# 決策紀錄（MeetCopilot v2 重建）

> 這份是「使用者已拍板」的決策清單，來源＝2026-07-06 Fable 5 與使用者的討論。
> 後續任何 session／模型執行時，**這裡的決策視為既定前提，不要重問、不要自行推翻**。
> 若要偏離，先停下來問使用者（見 `JUDGMENT_RUBRICS.md`）。

## 產品定位（大 pivot）

MeetCopilot 從「單一會中簡報 Copilot」擴為**一個平台傘名下的兩個 B2B 開會產品 + 一個共用核心**：

| 代號 | 是什麼 | 一句話 |
|---|---|---|
| **共用核心** | CRM ＋ 研究引擎（爬蟲＋grounding）＋檢索 | 事先存好公司/客戶/主管的詳細資料，會前用爬蟲填、用戶細填；會中可主動爬對方公司與主管背景 |
| **DynamicSlide** | 動態簡報 | 依會議內容**新增**簡報頁（補充說明），兩種生成路徑（沿用風格的 CSS／AI 生圖） |
| **MeetCopilot（會中副駕）** | 即時副駕 + 模擬訓練 | 會中給報告者即時補充資訊；會前用 CRM 資料做 AI 扮演客戶的**語音**模擬對練 |

## 14 項已鎖定決策

1. **重建方式＝從零重寫**（fresh rewrite）。v1（`c:/Users/Martin/Desktop/MeetCopilot`）保留為參考件，不動；v2 在新目錄 `c:/Users/Martin/Desktop/MeetCopilot_v2`（已 `git init`）。
2. **技術棧＝同棧重寫**：Next.js 15（App Router、next-intl zh-TW/en、純 CSS）＋ Express＋ws ＋ better-sqlite3 ＋ Gemini（@google/genai）。v1 舊碼可當參考件直接借。
3. **傘名沿用 MeetCopilot**；平台下含 DynamicSlide 與 MeetCopilot 兩個 surface。
4. **兩個產品並行開發**（M2 起三條並行線：DynamicSlide／會中副駕／語音模擬）。
5. **語音模擬訓練與第一個產品並行**（只依賴 CRM，不需會議擷取，可提早）。
6. **部署＝先本機、架構留雲端路**：開發與實戰都在使用者本機（localhost，開會前啟動）；不寫死 localhost，日後上雲不動業務碼。
7. **資料庫＝SQLite 起步 ＋ repository 層**：better-sqlite3 ＋ JS cosine 檢索；用 repository 層隔離，日後換 Postgres/pgvector 不動業務碼。
8. **研究引擎＝混合式**：Gemini Google Search grounding（開放背景研究，合法、自帶引用、零爬蟲維運）＋ **搬 ezpagesite wizard phase 1「從網址匯入」的自建爬蟲**（Playwright＋stealth 渲染 SPA、子頁連結評分爬取、視覺截圖）深讀使用者指定網址；沿用 v1 的 SSRF-safe 抽取器並**把 SSRF 檢查掛在對使用者提供 URL 的首次 fetch 上**（ezpagesite 原版有這缺口）。
9. **會中即時研究觸發＝自動＋手動並行**：訊號分析偵測到新話題/新人名時自動發研究（每場設次數/成本上限）；HUD 另有「深查」按鈕讓報告者點名主題。
10. **AI 生圖＝兩者都做**：(a) 背景圖＋CSS 真文字疊層（預設，可編輯、中文不糊、pptx 可用）；(b) 整頁生圖（純視覺頁）。
11. **語音模擬引擎＝Gemini Live API**（原生雙向即時語音，聽＋說同一模型、支援打斷）；抽象層留好接口，若配額/品質出問題可退回「ASR＋文字 LLM＋TTS」拼裝。
12. **模擬訓練＝直接做語音模擬**（不先做文字版）。
13. **DynamicSlide 新頁＝插到最後面當補充**（不再插在特定頁後面）；**仍需報告者批准才進 deck**（保留 I2）。
14. **HUD ＝第二裝置（手機/平板）**：HUD 做成 responsive，報告者用另一台裝置看建議/研究卡/逐字稿。

## 會議運作模型（web-only 雙帳號 — 使用者 2026-07-06 明確指定）

**不做桌面軟體，一律網頁版。** Google Meet 實戰時報告者開**兩個帳號/兩個瀏覽器**：

