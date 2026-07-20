# ✅ 實際上線紀錄（2026-07-08，Cloud Run + Cloud SQL，ezpagesite 專案）

> 本產品**已實際部署到 GCP 並驗證通過**（改用 Cloud Run + Cloud SQL，非下方原 VM 方案——因使用者要 scale-to-zero＋建了 SQL DB）。下方「GCP 單 VM」章節保留為**自架替代方案**（此次未採用）。

**現況（live）**
- 前端 Web：**https://meetcopilot-web-54139295474.asia-east1.run.app**
- 後端 API/WS：**https://meetcopilot-server-54139295474.asia-east1.run.app**（`/api/health`＋`/api/ready` 皆 200；register→me 端到端過；CSP 已指向 server https/wss＋Gemini Live）
- DB：Cloud SQL Postgres 16 `ezpagesite:asia-east1:meetcopilot-db`（db-f1-micro）
- Secrets：`meetcopilot-{jwt-secret,gemini-key,openai-key,db-url}`（Secret Manager）
- Cloud Run：`meetcopilot-server`（min=0/max=1/cpu=2/mem=4Gi/gen2/CloudSQL/WS 3600/session-affinity）、`meetcopilot-web`（min=0/max=2/cpu=1/mem=1Gi）
- 影像：`asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/{server,web}`

