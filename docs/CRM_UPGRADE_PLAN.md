# CRM × DynamicSlide × 模擬訓練 升級計畫（2026-07-23 起，多階段）

> 使用者 2026-07-23 連續三則訊息提出的一整套升級需求，收斂於此，避免跨 session/context 遺失。
> 執行紀律：每階段先凍契約→派工→fresh-context 驗證→（使用者核准）部署→再進下一階段。決策記 ROM、程式改動記 CHANGE_TRACKER。

## 需求全集（原話對照）

- **[R1] AI 補充頁品質**（2026-07-23 訊息 2）：補充頁「跟 CRM 內容沒有直接相關、也沒有寫好給講者的稿，講者不知道該講什麼」；「排版過度單一沒美感，3 個欄位不該 2 上 1 左下、至少三角形，且每頁都長一樣」。
- **[R2] CRM 可編輯校正**（訊息 1）：CRM 有錯誤敘述但無管道更正；要能**直接編輯**，且修正後的資料要成為**後續爬取的正確背景**（在正確背景下抓更多）。
- **[R3] 政府資料爬取**（訊息 1）：CRM 資料太少；公司常與政府合作（標案/採購），要爬政府相關管道。
- **[R4] 模擬訓練可用性**（訊息 3）：
  - (a) 要能**手動新增單一主管**＋他的事情（現在無法，導致無對象可訓練）。
  - (b) CRM 要有**像筆記欄的自由填寫區塊**，讓使用者直接填內容 → **AI 依內容歸位**到結構化欄位 → 也可**依筆記內容做額外研究/調查**。
  - (c) 「已驗證」改成**手動點**（按鈕），不要用欄位內容自動判定（否則很難測試）。
- **[R5] 合成/設計式訓練對象**（2026-07-23 訊息 5）：模擬面談對象**不必是真人**；可**設計對象的人格特質**，再**搭配對方公司的 CRM 內容 ＋ 銷售目的 ＋ 面談目的**組成對練情境。

## 階段規劃

### Phase A — CRM 人工掌控（含測試解鎖，優先）
對應 R2 + R4。先做「解鎖測試」的小改，再做編輯與筆記歸位。
- A1. **手動「已驗證/解鎖對練」開關**（R4c）：persona/contact 加一個手動 verified 切換，取代/覆蓋自動判定的訓練閘 → 立即解鎖模擬訓練測試。
- A2. **手動新增單一主管/聯絡人**＋其欄位（R4a）：create-contact UI＋端點（若無則補）。
- A3. **敘述型/陣列欄位可編輯**（R2）：前端為 company/persona/product 的 description、pain_points、hot_buttons… 補 textarea/chip 編輯器，接既有 `PATCH`＋`applyHumanUpdate`（後端已支援任意欄、寫 human/verified=1）。
- A4. **自由筆記 → AI 歸位 ＋ 延伸研究**（R4b）：一個筆記/自由填寫入口；送出後 AI 把內容歸位到結構化欄位（company/persona），並可依內容觸發研究 job。
- A5. **人工值不被重爬覆寫 ＋ 餵回爬取背景**（R2）：products/子表 upsert 補 `trustedFieldsOf` 檢查；爬取前把已確認的 CRM 權威值注入研究 prompt 當背景。
- A6. **合成/設計式訓練對象**（R5）：模擬訓練 startSession 支援「非真人」對象——可設計人格特質（自由描述→AI 歸位成 persona 欄，或直接填），並在 `buildPersonaPrompt` 融入「對方公司 CRM 內容＋銷售目的＋面談目的」三項情境參數（新增 train session 設定欄位；不必綁真 contact，可用暫時/合成 persona）。與 A1（手動解鎖）、A2（新增主管）、A4（筆記→歸位）協同。
- 既有現況（前次調查）：後端 `PATCH`→`applyHumanUpdate` 已支援任意欄；company/contact 重爬有 `trustedFieldsOf` 防覆寫；provenance 逐欄（`field_provenance`）。缺口＝前端編輯器、products 子表防覆寫、爬取背景注入、create-contact UI、手動 verified、筆記歸位。

### Phase B — AI 補充頁升級（契約已凍結，見下）
對應 R1。CRM 取材＋講者口白（HUD 專用、守 I3）＋版型多樣與美化（3 項三角形、每頁換版型）。

### Phase C — 政府資料爬取
對應 R3。GCIS 公司登記 API（官方免費 JSON、無驗證碼→統編/資本額/董監事）＋決標/標案得標紀錄（走 g0v JSON 或 data.gov.tw 開放資料，避官網驗證碼與法遵風險）。需 migration：companies 加 `tax_id`（統編，政府 API 的 match key）＋新子表 `company_gov_contracts{tender_no, project_name, agency, amount, award_date, source_url}`。經 `safeFetcher`（SSRF-safe），落 CRM＋provenance，不動 I1/I2/I3。

