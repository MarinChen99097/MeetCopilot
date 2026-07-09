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

### 2026-07-08 23:20 | P2/P3 部署前審查修正（3 項）
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `src/gemini.ts`, `src/decks-routes/index.ts`, `src/asr/gemini-asr.ts`
- **改了什麼**:
  - **gemini.ts `normalizeCallError`**: abort/逾時分支原地改寫 `e.message`——但真實 client timeout 的 caught error 是 `DOMException{name:"AbortError", message:"This operation was aborted"}`、其 `.message` 是唯讀 getter，賦值丟 TypeError → 吞掉 `retryable=false` → withRetry 不短路、白跑第二次 ~120s（共 ~240s）且逾時被誤標一般錯誤。改：回傳**全新可寫 Error**帶 `retryable=false`（保留逾時 token）；abort 偵測靠既有 `isAbortOrTimeout`（比對 `err.name`）。
  - **decks-routes/index.ts**: catch-all `/MAX_TOKENS|finishReason/i` 會把 `finishReason=OTHER`/`MALFORMED_FUNCTION_CALL` 誤標「輸出過長」；收窄成 `/MAX_TOKENS/i`，殘餘 `/finishReason/i` 另給中性 422「生成未正常結束，請調整輸入後再試」；429、SAFETY/RECITATION 順序不變。
  - **asr/gemini-asr.ts**: 併發 fire-and-forget transcribe 共用單一 `unavailableSignaled` 旗標，恢復後 straggler 失敗會重放 `asr_unavailable`（presenter HUD 雜訊）。加單調序號 `dispatchSeq`/`lastSuccessSeq`，失敗只在 `seq > lastSuccessSeq && !unavailableSignaled` 才 signal → 過期 straggler 不重放；空白音訊仍不報。
- **為什麼**: 部署前用內建多 agent 對抗式審查（0 critical／1 warning／2 info、4 駁回）抓到——warning 的 gemini 逾時路徑崩是 P2 引入的真 bug（會讓逾時變 240s＋誤標）。typecheck 4ws 綠、server 36/36＋CRM 43/43 綠、fresh-context read-back（含 DOMException 實測）PASS。

### 2026-07-08 22:40 | extract-url 加固後續 P2/P3：gemini 韌性＋pptx 串流/worker 隔離＋ASR asr_unavailable＋webp 匯出排除
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `src/gemini.ts`, `src/import/pptx-parser.ts`, `src/import/run-in-worker.ts`(新), `src/import/parse-worker.ts`(新), `src/asr/gemini-asr.ts`, `src/realtime/hub.ts`, `src/generation/pptx-render.ts`, `src/decks-routes/index.ts`
- **改了什麼**:
  - **P2 gemini（gemini.ts）**: generateContent 加 per-call 逾時（client 預設 30s、generateJson 120s——非串流大簡報可能 >30s）；generateJson 偵測 finishReason≠STOP → 丟含「finishReason=<REASON>」的可行動 zh-TW 錯誤＋設 `err.retryable=false`；withRetry 加退避（衍生 jitter、非 Math.random）＋honor Retry-After（數值＋message 內 `retryDelay:"Ns"` 字串）＋`retryable===false` 立即短路。ASR 不走此共用 client（v2 ASR 自有 GoogleGenAI）；maxOutputTokens 已存在未重加。
  - **P3 pptx 串流上限（pptx-parser.ts）**: 原 post-decompress 檢查（`MAX_IMAGE_BASE64_CHARS`，可被謊報宣告大小繞過）→ 改 `entry.nodeStream()` 邊解壓邊累計位元組、超標即 destroy+reject；圖片與 slide-XML 路徑都走；加投影片數上限。周邊 entry（rels/theme/layout）超標由既有 try/catch 吞（graceful，記憶體仍因 stream destroy 有界）。
  - **P3 worker 隔離（run-in-worker.ts＋parse-worker.ts 新）**: `runInWorker<T>(task,buf,timeoutMs)` 把 parse 丟進可 terminate 的 worker_thread，逾時 `worker.terminate()`+reject「匯入解析逾時」。載入用 `__filename` 副檔名判斷＋workerData 傳 ext＋**dynamic import 帶副檔名**（Node 22.18 原生 strip-types 會頂掉 worker 內 tsx、靜態 import 會 ERR_MODULE_NOT_FOUND）。dev(tsx)＋prod(dist node) 兩模式實測 parse 正確＋1ms 逾時真 terminate。
  - **P3 ASR（asr/gemini-asr.ts＋realtime/hub.ts）**: 真失敗 vs 靜音區分；真失敗經 hub 廣播既有 ServerMessage error（code `asr_unavailable`）一次（per-provider 去重旗標、instance-per-session＝等同 per-runtime，成功即清）；空白音訊仍不廣播。I3 保留（只傳可用性通知、無內容、presenter-private）。
  - **P3 webp（generation/pptx-render.ts）**: 匯出 addImage 三個 sink（safeImage、cover renderImageFull、addLogo 經 resolveLogo）排除 `image/webp`；**shared `isRasterImageDataUri` 不動**（畫面預覽仍可顯示 webp）——舊版 PowerPoint 無法渲染 webp。
  - **P2/P3 decks（decks-routes/index.ts）**: /decks/generate catch 依 `err.status`/訊息映射（429/quota→429、SAFETY/RECITATION→422、MAX_TOKENS/finishReason→422、其餘 502 不外洩 raw、一律 server-side `console.error`）；/decks/import、/extract-pdf 改走 `runInWorker`，逾時→408，保留掃描/空白→422；GenerationEmptyError→422。
