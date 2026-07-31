# API 契約（前端 ↔ 後端的唯一交界；凍結版 **v1.1**，2026-07-07）

> v1.1 批准紀錄（M0 實作揪出的缺口，指揮官批准補進契約；實作已符）：
> `GET /api/health`（免認證）入約；`me` 子形狀明定；`ContactSummary` 補 `id/companyId/fullName`；
> §6 音訊 binary frame 位元組佈局明定；`research_status.status`＝§3 job status enum；ping 的回應＝`session_state`（無 pong 訊息）。

> **地位**：平行開發的契約凍結檔（CLAUDE.md 硬規則 6）。前端（使用者以 Claude Design 設計）與後端（Opus agent 實作）都以本檔為準；
> 任何一方要改契約 → 先改本檔＋記 ROM，再改碼。TS 型別的實作放 `packages/shared`（實作必須與本檔一致；漂移＝bug）。
> 形狀語法為 TS 風格速記；欄位可為 optional 以 `?` 標示。

## 0. 通則

- Base URL：`NEXT_PUBLIC_API_BASE`（預設 `http://localhost:8787`），一律經環境變數。
- 認證：`Authorization: Bearer <JWT>`（除 register/login 外全部必帶）。org 隔離由 server 從 JWT 推導，**前端永不傳 orgId**。
- 錯誤契約：非 2xx 一律 `{ error: string }`；狀態碼 400/401/403/404/409/413/429/502。
- ID＝UUIDv7 字串；時間＝epoch 毫秒（number）。分頁：`?page=1&pageSize=20` → `{ items: T[], total: number }`。
- 長任務（爬蟲、生圖）一律 **job 模式**：POST 回 `202 { jobId }`，GET job 輪詢；會中另有 WS 推播。

## 1. Auth

| Method | Path | Body → Response |
|---|---|---|
| POST | `/api/auth/register` | `{email,password,displayName,orgName}` → `{token, user:{id,email,displayName}, org:{id,name}}` |
| POST | `/api/auth/login` | `{email,password}` → 同上 |
| GET | `/api/auth/me` | → `{user:{id,email,displayName}, org:{id,name}, role:'owner'\|'admin'\|'member'}` |
| GET | `/api/health` | 免認證 → `{ok:true}`（ops/監控用） |

## 2. CRM

### 公司（對方）
| Method | Path | 說明 |
|---|---|---|
| GET | `/api/crm/companies?query=&status=&page=&pageSize=` | 清單 `{items:CompanySummary[],total}`；`CompanySummary={id,name,domain?,industry?,logoUrl?,accountStatus?,verifiedStatus,crawlConfidence?,lastCrawledAt?,ownerUserId?}` |
| POST | `/api/crm/companies` | `{name, domain?, websiteUrl?}` → `Company`（建檔即可觸發 enrich，見 §3） |
| GET | `/api/crm/companies/:id` | `Company`（全欄位，欄位名＝CRM_SCHEMA camelCase 化）＋`counts:{contacts,products,news,deals}` |
| PATCH | `/api/crm/companies/:id` | `{...部分欄位}` → `Company`。**語意＝細填**：server 對每個被改欄位寫 `filled_by='human'` provenance |
| DELETE | `/api/crm/companies/:id` | 204 |
| GET | `/api/crm/companies/:id/news` `/locations` `/funding` `/tech` `/departments` | 各子表陣列 |

### 人物（主管）
| GET | `/api/crm/companies/:id/contacts` | `ContactSummary[]`＝`{id, companyId, fullName, title?, seniority?, decisionPower?, verifiedStatus, photoUrl?}` |
| POST | `/api/crm/companies/:id/contacts` | `{fullName, title?}` → `Contact` |
| GET / PATCH / DELETE | `/api/crm/contacts/:id` | PATCH＝細填語意同上 |

### 對方產品深檔
| GET | `/api/crm/companies/:id/products` | `CompanyProduct[]` |
| POST | `/api/crm/companies/:id/products` | `{name,...}` → `CompanyProduct` |
| GET / PATCH / DELETE | `/api/crm/products/:id` | |
| GET | `/api/crm/products/:id/people` | `{contact:ContactSummary, role, titleOnProduct?, confidence?}[]` |
| POST / DELETE | `/api/crm/products/:id/people` | `{contactId, role, titleOnProduct?}`；DELETE body `{contactId}` |

