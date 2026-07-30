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
| [`rom_archives/ROM_001.md`](rom_archives/ROM_001.md) | 2026-07-04 ～ 2026-07-24 | v1 關鍵決策＋v2 大 pivot（14 項＋雙帳號會議模型）；模型分工 Fable 決策/Opus 執行＋審查修正批＋生圖 OpenAI；CRM 核心＋研究引擎擴編（爬蟲深廣多輪·社群結構化落庫·雙語 *Zh gloss·照片獵取·人物去重·政府爬取規劃）；DynamicSlide 匯入重構（保留原 pptx/PDF·LibreOffice 轉圖顯示·jszip 嫁接匯出）＋補充頁生成橋接＋抽色風格對齊；會中副駕/HUD 導覽收斂＋WS_PUBLIC_BASE 修復；AI 記帳全面對齊 ezpage（五桶 token·差別計價·每列稅率）＋org 花費頁；模擬訓練手動解鎖→train 頁自助建對象（#1 AI 補齊真人/#4 虛擬人物/objective）＋Gemini Live 3.1 微調（chunk 延遲·每 persona 嗓音）；WYSIWYG Studio 編輯器藍圖＋C1。 |

---

<!-- ROM_BELOW -->

### 2026-07-30 16:42 | C2 對抗驗證裁決：兩條契約漏洞（v1.4 更正）＋實作四項自主決策追認
- **誰決定**: Fable（依 C2 雙路復驗結果裁決；本 session 第四次由對抗路抓到我方設計/契約缺陷）
- **C2 實作與契約復驗結果**：契約六小節逐條 pass（信心 90–95）；對抗路 10 個惡意 pptx fixture（重排/孤兒頁/隱藏頁/缺 rel/壞 XML/重複 rId…）**零錯位寫入路徑**——§11.2 的對齊守門設計成立；併發去重、計費覆蓋、I1/I3 鄰接面、buffer detach 全數實測乾淨。crm 87 測＋server 61 檔 370 測＋web 19 路由。
- **決策 1（修，契約 v1.4）——空結果頁無限重讀（85 分）**：§11.1 原寫「空字串不寫、留 NULL」是**契約漏洞**——讀圖確認無字的頁留 NULL → `needsText` 永遠判「還沒抽」→ 使用者每次在建會表單選中圖片型 deck 就重燒最多 20 次讀圖（對抗實測 5 頁純圖 deck 每輪重燒、永不收斂），且 `slice(0,20)` 每輪取同批 → 第 21 頁後**永久飢餓**。→ **三態語意**：NULL=未抽、`''`=抽過確認無字（負結果標記）、非空=文字；parser 空留 NULL（交讀圖）、**讀圖空寫 `''`**。負結果標記同時解掉飢餓（已確認頁跳過、下輪自然輪到後面）。下游相容：`buildDeckOutline` 對空文字頁本就跳過。
- **決策 2（修，契約 v1.4）——`POST /api/decks/import` 未掛限流桶（75 分）**：§11.5 原稿只要求**回填端點**掛桶，漏了匯入本身——C2 後匯入就是 LLM 觸發端點（每發 ≤20 次讀圖），且 in-flight 去重以 deckId 為鍵、每次匯入都是新 deck＝**去重永不命中**。→ 入 index.ts 共用桶（與 meetings×2/extract-text 同桶）。
- **決策 3（不修）——job running 窗口拉長與隱藏頁**：對抗路自評非阻斷——(a) 抽字期間重啟會讓 job 被 reaper 標 failed 但 deck 已 ready，前端只看 importStatus、無使用者可見影響、回填天然補救；(b) 隱藏頁兩種點陣化行為（含/不含）都不會錯位、僅成本差——守門設計已涵蓋。
- **決策 4（追認實作四項自主決策）**：`getPageImage` 帶 orgId 縱深；pdf.js pooled Buffer byteOffset 陷阱修在源頭（`new Uint8Array(buffer)` 精確拷貝——測試真實踩到 'bad XRef entry'，prod 路徑 0-offset 僥倖不觸發）；讀圖帶 `temperature:0`＋`thinkingBudget:0`；`setSlideTextExtract` 不 bump `decks.updated_at`（非內容變更、不擾動列表排序）。全數合理，追認入帳。
- **方法論**: 本 session 對抗路的第四次命中（evidence purge 白名單→冷卻期時鐘域→本次兩條），四次全是**指揮官層的設計/契約缺陷而非實作偏差**——「實作照契約做對了，但契約本身有洞」是這個專案最穩定的失敗模式。對抗驗證必須把**契約本身**當攻擊面（L19 已記，本次再證）。
- **影響**: `text-extract.ts`（負結果寫 `''`＋needsText 三態判定）、`index.ts`（限流名單 +1 行）、對應測試更新；契約 §11.1/§11.5 已更正 v1.4。

### 2026-07-30 15:40 | C2 契約凍結（v1.3）：匯入 deck 抽字＋讀圖 fallback＋回填——頁序對齊定為最高風險
- **誰決定**: 使用者（「C2」一聲啟動；抽字＋讀圖 fallback 的大方向是 2026-07-28 16:54 四岔路已拍板的）＋Fable（偵察後的風險設計與範圍凍結）
- **決策（寫進 MEETING_CHECKLIST_CONTRACT §11 v1.3，六節）**:
  1. **抽字掛在 conversion-job、deck 先 ready 再抽字**：前端輪詢 importStatus 即解鎖、UX 不變；抽字任何失敗只 log、絕不把匯入標 failed（圖好了就是好了）。
  2. **頁序對齊是 C2 最高風險，兩道守門**：(a) pptx 頁序權威改為 `presentation.xml sldIdLst`（偵察證實既有 parser 用 slideN.xml 檔名數字排序＝錯的權威——使用者重排過投影片時檔名序≠播放序、頁數相等無從偵測、文字靜默錯位→翻頁勾稽**誤劃**）；(b) 數量守門（隱藏頁/pdf 吞頁→頁數不等→對齊無效）。**對齊無效＝整份逐頁文字全丟、改走讀圖路徑**（PNG 上的字 Gemini 讀得到、天然對齊）——**寧付讀圖成本，不寫可能錯位的文字**。
  3. **讀圖 fallback 成本硬上限**：每 deck 上限 20 頁（env）、並行 2、attempts 1；掃描型 100 頁 PDF 不得變 100 次呼叫（outline 全份也才 12k 字）。計費 kind＝`gemini_extract`（admin 標籤本來就寫「匯入解析」、至今無人用）、補傳 userId、idemPrefix=jobId。
  4. **既有 deck 回填**（契約 §11 原稿沒有、本次擴充）：`POST /api/decks/:id/extract-text`，fill-empty 冪等、共用限流桶、**無 job 列無進度 UI**（靜默 enhancement）；前端唯一觸發＝建會表單選 deck 時 fire-and-forget（與 draft-objective 同時機、零新按鈕，守 [[keep-operations-simple-low-barrier]]）。原稿 §11 doc comment「僅限匯入期呼叫」同步放寬為「匯入期＋回填 job，嚴禁 realtime 路徑」。
  5. **輕量文字路徑**：新增只回 `string[]` 的 `parsePptxText`/`parsePdfText`，不得走既有 SlideSpec 路徑（會把圖片 base64 內嵌＝純浪費記憶體）；worker transfer 用複本防 detach。
  6. **明確不做**：第三種「文字部分缺」匯入狀態；表格/SmartArt XML 深抽（讀圖天然覆蓋）；不動既有 parsePptx/parsePdf 及其呼叫者。
