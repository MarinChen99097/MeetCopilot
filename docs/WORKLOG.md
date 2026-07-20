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
- **commit＋部署（2026-07-17 使用者核准）**：部署前把關 agent 4/4 PASS（typecheck 5ws 綠、server 111/111、crm 49/49、秘密掃描零命中、PG migration 013/014 語法/冪等審過、無新 boot 必填 env、Geist build 可行）→ 三邏輯 commit：`29ba343` feat(research)（50 檔）＋`166ef20` feat(web)（10 檔）＋`9416775` feat(meeting)（14 檔），push origin main。部署照 SOP A：兩 build 皆 SUCCESS → server rev **00011-m62**（`services update --image`＋**`--no-cpu-throttling` 已套**，env 保留，migration boot 自動套）＋ web rev **00008-sx9**。冒煙：health 200／ready 200／web 307／zh-TW 200＋title「工作台 · MeetCopilot」。DEPLOY.md 版本節已更新。
- **部署後仍待使用者**：Google OAuth Console 授權來源（舊項未完）；YOUTUBE_API_KEY（可選，缺則 YT skip）；admin 第三 service 尚未部署（需 PLATFORM_ADMIN_EMAILS／ADMIN_ORIGIN 拍板）；本機清理（:3000 殭屍 pid 56956／孤兒 Chromium pid 54108／DB 測試會議×4 與測試帳號）。
- **深色對比徹查輪（2026-07-17/18，使用者截圖產品列近黑字＋指示徹查）**：
  1. **4 鏡頭對抗式徹查 workflow**（40 agents；token-math 鏡頭 agent 陣亡由另兩鏡頭覆蓋）：raw 18→confirmed 6／killed 5。**單一根因**＝全域 `button{font-family:inherit}` 缺 `color:inherit`＋全站無 `color-scheme:dark`→五種卡片型 `<button>` 標題（companycard/contactrow/productrow/personacard/deckcard）吃 UA ButtonText 近黑、對比 1.21:1。假陽性攔下：「未驗證」badge 實算 ~5:1 屬刻意弱化、admin 淺色主題無此缺陷（其 button 同缺 color:inherit 記債）。
  2. **修（commit `345e495`）**：`button{color:inherit}`（一條治六處，唯讀 studio-present.css 的 deck 卡靠繼承修）＋`:root{color-scheme:dark}`（.mc-google__btn light 保留）＋CRM 新增公司三裸 input 補 .mc-input＋id/name。誤傷掃描 0。**實機驗證全 PASS**：五種卡片 computed color 全 `rgb(232,237,248)`、colorScheme=dark、console 0 error（crawl-test 帳號 Connact AI 實資料，案發現場截圖比對）。
  3. **同 commit 入憲**：CLAUDE.md 硬規則 1 改四點式「Fable=計畫者、執行派 Opus」（使用者 07-17 下令，參考 ezpage CLAUDE.md:13-17 寫法）；記憶同步。
  4. **部署**：web build SUCCESS → rev **00009-ftj**（只動 apps/web 故只重建 web）；冒煙 web 200＋線上 CSS 含 color-scheme:dark＋API 200。
  5. **記債**：ContactsTab 兩裸 input（color-scheme:dark 後反而變佳，日後統一）；admin button color:inherit。

## 2026-07-18 session（CRM 品質四修：型號+圖片、中文名+照片、全繁中、研究卡死）

