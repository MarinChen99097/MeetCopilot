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

### 2026-07-09 16:55 | 安全修正：補完 admin A1 洞——register 拒收 allowlist 保留 email
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/auth/routes.ts`, `apps/server/src/auth/register-admin.test.ts`, `apps/server/src/admin-routes/admin.test.ts`, `apps/server/src/auth/suspension.test.ts`
- **改了什麼**: 前一輪只讓 register 不「衍生」platformAdmin，但 login 仍對 allowlist email 發 admin → 攻擊者可「用尚無帳號的 allowlist email 自助 register 設密碼 → 再 login」竊 admin（register 修法不完整）。**修**＝register handler 在 dup-409 檢查後、建帳號前，`isPlatformAdmin(email)` 命中 → **403「email reserved」**（用與 payloadFor 同一正規化小寫比對）。**Before**: allowlist email register → 201 建本地密碼帳號。**After**: → 403、不建帳號。login/google 的 admin 衍生不變（兩者證明 email 擁有權）；既有 allowlist 帳號不受影響（真帳號已於前面 409）。測試：register-admin.test 改 allowlist→403 且未建帳號＋非 allowlist→201＋「out-of-band provision 後 login→仍拿 admin」；admin.test/suspension.test 的 admin seed 由 `register` 改 `createUserWithOrg`（+bcrypt hash）。
- **為什麼**: /simplify altitude 鏡頭揪出的安全殘留（A1 register 修法不完整）。server 73/73（+1 安全測試）、typecheck 綠。

### 2026-07-09 16:55 | 品質清理（行為不變）：dedup／熱路徑單查詢／repo 復用／併發
- **工作區**: apps/server
- **類型**: refactor
- **檔案**: `apps/server/src/ops/metered-gemini.ts`, `apps/server/src/ops/pricing.ts`, `apps/server/src/admin-routes/admin-queries.ts`, `apps/server/src/admin-routes/index.ts`, `apps/server/src/auth/active-account.ts`
- **改了什麼**: (1) metered-gemini `{value,usage}→MeterResult` 五欄映射兩處 → 抽近端 `toMeterResult()` helper。(2) pricing `pricingRows` 內聯定價解析 → 復用 `priceFor(kind,model)`（與 `estimateCostUsd` 同一解析；順修誤導註解）。(3) **admin-queries 復用既有 CRM repo**：`adminOrgDetail` invite 清單→`core.invites.list`（**只投影不含 token 的欄位，A3**）、per-org 用量→`core.usage.rollup`（映射回 `{kind,costUsd}`＋保留 cost DESC 排序＋`totalCostUsd`）；`orgMemberEmails`→`core.members.list`、`userEmailById`→`core.users.findById`（三 fn 簽名 `db`→`core`，index.ts 三處呼叫同步改）；**跨租戶 overview/usage/jobs 全域 rollup 維持手刻**（既有 repo 帶 org filter 不可用）。(4) active-account `isAccountActive` 熱路徑兩次 sequential await → **單一 correlated-subquery 查詢**（`SELECT (SELECT status FROM orgs...) AS org_status, (SELECT status FROM users...) AS user_status`；SQLite/PG 皆可、`?` 參數化，**fail-closed 語意逐位元不變**）。(5) `adminOverview` ~10 個獨立 await → `Promise.all`（冷路徑、零風險）。
- **為什麼**: /simplify 清理批次。**admin 端點回傳形狀逐欄比對契約 §4 不變**（admin.test 17/17 過，含 #5 `byKind`／invite-no-token、#1/#2 shape）；server 73/73、typecheck 綠。

### 2026-07-09 16:50 | apps/web 行為不變品質清理：抽共用 ConfirmDialog＋WsStatus 直用＋CopilotView 巢狀三元化簡
- **工作區**: apps/web
- **類型**: refactor
- **檔案**: `apps/web/components/ui/ConfirmDialog.tsx`(新), `apps/web/components/studio/SlideEditor.tsx`, `apps/web/components/train/PersonaPicker.tsx`, `apps/web/app/globals.css`, `apps/web/app/studio-present.css`, `apps/web/components/hud/HudView.tsx`, `apps/web/components/copilot/CopilotView.tsx`
- **改了什麼**:
  - **抽共用 ConfirmDialog（reuse）**: 新增 `components/ui/ConfirmDialog.tsx`（props：title／message(ReactNode)／confirmLabel／cancelLabel／onConfirm／onCancel／confirmTone("primary"|"accent"|"danger"，含危險樣式旗標)／dismissOnBackdrop／ariaLabel）。SlideEditor 原內嵌 `.mc-confirm` 生圖確認 → 改用 ConfirmDialog（ariaLabel="AI 生圖確認"、confirmTone="accent"、不允許點背景關）；PersonaPicker 原 `StartConfirmDialog`（`.mc-modal`）→ 改用 ConfirmDialog（dismissOnBackdrop、confirmTone 預設 primary），並刪除該區域元件。文案（生圖付費/耗時預警、麥克風/計費/如何結束三點、對練對象名）逐字保留。CSS 合併：`.mc-modal`（globals.css）＋ `.mc-confirm`（studio-present.css）→ 單一 `.mc-confirm` 家族（backdrop 模糊、panel 陰影、`__list`/`__who`），移至 **globals.css**（因 ConfirmDialog 也用於 /train，而 studio-present.css 只在 studio/present 載入）；studio-present.css 舊 `.mc-confirm` 區塊移除只留註記。
    - **TeamSettingsView 決定＝維持 window.confirm 不動**（只讓 SlideEditor＋PersonaPicker 共用）。理由：同步阻塞式 `window.confirm` → 非同步 React modal 客觀上改變互動時序（違本批「行為不變」宗旨），且需憑空生一個新標題字串（違「i18n 一字不改」）＋新增 pending-state。走了指示明文給的逃生門。
  - **HudView WsStatus 直用**: `ConnectingState` 的 `status: ReturnType<typeof useRealtime>["status"]` → `status: WsStatus`；`useRealtime` 已匯出 `WsStatus`，import 補上 `type WsStatus`。
  - **CopilotView 巢狀三元化簡**: `granted ? (status === "failed" ? "mc-badge--warn" : "mc-badge--ok") : "mc-badge--warn"` → `granted && status !== "failed" ? "mc-badge--ok" : "mc-badge--warn"`（四種輸入逐一比對語意等價後才改）。
- **為什麼**: 上一批 UI 新增造成兩個各異但同構的確認 dialog（各帶一套 CSS）與繞圈型別推導、巢狀三元；純品質清理、不改行為、不找 bug。未觸及 lib/ws.ts toWsEndpoint（本輪刻意不動）、error-i18n.ts；i18n 文案只搬結構未改字。
- **驗證**: `apps/web` `tsc --noEmit` 綠。本機 web dev(:3000) 有跑，但較重的 client 路由（/train、/copilot、/hud）在此環境會因 Next dev 編譯 worker 崩潰回 500（錯誤＝「Jest worker encountered 2 child process exceptions」，屬 dev-server 基建不穩、非本次改動：typecheck 綠、錯誤未指向任何本次檔案、未改動的重路由 zh-TW/studio 同樣 500 而輕路由 en 的 crm/login/studio 清單頁 200），故無法在瀏覽器實際點按確認鈕；以 typecheck 綠＋結構等價為佐證。未 commit（硬規則 6）。

### 2026-07-09 16:40 | admin 行為不變品質清理（/simplify 12 項）
- **工作區**: apps/admin
- **類型**: refactor（純清理，零行為改動）
- **檔案**: 新增 `src/components/charts/geometry.ts`、`src/lib/useConfirmAction.ts`；改 `charts/Sparkline.tsx`、`charts/LineChart.tsx`、`components/DataTable.tsx`、`components/StatusBadge.tsx`、`app/orgs/page.tsx`、`app/orgs/[id]/page.tsx`、`app/jobs/page.tsx`、`app/page.tsx`、`lib/api.ts`、`lib/useAsync.ts`、`app/login/page.tsx`、`lib/format.ts`、`app/globals.css`。
- **改了什麼**: (1) 抽泛型純函式 `projectPolyline(items,getValue,geom)→{coords,line,area,min,max}`，Sparkline/LineChart 各傳自己幾何（Sparkline x0=pad/yBase=h-pad；LineChart maxFloor=1）——投影數學逐字等價（座標/字串 toFixed 皆不變）。(2) 刪 LineChart 死碼 `height` prop。(3) Sparkline 守衛 `>=1`→`>=2`（單點本就不渲染，輸出不變）。(4) 抽 `useConfirmAction(perform,onDone)` hook，orgs 兩頁的 pending/busy/actionErr 狀態機收斂，各傳差異 perform。(5) 抽 `errMessage(err,fallback)` 進 lib/api.ts，useAsync/login/hook 共用（原 4 處 `err instanceof ApiError?…`）。(6) orgs status 解析化簡為 `raw==="suspended"||raw==="active"?raw:""`。(7) jobs `orgId` 無 setter 的 useState→純 const。(8) page.tsx 相鄰兩 KpiCard 的 `sparkFromDays(rows,7)` 提為 `spark7` 共用。(9) 刪 DataTable 未用的 `caption` prop＋死 CSS `.ad-table__caption`。(10) DataTable client/server 兩段頁尾導航抽 presentational `<Pager>`（DOM/class/文案/disabled 邏輯全等）。(11) 刪無呼叫端的 `fmtRelative`。(12) 刪 StatusBadge 未被傳的 `title` prop。
- **為什麼**: /simplify 結果，去重＋除死碼，不碰 API 參數/回傳（dayParamToEpochMs、labels 皆未動）。`tsc --noEmit`（root hoist next15/react19）全綠；未 commit。

### 2026-07-09 15:16 | admin 停權批次 2 個 regression 修復：WS 監聽器 async 窗口＋register 竊取 admin
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/realtime/ws-server.ts`, `apps/server/src/realtime/hub.ts`, `apps/server/src/auth/routes.ts`, `apps/server/src/auth/register-admin.test.ts`(新), `apps/server/src/realtime/ws-async-gate.test.ts`(新), `apps/server/src/admin-routes/admin.test.ts`, `apps/server/src/auth/suspension.test.ts`
- **改了什麼**:
  - **Finding 1 WS async 窗口（crash＋洩漏）**: `ws-server.ts` connection handler 把 `ws.on("error")`＋`ws.on("close",()=>hub.detach(ws))` 移到 `isAccountActive(...).then` **之前同步掛上**（帳號檢查是兩個 await 的 DB 查詢，有真實窗口）。理由：(a) 無 error listener 時 ws@8 的 EventEmitter 會 re-throw 成 uncaught → index.ts 無 uncaughtException handler → 整 process crash；(b) 窗口內 close 若在 attach 前發生，close 事件需已有人接才會 detach，否則幽靈 entry 殘留、room Set 永不歸 0 → runtime＋Gemini ASR 洩漏。`.then` 內只留 `hub.attach`＋`ws.on("message")`（error/close 不重掛，避免 double-detach）。`hub.ts attach()` 開頭加防呆 `if (ws.readyState !== ws.OPEN) return;`——窗口內已關閉的 socket 不入房（其 close 已 fire 過、不會再 detach）。停權語意不變（不通過仍 close 4003 fail-closed）。
  - **Finding 2 register 竊取 admin（A1 繞過）**: `routes.ts` register handler 的 token 改為 `issueToken(jwtSecret,{userId,orgId,role:"owner"})`，**不再走 `payloadFor`**（後者會對 allowlist email 蓋 `platformAdmin:true`）。契約 §1：platformAdmin 只在 login/google（兩者證明 email 擁有權）蓋；register 證明不了任何事（Google-only admin 的 allowlist email 尚無本地帳號 → 攻擊者可 register 該 email 竊取 admin JWT）。login/google 路徑不動。
  - **測試**: 新增 `register-admin.test.ts`（allowlist email 走 register → token 非 platformAdmin；對照同 email login → 為 platformAdmin）；新增 `ws-async-gate.test.ts`（① 真 hub：已關閉 socket attach 不入房、不 materialize runtime＝不洩漏，OPEN socket 正常入房為對照；② 真 WS server＋慢速 fake core：窗口內 `emit("error")` 不 throw＝證同步 error listener 在，client close 觸發 detach＋attach 收到非 OPEN socket）。因安全修法改變 register 語意，`admin.test.ts`／`suspension.test.ts` 的 adminToken 取得改為「register 建帳號後再 login」（原本直接用 register token 當 admin，正是本次修掉的洞）。