```
帳號 A（報告 / presenter）          帳號 B（接收聲音 / listener）
─────────────────────────          ──────────────────────────────
· 開 DynamicSlide「播放視圖」       · 以靜音+關鏡頭身分加入同一個 Meet
· 只把「簡報那個分頁」分享進 Meet   · Copilot web app 用 getDisplayMedia
· 播放視圖是乾淨舞台（無 HUD）        擷取「Meet 分頁的音訊」＝所有人混音
                                    · 送 ASR → 分析 → 研究 → HUD
                                    · 此瀏覽器永不被分享
        │                                   │
        └──── 報告者用第二裝置看 B 的 HUD ────┘
```

### 為什麼這個模型是重大簡化
- **I3（HUD 不外流）幾乎天然成立**：報告者只分享「簡報分頁」；HUD 在帳號 B / 第二裝置，從不進任何被分享的畫面。v1 那套 `getDisplayMedia` 整螢幕 preflight 複雜度大幅下降（仍保留「播放視圖不得渲染 HUD 元素」「分享分頁而非整螢幕」的輕量守則）。
- **音訊擷取大幅簡化**：不需 loopback、不需 Electron desktopCapturer。帳號 B 是真實與會者，透過 Meet 自己的混音聽到所有人；Copilot 只需擷取 Meet 分頁音訊。
- **代價（誠實揭露）**：帳號 B 聽到的是**一條混音**，失去乾淨的 presenter/client 分軌 → **辨識誰在講話改用「轉逐字稿後 LLM 依內容/語氣推斷」**（決策 R#），不做雙軌 diarization。帳號 B 在 Meet 靜音，故混音裡不含 B 自己的麥克風、無回音迴圈。

## 三大不變量（延續 v1，依新模型調整落點）

| # | 不變量 | v2 落地 |
|---|---|---|
| **I1** | 只改 pending：deck 變更僅新增到**尾端**（append），不動已播頁 | 改造引擎只允許 `APPEND`（append-only）＋pending 尾段 `REORDER`；不再有插入中段 |
| **I2** | 需報告者批准：patch 進 live deck 前必經 approval gate | 新頁進 HUD 佇列，報告者接受才附到簡報尾部；未批准客戶永遠看不到 |
| **I3** | HUD 不外流：Copilot 介面不得出現在被分享畫面 | 雙帳號模型天然隔離（見上）＋播放視圖零 HUD ＋只分享分頁 |

> I1/I2/I3 從 M1 起就生效；在 approval gate／播放視圖隔離機制完工前，任何 demo 禁止把未批准內容顯示給客戶側。

## 研究回填（2026-07-06 工作流查證，詳見 `research/API_FINDINGS.md`）

四項載重假設已查證，其中**三項修正/釐清了原決策**（動工前務必吸收）：

1. **會議 ASR 不用 Gemini Live API**（釐清決策 11 邊界）：Live API 無 speaker diarization、為單一互動使用者設計、單場 ~15 分鐘——**不適合被動轉寫會議混音**。→ 會議 ASR 走 Gemini 分段轉寫（藏在 `AsrProvider` 後），diarization 交下游 LLM。Live API **只用於語音模擬訓練**（決策 11/12 的強適配用途不變）。
2. **AI 生圖一律 pre-meeting**（修正決策 10 的落地）：整頁生圖光生成就 2–4s，**進不了 <4s 會中預算**。→ 所有 AI 生圖是會前/預取；會中即時只走「沿用風格 CSS 路徑」＋重用會前已生背景圖。生圖被內容安全擋時 fallback 漸層/CSS，絕不出壞頁。
3. **雙帳號需「同瀏覽器 profile」**（釐清會議模型）：getDisplayMedia 分頁音訊只列**同一 Chromium instance** 的分頁——帳號 B 的 Meet 分頁與 Copilot 擷取分頁必須同 profile；且**接收端硬限 Chrome/Edge 桌面**（Firefox/Safari/行動不支援）。HUD 檢視端（第二裝置）不受限，因只看不擷取。→ 列為 **S1 spike**（最高風險）。

其餘查證確認可照原決策：Gemini Live model `gemini-3.1-flash-live-preview`（瀏覽器經 ephemeral token 直連、長對練開 compression+resumption）；生圖 `gemini-3.1-flash-image`（背景）/`gemini-3-pro-image`（中文 in-image 97%，會前純視覺頁）；CRM 詳細 schema 已定案於 `CRM_SCHEMA.md`。
