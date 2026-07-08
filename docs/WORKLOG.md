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

## 2026-07-07 session（同日續・建立 ROM 決策總帳，決策 19）

- **使用者指示**：CHANGE_TRACKER 之外再加一個 **ROM**——記錄使用者或 Claude 下的**所有決策**；不是 memory 那種要精簡的，是「更大更雜」的帳本；每 500 行歸檔、歸檔以**序號**命名、要有**目錄**記每個歸檔的簡介供快速查詢。
- **落地**：`docs/ROM.md`（規則＋歸檔目錄表＋`<!-- ROM_BELOW -->` 錨點；寫入/歸檔機制同 CHANGE_TRACKER；與 00-DECISIONS 分工＝蒸餾 vs 全量、衝突時 00-DECISIONS 為準；查詢三段式）＋`docs/rom_archives/` 目錄；**回填 6 筆初始帳**（建立 ROM 自身／四項新指示 15–18 含 Fable 執行層取捨／Fable-Opus 分工／審查修正批／v2 pivot 全套／v1 時期摘要）。CLAUDE.md 硬規則 9＋路由表；00-DECISIONS 第 19 項；HANDOFF.html 決策表/目錄/文件索引同步為 19 項並刷新桌面副本。
- **驗證**：Opus fresh-context read-back 15 項全 ✓（含 CLAUDE.md 仍 65 行 ≤150、HANDOFF 無外部資源）。
- **狀態**：制度三件套齊（WORKLOG 進度／CHANGE_TRACKER 程式變更／ROM 決策）。仍未動產品程式碼。

## 2026-07-07 session（同日續・S1 結案→契約凍結→M0 落地→SaaS 成品化）

- **S1 spike PASS 結案**：使用者確認 capture-test 那輪即真實雙帳號 Meet（Brave/Win11 9 項全 PASS）——會議模型地基成立。
- **API 契約 v1.0 凍結**（Fable 親自，`docs/API_CONTRACT.md`）：Auth/CRM（確認=verify、細填=PATCH+human provenance）/研究 job/Decks+生圖 job/Meetings/WS 三角色（capture/hud/present，音訊 binary）/Train（ephemeral 直連 Live）。→ **v1.1**：M0 揪出缺口批准入約（health、me 子形狀、ContactSummary、音訊 frame 佈局＝raw PCM16 LE 16k mono 無標頭、research_status enum、ping→session_state）。
- **前端設計 prompt 包交付**（Opus，`docs/FRONTEND_DESIGN_PROMPTS.md` 539 行＋桌面副本）：PROMPT 0–6，fresh-context 逐欄位比對契約**零偏差**。
- **M0 全量落地**（工作流 5 Opus：A1 骨架+shared → A2 crm ∥ A3 server ∥ A4 web → A5 驗收）：**A5 fresh-context 6/6 PASS**——typecheck 四 workspace 全綠、crm vitest 7/7（含跨 org 攻擊斷言、tx 回滾）、真 server 冒煙（register/login/me、dup 409、跨 org 隔離）、JWT fail-fast exit 1、契約零漂移（PatchOp=append-only 保 I1）、/present 無副駕詞彙（I3）。已修 .gitignore WAL 側檔後 commit。
- **使用者定調（決策 20）：SaaS 成品，不是 demo**。四答：SQLite 維持／**GCP**／邀請制免計費／**前端成品全由我方 agent 做**（prompt 包降為設計規格）。Fable 裁決部署形態：**GCE 單 VM＋持久磁碟＋Docker Compose＋Caddy TLS＋snapshot**（Cloud Run 不能放 SQLite）；量大遷 Cloud SQL。
- **已知未消**（M1 要處理）：login 的 direct-SQL shim（升級 `MembershipRepository.findPrimaryOrgOf` 後移除）；better-sqlite3 在 Node 22 需 `npm rebuild`（要進 setup 文件或 postinstall）；server 尚無 build script（tsx dev / noEmit typecheck，之後上 project references）；並行 npm install 在 Windows 有檔案鎖競態（單獨重試可過——派工守則補一條「同機平行 agent 勿同時 npm install」）。
- **下一步**：M1（CRM 全 schema＋研究引擎＋**CRM 成品前端**）。使用者前置：GCP 專案＋帳單＋網域（M5 上線用，不擋 M1–M4）。
- **狀態**：M0 完成並 commit；三線並行的前置（M1）就緒可開工。

