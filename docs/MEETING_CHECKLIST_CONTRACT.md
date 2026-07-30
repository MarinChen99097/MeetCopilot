# 會中待講清單（Meeting Checklist）— 凍結契約 v1.0

> 凍結者：Fable（2026-07-28）。決策來源：ROM 2026-07-28 16:54（使用者四項岔路全拍板）。
> **本檔為單一真相**。實作 agent **只實作、不得改契約**；發現契約有誤 → 停下來回報指揮官，不要自行改。
> 分期：**C1＝核心閉環**（本輪做完）、**C2＝匯入 deck 餵料**（本輪只把 schema 欄位預留好）。

---

## 0. 一句話

會前依「會議目標 ＋ 簡報全文 ＋ CRM 情報」生成一份**達成本場目標所需的溝通清單**（必講／必問／必回應），
會中隨對話與簡報進度**自動劃掉**，報告者可隨時手動改，HUD 上永遠看得到「還剩什麼沒講」。

## 1. 不變量（實作時逐條自檢）

| # | 要求 | 落地 |
|---|---|---|
| **I1** | 不觸及 deck patch 路徑 | checklist 不產生任何 `PatchOp`；`deck_slides.text_extract` 只在**匯入期**寫入、只碰新欄不碰 `spec_json`，**嚴禁在會中路徑呼叫** |
| **I2** | 手動勾選＝報告者專屬 | `checklist_action` 走 `ws-server.ts` 既有 `isPresenter`（`claims.userId === claims.presenterUserId`）身分閘，比照 `suggestion_action`（`ws-server.ts:192-200`）；非 presenter 回 `error{code:"forbidden_not_presenter"}` |
| **I3** | 清單絕不外流 | `checklist` server→client 訊息**一律 `broadcast(meetingId, msg, "hud")`**，禁止 `"all"`／`"present"`；`apps/web/components/present/PresentStage.tsx` **禁止 import 任何 checklist 模組**（該檔 :6-10 有 import 白名單硬規則） |

## 2. 資料層（migration 023，SQLite ＋ PG 雙份，缺一不可）

檔名：`packages/crm/migrations/023_meeting_checklist.sql` ＋ `packages/crm/migrations-pg/023_meeting_checklist.sql`

### 2.1 `meetings` 加兩欄（修既有債：deck 綁定原本只在記憶體）

```
deck_id    TEXT           -- nullable；本場綁哪份 deck
objective  TEXT           -- nullable；本場會議目標（自由文字，一句話）
```
- **不得改用既有 `agenda` 欄**（語意＝議程，且從未被寫入，混用製造歧義）。
- SQLite 一欄一條 `ALTER TABLE ... ADD COLUMN`；PG 用 `ADD COLUMN IF NOT EXISTS`（照 `migrations-pg/018_deck_import.sql` 慣例）。

### 2.2 `deck_slides` 加一欄（C2 預留，C1 不寫入）

```
text_extract TEXT         -- nullable；匯入 deck 的逐頁純文字（native deck 恆 NULL，用 extractSlideText 即可）
```

### 2.3 新表 `meeting_checklist_items`

```
id            TEXT PRIMARY KEY
org_id        TEXT NOT NULL
meeting_id    TEXT NOT NULL
idx           INTEGER NOT NULL              -- 顯示順序，0 起
category      TEXT NOT NULL                 -- CHECK IN ('talk','ask','address')
title         TEXT NOT NULL                 -- HUD 顯示用，繁中 ≤24 全形字
detail        TEXT                          -- 展開才看：為什麼要講／講到什麼程度
slide_idx     INTEGER                       -- nullable；綁哪一頁（只有 talk 類可能有值）
keywords_json TEXT NOT NULL DEFAULT '[]'    -- string[]，勾稽關鍵詞
priority      TEXT NOT NULL DEFAULT 'must'  -- CHECK IN ('must','nice')
status        TEXT NOT NULL DEFAULT 'pending' -- CHECK IN ('pending','covered','skipped')
covered_by    TEXT                          -- nullable；CHECK IN ('transcript','slide','manual')
covered_at    BIGINT                        -- nullable；epoch-ms
evidence      TEXT                          -- nullable；逐字稿片段（≤120 字）或「第 N 頁」
created_at    BIGINT NOT NULL
updated_at    BIGINT NOT NULL
```
- 索引：`(org_id, meeting_id, idx)`。
- PG 方言照 018 慣例：無 SQL FK、enum＝TEXT+CHECK、時間 epoch-ms 用 `BIGINT`。
- **加 CHECK 值時的既有陷阱**：本表是新表，直接在 CREATE 帶 CHECK 即可（不像 `meeting_signals` 要整表重建）。

