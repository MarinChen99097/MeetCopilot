# MeetCopilot v2 — B2B 開會平台（CRM 核心 × DynamicSlide × 會中副駕 × 模擬訓練）

以詳細 **CRM ＋ 研究引擎（爬蟲＋grounding）** 為核心的 B2B 銷售平台：會前/會中蒐集對方公司與主管情報，
供三個消費端——**DynamicSlide**（會中依對話 append 補充簡報頁）、**會中副駕**（即時給報告者補充資訊）、
**模擬訓練**（AI 用 CRM 資料扮客戶做語音對練）。
**目前狀態**：計畫書已定案（2026-07-06，Fable 5 與使用者討論拍板），**尚未動程式碼**。開發按 M0→M5 里程碑推進。
**這是 v1（`c:/Users/Martin/Desktop/MeetCopilot`）的從零重寫**；v1 保留為參考件，可讀可借碼，不動。

## 開工第一步（每個 session 必做）

1. 讀 `docs/WORKLOG.md` 最尾端一節，確認上次做到哪。
2. 讀 `docs/00-DECISIONS.md`——**14 項已拍板決策＋會議模型，視為既定前提，不要重問**。
3. 依下方路由表，只讀與當前任務相關的檔案。

## 三大產品不變量（任何改動都不可違反）

- **I1** 只改 pending：deck 變更僅 **append 到尾端**（不動已播頁）；改造引擎只有 `APPEND`＋pending `REORDER`。
- **I2** 需報告者批准：新頁進 live deck 前必經 approval gate（只有 ACCEPT/EDIT 會 append）。
- **I3** HUD 絕不外流：雙帳號天然隔離（報告者只分享簡報分頁、HUD 在帳號 B/第二裝置）；播放視圖零 HUD 元素。

細節見 `docs/PRODUCT_SPEC.md`。若改動會削弱 I1/I2/I3 → 停下來問使用者。

## 路由表（做什麼 → 先讀什麼）

| 任務 | 先讀 |
|---|---|
| 已拍板決策、會議模型（雙帳號 web-only） | `docs/00-DECISIONS.md` |
| 產品怎麼運作（三產品一核心、流程、不變量） | `docs/PRODUCT_SPEC.md` |
| 架構、模組地圖、里程碑 M0–M5＋驗收、spike | `docs/ARCHITECTURE_PLAN.md` |
| API 事實（Gemini Live/生圖 model ID、擷取限制）——**不能猜** | `docs/research/API_FINDINGS.md` |
| CRM 資料 schema、repository、provenance、檢索 | `docs/CRM_SCHEMA.md` |
| 派 subagent、選模型、驗證工作 | `docs/MODEL_DISPATCH.md` |
| 拿不定主意（升級？完成了嗎？該問使用者嗎？） | `docs/JUDGMENT_RUBRICS.md` |
| 交辦任務給 subagent 前 | `docs/TASK_TEMPLATES.md`（照模板；含平行契約鎖定守則） |
| 改本檔或 docs/ 制度檔 | `docs/MAINTENANCE.md`（先看許可權） |
| 踩坑/環境陷阱 | `docs/DIAGNOSIS.md`＋把新教訓寫 `docs/LESSONS.md` |
| 接手新 session、想了解全局 | `docs/LETTER_TO_FUTURE_SESSIONS.md` |
| 想借 v1 的碼 | 讀 `c:/Users/Martin/Desktop/MeetCopilot/apps/server/src`（參考件；借＝在 v2 重寫對齊新契約） |

## 硬規則（不讀其他檔也必須遵守）

1. **指揮官不下場**：讀 3+ 檔／掃目錄／跑驗證 → 派 subagent，主對話只收結論＋`檔案:行號`。**模型分工（使用者 2026-07-07 拍板）：Fable＝主決策者（指揮官）；搜尋/調查/研究/驗證/審查等 agent 一律 `model:"opus"`**。例外：本檔與 `docs/` 制度檔（含 WORKLOG/DECISIONS）是寫給指揮官讀的，親自讀不違反——本條管程式碼、資料與探索性搜尋。
2. **隨做隨存**：每完成一項立刻 commit 再做下一項；跨 session 狀態寫 `docs/WORKLOG.md`。
3. **寫檔用 Write/Edit**，不用 shell 寫檔（PowerShell 5.1 預設 UTF-16 會亂碼）。
4. **改既有檔前確認 `git status` 乾淨**（v2 已 git init，是主要備份）；階段性成果隨手 commit 即可回滾，不需 `.bak`。追加型日誌（WORKLOG/LESSONS）更不需處理。
5. **驗證不自驗**：宣稱完成前，派 fresh-context agent 做 read-back 或跑測試。
6. **平行派工先鎖契約**（v1 L5 教訓）：並行 agent 前把共用契約凍結，各 agent 只實作不改契約，整合時驗一致。
7. **授權用攻擊者憑證測**（v1 教訓）：I2/authz 用非 presenter / 跨 org 憑證測被拒。

## 環境速記

- Windows 11＋PowerShell 5.1（`&&` 不可用；Unix 命令多數不存在）＋Bash 工具（Git Bash）。
- v2 **已 git init**（2026-07-06，主要備份）；改壞可 commit/diff 回滾。v1 在隔壁目錄不動。
- **硬平台約束**：會中「接收聲音」端限 Chrome/Edge 桌面（getDisplayMedia 分頁音訊）；帳號 B 的 Meet 分頁＋Copilot 分頁需同瀏覽器 profile。
- LLM 全用 Gemini（`@google/genai`）；需 GEMINI_API_KEY。model ID 見 API_FINDINGS，連線時再確認 preview 後綴。
- 未授權 MCP server：告知使用者去授權，不要代辦 OAuth。

## 維護

本檔上限 150 行、只放索引與硬規則；長內容放 `docs/` 並在路由表掛連結。
許可權與教訓回寫格式見 `docs/MAINTENANCE.md`。