## Phase B 凍結契約（實作只照此，不再改）

- **shared** `packages/shared/src/protocol.ts`：`Suggestion` 加選填 `speakerNotes?: string`（講者口白，HUD 專用，**絕不進 SlideSpec/deck**，守 I3）。`ServerMessage.suggestion` 不動（已引用 Suggestion）。
- **生成** `generateSupplementSlide`（`slide-gen.ts`）：input 加 `crmContext?`（CRM 取材）、`avoidLayout?`（排除上一張版型）；回傳改 `{ slide: SlideSpec; speakerNotes?: string } | null`。新增 `SUPPLEMENT_SLIDE_SCHEMA`＝SLIDE_SCHEMA **移除 notes**＋**加 speakerNotes**（口白不落 slide.notes）。
- **orchestrator**：`suggestSlideCb`/`onSuggestSlide` 尾端加選填 `speakerNotes?`；`maybeSuggestSlide` 組 `crmContext`（直接讀本場 company＋其 contacts 的既有非空值＝§9 白名單實體，org-scoped，不套 verified-only）、傳 `avoidLayout`（新 `lastSuggestLayout` Map，記 `template/主導block`）、成功後 set；`disposeSession` 清 Map。
- **patch-service** `suggest(...)` ＋凍結接縫 `copilot.ts:55` 同步加選填 `speakerNotes?`；append 的是 `suggestion.slide`（結構上不含口白）。
- **hub**：`onSuggestSlide` 佈線多帶 notes。
- **web**：`SuggestionQueue.tsx` 顯示 `speakerNotes`（口白區塊，HUD only）；`SlideRenderer.tsx` features case 加 `feat-count-N` class；`studio-present.css` 對 `.feat-count-3` 給置中 flex-wrap（2/4 項不動）。
- **I3 驗證點**：口白只在 Suggestion；ACCEPT append 的 slide 與 `deck_update`/present 不含口白；present 渲染只讀 eyebrow+blocks+logo。
- **要更新/新增測試**：supplement-slide.test（+speakerNotes 斷言、+avoidLayout 斷言）；新 I3 測試（口白不入 deck_update、只在 suggestion/hud）；mid-meeting-crm.test（+crmContext 含本場欄位值、不含他 org）。

## 執行順序（現行）

1. **Phase A**（解鎖測試優先：A1 手動 verified → A2 新增主管 → A3 編輯 → A4 筆記歸位 → A5 防覆寫/背景注入）
2. **Phase B**（補充頁升級，契約已凍）
3. **Phase C**（政府爬取，含 migration）

（順序可由使用者調整。B 的契約已凍可隨時實作；A 的 A1/A2 為最小測試解鎖、價值即時。）

## Phase A2 凍結契約 — train 頁自助建對象（#1 AI 補齊真人 ＋ #4 AI 虛擬人物）

**使用者決策（2026-07-24，已拍板，實作只照此）**：
- **#1 放行**：AI 補齊真人 persona 後**直接可對練**——欄位仍寫**未驗證草稿**（不標 human/verified，守 §11），但**自動設 `trainingUnlocked=1`** 讓對練閘放行（使用者接受「對練 AI 推斷版的真人」）。
- **#4 歸屬**：虛擬人物**也顯示在 CRM**（公司人物清單），以「虛擬」badge 區分。
- **面談目的／銷售目標**：放**每次對練**（`NewTrainSession.objective`），真人＋虛擬通用。
- 小修（中文名＋深連結）**併本功能一起部署**。

### 已凍型別（`packages/shared/src`，已寫入）
- `crm-types.ts`：`Contact.isSynthetic?: Bool01`、`ContactSummary.isSynthetic?: Bool01`。mappers 已加 `{ col:"is_synthetic", key:"isSynthetic" }`。migration `021_synthetic_contact.sql`（sqlite＋pg，`contacts ADD COLUMN is_synthetic INTEGER NOT NULL DEFAULT 0`）已建。
- `train.ts`：`TrainObjective{salesGoal?,meetingPurpose?}`、`NewTrainSession.objective?`、`PersonaFieldDraft`（九欄，鍵＝Contact persona 欄位＝server `PERSONA_FIELDS`）、`PersonaDraftResult{fields}`、`NewSyntheticPersona{companyId,fullName?,title?,persona?,autoDesign?,difficulty?,objective?}`、`CreateSyntheticResult{contactId}`。

