# ROM — 決策總帳（強制）

> 使用者 2026-07-07 指示建立（決策 19）：記錄「**使用者或 Claude 下的所有決策**」。
> 這**不是** memory 那種要精簡的東西——是**更大、更雜**的決策帳本：可以長、可以囉嗦、要帶完整脈絡，寧多勿漏。
> 與 `00-DECISIONS.md` 的分工：00-DECISIONS 是**蒸餾後的產品既定前提**（少而精，衝突時以它為準）；
> ROM 是**未蒸餾的全量帳**（誰決定、何時、為什麼、考慮過什麼替代、連被否決的都記）。

## 規則

1. **任何決策當下就記**：使用者的指示/拍板、指揮官（Fable）的設計取捨、預設值選擇、範圍裁決、
   「決定**不**做某事」、agent 建議被採納或否決——全部都算。不可延後補寫。
2. 每筆格式（**可以長**，照抄模板）：
   ```
   ### YYYY-MM-DD HH:MM | 決策標題
   - **誰決定**: 使用者｜Fable｜使用者採納 agent 建議｜…
   - **決策**: 決定了什麼（完整寫，不用省字）
   - **脈絡與理由**: 為什麼、當時的情況
   - **考慮過的替代**: 有哪些選項、為何不選（沒有就寫「無」）
   - **影響**: 影響哪些檔案/里程碑/後續（有就寫）
   ```
3. **寫入方法同 CHANGE_TRACKER**：嚴禁 Write 覆寫本檔；先 `Read(offset=1, limit=10)` 確認錨點在，
   再用 Edit 以 `---`＋空行＋`<!-- ROM_BELOW -->` 為 old_string 前綴，把新紀錄插在錨點正下方（新上舊下）。
4. **每滿 500 行歸檔**：
   1. 把 `<!-- ROM_BELOW -->` 以下**全部**搬到 `docs/rom_archives/ROM_NNN.md`（NNN 自 `001` 起**依序遞增**，不用日期當檔名）；
   2. 為該歸檔寫一則**簡介**登錄到下方「歸檔目錄」：涵蓋期間＋本批主要決策主題 3–6 條（讓之後不開檔就能判斷要不要點進去）；
   3. 清空本檔（保留標頭＋規則＋歸檔目錄＋錨點），再插入新紀錄。
5. **查決策的順序**：`00-DECISIONS.md`（現行前提）→ 本檔錨點下方（近期）→「歸檔目錄」簡介定位到 `ROM_NNN.md`（歷史）。

## 歸檔目錄（每個歸檔一則簡介，供快速查詢）

| 檔案 | 涵蓋期間 | 簡介 |
|---|---|---|
| （尚無歸檔） | | |

---

<!-- ROM_BELOW -->

### 2026-07-08 22:40 | extract-url 匯入加固全數做在 v2 並上線（P1 已部署、P2/P3 待部署）＋commit/部署前先問
- **誰決定**: 使用者（回報 bug、拍板「所有問題都在 v2」、核准 P1 上線、指示「1 3 修一修」）＋Fable（設計/範圍/實作取捨）
- **脈絡與理由**: 使用者回報 DeckWizard「從網址匯入」回 429。**過程踩坑**：session 工作目錄指向 `c:\...\MeetCopilot`（v1 參考件），Fable 誤在 v1 修了一整輪（UA/charset/429/DNS＋稽核 15 項＋審查 remediation＋worker）並 push 到 GitHub `MarinChen99097/MeetCopilot`，才在處理「部署」時查 GCP 發現 **live 是 v2（Cloud Run＋Cloud SQL）**、v1 未部署。使用者明確：「早就不管 v1 了，所有問題都是在 v2 發生的」。故全部改在 v2 重做。
- **決策**:
  1. **修復目標一律 v2**：v1 完全不管；v1 的修復只當「已驗證藍本」移植進 v2（v2 extract.ts 早期從 v1 移植後已分歧，須對齊 v2 契約重寫，不照搬）。
  2. **P1（extract.ts 6 項）先上線**：瀏覽器 UA／charset 解碼／十六進位 entity 防崩／429 重試／DNS 逾時／pdf `{max:50}`；**v2 更強的 SSRF/DNS-pin 逐字保留**。已 commit `5538ddd`、只重建 server、部署 rev **00009-qcb**、health/ready 200。
  3. **P2/P3 續做（本筆）**：P2＝gemini per-call 逾時＋finishReason≠STOP 可行動錯誤＋withRetry 退避/Retry-After/retryable 短路＋decks 錯誤映射（不外洩 raw）；P3＝pptx 串流位元組上限（取代可繞過的宣告大小檢查）＋parse 移進可 terminate 的 worker_thread＋ASR 真失敗廣播 `asr_unavailable`（去重、成功即清、空白不報）＋webp 匯出排除（畫面仍可 webp）。
  4. **實作取捨**：(a) worker 載入因 Node 22.18 原生 strip-types 頂掉 worker 內 tsx，改 **dynamic import 帶副檔名＋workerData 傳 ext**（dev/prod 皆實測過）；(b) webp **只在匯出 sink 排除、不動 shared 驗證器**（畫面預覽保留 webp）；(c) ASR 去重旗標放在 **per-session GeminiAsrProvider**（＝等同 per-runtime）、不廣播「已恢復」；(d) GenerationEmptyError→422（內容問題而非 502）。
  5. **commit／部署前先問**（使用者立規、已寫進 v1 CLAUDE.md 硬規則 6＋記憶）：寫完只回報＋擬 message，不自行 `git commit`/`git push`/`gcloud` 部署；追加 WORKLOG/CHANGE_TRACKER/ROM 不算 commit。