- **脈絡與理由**: 偵察（單路 opus）確認：Gemini 讀圖能力已存在（`GenerateJsonOptions.images`）、兩解析器都逐頁、新匯入 PNG 在記憶體零額外讀取、`buildDeckOutline`/`rowToSlide`/`gatherChecklistContext` C1 已就緒——C2 純 server 工程＋一行前端。最大的坑不是能力而是**對齊正確性**與**成本失控**（100 頁掃描 PDF）。
- **考慮過的替代**: 全部頁一律讀圖不用 parser（否——parser 免費且常態正確，讀圖只當 fallback）；對齊無效時仍寫「可能錯位」的文字（**絕對否**——誤劃比漏劃傷害大，checklist 全設計的底線）；回填做成有進度的 job＋UI（否——靜默 enhancement 就夠，違反低門檻原則）；修 pdf-parse 吞頁（否——第三方庫行為，用索引鍵＋數量守門繞開）。
- **影響**: `import/`（conversion-job、pptx-parser 加 parsePptxText、pdf-parser 加 parsePdfText、parse-worker、import-handler 補 userId）、`repos-decks`（setSlideTextExtract）、`repos-deck-assets`（依頁取圖）、`ports`、`decks-routes`（回填端點）、`index.ts`（限流名單）、web `CopilotView` 一行觸發。

### 2026-07-30 13:42 | 契約 §7.5 更正到 v1.2（時鐘域）＋第三輪殘留 4 條裁決：修 1、記債 3
- **誰決定**: Fable（依限流／冷卻兩路 fresh-context 復驗的殘留 finding 裁決）
- **第三輪修正本體已驗收**（4 條全成立）：建會端點納入共用限流桶、uncheck 冷卻期、清單生成補 `userId`、同來源重勾不刷 `covered_at`。兩路復驗 `pass`，且驗證做得比前幾輪更硬——限流是**用真的 `index.ts` 起真 server 打真 HTTP**（刻意不採信修正 agent 自己寫的測試），並做了**突變測試**（故意把修正改壞確認測試轉紅再還原）。最終 server 60 檔 351 測、crm 10 檔 80 測。
- **決策 1（修）——契約 §7.5 的「冷卻長度」漏寫時鐘域，是我的契約缺陷（信心 90 機制／65 值得修）**：
  - 我在 §7.5 寫「冷卻長度＝分析滾動窗最大年齡（`WINDOW_MAX_AGE_MS`）」，理由是「那正是害它被誤判的逐字稿最久能留在窗裡的時間」。**理由對，但沒寫明用哪個時鐘。**
  - 實作（正確地）照字面用了 `Date.now()`＝**牆鐘**；但**分析窗的年齡是用音訊取樣時鐘**算的（`chunker.ts` 的 `consumedSamples / (SAMPLE_RATE/1000)`，**只在 PCM frame 進來時前進**）。兩者只在音訊持續流動時等價。
  - **失敗情境（復驗 agent 實測復現）**：報告者 uncheck 一個誤判項 → 按「撤回同意」做 2 分鐘內部討論（`pushAudio` 在 `!consent` 時 return，音訊時鐘完全凍結，且 consent handler 不清 engine 的 window）→ **牆鐘 90 秒已到期、但那段逐字稿在音訊時鐘上只老了幾秒、仍在窗裡** → 恢復後第一輪分析（節流 5 秒）就把同一項再劃掉＝**§7.5 要消滅的打地鼠原樣復活**。停止分享導致 capture socket 斷線（HUD 仍在故 runtime 不回收）亦同。
  - **裁決修（雖 65 分低於門檻）**：因為 (a) 這是**我的設計錯誤**不是實作偏差；(b) 它**完全抵銷了 §7.5 存在的意義**；(c) 「報告者的 uncheck 沒用」正是使用者會直接察覺的缺陷；(d) 修法小。
  - **契約已更正為 v1.2**：明訂用音訊時鐘——uncheck 當下記下**音訊時鐘高水位**，放行條件 `latestAudioT - uncheckAudioT >= WINDOW_MAX_AGE_MS`，engine 需暴露唯讀存取器當單一真相；**取不到音訊時鐘時 fail-safe 成「仍在冷卻」**（寧可多擋自動勾稽，也不要讓報告者的 uncheck 被推翻，與 §7.1「誤劃比漏劃傷害大」同向）。
- **決策 2（記債不修）——SQLite `tx()` 無互斥鎖，023 讓它變成可觸發路徑（信心 85 存在／45 實務）**：`packages/crm/src/sqlite-db.ts:49-59` 在單一共享 better-sqlite3 連線上直接 `BEGIN IMMEDIATE`、無排隊。023 新增的**背景 fire-and-forget 生成**讓「兩場會議幾乎同時建立」變成可觸發：第二筆 `replaceAll`（本身是一個 tx）炸 `cannot start a transaction within a transaction`，被 catch 吞掉 → 該場清單靜默 `failed`（已實測重現：checklist 落庫 0 筆但 usage_event 已記帳）。同源問題也讓高併發 `checklistAction` 靜默無效（HUD 刻意無樂觀更新 → checkbox 不動、無錯誤回饋）。
  - **不修的理由**：**生產不受影響**——`DB_DRIVER=pg` 走 `pg-db.ts:139-160`，每個 tx 從 pool 取獨立 client＋AsyncLocalStorage，無此問題；生產是 Cloud SQL Postgres。且這是**既有基礎設施債**，修 `tx()` 的序列化原語會影響**每一條** DB 路徑，**必須另開一輪帶自己的驗證**（同 MAX_TOKENS 記帳那條的理由）。**但要記牢：023 是讓它從「理論問題」變成「本機 dev 可觸發」的那個改動。**