- **為什麼**: extract-url（P1）上線後續，把 v1 稽核＋審查在 v2 也複發的同類問題補上（P2 LLM 韌性、P3 上傳 DoS／ASR 觀測性／webp 相容）。使用者「1 3修一修」。全 workspace typecheck 綠；server 36/36＋CRM 43/43 測試全 pass；逐 cluster fresh-context read-back PASS。I1/I2/I3 未削弱、SSRF 未動。凍結契約平行派工（v2 rule 6）。

### 2026-07-08 21:52 | 從網址匯入：瀏覽器 UA 修 429 ＋ 非 UTF-8 頁面編碼修亂碼（移植 v1 6 項）
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `src/import/extract.ts`
- **改了什麼**: 把 v1 已加固的 6 項移植進 v2 的 `extractFromUrl`/`extractFromPdf`（v2 較強的 SSRF/DNS-pin 區塊逐字保留，未回退）：
  1. **瀏覽器 UA（headline 429 修）**: `safeFetch` 標頭 Before＝bot UA `MeetCopilot/0.1 (research-import)`＋`accept:text/html,application/xhtml+xml` → After＝新增常數 `BROWSER_HEADERS`（extract.ts:34，真實桌面 Chrome UA＋完整 accept＋`accept-language: zh-TW,zh;q=0.9,en;q=0.8`），`safeFetch` 改 `headers: BROWSER_HEADERS`（extract.ts:137）。實站對 bot UA 直接回 429。
  2. **編碼感知解碼（修 Big5/GBK 亂碼）**: 新增 `resolveCharset()`（extract.ts:151，Content-Type charset → 前 2KB 嗅探 `<meta charset>` → 預設 utf-8）＋`decodeBody()`（extract.ts:163，`new TextDecoder(label)`，未知/錯誤退回 utf-8）。`extractFromUrl` body 讀取 Before＝`Buffer.concat(chunks).toString("utf8")` → After＝先讀成 `Buffer` 再 `decodeBody(buf, ctype)`（extract.ts:285）；`!reader` 分支改 `res.arrayBuffer()`（原為 `res.text()`）。
  3. **十六進位實體＋防崩**: `decodeEntities` 新增 `&#x[hex];` 處理，並把 `String.fromCodePoint(Number(n))` 換成 `codePoint()` 守衛（extract.ts:191，非有限/<0/>0x10FFFF 回 ""），越界實體不再丟 RangeError 崩掉整頁抽取。
  4. **429/503 有界重試**: `extractFromUrl` 對 429/503 做 1 次有界重試（`RETRY_STATUSES`/`MAX_FETCH_ATTEMPTS=2`/`MAX_RETRY_WAIT_MS=2500`），尊重 `Retry-After`（秒數＋HTTP-date 兩式、上限 ~2.5s）；sleep 可被既有 `AbortController` 中止、abort 即 break；重試走 `safeFetch` 讓 SSRF 逐跳重驗（extract.ts:218-247）；仍 429/503 丟 zh-TW「暫時限流」。
  5. **DNS lookup 逾時**: 新增 `lookupAll()`（extract.ts:76，`dns.lookup` 對 `DNS_TIMEOUT_MS≈5s` race），在 `resolveAndValidate` 內把 `dns.lookup(...)` 換成 `lookupAll(...)`（extract.ts:94）——**只在 lookup 呼叫內加 race，未動 `resolveAndValidate`/`isPrivateIp` 匯出簽章**（crawler.ts 共用）。黑洞 nameserver 不再拖過 10s 總預算。
  6. **PDF 頁數上限**: `extractFromPdf` Before＝`pdfParse(buffer)` → After＝`pdfParse(buffer, { max: 50 })`（extract.ts:294）。