- **考慮過的替代**: (a) 把 v1 已 push 的成果直接視為交付——否決：live 是 v2，v1 修了production 不受惠；(b) P3 只做 pptx 串流上限、不做 worker——保留為選項但使用者要「修一修」故一併做（worker 為同步 CPU bomb 真正可硬性中止的唯一解，v1 已證可行）；(c) webp 直接從 shared 驗證器刪除——否決：該驗證器畫面/匯出共用，刪了畫面也不顯示 webp。
- **影響**: apps/server（gemini/pptx-parser/asr/realtime-hub/generation-pptx-render/decks-routes＋新 import/run-in-worker、parse-worker）。全 workspace typecheck 綠、server 36/36＋CRM 43/43 pass、逐 cluster fresh-context read-back PASS。**部署待使用者同意後**（只重建 server）。I1/I2/I3 未削弱、SSRF 未動。
- **注意**: v2 無 GitHub remote（純本機 git＋Cloud Run），與 v1（有 origin）不同。v1 那套修復留在 GitHub 當參考，不再維護。

### 2026-07-08 20:30 | 「研究此公司」URL 可選＝無 URL 就以公司名稱做全網深度研究（＋job 逾時）
- **誰決定**: 使用者（「這邊邏輯有問題，當他說『可選』時，好歹要藉由公司名稱去做深度研究才對」；且新建無官網公司 CyP 留空 URL 研究跑很久沒結果）＋Fable（設計）
- **根因**: orchestrator createJob 對**所有模式（含 deep）**在無 url 時 throw「no URL to crawl」；但 DeepResearcher 本就以 company.name 為 grounding 種子、domain/startUrl 皆 optional——根本不需 url，只是被這行擋在門外。且整個 job 無逾時＝卡住永遠「研究中」。
- **決策**:
  1. **無可爬 url 的 company → 一律以公司名稱走全網深度研究**（grounding by name，跳過官網 crawl）；有 url 才照 mode 爬官網。等於「URL 真正可選」。
  2. **整體 job 硬逾時** RESEARCH_JOB_TIMEOUT_MS（預設 360s，Promise.race）→ 逾時 markFailed 記「研究逾時」，job 狀態必終結。
  3. name-based 需 grounding+LLM（正式環境已設 GEMINI）；缺則清楚報錯而非默默卡住。
- **考慮過的替代**: (a) 無 url 就報錯要使用者補網址——否決：使用者明確要「用公司名稱研究」；(b) 只有 deep 模式支援無 url——否決：quick/detailed 留空也應退回名稱研究（mode 只是標籤，無 url 時官網爬不動）。
- **限制**: name-based 較耗（跑 grounding+合成）＝即使選 quick，無 url 也會走深度；共用品牌名消歧仍不完美（沿用 deep 既有限制）。逾時採 Promise.race 使 job 狀態終結，背景殘工在單一實例上自然結束（可接受）。
- **驗證**: typecheck 4ws 綠、server 36/36、CRM 43/43；親自讀回 orchestrator 逾時/createJob/分派/runDeep 四段確認。I1/I2/I3 未觸及。
- **注意**: 舊卡死 job（前一版建立）狀態不會自動變——使用者需重整重跑；未做 boot-time stale-job 清理（列為後續可選）。

### 2026-07-08 19:30 | CRM 顯示原文＋zh-TW 簡介、擷取在地化、補技術棧/部門孤兒表
- **誰決定**: 使用者（截圖 CyberPower 頁反映三點：「表現形式應該原文+i18n 簡介才對」「爬出來全英文沒翻成 i18n」「技術棧與部門也沒爬出來」）＋Fable（設計契約）
- **決策**:
  1. **原文＋zh-TW 簡介並排**（非取代）：DB 各加平行 `*_zh` 欄（news title/summary、product one_liner/description、company description、contact title/background_summary），原文欄照舊逐字，額外存 zh-TW 簡介；前端 locale===zh-TW 且 *Zh 有值時，於原文下顯示視覺區別的「🌐 中文簡介」框。
  2. **在地化放擷取階段**（非讀取時即時翻譯）：擷取器一次產出雙語（SYSTEM 從「do not translate」改為「主欄逐字＋*Zh 產 ≤2 句 zh-TW 簡介」）——省成本、可快取、有 provenance、離線可讀。
  3. **技術棧/部門是合成資料，直接產 zh-TW**（不需雙語欄）；補上擷取 schema（techStack/departments）＋orchestrator 呼叫既有 bulkUpsertTech/bulkUpsertDepartments，接上「有表有 repo 有讀路由有 UI 卻從無寫入」的孤兒表。
- **根因（調查確認）**: company_tech/company_departments 自 003 就有表＋repo＋GET＋前端分頁，但**沒有任何擷取器產出、orchestrator 也從沒呼叫 bulkUpsert**＝只讀得到永遠空。且兩擷取器 prompt 都明令 do-not-translate＝內容全來源語言、schema 無任何 zh 欄。
- **考慮過的替代**: (a) i18n map（Record<locale,string>）欄——否決：只有 zh-TW/en，平行純量 `*_zh` 最簡且足夠；(b) 讀取時即時翻譯——否決：延遲/成本/無 provenance；(c) 批次回填既有資料——否決：改走「使用者重跑研究即現」，避免一次性翻譯 job。
- **範圍/限制**: 只影響**新研究結果**，既有 CyberPower 資料需重跑「研究此公司（深度）」才會出現新欄位；大型產品目錄每產品多出 *Zh 可能逼近 16384 output token 上限（簡介有界故風險低，deep-extractor 有 3 次重試救 truncation）。
- **驗證**: typecheck 4 workspace 綠、server 36/36、CRM 43/43（idempotency 測試改連續 1..N 不硬編碼版本數）。I1/I2/I3 未觸及。migration 011 雙份（SQLite 多條 ADD COLUMN／PG ADD COLUMN IF NOT EXISTS），server boot 自動套。