- **決策 3（記債不修）——MAX_TOKENS 分支已消耗的 token 不記帳（信心 70）**：`meter-impl.ts:29` 的 `await withSuppressedMetering(fn)` 拋錯即不 `record`，是 meter 的**系統性行為**（所有路徑皆然）。本輪是**第一次寫出刻意期待並處理該拋錯分支的程式**（`checklist-gen.ts` 的 MAX_TOKENS 砍半重試），所以少計從偶發變成設計內建：第一次真的燒了 12k 輸入＋4096 輸出才被打掉，那筆零紀錄，只有砍半後的第二次進帳。→ 改 meter 語意影響每條計費路徑，另開一輪。
- **決策 4（記債不修）——`POST //api/meetings`（雙斜線）回 Express 預設 HTML 404 而非契約的 `{error}` JSON（信心 95／值得修 10）**：既有行為，**不是限流繞過**（沒有任何 handler 被執行、不觸發建會或 LLM）。純一致性瑕疵。
- **方法論延續**：這是本輪第三次「我的裁決/設計被下一輪的對抗驗證推翻」（依序：evidence purge 白名單條件 → 現在的時鐘域）。**兩路驗證（回歸＋對抗）已證明是本專案該常設的預設**，而且對抗路一定要明確被指示「預設立場＝有漏、主動攻擊」。已入 L19／L21。
- **影響**: `apps/server/src/analysis/gemini-analysis.ts`（暴露音訊時鐘存取器）、`session-runtime.ts`（冷卻改音訊時鐘）、`checklist.test.ts`（冷卻測試改用音訊時鐘推進＋新增撤回同意情境＋突變驗證）、`docs/MEETING_CHECKLIST_CONTRACT.md` §7.5 v1.2。同輪併跑 `/simplify` 四鏡頭清理。

### 2026-07-30 12:35 | 對抗復驗抓到「我自己的修法有洞」＋記帳漏包——兩條都修
- **誰決定**: Fable（採納對抗式復驗 agent 的兩個發現，裁決兩條都修）
- **脈絡**: 21:20 那輪我升級修了 evidence 的 retention 缺口。修完照硬規則 5 派兩路 fresh-context 驗證——回歸路 pass，**對抗路 fail**，抓到兩個新問題。**我自己拍板的修法被證明有繞過路徑**，這是本輪最有價值的一次驗證。
- **決策 1（修）——evidence purge 的 `WHERE covered_by='transcript'` 可被繞過（信心 85）**：
  - **攻擊時序**（復驗 agent 用 in-memory DB 實跑證實，probe 輸出 `!!! TRANSCRIPT TEXT SURVIVED TTL !!!`）：對話自動勾稽先 `markCovered(...,'transcript',<逐字片段>)` 寫入 evidence ＋ `covered_by='transcript'` → 但 snapshot 廣播有 **300ms debounce**（`CHECKLIST_BROADCAST_DEBOUNCE_MS`）＋網路 RTT，**這段時間 HUD 上該項仍顯示 pending** → 報告者（正是最可能此刻動手的人）點 checkbox → `ChecklistPanel.tsx:181` 因 `isCovered=false` 送 `action:'check'` → `repos-checklist.ts:200-205` 的 `setStatus('covered','manual')` **改了 `covered_by` 但完全不動 `evidence`** → 該列從此永不符 purge 的 WHERE → **逐字稿永久留存、繞過 TTL**。
  - **最嚴重的部分**：21:20 那輪**新增的測試 `transcript-retention.test.ts:81` 正好斷言「manual 的 evidence 不會被清成 NULL」——把這個洞寫成了回歸鎖定**。該斷言的前提（manual 的 evidence 恆為 NULL）是錯的。**測試不只沒抓到洞，還在保護洞。**
  - **修法（縱深兩處）**：(a) purge 條件由「只取 `'transcript'`」改為「**排除 `'slide'`**」（`(covered_by IS NULL OR covered_by <> 'slide')`，**刻意不用 `IS DISTINCT FROM`**——舊版 SQLite 不支援）——因為 `'slide'` 的 evidence 是「第 N 頁」＝唯一該排除的非逐字內容，而 `'manual'` **可能**帶著殘留的 transcript 片段；(b) **源頭堵住**：`setStatus` 轉 `'covered'` 且 `covered_by` 實際變化時**一併清 evidence**（來源換人了，舊來源的證據不該留，而它是逐字位元組）。並**改掉那條錯誤斷言**＋新增一條重現攻擊時序的測試。
- **決策 2（修）——`draft-objective` 的 LLM 呼叫只靠安全網記帳、未顯式記帳（信心 75）**：`hub.ts:126-127` 的 `checklistGenDeps()` 回傳**未包 meter 的 raw `this.gemini`**，而 `POST /api/meetings/draft-objective` 就用它。**同檔的清單生成路徑（`hub.ts:451-458`）有正確包 `meteredGeminiClient`**，證明這是漏包不是取捨。→ 沿用既有正確用法補上（含 orgId 歸屬、`kind='gemini_text'`、idemPrefix 用 per-call uuid 避免撞冪等鍵少計——專案 LESSONS 有過冪等 key 復用少計的教訓）。
  - **⚠️ 事實更正（2026-07-30 12:55，由記帳復驗 agent 指出，信心 88）**：本則原先寫「這條路徑的 token **完全不進** `usage_events`／costUsd 少計／無法歸屬 org」——**這是錯的，不要據此回填或對帳歷史 usage_events**。實際上 019 的安全網早就接住了：`index.ts:202` 把 `/api/meetings` 掛在 `meterBoundary` 下 → `ops/metering-middleware.ts:20-23` 以 `runWithMetering({orgId, userId, kind:"gemini_text", idemPrefix:"req:<uuid>"})` 包住整個 handler；修正前 `draftMeetingObjective` 呼叫的是 raw 公開 `generateJson`，而 `gemini.ts:400-410` 在該方法內**無條件** `safetyNetRecord(...)` → `metering-context.ts:75-104` 補記一筆 `kind='gemini_text'`、**orgId／userId 皆正確**、idemKey `req:<uuid>:sn:0` 唯一。既有測試 `ops/metering-safety-net.test.ts:51-58` 正是鎖這條。
  - **真正的缺口只是「靠安全網 fallback 而非顯式記帳」**——修正本身仍有價值（explicit 優於安全網、多一層 kind/attribution 保證、且新測試鎖住行為），但**嚴重性被我高估、成因被我寫錯**。CHANGE_TRACKER 同輪那筆的理由 B 亦同步更正。
  - **教訓**：我當時採信了 review agent 對「未包 meter」的正確觀察，卻**自己外推出「所以完全沒記帳」這個未經查證的結論**——安全網的存在正是為了兜住這種漏包。**制度紀錄裡的因果敘述要與「觀察到的事實」分開**：agent 看到的是「raw client」（真），我寫下的是「零記帳」（假）。已補進 L21。
