# CHANGE_TRACKER — 程式碼變更追蹤（強制）

> 制度源自 ezpagesite `CLAUDE.md` 的「Change Tracking — MANDATORY」（使用者 2026-07-07 指示移植，決策 17），v2 加上「工作區」欄位。
> **每個 session 都必須遵守，無例外。**

## 規則

1. **每次修改程式檔後**（Edit/Write 任何 `.ts`／`.tsx`／`.js`／`.mjs`／`.cjs`／`.css`／`.json`（含 package.json、tsconfig）等程式相關檔案），**必須立刻**在本檔追加一筆紀錄。
2. **不可延後、不可批次補寫**——改完一個檔案（或一組相關檔案）就寫一筆。
3. 每筆必含（模板見下）：`### YYYY-MM-DD HH:MM | 主題`（24 小時制、必含日期）＋**工作區**＋**類型**＋**檔案**＋**改了什麼**（關鍵邏輯附 Before/After）＋**為什麼**（根因或需求背景）。
4. **嚴禁用 Write 覆寫本檔**。安全寫入法：
   - 先 `Read(offset=1, limit=10)` 確認錨點存在；
   - 再用 Edit，`old_string` 用 `---` 加空行加 `<!-- TRACKER_BELOW -->`（**必須含 `---` 前綴**，否則會撞到本檔規則裡的範例文字），`new_string` ＝原字串＋新紀錄。
5. **超過 500 行自動打包**：把 `<!-- TRACKER_BELOW -->` 以下全部搬到 `docs/change_archives/archive_YYYY-MM-DD.md`，本檔清空只留標頭＋錨點，再插入新紀錄；並在下方 Archives 清單補連結。
6. **不需追蹤**：唯讀操作（Read/Grep/Glob）；修改本檔自身；`docs/*.md` 制度與計畫文件（由 WORKLOG 涵蓋）；臨時除錯檔。
7. **M0 建好 package.json 後**：加輕量 pre-commit hook——staged 有程式檔而本檔無同批新增紀錄 → 擋 commit（把 ezpagesite 純靠紀律的缺口關上）。

## 紀錄模板（照抄替換）

```
### YYYY-MM-DD HH:MM | 主題名稱
- **工作區**: packages/shared｜packages/crm｜apps/server｜apps/web｜tools
- **類型**: feat｜fix｜refactor｜chore
- **檔案**: `path/to/file.ts`, `path/to/other.ts`
- **改了什麼**: 具體改動；關鍵邏輯附 Before/After
- **為什麼**: 根因或需求背景
```

## Archives

（尚無）

---

<!-- TRACKER_BELOW -->

### 2026-07-08 09:40 | 訊號→CRM 批准回寫端點（M5 flywheel 收尾，關閉唯一 PARTIAL）
- **工作區**: apps/server＋packages/crm＋apps/web
- **類型**: feat
- **檔案**: 新 `apps/server/src/realtime/writeback-service.ts`＋`writeback.test.ts`；改 `packages/crm/src/ports.ts`(ByUser 加 optional sourceType/sourceDetail)＋`update-apply.ts`(§7 provenance)＋`realtime/meeting-store.ts`(findSignal)＋`meetings-routes.ts`(路由)＋`index.ts`＋`apps/web/lib/api.ts`＋`docs/API_CONTRACT.md §5`
- **改了什麼**: `POST /api/meetings/:meetingId/signals/:signalId/writeback {targetType,targetId,field,value}`——會後把批准的訊號寫回 contact/deal。array 欄 append、scalar set，欄位白名單（非清單 400）；signal 須屬該 meeting+org、target 同 org（否則 404）。provenance 走既有 update 路徑但覆寫 `source_type='meeting'`＋`source_detail=meetingId`＋`filled_by='human'`＋`verified=1`（CRM_SCHEMA §7）。ByUser 加**兩個 optional 欄**（向後相容：舊呼叫者 undefined→回退 'manual'，既有細填測試不變）。
- **為什麼**: M5 整合驗收唯一 PARTIAL（訊號 review-only、缺回寫端點）→ PRODUCT_SPEC 的「會後回寫 CRM」flywheel 現在接起來。typecheck 綠、writeback 3/3＋crm 43＋realtime 20 測試無回歸。**至此 M5 9/9、整個產品 M0–M5 完成。**