- **使用者四指示**（看線上 CyberPower 詳頁截圖）：產品深檔要型號+圖片+簡介（只寫「USB 充電器」太模糊）；台灣人物要中文名+照片；除專有名詞外一律繁中 i18n；「研究此公司」卡「研究中」不消失要修。
- **兩路 Opus 調查**：(a) 研究卡死＝背景 fire-and-forget job＋Cloud Run min-instances=0 回收時無人收尾（無 boot reaper、無心跳）→DB 列永遠 running；前端不看年齡、active 時關閉/重試全藏＝鎖死無逃生口。(b) 管線：schema 無 model 欄（prompt 把型號當獨立產品名）；mediaUrls/photoUrl 欄早存在但爬蟲不抓圖、抽取器不填；titleZh/backgroundSummaryZh 已落庫但 UI 從不 render；industry/中文名缺欄。
- **Fable 拍板**（ROM 07-18 兩則）：reaper（boot 掃 queued/running→failed）＋前端 65 分逃生口；migration 015 加五欄（industry_zh/tagline_zh/business_model_zh/model/full_name_zh，SQLite+PG 各一支）；雙語不變量保留（主要欄留來源語言、繁中走 *Zh gloss+UI 優先）；圖片走既有欄免 migration（爬蟲抓 og:image+頁內 img、白名單防幻覺）；中文名嚴禁音譯捏造；deep 第三方人物照不做（記債）。
- **Workflow 實作**（8 agents 全存活）：server 包 14 檔（migrations 015×2、crm-types/mappers/repos-prospect、crawler 抓圖+sanitize、extractor/deep-extractor schema+prompt、jobs.failInterrupted+index boot reaper、reaper.test+image-whitelist.test）＋web 包 11 檔（api.ts、ProductsTab 縮圖+型號、ContactsTab/PersonaCard 中文名+titleZh+backgroundSummaryZh、CompanyDetailView *Zh 優先+細填錨定主欄、EnrichPanel/JobProgressCard 逃生口、messages parity 186/186）。
- **驗證**：build 全綠（server tsc+vitest 27 檔 120 測、web tsc+next build 16 路由、crm 7 檔 49 測含 migration 015）；雙對抗審查 3 findings 全修（medium＝sanitizeContacts 空字串 gloss 會讓 `??` 顯示空白人名——與 deep 端 cleanStr 對齊；low＝逃生口樂觀 job 補 createdAt 錨；low＝圖片排除移 gif 對齊契約）；複驗全綠。
- **E2E（本地真跑）**：PORT=8790 起 server（8788 被佔改埠）、crawl-test 帳號對 Connact AI 重跑 deep→118 秒 done、fields_filled=46；**industry_zh=「軟體開發、行銷科技與電商人工智慧」落庫**（原 NULL）、Troy→full_name_zh=「程峻宏」、jobs API 回 createdAt、reaper 正常（無孤兒=0 筆）。SaaS 公司 model/media_urls 全 null 屬合理。
- **未 commit（硬規則 10，等使用者核准）**。CHANGE_TRACKER 3 筆（server/web/fix）、ROM 3 則。
- **部署後效果**：prod 卡死的 CyberPower job 會被新版 boot reaper 自動標 failed→按鈕解鎖；既有英文資料屬舊管線產物，重按「研究此公司」即以新管線重抽（型號/圖片/中文名/繁中）。
- **記債**：deep 第三方來源人物照；contact 疑似重複列（E2E 見 Troy/Cheng Chun-Hung/Cheng Chun-hung(程峻宏) 三筆並存，屬合併鍵問題另輪處理）；本機 :8788 有 node tsx dev server（pid 39956，14:16 起，非本 session 所啟）待清。
- **研究引擎擴編輪（同日續，使用者看 ConnactAI 重研究結果：「範圍不夠多不夠深、產品不具體」）**：
  1. **兩路調查定根因**：①isBilingual 誤判（英文名＋非 .tw → round1 全英文查詢，台灣中文來源全漏＝外部只剩 1 筆 bnext 的第一因）＋grounding 跑最弱 flash-lite＋深讀上限 6＋SafeFetcher 純 undici 不渲染 JS（104/cakeresume/SPA 站全滅）；②產品：每頁 6K 硬砍（總預算沒用滿也砍）＋單次全家桶 16K 輸出擠壓＋schema 只 name 必填＋deep 對產品零回填＋specs 抽了 UI 不顯示。
  2. **擴編實作（Workflow 9 agents：S1 廣度→S2 產品序跑＋web 平行）**：S1＝全角度雙語查詢（廢排除語意）＋五新角度（徵才/客戶案例/評測/商工登記/獲獎）＋grounding 升模 extractModel＋深讀 6→12(cap20)＋Playwright render fallback（SSRF 同 crawler、≤8 次/20s/並行2）＋per-contact 補查（≤5 人 fill-empty）＋商機路徑（opportunities[]→「研究商機線索」筆記，不建 deals）＋deep 產品外部回填（名稱對齊 fill-empty/union）＋sources 補真 cap60。S2＝每頁截斷動態化（夠就給足 12K）＋prompt 硬性最低具體度＋產品 schema 補 techStack/competitors＋per-product 二段式聚焦深抽（≤10 品、單品 rich schema、失敗隔離）＋案例頁權重 2→4。web＝ProductsTab 補 render specs 表格/keyFeatures detail·benefit/targetPersonas/competitors/pricingNotes/oneLiner/外開連結＋productsTab namespace 25 鍵 parity（順帶收斂全元件標籤進 i18n）。
  3. **對抗審查**：confirmed 1 medium（A8 base/variant 產品貪婪誤配 Ghost/Ghost Pro）→ 修＝正規化精確配對優先＋新 merge-deep-products.test 6 測；另修 A6 provenance redirect 未還原。
  4. **E2E 對照（Connact AI 本地重跑）**：來源 12→45（外部 1→32、26 網域）、主管 1→8（6 人中文名）、新聞 2→5、4 產品全部 3 具名功能＋競品 0→3/4、商機線索筆記首次產出（徵才×2＋政府專案，帶來源）、fieldsFilled 46→84；耗時 118s→749s（預期代價，20 分軟預算內）。
  5. **三尾巴修復**：產品深抽 MAX_TOKENS→0（掉筆品復抽 3/3/3）；grounding 504 24→0（timeout 30→90s＋attempts 3＋並行 3→2 env 化）；thinkingBudget plumbing 相容性實證 OK。**人物背景第二輪聚焦修**：真根因＝模型對身兼多職者在 titleZh 退化重複循環灌爆輸出（usageMetadata 實證，非 thinking 吃預算）→ 硬性單一職稱 prompt＋maxOutputTokens 2048/thinking 0/temp 0.4＋saneTitle 守衛＋MAX_TOKENS 砍半重試；真實 API 微型實測修前 3/3 失敗→修後 6/6 乾淨。
  6. **驗證數字**：server tsc 綠＋vitest 31 檔 152 測全綠；web tsc＋next build 16 路由綠；crm 49 測綠。**未 commit（硬規則 10，等使用者核准）**。CHANGE_TRACKER 本輪 6 筆、ROM 2 則。
  7. **記債**：極端多職者仍可能偶發循環（三層兜住、最壞留空）；saneTitle/isMaxTokensError 未匯出無單測；產品 specs/pricingModel/techStack 對純行銷官網先天有限（來源沒有就抽不到）；deep 單次成本/耗時 ~6 倍（env 可調降 DEEP_RESEARCH_MAX_QUERIES/MAX_SOURCES/GROUNDING_CONCURRENCY）。
