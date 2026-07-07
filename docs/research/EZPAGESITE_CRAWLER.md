# ezpagesite「從網址匯入」爬蟲 — 原版實作地圖（搬運參考）

> 來源＝2026-07-06 Explore agent 對 `C:\Users\Martin\Desktop\ezpagesite` 的實測探勘。
> **用途**：v2 研究引擎的爬蟲要「邏輯照搬、語言換 Node」（原版 Python）。這份是原版的檔案:行號地圖，
> 實作 M1 研究引擎時照這裡去讀原始碼，不要重新探勘。
> ⚠️ **原版有安全缺口**：主爬取流程**沒掛 SSRF 防護**（詳見文末）——v2 必補，不得照抄這個缺口。

## 前端入口（Phase 1「從網址匯入」）

- 按鈕：`components/WizardV2/WizardV2View.tsx:624-634`
- 彈窗 UI：`components/WizardV2/WizardSharedModals.tsx:122-254`（URL 輸入框 + quick/detailed 兩種模式選擇）
- 狀態與 handler：`app/[locale]/wizard/page.tsx:1442-1446`（`isUrlImportModalOpen/urlToImport/isScrapingUrl/scrapeStage/scrapeError`）
- `handleUrlImport`：`app/[locale]/wizard/page.tsx:2971-3014` → `api.post('/scrape_landing_page', {url, mode}, {timeout:30000})`（`page.tsx:2983`）
- 非同步輪詢交給背景任務 provider：`startUrlImport`（`hooks/use-background-tasks.tsx:318-334`），可跨頁面存活
- 結果套用：`applyImportResponse`（`app/[locale]/wizard/page.tsx:2759-2802+`）

## 輸入

單一 URL（`marketing_backend/core/schemas.py:648-652` `ScrapeUrlRequest{url, mode:"quick"|"detailed", session_id?}`）。無多 URL 批次。

## 抓取方式（雙引擎並行）

後端 `POST /scrape_landing_page`（`main.py:5200-5297`）非同步 dispatch 到 `_quick_import`（`main.py:2742`）或 `_detailed_import`（`main.py:3695`）。兩者皆**並行跑兩條管線**：

1. **Gemini「URL Context Tool」**做結構化擷取——`core/llm_client.py:2725-2785`（用 Gemini 內建網頁抓取 + google_search grounding，非自建爬蟲）
2. **headless Chromium via Playwright + playwright-stealth**（`main.py:2776-2822`，`sync_playwright` + stealth 反偵測 script）＋ **BeautifulSoup** 補抓圖片（`main.py:1427-1466`, `3389`, `4752`）＋ **httpx** 作 HTML fallback 與圖片下載（`main.py:3247`, `3301`, `3436`, `4603`, `4818`）

截圖能力：全頁截圖（`~2900`, `4062`, `4131`）、spec 表格截圖（`3121`, `4192`）、logo 元素截圖（`4320`）、頁面分段截圖 `screenshot_segments`（`4101`）。

## 抓多深

- **detailed 模式**：`_discover_sub_pages`（`main.py:2277-2730`）以關鍵字正規式評分（`2317-2323`）在頁內 `<a>` 掃描找最多 **5 個子頁**（`max_sub_pages=5`, `main.py:2599`）並逐一造訪截圖；另會點擊分頁 tab 揭露內容、蒐集 PDF 連結。**無 sitemap.xml 解析**，純靠頁內連結評分。
- **quick 模式**：只抓單頁。

## 抽取什麼

`ScrapedLandingPage` schema（`core/schemas.py:655-709+`）：`brand_name / product_name / base_description / value_proposition / key_features / product_appeal / industry_category`（30 產業別）、`image_urls / primary_color / logo_url`、`page_title / meta_description`，＋約 20 個產業專屬欄位（成分、規格、尺寸、定價…）。

## 輸出（非同步 job/poll 架構）

Dispatcher 立即回 `{scrape_id, status}`（`main.py:5291-5297`），前端輪詢 `GET /scrape_status/{scrape_id}`（`main.py:5300`），完成後 `result = {phase1_data, images:[{url,name,type,zone}], logo_image, full_page_screenshot, warnings, session_merge}`。前端 `applyImportResponse` 依 `zone` 分組圖片寫入 sharedData；帶 `session_id` 則後端自動合併（`main.py:5247-5270` → `core/session_asset_writer.py`）。

## 安全性（⚠️ v2 必修的缺口）

- 原版僅有 timeout（Playwright nav 30s / networkidle 8s、httpx 15–30s、前端 30s），**主爬取流程無 SSRF 防護**——目標 URL 直接餵 Playwright/httpx，未檢查私網/loopback/metadata IP。
- 專案裡其實有一套 SSRF 工具 `_is_safe_download_url` / `download_public_url_to_bytes`（`core/gcs_storage.py:661-784`，只允許 https+公網 IP），但只接在 `/vision/analyze-image`（`main.py:5780-5781`），**沒套在 scrape_landing_page**。
- **v2 規則**：SSRF 檢查掛在**所有**使用者提供 URL 的首次 fetch 上。undici 路徑直接借 v1 `apps/server/src/import/extract.ts` 的 DNS-pin 方案（解析→驗全部 IP→pin 已驗 IP→逐跳重驗）；**Playwright 路徑不走 undici、DNS-pin 不直接適用**——落地手法＝導航前解析並驗證 IP＋`page.route()` 逐請求攔截驗證（每個子請求的目標 host 都過 isPrivateIp 檢查）＋擋未驗 redirect（S4 spike 驗證此組合在真實網站不誤殺）。
- 圖片只有下限過濾（<500B 視為佔位圖，`1763-1791`），無頁面大小上限——v2 要補上限。

## 依賴（原版）→ v2 對應

| 原版（Python） | v2（Node） |
|---|---|
| `playwright>=1.40.0` + `playwright-stealth>=1.0.6`（requirements.txt:46-47） | `playwright`（Node 版）＋ stealth 等價（如 `playwright-extra` + stealth plugin；選型時查現況） |
| `beautifulsoup4`（:51） | `cheerio` |
| `httpx`（:50） | v1 的 undici SSRF-safe 抽取器（直接借） |
| `google-genai>=1.0.0`（:17） | `@google/genai`（同） |
| `pillow`（:39） | `sharp`（若需要圖片處理）或省略 |

## 值得搬 / 不搬

**搬**：Playwright+stealth 渲染路徑（SPA 頁面）、子頁連結評分邏輯（`main.py:2317-2323` 的關鍵字權重）、截圖分段當視覺素材的手法、雙引擎（Gemini URL-context ＋ DOM 爬蟲）互補、非同步 job/poll 架構（對應 v2 的 `crawl_jobs` 表）。
**不搬**：30 產業別的 LP 專屬欄位（v2 的抽取目標是 CRM 欄位，見 `CRM_SCHEMA.md` §11 爬蟲可填清單）、session_merge 機制（v2 用 `upsertFromCrawl`）、無 SSRF 的裸 fetch（缺口）。
