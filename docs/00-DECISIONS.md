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

## 14 項已鎖定決策（2026-07-06；15–18 見下方補充拍板節）

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

**不做桌面軟體，一律網頁版。** Google Meet 實戰時報告者開**兩個帳號／兩個瀏覽器 profile**（⚠️ 帳號 B 的 Meet 分頁與 Copilot 擷取分頁**放同一個 profile 才是可靠路徑**，見文末研究回填 3）：

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
- **代價（誠實揭露）**：帳號 B 聽到的是**一條混音**，失去乾淨的 presenter/client 分軌 → **辨識誰在講話改用「轉逐字稿後 LLM 依內容/語氣推斷」**（使用者 2026-07-06 拍板），不做雙軌 diarization。帳號 B 在 Meet 靜音，故混音裡不含 B 自己的麥克風、無回音迴圈。

## 三大不變量（延續 v1，依新模型調整落點）

| # | 不變量 | v2 落地 |
|---|---|---|
| **I1** | 只改 pending：deck 變更僅新增到**尾端**（append），不動已播頁 | 改造引擎只允許 `APPEND`（append-only）＋pending 尾段 `REORDER`；不再有插入中段 |
| **I2** | 需報告者批准：patch 進 live deck 前必經 approval gate | 新頁進 HUD 佇列，報告者接受才附到簡報尾部；未批准客戶永遠看不到 |
| **I3** | HUD 不外流：Copilot 介面不得出現在被分享畫面 | 雙帳號模型天然隔離（見上）＋播放視圖零 HUD ＋只分享分頁 |

> I1/I2/I3 從 M1 起就生效；在 approval gate／播放視圖隔離機制完工前，任何 demo 禁止把未批准內容顯示給客戶側。

## 2026-07-07 補充拍板（使用者四項新指示）

15. **AI 生圖供應商改 OpenAI `gpt-image-2`**（使用者稱 image-2；同日查證確認 ID＝`gpt-image-2`，snapshot 2026-04-21）：`ImageProvider` 抽象、OpenAI 主力、Gemini 降備選；`1536x864` 原生 16:9、quality 顯式 low/medium/high；被擋/逾時 fallback（漸層/CSS）不變。**查證後果**：延遲 ~80s 級（agentic 規劃階段）→ 生圖**一律 pre-meeting 坐實**、會中選配唯一候選 `gpt-image-1-mini`（S5 另議）；**前置＝OpenAI 組織驗證＋tier 配額確認**；輸出強制 C2PA＋SynthID。細節見 `research/API_FINDINGS.md` §F。
16. **擷取相容性測試工具先行**：`tools/capture-test.html`（單檔、雙擊可開、免安裝）——使用者要親測「各裝置 × 各開會軟體（Meet/Zoom/Teams…）」的分頁/視窗音訊擷取配合度；此工具是 S1 spike 的載具，M0 前就交付。（**已交付**：tools/capture-test.html＋tools/README.md 矩陣範本。）
17. **引入 ezpagesite 的 code-tracker 制度**：實體＝ezpagesite 的 **CHANGE_TRACKER**（強制變更日誌：每次改程式檔立刻追加一筆、錨點插入、>500 行打包），移植時加「工作區」欄位。（**已落地**：`docs/CHANGE_TRACKER.md`＋CLAUDE.md 硬規則。）
18. **CRM 對方產品深檔**：CRM 欄位要能「完整介紹一家公司的產品」含細節與開發人——新增 `company_products`（規格/功能/定價/技術棧/整合/路線圖）、`company_product_people`（產品↔人：developer/PM/owner…）、`company_departments`（部門/主管/人數），接上 embedding 檢索與爬蟲填欄。（**已落地**：CRM_SCHEMA「對方產品深檔」節。）
19. **建立 ROM 決策總帳**（2026-07-07 追加）：記錄使用者或 Claude 的**所有決策**——比 memory 更大更雜、不精簡、帶脈絡與替代方案；每 500 行歸檔 `rom_archives/ROM_NNN.md`（序號命名），ROM.md 頂部維護每檔簡介的歸檔目錄。與本檔分工：本檔＝蒸餾後前提（衝突時為準）、ROM＝全量帳。（**已落地**：`docs/ROM.md`＋CLAUDE.md 硬規則 9。）
20. **SaaS 成品化**（2026-07-07 追加）：目標是**上線營運的 SaaS 成品，不是 demo**。四項細部拍板——(a) **資料庫維持 SQLite 起步**（repo 層已隔離，量大再遷 Postgres）；(b) **部署 GCP**；(c) **計費先不做，邀請制**（org.plan 欄位留鉤子，要收費再接 Stripe）；(d) **前端成品全由我方 agent 設計＋實作**（Claude Design prompt 包轉為「設計規格」供 agent 與使用者參考，前端進度不等原型）。**技術現實（Fable 點破）**：SQLite×GCP 的可行形態＝**單一 Compute Engine VM＋持久磁碟**（Docker Compose：server 含 Playwright、web、Caddy 自動 TLS；每日磁碟 snapshot 備份）——Cloud Run 檔案系統短暫、放不了 SQLite；未來量大 → Cloud SQL Postgres（不動業務碼）。**使用者前置**：開 GCP 專案＋帳單帳戶、準備網域。

## 研究回填（2026-07-06 工作流查證，詳見 `research/API_FINDINGS.md`）

四項載重假設已查證，其中**三項修正/釐清了原決策**（動工前務必吸收）：

1. **會議 ASR 不用 Gemini Live API**（釐清決策 11 邊界）：Live API 無 speaker diarization、為單一互動使用者設計、單場 ~15 分鐘——**不適合被動轉寫會議混音**。→ 會議 ASR 走 Gemini 分段轉寫（藏在 `AsrProvider` 後），diarization 交下游 LLM。Live API **只用於語音模擬訓練**（決策 11/12 的強適配用途不變）。
2. **AI 生圖預設 pre-meeting**（修正決策 10 的落地；2026-07-07 二次查核再校準）：生圖延遲**無官方數字**（第三方：flash-lite 目標 sub-2s、flash 級 ~2–4s）→ 當工程估計、S5 spike 實測。預設仍會前/預取（延遲變異＋**會中被內容安全誤擋不可在客戶面前發生**）；會中即時走「沿用風格 CSS 路徑」＋重用已生背景圖；若 S5 實測穩定可開「會中 1K 快速生圖」選配（嚴格逾時＋fallback）。被擋一律 fallback 漸層/CSS，絕不出壞頁。
3. **雙帳號建議「同瀏覽器 profile」**（釐清會議模型；2026-07-07 二次查核校準）：分頁 picker 只列**同一 Chromium instance** 的分頁（UA 實作行為、規範未載明）——**可靠路徑**＝B 的 Meet 分頁與 Copilot 擷取分頁同 profile；跨 profile 有 Window-surface 備援（音訊可得性隨 OS/版本，S1 一併驗）。**接收端硬限 Chrome/Edge 桌面**（Firefox/Safari/行動不支援分頁音訊擷取）。HUD 檢視端（第二裝置）不受限，因只看不擷取。→ 列為 **S1 spike**（最高風險）。

其餘查證確認可照原決策：Gemini Live model `gemini-3.1-flash-live-preview`（瀏覽器經 ephemeral token 直連、長對練開 compression+resumption）；生圖 `gemini-3.1-flash-image`（背景）/`gemini-3-pro-image`（中文 in-image 97%，會前純視覺頁）；CRM 詳細 schema 已定案於 `CRM_SCHEMA.md`。
