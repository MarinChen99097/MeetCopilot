# 前端設計 Prompt 包（給 Claude Design 用）

> **這份檔案是什麼**：一包可直接複製貼進 **Claude Design（claude.ai 的設計 / artifact 能力）** 的前端設計 prompt。
> 使用者拿這些 prompt 讓 Claude 產出六個 surface 的**可互動 HTML/React artifact 原型**；後端由另一組 agent 依 `docs/API_CONTRACT.md`（凍結契約 v1.0）平行實作。
> **契約鐵律**：本檔每個 prompt 內引用的 API 路徑 / 欄位名 / WS 訊息形狀，都與 `API_CONTRACT.md` **一字不差**。設計側若覺得契約缺欄位，回報工程側改契約，**不要在 artifact 裡自己發明欄位**。

---

## 一、怎麼用（給使用者的操作說明）

1. **先建立 context**：開一個新的 Claude 對話，把 **PROMPT 0**（共用設計語言＋系統背景）整塊貼進去。它會讓 Claude 記住配色、通用元件、無障礙與 responsive 原則——這是後面每個畫面共用的地基。
2. **逐個貼 PROMPT 1–6**：在**同一個對話**裡，一次貼一個 PROMPT（每個 PROMPT 各自一個程式碼圍欄，方便整塊選取複製）。讓 Claude 針對該 surface 產出一個 artifact 再貼下一個；不要一次全貼。
3. **每個 PROMPT 產出的是「可互動的 HTML/React artifact 原型」**：用假資料（mock）驅動、狀態齊全（載入/空/錯誤/斷線）、可點可切。**不是最終產品碼**，是設計對齊用的高保真原型。
4. **設計完成後把 artifact 代碼交回工程側對接**（交付要求見本檔最末〈結尾備註〉）。工程側會把 mock 換成真 API、把狀態接上真 WS。
5. **每個 PROMPT 的圍欄用四個反引號**（```` ```` ````）包住，內層的型別範例用三個反引號——這樣整塊複製時內層程式碼不會把外框截斷。複製時**連反引號一起選**沒關係，貼進 Claude Design 後把最外層四反引號去掉即可，或直接整塊貼、Claude 會理解。

---

## 二、PROMPT 0｜共用設計語言與系統背景（先貼這塊）

````
你是我的資深產品設計師＋前端工程師。我正在做一個 B2B 銷售平台叫 MeetCopilot v2，接下來我會分次請你設計六個畫面（surface），每個都要產出「可互動的 HTML/React artifact 原型」（用 mock 假資料驅動、狀態齊全、可點可切）。

這則訊息是「共用設計語言與系統背景」，請你先讀懂並記住；之後每個畫面 prompt 都沿用這裡的配色、通用元件、無障礙與 responsive 原則。先不要出圖，讀完回我「已建立設計語言，請給我第一個畫面」即可。

## 產品一句話
MeetCopilot v2 = 詳細 CRM ＋ 研究引擎（爬蟲＋grounding）為核心，支撐三個消費端：DynamicSlide（會中依對話新增補充簡報頁）、會中副駕（即時給報告者補充資訊）、語音模擬訓練（AI 用 CRM 資料扮客戶做語音對練）。給 B2B 業務銷售用。

## 使用者是誰
使用者＝B2B 業務／售前（下稱「rep」）。用 Google Meet 對「潛在客戶公司」開會做簡報銷售。會前把對方公司與主管建進 CRM（爬蟲先填、rep 再確認/細填），會中一邊講簡報一邊收到副駕情報，會後把訊號回寫 CRM。技術素養中等，會用鍵盤、常在時間壓力下操作，介面要「一眼看懂、少讀字、狀態明確」。

## 設計語言（所有畫面共用）
- 整體＝專業深色系。基底＝深藍 / 石板（deep navy / slate），accent＝紫 / 粉。給人「冷靜、可信、資料密度高但不雜」的銷售工作台感。
- 建議 token（可微調，但六個畫面要一致）：
  - 底色 --bg:#0B1220；卡片 --surface:#18233B；卡片 hover --surface-2:#1F2D4D；分隔線 --border:#263252
  - 主文字 --text:#E6EBF5；次文字 --text-muted:#96A2C2
  - accent 主 --accent:#8B5CF6（紫）；accent 次 --accent-2:#EC4899（粉）；兩者可做漸層點綴（mesh / linear）
  - 成功/PASS --ok:#34D399；警告 --warn:#FBBF24；危險/FAIL --danger:#F87171；資訊 --info:#38BDF8
  - 圓角 --radius:10px；卡片間距 12–16px；字級用 rem，數字強調用大字重與大字級
- 版式：卡片化（card-based）、清晰層級（標題/副標/內文三級）、大數字（KPI、分數、計數用醒目大字）、留白足夠。深色下用「微亮邊框＋輕陰影」界定卡片，不要重陰影。
- 語言：UI 主語言 zh-TW（繁體中文），但所有文案要能容納 en（字串抽成可替換、不寫死寬度、按鈕不因語言爆版）。日期/數字在地化。

## 通用元件（請設計成可複用的元件，六個畫面重複使用）
1. 狀態徽章 StatusBadge：PASS/FAIL（綠/紅）、通用狀態（queued/running/done/failed）用不同底色小圓角標籤。
2. 信心徽章 ConfidenceBadge：把 0–1 的信心值顯示成「高/中/低」或百分比小徽章，低信心用較灰、附「據公開資訊」語氣提示。
3. Provenance 徽章 ProvenanceBadge：標示某欄位「來源（crawler/human/llm/import）＋信心＋是否已驗證(verified)」，已驗證打勾綠、未驗證顯示來源圖示＋可點「確認」。
4. Job 進度卡 JobProgressCard：長任務（爬蟲、生圖）queued→running→done/failed 的進度卡，含轉圈/進度、可離開再回來、失敗顯示錯誤文案與重試。
5. 三態容器 StateBoundary：每個資料區塊都要有「載入中（skeleton）/ 空（空狀態插畫＋引導動作）/ 錯誤（顯示錯誤文字＋重試鈕）」三態。
6. Toast：右上或底部的短暫通知（成功/失敗/資訊），可堆疊、可自動消失。
7. 空狀態 EmptyState：友善插畫或圖示＋一句話＋主要 CTA。