**目前版本（2026-07-20 /sim 實測修復輪：HUD markdown/欄寬、補充頁重疊、匯入抽色風格對齊、pptx WYSIWYG）**：server **`meetcopilot-server-00019-mzw`**、web **`meetcopilot-web-00015-kzp`**（commit `606f7ee`；build server `df93c5e7-263f-43a0-9a67-a9edb376aac4`／web `615c9d03-2ae8-40ef-ab27-6d9495cfa964` 皆 SUCCESS；**本輪無新 migration**；**+pngjs 相依**（server 匯入頁抽色，純 JS 無原生建置）；server 走 `services update --image` **保 env**（含 rev 00018 補的 `WS_PUBLIC_BASE`＋`--no-cpu-throttling`，env count 18 未吹）；web `run deploy` 帶 `--set-env-vars=NEXT_PUBLIC_API_BASE`；改動＝apps/web（HUD markdown 共用元件/欄寬單欄、SlideRenderer 抽色 accent-2/-3、studio-present features/two-col 重疊修）＋apps/server（import/palette.ts 抽色、conversion-job 帶 theme、slide-gen prompt、pptx-render chartPalette 對齊螢幕）；驗證 server 47 檔 269 測＋web build 18 路由＋前後端 typecheck 全綠；冒煙全綠：`/api/health`+`/api/ready` 200＋web `/`307＋`/zh-TW`·`/zh-TW/sim`·`/zh-TW/spend` 200＋`/api/org/usage` unauth 401。**中間 rev 00018-47r**＝WS_PUBLIC_BASE 補設（realtime WS 修復，見排錯速記）。）前版（2026-07-20 四輪：DynamicSlide 補充頁橋接+mp3 會議模擬器／AI 記帳完整化並對齊 ezpage／org 花費頁）：server **`meetcopilot-server-00017-dl5`**、web **`meetcopilot-web-00014-qpq`**（commits `569f9ea` feat(server)＋`139dc61` feat(web)＋`b26c682` docs；push origin main `2f98231`→`b26c682`；build server `9a008cb0-7271-48e1-9ea3-4c27709ce641`／web `75d51e1b-42db-4eb0-bd02-217cd23a9213` 皆 SUCCESS；**新 migration `019_usage_detail` 開機自動套**（usage_events 加 reasoning_tokens/cached_input_tokens/retry_count/cost_tax_multiplier；`ready:true`＋`listening on :8080` 佐證 PG migrate() 過——019 若失敗會 crash boot）；**packages(shared/crm)＋server＋web 皆重建**（本 session 動到三者）；`services update --image` 保 env＋`--no-cpu-throttling`；web `run deploy` 帶 `--set-env-vars=NEXT_PUBLIC_API_BASE`；**無新必填 boot env**（`COST_TAX_MULTIPLIER`/`SUPPLEMENT_AUTO_LIMIT_PER_MEETING`/`SUPPLEMENT_THROTTLE_MS` 皆有預設）；冒煙全綠：`/api/health`+`/api/ready` 200＋web `/` 307＋`/zh-TW` 200＋`/zh-TW/spend` 200（新花費頁）＋`/api/org/usage` unauth 401（新端點 mounted+guard）＋`/api/auth/google` bogus 401；開機 log 無 error（GOOGLE_CSE/YOUTUBE/PLATFORM_ADMIN 缺鑰 warning 屬預期）。待使用者：本機用 `/sim` 模擬器需 GEMINI_API_KEY＋poppler；`/spend` 需 owner/admin 登入且跑過 AI 才有數字。）前版（2026-07-19 三指令輪：筆記 md 渲染／社群真內容／照片 v3）：server **`meetcopilot-server-00016-dtp`**、web **`meetcopilot-web-00013-w8v`**（commits `ab7f3ed` feat(research) 社群真內容——YT 無金鑰抓取/Threads 推導＋登入牆偵測/FB·IG AI 摘要/二次抓取＋筆記來源全解析＋照片 v2/v3（DOM 鄰近＋Google CSE）、`822923f` feat(web) 筆記 markdown 渲染（react-markdown/無 raw HTML/連結白名單）、`0dcef09` docs；push origin main `4d8d78d`→`0dcef09`；build server `f15ce324-99f5-4895-91b7-fbb9d9a72fbb`／web `0f1c0d68-6b8b-463a-8398-796a41f1d66a` 皆 SUCCESS；**本輪無新 migration**（016/017/018 前次部署已套、開機 log 無 migration 動作）；`services update --image` 保 env＋`--no-cpu-throttling`；冒煙 `/api/health`+`/api/ready` 200＋web `/` 307＋`/zh-TW` 200＋開機 log 無 error（GOOGLE_CSE/YOUTUBE 缺鑰 warning 屬預期））。前版（2026-07-19 DynamicSlide 匯入重構＋研究/社群/會中導覽擴編）：server **`meetcopilot-server-00015-xbb`**、web **`meetcopilot-web-00012-xmx`**（merge `55b812c`＝並行 research/社群/導覽工作 `ee2468a`＋DynamicSlide 匯入重構 `bf88fd9`，push origin main；build server `b98dad17-c0b6-4652-beb2-44527a68ca7d`／web `8d5e7f6a-5686-4dba-95cd-2a36d3e67c45` 皆 SUCCESS；**新 migration 016_social_tech/017_more_mode/018_deck_import 開機自動套**（ready:true＋reaper 查 import_jobs/deck_assets 無錯佐證）；**server Dockerfile 新增 LibreOffice-impress+poppler-utils+fonts-noto-cjk（image +~1GB，供 pptx/pdf→PNG 轉檔）**；DynamicSlide 新選配 env 皆有預設未動；`services update --image` 保 env＋`--no-cpu-throttling`；冒煙 `/api/health`+`/api/ready` 200＋web `/` 307＋`/zh-TW` 200＋開機 log 無 error＋3 reaper 0 孤兒）。前版（2026-07-18 研究引擎擴編）：server `meetcopilot-server-00013-8ms`、web `meetcopilot-web-00011-89t`（commits `6b6025f` feat(research) 引擎擴編——雙語查詢/五新角度/升模/深讀12/渲染 fallback/per-contact/商機/產品外部回填/二段式深抽/MAX_TOKENS/504 修復＋`c38291d` feat(web) ProductsTab 明細補 render＋`0d9c95c` docs；build server `fbec48f0`／web `ac85d0d8` 皆 SUCCESS；本輪無 migration；冒煙 `/api/health` 200＋`/api/ready` 200＋web `/` 307＋`/zh-TW` 200、開機 log 無 error、reaper 0 筆孤兒；`--no-cpu-throttling` 保留）；前版 server 00012-drd／web 00010-lmf（`6826567` feat(research)＋`92020ed` feat(web)＋`95de538` docs：CRM 品質四修——migration 015 五欄＋爬蟲抓圖＋型號/中文名/繁中優先 UI＋研究 job 開機 reaper；`--no-cpu-throttling`＝CPU always-allocated 已套、保留至今）。

