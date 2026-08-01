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
- **同日續三輪（AI 記帳）**：(2) 使用者要 apps/web 開 AI 花費 dashboard（參考 ezpage、稅 ×1.25）＋「每次調用 AI 都記成本」→ 稽核出 **4 個漏記的 AI 呼叫**（補充頁/說話者/會中 grounded/train 評分）全補走 metered client；新 org-scoped `GET /api/org/usage(+events)`（owner/admin、租戶隔離）＋`/spend` dashboard（稅前→含稅×1.25）。(3) 使用者問「底層有無參考 ezpage」→ 誠實答無、遂調查 ezpage `marketing_backend` 後**全面對齊**：migration 019（reasoning/cached/retry/cost_tax_multiplier 每列稅率快照）＋差別計價＋**運行時 ALS 安全網補記**（raw 呼叫不漏記，explicit metering 抑制防雙記）。(4) /code-review 順修安全網自我干擾（als.exit）＋org usage 窗口守衛。每輪經 fresh-context 對抗驗證＋/code-review，各修 1 真 bug（consent 競態／安全網併發雙記／自我干擾）。細節見 CHANGE_TRACKER 2026-07-20 三筆＋ROM 三則＋ADMIN_CONTRACT v1.3。
- **commit＋部署（2026-07-20 使用者核准「commit + 部署」）**：部署前把關全綠（5 workspace tsc／server 264＋crm 65 測／秘密掃描零命中／migration 019 冪等＋開機安全／無新必填 env）。三邏輯 commit → `569f9ea` feat(server)（DynamicSlide 橋接＋AI 記帳對齊 ezpage＋org 花費端點）＋`139dc61` feat(web)（模擬器＋花費頁）＋`b26c682` docs，push origin main `2f98231`→`b26c682`。**packages＋server＋web 皆重建**：build server `9a008cb0`／web `75d51e1b` 皆 SUCCESS → server rev **00017-dl5**（`services update --image` 保 env＋`--no-cpu-throttling`）＋web rev **00014-qpq**（`run deploy` 帶 NEXT_PUBLIC_API_BASE）。**migration 019 開機自動套**（PG，`ready:true`＋`listening on :8080`＝019 未 crash boot 佐證）。冒煙全綠（health/ready 200＋web 307/200＋`/zh-TW/spend` 200＋`/api/org/usage` unauth 401＋開機 log 無 error）。DEPLOY.md 版本節已更新。
- **部署後待使用者**：`/sim` 本機測需 GEMINI_API_KEY＋poppler(pdftoppm)，或打線上；`/spend` 需 owner/admin 登入且系統跑過 AI 才有數字（可用 `/sim` 灌 mp3 產生用量）；`COST_TAX_MULTIPLIER` env 可調稅率（預設 1.25）。

## 2026-07-20 session（續：/sim 實測回饋修復——realtime WS 全掛＋HUD/markdown/重疊/風格對齊＋pptx WYSIWYG，已部署）

- **緣起**：上一輪部署後使用者首次用瀏覽器實跑 `/sim`，回報 4 點：①HUD 排版/可視化差 ②markdown 沒渲染 ③生成補充頁排版重疊＋與匯入簡報風格差異太大 ④「去帳戶擷取分析、比照腳本修正」。（另使用者先要語音測試素材：用 Windows SAPI 合成兩 WAV 到桌面——`meetcopilot-測試音檔_AI金融商品.wav` 單聲 ~7:55＋`..._雙聲.wav` 報告者Hanhan/客戶Tracy ~8:10，每句 12s 靜音撐過 40s 節流；劇本 `meetcopilot-測試劇本_AI金融商品.txt`。）
- **先修的線上 realtime 全掛（rev 00018-47r）**：`/sim` 兩條 WS 永遠「連線中」、收音 0%。根因＝Cloud Run server **漏設 `WS_PUBLIC_BASE`**（`meetings-routes.ts:33` fallback `ws://localhost:8080/ws`→瀏覽器連不到＋web CSP/mixed-content 擋；`/copilot`·`/hud` 同受影響，先前只跑 HTTP 冒煙故未抓到）。修＝`--update-env-vars WS_PUBLIC_BASE=wss://…server…run.app`（只動這 key、保其餘 17 env）。DEPLOY.md D 段/排錯速記補此必填 env。
- **4 點診斷（3 opus agent 平行）＋修**：①HUD 欄寬＝`globals.css` `.mc-hud` grid `1fr`→`minmax(0,1fr)`＋`/sim` HUD wrapper 掛 `mc-cockpit__hud`（套既有內嵌單欄規則）；②markdown＝情報卡/深查卡改走 react-markdown（新共用 `components/ui/Markdown.tsx`，`NotesTab` 收斂到它，安全模型不變：scheme 白名單/無 rehype-raw/a-tag noopener）；③重疊＝`studio-present.css` `.slide-block--features/two-col` 補 `min-height:0`＋features `align-content:safe center`＋`slide-gen` prompt 禁「chart/多 stat」與 features 同頁；③風格＝PDF 無 theme→生成頁退深色紫，新 `import/palette.ts` 用 pngjs 逐頁抽 bg/text/accent 寫進 `slide.theme`（四角取樣/亮度判文字/最飽和像素當主色，抽不到退 `NEUTRAL_LIGHT_THEME`，+pngjs 相依）＋`conversion-job` 每頁帶入＋`SlideRenderer` 由主色 color-mix 衍生 accent-2/-3；④＝撈線上 Cloud SQL 該場 58 筆 signals 證明**分析引擎正確、無 bug**——這次音檔本身是大雜燴（金融劇本只占少數，交錯 AI/統計課程/科技論壇/閒聊），管線忠實轉寫；跨場次無污染。**不改分析**，要驗劇本用乾淨 WAV 重跑。
- **風格策略（AskUserQuestion）**：使用者選「抽色為主、抽不到退中性淺色」（兩者都要）。
- **/code-review（5 opus 視角對抗式，部署前把關）**：Bug/正確性・I1/I2/I3/SSRF・authz・錯誤處理 4 視角**無 ≥80 問題**；脈絡一致性抓 **1 Warning（信心 88）**＝`SlideRenderer` 螢幕衍生 accent-2/-3 後，pptx 匯出 `pptx-render.ts:chartPalette` 仍固定 `CHART_ACCENT_HUES`(7c6cff/ff5d9e)→themed deck 多序列圖表「螢幕≠匯出」（違反 `slide-spec.ts:59-61` WYSIWYG）。使用者 AskUserQuestion 選「**修 pptx 匯出對齊**」→ `ResolvedTheme` 加 `accentIsExplicit`＋加 `mixWithBlack`，`chartPalette` 顯式主色時 series 2/3＝`mixWithWhite(accent,0.58)`/`mixWithBlack(accent,0.66)`（＝螢幕 color-mix），與 `slide-chart.tsx` PALETTE 逐格對齊。
- **驗證**：三批 fresh-context agent 全綠（server 47 檔 **269** 測、web `next build` 18 路由、前後端 typecheck；新 `palette.test.ts` 5 測、`conversion-job.test` 不破）。
- **commit＋部署（使用者核准「好」）**：commit **`606f7ee`**（17 檔）。**server＋web 皆重建**：build server `df93c5e7-263f-43a0-9a67-a9edb376aac4`／web `615c9d03-2ae8-40ef-ab27-6d9495cfa964` 皆 SUCCESS → server rev **00019-mzw**（`services update --image` 保 env，含 00018 補的 `WS_PUBLIC_BASE`＋`--no-cpu-throttling`，env count 18 未吹）＋web rev **00015-kzp**（`run deploy` 帶 NEXT_PUBLIC_API_BASE）。**本輪無新 migration、無新必填 env**。冒煙全綠：`/api/health`+`/api/ready` 200＋web `/`307＋`/zh-TW`·`/zh-TW/sim`·`/zh-TW/spend` 200＋`/api/org/usage` unauth 401＋`WS_PUBLIC_BASE` 仍在。DEPLOY.md 版本節已更新。
- **⚠ 尚未 push origin main**（本地 commit `606f7ee`；Cloud Build 從本地 tarball 建置故部署不需 push，但 origin 落後於已部署狀態——待使用者確認是否 push 備份）。
- **部署後待使用者**：用桌面乾淨的 `meetcopilot-測試音檔_AI金融商品.wav` 重跑 `/sim` 驗收——HUD 可讀＋markdown 正常、補充頁不重疊、生成頁採淺底配色貼近匯入簡報。

