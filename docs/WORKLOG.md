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
