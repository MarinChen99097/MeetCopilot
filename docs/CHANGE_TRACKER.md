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

- [`change_archives/archive_2026-08-19.md`](change_archives/archive_2026-08-19.md) — 涵蓋 2026-07-30 ~ 2026-08-19（33 筆、543 行）。主題：C2 匯入抽字全鏈（crm repo→server 解析器＋讀圖 fallback→回填端點＋限流→契約測試→三態負結果標記）；**全站重設計 W1–W4**（token 雙主題＋next/font、slide 模板 17 版式＋pptx 映射、cockpit 三欄 Signal Desk＋I2「建議卡即批准卡」、首頁 KPI／spend／train 接真資料）；prod 事故修復（RECITATION 誤標「安全性限制」、deck 生成 MAX_TOKENS 撞頂→版型 prompt/schema 瘦身 38%→100%）；Studio 編輯器三症狀＋頂列按鈕組；全站換皮接縫掃蕩（孤兒 class／舊色板／死 CSS＋跳過清單裁決 6 項）；**會中副駕收音全鏈（08-19）**——「結束這場會議」接上 UI＋WS close 1000／4003 判 terminal＋meeting-ended 殘留 UI 四修、**雙聲道擷取全鏈**（worklet 雙模式＋麥克風合流交錯 stereo〔L＝報告者／R＝對方〕、`channels` 協商、server deinterleave＋兩路 ASR＋speaker 由聲道決定、分析窗 10→20 段）、麥克風生命週期三缺口（軌洩漏／永久卡住／死軌）、mono 真下混＋resampler overshoot drift、tools 擷取測試頁「測試 D：系統音訊」、Windows vitest 模組重複求值致間歇測試失敗修正；三輪 /simplify 行為不變清理。
- [`change_archives/archive_2026-07-30.md`](change_archives/archive_2026-07-30.md) — 涵蓋 2026-07-19 ~ 2026-07-30（43 筆、597 行）。主題：會中進行收斂＋補充頁 theme；Phase A1/A2/A3 對練升級（自助建對象、情境模式、對練語言）；WYSIWYG C1；Live 3.1 微調＋語速拉桿；登入純 Google＋admin 首次上線；**會中待講清單全鏈**（migration 023＋三包＋三輪 code-review 修正：slideIdx 座標系、evidence TTL 縱深、建會限流、uncheck 音訊時鐘冷卻、記帳歸屬）；「會中進行」兩入口改造（會議簡報/MeetCopilot、/present/start、舞台全螢幕）；/simplify 十項清理。
- [`change_archives/archive_2026-07-19.md`](change_archives/archive_2026-07-19.md) — 涵蓋 2026-07-07 ~ 2026-07-18（55 筆、602 行）。主題：M0 地基→M5 完成→GCP Cloud Run 部署上線；CRM 核心＋研究引擎擴編（爬蟲深廣多輪、社群來源、雙語 *Zh gloss、per-contact 背景抽取 MAX_TOKENS 韌性、deep/more 模式）；DynamicSlide／會中副駕／模擬訓練三產品線；admin 平台後台＋記帳＋停權；UI 換皮＋可收折側欄 Shell＋首頁儀表板；Postgres 移植；多輪 code-review／simplify 修復。2026-07-19（含）起之新紀錄留於本檔。

---

<!-- TRACKER_BELOW -->

### 2026-08-19 15:10 | worklet 三支驗證腳本＋凍結基準搬進 repo（`tools/`）——脫離 session scratchpad，並在 worklet 檔頭指回來

- **工作區**: tools（＋`apps/web` 一行註解）
- **類型**: chore（**零程式邏輯改動**：`pcm-worklet.js` 只加一行檔頭註解，三支腳本只改路徑推導與檔頭說明，斷言邏輯逐字不動）
- **檔案**: `tools/worklet-check.mjs`（新）, `tools/worklet-diff.mjs`（新）, `tools/worklet-diff-mutation.mjs`（新）, `tools/pcm-worklet.baseline.js`（新）, `tools/README.md`, `apps/web/public/pcm-worklet.js`
- **改了什麼**:
  1. **三支腳本從 session scratchpad 搬進 `tools/`**。它們原本只存在於本輪的臨時目錄（session 結束即消失），而 `apps/web` 沒有任何 test runner、`npm test` 跑不到它們——等於全 repo 最危險的檔案的唯一自動化防線是拋棄式的。
  2. **路徑推導改成相對自身**。Before：`const REPO = "c:/Users/Martin/Desktop/MeetCopilot";` ＋ `const HERE = "C:/Users/Martin/AppData/Local/Temp/claude/…/scratchpad";`（兩條寫死的絕對路徑，其中一條指向會消失的目錄）。After：`const HERE = dirname(fileURLToPath(import.meta.url)); // tools/` ＋ `const REPO = join(HERE, "..");`，並補 `node:url`／`node:path` 兩個 import。三支都一樣，仍是零相依原生 node ESM（不需 install、不需先 build）。
  3. **基準檔 `pcm-worklet.BASELINE.js` → `tools/pcm-worklet.baseline.js`，並加檔頭說明來歷**。`worklet-diff.mjs` 需要一份「改動前」的位元副本才能做差分；該副本**不在任何 commit 裡**（是本輪 stereo 實作完成後、`/simplify` 抽 `joinCarry` 之前的 working-tree 中間狀態），而最後一次 commit 到 worklet 的 `e1f7ffd` **早於 stereo**、只會吐 8000 bytes 的 mono frame → `git show <sha>:…` 這條路走不通。檔頭把這件事、以及「git 相對基準是會移動的靶、破掉的改動一 commit 就自動轉綠」的理由寫死在檔案裡，並註明重建基準的規矩。
  4. **`worklet-diff.mjs` 檔頭重寫**：從「為 /simplify item-2 這次重構寫的一次性 harness」改寫成常設的位元級回歸鎖——什麼時候該綠、什麼時候可以刻意轉紅、以及**重建基準必須在 commit message 明講**（默默重建＝把防線拆掉）。斷言邏輯與覆蓋組態一字未改。
  5. **`tools/README.md` 新增最末節「worklet 驗證腳本」**：三支各證什麼、為什麼這支檔案特別危險（L/R 錯開一個 sample＝整場兩人對調，且**不會 throw、frame 大小照樣正確、聽起來還是人聲**，TS 管不到、`npm test` 跑不到）、什麼時候必須跑（動 `pcm-worklet.js` **前後各一次**；動 `audio-capture.ts` 的 node options 或 shared 的 `parseAudioChannels` 也要跑）、確切指令、以及四種結果的判讀表。H1 與開頭導言同步擴為「兩組工具」。
  6. **`apps/web/public/pcm-worklet.js` 檔頭 L/R 對齊不變量那段之後加一行**：`BEFORE AND AFTER touching this file run \`node tools/worklet-check.mjs\` + \`worklet-diff.mjs\` + \`worklet-diff-mutation.mjs\` (see tools/README.md) — an L/R slip fails SILENTLY.` 僅此一行，其餘註解與程式碼未動。
- **為什麼**: 這支 worklet 的失敗模式是**靜默**的，而本輪剛把它從 mono 改成 stereo 交錯——正是最需要防線的時候，防線卻放在會蒸發的暫存目錄裡。搬進 repo 讓下一個工程師（可能不知道 L/R 錯位不會報錯）在檔頭就被導到指令。
- **驗證**: 搬完後三支在 `tools/` 下各實跑一次，結果與 scratchpad 版本相同——`worklet-check` 50 PASS／0 FAIL（`ALL WORKLET CHECKS PASSED`）、`worklet-diff` 240 組態／2708 frames **逐位元組相同**、`worklet-diff-mutation` 四種 L/R 錯位突變全被偵測＋control 綠。加完 worklet 檔頭那行註解後**再跑一次三支，全綠不變**。`npm run typecheck` 五 workspace 全過。

### 2026-08-19 14:55 | /simplify 批 C：web 內部清理六項——失效的安全論述降級／worklet carry 接頭／死 disabled／終態文案單一來源／`endedTitle` 收進 ws／stereo 合流抽函式