- **方法論教訓（重要，值得入 LESSONS）**：
  1. **「修 bug 時新寫的測試」本身也需要被對抗驗證**——它可能把錯誤前提固化成回歸鎖定，反而讓後續的人更難發現洞。本輪 `:81` 就是活例：測試全綠、回歸路 agent 也 pass，只有**被指示「假設修正是有漏的、主動去找漏洞」的對抗路**抓到。
  2. **「白名單式」清理條件（只清 X）比「黑名單式」（排除 Y）脆弱**——只要有任何路徑能把狀態改成 X 以外的值，資料就漏出清理範圍。隱私/保留這種「必須清乾淨」的場景應該用**排除法**（預設清、只排除明確安全的），而非**列舉法**。
  3. **驗證要分兩路、且對抗路要明確被指示「預設立場＝修正有漏」**——回歸路（確認改了、測試綠）與對抗路（假設有漏、主動攻擊）抓到的東西完全不同。單跑回歸路會漏掉這兩條。
- **影響**: `apps/server/src/realtime/transcript-retention.ts`＋其測試（改錯誤斷言＋新增攻擊時序測試）、`packages/crm/src/repos-checklist.ts`（setStatus 清 evidence）＋crm 測試、`apps/server/src/realtime/hub.ts`（`checklistGenDeps` 包 meter）、`meetings-routes.ts` 呼叫端傳 orgId。修完再派兩路 fresh-context 復驗（隱私 probe 實測 ＋ 記帳逐跳追＋全 LLM 呼叫點計費標記表）。

### 2026-07-30 11:55 | /code-review 裁決：修 2 條（含 1 條門檻下升級）、記債 3 條
- **誰決定**: Fable（依五鏡頭對抗式審查＋逐 finding 反駁驗證的結果裁決）
- **⏱️ 時間戳校正註**: 本 session 自 **2026-07-28 16:54** 開工（契約凍結那則的時間戳為實讀），但因多輪 workflow 各耗 30 分鐘級、中途又撞到週用量上限需等待，**實際跨到 2026-07-30**。我先前把 07-28 之後幾則的時間戳「推算」成同日晚間（19:40／21:20／22:35／23:50）＝**未實讀、是錯的**，已依 workflow 的 epoch 時間戳校正為 07-30（審查 workflow 實跑 11:35–11:51）。教訓同 L21：**制度紀錄的時間戳要實讀，不要靠推算**——它是日後重建「何時決定」的依據。
- **審查規模**: 13 agents（5 鏡頭 review → 8 個 ≥70 finding 各派 1 個對抗式反駁者），**raw 8 → confirmed 1／killed 7**。
- **決策 1（修）——`checklist-gen.ts:202` slideIdx 座標系 bug**：
  - **五個鏡頭有四個獨立抓到同一條**（bugs 88→驗證 80、consistency 76、invariants 73、errors 70；**四個 verifier 全部 `refuted:false`**）。這種交叉印證的可信度高於單一高分。
  - 根因：`buildDeckOutline` 跳過無文字頁但**保留原始頁碼**（`deck-outline.test.ts:99` 自證 5 頁 deck → idx `[0,1,3,4]`、length=4），而 sanitize 用 `length` 當上限比 `rawIdx`——**兩個座標系**。模型被 prompt 明令「填該頁的 #編號」（＝原始頁碼），所以合法的 `slideIdx:4` 被 `4<4` 判 false → 靜默 NULL → 翻頁勾稽與「正在講」高亮永久失效、**零錯誤訊號**。
  - 觸發路徑是正式功能（非邊角）：studio「整頁圖」生成的頁 `alt:""` → `extractSlideText` 回空 → 該頁被跳過；重用「匯入原始頁＋前次 AI 補充頁」的 deck 時**全部** slideIdx 失效。
  - 修法採 verifier 的 correctedFix：**用大綱實際存在的 idx 集合（Set）當權威**，而非列數。附帶收益＝同時擋掉反向漏洞（現行版本反而**放行**被跳過的空頁頁碼，會把 talk 項綁到純圖頁埋誤劃地雷）。並補測試（`sanitizeChecklist` 原本**全 repo 零測試**）。
- **決策 2（門檻下升級修）——`hub.ts:405` evidence 的 retention 缺口，58 分**：
  - `evidence` 在 `covered_by='transcript'` 時存的是**逐字稿位元組前綴**（與寫進 `meeting_transcript_segments` 的同一個字串值），但 `transcript-retention.ts:32-39` 的 TTL purge **只刪 transcript 表、不涵蓋新表** → 與 `M5_CONTRACT.md:13`「purge 超過 retention_days 的已持久逐字稿」不一致。
  - **為何升級**：verifier 逐條反駁六個角度全部失敗，只找到兩個折扣——(a) 已被 `persistTranscript` 閘住（ephemeral 場次恆 NULL＝**今日無隱私回歸**）、(b) `persistTranscript` 目前**無 UI 也無文件化 API** 能開啟。但這正是危險所在：**留著就等於「哪天開放這個 opt-in 時靜默違反保留政策」**，而修法只是一條 SQL。現在關掉比記債好。
  - 修法界線（刻意不過度）：**只清 `evidence` 欄不刪 checklist 列**（項目是會議產物不是逐字稿，刪掉會破壞會後檢視）；**只清 `covered_by='transcript'`**（`'slide'` 是「第 N 頁」、`'manual'` 是 undefined，都非逐字位元組）；**過期判定逐字沿用既有 purge 的同一 predicate**（不另發明，否則兩表保留期會分歧）。