### 商機／筆記
| CRUD | `/api/crm/deals?companyId=&stage=&page=&pageSize=`、`/api/crm/deals/:id` | `Deal`（stage enum 見 CRM_SCHEMA §6）；list 支援 **`?companyId=`**（公司 Deals 分頁用，org-scoped）＋`/api/crm/deals/:id/contacts`（buying committee join） |
| GET/POST | `/api/crm/notes?entityType=&entityId=` | `Note{id,entityType,entityId,body,noteType,pinned,createdAt}` |
| PATCH/DELETE | `/api/crm/notes/:id` | |

### Provenance（「確認／細填」UI 的資料來源）
| GET | `/api/crm/provenance?entityType=&entityId=` | `FieldProvenance[]`：`{fieldName, valueSnapshot, filledBy:'crawler'\|'human'\|'llm'\|'import', sourceType?, sourceUrl?, confidence?, verified:0\|1, createdAt}`（每欄位取未 superseded 最新一筆） |
| POST | `/api/crm/provenance/confirm` | `{entityType, entityId, fieldName}` → 該欄 `verified=1`（**確認**；值不變）。**細填**＝直接 PATCH 實體 |

## 3. 研究引擎

| POST | `/api/research/enrich` | `{targetType:'company'\|'contact', targetId, mode:'quick'\|'detailed', url?}` → `202 {jobId}`。detailed＝會前建檔（爬官網＋子頁＋grounding）；quick＝輕量 |
| GET | `/api/research/jobs/:id` | `{id,targetType,targetId,mode,status:'queued'\|'running'\|'done'\|'failed', fieldsFilled?, sources?:string[], error?, startedAt?, finishedAt?}` |
| GET | `/api/research/jobs?targetId=` | 歷史 jobs |
| POST | `/api/research/ground` | `{query, companyId?, meetingId?}` → `{answer:string, citations:{title,url}[]}`（grounding 即答；帶 meetingId 時結果同步推入該場 HUD） |

## 4. Decks（DynamicSlide；slide 結構＝`packages/shared` 的 `SlideSpec`）

| GET | `/api/decks` | `{items:{id,title,language,slideCount,updatedAt}[],total}` |
| POST | `/api/decks/generate` | wizard 契約（沿 v1）：`{topic,pages,language,objective?,keyPoints?,metrics?,audience?,tone?,style?,logoDataUri?,refImageDataUris?,sourceText?, companyId?}` → `Deck`（companyId 供 CRM grounding） |
| POST | `/api/decks/import` | multipart（pptx/pdf）→ `Deck` |
| GET | `/api/decks/:id` | `{deck:{id,title,language,committedIndex}, slides:SlideSpec[]}` |
| PATCH | `/api/decks/:id/slides/:index` | `{slide:SlideSpec}`（會前編輯；live 中僅 pending 區可改，違反 I1 → 409） |
| POST | `/api/decks/:id/image-jobs` | `{slideIndex, kind:'background'\|'full', prompt?}` → `202 {jobId}`（**pre-meeting** AI 生圖；OpenAI gpt-image-2，~10–80s） |
| GET | `/api/image-jobs/:id` | `{status:'queued'\|'running'\|'done'\|'failed'\|'refused', dataUri?, error?}`（`refused`＝內容審核拒絕 → 前端顯示 fallback 漸層已套用） |
| GET | `/api/decks/:id/export.pptx` | 檔案下載（RFC5987 檔名） |
| POST | `/api/decks/:id/extract-text` | 匯入 deck 逐頁文字回填（checklist 餵料，MEETING_CHECKLIST_CONTRACT §11.5）：需要跑→`202 {started:true}`（背景 fire-and-forget，**無 job 列、不輪詢**）；native deck／已全有字／匯入未完成→`200 {needed:false}`。fill-empty 冪等、同 deck 併發去重；org-scoped（非本 org → 404）；**rate-limited（index.ts 共用桶）**。讀圖 fallback 計費 kind=`gemini_extract` |
| POST | `/api/extract-url` | `{url}` → `{title?, text}`（wizard grounding；SSRF-guarded） |
| POST | `/api/extract-pdf` | multipart → `{text}` |

## 5. Meetings（會議 session）

