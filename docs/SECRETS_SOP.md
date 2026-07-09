# 密鑰安全 SOP：預防清單 ＋ 洩漏處理（MeetCopilot）

> 讀者：任何改動 MeetCopilot 程式碼／設定／部署的 session。
> 核心原則：**絕對不允許將任何密碼、API Key、Token、Secret 硬編碼到程式碼或設定檔。**
> 相關檔：正式部署與 Secret Manager 見 [DEPLOY.md](./DEPLOY.md)；程式審查查金鑰見 `.claude/skills/code-review/SKILL.md`（＋CLAUDE.md 硬規則 7）。

MeetCopilot 的實際密鑰（Secret Manager，project=`ezpagesite`／region=`asia-east1`）：
`meetcopilot-jwt-secret`、`meetcopilot-gemini-key`、`meetcopilot-openai-key`、`meetcopilot-db-url`。
生產環境一律以 Cloud Run `--set-secrets` 從 Secret Manager 注入；**不用 `--set-env-vars` 傳密鑰**。本機開發放 `.env`（已被 `.gitignore` 排除）。

---

## 一、預防清單

### 1. 禁止事項（違反＝生產事故）
- 在任何檔案（`.ts`/`.tsx`/`.js`/`.json`/`.yaml`/`.sh`/`.ps1`）寫入真實 DB 密碼、API Key、OAuth Secret、JWT Secret、`DATABASE_URL`。
- 在 deploy 指令或 `cloudbuild-*.yaml` 的 `--substitutions` / `--set-env-vars` 傳遞密鑰（build config 只放**非機密**如 `_API_BASE`、`_GOOGLE_CLIENT_ID`）。
- 把 `.env`、`*.db`、`credentials.json`、`token.json`、SA 金鑰 JSON 加入 git。
- 在 docs / SKILL.md / CLAUDE.md 寫真實密碼（用 `<YOUR_XXX>` 佔位）。

### 2. 程式碼引用方式
- 用 `process.env.KEY_NAME`（或 server 端設定載入層），不把真實密鑰當預設值帶入。
- 缺密鑰時 **fail-fast**：例如 `JWT_SECRET` 空或占位字串應讓 server 退出（DEPLOY.md 常見坑已載）。

### 3. `.gitignore` 必含清單
以下每一項都應被 repo 根 `.gitignore` 覆蓋（本專案已補齊，新增服務目錄若有各自 `.gitignore` 也照抄）：

```gitignore
.env
.env.*
!.env.example
!.env.production.example
credentials.json
token.json
service-account*.json
client_secret*.json
oauth*.json
*.pem
*.key
*.db
*.sqlite
```

新增任何會落地金鑰的檔案型別（例如某工具產生的 `*.p12`、`*.jks`）時，先補進 `.gitignore` 再產生檔案。

### 4. gitleaks pre-commit hook（建議，尚未安裝——等使用者決定）
本專案**目前沒有裝** gitleaks pre-commit hook。想加一層自動防線時（**先問使用者**是否要裝，本 SOP 只給指令、不代裝）：

```bash
# 1) 安裝 pre-commit（擇一）
pip install pre-commit        # 或 brew install pre-commit / choco install pre-commit
# 2) 在 repo 根新增 .pre-commit-config.yaml：
#   repos:
#     - repo: https://github.com/gitleaks/gitleaks
#       rev: v8.18.4            # 用當時最新 tag
#       hooks:
#         - id: gitleaks
# 3) 安裝 hook 到 .git/hooks
pre-commit install
# 4) 先對現有歷史掃一次
pre-commit run gitleaks --all-files
```

> 若不想裝 hook，也可在提交前手動掃：`gitleaks detect --source . --no-git`（需先裝 gitleaks 二進位）。

---

## 二、若發現密鑰洩漏的處理 SOP

依序執行，**輪替優先於清歷史**（先讓外洩值失效，再處理紀錄）：

1. **立即輪替**：到對應平台重新產生密鑰。
   - Gemini → Google AI Studio 重新產 `GEMINI_API_KEY`
   - OpenAI → platform.openai.com 撤銷舊 key、產新 `OPENAI_API_KEY`
   - `JWT_SECRET` → 重新產強隨機值（`openssl rand -base64 48`）；注意輪替後既有 JWT 全失效＝所有使用者需重新登入
   - DB → 若 `DATABASE_URL` 含的密碼外洩，於 Cloud SQL 改該使用者密碼並更新連線字串
2. **更新 Secret Manager**：
   ```bash
   gcloud secrets versions add meetcopilot-gemini-key --data-file=- --project=ezpagesite   # 依外洩的 secret 換名
   ```
3. **重新部署服務**：讓服務抓到新版 secret（DEPLOY.md A/D 節）。`--set-secrets` 指向 `:latest` 者，重部署即生效。
   ```bash
   gcloud run services update meetcopilot-server --region=asia-east1 --project=ezpagesite \
     --update-secrets=GEMINI_API_KEY=meetcopilot-gemini-key:latest
   ```
4. **清除 git 歷史（視情況）**：若密鑰曾被 commit 進 git，撤銷還不夠——歷史仍留有值。用 `git filter-repo`（或 BFG）清除歷史敏感值後 force-push（**force-push 屬破壞性、且本專案 commit/push 一律先問使用者——硬規則 6**）。
5. **檢查存取日誌**：確認洩漏期間是否有未授權存取。
   ```bash
   gcloud logging read 'resource.labels.service_name=meetcopilot-server AND severity>=WARNING' \
     --project=ezpagesite --freshness=24h --format=json
   ```
6. **記錄**：把事件與處理寫進 `docs/WORKLOG.md`；若是可複用的教訓，補一條到 `docs/LESSONS.md`。

---

> 來源：預防清單與洩漏 SOP 改編自 ezpagesite `CLAUDE.md`「憑證與密鑰安全規範」，服務名／secret 名／project／region 已改為 MeetCopilot 實際值。