## 2026-07-23 session（/sim 實測二輪回饋——補充頁繼承匯入配色＋版型多樣＋版面預算，已部署）

- **緣起**：使用者用 `/sim`（07-21 匯入的 deck）實測，回報 3 點：①生成補充頁仍深色、與淺色匯入簡報不匹配 ②簡報下緣被裁 ③版型過於一致（都是 features 卡格）。
- **診斷（2 opus agent 平行，含撈線上 Cloud SQL 該 deck 實際 theme 值）**：
  - ①**根因＝anchor 未接**（真 bug，**非「要重新匯入」**）：前輪已讓匯入頁逐頁抽色帶 theme（線上實查：deck 19 頁匯入頁皆有淺色 theme `#f6f7f9`／末頁真實主色 `#911d22`/`#1595f7`——producer 正常），但 `orchestrator.maybeSuggestSlide` 呼叫 `generateSupplementSlide` **從未傳 anchorSlide** → `sanitizeSlide(raw, undefined)` → 補充頁 theme=undefined → 前端退 app 深色（consumer 斷線）。前輪只做「匯入抽色＋SlideRenderer 衍生」，漏了 orchestrator 這條接線。
  - ②內容量 ~59cqw ≫ 可用 ~42.3cqw（eyebrow+heading+subheading+4 feature 卡超出固定 16:9、body overflow:hidden），且 `generateSupplementSlide` 未跑 QA。
  - ③`TEMPLATE_INTENT_ZH` 叫 content 頁「優先 features 填滿」、補充頁又無「依訊號選版型」指引 → 千篇一律 features。
- **修**：`orchestrator.ts` 新私有 `deckTailSlide(orgId, deckId?)`（`core.decks.findWithSlides` 取 `slides.at(-1)?.spec`、deckId 缺/失敗吞錯回 undefined），`maybeSuggestSlide` 撈 deck 尾頁當 anchor 傳入 → 補充頁繼承匯入 deck 配色（含級聯：後續頁 anchor＝前一張已themed 補充頁）；`slide-gen.ts` 補充頁 system prompt 加「補充頁專屬規則」＝依當下訊號選版型（數據→stats/chart、對比→two-col、清單→bullets、單點→section/paragraph，僅並列多重點才 features；覆寫 content 優先 features）＋版面預算（features≤3、用 features 不放 subheading、每張 desc 一句話 ~20 全形字、不放 eyebrow、一頁一重點）；`studio-present.css` `.feature__desc` 加 `-webkit-line-clamp:2` 安全網（過長 desc 省略號、不硬裁整卡）。不動 I1/I2/I3（只補 anchor 唯讀讀取＋prompt/CSS）。
- **驗證**：fresh-context agent——server typecheck＋vitest **47 檔 269 測全綠**（`supplement-slide` 7 測如預期過：測試 runtime 無 deckId → `deckTailSlide` 早退不碰 core；`mid-meeting-crm`／I2 authz 相關測綠）＋web typecheck＋`next build` 18 路由。
- **commit＋部署（使用者核准「要」）**：commit **`7d77115`**（4 檔）。**server＋web 皆重建**：build server `79136327-5f74-4fad-a210-1b73acc97ef7`／web `4f92d4ea-6965-420a-879c-0d08539f56aa` 皆 SUCCESS → server rev **00020-q28**（`services update --image` 保 env，`WS_PUBLIC_BASE`＋`--no-cpu-throttling`，env count 18 未吹）＋web rev **00016-m7l**（`run deploy` 帶 NEXT_PUBLIC_API_BASE）。**本輪無新 migration/env/相依**。冒煙全綠：`/api/health`+`/api/ready` 200＋web `/zh-TW`·`/zh-TW/sim` 200＋`/api/org/usage` unauth 401。DEPLOY.md 版本節已更新、ROM 記「反轉前輪『補充頁不繼承 theme＝可接受』記債」。（CHANGE_TRACKER 該筆初寫誤植 07-21，已更正 07-23。）
- **部署後待使用者**：**不用重新匯入**——anchor 是生成當下即時撈 deck 尾頁，現有 deck 已帶淺色 theme；直接開一場新 `/sim` 即可看到補充頁淺底配色＋版型有變化＋不被裁。

## 2026-07-23 session（續：CRM×DynamicSlide×模擬訓練 多階段升級啟動——Phase A Cycle 1 已部署）

- **緣起**：使用者連續 5 則需求——R1 補充頁品質、R2 CRM 可編輯校正＋修正值回饋爬取背景、R3 政府標案/採購爬取、R4 模擬訓練可用性（手動新增主管／自由筆記→AI 歸位／已驗證改手動點）、R5 合成/設計式訓練對象（非真人＋人格特質＋公司 CRM＋銷售/面談目的）。收斂成單一計畫 `docs/CRM_UPGRADE_PLAN.md`（三階段 A CRM 人工掌控／B 補充頁升級（契約已凍）／C 政府爬取；Phase A、B 藍圖皆 opus agent 凍結）。
- **Phase A Cycle 1 實作＋部署**：A1 手動解鎖對練（`contacts.training_unlocked` 旗標＋migration 020＋PersonaCard「🔓 解鎖對練」按鈕；train 閘抽 `canTrain(readiness, unlocked)＝passesGate||unlocked`；**刻意不走 field_provenance 信任層**，避免把爬蟲猜測值升格為「人驗證真相」＝CRM_SCHEMA §11 反模式；決策記 ROM）／A2 新增主管補欄（部門/職級/決策權，重用 SENIORITY_LABEL）／A5a 子表重爬不覆寫人工值（`upsertChild` 加 `spec.entityType`→`trustedFieldsOf` 跳過 human/verified 欄，PRODUCT_SPEC=company_product、CONTACT_SPEC=contact；human value beats crawler 下沉共用機制）。跨 shared/crm/server/web。
- **驗證**：兩輪對抗式 Workflow（第 2 輪＝/code-review 6 視角）——build 全鏈、**crm 67＋server 270 測全綠**（新增 A5a 產品防覆寫 2 測、A1 解鎖閘 1 測）、web build 18 路由；**/simplify** 套 4 項（抽 canTrain、Bool01 映射對齊、移除冗餘守衛、SENIORITY_LABEL 去重）；**/code-review** bug/正確性・I1/I2/I3/SSRF・authz・錯誤邊界 無 ≥80，脈絡一致性抓 1 筆（Cycle 1/R4c 決策未記 ROM，信心 88）已補。
- **commit＋部署（使用者核准「Commit + 部屬」）**：commit **`628b810`**（17 檔）。**shared/crm/server/web 皆重建**：build server `59e2a322-0edc-4e1e-9799-8dbeead8a45e`／web `d90a73e8-b2ba-45ff-839e-bb9b808c2bf6` 皆 SUCCESS → server rev **00021-rxb**（`services update --image` 保 env、count 18）＋web rev **00017-xxc**（run deploy 帶 NEXT_PUBLIC_API_BASE）。**migration 020 開機自動套**（`ready:true`）。冒煙全綠（health/ready 200＋web `/zh-TW`·`/zh-TW/train`·`/zh-TW/crm` 200）。DEPLOY 版本節已更新、ROM 記 CRM 升級決策、`CRM_UPGRADE_PLAN.md` 為計畫真相來源。
- **部署後可測**：`/crm` 新增主管 → 按「🔓 解鎖對練」→ 到 `/train` 直接對練（不需先把 persona 欄填成 verified）。
- **待後續 cycle**：Phase A 餘項 A3（敘述/陣列欄編輯器）／A4（自由筆記→AI 歸位＋延伸研究）／A5b（爬取前注入已確認 CRM 權威值當背景）／A6（合成/設計式訓練對象＝R5：人格特質＋公司 CRM＋銷售/面談目的融入 `buildPersonaPrompt`）；Phase B 補充頁升級（契約已凍：CRM 取材＋講者口白 HUD-only 守 I3＋版型多樣三角形）；Phase C 政府爬取（GCIS 公司登記 API＋決標/標案子表＋tax_id，含 migration）。