## 無障礙與鍵盤操作（六個畫面都要做到）
- 所有互動元件可 Tab 聚焦、有清楚 focus ring（用 accent 色描邊，深色下要看得見）。
- 快捷鍵要有：例如批准佇列的「A＝接受 / S＝略過」，且畫面上要標示快捷鍵提示（kbd 樣式）。快捷鍵不可與輸入框衝突（聚焦輸入框時停用單鍵快捷鍵）。
- 顏色不可作為唯一資訊載體（PASS/FAIL 除了顏色也要有文字/圖示）。文字與背景對比達 WCAG AA。
- 支援 prefers-reduced-motion：關閉大動畫。
- 語意化 HTML＋ARIA（角色、live region 用於即時流如逐字稿/toast）。

## Responsive 原則
- /crm、/studio：桌面優先（工作台），但要能在窄視窗收合成單欄。
- /present：全螢幕舞台，字級用 vw/cqw 隨視窗縮放（投影用），內容置中。
- /copilot：桌面（Chrome/Edge），單欄卡片流即可。
- /hud：手機直式優先（rep 拿第二裝置看），大觸控目標（≥44px）、單欄、可單手操作；同時要能在平板/桌面放大成兩欄。
- /train：桌面與平板皆可，對練畫面像「視訊通話」佈局。

## 交付慣例（每個畫面都照做）
- 元件要「狀態 props 化」：所有資料從 props / mock store 進來，不要把 fetch/WS 呼叫寫死在元件內部（工程側之後會把 mock 換成真 API）。
- 幫每個可複用元件取清楚的名字（如上面列的）。
- 用假資料把「有很多筆」「只有一筆」「空」「載入中」「錯誤」都示範出來（可加切換開關 demo）。

讀完請回覆「已建立設計語言，請給我第一個畫面」。
````

---

## 三、PROMPT 1｜/crm（公司清單／詳情｜CRM 核心）

````
請設計 MeetCopilot v2 的 /crm 畫面（沿用我先前給的設計語言與通用元件），產出可互動的 HTML/React artifact 原型，用 mock 假資料驅動、狀態齊全。

## 目標
讓 rep 在會前把「對方公司＋關鍵主管＋對方產品」建成一份可信的 CRM 檔案：爬蟲先填大半欄位，rep 逐欄「確認」或「細填」。這是整個平台的資料核心。

## 使用者情境
rep 明天要跟某公司開會。他打開 /crm，搜到或新建這家公司，按「enrich（研究）」讓爬蟲去填欄位；幾十秒後欄位陸續填好、每個欄位帶「來源＋信心＋未驗證」徽章；rep 快速掃一遍，把對的欄位一鍵「確認」、把錯的欄位「細填」（行內編輯改成人工值）。再切到「人物」看主管 persona、切到「產品深檔」看對方產品。

## 必備畫面／元件
1. 左：公司清單（來自 GET /api/crm/companies）
   - 搜尋框（query）、狀態篩選（status）、分頁。
   - 每列＝logo、公司名、產業、accountStatus 徽章、verifiedStatus 徽章、crawlConfidence 信心徽章、lastCrawledAt。
   - 頂部「＋ 新增公司」開一個小表單（name 必填、domain?、websiteUrl?）。
2. 右：公司詳情，頂部是公司頭（logo/名稱/domain/產業）＋一排 counts（contacts/products/news/deals 數字大字），下面是 tabs：
   - 總覽（Overview）：公司主要欄位（描述、產業、規模、地點…），每個欄位一行、右側掛 ProvenanceBadge。
   - 人物（Contacts）：主管清單→點開 persona 卡。
   - 產品深檔（Products）：對方產品清單→點開產品詳情（規格/功能/定價/技術棧/整合/路線圖）＋「產品↔人」關聯（developer/PM/owner…）。
   - 新聞（News）、技術棧（Tech）、部門（Departments）：各自子表清單（GET .../news /tech /departments）。
   - 商機（Deals）：該公司的 deal 清單＋stage。
   - 筆記（Notes）：可新增/釘選的筆記流。
3. 「確認／細填」provenance 互動（本畫面的靈魂，請做到位）：
   - 每個「爬蟲填的欄位」旁邊有 ProvenanceBadge：來源（crawler/human/llm/import）＋信心＋是否 verified。
   - 「一鍵確認」：未驗證欄位上有「✓ 確認」小鈕，按下＝呼叫 confirm，該欄變 verified（值不變、徽章轉綠打勾）。
   - 「細填」＝行內編輯（inline edit）：點欄位進入編輯態，存檔＝PATCH 該實體；存完該欄 provenance 變成 filled_by=human。
   - 要能「批次確認整個 tab 的欄位」的便捷操作（可選）。
4. enrich 觸發與 crawl job 進度：
   - 公司頭有「研究此公司」按鈕，展開讓 rep 選 mode：quick（輕量）/ detailed（會前建檔：爬官網＋子頁＋grounding），detailed 可填一個 url。
   - 送出後用 JobProgressCard 顯示 crawl job：queued→running→done/failed，done 顯示 fieldsFilled 數與 sources 清單，可離開再回來。
5. 人物 persona 卡（Contacts tab 點開）：
   - 顯示姓名、title、seniority、decisionPower（決策權，做成醒目視覺如 1–5 級或高/中/低）、photo。
   - persona 區塊：hot buttons（在意什麼）、objections（可能異議），這些是「人驗證/會議衍生」的高信任欄位，用不同視覺與爬蟲猜測區隔。