## 3. Repository（`packages/crm`）

新檔 `packages/crm/src/repos-checklist.ts`，`class SqliteChecklistRepository implements ChecklistRepository`（port-agnostic，兩驅動共用，比照 `repos-import-jobs.ts:18-56`）。

`packages/crm/src/ports.ts` 新增介面並掛進 `CrmCore`（`core.ts` 的 `assemble()` 註冊）：

```ts
export interface ChecklistRepository {
  replaceAll(orgId: string, meetingId: string, items: NewChecklistItem[]): Promise<ChecklistItem[]>;
  list(orgId: string, meetingId: string): Promise<ChecklistItem[]>;
  markCovered(orgId: string, meetingId: string, itemIds: string[],
              by: ChecklistCoverSource, evidence?: string): Promise<ChecklistItem[]>; // 回傳「這次真的被改動」的項目
  setStatus(orgId: string, meetingId: string, itemId: string,
            status: ChecklistStatus, by?: ChecklistCoverSource): Promise<ChecklistItem | null>;
}
```
- `markCovered` **只改 `status='pending'` 的列**（已 covered/skipped 不覆寫、不更新 `covered_by`）→ 天然冪等，回傳陣列為空即代表「沒有新變化，不必廣播」。
- 所有方法**第一個參數恆為 orgId 且必須進 WHERE**（org 隔離；跨 org 一律回空/null，不 throw）。

## 4. Shared 型別（`packages/shared/src/checklist.ts`，新檔）

```ts
export const CHECKLIST_CATEGORIES = ["talk", "ask", "address"] as const;
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

export const CHECKLIST_STATUSES = ["pending", "covered", "skipped"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_COVER_SOURCES = ["transcript", "slide", "manual"] as const;
export type ChecklistCoverSource = (typeof CHECKLIST_COVER_SOURCES)[number];

export interface ChecklistItem {
  id: string;
  idx: number;
  category: ChecklistCategory;
  title: string;
  detail?: string;
  slideIdx?: number;
  keywords: string[];
  priority: "must" | "nice";
  status: ChecklistStatus;
  coveredBy?: ChecklistCoverSource;
  coveredAt?: number;
  evidence?: string;
}
export type NewChecklistItem = Omit<ChecklistItem, "id" | "status" | "coveredBy" | "coveredAt" | "evidence">;

export const CHECKLIST_MAX_ITEMS = 14;      // 生成上限
export const CHECKLIST_MIN_ITEMS = 6;
export const CHECKLIST_PROMPT_MAX_PENDING = 15; // 送進分析 prompt 的 pending 上限
export const SLIDE_DWELL_COVER_MS = 20_000;  // 翻頁自動判 covered 的最小停留
```
從 `packages/shared/src/index.ts` re-export。

## 5. Wire 協定（`packages/shared/src/protocol.ts`）— **改完必須同步 `docs/API_CONTRACT.md` §6**

### Server → Client（新增 1 型，hud-only）
```ts
| { type: "checklist"; status: "generating" | "ready" | "failed";
    items: ChecklistItem[]; currentSlideIdx?: number }
```
- **全量 snapshot、replace 語意**（HUD 端整份換掉）。理由：斷線重連自我修復，不需增量對帳。
- `status:"generating"` 時 `items` 為空陣列（HUD 顯示「清單生成中…」）。
- `currentSlideIdx` ＝ server 已知的簡報高水位（`runtime.committedIndex`），供 HUD 高亮「正在講」。

### Client → Server（新增 1 型，presenter-only）
```ts
| { type: "checklist_action"; itemId: string; action: "check" | "uncheck" | "skip" }
```
- `check`→`covered`（`covered_by='manual'`）｜`uncheck`→`pending`（清空 covered_by/at/evidence）｜`skip`→`skipped`。
- 處理後**重播全量 `checklist` snapshot 給 hud**。

## 6. 生成端