> ⚠️ **長研究 job 需 CPU always-allocated（RESEARCH_UPGRADE_CONTRACT WP3，2026-07-13 註記；2026-07-17 部署時已套用）**：研究引擎現走「深與廣（30–60 分鐘級）」——`RESEARCH_JOB_TIMEOUT_MS` 預設 60 分、`CRAWL_HARD_CAP_MS` 30 分、多輪 grounding ≤20 分、社群 fetch ≤10 分。Cloud Run 預設**只在處理請求時分配 CPU**（enrich 走背景 fire-and-forget，HTTP 回應在 202 後結束）→ 回應一結束背景 job 就會被凍結/停擺。部署此版時**必須**對 `meetcopilot-server` 加 `--no-cpu-throttling`（CPU always allocated），否則長 job 永遠跑不完（卡在「研究中」）。本輪不改部署，實際部署時再處理。
> 範例：`gcloud run services update meetcopilot-server --region=asia-east1 --project=ezpagesite --no-cpu-throttling`（注意：CPU always-allocated 會提高閒置成本，需搭配 min-instances/max-instances 評估）。

---

## 🚀 重新部署 SOP（改程式後——這是 2026-07-08 session 實際用、驗證可行的流程）

> 前置：已在 `ezpagesite` 同帳號授權過，**直接 `gcloud` 即可，不需重新登入**。變數：`PROJECT=ezpagesite`、`REGION=asia-east1`。
> **黃金守則**：改 `apps/server` 或 `packages/*` → 重建 **server**；改 `apps/web` → 重建 **web**（`NEXT_PUBLIC_*` 是 build 期常數，光重啟無效！）；跨兩者 → **各自都要重建**。

### A) 最常用：只改程式、沒改 env/secret
```bash
# ── server（含 Playwright；migration 於開機自動套，新增 migration 就靠這步上）──
gcloud builds submit --config=cloudbuild-server.yaml --region=asia-east1 --project=ezpagesite --async .
#   ↑ 回一個 BUILD_ID。gcloud 會等到超過「工具 2 分鐘逾時」→ 一律用 --async，再輪詢直到 SUCCESS：
gcloud builds describe <BUILD_ID> --region=asia-east1 --project=ezpagesite --format="value(status)"
gcloud run services update meetcopilot-server --region=asia-east1 --project=ezpagesite \
  --image=asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/server:latest
#   ↑ services update --image：只換 image、**完整保留現有 env/secret**（不會吹掉 DB_DRIVER/WEB_ORIGIN/GOOGLE_CLIENT_ID…）

# ── web（改了 apps/web 才需要；_API_BASE/_GOOGLE_CLIENT_ID 於 build 時 bake 進去）──
gcloud builds submit --config=cloudbuild-web.yaml --region=asia-east1 --project=ezpagesite --async \
  --substitutions=_API_BASE=https://meetcopilot-server-54139295474.asia-east1.run.app,_GOOGLE_CLIENT_ID=54139295474-f7cve65n4884ttkcbc2o23hs763q7hm4.apps.googleusercontent.com .
# 等該 BUILD_ID SUCCESS 後：
gcloud run deploy meetcopilot-web --region=asia-east1 --project=ezpagesite \
  --image=asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/web:latest \
  --min-instances=0 --max-instances=2 --cpu=1 --memory=1Gi \
  --set-env-vars=NEXT_PUBLIC_API_BASE=https://meetcopilot-server-54139295474.asia-east1.run.app --allow-unauthenticated

# ── admin（第三個 service；改了 apps/admin 才需要。與 web 同構：_API_BASE/_GOOGLE_CLIENT_ID 於 build 時 bake）──
gcloud builds submit --config=cloudbuild-admin.yaml --region=asia-east1 --project=ezpagesite --async \
  --substitutions=_API_BASE=https://meetcopilot-server-54139295474.asia-east1.run.app,_GOOGLE_CLIENT_ID=54139295474-f7cve65n4884ttkcbc2o23hs763q7hm4.apps.googleusercontent.com .
# 等該 BUILD_ID SUCCESS 後（首次建服務見 E；admin 無 secret/CloudSQL，故首次與後續 deploy 指令相同。
#   NEXT_PUBLIC_* 是 build 常數 → 每次改 apps/admin 都要重建 image 並重帶 --set-env-vars）：
gcloud run deploy meetcopilot-admin --region=asia-east1 --project=ezpagesite \
  --image=asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/admin:latest \
  --min-instances=0 --max-instances=1 --cpu=1 --memory=1Gi \
  --set-env-vars=NEXT_PUBLIC_API_BASE=https://meetcopilot-server-54139295474.asia-east1.run.app --allow-unauthenticated
```