## 關鍵互動
- 清單↔詳情：點清單選中公司，右側載入詳情。
- 確認：樂觀更新徽章、失敗回滾＋toast。
- 細填：行內編輯有「儲存/取消」，儲存中顯示 spinner。
- enrich：非同步 job，過程中欄位可能被「填新值」，要能刷新詳情看到新欄位。

## 必做狀態
- 載入：清單/詳情各自 skeleton。
- 空：無公司→引導「新增第一家公司」；某 tab 無資料→空狀態＋「用研究引擎補齊」CTA。
- 錯誤：API 失敗顯示 {error} 文案＋重試。
- job 失敗：JobProgressCard 顯示 error 文字＋重試鈕。

## 後端提供的接口（照 API_CONTRACT §1–3，一字不差；ID=UUIDv7 字串、時間=epoch 毫秒 number；分頁 ?page=1&pageSize=20 → {items,total}；錯誤一律 {error}）
```ts
// §1 Auth（載入使用者/組織/角色）
GET  /api/auth/me
  → { user, org, role:'owner'|'admin'|'member' }

// §2 CRM — 公司
GET  /api/crm/companies?query=&status=&page=&pageSize=
  → { items: CompanySummary[], total: number }
  CompanySummary = { id, name, domain?, industry?, logoUrl?, accountStatus?, verifiedStatus, crawlConfidence?, lastCrawledAt?, ownerUserId? }
POST /api/crm/companies      body { name, domain?, websiteUrl? } → Company
GET  /api/crm/companies/:id  → Company（全欄位）＋ counts:{ contacts, products, news, deals }
PATCH  /api/crm/companies/:id  body {...部分欄位} → Company   // 語意＝細填：被改欄位寫 filled_by='human'
DELETE /api/crm/companies/:id  → 204
GET  /api/crm/companies/:id/news        → 子表陣列
GET  /api/crm/companies/:id/locations   → 子表陣列
GET  /api/crm/companies/:id/funding     → 子表陣列
GET  /api/crm/companies/:id/tech        → 子表陣列
GET  /api/crm/companies/:id/departments → 子表陣列

// §2 CRM — 人物（主管）
GET  /api/crm/companies/:id/contacts → ContactSummary[]   // 含 title, seniority, decisionPower?, verifiedStatus, photoUrl?
POST /api/crm/companies/:id/contacts  body { fullName, title? } → Contact
GET | PATCH | DELETE  /api/crm/contacts/:id   // PATCH＝細填語意同上

// §2 CRM — 對方產品深檔
GET  /api/crm/companies/:id/products → CompanyProduct[]
POST /api/crm/companies/:id/products  body { name, ... } → CompanyProduct
GET | PATCH | DELETE  /api/crm/products/:id
GET  /api/crm/products/:id/people → { contact:ContactSummary, role, titleOnProduct?, confidence? }[]
POST /api/crm/products/:id/people  body { contactId, role, titleOnProduct? }
DELETE /api/crm/products/:id/people  body { contactId }

// §2 CRM — 商機／筆記
CRUD /api/crm/deals、/api/crm/deals/:id → Deal（stage enum）；/api/crm/deals/:id/contacts（buying committee）
GET | POST /api/crm/notes?entityType=&entityId=
  Note = { id, entityType, entityId, body, noteType, pinned, createdAt }
PATCH | DELETE /api/crm/notes/:id

// §2 CRM — Provenance（「確認／細填」UI 的資料來源）
GET  /api/crm/provenance?entityType=&entityId=
  → FieldProvenance[] = { fieldName, valueSnapshot, filledBy:'crawler'|'human'|'llm'|'import', sourceType?, sourceUrl?, confidence?, verified:0|1, createdAt }
POST /api/crm/provenance/confirm  body { entityType, entityId, fieldName }
  → 該欄 verified=1（確認；值不變）    // 細填＝改用 PATCH 實體

// §3 研究引擎（enrich 與 grounding）
POST /api/research/enrich  body { targetType:'company'|'contact', targetId, mode:'quick'|'detailed', url? } → 202 { jobId }
GET  /api/research/jobs/:id
  → { id, targetType, targetId, mode, status:'queued'|'running'|'done'|'failed', fieldsFilled?, sources?:string[], error?, startedAt?, finishedAt? }
GET  /api/research/jobs?targetId=  → 歷史 jobs
POST /api/research/ground  body { query, companyId?, meetingId? } → { answer:string, citations:{ title, url }[] }
```

## 驗收要點（3–5 條）
1. 每個爬蟲欄位都能看到 provenance（來源＋信心＋verified），且「確認」「細填」兩個動作都跑得通（確認只變 verified、細填走 PATCH）。
2. enrich 走 job 模式：送出得 jobId、輪詢顯示 queued→running→done、done 後看得到 fieldsFilled 與 sources，離開再回來仍在。
3. tabs 完整（總覽/人物/產品深檔/新聞/技術棧/部門/商機/筆記），且各自有空/載入/錯誤三態。
4. persona 卡把 decision_power / hot buttons / objections 呈現清楚，且高信任（人驗證）欄位與爬蟲猜測有視覺區隔。
5. 前端永不傳 orgId（org 隔離由 server 從 JWT 推導）；所有請求帶 Authorization: Bearer <JWT>。
````

---

## 四、PROMPT 2｜/studio（DynamicSlide 簡報工作室）

````
請設計 MeetCopilot v2 的 /studio 畫面（沿用設計語言與通用元件），產出可互動的 HTML/React artifact 原型。

## 目標
讓 rep 在會前準備簡報：新建/匯入 deck，用三段 wizard 生成，進 slide 編輯器微調，pre-meeting 產生 AI 圖，最後匯出 pptx。

## 使用者情境
rep 開 /studio 看到 deck 清單，按「新建」進三段 wizard：第一段填方向與素材（主題、頁數、要點、可貼一段來源文字或從網址/PDF 匯入），第二段選受眾與風格（audience/tone/style、可傳 logo 與參考圖），第三段檢視並生成。生成後進編輯器，逐頁調整 blocks，對某頁按「AI 生背景圖」，等 ~10–80 秒（耐心 UI），完成套上；若被內容審核拒絕（refused）就顯示「已套用 fallback 漸層」。滿意後匯出 pptx。