### 2026-07-08 18:00 | 研究引擎不再鎖公司網域＝新增全網深度研究（deep 模式）
- **誰決定**: 使用者（「應有專門 agent 深度搜尋公司資料，公司網址只是起點，要去報導/wiki 等全網找，不要被鎖死在公司網址」）＋Fable（設計）
- **決策**: enrich 新增 **deep 模式**——專門的全網研究：以公司名/網址為起點，Gemini Google Search 多角度雙語查詢＋深讀外部來源（新聞/維基/產業/公開資料，跳過公司網域）＋綜合填 CRM，**關鍵＝每欄 provenance 指向真實外部來源 URL**（不是公司網域）。既有 quick/detailed（爬公司網站）不變；deep 額外並行網站爬蟲補產品。GroundingProvider（原只接 HUD /ground）現也接進 enrich。
- **考慮過的替代**: agentic 迭代 loop（Gemini 自行決定後續查詢）——第一版用結構化多查詢（可靠有界），迭代式列為後續。
- **實測（碩天科技/CyberPower）**: 從 FT/Wikipedia/cnyes/digitimes/businesswire 撈到 11 概況+5 新聞+6 主管+10 競爭對手，員工數 1730←FT、董事長郭瑾←Wikipedia，附真實出處。~$0.013/次。
- **誠實限制**: 共用品牌名跨實體消歧不完美（CyberPower TW UPS vs 美國電競 PC，6 主管有 2 疑錯實體）；redirect 解析 best-effort；LLM 合成非決定性（已修 JSON runaway）；找不到私有/付費牆/未索引資料。
- **新 env**: DEEP_RESEARCH_BUDGET_MS(150s)/MAX_QUERIES(9)/MAX_SOURCES(6)；migration 010（crawl_jobs.mode 加 deep，server boot 自動套）。
- **影響**: research 全模組、CRM provenance sourceType、web EnrichPanel；需重建 server image 重部署（migrate() boot 套 010）。

### 2026-07-08 14:30 | 帳號互通＝Google 登入（沿用 EZpage client）＋爬蟲放寬
- **誰決定**: 使用者（要跟 EZpage 帳號互通；澄清 EZpage 純 Google 登入無密碼；沿用同 OAuth client；爬蟲慢沒事）＋Fable（設計）
- **決策**:
  1. **共用帳號＝Google 登入**（非密碼代理）：EZpage 只用 Google，故 MeetCopilot 也做 Google Sign-In，用同一個 Google email 對接＝同身分。零 secret 共用、零改 EZpage、零改 MeetCopilot schema（用既有 provision 邏輯 by email）。沿用 EZpage 的 OAuth client id `54139295474-f7cve65n...`（client id 非機密）。feature flag 保留本地登入給 dev。中途兩個 agent（email 密碼代理、爬蟲）被使用者停掉——採用其已落地且 typecheck 綠的爬蟲碼，Google 登入改由新 agent 正確實作。
  2. **爬蟲「慢慢爬沒事」**：nav 60s、quick deadline 120s、detailed 300s，全 env 可覆寫但仍有界（L13）；逾時不硬敗、搶救部分內容。
- **使用者行動項（唯一）**: Google Cloud Console 把 `https://meetcopilot-web-54139295474.asia-east1.run.app` 加進該 OAuth client 的「已授權 JavaScript 來源」（gcloud 改不了、只能 Console），否則 Google 不發 token。
- **部署**: 需重建 server image（爬蟲＋auth 碼）＋設 GOOGLE_CLIENT_ID env；重建 web image（bake NEXT_PUBLIC_GOOGLE_CLIENT_ID）。
- **影響**: server auth/config/crawler、web auth/CSP、.env.example、DEPLOY 重部署要加 GOOGLE_CLIENT_ID。

### 2026-07-08 03:00 | ✅ 上線 GCP 完成 — MeetCopilot v2 live
- **誰決定**: Fable（執行部署；使用者授權「直接部署到 GCP、同 ezpagesite 專案」）
- **決策/結果**: **已實際部署到 GCP ezpagesite 專案並驗證**——server `https://meetcopilot-server-54139295474.asia-east1.run.app`（Cloud Run min=0/max=1/cpu2/ram4/gen2/CloudSQL/WS3600/session-affinity；/health+/ready 200；register→me 端到端過、資料寫進 Cloud SQL）、web `https://meetcopilot-web-54139295474.asia-east1.run.app`（min=0/max=2；i18n 307→/zh-TW、login 200、CSP 指向 server https/wss+Gemini Live）、Cloud SQL Postgres16 `meetcopilot-db`、4 Secret、Artifact Registry server+web 影像。
- **執行過程/坑**: provisioning agent 建好 Cloud SQL+secrets+推 server 影像，但反覆卡在 async-build 等待迴圈→**Fable 接手親自驅動剩餘 Cloud Run deploy**。Cloud Build 失敗根因＝monorepo `tsc -b` 乾淨 Linux 誤判 mtime（TS6305→@meetcopilot/shared 解析失敗 cascade implicit-any）→改 crm/server build tsconfig 為 `tsc -p`+paths→dist .d.ts（commit 99a98e4）。web 的 NEXT_PUBLIC_API_BASE build-time bake 走 cloudbuild-web.yaml。
- **成本**: 閒置約 $8–12/月（Cloud Run→$0、Cloud SQL 常態 ~$8–10）。
- **仍待使用者**: OpenAI 組織驗證（生圖）、真語音/麥克風瀏覽器實測、自訂網域（可選）。max>1 需 Redis 外部化 session。
- **影響**: docs/DEPLOY.md 加實際上線章節+重部署指令；cloudbuild-web.yaml。**MeetCopilot v2 從規劃到上線全程完成（M0–M5＋code-review＋Postgres 移植＋GCP 部署）。**