### A 補充：traffic 沒切到新 revision 時的保險（`update-traffic --to-latest`）

> ⚠️ `gcloud run services update` / `run deploy` 部署了新 revision，但**若該服務的 traffic 曾被釘死在某個特定 revision**（例如先前做過流量拆分或 rollback，`latestRevision` 已從 true 變成固定 revision），新 revision 會拿到 **0% 流量**——你的程式看似沒生效、`curl` 還是舊行為。

**什麼時候要跑**：部署（A 或 D）後跑冒煙測試（C）發現「改了程式卻沒生效、且已確認重建了正確那邊」，先用下面指令查 traffic 是否卡在舊 revision；卡住就切回最新：

```bash
# 查目前 traffic 分佈（看 LATEST 那列 percent 是否 100）
gcloud run services describe meetcopilot-server --region=asia-east1 --project=ezpagesite \
  --format="value(status.traffic)"
# 若新 revision 不是 100% → 把 traffic 切回最新 revision：
gcloud run services update-traffic meetcopilot-server --to-latest --region=asia-east1 --project=ezpagesite
# web 同理（服務名換 meetcopilot-web）
```

> 正常情況下 `services update --image` / `run deploy` 會自動把 traffic 帶到最新，**不需每次都跑**；此指令是「traffic 被 pin 住」時的修正保險，冒煙測試異常才用。

### B) 只改一個 env（不必重建 image）
```bash
gcloud run services update meetcopilot-server --region=asia-east1 --project=ezpagesite \
  --update-env-vars=RESEARCH_JOB_TIMEOUT_MS=600000
#   ⚠ 用 --update-env-vars（只動這個 key）。**千萬別用 --set-env-vars 或完整 run deploy**——那會覆寫「全部」env，把 DB/CORS/Google/Gemini 設定吹光。
```

### C) 冒煙測試（每次部署後必做）
```bash
curl -s https://meetcopilot-server-54139295474.asia-east1.run.app/api/health   # 期望 {"ok":true}
curl -s https://meetcopilot-server-54139295474.asia-east1.run.app/api/ready    # 期望 {"ready":true}＝DB 通、開機 migration 已套
# web：curl -s -o /dev/null -w "%{http_code}" .../  → 307（locale 轉址，正常）
```

### D) 首次建立服務 / 需重設「全部」env 時（才用完整 run deploy）
```bash
gcloud run deploy meetcopilot-server --image=asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/server:latest \
  --region=asia-east1 --project=ezpagesite --execution-environment=gen2 --min-instances=0 --max-instances=1 --cpu=2 --memory=4Gi \
  --add-cloudsql-instances=ezpagesite:asia-east1:meetcopilot-db \
  --set-secrets=JWT_SECRET=meetcopilot-jwt-secret:latest,GEMINI_API_KEY=meetcopilot-gemini-key:latest,OPENAI_API_KEY=meetcopilot-openai-key:latest,DATABASE_URL=meetcopilot-db-url:latest \
  --set-env-vars=DB_DRIVER=pg,WEB_ORIGIN=https://meetcopilot-web-54139295474.asia-east1.run.app,WS_PUBLIC_BASE=wss://meetcopilot-server-54139295474.asia-east1.run.app,GOOGLE_CLIENT_ID=54139295474-f7cve65n4884ttkcbc2o23hs763q7hm4.apps.googleusercontent.com,GEMINI_TEXT_MODEL=gemini-3.1-flash-lite,GEMINI_EXTRACT_MODEL=gemini-3.5-flash,GEMINI_EMBED_MODEL=gemini-embedding-001,GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview,OPENAI_IMAGE_MODEL=gpt-image-2,OPENAI_IMAGE_SIZE=1536x864,OPENAI_IMAGE_QUALITY=medium,RESEARCH_AUTO_LIMIT_PER_MEETING=10,RESEARCH_JOB_TIMEOUT_MS=600000 \
  --allow-unauthenticated --timeout=3600 --session-affinity
# ⚠ WEB_ORIGIN 必帶（CORS）；GOOGLE_CLIENT_ID 必帶（沿用 EZpage 的 client，共用帳號）。
# ⚠ WS_PUBLIC_BASE 必帶（**realtime WS**）：POST /api/meetings 用它組 wsUrl 回前端；漏設 → fallback ws://localhost → /sim·/copilot·/hud 三個 realtime 面永遠「連線中」、收音 0%。須 wss://（https 頁不能連 ws://，且 web CSP connect-src 只放 wss://server網址）。2026-07-20 補（rev 00018 起）。
# ⚠ Google 登入前置（一次性、只有使用者能做）：Console 把 meetcopilot-web 兩個網址加進該 OAuth client 的「已授權 JavaScript 來源」。
```