### 2026-07-08 09:00 | M5 整合／隱私／生產強化／邀請／部署產物（7 agent；指揮官代記）
- **工作區**: packages/shared＋packages/crm＋apps/server＋apps/web＋repo 根（部署）
- **類型**: feat
- **檔案**: crm `migrations/009_ops.sql`＋repos(usage/invites/members)；shared `ops-types.ts`/`redact.ts`；server `ops/`(meter/rate-limiter/pricing/log/health)＋`realtime/transcript-privacy.ts`/`transcript-retention.ts`＋`org-routes/`＋隱私 gate 改 hub/session-runtime/meeting-store／限流+log+安全標頭+優雅關機 in index.ts／刪孤兒 ws.ts；web `next.config.mjs`(CSP)＋`/settings/team`；根 `Dockerfile.server`/`Dockerfile.web`/`docker-compose.yml`/`Caddyfile`/`.env.production.example`/`scripts/backup.sh`＋`docs/DEPLOY.md`
- **改了什麼**: (A 隱私) 同意閘（未同意不分析/不落）、逐字稿預設記憶體即棄（persist=0 不寫 DB）、PII 遮蔽（送 LLM＋落 DB 前，實測 `請聯絡我 *** 或電話 ***`）、TTL purge、CSP。(B 成本) usage_events 冪等＋meter 包裝＋/api/usage rollup。(C 強化) 限流 429、結構化 log（0 洩漏）、/ready、安全標頭、優雅關機、刪死碼。(D 邀請) invites/members 路由＋last-owner guard＋/settings/team。(E 部署) Docker/compose/Caddy/DEPLOY runbook（不跑 gcloud）。
- **為什麼**: M5 里程碑。全鏈路整合驗收 8/9 PASS（typecheck 綠、crm 43/43＋server 29/29 測試、next build 13 路由）。1 PARTIAL：訊號→CRM 批准回寫端點未做（見下筆補）。詳見 ROM 2026-07-08 09:05。

### 2026-07-08 06:00 | /code-review 修 7 個確認 findings（含 1 critical 跨租戶）
- **工作區**: apps/server＋apps/web
- **類型**: fix
- **檔案**: `apps/server/src/realtime/hub.ts`＋`realtime/hub-endmeeting-authz.test.ts`(新)、`research/crawler.ts`＋`research/crawler-ssrf.test.ts`(新)、`train/routes.ts`、`index.ts`；`apps/web/lib/train/liveClient.ts`、`components/present/PresentStage.tsx`、`components/train/TrainCall.tsx`、`components/studio/DeckWizard.tsx`
- **改了什麼**:
  - **F1 critical**：hub.endMeeting 破壞動作（disposeSession+關 socket）改成**擁有權 `ok` 通過才執行**（否則 org A 知道 meetingId 就能掐斷 org B 會議）。加跨租戶回歸測試（無防護則失敗、有則過）。
  - F2：liveClient 重連失敗時重設 `reconnecting`＋指數退避重排（原本一次失敗就卡死 60 分）。
  - F3：PresentStage 接真 ws open/close callback＋重連時 re-fetch deck＋狀態燈反映真連線（原註解騙人、斷線漏 append）。
  - **F4 SSRF＋回歸修正**：Chromium `--host-resolver-rules=MAP host ip` pin 目標 host（關 DNS-rebinding TOCTOU）；**曾加 `MAP * ~NOTFOUND` fail-close 但實測弄壞 www→apex 跨 host 重導（ghost.org 掛）→ 改回只 pin 目標**，其餘 host 由 context.route 逐請求擋私網。CyberPower＋Ghost 重跑皆 done、SSRF 仍擋內網。
  - F5：train routes 的 sendTrainError 不再 re-throw（Express4 async 拋錯會 hang）→ 未知錯一律回 500 {error}。
  - F6：TrainCall 計時改 Date.now()-startedAt（原 state-keyed interval 漏 tick）。
  - F7：/decks/generate JSON 上限 25mb（其餘維持 2mb）＋wizard 圖片 canvas 縮圖(≤1280px)＋參考圖上限 4（原真實照片會 413）。
- **為什麼**: 多鏡頭對抗式 /code-review（12 raw→對抗 verify→7 confirmed）。typecheck 綠、server vitest 15 過（含 F1+F4 新測試）、crm 31、crawler-ssrf 5/5。SSRF fail-closed 回歸經真站重驗抓到並修正（見 L16）。