- **決策 3（修）——ChecklistPanel 進度分母排除 skipped**：`skipped`＝報告者主動判定「這場不講」，不該留在待完成分母。改「已講 4/9」而非 4/12；分母為 0（全 skipped）要防 NaN／除零。（此條是我在包 C 回報時就已列的待修，非審查發現。）
- **決策 4（記債不修）——第 0 頁永不 `page_commit`（30 分）**：機制描述為真（`PresentStage` 的 `committed=useRef(-1)` 單調閘 ＋ `useState(0)`，第 0 頁從不上報），但 (a) 這是**契約 §7.2 明文規定的行為**，`hub.ts:502-516` 是逐字落地；(b) verifier 證明**建議的修法會把情況弄壞**——在 `ensureRuntime` seed `lastCommitAt` 等於量「距第一條 socket 多久」而非「第 0 頁停留多久」，而 `attach()` 對任何 role 都會 ensureRuntime、帳號 B 常比報告者早連好幾分鐘 → 第一次真翻頁時綁 slide 0 的項目幾乎**無條件被自動劃掉**，正好反轉契約「**誤劃比漏劃傷害大**」的取向；(c) 第 0 頁是「預設就顯示」、報告者未做任何導覽動作，其停留時間本質上弱於「刻意翻到第 N 頁」。**現行 no-op 是可辯護的取捨**。→ 保持現狀。**附帶記錄一筆待日後處理**：server 在第 0 頁期間認為 `committedIndex=-1`，代表第 0 頁**正在被投影時仍被 `patch-service.ts:93` 視為 pending、可被 REORDER/updateSlide 動到**（I1 鄰接面，既有行為，非本輪引入）。
- **決策 5（記債不修）——`deck_id` 落庫但 `ensureRuntime` 不 rehydrate（25 分）**：verifier 用 `git show HEAD:` 逐行證明該區段**位元組相同、本輪零改動**，且 finding 的 authz 主張**事實錯誤**（`runtime.presenterUserId` 全部讀取點都只是計費歸屬，I2 權威是 `ws-server.ts:103` 的 token 純身分檢查，patch-service 的 `presenterAuth` 是 gate 後傳入的字面 `true`，從不讀 runtime）。「落庫沒人讀」也不成立（`meeting-store.ts:107-110`／`:213-214` 已 SELECT 並映射，經 GET 端點外流）。**殘留真相**＝Cloud Run revision 重啟或 grace 回收後，自動重連的 client 拿到 `deckId===undefined` → `committed_index` 停止持久化、重啟後的建議被 discard（`patch-service.ts:79-81` 的刻意 fail-safe）。**既有債，記 backlog。**
- **決策 6（記債不修）——`checklist-gen.ts:184` maxOutputTokens 4096 未關 thinking（25 分）**：**finding 引用的證據反向**——它拿 `deep-extractor.ts:755-758` 當「thinking 吃預算」的教訓，但該註解與 `WORKLOG.md:146` 逐字寫的是**相反結論**（usageMetadata 實測 `thoughtsTokenCount=undefined`，**thinking 非元兇**，真因是模型對 `titleZh` 退化重複循環）。另有五個同模型、**全部不帶 thinkingBudget**、上限**低於** 4096 的已上線路徑反證（`gemini-analysis.ts:24` 1024 會中即時分析／`scoring.ts:155` 2048／`persona-gen.ts:91` 1024／`slide-gen.ts:556` 2048／`slide-gen.ts:444` 4096 且輸入是整份 12,000 字 outline）。另兩條腿（砍輸入、無重生成）皆為**契約 §6.2/§6.3 逐字要求**。→ 誤報，不動。
- **方法論收穫（值得記）**：**「同一 bug 被多個獨立鏡頭抓到」比「單一鏡頭給高分」更值得信**——本輪四鏡頭交叉命中的那條，四個 verifier 給了 80/76/73/70 四個不同分數，只有一個過 80 門檻；若機械地只看 confirmed 清單，會誤以為「只有 1 個鏡頭發現、勉強過關」。**裁決時要看 killed 清單裡的 `refuted:false`**（＝驗證過是真問題、只是影響半徑被評為邊際），那裡藏著真東西（本輪的 retention 缺口就是從 killed 撈上來的）。
- **影響**: `apps/server/src/generation/checklist-gen.ts`＋新測試、`apps/server/src/realtime/transcript-retention.ts`（＋可能 `packages/crm/src/repos-checklist.ts`／`ports.ts`）、`apps/web/components/hud/ChecklistPanel.tsx`＋messages 雙語。修完派兩路 fresh-context 驗證（回歸 ＋ 對抗式復驗）。

### 2026-07-30 10:45 | 「會中進行」兩入口改造：改名＋同分頁導覽＋準備頁（解死路）
- **誰決定**: 使用者（三點指示＋附側欄截圖）＋Fable（依偵察出的 7 個卡點設計改造範圍）
- **決策**:
  1. **改名**：`nav.present`「簡報舞台」→**「會議簡報」**、`nav.copilot`「會中副駕 · HUD」→**「MeetCopilot」**。**順帶統一同一功能的三種叫法**（偵察卡點 7）：`present.title`／`copilot.title`／`CopilotView.tsx:184` 的硬編碼中文「會中副駕 · 擷取端」全部對齊，且該硬編碼改走 i18n。
  2. **兩個入口都不再另開分頁**：`AppShell.tsx:128-129` 的 `external: true` 移除（連帶 `target="_blank"`／`rel`／↗ 圖示／`nav.newTab` hover 提示消失，且 `isActive()` 的 `if (external) return false` 自然讓兩項恢復 active 高亮）。`HomeDashboard.tsx:26-29`／`:96-97`／`:105-109` 的同款清單同步。
  3. **僅 MeetCopilot 需要新分頁、且延後開**：進 `/copilot` 是同分頁 cockpit；新分頁只在使用者**主動**按「在另一台裝置／另一個分頁看 HUD」時才開（＝現有第二裝置摺疊區，`CockpitView.tsx:66-111`）。
  4. **「會議簡報」不再直接指向死路**：側欄改指**新的 app 內準備頁**（掛 AppShell，可選 deck、看預覽、選單機播放／連線會議播放）→ 按「開始播放」才進乾淨舞台。**舞台一律同分頁 ＋ Fullscreen API**（使用者明示會議簡報完全不開新分頁）。
  5. **`/copilot` 掛 AppShell、`/present` 絕不掛**：cockpit 在帳號 B、永不被分享 → 掛側欄安全且解決「被關在外面」；present 會被分享進 Meet → 維持零 chrome。**同分頁導覽本身就提供了離開路徑（瀏覽器上一頁）**，這是不開新分頁的附帶好處。
  6. **假 QR 誠實化**（卡點 6）：`CockpitView.tsx:77-87` 的裝飾性假 QR（註解自己寫明 "intentionally NOT a scannable code"）**移除**，文案 `secondDeviceDesc`「用手機或平板掃描 QR」改為複製連結的真實敘述。**真 QR encoder 記債**（不為此加外部依賴）。
  7. **present 補基本可用性**（卡點 3/4）：加滑鼠／觸控翻頁區、首次進入的鍵盤提示（可淡出）、Fullscreen 進出、死路頁的按鈕由 `/`（首頁）改指**準備頁**（原文案叫人「從 App 開啟一份簡報」卻只給回首頁）。