- **為什麼**: 使用者面向的「從網址匯入」（POST /api/extract-url）送 bot UA 被實站回 429、且對非 UTF-8（Big5/GBK/Shift-JIS）頁面硬解 utf8 變亂碼。移植 v1 `apps/server/src/import/extract.ts` 的已加固版。**SSRF / DNS-pin 區塊（isPrivateIp、resolveAndValidate 的公網/雲端 metadata 檢查、pinnedAgent IP-pin、逐跳重驗、error 路徑 body cancel）逐字保留未改**；v2 特有的 `finalUrl` 亦保留。typecheck `tsc -p tsconfig.json --noEmit` 綠。真網重現：`http://www.zol.com.cn/`（charset=gbk）標題「中关村在线 - 大中华区专业IT网站…」正確中文、**無 U+FFFD**；`https://example.com/`（utf-8）標題「Example Domain」無回退。I1/I2/I3 未觸及。

### 2026-07-08 21:00 | 研究面板一律全網深度（移除輕量/會前建檔選項）＋修 job 卡片誤標「輕量研究」
- **工作區**: apps/web
- **類型**: fix/ux
- **檔案**: `crm/EnrichPanel.tsx`（移除 quick/detailed/deep 模式選單，mode 固定 'deep'；URL 欄永遠顯示為可選起點；加 mc-enrich__lead 說明）＋`ui/JobProgressCard.tsx`（MODE_LABEL map：deep→「全網深度研究」/detailed→「會前建檔」/quick→「輕量研究」，修掉原本 `mode==='detailed'?'會前建檔':'輕量研究'` 二分法把 deep 誤標成輕量；進度文字 deep 改「正在全網研究…」）＋`globals.css`（.mc-enrich__lead）
- **改了什麼**: (1) 修顯示 bug——JobProgressCard 用二分法判斷模式，deep 落入 else 被標成「輕量研究」、進度文字硬寫「爬取官網」；改為 mode-aware 正確顯示。(2) 依使用者要求移除模式選擇，手動「研究此公司」一律跑最重的全網深度研究（deep），只留可選 URL 起點。
- **為什麼**: 使用者選深度卻顯示「輕量研究」，且「不需要有輕度研究，一律都是最重的」。註：會中副駕的 auto-research 仍用 quick（現場需快，屬不同情境，未動）。typecheck 4ws 綠。I1/I2/I3 未觸及。