- **為什麼**: 兩者皆為今日 admin/停權批次新引入的 regression（review 確認）。未動契約；I1/I2/I3 未觸及；未改 index.ts。
- **驗證**: server typecheck 綠；server 全測試 72/72 綠（原 68＋4 新）；realtime 子集 22/22（原 20＋2）。WS 窗口驗法＝ws-async-gate.test.ts 用真 WebSocketServer＋可控 gate 的 fake core 模擬「連線→窗口中 close/emit error→放行檢查」，實證不 crash（error listener 同步在）＋不洩漏（attach 收非 OPEN、真 hub guard 拒收）。未 commit（硬規則 6）。

### 2026-07-09 15:10 | apps/admin 契約修復：日期參數 epoch-ms 化（修全頁 400）＋UsageSummary.from/to 型別＋KIND_LABELS 對齊真實 6 種 kind
- **工作區**: apps/admin
- **類型**: fix
- **檔案**: `apps/admin/src/lib/api.ts`, `apps/admin/src/lib/api-types.ts`, `apps/admin/src/app/usage/page.tsx`, `apps/admin/src/lib/labels.ts`
- **改了什麼**:
  - **Finding 1（Critical）日期參數不符**: DateRangePicker 產出 `YYYY-MM-DD`，前端原樣送 `?from=2026-06-10&to=...`；server `admin-routes/index.ts:46 parseEpoch` 做 `Number("2026-06-10")=NaN` → 400「from/to must be epoch-ms numbers」，`/usage`、`/jobs`、`/`(dashboard) 首次載入必中。修法＝在 api.ts 集中新增 `dayParamToEpochMs(day, edge)`（`start`→`Date.parse(day+"T00:00:00.000Z")`、`end`→`Date.parse(day+"T23:59:59.999Z")`，涵蓋整日以免 `created_at <= to` 排除同日事件；空值→undefined 由 qs 略過；非 `YYYY-MM-DD`（含已是數字字串）→數值化原樣回，防二次轉換）。套進 `getUsage`(from start/to end)、`getUsageEvents`(同)、`listJobs`(同)。UsageEventsDrawer 的「單日 cell」（groupBy=day 時 from=to=row.key）也走同轉換＝該日 00:00→23:59:59.999。
  - **Borderline #4 型別漂移**: `UsageSummary.from/to` 型別 Before＝`string` → After＝`number`（server `admin-queries.ts:147-149 AdminUsage.from/to:number` 回 epoch-ms）；`usage/page.tsx` 約 106 行「區間」標籤 Before＝`{q.data.from} → {q.data.to}`（會渲染原始毫秒整數）→ After＝`{fmtDate(q.data.from)} → {fmtDate(q.data.to)}`（複用 format.ts 既有 formatter，另補 import）。
  - **Finding 2（Info）KIND_LABELS 錯誤**: labels.ts 用了不存在的 `image`、漏真實 `openai_image`/`gemini_extract`。改為對齊真相來源 `packages/shared/src/ops-types.ts USAGE_KINDS` 六種（gemini_text/gemini_extract/gemini_live/openai_image/embedding/asr），`image`→`openai_image`（「OpenAI 生圖」）、補 `gemini_extract`（「Gemini 擷取（匯入解析）」）。usage 定價說明表與 drawer 項目欄一併正確。
