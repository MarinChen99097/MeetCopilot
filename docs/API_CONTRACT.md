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
| POST | `/api/extract-url` | `{url}` → `{title?, text}`（wizard grounding；SSRF-guarded） |
| POST | `/api/extract-pdf` | multipart → `{text}` |

## 5. Meetings（會議 session）

| POST | `/api/meetings` | `{title, companyId?, dealId?, deckId?}` → `{meeting:{id,...}, wsUrl, wsToken}`（建立 live session；wsToken 短效） |
| GET | `/api/meetings/:id` | 會後檢視：`{meeting, signals:Signal[], transcript:Segment[], actions}` |
| POST | `/api/meetings/:id/end` | 結束 session → `{summary?}` |
| GET | `/api/meetings` | 歷史清單 |

## 6. WS 協定（`/ws?token=<wsToken>&meetingId=&role=`；role＝`capture`｜`hud`｜`present`）

**傳輸**：音訊用 **binary frame**——**raw 16-bit little-endian PCM、16kHz、mono、無標頭**（直接丟 ArrayBuffer，~100–250ms/frame）；時間戳由 server 以到達時間標記（每場會議單一 capture 連線，勿多路混傳）。其餘 JSON text frame。`ping` 的回應＝`session_state`（協定無 pong）。`research_status.status`＝`'queued'|'running'|'done'|'failed'`（同 §3）。
**授權**：`suggestion_action`、`page_commit` 只接受 presenter 的連線（server 驗 wsToken 身分；攻擊者憑證必須被拒）。

### Client → Server（JSON）
```ts
{type:'hello', role:'capture'|'hud'|'present'}
{type:'consent', granted:boolean}                      // capture：未同意不啟動分析
{type:'suggestion_action', suggestionId, action:'accept'|'edit'|'reject', editedSlide?:SlideSpec}  // hud
{type:'deep_research', query:string}                   // hud「深查」→ 觸發 §3 ground（受每場上限）
{type:'page_commit', index:number}                     // present：已播到第 index 頁（committedIndex 單調遞增）
{type:'ping'}
```

### Server → Client（JSON）
```ts
{type:'transcript', segment:{id, t:number, speaker:'presenter'|'client'|'unknown', text, final:boolean}}
{type:'signals', items:{id, kind:'interest'|'objection'|'pain'|'competitor_mention'|'buying_signal'|'risk'|'pricing'|'next_step'|'landmine', label, confidence}[]}
{type:'info_card', card:{id, kind:'company'|'contact'|'battlecard'|'objection_handler'|'research', title, body, sourceUrl?, confidence?, trust:'verified'|'crawler'|'live'}}   // hud
{type:'suggestion', suggestion:{id, slide:SlideSpec, reason, expiresAt}}                     // hud（批准佇列）
{type:'suggestion_result', suggestionId, status:'applied'|'discarded', newSlideIndex?}      // hud
{type:'deck_update', op:{kind:'APPEND', slide:SlideSpec}, index:number}                     // present（批准後 append 到尾端）
{type:'research_status', jobId, status, remainingQuota:number}                              // hud
{type:'session_state', consent:boolean, committedIndex:number, connectedRoles:string[]}     // 全角色，連線/重連時同步
{type:'error', code:string, message:string}
```

## 7. Train（語音模擬訓練）

| GET | `/api/train/personas?companyId=` | 可對練的 contacts（**只列 persona 欄位過 verified 閘者**）：`{contactId, fullName, title, companyName, readiness:{verifiedFields:number, missing:string[]}}[]` |
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