- **commit＋部署（2026-07-18 使用者核准，研究引擎擴編輪）**：三邏輯 commit → `6b6025f` feat(research)（server＋4 新測 13 檔：雙語查詢＋五新角度＋grounding 升模＋深讀 6→12/render fallback＋per-contact/商機/產品外部回填＋二段式深抽＋MAX_TOKENS/504 修復）＋`c38291d` feat(web)（ProductsTab 補 render specs 表格/功能細節/競品/定價備註＋i18n 收斂 4 檔）＋`0d9c95c` docs（WORKLOG/ROM/CHANGE_TRACKER），push origin main（`b59c4c4..0d9c95c`）。部署照 SOP A：兩 build 皆 SUCCESS——server build `fbec48f0-0345-44f3-8f84-c2e2d06fc52c`／web build `ac85d0d8-427f-4132-979a-e9dcf33f6f0b`；server rev **00013-8ms**（`services update --image`，env 與 `--no-cpu-throttling` 保留）＋web rev **00011-89t**（`run deploy` 帶 `--set-env-vars=NEXT_PUBLIC_API_BASE`）。本輪無 migration。冒煙：`/api/health` 200＋`/api/ready` 200＋web `/` 307＋`/zh-TW` 200；新 rev 開機 log 無 error（`[server] listening on :8080`＋STARTUP probe OK；`PLATFORM_ADMIN_EMAILS`/`YOUTUBE_API_KEY` 未設＝既有良性 config 警告；reaper 0 筆孤兒＝上輪卡死 job 已清完屬正常）。DEPLOY.md 版本節已更新。
- **commit＋部署（2026-07-18 使用者核准）**：三邏輯 commit → `6826567` feat(research)（server/packages 13 檔：migration 015×2＋爬蟲抓圖＋型號/中文名/繁中 gloss＋防幻覺白名單＋boot reaper＋2 新測）＋`92020ed` feat(web)（10 檔：繁中優先 UI＋產品縮圖/型號＋人物中文名＋研究卡死逃生口）＋`95de538` docs（WORKLOG/ROM/CHANGE_TRACKER），push origin main（`0f4fac9..95de538`）。部署照 SOP A：兩 build 皆 SUCCESS——server build `0c17b36d-56f0-46ef-abc0-4fd8da6b0917`／web build `251593d8-5dfa-47c2-b8e2-28ca05819442`；server rev **00012-drd**（`services update --image`，env 與 `--no-cpu-throttling` 保留）＋ web rev **00010-lmf**（`run deploy` 帶 `--set-env-vars=NEXT_PUBLIC_API_BASE`）。冒煙：health 200／ready 200／web 307／zh-TW 200。**boot reaper 實證**（新 rev 開機 log）：`2026-07-18T06:54:01.091816Z [research] reaper: marked 1 interrupted crawl job(s) as failed on boot`＝prod 卡死的 CyberPower deep job 被收（筆數 1）。migration 015：pg runner 靜默成功（僅出錯才 throw＝crash boot），boot 正常 `listening on :8080`＋/api/ready 200＋reaper 行在 migrate() 之後印出＝三重佐證 015 已套、無 migration 錯誤。DEPLOY.md 版本節已更新。