## 2026-07-23 session（續：features 3 要點三角形排版〔已部署〕＋ WYSIWYG Studio 編輯器藍圖〔開始 C1〕）

- **features 3 要點三角形排版（已部署）**：使用者兩度回報 3 個要點排「2 上＋1 左下、右下留空」不美觀。修：`SlideRenderer` 加 `feat-count-N` class、`studio-present.css .feat-count-3` flex-wrap 置中（2 上＋1 置中下）、pptx `addFeaturesGrid` 落單卡置中（**螢幕＝匯出一致**）。commit `0e7158e` → server **00022-6kr**／web **00018-g98**（無 migration/env）。驗證 web build＋server 48 測＋typecheck 全綠；冒煙全綠。
- **WYSIWYG Studio 編輯器（使用者選「所見即所得」，藍圖已凍，指示「藍圖先做」→ 開始 C1）**：opus agent 3-cycle 計畫——採**獨立 `EditableSlide` 元件重用同一組 studio-present.css class**（present/thumb/sim 唯讀路徑**硬隔離**；`SlideRenderer` 抽 export 純函式 `renderSlideBlock` 當單一顯示真相，輸出逐字不變）＋**click-to-edit swap（原生 input／textarea，避 contentEditable 游標坑、繁中 IME 掛 onCompositionStart/End、blur/Enter 提交、Esc 取消，字級靠 font:inherit＋cqw 吻合）**；右側精簡為 版型（中文標籤）＋新增 palette（友善標籤＋glyph）＋AI 生圖（原封保留）；`readOnly`（isPlayed/isOriginal/locked409）時**不掛 EditableSlide、改唯讀 SlideRenderer**＋鎖定提示。分 **C1 文字類 block inline＋區塊工具列（↑↓✕）＋間隙「＋」插入＋右側精簡（含 renderSlideBlock 抽出＝最高風險先做並驗回歸）→ C2 stat/bullets/features＋視覺 IconPicker（重用 SlideGlyph）→ C3 chart(popover)/two-col(遞迴)＋淘汰 BlockEditor**。draft/persist/save/dirty/409（SlideEditor）＋`patchSlide` 整張覆寫（api.ts:558）一律沿用、SlideSpec/SlideBlock/SLIDE_ICONS/TEMPLATES/CHART_TYPES 契約不變 → server zod/Gemini enum/.pptx 匯出無感。
- **C1 已實作＋部署（2026-07-24）**：`SlideRenderer` 抽 export `renderSlideBlock`/`themeStyle`/`bgIsImage`/`slideClass`（純改名/抽出，present/thumb/sim 輸出逐字等價）；新 `EditableSlide`（文字類 block＋eyebrow 就地編輯、其餘型別唯讀顯示、每 block hover ↑↓✕）＋`ui/InlineText`（通用就地文字原語，blur/Enter/Cmd+Enter 提交、Esc 取消、繁中 IME `composing` ref＋`isComposing`、auto-grow）＋`slide-block-ops`（blockMove/Remove/Replace/newBlock 共用，BlockEditor 去重）；`SlideEditor` `!readOnly?EditableSlide:SlideRenderer`；`BlockEditor` 版型/新增區塊改中文標籤（過渡保留表單供非文字 block）。**/simplify 4 項＋/code-review 5 視角無 ≥80**（build-test 逐字確認 present/thumb/sim 回歸等價）。commit `d794ef4` → **web 00019-5cb**（純 web 重建、server 維持 00022-6kr、無 migration/env）。冒煙全綠（studio/present/sim 200）。**待使用者實機驗收就地編輯順手度**（尤其 Esc 丟棄未存編輯）；回饋後接 **C2**（stat/bullets/features 就地化＋視覺 IconPicker〔重用 SlideGlyph〕）→ **C3**（chart popover/two-col 遞迴＋淘汰 BlockEditor）。

## 2026-07-24 session（train 頁自助建對象：小修＋Phase A2 大功能，**已完成待部署**）

- **緣起**：使用者看 train persona 卡（「Chun-Hung Cheng」）回報 4 事——#2「補齊」連到 /crm 外層難調整（應直接到那個人）、#3 train 顯示英文名但 CRM 顯示中文名、#1「補齊」讓 AI 自行填、#4「對象不必是真人，直接在 train 頁選 AI 虛擬人物＋選公司＋人工或 AI 設人格，進 CRM 內部設定太麻煩」。
- **小修（#2/#3/readiness 標籤，6 檔）**：`PersonaOption` 加 `companyId`/`fullNameZh`；train-service `personas()` 帶出；PersonaPicker 顯示 `fullNameZh ?? fullName`（對齊 CRM ContactsTab）＋「補齊」深連結改 UrlObject `/crm/[companyId]?tab=contacts&contact=`；`/crm/[id]/page.tsx`（Server Component）收 `searchParams`→傳 `initialTab`/`initialContactId`→CompanyDetailView→ContactsTab 自動展開該主管；`FIELD_LABELS` 對齊 PERSONA_FIELDS 九鍵。tsc 三端綠（fresh agent read-back GREEN）。
- **Phase A2 大功能（#1 AI 補齊真人 ＋ #4 AI 虛擬人物 ＋ objective）**：使用者 4 岔路拍板（見 ROM 2026-07-24）——#1 補齊後**直接可對練**（草稿未驗證只翻 unlock，守 §11）、#4 虛擬人物**也進 CRM 附 badge**、objective **每次對練**、小修**併大功能部署**。
  - **流程（硬規則 1/6）**：Fable 凍契約（shared train.ts 六型別＋`PersonaOption.unlocked` 補洞、crm-types `isSynthetic`、migration 021、mappers、freeze doc `CRM_UPGRADE_PLAN.md` Phase A2 節）→ 派 Opus 實作 server（persona-gen.ts＋draftPersona/createSynthetic＋buildPersonaPrompt `BuildPersonaOptions{unlocked,objective}`＋crm `applyAiDraft`〔verified=0 守 §11〕）→ **Workflow** 六視角對抗式審查（server 驗證＋web 實作並行→審→驗）。
  - **審查結果**：11 raw findings → 2 高信心確認，**全數已修**（(1) draftPersona 原走 human update 會把真人 `verified_status` bump 成 'partial'＝誤導→新增 `setTrainingUnlocked` 純寫旗標；(2) 兩新 LLM 端點補 rate limit；(3) 虛擬按鈕文案「建立並開始對練」→「建立並選取對象」＋帶難度/objective 回啟動列；(4) 模式切換 ARIA 合法化）；4 誤報經對抗式驗證濾掉。
  - **驗證**：重建 shared＋crm dist 後——typecheck crm/server/web 全 EXIT=0；`server vitest` **50 檔 285 測全綠**（新增 train-selfserve 7＋persona-gen 8，含「persona 草稿恆 llm/verified=0」「draftPersona 不 bump verified_status」「跨 org /draft·/synthetic not_found 無副作用」斷言）；`crm vitest` **8 檔 67 測全綠**（is_synthetic 落庫/summary）。