- **為什麼**: code-review 兩項確認問題——契約 §4/§8 規定 from/to 一律 epoch-ms number，前端違約送日期字串使每個帶日期範圍的 admin 查詢被 server 回 400；KIND_LABELS 對不上真實 kind 導致定價表缺項/誤標。**只動 apps/admin，未改 server**（違約方＝前端）；未動其他 review finding；未 commit（硬規則 6）。
- **驗證**: `apps/admin` `tsc --noEmit` 綠；node 驗轉換函式（`2026-06-10`→from=1781049600000/`2026-06-10T00:00:00.000Z`、to=1781135999999/`2026-06-10T23:59:59.999Z`、同日跨距 86399999ms、空值→undefined、數字字串直通）。本機 admin dev(:3100) 與 server(:8787) 皆未啟動，未能實跑 `/usage` 驗 200；轉換與 typecheck 佐證修復。

### 2026-07-09 13:55 | 整合收線：接上 admin 半場留下的 5 個跨界缺口＋部署殘留檔棄用標記
- **工作區**: apps/server（＋根目錄部署檔）
- **類型**: fix
- **檔案**: `apps/server/src/realtime/hub.ts`, `apps/server/src/realtime/session-runtime.ts`, `apps/server/src/realtime/ws-server.ts`, `apps/server/src/realtime/retrieval.ts`, `apps/server/src/realtime/orchestrator.ts`, `apps/server/src/research/orchestrator.ts`, `apps/server/src/research/routes.ts`, `apps/server/src/decks-routes/index.ts`, `apps/server/src/index.ts`, `.env.example`, `docker-compose.yml`, `Caddyfile`, `.env.production.example`
- **改了什麼**:
  - **缺口1 ASR 記帳**: hub 建構子 `meter?` 改參數屬性存為欄位；`onAsrFinal` consent 閘後對每個成功轉寫的 final 逐字段記一筆 `asr`（fire-and-forget，`meter(orgId,'asr',()=>({result:undefined,meetingId}),\`asr:<meetingId>:<seq>\`)`）。冪等 key = meetingId＋單調 chunk 序號（新 `LiveSessionRuntime.asrChunkSeq`，隨 runtime dispose）。
  - **缺口2 會中分析記帳**: hub `ensureRuntime` 的 `new RollingWindowAnalysisEngine(...)` 補第 4 引數 `this.meter ? {meter:this.meter, orgId:meta.orgId} : undefined`（engine 已支援，之前恆傳 undefined＝不計費）。
  - **缺口3 WS 升級停權閘**: `ws-server.ts` import `isAccountActive`＋收 `core` 參數（index.ts 呼叫補傳 `core`）；連線 handler 在 `hub.attach` 前 `await isAccountActive(core,orgId,userId)`，不通過→送 `account_suspended` error＋`close(4003)`；DB 錯 fail-closed 關閉。attach＋message/close 監聽器移進通過分支（停權 socket 絕不入房，比照既有 send-error-then-close 拒絕風格）。
  - **缺口4 userId 回填**: decks route generate/image 呼叫傳 `userId(req)`（服務層已就緒）；research/orchestrator 把 `requestedBy` 貫穿到 metered helpers（`meteredGeminiFor`/`extractorFor`/`deepExtractorFor`/`meteredGrounding`/`deepResearcherFor` 加 `userId?`）＋`runJob` 介面/`runStandard`/`runDeep` 加 `requestedBy?`，routes 的 runJob 呼叫補 `requestedBy: req.auth!.userId`；realtime `MeetingContext` 加 `userId?`（→ metered embed ctx），orchestrator 檢索 ctx 帶 `runtime.presenterUserId`。
  - **缺口5 .env.example**: 補 `PRICING__<MODEL>__INPUT_PER_M/OUTPUT_PER_M/PER_IMAGE` 覆寫說明區塊（含 5 model 範例，預設全註解＝行為不變）；確認 `PLATFORM_ADMIN_EMAILS`/`ADMIN_ORIGIN` 已在。
  - **棄用標記**: `docker-compose.yml`/`Caddyfile`/`.env.production.example` 檔頭加醒目 `⚠️ 未採用的 GCE VM 替代方案殘留 — 現行部署＝Cloud Run×2＋Cloud SQL，見 docs/DEPLOY.md`（.env.production.example 另指現行 env 以 DEPLOY.md 的 Secret Manager/env 清單為準）。