## 必備畫面／元件
1. Deck 清單（GET /api/decks）：卡片格，每張顯示 title、language、slideCount、updatedAt；「＋ 新建」與「從檔案匯入」。
2. 三段 wizard（stepper）：
   - Step 1 方向與素材：topic（必填）、pages（頁數）、language、objective?、keyPoints?（多筆）、metrics?、sourceText?（可貼長文）；並提供「從網址匯入」（呼叫 extract-url，把回來的 text 灌進 sourceText）與「從 PDF 匯入」（extract-pdf）。
   - Step 2 受眾與風格：audience?、tone?、style?、logoDataUri?（上傳→轉 dataURI）、refImageDataUris?（多張參考圖）。可選 companyId（綁定 CRM 公司做 grounding）。
   - Step 3 檢視生成：把前兩段參數摘要出來，「生成簡報」按鈕呼叫 decks/generate。生成中顯示進度感（此為同步回 Deck，但可能久，要有 loading）。
3. Slide 編輯器：
   - 左＝slide 縮圖列（可選頁）；中＝目前 slide 預覽（16:9 舞台比例）；右＝該頁的 blocks 屬性面板（標題/內文/清單/圖片等 block 型別，依 SlideSpec 結構）。
   - 編輯某頁存檔＝PATCH /api/decks/:id/slides/:index。
   - 註明：live（會中）時只有 pending 尾段可改，改已播頁會回 409（本畫面主要是會前，但要把 409 的錯誤態設計出來：顯示「此頁已播出，無法修改」）。
4. AI 生圖 job（pre-meeting）：
   - 在某頁按「生成背景圖」或「整頁生圖」，選 kind:'background'|'full'、可填 prompt。
   - 呼叫 image-jobs 得 jobId，用 JobProgressCard 輪詢；文案要傳達「AI 生圖約 10–80 秒，可以先去做別的、完成會套上」的耐心 UI（進度轉圈＋預估時間＋可離開）。
   - status='done' 拿 dataUri 套為背景/整頁；status='refused'（內容審核拒絕）顯示「已自動套用 fallback 漸層背景」的友善提示，絕不出現壞頁；status='failed' 顯示 error＋重試。
5. 匯出 pptx：「匯出 .pptx」按鈕 → GET export.pptx 下載（顯示下載中狀態）。

## 關鍵互動
- wizard 三段可前後切換、保留已填。
- 匯入（url/pdf）是非同步抽取，回來的 text 要能預覽再決定灌入。
- 生圖是長任務，多頁可各自有自己的 job 卡；同時進行時互不阻塞。

## 必做狀態
- 載入：deck 清單/編輯器 skeleton。
- 空：無 deck→引導新建/匯入。
- 錯誤：generate/import 失敗顯示 {error}＋重試；PATCH 409（違反 I1）顯示專屬文案。
- 生圖：queued/running/done/failed/refused 五態都要設計（refused 特別重要＝已套 fallback）。

## 後端提供的接口（照 API_CONTRACT §4，一字不差；長任務走 job 模式：POST → 202 {jobId}，GET 輪詢）
```ts
GET  /api/decks → { items:{ id, title, language, slideCount, updatedAt }[], total }
POST /api/decks/generate
  body { topic, pages, language, objective?, keyPoints?, metrics?, audience?, tone?, style?, logoDataUri?, refImageDataUris?, sourceText?, companyId? }
  → Deck                                   // companyId 供 CRM grounding
POST /api/decks/import  （multipart：pptx/pdf） → Deck
GET  /api/decks/:id → { deck:{ id, title, language, committedIndex }, slides: SlideSpec[] }
PATCH /api/decks/:id/slides/:index  body { slide: SlideSpec }
  // 會前編輯；live 中僅 pending 區可改，違反 I1 → 409
POST /api/decks/:id/image-jobs  body { slideIndex, kind:'background'|'full', prompt? } → 202 { jobId }
  // pre-meeting AI 生圖（OpenAI gpt-image-2，約 10–80s）
GET  /api/image-jobs/:id
  → { status:'queued'|'running'|'done'|'failed'|'refused', dataUri?, error? }
  // refused＝內容審核拒絕 → 前端顯示「fallback 漸層已套用」
GET  /api/decks/:id/export.pptx → 檔案下載（RFC5987 檔名）
POST /api/extract-url  body { url } → { title?, text }   // wizard grounding；SSRF-guarded
POST /api/extract-pdf  （multipart） → { text }
```
（SlideSpec 的完整 block 結構由工程側 packages/shared 定義；設計時把 slide 當成「標題＋若干 block（內文/清單/圖片/背景圖）」的結構化物件即可，不要把樣式寫死成單一版型。）

## 驗收要點（3–5 條）
1. 三段 wizard 完整，且「從網址/PDF 匯入」把抽取文字灌進 sourceText 的流程走得通。
2. 生圖 job 五態齊全，尤其 refused 明確顯示「已套 fallback 漸層」、絕不出壞頁；~80s 有耐心 UI 且可離開再回來。
3. slide 編輯器以「blocks」結構呈現與編輯，存檔走 PATCH；並設計出 409（已播頁不可改）的錯誤態。
4. deck 清單與編輯器都有空/載入/錯誤三態。
5. 匯出 pptx 有下載中/完成/失敗回饋。

## 本 surface 的不變量約束
- I1（只改 pending）：PATCH slide 若違反（改到已播頁）server 回 409，前端要有專屬錯誤態；編輯器不可讓使用者以為能改已播頁而無提示。
````

---

## 五、PROMPT 3｜/present（播放視圖｜零 HUD 乾淨舞台）

````
請設計 MeetCopilot v2 的 /present 畫面（沿用設計語言，但這個畫面極簡），產出可互動的 HTML/React artifact 原型。