| POST | `/api/meetings` | `{title, companyId?, dealId?, deckId?, objective?}` → `{meeting:{id,...}, wsUrl, wsToken}`（建立 live session；wsToken 短效）。`deckId`／`objective` **會落庫**（migration 023）；建會成功後若 `deckId` 或 `companyId` 任一有值 → **背景**生成待講清單（fire-and-forget，不阻塞回應、失敗不影響建會），進度經 WS `checklist` 推 hud。每場只生成一次。**rate-limited**（因背景清單生成是最貴的 LLM 呼叫；與 `draft-objective` **共用** index.ts 的同一個 token bucket，額度不加倍） |
| POST | `/api/meetings/draft-objective` | `{deckId?, companyId?, title?}` → `{objective:string}`（AI 依簡報＋CRM 擬一句會議目標，繁中 ≤40 全形字，供建會表單預填、使用者可覆寫）。資料不足 → `{objective:""}`（**不報錯**）。org-scoped＋rate-limited（index.ts 共用桶，非 router 自建） |
| GET | `/api/meetings/:id` | 會後檢視：`{meeting, signals:Signal[], transcript:Segment[], actions}` |
| POST | `/api/meetings/:id/end` | 結束 session → `{summary?}` |
| GET | `/api/meetings` | 歷史清單 |
| POST | `/api/meetings/:meetingId/signals/:signalId/writeback` | **批准回寫**（會後訊號 → CRM，PRODUCT_SPEC 飛輪）：`{targetType:'contact'\|'deal', targetId, field, value}` → `{target}`（更新後的 Contact/Deal）。`value`＝人核准值（可由訊號建議編輯）。signal 必須屬於該 `meetingId`＋org（否則 404）；target 亦須在同 org。array 欄 **append**、scalar 欄 **set**。provenance 依 CRM_SCHEMA §7 記 `filled_by='human'`＋`source_type='meeting'`＋`source_detail=<meetingId>`＋`verified=1`，並 supersede 該欄舊 provenance。錯誤：400（非法/未允許 field）、404（meeting/signal/target 不存在或不屬本 org） |

> **writeback `field` 白名單**（camelCase 域欄位名＝provenance `fieldName`；非清單內 → 400）：
> `contact`：`objectionsRaised`／`painPoints`／`knownPriorities`／`hotButtons`（array，append）、`decisionPower`／`communicationStyle`（scalar，set）；
> `deal`：`riskFlags`（array，append）、`nextStep`／`pain`（scalar，set）。

## 6. WS 協定（`/ws?token=<wsToken>&meetingId=&role=`；role＝`capture`｜`hud`｜`present`）

**傳輸**：音訊用 **binary frame**——**raw 16-bit little-endian PCM、16kHz、mono、無標頭**（直接丟 ArrayBuffer，~100–250ms/frame）；時間戳由 server 以到達時間標記（每場會議單一 capture 連線，勿多路混傳）。其餘 JSON text frame。`ping` 的回應＝`session_state`（協定無 pong）。`research_status.status`＝`'queued'|'running'|'done'|'failed'`（同 §3）。
**授權**：`suggestion_action`、`page_commit`、`checklist_action` 為 presenter 專屬——依 **wsToken 身分**授權（`userId === presenterUserId`，**純身分判定**），**與連線 role 無關**（role 僅係 server→client 的推播目標，非安全邊界；任何持 token 者本就可自稱任一 role）。會中副駕 cockpit 由 presenter 從 `hud` 連線批准（故 §6 送訊表標 `suggestion_action // hud`）。任何非 presenter 身分的憑證（含跨使用者／跨 org），無論用哪個 role，一律被拒（`forbidden_not_presenter`）；handshake 另擋 token/meeting 不符（`unauthorized`，close 4001）。patch-service 於寫 deck 前再驗一次 presenterAuth（縱深防禦）。

### Client → Server（JSON）
```ts
{type:'hello', role:'capture'|'hud'|'present'}
{type:'consent', granted:boolean}                      // capture：未同意不啟動分析
{type:'suggestion_action', suggestionId, action:'accept'|'edit'|'reject', editedSlide?:SlideSpec}  // hud
{type:'deep_research', query:string}                   // hud「深查」→ 觸發 §3 ground（受每場上限）
{type:'page_commit', index:number}                     // present：已播到第 index 頁（committedIndex 單調遞增）
{type:'checklist_action', itemId:string, action:'check'|'uncheck'|'skip'}   // hud（**presenter-only**，同 suggestion_action 身分閘）
{type:'ping'}
```
> `checklist_action`：`check`→`covered`（`covered_by='manual'`）｜`uncheck`→`pending`（清空 `covered_by`/`covered_at`/`evidence`）｜`skip`→`skipped`。處理後重播全量 `checklist` snapshot 給 hud。非 presenter → `error{code:'forbidden_not_presenter'}`。