- **為什麼**: 五路平行改動各自驗過，但 admin server 半場留下的 ASR/會中分析記帳、WS 停權掛勾、userId 歸屬全靠 hub/ws-server/route 各一處掛接才生效（該 agent 明列為 gap）；部署殘留檔（單 VM 方案）易誤導。**未動任何契約**；I1/I2/I3 未觸及（僅記帳副作用＋停權閘＋歸屬欄）。
- **驗證**: 全 workspace（shared/crm/admin/server/web）typecheck 綠；server 68/68、CRM 46/46 全綠零回歸。本機起 server(:8788)＋web(:3000) 冒煙：health/ready 200；register 201→me 200；admin 無 token 401／一般 token 403／admin token（.env 臨時加 PLATFORM_ADMIN_EMAILS 後重啟）/api/admin/overview 200（測後已還原 .env）；WS 三角色 capture/hud/present 皆 open＋session_state（同時實證缺口3 放行 active 帳號）；web home/login/crm/studio 四頁 200。未 commit（硬規則 6）。

### 2026-07-09 14:25 | 會議即時層 P0 修復：WS 連線根因＋三視圖連線狀態機＋train 預警
- **工作區**: apps/web
- **類型**: fix
- **檔案**: `apps/web/lib/ws.ts`, `apps/web/lib/useRealtime.ts`, `apps/web/components/copilot/CopilotView.tsx`, `apps/web/components/hud/HudView.tsx`, `apps/web/components/present/PresentStage.tsx`, `apps/web/components/train/PersonaPicker.tsx`, `apps/web/app/globals.css`, `apps/web/app/studio-present.css`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`
- **改了什麼**:
  - **P0 根因（連線恆失敗）**: `POST /api/meetings` 回的 `wsUrl` 是**完整 ws 端點** `ws://host/ws`；copilot/HUD 把它當 `apiBase` 傳進 `useRealtime`→`ws.ts connect()`，後者又補一次 `WS_PATH`（`/ws`）→ `ws://host/ws/ws`，被 path-scoped `WebSocketServer` abortHandshake(400) 拒 → 永遠連不上。present 用 `API_BASE`（非 wsUrl）故不受此 bug，但等待畫面無任何連線指示。**修**: `ws.ts` 新 `toWsEndpoint()`——base 若已以 `/ws` 結尾就不再補 → 同時吞掉 origin 型與 full-endpoint 型兩種輸入，`connect()` 改用之。Before `new URL(\`${toWsOrigin(apiBase)}${WS_PATH}\`)` → After `new URL(toWsEndpoint(apiBase))`。
  - **連線狀態機（三視圖統一）**: `useRealtime` 加終態 `failed`＋重連上限 `MAX_ATTEMPTS=6`＋`describeWsClose(code)`（4001/4000→terminal 憑證/握手錯；其餘→可重試）＋`failureReason`＋`retry()`（bump nonce 重跑 effect、重置預算）＋`wsStatusLabel()`。禁「未連線但看似正常」與「永久重連中」：達上限或 auth-terminal → 停止重連、顯示原因＋[重試]。
  - **copilot**: StatusBar 用 `wsStatusLabel`＋failed 時顯示 `.mc-cap__connfail`（原因＋重試連線鈕）；ConsentGate 標籤依 status（failed→「已同意（連線失敗）」）。
  - **HUD 假聆聽修**: 加 `everConnected` 閘——**首次連上前不渲染串流面板**（原本會顯示假「聆聽中，尚無…」看似已連）；改顯示 `ConnectingState`（連線中 spinner／failed 時「無法連上會議 HUD」＋原因＋重試連線＋重新貼連結）。連上後掉線→banner（reconnecting／failed 專用 `--fail` banner 含重試＋重新貼連結）。`idle` 也視為未連。
  - **present 等待畫面（I3 中性）**: `LinkState` 加 `failed`；重連耗盡→終態 `failed`；onClose 讀 `ev.code`，4001/4000 立即終態（不空耗 10 次重連）；等待畫面加中性連線指示點（`.mc-present__waitdot` 連線中/已連）＋failed 時「連線中斷＋重新連線」notice（`retryWs` bump nonce）。新 i18n key `connConnecting/connFailedTitle/connFailedDesc/connRetry`（zh-TW＋en）。**未新增任何 HUD/副駕元素或詞彙，守 I3**。
  - **train 預警**: PersonaPicker「開始語音對練」改為先開確認 dialog（`.mc-modal`：需麥克風＋會開始計費語音 session＋結束方式），同意才 `onStart`（後續才 `getUserMedia`＋鑄 Live token＋連 Gemini Live）。
  - CSS: globals.css 加 `.mc-cap__connfail`／`.mc-hud__banner--fail`／`.mc-hud__connstate*`／`.mc-hud__connspinner`／`.mc-modal*`；studio-present.css 加 `.mc-present__waitdot*`。