### 端點契約（server 只照此實作）
1. **`POST /api/train/personas/:contactId/draft`（#1）** — body 無。效果：讀該 contact＋其 company 的 CRM 脈絡（company 名/產業/描述/新聞標題/該 contact 的 title/department/seniority/decisionPower），跑 LLM 產九欄 `PersonaFieldDraft`（zh-TW，各一短句）；**以 crawler 級 provenance 寫入未驗證草稿**（走 contact upsert 的非人工路徑，`confidence≈0.5`、`source='ai_draft'`，**不**呼叫 applyHumanUpdate、**不**標 verified）；**設 `trainingUnlocked=1`**。回 `PersonaDraftResult`。錯誤：contact 不存在→404；GEMINI 未設→502（沿用 TrainError 對映）。org-scoped。
2. **`POST /api/train/synthetic`（#4）** — body `NewSyntheticPersona`。效果：`autoDesign`（或 persona 省略）→ LLM 依該 company 脈絡設計九欄 persona（＋若 title 省略可一併給合理職稱）；否則用帶入的 `persona`。建立一個 `is_synthetic=1` 的 contact（`fullName` 省略→給預設如「虛擬決策者」）；**persona 欄位以 human provenance 寫入**（虛擬角色由使用者創作、非臆測真人，標人工合法）；設 `trainingUnlocked=1`。回 `CreateSyntheticResult{contactId}`（201）。錯誤：company 不存在→404；autoDesign 但 GEMINI 未設→502。org-scoped。
3. **`POST /api/train/sessions`（既有，擴充）** — body 多收 `objective?`；startSession 把它傳進 `buildPersonaPrompt`。

### LLM persona 產生器（共用 helper，`apps/server/src/train/persona-gen.ts` 新檔）
- 匯出 `draftPersonaForContact(gemini, {company, contact}) → Promise<PersonaFieldDraft>`（#1）與 `designSyntheticPersona(gemini, {company, hints}) → Promise<{fields: PersonaFieldDraft; title?: string}>`（#4）。
- 用 Gemini structured output（`responseSchema`＝九欄皆 string，nullable/optional；zh-TW；每欄一短句、可空）。system prompt：#1 明示「依已知事實推斷此**真實**決策者的溝通/決策風格與在意點，標示為推斷」；#4 明示「設計一個**虛構但合理**的該公司決策者，可自由創作」。外呼有界（沿用既有 gemini client 逾時慣例）。**記帳**：兩者各一次 `gemini_text`，若有 meter 就現包 metered client（idemPrefix 帶 contactId/companyId＋randomUUID），沿用 finish() 的 metered 寫法。
- **共用**：#1／#4 共用同一 responseSchema 與欄位清單；prompt 文案不同。避免重複定義九欄鍵——可 import server `persona.ts` 的 `PERSONA_FIELDS`。

### 寫入路徑對接（重點，勿繞信任層）
- **#1 未驗證草稿**：走 contact 的**爬蟲/非人工** upsert 路徑寫九欄＋各欄 `field_provenance`（source≠human、confidence≈0.5）；**絕不** applyHumanUpdate、**絕不**動 verified。查現有 `core.contacts` 是否有可寫單一 contact 欄位＋provenance 的非人工方法（如 upsertFromCrawl／updateContact＋provenance write）；若只有 human 路徑，新增最小的「AI 草稿寫入」method（依 CRM_SCHEMA §9 provenance 慣例：值與來源同一 tx）。
- **#4 human persona**：虛擬角色欄位走 `applyHumanUpdate`（human provenance）合法。建立 contact 用既有 `core.contacts.create`（＋set is_synthetic=1；若 create 不收 is_synthetic，最小擴充）。
- `trainingUnlocked=1`：沿用 Cycle 1 的解鎖寫法（PATCH contact training_unlocked，見 020 相關 code）。

### buildPersonaPrompt 用欄語意（**關鍵，勿漏**）＋objective（`persona.ts`）
- **問題**：`buildPersonaPrompt(contact, company, difficulty, trusted)` 目前只用 `trusted`（verified/human）欄位組 persona（§9 預設安全：爬蟲猜測不進 prompt）。但 #1 的 AI 草稿是**未驗證**，若照舊只用 trusted → 會「可對練但 persona 空白」；同理 Cycle 1 的**純手動解鎖**（欄位全是 crawler）也有此潛在空白。
- **凍結語意**：**當 `contact.trainingUnlocked=1` 時，buildPersonaPrompt 改用「所有非空 persona 欄位」（trusted ∪ 未驗證但有值），因為手動解鎖／AI 補齊直接可練＝使用者明示接受用現有內容演。** trainingUnlocked=0（走純 verified 閘）時維持原本 trusted-only 行為不變。實作：startSession 已有 `trusted`＋`contact.trainingUnlocked`；把「有效用欄集合」算好傳入（unlocked→非空欄集合；否則→trusted），或讓 buildPersonaPrompt 收 `unlocked` 旗標自行決定。先讀現況再改，勿破壞 trusted-only 路徑與既有測試。
- **objective**：簽名加選填 `objective?: TrainObjective`；有 `salesGoal`/`meetingPurpose` 時在 prompt 末尾加「本次對練情境」段（zh-TW），指示 AI 依此情境回應。無則不加。

