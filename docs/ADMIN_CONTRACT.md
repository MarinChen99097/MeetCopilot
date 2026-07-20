# ADMIN_CONTRACT v1.0 — 平台管理後台（apps/admin）接縫凍結

> 2026-07-09 Fable 起草。地基事實依據：`C:\tmp\meetcopilot-recon\v2-admin-foundation.md`（file:line 全在裡面）。
> 平行派工守則：實作 agent **只實作、不改本契約**；發現缺口回報 gaps，由指揮官裁決後更新版本號。
> 使用者拍板（ROM 2026-07-09 11:45）：admin＝獨立 app、第三個 Cloud Run service；第一版四塊全做
> （token 花費儀表板／帳號管理／研究 job 監控／系統健康）。

## 0. 範圍與不變量

- admin 是**平台管理者**（營運方）視角：跨 org 讀取、少量管控動作。與產品前端（apps/web）完全分離。
- **I1/I2/I3 不受影響**（admin 不觸 deck/meeting 業務路徑）。新增不變量：
  - **A1 admin 路由絕不外洩到非 admin token**：所有 `/api/admin/*` 過 `platformAdminRequired`；用「非 admin 的合法登入 token」攻擊測試必須 403。
  - **A2 admin 為 read-mostly**：v1 唯二寫入動作＝org 停權/復權、使用者停權/復權。其他一律唯讀。
  - **A3 不回傳秘密**：任何 admin 端點不得回 password_hash／API key／JWT secret／invite token 明碼。

## 1. 平台管理員身分（server 端）

1. env 新增 `PLATFORM_ADMIN_EMAILS`（逗號分隔 email 清單；prod 放 Secret Manager 或明文 env 皆可）。
2. 登入沿用既有 `POST /api/auth/login`／`/api/auth/google`：簽發 JWT 時（`auth/routes.ts` 兩處＋`provision`），
   若 `email ∈ PLATFORM_ADMIN_EMAILS` → payload 多帶 `platformAdmin: true`。
   `AuthPayload`（`auth/jwt.ts:11-15`）加可選欄 `platformAdmin?: boolean`；`verifyToken` 放行該欄。
3. 新 middleware `platformAdminRequired`（放 `auth/jwt.ts` 旁）：先 `authRequired` 語意再檢查 `platformAdmin === true`，否則 **403 `{error:"admin only"}`**（非 404）。
4. 同一 `JWT_SECRET`（單操作者 MVP；隔離爆破面留待 v2 換 `ADMIN_JWT_SECRET`）。

## 2. 資料層新增（packages/crm；migration 同步 `migrations/` 與 `migrations-pg/` 兩套）

**migration 012_admin.sql**：
- `orgs` 加 `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))`。
- `users` 加 `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'))`。
- `usage_events` 加 `user_id TEXT`（nullable，無 FK，比照 org_id denormalize）。
- SQLite 對既有表加欄用 `ALTER TABLE ... ADD COLUMN`（CHECK 隨欄宣告即可，不必重建表）。
- **裁決（2026-07-09）**：packages/shared 的 `OrgMember`（/api/org/members 產品接縫）**不加** `status?`——admin §4 #5 的 members 形狀由 `admin-routes` 自己的回應型別直接從 DB 取 status，產品契約不動。shared 只同步 `UsageEvent.userId?`（已做）。

**停權語意（enforcement 點，全部要做）**：
- `POST /api/auth/login`／`/google`：user.status 或其 org.status = suspended → 403 `{error:"account suspended"}`。
- `authRequired` 之後的**集中攔截**：新 middleware `activeAccountRequired`（查 org+user status，兩張小表可接受每請求查詢；SQLite/pg 皆快），套在 crm/research/decks/train/meetings/org 各 router 前（health/ready/auth 除外）。suspended → 403。
- WS 升級（`attachRealtimeWs`）沿用同檢查。

**usage_events.user_id 回填寫入點**：`Meter.meter` 簽名擴充為可選 `userId`（不破壞既有呼叫）；
request-scoped 寫入點（generation、research enrich/ground、image job 建立、embedding query）從 `req.auth.userId` 傳入；
無 request 脈絡的（背景 job 內部步驟）可傳 job.requested_by 或留 NULL。