### 6.1 目標草擬 `POST /api/meetings/draft-objective`（新端點，`meetings-routes.ts`）
- body：`{ deckId?: string; companyId?: string; title?: string }`
- 回：`{ objective: string }`（繁中一句話，≤40 全形字）
- 需 auth＋org scope；**必須套既有 rate limit**（比照 `apps/server/src/ops/token-bucket.ts` 現有 LLM 端點用法）。
- 資料不足（無 deck 也無 company）→ 回 `{ objective: "" }`，**不 throw**。

### 6.2 清單生成 `apps/server/src/generation/checklist-gen.ts`（新檔）
```ts
export async function generateChecklist(deps, input: {
  objective: string;
  deckOutline: { idx: number; template: string; text: string }[];
  company?: { name: string; industry?: string; narrative?: string };
  contacts?: { name: string; title?: string; background?: string }[];
  knownObjections?: string[];
  competitors?: string[];
  sellerProducts?: { name: string; oneLiner?: string }[];
}): Promise<NewChecklistItem[]>
```
- 模型＝`config.gemini.extractModel`；**必用 `responseSchema` 強制結構**（比照 `slide-gen.ts` 既有寫法）；deadline 45s；attempts 2；MAX_TOKENS 時砍半重試（沿用 `extract-shared.ts` 既有 helper）。
- 輸出 `CHECKLIST_MIN_ITEMS`–`CHECKLIST_MAX_ITEMS` 條，**三類都要有**（`talk` 為主體，`ask`／`address` 各至少 1 條，除非資料完全不足）。
- `slideIdx` 只在該項確實對應某頁時給；`ask`／`address` 恆為 undefined。
- `keywords` 每項 2–5 個繁中/原文詞（用於對話勾稽；專有名詞保留原文，沿用既有雙語規則）。
- **失敗＝優雅降級**：throw 由呼叫端捕捉，改 broadcast `status:"failed"`，**絕不讓建會失敗**。

### 6.3 觸發時機
- `POST /api/meetings` 建會成功後**背景 fire-and-forget** 生成（不阻塞回應）：先 broadcast `status:"generating"` → 完成 `replaceAll` 後 broadcast `status:"ready"`。
- 缺 `deckId` **且**缺 `companyId` → 不生成，不廣播（本場無 checklist）。
- **每場只生成一次**（重連不重生）。

### 6.4 deck 全文組裝（共用函式）
- 把 `slide-gen.ts:346-348` 的 outline pattern **抽成 export 共用函式**（例如 `buildDeckOutline(slides)`），`reviseSlides` 改呼叫它，**輸出逐字不變**（回歸鎖定）。
- 逐頁文字取用順序：`extractSlideText(spec)` → 空則用 `slide.textExtract`（C2 才有值）→ 仍空則跳過該頁。
- 整份 outline 硬上限 12,000 字（超出則逐頁等比截斷，保留頁序與頁碼）。

## 7. 勾稽端（三路）

### 7.1 對話（併進既有分析呼叫，**零額外 LLM 呼叫**）
- `apps/server/src/analysis/analysis-engine.ts` 介面擴充：新增 `setPendingChecklist(items: {id: string; title: string; keywords: string[]}[]): void`。
- `AnalysisResult` 新增 `coveredItemIds?: string[]`。
- `gemini-analysis.ts`：
  - `SIGNALS_SCHEMA` 加 `coveredItemIds: { type: "array", items: { type: "string" } }`。
  - system prompt 加一節：當 pending 非空時列出 `#<id> <title>（關鍵詞：…）`，指示「**只在最近對話明確涵蓋該項時**才回報其 id；模稜兩可一律不報」（寧漏勿誤，因為誤劃比漏劃傷害大）。
  - pending 為空 → **prompt 完全不加這一節**（省 token）。
  - 上限 `CHECKLIST_PROMPT_MAX_PENDING` 條，超出取 `priority='must'` 優先、再依 idx。
  - sanitize：回傳 id 必須在 pending 集合內，否則丟棄（防幻覺 id）。
- 窗口/節流/單飛鎖**全部沿用現況**（10 段/90 秒/5 秒節流），不得放寬。

