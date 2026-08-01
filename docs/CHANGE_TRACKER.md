# CHANGE_TRACKER — 程式碼變更追蹤（強制）

> 制度源自 ezpagesite `CLAUDE.md` 的「Change Tracking — MANDATORY」（使用者 2026-07-07 指示移植，決策 17），v2 加上「工作區」欄位。
> **每個 session 都必須遵守，無例外。**

## 規則

1. **每次修改程式檔後**（Edit/Write 任何 `.ts`／`.tsx`／`.js`／`.mjs`／`.cjs`／`.css`／`.json`（含 package.json、tsconfig）等程式相關檔案），**必須立刻**在本檔追加一筆紀錄。
2. **不可延後、不可批次補寫**——改完一個檔案（或一組相關檔案）就寫一筆。
3. 每筆必含（模板見下）：`### YYYY-MM-DD HH:MM | 主題`（24 小時制、必含日期）＋**工作區**＋**類型**＋**檔案**＋**改了什麼**（關鍵邏輯附 Before/After）＋**為什麼**（根因或需求背景）。
4. **嚴禁用 Write 覆寫本檔**。安全寫入法：
   - 先 `Read(offset=1, limit=10)` 確認錨點存在；
   - 再用 Edit，`old_string` 用 `---` 加空行加 `<!-- TRACKER_BELOW -->`（**必須含 `---` 前綴**，否則會撞到本檔規則裡的範例文字），`new_string` ＝原字串＋新紀錄。
5. **超過 500 行自動打包**：把 `<!-- TRACKER_BELOW -->` 以下全部搬到 `docs/change_archives/archive_YYYY-MM-DD.md`，本檔清空只留標頭＋錨點，再插入新紀錄；並在下方 Archives 清單補連結。
6. **不需追蹤**：唯讀操作（Read/Grep/Glob）；修改本檔自身；`docs/*.md` 制度與計畫文件（由 WORKLOG 涵蓋）；臨時除錯檔。
7. **M0 建好 package.json 後**：加輕量 pre-commit hook——staged 有程式檔而本檔無同批新增紀錄 → 擋 commit（把 ezpagesite 純靠紀律的缺口關上）。

## 紀錄模板（照抄替換）

```
### YYYY-MM-DD HH:MM | 主題名稱
- **工作區**: packages/shared｜packages/crm｜apps/server｜apps/web｜tools
- **類型**: feat｜fix｜refactor｜chore
- **檔案**: `path/to/file.ts`, `path/to/other.ts`
- **改了什麼**: 具體改動；關鍵邏輯附 Before/After
- **為什麼**: 根因或需求背景
```

## Archives

- [`change_archives/archive_2026-07-30.md`](change_archives/archive_2026-07-30.md) — 涵蓋 2026-07-19 ~ 2026-07-30（43 筆、597 行）。主題：會中進行收斂＋補充頁 theme；Phase A1/A2/A3 對練升級（自助建對象、情境模式、對練語言）；WYSIWYG C1；Live 3.1 微調＋語速拉桿；登入純 Google＋admin 首次上線；**會中待講清單全鏈**（migration 023＋三包＋三輪 code-review 修正：slideIdx 座標系、evidence TTL 縱深、建會限流、uncheck 音訊時鐘冷卻、記帳歸屬）；「會中進行」兩入口改造（會議簡報/MeetCopilot、/present/start、舞台全螢幕）；/simplify 十項清理。
- [`change_archives/archive_2026-07-19.md`](change_archives/archive_2026-07-19.md) — 涵蓋 2026-07-07 ~ 2026-07-18（55 筆、602 行）。主題：M0 地基→M5 完成→GCP Cloud Run 部署上線；CRM 核心＋研究引擎擴編（爬蟲深廣多輪、社群來源、雙語 *Zh gloss、per-contact 背景抽取 MAX_TOKENS 韌性、deep/more 模式）；DynamicSlide／會中副駕／模擬訓練三產品線；admin 平台後台＋記帳＋停權；UI 換皮＋可收折側欄 Shell＋首頁儀表板；Postgres 移植；多輪 code-review／simplify 修復。2026-07-19（含）起之新紀錄留於本檔。

---

<!-- TRACKER_BELOW -->

### 2026-08-01 18:20 | /simplify 清理：重試 hint 組裝壓平、token 預算共用夾頂公式、表格欄名去重、CSS no-op 刪除
- **工作區**: apps/server, apps/web
- **類型**: refactor
- **檔案**: `apps/server/src/gemini.ts`, `apps/server/src/generation/slide-gen.ts`, `apps/web/components/studio/BlockEditor.tsx`, `apps/web/app/studio-present.css`
- **改了什麼**（四項，皆行為不變）：
  1. `gemini.ts` systemInstruction 巢狀三元壓平。Before：外層 `escalateRecitation || maxTokensHits > 0` 三元，內層兩個模板字串各再嵌一個三元（同組條件判兩次）。After：`const retryHints = (escalateRecitation ? RECITATION_REWRITE_HINT : "") + (maxTokensHits > 0 ? MAX_TOKENS_CONCISE_HINT : "");` ＋ `const systemInstruction = retryHints ? \`${opts.system ?? ""}${retryHints}\` : opts.system;`。兩個 hint 常數皆非空字串 → `retryHints` 為空 ⇔ 原外層條件為 false，無 hint 時仍原封回傳 `opts.system`（含 undefined，維持「連鍵的有無都一樣」與 `toBe` 同參照）。
  2. `gemini.ts` `usageMetadata` 的 `UsageMetadataLoose` cast 由兩處（非 STOP 觀測 log／正常路徑 `readUsage`）上提為一份 `const u`，兩處共用；純型別斷言、零副作用。
  3. `slide-gen.ts` `deckOutputTokenBudget`／`reviseOutputTokenBudget` 兩份逐字相同公式抽出私有 `clampedOutputBudget(floor, perUnit, count)`＝`Math.min(floor + Math.max(1, count) * perUnit, GEMINI_MAX_OUTPUT_TOKENS)`；兩個 export 名稱、簽名、常數與事故實測 doc comment 全保留，改為一行委派。
  4. `BlockEditor.tsx` TableFields 內容格：`c === 0 ? "列標題" : block.headers[c] || \`第 ${c + 1} 欄\`` 原本在 placeholder 與 aria-label 逐字重複兩次 → 提為區域變數 `colName` 共用（渲染出的 DOM 屬性不變）。
  5. `studio-present.css` 刪除 `@media (max-width: 960px)` 內的 `.mc-shell__body:has(.mc-editor) { min-height: 0; }`——第 542 行同選擇器同特異度（0,2,0）已無條件宣告同值，MQ 內這條是純 no-op 死碼（globals.css 的 `.mc-shell__body` 為 0,1,0，任何順序都輸給 542）。
- **未套**：`decks-routes/index.ts` 的 `mapGenerateError` 改用 `isRecitationError`／`isMaxTokensError` helper——現有 regex 是 `/…|recitation/i`、`/MAX_TOKENS/i`（大小寫不敏感）且吃非 Error 值（`String(err)`），helper 為 `instanceof Error` ＋大小寫敏感，對「上游原始訊息用小寫」或「丟非 Error」的邊界輸入判定會收窄 → 非「行為完全不變」，跳過。
- **為什麼**: `/simplify` 候選裁決；只套可逐位元證明等價者，且一律不動測試斷言。
- **回歸**: apps/server `tsc --noEmit` 乾淨、`vitest run` 68 檔 475 測全綠；單獨再跑 slide-legacy-lock（20）＋generate-error-mapping（14）＝34 全綠；apps/web `tsc --noEmit` 乾淨、`next build` 19 路由成功；i18n key parity zh-TW/en 各 472 鍵、零缺漏。測試檔一行未動。

### 2026-08-01 18:05 | RECITATION 重取樣拆兩層：全域維持純重抽、升溫＋改寫 hint 改 opt-in（`resampleOnRecitation`）
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/gemini.ts`, `apps/server/src/generation/slide-gen.ts`, `apps/server/src/gemini-recitation-resample.test.ts`（新增）, `apps/server/src/generation/generate-error-mapping.test.ts`
- **為什麼（ROM 2026-08-01 17:54 決策 1／/code-review 三鏡頭交叉命中）**: 17:15 的修法讓 RECITATION 可重試（prod 事故的根修，正確且保留），但把「每撞一次升溫 +0.2（夾 1.4）＋在 systemInstruction 追加『用自己的話改寫、不要照抄』」**無條件**套到所有 `generateJson` 呼叫端。問題在於 CRM 抽取端（`research/extractor.ts`、`research/deep-extractor.ts`）的 SYSTEM 明令「逐字取值、嚴禁捏造」，且 `temperature` 0.3/0.4 是實測釘死的（同一頁在預設溫度下產品數 1 vs 33）。一旦那條路徑撞到 RECITATION 觸發重取樣，抽出的值會被升溫＋被指示「改寫」，而 provenance 仍指著原頁 ＝ **假的可稽核性**。17:15 的裁決只涵蓋 deck 生成脈絡（同輪對 MAX_TOKENS 已做 per-caller 裁決、對 RECITATION 沒做，不對稱本身即漏洞證據）。
- **改了什麼**:
  1. `gemini.ts:70` `GenerateJsonOptions` 新增 `resampleOnRecitation?: boolean`（命名／位置比照既有 `resampleOnMaxTokens`），預設 false，附「何時該開／何時不要開」的判準註解。
  2. `gemini.ts:392` `generateJsonMetered` 內的重取樣升級改為受旗標守門：**Before** `const temperature = recitationHits > 0 ? Math.min(...) : opts.temperature;` ＋ `systemInstruction = recitationHits > 0 || maxTokensHits > 0 ? ... : opts.system;` → **After** 先算 `const escalateRecitation = opts.resampleOnRecitation === true && recitationHits > 0;`，`temperature` 與 `systemInstruction` 一律改判 `escalateRecitation`。未開旗標時重試的 `config.temperature` 與 `config.systemInstruction` **逐位元等同首次呼叫**（未指定 temperature 時連鍵都不會憑空出現）。
  3. **未動**：`finishReasonError` 對 RECITATION 的 `retryable` 語意（仍全域無條件不短路）、`recitationHits` 計數與非 STOP 的觀測 log、happy path。亦即「可重試」與「升級重取樣」被拆成兩件獨立的事。
  4. `slide-gen.ts:659`（`reviseSlides`）與 `slide-gen.ts:731`（`generateDeckSlides`）各補 `resampleOnRecitation: true`，與該處既有的 `resampleOnMaxTokens: true` 同位——只有這兩處輸出本來就該是原創簡報文案，「換句話說」正是需求。
  5. 新測 `gemini-recitation-resample.test.ts`（5 測，`vi.mock("@google/genai")` 錄下每次 request）：(a) RECITATION 不短路、attempts 用滿；(b) 模擬抽取端（temperature 0.3 ＋逐字取值 SYSTEM）三次呼叫 config 逐位元相同、且未指定溫度時不塞 temperature 鍵；(c) 開旗標時 0.3→0.5→0.7 升溫＋注入 hint，未指定溫度時 1.2→1.4→夾住。`generate-error-mapping.test.ts` 補一測鎖「RECITATION 的 retryable 與任何旗標無關」＋檔頭交叉引用。
- **驗收**: `apps/server` `tsc --noEmit` EXIT=0；`vitest run` 68 檔 475 測全綠（基準 67 檔 469 測，只增不減）。全庫 grep `resampleOnRecitation`：生產程式碼僅 `gemini.ts` 定義處 ＋ `slide-gen.ts` 兩處啟用，其餘 14 個 `generateJson` 呼叫端零人拿到旗標——12 個在 slide-gen 之外（text-extract:243／checklist-gen:174,304／gemini-analysis:183／scoring:146／persona-gen:129,174／orchestrator:372／extractor:698,875／deep-extractor:769,821），另 2 個在 slide-gen 內但**刻意不開**（`generateSupplementSlide:789`、`regenerateOneSlide:859`——它們原本也沒開 `resampleOnMaxTokens`，本次嚴格照 ROM「只在 deck 生成＋revise 兩處、與 resampleOnMaxTokens 同位」不擴大範圍）。

### 2026-08-01 17:20 | Studio 編輯器實測三症狀修復——舞台深藍殘色/切頁位移、TABLE 表單擠爆、縮圖列無法獨立捲
- **工作區**: apps/web
- **類型**: fix
- **檔案**: `apps/web/app/studio-present.css`, `apps/web/components/studio/BlockEditor.tsx`, `apps/web/components/studio/SlideEditor.tsx`
- **使用者回報（新版 Studio 編輯器實測）**: ①中間畫布上下大片深藍黑邊、切不同 slide 時畫布上下位移；②右側 TABLE 表單太長、內容列欄位文字擠成「單次運」「極高（」；③左側縮圖列無法獨立上下捲。
- **根因（① ② ③ 有共同的一個結構根因）**: `.mc-editor` 掛在 `.mc-shell__body`（`max-width:1160px` ＋上下留白、**高度隨內容**）裡，而 `.mc-editor__grid` 沒指定 `grid-template-rows` → 隱含 row ＝ `auto` ＝ 三欄中最高者的 max-content，最高者永遠是右側屬性面板。於是舞台高度＝面板高度：選到 blocks 多的頁（比較表）面板變高 → 舞台跟著變高 → 置中的 slide 垂直位置跳動（Playwright 修前實測：第 1 頁 slideTop=365.2px、第 3 頁 520.2、第 4 頁 588.2、第 6 頁 511.2 → 位移 223px；previewH 848.6/1158.6/1294.6/1140.6）；縮圖列高度也永遠等於 row 高 → `overflow:auto` 永不觸發（修前 scrollHeight==clientHeight==849）、滾輪打到整頁（修前滾輪 → `window.scrollY=363`、縮圖列 scrollTop=0）。另有一條獨立的殘留：`.mc-editor__preview` 背景寫死重設計前的深藍 `#0a1120`（雙主題同色），撐高後就是「大片深藍黑邊」。
- **改了什麼**:
  1. `studio-present.css` 編輯器區段：新增 `.mc-shell__main:has(.mc-editor){height:100dvh}` ＋ `.mc-shell__body:has(.mc-editor){max-width:none;padding:0;flex:1 1 auto;min-height:0}`——用 `:has()` 精準限縮在「本頁有編輯器」時才讓 shell 主欄變定高滿版工作台，其他頁零影響。
  2. `.mc-editor__grid`：**Before** `grid-template-columns:180px 1fr 360px`（無 rows）→ **After** `grid-template-columns:184px minmax(0,1fr) clamp(340px,27vw,440px); grid-template-rows:minmax(0,1fr)`。明確單列 `minmax(0,1fr)` 是本次關鍵：吃滿定高、且允許欄內容縮到 0，三欄才各自捲動而非互相撐高。
  3. `.mc-editor__preview`：`background:#0a1120` → `var(--mc-sunk)`（雙主題各自對）；`align-items:center` 改為 stage 的 `margin:auto`（前者在內容超高時會裁掉上緣）；加 `container-type:size`，配合 `.mc-editor__stage{width:min(100%,1040px,calc(100cqh*16/9))}`（`@supports` 內）把 16:9 盒鎖進可用高度。
  4. `.mc-editor__thumbs` / `__panel`：`overflow:auto` → `overflow-y:auto` ＋ `overscroll-behavior:contain`（捲到底不牽動整頁）；`.mc-thumb` 加 `flex:none`（定高容器下不被壓扁）。
  5. **TABLE 表單重排**（`BlockEditor.tsx` TableFields ＋ 新 CSS `.mc-tbl` 家族）：**Before** 表頭 N 欄各佔一整列、內容列每列橫排 N 個窄輸入框（360px 面板裡每格 62.6px，20 格有 13 格文字被截）→ **After** 表頭與內容格合成**一張 2D 網格**（`grid-template-columns: repeat(var(--mc-tbl-cols), minmax(132px,1fr)) 26px`，`--mc-tbl-cols` 由 inline style 帶入），欄寬下限 132px（≥8 個全形字）、欄多時**本區塊自己**橫捲（`overflow-x:auto; overscroll-behavior-x:contain; scrollbar-width:thin`），內容格 placeholder/aria-label 改用該欄欄名。**行為零變更**：setHeader/setCell/addCol/removeCol/刪列 都是同一組 handler，`canRemoveCol = cols > 2` 守門原封不動。
  6. `.mc-blk` 加 `min-width:0`：它是 `<fieldset>`，瀏覽器內建 `min-width:min-content` 會讓比較表網格一橫寬就撐破右欄漂出視窗（第一版改完實測到，截圖佐證）。
  7. `SlideEditor.tsx`：加 `thumbRefs` ＋ `useEffect([selected, slides.length])` → `scrollIntoView({block:"nearest",inline:"nearest"})`，選到捲出視野的頁時縮圖自動進視野（唯一可捲祖先＝縮圖列，不連動整頁）。
  8. ≤960px media query 補上退回規則（`height:auto`、`container-type:normal`、stage 寬度復原、縮圖列改橫捲），維持既有「單欄堆疊、整頁捲」行為，避免定高把三段擠成一團／尺寸容器讓舞台塌成 0 高。
  9. **未動**：`renderSlideBlock`／SlideRenderer 輸出與 `.slide` 內容域樣式一行未改（`apps/server` `slide-legacy-lock.test.ts` 20/20 綠佐證）；wire/server 零改動。