### 2026-07-08 11:35 | 部署路線定案：Cloud Run(min=0/max=1)+Cloud SQL Postgres；Postgres 移植完成
- **誰決定**: 使用者（要 scale-to-zero autoscaling＋「可以創一個 SQL 資料庫」）＋Fable（架構裁決）
- **決策**:
  1. **改上 Cloud Run + Cloud SQL Postgres**（取代原決策 20 的 GCE 單 VM+SQLite）。理由：使用者要 scale-to-zero（min=0）經濟性，SQLite 在 Cloud Run 短暫 FS 會掉資料→必須 Cloud SQL。**Cloud Run 自帶 *.run.app HTTPS**→網域/TLS 問題消失（secure context 免費，麥克風/Live 可用）。
  2. **max=1 硬約束（非使用者說的 2）**：會中副駕 session 狀態在單進程記憶體＋WS 長連線，多實例會拆散會議。min=0/max=1 給 scale-to-zero 又正確；max>1 需未來 Redis 外部化 session。cpu=2/ram=4 OK。
  3. **成本誠實**：Cloud Run compute 閒置→$0，但 **Cloud SQL 本身不 scale-to-zero**（最小 db-f1-micro 約 $8–10/月常態底）。仍遠低於 e2-medium 常開 VM（$27）。若要連 DB 都 $0 idle＝Neon 等第三方 serverless PG（非 GCP 原生，使用者要的是同 ezpagesite 專案故用 Cloud SQL）。
  4. **Postgres 移植完成並驗證**：雙驅動（不破 SQLite）、crm 43/43 兩 DB 皆綠、真 server 在 pg 端到端。
- **考慮過的替代**: GCE 小 VM+SQLite+排程停機（幾乎零工程但非真 autoscaling；使用者選了 SQL DB 路）；Neon serverless PG（$0 idle 但非 GCP 專案內）。
- **影響**: packages/crm 雙驅動、apps/server crm.ts；接著 provision Cloud SQL＋Cloud Run（ezpagesite 專案）＋deploy 2 服務（server/web）。ARCHITECTURE 部署節與決策 20 更新為 Cloud Run 路線。

### 2026-07-08 09:05 | M5 PASS — 整個產品 M0–M5 完成（含誠實 gap）
- **誰決定**: Fable（依全鏈路整合驗收裁決）
- **決策**:
  1. **M5 驗收 PASS 入庫**：全鏈路 fresh-context smoke 8/9 PASS——隱私（同意閘/PII 遮蔽實測遮罩/persist=0 逐字稿 0 落 DB）、成本（usage rollup 跨 org 隔離）、強化（/ready、限流 429、安全標頭、log 0 洩漏）、邀請（invite→accept＋跨 org 隔離）、I1/I2（append-only＋非 presenter 被拒）、typecheck＋72 測試＋13 路由 build 全綠。
  2. **1 PARTIAL＝訊號→CRM 批准回寫端點未做**：目前訊號 review-only，PRODUCT_SPEC 的「會後訊號經批准回寫 CRM」flywheel 尚缺端點 → **指揮官決定補上**（M5 closeout，小範圍）：POST 批准回寫，寫進 contact 的 objections/pain 等，provenance `filled_by=human, source_type=meeting, verified=1`（CRM_SCHEMA §7 接縫早已定）。
- **carry-forward（非阻斷，記錄）**: 成本記帳未涵蓋 ASR/rolling 分析/speaker 推斷/live-token/grounding（大宗 generation/image/extract 已記，串流小項未記）；persona-lock、真語音體驗待使用者真跑；npm audit（hardening agent 已 triage）。
- **使用者前置（唯一未完＝上線）**: GCP 專案/帳單/網域/DNS、OpenAI 組織驗證、換強 JWT_SECRET，照 `docs/DEPLOY.md` 跑（我不跑 gcloud）。
- **影響**: M5 全量 commit；ARCHITECTURE 里程碑 M5；接著補訊號回寫。**至此 MeetCopilot v2 為 M0–M5 完整成品，只差使用者上線＋真語音驗。**

### 2026-07-08 09:42 | 訊號→CRM 回寫端點補上，M5 PARTIAL 關閉（9/9）
- **誰決定**: Fable（M5 收尾）
- **決策**: 補 `POST /meetings/:id/signals/:signalId/writeback`，讓會後批准的訊號帶 `source_type='meeting'` provenance 回寫 contact/deal（PRODUCT_SPEC flywheel）。ByUser 介面加 optional sourceType/sourceDetail（向後相容）。M5 整合驗收由 8/9 → **9/9**。
- **影響**: 產品 M0–M5 全部功能完成；契約 §5 更新；commit。剩：使用者上線（DEPLOY.md）＋真語音驗＋（carry-forward）串流成本記帳。

### 2026-07-08 06:05 | /code-review 收尾：7 confirmed 全修＋SSRF 回歸攔截
- **誰決定**: Fable（依審查證據＋回歸驗證裁決）
- **決策**:
  1. **多鏡頭對抗式 /code-review**（使用者指定；CodeRabbit CLI 未裝故自建，6 鏡頭 find→對抗 verify-to-refute）：12 raw findings，**5 個假陽性被 refuter 駁回、7 confirmed**（1 critical/5 warning/1 info）全修。
  2. **F1 critical（跨租戶掐會議）務必修**：hub.endMeeting 破壞動作在擁有權檢查前無條件執行——多租戶隔離真漏洞，上線前攔到；加回歸測試。
  3. **F4 SSRF 修法二次校準（關鍵）**：fail-closed `MAP * ~NOTFOUND` 雖最安全但實測**弄壞 www→apex 跨 host 重導**（ghost.org 掛，CyberPower 剛好沒中）→ 改回**只 pin 目標 host**、其餘公網 host 由 per-request 守衛擋私網。CyberPower＋Ghost 重跑皆填出豐富欄位、SSRF 仍擋內網。教訓 L16：安全修正必對既有可用功能＋不同形狀案例回歸。
  4. carry-forward 一併處理：F7 wizard 圖片 413（server 25mb＋前端縮圖）、F2/F3 重連（train live＋/present）、F5 train 錯誤 hang、F6 計時。
