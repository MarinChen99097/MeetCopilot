# ✅ 實際上線紀錄（2026-07-08，Cloud Run + Cloud SQL，ezpagesite 專案）

> 本產品**已實際部署到 GCP 並驗證通過**（改用 Cloud Run + Cloud SQL，非下方原 VM 方案——因使用者要 scale-to-zero＋建了 SQL DB）。下方「GCP 單 VM」章節保留為**自架替代方案**（此次未採用）。

**現況（live）**
- 前端 Web：**https://meetcopilot-web-54139295474.asia-east1.run.app**
- 後端 API/WS：**https://meetcopilot-server-54139295474.asia-east1.run.app**（`/api/health`＋`/api/ready` 皆 200；register→me 端到端過；CSP 已指向 server https/wss＋Gemini Live）
- DB：Cloud SQL Postgres 16 `ezpagesite:asia-east1:meetcopilot-db`（db-f1-micro）
- Secrets：`meetcopilot-{jwt-secret,gemini-key,openai-key,db-url}`（Secret Manager）
- Cloud Run：`meetcopilot-server`（min=0/max=1/cpu=2/mem=4Gi/gen2/CloudSQL/WS 3600/session-affinity）、`meetcopilot-web`（min=0/max=2/cpu=1/mem=1Gi）
- 影像：`asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/{server,web}`

**重新部署（改程式後）**
```bash
# server（含 Playwright）
gcloud builds submit --tag asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/server:latest -f Dockerfile.server .
gcloud run deploy meetcopilot-server --image=asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/server:latest \
  --region=asia-east1 --execution-environment=gen2 --min-instances=0 --max-instances=1 --cpu=2 --memory=4Gi \
  --add-cloudsql-instances=ezpagesite:asia-east1:meetcopilot-db \
  --set-secrets=JWT_SECRET=meetcopilot-jwt-secret:latest,GEMINI_API_KEY=meetcopilot-gemini-key:latest,OPENAI_API_KEY=meetcopilot-openai-key:latest,DATABASE_URL=meetcopilot-db-url:latest \
  --set-env-vars=DB_DRIVER=pg,WEB_ORIGIN=https://meetcopilot-web-54139295474.asia-east1.run.app,GOOGLE_CLIENT_ID=54139295474-f7cve65n4884ttkcbc2o23hs763q7hm4.apps.googleusercontent.com,GEMINI_TEXT_MODEL=gemini-3.1-flash-lite,GEMINI_EXTRACT_MODEL=gemini-3.5-flash,GEMINI_EMBED_MODEL=gemini-embedding-001,GEMINI_LIVE_MODEL=gemini-3.1-flash-live-preview,OPENAI_IMAGE_MODEL=gpt-image-2,OPENAI_IMAGE_SIZE=1536x864,OPENAI_IMAGE_QUALITY=medium,RESEARCH_AUTO_LIMIT_PER_MEETING=10 \
  --allow-unauthenticated --timeout=3600 --session-affinity
# ⚠ WEB_ORIGIN 必帶（CORS）；GOOGLE_CLIENT_ID 必帶（沿用 EZpage 的 client，共用帳號）。server 用 cloudbuild-server.yaml 建。
# ⚠ Google 登入前置：Console 把 meetcopilot-web 網址加進該 OAuth client 的「已授權 JavaScript 來源」。
# web（NEXT_PUBLIC_API_BASE + NEXT_PUBLIC_GOOGLE_CLIENT_ID 皆 build 時 bake）
gcloud builds submit --config=cloudbuild-web.yaml --region=asia-east1 --substitutions=_API_BASE=https://meetcopilot-server-54139295474.asia-east1.run.app,_GOOGLE_CLIENT_ID=54139295474-f7cve65n4884ttkcbc2o23hs763q7hm4.apps.googleusercontent.com .
gcloud run deploy meetcopilot-web --image=asia-east1-docker.pkg.dev/ezpagesite/meetcopilot/web:latest \
  --region=asia-east1 --min-instances=0 --max-instances=2 --cpu=1 --memory=1Gi \
  --set-env-vars=NEXT_PUBLIC_API_BASE=https://meetcopilot-server-54139295474.asia-east1.run.app --allow-unauthenticated
```
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
