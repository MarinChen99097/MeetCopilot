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

## 2026-07-07 session（Fable 5 · 審查 Opus 產出＋新調度規則）

- **背景**：上一段「continue」之後（含最後一輪決策、研究工作流、整套計畫書、首次 commit 1588235）由 Opus 4.8 執行；使用者切回 Fable 並要求 (1) 審查 Opus 產出是否足夠詳細與正確、(2) 新調度規則——**Fable 主決策、搜尋調查等 agent 用 opus**（已寫入 MODEL_DISPATCH 拍板覆寫節＋CLAUDE.md 硬規則 1＋記憶）。
- **審查方法（三路，全 opus agent）**：(a) 事實查核工作流——21 條 API 載重宣稱對抗式重驗（live 來源）；(b) 全計畫書跨檔一致性審查；(c) CRM schema 設計審查（DDL 心智編譯）。加上 Fable 親自比對對話定案 vs 文件。
- **審查結論**：骨幹高品質、決策全數入檔、I1/I2/I3 三處表述一致；Live API 7 條宣稱全確認。但抓到並修正：
  - **事實面**：「同瀏覽器硬限制」降級為 UA 行為＋Window-surface 備援（S1 一併驗）；生圖「97%」非官方數字（官方＝單行文字錯誤率多 <10%）；**API 參數要用 `gemini-3-pro-image-preview`**（-preview 是現行字串）；生圖延遲無官方數字→「一律 pre-meeting」改「預設 pre-meeting、S5 實測後可開會中 1K 快速選配」。
  - **Fable 親自抓**：contacts DDL 一行無效 SQL（斜線合併宣告）、懸空「決策 R#」引用、延遲預算沿用 v1 串流數字（MVP 分段轉寫 final 應為 ~2–5s，已誠實化）、quick/detailed 分工漏寫、ezpagesite 爬蟲 file:line 地圖未落檔（已補 research/EZPAGESITE_CRAWLER.md）。
  - **一致性審查（10 must-fix 全修）**：TASK_TEMPLATES T2 範本仍教已廢除的 INSERT_AFTER（會教壞弱模型違反 I1）；M0 缺 .env 欄位清單/測試框架（vitest）/npm scripts 約定（已補進 ARCHITECTURE_PLAN §1）；flash-lite/embedding model ID 補進 API_FINDINGS §E；MAINTENANCE 死連結；LESSONS/RUBRICS v1 語彙加 v2 對齊註記；M0 驗收與 spike gate 解耦（S1 需使用者協助不擋 M0 收尾）；S2/S3 標註需真人音訊；Playwright 端 SSRF 不適用 DNS-pin→page.route 攔截方案。
  - **CRM 審查（2 must-fix 全修＋擇要修 nice）**：DbPort 改 async-first（同步簽名會讓「換 pg 不動業務碼」破功；better-sqlite3 的 tx 陷阱已註明）；實作順序補漏掉的 §3 賣方側表；會議衍生值的 provenance 記法定案（human+meeting+verified=1）；persona 逐欄過 provenance 閘（不看 rollup）；(org_id,domain) 改 UNIQUE；crawl_jobs 補 mode；schema_migrations 給最小 DDL；M3/M4 補充實體備忘。
- **下一步**：計畫書已審定可交付。動工＝M0 地基（照 ARCHITECTURE_PLAN §6，工具鏈約定已定死）＋跟使用者約 S1 測試 Meet。
- **待決**：接收端限 Chrome/Edge 桌面的硬約束，動工前跟使用者口頭再確認一次可接受。

## 2026-07-07 session（同日續・使用者四項新指示＋交接 HTML）

- **使用者四項指示（Fable 決策、Opus 執行）**：(1) 生圖 API 改 OpenAI「image-2」；(2) 接收聲音硬約束要有測試 code 讓使用者測各裝置×開會軟體；(3) 移植 ezpagesite CLAUDE.md 的 code-tracker 規定；(4) CRM 欄位要能完整介紹一家公司的產品含細節與開發人。加開決策 15–18（00-DECISIONS 補充拍板節）。
- **執行（4 個 Opus agent 並行工作流＋1 個 HANDOFF agent）**：
  - **生圖**：查證「image-2」＝`gpt-image-2`（snapshot 2026-04-21）；**原生支援 16:9（`1536x864`）**、繁中 in-image 大幅進步（社群 ~99%，S5 自測）；**關鍵警訊＝延遲 ~80s 級（agentic 規劃）→「一律 pre-meeting」坐實**，會中選配唯一候選 `gpt-image-1-mini`；**前置＝OpenAI 組織驗證＋tier 配額**；輸出強制 C2PA＋SynthID。已回寫 API_FINDINGS §F（Gemini §C 降備選）、ARCHITECTURE_PLAN（§1/.env/S5/§8）、PRODUCT_SPEC、DECISIONS 15、LETTER。
  - **測試工具（已交付）**：`tools/capture-test.html`（792 行、單檔零外部資源、繁中、雙擊可開）——測試 A 分頁/視窗音訊擷取（zero-track 守衛＋音量表＋10 秒錄放回聽）、測試 B 麥克風、測試 C 環境自檢、結果摘要＋一鍵複製；`tools/README.md` 附裝置×開會軟體矩陣範本。JS 已 node --check 通過；**尚未在真瀏覽器實跑（使用者開起來若有問題回報即修）**。
  - **code-tracker**：實體＝ezpagesite 的 CHANGE_TRACKER（強制變更日誌：每改程式檔立刻一筆、`<!-- TRACKER_BELOW -->` 錨點插入、嚴禁 Write 覆寫、>500 行打包）。已移植為 `docs/CHANGE_TRACKER.md`（加「工作區」欄＋M0 後補 pre-commit hook 條款），接進 CLAUDE.md 硬規則 8＋路由表＋ARCHITECTURE_PLAN 橫切紀律。
  - **CRM 產品深檔**：CRM_SCHEMA 新增 `company_products`（規格/功能/定價/技術棧/整合/路線圖/已知問題…全欄位 DDL）＋`company_product_people`（產品↔人 role enum）＋`company_departments`（部門樹）；實體圖/embedding（company_product_card）/副駕白名單/§11 能不能/§12 順序全部同步。agent 三項自檢 PASS。
  - **交接 HTML（已交付）**：`docs/HANDOFF.html`（636 行、零外部資源、零 JS、繁中、列印友善）——12 節：30 秒版/會議模型圖/18 決策/技術架構/CRM/研究引擎/里程碑+spike/風險/現在就能做的三件事/文件索引。**桌面副本：`C:/Users/Martin/Desktop/MeetCopilot_v2_規劃交接.html`**。
- **給使用者的三個行動項**：(1) 各裝置開 `tools/capture-test.html` 實測並填矩陣；(2) OpenAI console 完成組織驗證＋查 tier 配額；(3) 備兩個 Google 帳號約 S1 測試 Meet。
- **狀態**：計畫書含四項新指示全部定稿；仍未動產品程式碼。