- **驗收（真實輸出）**: web `tsc --noEmit` EXIT=0；`next build` EXIT=0（19 路由）；server `vitest run slide-legacy-lock` 20/20 passed。Playwright 實測（本機 dev + mock deck 8 頁含 comparison-matrix/timeline-gantt，1440×820）：舞台底色 `rgb(10,17,32)` → light `rgb(235,231,224)`／dark `rgb(21,23,23)`；切 5 頁 slideTop `365.2/520.2/588.2/511.2/365.2` → **全為 275.5**（previewH 恆 762）；TABLE 群組高 576px → **377px**（−34.5%），內容格最小寬 62.6 → **132px**，文字截斷 **13/20 → 0/20**，面板 `scrollWidth==clientWidth==388`（不再溢出）；縮圖列 `scrollHeight/clientHeight` 849/849（不可捲）→ 698/562（可捲），滾輪 `window.scrollY 363→0`、縮圖列 `scrollTop 0→136`，選第 8 頁 `inView:true`；整頁 `scrollHeight 983>820` → `820==820`；console error 修前修後同為 5 筆（皆為既有 `data-theme` hydration 警告，與本次改動無關）。行為回歸：+列/-列/+欄/刪欄到 2 欄後移除鈕 `disabled:[true,true]`、改格值同步進預覽並亮「尚未儲存」，pageErrors 0。
- **為什麼**: 使用者實測回報的三個 UI 缺陷。前兩項若不修，比較表這種「會中最常被追問細節」的頁反而最難編（表單最長、字最不可讀），且切頁畫面跳動會讓人以為簡報壞了。修法一律只動編輯器 chrome（shell 定高、grid 軌道、表單版面、縮圖列捲動），不碰渲染輸出——這條界線由 legacy-lock 測試自動把關。