- **脈絡與理由**: 使用者看截圖說「點進去的 UI 互動太不直覺」。偵察證實這不是主觀感受而是**硬缺陷**：側欄「簡報舞台」href 是裸 `/present` 不帶 `deckId`（`AppShell.tsx:128`），`PresentStage.tsx:62-66`→`:350-365` 必定落在「沒有可播放的簡報」終態——**這個入口 100% 是死路**，而且還先開一個新分頁才讓人撞牆。加上 present 全庫 0 個 fullscreen 呼叫、0 個滑鼠可操作元素、`/copilot` 新分頁內 0 個回 App 連結，「不直覺」有具體來源。
- **考慮過的替代**:
  - 側欄「會議簡報」直接指 `/studio`（否——studio 是**編輯器**語意，且使用者要的是「播放」入口）。
  - 讓 `/present` 自己長出 deck 選擇器（否——會往乾淨舞台裡塞 app chrome，逼近 I3 邊界，且該檔 import 白名單本就禁擴充）。
  - present 舞台改「按下開始才另開新分頁」（否——使用者明示只有 MeetCopilot 需要新分頁）。
  - 自己實作 QR encoder（否——本輪不加依賴也不寫 200 行編碼器，先誠實改文案，記債）。
- **不變量檢查**: **I3 是本輪主要風險面** —— `/present` **維持不掛 AppShell**、`PresentStage.tsx:6-10` 的 import 白名單**不得擴充任何 HUD 詞彙**（Fullscreen／翻頁區只用瀏覽器 API 與既有 SlideRenderer）；`/copilot` 掛 AppShell 屬安全（帳號 B 永不被分享）。I1/I2 不觸及。
- **影響**: `AppShell.tsx`、`HomeDashboard.tsx`、新準備頁、`PresentStage.tsx`、`CockpitView.tsx`、`CopilotView.tsx`、`app/[locale]/copilot/page.tsx`、messages 雙語、globals.css。與同輪的 checklist 三包（A/B/C）同批未 commit。

### 2026-07-28 16:54 | 新產品線：會中「待講清單」（Meeting Checklist）——四項岔路全拍板＋契約凍結
- **誰決定**: 使用者（提出需求＋4 個 AskUserQuestion 全選推薦項）＋Fable（偵察後的接點設計、分期裁決、契約凍結）
- **決策**:
  1. **需求原話**：「除了提供對方公司或我方公司的內容⋯也應該像做 checklist 那樣讓報告者知道哪些已經講了哪些還沒。checklist 比較像是 AI 自行根據會議內容與 PPT 生成的，要先判斷哪些內容需要講會有利於會議目標的達成，然後生成 checklist，然後隨著會議內容與簡報內容逐一把 checklist 劃掉。」
  2. **清單範圍＝三類全包**（使用者選）：`talk` 必講重點（來自簡報）＋`ask` 必問問題（來自 CRM 缺口：預算/決策時程/決策鏈）＋`address` 必回應顧慮（來自 CRM 已知異議與競品）。**清單不是簡報大綱的複製，而是「達成本場目標所需的完整溝通清單」**，簡報裡沒有的也會列。
  3. **匯入 pptx/pdf 的文字＝解析器＋Gemini 讀圖 fallback**（使用者選最完整那項）：現況匯入流程只把每頁轉點陣圖（`conversion-job.ts:40-50`），`extractSlideText` 對它回空字串→匯入 deck 對 AI 等於全白。作法＝重新啟用 repo 內已存在但無人呼叫的 `pptx-parser`/`pdf-parser`（`parse-worker.ts:24,28`）抽純文字存 `deck_slides.text_extract`；抽不到字（純圖/掃描頁）再用 Gemini 多模態讀該頁 PNG 補。**畫面渲染完全不動**（仍是原本點陣圖），零視覺回歸風險。
  4. **會議目標＝AI 先擬、使用者可改**（使用者選）：選好簡報＋對方公司後，前端打 `POST /api/meetings/draft-objective` 取一句話填進欄位；可改、可留空（留空則以 AI 擬的為準）。維持「選對象→按開始」的低門檻（守 [[keep-operations-simple-low-barrier]]）。
  5. **劃掉方式＝AI 自動劃＋可手動改**（使用者選）：三路訊號——(a) **對話**：**併進既有每 5 秒的分析呼叫**（`gemini-analysis.ts:20-24`）擴 schema 出 `coveredItemIds`，**零額外 LLM 呼叫、零額外延遲**；(b) **簡報進度**：翻頁當弱訊號，`slideIdx` 對上當前頁＝HUD 高亮「正在講」，翻過去且該頁停留 ≥20 秒才自動判 covered；(c) **手動**：HUD 點擊 toggle，presenter-only gate（同 `suggestion_action`）。報告者永遠是最終權威。
  - **Fable 分期裁決**：**C1＝核心閉環**（migration 023＋shared 型別＋生成＋三路勾稽＋wire＋HUD panel＋建會表單），**C2＝匯入 deck 餵料**（parser 重啟＋讀圖 fallback）。migration 023 一次把 C2 要用的 `deck_slides.text_extract` 欄也加好，C2 只改程式不再動 schema。
  - **Fable 順修既有債**：`meetings` 表原本**無 `deck_id` 無目標欄**，deck 綁定只活在記憶體 binding（`hub.ts:59`，`disposeSession` 就刪）→ 重啟即失聯。本輪 migration 023 補 `meetings.deck_id`＋`objective` 落庫（不用既有 `agenda` 欄——語意是「議程」非「目標」，且從未被寫入，混用會製造歧義）。
  - **Fable 順修既有債 2**：主入口 cockpit 建會**只填一個標題**（`CopilotView.tsx:408`，無 companyId/deckId）→ 補「選簡報／選對方公司／會議目標」三欄，否則 checklist 無料可生。