### 7.2 簡報進度（弱訊號，零 LLM）
- `session-runtime.ts` 加 `lastCommitAt?: number`（epoch-ms）。
- `ws-server.ts` 處理 `page_commit` 時（既有 I2 gate 內）：若 `lastCommitAt` 存在且 `now - lastCommitAt >= SLIDE_DWELL_COVER_MS`，則把 `slide_idx === 前一個 committedIndex` 且仍 `pending` 的項目 `markCovered(..., 'slide', "第 N 頁")`。
- **停留 <20 秒不動作**（快速翻過不算講到）。
- `currentSlideIdx` 隨每次 snapshot 帶給 HUD 做「正在講」高亮（純顯示，不改狀態）。

### 7.3 手動（報告者最終權威）
- 見 §5 `checklist_action`。手動設定的 `covered_by='manual'` **不會被自動路徑覆寫**（因 `markCovered` 只動 pending）。

### 7.4 廣播節流
- 任何路徑造成狀態改變 → 重播全量 snapshot 到 hud。
- **無改變不廣播**（`markCovered` 回空陣列即 return）。
- 同一秒內多次改變合併為一次廣播（簡單 debounce 300ms 即可）。

### 7.5 手動 uncheck 的冷卻期（v1.1 增訂，2026-07-28）

> **增訂緣由**（記帳復驗 agent 發現，信心 72）：原 §7.3 只保證「手動 **covered** 不被自動路徑覆寫」，
> 但**手動 uncheck 完全沒有保護**。實際時序：對話勾稽誤判某項已講 → 報告者點 uncheck → `setStatus('pending')`
> 清空 cover 三欄 → 但**害它被誤判的那段逐字稿還留在分析滾動窗裡**（10 段／90 秒），而節流只有 5 秒
> → 下一輪分析模型看到同樣的窗＋該項又回到 pending → 極可能再回報同一個 id → `markCovered` 因為它是 pending
> 而**完全擋不住** → 又被劃掉。**報告者最多撐 5 秒，只能改用 `skip` 才能讓修正生效——但 `skip` 語意是
> 「決定不講」，不是「還沒講」。** 等於 uncheck 這個動作在會中實質無效。

**要求**：
- session runtime 維護 `recentlyUnchecked: Map<itemId, number>`（itemId → uncheck 的 epoch-ms）。
- `checklist_action` 的 `uncheck` 除了 `setStatus('pending')` 外，**一併記入該 Map**。
- **對話勾稽路徑（`covered_by='transcript'`）在 cover 前必須跳過**冷卻期內的 itemId。
- 冷卻長度 = 分析滾動窗的最大年齡（`WINDOW_MAX_AGE_MS`，目前 90 秒）。**理由**：那正是「害它被誤判的逐字稿」
  最久能留在窗裡的時間；窗一輪替過去，模型若**仍**回報該項，那就是來自**新的**對話內容＝真的講到了，此時應該放行。
  常數要從分析引擎那側取得單一真相，**不要在兩處各寫一個 90000**。
- **⚠️ 冷卻必須用「音訊時鐘」計時，不是牆鐘（v1.2 更正，2026-07-30）**：上一版此處只寫「90 秒」而未指定時鐘域，
  實作（正確地）照字面用了 `Date.now()`——但**分析滾動窗的年齡是用音訊取樣時鐘算的**
  （`chunker.ts` 的 `consumedSamples / (SAMPLE_RATE/1000)`，**只在 PCM frame 進來時前進**）。兩個時鐘只在音訊持續流動時等價。
  **失敗情境（已實測）**：報告者 uncheck 一個誤判項 → 按「撤回同意」做 2 分鐘內部討論（`pushAudio` 在 `!consent` 時 return，
  音訊時鐘完全凍結，且 consent handler 不清 engine 的 window）→ **牆鐘 90 秒已到期，但那段逐字稿在音訊時鐘上只老了幾秒、仍在窗裡**
  → 恢復後第一輪分析（節流 5 秒）就把同一項再劃掉＝本節要消滅的打地鼠原樣復活。停止分享導致 capture socket 斷線
  （HUD 仍在故 runtime 不被回收）亦同。
  **正確做法**：uncheck 當下記下**當時的音訊時鐘高水位**，放行條件改為 `latestAudioT - uncheckAudioT >= WINDOW_MAX_AGE_MS`。
  分析引擎需暴露一個唯讀的「目前窗內最新 t」存取器當單一真相。**上一版把理由寫對、卻沒把時鐘域寫明，是契約的缺陷（非實作的）。**
  **fail-safe（時鐘不可讀時一律落安全側＝「仍在冷卻」，絕不 throw）**：uncheck 當下取不到高水位（窗空／engine 未注入）→
  **掛帳**，以音訊恢復流動後的**第一個高水位**為冷卻基準；時鐘後退亦視為仍在冷卻。寧可多擋自動勾稽，
  也不讓報告者的 uncheck 被推翻（與 §7.1 同向）。
  **對照註**：§7.2 翻頁停留的 `lastCommitAt` **刻意仍用牆鐘**——停留時間是報告者的真實體感時間，與音訊窗無關；
  兩者時鐘域不同是設計，日後勿誤統一。