## 2026-07-07 session（同日續・M1 CRM 核心＋研究引擎＋CRM 成品前端）

- **接縫先凍結**（Fable，`docs/M1_CONTRACT.md`）：11 repository 方法簽名、研究引擎 4 介面、provenance 細填/確認程式落點。
- **工作流 6 Opus agent**（B0 seam → B1 repos ∥ B2 routes ∥ B3 research ∥ B4 前端 → B5 驗收）：
  - B0 凍全 domain 型別＋migration 002–006（29 表）；B1 全 11 repo＋22/22 vitest；B2 CRM 全路由＋移除 auth direct-SQL shim（改 findPrimaryOrgOf）；B3 研究引擎（SSRF 抽取＋Playwright 爬蟲＋Gemini 抽取＋grounding＋crawl_job）＝S4 spike；B4 CRM 成品前端（/crm＋/crm/[id] 八 tabs＋provenance 徽章/確認/細填＋登入，next build 11 路由綠）。
- **B5 fresh-context 驗收 6/7 PASS**：typecheck 四綠、crm 22/22（跨 org cosine 隔離/upsert 值+provenance 同 tx/human supersede/confirm/信任守則）、29 表遷移、真 server CRM 冒煙（細填→provenance supersede 用 raw SQL 驗）、SSRF 兩路擋內網+雲端 metadata、shim 已除、前端 build 綠。
- **1 項 PARTIAL → 已修**：crawler `browser.close()` 此機懸掛→job 卡 `running`（真 bug）。派 Opus 修：close deadline race＋SIGKILL、整體 crawl deadline、job 失敗落 `failed`（L13）。
- **S4 spike 判定**：SSRF 穩、爬蟲 render 可行、**Gemini 抽取待 key**（B5 環境無 GEMINI_API_KEY）。
- **接縫決策採納**：crm build 拆 typecheck/emit tsconfig；CHECK 欄才做 union；crawl_jobs 經 DbPort 自管；契約補 deals `?companyId=`；provenance wire camelCase。
- **踩雷入冊**：L12（Windows 平行 install 半解壓→清裝優先）、L13（外部進程 close 要 deadline+強殺）。
- **使用者行動項**：把 GEMINI_API_KEY 放 `apps/server/.env`，我再跑真爬蟲關掉 S4 抽取那半。GCP/網域/OpenAI 驗證仍是 M5 前置。
- **下一步**：M2/M3/M4 三線並行可開工（契約已凍、M1 核心就緒）。
- **狀態**：M1 完成（含 crawler 修）；待 commit。

## 2026-07-08 session（M2/M3/M4 三線並行＋S3 spike）

- **接縫先凍**（Fable，`docs/M234_CONTRACT.md`）：三線共用型別/migration 007-008/web client/service 介面。
- **工作流 11 Opus agent**（seam+S3 → 六路 build → 三線 verify）：
  - **S3 spike PASS**：Gemini Live 全鏈路實測（`ai.authTokens.create` v1alpha → token 直連 `gemini-3.1-flash-live-preview` → 30 音訊 chunk+繁中逐字稿）。gotcha 入 API_FINDINGS。
  - **M2 DynamicSlide PASS**（live）：生成 6 頁 0 空白、pptx 111KB 往返、gpt-image-2 背景圖、refused fallback、I1 攻擊測 409、I3 零-HUD、31 測試。
  - **M3 會中副駕 PASS**（9/9）：WS 三角色、訊號→hud info_card（CRM 白名單+跨 org 不洩）、presenter-only 攻擊拒、ACCEPT append（I1）、present 不收 HUD（I3）、SessionRuntime 清理、12 路由 build。
  - **M4 語音模擬 PASS**（機械面）：真 ephemeral token、persona 逐欄過 verified 閘、四維評分、socket 有界、跨 org 隔離。