### 2026-07-08 03:30 | M2 DynamicSlide＋M3 會中副駕＋M4 語音模擬（三線並行，11 agent；指揮官代記）
- **工作區**: packages/shared＋packages/crm＋apps/server＋apps/web
- **類型**: feat
- **檔案**: shared `deck.ts`/`train.ts`/`protocol.ts`（Suggestion）；crm `migrations/007_decks.sql`/`008_training.sql`＋`repos-decks.ts`/`repos-training.ts`＋ports/core；server `generation/`＋`decks/`＋`decks-routes/`（M2）、`realtime/`＋`asr/`＋`analysis/`＋`meetings-routes`（M3）、`train/`（M4）；web `studio`/`present`/`copilot`/`hud`/`train` 路由＋`components/{studio,present,copilot,hud,train}`＋`lib/{api,ws,train/liveClient}`
- **改了什麼**: 三產品線。M2＝deck 生成（借 v1 生成器+QA，分析用 3.5-flash）+append-only 改造引擎（I1）+生圖 job（gpt-image-2 pre-meeting+refused fallback）+pptx 匯出+/studio wizard+/present 零 HUD 舞台（I3）。M3＝WS 三角色（capture/hud/present，音訊 binary）+SessionRuntime（含清理）+ASR/分析/檢索白名單/patch-service（I2 presenter-only+I1 append）+/copilot 擷取端（zero-track 守衛）+/hud 第二裝置。M4＝Gemini Live ephemeral token 直連（persona 逐欄過 verified 閘）+課後四維評分+/train 語音對練（有界 socket）。
- **為什麼**: M2/M3/M4 里程碑。三線 fresh-context 驗收**全 PASS**（M2 live 測生成+pptx+生圖；M3 9/9 含 presenter 攻擊測+I1/I3;M4 真 token mint+per-field 閘+評分）。詳見 ROM 2026-07-08 03:35。

### 2026-07-08 01:30 | 修爬蟲抽取品質＋去重＋抽取模型升級（S4 關閉）
- **工作區**: apps/server＋packages/crm
- **類型**: fix
- **檔案**: `apps/server/src/research/{extractor,orchestrator}.ts`、`apps/server/src/{gemini,config}.ts`、`packages/crm/src/{ports,repos-prospect}.ts`、`.env.example`
- **改了什麼**: (1) **去重**：`upsertFromCrawl` 加 `CrawlUpsertOptions{targetId?}`，repo 改「先按 id 解析→domain fallback（domain 空則跳過）→insert」＋回填 target 的 domain（防 UNIQUE 撞）；orchestrator 傳 targetId。(2) **抽取品質**：extractor prompt 指令化（hero/feature 文案即 description、tagline 只放短標語、語言忠實 zh-TW）、schema 移除 websiteUrl/domain（爬蟲自己有）、`required:[name,description,industry]` 逼填、`cleanUrl()` 去尾標點（修逗號）。(3) **模型**：新增 `GEMINI_EXTRACT_MODEL`（預設 `gemini-3.5-flash`）只給抽取用；gemini.ts 加 `maxOutputTokens` 上限（runaway fail-fast）＋`stripJsonFences`。
- **為什麼**: B5/DB 揪出「爬完只填 name+websiteUrl、還重複建公司」。根因＝flash-lite 對此抽取不穩（JSON 坍縮/runaway/偷懶，見 L15），非爬文字或 prompt 問題。**重驗 CyberPower 台灣站（zh-TW）：一筆公司（domain 回填 cyberpower.com）、8 欄 crawler 值（industry「不斷電系統與電源管理」/description/legalName 碩天科技）＋5 產品，繁中乾淨無幻覺**。typecheck 綠、crm 23/23（加 targetId 去重回歸測試）。

### 2026-07-07 23:35 | M1 CRM 核心＋研究引擎＋CRM 成品前端（工作流 6 agent；指揮官代記一組）
- **工作區**: packages/shared＋packages/crm＋apps/server＋apps/web
- **類型**: feat
- **檔案**: `packages/shared/src/crm-types.ts`（全 domain 實體＋輸入型別）；`packages/crm/src/{ports,core,mappers,provenance-write,update-apply,child-upsert,repos-prospect,repos-pipeline,repos-retrieval}.ts`＋`migrations/002-006*.sql`＋`tsconfig.build.json`＋測試；`apps/server/src/crm-routes/*`（8 檔）＋`research/*`（7 檔：extract SSRF/crawler Playwright/extractor/grounding/jobs/routes）＋auth shim 移除；`apps/web` `/crm`＋`/crm/[id]`＋`(auth)` 登入註冊＋`components/crm/*`（11 tsx）＋lib/api CRM client
- **改了什麼**: M1 全量。CRM 15+ 表（含對方產品深檔）＋11 repository（org-scoped、upsertFromCrawl 值+provenance 同 tx、cosine 白名單檢索、細填/確認 provenance 語意）；研究引擎（SSRF-safe 抽取＋Playwright 渲染爬蟲＋Gemini 結構化抽取＋grounding＋crawl_job 編排）；CRM 成品前端（清單/詳情八 tabs/provenance 徽章+確認+細填/persona 卡/enrich 進度/登入）。crm build 拆 typecheck/emit 兩 tsconfig。
- **為什麼**: M1 里程碑。B5 fresh-context 驗收 6/7 PASS（詳見 ROM 2026-07-07 23:30）；1 項 crawler 懸掛已修（見下筆）。