### web UX（`apps/web`）
- **train 頁模式切換**：`PersonaPicker` 之上加「真人 ／ AI 虛擬人物」切換。
  - **真人**：清單同現況；未 ready 的卡除「補齊後可對練」深連結外，**加一顆「讓 AI 補齊」**按鈕 → `POST /personas/:id/draft` → 成功後 refetch personas（該卡變可對練）。載入中禁用＋spinner。
  - **AI 虛擬人物**：公司選擇（重用 `listCompanies`/`GET /api/crm/companies`）→ persona 設定：「讓 AI 決定」（autoDesign）或手動填九欄（可摺疊，給友善中文標籤，複用 `FIELD_LABELS`）→（可選）填 objective → 建立 → `POST /api/train/synthetic` → 成功拿 contactId → 直接進對練/選取。
- **objective 輸入**：對練啟動列（`mc-train__launch`）加兩個選填輸入（銷售目標／面談目的），開始對練時併入 `startSession` body。
- **CRM 虛擬 badge**：`ContactsTab` 列與 `PersonaCard` 於 `c.isSynthetic` 時顯示「虛擬」badge（沿用 `mc-badge` 系）。
- **api.ts**：加 `draftPersona(contactId)`、`createSyntheticPersona(body)`、`startSession` 加 objective；型別鏡像 shared。

### 不變量與測試
- **I1/I2/I3 不受影響**：純 CRM 資料＋對練設定，不動 deck patch／approval／HUD。
- **信任層**：#1 草稿**不**升 verified（只翻 trainingUnlocked）；#4 虛擬角色 human provenance 合法（無真人可誤representation）。
- **測試**：persona-gen 產九欄（mock gemini）；#1 端點寫草稿＋set trainingUnlocked＋不標 verified（斷言 provenance source≠human）；#4 建 is_synthetic contact＋human persona＋可 startSession；buildPersonaPrompt objective 注入斷言；authz 跨 org 憑證對 /draft、/synthetic 應 404/拒絕。

## Phase A3 凍結契約 — 對練情境模式（sales/partnership/government/interview，可擴充）

**使用者決策（2026-07-24，已拍板）**：把「銷售對練」一般化為**可切換情境模式**。首批 **4 個模式**（銷售對練〔現有〕／尋求合作簡報／政府簡報／面試），做成**資料驅動登錄表**（加模式＝加一筆）。評分改**可變維度 labeled 陣列**（各模式維度不同）。

### 已凍型別（`packages/shared/src/train.ts`，已寫入）
- `TRAIN_MODES_KEYS`／`TrainMode`（"sales"|"partnership"|"government"|"interview"）；`TrainScoreDimensionDef{label,guide}`；`TrainModeDef{key,label,aiRole,youRole,blurb,framing,stance,coachRole,dimensions}`；**`TRAIN_MODES: Record<TrainMode,TrainModeDef>`（4 模式全文＝單一真相：web 顯示、server persona 框架、評分 rubric 都讀它）**。
- `TrainSession.mode: TrainMode`＋`NewTrainSession.mode?: TrainMode`（預設 sales）。
- **`TrainScores` 由固定四維 object 改為 `TrainScoreDimension[]`**（`{label,score}[]`）；`TrainReport.scores`/`NewTrainReport.scores` 隨之變陣列。
- migration `022_train_mode.sql`（sqlite＋pg，`training_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'sales'`）已建（值域由 app `TRAIN_MODES_KEYS` 驗證，不加 CHECK 以便擴充）。

### 待實作（照此，勿改已凍型別）
1. **`packages/crm/src/repos-training.ts`**：
   - `createSession` INSERT 加 `mode` 欄（`input.mode ?? 'sales'`）；`mapSession` 讀 `r.mode as TrainMode`（`TrainSession.mode` 必填）。
   - **`mapReport` 向後相容（關鍵）**：`scores_json` 舊列是 object `{objectionHandling,discovery,clarity,closing}`、新列是 `TrainScoreDimension[]`。parse 後：**是陣列→直接用；是 object（legacy）→用 `TRAIN_MODES.sales.dimensions` 的 label 依序轉成陣列**（[{label:"異議處理",score:objectionHandling},…]），避免舊報告壞掉。
