# 工作日誌（跨 session 狀態）

> 新 session 開工第一步＝讀本檔**最尾端**的最後一個 `##` 區塊（新紀錄一律追加在檔尾）。格式見 `MAINTENANCE.md`。
> 歷史紀錄見 docs/archive/WORKLOG-2026-07-06_08.md

## 2026-07-08 session（上線後強化・爬蟲 + 全網深度研究 + web 補建）

- **爬蟲**：navTimeout 20s→env 化、2-level BFS 平行池、雙語連結評分、**5 分鐘硬上限**（CRAWL_HARD_CAP_MS）；SSRF 只 pin 目標 IP（L16）。部署 server rev 00005。深度爬取 6→33 產品。
- **全網深度研究 deep 模式**（commit `0d06cee`）：DeepResearcher（6–9 雙語 grounding 查詢＋深讀 top6 外部來源，跳過公司網域）＋DeepExtractor（逐事實 [S#]→provenance 真實外部 URL）。orchestrator deep＝研究∥網站爬蟲。migration 010（crawl_jobs.mode 加 deep，boot 自動套）。碩天實測 FT/Wikipedia/cnyes/digitimes 撈到 11 概況+5 新聞+6 主管+10 競爭對手。server rev **00006-gx4**、/api/health＋/api/ready 皆 200。ROM 已記。
- **web 補建**：deep commit 含 EnrichPanel 第三選項「深度（全網研究）」，但先前**只重建 server 漏了 web**（`NEXT_PUBLIC_*` 是 build 期常數，重啟無效）→ cloudbuild-web 重建（build `999cbbd1`）→ deploy web rev **00003-48v**。**教訓：動到 apps/web 要 server＋web 各自重建。**
- **待使用者**：Google 登入需在 Console 把兩個 meetcopilot-web 網址加進共用 OAuth client 的「已授權 JavaScript 來源」。

## 2026-07-08 session（CRM 原文+zh-TW 簡介 + 技術棧/部門補孤兒表）

- **緣起**：使用者截圖 CyberPower 頁反映三點——顯示該「原文+i18n 簡介」、爬出來全英文沒翻、技術棧/部門分頁空白。
- **調查（workflow 4 路 opus）**：確認 (a) 對方情報四表無任何 zh/locale 欄、兩擷取器 prompt 明令 do-not-translate；(b) company_tech/company_departments 自 003 就有表+repo+GET+UI 分頁，但**無任何擷取器產出、orchestrator 從沒呼叫 bulkUpsert**＝孤兒表永遠空。
- **實作（workflow：Contract 鎖→Build 擷取∥前端→Verify）**：commit `6e6bf00`。
  - migration 011 雙份：company_news/products/companies/contacts 加 `*_zh` 平行欄。
  - 擷取器 extractor+deep-extractor：schema 加 descriptionZh/techStack/departments/*Zh；SYSTEM 改雙語（原文逐字＋≤2 句 zh-TW 簡介，tech/dept 直接 zh-TW、專有名保留）；MAX_TECH=12/DEPT=10 防 JSON 爆量。
  - orchestrator：runStandard/runDeep 落庫後呼叫 bulkUpsertTech/bulkUpsertDepartments（接上孤兒表）。
  - 前端：NewsTab/ProductsTab/OverviewTab 原文+🌐中文簡介並排（useLocale gating），globals.css 加 .mc-i18n-sum。
  - 驗證：typecheck 4ws 綠、server 36/36、CRM 43/43（idempotency 測試改連續 1..N 不硬編碼）。I1/I2/I3 未觸及。
- **部署**：server rev **00007-r7z**（migration 011 boot 自動套，/api/ready 200）＋ web rev **00004-rhw**（.mc-i18n-sum 已在線上 CSS）。
- **限制/待使用者**：只影響新研究結果，不回填既有資料——使用者需在公司頁**重跑「研究此公司（深度）」**才會看到中文簡介＋技術棧＋部門。Google 登入仍待 Console 授權來源。

## 2026-07-08 session（研究：無 URL→公司名稱研究 + job 逾時）

- **緣起**：使用者對無官網公司（CyP）留空 URL 研究，跑很久沒結果；指出「URL 說可選，好歹要用公司名稱做深度研究才對」。
- **根因**：orchestrator createJob 對所有模式（含 deep）在無 url 時 throw「no URL to crawl」；但 DeepResearcher 本就以 company.name 為 grounding 種子、不需 url。且整個 job 無逾時＝卡住永遠「研究中」。
- **修（commit `a8fee24`＋`5fc02ac`）**：
  - company 無可爬 url → 一律以公司名稱走全網 grounding 深度研究（runDeep 跳過官網 crawl）；有 url 才爬官網。
  - 整體 job 逾時 withTimeout + RESEARCH_JOB_TIMEOUT_MS（讀回驗證後預設 360s→**600s**，寬鬆於 deep 最壞 ≈450s）→ 逾時 markFailed 記「研究逾時」。
  - 前端 EnrichPanel 提示「留空則以公司名稱做全網深度研究（不需官網）」。
- **驗證**：typecheck 4ws 綠、server 36/36、CRM 43/43；獨立 opus agent 讀回確認兩目標達成、無 must-fix bug（僅提醒逾時預設偏緊→已改 600s；逾時後殘工不 abort＝可接受）。
- **部署**：server rev **00008-qdf**（+RESEARCH_JOB_TIMEOUT_MS=600000，--update-env-vars 未動其他 env）＋ web rev **00005-gfq**；health/ready 200。
- **待使用者**：重整頁面丟掉舊卡死 job，重跑研究（可不填 URL）。Google 登入仍待 Console 授權來源。

## 2026-07-08 session（extract-url 匯入加固：UA/charset/429/DNS）

- **緣起**：DeckWizard「從網址匯入」(POST /api/extract-url) 抓 agriharvest.tw 回「url import failed: 來源回應 429」。（註：問題先在 v1 參考件被誤修一輪，才發現 live 是 v2；v1 已不管，本次修的是 v2。教訓已寫進記憶。）
- **根因**：extractFromUrl 送 bot UA `MeetCopilot/0.1 (research-import)`→WordPress/Cloudflare 類站台回 429；body 硬解 utf-8（忽略 Content-Type charset／`<meta charset>`）→Big5/GBK 亂碼；無 429 重試、DNS lookup 未被 10s abort 涵蓋、entity 只解十進位且越界會 crash。
- **修（commit `5538ddd`，只動 `apps/server/src/import/extract.ts`）**：BROWSER_HEADERS 真瀏覽器 UA＋Accept-Language；resolveCharset/decodeBody（header→meta→utf-8 TextDecoder）；十六進位 entity＋codePoint 防崩；429/503 一次 Retry-After-aware 重試（可 abort、重試重走 safeFetch 再驗 SSRF）；lookupAll DNS 逾時 race；extractFromPdf `{max:50}`。**v2 更強的 SSRF/DNS-pin 完整保留**（只在 lookup 內加逾時）；research/crawler.ts Playwright 路徑不動。
- **驗證**：v2 server typecheck 綠；tsx 實測 zol.com.cn（gbk）→標題正確「中关村在线…」0 U+FFFD、example.com utf-8 無回歸；獨立 opus fresh-context read-back PASS、ssrfIntact。CHANGE_TRACKER 已補。
- **部署**：只重建 server（cloudbuild-server.yaml，build SUCCESS 2m42s）→ `run services update --image`（保留 env）→ rev **00009-qcb**、health/ready 200。web 未動。
- **P2/P3（同 session 續做，已完成，commit＋部署待核准）**：gemini per-call 逾時＋finishReason≠STOP 可行動錯誤＋withRetry 退避/Retry-After/retryable 短路；decks 錯誤映射（429/quota→429、SAFETY→422、MAX_TOKENS→422、其餘 502 不外洩 raw）；pptx 串流位元組上限（取代可繞過的宣告大小檢查）＋parse 移進可 terminate 的 worker_thread（Node 22.18 strip-types 頂掉 worker 內 tsx → dynamic import 帶副檔名，dev/prod 實測 terminate 生效）；ASR 真失敗廣播 `asr_unavailable` 一次（去重/成功即清/空白不報）；webp 匯出 sink 排除（畫面仍可 webp）。凍結契約平行派工。驗證：全 workspace typecheck 綠、server 36/36＋CRM 43/43 pass、逐 cluster fresh-context read-back PASS。詳見 CHANGE_TRACKER／ROM 2026-07-08 22:40。**只動 apps/server → 部署只重建 server。**

## 2026-07-09 session（v1/v2 徹底合一＋admin 後台立項＋UI/UX 自測輪）

- **使用者四痛點**：爬蟲效果不佳／token 花費不明／UI/UX 醜且多處不可用／v1、v2 並存混淆。**六任務**：admin 後台（參考 ezpage）、v1 移除合一、GCP 部署流程確認、ezpage skills+SOP 搬運、Fable 決策 Opus 執行、UI/UX 先快修再寫設計需求 md。決策細節見 ROM 2026-07-09 11:45。
- **合一完成**：
  1. 本機：v1 內容→`Desktop/MeetCopilot_v1_archive`（待使用者確認後刪）；v2 全量遷入 `c:/Users/Martin/Desktop/MeetCopilot`（原 `_v2` 目錄消滅）。因 VS Code 鎖根目錄採「內容置換法」；殘留本機 server（PID 11332）經使用者同意終止。git HEAD 1e4bf76、樹乾淨。
  2. GitHub：v1 repo 改名 `MeetCopilot-v1-archive` 封存；新建 private `MarinChen99097/MeetCopilot`（=v2 全歷史）並 push（Opus 秘密掃描 PASS 後才推）。**本 repo 從此有 origin**。
  3. v1 未 commit 誤修殘留：備份至 session scratchpad `v1-uncommitted-backup/` 後放棄。
- **進行中**：4 路 Opus 偵察（ezpage admin console／ezpage skills+SOP／v2 admin 資料地基／部署流程比對），報告落 `C:\tmp\meetcopilot-recon\`。
- **下一步**：UI/UX 全面自測→壞點快修；`apps/admin` 獨立後台（token 花費／帳號／job 監控／健康，第三個 Cloud Run service）；skills/SOP 搬運；DEPLOY.md 補第三 service；UI/UX 需求 md 交 claude design。
- **坑/待決**：**爬蟲品質已立案**（效果不如預期；拍板＝先記錄，等 admin job 監控有數據再專輪處理）。桌面尚有舊名檔 `MeetCopilot_v2_規劃交接.html`／`MeetCopilot_v2_前端設計Prompt.md`（內容有效，暫留）。本檔已超 150 行，收尾時照 MAINTENANCE 三節歸檔舊 session。
- **本輪完成（同日續，全部未 commit 待使用者核准）**：
  1. **UI/UX 三路實機審測**（P0×2/P1×12/P2×31，報告 `C:\tmp\meetcopilot-audit\`）→ **四路快修全落地**：邀請死路修復（/invite 路由＋acceptUrl＋e2e 實測通）、研究三模式＋完成卡持久＋human 名稱防爬蟲覆蓋（name-guard 測試 5/5）、wizard（objective 下拉/生成進度/生圖成本預警/匯入錯誤人話化）、會議 P0 根因＝client 對 wsUrl 重複補 `/ws` 成 `/ws/ws` 被 400 拒（`lib/ws.ts` toWsEndpoint 修復＋三視圖連線狀態機＋train 計費預警）。
  2. **admin 後台全套**（規格 `docs/ADMIN_CONTRACT.md` v1.2）：apps/admin 六頁（33 檔）＋server `/api/admin` 10 端點＋migration 012（雙套）＋停權機制＋CORS allowlist＋記帳補洞（ASR/gemini_live/會中分析/userId 歸屬/pricing env 覆寫）＋Dockerfile.admin/cloudbuild-admin/DEPLOY 增補。
  3. **整合收線**：npm install 修復搬遷斷鏈 symlink、五個跨界接線、docker-compose/Caddyfile/.env.production.example 加棄用標記。
  4. **驗收**：typecheck 5 workspace 全綠；server **68/68**、CRM **46/46**；fresh-context 對抗式 read-back **12/12 CONFIRMED-OK（零 P0/P1）**——I1/I2/I3/A1/A2/A3/SSRF/CORS/冪等/open-redirect/userId 落帳全過。
  5. **交付物**：`docs/UIUX_DESIGN_BRIEF.md`＋桌面副本 `MeetCopilot_UIUX設計需求.md`（給 claude design）。
- **已接受的 P2 取捨**：WS 停權閘 fail-closed（DB 短暫錯誤會斷線、重連即恢復）；ASR 冪等 key 在 session 完全 dispose 後同 meeting 復用時 seq 歸零→撞舊 key 少計不重計（邊角，可日後補 runtime epoch）。
- **待使用者**：核准 commit（見終報提案）；核准後部署（server＋web 重建、admin 首次部署需 PLATFORM_ADMIN_EMAILS/ADMIN_ORIGIN env＋OAuth origin）；決定刪除 `Desktop/MeetCopilot_v1_archive`；dev 環境留跑中（server :8788）。
- **/code-review（使用者指定學 ezpage）**：CodeRabbit CLI 未裝→改用本 repo 自建的 ezpage 風格五鏡頭＋逐字 0–100 評分流程（已把 ezpage 的評分 rubric 回灌進 `.claude/commands/code-review.md`）。實跑審這批未 commit 變更：12 raw→10 去重→**5 confirmed（2 Critical＋2 Warning＋1 Info）全修**：
  1. **Critical**：admin 前端送 `YYYY-MM-DD`、後端要 epoch-ms→/usage /jobs /明細抽屜首載全 400（核心報表打不開）。修＝api.ts 集中 dayParamToEpochMs（to 涵蓋整日）＋UsageSummary 型別改 number＋fmtDate。
  2. **Warning**：WS 監聽器全掛在 isAccountActive().then() 內→帳號檢查期間 socket 斷線洩漏 session／emit error 會 crash process。修＝error/close 同步掛在 await 前＋hub.attach 加 readyState guard。
  3. **Warning（A1 繞過）**：register 僅憑 email 字串比對就蓋 platformAdmin→搶註冊 allowlist email 竊 admin。修＝register 不衍生 platformAdmin（只 login/google）；連帶修「測試直接拿 register token 當 admin」。
  4. **Info**：KIND_LABELS 用不存在的 image、漏 openai_image/gemini_extract。修＝六 kind 對齊。
  - **復審＋實測 7/7 PASS**（日期端點 200／舊字串仍 400 證契約不變、register token 打 admin 403／login token 200）；typecheck 5/5、server **72/72**、CRM **46/46**。教訓入 **L17**（對抗驗收要測帶參數端點）＋**L18**（allowlist 旗標不在未驗證路徑蓋）。
- **關鍵領悟**：自建對抗式驗收（12/12）≠ 免跑 code-review——兩者鏡頭不同，code-review 的「帶參數端點」視角補抓到驗收漏掉的 P0。
- **/simplify（使用者指定）**：4 路清理審查（reuse/simplification/efficiency/altitude）→去重→3 路 apply（admin 前端／server／web，改動不重疊）。套用約 20 項**行為不變**清理：admin 圖表 projectPolyline 抽共用＋useConfirmAction hook＋errMessage helper＋Pager 抽取＋刪死 prop/CSS；server metered toMeterResult＋pricing priceFor＋admin-queries 復用 core.usage.rollup/invites.list/members.list/users.findById＋active-account 兩查詢併一（熱路徑）；web ConfirmDialog 共用（SlideEditor＋PersonaPicker）。
  - **/simplify altitude 鏡頭揪出安全殘留（升級為安全修正）**：先前 code-review 的 register A1 修法**不完整**——register 不發 admin 旗標，但攻擊者仍可「自助 register allowlist email 設自己密碼→login」拿 admin。補完＝**register 拒絕 allowlist email（403 reserved）**；login/google 衍生不變（google 經 provision 不受影響、既有帳號走 409）。教訓 L18 已涵蓋此類，加註「排除要排在所有發證路徑、或從源頭擋帳號建立」。
  - **跳過（記 backlog，不在此輪動）**：ws.ts toWsEndpoint 的 altitude bandaid（正解要改 server wsUrl 生成契約＋useRealtime 簽名，動到剛驗過的會議 P0，回歸風險高）；admin 冷路徑記憶體分桶（可接受）。
  - **回歸**：乾淨環境重建（npm install 修 symlink）→typecheck 5/5、server **73/73**、CRM **46/46**；admin 六頁實測 render/圖表/ConfirmDialog 全正常、安全 403/201/admin 驗證 PASS、web 重路由 500 於乾淨 install 後恢復 200。dev 留跑（server :8788、web :3000、admin :3100）。
- **本輪最終狀態**：合一＋admin 後台＋UI/UX 快修＋記帳補洞＋code-review 5 修＋simplify 清理＋admin A1 安全補完，全部經對抗審查＋復審＋乾淨環境實測。**未 commit（待使用者核准三個邏輯 commit）**。

## 2026-07-13 session（爬蟲專輪立項：社群媒體＋筆記區＋深廣優先＋會中 CRM 消費）

- **使用者四指示**（ROM 2026-07-13 10:33）：(1) 爬蟲擴 FB/IG/Threads/YT；(2) CRM「筆記區」——歸類不進結構化欄位的情報由 AI 平鋪直敘描述公司型態與狀況；(3) 深與廣優先、時間不是問題、不需要「快速爬蟲」；(4) 會中依交談內容（雙方可能各多位）顯示 CRM 補充資訊。重申 Fable 指揮／Opus 執行。
- **4 路 Opus 偵察完成**（報告 `C:\tmp\meetcopilot-social-recon\{engine,crm,meeting}.md`＋`docs/research/SOCIAL_CRAWL_FINDINGS.md`）：
  1. **引擎**：社群來源自然插入點＝per-platform fetcher 產 `SourceText` 注入 DeepResearchBundle（deep-research.ts:49-56，[S#] provenance 自動繼承）；schema 外情報現被靜默丟棄（responseSchema 無自由欄＋mappers.ts:37-47 丟未知鍵）；時間/數量上限 20+ 項（CRAWL_HARD_CAP_MS=300s、DEEP_RESEARCH_BUDGET_MS=150s、RESEARCH_JOB_TIMEOUT_MS=600s…）；爬蟲**零 stealth**。
  2. **CRM**：多型 `notes` 表（005:148）＋NotesTab 前端已上線，narrative 筆記可沿用不開新表；🔴 **嵌入管線生產未實作**（無任何 embeddings.upsert，只在測試）→ 索引永遠空。
  3. **會中**：檢索入口存在（realtime/retrieval.ts:62-107）但索引空→CRM 補充卡端到端不會出現；說話者只壓 presenter/client、多人未實作；九類商機訊號、無「新話題/人名」偵測；白名單只吃 company/contacts/deal。
  4. **社群查證**：YT＝官方 Data API v3 免費充裕＋Gemini 原生懂 YT URL；FB/IG＝官方 API 門檻高（PPCA app review）、自建爬最難，務實路＝第三方（Apify $0.5–2/1K posts）＋Gemini grounding（**2025-07-10 起 Google 開始索引 FB/IG 公開專業帳號**）；Threads＝公開頁無登入可爬（script JSON）、封鎖較寬鬆；**一律不做登入態爬取**（ToS/封號，Meta v. Bright Data 判例只禁登入態）。
- **使用者拍板**（ROM 10:48）：Meta＝grounding-only（不接 Apify）；深研究天花板＝30–60 分鐘級。
- **契約凍結**：`docs/RESEARCH_UPGRADE_CONTRACT.md` v1.0（四工作包介面/表/env/檔案所有權）。
- **實作完成（R/M/W 三路 Opus＋整合修正輪，全部未 commit）**：
  1. **R**：social/（YouTube Data API v3＋Threads 無登入＋FB/IG grounding 模板＋帳號發現→companies.social_links）；extractor 加 narrativeZh+uncategorized→每公司兩單例筆記；預算重設（job 3600s/爬蟲 1800s/150 頁/深度 3 env 化/多輪 DEEP_RESEARCH_ROUNDS=3 提早停＋markProgress）；indexer.ts 補實嵌入管線＋`POST /api/research/companies/:id/reindex`；migration 013（social_links＋notes CHECK）＋014（signals CHECK 11 類）雙套。
  2. **M**：檢索白名單擴 notes/products/news、CRM 卡同場同實體去重、trust 依 provenance、signals 加 person_mention/topic_shift（只觸發檢索）、speakerLabel 多人標註（wire enum 不變、帶 contacts 名冊推斷）。
  3. **W**：EnrichPanel 單一深度入口（保留可選 URL 種子）＋NotesTab 置頂 AI 敘事＋HUD 顯示 speakerLabel；避開換皮 session 檔案集。
  4. **整合修正**：NoteType 聯集補值、standard 擷取 MAX_TOKENS 減半重試、MAX_CRAWL_DEPTH env 化、註解修正。
- **驗證**：fresh-context 對抗驗證 **10/10 ✓**（含 embeddings 詞彙 R/M 逐字對上、reindex/白名單攻擊者憑證 403、I1/I2/I3 未觸及、**live 冒煙**：真 Gemini 爬 ghost.org 125s job done、兩單例筆記＋7 列 embeddings 全對）。最終：typecheck 5 workspace 全綠、server **97/97**、crm **49/49**。gap 裁決全記 ROM（10:33/10:48/11:13/11:36/11:52 五則）；00-DECISIONS 補決策 21–24；API_FINDINGS 補 §G。
- **待使用者**：核准 commit（訊息見終報；messages/CHANGE_TRACKER/ROM 與換皮 session 交疊，見終報注意事項）；開免費 `YOUTUBE_API_KEY`（缺則 YT 優雅跳過）；部署時——server＋web 都要重建、Cloud Run server 需 CPU always-allocated、pg migration 013/014 先冒煙。
- **坑/待決**：Threads 為 best-effort（撞牆 skip）；FB/IG 深度受限 Google 索引，日後不足可升級 Apify（已查證定價，見 SOCIAL_CRAWL_FINDINGS）。
- **/code-review＋/simplify（使用者指示補跑，同日續）**：
  1. **/code-review**（五鏡頭 workflow＋逐 finding 對抗評分 ≥80）：12 agents → **1 confirmed（82/80 雙鏡頭）**＝`resolveTrust` 用 embedding entity_type 查 provenance 永遠 0 列→**verified 徽章死碼**；另 2 個門檻下真 bug 指揮官升級修（indexer 不清殘留 chunk→陳舊情報出卡 74/72；deep-rounds 預算實為每輪非整場 60）；接受不修：Threads AbortSignal（45s 硬上限兜底）。三修帶測試→server **100/100**。再次印證「自建對抗驗收 ≠ 免跑 code-review」（驗收測命中、沒測徽章亮）。裁決 ROM 12:15。
  2. **/simplify**（四鏡頭→裁決 ROM 12:32→單 agent apply）：**8 項套用**——會中熱路徑白名單 per-session 快取（原每窗 4 次序列 DB 讀）＋resolveTrust 平行化＋擷取器共用模組 extract-shared.ts＋`pinnedAgent` DNS-pin 防線收斂單一來源＋社群網域清單單一來源＋冗餘 filter/死參數/magic number；1 skipped 有理（contacts.list 缺欄位，N+1 必要）；跳過 URLSearchParams（編碼等價性）；**backlog**：embedding entity_type 詞彙單一真相來源（altitude 指出 resolveTrust 修法位置偏低，但動剛驗過的 trust 面回歸風險高）＋孤兒 embeddings GC。
  3. **最終回歸**：typecheck 5 workspace 全綠、server **100/100**、crm **49/49**（斷言未放寬）。全部未 commit 待核准。
- **本地 E2E 實測（使用者指示，Connact AI）**：deep 98s done、50 欄、narrative＋observations 正確、embeddings 11 列、YT 無 key 優雅 skip（ROM 13:09）。暴露兩缺口→**已修**（server **111/111**）：(1) 社群發現擴為掃全部已爬頁＋deep 擷取器 socialLinks 回填（機械保險只收 https＋四平台；官網爬到的贏）；(2) uncategorized 來源納入 resolveMerged 轉址還原。重跑驗證：**轉址 0 殘留**（54 筆 provenance 全真實 URL）；social_links 對此站**合法留空**（9 頁 DOM 與 grounding 皆無官方社群錨點，narrative 亦言其不經營 FB/IG——機制正確、該公司真沒有）。登入問題根因＝使用者開到 :3000 殭屍，:3001 實測正常。
- **測試帳號**：crawl-test-0713@example.com / CrawlTest0713!（:8788 DB，org=Crawl Test Org）。

## 2026-07-13 session（UI 換皮：可收折側欄 Shell＋首頁儀表板，參考 ezpage）

- **使用者三指示**：首頁醜重設計（左側可收折漢堡導覽欄＋右側內容區）、整體 UI 用 frontend-design skill 重設計、先本地看過才部署；重申 Fable 指揮／Opus 執行（含實作）；補充指定參考 `Desktop/ezpagesite`。
- **偵察（Opus）**：ezpage 好看來源＝claude.ai/design handoff 的 V2 頁（純 CSS＋data-scope token 分層）；可移植：token 分層＋r-sm/md/lg 刻度、雙欄工作台 grid、墨底 hover 上浮鈕、聚焦光環、選中態低透明主色底＋內光、mono kicker、reduced-motion 護欄動效。
- **Fable 設計契約**（ROM 11:20；契約檔=session scratchpad design-contract.md）：深色「會議控制室」——保留品牌紫、**廢紫→粉漸層**（accent-2 粉→靛 #6d7cff）、極少量萊姆 `--mc-hi` 當 live 訊號簽名色；Geist/Geist Mono via next/font；radius 收斂 3 檔；AppShell 頂欄→**248↔64px 可收折側欄**（localStorage 持久、<880px off-canvas）＋生命週期分組（會前/會中/對練/管理）＋語言切換器；present/copilot/hud 一律另開分頁；首頁→AppShell 內儀表板（簽名元素＝PRE→LIVE→DRILL 三階段 rail＋萊姆光點巡航）＋metaTitle＋icon.svg favicon。首頁因此入 AuthGuard（未登入導 /login，消舊首頁公開曝露 I3 面）。
- **實作（Opus，7 檔白名單）**：globals.css token 重整＋側欄/首頁 CSS＋清掃（粉→靛 5 處、圓角 34 處收斂、mc-field token 化 9 處、死 token 補定義、.mc-nav 刪）；AppShell 全改（export API 不變）；page.tsx＋新 HomeDashboard；messages nav/home 增補（parity 180/180）；layout 只加字體（I3 註解保留）。studio-present.css 消費的 12 token 全存在、未消費 accent-2→**簡報渲染零破面**。
- **對抗式驗證（Workflow：4 鏡頭 find→每 finding 2 反駁者）**：raw 6→**confirmed 3 全修**（rail 記憶閃跳→useState lazy init；手機抽屜 visibility 退出 Tab 序；resize 往返殘留→matchMedia；.mc-shell 納 reduced-motion）／killed 3（SlideEditor 粉漸層＝範圍外記 backlog、圓角膠囊化數學證偽、語言切換掉 query 無場景）。I3 攻擊鏡頭零破口。
- **實機走查（Opus×chrome-devtools）＋Fable 審圖**：方向通過；5 項收尾擴充（ROM 13:10）全落地——AuthForm 輸入框套 .mc-input＋id/name（P0 白底原生框）、**登入落點 /crm→/**（email/Google 皆改；invite 流不動）、EN copilot.title→「Copilot Capture」救截斷、/train 補 main landmark、.mc-empty__icon 升 56px 圓形底座＋inbox SVG（全站空狀態受益）。最終檢查表全 PASS：收折記憶零閃跳、抽屜 a11y、EN 零截斷、console 0 error/0 hydration、title/favicon 齊。
- **本地環境（本 session 整理）**：:8787 被無關 bun「fakechat」佔用；:3000 web dev=07-09 殭屍（Jest worker 崩全站 500，分類器擋 kill 未動）→**預覽環境＝web :3001（NEXT_PUBLIC_API_BASE=8788）＋API :8788（PORT+WEB_ORIGIN=http://localhost:3001 覆寫）**，CSP/CORS 皆驗通（preflight ACAO=3001）；測試帳號 ui-review-0713@example.com 已建（curl register 201）。截圖在 session scratchpad `shots/`。另：本機無 Chrome stable，走查 agent 建了可還原 junction `%LOCALAPPDATA%\Google\Chrome\Application`→Playwright Chromium（移除＝Remove-Item 該路徑）。
- **驗證數字**：apps/web `tsc --noEmit` 綠（server 側紅=爬蟲 session in-flight，非本批）；en/zh parity 180/180；CHANGE_TRACKER 3 筆、ROM 2 則（11:20/13:10）。**未 commit（硬規則 10，等使用者核准）**。
- **待使用者**：(1) 本地過目 http://localhost:3001/zh-TW；(2) 核准 commit（與爬蟲 session 的變更在 messages/CHANGE_TRACKER/ROM 交疊，commit 切分見兩session終報）；(3) 核准後部署（動 apps/web→web image 要重建）；(4) 裁決 :3000 殭屍與 fakechat 佔 8787 怎麼清。
- **backlog（本輪不動）**：SlideEditor JS 內硬編碼紫→粉漸層字串（fallback 路徑美學殘留）；空狀態插圖系統；首頁儀表板資料化（今天的會議/最近 deck，需接 API）；Google 登入不吃 invite next（已記取捨）。
- **cockpit 輪（同日續，使用者看新首頁後指示）**：「擷取端與 HUD 應同一視窗——一邊聽一邊看建議」（ROM 14:05/14:25）。
  1. **偵察揪出既有 I2 裂縫**：ws-server `isPresenter` 要求 `role==="present"`，但 suggestion 只推 hud role→**獨立 /hud 的批准本會被 forbidden_not_presenter 拒**（CI 沒抓＝authz 測試直打 service 層未經 ws-server；protocol.ts 與 API_CONTRACT 註解自相矛盾）。
  2. **修正＝isPresenter 改純身分**（`userId===presenterUserId`，役割僅推播目標）＋新 `ws-presenter-authz.test.ts` 6 tests（經真 ws-server：presenter+hud 過、非 presenter 任何 role 拒、跨 meeting 4001）；API_CONTRACT.md:96 更正。**對抗式驗證 I2 攻擊鏡頭：零可利用破口**（wsToken 單一鑄造路徑=建會者、綁 meetingId、無洩漏端點）。server 測試全綠（實作時 106/106；protocol.ts 註解矛盾留給爬蟲線對齊）。
  3. **前端 cockpit**：/copilot＝`CockpitView`（左 340px 擷取控制＋右建議流；CopilotInner/HudInner 改 export 可嵌，creds 由 cockpit 持有、建會後 HUD 免重整即連；<1100px 直向堆疊）；/hud 獨立頁不動（第二裝置鏡像，決策 14 降選配）；文案 copilot.title→「會中副駕」/「Meeting Copilot」、hudDesc→「第二裝置鏡像（選配）」、liveNote 同步（parity 184/184）。
  4. **驗證＋審圖收尾**：對抗驗證 confirmed 2（嵌入 HUD 被全域 .mc-hud 雙欄 grid 滲透：佔位卡擠左半＋連線態右下空洞）→Fable 看圖拍板**嵌入式 HUD 改單欄直向流**（`.mc-cockpit__hud > .mc-hud` 補 display:flex 一條治兩態；standalone /hud 雙欄不動）＋會議標題 input id/name＋embedded 時 h1 降 h2。實機走查（真 API 建會 201）全 PASS：另開分頁、建會後 hud 即連（單 WS=hud 屬正常，capture 等開始聆聽）、手機堆疊、console 乾淨。
  5. **過程事故**：chrome-devtools MCP 中途與瀏覽器斷線不可復（孤兒 Chromium pid 54108 樹殘留，無害待使用者清）→走查改 repo 內建 Playwright headless 完成。真 DB 多了測試會議數場（UI Review Org 名下），待清。