### 2026-07-07 23:55 | 修 crawler browser.close() 懸掛＋有界 teardown
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/research/crawler.ts`
- **改了什麼**: 改 `chromium.launchServer()`+`connect()`（`Browser` 無 public `process()`，`BrowserServer` 才有可強殺 handle）。teardown：`browser.close()` race 5s → `server.kill()` 強殺底層 Chromium；`crawl()` 整場包 deadline race（quick 45s／detailed 90s）throw 明確錯。**保證 crawl() 一定 settle、永不 hang**。deals `?companyId=` 確認早已支援（route+DealFilter+repo），未改。
- **為什麼**: B5 揪出 `browser.close()` 此機永久卡→enrich job 卡 `running`（L13）；外部子進程關閉必須有逾時+強殺兜底。typecheck 全綠。

### 2026-07-07 21:40 | M0 地基全量落地（工作流 5 agent；指揮官代記一組）
- **工作區**: repo 根＋packages/shared＋packages/crm＋apps/server＋apps/web
- **類型**: feat
- **檔案**: 根 `package.json`/`tsconfig.base.json`/`.env.example`/`.gitignore`（補 `*.db-wal`/`*.db-shm`）；`packages/shared/src/{slide-spec,protocol,signals,crm-types,trust,index}.ts`；`packages/crm/src/{ports,sqlite-db,migrate,repos,core,uuid,index}.ts`＋`migrations/001_tenancy.sql`＋`test/crm-core.test.ts`；`apps/server/src/{config,crm,index,gemini,ws}.ts`＋`auth/{jwt,routes,index}.ts`＋`providers/image.ts`＋`scripts/smoke-auth.mjs`＋jwt 測試；`apps/web` Next15+next-intl 骨架（六路由佔位、lib/{api,ws}.ts、messages）
- **改了什麼**: monorepo 骨架＋凍結契約實作。關鍵設計：slide-spec 的 PatchOp 改 **append-only**（`APPEND`/`REORDER`，`patchMinIndex(op, deckLength)` 簽名變更）；DbPort async-first、tx 用手動 `BEGIN IMMEDIATE`（不用 better-sqlite3 的 sync transaction）；auth 全流程過 crm repos（僅 login 的 findPrimaryMembership 留一處明標 direct-SQL shim，M1 升級 ports 後移除）；ws 只掛 hello/ping（M3 補全）；OpenAIImageProvider 編譯就緒未掛路由（M2）。
- **為什麼**: M0 里程碑（ARCHITECTURE_PLAN §6）。A5 fresh-context 驗收 6/6 PASS（typecheck 全綠、crm 7/7 測試、真 server 冒煙含跨 org 隔離與 dup-409、JWT fail-fast exit 1、契約零漂移、/present 無副駕詞彙）。

### 2026-07-07 17:20 | capture-test 加 Brave 偵測
- **工作區**: tools
- **類型**: fix
- **檔案**: `tools/capture-test.html`
- **改了什麼**: `runEnvCheck()` 在 UA 嗅探後加 `navigator.brave.isBrave()`（async）判別——Brave 時把瀏覽器標記更正為「Brave x.y（Chromium，UA 顯示 Chrome）」並更新畫面/JSON/日誌。Before：UA 嗅探把 Brave 誤判成 Chrome。After：矩陣記到真實瀏覽器。改後重抽 `<script>` 跑 `node --check` PASS。
- **為什麼**: 使用者第一筆實測（2026-07-07，9 項全 PASS）實際用的是 Brave，但工具記成 Chrome 150——Brave 的 UA 偽裝成 Chrome，會讓相容性矩陣把 Brave 的結果誤記到 Chrome 帳上。