- **工作區**: apps/web
- **類型**: refactor（**行為零改變**：渲染輸出、close-code 判定、worklet 位元組輸出、teardown 順序與時機全部維持現狀）
- **檔案**: `apps/web/lib/useRealtime.ts`, `apps/web/lib/ws.ts`, `apps/web/lib/audio-capture.ts`, `apps/web/public/pcm-worklet.js`, `apps/web/components/copilot/CopilotView.tsx`, `apps/web/components/hud/HudView.tsx`, `apps/web/components/present/PresentStage.tsx`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`
- **改了什麼**（六項，上層裁決；**只改前端，`apps/server/`／`packages/` 未觸及**——同一輪另有 agent 在改）:
  1. **十處已失效的安全論述降級成 UX 理由**（優先做、零風險）。本輪先在前端疊了多層防「已結束的會議被復活」（close-code 判 terminal、`retry()` 封鎖、UI 條件渲染、清 creds、`end-failed` phase），**之後** server 才補上握手閘（`apps/server/src/realtime/ws-handshake-gate.ts`，對 completed 會議直接拒絕握手）。前端那些註解仍寫著「重連會讓 server 替 completed meeting 重建 runtime／殭屍會議」——**握手閘上線後這句話是假的**，而「相信前端是安全邊界」正是產出原始 bug 的那個信念。
     - 改法一律：安全論述**只留在 server 的握手閘**，前端改寫成「終態不提供無效動作（按了只會被同一個 close code 再關一次）；**安全性由 server 握手閘保證**」。**前端防護一個都沒刪**——它們現在有獨立的 UX 價值（不給保證失敗的按鈕、不留死畫面、不讓失效 creds 留在 storage）。
     - 位置（grep 確認後實為 10 處，比裁決書點名的 6 處多）：`useRealtime.ts` 的 `canRetry` doc（:83-90）、`fail()` 的終態閘門註解（:139）、`retry()` 的最後一道閘（:217-219）；`ws.ts` 的 `WsCloseKind` `"ended"` 條目（:57）與 `describeWsClose` doc 裡那段歷史敘述（:90，改成明講「當時 server 握手也還沒查 meeting status；今天由 `ws-handshake-gate.ts` 擋死」）；`CopilotView.tsx` 的 `Phase` doc（:20-22）、`confirmEndMeeting` catch（:288-291）、`failureKind` effect（:309-311＋清 creds 那段）、rail failed 面板（:490-491）；`HudView.tsx` banner 的終態說明（:320-321）；`PresentStage.tsx` 的 `linkKind` doc（:70-72）、`onClose` 的「別再抄一份表」（:342-345）、`retryWs`（:374-376）、failed 畫面三種 kind 的說明（:426）。
     - **刻意未動**：`HudView.tsx:203-206` 與 `:311`——那兩處本來就是**正確**的（明講 F5 由握手閘擋、修補前才會繞過），是這一輪之後唯一該長的樣子。
  2. **worklet 的 carry 接頭抽成 `joinCarry(carry, chan)`**（`pcm-worklet.js`，新函式在 `toPcm16` 旁；呼叫點 `process()` 內）。Before：`if (this.carryL.length) { …三行手寫 splice…; if (stereo) { …再手寫一次… } } else { dataL = chanL; dataR = chanR; }`——`carryL.length === carryR.length` 這條**L/R 對齊不變量靠「兩條對稱的程式碼路徑必須同步修改」的慣例維持**，而壞掉的方式是無聲的（單一 sample 滑動＝整場說話者對調）。After 兩條 carry 走同一段邏輯：`const dataL = joinCarry(this.carryL, chanL); const dataR = stereo ? joinCarry(this.carryR, chanR) : null;`。順帶 `const step = this.channels` → `const step = stereo ? 2 : 1`（`stereo` 與 `step` 是同一個位元的兩個名字，只留一個真相；constructor 的 `new Int16Array(frameSamples * this.channels)` 位於 `stereo` 之前，維持原樣）。檔頭的對齊不變量清單補上「ONE shared `joinCarry()` splice」。
     - **刻意不做**（審查已裁決跳過，本輪重申）：不改用複用 buffer（scratch buffer／固定 carry 陣列）。收益 ~137 KB/s，代價是動到全 repo 最不該手滑的地方。
  3. **`endingMeeting` 的兩個 `disabled` 綁定刪除**（`CopilotView.tsx`）：`end-failed` 分支「再試一次結束」的 `disabled={endingMeeting}`、以及危險區「結束這場會議」的 `endingMeeting || `（**保留** `phase === "requesting"`）。兩者**都不可能為 true**：`endingMeeting` 只在 `confirmEndMeeting` 期間為真，而 `setPhase("meeting-ended")` 在**同一個同步區塊、同一批更新**裡——於是危險區那顆鈕落在 `!meetingClosed` 之內根本不渲染，`end-failed` 那顆則是在 `setEndingMeeting(false)` 與 `setPhase("end-failed")` 同批之後才出現。state 只留給 `confirmEndMeeting` 開頭的防重入 guard，並在宣告處寫明「不再綁任何 disabled 及其理由」。
     - **刻意不做**：**不**把 `endingMeeting` 改成 `useRef`。那會讓防重入真的擋得住同一 tick 的重複觸發——**那是行為改變，不屬於 /simplify**（上層已知悉並另行記錄）。
  4. **終態文案收成 `closedText` 單一來源**（`CopilotView.tsx`，宣告在 `meetingClosed` 旁）。Before：rail 的兩個分支各硬編一句（`t("endMeetingDone")`／`t("endMeetingUncertain")`），standalone 面板再用三元式 `phase === "meeting-ended" ? … : …` **重算同一個選擇**。After 三處都用 `closedText`，渲染輸出完全相同。
     - ⚠️ **未合併** rail 的兩個分支本身——它們差在「再試一次結束」那顆鈕，**那是真正的語意差異**（確定已結束 vs 結束狀態不確定）。standalone 借用 rail 命名空間的 class `mc-rail__ended` 也維持原狀（改 class 要動 CSS＝視覺風險，不在本輪範圍）。
  5. **「這場會議已結束」四個 namespace → 收進共用 `ws.endedTitle`**（`messages/*.json`＋三個消費端）。`present.endedTitle` 與 `hud.endedTitle` 是**逐字相同**的字串（zh「這場會議已結束」／en "This meeting has ended"），三個 surface 顯示同一個終態，改一次措辭要動兩個 namespace × 兩個 locale，漏一個就出現「HUD 說已結束、簡報畫面說別的」——而那正是使用者最可能同時看到兩個畫面的時刻（cockpit ＋ 投影機）。
     - `HudView` 兩處（banner、`ConnectingState` 的 title）改 `tw("endedTitle")`；`PresentStage` 加 `const tw = useTranslations("ws")`，`{t(ended ? "endedTitle" : "connFailedTitle")}` → `{ended ? tw("endedTitle") : t("connFailedTitle")}`。
     - **`PresentStage` 的 I3 import 白名單零新增**：`useTranslations` 早就是白名單成員（檔頭寫明「next-intl，僅文案」），這裡只是多開一個 namespace、沒帶進任何副駕符號 → I3 的機械保證維持原狀（已在該檔加註說明）。
     - **刻意未收斂**（值不同，合併＝改畫面文字，那是文案決策不是 simplify）：`copilot.endMeetingDone`＝「這場會議已結束**。**」（多一個句號，且身兼成功 toast 的訊息）、`ws.close.ended`＝「這場會議已結束**，即時連線已關閉。**」、`hud.connTerminalHint` 與 `copilot.connTerminalHint`（後者＝前者＋「請回首頁重新開始一場會議。」，且 zh 無分隔、en 用空白分隔 → 串接法會 locale-dependent）。三組都留在原位並在回報中列出。
  6. **`audio-capture.ts` 的 stereo 合流區塊抽成兩個函式**。Before 是本檔最深的巢狀（try → if → try → catch → for → try/catch，5 層），而且 catch 裡重寫了一份 `stop()` 已經有的 disconnect 迴圈。After：
     - 新增 `disconnectAll(nodes: Array<AudioNode | null>)`（`stopTracks` 的孿生 helper，放在它正下方；**每個節點各自 try/catch** 的性質保留——一個節點 throw 不得中斷整串）；
     - 新增 `tryStereoMerge(ctx, tabSource, micStream, micTracks)`，成功回 `{micSource, merger}`、失敗時**內部**做完 `disconnectAll([micSource, merger])` ＋ `stopTracks(micTracks)` 後回 `null`；
     - 主流程攤平成 `const stereo = micStream ? tryStereoMerge(…) : null; const channels: AudioChannels = stereo ? 2 : 1; const graphHead: AudioNode = stereo?.merger ?? tabSource;`，analyser 那行改 `if (stereo) stereo.micSource.connect(analyser);`，`stop()` 的節點陣列改 `disconnectAll([tabSource, stereo?.micSource ?? null, stereo?.merger ?? null, analyser, worklet, sink])`。
     - **呼叫順序與釋放時機逐一對照未變**（這段前幾輪剛修過三個麥克風生命週期 bug，teardown 完整性是用血換來的）：建構序列 `createMediaStreamSource(mic) → createChannelMerger(2) → mic.connect(merger,0,0) → tab.connect(merger,0,1)` 一字未動且仍在同一個位置被呼叫；失敗路徑的 disconnect 順序仍是 `[micSource, merger]`、仍在 `stopTracks(micTracks)` **之前**；`cleanupTracks`（display＋mic 兩組軌）與外層 try/catch 的 `ctx.close()` 完全未觸及；`stop()` 的節點順序 `[tabSource, micSource, merger, analyser, worklet, sink]` 逐項相同（mono 時中間兩項仍為 null → 跳過）。
- **為什麼**: /simplify 批 C（web 內部）。項目 1 是最高價值的一項——把已經失效的安全論述留在四個 surface，等於把下一個工程師推回「前端做滿、server 沒閘」那個坑，也會讓未來任何簡化提案被這些註解嚇退；項目 2 是把一條靠慣例維持、壞掉時無聲把兩個人的話對調的不變量搬進共用程式碼；項目 3、4 是同一輪留下的死分支與三份重算；項目 5 是三塊螢幕同時顯示同一句話卻各存一份；項目 6 是把最深的巢狀與第二份 disconnect 迴圈收掉。
- **驗證（真實輸出）**: repo `npm run typecheck` 五 workspace **EXIT=0**；`npm test` **連跑三次全 EXIT=0**（crm 11 檔／88 tests＋server 70 檔／**514** tests，數字與批 B 相同、斷言未放寬）；`apps/web` `npx next build` **EXIT=0**（19 routes 不變）。
  - **worklet（項目 2 的硬性要求）**：前幾輪那支 node 實跑套件在 repo 內**沒有**（scratchpad 腳本，未 commit）——已在本 session scratchpad 找到 `worklet-check.mjs` 並沿用：改動前基線 **50 PASS／0 FAIL**、改動後 **50 PASS／0 FAIL**（含 mono 真下混、stereo L/R 逐 pair 對齊、右軌缺席／過短補靜音、drift 四種取樣率 × 兩種聲道）。另新寫 `worklet-diff.mjs` 做**逐位元組差分**：把改動前的位元組副本與現檔各自載進 shim 過的 AudioWorkletGlobalScope，同一輸入下比對 **240 種組態、2708 個 frame 的原始 bytes ＋ 收工後的內部狀態**（`bufLen`／`readPos`／`carryL`／`carryR`／未送出的 `buf` 尾巴）——**全部逐位元組相同**（涵蓋 16k/32k/44.1k/48k × ch=1/2/缺席/垃圾值/frameMs=100 × quantum 大小 128／混合 1..129／全 1 × 右軌 正常/缺席/過短/過長）。
  - **反向驗證（證明差分不是空洞的）**：`worklet-diff-mutation.mjs` 在**記憶體中**（不落磁碟）注入四種突變——`carryR` 用 `consumed + 1` 切（正是「兩個人的話對調」那個失效模式）、`joinCarry` 無條件回 `chan`、`joinCarry` 前後接反、`step` 硬寫 1——**四種全部被差分抓到**，未突變的現檔則仍與基線相同。
  - **i18n 對齊實跑**：zh-TW／en 各 **507** keys（收斂前 508：−2 個 `endedTitle` ＋1 個 `ws.endedTitle`），雙向差集皆空；`ws`／`hud`／`present` 三個動到的 namespace **key 集合與順序**逐一相同（12／89／21）；`ws.endedTitle` 兩邊都在、`hud.endedTitle`／`present.endedTitle` 兩邊都已消失；**收斂後的值與收斂前逐字相同**（zh「這場會議已結束」、en "This meeting has ended"）；git grep 確認 `apps/web` 已無任何走 hud／present namespace 的 `t("endedTitle")`。

### 2026-08-19 14:43 | /simplify 批 D：交接清單與測試去重——`AudioChannels` 掃齊、第三份 fail-safe 複本、握手閘假 row ×3 與測試 helper ×7 收成單一擁有者

- **工作區**: apps/server
- **類型**: refactor（**行為零改變**：型別別名等值替換、測試斷言嚴格度一律未放寬、測試數不增不減）
- **檔案**: `apps/server/src/asr/asr-provider.ts`, `apps/server/src/asr/gemini-asr.ts`, `apps/server/src/realtime/chunker.ts`, `apps/server/src/realtime/session-runtime.ts`, `apps/server/src/realtime/hub.ts`, `apps/server/src/realtime/ws-handshake-gate.ts`, `apps/server/src/realtime/test-support.ts`（**新檔**）, `apps/server/src/realtime/stereo-audio.test.ts`, `apps/server/src/realtime/checklist.test.ts`, `apps/server/src/realtime/ws-async-gate.test.ts`, `apps/server/src/realtime/ws-presenter-authz.test.ts`, `apps/server/src/realtime/hub-endmeeting-authz.test.ts`, `apps/server/src/realtime/ws-meeting-status.test.ts`, `apps/server/src/realtime/checklist-metering.test.ts`, `apps/server/src/realtime/draft-objective-metering.test.ts`
- **改了什麼**（四項，接批 A／批 B 明列的交接）:
  1. **`AudioChannels` 掃齊 server 端**（批 A 因當時檔案被批 B 佔用而留下的半套）。`asr-provider.ts`（`AsrFrameContext.channels`、`AsrSegment.channels`）／`gemini-asr.ts`（`transcribe` 簽章）／`chunker.ts`（`ChunkResult.channels`、`segment` 快照）／`session-runtime.ts`（getter、private `channelMode`、`noteChannelMode`）／`hub.ts`（`applyChannelMode`）／`stereo-audio.test.ts`（5 處鏡射生產簽章者）全部由 `1 | 2` 字面改 import `@meetcopilot/shared` 的 `AudioChannels`。
     - **grep 反證**：全 repo（`apps/server/src`＋`packages/*/src`）的 `1 | 2` 現在只剩 `packages/shared/src/protocol.ts:143` 的定義本身與它上一行的說明註解，server 端字面歸零。
     - **`AsrSegment.channels` 維持 optional**（照批 B 的查證結果，不是照上層原裁決書）：`checklist.test.ts`／`mid-meeting-crm.test.ts` 有兩參數的 literal 靠它，`hub.wireAsr` 的 `seg.channels ?? runtime.audioChannels` 是**真的會被取到**的（`stereo-audio.test.ts` 兩條 speaker 測試正是走這條）。只換型別別名，**沒有動 optional 性質**；同批把這個「不要順手改成必填」的理由寫進該欄位的註解，免得下一輪再判一次。
  2. **第三份 `channels` fail-safe 複本刪除**（`hub.ts` `pushAudio`）。
     - Before：`const channels: 1 | 2 = meta.channels === 2 ? 2 : 1`
     - After：`const channels: AudioChannels = meta.channels ?? 1`
     - `meta.channels` 已經是 `ws-server.ts` 握手時用 shared 的 `parseAudioChannels` 解析過的 `AudioChannels | undefined`，所以那個三元式等於把同一條 fail-safe 規則**抄第三遍**（前兩份是 shared 的 parser 與 `pcm-worklet.js` 那份唯一許可的鏡射）。`??` 只補「握手沒帶 param」的預設，語意更窄也更準——**兩者對所有輸入的結果逐一相同**（`meta.channels` 的型別使 `1`／`2`／`undefined` 是全部可能值）。
  3. **握手閘的假 row 從三份收成一份**，擁有者＝新檔 `realtime/test-support.ts` 的 `passingHandshakeRow()`。同批把 `ws-handshake-gate.ts` 那個內聯泛型 `AccountStatusRow & { meeting_status: string|null }` 具名成 **`export interface WsHandshakeRow`**（行為零改變），並讓 `passingHandshakeRow(): WsHandshakeRow` 以它為回傳型別。
     - **為什麼這樣配**：擁有者放測試支援模組（沿用 `packages/crm/src/test-helpers.ts` 的既有先例，產線檔不長出 test-only export），但**型別綁在閘身上**——閘的 SELECT 多讀一欄，`passingHandshakeRow()` 當場 **typecheck 失敗**。
     - **它換掉的失效模式**：此前 `checklist.test.ts`／`ws-presenter-authz.test.ts`／`ws-async-gate.test.ts` 各存一份 `{org_status,user_status,meeting_status}` literal，本輪為了讓閘多讀一欄**三個檔各改了一次**；漏改任一個，該檔**每一條 socket 都在握手被 1000 關掉**，I2 身分閘整組變 vacuous——**測不到任何東西卻仍然全綠**。本輪稍早真的發生過（`ws-async-gate.test.ts` 的 `slowCore` 回 `{status:"active"}` → `hub.attach` 從未被呼叫）。現在同一個疏漏是編譯錯誤，不是綠燈。
  4. **`testConfig`／`fakeSocket`／`tick` 從 7 份收成 1 份**（同樣落在 `realtime/test-support.ts`），搬移**逐字**、不改行為：
     - `testConfig(overrides?: Partial<AppConfig>)`：5 個 realtime 測試檔的版本**值逐字相同**（3 個用區域 `SECRET` const、2 個內聯同一字面值，故一併提為 `TEST_JWT_SECRET`，各檔以 `import { TEST_JWT_SECRET as SECRET }` 保留原有寫法、call site 零改動）；兩個計費測試檔（`checklist-metering`／`draft-objective-metering`）**本來就不同**（`gemini.apiKey:"k"` 讓 `isConfigured()` 為 true、`extractModel:"extract-model"` 供斷言），故**不強行統一**，改以整包 override 傳入，結果值與它原本自己寫的一份逐欄相同。`overrides` 刻意是**淺層**：深層合併會讓「這個測試吃到哪組 model 名稱」變成要跨檔推理。
     - `fakeSocket()`：原本 4 份分 3 種形狀（最小版 ×2、帶 `sent` 錄 JSON 的 ×1、帶 `closed`/`closeCode` 的 ×1）。收成**三者的聯集**（`sent` ＋ `closed`/`closeCode` ＋ 三版逐字相同的 `readyState` 1→3），不是任何一版的削減——不讀那些欄位的測試完全不受影響（純記錄、沒有分支）。
     - `tick(ms = 0)`：原本叫 `tick`（×2，逐字相同）／`sleep(ms)`（×1）／`flush()`（×1），實作是同一行 `new Promise(r => setTimeout(r, ms))`。以 **import alias**（`tick as sleep`、`tick as flush`）保留各檔原有用詞，32 個 `sleep(...)`／2 個 `flush()` 的 call site **一字未動**（把重命名的風險降到零）。
     - **`liveHub()`／`checklist harness()` 刻意不合併**：兩者確實共用 core→migrate→org→`store.create`→`registerMeeting`→meta→`attach`→tick→`getRuntime` 這條流程，但差在 role（capture／hud）、`registerMeeting` 有無 `deckId`、meta 有無 `channels`、等待長度（0／20ms），且 checklist 那兩份各自回傳完全不同的斷言介面（`status`/`advanceAudio`/`emitCovered` vs `hud`/`meta`）。合併需要 4 個以上的旋鈕，會把「這條測試在驗音訊路徑還是在驗 HUD 投遞面」藏進設定物件裡——照裁決書給的例外條款只搬 helper、不合併。
- **為什麼**: /simplify 批 D。項目 1、2 是批 A 明列的交接（`1 | 2` 半套＋第三份 fail-safe）；項目 3、4 是**已經付過的成本**而非假設性——本輪為了讓握手閘多讀一欄，三個測試檔各改了一次同一份 row；`testConfig`/`fakeSocket`/`tick` 也在本輪從 4 份長成 6–7 份，`AppConfig` 每加一個必填欄位就要改 7 個測試檔（若新欄位選配，就變成 7 份行為分歧的測試設定）。
- **驗證**: `npm run typecheck` 全 workspace 通過；`npm test` **連跑三次**（L23）皆 crm 11 檔 88 tests／server 70 檔 **514** tests 全綠——與批 B 收尾時**數字完全相同**（本批不增不減任何測試，純去重）。**反證（證明測試沒有變空洞）**：把 `passingHandshakeRow()` 的 `meeting_status` 由 `"scheduled"` 改成 `"completed"`（握手閘會拒的值）→ `ws-presenter-authz.test.ts` **6 條中 5 條轉紅**（`ACCEPTS…` 兩條的 spy `Number of calls: 0`；`REJECTS…` 三條的 `expected undefined to be defined`，因為 socket 在握手就被關掉、`forbidden_not_presenter` 根本沒機會送出），已還原並複跑至全綠。

### 2026-08-19 14:35 | /simplify 批 B：server 內部清理七項——靜音段不打 Gemini／分析窗改字元預算／時鐘單一擁有者

- **工作區**: apps/server, docs
- **類型**: perf（項目 1、2 是刻意的成本優化）＋ refactor（項目 3–7 行為不變）
- **檔案**: `apps/server/src/realtime/chunker.ts`, `apps/server/src/analysis/gemini-analysis.ts`, `apps/server/src/analysis/analysis-engine.ts`, `apps/server/src/asr/asr-provider.ts`, `apps/server/src/asr/gemini-asr.ts`, `apps/server/src/realtime/session-runtime.ts`, `apps/server/src/realtime/hub.ts`, `apps/server/src/realtime/stereo.ts`, `apps/server/src/realtime/stereo-audio.test.ts`, `apps/server/src/realtime/checklist.test.ts`, `docs/M234_CONTRACT.md`
- **改了什麼**（七項，上層裁決；除 1、2 外行為不變、測試斷言嚴格度未放寬）:
  1. **靜音段不再空打 Gemini**（最高價值）。`Chunker` 在 `push()` 的既有 frame 迴圈裡順手維護本段的 peak `|sample|`（每取樣一次比較、只掃新資料，比每次 push 都回頭重掃尾端 600ms 的 `trailingRms()` 便宜），`flush()` 在 `peak < SILENCE_RMS_THRESHOLD`(400) 時 `reset()` 並回 `null`——不編 WAV、不 base64、不送轉寫。
     - Before：切段規則是「`totalSamples ≥ 1s` 且尾端 600ms RMS < 400 → flush」，所以一條**完全沒人講話**的軌每滿 1 秒就切一段 → 1 秒 WAV(≈32KB)→base64(≈43KB)→`extractModel.generateContent` round trip → 回來空字串直接丟掉。雙軌之後這不是邊角案例：**雙方輪流講話就代表整場幾乎隨時恰好有一條軌是靜音的**（報告者講話時右軌靜音，反之亦然）→ 每分鐘約 60 次、每小時約 3,600 次零產出的呼叫／場，外加同量的 base64 配置與 20 秒 deadline timer。
     - After：`peak < 門檻` **必然蘊含** `RMS < 門檻`，所以這個丟棄條件嚴格比既有切段判定更保守，不可能誤丟「安靜但有人講話」的段落（新測試以 RMS≈346 < 400、peak=8000 的段落實證）。
     - **對音訊時鐘零影響**（已逐行複驗）：時鐘是 `hub.pushAudio` 每 frame 呼叫一次的 `runtime.advanceAudioClock(samples)`，與 chunker 的切段／丟段次數無關；下一段的起點重新取自 `ctx.tMs`，所以丟掉的靜音**仍然被計時**，時間軸不開洞（新測試釘死「5 秒靜音後那段的 `tMs` 是 5000 而非 0」）。consent gate 在 `hub.pushAudio` 最前面、位於本改動的**上游**，完全未觸及；本改動只會讓更少音訊離開程序。
  2. **`WINDOW_MAX_SEGMENTS`(20) → `WINDOW_MAX_CHARS`(300)**（`gemini-analysis.ts` `trimWindow`）。段數上限的唯一職責是「限制 prompt 大小」（牆上時長已由 `WINDOW_MAX_AGE_MS`=90s 管住），而「一段」在 mono／stereo 不是同一個量（stereo 兩軌各自產生 final 段、`ingest` 頻率翻倍）。本輪為補償 stereo 把 10 翻倍成 20，但常數**不分模式** → mono 場次的 prompt 逐字稿也從 ≤40 秒變 ≤80 秒直接翻倍，而 mono 正是麥克風被拒時的 fallback（`audio-capture.ts` 自註「denial is common — so this path carries the WHOLE meeting」）。
     - `trimWindow` 改成先濾年齡（仍用 `filter` 不用 break：兩軌非同步轉寫完才 ingest，`t` 抵達順序**不保證單調**）再從最新往回收字元，超出預算即停，**最新一段永遠留著**（單段超標也不能讓窗變空）。
     - **300 的推導**：基準線＝改動前的 mono 行為 10 段 × 段長上限 4 秒 ＝ 最多 40 秒逐字稿；繁中口語 4–5 字/秒 → 40 秒 ≈ 160–200 字（天花板，靜音切段讓實際段落多半不到 4 秒），中英夾雜字元密度更高 → 取 300 讓 mono 在最壓迫情況下不比舊行為少看到東西，相對「20 段」版（繁中 ≈ 400 字）是實打實的降幅，且不再隨聲道數浮動。**不走「把 channels 傳進 engine」**：`ensureRuntime` 建構 engine 時右軌還不存在（中途才 lazily 建）。
  3. **刪掉不可達的 `consumedSamples` fallback，時鐘只剩一個文件擁有者**。`Chunker.push` / `GeminiAsrProvider.pushAudio` / `AsrProvider.pushAudio` 的 `ctx` 改**必填**，`ChunkResult.channels` 去 optional，`consumedSamples` 及其每 frame 累加刪除；`segmentStartMs` + `segmentChannels` 兩個平行 nullable 欄位合成一個 `segment: {startMs, channels} | null`（`flush()` 不再重寫一份 reset 邏輯，改呼叫 `reset()`）。
     - **不可達的複驗方法**：`new Chunker()` 全庫僅 `gemini-asr.ts:37` 一處；`implements AsrProvider` 僅 `GeminiAsrProvider` 一個；`pushAudio` 非測試呼叫點僅 hub 三處（mono 1 + stereo 2）且**全部無條件帶 ctx**。最終證據是把參數改必填後 `npm run typecheck` 全 workspace 通過——編譯器窮舉了所有呼叫點。
     - **`AsrSegment.channels` 維持 optional**（`checklist.test.ts` / `mid-meeting-crm.test.ts` / `stereo-audio.test.ts` 有兩欄位 literal），因此 `hub.wireAsr` 的 `seg.channels ?? runtime.audioChannels` **保留**——上層裁決書說該 `??` 右側永遠不會被取到，實際複驗**不成立**：`stereo-audio.test.ts` 兩條測試（stereo 期待 `presenter`、mono 期待 `unknown`）正是靠這條 fallback。只改註解說明它現在只服務「直接注入 `{t,text}` 的呼叫端」。
     - **同批修掉 5 處已不成立的「chunker 是唯一時鐘」敘述**（其中兩處是本輪剛寫的新註解，全新檔案裡的錯誤不變量未來一定會被當真相引用）：`stereo.ts` 檔頭、`hub.ts` `pushAudio` 檔頭、`analysis-engine.ts` `latestWindowT`、`session-runtime.ts` `UNCHECK_COOLDOWN_MS`、`checklist.test.ts` `advanceAudio`——全部改指 `LiveSessionRuntime.advanceAudioClock`。`chunker.ts` 檔頭的「時鐘所有權」段改寫成「本檔不擁有任何時鐘」。
  4. **`audioChannels` 收成唯讀**：private `channelMode` ＋ `get audioChannels()` ＋ `noteChannelMode(c): boolean`（回傳「有沒有變」），hub `applyChannelMode` 的 guard 與賦值合成一次呼叫。**每 frame 更新的鏡像語意不變**（stereo→mono 降級重連是真實路徑，黏著旗標會把混音段全貼成 `presenter`），測試改讀 getter（斷言逐字未動）。
  5. **「對每一軌做 X」收成一個走訪點**：`LiveSessionRuntime.asrTracks` getter，`dispose()`（reset 每軌）與 hub `applyChannelMode`（flushPending 每軌）各收成一個迴圈——原本 dispose 用陣列走訪並自註「避免未來加軌時又漏一個」，hub 卻在同一輪寫成兩行 `?.flushPending?.()`，那條註解變成「一個檔案遵守、另一個沒遵守」。**刻意不做**兩路 ASR 的 Map／集合式一般化（綁死的是 `TranscriptSpeaker` 凍結 enum ＋ DB `SPEAKERS` 白名單 ＋ 交錯 2ch wire format，集合化貢獻為零且失去 presenter/client 映射的編譯期窮盡性）。
  6. **`advanceAudioClock` 的 `if (samples > 0)` no-op 守衛刪除**（`samples` 恆為非負整數，`+= 0` 無副作用）；`capturedAudioMs()` 保留為唯一「讀而不動時鐘」的存取器，註解從「供 hub 組 frame 脈絡」（hub 從不呼叫它）改為「測試／診斷用」。
  7. **byte→sample 換算的第二份刪除**：`chunker.ts` 新 export `pcmSampleCount(buf)`（規則擁有者，與 `pcmBufferToInt16` 共用同一條 `byteLength % 2`），`hub.pushAudio` 的 `Math.floor(pcm.byteLength / 2)` 與 `left.byteLength / 2` 改用它——原本 `hub.ts` 有一句「取樣數與 `pcmBufferToInt16` 同規則」的註解，那句話就是耦合沒被表達成程式碼的證據。
  - **契約文件同步**：`docs/M234_CONTRACT.md` §M3 的 `pushAudio` 簽章與「三個雙聲道擴充」說明改為「ctx 必填、`AsrSegment.channels?` 與 `flushPending?()` 維持選配」，並寫明必填的理由與相容性活證明（`realtime-authz.test.ts` 的 `fakeAsr()` 連參數都不收、照樣通過）。
- **為什麼**: /simplify 四角度審查後的上層裁決。項目 1、2 是雙聲道落地時新引入的**持續性成本**（前者每小時數千次零產出 API 呼叫，後者 mono 場次整場付雙倍 prompt token）；項目 3–7 是同一輪留下的殘影——不可達的死碼、五處指名錯誤擁有者的註解（兩處還是新檔案）、一個欄位三種寫法、no-op 守衛、以及被寫進註解而不是程式碼的耦合。
- **驗證**: `npm run typecheck` 全 workspace 通過；`npm test` **連跑三次**皆 crm 11 檔 88 tests／server 70 檔 **514** tests 全綠（原 506，新增 8 條）。新增測試：靜音軌零轉寫呼叫＋時鐘照走、靜音後那段起點不開洞、**安靜但有人講話的段落仍送**（RMS≈346<400 但 peak=8000，證明 peak 判準沒誤丟）、stereo 只有講話那軌付錢；字元預算裁切、mono/stereo 收斂同一 prompt 成本、年齡上限仍獨立生效、單段超標仍保留（窗不會瞎掉）。**反向驗證**：把 peak 閘停掉 → 新增的 3 條靜音測試全紅；把 `WINDOW_MAX_CHARS` 放大到 100000 → 2 條預算測試全紅；把 peak 換成整段 RMS → 「安靜但有人講話」那條轉紅（證明它真的在區分 peak 與 RMS），三個突變全部已還原。

### 2026-08-19 14:30 | /simplify 批 A：跨端契約收進 shared——WS close code ×4 ＋ `channels` 協商（型別／param 名／fail-safe 解析）

- **工作區**: packages/shared, apps/server, apps/web
- **類型**: refactor（**行為零改變**：close code 數值、`channels` 判定結果、fail-safe 方向全部維持現狀）
- **檔案**: `packages/shared/src/protocol.ts`, `apps/server/src/realtime/types.ts`, `apps/server/src/realtime/ws-server.ts`, `apps/server/src/realtime/stereo-audio.test.ts`, `apps/web/lib/ws.ts`, `apps/web/lib/useRealtime.ts`, `apps/web/lib/audio-capture.ts`, `apps/web/components/copilot/CopilotView.tsx`, `apps/web/public/pcm-worklet.js`（僅註解）
- **改了什麼**:
  1. **WS close code 收成單一真相**。`protocol.ts` 新增 `WS_CLOSE_MEETING_ENDED=1000`／`WS_CLOSE_BAD_HANDSHAKE=4000`／`WS_CLOSE_UNAUTHORIZED=4001`／`WS_CLOSE_ACCOUNT_BLOCKED=4003`（放在既有 wire 常數 `WS_PATH`／`SERVER_DEFAULT_PORT` 旁——「兩端都 import 的 wire 常數」的既有先例），語意註解一併從 server／web 兩處搬過來合併。
     - Before：server 端**只有 1000 被命名**（`realtime/types.ts`），4000／4001／4003 在 `ws-server.ts` 是**裸數字**（4 個 `ws.close(...)` 送出點）；web 的 `describeWsClose` 另有一張自己的 `case 4001/4000/4003/1000` 表。兩份跨 package、互不知情，只靠 `types.ts:21` 那句「改這個值＝同時要改那張表」的**註解**互相指涉——耦合寫進註解，正是它沒被表達成程式碼的證據。
     - After：`ws-server.ts` 四個送出點與 web `describeWsClose` 的四個 `case` **import 同一組常數**；`realtime/types.ts` 的 `WS_CLOSE_MEETING_ENDED` 改為 `export { WS_CLOSE_MEETING_ENDED } from "@meetcopilot/shared"`（**re-export**，沿用本 repo 既有做法——`useRealtime.ts` 對 `describeWsClose` 就是這樣轉出的），故 `hub.ts:250`／`ws-meeting-status.test.ts` 的 `import … from "./types.js"` 零改動。
  2. **`channels` 協商收成單一真相**（與 close-code 同型，失敗模式更糟）。`protocol.ts` 新增 `WS_PARAM_CHANNELS="channels"`、`WS_CHANNELS_STEREO="2"`、`type AudioChannels = 1 | 2`、`parseAudioChannels(raw: string|null|undefined): AudioChannels`（fail-safe：只有字面 `"2"` 回 2，其餘一律 1）。
     - Before：同一條規則在**三個 runtime 各實作一次**——`ws-server.ts` 的 `parseChannels`、`ws.ts` 的 `if (channels === 2) url.searchParams.set("channels","2")`、`pcm-worklet.js` 的 `opts.channels === 2 ? 2 : 1`；`1 | 2` 型別另外**獨立宣告 7 次**。
     - After：`ws-server.ts` 刪掉 `parseChannels`（改呼叫 `parseAudioChannels(query.get(WS_PARAM_CHANNELS))`）；`ws.ts` 組 URL 改用兩個常數；`ws.ts`／`useRealtime.ts`／`audio-capture.ts`（介面＋`const channels`）／`CopilotView.tsx`（`useState`）／`realtime/types.ts` 的 `1 | 2` 全改 `AudioChannels`。`stereo-audio.test.ts` 的 fail-safe 表格測試改 import shared 的 `parseAudioChannels`（15 個輸入的斷言逐字未動）。
     - **為什麼比 close-code 更該修**：漏改一處是**靜音失敗**——前端送 16000 bytes、server 當 mono 處理，chunker 取樣時鐘跑兩倍快、speaker 全錯，沒有任何一行會報錯、沒有任何測試會紅。
  3. **`pcm-worklet.js` 是唯一且已知的例外**（純註解改動）。它在 `apps/web/public/`、由 `audioWorklet.addModule('/pcm-worklet.js')` 靜態載入，**不經 Next bundle、不 typecheck**，無法 import `packages/shared`——把它拉進 bundle 會破壞它的載入方式。故**維持自己的字面判定**，另在檔頭新增「THE ONE ALLOWED COPY」段落＋判定該行的行內註解，指明 shared 才是權威、改規則要先改那裡再鏡射過來。
- **為什麼**: /simplify 批 A（跨端契約統一）。兩組常數都是「兩端必須逐位元一致、卻各存一份」的接縫；`types.ts:21` 用註解描述耦合，等於承認耦合沒被程式碼表達。收斂後改一個值兩端一起變，`channels` 的靜音失敗模式也失去了滋生的地方。
- **驗證**: `npm run typecheck` 全 workspace 通過；`npm test` crm 11 檔／server 70 檔 506 tests 全綠（L23 連跑三次）；`apps/web` `npx next build` 成功（19 routes）。grep 反證：TS 側 `"channels"` 字串只剩 shared 一處、`1 | 2` 於 web 端全滅、四個 close code 的**可執行**字面值只剩 shared（其餘命中為 `DAY_MS`／`4000 samples` 等無關數值、散文註解，以及 `ws-presenter-authz.test.ts:207` 刻意保留的 wire pin 斷言）。**未動**（另一個 agent 同時在改，留下一輪）：`asr/asr-provider.ts:29,40`、`asr/gemini-asr.ts:116`、`realtime/chunker.ts:48,55`、`realtime/hub.ts:771,807`、`realtime/session-runtime.ts:196` 的 `1 | 2`，`hub.ts:265` 的裸 `1001`，`hub.ts:771` 的第三份 fail-safe 複本（`meta.channels === 2 ? 2 : 1`，可簡化為 `meta.channels ?? 1`），以及 `stereo-audio.test.ts` 5 處鏡射用的 `1 | 2`。

### 2026-08-19 13:55 | 殭屍會議根因：WS 握手加 meeting-status 閘（org-scoped）＋HUD ended 終態＋close 文案 i18n＋AsrProvider 接縫文件同步

- **工作區**: apps/server, apps/web, docs
- **類型**: fix
- **檔案**: `apps/server/src/auth/active-account.ts`, `apps/server/src/realtime/ws-handshake-gate.ts`（新）, `apps/server/src/realtime/ws-server.ts`, `apps/server/src/realtime/types.ts`, `apps/server/src/realtime/hub.ts`, `apps/server/src/realtime/ws-meeting-status.test.ts`（新）, `apps/server/src/realtime/ws-presenter-authz.test.ts`, `apps/server/src/realtime/checklist.test.ts`, `apps/server/src/realtime/ws-async-gate.test.ts`, `apps/web/lib/ws.ts`, `apps/web/lib/useRealtime.ts`, `apps/web/components/hud/HudView.tsx`, `apps/web/components/copilot/CopilotView.tsx`, `apps/web/components/sim/MeetingSimulator.tsx`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`, `docs/M234_CONTRACT.md`, `docs/API_CONTRACT.md`
- **改了什麼**（code review 第二輪，補前一輪碰不到的根因）：
  1. **WS 握手檢查 meeting status**（CRITICAL，根因）。新增 `realtime/ws-handshake-gate.ts` 的 `checkWsHandshake(core, orgId, userId, meetingId)`：**一次 `db.get`** 三個相關子查詢（org status／user status／meeting status），回 `null`（放行）｜`"account"`｜`"meeting"`。`ws-server.ts` 的 `isAccountActive(...)` 呼叫換成它；`"account"` → 既有 4003 路徑不變，`"meeting"` → 先送 `{type:"error", code:"meeting_ended"}` 再 `ws.close(WS_CLOSE_MEETING_ENDED, "meeting ended")`。
     - Before：握手只驗 token（簽章／exp／`claims.meetingId === meetingId`）＋帳號未停權，**完全不查 `meetings.status`** → `/hud`、`/present` 的憑證就在網址列（`readMeetingCreds()` 先讀 URL query），會議結束後按一次 **F5** ＝全新連線，前端所有終態閘（close-code 判定、`retry()` 封鎖、UI 不給重試鈕）**全部繞過** → `hub.attach` → `hub.ensureRuntime` 替 `completed` 的會議重建 `LiveSessionRuntime`＋`GeminiAsrProvider`＋分析引擎，且 `runtime.consent` 重置 false。
     - After：`status == null || status === 'completed'` → 拒。新測試 `ws-meeting-status.test.ts` 第 1 條驗到 `hub.getRuntime(meetingId)` 仍 `undefined`（修補前該處為 defined ＝殭屍會議）。
     - **查詢成本**：併進帳號閘**既有的那一次** `db.get`，相對修補前**零額外 DB 往返**。帳號那兩欄的 SQL 與 fail-closed 判定抽成 `ACCOUNT_STATUS_COLUMNS` / `accountActiveFromRow()` 由 `auth/active-account.ts` 匯出，HTTP 中介層與 WS 閘共用（不抄第二份 → 不會漂移）。
     - **authz（硬規則 7）**：meeting 子查詢一律 `WHERE id = ? AND org_id = ?`，orgId 取自**已驗證的 wsToken**。「跨 org 的 meetingId」與「meetingId 不存在」在該查詢下都是 NULL → 送出**逐位元相同**的 error payload ＋同一個 close code（測試以 `expect(cross.raw).toEqual(ghost.raw)` 機械驗證），故未開存在性側信道。順序上帳號閘先判，停權帳號拿到的回應與會議狀態無關。
     - **close code 用 1000**（重用既有語意，前端那張表零改動）：`describeWsClose(1000)` → `{terminal:true, kind:"ended"}` → UI 顯示「這場會議已結束」而非「連線失敗，請重試」。server 端兩個發送點（`hub.endMeeting` 與握手閘）改為共用 `types.ts` 新增的 `WS_CLOSE_MEETING_ENDED` 常數（純具名化，值不變）。
     - **不誤擋重連**：`DISCONNECT_GRACE_MS`（5 分鐘）內 meeting 仍是 `'scheduled'`；白名單反著寫（只擋 `'completed'`）→ 未來新增中間狀態不必同步改閘。
     - **測試**：新增 4 條（全部走**真 core :memory: SQLite＋真 hub＋真 `attachRealtimeWs`**，故那句四個 `?` 的 SQL 是真的被執行過）——① completed 被拒＋code 1000＋不建 runtime；② 正控制組 active 正常通過（收得到 `session_state`）；③ grace 期間重連通過且 `getRuntime` 回**同一個實例**；④ 跨 org 憑證被拒且與「不存在」逐位元不可分，受害者那場的 `rolesOf` 仍為空。既有三個測試的假 core 補上 `meeting_status: "scheduled"`（少了它每條連線都會在握手被 1000 關掉）；`ws-async-gate.test.ts` 的 `slowCore` 一併從 `{status:"active"}` 修正為完整 row——原本閘其實是**擋掉**的，`hub.attach` 根本沒被呼叫，該測試的斷言是空洞通過。
  2. **HUD 端處理「會議已結束」**。`HudView.tsx` 新增 `meetingEnded = realtime.failureKind === "ended"` ＋ effect：非 embedded 時 `clearMeetingCreds()`（與 capture 端一致；不清的話 sessionStorage 那組憑證指向已結束的會議，下次進 /hud 又拿它連一次）。**只清 storage、不動 `creds` state**——畫面留在原地讓使用者看到終態，出口是既有的「重新貼連結」。`ConnectingState` 加 `ended` prop：標題／說明改用新的 `hud.endedTitle` / `hud.endedDesc`（不再顯示「無法連上會議 HUD」＋通用斷線原因），且已結束時不再疊 `connTerminalHint`（`endedDesc` 已把出路講完）。連線中橫幅同樣分流。
  3. **close 文案改走 i18n**（既有問題，但 1000 本輪變成常態路徑而被放大）。`describeWsClose` 的回傳 `reason: string` → `reasonKey: WsReasonKey`；`useRealtime` 的 `failureReason` → `failureReasonKey`、`UNREACHABLE_REASON` 常數 → `"close.unreachable"` key；`wsStatusLabel(status): string` → `wsStatusKey(status): WsStatusKey`。**純函式維持零 hook**（它跑在 React 之外的 socket `onClose` callback 裡，呼叫 `useTranslations` 會違反 hook 規則）——判定回 key、翻譯留給渲染層。新增共用 namespace `ws`（`status.*` 5 條、`close.*` 6 條）zh-TW／en 兩檔同位置。消費端：`CopilotView`（facts 那列＋失敗面板）、`HudView`（橫幅／desk pill／`ConnectingState`）、`MeetingSimulator`（/sim 兩顆 pill，新增 `useTranslations("ws")`）。`PresentStage` 只解構 `{terminal, kind}`、從不用 reason，且其終態文案早已在 `present` namespace → **無需改動**（已確認）。
  4. **`AsrProvider` 凍結接縫文件同步**（前一輪限定只改 `apps/server/` 而漏掉）。`docs/M234_CONTRACT.md` 的介面區塊補上 `AsrFrameContext`、`pushAudio` 第三參數、`AsrSegment.channels?`、`flushPending?()`，各自寫明用途與**為什麼是選配**（向後相容的活證明：`realtime-authz.test.ts` 的 `fakeAsr()` 至今仍只有 `{pushAudio, onFinal}` 且照樣通過）。同檔 WS server 段補握手閘。`docs/API_CONTRACT.md` §6 補「音訊時鐘是 session 級不是 provider 級」與**握手閘＋close code 對照表**（含 org-scoped／不洩漏存在性／不誤擋重連三則說明），§8.4 補終態不重連的前端規則＋`/present` 有投影片時不跳覆蓋層的例外（I3）。§7（Train）經查與本輪無關，敘述仍正確。