### Server → Client（JSON）
```ts
{type:'transcript', segment:{id, t:number, speaker:'presenter'|'client'|'unknown', text, final:boolean}}
{type:'signals', items:{id, kind:'interest'|'objection'|'pain'|'competitor_mention'|'buying_signal'|'risk'|'pricing'|'next_step'|'landmine', label, confidence}[]}
{type:'info_card', card:{id, kind:'company'|'contact'|'battlecard'|'objection_handler'|'research', title, body, sourceUrl?, confidence?, trust:'verified'|'crawler'|'live'}}   // hud
{type:'suggestion', suggestion:{id, slide:SlideSpec, reason, expiresAt}}                     // hud（批准佇列）
{type:'suggestion_result', suggestionId, status:'applied'|'discarded', newSlideIndex?}      // hud
{type:'deck_update', op:{kind:'APPEND', slide:SlideSpec}, index:number}                     // present（批准後 append 到尾端）
{type:'research_status', jobId, status, remainingQuota:number}                              // hud
{type:'checklist', status:'generating'|'ready'|'failed', items:ChecklistItem[], currentSlideIdx?:number}  // hud **only**（I3）
{type:'session_state', consent:boolean, committedIndex:number, connectedRoles:string[]}     // 全角色，連線/重連時同步
{type:'error', code:string, message:string}
```
> `checklist`（會中待講清單，契約 `docs/MEETING_CHECKLIST_CONTRACT.md` §5）：**一律 `broadcast(meetingId, msg, 'hud')`**，禁止 `'all'`／`'present'`（I3：清單含會議目標與話術，外流給客戶是災難）。**全量 snapshot、replace 語意**（HUD 端整份換掉；斷線重連自我修復，不需增量對帳）；`status:'generating'` 時 `items` 為空陣列；`currentSlideIdx`＝server 已知的簡報高水位（`runtime.committedIndex`），供 HUD 高亮「正在講」。`ChecklistItem`＝`packages/shared/src/checklist.ts`（`{id, idx, category:'talk'|'ask'|'address', title, detail?, slideIdx?, keywords:string[], priority:'must'|'nice', status:'pending'|'covered'|'skipped', coveredBy?:'transcript'|'slide'|'manual', coveredAt?, evidence?}`）。

## 7. Train（語音模擬訓練）

| GET | `/api/train/personas?companyId=` | 可對練的 contacts（**只列 persona 欄位過 verified 閘者**）：`{contactId, fullName, title, companyName, readiness:{verifiedFields:number, missing:string[]}, unlocked:boolean, lastScore?:number, lastPracticedAt?:number}[]`。`lastScore`＝**最近一份**對練報告的總分（0–100，各維度平均四捨五入）、`lastPracticedAt`＝該場 `endedAt`；兩欄由既有 `training_reports`/`training_sessions` 彙總而來，**沒練過（或最近那場沒有可用評分）→ 兩欄皆 undefined**，前端顯示「尚未對練」，**不得補 0** |
| POST | `/api/train/sessions` | `{contactId, dealId?, difficulty?:'friendly'\|'neutral'\|'hostile'}` → `{sessionId, live:{ephemeralToken, model, expireTime}, persona:{displayName,title}}`（瀏覽器拿 ephemeralToken **直連 Gemini Live**，音訊不經我方 server） |
| POST | `/api/train/sessions/:id/transcript` | `{turns:{speaker:'rep'\|'ai', text, t}[]}`（前端於對練中/結束時上傳雙向逐字稿） |
| POST | `/api/train/sessions/:id/finish` | → `{reportId}`（觸發評分） |
| GET | `/api/train/reports/:id` | `{scores:{objectionHandling,discovery,clarity,closing}: 0-100, highlights:{quote,comment,kind:'good'\|'improve'}[], summary, transcriptRef}` |

## 8. 前端要處理的關鍵狀態（設計時必做）