## 目標
這是報告者（帳號 A）分享進 Google Meet 的「簡報播放視圖」。它是一個乾淨舞台：只有投影片＋頁碼，其他什麼都不能有。客戶會看到這個畫面，所以任何副駕資訊都絕對不能出現在這裡。

## 使用者情境
rep 用帳號 A 開 /present 全螢幕，只把「這個分頁」分享進 Meet。他用鍵盤左右鍵翻頁；每翻一頁，前端上報 page_commit。會中副駕批准了一張新補充頁後，deck_update 會靜默把新頁 append 到簡報尾端（rep 之後翻到它時才播出），過程中畫面上不彈任何提示。

## 必備畫面／元件（極簡！）
1. 全螢幕投影片舞台：16:9 置中，字級用 vw/cqw 隨視窗縮放（投影機/大螢幕都清楚）。渲染目前 slide（SlideSpec）。
2. 頁碼指示：低調地顯示「目前頁 / 總頁數」（例如右下角小字），這是唯一允許的 overlay。
3. 鍵盤翻頁：← / → 或 PageUp/PageDown 或空白鍵前進；翻頁要平順。
4. （可選）極簡進度條或翻頁時的頁碼淡入淡出——但不得有任何文字通知、卡片、逐字稿、建議。

## 關鍵互動
- 翻頁 → 本地切頁 ＋ 送 page_commit{index}（committedIndex 單調遞增，只增不減）。
- 收到 deck_update{op:{kind:'APPEND', slide}, index} → 靜默把該 slide 接到 deck 尾端，不打斷目前播放、不彈任何東西；使用者翻到最後才會看到它。
- 收到 session_state → 同步 committedIndex（重連時對齊頁碼）。

## 必做狀態
- 載入：deck 載入前顯示極簡 loading（品牌暗底＋轉圈），不要有雜訊。
- 斷線：WS 斷線時**不得**在舞台上顯示大紅字（客戶會看到）；用極不顯眼的方式（如頁碼旁一個小圓點變色）表示，且本地已載入的頁仍可翻。重連後 session_state 對齊。
- 空/錯誤：deck 載不到時顯示中性的「簡報載入中」而非技術錯誤（客戶側友善）。

## 後端提供的接口（WS，照 API_CONTRACT §6 的 present 角色子集，一字不差）
```ts
// 連線：/ws?token=<wsToken>&meetingId=&role=present
// （wsToken 與 wsUrl 由 POST /api/meetings 建 session 時取得）

// Client → Server（present 只發這些）
{ type:'hello', role:'present' }
{ type:'page_commit', index:number }   // 已播到第 index 頁；committedIndex 單調遞增
{ type:'ping' }

// Server → Client（present 只消費這些）
{ type:'deck_update', op:{ kind:'APPEND', slide: SlideSpec }, index:number }   // 批准後 append 到尾端
{ type:'session_state', consent:boolean, committedIndex:number, connectedRoles:string[] }  // 連線/重連同步
{ type:'error', code:string, message:string }
```
（注意：present 角色**不會**收到 transcript / signals / info_card / suggestion / research_status——那些只送給 hud。若你在設計時看到這些訊息，代表串錯角色。）

## 驗收要點（3–5 條）
1. 舞台上除了投影片與頁碼，絕無任何建議/逐字稿/資訊卡/通知/toast（用眼睛掃一遍，一個都不能有）。
2. 鍵盤翻頁順暢，翻頁即送 page_commit，且 index 單調遞增。
3. deck_update 是「靜默 append 到尾端」，不打斷當前播放、不彈任何 UI。
4. 斷線時客戶側看不到刺眼技術錯誤，重連用 session_state 對齊頁碼。

## 本 surface 的不變量約束（最重要）
- I3（HUD 絕不外流）：這個畫面會被分享給客戶，**絕對不能**渲染任何副駕元素（建議、逐字稿、卡片、研究、通知）。這是硬約束，設計時把它當紅線。
- I1（append-only）：deck 只會從尾端長出來（APPEND），不會插入中段、不會改已播頁。
- I2（需批准）：present 只在「報告者已批准」後才收到 deck_update；未批准的內容永遠不會到這裡。
````

---

## 六、PROMPT 4｜/copilot（擷取端｜帳號 B 開）

````
請設計 MeetCopilot v2 的 /copilot 擷取端畫面（沿用設計語言與通用元件），產出可互動的 HTML/React artifact 原型。

## 目標
這是「接收聲音」的擷取端，由帳號 B 在 Chrome/Edge 桌面開。它用 getDisplayMedia 擷取「Meet 分頁的音訊」（所有人的混音），送去做 ASR→分析→研究。核心體驗＝把「分享分頁並勾選分頁音訊」這件容易做錯的事，引導使用者一次做對。

## 使用者情境
帳號 B 已用靜音+關鏡頭加入同一個 Meet。rep 在同一 profile 另開 /copilot，按大大的「開始聆聽」→瀏覽器彈出分頁選擇器→使用者要選對 Meet 分頁**並勾「分享分頁音訊」**。如果他沒勾（拿到 0 條音軌），畫面要立刻用紅色指引教他重試。開始後顯示即時音量表＋session 狀態，並有 consent（同意）閘：未同意不啟動分析。若音軌中途 ended（使用者按了瀏覽器的「停止分享」），要引導重連。

## 必備畫面／元件
1. 開始前：一個大大的「開始聆聽」主按鈕＋一句話說明「將擷取這個 Meet 分頁的聲音用於即時副駕」。
2. 分頁選擇教學：按下後彈系統選擇器，同時畫面顯示圖解教學：「① 選『Chrome 分頁』②『這個 Meet 分頁』③ 一定要勾『分享分頁音訊 / Share tab audio』」。（教學是我方 UI，系統彈窗本身無法改。）
3. zero-track 守衛：若拿到的 stream 沒有 audio track（使用者沒勾音訊）→整塊變紅色錯誤區：「沒有偵測到音訊！請重新分享並勾選『分享分頁音訊』」＋「重新分享」鈕。這是本畫面最重要的防呆。
4. 進行中：
   - 即時音量表（VU meter，隨麥波動）證明「真的有聽到聲音」。
   - session 狀態列：已連線角色（connectedRoles）、committedIndex、consent 狀態。
   - consent 閘：一個明確的「我已取得與會者同意錄音分析」開關/確認；未同意時分析不啟動（送 consent{granted:false} 或不送 hello 後的分析），畫面標示「等待同意」。