## 2026-07-19 session（會中進行收斂：三介面→帳號B 單一 cockpit＋帳號A 一鍵開簡報）

- **緣起**: 使用者看「會中進行」三連結（簡報舞台／會中副駕／HUD）截圖，指過於複雜——應同頁同時打開、不需給連結；一人開 Google Meet 按允許即拿到聲音；副駕/HUD 要同介面。澄清：簡報仍分享給對方，但報告者開兩帳號（A 報告、B 看額外內容）。決策細節 ROM 2026-07-19 17:20。
- **設計 pass（Workflow：3 讀檔→3 方案→3 視角評審→收斂）**: **關鍵發現＝使用者要的融合頁已存在於 /copilot**（CockpitView 左收音＋右完整 HUD＋I2 gate，同 <main>／雙 WS）。真正缺：(a) 導覽平列三 external 使人不知 cockpit 已含 HUD；(b) /hud 與 cockpit 右半重複；(c) 收音遠非一鍵（登入＋setup＋隱藏同意勾選第四關）。評審選 Design 1「一站式副駕」（贏 invariant-safety＋impl-risk 兩鏡頭）嫁接 Design 2 檔案清單＋帳號A launcher；棄 Design 3 /live hub（多 render-cockpit 容器＝近 I3 破面）與 Design 2 stepper（動 live-critical 邏輯）。
- **使用者三拍板**（AskUserQuestion，皆採建議預設）：全套照建議做／／hud 保留但從導覽移除（留第二裝置）／收音中度精簡。
- **實作（Workflow：Foundation 鎖契約→UI 平行四檔→Verify 三路對抗）**，七檔 apps/web：
  1. **導覽**（AppShell＋HomeDashboard）：nav.live 收斂為兩入口（簡報舞台/present、會中副駕·HUD/copilot），移除頂層 hud；兩檔一致。
  2. **cockpit 外殼**（CockpitView＋globals.css）：私人帳號B 說明＋可收折「在另一台裝置看 HUD」affordance（buildHudUrl 連結＋複製＋QR 佔位）；版面/雙 WS/pane 掛載未動。
  3. **收音摩擦**（CopilotView）：同意內嵌起始卡（非預設勾）＋分頁音訊三步引導於 picker 前＋zero-track 一鍵重試；相位機/介面不變、getDisplayMedia 前不 await createMeeting。
  4. **帳號A launcher**（SlideEditor）：「開始簡報」＝靜態預覽（deckId-only）＋連線會議播放（createMeeting→buildPresentUrl→開分頁，present-role token）；不動 present/PresentStage。
  5. **helpers**（meeting-session）：buildPresentUrl/buildHudUrl（locale 前綴絕對 URL）；i18n 兩語系加 25 鍵、移除 hud.title。
- **驗證**: apps/web `tsc --noEmit` exit 0 零診斷；fresh-context 走查全 PASS（兩入口無 hud、affordance/雙WS、consent 非預設＋一鍵重試＋無 await createMeeting、launcher present URL、25 鍵兩語系齊）；不變量＋authz 攻擊者視角 PASS（誤帶/跨 org token 仍漏不出 HUD、I1/I2/I3 未削弱、present/PresentStage/SuggestionQueue/deck-patch 皆未碰）。**未 commit（硬規則 10，等使用者核准）**。
- **誠實邊界/記債**: 「一鍵允許拿聲音」技術不可能（getDisplayMedia 必跳系統選單，app 不能替選 Meet 分頁/勾分頁音訊）——只能壓站內點擊＋拔隱形陷阱。靜態預覽假設 PresentStage 無 meetingId/token 時走本機翻頁（未改該檔驗證，待實機或小追查確認）。QR 為 inline-SVG 佔位（無 QR 相依，複製連結為實際交接路徑）。帳號 A↔B 跨帳號 live-sync 免貼連結需 Design 3 join-as-present 端點（工作量 L），此輪不做。工作區另有未提交 CRM 變更，commit 時只 stage cockpit 相關檔。
- **待使用者**: 核准 commit（見終報 message）；核准後部署只重建 web（純 apps/web）；實機兩帳號＋Meet 走查真收音。