- **為什麼**: 前一輪把殭屍會議的防護**全部建在前端**，但憑證在網址列 → F5 是一條全新連線而非重連，前端閘一個都攔不到；唯一能守住的位置是 server 握手。順帶把「文件與實作落差」補上（會誤導未來 session）與把硬編繁中的 WS 文案改成 i18n（1000 從邊角變常態後，en locale 每次正常結束會議都會看到中文）。
- **驗證**: `npm run typecheck` 全 workspace 通過；`npm test` **連跑三次**皆 crm 11 檔 88 tests／server 70 檔 506 tests 全綠（L23 Windows vitest 間歇失敗前科）；`apps/web` `npx next build` 成功（19 routes）；i18n 對齊腳本實跑 zh-TW/en 各 508 keys、雙向差集皆空、本輪 13 個新 key 兩邊皆在。

### 2026-08-19 13:30 | 雙聲道三缺口修正——共用音訊時鐘／切換點強制切段／告警 session 層去重
- **工作區**: apps/server
- **類型**: fix
- **檔案**: `apps/server/src/asr/asr-provider.ts`, `apps/server/src/asr/gemini-asr.ts`, `apps/server/src/realtime/chunker.ts`, `apps/server/src/realtime/session-runtime.ts`, `apps/server/src/realtime/hub.ts`, `apps/server/src/realtime/stereo-audio.test.ts`
- **改了什麼**:
  - **修正 1（音訊時鐘）**：時鐘所有權從 `Chunker.consumedSamples`（per-provider）上移到 `LiveSessionRuntime.audioSamples`（per-session）。新增 `AsrFrameContext { tMs, channels }`，`hub.pushAudio` 每個 frame 呼叫一次 `runtime.advanceAudioClock(samples)` 並把脈絡下傳；stereo 的左右兩軌**共用同一份 ctx**（時鐘不會跑兩倍快）。`Chunker.push(pcm16, ctx?)` 在開新段時採用 `ctx.tMs`（無 ctx → 舊的內部計數 fallback）。
    - Before：`ensureRightAsr` 新建的右軌 `consumedSamples` 從 0 起算，左軌已跑完整個 mono 時段 → 兩軌 `TranscriptSegment.t` 差整段 mono 時長 → `gemini-analysis.trimWindow` 以「最新段 t − 90s」濾窗，任一左軌段進窗即把**所有右軌（客戶）段濾光**。
    - After：`chunker.ts` 新增 `export const SAMPLE_RATE` / `samplesToMs()`（單一換算點），兩軌何時建立都落在同一條時間軸。
  - **修正 2（模式切換錯貼 speaker）**：兩層。(a) `AsrSegment.channels` 記錄**擷取當下**的模式（chunker 在切段起點快照、`transcribe` 帶回 `onFinal`），`hub.wireAsr` 左軌改讀 `seg.channels ?? runtime.audioChannels`（原本讀 final 抵達當下的 `runtime.audioChannels`）。(b) 新增 `hub.applyChannelMode()`：模式真的改變時先 `runtime.asr.flushPending?.()` ＋ `runtime.asrRight?.flushPending?.()`，保證沒有任何一段音訊橫跨兩種語意。`Chunker.flushPending()` 殘料 < MIN_SEGMENT_SAMPLES（1s）→ 丟棄回 null（那本來就短到不會單獨成段；留著才會被黏到新模式音訊上）。
    - Before：mono→stereo 切換時左軌壓著的最多 4 秒 mono 混音（**含客戶聲音**）在切換後才 flush，`audioChannels` 已是 2 → 貼 `speaker="presenter"` 並落庫 `meeting_transcript_segments.speaker`。
    - After：該段帶 `channels=1` → 走 mono 語意（`inferSpeaker`／`unknown`），絕不為 `presenter`。stereo→mono 反向：右軌殘留的客戶語音在切換點被切出去（不遺失、不與數分鐘後的音訊黏成一段），仍以 `speaker="client"` 結算。
  - **修正 3（`asr_unavailable` 廣播兩次）**：去重從 provider 層（`unavailableSignaled` 是 instance 欄位，語意建立在「provider 與 SessionRuntime 1:1」的舊假設）提升到 session 層。`LiveSessionRuntime` 新增 `asrOutages: Set<AsrProvider>` ＋ `noteAsrUnavailable()`（回 true＝本場從全好轉為有壞，此時才廣播）／`noteAsrRecovered()`／`asrOutageCount()`；`dispose()` 一併 clear。`GeminiAsrProvider` 新增 `onAvailable(cb)`，成功轉寫且原本 signaled 時觸發，讓 session 層把該軌移出集合——全部恢復後下次中斷仍會告警（不會一場只告警一次就永遠靜音）。
  - **測試**：`stereo-audio.test.ts` 由 15 → 27 條。新增 `spyTranscribe`（spy provider-private `transcribe`，因為無 API key 時 `onFinal` 永遠不會觸發，這是唯一能觀察到「真 chunker 切段」的接縫）＋ `monoFrame`/`stereoFrame`/`pushFrames`/`attachHudErrors`/`outageCbOf`/`recoveryCbOf`；`attachHud` 從內層 describe 提到模組層共用。涵蓋：時鐘對齊（右軌首段 t=5000 而非 0）、mono-only／all-stereo 行為不變、mono→stereo 殘段不為 presenter、stereo→mono 兩軌都 flush 且客戶語音不遺失、殘料 <1s 丟棄且不黏連、雙軌同時中斷只發一次 toast、部分恢復不重發、全恢復後再中斷會發、mono 場次同語意、dispose 清空集合。**反向驗證**：暫時把 hub 改回舊行為，新測試 8 條全紅（非空洞測試），已完整還原。