- **未修（審查未列為 confirmed，屬既知 carry-forward）**: persona-lock 是否真鎖進 token（需真 /train browser 連線確認，第一次真跑驗）；npm audit 傳遞依賴漏洞（待 M5 triage）；孤兒 ws.ts（可刪，非 bug）。
- **考慮過的替代**: 保留 fail-closed（否——破壞多數真站）；不修 F1 因 meetingId 難猜（否——多租戶破壞動作必須守擁有權，不靠 id 難猜當防線）。
- **影響**: apps/server hub/crawler/train/index＋2 新測試、apps/web liveClient/PresentStage/TrainCall/DeckWizard；LESSONS L16；commit。**M0–M4 全部完成且經對抗審查修正**。下一步＝M5（整合/隱私/成本/上線 GCP）＋使用者真跑驗語音/persona-lock。

### 2026-07-08 03:35 | M2/M3/M4 三線全 PASS＋S3 spike 過＋carry-forward 風險
- **誰決定**: Fable（依三線 fresh-context 驗收裁決）
- **決策**:
  1. **三線驗收全 PASS，入庫**：M2 DynamicSlide（live 測：生成 6 頁 0 空白/pptx 111KB 往返/gpt-image-2 背景圖 1.9MB/refused fallback/I1 攻擊測 409/I3 零-HUD grep 淨/build 綠/CRM 31 測試）、M3 會中副駕（9/9：meeting→wsToken/三角色連線/訊號→hud info_card 且跨 org 不洩/presenter-only 攻擊拒/ACCEPT append I1/present 不收 HUD I3/SessionRuntime 清理/12 路由 build）、M4 語音模擬（真 token mint v1alpha/persona 逐欄過 verified 閘、crawler-only 被拒 400/四維評分/rows 寫入/build 綠/socket 有界/跨 org 隔離）。
  2. **S3 spike PASS（機械面）**：Gemini Live 全鏈路實測（authTokens.create→token 直連→模型音訊+繁中逐字稿）。關鍵事實入 API_FINDINGS：`ai.authTokens`（非 tokens）＋`apiVersion:'v1alpha'`。
- **carry-forward 風險（不擋入庫，交 /code-review 或首次真跑處理）**:
  a. **persona-lock 未驗**（最高價值）：startSession 為安全不回傳 systemInstruction、靠 `liveConnectConstraints` 鎖進 token；若鎖無效 AI 會 persona-less。第一次真 /train 要確認。
  b. **全域 JSON body 2MB**：wizard 帶 logoDataUri+refImageDataUris 可能 413——要嘛升上限、要嘛圖走 multipart。
  c. **theme.bg 可能是 url()/gradient**（生圖背景存這）：pptx-exporter/SlideRenderer 要容忍非純色。
  d. **npm audit 8 個漏洞**（1 critical/1 high，多為 pdf-parse/pptxgenjs 傳遞依賴）——待 triage。
  e. **dist 需重建**：shared/crm 的 `dist/` 早於 M2 decks repo，runtime 靠 dist→部署/dev 要 `npm run build`（gitignored）。
  f. 孤兒 `apps/server/src/ws.ts`（M0 attachWs）已成死碼，整合時刪。
- **語音體驗＝待使用者**：真開口打斷、>15min resumption 需真人+麥克風（同 S1 模式）。
- **影響**: M2/M3/M4 全量程式碼 commit；ARCHITECTURE spike S3/里程碑；接著 /code-review（使用者指定）處理 carry-forward + 找新問題。

### 2026-07-08 01:35 | S4 spike 正式 PASS＋抽取模型分流決策
- **誰決定**: Fable（依 CyberPower 台灣站實測證據裁決）
- **決策**:
  1. **S4 spike 全數關閉（PASS）**：真實爬蟲端到端把**豐富 CRM 欄位**填出來已證實——重驗 `https://www.cyberpower.com/tw/zh`（使用者指定、繁中 B2B）：一筆公司（無重複、domain 回填）、industry/description/legalName（碩天科技股份有限公司＝CyberPower 真實台灣法人）＋5 個產品，`filled_by='crawler'`＋source_url，繁中乾淨無幻覺。加上先前已證的 SSRF 穩、browser.close 有界不懸掛、job 到 done。→ 研究引擎（M1 核心）真正可用。
  2. **抽取模型分流**（決策）：爬蟲結構化抽取用 `GEMINI_EXTRACT_MODEL=gemini-3.5-flash`，一般文字/生成維持 `gemini-3.1-flash-lite`。因 flash-lite 對「爬頁文字→CRM 結構化欄位」不穩（JSON 坍縮/runaway/偷懶，見 L15）——按任務難度配模型，不是一把模型打天下。
- **脈絡與理由**: 使用者要成品，S4 的價值不是「水管通」而是「真的填得出資料」；ghost.org 只填 2 欄暴露 flash-lite 抽取不穩，換 3.5-flash＋CyberPower 實測才真正過關。
- **考慮過的替代**: 全線升 3.5-flash（否——一般文字 flash-lite 夠用又便宜，只有抽取需要）；維持 flash-lite 靠重試（否——它吐的是合法 JSON，重試也救不了）。
- **未消小限（誠實）**: 產品的 description/keyFeatures 常只有 oneLiner（quick 單頁）、近似產品名可能重複（child dedupe 為精確名比對）——detailed 模式爬子頁可補；M1 可接受。
- **影響**: apps/server research/gemini/config、packages/crm upsertFromCrawl、.env(.example) 加 GEMINI_EXTRACT_MODEL、API_FINDINGS §E、ARCHITECTURE_PLAN .env、LESSONS L15。**M1 研究引擎驗收完成 → M2/M3/M4 三線可開工**。