## 3. 記帳缺口修補（讓「token 花費」真的完整——使用者痛點 #2）

依地基報告缺口 2/3/4/6，全部補：
1. **ASR 記帳**：ASR provider 轉寫成功後 `meter(orgId,'asr',...)`，idemKey 用 meetingId+chunk 序號（冪等）；token 欄 NULL、est_cost 依 pricing `asr` fallback（分鐘或 chunk 計，pricing.ts 補註記單位）。
2. **gemini_live 記帳**：train session 結束（或 token 簽發）時記一筆 `gemini_live`（無精確 token 就記次數＋估值；註明估算）。
3. **會中分析記帳**：`analysis/gemini-analysis.ts:108` 改走 `meteredGeminiClient`（kind=`gemini_text`、meetingId 歸屬）。
4. **pricing 環境覆寫落地**：實作 `loadPricingOverrides()`（`PRICING__<MODELKEY>__INPUT_PER_M` 等，boot 時讀），
   兌現 `pricing.ts:52` 註解；README/.env.example 補說明。est_cost_usd 仍為寫入時凍結值（不回溯）。

## 4. Admin API（apps/server 新增 `src/admin-routes/`，掛 `/api/admin`，全部 `platformAdminRequired`）

跨 org 查詢一律走 raw `DbPort`（`ports.ts:89-92`）的新模組 `apps/server/src/admin-routes/admin-queries.ts`；SQL 需同時相容 SQLite/PG（比照既有 repo 寫法）。

| # | 端點 | 回傳形狀（欄位名固定，實作不得自創） |
|---|---|---|
| 1 | `GET /api/admin/overview` | `{ costUsd:{today,last7d,last30d}, orgs:{total,suspended}, users:{total}, jobs:{running,failedLast7d,doneLast7d}, health:{ready:boolean} }` |
| 2 | `GET /api/admin/usage?from&to&groupBy=org\|kind\|model\|day` | `{ from,to,totalCostUsd,totalInputTokens,totalOutputTokens,rows:[{key,orgName?,events,inputTokens,outputTokens,costUsd}] }`（groupBy=org 時附 orgName；day 用 UTC `YYYY-MM-DD`） |
| 3 | `GET /api/admin/usage/events?from&to&orgId?&kind?&limit=50&offset=0` | `{ total, items:[{id,orgId,orgName,userId,userEmail?,kind,model,inputTokens,outputTokens,estCostUsd,meetingId,createdAt}] }`（明細頁；limit 上限 200） |
| 4 | `GET /api/admin/orgs?query?&status?` | `{ items:[{id,name,status,plan,createdAt,memberCount,costUsd30d}] }` |
| 5 | `GET /api/admin/orgs/:id` | `{ org:{id,name,status,plan,createdAt}, members:[{userId,email,displayName,role,status}], invites:[{id,email,role,acceptedAt,expiresAt}], usage30d:{costUsd,byKind[]}, recentJobs:[≤10 筆同 #7 item 形狀] }`（invite **不回 token**，A3） |
| 6 | `PATCH /api/admin/orgs/:id/status`＋`PATCH /api/admin/users/:id/status` | body `{status:'active'\|'suspended'}` → 回 `{id,status}`；不得停權「含平台管理員的 user」自鎖（400） |
| 7 | `GET /api/admin/jobs?status?&mode?&orgId?&from&to&limit=50&offset=0` | `{ total, items:[{id,orgId,orgName,targetType,targetId,targetName?,mode,status,error,createdAt,startedAt,finishedAt,durationMs,queueMs}] }`（durationMs/queueMs server 端算好） |
| 8 | `GET /api/admin/jobs/stats?days=14` | `{ days:[{date,queued,running,done,failed}], failRatePct, avgDurationMs, topErrors:[{error,count}≤10] }`（topErrors 以 error 前 120 字元正規化分組） |
| 9 | `GET /api/admin/health` | `{ ready:boolean, db:{driver,ok}, providers:{gemini:boolean,openai:boolean}（只回「已設 key」布林，不驗即時連通）, liveMeetings:number, uptimeSec:number, version:string（env K_REVISION 或 git sha，無則 "dev"） }` |