- **為什麼**: 對抗式 code review 三項裁決。三者共同前提是「同一場 runtime 先 mono 後 stereo」屬**正常操作路徑**而非邊角案例——第一次按「開始聆聽」時麥克風權限泡泡沒回應 → 前端 `MIC_TIMEOUT_MS=10000` 後降級 mono → 停止 → 再按一次並給了授權 → 送 stereo；server 端 runtime 不會消失（斷線只排 `DISCONNECT_GRACE_MS=5min` 回收，且 cockpit 另有一條 hud socket 讓 room 不歸零）。後果分別是：客戶那一路的分析訊號被單向清空（objection/budget/competitor 幾乎只來自客戶）、客戶說的話被記成報告者且持久化進 DB、HUD/copilot 疊出兩個一模一樣的錯誤 toast。

### 2026-08-19 13:14 | 殭屍會議防護補完：close-code 單一真相＋terminal 不可重試＋擷取取消權＋結束失敗態

- **工作區**: apps/web
- **類型**: fix
- **檔案**: `apps/web/lib/ws.ts`, `apps/web/lib/useRealtime.ts`, `apps/web/components/present/PresentStage.tsx`, `apps/web/components/copilot/CopilotView.tsx`, `apps/web/components/copilot/CockpitView.tsx`, `apps/web/components/hud/HudView.tsx`, `apps/web/app/globals.css`, `apps/web/messages/zh-TW.json`, `apps/web/messages/en.json`
- **改了什麼**（對抗式 review 五項裁決）：
  1. **close-code 判定收斂成單一真相**（CRITICAL）。`describeWsClose` 從 `useRealtime.ts` 搬到 `lib/ws.ts`（兩個消費端都已 import 的 primitive；PresentStage 的 I3 import 白名單因此**零新增**），回傳值加 `kind: "retryable" | "ended" | "auth"`；`useRealtime` 改成 re-export，不再自帶第二份。
     Before（`PresentStage.tsx:340`）：`const code = ev?.code ?? 1006; if (code === 4001 || code === 4000) { setLink("failed"); return; }` → **1000 落在可重連分支**：報告者結束會議後 /present 照樣退避重連，握手不查 meeting status、`hub.ensureRuntime` 替 completed meeting 重建 runtime ＝ 本輪要殺的殭屍會議從另一個分頁原路回來。
     After：`const { terminal, kind } = describeWsClose(ev?.code ?? 1006); if (terminal) { setLinkKind(kind); setLink("failed"); return; }`。
  2. **terminal 狀態不可重試**。`useRealtime` 新增 `terminalRef` 閘門：`retry()` 在終態直接 return；handle 加 `failureKind`／`canRetry`。UI 三處（copilot rail `:466`、HUD banner、HUD `ConnectingState`）改成 `canRetry` 才渲染重試鈕，否則顯示 `connTerminalHint`；`/present` 的 `retryWs` 同樣加閘（`linkKind !== "retryable"` → no-op），失敗畫面依 kind 分流：`ended` 給「這場會議已結束」＋回到 App、`auth` 只給回到 App、`retryable` 才給「重新連線」。
     Before：failed 面板恆有一顆「重試」→ 按一下就替 completed meeting 開新 socket（殭屍會議第二條路）。
  3. **in-flight `startCapture()` 取消權**（世代計數 `startEpochRef`）。`stopCapture()`（＝停止聆聽／結束會議／unmount cleanup 三處的共同出口）與每次 `start()` 都 +1；`start()` 在 await 之後比對世代，過期就 **`ctrl.stop()` 並 return**，不寫 `controllerRef`、不改 phase（catch 分支同閘）。
     Before（`CopilotView.tsx:170`）：resolve 後**無條件**寫 ref＋`setPhase("listening")` → (a) 使用者在權限泡泡開著時按「停止聆聽」，幾秒後 phase 被推回 listening、音訊重新外送（隱私）；(b) 在 `requesting` 期間結束會議 → 元件卸載後 controller 寫進沒人碰得到的 ref，螢幕分享＋麥克風軌永遠不釋放。順手讓危險鈕在 `requesting` 時 disabled（非根因修正，只是不讓人踩進競態）。
  4. **結束會議失敗改落新 phase `end-failed`**。Before：非 404 失敗 → `setPhase("idle")` ＋保留 creds → 「開始聆聽」一按就替一場**可能已 completed**（`store.end` 成功後才出錯／回應途中斷線）的會議重建 runtime。After：`end-failed` 誠實說明不確定，只給「再試一次結束」（重打冪等的 `/end`）與「離開這場會議」（純本地清 creds＋導回首頁），**該 phase 下不渲染任何會重連或重啟擷取的元件**（VU／同意閘／教學／開始聆聽／結束鈕全部收起，共用新的 `meetingClosed` 判定）。standalone `variant="page"` 也補上同樣的攔截分支。
  5. **cockpit 結束後不再閃現建會表單**。`CockpitView` 加 `ended` 過渡旗標：`onMeetingEnded` 清 creds 的同時立旗標，`!creds` 分支之前先攔截並顯示「這場會議已結束／正在帶你回首頁…」，等 `router.push("/")` 的 navigation transition 完成。
  - 附帶（同源、同一個殭屍會議判準）：`CopilotView` 加一個 effect，socket 被 server 以 1000 關掉（會議在別處被結束）時本地落到 `meeting-ended` 並清 storage 的 creds——否則「停止聆聽→開始聆聽」或重新整理又是一次 runtime 重建。只動本地狀態，不呼叫 `onMeetingEnded`、不導航（使用者沒下指令，不該被強制帶走）。
  - i18n 9 個新 key（zh-TW／en 位置一致）：`copilot.railEndFailed`／`connTerminalHint`／`endMeetingUncertain`／`endMeetingRetryAction`／`endMeetingLeave`／`meetingEndedReturning`、`hud.connTerminalHint`、`present.endedTitle`／`endedDesc`；CSS 新增 `.mc-hudm__bannerhint`（終態取代重試鈕的說明文字）。
  - **fresh-context read-back 後的收尾五項**（硬規則 5，reviewer 逐項驗完再回頭補）：(i) `meeting-ended` 補一顆 `leaveMeeting` ghost 出口——會議**在別處**被結束時沒有任何導航，原本只有一行字＝死畫面（自己按結束的那條路下一步就導航，所以先前沒發現）；(ii) `onEnded` 也吃世代閘（原本安全只因 `audio-capture` 的 `stop()` 會 `removeEventListener`，那是別檔的實作細節，不該當正確性前提）；(iii) `ConfirmDialog` 加 `!meetingClosed`——確認框開著時會議在別處被結束，框還掛著且可按；(iv) cockpit 過渡畫面文案改成只講「正在帶你回首頁…」——那個畫面也會由 end-failed 的「離開這場會議」帶出來，「會議已結束」正是該狀態**不能**斷言的事；(v) 補上從來不存在的 `.mc-stage3__dot--failed`（1000 判 terminal 後 /present 的 failed 變成常見狀態，圓點卻靜默掉回中性灰）。
- **為什麼**: 本輪「結束這場會議」的防護只做了一半——1000 判 terminal 只改了 `useRealtime`，/present 的複本沒跟上（複製一份表正是這個 bug 的成因），且 terminal 只擋自動重連、沒擋使用者按的 `retry()`；另外 `startCapture` 沒有取消權，權限泡泡那幾秒是隱私外洩與資源洩漏的窗口；結束失敗又退回可重新聆聽的 idle。四條路都通向同一個結果：server 端替一場已結束的會議重建 ASR runtime。