- **翻頁勾稽（`'slide'`）與手動 `check` 不受冷卻限制**——前者是報告者自己的導覽行為、後者是報告者的直接指令，
  都不是「AI 誤判」的來源。
- **項目仍留在分析 prompt 的 pending 清單裡**（它確實還沒講完，§7.1 的 prompt 形狀不變）；
  只是**抑制自動 cover**。刻意不從 prompt 移除，以免冷卻期內真的講到了卻永久漏掉。
- 冷卻記錄在 `disposeSession` 一併清除（與其他 per-session 狀態同生命週期）。
- 測試要涵蓋：uncheck 後冷卻期內的 transcript 自動 cover **被跳過**；冷卻期過後**放行**；
  同期間的 `'slide'` 與手動 `check` **不受影響**。

## 8. HUD 前端

新元件 `apps/web/components/hud/ChecklistPanel.tsx`：
- **收合態（預設）**：單行高度 — 進度條 `已講 4/12` ＋ 下一個待辦（最高 priority 的 pending `title`，截斷）＋ 展開鈕。
- **展開態**：依 `category` 分三組（必講／必問／必回應），每項一列＝checkbox ＋ title（covered 者刪除線＋淡化）＋ 點擊 toggle；`slideIdx === currentSlideIdx` 者加「正在講」標記。
- 版面位置：`HudView.tsx` 的 **`SuggestionQueue` 之上**（`HudView.tsx:217-220` 的順序改為 Checklist → SuggestionQueue → TranscriptStream → InfoCardStream → DeepResearchBox）。
  - **硬約束**：收合態必須夠矮（≤48px），**不得把 I2 批准佇列擠出首屏**。
- state：`HudView.tsx` 加 `checklist` 與 `checklistStatus`，`onMessage` 新增 `case "checklist"` **replace 語意**（不是 append）。
- 樣式沿用 `.mc-hud__panel` 既有形狀（比照 `InfoCardStream.tsx:26`）；深色 token 一律用既有 CSS 變數。
- i18n：所有文案進 `messages/zh-TW.json` ＋ `en.json`，**parity 必須相等**。

## 9. 建會表單（`apps/web/components/copilot/CopilotView.tsx:393-445`）

現況只有「會議標題」一格。改為：
1. 會議標題（既有）
2. **選簡報**（下拉，可留空；資料來源＝既有 deck 列表 API）
3. **選對方公司**（下拉，可留空；既有 CRM company 列表 API）
4. **會議目標**（單行文字，可留空）— 當 2 或 3 有值時自動打 `draft-objective` 填入，使用者可覆寫

- **守低門檻原則**（[[keep-operations-simple-low-barrier]]）：2/3/4 一律**可留空**，全空時行為與今天完全一致（不生成 checklist、不報錯）。第 4 欄放在 `<details>` 或次要位置，**主動線仍是「填標題→開始」一步**。
- `createMeeting` 送出時帶 `{ title, deckId?, companyId?, objective? }`；`meeting-store.ts` 的 INSERT 補上 `deck_id`／`objective`。

## 10. 測試（最低要求，`apps/server/src/realtime/` 或 `analysis/`）

新增 `checklist.test.ts`，至少涵蓋：
1. `markCovered` **只動 pending**：已 `manual` covered 的項目不被自動路徑覆寫。
2. `markCovered` 無變化時回空陣列（→ 不廣播）。
3. 跨 org：A org 憑證對 B org 的 meeting 做 `list`／`setStatus` → 回空／null，**零副作用**。
4. `checklist_action` **非 presenter 被拒**（經真 ws-server，比照 `ws-presenter-authz.test.ts` 寫法）。
5. 分析 sanitize：回傳不在 pending 集合的 id 被丟棄。
6. 翻頁勾稽：停留 <20 秒不 cover、≥20 秒才 cover。
7. `buildDeckOutline` 抽出後 `reviseSlides` 的 outline 輸出**逐字等價**（回歸鎖定）。