5. track ended 重連：偵測 audio track 的 ended 事件→顯示「分享已停止」＋「重新開始聆聽」，可一鍵重來。
6. 平台提示：小字提醒「此端限 Chrome/Edge 桌面；此瀏覽器分頁永不被分享」。

## 關鍵互動
- 開始聆聽 → getDisplayMedia → 檢查 audio tracks 數量（0＝紅色守衛）。
- 音量表：把 audio track 接上 Analyser 畫波形/柱狀（原型可用假波形 demo，但要示範「有聲/靜音」兩態）。
- consent：切換 granted 會送 WS consent，且 UI 明確反映「分析中／等待同意」。
- 斷線/ended：清楚的重連路徑。

## 必做狀態
- 初始（未開始）、請求權限中、0 音軌錯誤（紅色守衛）、聆聽中（音量表跳動）、等待同意、已同意分析中、track ended（需重連）、WS 斷線重連。
- 錯誤：getDisplayMedia 被拒／不支援瀏覽器→友善說明與指引。

## 後端提供的接口（WS，照 API_CONTRACT §6 的 capture 角色；音訊走 binary frame）
```ts
// 連線：/ws?token=<wsToken>&meetingId=&role=capture
// （wsToken/wsUrl 來自 POST /api/meetings；音訊＝16-bit PCM 16kHz mono，~250ms/frame，直接丟 ArrayBuffer binary frame）

// Client → Server
{ type:'hello', role:'capture' }
{ type:'consent', granted:boolean }   // capture：未同意不啟動分析
{ type:'ping' }
// 以及：binary frame（PCM 音訊）持續上送

// Server → Client（capture 消費）
{ type:'session_state', consent:boolean, committedIndex:number, connectedRoles:string[] }
{ type:'error', code:string, message:string }
```
```ts
// 建立 session（進入本頁前，取得 wsUrl/wsToken）
POST /api/meetings  body { title, companyId?, dealId?, deckId? }
  → { meeting:{ id, ... }, wsUrl, wsToken }   // wsToken 短效
```

## 驗收要點（3–5 條）
1. zero-track 守衛確實存在：0 音軌時整塊紅色指引＋重新分享，是最醒目的錯誤態。
2. 分頁選擇教學把「一定要勾分享分頁音訊」講得夠清楚（圖解＋文字）。
3. 音量表能證明「有聽到聲音」，且有聲/靜音兩態可 demo。
4. consent 閘明確：未同意不啟動分析，UI 狀態誠實反映。
5. track ended 有清楚重連路徑；並標示「限 Chrome/Edge、此分頁不被分享」。

## 本 surface 的不變量約束
- 隱私/同意：未同意（consent=false）不啟動分析——設計要讓「等待同意」是明確可見的閘門。
- I3 相關：此擷取瀏覽器永不被分享（提示即可，非本頁強制邏輯）。
````

---

## 七、PROMPT 5｜/hud（報告者 HUD｜第二裝置、手機直式優先）

````
請設計 MeetCopilot v2 的 /hud 畫面（沿用設計語言與通用元件），手機直式優先，產出可互動的 HTML/React artifact 原型。

## 目標
這是報告者在**第二裝置（手機/平板）**上看的副駕抬頭顯示。它即時串流逐字稿、資訊卡、建議批准佇列，讓 rep 一邊講一邊接情報、一鍵批准新簡報頁、必要時「深查」某主題。這個畫面只在 rep 手上，客戶看不到。

## 使用者情境
rep 開會時把手機立在桌上開 /hud。畫面上半是即時逐字稿流（誰在講：presenter/client/unknown）；中間浮出資訊卡（對方公司/主管/battlecard/objection handler/研究，每張帶信任徽章）；當副駕想加一張補充簡報頁，會進「建議批准佇列」，rep 按 A 接受 / S 略過（手機上是大按鈕），每個建議有 expiresAt 倒數、可展開 edit 微調。rep 也能在「深查」框輸入主題觸發研究（顯示剩餘配額）。WS 斷了會自動重連並用 session_state 恢復。

## 必備畫面／元件
1. 即時逐字稿流（transcript）：氣泡/行流，speaker 標記 presenter/client/unknown（三色/三標籤區隔），final=false 的顯示為「正在聽…」的暫定樣式，final=true 定稿。自動捲到最新（但使用者手動上捲時暫停自動捲）。
2. 資訊卡流（info_card）：卡片流，五種 kind：company / contact / battlecard / objection_handler / research，每張含 title、body、可選 sourceUrl、confidence，以及 trust 徽章：verified（人驗證，最高）/ crawler（爬蟲）/ live（即時研究）。trust 要有明顯視覺階（verified 綠實心、crawler 藍描邊、live 紫脈動）。
3. 建議批准佇列（suggestion，本畫面核心）：
   - 每個建議＝一張待批准的新簡報頁（slide 預覽縮圖）＋reason（為什麼建議）＋expiresAt 倒數計時（進度環/條，逾時自動 discard）。
   - 快捷鍵：A＝接受、S＝略過（桌面）；手機＝大「接受／略過」按鈕（≥44px，拇指可及）。
   - 「編輯後接受」：展開 edit 面板可改 slide 內容，再送 accept＋editedSlide。
   - 送出後等 suggestion_result：applied（顯示「已加入第 N 頁」）/ discarded（淡出）。