- **狀態（已部署）**：使用者核准「commit+部屬」→ commit **`2855c46`**（28 檔）→ build server `3b183fc6-61cd-44ea-abe3-4015eb082cfc`／web `d077e3a0-ad67-4f10-9d70-ed6ec9fce209` 皆 SUCCESS → **server `00023-hgs`／web `00020-mz9`**（server `services update --image` 保 env、web `run deploy` 帶 NEXT_PUBLIC_API_BASE）。**migration 021 開機自動套**（`ready:true` 佐證 boot+migrate 未 crash）。冒煙全綠（`/api/health`+`/api/ready` 200＋web `/zh-TW`·`/zh-TW/train`·`/zh-TW/crm` 200＋未帶 token `/api/train/personas` 401）。DEPLOY.md 版本節已更新。
- **待辦**：**尚未 `push origin main`**（照本專案慣例 push 為獨立步，等使用者另行同意）；ROM 已 671 行（逾 500）**待歸檔**至 `rom_archives/ROM_001.md`（下個維護窗口做）；後續 Phase A 餘項 A3（敘述/陣列欄編輯器）/A4（自由筆記→AI 歸位＋延伸研究）/A5b（爬前注入 CRM 權威值）·Phase B 補充頁升級（契約已凍）·Phase C 政府爬取（含 migration）。

## 2026-07-24 session（續：語音對練 Gemini Live——確認 model＋對照官方範例微調，**已部署**）

- **緣起**：使用者貼 `gemini-3.1-flash-live-preview` 規格＋2.5→3.1 遷移注意事項並說「即時對話與對練用這個 model」，隨後補「參考 `github.com/google-gemini/gemini-live-api-examples` 範例」。
- **稽核**：(1) model 確認——config 預設＋`.env.example`＋**deployed server env 皆已是** `gemini-3.1-flash-live-preview`；Live client（`apps/web/lib/train/liveClient.ts`）**已與 3.1 相容**（無 thinkingBudget/proactiveAudio/affectiveDialog/對話中 sendClientContent/video 等 2.5 遺留；多 part 事件正確遍歷、audio 與 transcript 獨立 if 不漏取）。(2) 對照官方範例（`gemini-live-api-examples` node/前端＋`gemini-skills` SKILL.md）逐 9 點：音訊 16k/24k、interrupted 清佇列、自動 VAD、ephemeral token 前端安全、sessionResumption+goAway 續連——**全部一致且比基本範例更完整**；唯二「官方建議、我方偏離」＝麥克風 chunk 與 persona 嗓音。
- **套用（使用者 2 岔路拍板）**：(a) chunk `_target` 1600(100ms)→512(32ms)（對齊官方 20–40ms、barge-in 更靈敏）；(b) 每 persona 依 contactId 穩定選 prebuilt 嗓音（`PERSONA_VOICE_POOL` 8 經典嗓音〔native-audio＋half-cascade 皆支援，確保對 3.1-flash-live 有效〕＋純函式 `pickPersonaVoice`＋`live-token` 把 `speechConfig` 鎖進 ephemeral token，client 不可改）；(c) 修正 liveClient 誤導註解。驗證 web+server tsc=0＋server vitest 51 檔 **289 測全綠**（新 `persona-voice.test.ts` 4 測）。
- **commit＋部署（使用者核准「套用＋重部署」）**：commit **`d73b1c4`**（9 檔）→ build server `b3d8add8`／web `c6996ff1` 皆 SUCCESS → **server `00024-ngk`／web `00021-5kg`**（server `services update --image` 保 env、web `run deploy` 帶 NEXT_PUBLIC_API_BASE）。**無 migration/env/相依**。冒煙全綠（health/ready 200＋web `/zh-TW`·`/zh-TW/train`·`/zh-TW/crm` 200＋`GEMINI_LIVE_MODEL` 部署後仍 `gemini-3.1-flash-live-preview`）。DEPLOY.md 版本節已更新。
- **待辦（同上）**：**尚未 `push origin main`**——現累積 2 個未推 commit `2855c46`（train 自助建對象）＋`d73b1c4`（Live 微調），等使用者一聲一起推。
- **後續（2026-07-25 已處理）**：使用者核准「commit+部屬」→ 推上並部署（server 00023/00024、web 00020/00021），三 commit＋ROM 歸檔已 `push origin main`（至 `41d6d99`）。

## 2026-07-25 session（對練情境模式 Phase A3：把「銷售對練」一般化為可切換場景）

- **緣起**：使用者問「怎麼模擬面試」（原「密室」＝語音轉錄誤植「面試」）。釐清後需求更大——**對練對象/情境要可切換**，不只銷售：還要「尋求合作簡報（報告給對方公司爭取合作）」「政府簡報（報告給政府人員）」「面試」等，且**強調整個項目操作都要簡單、門檻低**（已入長期記憶 [[keep-operations-simple-low-barrier]]）。
- **設計（Fable 凍契約）**：把寫死 sales 框架＋四維評分，一般化為**資料驅動的情境模式登錄表 `TRAIN_MODES`**（4 模式：sales/partnership/government/interview，每個含 framing/stance/coachRole/dimensions＝單一真相，加模式＝加一筆）＋**評分改可變維度 labeled 陣列 `TrainScoreDimension[]`**（使用者選「可變維度」）。migration 022（training_sessions.mode）。
- **實作（Workflow 並行 server+web＋五視角對抗式審查）**：server＝repos-training（落 mode＋mapReport 舊 object scores 向後相容轉陣列）／buildPersonaPrompt 依 mode 換框架（sales 立場句逐字回歸）／scoring 動態維度（以模式 dimensions 為權威、缺補 0、亂序不影響）／train-service finish 用 session.mode（server 權威）／routes 驗 mode；web＝啟動列情境模式選擇＋ScoreReport 遍歷 labeled 陣列。**審查 8 raw→1 確認**（objective 用詞「銷售目標/這位業務」對非銷售模式錯位，信心 85）已修中性化。
- **簡化收斂（使用者原則）**：啟動流程收斂為**「選對象→按開始」**（mode 預設 sales、難度中性、目的空＝不注入，不碰也能一鍵開練）；情境模式由 4 張三行高卡改**精簡 chips＋一行角色提示**；objective 兩欄收進**預設收合**的 `<details>`。
- **驗證**：typecheck crm/server/web 全 0；`server vitest` 52 檔 **298 測全綠**（+9 mode 測）；`crm vitest` 9 檔 **70 測全綠**（+3）。
- **對練語言（同批加，2026-07-25）**：使用者要能設全中文/全英文對練＋報告語言跟 app i18n＋全中文兼容英文專有名詞。加 `TrainLang`（zh/en/auto，預設中文）→ persona `LANG_RULE` 決定 AI 回覆語言；評分報告語言＝跟 next-intl locale（web finish 帶 locale→scorer）；zh 時專有名詞保留原文不硬翻（persona＋scoring）。web 啟動列加精簡 3-chip 語言選擇（compact）。server vitest 升至 **306 測全綠**（+8 lang）。見 ROM 2026-07-25 15:16、CHANGE_TRACKER 同時。
- **狀態（已部署）**：使用者核准「Commit + 部署」→ commit **`cb33d14`**（21 檔）→ build server `3f5d2755`／web `d599f06a` 皆 SUCCESS → **server `00025-4x9`／web `00022-ztw`**（server `services update --image` 保 env、web `run deploy` 帶 NEXT_PUBLIC_API_BASE）。**migration 022 開機自動套**（`ready:true` 佐證）。冒煙全綠（health/ready 200＋web `/zh-TW`·`/zh-TW/train`·`/zh-TW/crm` 200＋未帶 token `/api/train/personas` 401）。DEPLOY.md 版本節已更新。隨後 `push origin main`。
- **實機 hotfix（/train 麥克風無法啟動）**：使用者首次線上實跑對練——按開始後**麥克風權限視窗不跳**、顯示「無法啟動麥克風」。console MIC-TEST 三步確認**卡在 AudioWorklet.addModule(blob:)＝`AbortError`**。根因：CSP `script-src` 未含 `blob:`（只 worker-src 有），Chrome 對 AudioWorklet 用 script-src 檢查→擋→getUserMedia 前即 throw（故不跳窗）。修（web-only）：`next.config.mjs` `script-src` +`blob:`＋`style-src` +accounts.google.com（順修 GSI 樣式紅字）；`liveClient` console.error 真錯誤＋AbortError/NotReadableError 訊息細分。commit **`1166f24`** → build web `6d27e18e` SUCCESS → **web `00023-9hb`**（server 不動）；`curl -sI` 驗回應 `script-src ... blob:`＋`style-src ... accounts.google.com`。**待使用者實機重跑對練確認麥克風權限視窗跳出。** 另記債：名牌職稱重複堆疊（mergeTitle 過度累加，如「Founder & CEO · Founder, Chairman, and CEO · CEO」）＋Google 登入 COOP postMessage 良性警告，後續處理。