## 11. C2：匯入 deck 餵料（v1.3 凍結，2026-07-30；C1 時僅預留 schema）

> 目標：匯入的 pptx/pdf 也能供 checklist 取材。逐頁純文字寫 `deck_slides.text_extract`；
> 抽不到字的頁用 Gemini 讀該頁 PNG 補。**任何失敗都不得影響匯入本身**（圖好了就是 ready）。

### 11.1 抽字管線（掛在 `conversion-job.ts`，於 `setImportStatus('ready')` **之後**）

- 順序：轉圖→落 slides→**deck 先 ready**（前端輪詢即解鎖，UX 不變）→ 抽字階段 → job `done`。
- 抽字階段整段自帶 try/catch，**逐頁隔離**；任何例外只 log，**絕不**把 `import_status` 改 failed、絕不影響 job 主流程。
- 文字純抽取路徑：**新增只回 `string[]` 的輕量函式**（`parsePptxText`／`parsePdfText`），**不得**走既有
  `parsePptx/parsePdf` 的 SlideSpec 路徑（那條會把圖片 base64 內嵌進 spec＝純浪費記憶體）。經 `runInWorker` 跑（沿用逾時/terminate）。
  **buffer detach 警告**：`runInWorker` 對 buffer 做 zero-copy transfer，transfer 後主執行緒該 buffer 會 detach——
  抽字必須在點陣化完成之後執行，且傳入 worker 的 buffer 用複本（`Buffer.from(bytes)`）。
- 每頁寫入前：trim、**上限 8000 字/頁**（超出截斷）。
- **三態語意（v1.4 更正，2026-07-30——原「空字串一律不寫」是契約漏洞）**：
  `NULL`＝**尚未抽過**；`''`（空字串）＝**抽過、確認無字**（負結果標記）；非空＝逐頁文字。
  規則：parser 抽出空 → **留 NULL**（交給讀圖 fallback 判定）；**讀圖回空 → 寫入 `''`**。
  否則讀圖確認無字的頁永遠是 NULL → `needsText` 永遠判「還沒抽」→ 每次觸發回填都重付讀圖成本
  （對抗驗證實測：5 頁純圖 deck 每輪重燒 5 次呼叫、永不收斂），且 `slice(0, maxPages)` 每輪取同樣前 20 頁
  → 第 21 頁以後**永久飢餓**。負結果標記讓已確認頁跳過、下一輪自然輪到後面的頁，兩個問題一併解。
  下游相容：`buildDeckOutline` 對空文字頁本來就跳過（`''` 與 NULL 同樣被略），checklist 行為不變。

### 11.2 頁序對齊（最高風險，兩個守門缺一不可）

- **pptx 的頁序權威＝`presentation.xml` 的 `sldIdLst`**（經 `_rels` 把 rId 映到 `slideN.xml`）。
  既有 `parsePptx` 用檔名數字排序是**錯的權威**——使用者在 PowerPoint **重排過**投影片時，檔名序≠播放序、
  且頁數相等**無從偵測**，文字會靜默錯位到別頁 → 翻頁勾稽劃錯項目（誤劃）。`parsePptxText` 必須解 `sldIdLst`；
  解不出 → 視為**對齊無效**。
- **pdf 逐頁收集必須以頁索引為鍵**（不得順序 push——`pdf-parse` 的 pagerender 對單頁失敗會靜默吞頁造成整體位移）；
  無法可靠取得頁索引 → 只能靠數量守門。
- **數量守門**：解析頁數 ≠ PNG 頁數（隱藏頁、吞頁）→ **對齊無效**。
- **對齊無效時**：整份逐頁文字**全部丟棄**（一頁都不寫），該 deck 的頁走 §11.3 讀圖路徑（PNG 上的字 Gemini 讀得到，
  結果天然對齊）。**寧可付讀圖成本，不可寫入可能錯位的文字。**

### 11.3 Gemini 讀圖 fallback（成本硬上限）

- 觸發：該頁對齊後的文字 **< `TEXT_EXTRACT_MIN_CHARS`（預設 20）**，或整份對齊無效。
- 用既有 `GenerateJsonOptions.images`（`gemini.ts:20-21`，裸 base64）＋`config.gemini.extractModel`＋responseSchema `{text:string}`；
  prompt＝「逐字轉錄頁面可見文字、依閱讀順序、**保留原文語言不翻譯不摘要**、無文字回空字串」。