### 2026-07-08 20:30 | 研究：無 URL→以公司名稱做全網深度研究 ＋ job 逾時保護（不再永遠「研究中」）
- **工作區**: apps/server＋apps/web
- **類型**: fix
- **檔案**: server `research/orchestrator.ts`（createJob company 無 url 不再 throw、改帶 companyName；runJob 分派 nameBased=(company&&!url)→useDeep；runDeep url 改 optional、無 url 跳過官網 crawl 只跑 DeepResearcher by name；新增 withTimeout()＋jobTimeoutMs() env RESEARCH_JOB_TIMEOUT_MS 預設 360s）＋`research/routes.ts`（created.url optional、傳 companyName）；web `crm/EnrichPanel.tsx`＋`globals.css`（URL 欄提示「留空則以公司名稱做全網深度研究（不需官網）」）
- **改了什麼**: (1) 修邏輯 bug——原 orchestrator:196 對**所有模式含 deep** 硬要 URL，導致沒官網的公司留空 URL 就無法研究；現改為 company 無可爬 url 時**一律以公司名稱走全網 grounding 深度研究**（DeepResearcher 本就以 name 為種子、不需 url）。(2) 修掛死——整個 job 包 Promise.race 硬逾時，卡住會 markFailed 記「研究逾時」，不再永遠「研究中」。
- **為什麼**: 使用者反映「研究此公司」對無官網公司（CyP）留空 URL 跑很久沒結果——「URL 說可選，那好歹要藉由公司名稱去做深度研究才對」。有 url 的三條原路徑行為不變。typecheck 4ws 綠／server 36/36／CRM 43/43。I1/I2/I3 未觸及。

