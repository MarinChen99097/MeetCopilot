# 工作日誌（跨 session 狀態）

> 新 session 開工第一步＝讀本檔**最尾端**的最後一個 `##` 區塊（新紀錄一律追加在檔尾）。格式見 `MAINTENANCE.md`。

## 2026-07-06 session（Fable 5 · v2 大 pivot：討論定案＋寫計畫書）

- **背景**：使用者要「整個重新構建 MeetCopilot 與 DynamicSlide，兩個都用於 B2B 開會」。從 v1 的單一「會中簡報 Copilot」擴為**一個平台傘名下、CRM 核心 + 三個消費端**（DynamicSlide / 會中副駕 / 語音模擬訓練）。使用者明確要 Fable「不斷討論到細節定案，再寫給後續較弱模型執行的計畫書」。
- **做了（本 session 只討論+寫計畫，不動程式碼）**：
  1. 兩輪 AskUserQuestion 鎖定 14 項決策（重寫方式/技術棧/資料庫/研究引擎/生圖/語音/交付順序/命名/部署…）＋使用者中途加的**會議模型**（純網頁雙帳號：A 分享簡報、B 擷取混音、HUD 第二裝置）。全記入 `docs/00-DECISIONS.md`。
  2. 派 Explore agent 摸清 ezpagesite「從網址匯入」爬蟲（Playwright+stealth 渲染、子頁評分爬 5 頁、視覺截圖、但**無 SSRF 防護**）——值得搬，且要補 SSRF。
  3. 跑研究工作流（wf_dd7636ee-fde，4 agent 並行）查證載重假設，結論寫 `research/API_FINDINGS.md`：
     - **Gemini Live API 不適合會議 ASR**（無 diarization、單使用者、15min）→ 只用於語音模擬；會議 ASR 走 Gemini 分段轉寫。
     - **雙帳號擷取可行但**只 Chromium 桌面、且 B 的 Meet+Copilot 分頁需**同 profile**（「兩瀏覽器」是陷阱）→ S1 spike。
     - **整頁生圖進不了會中預算**（2–4s）→ AI 生圖一律 pre-meeting。
     - CRM 詳細 schema 定案（`CRM_SCHEMA.md`）。
  4. 建 v2 repo `c:/Users/Martin/Desktop/MeetCopilot_v2`（git init），把 v1 的**制度檔**（MODEL_DISPATCH/JUDGMENT_RUBRICS/TASK_TEMPLATES/LESSONS/DIAGNOSIS/MAINTENANCE）與原始 HTML 願景搬過來。
  5. 寫出計畫書全套：`CLAUDE.md`（路由）、`00-DECISIONS.md`、`PRODUCT_SPEC.md`、`ARCHITECTURE_PLAN.md`（模組地圖＋M0–M5 驗收＋S1–S5 spike）、`CRM_SCHEMA.md`、`research/API_FINDINGS.md`。
- **下一步（動工）**：從 **M0 地基**開始（monorepo + packages/shared 契約 + packages/crm DbPort/migration/base repo + auth + i18n + gemini client），**平行跑 S1/S3/S4 spike**。S1（雙帳號擷取）最高風險，先驗；失敗要回頭與使用者重議。
- **待決/誠實**：三線並行（M2–M4）契約漂移風險高（v1 踩過）→ 動工前先凍結 shared 契約。接收端只 Chromium 桌面是硬約束，M0 要再向使用者確認可接受。會中研究的成本/合規邊界只做公開資訊＋每場上限＋provenance。
- **狀態**：計畫書定案，未動程式碼。git（v2）尚未首次 commit（待本 session 收尾 commit 制度檔+計畫書）。