## 2026-07-19 session（CRM 五指令：人物去重＋照片＋社群專區＋研究更多＋技術棧UI）

- **使用者五指令**（看 ConnactAI 擴編版結果截圖）：人物重複要合併且頭銜累加；還是沒照片；要社群媒體專區（FB/IG/Threads/YT 專門整理）；要「研究更多」（既有基礎上驗證＋補缺）；技術棧難讀要改版＋說明文字。另同輪打包六記債（semaphore settle/尾段 deadline/cleanUrl 白名單/預算預設對齊/逃生口 65→95 分）。
- **兩路調查根因**：contacts 合併鍵只比 full_name 精確字串（威妥瑪/漢語拼音/英文名各算一人，fullNameZh 從不參與）；深度模式 payload.contacts=[] 把官網 contacts（拼音統一+帶照片）整批丟棄；deep prompt 明令不填照片；social_links 早在抓但沒映射給前端、YT/Threads 內容合成後即丟；company_tech 無說明欄；gap 分析純 citation 計數不看 DB 空欄。
- **實作（Workflow 9 agents：WS-A 資料層→WS-B 引擎序跑＋WS-C web 平行）**：
  1. migration 016（tech note_zh＋company_social_posts 表）＋017（crawl_jobs.mode CHECK 放寬加 more——E2E 逮到的漏網 migration，SQLite 走 010 重建 pattern）。
  2. 人物去重四件套：fullNameZh fallback 合併鍵（兩條 upsert 路徑）＋mergeTitle「 · 」累加去重上限 4 段＋dedupeCompanyContacts 研究後自動合併 pass（10 引用欄 re-point、deal_contacts PK 撞刪重複、≥2 verified 跳過護欄、單群一交易）＋deep 不再丟官網 contacts；E2E 後契約擴充：CJK 內嵌抽取入群＋回填 fullNameZh、羅馬拼音正規化全等橋接（嚴禁模糊）。
  3. 照片：crawler 補抓 CSS background-image；enrichKeyPeople 照片獵取（alt 含人名 詞界匹配、og:image 需 title 含人名、佔位圖檔名黑名單）；頭像 referrerPolicy=no-referrer。
  4. 社群：SocialFetcher 回結構化 posts 落 company_social_posts；GET /companies/:id/social；web 新 SocialTab（四平台帳號卡＋貼文/影片清單）。
  5. 研究更多：mode=more——DB 空欄種子定向查詢（cap 12）、基礎角度縮 overview+news、公司欄 fill-empty 不覆寫、同值異源佐證 confidence +0.15 cap 0.9（不動人工 verified）、跑完自動 dedupe＋獵照。
  6. 技術棧：抽取器產 noteZh 一句說明；TechTab 改分類分組列表。