### 2026-07-08 19:30 | CRM 原文＋zh-TW 簡介並排 ＋ 技術棧/部門擷取寫入（補孤兒表）
- **工作區**: packages/shared＋packages/crm＋apps/server＋apps/web
- **類型**: feat
- **檔案**: crm `migrations/011_i18n_children.sql`＋`migrations-pg/011`（company_news+title_zh/summary_zh、company_products+one_liner_zh/description_zh、companies+description_zh、contacts+title_zh/background_summary_zh）＋`mappers.ts`（6 新欄 FieldDef，讀寫雙向）；shared crm-types（CompanyNews/CompanyProduct/Company/Contact 加 *Zh；CrawlPayload 加 techStack/departments，型別 NewCompanyTech[]/NewCompanyDepartment[]）；server `research/extractor.ts`＋`deep-extractor.ts`（schema 加 descriptionZh/techStack/departments/*Zh，SYSTEM 改雙語規則：原文逐字＋*Zh 產 zh-TW 簡介 ≤2 句，techStack/departments 直接 zh-TW、專有名保留；MAX_TECH=12/MAX_DEPARTMENTS=10）＋`orchestrator.ts`（runStandard/runDeep 落庫後呼叫 bulkUpsertTech/bulkUpsertDepartments，接上孤兒表）；web `ChildTabs.tsx`（NewsTab 原文+🌐中文簡介）＋`ProductsTab.tsx`（product description/oneLiner 中文簡介）＋`CompanyDetailView.tsx`（OverviewTab descriptionZh）＋`globals.css`（.mc-i18n-sum 等）；test `crm-core.test.ts`（idempotency 斷言改連續 1..N 不硬編碼）
- **改了什麼**: 三件——(1) 對方情報顯示「原文＋zh-TW 簡介」並排（locale===zh-TW 且 *Zh 有值時顯示中文簡介框）；(2) 擷取器產出並在地化（不再只逐字英文）；(3) 技術棧 company_tech／部門 company_departments 兩張「有表有 repo 有讀路由有 UI、卻從無寫入」的孤兒表——補上擷取 schema＋orchestrator bulkUpsert 寫入路徑。
- **為什麼**: 使用者反映「表現形式應該原文+i18n 簡介、爬出來全英文沒翻、技術棧與部門沒爬出來」。範圍＝只影響新研究結果（重跑「研究此公司」即現）；不回填既有資料。typecheck 4 workspace 綠/server 36/36/CRM 43/43。I1/I2/I3 未觸及（只動 CRM 資料/擷取/顯示）。

### 2026-07-08 18:00 | 全網深度研究 enrich 模式（deep）— 不鎖公司網域、多來源、標真出處
- **工作區**: packages/shared＋packages/crm＋apps/server＋apps/web
- **類型**: feat
- **檔案**: shared crm-types（CrawlMode 加 'deep'、ProvenanceInput.sourceType）；crm `migrations/010_deep_mode.sql`＋`migrations-pg/010`（crawl_jobs.mode CHECK 加 deep）＋`repos-prospect.ts`（provenance 帶外部 sourceType）；server 新 `research/deep-research.ts`（DeepResearcher：6-9 組雙語 grounding 查詢+排序引用+深讀 top6 外部來源，跳過公司網域，SSRF-safe）＋`research/deep-extractor.ts`（逐事實 [S#] 來源標記→provenance source_url）＋`import/extract.ts`（回 finalUrl 解 redirect 到真發布者）＋`orchestrator.ts`（deep：DeepResearcher∥網站爬蟲→news/funding/people/competitors 寫入）＋routes（MODES 加 deep）；web EnrichPanel 第三選項「深度（全網研究）」
- **改了什麼**: enrich 從「只爬公司網站」→ 新增 **deep 模式：全網研究**。以公司名/網址為起點，Gemini Google Search 多角度查（概況/新聞/募資/主管/競爭對手/產品，中英雙語）→深讀新聞/維基等外部來源→綜合填 CRM，**每欄 provenance.source_url 指向真實外部網址**（FT/Wikipedia/cnyes…非公司網域）。有界（DEEP_RESEARCH_BUDGET_MS 150s∥網站爬 ≤5min）、不幻想、成本記帳。
- **為什麼**: 使用者要「不被鎖死在公司網址、要能去報導/wiki 等全網找」。**碩天科技實測：從 FT/Wikipedia/cnyes/digitimes/businesswire 撈到 11 概況+5 新聞+6 主管+10 競爭對手，附真實出處**。誠實：共用品牌名跨實體消歧不完美（CyberPower TW vs 美國 PC）。typecheck 綠/server 36/36/CRM 43/43/SSRF 仍擋內網。

### 2026-07-08 16:30 | 深度爬取大幅強化（2 層 BFS+平行+雙語評分+單產品抽取，5 分內）
- **工作區**: apps/server
- **類型**: feat
- **檔案**: `research/crawler.ts`（BFS+平行 pool+雙語評分+normalizeUrl+env MAX_CRAWL_PAGES/CRAWL_CONCURRENCY+softDeadline）、`research/extractor.ts`（per-product schema+多頁聚合+temp 0.3）、`gemini.ts`（temperature 傳遞）、`.env.example`
- **改了什麼**: detailed 從「1 層/5 頁/循序/英文評分」→ **2 層 BFS＋有界平行（CRAWL_CONCURRENCY 預設 5）＋雙語連結評分（中英，看 pathname+連結文字）＋逐產品抽取**。總頁數 MAX_CRAWL_PAGES 預設 28（clamp 2-40）；softDeadline=硬 deadline-15s（回 partial+teardown 在 5 分硬上限前收尾）；normalizeUrl 去重（#/追蹤參數/尾斜線+redirect final）。extractor 聚合多頁（標來源 URL、每頁 6k、總 180k）逐產品填 category/pricing/specs/targetMarket/keyFeatures。
- **為什麼**: 使用者反映爬取效果要加強、要像 EZpage 點連結往下追。**CyberPower 實測：6 產品全空→33-35 產品/100% 有類別，28 頁 2 層 ~80s（遠低於 5 分）**。誠實：定價/功能多空是真的（B2B 硬體不公開、不幻想）、規格量跑動（JS 比較表）。typecheck 綠、ssrf 5/5、server 36/36、fresh-context 審查 PASS（SSRF/SIGKILL/300s/BFS race-safe/quick 不變）。

### 2026-07-08 14:30 | 共用 EZpage 帳號＝Google 登入＋爬蟲逾時放寬
- **工作區**: apps/server＋apps/web
- **類型**: feat
- **檔案**: server 新 `auth/provision.ts`＋`auth/google-auth.test.ts`；改 `auth/routes.ts`（POST /api/auth/google）＋`config.ts`（GOOGLE_CLIENT_ID）＋`auth/index.ts`＋`index.ts`＋package.json（google-auth-library）；web 新 `components/auth/GoogleSignInButton.tsx`＋改 `AuthForm.tsx`/`lib/api.ts`/`next.config.mjs`（CSP 放行 accounts.google.com）/globals.css；`research/crawler.ts`（逾時/deadline）＋`.env.example`
- **改了什麼**: (1) **Google 登入**：後端驗 Google ID token（audience＝EZpage 同一個 client id）→取 email→provisionUser find-or-create 本地 user+個人 org+owner→發 MeetCopilot JWT。與 EZpage 同 Google email 即同身分、無密碼。feature flag（GOOGLE_CLIENT_ID 未設→維持本地登入、測試不壞）。前端 GIS 按鈕＋CSP。(2) **爬蟲**：nav 逾時 20s→60s（env CRAWL_NAV_TIMEOUT_MS，clamp 5–120s）、逾時不硬敗改 waitUntil:"commit" 搶救部分內容、剝 #fragment；整場 deadline 放寬 quick 120s/detailed 300s（env 可覆寫、仍有界，L13）——使用者「慢慢爬沒事」。
- **為什麼**: 使用者要跟 EZpage 帳號互通＋嫌密碼複雜（EZpage 純 Google 登入無密碼）；爬 CyberPower 產品頁 domcontentloaded 20s 硬敗。typecheck 綠、server 36/36。

### 2026-07-08 11:30 | Postgres 移植（雙驅動；為 Cloud Run + Cloud SQL，4 agent；指揮官代記）
- **工作區**: packages/crm＋apps/server
- **類型**: feat
- **檔案**: 新 `packages/crm/src/pg-db.ts`（PgDbPort＋`?`→`$n` 轉換＋AsyncLocalStorage tx＋int8→Number＋runMigrationsPg）＋`migrations-pg/001-009`＋`test-helpers.ts`；改 `core.ts`（driver 選擇工廠＋back-compat overload）、`index.ts`、5 個 repo 的方言 SQL、`apps/server/src/crm.ts`（DB_DRIVER=pg 支援）、5 個測試檔（driver 切換）
- **改了什麼**: 加 Postgres 持久層路徑、**不破壞 SQLite**（env `DB_DRIVER`＋`DATABASE_URL` 選）。repo 完全 DbPort-agnostic → 同一份 `Sqlite*Repository` 在 pg 上跑，**免寫 Pg 版**。方言修正：`INSERT OR IGNORE`→`ON CONFLICT DO NOTHING`、`MAX(a,b)`→JS Math.max、`LIKE`→`LOWER() LIKE LOWER()`（大小寫 parity）、pg 版 DDL 全 epoch 欄 `INTEGER`→`BIGINT`（int4 溢位）、bool 保持 integer 0/1、JSON 保持 TEXT。
- **為什麼**: 使用者選 Cloud Run scale-to-zero → 需 Cloud SQL Postgres（SQLite 在 Cloud Run 短暫檔案系統會掉資料）。**驗證：crm 43/43 在 SQLite＋Postgres 皆綠、server 32/32、真 server 在 pg 端到端（含真爬蟲、bigint 持久化）、SQLite 本機不破**。app 已 Postgres-ready for Cloud SQL。

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
