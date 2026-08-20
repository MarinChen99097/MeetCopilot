# M2/M3/M4 內部契約（三線並行的凍結接縫）

> 三個產品線平行實作的接縫凍結檔。HTTP/WS 形狀以 `API_CONTRACT.md` 為準（§4 Decks、§5 Meetings、§6 WS、§7 Train 已凍）；WS 訊息型別已在 `packages/shared/protocol.ts`。本檔定 agent 推不出、但跨線必須一致的介面與程式落點。改接縫→先改本檔＋記 ROM。

## 共通
- 沿用 M1 慣例：async DbPort、org_id 全帶、no FOREIGN KEY、tx=手動 BEGIN IMMEDIATE、repo row↔domain 映射、UUIDv7。
- 前端＝成品（決策 20）：各 surface 生產級 UI，設計規格＝`FRONTEND_DESIGN_PROMPTS.md` 對應 PROMPT＋`API_CONTRACT.md`；元件 presentational＋資料走 lib/api、lib/ws。
- 外部進程/長連線一律有界（L13）：任何會 hang 的外呼（Live socket、瀏覽器）都要 deadline＋強制關閉。
- LLM 結構化輸出：union-superset schema＋`required` 關鍵欄＋`maxOutputTokens` 上限（L15）；抽取/分析類任務用 `gemini-3.5-flash` 等級，別用 flash-lite 做複雜結構化。

---

## M2 — DynamicSlide

### migration 007_decks.sql（新）
`decks`：`id, org_id, title, language CHECK('zh-TW','en'), source CHECK('ai','pptx','pdf'), committed_index INTEGER DEFAULT -1, company_id(nullable), theme_json, created_at, updated_at`。
`deck_slides`：`id, org_id, deck_id, idx INTEGER, spec_json(SlideSpec), created_at`（idx 為序；append 即 max(idx)+1）。index `(org_id, deck_id, idx)`。
`image_jobs`：`id, org_id, deck_id, slide_idx, kind CHECK('background','full'), status CHECK('queued','running','done','failed','refused'), prompt, data_uri, error, created_at, finished_at`。

### 介面（apps/server/src/generation/ 與 decks/）
```ts
interface GenerationService {
  generateDeck(orgId, input: GenerateDeckInput): Promise<Deck>;   // 借 v1 生成器+QA+DESIGN_PRINCIPLES；分析/生成用 3.5-flash 等級
  regenerateSlide(orgId, deckId, idx, hint?): Promise<SlideSpec>; // 自動 QA 重生（借 v1 slideQaIssues/reviseSlides）
}
interface ImageService {   // 用 M0 已建的 ImageProvider(OpenAI gpt-image-2)
  enqueue(orgId, deckId, slideIdx, kind, prompt?): Promise<{jobId}>;  // pre-meeting；job 化；被擋→status='refused'+前端套漸層 fallback
}
interface DeckRepository { list/create/findById(含 slides)/updateSlide/appendSlide/setCommittedIndex/delete; }
interface PptxExporter { export(deck, slides): Promise<Buffer>; }   // 借 v1 export/pptx.ts（設計版面+原生圖表+RFC5987 檔名）
```
- **改造引擎 append-only（I1）**：`appendSlide` 只加到尾端；`updateSlide` 僅允許 `idx > committedIndex`（live 中），否則 409。會前編輯（deck 未進 live）不受限。
- 借 v1：slide 生成器、BLOCK_SCHEMA/sanitize、自動 QA、DESIGN_PRINCIPLES、pptx 匯出、wizard、slide-chart/icons、globals.css 的簡報樣式。**在 v2 重寫對齊 SlideSpec（append-only PatchOp）**。
- 前端 `/studio`（PROMPT 2）：deck 清單、三段 wizard（含 /extract-url、/extract-pdf 匯入）、slide 編輯器、生圖 job 進度（~10–80s＋refused fallback）、pptx 匯出。`/present`（PROMPT 3）：**零 HUD** 播放，`page_commit` 上報、`deck_update` 靜默 append。
- **decks 路由**（API_CONTRACT §4）：/api/decks CRUD、/generate、/import、/:id/slides/:idx PATCH、/:id/image-jobs、/image-jobs/:id、/:id/export.pptx、/extract-url、/extract-pdf（extract.ts 已存在，M2 掛路由）。

---

## M3 — 會中副駕（realtime）

### 即時 session（用 005 的 meetings/meeting_transcript_segments/meeting_signals；新增 runtime，不必新表；consent/TTL 存 meetings 欄或新 007b）
- **live session runtime**（記憶體 + 落 DB）：每個 meeting 一個 `SessionRuntime`（committedIndex、consent、connected roles、rolling transcript window、signal running-state、research 配額計數）。程序內 Map<meetingId, SessionRuntime>；**要有逐 session 清理**（v1 gap：session 單調累積）——end 或斷線逾時回收。