## 2026-07-25（下午）登入改純 Google（web+admin）＋admin 後台首次上線

- **需求**：使用者「把帳號密碼的部分先移除，純用 Google 登入」。範圍＝web+admin（AskUserQuestion），深度＝**先只拔前端 UI**、後端 endpoint 暫留（mid-turn 補充「先把前端的帳密登入移除即可」）。決策見 ROM 2026-07-25 20:13。
- **調查**：自刻 Express 驗證（非 NextAuth）——帳密 `bcryptjs`＋自簽 JWT（`/api/auth/login`·`/register`），Google 走 `google-auth-library` 驗 ID token（`/api/auth/google`，`provisionUser` 靠 email find-or-create、`password_hash NOT NULL` 由 `unusablePasswordHash` 填→**移除帳密不需 migration**）。前端 Google 靠 GIS `<script>`，`NEXT_PUBLIC_GOOGLE_CLIENT_ID` build 期常數。
- **實作（派 opus coder，只動前端）**：`apps/web/components/auth/AuthForm.tsx`＋`apps/admin/src/app/login/page.tsx` 移除 Email/密碼/顯示名稱/組織名欄位、送出鈕、「用密碼登入」toggle、登入⇄註冊切換連結及相關 state/import（**不動 `lib/api.ts` 函式定義**，僅停止呼叫）；只留 GoogleSignInButton＋錯誤區；`googleOn=false` 時顯示「Google 登入尚未設定」提示（不再退回帳密、不留白）。admin 的 platformAdmin 健康探測＋非管理員清 token 邏輯完整保留。web login/register 兩 thin page 未改（自動變 Google-only）。
- **驗證**：coder 自檢＋**fresh-context agent 六項複驗全 PASS**（兩 app `tsc --noEmit` 皆 exit 0、grep `type="password"` 登入區零殘留、後端三 endpoint 與 api.ts 定義未動、admin 安全探測未弱化）。
- **部署（使用者核准 commit+部署）**：commit **`3c7e113`**（4 檔：2 code＋ROM＋CHANGE_TRACKER）。動 web+admin→**兩 service 都重建**（server 程式碼不動）。build web `9ca3f161`／admin `63375e06` 皆 SUCCESS → deploy **web `00027-tvb`**、**admin `00001-qf8`**。
- **⚠️ admin 首次上線**：admin 部署顯示「Deploying new service」＋rev **00001**——先前從沒真正上線過。使用者選「現在就把 admin 接好上線」→ server 用 `--update-env-vars` 補 `ADMIN_ORIGIN`＋`PLATFORM_ADMIN_EMAILS=martin99097@gmail.com`（→ **server rev `00026-xwl`**，其餘 20+ env 未吹、image 不動）。驗證 admin CORS preflight `/api/admin/health`→204＋ACAO=admin 網址。
- **冒煙全綠**：server health/ready 200；web `/`→307·`/zh-TW`→200·`/zh-TW/login`→200；admin `/`→200·`/login`→200。
- **仍待使用者一次性動作**：Google OAuth Console 把 admin 網址 `https://meetcopilot-admin-54139295474.asia-east1.run.app` 加進該 client「已授權 JavaScript 來源」（不可結尾 `/`、約 5 分鐘生效），否則 admin Google 登入 `origin_mismatch`。
- **狀態**：DEPLOY.md 版本節＋現況（live）已更新（加 admin service）。**docs 部署紀錄待 commit**；**尚未 push origin**。小債：兩個 `GoogleSignInButton.tsx` 註解仍寫「未設 env 退回帳密」已過時（純註解、無害），可日後清。

## 2026-07-28～30 session（新產品線：會中待講清單 ＋「會中進行」兩入口改造）

> ⏱️ 本節單一 session 但**跨三天實際時間**（2026-07-28 16:54 開工 → 07-30 收尾）：多輪對抗式 workflow 各耗 30 分鐘級，中途撞到週用量上限需等待。ROM 內 07-28 之後幾則的時間戳已依 workflow epoch 校正為 07-30（詳見 ROM「時間戳校正註」）。

- **使用者需求 1（新功能）**：「meet copilot 除了提供對方/我方公司內容，也應該像做 checklist 那樣讓報告者知道哪些已經講了哪些還沒。checklist 比較像是 AI 自行根據**會議內容與 PPT** 生成的，要先判斷哪些內容需要講會**有利於會議目標的達成**，然後生成 checklist，然後隨著會議內容與簡報內容**逐一劃掉**。」
- **兩路 Opus 偵察定位接點**（會中管線＋deck/播放進度），揪出三個硬障礙：
  1. **匯入的 pptx/pdf deck 在系統裡只有點陣圖、沒有文字**（`import/conversion-job.ts:40-50`，`extractSlideText` 對它回空字串）→ 只有站內 AI 生成的 deck 有可讀文字。舊的 pptx/pdf 文字解析器還在（`import/parse-worker.ts:24,28`）但無人呼叫。
  2. **`meetings` 表無 `deck_id` 無目標欄**，deck 綁定只活在記憶體 binding（`hub.ts:59`，`disposeSession` 就刪）→ 重啟即失聯；且主入口 cockpit 建會**只填一個標題**（`CopilotView.tsx:408`）。
  3. **「翻到第 N 頁」≠「講完第 N 頁」**，且 `committedIndex` 是高水位、往回翻 server 不知道。
  好消息：翻頁事件**早就在廣播**（`session_state.committedIndex`）只是 HUD 收到就丟掉；每 5 秒的分析 LLM 呼叫可直接擴 schema 做勾稽（零額外成本）。