### 2026-07-08 00:20 | .env 祕鑰唯一真相＝apps/server/.env（不再自動同步）
- **誰決定**: 使用者（「以 server 為主」「原本最外層的 .env 我刪掉了」）＋Fable（守則）
- **決策**: `apps/server/.env` 是所有 API key 的唯一落點；根 `.env` 已由使用者刪除。**永久停用**先前「root→server 自動同步」腳本（它造成使用者新填的 OpenAI key 被舊值覆蓋、因 gitignored 無法復原，見 L14）。往後 Claude 對 .env 一律**唯讀、遮蔽檢查**，需要 key 請使用者直接編該檔。
- **脈絡與理由**: server config 讀 apps/server/.env；同步腳本是我救急寫的，反而毀了使用者資料。
- **考慮過的替代**: 讓 server 也載入 root .env（否——使用者選擇單一 server 檔、刪 root，更乾淨）。
- **現況（遮蔽驗證）**: GEMINI_API_KEY（AIza…，107 字元）、OPENAI_API_KEY（sk-proj-…，218 字元）格式皆正確；JWT_SECRET 為 dev 值（M5 上線需換真祕鑰）。
- **影響**: LESSONS L14；S4 實跑爬蟲進行中（用此 .env）。

### 2026-07-07 23:30 | M1 驗收裁決（6/7 PASS，修 crawler 懸掛）＋接縫決策採納
- **誰決定**: Fable（依 B5 fresh-context 驗收證據裁決）
- **決策**:
  1. **M1 驗收通過並入庫**：B5 fresh-context 7 項驗收 6 PASS（typecheck 四 workspace 綠、crm vitest 22/22 含跨 org cosine 隔離/upsert 值+provenance 同 tx/human 覆寫 supersede/confirm/信任守則、29 表遷移、真 server CRM 路由冒煙含細填→provenance supersede、SSRF 兩路擋內網+雲端 metadata、auth shim 已移除、CRM 前端 11 路由 next build 綠）。
  2. **1 項 PARTIAL 修正**：crawler `browser.close()` 在此機懸掛→enrich job 卡 `running`。**派 Opus 修**：close race deadline＋SIGKILL 強殺、整體 crawl deadline、job 失敗一律落 `failed`（見 L13）。此為真 bug（生產也會漏進程/卡 job），非僅環境問題。
  3. **接縫決策採納**（B0/B2/B3/B4 提報）：(a) crm build 拆 `tsconfig.json`(noEmit typecheck)＋`tsconfig.build.json`(tsc -b emit，shared composite)——沿用 apps/server 既證模式，typecheck 零建置順序；(b) 只有 CRM_SCHEMA 有 CHECK 的欄位變 string-literal union，註解型清單保持 string 讓爬蟲不被擋；(c) `crawl_jobs` 經 DbPort 由 research 自管、不進 repo 接縫（M1 可接受，日後要再升 `CrawlJobStore`）；(d) 契約補 deals list `?companyId=` filter（前端 Deals tab 需要，已入契約＋修）；(e) provenance wire 欄位 camelCase（B5 證實 badge 對齊）。
  4. **誠實 gap（需使用者的 key 才能全關）**：Gemini 抽取未驗（B5 環境無 GEMINI_API_KEY）——爬蟲 render＋SSRF 已證，但「爬蟲把 CRM 欄位填出來」要有 key 才能實測。**S4 spike 判定：SSRF 穩、爬蟲 render 可行、抽取待 key**。
- **考慮過的替代**: 把 crawler 懸掛當純環境問題不修（否——生產同樣會漏進程/卡 job，必修）；build 標準化成全 dist（否——維持 M0 的 src-paths typecheck＋dist runtime，成本較低）。
- **影響**: apps/server crawler/jobs/deals（修）、API_CONTRACT deals filter、LESSONS L12/L13、M1 全量程式碼 commit。**使用者行動項**：把 GEMINI_API_KEY 放進 `apps/server/.env`，我再跑一次真爬蟲把 S4 抽取那半關掉。

### 2026-07-07 21:50 | SaaS 成品化（決策 20）＋M0 驗收通過＋契約 v1.1
- **誰決定**: 使用者（成品定調＋四項答覆）＋Fable（部署形態與契約批准）
- **決策**:
  1. **使用者定調：要上線營運的 SaaS 成品，不是 demo**。四答：DB 維持 SQLite 起步／部署 **GCP**／計費先不做（邀請制）／**前端成品全由我方 agent 設計＋實作**（Claude Design prompt 包降為設計規格與使用者參考，不擋工）。
  2. **Fable 部署形態裁決**：SQLite×GCP ⇒ 單一 GCE VM＋持久磁碟＋Docker Compose（server 含 Playwright、web、Caddy TLS）＋每日 snapshot；明令**不部署 Cloud Run**（短暫檔案系統毀 SQLite）；量大遷 Cloud SQL Postgres。
  3. **M0 驗收通過**（A5 fresh-context 6/6 PASS），程式碼入庫。
  4. **契約 v1.1 批准**（M0 揪出的缺口）：/api/health 入約、me 子形狀、ContactSummary 補 id/companyId/fullName、音訊 binary frame＝raw PCM16 LE 16k mono 無標頭（server 到達時間戳）、research_status enum、ping→session_state。另批准：crm 套件不依賴 shared（持久層不該依賴線上契約包，A1 的分層判斷正確）；login 的 direct-SQL shim 限期到 M1（升級 `MembershipRepository.findPrimaryOrgOf`）。
- **考慮過的替代**: 部署選 Vercel+Railway+Neon（Fable 原推薦，使用者選 GCP）；DB 直上 Postgres（Fable 原推薦，使用者選維持 SQLite——已點破 GCP 形態代價並入冊）。
- **影響**: 00-DECISIONS 決策 20、ARCHITECTURE_PLAN（部署 row/M1/M5/前端成品註記）、API_CONTRACT v1.1、.gitignore WAL 側檔、M0 全量程式碼 commit。使用者前置：GCP 專案＋帳單＋網域；後續 M1 開工。