### E) 新增 meetcopilot-admin（第三個 service）：一次性 server 端接線

> admin 是純前端 Next.js 後台（同 web 架構、走 server REST/WS）。**admin service 自身**的 build→deploy 見 A 段的 admin 區塊（無 secret / 無 Cloud SQL，首次即用該 `run deploy`）。以下是**讓 server 認得 admin** 的一次性設定——因 admin 部署在第三個網址、且平台管理員名單放 server env。

```bash
# 1) server 加兩個 env（**用 --update-env-vars 只動這兩個 key，切勿 --set-env-vars / 完整 run deploy** —— 否則吹光 DB/CORS/Google/Gemini）：
gcloud run services update meetcopilot-server --region=asia-east1 --project=ezpagesite \
  --update-env-vars=ADMIN_ORIGIN=https://meetcopilot-admin-54139295474.asia-east1.run.app,PLATFORM_ADMIN_EMAILS=you@example.com
#   ADMIN_ORIGIN：server CORS allowlist 加入 admin 網址（server 端把單一 WEB_ORIGIN 改成 WEB_ORIGIN+ADMIN_ORIGIN 白名單；見 ADMIN_CONTRACT §6.1）。
#   PLATFORM_ADMIN_EMAILS：逗號分隔 email 清單；名單內帳號登入時 JWT 帶 platformAdmin=true，才能過 /api/admin/* 的 platformAdminRequired（§1）。
#   （敏感度低，明文 env 即可；若要更嚴可改放 Secret Manager 再 --set-secrets。）

# 2) 冒煙測試：admin 帳號 login 後打 admin 端點應 200；一般 owner token 打應 403；無 token 401。
curl -s https://meetcopilot-admin-54139295474.asia-east1.run.app/  -o /dev/null -w "%{http_code}\n"   # 期望 200/307
```

> ⚠ Google 登入前置（一次性、只有使用者能做）：Console 把 **meetcopilot-admin** 的 run.app 網址也加進該 OAuth client 的「已授權 JavaScript 來源」（不可結尾 `/`，約 5 分鐘生效），否則 admin 的 Google 登入會 `origin_mismatch`。
> 完整 `run deploy meetcopilot-server`（D 段）若日後需重設全部 env，記得把 `ADMIN_ORIGIN`、`PLATFORM_ADMIN_EMAILS`、`WS_PUBLIC_BASE` 一併補進 `--set-env-vars`，否則會漏掉這幾個。