2. **`apps/server/src/train/persona.ts` `buildPersonaPrompt`**：`BuildPersonaOptions` 加 `mode?: TrainMode`（預設 'sales'）。開頭句由寫死的 sales 句改為 `You are role-playing ${name}, ${title} at ${companyName}, ${TRAIN_MODES[mode].framing}. Stay fully in character…`；「本次對練情境」段的立場句由寫死「你是買方…」改為 `TRAIN_MODES[mode].stance`。**mode='sales' 時輸出與現況等價**（framing/stance 就是原文）——確保回歸。
3. **`apps/server/src/train/scoring.ts`**：`score(turns, ctx, client?, mode?: TrainMode)`。
   - SYSTEM 由 `TRAIN_MODES[mode].coachRole` ＋逐維 `dimensions[].label: guide` 動態組（取代寫死 4 維與「B2B sales coach」）。
   - RESPONSE_SCHEMA 的 scores 改成 **array of {label:STRING, score:INTEGER}**（要求模型對 `TRAIN_MODES[mode].dimensions` 每個 label 各給一分）。回傳前**以模式維度為準**組 `TrainScores`：對每個 `dimensions[i].label` 找模型該 label 的分數（clamp 0–100，缺→0），保證回傳陣列＝該模式維度、順序一致、不受模型亂序影響。
   - 逐字稿標籤 `rep`→"YOU"（受評者）、`ai`→`TRAIN_MODES[mode].aiRole` 或泛稱 "COUNTERPART"；SYSTEM 明示「score only YOU（受評的報告者/求職者/業務）」。
4. **`apps/server/src/train/train-service.ts`**：`startSession` 把 `input.mode ?? 'sales'` 傳給 `createSession`（落庫）與 `buildPersonaPrompt`（framing）；`finish` 讀 `session.mode` 傳給 `scorer.score(..., session.mode)`。
5. **`apps/server/src/train/routes.ts`**：`POST /sessions` 解析 `mode`（驗 `TRAIN_MODES_KEYS.includes`，非法→400 或忽略退 sales）。
6. **web**：
   - **模式選擇**：train 頁「開始對練」啟動列（`mc-train__launch`，選定 persona 且可對練時）加**情境模式選擇**（4 張卡/segmented，顯示 `TRAIN_MODES[k].label`＋`aiRole`/`youRole`/`blurb`）；選定值併入 `startTrainSession` 的 `mode`。與既有難度／objective 並列。（模式與 persona 來源〔真人/虛擬〕正交：先選對象，再選情境。）
   - **`ScoreReport.tsx`**：移除寫死 `SCORE_META`；改**遍歷 `report.scores`（`{label,score}[]`）** 畫維度格；綜合分數 avg＝陣列平均（`sum/length`，空陣列→0）。hint 可省略或不顯示。
   - **`api.ts`**：`startTrainSession` 加 `mode?: TrainMode`（型別 import shared）。
7. **記帳/安全**：mode 由 server 權威決定評分（用 `session.mode`，非信任 client）；persona/voice 仍鎖 token；不動 deck/approval/HUD（I1/I2/I3）。

### 測試
- buildPersonaPrompt 各 mode 開頭句/立場句正確＋**sales 與改前逐字等價**（回歸）。
- scoring 各 mode 回傳維度＝該模式 dimensions（label 對、缺分補 0、亂序不影響）。
- repos-training `mapReport` 舊 object scores → 相容轉陣列（sales labels）；新陣列直通。
- createSession 落 mode、finish 用 session.mode 評分。
- migration 022 開機自動套（ready:true）。

## 狀態

- 2026-07-23：計畫建立；Phase A、B 藍圖皆凍結（agent 藍圖）。
- 2026-07-23：**Phase A Cycle 1 實作完成**（A1 手動解鎖 training_unlocked＋migration 020／A2 新增主管補欄／A5a 產品·contact 子表 trustedFieldsOf 防覆寫），多視角對抗式驗證進行中；未 commit。R5（合成訓練對象）納入計畫 A6，待後續 cycle。
- 2026-07-24：train 頁小修（中文名對齊 CRM＋「補齊」深連結到該主管＋readiness 標籤）完成、tsc 三端綠。**Phase A2 凍結契約**（train 頁自助建對象 #1/#4）如上；型別＋migration 021＋mappers 已寫入 shared/crm，server／web 實作待派工。