- **為什麼**: 使用者痛點「多處無法使用」的主犯＝會中即時流程未連線就永遠卡死、零回饋零重試（audit-c P0）。根因是 client 端 wsUrl 雙重補 `/ws`；伺服器**不需**先 start（scheduled 會議即可連，WS handshake 不檢查 status）。附帶修 HUD 假聆聽/idle banner 消失（P1）與 train 無預警（P1）。
- **驗證**: web typecheck 綠；realtime server 測試 20/20 綠（未觸 server）。WS 協定層對真 server(:8788) 決定性驗證（browser-free）：舊 `/ws/ws`→opened:false/1006（根因坐實）；新 `/ws` 三角色(capture/hud/present) 皆 opened:true+session_state（修復）；壞 token→close 4001（終態映射）。**Playwright 三視圖 UI 截圖受阻**：本機 Next dev server 在多 agent 並行下 OOM，SWC worker 崩潰（"Jest worker exceeding retry limit"，未改過的 home/login 同 500），且無授權重啟——非本次改動所致。未 commit（硬規則 6）。

### 2026-07-09 13:40 | Admin 後台 server 半場（ADMIN_CONTRACT §1–§4/§6.1）＋記帳補洞
- **工作區**: apps/server, packages/crm
- **類型**: feat
- **檔案**: 新 `apps/server/src/admin-routes/{index.ts,admin-queries.ts,admin.test.ts}`、`apps/server/src/auth/{active-account.ts,suspension.test.ts}`、`apps/server/src/ops/{meter-userid.test.ts,pricing.test.ts}`；改 `apps/server/src/config.ts`、`auth/{jwt.ts,routes.ts}`、`index.ts`、`ops/{meter.ts,meter-impl.ts,metered-gemini.ts,pricing.ts}`、`generation/generation-service.ts`、`decks/image-service.ts`、`train/{routes.ts,train-service.ts}`、`analysis/gemini-analysis.ts`、`realtime/hub-endmeeting-authz.test.ts`(config 字面補 2 欄)；`packages/crm/src/{repos-ops.ts,usage.test.ts}`、新 `packages/crm/test/admin-migration.test.ts`
- **改了什麼**:
  - **§1 平台管理員身分**: config 加 `PLATFORM_ADMIN_EMAILS`/`ADMIN_ORIGIN`；`AuthPayload.platformAdmin?`＋`verifyToken` 放行該欄；新 `platformAdminRequired`（無 token→401、非 admin token→403 `{error:"admin only"}`）；register/login/google 簽發時 email∈allowlist→`platformAdmin:true`。
  - **§2 停權**: 新 `auth/active-account.ts`（`isAccountActive` 以 raw DbPort 查 orgs/users.status、不加寬 frozen 型別；`activeAccountRequired` middleware，DB 錯 fail-closed 403）；login/google 停權 403；index.ts 於 crm/research/decks/train/meetings/org router 掛 `activeGuard`（usage 依契約不掛）。`Meter.meter` 加可選 5th `userId`→`record` 寫 `usage_events.user_id`（repos-ops INSERT 補欄）；metered-gemini ctx.userId、generation/image-service 補可選 userId 參數。
  - **§3 記帳補洞**: `loadPricingOverrides()` 實作（`PRICING__<MODEL>__INPUT_PER_M` 等，boot 於 index.ts 套用）＋`pricingRows()`/`PRICING_DISCLAIMER`（§4#10）；train `startSession` 鑄 Live token 時記 `gemini_live`（idem=`live:<sid>`、userId）；`gemini-analysis.ts` 加可選 metering（建構傳 `{meter,orgId}`→包 metered client）。
  - **§4 Admin API**: `admin-routes/`（10 端點，全過 `platformAdminRequired`，跨 org 走 raw DbPort、`?` 佔位、小寫別名+JS camel 映射、日期分桶用 JS UTC；overview/usage(4 groupBy)/usage-events/orgs/orgs:id/PATCH status×2(自鎖守門)/jobs/jobs-stats/health/pricing）。v1.2：時間戳 epoch ms、usage30d.byKind={kind,costUsd}、durationMs/queueMs server 算。
  - **§6.1 CORS**: index.ts 單 origin→allowlist Set（WEB_ORIGIN+ADMIN_ORIGIN+localhost:3000/3100）；掛 `/api/admin`（在 `/api` decks catch-all 之前）。**index.ts 只動 CORS 區塊與 router 掛載**。