### 排錯速記（本 session 踩過）
- **build 卡住/工具逾時** → `gcloud builds submit` 用 `--async`＋`gcloud builds describe <id> --format="value(status)"` 輪詢；build 在雲端續跑，不受本地 2 分逾時影響。
- **env 被吹光**（CORS 壞、Google 登入壞）→ 用了 `--set-env-vars`/完整 `run deploy` 只帶部分 env。改用 `--update-env-vars` 只動單一 key。
- **realtime 面永遠「連線中」／收音 0%**（/sim·/copilot·/hud，兩條 WS 都卡）→ server 漏設 `WS_PUBLIC_BASE`，`POST /api/meetings` 回 fallback `ws://localhost:8080/ws`，瀏覽器連不到 localhost（又被 CSP／mixed-content 擋）。修：`gcloud run services update meetcopilot-server --region=asia-east1 --update-env-vars=WS_PUBLIC_BASE=wss://meetcopilot-server-54139295474.asia-east1.run.app`（只動這 key）；設好後重開一場新會議（wsUrl 是開會當下鑄的）。2026-07-20 首次瀏覽器實測才抓到（先前只跑 HTTP 冒煙）。
- **改了程式卻沒生效** → 只重建了一邊。web 的 `NEXT_PUBLIC_*` 是 build 期常數，非重建 web 無效（光 `run services update` 或重啟都沒用）。
- **日誌**：app 自身 log 在 `logName:"stdout"` 的 `jsonPayload`（request log 在 `run.googleapis.com/requests`）；查研究 job：`gcloud logging read 'resource.labels.service_name=meetcopilot-server AND logName:"stdout"' --freshness=20m --format=json`。
- **Google 登入驗證**（不需真登入即可測後端就緒）：`curl -X POST .../api/auth/google -d '{"idToken":"bogus"}'` 應回 401「invalid Google credential」（端點已接）；`OPTIONS` 應回 204＋`access-control-allow-origin`。
**成本**：Cloud Run 閒置→$0；**Cloud SQL db-f1-micro 約 $8–10/月**（不 scale-to-zero）。合計閒置約 $8–12/月。
**還需使用者**：(1) OpenAI 組織驗證（否則 gpt-image-2 生圖被拒）；(2) 自訂網域可選（`gcloud run domain-mappings`；run.app 的 HTTPS 已足夠麥克風/擷取/Live）；(3) max>1 需先做 Redis 外部化 session。
**踩過的坑（已解）**：monorepo `tsc -b` 在 Cloud Build 乾淨 Linux 誤判 mtime（TS6305→shared 解析失敗）→ crm/server build tsconfig 改 `tsc -p`+paths→dist .d.ts。

---

# DEPLOY — MeetCopilot v2 上線 runbook（GCP 單 VM，替代方案／未採用）

> 決策 20：SaaS 成品、部署 GCP、邀請制（先不計費）。技術形態＝**單一 Compute Engine VM ＋持久磁碟**，用 Docker Compose 跑 `server`（含 Playwright）＋`web`＋`caddy`（自動 TLS）。
> 本檔只給指令與說明；**不含任何已執行的雲端動作**——所有 `gcloud`/`docker` 由你在自己的專案手動執行。

---

## 0. 為什麼是「單 VM ＋ SQLite」而不是 Cloud Run

- 資料庫是 **SQLite（better-sqlite3）**，需要一顆穩定、可讀寫的本機磁碟檔。**Cloud Run 檔案系統短暫**（容器重啟即消失、無法多實例共享一個 SQLite 檔），放不了正式資料。
- 研究引擎用 **Playwright/Chromium**（重、需系統依賴），常駐 VM 比每次冷啟容器划算。
- 因此形態＝**一台 e2-small GCE VM**，SQLite 檔放在**掛載的持久磁碟**，每日**磁碟快照＋`backup.sh`**雙保險。
- **未來擴充路（不動業務碼）**：量大時把 repository 層指到 **Cloud SQL for PostgreSQL（+pgvector）**；決策 7 已用 repository 隔離，遷移不改業務邏輯。

---

## 1. 使用者前置（你要先自己完成，Claude 無法代辦）

| # | 前置 | 說明 |
|---|---|---|
| 1 | **GCP 專案 ＋ 帳單帳戶** | console.cloud.google.com 建專案、綁定帳單。 |
| 2 | **網域** | 準備一個你控管 DNS 的網域（例：`meetcopilot.example.com`）。上線時把 A record 指到 VM 外部 IP。 |
| 3 | **OpenAI 組織驗證 ＋ tier 配額** | `gpt-image-2` 需組織通過驗證；先在 platform.openai.com 完成組織驗證並確認生圖 tier 配額（決策 15）。取得 `OPENAI_API_KEY`。 |
| 4 | **Gemini API key** | Google AI Studio 取得 `GEMINI_API_KEY`（文字/分析/embedding/Live 語音）。 |
| 5 | **強隨機 JWT_SECRET** | `openssl rand -base64 48`，貼到 `.env.production`。 |