4. 「深查」輸入框（deep_research）：一個輸入框＋送出，觸發研究；旁邊顯示 remainingQuota（本場剩餘配額，用完禁用並提示）。送出後用 research_status 顯示 jobId 的 queued→running→done 與更新後的配額。
5. 連線狀態列：顯示 WS 連線/重連中；斷線時 banner「重新連線中…」，恢復後用 session_state 回填（不丟資料感）。

## 關鍵互動
- A/S 快捷鍵＋觸控按鈕雙軌；聚焦「深查」輸入框時停用單鍵快捷鍵。
- 建議倒數：expiresAt 到了自動略過並淡出。
- 深查配額：remainingQuota=0 時禁用送出＋提示「本場配額已用盡」。
- 逐字稿 final 態切換：暫定→定稿的視覺過渡。

## 必做狀態
- 載入：首次連線 skeleton。
- 空：還沒有逐字稿/卡片/建議時，各區塊各自友善空狀態（「聆聽中，尚無…」）。
- 錯誤：WS error{code,message} 顯示為不打斷的小提示。
- 斷線：明確「重新連線中」banner；重連成功用 session_state 恢復 consent/committedIndex/connectedRoles，且不清空已收到的流。

## 後端提供的接口（WS，照 API_CONTRACT §6 的 hud 角色，一字不差）
```ts
// 連線：/ws?token=<wsToken>&meetingId=&role=hud

// Client → Server（hud 發這些）
{ type:'hello', role:'hud' }
{ type:'suggestion_action', suggestionId, action:'accept'|'edit'|'reject', editedSlide?:SlideSpec }
{ type:'deep_research', query:string }   // 「深查」→ 觸發研究（受每場上限）
{ type:'ping' }

// Server → Client（hud 消費）
{ type:'transcript', segment:{ id, t:number, speaker:'presenter'|'client'|'unknown', text, final:boolean } }
{ type:'signals', items:{ id, kind:'interest'|'objection'|'pain'|'competitor_mention'|'buying_signal'|'risk'|'pricing'|'next_step'|'landmine', label, confidence }[] }
{ type:'info_card', card:{ id, kind:'company'|'contact'|'battlecard'|'objection_handler'|'research', title, body, sourceUrl?, confidence?, trust:'verified'|'crawler'|'live' } }
{ type:'suggestion', suggestion:{ id, slide:SlideSpec, reason, expiresAt } }   // 批准佇列
{ type:'suggestion_result', suggestionId, status:'applied'|'discarded', newSlideIndex? }
{ type:'research_status', jobId, status, remainingQuota:number }
{ type:'session_state', consent:boolean, committedIndex:number, connectedRoles:string[] }
{ type:'error', code:string, message:string }
```
（signals 可用來在逐字稿旁標記情緒/訊號小標籤；kind 列舉照上面九種。suggestion_action 只接受報告者本人的連線——這是後端的授權，前端照常送即可。）

## 驗收要點（3–5 條）
1. 手機直式單手可操作：批准按鈕大、拇指可及；A/S 快捷鍵在桌面可用且有 kbd 提示。
2. trust 徽章（verified/crawler/live）視覺階清楚；資訊卡五種 kind 都有樣式。
3. 建議佇列有 expiresAt 倒數＋逾時自動略過＋edit 展開；送出後正確反映 suggestion_result（applied/discarded）。
4. 深查顯示 remainingQuota 且配額用盡禁用；research_status 進度可見。
5. WS 斷線有「重連中」banner，重連用 session_state 恢復且不清空既有流。

## 本 surface 的不變量約束
- I2（需批准）：新頁只有在此佇列被 accept/edit 才會 append 進 deck；reject 或逾時＝discarded 不可恢復。批准動作要明確、不誤觸。
- I3（HUD 不外流）：此畫面只在第二裝置、只看不擷取，天然不進被分享畫面——設計上不需擷取任何螢幕。
````

---

## 八、PROMPT 6｜/train（語音模擬訓練）

````
請設計 MeetCopilot v2 的 /train 畫面（沿用設計語言與通用元件），產出可互動的 HTML/React artifact 原型。

## 目標
讓 rep 在會前用 AI 對練：AI 用 CRM 裡某位真實 contact 的 persona 扮演「那位客戶」，跟 rep 即時語音對話（可打斷、低延遲）。練完給一份四維評分報告。

## 使用者情境
rep 選一位「準備度足夠（persona 欄位已過 verified 閘）」的 contact 當對練對象，選難度（友善/中性/敵對），進對練畫面。畫面像視訊通話：顯示連線中→AI 說話中→你說話中→（被打斷）等狀態，雙向即時字幕同步跑，有計時；超過 15 分鐘會無感續連（不斷對話感）。練完進評分報告：四維分數（0–100）＋highlights 引述卡（好的/待改進）。

## 必備畫面／元件
1. persona 選擇器：列出可對練的 contacts（GET /api/train/personas）。**只列 persona 欄位過 verified 閘者**；每個顯示 fullName、title、companyName，以及 readiness：verifiedFields 數與 missing[]（缺哪些欄位）。準備度不足的用「補齊後可對練」提示（連回 /crm 補），不可直接開練。
2. 難度選擇：friendly / neutral / hostile 三選一（視覺上表達強度）。
3. 語音對練畫面（像通話）：
   - 中央大區＝對方 persona 頭像／名牌（displayName + title）。
   - 明確的狀態視覺：連線中（connecting）、AI 說話中（AI 波形動、你的麥暗）、你說話中（你的波形動）、被打斷（interrupt 的瞬間視覺，例如 AI 波形被切斷）。
   - 雙向即時字幕：rep 與 ai 兩邊的字幕即時顯示（speaker:'rep'|'ai'），像雙色對話流。
   - 計時器；>15 分鐘自動續連（resumption）要「無感」——不可出現斷線再連的突兀感，最多一個極小的「已續連」微提示。
   - 結束按鈕（掛斷）。