- **為什麼**: token 花費儀表板／帳號管理／job 監控／健康頁的後端＋補齊 ASR/gemini_live/會中分析漏記帳與 pricing env 覆寫（使用者痛點 #2）。**不改契約**；未碰 realtime/research 檔本體（僅 index.ts 掛載點與 analysis 可選注入）；ASR 記帳＋analysis/ws 停權掛接需 hub/ws-server 各 1 行掛勾（realtime 平行 agent 所有，列為 gap）。
- **驗證**: 全 workspace（shared/crm/admin/server/web）typecheck 綠；server 68/68（+27 新：admin 17、suspension 4、meter-userid 2、pricing 4）、CRM 46/46（+3：migration 2、userId 1）全綠，既有測試零回歸。本機起 server（:8789，PLATFORM_ADMIN_EMAILS 經 .env override）實測：admin email 登入→10 端點全 200 且形狀對、一般 token 全 403、無 token 401；停權 e2e（suspend→login 403+crm 403、health/ready 200、restore→200）。migration 012 空庫＋既有庫升級（001..011→012 ALTER）雙路徑實測資料完好。未 commit（硬規則 6）。

### 2026-07-09 13:20 | 簡報線（DeckWizard/studio）審測 P1×3＋精選 P2 修正
- **工作區**: apps/web, apps/server
- **類型**: fix
- **檔案**: `apps/web/components/studio/DeckWizard.tsx`, `apps/web/components/studio/SlideEditor.tsx`, `apps/web/app/studio-present.css`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`, `apps/server/src/decks-routes/index.ts`
- **改了什麼**:
  - **P1 objective 靜默丟值**：DeckWizard「目標」自由 `<input>` → `<select>`（5 後端 enum pitch/introduce/fundraise/report/training，本地化標籤 提案/介紹/募資/報告/培訓 ＋選中一行說明）。只可能送 enum 值或空，杜絕「中文自由字→後端 isOneOf 靜默丟值」。
  - **P1 生成中無回饋**：step3 生成 modal 從單一 spinner+「別關閉」升級為 階段提示（分析輸入→產生每頁內容→排版配色，誠實假階段依耗時推進封頂）＋三段進度條＋「已耗時 N 秒」計時＋「約需 15–60 秒，頁數越多越久」預估＋誠實說明「單次作業無法中途取消」（後端本無取消）。
  - **P1 AI 生圖零預警**：SlideEditor「生成背景圖/整頁生圖」點擊前先出確認 dialog（説明「呼叫外部付費 API、約 10–80 秒、每張約 US$0.04、完成自動套上」，確認才 launchJob）＋按鈕區常駐一行成本/時間說明。取消＝不排 job、零花費。
  - **P2 網址匯入錯誤人話化（server 錯誤映射）**：`decks-routes/index.ts` `/extract-url` catch 新增 `classifyExtractError`：來源限流(429)/內網·拒絕存取(422)/逾時(504)/格式不符(422)/來源5xx(502) 分案回可行動中文，去掉外露的 `url import failed:` 開發前綴；空文字分支也改中文。Before＝`url import failed: ${err.message}`（英中混）→ After＝「無法匯入：…（分案）」。
  - **P2 跨步殘留錯誤 banner**：DeckWizard 換步驟（上一步/下一步）統一走 `goToStep` 先 `setError(null)` → step1 匯入失敗的 banner 不再跟到 step2/3。
  - **P2 欄位標籤英文變數名**：DeckWizard 全字串抽進 `deckWizard` i18n 命名空間（zh-TW＋en）；可見標籤只剩中文（目標/要點/數據/來源文字…），英文提示移到欄位下方 `.mc-field__hint`；/en 顯示英文標籤。
  - **P2 stats/image-full CSS 小修**（只動該兩模板樣式段）：stats 卡片加高＋垂直置中＋數字整體放大（消「上聚下空」）；image-full 用 `:has()` 區分——有圖滿版無留白（原行為）、無圖時保留 padding＋柔和漸層底（消「大標貼頂像壞頁」）。
- **為什麼**: Audit-B 簡報線 P1×3＋精選 P2（生圖零預警、objective 靜默丟值、生成中無回饋、錯誤混語言、標籤露英文變數名、stats/image-full 醜點）。**未動** `apps/server/src/index.ts`、生成 prompt 與 schema 本體。
- **驗證**: web typecheck 綠；server typecheck 我方檔案（decks-routes/extract）零錯——唯一紅在平行 admin agent 進行中的測試檔（admin.test.ts、config.ts 新增 AppConfig 欄位），非本批。Playwright（channel msedge）full wizard flow 12/13 PASS：objective 下拉 6 選項、標籤零英文變數名、生成中三段進度+計時+預估、確認 dialog 含 $0.04/10–80s、banner 換步清空、stats/image-full render、/en 英文標籤、零 next-intl missing-message；截圖存 `C:\tmp\meetcopilot-audit\shots\b-after\`。item4 humanized 文案另以直打 API 4 案驗證（private/format/metadata/baddomain 全回正確中文、無 dev 前綴）——因平行 agent 同時改 auth/i18n 使 web `/register` 暫時 500，該項截圖以 API 佐證。未 commit。

### 2026-07-09 12:49 | 邀請流程死路修復（P0-1）＋團隊/設定入口（P1-2）＋auth 錯誤中文化（P1-4）
- **工作區**: apps/web, apps/server
- **類型**: fix
- **檔案**: 新 `apps/web/app/[locale]/invite/page.tsx`、`apps/web/components/invite/InviteAcceptView.tsx`、`apps/web/app/[locale]/settings/page.tsx`、`apps/web/lib/error-i18n.ts`；改 `apps/web/components/auth/AuthForm.tsx`、`apps/web/app/[locale]/(auth)/login/page.tsx`、`apps/web/app/[locale]/(auth)/register/page.tsx`、`apps/web/components/AppShell.tsx`、`apps/web/app/globals.css`、`apps/web/messages/zh-TW.json`、`apps/web/messages/en.json`、`apps/server/src/org-routes/index.ts`
- **改了什麼**:
  - **P0-1 邀請接受頁**：新增 `[locale]/invite`（server page 從 `searchParams` 讀 `?token=`→ 傳給 client `InviteAcceptView`，免 Suspense）。刻意在 AppShell/AuthGuard 之外，未登入者也可落地：未登入→引導登入/註冊並用 `?next=/invite?token=…` 保留 token 回跳；已登入→顯示 `authedLead` ＋「接受邀請」→ `acceptOrgInvite(token)`→ 成功導向 `/crm`；token 缺失/伺服器錯誤→ 用 `inviteErrorKey` 映射成 zh-TW/en 人話（notFound/expired/emailMismatch/alreadyMember…）＋返回鈕。i18n 鍵在 `org.invite` 命名空間。
  - **acceptUrl 修正（server）**：`org-routes/index.ts:84` Before＝`${WEB_ORIGIN}/invite?token=`（無此路由＋缺 locale）→ After＝`${WEB_ORIGIN}/zh-TW/invite?token=`（指向實存路由、帶預設 locale，`localePrefix:"always"`）。
  - **AuthForm `?next=` 支援**：login/register page 從 `searchParams` 讀 `next` 傳入 `AuthForm`；成功後 `router.replace(redirectTarget(next))`——`redirectTarget` 僅接受同源絕對路徑（防 open-redirect），並把 query（邀請 token）拆成 `{pathname,query}` 讓 next-intl 保留 query＋補 locale。
  - **P1-2 導覽入口**：AppShell 頂欄 nav 對 owner/admin 加「團隊設定」連結（`t("org.nav.team")`，指向 `/settings/team`）；新增 `[locale]/settings/page.tsx` 於 `/settings` 直接 `redirect(/${locale}/settings/team)`（原本掉進 Next 預設 404）。
  - **P1-4 auth 錯誤中文化**：新增 `lib/error-i18n.ts`（`authErrorKey`/`inviteErrorKey`：依 `ApiError.status`＋英文訊息子字串→回 i18n leaf key，未知→generic）；AuthForm catch Before＝直接吐 `ApiError.message`（英文）→ After＝`t(\`errors.${authErrorKey(err)}\`)`。**不改 server 錯誤契約**（仍回英文 `{error}`），純 web 端映射。messages 加 `auth.errors` 命名空間。
  - CSS 加 `.mc-authcard__actions`（邀請頁按鈕縱向排列）。
- **為什麼**: Audit-A P0-1（受邀者點連結 404、邀請制形同虛設）、P1-2（團隊/設定頁無入口、`/settings` 404）、P1-4（登入/註冊英文錯誤混在中文 UI）。**驗收**：server typecheck 綠；web typecheck 我方檔案零錯（既有 2 錯在 `components/copilot/CopilotView.tsx`＝平行 agent 進行中的改動，非本批）。Playwright（channel msedge）實跑 e2e 全 PASS：owner UI 發邀請→ acceptUrl 為 `/zh-TW/invite?token=`→ 無痕 context 開連結（不再 404、顯示引導）→ 註冊（next 保留 token）→ 回跳接受→ 進 /crm → 出現在 owner 成員列表；`/settings`→`/settings/team` 重導；頂欄團隊連結存在；wrong-pw login 顯示「Email 或密碼錯誤…」（非英文）。I1/I2/I3 未觸及；未改 `apps/server/src/index.ts`；未 commit。

### 2026-07-09 12:30 | 研究（Enrich）UX P1/P2 修正：三模式選擇＋完成卡持久＋人名不被覆寫
- **工作區**: apps/web, apps/server
- **類型**: fix
- **檔案**: `apps/web/components/crm/EnrichPanel.tsx`, `apps/web/components/crm/CompanyDetailView.tsx`, `apps/web/components/ui/JobProgressCard.tsx`, `apps/web/app/globals.css`, `apps/server/src/research/orchestrator.ts`, `apps/server/src/research/name-guard.test.ts`(新)
- **改了什麼**:
  - **EnrichPanel（P1-3）**: 移除寫死的 `const mode = "deep"`，恢復 quick/detailed/deep 三選（`useState<CrawlMode>("quick")`，預設 quick）。每模式附一行說明＋成本/時間量級（quick=官網快掃・約1分內；detailed=官網深掃・數分鐘；deep=全網研究・數分鐘・費用較高）。deep 二次確認（首點顯示警告＋改鈕文案「確認開始（費用較高）」，再點才送）。二次確認以「實際會跑 deep」為準＝選 deep 或（company 且無 URL，後端強制走 name-based 全網研究）→ 關掉「選 quick 但無 URL 卻靜默跑昂貴 deep」的成本驚嚇缺口。無 URL 時顯示「將以公司名稱做全網深度研究」提示。複用既有 CSS `.mc-enrich__mode/.is-on`（前次 deep-only 重構留下的孤兒樣式）。
  - **CompanyDetailView（P2-7）**: `load` 加 `opts.silent`——研究完成後的 `onEnriched` 改 `load({ silent: true })`，不進 `setLoading(true)` → StateBoundary 不換整頁 DetailSkeleton → EnrichPanel 不被卸載 → JobProgressCard 的 done 完成卡（填入 N 欄位＋來源清單）持久顯示到使用者關閉。Before：`onEnriched={load}`（非 silent）→ 整頁閃骨架＋卡永不顯示。
  - **JobProgressCard（P2-9 對齊）**: MODE_LABEL 三模式名對齊 EnrichPanel（quick=快速掃描、detailed=官網深掃、deep=全網深度研究）。
  - **orchestrator（P2-8，server 覆蓋修正）**: 新增 `guardHumanCompanyName(payload, existingName, nameProvenance)`＋私有 `protectHumanCompanyName`。runStandard（company 分支）與 runDeep 落庫前呼叫：既有 name 非空且**非爬蟲來源**（無 name provenance＝建檔人工輸入／filled_by=human／verified=1）→ 從 payload 移除 `company.name` 與其 name provenance，upsertFromCrawl 保留原名。只有 name 明確來自爬蟲且未人驗才允許重爬更新。fieldsFilled 改用 `payload.provenance.length`（守則後計數正確）。
- **為什麼**: Audit-A P1-3（研究入口寫死昂貴 deep、無成本提示）、P2-7（完成卡永不顯示＋整頁閃骨架，根因＝onDone→load 整頁進 loading 卸載 EnrichPanel）、P2-8（研究把人工中文公司名覆蓋成爬到英文名，根因＝company.create 不寫 name provenance → trustedFieldsOf 漏掉 name → upsertFromCrawl 覆寫）。補上 create 未寫 provenance 的缺口、對齊既有 human>crawler supersede 慣例。未動爬蟲抓取本體、未動 index.ts。
- **驗證**: server+web typecheck 綠；server 全測試 41/41 綠（含新 name-guard 5/5；因 node_modules/@meetcopilot/* symlink 指向已刪的 _v2 路徑，需用 alias 指向現 repo dist 才能跑 runtime import 的既有測試——環境問題，非本次改動）。live Playwright 受同一 symlink 斷鏈＋無 GEMINI_API_KEY 阻擋，未實跑。

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