### 2026-07-07 18:10 | S1 結案＋開工分工＋API 契約 v1.0 凍結
- **誰決定**: 使用者（S1 事實＋分工）＋Fable（契約設計）
- **決策**:
  1. **S1 spike PASS 結案**——使用者確認 2026-07-07 那輪 capture-test 就是「真實雙帳號 Meet」情境（Brave/Win11，9 項全 PASS）。會議模型地基成立，可開工。殘項：Window-surface 備援未測（非阻斷）。
  2. **分工**——前端：使用者以 Claude Design 設計互動元件（我方提供設計 prompt 包）；後端：Fable 負責設計（架構/契約/裁決），**程式碼一律派非 Fable 的 agent（Opus）執行**。
  3. **API 契約 v1.0 凍結**（`docs/API_CONTRACT.md`）——關鍵形狀：長任務（爬蟲/生圖）一律 job 模式（202+輪詢+WS 推播）；WS 三角色 capture/hud/present、音訊走 binary frame；presenter-only 動作（suggestion_action/page_commit）server 驗身分；「確認」＝provenance verify、「細填」＝PATCH 實體並寫 human provenance；train 用 ephemeral token 讓瀏覽器直連 Gemini Live（語音不經我方 server）；錯誤一律 `{error}`；前端永不傳 orgId。
- **脈絡與理由**: 使用者要開始設計/實作；平行開發前必須先凍結前後端交界（v1 L5 契約漂移教訓）。
- **考慮過的替代**: 音訊走 JSON base64（否——binary frame 省 33% 頻寬與編解碼）；生圖同步等待（否——gpt-image-2 ~80s 必須 job 化）。
- **影響**: docs/API_CONTRACT.md（新）、docs/FRONTEND_DESIGN_PROMPTS.md（派工中）、M0 實作工作流啟動、ARCHITECTURE_PLAN spike 表 S1 標 PASS、tools/README 矩陣更正。

### 2026-07-07 17:25 | 接收端瀏覽器約束放寬：Chrome/Edge → Chromium 系（Brave 實測通過）
- **誰決定**: Fable（依使用者實測證據）
- **決策**: 「接收聲音端限 Chrome/Edge 桌面」放寬為「**Chromium 系桌面瀏覽器**——Chrome/Edge（文件背書）＋Brave（使用者裝置 2026-07-07 實測 9 項全 PASS，含分頁音訊擷取與錄放回聽）」。同時在 capture-test 工具補 Brave 偵測（UA 偽裝成 Chrome，需 `navigator.brave.isBrave()` 判別）。
- **脈絡與理由**: 使用者用 Brave 跑第一輪 capture-test：環境 4 項＋測試 A（分頁串流、1 條音軌、160KB 錄音可回放）＋測試 B（麥克風）全 PASS；displaySurface=browser、48kHz 立體聲、AudioContext@16k 正常。Brave 是 Chromium 分支，API 面一致。
- **考慮過的替代**: 維持只寫 Chrome/Edge（否——使用者主力瀏覽器就是 Brave，實測已過就該入冊）。
- **留意（未消風險）**: (1) 本輪是單機自測，**還不是真實雙帳號 Meet 情境**（裝置/軟體欄未填）——S1 仍要跑真會議版；(2) Brave 的防指紋（farbling）會對 Web Audio 輸出加極微噪聲，理論上不影響 ASR 品質，S2 實測時順帶確認；(3) Brave Shields 若把會議網站的資源擋掉屬另一類問題，實測時 Shields 保持預設即可。
- **影響**: PRODUCT_SPEC 硬性平台約束、API_FINDINGS §B、tools/capture-test.html、tools/README.md 矩陣首筆。

### 2026-07-07 | 建立 ROM 決策總帳制度（本檔）
- **誰決定**: 使用者（指示）＋Fable（設計細節）
- **決策**: 在 CHANGE_TRACKER 之外新增 ROM——記錄使用者或 Claude 的所有決策；不精簡、可長可雜；每 500 行歸檔到 `rom_archives/ROM_NNN.md`（序號命名）；ROM.md 頂部維護歸檔目錄（每檔一則簡介）。Fable 補的設計：與 00-DECISIONS 分工（蒸餾 vs 全量）、錨點插入機制沿用 CHANGE_TRACKER、查詢順序三段式。
- **脈絡與理由**: 使用者要一個「比 memory 更大更雜」的決策記憶體——memory 必須精簡、CLAUDE.md 有 150 行上限、WORKLOG 記進度不記決策脈絡，三者都裝不下「為什麼這樣決定＋考慮過什麼」的全量資訊。
- **考慮過的替代**: 塞進 memory（否——memory 制度要求精簡）；擴寫 WORKLOG（否——進度與決策混在一起會兩頭難查）；歸檔用日期命名（否——使用者指定序號為主）。
- **影響**: 新增本檔＋`rom_archives/`；CLAUDE.md 硬規則 9＋路由表；HANDOFF 文件索引補列。

### 2026-07-07 | 四項新指示（決策 15–18）與其執行層決策
- **誰決定**: 使用者（四項指示）＋Fable（執行層取捨）
- **決策**: (15) 生圖供應商改 OpenAI「image-2」＝查證後確認 `gpt-image-2`；(16) 做免安裝的音訊擷取相容性測試工具（tools/capture-test.html）供使用者親測各裝置×開會軟體；(17) 移植 ezpagesite 的 code-tracker（實體＝CHANGE_TRACKER 強制變更日誌）；(18) CRM 加「對方產品深檔」（company_products／company_product_people／company_departments）。
- **脈絡與理由**: 使用者看完第一版計畫書後的四項補強——生圖要用他偏好的 OpenAI；硬約束（Chromium-only）要能自己驗證；ezpagesite 的追蹤紀律證明有效想沿用；CRM 要能「完整介紹一家公司的產品含開發人」。
- **Fable 執行層取捨**: 生圖走 `ImageProvider` 抽象（OpenAI 主力、Gemini 降備選、fallback 漸層不變）；預設 `1536x864`（gpt-image-2 原生 16:9，免裁切）＋quality 顯式 medium（auto 會偷跑 high 又貴又慢）；查證出延遲 ~80s 級 → 「一律 pre-meeting」坐實、會中選配唯一候選改 `gpt-image-1-mini`（S5 另議）；CHANGE_TRACKER 移植時加「工作區」欄（monorepo 需要）＋M0 後補 pre-commit hook；CRM 產品↔人用 join 表（不在 contacts 加欄）。
- **考慮過的替代**: 生圖續用 Gemini（否——使用者指定 OpenAI）；測試工具做成 npm 專案（否——要免安裝雙擊可開）；CHANGE_TRACKER 改英文（否——本專案制度檔全繁中）。
- **影響**: API_FINDINGS §F、ARCHITECTURE_PLAN §1/.env/S5/§8、PRODUCT_SPEC、CRM_SCHEMA 產品深檔節、tools/、docs/CHANGE_TRACKER.md、HANDOFF.html。前置行動項：使用者要做 OpenAI 組織驗證＋查 tier 配額。