4. 課後評分報告：
   - 四維分數（0–100）大數字＋雷達圖或四條 bar：objectionHandling（異議處理）、discovery（發現需求）、clarity（表達清晰）、closing（成交推進）。
   - highlights 引述卡：每張含 quote（逐字引述）＋comment＋kind:'good'|'improve'（好/待改進兩色）。
   - summary 總評；可回看逐字稿（transcriptRef）。

## 關鍵互動
- 選 persona→選難度→開始（POST sessions，拿 ephemeralToken 後瀏覽器直連 Gemini Live，音訊不經我方 server）。
- 對練中把雙向逐字稿累積，中途/結束時上傳（POST .../transcript）。
- 結束→finish 觸發評分→拿 reportId→GET report 顯示。
- 狀態機視覺：connecting / ai-speaking / user-speaking / interrupted 要一眼可辨。

## 必做狀態
- 載入：persona 清單 skeleton；報告載入 skeleton。
- 空：無可對練 persona→引導去 /crm 補齊 verified persona 欄位。
- 錯誤：建 session 失敗、麥克風權限被拒、Live 連線失敗→友善說明與重試。
- 斷線：>15 分鐘續連無感；真的斷了要能重連或優雅結束並仍出報告。

## 後端提供的接口（照 API_CONTRACT §7，一字不差）
```ts
GET  /api/train/personas?companyId=
  → { contactId, fullName, title, companyName, readiness:{ verifiedFields:number, missing:string[] } }[]
  // 只列 persona 欄位過 verified 閘的 contacts
POST /api/train/sessions
  body { contactId, dealId?, difficulty?:'friendly'|'neutral'|'hostile' }
  → { sessionId, live:{ ephemeralToken, model, expireTime }, persona:{ displayName, title } }
  // 瀏覽器拿 ephemeralToken 直連 Gemini Live，音訊不經我方 server
POST /api/train/sessions/:id/transcript
  body { turns:{ speaker:'rep'|'ai', text, t }[] }   // 對練中/結束時上傳雙向逐字稿
POST /api/train/sessions/:id/finish → { reportId }   // 觸發評分
GET  /api/train/reports/:id
  → { scores:{ objectionHandling, discovery, clarity, closing }:0-100,
      highlights:{ quote, comment, kind:'good'|'improve' }[],
      summary, transcriptRef }
```

## 說明（重要架構事實，設計時要理解）
- 音訊經 **ephemeral token 直連 Gemini Live**，**不經我方 server**：所以對練畫面的「即時語音/字幕」是瀏覽器↔Gemini 的直連，我方 API 只負責建 session（發 token）、收逐字稿、算報告。設計時把「連線」理解為前端直連第三方即時語音。
- Live 單場約 15 分鐘上限 → 必須靠續連（sessionResumption）延續，UI 要讓它無感。

## 驗收要點（3–5 條）
1. persona 選擇器只列 verified-ready 的 contact，且清楚顯示 readiness（verifiedFields／missing），不足者引導補齊而非硬開。
2. 對練畫面四種狀態（連線中/AI 說話中/你說話中/被打斷）視覺一眼可辨，雙向即時字幕同步。
3. >15 分鐘續連無感，不破壞對話連續感。
4. 評分報告四維分數（0–100）＋highlights 引述卡（good/improve）＋summary 完整。
5. 建 session／麥克風權限／Live 連線的錯誤態都有友善處理。

## 本 surface 的不變量約束
- 信任規則：只扮演「人驗證／會議衍生」的 persona 欄位，不拿爬蟲猜測幻想——所以只有 verified-ready 的 contact 能對練（這是後端 GET personas 的過濾，前端照結果呈現即可）。
````

---

## 九、結尾備註｜設計產物交回工程側的對接要求

設計完成、把每個 artifact 代碼交回工程側時，請確保：

1. **元件命名清楚且穩定**：沿用 PROMPT 0 定義的通用元件名（`StatusBadge`、`ConfidenceBadge`、`ProvenanceBadge`、`JobProgressCard`、`StateBoundary`、`Toast`、`EmptyState`…）；各 surface 的主元件也取語意化名字（如 `CompanyDetail`、`ProvenanceField`、`SlideEditor`、`ImageJobCard`、`PresentStage`、`CaptureGuard`、`TranscriptStream`、`SuggestionQueue`、`PersonaPicker`、`TrainCall`、`ScoreReport`）。

2. **狀態全部 props 化**：資料一律從 props / 可注入的 mock store 進來；**不要在元件內部寫死 `fetch` 或 `WebSocket` 呼叫**。工程側會把 mock 換成真 API/WS 層（`apiClient` 與 `wsClient`），元件只認 props 與 callback（如 `onConfirm(fieldName)`、`onAcceptSuggestion(id, editedSlide?)`、`onPageCommit(index)`）。

3. **不要把 API 呼叫寫死在元件內**：把「呼叫哪個端點、送什麼 body」留給工程側的資料層；設計原型可用假 async 函式模擬（回 mock、模擬 loading/error/延遲），但介面（函式簽名、回傳形狀）要對齊本檔的契約形狀，方便工程側直接替換。

4. **契約形狀不可漂移**：artifact 裡用到的欄位名（如 `verifiedStatus`、`crawlConfidence`、`filledBy`、`expiresAt`、`remainingQuota`、`committedIndex`…）與 WS `type` 值（如 `deck_update`、`suggestion_action`、`page_commit`…）**必須與 `docs/API_CONTRACT.md` 一字不差**。若設計上覺得需要新增欄位，寫成 TODO 回報工程側改契約，不要自行改名或杜撰。

5. **三態與斷線態都要交付**：每個 artifact 都附上載入/空/錯誤（＋即時類畫面的斷線重連）示範，方便工程側對接時直接接上真實狀態。

6. **無障礙與 responsive 保留**：交付碼保留 focus ring、鍵盤操作、ARIA live region、`prefers-reduced-motion`、以及各 surface 的 responsive 斷點（尤其 /hud 手機直式、/present 全螢幕縮放）。