- **脈絡與理由**: 會中副駕現有三種輸出（訊號 chip、CRM 補充卡、補充頁建議）**全是被動反應式**——對方講到什麼才給什麼。checklist 是第一個**主動目標導向**的輸出：會前就算清楚「要達成目標必須做到哪些事」，會中盯著完成度。與既有管線高度互補且共用同一套骨架（分析引擎、WS、HUD），不需新基礎設施。
- **考慮過的替代**:
  - 勾稽用**獨立 LLM 呼叫**（否——成本翻倍、延遲多一跳；併進既有分析呼叫只多 ~400 tokens prompt，且分析引擎已是 per-session instance 可持有清單狀態）。
  - 只靠翻頁劃掉、零 LLM（否——使用者未選；且「翻到≠講到」，`ask`/`address` 類沒有對應頁永遠劃不掉）。
  - 清單塞 `meetings` 的 JSON 欄而非獨立表（否——要逐項更新狀態、會後要出「本場未涵蓋」報告，獨立表較正）。
  - 借用 `SlideSpec.analysis`（型別已存在但全 repo 無寫入者）掛在頁上（否——`updateSlide` 對 `idx <= committedIndex` 或 `kind='original'` 一律 409，會中回寫已播頁會被 I1 擋）。
  - checklist 也推給 present（**絕對否，I3**：清單含會議目標與話術，外流給客戶是災難）→ 一律 hud-only broadcast。
- **不變量檢查**: **I1 不觸及**（不走 deck patch；`text_extract` 是匯入期寫入、只碰新欄不碰 `spec_json`，且明文禁止在會中路徑呼叫）；**I2 沿用**（`checklist_action` 走 presenter-only 身分閘）；**I3 強化面**（新 wire 訊息 hud-only，`PresentStage` 禁 import 任何 checklist 模組）。
- **影響**: migration 023 雙份（SQLite＋PG）；`packages/shared/src/checklist.ts`＋`protocol.ts`；`packages/crm`（ports/repos-checklist/core）；server（`generation/checklist-gen.ts`、`analysis/*`、`realtime/{hub,orchestrator,ws-server,meetings-routes,meeting-store,session-runtime}`、`import/conversion-job.ts`）；web（`hud/ChecklistPanel.tsx`、`HudView.tsx`、`CopilotView.tsx` 建會表單、messages 雙語）；`docs/MEETING_CHECKLIST_CONTRACT.md`（本輪凍結）＋`docs/API_CONTRACT.md` §6 同步。未 commit／未部署（硬規則 10）。

