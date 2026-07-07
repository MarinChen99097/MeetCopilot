# M5 內部契約（整合／隱私／生產強化／上線）

> M5 平行實作的接縫凍結檔。決策 6/20：先本機、成品 SaaS、部署 GCP 單 VM。這裡定隱私模型、成本 schema、限流政策、部署拓撲，agent 照做。改接縫→先改本檔＋記 ROM。

## 共通
- 沿用既有慣例（async DbPort、org_id、no FK、tx、L13 有界、L15 分模型）。
- **實際 GCP provisioning 屬使用者前置（帳號/帳單/網域），M5 只產「程式碼＋部署產物＋runbook」，不跑 `gcloud`／不做外部不可逆動作。**

## A. 隱私（PRODUCT_SPEC 資料與隱私的落地）
- **同意閘**：會中未收到 WS `consent{granted:true}` 前，**不做分析、不落任何逐字稿**（M3 已有 consent 欄，M5 確保 analysis/persist 都 gate 在它後面，加測試）。
- **逐字稿預設記憶體即棄**：`meetings` 加 `persist_transcript INTEGER DEFAULT 0`、`retention_days INTEGER`。persist=0（預設）→ 逐字稿只在 SessionRuntime 記憶體，**不寫 `meeting_transcript_segments`**；會後 dispose 即棄。persist=1→才寫 DB。**訊號（signals）**＝衍生、較不敏感，可持久（供回寫 CRM）。
- **PII 遮蔽**：一個 `redactPii(text)` 純函式（email/電話/信用卡樣式→遮罩），套在 **(a) 送 LLM 分析前**（不必要的原始 PII 不外送）與 **(b) 落 DB 前**。萃取/回寫 CRM 的欄位不含被遮的原始 PII。
- **TTL 清理**：啟動時＋每日一次，purge 超過 `retention_days`（預設 30）的已持久逐字稿。
- **CSP/sanitize**：web 加 CSP 標頭；LLM 生成內容落 DOM 前 sanitize（沿用 v1）。

## B. 成本記帳（migration 009）
- `usage_events`：`id, org_id, kind CHECK('gemini_text','gemini_extract','gemini_live','openai_image','embedding','asr'), model, input_tokens, output_tokens, est_cost_usd REAL, meeting_id(nullable), idempotency_key UNIQUE(org_id,idempotency_key), created_at`。
- 所有 LLM/生圖/embedding 呼叫**經一個 `meter(orgId, kind, fn, idemKey)` 包裝**冪等記一筆（借 v1 記帳；token 數取 API usage 欄，無則估）。`GET /api/usage?from=&to=` 回 per-org rollup（kind 分組＋總成本）。定價常數集中一處。

## C. 生產強化（apps/server 中介層）
- **限流**：per-org＋per-IP token bucket（記憶體即可）套在貴的端點（`/decks/generate`、`/research/enrich`、`/decks/:id/image-jobs`、`/train/sessions`）；超限回 429 `{error}`。
- **結構化 log**：JSON（requestId、orgId、method、path、status、latencyMs）；**絕不 log 祕鑰/JWT/PII/逐字稿**。
- **健康/就緒**：`/api/health`（存活，已有）＋`/api/ready`（DB 可達才 200）。
- **安全標頭**：helmet 式（X-Content-Type-Options、Referrer-Policy、HSTS〔prod〕、CSP）。
- **優雅關機**：SIGTERM→停收新連線、關 WS、dispose 所有 SessionRuntime、close DB。
- **清理**：刪孤兒 `apps/server/src/ws.ts`（M0 死碼）；`npm audit` 高危 triage（能升則升，不能則記 ROM）。

## D. 邀請制成員管理（決策 20：無計費、邀請制；migration 009）
- `invites`：`id, org_id, email, role CHECK('admin','member'), token UNIQUE, invited_by, accepted_at, expires_at, created_at`。
- 路由：`POST /api/org/invites`（owner/admin 發，回 invite 連結）、`GET /api/org/invites`（列）、`DELETE /api/org/invites/:id`（撤）、`POST /api/org/invites/accept {token}`（登入者接受→建 membership）、`GET /api/org/members`／`PATCH /api/org/members/:userId`（改角色）／`DELETE`（移除，不可移除唯一 owner）。
- web `/[locale]/settings/team`：成員清單＋角色、發邀請（顯示連結）、撤銷/移除。owner/admin 才可見。

## E. 部署產物（不跑 gcloud，只產檔）
- `Dockerfile.server`（Node 22＋**Playwright chromium 系統依賴**＋build shared/crm/server dist＋`npx playwright install --with-deps chromium`）。
- `Dockerfile.web`（Next.js standalone build）。
- `docker-compose.yml`：`server`（掛持久 volume 給 SQLite `/data`）、`web`、`caddy`（反代＋Let's Encrypt 自動 TLS，站台網域從 env）。
- `Caddyfile`：`${DOMAIN}` → web（/）＋server（/api、/ws 需 websocket 反代）；自動 HTTPS。
- `scripts/backup.sh`：每日 `sqlite3 .backup` 到時間戳檔（GCE 上再配磁碟 snapshot）。
- `.env.production.example`：prod 所有 key（JWT_SECRET 換強隨機、DOMAIN、NEXT_PUBLIC_API_BASE=https網域）。
- `docs/DEPLOY.md`：**使用者上線 runbook**——建 GCE VM（e2-small 起）、裝 Docker、拉 repo、填 .env.production、`docker compose up -d`、指 DNS A record 到 VM、Caddy 自動發憑證、設每日磁碟 snapshot＋backup.sh cron。列清楚哪些是使用者要做的（GCP 專案/帳單/網域/OpenAI 組織驗證）。

## F. 整合冒煙（M5 驗收，fresh-context 全鏈路）
會前 register→建 company→enrich 填 CRM（真爬蟲）→（選）建 verified persona→startSession 語音 token；會中 create meeting→WS consent→注入逐字稿→**PII 被遮**→訊號→CRM 檢索 info_card→suggest→presenter accept→append 到 deck 尾（I1）→page_commit；會後 end→（persist=0 則逐字稿不留 DB）→訊號經批准回寫 contact；成本 events 有記；/api/usage 有數；限流/health/ready/安全標頭生效；邀請→接受→跨 org 仍隔離。typecheck＋全測試綠。