- **使用者四項岔路全拍板**（AskUserQuestion，全選推薦項；ROM 2026-07-28 16:54）：清單**三類全包**（必講/必問/必回應，不只是簡報大綱）／匯入簡報走**解析器＋Gemini 讀圖 fallback**／會議目標**AI 先擬、可改**／**AI 自動劃＋可手動改**。
- **契約凍結**：`docs/MEETING_CHECKLIST_CONTRACT.md` v1.0（不變量落點、migration 023 雙份、repo 介面、shared 型別、wire 兩型別、生成端、三路勾稽、HUD 版面、建會表單、7 項最低測試、C2 範圍、明確不做清單）。分 **C1 核心閉環**（本輪）＋ **C2 匯入 deck 餵料**（migration 023 已預留 `deck_slides.text_extract`，C2 只改程式）。
- **三包實作（Opus，契約凍結後派工）**：
  1. **包 A 資料層**：migration 023 雙份（`meetings.deck_id`/`objective`、`deck_slides.text_extract`、新表 `meeting_checklist_items` 16 欄＋4 CHECK＋索引）、`packages/shared/src/checklist.ts`、protocol 兩 wire 型別、`ChecklistRepository`＋`SqliteChecklistRepository`（`markCovered` 只動 pending 且回「真的被改動的項目」＝天然冪等）、`CrmCore.checklist` 註冊。**crm 76 測全綠**（基準 70）、**SQLite 實跑 001→023 兩次證冪等**。
  2. **包 B server**：`generation/checklist-gen.ts`（responseSchema 強制、deadline 45s、MAX_TOKENS 砍半重試、sanitize 保三類覆蓋＋0 起連號 idx）＋`buildDeckOutline` 抽出（`reviseSlides` outline 輸出**逐字等價**，有回歸測試鎖定）＋`draft-objective` 端點＋建會落庫與**背景 fire-and-forget 生成**（絕不讓建會失敗）＋**對話勾稽併進既有分析呼叫**（schema 加 `coveredItemIds`、pending 空就不加 prompt 節、sanitize 丟幻覺 id、窗口/節流/單飛鎖一字未動）＋翻頁勾稽（停留 ≥20 秒才判 covered）＋`checklist_action` presenter 閘＋300ms debounce 的 **hud-only** 全量 snapshot 廣播。**server 55 檔 329 測全綠**（基準 53/306）。
  3. **包 C web**：`hud/ChecklistPanel.tsx`（收合態進度條＋下一個待辦／展開態三組／「正在講」標記）＋`HudView` **replace 型 reducer**（本檔唯一覆寫型，其餘 append/dedupe）＋建會表單綁 deck/company/objective（三欄**全可留空、全空時行為與改動前逐字相同**）。**tsc 0、build 18 路由、i18n parity 274/274**；實機證明**收合態 48.0px 且批准佇列留在首屏**、掐斷 `WebSocket.send` 後點 checkbox **不樂觀更新**（I2 真相來源＝server snapshot）。
- **包 B 自己抓到一個契約沒想到的隱私衝突**（已採納）：`evidence` 欄落庫逐字稿片段，在 `persistTranscript=false` 的 ephemeral 場次等於偷偷持久化 → 改為只取 `route.persist?.text`（已 redact 且該場已同意持久化的同一份文字），ephemeral 場次恆 `undefined`＝**零新增持久化面**。
- **使用者需求 2（同 session 續，附側欄截圖）**：「會中進行」兩入口 (1) 改名成**會議簡報**跟 **MeetCopilot**；(2) **點進去的 UI 互動要重新設計，太不直覺**；(3) 兩個都不要一點進去就另開新分頁，**僅 MeetCopilot 需要開新分頁、也不是立刻開**。
- **偵察證實「不直覺」是硬缺陷不是主觀感受**（ROM 2026-07-28 19:40）：側欄「簡報舞台」href 是**裸 `/present` 不帶 deckId**（`AppShell.tsx:128`）→ `PresentStage.tsx:62-66`→`:350-365` **必定**落在「沒有可播放的簡報」終態＝**這個入口 100% 是死路**，還先開一個新分頁才讓人撞牆；真正入口藏在 `/studio` 編輯器裡。另：present 全庫 **0 個 fullscreen 呼叫、0 個滑鼠可操作元素**；`/copilot` 新分頁內 **0 個回 App 連結**＝把人關在外面；「在另一台裝置看 HUD」的 **QR 是不能掃的裝飾**（註解自承）但文案叫人「掃描 QR」；同一功能有**三種叫法**（側欄／`present.title`／元件內硬編碼中文）。
- **改造實作（Opus）**：兩入口移除 `external`（↗／`target=_blank`／`nav.newTab` 隨之消失、active 高亮恢復）＋`HomeDashboard` 同款清單同步；**新 `/present/start` 準備頁**（掛 AppShell、列 deck、單機播放／連線會議播放、無 creds 時 live 鈕停用並指去 MeetCopilot、無 deck 時空狀態指 `/studio`、一律 `router.push` 不開新分頁）；**`/copilot` 掛 AppShell**（帳號 B 永不被分享故安全）而 **`/present`、`/hud` 維持不掛**（I3）；PresentStage 加 Fullscreen（rejection／不支援靜默降級）＋滑鼠翻頁＋鍵盤提示 5 秒淡出＋**死路出口改指 `/present/start`**；**移除誤導性假 QR**＋文案誠實化；三種叫法統一、硬編碼中文改走 i18n。**tsc 0、build 19 路由、parity 300/300、console 0 error、22 張截圖**、改名 grep 全庫乾淨。
  - **一處設計偏離經指揮官認可**：原規格「hover 才顯著」在 `position:fixed;inset:0` 滿版元素上恆為真（指標在視窗內即 hover）→ 改「指標一動就顯示、靜止 2.5 秒淡回 0.16」，對「這個分頁會被分享進 Meet」的場景更正確。
- **同分頁導覽的附帶好處**：瀏覽器上一頁本身就是離開路徑，這是原本「一律另開分頁」設計缺失的東西。
- **/code-review＋三輪對抗式修正（使用者指示「做完之後 /code-review + /simplify」）**：
  1. **審查**（13 agents：5 鏡頭→8 finding 各派反駁者）：raw 8→confirmed 1。**關鍵教訓 L20**：最重要的 slideIdx 座標系 bug 被**四個鏡頭獨立命中**（80/76/73/70）但只有一個過 80 門檻；第二條真問題（evidence TTL 缺口，58 分）是**從 killed 清單撈上來升級修的**——裁決要看 killed 中 `refuted:false`。
  2. **修正輪 1**（slideIdx 頁碼集合＋evidence TTL＋進度分母排除 skipped）→ 對抗復驗抓到**我的修法有洞**：`setStatus` 換來源不清 evidence＝繞過 purge 白名單條件，且**新測試正好把洞寫成回歸鎖定**（L19）；另抓 draft-objective 未顯式記帳（但 ROM 初版把它寫成「完全沒記帳」——實際 019 安全網有接住，**事實已更正**，L21）。
  3. **修正輪 2**（purge 改排除法＋setStatus 換來源清 evidence＋顯式 metered）→ 隱私 probe 獨立實測 PASS；記帳復驗再抓 4 條：**建會端點是最貴 LLM 端點卻無限流**、uncheck 會被分析窗殘留逐字打地鼠、清單生成漏 userId、同來源重勾重置 TTL 時鐘。
  4. **修正輪 3**（4 條全修，含契約 §7.5 新增 uncheck 冷卻期）→ 兩路復驗 PASS（限流用**真 server 打真 HTTP**＋突變測試）；殘留 1 條＝**我的契約漏寫時鐘域**（冷卻用牆鐘 vs 分析窗用音訊時鐘→撤回同意 2 分鐘就失效）→ 契約更正 **v1.2**（音訊時鐘＋fail-safe 掛帳）並修妥（突變驗證兩版都咬得住）。