> 平台硬約束（提醒終端使用者，非部署步驟）：會中「接收聲音」端限 **Chrome/Edge 桌面**；帳號 B 的 Meet 分頁與 Copilot 擷取分頁需**同一瀏覽器 profile**（決策研究回填 3）。

---

## 2. 建立 VM（在你的機器上跑 `gcloud`，或用 Console）

```bash
# 變數（自行替換）
export PROJECT=your-gcp-project
export ZONE=asia-east1-b            # 靠近使用者的 region
export VM=meetcopilot

gcloud config set project "$PROJECT"

# e2-small（2 vCPU / 2GB）起步；含 Playwright 建議至少 2GB，記憶體吃緊可升 e2-medium。
# 開機碟 30GB（映像＋Chromium＋SQLite＋備份）。允許 http/https。
gcloud compute instances create "$VM" \
  --zone="$ZONE" \
  --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --tags=http-server,https-server

# 防火牆（若專案還沒有預設規則）：放行 80/443
gcloud compute firewall-rules create allow-web \
  --allow=tcp:80,tcp:443 --target-tags=http-server,https-server \
  --direction=INGRESS 2>/dev/null || true

# 記下外部 IP（DNS 要用）
gcloud compute instances describe "$VM" --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

> SQLite 放在**開機碟**即可（30GB 綽綽有餘），用磁碟快照備份；不必額外掛第二顆盤。若要獨立資料盤，另建 pd-ssd 掛到 `/opt/meetcopilot/data` 再對它排快照。

---

## 3. 裝 Docker（SSH 進 VM 後）

```bash
gcloud compute ssh "$VM" --zone="$ZONE"     # 進到 VM

# Docker Engine + compose plugin（官方 convenience script）
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"             # 之後免 sudo（重新登入生效）
sudo apt-get install -y git sqlite3         # git 拉碼、sqlite3 給 backup.sh
exit                                        # 重新 SSH 讓群組生效
```

---

## 4. 拉 repo ＋ 填 `.env.production`

```bash
gcloud compute ssh "$VM" --zone="$ZONE"

sudo mkdir -p /opt/meetcopilot && sudo chown "$USER" /opt/meetcopilot
git clone <your-repo-url> /opt/meetcopilot
cd /opt/meetcopilot

cp .env.production.example .env.production
chmod 600 .env.production
nano .env.production          # 填：DOMAIN, ACME_EMAIL, NEXT_PUBLIC_API_BASE(=https://你的網域),
                              #     WEB_ORIGIN(=https://你的網域), JWT_SECRET, GEMINI_*, OPENAI_*
mkdir -p data                 # SQLite 持久目錄（compose 掛 ./data:/data）
```

**必填檢查**：`DOMAIN`、`ACME_EMAIL`、`NEXT_PUBLIC_API_BASE`、`WEB_ORIGIN`、`JWT_SECRET`、`GEMINI_API_KEY`、`OPENAI_API_KEY`。
`NEXT_PUBLIC_API_BASE`、`WEB_ORIGIN` 都要是 `https://<你的網域>`。

---

## 5. 指 DNS（在你的網域註冊商 / DNS 供應商）

- 新增 **A record**：`meetcopilot.example.com` → VM 外部 IP（第 2 步記下的）。
- 等 DNS 生效（`dig +short meetcopilot.example.com` 應回你的 VM IP）**再** `up`，否則 Caddy 首次發憑證會失敗（可重試）。

---

## 6. 建置並啟動

```bash
cd /opt/meetcopilot
# --env-file 讓 ${DOMAIN}/${NEXT_PUBLIC_API_BASE} 等在 compose 檔展開；--build 首次建置映像。
docker compose --env-file .env.production up -d --build
```

- 首次 `web` 映像建置會把 `NEXT_PUBLIC_API_BASE` **烤進前端 bundle 與 CSP**。
- `caddy` 在 80/443 上線後，會用 Let's Encrypt **自動簽發憑證**（需 DNS 已指向本機、80/443 可達）。
- 驗證：
  ```bash
  docker compose ps                                  # 三個服務 running；server healthy
  curl -sk https://<你的網域>/api/health             # -> {"status":"ok"} 或 200
  docker compose logs -f caddy                       # 看 TLS 憑證是否簽發成功
  ```

