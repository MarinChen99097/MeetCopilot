# 產品規格：MeetCopilot v2（CRM 核心 × DynamicSlide × 會中副駕 × 模擬訓練）

> v2 產品規格。取代 v1 的同名檔（v1 只有「會中簡報 Copilot」單一產品）。
> 決策來源見 [00-DECISIONS.md](00-DECISIONS.md)；API 事實見 [research/API_FINDINGS.md](research/API_FINDINGS.md)；資料見 [CRM_SCHEMA.md](CRM_SCHEMA.md)。
> 規格有疑義時以 DECISIONS 為準；本檔與 DECISIONS 衝突視為本檔過時。

## 一句話

一個 B2B 銷售平台：以**詳細 CRM ＋ 研究引擎（爬蟲＋grounding）** 為核心，事先與會中蒐集對方公司/主管情報；三個消費端——**DynamicSlide**（會中依對話新增補充簡報頁）、**會中副駕**（即時給報告者補充資訊）、**模擬訓練**（AI 用 CRM 資料扮客戶做語音對練）。

## 使用者與情境

- **使用者**＝B2B 業務/售前（rep）。用 Google Meet 對「潛在客戶公司」開會做簡報銷售。
- **會前**：把對方公司與關鍵主管建進 CRM——先讓爬蟲填大半欄位，rep 再確認/細填。可能先用模擬訓練對練。
- **會中（雙帳號、純網頁、Chrome/Edge 桌面）**：
  - **帳號 A（報告）**：瀏覽器 profile 開 DynamicSlide 播放視圖，只把「簡報分頁」分享進 Meet。
  - **帳號 B（接收聲音）**：另一個 profile，以靜音+關鏡頭加入同一 Meet；同 profile 另開 Copilot 分頁，`getDisplayMedia` 擷取 Meet 分頁混音 → ASR → 分析 → 研究。
  - **HUD**：報告者用**第二裝置（手機/平板）**看建議/研究卡/逐字稿（只看不擷取，故可非 Chromium）。
- **會後**：會議訊號經批准回寫 CRM（異議、痛點、決策角色…），養厚下一次。

## 三大產品（一個核心）

### 核心：CRM ＋ 研究引擎
- CRM 詳細 schema（見 CRM_SCHEMA.md）：seller/products/competitors、對方 companies+子表、contacts（主管 persona）、deals、meetings/signals、notes、**field_provenance 信任層**、embeddings。
- 研究引擎（混合式）：
  1. **Gemini Google Search grounding**：開放背景研究（合法、自帶引用、零爬蟲維運）——公司概況、新聞、主管公開背景。
  2. **自建爬蟲（搬 ezpagesite wizard「從網址匯入」）**：Playwright + stealth 渲染 SPA、子頁連結評分爬取（最多 5 子頁）、視覺截圖；深讀 rep 指定的對方官網。**補上 ezpagesite 缺的 SSRF 防護**（把檢查掛在對使用者提供 URL 的首次 fetch，沿用 v1 SSRF-safe 抽取器）。
  3. 爬完 → `upsertFromCrawl` 寫實體欄位 + provenance rows（filled_by=crawler + source_url + confidence）→ UI 呈現「確認/細填」。
- **會中即時研究觸發＝自動＋手動並行**：訊號分析偵測新話題/新人名 → 自動發研究（每場設次數/成本上限）；HUD 有「深查」鈕讓報告者點名主題。

### 產品一：DynamicSlide（動態簡報）
- 會前：rep 匯入或 AI 生成簡報（沿用 v1 的 slide-spec + 模板 + wizard）。
- 會中：依對話**新增**簡報頁——**一律 append 到簡報尾端當「補充說明」**（不再插入特定頁後面）。
- **兩種生成路徑**：
  1. **沿用先前簡報風格的 CSS 生成**（會中即時路徑；快；繼承 anchor 頁 theme；結構化 slide-spec + 固定模板渲染，可編輯、pptx 可匯出）。
  2. **AI 生圖**（**一律 pre-meeting**，見 API_FINDINGS §C）：(a) 背景圖 + CSS 真文字疊層（預設）；(b) 整頁生圖（純視覺頁，`gemini-3-pro-image`）。會中只重用會前已生的背景圖，不即時整頁生圖。
- **新頁仍需報告者批准**（I2）：進 HUD 佇列，報告者接受才 append 到 deck 尾部；未批准客戶永遠看不到。