### 介面（apps/server/src/realtime/ 與 asr/ analysis/）
```ts
interface AsrFrameContext {          // 2026-08-19 雙聲道追加（hub 隨每個 frame 下傳）
  tMs: number;                                                   // 這個 frame 起點在**本場共用音訊時鐘**上的位置
  channels: 1 | 2;                                               // 這個 frame 的擷取模式（stereo 已在 hub 拆成兩條純 mono）
}
interface AsrProvider { // 借 v1；Gemini 分段轉寫；藏介面後（S2 未來可換 Google STT v2）
  pushAudio(sessionId, pcm: Buffer, ctx: AsrFrameContext): void;  // 16k mono PCM binary frame 累積（ctx 必填）
  onFinal(cb: (seg:{t;text;channels?:1|2}) => void): void;       // final segment → 分析
  flushPending?(): void;                                         // 選配：強制把緩衝殘料切段送轉寫
}
interface AnalysisEngine { // 借 v1；rolling window 增量分析 → 結構化訊號
  ingest(sessionId, seg): void;
  onSignals(cb: (items:SignalItem[]) => void): void;            // 達門檻才發（含 unhandledRejection guard）
}
interface CopilotOrchestrator { // 訊號 → CRM 檢索(§CRM_SCHEMA §9 白名單) → info_card；research 觸發(自動+手動)
  // speaker 推斷：轉逐字後 LLM 依內容/語氣推 presenter/client（決策：不做雙軌 diarization）
}
interface PatchService { // 改造引擎+approval FSM（借 v1 patch-service）
  suggest(sessionId, slide, reason): Suggestion;                // 進 HUD 佇列
  act(sessionId, suggestionId, action, presenterAuth, editedSlide?): void;  // 只 presenter；ACCEPT/EDIT→append 到 deck 尾端(I1)；FSM
}
```
> **`AsrProvider` 的三個雙聲道擴充**（2026-08-19 雙聲道／共用音訊時鐘落地時加入；接縫仍凍結。**既有實作不改也仍符合本介面**——`realtime-authz.test.ts` 的 `fakeAsr()` 至今仍只有 `{pushAudio, onFinal}`（且 `pushAudio` 連參數都不收）且照樣通過，就是相容性的活證明）：
> - **`pushAudio` 的第三參數 `ctx: AsrFrameContext`（必填）**——**音訊時鐘的所有權因此上移到 session 層**（`LiveSessionRuntime.advanceAudioClock`）。非這樣不可的理由：右聲道那條軌是**會議中途才 lazily 建立**的（mono 場次永遠不建），若讓每個 provider 各自從 0 起算取樣數，兩軌的 `AsrSegment.t` 會相差整個 mono 時段——分析的 90 秒滾動窗會把客戶那一路整批濾光，HUD 時間軸與 DB 的 `t` 也全錯位。**2026-08-19 /simplify 由選配改必填**：留一條「不給 ctx 就自己數樣本」的後路等於在型別上宣告時鐘有第二個擁有者（`Chunker.consumedSamples` 那份 fallback 在產線與整個測試套件都不可達，卻仍每 frame 累加），三個呼叫點（mono 一處、stereo 兩處）本來就無條件帶 ctx。實作端要忽略它仍然完全自由（參數少寫的函式依舊相容）。
> - **`AsrSegment.channels?`（選配）**——這一段音訊**被擷取當下**的聲道模式快照（切段起點取），不是 final 抵達當下的模式。speaker 判定必須看它：轉寫是非同步的（deadline 20 秒）而 chunker 最多累積 4 秒，模式在段落飛行途中可能已經換過，讀「目前模式」會把客戶講的話貼成 `presenter` 並落庫。**維持選配**：測試與精簡替身會直接注入 `{t, text}` 兩欄位的 segment，缺席＝下游 fallback 到 `runtime.audioChannels`（＝「用目前模式」，mono 場次因此仍走 LLM 推斷，與現行同路）。
> - **`flushPending?()`（選配）**——hub 在**聲道模式切換點**呼叫，強制把兩軌 chunker 裡屬於舊模式的殘料切出去，保證沒有任何一段音訊橫跨 mono／stereo 兩種語意（mono→stereo 時左軌壓著含客戶聲音的混音；stereo→mono 時右軌壓著客戶語音且之後不會再有資料推進來）。未實作＝維持「只有 4 秒硬切／靜音切」的原行為。