- **/simplify**：四鏡頭 15 候選→**套 10 項行為不變**（isMaxTokensError 三份收斂進 gemini.ts、hub metered/wire 單一建構點、排序 comparator 收斂 shared、setStatus 死三元、全螢幕 prefix 收斂、死 CSS×4、replaceAll 回傳值省一次 SELECT、onPageCommitted 改直呼＋補測試替身、textExtract 入 DeckSlide 型別免 as-cast）／跳 3 項有理（不碰剛驗過的隱私 SQL 等）。**零測試斷言被動**。
- **最終回歸**：shared/crm build 0＋crm **80 測**、server tsc 0＋**60 檔 355 測**、web tsc 0＋build **19 路由**、i18n parity **301/301**。
- **commit＋push（使用者核准「好了就先 commit+推上去」）**：`a022c80` feat(checklist)（40 檔，+4515/−81）＋`a9243d5` feat(web) 兩入口改造（11 檔）＋docs 收尾 commit，push origin main。CHANGE_TRACKER 已歸檔 `change_archives/archive_2026-07-30.md`（43 筆 597 行）。
- **部署（另待核准，本輪未做）**：動了 shared/crm/server/web → **server＋web 都要重建**；**migration 023 開機自動套**；**部署前建議**：對 Cloud SQL 先跑 `TEST_DB_DRIVER=pg` 的 crm 測試（023 與 evidence purge 的 PG 方言未經真實 PG 實跑）＋部署首日看 log 有無 `[retention] purge failed`。
- **C2 待做（下一輪）**：匯入 pptx/pdf 抽文字進 `deck_slides.text_extract`（parser 重啟＋Gemini 讀圖 fallback，schema 已預留）——**在此之前匯入 deck 的 checklist 只有必問/必回應兩類**。
- **記債**：SQLite `tx()` 無互斥（生產 PG 不受影響，但 023 背景生成讓本機 dev 併發建會可觸發 tx-in-tx，ROM 07-30 13:42 決策 2）；MAX_TOKENS 分支已耗 token 不記帳（meter 系統性行為，另開一輪）；`setPendingChecklist`/`latestWindowT` optional（遷就測試替身）；真 QR encoder；deck 縮圖；`trust.ts:2` 舊名註解；`POST //api/meetings` 雙斜線回 HTML 404（純一致性瑕疵）。
- **C2（同 session 續，使用者一聲「C2」啟動）：匯入 deck 餵料——完成，未 commit 待核准**：
  1. **偵察→契約 v1.3 凍結**（MEETING_CHECKLIST_CONTRACT §11 六小節；ROM 15:40）：Gemini 讀圖能力已存在（`GenerateJsonOptions.images`）、兩解析器都逐頁、新匯入 PNG 在記憶體。**最高風險＝頁序對齊**：既有 parser 用 slideN.xml 檔名數字排序＝錯的權威（重排過的 pptx 文字靜默錯位→翻頁勾稽誤劃）→ 頁序權威改 `presentation.xml sldIdLst`＋數量守門，**對齊存疑整份丟、改走讀圖**（寧付成本不寫錯位文字）。讀圖硬上限 20 頁/並行 2/attempts 1、kind=`gemini_extract`（admin 標籤「匯入解析」名至實歸）＋匯入路徑補傳 userId。回填端點 `POST /api/decks/:id/extract-text`（fill-empty 冪等、無 job 列），前端唯一觸發＝建會表單選 deck 時 fire-and-forget（零新按鈕）。
  2. **實作＋雙路復驗**：契約六小節逐條 pass（含真 zip fixture 驗重排頁序）；對抗路 **10 個惡意 pptx fixture 零錯位寫入**、併發去重/計費/I1I3 鄰接/buffer detach 全實測乾淨。實作自主決策四項獲追認（getPageImage 帶 orgId、pdf.js pooled Buffer byteOffset 陷阱修在源頭、讀圖 temperature 0＋thinking 0、不 bump updated_at）。
  3. **對抗路抓到兩條契約漏洞（本 session 第四次；ROM 16:42）→ 契約 v1.4＋修妥**：(a) 「空字串不寫」讓讀圖確認無字的頁永遠 NULL → 圖片型 deck 每次選中重燒 20 次讀圖＋第 21 頁後永久飢餓 → **三態語意**（NULL=未抽、`''`=讀圖確認無字、非空=文字；parser 永不寫 `''`——`Math.max(1,minChars)` 門檻）；(b) `POST /api/decks/import` C2 後變 LLM 觸發端點卻不在限流桶（in-flight 以 deckId 為鍵、新 deck 永不命中去重）→ 入共用桶（429 早於 multer 收 50MB 檔）。復驗 probe 實測：5 頁純圖第二輪 **0 次呼叫**（收斂）、25 頁全空第二輪自動輪到 21–25（飢餓解除）、parser 空＋讀圖故障→下輪讀圖仍會跑（fallback 未自宮）。
  4. **最終數字**：crm **88 測**、server **61 檔 375 測**、web tsc 0＋build 19 路由；API_CONTRACT §4 已補新端點。**部署前注意不變**（PG 未實跑）。C2 之後匯入的 PPT 也有「必講重點」了；**既有匯入 deck 第一次在建會表單被選中時自動回填**。C2 經使用者「ok」核准：commit **`ea05daf`**（23 檔）push origin main。**部署仍未做**（GCP 還是舊版）。

## 2026-07-30（晚）全站前端重設計套用立項（claude.ai/design 交付＋新 slide 模板入會中生成）

