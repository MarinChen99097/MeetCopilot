# MeetCopilot v2 — B2B 開會平台（CRM 核心 × DynamicSlide × 會中副駕 × 模擬訓練）

以詳細 **CRM ＋ 研究引擎（爬蟲＋grounding）** 為核心的 B2B 銷售平台：會前/會中蒐集對方公司與主管情報，
供三個消費端——**DynamicSlide**（會中依對話 append 補充簡報頁）、**會中副駕**（即時給報告者補充資訊）、
**模擬訓練**（AI 用 CRM 資料扮客戶做語音對練）。
**目前狀態**：M0–M5 全部完成，**已部署 GCP Cloud Run×2＋Cloud SQL Postgres**（見 `docs/DEPLOY.md`＋WORKLOG 最新節）。
**2026-07-09 v1/v2 已徹底合一**：本 repo 現駐 `c:/Users/Martin/Desktop/MeetCopilot`（origin＝GitHub `MarinChen99097/MeetCopilot`）；v1 已封存（GitHub `MeetCopilot-v1-archive`），不再維護。

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
| **改了任何程式碼之後** | `docs/CHANGE_TRACKER.md`（**強制**：立刻追加變更紀錄，規則見該檔） |
| **下了任何決策之後**（使用者或 Claude） | `docs/ROM.md`（**強制**：決策總帳，可長可雜；500 行歸檔＋目錄簡介） |
| 密鑰外洩處理／.gitignore 判斷／gitleaks | `docs/SECRETS_SOP.md` |
| admin 後台（apps/admin）任何開發 | `docs/ADMIN_CONTRACT.md`（接縫凍結，實作不得自創欄位） |
| 踩坑/環境陷阱 | `docs/DIAGNOSIS.md`＋把新教訓寫 `docs/LESSONS.md` |
| 接手新 session、想了解全局 | `docs/LETTER_TO_FUTURE_SESSIONS.md` |
| 想借 v1 的碼 | GitHub `MarinChen99097/MeetCopilot-v1-archive`（封存參考件；借＝重寫對齊本 repo 契約） |

## 硬規則（不讀其他檔也必須遵守）

1. **指揮官不下場**：讀 3+ 檔／掃目錄／跑驗證 → 派 subagent，主對話只收結論＋`檔案:行號`。**模型分工（使用者 2026-07-07 拍板）：Fable＝主決策者（指揮官）；搜尋/調查/研究/驗證/審查等 agent 一律 `model:"opus"`**。例外：本檔與 `docs/` 制度檔（含 WORKLOG/DECISIONS）是寫給指揮官讀的，親自讀不違反——本條管程式碼、資料與探索性搜尋。
2. **隨做隨存**：每完成一項立刻用 Write/Edit 存檔再做下一項；跨 session 狀態寫 `docs/WORKLOG.md`。（commit 時機受硬規則 10 約束）
3. **寫檔用 Write/Edit**，不用 shell 寫檔（PowerShell 5.1 預設 UTF-16 會亂碼）。
4. **改既有檔前確認 `git status` 乾淨**（v2 已 git init，是主要備份）；階段性成果隨手 commit 即可回滾，不需 `.bak`。追加型日誌（WORKLOG/LESSONS）更不需處理。
5. **驗證不自驗**：宣稱完成前，派 fresh-context agent 做 read-back 或跑測試。
6. **平行派工先鎖契約**（v1 L5 教訓）：並行 agent 前把共用契約凍結，各 agent 只實作不改契約，整合時驗一致。
7. **授權用攻擊者憑證測**（v1 教訓）：I2/authz 用非 presenter / 跨 org 憑證測被拒。
8. **程式碼變更必記 CHANGE_TRACKER**（決策 17）：每次 Edit/Write 程式檔後**立刻**照 `docs/CHANGE_TRACKER.md` 追加一筆（錨點插入、嚴禁 Write 覆寫、>500 行打包）。
9. **決策必記 ROM**（決策 19）：使用者或 Claude 下的**任何決策**（含否決、預設值選擇）當下照 `docs/ROM.md` 追加——不精簡、帶脈絡與替代方案；500 行歸檔到 `rom_archives/ROM_NNN.md` 並在目錄寫簡介。
10. **commit／部署前先問**（使用者 2026-07-08 立規，2026-07-09 同步入本檔）：完成一輪程式修改後回報改了什麼＋擬好的 commit message，**不自行**執行 `git commit`／`git push`／`gcloud` 部署，一律等使用者同意。Write/Edit 存檔與追加 WORKLOG/LESSONS/ROM/CHANGE_TRACKER 不算 commit，照硬規則 2 隨做隨存。

## 環境速記

- Windows 11＋PowerShell 5.1（`&&` 不可用；Unix 命令多數不存在）＋Bash 工具（Git Bash）。
- 本 repo 已接 GitHub origin（`MarinChen99097/MeetCopilot`，private，2026-07-09 起）；改壞可 diff／checkout 回滾。v1 已封存於 GitHub `MeetCopilot-v1-archive`。
- **硬平台約束**：會中「接收聲音」端限 Chrome/Edge 桌面（getDisplayMedia 分頁音訊）；帳號 B 的 Meet 分頁＋Copilot 分頁需同瀏覽器 profile。
- LLM 文字/語音用 Gemini（`@google/genai`，需 GEMINI_API_KEY）；**生圖用 OpenAI `gpt-image-2`**（openai npm，需 OPENAI_API_KEY＋先完成組織驗證）。model ID 見 API_FINDINGS，連線時再確認。
- 未授權 MCP server：告知使用者去授權，不要代辦 OAuth。

## 維護

本檔上限 150 行、只放索引與硬規則；長內容放 `docs/` 並在路由表掛連結。
許可權與教訓回寫格式見 `docs/MAINTENANCE.md`。