- **WS server**（API_CONTRACT §6，型別用 protocol.ts）：三角色 capture/hud/present；音訊 binary frame；`suggestion_action`/`page_commit` 只接受 presenter 連線（server 驗 wsToken 身分，**攻擊者憑證測**）；`consent` 未同意不啟動分析；`session_state` 連線/重連同步；research `remainingQuota`。**握手閘**（`realtime/ws-handshake-gate.ts`，一次 `db.get`）：帳號停權 **＋ meeting 是否仍在進行**（org-scoped）；已 `completed`／本 org 查不到 → 送 `error{code:'meeting_ended'}` 後 close **1000**（前端 `describeWsClose` 的 `kind:'ended'`）。這一關是殭屍會議的根因防線——前端的終態判定只擋得住重連，`/hud`、`/present` 的憑證就在網址列，會議結束後按 F5 就是全新連線。
- **I2**：只有 ACCEPT/EDIT 走 append；I3：HUD 內容只發給 hud 角色，`/present` 永不收 info_card/suggestion/transcript。
- 前端 `/copilot`（PROMPT 4，擷取端）：getDisplayMedia 擷取 Meet 分頁→AudioWorklet 16k PCM→WS binary；zero-track 守衛、consent 閘、track ended 重連。`/hud`（PROMPT 5，第二裝置手機直式）：逐字稿流/資訊卡（trust 徽章）/批准佇列(A/S+倒數)/深查+配額/斷線重連。
- **建立 session**：POST /api/meetings → {meeting, wsUrl, wsToken}（wsToken 短效、含 role 綁定）。

---

## M4 — 語音模擬訓練（S3 spike 先驗）

### migration 008_training.sql（新）
`training_sessions`：`id, org_id, contact_id, deal_id(nullable), difficulty CHECK('friendly','neutral','hostile'), started_at, ended_at, transcript_json, created_at`。
`training_reports`：`id, org_id, session_id, scores_json({objectionHandling,discovery,clarity,closing:0-100}), highlights_json, summary, created_at`。

### 介面（apps/server/src/train/）
```ts
interface TrainService {
  personas(orgId, companyId?): Promise<PersonaOption[]>;         // 只列 persona 欄位過 verified 閘的 contacts（逐欄過 provenance，見 CRM_SCHEMA §9）
  startSession(orgId, {contactId, dealId?, difficulty}): Promise<{sessionId, ephemeral, persona}>;  // 發 Live ephemeral token
  saveTranscript(orgId, sessionId, turns): Promise<void>;
  finish(orgId, sessionId): Promise<{reportId}>;                 // 觸發評分（LLM 依雙向逐字稿）
  report(orgId, reportId): Promise<TrainReport>;
}
```
- **Gemini Live 直連**（API_FINDINGS §A）：server 只發 ephemeral token（`ai.authTokens.create`），**語音不經我方 server**；瀏覽器直連 `gemini-3.1-flash-live-preview`。persona system prompt 由 CRM verified persona 欄位＋company card 組（信任規則：只用 human/verified/會議衍生，不用爬蟲猜測）。長對練開 contextWindowCompression＋sessionResumption（>15 分鐘不斷）。
- **S3 spike（M4 build 前先驗）**：ephemeral token 瀏覽器直連、persona system prompt、打斷（interrupted）、雙向逐字稿、>15 分鐘續連。**連線/token/轉寫 agent 可自驗；語音體驗需使用者實際開口**——agent 驗到「能建立 session＋收到模型音訊/逐字稿」即算 spike 過機械面，體驗面標「待使用者驗」。失敗→退 ASR+文字LLM+TTS 拼裝（介面留好）。
- 前端 `/train`（PROMPT 6）：persona 選擇器（readiness 缺欄提示）、語音對練狀態機（連線/AI 說/你說/被打斷）、雙向字幕、計時+續連、課後四維評分報告。AudioWorklet 送 16k、播 24k PCM。

## 驗收（各線 fresh-context，M234 §）
- M2：生成 deck 0 空白頁＋合法 pptx 下載；生圖 job（背景圖產出／refused→fallback）；I1（非 append/idx≤committed reject）；I3（/present 無 HUD 元素斷言）；/studio build 綠。
- M3：假音訊/逐字稿注入→訊號→HUD info_card（CRM 檢索白名單）；presenter-only（攻擊者憑證送 accept/page_commit 被拒）；append-only（I1）；/copilot zero-track 守衛；/hud 斷線重連；I3 隔離。
- M4：S3 機械面過（ephemeral 直連＋模型音訊/逐字稿）；personas 只列 verified；評分報告四維；session 有清理；/train build 綠。
- 全線 typecheck 綠；不並行 npm install（Verify 統一裝）；crawler/Live 等外呼有界。