### 2026-07-25 20:13 | 移除「帳號密碼登入」、純用 Google 登入（範圍 web+admin；深度先只拔前端 UI，後端 endpoint 暫留）
- **誰決定**: 使用者（原話「把這個帳號密碼的部分先移除，純用 google 登入」；範圍與深度經 2 個 AskUserQuestion＋mid-turn 補充拍板）
- **決策**:
  1. **範圍＝web＋admin 兩處登入都移除帳密 UI**（使用者選「web + admin 後台都移除」）。
  2. **深度＝這次只拔前端 UI**（使用者答「只隱藏前端 UI，後端先留著」＋mid-turn「先把前端的帳密登入移除即可」覆蓋確認）——後端 `POST /api/auth/login`、`/register` handler **保留不動**（[apps/server/src/auth/routes.ts](../apps/server/src/auth/routes.ts)），DB `users.password_hash` 欄與 provision 的 `unusablePasswordHash` 也不動。
  3. **前端改動**：`AuthForm.tsx`（web）與 admin `login/page.tsx` 移除 Email/密碼/顯示名稱/組織名欄位、送出鈕、「用密碼登入」toggle、登入⇄註冊切換連結及相關 state/handler/import（不刪 lib/api.ts 的 apiLogin/apiRegister 函式定義，僅停止呼叫）；只留 GoogleSignInButton＋標題＋錯誤區。
  4. **防呆**：`googleOn=false`（未設 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`）時改顯示「Google 登入尚未設定」提示，不再退回帳密、也不留空白頁。
- **脈絡與理由**: 產品既有設計已把 Google 當主路徑、密碼藏在 toggle 後（AuthForm `showPassword` 初值 `!googleOn`）。使用者要更進一步：前端純 Google。DB 不需 migration，因 Google 流程 `provisionUser` 只靠 email find-or-create、`password_hash NOT NULL` 由 `unusablePasswordHash` 填。
- **考慮過的替代**: (a) 深度＝連後端 endpoint 一併拔（使用者否，選「先只拔前端」——保留可還原、避免一併改大量用到 /login /register 的測試）；(b) 範圍＝只動 web（使用者否，選 web+admin 一起）；(c) Google 未設時維持帳密 fallback（否——與「純 Google」矛盾，改顯示提示）。
- **風險（已向使用者揭示）**: 拔帳密後每個環境（含本機開發）都必須設好 `GOOGLE_CLIENT_ID`＋`NEXT_PUBLIC_GOOGLE_CLIENT_ID`，否則無法登入；用「非 Google email」註冊過的舊帳號會被鎖在外（後端 endpoint 仍在，屬暫留可救）。
- **影響**: apps/web `components/auth/AuthForm.tsx`＋(auth)/login、register 頁；apps/admin `src/app/login/page.tsx`；CHANGE_TRACKER 待 coder 回報後補 1 筆。未 commit／未部署（硬規則 10，待核准）。

### 2026-07-25 19:32 | 語速做法：前端播放倍速拉桿（無段即時）——推翻 prompt 三段
- **誰決定**: 使用者（AskUserQuestion 拍板）
- **決策**: 對練語速要**無段拉桿、可對練中即時拖**。先前已做的 prompt 三段（慢/正常/快，靠 persona prompt pace 指示）不符「無段」→**整組退掉**，改**前端播放倍速**（`AudioBufferSourceNode.playbackRate`，0.5–2.0× 連續、拉桿即時生效）。拉桿放對練中畫面（TrainCall），純前端、不需 server/token。
- **脈絡與理由**: 我先說明直播語音的技術限制（AI 語音即時串流生成、不像錄音檔可自由精準倍速：>1× 會 underrun、<1× 延遲累積、前端改速會變聲），給 3 選（prompt 無段但近似｜前端播放倍速精確但有取捨｜維持三段）。使用者選**前端播放倍速**，明確接受變聲與直播微瑕，換取真·無段＋即時可拖。
- **考慮過的替代**: prompt 無段（送 AI「大概速度」，近似非精確、不能即時；被否）；pitch-preserving time-stretch（否——重、加延遲，違背低延遲）；維持三段（否——非無段）。
- **影響**: apps/web liveClient（setPlaybackRate＋playPcm rate＋nextPlayTime/rate）＋TrainCall（拉桿）＋globals.css；退掉 shared TrainSpeed／server persona-pace／web launch chips（未上線故無痕）；CHANGE_TRACKER 1 筆。未 commit／未部署（待核准）。

### 2026-07-25 15:16 | 對練語言可設定＋評分報告跟 i18n＋全中文兼容英文專有名詞
- **誰決定**: 使用者（2 個 AskUserQuestion＋mid-turn 補充覆蓋）
- **決策**:
  1. **對練語言可設定**：加「中文／English／自動跟隨」（`TrainLang` zh/en/auto），**預設中文**（全繁中）；auto＝原 mirror 行為（跟對方語言）。→ AI 講話語言由此決定（鎖進 token）。
  2. **評分報告語言＝跟 app i18n locale**（mid-turn 覆蓋前面「一律中文」的答案）：報告文字跟 next-intl 語系（zh-TW→繁中、en→英文），web finish 時帶當前 locale 給評分器；**評分維度 label 仍用中文（UI 顯示），只切 comments/summary 語言**。
  3. **全中文兼容英文專有名詞**：AI 回覆與評分報告在中文時，產品名/技術詞/縮寫/公司名等**保留原文（常為英文）、不硬翻**——加進 persona zh/auto 規則行與 scoring SYSTEM。
  - 實作取捨：對練語言預設由舊「繁中＋mirror」改為「全繁中」（mirror 移到 auto 選項）＝使用者明示預設中文；報告 locale 走 finish 參數（body/query locale/lang→zh/en）不需新 migration/型別；語言選擇 UI 精簡 3-chip、同難度列 compact（守 [[keep-operations-simple-low-barrier]]）。
- **脈絡與理由**: 使用者問「可以設定全中文或全英文對練嗎」＋「報告語言跟 i18n，全中文可能遇到專有名詞是英文要兼容」。屬 A3 情境模式的延伸，併同一批部署。
- **考慮過的替代**: 報告一律中文（初答，被 mid-turn「跟 i18n」覆蓋）；對練語言預設自動跟隨（否——使用者選預設中文）；不加語言設定（否）。
- **影響**: shared/train.ts（TrainLang）、server persona/scoring/train-service/routes、web api/PersonaPicker/TrainWorkbench/globals.css；CHANGE_TRACKER 1 筆。未 commit／未部署（併 A3 待核准）。

### 2026-07-25 14:51 | 對練一般化為「情境模式」（sales/合作/政府/面試）＋可變維度評分＋全項目「簡單低門檻」原則
- **誰決定**: 使用者（指定情境類型＋2 個 AskUserQuestion 拍板＋立全項目 UX 原則）＋Fable（登錄表抽象、契約凍結、審查後裁決）
- **決策**:
  1. **對練從「銷售」一般化為可切換情境模式**：首批 4 個——銷售對練（現有）／尋求合作簡報（AI＝對方公司高階，你爭取合作）／政府簡報（AI＝政府審查/承辦，你報告過審）／面試（AI＝面試官，你＝求職者）。使用者原話：「也不太像面試那種樣態，也要有像是報告給對方公司的人聽尋求合作、報告給政府人員聽等等模式」。做成**資料驅動登錄表 `TRAIN_MODES`**（framing/stance/coachRole/dimensions 全在一處，加模式＝加一筆，不改邏輯）。
  2. **評分改可變維度 labeled 陣列**（`TrainScoreDimension[]`，各模式維度不同）——非固定四維 object（AskUserQuestion 選「可變維度」勝「4 槽換標籤」）；舊報告由 repo mapReport 相容轉陣列。
  3. **全項目 UX 原則（重要，已入長期記憶 [[keep-operations-simple-low-barrier]]）**：使用者立「相關操作要直接簡單明瞭、不要過於複雜門檻過大——不只模擬，整個項目所有功能皆然」。當輪即套用：對練啟動流程收斂為「選對象→按開始」（模式/難度/目的全預設、進階收合），情境模式改精簡 chips。
  - **Fable 契約/實作取捨**：mode 由 **server 權威**決定評分（finish 用 `session.mode`，非信任 client 於 finish 再帶）；`buildPersonaPrompt`/`scoring` 依 mode 切換、mode='sales' 立場句逐字＝改前（回歸鎖定）、framing 因需支援非買方角色而語義擴充（新 canonical，語義等價或更明確）；scoring 回傳**以模式 dimensions 為權威**（模型缺/亂序/多回不影響）；審查後裁決 objective 用詞中性化（「銷售目標/這位業務」→中性，避免非銷售模式灌 sales 框架）。
- **脈絡與理由**: 對練引擎本質是通用角色扮演，只是原本寫死 sales 框架＋四維。使用者要多場景（B2B 平台的延伸：合作提案、政府關係、招募）。以「Fable 凍契約→Workflow 並行實作＋五視角對抗式審查→修高信心項→簡化收斂」流程完成。
- **考慮過的替代**: 評分維持 4 槽換標籤（否——使用者要可變維度更彈性）；先只做前 3 不做面試（否——4 個一起）；情境模式做成必經多步關卡（否——違反簡單原則，改精簡 chips＋預設＋摺疊）；mode 存 report 而非 session（否——mode 屬 session，評分時讀 session.mode）。**審查濾掉 7 誤報**，確認 1（objective 用詞錯位）已修。
- **影響**: shared/train.ts（TRAIN_MODES 登錄表＋TrainScores 陣列）、migration 022、crm repos-training、server train/*、web train/*＋globals.css；docs/CRM_UPGRADE_PLAN.md（Phase A3 凍結契約節）、CHANGE_TRACKER 1 筆；長期記憶 keep-operations-simple-low-barrier。未 commit／未部署（待核准）。