### 2026-08-01 16:05 | prod 事故修復——RECITATION 誤標「安全性限制」＋deck 生成 MAX_TOKENS 撞頂
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/gemini.ts`, `apps/server/src/decks-routes/index.ts`, `apps/server/src/generation/slide-gen.ts`, `apps/server/src/generation/generate-error-mapping.test.ts`（新）
- **事故**: 使用者於 prod（rev `meetcopilot-server-00027-nkz`）用 DeckWizard 生成「介紹MeetCopilot給Troy」8 頁繁中 → 紅框「內容可能觸發安全性限制，請調整主題或用語後再試」。內容完全無害。
- **prod log 逐字證據**（`2026-08-01T07:39:03` 收件、latency 51.87s、HTTP 422）：
  - `07:39:55.341602Z [gemini:generateJson] attempt 1/3 failed: Gemini 生成未正常結束（finishReason=RECITATION）：內容可能涉及 recitation 限制，請調整輸入後再試。`
  - `07:39:55.341986Z [decks/generate] generation failed: Error: ...（finishReason=RECITATION）...` ＋ `retryable: false`
  - `07:40:26.365049Z` 使用者同輸入重按 → **HTTP 201 成功**（證明是抽樣性、非內容問題）
  - `07:40:53.578395Z [gemini:generateJson] attempt 1/2 failed: ...（finishReason=MAX_TOKENS）...` ＋ `[generation] QA revise skipped:`（QA 修訂被靜默跳過）
- **改了什麼**:
  1. `gemini.ts` 新增純函式 `finishReasonError(finishReason)`（原本內嵌在 generateJsonMetered 的 hint 三元式抽出，可單測）。**Before**：所有 `finishReason!=="STOP"` 一律 `e.retryable = false` → withRetry 在 attempt 1/3 直接短路。**After**：只有 RECITATION 不設 `retryable=false`，交回 withRetry 重試；MAX_TOKENS／SAFETY／PROHIBITED_CONTENT／BLOCKLIST／其餘維持短路（行為不變）。RECITATION 的 hint 文字也不再含「安全性」。
  2. `gemini.ts` generateJsonMetered 加 **RECITATION 獨立重取樣**：以 closure 計數 `recitationHits`，每撞一次就把 temperature 拉高（`(opts.temperature ?? 1.0) + 0.2×hits`，夾在 1.4）並在 systemInstruction 追加改寫指示 `RECITATION_REWRITE_HINT`。首次呼叫完全不受影響（happy path 零變更）。借 deep-extractor MAX_TOKENS v3「退化循環→獨立重取樣」教訓：同溫度重打會複製出同一段疑似背誦的輸出。
  3. `gemini.ts` 新增 `isRecitationError`（比照既有 `isMaxTokensError`，字串真相住本檔）＋匯出 `RetryableError` 型別＋新增 `GEMINI_MAX_OUTPUT_TOKENS = 65536`（2026-08-01 以 `GET v1beta/models/gemini-3.5-flash` 實查：`outputTokenLimit=65536`，非臆測）。
  4. `gemini.ts` 觀測性：finishReason!==STOP 時 `console.warn` 印出 `promptTokens/outputTokens/thoughtTokens/maxOutputTokens/recitationHits`——本次診斷正是卡在「log 只有 finishReason、沒有 token 數」。
  5. `decks-routes/index.ts` 抽出純函式 `mapGenerateError(err)`（route handler 改為 4 行委派）。**Before**：`/finishReason=(?:SAFETY|RECITATION)|安全性|recitation/i` 把 RECITATION 併進 SAFETY 分支 → 回「內容可能觸發安全性限制」。**After**：RECITATION 獨立成一支且排在 SAFETY 之前（其 hint 含 "recitation"），回「生成內容與既有素材過度相似（recitation），自動改寫重試後仍未通過…」；SAFETY 分支改為 `finishReason=(?:SAFETY|PROHIBITED_CONTENT|BLOCKLIST)|安全性`。狀態碼一律不變（皆 422）。
  6. `slide-gen.ts` 新增 `deckOutputTokenBudget(pages)`／`reviseOutputTokenBudget(slideCount)`。**Before**：deck 生成寫死 `maxOutputTokens: 16384`、reviseSlides 寫死 `4096`。**After**：依頁數線性給預算（deck＝8192＋2600/頁、revise＝4096＋4600/頁），夾在模型上限 65536。
  7. **MAX_TOKENS 退化迴圈 → 獨立重取樣**（新增 `GenerateJsonOptions.resampleOnMaxTokens`，預設 false）。中途實測推翻了「加大上限就好」的假設：上限拉到 28992 後，失敗樣本照樣灌到 `26215+2761=28976` 撞頂——模型是**有多少預算吃多少**地重複繞圈，而同一份輸入的成功樣本 18～20 秒就寫完。故 deck 生成與 reviseSlides 兩處 `resampleOnMaxTokens: true`，撞頂時換一個 sample 並在 systemInstruction 追加 `MAX_TOKENS_CONCISE_HINT`（要求收斂長度、把 JSON 完整收尾）。**刻意不改全域預設**：checklist-gen（砍半大綱）與 deep-extractor（減半頁面）靠 `isMaxTokensError` 立刻取得控制權做「縮小輸入再重試」，內部先重試只會拖慢並多燒 token。
- **為什麼**:
  - **RECITATION 是輸出端的抽樣旗標**（這一筆 sample 被判太像既有素材），不是輸入內容違規——把它說成「安全性限制」既錯又不可行動（叫使用者改主題，但真正有效的動作是重試，使用者自己 31 秒後重按就成功了）。且 `retryable=false` 讓已設定的 `attempts:3` 形同虛設，一次抽樣不順就整份失敗。
  - **MAX_TOKENS**：昨日 rev 00027-nkz 的 W2 版型全鏈改動（BLOCK_SCHEMA 加 table/timeline/steps、SLIDE_TEMPLATES 6→8）讓每頁 JSON 變胖，寫死的 16384 對 8 頁已不夠——真 API 實測 `outputTokens=14218 + thoughtTokens=2150 = 16368 ≈ 16384` 撞頂（thinking 與 JSON 共用同一份預算），同輸入 6 連跑失敗 3 次（50%）。reviseSlides 更誇張：單頁重做就用掉 `3061+1018=4079 ≈ 4096`，而 QA 一次最多送 3 頁 → 幾乎必然 MAX_TOKENS，又因該路徑 try/catch 靜默 skip，症狀是「QA 修訂長期沒作用」而非報錯。
  - **但撞頂的真根因是退化迴圈、不是「真的需要那麼多 token」**（中途實測推翻第一版假設，故兩手都要）：只加大上限＝失敗成本變貴（44s→74s）而失敗率不變；只有換一個 sample 才有效。加大上限仍保留，因為它獨立解掉「長 deck（MAX_DECK_PAGES=40）在 16384 下必然截斷」這個真實的容量問題。
- **真 API 驗證（同輸入「介紹MeetCopilot給Troy」8 頁繁中，本機直打 generateDeckSlides）**:
  - **修前**：6 連跑 **3 成功／3 失敗**（失敗全 MAX_TOKENS，各 ~44s）。
  - **中途（只加大上限、還沒加重取樣）**：8 連跑 **6 成功／2 失敗**——失敗樣本在 28992 的新上限下照樣灌到 `26215+2761=28976`，證明加大上限無效、失敗只是變貴（44s→74s）。此結果推翻第一版假設，才補上重取樣。
  - **修後（重取樣就位）**：8 連跑 **7 成功／1 失敗**。兩次 RECITATION 全部自動救回（run 6、run 8：`finishReason=RECITATION` → 重取樣 → OK）；MAX_TOKENS 亦多次於第 2 次嘗試救回（run 3：attempt 1、2 撞頂，attempt 3 成功）。
- **已知代價／殘留**: 重取樣把「快速失敗」換成「慢一點但會成功」——成功案例最長 172s、唯一失敗案例耗 224s（3 次嘗試全撞頂）。使用者要的是簡報而非快速的錯誤，故判定為淨賺，但**尚存 ~12% 失敗率**。真正的下一步是替 W2 版型瘦身 prompt/schema（降低模型繞圈空間），屬產品取捨，需使用者決定——**本輪刻意未動 SLIDE_TEMPLATES／BLOCK 型別**。
- **回歸**: server tsc ✓（`tsconfig.json` 與 `tsconfig.build.json` 皆綠）＋vitest **67 檔 469 測全綠**（基準 66 檔 456 測，+1 檔 +13 測，無既有測試被改動或移除）；crm 11 檔 88 測綠（未受影響）。
- **未動凍結契約**: `SLIDE_TEMPLATES`／`BLOCK_SCHEMA`／block 型別一個都沒砍；HTTP 狀態碼對映不變（RECITATION 仍 422）。

### 2026-07-31 17:20 | /simplify 套用（13 項）——去重／死碼／單一真相來源
- **工作區**: packages/shared, apps/server, apps/web
- **類型**: refactor
- **檔案**: `packages/shared/src/slide-spec.ts`, `apps/server/src/generation/pptx-render.ts`, `apps/server/src/org-routes/usage-queries.ts`, `apps/web/components/slide/slide-chart.tsx`, `apps/web/components/spend/SpendDashboard.tsx`, `apps/web/components/hud/HudView.tsx`, `apps/web/components/home/HomeDashboard.tsx`, `apps/web/components/studio/SlideEditor.tsx`, `apps/web/components/sim/MeetingSimulator.tsx`, `apps/web/components/present/PresentStart.tsx`, `apps/web/app/globals.css`, `apps/web/app/studio-present.css`, `apps/web/messages/en.json`, `apps/web/messages/zh-TW.json`, `docs/DESIGN_APPLY_CONTRACT.md`, `docs/design-handoff/*`（新增）
- **改了什麼**（全部**行為不變**，無任何測試斷言被修改）：
  1. `pptx-render.ts`：`mixWithWhite`／`mixWithBlack` 各自複製的 parseInt→位移→round→padStart 邏輯刪除，改為 `mixHex(hex,"FFFFFF"|"000000",ratio)` 的一行委派（逐通道、逐捨入等價）。
  2. `slide-spec.ts` 新增 `SLIDE_DEFAULT_THEME = { bg:"F7F5F1", text:"15130F", accent:"12708C" }`（大寫無 `#`——`normalizeHex` 的 fallback 是原樣回傳，小寫會改變 .pptx 輸出字面值）；`pptx-render` 的 `DEFAULT_THEME` 三色與 `SlideEditor` 的 `gradientFallback`（Before `?? "#12708C"` → After `` ?? `#${SLIDE_DEFAULT_THEME.accent}` ``）改為引用；CSS 端無法 import，`studio-present.css` 註解改指此常數。
  3. `usage-queries.ts`：四處 `1.25`（2 段 SQL 的 `COALESCE(cost_tax_multiplier, 1.25)` ＋ 2 處 JS `?? 1.25`）收斂為檔頭 `LEGACY_TAX_MULTIPLIER`，SQL 以模板內插產生逐字相同的字串；註解寫明**不得**改接 env 可調的 `DEFAULT_TAX_MULTIPLIER`（會讓歷史列隨 env 浮動）。
  4. `slide-chart.tsx`：`DonutChart` 兩分支逐字重複的 18 行 `<svg>` 提為 `const donut`，`centerValue` 分支包 `.chart__donut-slot`＋圓心數字，另一分支直接用——DOM 逐字等價。
  5. `SpendDashboard.tsx`：主明細表與 by-meeting 表重複的兩層佔比條抽成 `<MeterBar pct>`（pct 仍由各呼叫端用自己的分母算好）。
  6. `HudView.tsx`：三處 desk 早退分支手抄的雙 `<section>` 骨架抽成 `deskFrame(main, busy)`；`aria-busy={busy ? "true" : undefined}` 與原本「有寫／沒寫」輸出相同。
  7. `HomeDashboard.tsx`：KPI 三支 fetch 的 `.then(alive && set).catch(()=>undefined)` 樣板抽成 `kpiJob`（回傳仍永不 reject → `Promise.all`／`kpiReady` 時序不變）。
  8. 死碼刪除：`globals.css` 的 `.mc-companygrid`／`.mc-companycard*` 全家族＋`.mc-crm__controls`／`__search`（CRM 已改表格＋chip）、`.mc-home__agendaempty`／`__agendahint`（空態改走 StateBoundary）；`studio-present.css` 的 `.mc-pstart__head/__h1/__lead/__h2/__launch*/__action/__action-hint/__tip`（改用 `.mc-pagehead`＋`.mc-launchcard`）。三處均以墓碑註解取代，`PresentStart.tsx:102` 那條已失效的「住在 studio-present.css」註解同步改寫。
  9. 孤兒 i18n 鍵：`home.phasePreDesc`／`phaseLiveDesc`／`phaseDrillDesc` 自 en/zh-TW 雙檔刪除（PHASES 只渲染 tag＋title，無動態組字）；parity 472/472 仍相等。
  10. `MeetingSimulator.tsx`：兩處 `var(--mc-accent, #7c6cff)` 的舊紫 fallback 刪除（`--mc-accent` 在 `:root` 與深色皆無條件定義，fallback 永不觸發）。
  11. `docs/design-handoff/`：把 session scratchpad 的 `DESIGN_INVENTORY.md`＋`MeetCopilot.dc.html` 原封複製進 repo（md5 逐位元相同），`DESIGN_APPLY_CONTRACT.md` 第 4–6 行指標改指 repo 內副本，§0–§3 條文逐字不動。
- **為什麼**: 本輪重設計留下多處「同一份邏輯／同一段 markup／同一個魔數」的複製貼上與中途版死碼，改一處漏一處就是靜默走樣（稅率不一致、環圈兩型分歧、預設色三處鏡射）。設計稿指標指向會消失的 scratchpad，會讓數十處 `INVENTORY §A7` 註解變懸空。
- **跳過**（未套）：`SuggestionQueue.isTalkTrack` 的三步→一句壓縮——I2 收緊剛落地且該函式是所見即所批准的判準，收益（3 行）不值得再動一次剛驗過的資產。
- **回歸**（全綠、無斷言變更）：shared build ✓／crm build＋vitest **88 passed**／server tsc ✓＋vitest **456 passed**（66 檔）／web tsc ✓＋next build **19 路由** ✓／i18n parity **472 = 472**。

### 2026-07-31 16:30 | code-review 確認項——isTalkTrack 收緊（I2）＋孤兒鍵＋死 CSS＋pill token
- **工作區**: apps/web
- **類型**: fix
- **檔案**: `apps/web/components/hud/SuggestionQueue.tsx`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`, `apps/web/app/studio-present.css`, `apps/web/components/sim/MeetingSimulator.tsx`
- **改了什麼**:
  (1) **`isTalkTrack` 收緊（I2，本次重點）**：Before
  ```ts
  const body = slide.blocks.filter((b) => b.type !== "heading" && b.type !== "subheading");
  if (body.length > 1) return false;
  return body.every((b) => b.type === "paragraph" || b.type === "quote");
  ```
  → After
  ```ts
  const textual = slide.blocks.filter((b) => TALK_BLOCK_TYPES.has(b.type)); // heading|subheading|paragraph|quote
  if (textual.length !== slide.blocks.length) return false; // 有任何非文字 block → 縮圖分支
  return textual.length <= 1;
  ```
  判準改為「**slide 的全部文字內容 ＝ 話術卡會顯示的那一行**」。Before 把 heading+subheading／heading+paragraph／heading+quote 都判成話術卡，而話術卡只印 `talkText()` **一行**（優先 heading）**且藏掉「編輯後加入」鈕**——報告者看到一行、按「加入簡報」，實際 APPEND 進 live deck 的卻含他沒看過的第二段文字。After 這三型與任何含 stat/bullets/features/chart/table/timeline/steps/image/two-col 的頁一律落**縮圖分支**（SlideRenderer 預覽＋3 鈕）。**wire 零改動**：兩型送出的 action 仍是 accept/edit/reject，A/S 鍵行為未動，`talkText()`／`EditPanel`／WS 協定一行未改——分類只決定呈現。
  (2) **孤兒鍵**：zh-TW／en 雙語各刪 `hud.nextUp`（全庫 grep `nextUp` 於 tsx/ts/json 僅命中這兩處 message 定義，零消費端）。parity 掃描 475=475、雙向零差集。
  (3) **死 CSS**：`studio-present.css` 刪 `.mc-present*` 家族兩段（原 591-611 舞台/通知/指示點/spinner ＋ 原 622-690 操作層/hint），共 ~90 行。逐 selector 查證：`PresentStage.tsx` 早已改用 globals.css 的 `.mc-stage3*`，全庫 grep `mc-present` 在 tsx/ts/json **零引用**（無動態拼接——舊碼的 template literal 亦含 `mc-present` 字面量，故單一 grep 即涵蓋全家族）。**連帶查證**：段內重複定義的 `@keyframes mc-pulse` 一併刪（globals.css:1388 已有同名定義，且 globals.css 由 `[locale]/layout.tsx` 全域載入，本檔消費者 hud/copilot 兩頁都在其下）；`mc-spin` 本就只定義在 globals.css:306。
  (4) **保留（verifier 警告屬實）**：原 613-620 **不是** `.mc-present*`，而是 `.mc-editor__grid`／`__thumbs`／`__panel`／`.mc-feat-edit` 的 `@media (max-width:960px)` 響應式規則，**活的、未動**。ROM 給的「~592-689 整段刪」範圍若照抄會誤刪這 8 行。同理 `.mc-pstart*`（PresentStart.tsx 在用）亦未動。
  (5) **pill token**：`MeetingSimulator.tsx` 的 `pill` Before `background: "rgba(255,255,255,0.06)"` → After `var(--mc-surface-2)`（淺色 `rgba(21,19,15,0.045)`／深色 `rgba(255,255,255,0.055)`，雙主題自動翻轉），接續 2026-07-31 15:25 該筆「未處理」欄位列出的同批殘留。
- **為什麼**: ROM 2026-07-31 16:00 決策 1（`/code-review` 確認項）。核心是 (1)：話術卡「只顯示一行卻 APPEND 整頁」是 I2「所見即所批准」的破口——批准閘的前提是報告者**看得到他在批准什麼**，少給資訊比多給一張縮圖危險得多，故收緊方向一律偏向縮圖分支。
- **驗收**: `apps/web` `npx tsc --noEmit` **EXIT=0**；`npm run build` **EXIT=0（19 路由，與基準一致、無新增路由）**；i18n parity zh 475 = en 475、雙向零差集、`hud.nextUp` 確認消失。**Playwright DOM readback**（臨時 fixture 頁掛真 `SuggestionDeck`＋真 messages，readback 後已刪除、未進 git）六形狀全數符合預期：
  | slide 形狀 | 分支 | 鈕數 | 「編輯後加入」 | A 鍵 wire |
  |---|---|---|---|---|
  | heading+subheading | THUMB ✓ | 3 ✓ | 有 ✓ | `accept` ✓ |
  | heading+paragraph | THUMB ✓ | 3 ✓ | 有 ✓ | `accept` ✓ |
  | 純單行 paragraph | TALK ✓ | 2 ✓ | 無 ✓ | `accept` ✓ |
  | heading+quote | THUMB ✓ | 3 ✓ | 有 ✓ | `accept` ✓ |
  | heading only | TALK ✓ | 2 ✓ | 無 ✓ | `accept` ✓ |
  | heading+stat | THUMB ✓ | 3 ✓ | 有 ✓ | `accept` ✓ |

  關鍵佐證：三個 THUMB 形狀的**第二段文字確實渲染在縮圖裡**（`SUBHEADING_A_HIDDEN_BEFORE`／`PARAGRAPH_B_HIDDEN_BEFORE`／`QUOTE_D_HIDDEN_BEFORE` 皆出現在 `.mc-appr__preview`；heading+stat 的 preview innerText ＝ `HEADING_F | 42% | STAT_F`）——即修正前會被藏起來的內容現在都看得見。kicker 亦隨分支正確切換（THUMB＝「要不要補一頁給對方看」／TALK＝「現在可以這樣說」）。

### 2026-07-31 15:25 | 三個小修——slide eyebrow 對比、spend 首載佔位、sim 深色 inline 殘留
- **工作區**: apps/web
- **類型**: fix
- **檔案**: `apps/web/app/studio-present.css`, `apps/web/components/spend/SpendDashboard.tsx`, `apps/web/components/sim/MeetingSimulator.tsx`
- **改了什麼**:
  (1) **slide eyebrow 對比**：`.slide` 的 `--slide-warn` Before `#a9661a` → After `#9b5e18`。實測（WCAG 2.x 相對亮度）：`#a9661a` on 預設紙底 `#f7f5f1` ＝ **4.190:1**（不過 AA 4.5）；`#9b5e18` on `#f7f5f1` ＝ **4.812:1** ✓。同色相壓深（HSV hue 31.9°→32.1°、S 不變），只動 `.slide` 內的預設 fallback 值——`.slide__eyebrow { color: var(--slide-warn) }` 等**所有變數消費點一行未改**，per-deck theme 由 SlideRenderer 打 inline style 覆寫的機制不受影響。註記：同色在純白上本來就是 4.563:1（所以 globals.css 的 `--mc-warn` 沒破、只有紙底 `#f7f5f1` 破），改後為 5.240:1。
  (2) **spend 首載佔位**：`SpendDashboard` header 大數字 Before `{fmtUsd(postTaxTotal)}`（`data===null` 時 `postTaxTotal` 退 0 → 首載閃一格 `$0.00`）→ After `{data ? fmtUsd(postTaxTotal) : "—"}`。載入完成（含空區間 → 真的 `$0.00`）與錯誤後行為不變；下方 KPI 卡與明細表不動（明細表本來就有自己的 loading 三態）。
  (3) **sim inline 殘留**：`MeetingSimulator` 的 `cardStyle` Before `border: 1px solid rgba(255,255,255,0.08)` ＋ `background: rgba(255,255,255,0.02)` → After `var(--mc-border)` ＋ `var(--mc-card)`（比照 SpendDashboard 2026-07-30 的同類修正）。
- **為什麼**: ROM 2026-07-31 15:10 裁決三個小修。(1) 承接同日 `--mc-text-muted` 壓深的同一條標準（token 預設值必過 AA 4.5），eyebrow 是 kicker 小字、4.19:1 在縮圖尺寸下最吃虧。(2) 首載閃 `$0.00` 會被讀成「這區間沒花錢」，是假數字。(3) 舊深色皮殘留：**查證後發現 `.mc-card` 全庫沒有任何 CSS 規則**（globals.css 只有 `--mc-card` **變數**），所以這 6 張卡的外觀 100% 由此 inline 決定——原值在淺色主題下等於「邊框看不見、底色等於沒有」，並非「反正被 mc-card 蓋掉的冗餘」，故走「清成 token」而非刪除。副作用已知並接受：淺色主題下這 6 張卡從無框透明變成有框白卡（＝與全站其他卡片一致）。
- **驗收**: `apps/web` `npx tsc --noEmit` **EXIT=0**；對比值以 WCAG 相對亮度公式實算（見上）。
- **未處理（同檔、超出本次範圍）**: `MeetingSimulator.tsx` 的 `pill` 仍是 `background: rgba(255,255,255,0.06)`（同一批深色殘留，淺色主題下等於無底色）。

### 2026-07-31 13:40 | W4-wire（web）——首頁 KPI／今日議程接真資料、spend 預算條＋單場成本、train 上次分數
- **工作區**: apps/web
- **類型**: feat
- **檔案**: `apps/web/lib/api.ts`, `apps/web/components/home/HomeDashboard.tsx`, `apps/web/components/spend/SpendDashboard.tsx`, `apps/web/components/train/PersonaPicker.tsx`, `apps/web/app/globals.css`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`
- **改了什麼**:
  (1) **api.ts（唯一 REST 接縫）**：`MeetingRef` 補 `objective?`（023 已落庫）＋補註 `status` 四值與「`createdAt`＝建會時間、模型無 `scheduledAt`」；`listMeetings()` → `listMeetings({page?,pageSize?})`（既有唯一呼叫端無傳參，預設值行為不變）；新 `OrgBudget` 型別＋`OrgUsage.budget?`；新 `OrgMeetingCostRow` 型別＋`getOrgUsageByMeeting({from,to,limit?})`。
  (2) **首頁（HomeDashboard）**：原本整塊「議程待端點」佔位（`home.agendaPending` 一句話＋按鈕）→ 改接真資料。KPI 列＝本週會議／簡報數／CRM 公司數／本月 AI 花費（後者 **owner/admin 才發請求**，member 連打都不打，該格不存在）。今日議程 ＝ `listMeetings({page:1,pageSize:50})` 前端篩 `createdAt >= 今日00:00 && status!=='completed'`；**滿頁且整頁都落在窗內**才在數字後加 `+`（`todayCapped`／`weekCapped`），不硬算第二頁。三格 KPI 各自 `.catch(()=>undefined)`＝**單支失敗只讓那一格消失，不會 0 兜底也不拖垮別格**；議程面板走 `StateBoundary`（載入 skeleton／錯誤＋重試／空態 EmptyState＋「開一場會議」CTA）。週首固定週一（`(getDay()+6)%7`），花費窗用 **UTC 月初**（與 server `OrgBudget.monthStart` 同定義，否則兩處數字對不上）。
  (3) **spend**：`data.budget` 存在才渲染 `BudgetBar`（env `ORG_MONTHLY_BUDGET_USD` 沒設 → 後端無此欄 → 整條不出現）；分子取 `spentUsdPosttax`（使用者看到的是含稅），≥80% 轉 `--mc-warn`、超支轉 `--mc-danger` 並改寫「已超出 $X」；文案明寫「本月至今、**與上方查詢區間無關**」（後端該欄的窗恆為 UTC 本月）。新 `ByMeetingSection`（`/api/org/usage/by-meeting`，top 10＋佔比 bar＋StateBoundary 三態），標題與尾註都寫「**會中**成本」並說明「會前的簡報生成／研究／persona 草擬沒有 meetingId、不計入，故本表加總小於總花費——這不是漏帳」。title 缺（會議已刪）顯示 `會議 <id 前 8 碼>`，不編標題。
  (4) **train**：persona 卡的 readiness 徽章列加「上次 N 分 · M 天前」（`mc-badge--info`）；`lastScore === undefined` ⇒ **整個徽章不渲染**（沒練過 ≠ 0 分），`lastPracticedAt` 缺就只顯示分數。
  (5) **CSS**：globals.css 檔尾**只新增**一段 W4-wire 區塊（`.mc-kpirow`／`.mc-kpi*`／`.mc-agenda*`），全部吃既有 `--mc-*` token（雙主題自動成立），未改動任何既有規則。train 一行新 CSS 都沒加（複用既有 `.mc-badge--info`）。
  (6) **i18n**：`home` 命名空間刪 `agendaPending`（版位說明字，已被真資料取代、全庫零引用），新增 `kpiSection`／`kpiWeekMeetings`／`kpiWeekMeetingsSub`／`kpiDecks`／`kpiCompanies`／`kpiAllTime`／`kpiSpend`／`kpiSpendSub`／`agendaCount`／`agendaUntitled`／`agendaEmptyTitle`／`agendaEmptyHint`＋`home.status.{scheduled,completed,canceled,no_show}`（005 CHECK 的四值），**zh-TW／en 雙語同步**（parity 掃描 en 473 = zh 473 鍵、雙向零差集）。
- **為什麼**: ROM 2026-07-31 13:05 W4 範圍（前端接線）。前置的 W4-backend 盤點結論是「首頁不加端點、由既有清單自湊」，故所有數字都來自既有 REST，零新後端依賴。全程守「後端沒有的欄位不渲染、不留假數字」：設計稿的「該講的都講到 %」「建議採用率 %」「月底預測」「本週還能查幾次」在後端**沒有任何來源**（checklist 命中率與建議採納數不落庫、無預測、配額無週期），因此**繼續不渲染**——不是忘了做。spend 頁沿用該檔既有的「zh 硬寫 + inline style」慣例（全檔本來就沒有 `useTranslations`），沒有為兩個新區塊單獨引入 i18n 造成半英半中的破頁。

### 2026-07-31 13:10 | W4-backend 便宜彙總端點——月預算欄＋單場成本端點＋persona 上次分數（零 migration）
- **工作區**: packages/shared｜apps/server
- **類型**: feat
- **檔案**: `apps/server/src/org-routes/usage-queries.ts`, `apps/server/src/org-routes/index.ts`, `apps/server/src/train/last-score.ts`（新）, `apps/server/src/train/train-service.ts`, `packages/shared/src/train.ts`, `apps/server/src/org-routes/usage-budget-meeting.test.ts`（新）, `apps/server/src/train/persona-last-score.test.ts`（新）, `.env.example`
- **改了什麼**:
  (1) **首頁：不加端點**（先盤點的結論）。`GET /api/meetings` 已回 `{id,title,companyId,dealId,deckId,objective,status,createdAt}`（meeting-store.ts:207 `toRef`），今日議程／本週會議數前端自篩即可；deck 數＝`GET /api/decks` 的 `total`、公司數＝`GET /api/crm/companies` 的 `total`、本月花費＝`GET /api/org/usage`。湊法寫進 API_CONTRACT §9 尾註。
  (2) **月預算**：`usage-queries.ts` 新增 `readMonthlyBudgetUsd()`（env `ORG_MONTHLY_BUDGET_USD`，**每次請求現讀**，空/非數/≤0 → null）、`utcMonthStart()`、`orgMonthToDateSpend()`；`OrgUsage` 加 optional `budget:{monthlyUsd,monthStart,spentUsd,spentUsdPosttax}`，由 `GET /org/usage` 在 env 有設時附掛。**env 未設＝整個欄位不存在**（前端不渲染預算條，不編造上限）。budget 的窗恆為 UTC 本月，與 `from/to` 查詢窗無關。
  (3) **單場成本**：新端點 `GET /api/org/usage/by-meeting?from&to&limit` → `{items:{meetingId,title?,events,costUsd,costUsdPosttax}[]}`，依 `usage_events.meeting_id` 分組加總、成本由高到低取前 N（預設 10、上限 50）。`LEFT JOIN meetings m ON m.id=u.meeting_id AND m.org_id=u.org_id` 帶標題——**join 條件含 org_id**，故他 org 的會議標題永不外洩。`meeting_id IS NULL`（會前生成／研究／persona 草擬）一律排除，不做歸屬臆測。授權沿用 `requireManager`（owner/admin），無 rate limit（讀端點，照既有慣例）。
  (4) **重複碼收斂**：三條 `/usage*` 的 `from/to` 解析（parseEpoch＋from>to＋400 天上限，原本各抄一份）抽成 `parseUsageWindow(req,res)`——不合法時**自己送 400** 並回 null，呼叫端 `if (!win) return;`。
  (5) **persona 上次分數**：新 `train/last-score.ts`——`overallScore(scoresJson)`（相容新格式 `[{label,score}]` 與舊四維 object，取平均四捨五入、clamp 0–100；壞資料回 null）＋`lastPracticeByContact(db,orgId)`（`training_reports JOIN training_sessions ON s.id=r.session_id AND s.org_id=r.org_id WHERE r.org_id=? ORDER BY r.created_at DESC LIMIT 5000`，DESC 取每個 contact 第一筆＝最新）。`train-service.personas()` 於組完清單後**一次查完回貼**（非 per-contact N+1），`PersonaOption` 加 `lastScore?/lastPracticedAt?`；沒練過→兩欄 undefined（**不補 0**）。`seen` 與 `out` 兩個集合分開：最新那場若 scores_json 壞掉就回 undefined，**不退回去拿更舊一場冒充「上次」**（否則時間與分數對不上）。
  (6) **team 動態：不做**（查證後結論，見「為什麼」）。
  (7) 測試 +16：`usage-budget-meeting.test.ts` 11 條（env 未設/非法四值 → 無 budget 欄；設 100 → 月上限＋MTD，他 org $9.99 不混入；budget 不隨 from/to 窗變動；by-meeting 401/403 閘；排序＋會前用量不成列；**跨 org**：A 的用量列硬指向 B 的 meetingId → 成本記 A 但標題查不到、`"B 機密會"` 全回應零出現；limit／400）；`persona-last-score.test.ts` 5 條（overallScore 三格式；多次對練取最新、沒練過 undefined；**跨 org**：o2 拿 o1 的 contactId 建 99 分報告 → o1 的 personas 仍 undefined）。
- **為什麼**: ROM 2026-07-31 13:05 W4 範圍 (b)「便宜彙總端點」。原則是先盤點既有 API 能不能湊、真缺的才加——故只新增**一條**端點（單場成本，既有 API 無法從 usage 明細分頁湊出 top-N 分組）＋**一個** optional 欄位（budget，前端沒有 env 可讀）＋**兩個** optional 欄位（lastScore/lastPracticedAt，避免前端對每個 persona 各打一次 report API）。**零 migration**（只讀既有 `usage_events`／`meetings`／`training_*` 表）。「team 動態」查證後不做：`activities` 表（005_deals_meetings.sql:164）雖存在，但全 repo 唯一觸及它的程式是 `packages/crm/src/contact-merge.ts:300` 的 contact_id 重指，**沒有任何 INSERT 寫入點**＝該表恆空；其餘表沒有跨使用者事件流（`meetings.presenter_user_id` 只能拼出「誰建了會」，已在 meetings 清單裡；`usage_events.user_id` 是花費不是動態；`field_provenance` 是逐欄來源不是 feed）——沒有便宜資料源，依「不發明資料」原則不做。

### 2026-07-31 13:20 | W4-fix（web）——建議卡誠實文案＋chart 防炸＋/sim 錯誤字對比＋死 CSS 清除 232 行
- **工作區**: apps/web｜apps/server（僅新增一支測試檔）
- **類型**: fix＋chore
- **檔案**: `apps/web/components/hud/SuggestionQueue.tsx`, `apps/web/components/slide/chart-guard.ts`（新）, `apps/web/components/slide/SlideRenderer.tsx`, `apps/web/components/slide/slide-chart.tsx`, `apps/web/components/sim/MeetingSimulator.tsx`, `apps/web/components/ui/Markdown.tsx`（註解）, `apps/web/app/globals.css`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`, `apps/server/src/generation/slide-chart-guard.test.ts`（新）
- **改了什麼**:
  (1) **建議卡誠實文案（ROM 2026-07-31 13:05 裁決 1）**：primary 按鈕 Before `{talk ? t("sayThis") : t("addToDeck")}`（話術型寫「照這樣說」）→ After **兩型統一 `{t("addToDeck")}`＝「加入簡報」／"Add to deck"**。話術型的**大字呈現＋`kickerTalk`「現在可以這樣說」kicker 原樣保留**。i18n：刪 `hud.suggest.sayThis`（全庫零引用）；`hud.suggest.keys`（"鍵盤：A 照著說　S 跳過"）拆成 `keysSlide`／`keysTalk`，兩型都是「鍵盤：A 加入簡報　S 跳過」/"Keys: A add to deck · S skip"，呼叫端 `{talk ? t("keysTalk") : t("keysSlide")}`。**鍵盤處理器一個字沒動**（A→accept、S→reject，輸入框聚焦／in-flight 仍停用）；wire action 不變。
  (2) **chart 防炸（裁決 2）**：新純函式模組 `chart-guard.ts`（`chartSeriesOk` / `describeShape`，無 React 無 JSX → 測試可直接 import 真跑）。`SlideRenderer` 的 `case "chart"` 在**建立 `<SlideChart/>` element 之前**先驗 `Array.isArray(block.series)`＋`series2` 若存在須為陣列，不合格 `console.warn` ＋ `return null`。根因：`renderSlideBlock` 的 try/catch 只包住「建立 element」，`SlideChart` 函式本體是 React 稍後才執行的，`series.filter is not a function` 丟在 catch 之外 → **炸掉整頁**（/present、/hud 縮圖、/sim 面板一起白）。`slide-chart.tsx` 內部再守一層：Before `series.filter(...)`／`(series2 ?? []).filter(...)` → After `(Array.isArray(series) ? series : []).filter(...)`／`(Array.isArray(series2) ? series2 : []).filter(...)`（合法輸入路徑逐字等價，DOM 不變）。
  (3) **/sim deckErr 對比（裁決 3）**：`MeetingSimulator.tsx` 的 deck 載入失敗字疊在 `--mc-sunk` 佔位底上，淺色主題 `--mc-danger`(#c0403b) on `--mc-sunk`(#ebe7e0) 實測僅 **4.22:1**（未達 AA 4.5）。新增 token `--mc-danger-on-sunk`：淺色 `color-mix(in srgb, var(--mc-danger) 80%, black)` → #9a332f = **5.90:1** ✓；深色維持 `var(--mc-danger)`(#e5716b) on #151717 = **5.92:1** ✓（壓深反而變糊）。錯誤字改吃該 token。
  (4) **死 CSS 清除**：globals.css **2493 → 2261 行（-232）**。刪除全庫零 tsx 引用的舊皮規則群：`.mc-cap*`＋`.mc-vu`、`.mc-hud`／`.mc-hud__*`／`.mc-hud--*`＋其 `@media (min-width:860px)` 兩欄 grid、`.mc-checklist*`、`.mc-sig*`／`.mc-line*`、`.mc-cardstream`／`.mc-infocard*`／`.mc-trust*`＋`@keyframes mc-trust-pulse`、`.mc-sugqueue`／`.mc-sugcard*`／`.mc-sugbtn`／`.mc-sugedit`、`.mc-slideprev*`、`.mc-cockpit*`（含 `.mc-shell__body .mc-cockpit` 與兩個斷點）。**保留**：`kbd{}`（元素選擇器，非死 class）、`@media (prefers-reduced-motion)`、`.mc-transcript`（ScoreReport.tsx:116 仍用）。刪前逐個 grep 確認 tsx/ts/json 零引用。
  (5) 唯一殘留引用點 `MeetingSimulator.tsx` 的 `<div className="mc-card mc-cockpit__hud">` → 改 `className="mc-card"`：內嵌 HUD 的單欄收斂現已由 W3 的 `section.mc-hudm` 規則負責（`HudInner rootTag="section"` 自己輸出該 class），舊覆寫是配舊 `.mc-hud` 兩欄 grid 才需要的。`Markdown.tsx:35` 註解裡的 `mc-infocard__body` → `mc-intel__body`。
  (6) **新增 probe 測試** `apps/server/src/generation/slide-chart-guard.test.ts`（10 測，全綠）：真跑 `chartSeriesOk`（`series:null`／`"x"`／物件／undefined 全判不合格；`series2:"x"` 不合格但 `series2:null` 合格）＋原始碼片段鎖住「守衛在 element 建立之前」與 slide-chart 兩層 filter 守衛，並斷言舊寫法不得復活。放在 apps/server 是因 apps/web 無測試 runner，沿用 `slide-legacy-lock.test.ts` 既有的跨包手法（該檔本來就讀 apps/web 的 SlideRenderer.tsx）。
- **為什麼**: ROM 2026-07-31 13:05 三項裁決。(1) 「照這樣說」讓報告者以為只是唸一句、什麼都不會動，實際 accept 一樣把那頁 APPEND 進 live deck（同一條 I1/I2 路徑）——按鈕必須說出真正會發生的事。(2) LLM 回傳或舊資料的 chart 欄位形狀不可信，一顆壞 block 不得炸掉會議中的整個畫面。(3) 錯誤訊息是最需要讀得到的字，淺色主題下不得低於 AA。(4) W3 已把 cockpit/hud/stage 全面換到新 class（該包在 globals.css:1688 自述舊規則成死碼、留待 W4 清），死 CSS 留著只會讓後人不確定哪一套才是活的。
- **驗收**: web `npx tsc --noEmit` **EXIT=0**；`npx next build` **EXIT=0、19 路由（不減）**；globals.css 大括號平衡 0／最小深度 0；i18n parity **461/461**（only-en、only-zh 皆空）；`vitest run slide-chart-guard slide-legacy-lock` **30/30 綠**（legacy-lock 20 測全綠＝chart 正常路徑逐字等價未破）；全庫 grep `mc-cockpit|mc-cap__|mc-hud__|mc-sugcard|mc-checklist|mc-line__|mc-infocard` 於 tsx/ts/json **零命中**（僅剩註解）。
  **Playwright（載入 `next build` 產出的正式 CSS bundle，非理論值）**：deckErr 對比 light **4.22:1 → 5.91:1**（瀏覽器回 `color(srgb 0.602353 0.200784 0.185098)` ＝ #9a332f on #ebe7e0）、dark **5.92:1 → 5.92:1**（不變，本來就過），兩主題皆 ≥4.5 ✓；建議卡 DOM readback——zh 兩型 primary 皆「加入簡報」、en 皆 "Add to deck"，kicker 仍分「要不要補一頁給對方看」／「現在可以這樣說」，話術型仍只有 2 顆鈕（無「編輯後加入」），kbd 皆「鍵盤：A 加入簡報　S 跳過」/"Keys: A add to deck · S skip"，primary 觸控高 40px。截圖 `scratchpad/appr-{zh-TW,en}-{light,dark}.png`。

### 2026-07-31 12:19 | W3 全站重設計——cockpit 三欄 Signal Desk＋I2「建議卡即批准卡」＋hud 手機視圖＋stage 新皮
- **工作區**: apps/web
- **類型**: refactor（UI 重塑；**WS 協定與授權零改動**）
- **檔案**: `apps/web/components/copilot/CockpitView.tsx`, `apps/web/components/copilot/CopilotView.tsx`, `apps/web/components/copilot/VuMeter.tsx`, `apps/web/components/copilot/use-elapsed.ts`（新）, `apps/web/components/hud/HudView.tsx`, `apps/web/components/hud/SuggestionQueue.tsx`, `apps/web/components/hud/ChecklistPanel.tsx`, `apps/web/components/hud/InfoCardStream.tsx`, `apps/web/components/hud/TranscriptStream.tsx`, `apps/web/components/hud/DeepResearchBox.tsx`, `apps/web/components/hud/SlidePreview.tsx`（刪）, `apps/web/components/present/PresentStage.tsx`, `apps/web/app/[locale]/copilot/page.tsx`, `apps/web/app/[locale]/hud/page.tsx`, `apps/web/app/globals.css`（**只新增 W3 區段 :1916-2485**）, `apps/web/messages/en.json`, `apps/web/messages/zh-TW.json`
- **改了什麼**:
  (1) **cockpit 三欄 Signal Desk**（`.mc-desk` = 230px rail / 1fr main / 372px side）：`CopilotInner` 加 `variant="rail"`（LIVE 列＋VU＋同意閘＋主按鈕＋「這場會議」事實欄），`HudInner` 加 `layout="desk"`（回傳 `.mc-desk__main`＋`.mc-desk__side` 兩個 grid 子節點）。creds 仍由 CockpitView 擁有，建會後就地下發，兩端各開一條 WS（capture＋hud）＝原行為。
  (2) **I2 批准形態＝建議卡即批准卡**（ROM 2026-07-30 21:17 決策 1）：`SuggestionQueue` 由「垂直佇列」改為 `SuggestionDeck`（一次顯示最前面一則＋`第 N/M 則`）。新純函式 `isTalkTrack(slide)`（body block ≤1 且只有 paragraph/quote）分兩型——話術：大字 `.mc-appr__line`＋「照這樣說／跳過」；補充頁：`SlideRenderer size="thumb"` 真縮圖＋「加入簡報／編輯後加入／跳過」。**送出的 wire 訊息完全不變**（`suggestion_action` × accept/edit/reject），EDIT 面板（eyebrow＋first heading → `editedSlide`）逐字保留。A/S 快捷保留（輸入框聚焦／in-flight 時停用）。
  (3) **非樂觀更新加固**：`HudInner` 新增 `pendingActions: ReadonlySet<string>` in-flight 集合，按鈕只送訊息＋disabled＋`aria-busy`，卡片只有收到 `suggestion_result`（或本地 expiresAt 逾時）才 `settle()` 移除。checklist 同理（`inFlight` 只做視覺淡化，狀態一律等下一份全量 snapshot）。
  (4) **checklist 兩 variant**：`"desk"`＝cockpit 右欄常駐（標頭進度條＋混排可勾列表＋分類 tag＋「正在講」左脊）；`"bar"`＝/hud 手機收合單行（`max-height:48px`，進度＋下一項，點開分三組）。replace 語意 reducer、分母排除 skipped、全 skipped 不除零——全部逐字保留。
  (5) **hud 手機視圖**（`.mc-hudm`）：頂列（LIVE＋經過時間＋簡報頁）→ 清單列 → 批准卡 → 情報 tab（`filterIntel` 依既有 `InfoCardKind` 分「對方的資料／我們可以說」，**未新增 wire 欄位**）→ 逐字稿／深查改**摺疊保留**（設計稿手機版把兩者整個砍掉，這裡不跟——第二裝置可用性不得回退）。ConnectPanel 貼連結流程原樣換皮。
  (6) **stage 新皮**（`.mc-stage3*`，取代 `.mc-stage*`）：深灰 `#111211` 底＋內縮 16:9 淺紙＋重陰影，**顏色寫死 hex 不接 `--mc-*`**（app 切主題不得改變被分享出去的畫面；實測 stage-light.png 與 stage-dark.png 位元組數相同）。I3：`PresentStage.tsx` import 白名單**一個都沒加**；控制列**不放**設計稿那兩句常駐說明（其一直接提到 HUD，且會被一起分享）。
  (7) 刪 `hud/SlidePreview.tsx`（其職責被批准卡的 `SlideRenderer` 縮圖取代；全庫零殘留 import）；新 `copilot/use-elapsed.ts`（`useElapsedLabel`＝從 client 事件起算的真實經過時間，刻意不用牆上時鐘以免 hydration mismatch）。
  (8) `/copilot` 與 `/hud` 的 page.tsx 各加 `import "../../studio-present.css"`——批准卡縮圖要用 `.slide*` 規則，那支 CSS 只被 studio/present 匯入過。
  (9) i18n：新文案全進雙語（含本輪補的 `copilot.vuLabel`，把 VuMeter 原本寫死的中文 `aria-label` 換成 prop）；parity 461=461、`only en`／`only zh` 皆空。
  (10) 溢出防護：新增 `section.mc-hudm { min-height:0; max-width:none; padding:8px 6px 12px; }`。`.mc-hudm` 的 `min-height:100dvh` 只有「整個第二裝置畫面」才成立，而 `HudInner` 也被 `/sim`（`MeetingSimulator.tsx:576`，`rootTag="section"`）內嵌在一張 `minHeight:360` 的卡片裡——不加這條會把該面板撐成一整屏高。standalone `/hud` 走 `<main>`（rootTag 預設），不受影響。**未改任何既有規則、未動 sim 的檔案。**
- **為什麼**: DESIGN_APPLY_CONTRACT §2 W3。舊 cockpit 是兩欄堆疊、建議是一條垂直佇列＋另一塊縮圖預覽，報告者在會議中要同時掃三處才知道「現在要不要按」；設計稿把批准動作收斂成主舞台單卡，使用者拍板「建議卡即批准卡」。重塑全程只動呈現層——protocol.ts 未改一字，presenter 身分閘仍在 server，前端不代為判斷授權。
- **驗收**: web `tsc --noEmit` EXIT=0；`next build` EXIT=0、19 路由（不減）；i18n parity 461/461；Playwright 雙主題走查（cockpit 三欄／兩型建議卡／建會表單／hud 430px／stage）**console errors: 0**；I2 攻擊自測（掐斷 WS send 後點「加入簡報」）＝卡片仍在、in-flight、按鈕 disabled，收到 server `suggestion_result` 才消失；checklist 勾選 `1/4 → 1/4` 不動；A 鍵送 `{"type":"suggestion_action","action":"accept"}`、S 鍵送 `reject`，全程 wire 型別只有 `hello`／`suggestion_action`；stage DOM 稽核 `shell=0`、HUD 詞彙命中 0。

### 2026-07-31 09:27 | W2.5 七項小修——對比／配色對齊（螢幕↔pptx）／pptx 預設淺紙／marker 匯出／空殼守門／渲染防炸
- **工作區**: apps/web｜apps/server
- **類型**: fix
- **檔案**: `apps/web/components/sim/MeetingSimulator.tsx`, `apps/web/app/globals.css`, `apps/web/components/slide/slide-chart.tsx`, `apps/web/components/slide/SlideRenderer.tsx`, `apps/web/components/studio/BlockEditor.tsx`, `apps/web/components/studio/SlideEditor.tsx`, `apps/server/src/generation/pptx-render.ts`, `apps/server/src/generation/slide-gen.ts`, `apps/server/src/generation/slide-new-blocks.test.ts`, `apps/server/src/generation/slide-legacy-lock.test.ts`
- **改了什麼**:
  (1) **/sim 灰字**：8 處 `var(--mc-text-dim, #9aa3b8)` → `var(--mc-text-2)`（`--mc-text-dim` **從未被定義過**，等於永遠吃寫死的冷灰 fallback，在新的暖米白底上只有 2.20:1）；`#e5657f`（錯誤字，2 處：SetupPanel startErr／預覽 deckErr）→ `var(--mc-danger)`。連帶把預覽佔位框 Before `background:"#000"` → After `var(--mc-sunk)`——不改的話上面那行剛 token 化的提示字會壓在純黑上，反而更糟。
  (2) **globals.css `--mc-text-muted` 兩值**（ROM 2026-07-31 09:05 裁決；只動這兩行）：淺色 `#9c9488`→`#7d766a`（on `--mc-card` 3.00→**4.50:1**）、深色 `#7b776f`→`#8f8a81`（on `--mc-card` 3.47→**4.50:1**）。
  (3) **圖例 swatch 對色**：`slide-chart.tsx` paired 圖例 Before `PALETTE[i]`（accent／accent-2 兩個彩色）→ After 新增 `PAIRED_COLORS = ["var(--slide-sunk)","var(--slide-accent)"]`，與 `studio-present.css:245-246` 的長條實色逐格一致（原本圖例色 ≠ 長條色）。
  (4) **pptx paired 配色**：`addChartBlock` Before 一律 `chartPalette(...)` → After `paired ? pairedChartColors(theme) : chartPalette(...)`；新增 `mixHex()`＋`pairedChartColors()`＝`[mixHex(text,bg,0.07), accent]`，即螢幕 `--slide-sunk`（`color-mix(text 7%, bg)`）＋ accent。預設主題下算出 `E7E5E1`／`12708C`（測試斷言此二值出現在 chart XML）。
  (5) **pptx 預設主題深藍→淺紙**（裁決的外觀變更）：`DEFAULT_THEME` Before `bg 18233B / text E6EBF5 / accent 22D3EE` → After `F7F5F1 / 15130F / 12708C`（對齊 `studio-present.css` 的 `--slide-bg/-text/-accent`）。連帶 `resolveTheme.muted` Before 恆為 `MUTED(96A2C2)` → After **僅在該頁沒有顯式 `theme.text` 時**改用 `DEFAULT_THEME.muted(5C564C)`——否則 96A2C2 藍灰壓在 F7F5F1 淺紙上只有 2.4:1，副標/圖說幾乎看不見；**有顯式 theme 的 per-deck 路徑逐字不變**（新增測試同時鎖兩邊）。
  (6) **`bullets.marker` 進 pptx**：新增 `BULLET_PREFIX = {check:"✓ ", cross:"✕ ", dash:"— "}`；有 marker → 文字前綴＋`bullet:false`（關掉原生圓點，否則變「• ✓ …」），無 marker／`dot` → 逐字維持原本 `bullet:{indent:14}` 的圓點清單。
  (7) **supplement 空殼守門**：`generateSupplementSlide` Before `return slide.blocks.length > 0 ? slide : null` → After 追加 `hollow = slideQaIssues(slide).includes(timeline-missing|matrix-missing)`，命中即回 null。理由：deck 生成路徑有 `reviseSlides` 可重做，會中補充頁沒有（單張、即時），版式主角 block 被 sanitize 濾掉就只剩一個標題 → append 進 deck 是一張沒人看得懂的空白版式頁。
  (8) **渲染防炸**：`renderSlideBlock` 改成 try/catch 薄包裝（壞 block 回 null＋`console.warn` 一行），原 switch 原封不動搬進 `renderSlideBlockInner`；`default:` 分支保留 `never` 窮舉檢查但執行期改回 `null`（原本會把 block 物件當 ReactNode 回給 React ＝ 整頁炸）。`BlockEditor` TableFields 欄數下限 2（`canRemoveCol = cols > 2`，到底時 `disabled`＋title 說明）。`SlideEditor.gradientFallback` 舊紫粉 `#8b5cf6→#ec4899` → `#12708C→#74C3D3`。
  (9) **測試 +9**（421→430，63 檔不變）：pptx marker 前綴實測 `✕ 對帳靠人工`／`✓ 15 分鐘…`；`buNone` vs `buChar` 二選一；paired chart 色 `E7E5E1`＋`12708C`；預設淺紙三色到位且舊四色（18233B/E6EBF5/22D3EE/96A2C2）皆不出現；顯式 theme 仍走 96A2C2；空殼守門 timeline／matrix 回 null＋content 頁不受影響；legacy-lock 補鎖「防炸包裝只加在最外層」。
- **為什麼**: ROM 2026-07-31 09:05 七項裁決。共同根因是重設計把底色從深色翻成淺紙後，**所有寫死的深色時代顏色都反轉成低對比**（`--mc-text-dim` 這種從未定義的變數尤其隱形：tsc/build 全綠、console 無聲，只有量 computed color 才看得到）；同時螢幕端新版式的配色（paired 長條、淺紙預設）沒有同步到 pptx 匯出端，破壞「畫面 ＝ 匯出」不變量。防炸與空殼守門則是把「會中一張壞頁炸掉整場」的尾風險關掉。


### 2026-07-30 23:20 | W1 全站重設計④——修 `--mc-font` 在 :root 失效導致全站掉回 Times New Roman
- **工作區**: apps/web
- **類型**: fix
- **檔案**: `apps/web/app/globals.css`
- **改了什麼**: Before `:root { --mc-font: var(--font-display), var(--font-tc), system-ui, …; }` → After `:root` 只放**不含 var() 的純 fallback stack**，另在 `body` 區塊重新定義 `--mc-font`／`--mc-font-display`／`--mc-font-mono` 把 next/font 的三個變數接上去。根因：next/font 的 `--font-display/-mono/-tc` 是掛在 `<body className>` 上的，而 custom property 的 `var()` 替換發生在**宣告處**——`:root` 上取不到它們 ⇒ `--mc-font` 整條變 guaranteed-invalid（實測 `getComputedStyle(:root).--mc-font === ""`）⇒ `body{font-family:var(--mc-font)}` 失效 ⇒ 掉回瀏覽器初始值 **Times New Roman**，且三個字族一個都沒下載（實測 `document.fonts` loaded 陣列為空、零個 woff2 請求）。修完實測：body/h1 computed＝`"Space Grotesk"`、kicker computed＝`"IBM Plex Mono"`、9 個 woff2 皆 200、loaded 含 Space Grotesk／IBM Plex Mono／Noto Sans TC。順帶調側欄標頭讓 wordmark 不再被主題鈕擠掉（sidebar padding 12→10px、head gap 6→5px、wordmark 15.5→15px `-.02em`、themeswitch 鈕 22→20px）。
- **為什麼**: 舊版 `--mc-font` 是純 system stack 所以同樣寫法不會爆；改成 next/font 後才踩到這個 CSS 變數作用域陷阱。這種失效是**靜默**的（不進 console、tsc/build 全綠），只有實機量 computed font-family 才抓得到——截圖上「標題變襯線體」是唯一線索。

### 2026-07-30 22:40 | W1 全站重設計③——一般畫面逐一重做（home／crm 列表＋詳情／present-start／train／spend／team）
- **工作區**: apps/web
- **類型**: refactor
- **檔案**: `apps/web/components/home/HomeDashboard.tsx`, `apps/web/components/crm/CompanyListView.tsx`, `apps/web/components/crm/CompanyDetailView.tsx`, `apps/web/components/present/PresentStart.tsx`, `apps/web/components/train/PersonaPicker.tsx`, `apps/web/components/spend/SpendDashboard.tsx`, `apps/web/components/settings/TeamSettingsView.tsx`, `apps/web/app/globals.css`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`
- **改了什麼**:
  (1) **共用版式原語**（globals.css 新增）：`.mc-panel`／`.mc-pagehead`（kicker→29–32px h1 `-.02em`→lead→右側動作）／`.mc-navlink`／`.mc-filterbar`＋`.mc-chipfilter`／`.mc-table`（`__scroll` 讓表格自己橫捲、body 永不橫捲）＋`.mc-table__head/__row`／`.mc-avatar`／`.mc-statustag`／`.mc-bar`。
  (2) **首頁**（§B1）：Before 三欄 PRE/LIVE/DRILL flow＋動畫 rail → After 日期 mono kicker＋32px h1＋脈衝 primary CTA，下方 2 欄（左 1.6fr「今天的會議」面板／右 1fr 三張階段卡）。**4 張 KPI 與議程列表刻意不渲染**（需 meetings repo／跨會議 checklist 聚合／budget，全部不存在——§D1 P0），左欄改給一句實話＋「開一場會議」出口。日期用 `Intl.DateTimeFormat` 且**只在掛載後計算**（時區在 server 算會對不上）。
  (3) **CRM 清單**（§B6）：卡片牆 → 表格；`<select>` → 5 顆狀態 chip；`ConfidenceBadge` → 進度條＋mono 百分比（≥75 ok／≥50 warn／<50 live）；狀態文案改口語（還沒聊過／談到一半／已成交／沒下文了）。設計稿的「誰做決定」「下次見面」後端無資料 → **不渲染**，版位讓給既有真欄位「產業」；篩選 chip **不顯示計數**（無 facet count API）。分頁、＋新增客戶展開表單、三態全部保留。整檔改走 i18n（新增 `crm.*` 30 鍵）。
  (4) **公司詳情**（§B7）：header 27px h1／52px 圓角方 logo／tab 38px＋mono 計數 badge；新增「開會時用這份資料」→ /copilot（§B7 差異 6）。設計稿把 9 tab 砍成 5、overview 換成 6 張銷售敘事卡＝**需要不存在的敘事聚合層**（§D1），故只換版式配色，tab 與欄位一字不動。
  (5) **/present/start**（§B4）：deck 卡片牆 → 左欄橫向列表列（104px 頁數縮圖佔位｜標題＋meta｜已選/選擇）＋右欄 340px sticky 啟動卡。設計稿的「開始前確認三件事」preflight 三項都無後端欄位 → 不做假勾選，只保留真判斷（有無會議 session ⇒ 連線播放能否按）。**兩條播放路徑保留**（設計稿收斂成一顆鈕是原型缺漏）。新 class 全部放 globals.css，**刻意不動 studio-present.css 裡的 `.mc-pstart__*`（W2 檔案）**，且 markup 不再併用 `.mc-pstart__head`（與 `.mc-pagehead` 的 flex-direction 會打架）。
  (6) **/train**（§B9）：只換 header 版式＋persona 卡（13px 圓角、acc 框＋accSoft 底、34px 方 avatar、3 欄 grid）。設計稿改成 3 個抽象「客戶類型」並砍掉情境模式／語言／難度／目標＝**產品語意變更**，契約未授權 → 對象仍綁 CRM persona、設定全留。
  (7) **/spend**（§B10）：header 換成「區間 kicker ＋ 大金額 h1」；**inline style 的寫死色全清**——Before `rgba(255,255,255,.08)` 卡框／`var(--mc-text-dim, #9aa3b8)`（`--mc-text-dim` 根本沒定義，等於永遠吃 fallback 灰）／`#e5657f`／`rgba(255,255,255,.07)` 進度槽 → After `var(--mc-border)`／`var(--mc-text-2)`／`var(--mc-danger)`／`var(--mc-sunk)`，表頭改 mono。月上限／預測／單場成本／週配額後端皆無 → 不渲染；區間鈕、分組 segmented、逐筆明細表全部保留。
  (8) **/settings/team**（§B11）：兩個 `<section>`（成員／待接受邀請）合併成**一張 4 欄表**＋狀態欄（使用中／還沒接受）；設計稿的「最近做了什麼」後端無欄位（`OrgMember` 只有 `createdAt`）→ 改渲染真實的「加入／邀請時間」。設計稿砍掉的角色 select／移除／撤銷**全部保留**。新增 `org.team.*` 8 鍵。
  (9) 側欄標頭 238px 內要塞 logo＋wordmark＋主題鈕＋收合鈕：gap 10→6px、wordmark 允許 ellipsis、收合鈕 30→28px（截圖實測 wordmark 會壓到主題鈕）；rail（64px）時隱藏主題 segmented 與 `en` 欄避免溢出。
- **為什麼**: DESIGN_APPLY_CONTRACT §2 W1「畫面逐一照 INVENTORY §B 的行號重做」＋§1 資料不變量「後端沒有的欄位不渲染、不留假數字」。設計稿有 20+ 個綁定欄位在後端不存在（§D1），照抄就是編造數字給使用者看；因此一律「有資料就照設計做、沒資料就留版位」，缺口清單交給 W4 補端點後再接。設計稿同時砍掉大量既有能力（分頁、篩選表單、播放雙路徑、對練設定、花費明細、成員管理操作）——那是單一 shell 原型的展示缺漏，不是產品決策，故全部保留。

### 2026-07-30 22:05 | W2 全站重設計②——slide 模板全鏈（新 3 block／新 2 template／17 版式 CSS／生成 prompt／pptx 映射）
- **工作區**: packages/shared｜apps/server｜apps/web
- **類型**: feat
- **檔案**: `packages/shared/src/slide-spec.ts`, `apps/server/src/generation/slide-gen.ts`, `apps/server/src/generation/pptx-render.ts`, `apps/server/src/generation/slide-legacy-lock.test.ts`（新）, `apps/server/src/generation/slide-new-blocks.test.ts`（新）, `apps/web/app/studio-present.css`, `apps/web/components/slide/SlideRenderer.tsx`, `apps/web/components/slide/slide-chart.tsx`, `apps/web/components/studio/BlockEditor.tsx`, `apps/web/components/studio/slide-block-ops.ts`
- **改了什麼**:
  (1) **shared 契約（純新增）**：`SlideBlock` 加 `table{headers,rows,highlightColumn?}`／`timeline{ticks,tracks}`／`steps{steps}`；既有 block 加選填欄位 `stat.desc?`、`bullets.marker?`（`BULLET_MARKERS`＝dot/check/cross/dash）、`chart.series2?/seriesNames?/centerValue?/centerLabel?`；`SLIDE_TEMPLATES` 6→8（＋`timeline-gantt`／`comparison-matrix`，`AI_GENERATION_TEMPLATES` 因此也含新版式）；新型別 `TimelineTick/TimelineTrack/StepItem/TimelineEmphasis` 與版面上限常數 `MAX_TABLE_COLUMNS=4/MAX_TABLE_ROWS=6/MAX_TIMELINE_TICKS=6/MAX_TIMELINE_TRACKS=4/MAX_STEPS=5`（server sanitize＋prompt＋測試共用，不各自硬列）；`extractSlideText` 補三個新 case 與 chart/stat 的新欄位——**新欄位一律接在既有 push 之後且以 if 守衛**，舊 spec 輸出逐字不變。timeline 用語意 `emphasis`（on/warn/off）而非 hex，色由渲染器從 `--slide-accent` 衍生，才吃得到 per-deck theme。
  (2) **CSS 17 版式（`studio-present.css`，單位一律 cqw ⇒ 編輯器畫布與舞台同尺度）**：`.slide` 預設 token **深卡→淺紙**——Before `--slide-bg:var(--mc-card)`／`--slide-text:var(--mc-text)`（跟 app 主題走）→ After 寫死 `#f7f5f1`／`#15130f`／`#12708c`（設計盤點 §A9：投影出去的畫面永遠淺色、與 app 深/淺主題脫鉤）；新增 `--slide-mono-font`／`--slide-dim`／`--slide-accent-soft`／`--slide-sunk`／`--slide-warn`。eyebrow 改 mono kicker（去 uppercase／去粗體、11px÷820 ≈ 1.35cqw，與舞台 15px÷1120 同尺度）；mesh 三層 radial-gradient → 封面/分節左側 accent 粗條（§C16 的風格轉向）；標題 4.6→3.5cqw＋`letter-spacing:-.02em`、內文 2.3→1.95cqw/1.75 行高。新增 `.slide-block--table/--timeline/--steps`、`bullets--check/cross/dash` marker 變體、`.stat__desc`、`.chart__bars--paired`／`.chart__donut-center`／`.chart__series-legend`，以及 `.slide--timeline-gantt`／`.slide--comparison-matrix` 兩個頁級版式。其餘 15 個設計版式以「既有 template × block 組合＋CSS 選擇器」表達，**不增 enum**：`hero-single-stat`＝`.slide--stats .slide__body:has(> .slide-block--stat:only-of-type)`（整頁 accSoft＋96px 大數字）、`pull-quote-dark`＝`.slide--section .slide__body:has(.slide-block--quote)`（整頁反底）、`before-after`＝`.slide--content` 的 two-col 兩欄各自成面＋bullets marker、`image-full-caption`＝`:has(.slide-block--image)` 時圖 absolute 鋪底＋底部漸層字幕層、`paragraph-explainer`/`bullet-highlights`＝單一段落/條列時垂直置中。`--slide-*` per-deck override 機制不動（inline style 仍蓋得掉全部）。
  (3) **renderer**：`renderSlideBlock` 加 table/timeline/steps 三分支（table 以 grid＋`--table-tracks` 完整 track list 表達首欄較寬；timeline 的 startPct/widthPct 再 clamp 一次；steps 序號 `01/02…` 與色階由 index 衍生，不進資料）；stat 多一個 `desc ? … : null`、bullets 的 marker class 用 `filter(Boolean).join(" ")` ⇒ **無 marker 時 class 字串逐字等於舊值**。`slide-chart` 的單序列與無 centerValue 路徑刻意保留原 DOM（成對/圓心走另一分支）。`EditableSlide` 未改：新 block 自動落到既有 `default: renderSlideBlock` ⇒ 就地編輯態唯讀顯示、編輯走 BlockEditor（符合契約「至少要有表單可編」）。`BlockEditor` 加 table/timeline/steps 表單（表頭增刪同步所有列，結構上不可能產生列長≠欄數）＋stat.desc／bullets.marker／donut 圓心欄位＋新版式中文標籤；`slide-block-ops.newBlock` 補三個 case（窮舉 switch 否則編譯不過）。
  (4) **server 生成**：`BLOCK_SCHEMA` enum ＋屬性補齊（`rows` 走 `{cells:string[]}` 物件包裝——巢狀陣列在結構化輸出較不穩，sanitize 兩種形狀都收）；`sanitizeBlock` 新增三個 case 與守門：table 列長補/裁到欄數、<2 欄或全空列濾除、highlightColumn 越界丟棄；timeline `startPct+widthPct>100` 夾回版面內、軌道全滅則整個 block 濾除；chart `series2` 長度不等於 `series` 即退回單序列（寧可不畫也不畫錯）、`centerValue` 只對 donut 生效。prompt：`TEMPLATE_INTENT_ZH`／`BLOCK_SHAPE_PROMPT_ZH` 納入新版式與新欄位；**supplement（會中補充頁）版型選擇規則**沿用既有「依訊號選版型」寫法擴編——時程/什麼時候能上線→`timeline-gantt`、對方說在比誰/競品對比→`comparison-matrix`、接下來怎麼做→`content＋steps`、現況 vs 導入後→two-col＋cross/check marker、客戶原話→section＋quote，並新增第 (3) 條**事實紀律**（table 競品欄／chart 數值／timeline 時間只能引用逐字稿已出現或我方已驗證的資訊，湊不出就退回純文字版型）。`slideQaIssues` 加 `timeline-missing`／`matrix-missing`（主角 block 被濾掉的空殼頁會進 reviseSlides 重做），revise prompt 同步。
  (5) **pptx 匯出（每個新版式都帶映射，實測產檔）**：`addTableBlock` 走**原生 `addTable`**（可在 PowerPoint 內續編）、首欄較寬、highlightColumn 吃 accent 淡底；`addTimelineBlock` 刻度色條＋每軌「槽＋條」兩個矩形（百分比幾何鏡射螢幕）；`addStepsBlock` 橫排等分欄＋頂色條＋序號/標題/說明/負責人；chart `series2` → 第二個 data set（自動開 legend）、donut `centerValue` → 疊一個置中文字框；`estimateHeight` 補三個 case；`renderSlide` 兩個新 template 路由到 `renderContent`（版面同為「標題＋一個主 block 吃滿」）。**修一個實測抓到的漏**：`renderStats` 自己畫 stat 卡（不走 layoutBlocks），原本會把 `stat.desc` 整段吞掉 → 改成有 desc 時輸出 label/desc 兩段 run。
  (6) **測試 +2 檔 +46 測**（server 61 檔 375 測 → **63 檔 421 測**）：`slide-legacy-lock.test.ts`＝舊 spec 逐字等價鎖定（extractSlideText golden／renderSlideBlock 既有分支 JSX 原文比對／舊 deck pptx 匯出文字 golden／sanitizeBlock 對舊 block 的輸出形狀）；`slide-new-blocks.test.ts`＝新 block sanitize 往返與上限守門、extractSlideText 涵蓋、supplement mock LLM 回新版式過 zod、**pptx 對含全部新 block/新 template 的 deck 實測產檔**（解壓驗 `<a:tbl>`／軌道圖形數／`01–04` 序號／雙序列名稱／圓心數字）。
- **為什麼**: DESIGN_APPLY_CONTRACT §2 W2。設計稿 16 個陳列版式＋1 個舞台版式與現行「6 template × 10 block」二維模型不對齊：多數是換皮（能用既有組合＋CSS 表達），但 `timeline-gantt`／`comparison-matrix` 現有 blocks 完全無法表達（chart 只吃 `{label,value}` 無法表達「起點＋長度」；two-col 只有兩欄），故必須新增 block 型別；`steps` 則是 features 加不上序號/負責人/橫排。新版式要能在**會中**被自動選用，所以 supplement prompt 與 zod/Gemini enum 必須同步——但競品表與時程是幻覺代價最高的內容（會當眾說錯），故同步加事實紀律條款與 sanitize 硬守門。向後相容鐵律（既有 deck 逐字不變）用 A/B 實證：把 `git show HEAD:pptx-render.ts` 與現版並排跑同一份舊 deck，`ppt/slides/slideN.xml` **全文完全相同**，該結果即 golden 落進回歸測試。

### 2026-07-30 21:40 | W1 全站重設計①——token 全套替換（雙主題）＋next/font 三字族＋AppShell 主題切換
- **工作區**: apps/web
- **類型**: refactor
- **檔案**: `apps/web/app/globals.css`, `apps/web/app/[locale]/layout.tsx`, `apps/web/components/AppShell.tsx`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`
- **改了什麼**: (1) `:root` token 表整塊重寫：Before 深藍紫單主題（`--mc-bg:#0a0f1a`／`--mc-accent:#8b5cf6`／`color-scheme:dark`）→ After **設計稿 18 變數雙主題**，變數名沿用 `--mc-*` 重新映射（`--mc-bg:#f2efea`／`--mc-card:#ffffff`(=--panel)／`--mc-panel:#faf8f4`(=--panel2)／`--mc-accent:#12708c`／新增 `--mc-sunk`／`--mc-line2`／`--mc-warn-soft`／`--mc-warn-line`／`--mc-live`／`--mc-shadow`／`--mc-scrim`）；**淺色為預設**（`:root` 與 `:root[data-theme="light"]` 同一份），深色走 `:root[data-theme="dark"]`；`color-scheme` 跟著主題切（light/dark），否則淺色下 UA select／捲軸仍深色。(2) 全檔硬寫色掃乾淨：`rgba(139,92,246,*)`×32＋`#c4b5fd`／`#cdbcff`／`#7dd3fc`／`#6ee7b7`／`rgba(216,246,81,*)`（萊姆）／`rgba(109,124,255,*)`／`rgba(38,50,82,.5)`／`rgba(150,162,194,*)` 等 → 全改 `color-mix(in srgb, var(--mc-*) N%, transparent)` 或對應 token；6 處 `color:#fff` → `var(--mc-accent-contrast)`／`var(--mc-accent)`（深色主題 accInk 是**深色**，寫死白字會近黑底白字翻車）。(3) radius 刻度 3 檔→6 檔（`--mc-radius:9px` 為預設，新增 `--mc-r-xs:5px`、`--mc-r-lg:14px`）。(4) `.mc-kicker` 照 §A7 重做：去掉 `::before` 圓點＋`text-transform:uppercase`＋`font-weight:600`（內容是繁中），改 10.5px/.14em/400；`--live` 圓點改由 `.mc-kicker--live::before` 長出。(5) 新增共用原語 `.mc-sr`／`.mc-mono`／`.mc-bar`(進度條，含 --lg/--warn/--ok/--live)。(6) 字體：Geist/Geist_Mono → **Space Grotesk＋IBM Plex Mono＋Noto Sans TC**（`next/font/google` 自架，不用 Google Fonts `<link>`），`--font-display`／`--font-mono`／`--font-tc`。(7) `layout.tsx` `<head>` 加同步 inline bootstrap script 讀 `localStorage["mc.theme"]` 掛 `data-theme` 到 `<html>`——避免 FOUC。(8) `AppShell`：側欄標頭加 `ThemeSwitch`（☀/☾ segmented，狀態單一真相＝`<html data-theme>`、localStorage 持久）；nav 每項加英文縮寫欄 `en`（TODAY/CLIENTS/SLIDES/SHOW/LIVE/PRACTICE/COST/TEAM，語言中立→不進 i18n）；nav 標籤改口語繁中（新 i18n key `nav.item*`）；側欄寬 248→238px；active 態從紫光暈改 accSoft 底＋accLine 框＋acc 字；avatar 圓形漸層→28px 圓角方＋mono。**保留**設計稿沒畫的 rail 收合、≤880px 抽屜、`adminOnly` 權限分支、登出、/sim 群組。
- **為什麼**: DESIGN_APPLY_CONTRACT §0／§2 W1：全站直接取代為新設計語言，淺色預設；沿用 `--mc-` 名減少全庫改名面。舊 CSS 有 2000 行深色 token 消費端，若只加新名不改舊值＝雙皮並存；硬寫色不掃＝淺底上仍是深色殘留。字體改 `next/font` 是 CSP／效能要求（契約 §0 明列不得用 `<link>`）。


### 2026-07-30 16:55 | C2 對抗驗證修正——三態負結果標記（§11.1 v1.4）＋匯入端點掛共用限流桶（§11.5 v1.4）
- **工作區**: apps/server｜packages/crm
- **類型**: fix
- **檔案**: `apps/server/src/import/text-extract.ts`, `apps/server/src/index.ts`, `apps/server/src/import/text-extract.test.ts`, `apps/server/src/generation/deck-outline.test.ts`, `apps/server/src/ops/rate-limit-wiring.test.ts`, `packages/crm/src/repos-decks.ts`（doc comment）, `packages/crm/test/deck-text-extract.test.ts`
- **改了什麼**: (1) 三態語意：讀圖 fallback 回空字串——Before `if (text.length===0) continue;`（留 NULL）→ After **寫入 `''` 負結果標記**（回應缺 text 欄位＝失敗，仍留 NULL 可重試）；`needsText` Before `(s.textExtract ?? "").trim().length>0` → After `typeof s.textExtract === "string"`（NULL/undefined＝未抽過→需要；`''`＝確認無字→跳過；非空→跳過）。(2) `index.ts` 限流名單加 `app.post("/api/decks/import", jwtGuard, limit)`（共用桶、body parser／multer 之前）。(3) 測試：server +5（讀圖回空→DB 落 ''、第二輪 not-needed＋gemini 零呼叫；25 頁全空第一輪寫 '' 前 20、第二輪自動輪到 21–25；缺 text 欄位留 NULL；`''` 頁不進 outline；wiring 名單斷言含 import＋extract-text 且在 parser 之前）；crm +1（`''` 經 rowToSlide `?? undefined` 讀回仍是 `''`）；假 core 的 setSlideTextExtract 改有狀態（寫入反映 slides）供第二輪測試。repos-decks doc comment 明文「`''` 合法值、不得加空字串守衛」。
- **為什麼**: C2 對抗驗證確認兩條契約漏洞（契約更正 v1.4）：a) 「空字串一律不寫」讓讀圖確認無字的頁永遠 NULL → 每次回填重燒讀圖永不收斂（實測 5 頁純圖 deck 每輪 5 呼叫）、且 `slice(0,maxPages)` 每輪同批＝第 21 頁起永久飢餓；b) 匯入本身就是 LLM 觸發端點（每發最多 20 次讀圖）且 in-flight 去重以 deckId 為鍵、每次匯入＝新 deck 去重永不命中，不掛桶＝合法帳號可連打匯入無限燒讀圖。驗收：crm tsc 重建 EXIT=0＋vitest 88/88（基準 87）；server `tsc --noEmit` EXIT=0＋vitest 61 檔 375/375（基準 370）。

### 2026-07-30 18:55 | C2 匯入抽字——測試（8 項契約要求）＋pdf.js Buffer byteOffset 修正
- **工作區**: packages/crm｜apps/server
- **類型**: feat（測試）＋fix
- **檔案**: `packages/crm/test/deck-text-extract.test.ts`（新）, `apps/server/src/import/text-extract.test.ts`（新）, `apps/server/src/import/pdf-parser.ts`
- **改了什麼**: (1) crm 測試 7 條：setSlideTextExtract 對 original 頁／committed 頁**照寫成功**（證明繞開 OriginalSlideLocked/I1 是刻意且有效）、spec_json 逐位元不動、org 隔離零副作用不 throw；getPageImage 命中/未命中/跨 org null/kind 過濾。(2) server 測試 15 條：parsePptxText 重排 zip fixture（檔名序≠sldIdLst 序→跟 sldIdLst 走；缺 sldIdLst/缺 rel→null）、assemblePdfPages 單頁失敗佔位＋手工構造真實 2 頁 PDF 整條 parsePdfText、數量守門（2≠3→零寫入）、讀圖上限（25→20 呼叫、頁 20–24 NULL）、fill-empty 冪等＋native/已全有字/processing→not-needed＋併發第二發 in-flight no-op、抽字 throw→deck ready+job done＋時序（ready 之後 done 之前）、計費（kind=gemini_extract、orgId/userId、idemKey seq 唯一）。(3) fix：`parsePdfText` 把輸入轉 `new Uint8Array(buffer)` 精確拷貝——pdf.js v1.10 對非 0 byteOffset 的 pooled Buffer 視圖會誤用底層 ArrayBuffer 全段（實測 'bad XRef entry'）。
- **為什麼**: 契約 §11 測試最低要求 8 項；Buffer byteOffset 陷阱在測試中真實踩到（Buffer.from(string) 走 pool），prod 路徑（worker Buffer.from(ArrayBuffer) 恰為 0-offset）僥倖不觸發，防禦性修正。

### 2026-07-30 18:35 | C2 匯入抽字——回填端點＋限流名單＋前端觸發
- **工作區**: apps/server｜apps/web
- **類型**: feat
- **檔案**: `apps/server/src/decks-routes/index.ts`, `apps/server/src/index.ts`, `apps/web/lib/api.ts`, `apps/web/components/copilot/CopilotView.tsx`
- **改了什麼**: (1) 新端點 `POST /decks/:id/extract-text`：org-scoped（findById 守門→404）；`maybeStartTextExtract` 判斷——native deck／已全有字／匯入未完成→`200 {needed:false}`，需要跑／同 deck in-flight→`202 {started:true}`（fire-and-forget，無 job 列、前端不輪詢）。(2) `index.ts` 限流名單（body parser 之前、共用單一 TokenBucketRateLimiter）加 `app.post("/api/decks/:id/extract-text", jwtGuard, limit)`。(3) web `requestDeckTextExtract(deckId)` client 函式。(4) `CopilotView` 建會表單：選中 deck 的 effect fire-and-forget 打一次（與 draft-objective 同時機；零 UI 狀態、失敗靜默）。
- **為什麼**: MEETING_CHECKLIST_CONTRACT §11.5：C1 之前匯入的 deck text_extract 全 NULL，需靜默回填；守低門檻＝零新按鈕，唯一觸發點在選 deck 時；限流掛共用桶避免同 org 額度加倍與白 parse body。

### 2026-07-30 18:25 | C2 匯入抽字——server 管線（輕量解析器＋讀圖 fallback＋掛進 conversion-job）
- **工作區**: apps/server
- **類型**: feat
- **檔案**: `apps/server/src/import/pptx-parser.ts`, `apps/server/src/import/pdf-parser.ts`, `apps/server/src/import/run-in-worker.ts`, `apps/server/src/import/parse-worker.ts`, `apps/server/src/import/text-extract.ts`（新）, `apps/server/src/import/conversion-job.ts`, `apps/server/src/decks-routes/import-handler.ts`
- **改了什麼**: (1) `parsePptxText`：逐頁純文字（只回 string[]），頁序權威＝presentation.xml `sldIdLst`（經 _rels 映 rId→slideN.xml）——解不出/缺 rel/缺檔一律回 null（對齊無效訊號）；單頁 XML 壞掉以空字串佔位。(2) `parsePdfText`＋`assemblePdfPages`：pagerender 以 `pageData.pageIndex` 為鍵收集，單頁失敗（pdf-parse `.catch(()=>"")` 靜默吞頁）補空字串佔位不位移；索引不可得時退順序收集＋數量守門。(3) worker task 新增 `pptx-text`/`pdf-text`。(4) 新 `text-extract.ts` 管線：fill-empty 冪等（text_extract 空且 spec 文字空的原始頁）、數量守門（解析頁數≠originalCount→整份丟棄）、每頁 trim+8000 上限、讀圖 fallback（<TEXT_EXTRACT_MIN_CHARS(20) 觸發；TEXT_EXTRACT_VISION_MAX_PAGES(20)/TEXT_EXTRACT_VISION_CONCURRENCY(2) env 化；attempts=1、temperature=0、thinkingBudget=0）、meteredGeminiClient kind='gemini_extract'、module-level in-flight Set 併發去重、worker 傳 `Buffer.from(bytes)` 複本防 detach。(5) conversion-job：`ConversionDeps.extractText?` 可選階段，於 setImportStatus('ready') 之後、setJobStatus('done') 之前跑，自帶 try/catch 只 log；`runConversionJob` 改收 `Partial<ConversionDeps>` 合併預設。(6) import-handler：`_config/_meter` 啟用，工廠期建 gemini client，注入 extractText（userId＝匯入者、idemPrefix=`textextract:${jobId}`）。
- **為什麼**: MEETING_CHECKLIST_CONTRACT §11（v1.3 凍結）：匯入 deck 逐頁餵料 checklist；既有 parsePptx 檔名序＝錯的權威（重排過的 pptx 文字靜默錯位→翻頁勾稽誤劃），pdf 順序 push 有吞頁位移風險；任何失敗不得影響匯入本身。

### 2026-07-30 18:05 | C2 匯入抽字——crm repo 層（setSlideTextExtract＋getPageImage）
- **工作區**: packages/crm
- **類型**: feat
- **檔案**: `packages/crm/src/ports.ts`, `packages/crm/src/repos-decks.ts`, `packages/crm/src/repos-deck-assets.ts`
- **改了什麼**: DeckRepository 新增 `setSlideTextExtract(orgId, deckId, idx, text)`——獨立 UPDATE 只寫 `deck_slides.text_extract`、不碰 spec_json、不 bump decks.updated_at、**刻意不走 updateSlide**（原始頁必命中 OriginalSlideLocked/I1 守門，而 text_extract 非內容變更）；orgId 進 WHERE（跨 org 命中 0 列）。DeckAssetRepository 新增 `getPageImage(orgId, deckId, pageIndex)`（kind='page_image' 單頁 PNG bytes，讀圖 fallback 用）。兩處介面均掛 doc comment「僅限匯入期與回填 job，嚴禁 realtime／會中路徑」。
- **為什麼**: MEETING_CHECKLIST_CONTRACT §11.4／§11.5：匯入 deck 逐頁純文字落庫供 checklist 取材；回填讀圖需依 deckId+pageIndex 取頁圖（DB 欄與 idx_deck_assets_deck_kind 索引已在，缺 repo 方法）。