- **使用者指示**：用 DesignSync MCP 讀入 claude.ai/design 專案「MeetCopilot 前端重设计」（使用者親自改過的前端＋新增 DynamicSlide 模板）；「逐一把新的前端套用上去，不必分新舊版，直接套用新的；並確認會中 AI 可自動套用新 slide 模板生成簡報」。/goal＝「全部前端都要套上，前後端都有接上，所有功能正常，前端沒有怪異的地方」。
- **設計交付物**：主稿 116KB＋dc-runtime，存 session scratchpad `design-handoff/`；Opus 盤點產出 `DESIGN_INVENTORY.md`（**實作唯一設計真相**）——11 畫面＋**17 個 slide 版式**（10 換皮／5 半新／**2 全新**：timeline-gantt 甘特時間表、comparison-matrix 競品比較表）；設計語言＝暖米白淺色預設＋暖灰黑深色（`data-theme` 雙主題、18 變數）、Space Grotesk＋IBM Plex Mono＋Noto Sans TC——與現行深色「會議控制室」全套替換。
- **盤點揪出的紅線（ROM 2026-07-30 21:17）**：設計稿建議卡**沒有補充頁批准入口＝I2 斷路**（停下來問，使用者拍板「**建議卡即批准卡**」：縮圖＋加入簡報／編輯後加入／跳過，EDIT 保留）；設計稿原型結構會把側欄帶進 `/present` 舞台（**照抄即違反 I3**，只取框內視覺）；consent 閘在設計稿消失（不可移除，新皮重做）；資料缺口 30+ 欄（使用者拍板「順帶補後端小端點」，真沒有的欄不渲染不留假數字）；設計稿純桌機（hud 手機可用性不得回退）。
- **契約凍結**：`docs/DESIGN_APPLY_CONTRACT.md` v1.0（四波分工＋檔案所有權鎖定＋不變量落點＋驗收底線）。模板系統擴充＝對「SlideSpec 契約不變」的**刻意解凍**（新 block table/timeline/steps＋擴充 stat.desc/bullets.marker/chart 多序列 donut＋SLIDE_TEMPLATES 加 2 值；supplement 生成 prompt 版型規則納新版式＝會中自動選用入口；pptx 匯不出的版式不得進 enum；舊 spec 渲染逐字等價回歸鎖定）。
- **執行結果（2026-07-31 全部完成，未 commit 待核准）**：
  1. **W1**（tokens/AppShell/9 畫面＋12 項未設計畫面重調）：淺色預設雙主題、字體 next/font；**自抓工具鏈全綠也測不到的真 bug**——next/font 變數掛 body、`:root` 引用 guaranteed-invalid → 全站掉回 Times New Roman（只有量 computed font-family 才抓得到）。
  2. **W2**（模板全鏈）：6→8 模板＋3 新 block（table/timeline/steps）＋17 版式（15 個不增 enum）；**supplement 會中選新模板＋事實紀律**（競品欄/數值只能引用逐字稿已現或已驗證資訊）；pptx 全映射；舊 spec A/B 逐字等價實證。
  3. **W2.5**（補驗 7 修）：/sim 接縫灰字、mute 對比裁決落實（card 基準 4.50）、雙序列圖例/pptx 對色、bullets 記號進匯出、pptx 預設淺紙（裁決：WYSIWYG 斷裂＞舊外觀凍結）＋連帶修 resolveTheme.muted、空殼守門、渲染防炸。
  4. **W3**（cockpit/hud/stage，中途撞限額斷點續作成功）：批准卡兩型（話術大字／補充頁縮圖＋編輯後加入）、consent 新皮不可繞、hud 430px、stage 零 chrome（light/dark 截圖位元組相同＝舞台不吃主題）；**對抗驗證 PASS**。
  5. **W4**（三修∥後端→接線→雙路總驗證 PASS）：chart 防炸補洞（React 惰性渲染逃出 try/catch）、話術卡按鈕誠實化；後端**首頁零新端點**（既有 API 自湊）、usage `budget` optional＋`by-meeting`（org-join 鎖）、train lastScore 非 N+1、team 動態**查證後不做**（activities 表恆空）；接線＝KPI 單支失敗只滅該格、預算條 env 未設整條消失、「會中成本」誠實文案。
  6. **code-review**（9 agents）：confirmed 1（83 分）＝**話術卡藏內文＝I2 知情批准回退**（isTalkTrack 把 heading+段落形狀歸話術、內文零渲染）→ 收緊為「整頁唯一文字＝卡上那行」才算話術，六形狀 DOM readback 全 PASS；killed 中 refuted:false 撈回 2 清理（L20 再次生效）。
  7. **/simplify**：16 候選→**12 套用**（含 SLIDE_DEFAULT_THEME 單一真相、稅率常數化、**設計真相檔複製進 repo `docs/design-handoff/`** 防 scratchpad 消失懸空）＋1 有理跳過；apply agent 收到壞插值時**正確拒跑**（指揮官腳本插值 bug，修後續跑）。
  8. **最終數字**：shared/crm build ✓、crm **88 測**、server **66 檔 456 測**、web tsc ✓＋build **19 路由**、parity **472/472**、零測試斷言被動。
- **本輪 ROM 共 7 則**（21:17 立項／08:30 W1W2＋四疑義／09:05 W2.5 清單／11:50 mute＋續作／13:05 W3 PASS＋三裁決／15:10 W4 PASS／16:00 review 裁決＋agent 現場裁決一則）；CHANGE_TRACKER 本輪 10+ 筆。
- **commit＋push＋部署（2026-07-31 使用者核准「commit + 推上去+部屬」）**：四邏輯 commit `f299ca5` feat(slides)＋`23f7071` feat(server)＋`bdaa4c4` feat(web)＋`8ce4c3c` docs，push origin main（`ea05daf..8ce4c3c`）。部署照 SOP A：build server `50eda524`／web `0284f1b1` 皆 SUCCESS → **server rev `00027-nkz`**（`services update --image` 保 env＋`--no-cpu-throttling`）＋**web rev `00028-qrl`**（`run deploy` 帶 NEXT_PUBLIC_API_BASE）。**migration 023 首次套上 Cloud SQL PG 成功**（`ready:true`＝boot+migrate 過，**PG 方言債關閉**）。冒煙全綠；開機 log 無 error。DEPLOY.md 版本節已更新（後續 docs commit `a6960e0` push）。**線上現為：待講清單全鏈＋C2 匯入抽字＋全站重設計＋新 slide 模板會中自動選用。**
- **記債（重設計輪）**：純話術建議（不 append 的 server 端新型別）；warn 琥珀 tag 族對比併日後 a11y 總議；spend/PersonaPicker 整檔 i18n 化；last-score 索引（org 報告破萬）；home.phase* 剩餘 6 鍵語意複查；殭屍行程（PID 33864/2020/8799）待使用者手動清。

## 2026-08-01 session（上線首日實測回饋：生成誤報安全限制＋Studio 編輯器三修＋review/simplify）

- **輪 1（使用者實測「介紹MeetCopilot給Troy」被拒「安全性限制」）**：prod log 實證真因＝**RECITATION 被誤標 SAFETY＋一律不可重試**（使用者 31 秒重按即成功＝根因佐證）。修＝RECITATION 可重試＋錯誤誠實分流＋非 STOP 印 token 四數；連帶挖出 MAX_TOKENS 退化迴圈（6 跑 3 失敗；**實測「加大上限無效只變貴」**）→ deck 生成/revise 開 resampleOnMaxTokens＋預算依頁數線性。修後 8 連跑 7 成功。
- **輪 2（使用者回報 Studio 三 UI 問題）**：共同根因＝`.mc-editor__grid` 沒設 rows（舞台高度隨右欄變→切頁跳 223px＋縮圖列不能捲）＋畫布背板寫死重設計前深藍 `#0a1120`（W1/W2 檔案接縫漏網）。修後切五頁 slide 頂邊全等、TABLE 表單 0/20 截字（−34.5% 高）、縮圖列獨立捲；`slide-legacy-lock` 20/20 綠。
- **/code-review（使用者指示）＋L20 第三度生效**：confirmed 0，但 killed 中**三鏡頭 refuted:false 交叉命中同一條**——RECITATION 升溫＋「改寫勿照抄」指示**無條件打進 CRM 抽取端**（任務恰是逐字取值）＝污染抽取忠實度。且出現新形態：**verifier 拿指揮官 ROM 當反駁證據**（17:15 裁決沒寫明只涵蓋 deck 脈絡）→ 決策紀錄必須寫明涵蓋範圍（入 ROM 17:54 方法論節）。
- **修（拆兩層）＋復驗 PASS**：RECITATION 全域維持可重試但預設**原溫原 prompt 純重抽**；升溫＋hint 改 `resampleOnRecitation` opt-in、僅 deck 生成/revise 兩處開。復驗關鍵證據＝**未開旗標呼叫端重試 config 與首次逐位元相同**（16 個 generateJson 呼叫端全清查）。
- **/simplify（使用者指示）**：9 候選去重 6 → 套 5 跳 1（跳＝mapGenerateError 換 helper 會把防禦性寬鬆 regex 收窄＝行為變更，正確拒套、記另輪）。
- **最終數字**：server **68 檔 475 測**、web tsc ✓＋build 19 路由、legacy-lock＋error-mapping 34/34。**未 commit 待核准**（server＋web 都要重建）。
- **記債**：~12% 生成殘留失敗率（治本＝W2 版型 prompt/schema 瘦身另輪）；重取樣失敗 attempt 不計費（併 07-30 既有 meter 系統債）；dev hydration 警告 5 筆（`suppressHydrationWarning` 候選）；4 欄比較表面板內橫捲（接受的取捨）；mapGenerateError 判定單一真相化（需補測另輪）。