### 2026-07-07 | 模型分工：Fable 決策、Opus 執行
- **誰決定**: 使用者
- **決策**: 指揮官（主對話）＝Fable，負責拆解、裁決、與使用者對話；搜尋、調查、研究、驗證、審查等 subagent 一律 `model:"opus"`；實作類交辦亦預設 opus。取代先前 haiku/sonnet 便宜優先的預設。
- **脈絡與理由**: 使用者曾在 Fable 暫不可用時切 Opus 續跑（產出第一版計畫書），切回後要求 Fable 審查 Opus 產出——他把 Fable 定位為裁決層、Opus 為執行層。
- **考慮過的替代**: 維持 haiku/sonnet 省成本（否——使用者明示品質優先）。
- **影響**: MODEL_DISPATCH.md 拍板覆寫節、CLAUDE.md 硬規則 1、長期記憶 dispatch-fable-decides-opus-investigates。

### 2026-07-07 | 審查修正批（Fable 三路審查 Opus 產出後採納的修正）
- **誰決定**: Fable（依對抗式審查證據裁決；其中涉產品行為者不改決策只改表述）
- **決策**: 約 25 處修正一次採納，要點——「同瀏覽器硬限制」降級為 UA 行為＋Window-surface 備援（S1 兩條都驗）；生圖「97%」標為非官方（官方＝單行文字錯誤率多 <10%）；Gemini 生圖 API 參數需 `-preview` 後綴；生圖延遲宣稱降為工程估計；`DbPort` 改 async-first（同步簽名會讓換 Postgres 的承諾破功）；CRM 實作順序補漏掉的賣方側三表；TASK_TEMPLATES 移除已廢除的 INSERT_AFTER 教學；M0 驗收與 spike gate 解耦（S1 需使用者協助不得擋 M0 收尾）；M0 補 .env 全欄位/vitest/npm scripts；Playwright 端 SSRF 改 page.route 攔截方案（DNS-pin 不適用）；persona 欄位逐欄過 provenance 閘（不看 rollup）；(org_id,domain) 改 UNIQUE；補 schema_migrations 最小 DDL 等。
- **脈絡與理由**: 使用者要求「檢查 Opus 產出是否足夠詳細與正確」；三路審查（事實再查核／跨檔一致性／CRM schema）＋Fable 親自比對抓出。
- **考慮過的替代**: 無（各項皆有證據）。
- **影響**: 幾乎全部 docs；commit 15bec1b。

### 2026-07-06 | v2 大 pivot 全套決策（14 項＋會議模型）
- **誰決定**: 使用者（三輪 AskUserQuestion＋兩則補充訊息拍板）
- **決策**: 從零重寫為「CRM 核心＋三消費端」平台；同棧（Next.js+Express+ws+SQLite+Gemini）；傘名沿用 MeetCopilot；M2 起三線並行；語音模擬與第一產品並行；先本機留雲端路；SQLite＋repository 層；混合式研究引擎（grounding＋搬 ezpagesite 爬蟲＋SSRF 補洞）；研究自動＋手動觸發；生圖兩模式都做；語音模擬用 Gemini Live 直接做語音版；新頁一律 append 尾端**仍需批准**（I2 保留）；HUD 用第二裝置；分軌改「轉逐字後 LLM 推斷」；**會議模型＝純網頁雙帳號**（A 分享簡報分頁、B 靜音進會擷取混音，不做桌面版，Electron 全案作廢）。完整清單見 00-DECISIONS（該檔為蒸餾版真相來源）。
- **脈絡與理由**: v1 單一「會中簡報 Copilot」範圍太小；使用者要兩個 B2B 開會產品共用 CRM 地基，爬蟲先填、用戶細填。
- **考慮過的替代**: 在 v1 monorepo 重構（否——使用者選從零重寫）；只用 Gemini grounding 或自建全套 crawler（否——選混合）；文字版模擬先行（否——直接語音）；桌面版（否——雙帳號讓 web-only 成立）。
- **影響**: 建 MeetCopilot_v2 repo＋整套計畫書；v1 保留為參考件不動。

### 2026-07-04 ～ 07-05 | v1 時期關鍵決策（摘要，詳見 v1 repo 的 WORKLOG/LESSONS）
- **誰決定**: 使用者＋當時指揮官
- **決策**: 純瀏覽器 Web＋Electron 殼雙軌（後被 v2 雙帳號模型作廢）；LLM 全 Gemini；SQLite＋JS cosine；自建 JWT；文字模型統一 `gemini-3.1-flash-lite`；簡報走結構化 SlideSpec＋CSS 模板（非整頁生圖）；批准閘 I2／pending-only I1／HUD 隔離 I3 三不變量；制度檔體系（指揮官不下場、隨做隨存、驗證不自驗…）。
- **脈絡與理由**: v1 從規格到可跑 MVP 的全程決策；多數制度與教訓（L1–L11）被 v2 繼承。
- **影響**: v1 repo（c:/Users/Martin/Desktop/MeetCopilot）；v2 的 PORTED 零件清單與制度檔。