- **carry-forward（交 /code-review 或首跑）**：persona-lock 未驗（最高）、JSON body 2MB 上限、theme.bg 非純色相容、npm audit 8 漏洞、dist 需重建、孤兒 ws.ts 刪。
- **待使用者驗**：語音真開口打斷體感、>15min resumption（同 S1 模式）。
- **下一步**：commit 三線 → **/code-review（使用者指定）** → 修 confirmed findings。
- **狀態**：M0/M1/M2/M3/M4 全部 build 完成且逐線驗收 PASS；三 spike（S1/S3/S4）過；待 commit＋code-review。

## 2026-07-08 session（同日續・/code-review 修正 + M5 整合/隱私/強化/部署）

- **/code-review**（多鏡頭對抗式，CodeRabbit 未裝故自建）：12 raw→5 refuted→**7 confirmed 全修**（F1 critical 跨租戶掐會議＋回歸測試；F2 live 重連卡死；F3 /present 假重連；F4 SSRF DNS-rebinding；F5 train hang；F6 計時；F7 圖片 413）。**F4 二次校準**：fail-closed 弄壞 www→apex 重導經真站抓到→改回只 pin 目標（L16）。commit a21a903。
- **M5**（工作流 7 agent）：**8/9 整合驗收 PASS**——(A) 隱私：同意閘/PII 遮蔽（實測 `*** 或電話 ***`）/逐字稿預設即棄/TTL/CSP；(B) 成本：usage_events 冪等＋/api/usage；(C) 強化：限流 429/結構化 log（0 洩漏）/ready/安全標頭/優雅關機/刪死碼；(D) 邀請制成員＋/settings/team＋last-owner guard；(E) 部署產物：Docker/compose/Caddy/DEPLOY.md。typecheck＋72 測試＋13 路由 build 綠。
- **1 PARTIAL → 補**：訊號→CRM 批准回寫端點（PRODUCT_SPEC flywheel），M5 closeout 補上。
- **carry-forward**：成本記帳串流小項未涵蓋；persona-lock/真語音待使用者真跑；npm audit 已 triage。
- **使用者唯一未完＝上線**：GCP 專案/帳單/網域/DNS、OpenAI 組織驗證、換 JWT_SECRET，照 DEPLOY.md。
- **狀態**：**MeetCopilot v2 = M0–M5 完整成品**（CRM＋研究引擎＋3 產品＋6 前端＋隱私/成本/強化/邀請/部署產物），經對抗審查修正。只差使用者上線＋真語音驗。

## 2026-07-08 session（上線後強化・爬蟲 + 全網深度研究 + web 補建）

- **爬蟲**：navTimeout 20s→env 化、2-level BFS 平行池、雙語連結評分、**5 分鐘硬上限**（CRAWL_HARD_CAP_MS）；SSRF 只 pin 目標 IP（L16）。部署 server rev 00005。深度爬取 6→33 產品。
- **全網深度研究 deep 模式**（commit `0d06cee`）：DeepResearcher（6–9 雙語 grounding 查詢＋深讀 top6 外部來源，跳過公司網域）＋DeepExtractor（逐事實 [S#]→provenance 真實外部 URL）。orchestrator deep＝研究∥網站爬蟲。migration 010（crawl_jobs.mode 加 deep，boot 自動套）。碩天實測 FT/Wikipedia/cnyes/digitimes 撈到 11 概況+5 新聞+6 主管+10 競爭對手。server rev **00006-gx4**、/api/health＋/api/ready 皆 200。ROM 已記。
- **web 補建**：deep commit 含 EnrichPanel 第三選項「深度（全網研究）」，但先前**只重建 server 漏了 web**（`NEXT_PUBLIC_*` 是 build 期常數，重啟無效）→ cloudbuild-web 重建（build `999cbbd1`）→ deploy web rev **00003-48v**。**教訓：動到 apps/web 要 server＋web 各自重建。**
- **待使用者**：Google 登入需在 Console 把兩個 meetcopilot-web 網址加進共用 OAuth client 的「已授權 JavaScript 來源」。