1. **空/載入/錯誤三態**每頁必備；錯誤顯示 `{error}` 文案。
2. **爬蟲/生圖 job**：queued→running→done/failed/refused 的進度呈現；生圖最長 ~80s 要有耐心 UI＋可離開再回來。
3. **provenance 徽章**：每個爬蟲填的欄位帶「來源＋信心＋已驗證?」徽章；「確認」「細填」兩動作（§2 Provenance）。
4. **HUD 即時流**：WS 斷線重連（`session_state` 恢復）、建議倒數（expiresAt）、A/S 快捷鍵、研究配額 `remainingQuota` 顯示。
5. **/present 零 HUD**（I3）：此 surface 只渲染投影片＋頁碼；`deck_update` 靜默 append；絕不出現任何建議/逐字稿/卡片元素。
6. **/copilot 擷取端**：zero-track 守衛（0 音軌 → 紅色指引重新分享並勾「分享分頁音訊」）、track ended 重試、consent 閘。
7. **/train 語音**：連線中/AI 說話中/你說話中/被打斷 的視覺狀態；>15 分鐘自動續連（resumption）不可斷對話感。
8. **首頁（今日議程＋KPI）沒有專屬端點**——一律由既有清單湊（見 §9 尾註）；湊不出來的 KPI 不顯示，不得前端瞎編。

## 9. Org（用量／預算／單場成本）

> 全部 `Bearer` 認證＋**owner/admin only**（現查 memberships 權威角色；member → 403）；org 一律由 JWT 推導。
> 完整的邀請／成員管理端點見 `docs/M5_CONTRACT.md` §D；本節只列**花費**相關（W4）。

| Method | Path | Response |
|---|---|---|
| GET | `/api/org/usage?from&to&groupBy=kind\|model\|day` | `{from,to,totalCostUsd,totalCostUsdPosttax,totalInputTokens,totalOutputTokens, rows:{key,events,inputTokens,outputTokens,costUsd,costUsdPosttax}[], budget?}` |
| GET | `/api/org/usage/events?from&to&kind&limit&offset` | `{total, items:UsageEvent[]}`（明細，分頁） |
| GET | `/api/org/usage/by-meeting?from&to&limit` | `{items:{meetingId, title?, events, costUsd, costUsdPosttax}[]}`（**單場成本**；依成本由高到低取前 `limit` 場，預設 10、上限 50） |

- **`budget`（可選欄）**：`{monthlyUsd, monthStart, spentUsd, spentUsdPosttax}`。月上限來自 env **`ORG_MONTHLY_BUDGET_USD`**（全平台單一值，無 per-org 設定表）；**env 未設或非法（非數／≤0）→ 整個 `budget` 欄不存在 → 前端不渲染預算條**。`spent*`＝**當月至今**（UTC 月初 → now），與 `from`/`to` 查詢窗**無關**（預算條問的永遠是「這個月燒了多少」）。預算條分子用 `spentUsdPosttax`（使用者看到的是含稅）。
- **`by-meeting` 的涵蓋範圍（不發明資料）**：只彙總帶 `usage_events.meeting_id` 的**會中**用量（realtime hub／metering-context 於會議脈絡帶入）。**會前**的 deck 生成、研究爬蟲、persona 草擬等呼叫沒有 `meeting_id`，不計入任何一場，也不做歸屬臆測——故 Σ`by-meeting` **小於** `totalCostUsd`，UI 文案須寫「會中成本」而非「該場總成本」。`title` 於會議已刪除／標題空時省略（join 帶 `org_id`，跨 org 標題不外洩）。
- **查詢窗**：三條共用 `from`/`to`（epoch-ms，預設近 30 天、上限 ~400 天）；非法 → 400。

> **首頁湊法（無新端點）**：「今日議程」＝`GET /api/meetings?page=1&pageSize=50` 後前端依 `createdAt` 落在今日 ＋ `status !== 'completed'` 篩選（會議模型無 `scheduledAt`，`createdAt` 即建會時間）。KPI：**deck 數**＝`GET /api/decks` 的 `total`；**公司數**＝`GET /api/crm/companies?page=1&pageSize=1` 的 `total`；**本週會議數**＝同一份 meetings 清單（`createdAt DESC`）篩本週，第一頁滿頁時顯示「N+」不硬算；**本月花費**＝`GET /api/org/usage?from=<UTC 月初>&to=<now>&groupBy=kind` 的 `totalCostUsdPosttax`（env 有設預算時，同一份回應的 `budget.spentUsdPosttax` 是同一個數字，可直接用來一併畫預算條）——此 KPI **owner/admin 才拿得到**，member 直接不顯示，不得改用其他端點繞過授權。「團隊動態」**不做**：`activities` 表雖存在（005）但全 repo 無任何寫入點，其餘表也沒有跨使用者的事件流可湊。