- **審查修復**：confirmed 2 全修（photo-hunt 拉丁 2 字母段子字串誤中→詞界匹配；補查軟 deadline 與硬 timeout 同值形同虛設→hard−clamp(1/6,60s,600s)）；2 low 附證據不修（契約既定設計/範圍外）。
- **E2E（本地 more 模式實跑 Connact AI，10.3 分）**：dedupe merged=4 removed=5 **零誤併**、四組人物三組完美收斂（程峻宏 5→3 揪出 zh=null 漏併→契約擴充後實資料驗收 3→1、7→5 列、中文名回填、頭銜累加 4 段）；tech note_zh 0→3（內容實質）；公司欄 fill-empty 實證（8 欄前後不變）；佐證升信心 0→5 筆 0.70；social 端點 200；migration 017 開機自動套；唯一垃圾照片（FB_default 佔位圖）→黑名單修＋DB 清掉。
- **驗證數字**：crm 8 檔 61 測＋server 35 檔 181 測＋web tsc/next build 全綠。**未 commit（硬規則 10，等使用者核准）**。
- **與平行 session 交疊**：會中導覽收斂輪（上一節）同倉未 commit，globals.css/messages×2/api.ts 四檔兩輪交錯——commit 切分方案見終報。
- **記債**：同公司同中文名不同人會被合併（契約既知風險，需人工鍵時再議）；meeting_signals.entity_ref_json 軟參照未 re-point（display-only）；圖片代理/落地儲存（hotlink 依賴 no-referrer）；FB/IG 無官方抓取管道（僅帳號卡）；photo 真實命中率仍受來源限制。
- **simplify＋/code-review 收尾（使用者指令）**：simplify 3 處真收斂（import 併行×2＋SOCIAL_PLATFORMS 單一真源）；5 鏡頭審查（掃兩輪合流 40 檔＋16 新檔）raw 6→過門檻 1——SocialTab 社群連結無 scheme 驗證（儲存型 XSS 面，兩輪驗證兵對 React 19 是否中和 javascript: href 結論相反→不賭，server buildSocialLinks/sanitizeSocialPosts 走 cleanUrl＋client httpUrl 純文字降級雙層白名單）；順收三筆低分（photo-hunt \b 詞界誤中 data-alt→(?:^|[\s"'])、CJK 抽取加 2-4 字＋地名/公司 stoplist 防「(台北)」誤組、dedupe 尾段補軟 deadline 守衛）；meeting-session wsToken 入 /present URL（47 分）屬導覽輪檔案記錄供該輪參考。終驗：crm 64＋server 188＋web tsc 全綠。
- **三指令輪（同日續，使用者本地試用後：筆記 md 渲染／社群要內容非連結／照片仍缺；補充指定照片來源＝官網＋Google 圖片）**：
  1. **調查含外部實測**：YT 無金鑰抓頻道頁 ytInitialData 實測可解 30 支；FB/IG 公開頁實測被牆（400/consent 殼）直抓不可行；cake.me 公司頁無人名 alt（對人物照無料但不誤配）；筆記裸 redirect 根因＝resolveRedirects 預設 max 16 溢出。
  2. **實作**：web 加 react-markdown v9（無 raw HTML、urlTransform http(s)/mailto 白名單、外開）＋NotesTab 渲染＋mc-md 樣式；筆記來源雙修（isGroundingRedirect 降級純文字＋resolve max 48）；YT 無金鑰 Playwright fallback（lockupViewModel＋舊 videoRenderer 雙結構、觀看數 zh/en 解析、相對日期 best-effort）；Threads handle 由 IG username 推導＋**登入牆偵測**（E2E 抓到把登入頁 UI 當 9 則貼文的髒資料→isLoginWallContent 兩條命中判死＋本地清理）；FB/IG 走 deep socialSummaries「動態摘要（AI 整理）」（明標非原文、每平台至多一筆冪等——審查抓到 url=null 不冪等→固定 title DELETE+upsert 修）；finalHandles 回饋二次社群抓取（治「grounding 才發現的頻道永遠餵不進 fetcher」架構缺口）。
  3. **照片 v2+v3**：per-person 專屬照片查詢；**官網 DOM 鄰近匹配**（img 前後 ~300 字窗口含人名即候選、alt 優先、守衛全沿用）；Google 圖片 CSE 整合（GOOGLE_CSE_API_KEY+GOOGLE_CSE_CX 雙鑰、缺鑰優雅 skip、每人 1 查/job ≤5）。
  4. **E2E 三連跑**：第二跑誠實 FAIL 揪出 threads 登入牆/YT 架構缺口/FB·IG 摘要 0；修復後終驗 **PASS**——threads 正確 skip＋零垃圾列、notes 零裸 redirect（來源全解析成真實 URL）、YT second pass log 正常、**照片 0/5→2/5**（程峻宏 niea.org.tw、李光斌 aif.tw，HTTP 200 實圖驗證）、FB/IG 摘要 0 但有多源證據＝本輪 grounding 無可斷言粉專事實（寧缺勿假，接線已驗通）。
  5. **驗證數字**：server 43 檔 241 測＋crm 65 測＋web tsc/next build 全綠。**未 commit（硬規則 10）**。
  6. **待使用者**：YOUTUBE_API_KEY（YT 官方 API 路徑）＋GOOGLE_CSE_API_KEY/GOOGLE_CSE_CX（Google 圖片）兩組可選金鑰；commit 方案 A/B 裁決。
  7. **上線（2026-07-19，使用者核准方案 A）**：複驗全綠（server tsc＋vitest 43 檔 241 測／web tsc＋next build，疊在剛 merge 的 DynamicSlide main 之上）。commit×3 push origin main `4d8d78d`→`0dcef09`：`ab7f3ed` feat(research)＋`822923f` feat(web)＋`0dcef09` docs（+本部署紀錄另立第 4 commit）。雙 image 重建：build server `f15ce324-99f5-4895-91b7-fbb9d9a72fbb`／web `0f1c0d68-6b8b-463a-8398-796a41f1d66a` 皆 SUCCESS。部署：server `meetcopilot-server-00016-dtp`（`services update --image` 保 env＋`--no-cpu-throttling`）＋web `meetcopilot-web-00013-w8v`（run deploy 照 SOP）。**本輪無新 migration**（016/017/018 前次已套，開機 log 無 migration 動作）。冒煙全綠：server `/api/health` `{"ok":true}` 200＋`/api/ready` `{"ready":true}` 200＋web `/` 307＋`/zh-TW` 200；新 revision 開機 log 無 error（GOOGLE_CSE/YOUTUBE 缺鑰＝預期 skip warning、無 ERROR/WARNING 級）。

## 2026-07-19 session（DynamicSlide 匯入徹底重構——保留原簡報＋尾端 append，獨立 worktree 分支）

- **緣起**：使用者匯入設計精美的簡報（金融商品AI導入計畫，實為 `AI金融商品應用v1.pdf`），發現匯入後變成「另一份純文字簡報」（標題亂碼 AIé‡‘èž…、每頁 heading 全「Page」、bullets 夾 CONNACT logo/頁碼 13、原視覺全失）。要求：DynamicSlide 應在**原簡報基礎上、尾端依會議內容加頁**，並檢查整條有無類似錯誤、逐項確認目的。
- **根因（Opus 調查，皆 檔案:行號）**：匯入管線設計本質＝pptx/pdf 拆純文字 SlideSpec→建**全新 deck**→平台深色模板重畫，原檔不落地。三疊加缺陷：multer 檔名 latin1 亂碼＋標題永遠取檔名；extractSlideBlocks 只認 title placeholder 當 heading 且未過濾頁尾/頁碼；資料模型只存 SlideSpec 無欄承載原始頁。append 本身正確（符合 I1）。
- **使用者逐項拍板（AskUserQuestion）**：①保留原簡報、只尾端加頁；②以原始 .pptx 為準（匯出可編）；③顯示用 server 轉每頁圖片；④這輪完整重構；來源＝**pptx 主力/PDF 次要雙路徑**（PDF 原始頁無法忠實變可編 pptx，故 PDF→PDF）；⑤存 Postgres bytea（無新物件儲存）；⑥獨立 worktree 隔離（主樹 research WIP 不動）。決策全記 ROM。
- **Phase 0 spike（真證據）**：A＝Debian 容器 libreoffice-impress+poppler+fonts-noto-cjk 轉檔（4頁 3.2s、峰值 152MiB、中文需 fonts-noto-cjk 硬需求、image +~1GB）；B＝jszip 嫁接補充頁到既有 pptx，**使用者實機 PowerPoint 開 merged.pptx 零修復、18 頁正確**。
- **實作（worktree 分支 `worktree-dynamicslide-preserve-original`，從 585a077 分）**：Phase 2 foundation（migration 018/型別/repos-deck-assets/import-jobs/signed-url/assets-route/路由骨架）→平行 build（IMPORT 匯入+rasterize job／EXPORT 雙路 merge／WEB 鎖定+進度+續簽／DOCKER apt）→整合。詳見 CHANGE_TRACKER 2026-07-19 22:10。
- **驗證**：typecheck 5ws 綠、crm 50/server 163 測綠；Phase 3 五維對抗式審查 4 confirmed 全修（migration 撞號 018/匯入卡 processing 開機對帳/補充頁尺寸讀原檔 sldSz/簽章 TTL 8h+續簽）；/code-review ≥80 confirmed 0；/simplify 套 6；**Docker 真檔 E2E 3 案例全綠**（PDF 19→21頁、真 pptx 16→18 slide、寬螢幕補充頁滿版，中文像素忠實）。E2E 產物 `Desktop\meetcopilot-spike\e2e\`。
- **待使用者**：(1) 開 E2E 產物（merged.pdf/merged.pptx/merged-widescreen.pptx）確認；(2) 核准 commit-to-branch / merge-to-main / 部署（部署動 apps/server→重建 server image 含新 apt 層 +~1GB；動 apps/web→重建 web）。
- **merge 注意**：本支 migration **018**（主樹 research WIP 已佔 016_social_tech/017_more_mode）；crm-core 冪等測試已改 gap-tolerant。merge 前確認 018 不撞屆時主樹最高號。
- **隔離狀態**：code 全在 worktree 分支；docs（本檔/ROM/CHANGE_TRACKER）在主樹補（與 research session 平行編輯交疊，Edit 精確插入未覆蓋）。**本檔已超 150 上限（研究 session 內容為主），歸檔待兩線 session 收斂後處理。**
- **記債**：真 pptx 恰為 10×5.625（寬螢幕修正只用合成檔驗）；補充頁生成走真 Gemini 管線未在本輪 E2E 驗；export HTTP 層/錯誤逾時路徑/加密 PDF 未驗；conversion job max-instances>1 時開機對帳理論上可能誤殺他實例進行中轉檔（現部署 max-instances=1 故無虞）。

## 2026-07-20 session（DynamicSlide 對話→補充頁生成橋接補完＋mp3 會議模擬器測試工具）

- **緣起**：使用者要「打造測試管道＋腳本，匯入音檔模擬會議、配合 PPT（`AI金融商品應用v1.pdf`）看到新增 PPT 被插在後面」；假設三人＝2 客戶＋1 報告者；測試入口直接寫進前端不隱藏。
- **關鍵發現（4 路 Opus 調查＋親自查證）**：DynamicSlide 的 append 機制（I1/I2/patch-service/deck_update/present 渲染）全建好且有測試，但 **`patch.suggest()` 無任何生產呼叫者**——`onSignals` 只做 CRM info_card＋自動深查，「會中對話→生成一張補充頁→送批准」這條觸發線**從未接上生產**＝真會議永不 append。→ 任務升級為「補完產品缺件＋測試工具」。
- **使用者三拍板（AskUserQuestion）**：(a) 補**真正的產品接線**（非測試專用觸發器）；(b) 走**真 HUD 手動接受**（保完整 I2，不自動批准）；(c) 執行環境**入口可切、本機/線上兩邊支援**（缺件偵測寫進頁面）。決策記 ROM 2026-07-20。
- **實作（server 橋接）**：`config` 加 `supplementAutoLimitPerMeeting`（env，預設 8）；`slide-gen` export SLIDE_SCHEMA＋新 `generateSupplementSlide`（與 deck 生成共用 prompt＋sanitize、禁 image、空頁回 null）；`orchestrator` 加 `onSuggestSlide`＋`maybeSuggestSlide`（合格訊號集＋節流 40s 樂觀佔窗＋每場配額成功才計＋`companyName` grounding，disposeSession 清狀態）；`hub` 傳配額＋`onSuggestSlide→patch.suggest`。**I1/I2/I3 未弱化**（只新增建議產出者，批准/append/HUD 隔離不變）。
- **實作（前端測試工具）**：`lib/mp3-capture.ts`（mp3→decodeAudioData→OfflineAudioContext 重取樣 16k mono→Int16→250ms/frame，與生產 worklet 同格式，回傳同形 CaptureController）；`components/sim/MeetingSimulator.tsx`（/sim，導覽「測試」群組**可見不隱藏**）——選/匯入 deck→選 mp3→createMeeting(綁 deck)→3 條 WS（capture 灌 mp3／present 收 deck_update 畫即時縮圖列、本次新增頁標綠／`HudInner embedded` 真 transcript/signals/建議＋手動接受）；AppShell nav 群組＋i18n 兩語系。
- **驗證**：server `tsc` 綠＋`vitest` **44 檔 248 測全綠**（含新 supplement-slide.test.ts 7 測）；web `tsc` 綠＋`next build` **17 路由綠**（新增 /sim）。fresh-context 對抗驗證：橋接觸發/bounded/I1/I2/I3/mp3 格式/配額連帶/companyName **全 PASS**，抓到 **1 真 bug**＝模擬器 **consent-on-open 競態**（consent 早於非同步 ensureRuntime 建好的 runtime→靜默丟棄→零補充頁，本機最易中）→**已修**（收 `session_state` 重送 consent 兜底）＋2 小瑕疵（seedLen 標記／註解）全修，複驗 web tsc 綠。
- **未 commit（硬規則 10，等使用者核准）**。CHANGE_TRACKER 1 筆（含審後修正）、ROM 1 則。
- **待使用者**：(1) 提供 mp3 實測（隨後給）；(2) 本機測需 `GEMINI_API_KEY`（跑 ASR/分析/生成）＋ PDF 轉原始頁需 `pdftoppm`(poppler)——裸 Windows 沒有 → 匯入會 failed（頁面誠實顯示＋提示），可改打線上已部署環境（已內建 poppler，但新橋接接線需先 commit＋部署才生效）；(3) 核准 commit／部署。
- **記債**：補充頁生成 language 先固定 zh-TW（orchestrator 無 deck language）；補充頁未繼承 anchor theme（PDF 原始頁本無 theme，渲染器退 app 預設反而讓 AI 頁視覺區隔＝可接受）；`/sim` 頁文字走 inline zh-TW（測試工具，未進 i18n，只 nav 標籤入兩語系）；補充頁生成真 Gemini 端到端未在本輪跑（等 mp3＋金鑰實測）。