| 10 | `GET /api/admin/pricing` | `{ rows:[{kind,model,inputPerM?,outputPerM?,perImage?,source:'default'\|'env'}], disclaimer:string }`（v1.2 增補：呈現現行 PRICING 常數與 env 覆寫結果；唯讀，A2 相容） |

錯誤格式沿用全域 error middleware `{error:string}`；分頁參數非法 → 400。

**v1.2 裁決**：所有時間戳欄位（createdAt/startedAt/finishedAt/acceptedAt/expiresAt）一律 **epoch ms number**（與 DB 慣例一致）；§4 #5 `usage30d.byKind[]` 元素＝`{kind,costUsd}`；#3 events 篩選維持 orgId/kind/from/to 四項（groupBy=model/day 的 drawer 用日期近似，屬已接受的能力限制）。

## 5. apps/admin（Next.js 15 獨立 app）

- **技術**：Next.js 15 App Router、TypeScript、**純 CSS＋自繪 SVG 圖表**（沿用 apps/web 慣例；不引圖表庫）、`output:"standalone"`。**UI 語言 zh-TW 單語**（不裝 next-intl）。
- **API base**：`NEXT_PUBLIC_API_BASE`（build-time bake，同 web 慣例）。JWT 存 localStorage（同 web 慣例），fetch 帶 Bearer。
- **頁面（route → 內容）**：
  - `/login`：email+密碼＋（若 GOOGLE_CLIENT_ID 有設）Google 登入；登入後檢查 `/api/auth/me`＋admin 端點探測，非 platformAdmin → 顯示「此帳號非平台管理員」並登出。
  - `/`（總覽）：#1 overview 卡片列（今日/7日/30日花費、org/user 數、job 失敗數、ready 燈）＋ 30 日花費**折線圖**＋ byKind **圓環圖**。
  - `/usage`：日期範圍選擇器（預設 30 天）＋ groupBy 切換（org/kind/model/day）表格＋長條圖；點列 → 明細 drawer（#3 分頁表格）。附「定價為估算值」免責說明＋現行 PRICING 表呈現。
  - `/orgs`：#4 表格（搜尋、status 篩選、停權/復權按鈕含二次確認 dialog）；點列 → `/orgs/[id]`（#5：成員表＋角色＋用量＋近期 job＋成員停權按鈕）。
  - `/jobs`：#7 表格（status/mode 篩選、時間範圍、error 展開顯示全文、耗時/排隊欄）＋頂部 #8 統計（14 日堆疊長條＋失敗率＋topErrors 清單）。
  - `/health`：#9 全欄位卡片＋手動重新整理；ready=false 顯著紅。
- **共用 UI**：側欄導航（總覽/花費/組織/Jobs/健康）＋頂欄（登入者 email、登出）；表格元件（排序、分頁）；日期範圍元件；空狀態與錯誤狀態一律有文案（不可白屏）。
- 桌面優先（管理工具），最低支援 1280px；行動裝置僅求不破版。

## 6. CORS 與部署

1. `index.ts:60-75` 單一 origin 改 **allowlist**：`WEB_ORIGIN`＋新 env `ADMIN_ORIGIN`＋dev 預設（`http://localhost:3000`,`http://localhost:3100`）。逐字比對改 `Set.has(origin)`；其餘標頭行為不變。
2. admin dev port 固定 **3100**（避開 web 3000）。
3. 部署新增（比照 web）：`Dockerfile.admin`（抄 `Dockerfile.web` 改 apps/admin）、`cloudbuild-admin.yaml`（抄 web 版，image `meetcopilot-admin`，substitutions `_API_BASE`）。
   **兩個既有 Dockerfile 的 COPY manifest 都要補 `apps/admin/package.json`**（deploy-flow 報告易漏點：`Dockerfile.server:23-27`、`Dockerfile.web:20-24`，否則 `npm ci` lockfile 對不上）。