### 產品二：會中副駕（Meeting Copilot）
- 會中 ASR（見 API_FINDINGS §D：Gemini 分段轉寫，藏在 `AsrProvider` 後）→ rolling window 增量分析 → 結構化訊號 `{emotion, interest_topics, buying_signals, landmines, expansion_ops, objections, confidence}`。
- 訊號 + CRM 檢索（§CRM_SCHEMA §9 副駕查詢）→ 即時把「對方公司/主管補充資訊、對手 battlecard、objection handler、下一步建議」浮到報告者 HUD（第二裝置）。
- 遵守信任規則：人驗證欄位優先；低信心措辭「據公開資訊」。

### 產品三：模擬訓練（語音）
- AI 用 CRM 的特定 contact persona + company + deal + 過往會議 → **Gemini Live API 原生語音**扮演「那位客戶」與 rep 即時口語對練（可打斷、低延遲；瀏覽器經 ephemeral token 直連）。
- 課後：用 `inputAudioTranscription/outputAudioTranscription` 的逐字稿做評分報告（涵蓋異議處理、發現需求、成交訊號回應）。
- 只扮演人驗證/會議衍生的 persona 欄位（信任規則），不拿爬蟲猜測幻想。

## 三大不變量（架構層強制；從 M1 起生效）

| # | 不變量 | v2 落地機制 |
|---|---|---|
| **I1** | 只改 pending：deck 變更僅 **append 到尾端**，不動已播頁 | 改造引擎只暴露 `APPEND`（append-only）＋pending 尾段 `REORDER`；**移除**插入中段的 `INSERT_AFTER`。guard 對違規 op reject |
| **I2** | 需報告者批准：任何新頁進 live deck 前必經 approval gate | Approval FSM：`SUGGESTED →(ACCEPT/EDIT)→ APPLIED`；`REJECT/逾時 → DISCARDED`。只有 ACCEPT/EDIT 會 append |
| **I3** | HUD 不外流：Copilot 介面不得出現在被分享畫面 | 雙帳號天然隔離：報告者只分享簡報分頁、HUD 在帳號 B/第二裝置；**播放視圖零 HUD 元素**；保留「分享分頁而非整螢幕」輕量守則（不再需要 v1 的整螢幕 preflight，但播放視圖仍不得渲染任何建議/逐字稿） |

> 任何改動若削弱 I1/I2/I3 → 停下來問使用者（見 JUDGMENT_RUBRICS.md）。
> 在 approval gate／播放視圖隔離機制完工前，任何 demo 禁止把未批准內容顯示到客戶側。

## Approval FSM（同 v1，op 改 append）

`IDLE →(偵測訊號)→ SUGGESTED →(ACCEPT/EDIT)→ APPLIED`；`REJECT/逾時 → DISCARDED`（不可恢復）。

## 延遲預算（設計目標）

| 階段 | 目標 |
|---|---|
| 音訊 frame（AudioWorklet） | ~100–250 ms |
| 上送 + ASR final | ~300–800 ms |
| 增量分析（LLM） | ~0.8–1.5 s |
| CRM 檢索 | ~50–150 ms |
| 副駕建議浮現 | **< 2 s** |
| DynamicSlide 新頁（CSS 路徑） | **< 4 s**（可先出佔位再補內容）|
| **AI 生圖** | **不進會中預算**（一律會前預生，見 API_FINDINGS §C）|
| 模擬訓練語音來回（Live API） | 次秒級（原生音訊）|

## 資料與隱私

- 同意閘門（未同意不啟動擷取）；擷取的是 Meet 分頁混音（rep 自己在場）。
- 對方公司/主管情報：只蒐集**公開**資訊；provenance 記來源；低信心誠實標示。合規責任在 rep（工具僅呈現公開資料）。
- PII 落地前遮蔽；逐字稿與洞察 RBAC + org 隔離（每查詢 org_id-scoped）；持久化 opt-in + TTL；WSS/TLS。
- LLM 生成內容 sanitize + CSP（沿用 v1）。

## 硬性平台約束（來自 API 研究）

- **會中「接收聲音」端限 Chrome/Edge 桌面**（getDisplayMedia 分頁音訊只在 Chromium 桌面；Firefox/Safari/行動不支援）。HUD 檢視端不限。
- 帳號 B 的 Meet 分頁與 Copilot 分頁**必須同一瀏覽器 profile**（同瀏覽器才擷取得到分頁音訊）。
- Live API 單場 ~15 分鐘 → 模擬訓練必開 contextWindowCompression + sessionResumption。
- AI 生圖被內容安全擋時必須 fallback 到漸層/CSS 背景，絕不出壞頁。