> ⚠️ **改網域＝要重建 web**：`NEXT_PUBLIC_API_BASE` 是建置期常數，改了要 `docker compose --env-file .env.production up -d --build web` 重建，光重啟無效。

---

## 7. 備份（磁碟快照 ＋ backup.sh 雙保險）

**(a) 每日磁碟快照**（GCP 排程，整碟層級）：
```bash
# 建一個每日快照排程並套到 VM 開機碟
gcloud compute resource-policies create snapshot-schedule daily-mc \
  --region=asia-east1 --max-retention-days=14 \
  --daily-schedule --start-time=18:00           # UTC；避開營運尖峰

gcloud compute disks add-resource-policies "$VM" \
  --zone="$ZONE" --resource-policies=daily-mc
```

**(b) SQLite 邏輯備份**（`scripts/backup.sh`，檔案層級、可快速還原單一 DB）：
```bash
# 在 VM 上加 cron（每日 03:17）。sqlite3 .backup 是線上備份，server 執行中也安全。
crontab -e
# 貼入一行：
17 3 * * * DB_DIR=/opt/meetcopilot/data BACKUP_DIR=/opt/meetcopilot/data/backups /opt/meetcopilot/scripts/backup.sh >> /var/log/meetcopilot-backup.log 2>&1
```
- 需 `sqlite3`（第 3 步已裝）。快照存到 `data/backups/*.db.gz`，保留 `BACKUP_RETENTION_DAYS` 天（預設 14）。
- 還原：`gunzip -c backups/meetcopilot_YYYYMMDD_HHMMSS.db.gz > data/meetcopilot.db` 後 `docker compose restart server`。

---

## 8. 日常維運

```bash
cd /opt/meetcopilot
docker compose ps                       # 狀態
docker compose logs -f server           # 結構化 JSON log（requestId/orgId/status/latency）
docker compose logs -f web
docker compose restart server           # 重啟單一服務

# 更新版本（拉新碼 → 重建 → 滾動起）
git pull
docker compose --env-file .env.production up -d --build
docker image prune -f                   # 清舊映像釋放磁碟
```

- **健康檢查**：`/api/health`（存活）；compose 對 server 設了 healthcheck。
- **優雅關機**：`docker compose down` 會送 SIGTERM，server 停收新連線、關 WS、dispose SessionRuntime、close DB。
- **資料落點**：SQLite 在 `./data/meetcopilot.db`（bind mount 到容器 `/data`）；Caddy 憑證在 `caddy_data` named volume（**勿刪**，否則重簽憑證會撞 Let's Encrypt rate limit）。

---

## 9. 常見坑

| 症狀 | 原因 / 解法 |
|---|---|
| Caddy 一直沒憑證 | DNS 尚未指向本機、或 80/443 被防火牆擋。確認 A record ＋ firewall 放行後 `docker compose restart caddy`。 |
| 前端打 API 失敗（CORS/連線） | `NEXT_PUBLIC_API_BASE` 沒設成 `https://網域`，或改了網域沒**重建** web；`WEB_ORIGIN` 要等於 web 的 https 網址。 |
| server 起不來、退出碼 1 | `JWT_SECRET` 空或占位字串（fail-fast）。填強隨機值。 |
| 生圖 502 | `OPENAI_API_KEY` 未填或**組織未驗證**；先完成 OpenAI 組織驗證。 |
| 記憶體吃緊 / OOM | Playwright 爬蟲＋Next 同機；升 `e2-medium`（4GB）或加 swap。 |
| 會中接收端收不到分頁音訊 | 接收端限 **Chrome/Edge 桌面**、Meet 分頁與 Copilot 分頁同 profile（平台約束，非部署問題）。 |

---

## 附：本機/預備環境快速起（非 GCP）

在任何裝了 Docker 的機器：
```bash
cp .env.production.example .env.production   # 填值；本機測可把 DOMAIN 設為 localhost（Caddy 會用內部憑證）
docker compose --env-file .env.production up -d --build
```
> `DOMAIN=localhost` 時 Caddy 走內部自簽（瀏覽器會警告），僅供煙霧測試；正式一定要真網域才有 Let's Encrypt 憑證。