- **硬上限（env 化）**：`TEXT_EXTRACT_VISION_MAX_PAGES`（預設 **20**，超出的頁跳過留 NULL 並 log 截斷筆數——掃描型
  100 頁 PDF 不得變 100 次呼叫；checklist outline 全份也才 12,000 字，20 頁綽綽有餘）；並行 `TEXT_EXTRACT_VISION_CONCURRENCY`
  （預設 **2**）；`attempts: 1`（失敗該頁留 NULL，不重試——這是 enhancement 不是關鍵路徑）。
- **計費（必記）**：`meteredGeminiClient`，kind＝**`gemini_extract`**（admin 標籤本來就寫「Gemini 擷取（匯入解析）」，
  至今無人用——名至實歸），orgId＝job 脈絡、**userId＝匯入者**（`import-handler` 現在只傳 orgId，要補傳 userId）、
  idemPrefix＝`textextract:${jobId}`（jobId 每次匯入唯一，頁間由 seq 區分）。

### 11.4 repo 方法

`setSlideTextExtract(orgId, deckId, idx, text)`：**獨立 UPDATE，只寫 `text_extract`、不碰 `spec_json`、不走 `updateSlide`**
（匯入原始頁 100% 命中 updateSlide 的 OriginalSlideLocked/I1 守門，此方法刻意繞開——因為它不是 deck 內容變更）。
orgId **必進 WHERE**。doc comment 明文：「**僅限匯入期與回填 job 呼叫，嚴禁 realtime／會中路徑**」。

### 11.5 既有 deck 回填（v1.3 新增；C1 之前匯入的 deck 全是 NULL）

- 端點：`POST /api/decks/:id/extract-text` → 需要跑＝`202 {started:true}`；不需要（native deck／已全有字／匯入未完成）＝`200 {needed:false}`。
- org-scoped＋**掛進 index.ts 共用 rate-limit 桶**（禁止 router 內自建第二個 limiter）。
- **`POST /api/decks/import` 也必須掛同一個桶（v1.4 更正——原稿只要求回填端點，是契約漏洞）**：C2 之後匯入
  本身就是 LLM 觸發端點（每發最多 `TEXT_EXTRACT_VISION_MAX_PAGES` 次讀圖），且 in-flight 去重以 deckId 為鍵、
  每次匯入都是新 deck＝去重永不命中；不掛桶＝合法帳號可連打匯入無限燒讀圖。
- **fill-empty 冪等**：只處理 `text_extract IS NULL` 且 spec 文字為空的頁；同 deck 併發去重（in-memory in-flight Set 即可，
  Cloud Run max-instances=1）。**無 job 列、前端不輪詢**——這是靜默 enhancement，沒有進度 UI。
- 回填的讀圖路徑需要「依 deckId+pageIndex 取 page_image」：`DeckAssetRepository` 現缺此方法（DB 欄與索引都在），補之。
- **前端唯一觸發點**（守低門檻，零新按鈕）：`CopilotView` 建會表單**選中 deck 時** fire-and-forget 打一次
  （與既有 draft-objective 自動觸發同時機；server 自行判斷 no-op）。不加任何 UI 狀態。

### 11.6 C2 明確不做

- 不做「文字部分缺」的第三種匯入狀態（degraded 時 checklist 走「本場未綁簡報」既有路徑，可接受）。
- 不做表格/SmartArt/圖表的 XML 深抽（`p:sp` 抽不到的內容交給讀圖 fallback 天然覆蓋——它讀的是渲染後的 PNG）。
- 不動 `parsePptx`/`parsePdf` 既有 SlideSpec 路徑與其呼叫者。

## 12. 明確不做（範圍界線）

- 不做會後「未涵蓋項目回寫 CRM／meeting summary」（下一輪）。
- 不做 checklist 的手動新增/編輯項目（下一輪；本輪只有 AI 生成＋勾/取消/略過）。
- 不做 `present` 端任何 checklist 顯示（**I3，永久不做**）。
- 不改既有分析窗口大小、節流秒數、任何既有配額。
- 不改 deck 渲染路徑（匯入 deck 畫面仍是原本點陣圖）。