4. `docs/DEPLOY.md` 補：admin service 部署節（`gcloud builds submit --config=cloudbuild-admin.yaml --async` 輪詢→`run deploy meetcopilot-admin`）＋server 需 `--update-env-vars=ADMIN_ORIGIN=...,PLATFORM_ADMIN_EMAILS=...`。
5. **實際 gcloud 部署由使用者核准後才執行**（硬規則 10）；本輪先交付檔案與文件。

## 7. 驗收（B-verify agent 依此逐項）

1. typecheck 全 workspace 綠（含新 apps/admin）；既有測試全過（server 36+、crm 43+）。
2. migration 012 兩套皆可從空庫跑到 head；既有庫升級不毀資料（SQLite ALTER ADD COLUMN 路徑實測）。
3. **A1 攻擊測試**：一般 owner token 打全部 9 個 admin 端點 → 403；無 token → 401；admin token → 200。
4. 停權 e2e：suspend org → 該 org 成員 login 403、既有 token 打 crm 403、health/ready 不受影響；復權後恢復。
5. 記帳補洞驗證：本機觸發一次生成＋一次 enrich（若 key 可用），`usage_events` 出現含 user_id 的新列；analysis 路徑改 metered 後 typecheck＋單測。
6. admin 前端：`npm run build` 綠；用 admin 帳號實跑六頁（Playwright 截圖）皆渲染、無 console error、空資料有空狀態。
7. fresh-context read-back：A1/A2/A3 逐條、CORS allowlist 不破既有 web、I1/I2/I3 未觸及。

## 8. 版本紀錄

- v1.3（2026-07-20）：**AI 記帳細化（對齊 ezpage 底層 per-call ledger）＋運行時安全網**（使用者拍板「全面對齊 ezpage」＋稅率 ×1.25 套全部 AI）。
  - **migration 019**（SQLite+PG，ALTER usage_events）：加 `reasoning_tokens`／`cached_input_tokens`（token 五桶＋差別計價：reasoning≈output、cached 較便宜）、`retry_count`、`cost_tax_multiplier`（每列稅率快照，NOT NULL DEFAULT 1.25；含稅＝est_cost_usd × 此值）。**`est_cost_usd` 語意不變＝稅前**，故 §4 #2/#3 admin 端點形狀**不變**（admin 續呈稅前，A1/A2/A3 不受影響）。
  - **記帳管線**：gemini.ts 取 usageMetadata 的 thoughts/cached；pricing.ts 加 reasoning/cached 分桶單價＋`taxMultiplierFor`／`DEFAULT_TAX_MULTIPLIER`（env `COST_TAX_MULTIPLIER`）；meter-impl 記稅前＋每列稅率快照＋五桶 token。
  - **運行時安全網**（`ops/metering-context.ts`＋`metering-middleware.ts`）：AsyncLocalStorage 計費脈絡（realtime hub 每場＋AI-using request 邊界），raw GeminiClient 公開方法補記未經 metered wrapper 的呼叫；explicit metering 期間抑制以防雙記。對既有已記帳路徑零影響（走 Metered 變體、且被抑制）。
  - **org-scoped 花費呈現**（非本契約的平台 admin 範圍）：apps/web `/spend`（owner/admin）走新 `GET /api/org/usage(+events)`，回稅前＋含稅（每列稅率加總）＋reasoning/cached/retry 明細。與 apps/admin 平台主控台並存不重疊。
- v1.0（2026-07-09）：初版凍結。
- v1.1（2026-07-09）：吸收 ezpage admin 解剖（`C:\tmp\meetcopilot-recon\ezpage-admin.md`）——
  (a) 驗證模式獲印證（ezpage＝Google OAuth＋後端 email allowlist＋is_admin 布林，與 §1 同構，維持原設計）；
  (b) §5 UI 借「模式」不借「棧」：KPI 卡含 inline-SVG sparkline、StatusBadge、job 監控頁（狀態篩選＋表格＋分頁）、資料驅動側欄 config——一律以純 CSS＋自繪 SVG 重寫，不引 Tailwind/recharts/TanStack；
  (c) v2 backlog（本輪不做）：cost-estimator 計算機頁、以 image digest 遙控部署/promote 的 deploy 頁、HttpOnly cookie 取代 localStorage。
  接縫（§1–§4、§6–§7）無變更。
