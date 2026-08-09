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

### 2026-08-09 14:35 | 前端接縫掃蕩收官：31 修＋復驗 PASS；跳過清單裁決（6 修／4 記債）
- **誰決定**: 使用者（「檢查是否有其他類似的前端問題，我覺得不少」——直覺獲證實）＋Fable（裁決）
- **掃蕩結果**：機械稽核（腳本窮舉：CSS 解析器＋className 微型求值器，排掉 17 假陽性）＋實機走查（44 次載入量測）。**簇狀而非零星**——三個沒跟上重設計的區域：CRM 子頁籤/詳情、登入頁＋團隊設定（兩次改版都只改 tsx）、DeckWizard（唯一殘留舊深藍＋舊紫）。修 31 項（P0 淺色隱形字 ×3 含 **I1 鎖頁提示 1.03→16.16:1**、殘色 8、孤兒 13 含 `.mc-card` 正式成原語、對齊 6、/studio 頁首歸位）。復驗 PASS：稽核腳本重跑清零、機器 diff（修前後 JSON 對比）、8 點抽測、6 行為流、slide-legacy-lock 20/20。
- **跳過清單裁決——修 6**：(1) 邀請「逾期」文案對未到期日期誤標（加 `expiresAt<now` 分支，真 bug）；(2) `PRICING__` 佔位字外洩使用者可見（映射人話或隱藏）；(3) 登入錯誤訊息把 env 變數名露給使用者（改人話文案，i18n 雙語）；(4) /studio 頁首補 kicker（完成 pagehead 統一，i18n）；(5) **B8 逐元素修**：非 kicker 家族踩 muted 者（`.mc-tabpane__title` 15px/700、可點的 `.mc-detail__back`、`.mc-field-row__label`、**雙主題都不過的 `.mc-ckl__titletext`「正在講」**）逐元素改 `--mc-text-2`——**token 值不動**（mute 以 card 校準的裁決不變）；(6) 死 CSS 清理 21+4 條（登入/團隊/train 殘骸；`.mc-deckcard.is-selected` 一併；逐條 grep 再刪）。
- **記債 4**：fmtUsd 小數對齊（<$1 四位小數屬刻意精度）；`emphasis:"on"` 無效值（兩端一致 fallback accent＝語意已兌現，補顯式規則屬化妝品）；/train 鎖定卡 CTA DOM 重構（行為面）；純版面 hook 死 class（`mc-job__body` 型——量測無視覺缺陷，補規則＝憑空發明設計）。
- **制度採納**：走查 agent 建議把 **dead-class 靜態檢查（秒級）收進驗收慣例**——同型 bug 否則會一直靠使用者截圖一個一個冒。納入 DESIGN_APPLY 驗收清單精神，後續輪次派工單直接引用 `scratchpad` 腳本已入 repo 化候選（記 backlog：搬進 `tools/`）。
- **影響**: 修 6 後與 Studio 按鈕修、31 項掃蕩修同批 commit＋部署（純 web）。

### 2026-08-01 20:00 | 版型 prompt/schema 瘦身（使用者指示）——一次過率 38%→100%、耗時中位 -83%；兩項語意裁決追認
- **誰決定**: 使用者（「瘦身版型 prompt 用一下」）＋Fable（約束凍結：契約形狀不動、真 API A/B 實證、事實紀律段不碰）＋agent 兩項執行期裁決（本則追認）
- **基準線（先量再動，全真 API）**：deck system 1,142 tok（三個共用片段佔 87%、四呼叫點各原封送一次、deck↔supplement 2,303 字元逐字重複）；動態 16 連跑——最終成功 94% 但**一次過僅 38%**、attempt 壞率 50%（MAX_TOKENS 14 次）、靠重試把 14.5s 拖到 85–98s；**退化迴圈鐵證**＝壞樣本 output 26K–32K tok vs 好樣本中位 1.2K（「有多少吃多少」）；**頁數達標僅 53%**（concise hint 靜默砍頁）；**stat/chart 產出 0**＝「涉及數據就放 stats 頁」規則 100% 造空殼頁、每次生成必進 reviseSlides。附帶實測發現：**responseSchema 不計入 promptTokenCount**（瘦 schema 省的是解碼繞圈空間非錢）。
- **瘦身結果（同輸入同條件 16 連跑 A/B）**：deck system **-38.7%**、supplement **-34.5%**；**一次過 16/16=100%**（原 38%）、attempt 壞率 **0%**、重取樣觸發 **0 次**（原 14）、耗時中位 **14.2/16.9s**（原 85.7/98.4）、頁數達標 94%（原 53%）、**新版式命中 100%/100%**（原 57%——瘦身反而加了直白選版指示）、stat 0→52、QA 觸發 100%→6%。server 68 檔 475 測全綠、**唯一改動檔＝slide-gen.ts**（契約形狀零改動經復驗 grep 證實）。
- **追認 1——stats 頁規則語意修正**：「主題涉及數據就至少 1 頁 stats」→「只有確有具體數字才放」——原規則是 100% 空殼頁＋必進 revise 的元兇，屬修 bug 級語意修正。
- **追認 2——「schema 綁頁數」被 API 硬限制否決、改 prompt 補**：實測發現 **Gemini responseSchema 的 min/maxItems 有「文法展開預算」，超過整份 request 400**（單測每特性都過、組合才爆——入 **L22** 含雙向夾擊除錯法＋邊界註解＋400 守門腳本）。`slides` 綁頁數等三項回退，頁數改 user prompt 補（15/16 達標）。
- **統計註**：16 樣本下 38%→100% 為強訊號非嚴格顯著性檢定；上線後以 usage log 的 finishReason 分佈持續驗證。
- **影響**: slide-gen.ts＋L22＋CHANGE_TRACKER。~12% 殘留失敗率之債**視為已清**（重取樣降級為保險絲）。使用者核准 commit＋push＋部署（只動 server → 只重建 server）。

### 2026-08-01 17:54 | /code-review 裁決：RECITATION 重取樣拆兩層（升溫＋改寫指示改 opt-in）——L20 第三度生效
- **誰決定**: Fable（10 agents：5 鏡頭＋逐 finding 反駁；confirmed 0、killed 5）
- **決策 1（修）——RECITATION 重取樣誤傷抽取端（三鏡頭 55/68/65 交叉命中、皆 refuted:false）**：17:15 的修法把「升溫 +0.2＋『改寫、勿照抄』指示」**無條件**套到所有 generateJson 呼叫端——但 CRM 抽取（extractor/deep-extractor）的 SYSTEM 明令「逐字取值、嚴禁捏造」、溫度 0.3/0.4 是實測釘死的：重取樣一觸發就**污染抽取忠實度**（provenance 還指著原頁、值卻被改寫）。有 verifier 拿 ROM 17:15 當「明文接受」反駁（40 分 refuted）——**誤讀**：該裁決只涵蓋 deck 生成脈絡；同輪對 MAX_TOKENS 做了 per-caller 裁決、對 RECITATION 沒做，不對稱即漏洞證據。
  - **修法（拆兩層）**：(a) RECITATION **全域維持可重試**（prod 事故的根修不動）——但預設重試＝**原溫原 prompt 純重抽**（RECITATION 本是抽樣相依，重抽常自解，對逐字抽取零污染）；(b) **升溫＋改寫指示改 opt-in**（`resampleOnRecitation` 風格旗標，比照 resampleOnMaxTokens），只有 deck 生成＋revise 開啟。回歸鎖更新：「RECITATION 不短路」保留、「hint 注入」改綁旗標。
- **決策 2（記債不擴修）——重取樣失敗 attempt 的 usage 不計費（65 分）**：機制屬實（失敗 attempt usage 丟棄、retryCount 零生產者），但這是 **ROM 2026-07-30 13:42 決策 3 已裁的 meter 系統性行為**（「拋錯即不記，改它影響每條計費路徑，另開一輪」）——重取樣讓頻率上升，記註於該債、維持另開一輪的裁決。
- **方法論（L20 第三度）**：本輪 confirmed=0，若機械看門檻＝「乾淨可上」；真問題全在 killed 的 refuted:false 交叉帶。**且出現新形態：verifier 拿指揮官的 ROM 當反駁證據——ROM 寫得不夠精確（沒寫明範圍限定）會反過來掩護漏洞**；決策紀錄要寫清楚「本裁決涵蓋／不涵蓋什麼」。
- **後續**: 修＋單路復驗 → /simplify（使用者指示）→ 全鏈回歸 → commit＋部署提案。

### 2026-08-01 17:15 | 上線首日兩輪修：生成「安全性限制」誤報（實為 RECITATION）＋Studio 編輯器三 UI 問題
- **誰決定**: 使用者（實測回報兩批問題）＋Fable（裁決修法與取捨）
- **輪 1——生成誤報安全限制（prod log 實證）**：使用者生成「介紹MeetCopilot給Troy」8 頁被拒「內容可能觸發安全性限制」；31 秒後重按成功。log 揭示真因＝**`finishReason=RECITATION`**（抽樣偶發，非內容安全）。兩層 bug：(a) `gemini.ts` 對所有非 STOP 一律 `retryable=false`——3 次重試形同虛設；(b) decks 錯誤映射把 RECITATION 併進 SAFETY 分支＝給使用者**錯誤的行動建議**（叫人改無害主題，正解是重試）。
  - **修（agent 實作、Fable 追認）**：RECITATION 改可重試＋獨立重取樣（每撞升溫 +0.2 夾 1.4）；錯誤訊息誠實分流；非 STOP 補印 token 四數。**連帶挖出**：同輸入 6 連跑 3 次 MAX_TOKENS 退化迴圈（實測「加大上限無效只變貴」——16384→28992 照樣灌滿，推翻直覺假設）→ deck 生成＋revise 開 `resampleOnMaxTokens`（**刻意不改全域預設**：checklist-gen/deep-extractor 靠 isMaxTokensError 自行縮輸入）＋token 預算依頁數線性。修後 8 連跑 7 成功、RECITATION 全救回。server 67 檔 469 測。
  - **記債**：殘留 ~12% 失敗率＋重取樣延遲（最長 224s）——治本＝W2 版型 prompt/schema 瘦身（動剛上線契約，另立一輪）。
- **輪 2——Studio 編輯器三 UI 問題**：共同根因＝`.mc-editor__grid` 沒設 `grid-template-rows`（row=最高欄＝右面板）→ 舞台高度隨面板變＝切頁 slide 跳 223px＋縮圖列 overflow 永不觸發；黑邊＝`.mc-editor__preview` 寫死重設計前的 `#0a1120`（該檔屬 W2、W1 換膚掃不到＝**兩包接縫再現**）。TABLE 表單每格 62.6px、13/20 截字。
  - **修**：grid 補 `minmax(0,1fr)`＋editor 頁 `:has()` 全高佈局＋舞台 `--mc-sunk` 置中（slideTop 五頁全等）；TABLE 重排 2D 網格（576→377px、0/20 截字、每格 ≥132px）；縮圖列獨立捲＋scrollIntoView。`slide-legacy-lock` 20/20 綠＝渲染輸出未動。
  - **裁決取捨（接受）**：4 欄比較表在面板內仍需橫捲 ~244px——「每格可讀」與「面板寬」的必然取捨，優於截字。
  - **記債**：dev 模式 `<html data-theme>` hydration 警告 5 筆（prod 不出現）——候選 `suppressHydrationWarning`，下輪順手。
- **影響**: apps/server（gemini/decks-routes/slide-gen＋新測）＋apps/web（studio-present.css/BlockEditor/SlideEditor）。未 commit；commit＋部署提案已備、待使用者核准（server＋web 都要重建）。

### 2026-07-31 17:20 | /simplify 套用批的四項執行期裁決（跳過 isTalkTrack、常數大小寫、設計稿進 repo、CSS 墓碑）
- **誰決定**: Fable 指派之清理套用 agent（執行期裁決，據現地查證與回歸結果）
- **決策**:
  1. **跳過 `SuggestionQueue.isTalkTrack` 的一句化**（候選清單第 5 項）。指派時的守則明寫「收益小又碰剛驗過的（SuggestionQueue 的 I2 修剛落地）就跳過」——該壓縮只省 3 行、且該函式正是 I2「所見即所批准」的判準本體，剛在 16:00 批收緊並驗證過。等價性雖已逐情形核對（空 blocks／單一文字／單一非文字／多 block 四種），但不值得為 3 行再動一次剛驗過的資產。**其餘 12 項全部套用**（候選清單有兩組重複描述——donut 與稅率各出現兩次——實際獨立項為 13，扣掉跳過的 1 項）。
  2. **`SLIDE_DEFAULT_THEME` 用大寫 hex，刻意不跟 `CHART_ACCENT_HUES` 的小寫慣例**。候選建議寫成 `bg:"f7f5f1"`，但 `pptx-render.normalizeHex` 的 fallback 分支是 `return … : fallback;`——fallback **原樣回傳、不經 `toUpperCase()`**，改小寫會讓無主題頁的 .pptx 輸出字面值從 `F7F5F1` 變 `f7f5f1`，`slide-new-blocks.test.ts:551-553` 立刻轉紅。慣例一致性 < 行為不變，故取大寫並在常數註解寫明原因。
  3. **設計稿兩份檔案複製進 `docs/design-handoff/`（不是搬移、不改契約條文）**。只複製 `DESIGN_INVENTORY.md`＋`MeetCopilot.dc.html`（契約第 4–6 行點名的兩份，md5 逐位元相同）；同目錄的 `support.js` 不複製——契約未引用、且是原型執行檔而非設計真相。`DESIGN_APPLY_CONTRACT.md` 只改指標三行，§0–§3 規範條文一字未動。
  4. **死 CSS 一律留墓碑註解，不留空白**。三處刪除（`.mc-companycard*` 家族、`.mc-pstart__launch*` 家族、`.mc-home__agendaempty`）各補一段註解寫明「誰取代了它、grep 零引用」，沿用本檔案既有慣例（`studio-present.css:591` 的 `.mc-present*` 墓碑）——避免下一位看到 `.mc-launchcard` 與舊名並存時誤以為漏刪，或把已刪的類名重新加回。
- **脈絡與理由**: /simplify 候選是「建議」不是「指令」，套用者需就地驗證每一項是否真的行為不變。本批 13 項獨立候選中，2 項的建議寫法若照抄會改變行為（常數大小寫）或超出授權範圍（碰剛驗過的 I2 判準），故就地修正與跳過。
- **考慮過的替代**: (1) 連 isTalkTrack 一起套（否——違反指派守則，且 I2 判準的任何改動都該配一次完整走查，不該搭清理批的便車）；(2) 把 `SLIDE_DEFAULT_THEME` 寫小寫再改 `normalizeHex` 補 `toUpperCase()`（否——那是**行為變更**，會動到 per-deck theme 路徑的輸出，遠超清理授權）；(3) 設計稿用「搬移」或只留連結（否——scratchpad 隨 session 消失，只留連結等於留懸空引用）；(4) 死 CSS 直接刪不留註解（否——本檔既有慣例是留墓碑）。
- **影響**: packages/shared（新增 `SLIDE_DEFAULT_THEME` 匯出，additive、不改既有形狀）、apps/server（pptx-render／usage-queries）、apps/web（7 個元件＋2 個 css＋2 個 messages）、docs（DESIGN_APPLY_CONTRACT 指標＋新增 design-handoff/ 兩檔）；CHANGE_TRACKER 1 筆。全鏈回歸全綠且**無任何測試斷言被修改**：crm 88、server 456（不減）、web 19 路由、i18n parity 472=472。未 commit／未部署（待使用者核准）。

### 2026-07-31 16:30 | 執行 16:00 修正批時的四項現場裁決（死 CSS 範圍縮小、keyframes、token 選擇、話術卡邊界）
- **誰決定**: Fable 指派之修正 agent（執行期裁決，據現地查證）
- **決策**:
  1. **死 CSS 刪除範圍由「~592-689」縮小為「591-611 ＋ 622-690」兩段**，中間的 **613-620 保留不動**。
  2. `studio-present.css` 段內重複定義的 **`@keyframes mc-pulse` 一併刪除**（非僅刪 selector）。
  3. `MeetingSimulator.tsx` pill 白膜底改吃 **`--mc-surface-2`**（而非 `--mc-card`／`--mc-border`）。
  4. `isTalkTrack` 的 `textual.length <= 1` **採字面實作（含 0）**：blocks 完全為空的 slide 仍判為話術卡。
- **脈絡與理由**:
  1. 16:00 決策已預警「verifier 指出區段內 613-620 疑似非死碼，刪前逐 selector grep 再驗」——**查證屬實**：613-620 是 `.mc-editor__grid`／`__thumbs`／`__panel`／`.mc-feat-edit` 的 `@media (max-width:960px)` 響應式規則，與 `.mc-present*` 無關且**活著**（編輯器窄視窗收單欄）。照 ROM 字面的連續範圍刪除會誤傷。同理 `.mc-pstart*`（PresentStart.tsx 在用）雖名字相近亦不在刪除範圍。`.mc-present*` 本身則確認為真死碼：PresentStage.tsx 已改用 globals.css 的 `.mc-stage3*`，全庫 grep `mc-present` 在 tsx/ts/json 零引用。
  2. 該 keyframes 只服務被刪的 `.mc-present*` 規則，留著即孤兒；且 globals.css:1388 已有同名 `mc-pulse` 定義，而 globals.css 由 `[locale]/layout.tsx` 全域載入、涵蓋本檔僅有的兩個消費者（hud／copilot 兩頁），刪除後所有現存 `mc-pulse` 消費者（`.mc-stage3__waitdot--connecting`、`.mc-call__dot` 等）仍解析得到定義。反之若留著，兩份同名 keyframes 並存會依載入序互相覆蓋，是更差的狀態。
  3. pill 是**淡色薄膜**（原 `rgba(255,255,255,0.06)`），語意上是 wash 而非卡片面。`--mc-card` 是不透明面色（淺色 `#ffffff`）會讓 pill 變成實心白塊、失去「淡標籤」外觀；`--mc-surface-2` 定義即為 hover wash（淺色 `rgba(21,19,15,0.045)`／深色 `rgba(255,255,255,0.055)`），深色值與原本的 0.06 幾乎等值，淺色則自動翻成深墨淡底——**雙主題都成立且視覺變化最小**。註：同檔 `cardStyle` 15:25 已改吃 `--mc-card`，兩者用不同 token 是刻意的（面 vs 膜）。
  4. 0 blocks 的 slide 在舊實作下同樣回 true（`[].every()` ＝ true），**維持既有行為、不引入新分支**；且此形狀在 I2 上無風險——沒有任何內容會被藏起來（話術卡印空字串，縮圖也會是空頁），不構成「所見≠所批准」。
- **考慮過的替代**:
  1. 照 ROM 字面刪 592-689 連續段 → 會誤刪活的響應式規則，**否決**（這正是 16:00 要求逐 selector 復驗的原因）。
  2. 只刪 selector、保留 keyframes 以求「最小改動」→ 留下無消費者的孤兒＋與 globals.css 同名衝突，**否決**。
  3. pill 用 `--mc-card`（與同檔 cardStyle 一致）或 `--mc-border` → 前者變實心塊、後者是線色不是面色，**均否決**。
  4. 收緊為 `textual.length === 1`（空頁改走縮圖）→ 屬於本次 I2 目標之外的行為變更，無風險收益，**否決**。
- **影響**: `apps/web/app/studio-present.css`（少刪 8 行、`.mc-editor__*` 響應式保住）、`apps/web/components/sim/MeetingSimulator.tsx`、`apps/web/components/hud/SuggestionQueue.tsx`。驗收：web tsc EXIT=0＋build EXIT=0（19 路由不變）＋i18n parity 475=475＋Playwright DOM readback 六形狀全通過（詳見 CHANGE_TRACKER 2026-07-31 16:30）。**教訓**：ROM/review 給的行號範圍是線索不是授權，跨越註解區塊的連續範圍常混入他族 selector，刪前必須逐 selector 復驗。

### 2026-07-31 16:00 | /code-review 裁決：修 1 confirmed（話術卡藏內文＝I2 知情批准回退）＋3 清理；polish 追認
- **誰決定**: Fable（9 agents：polish＋5 鏡頭（3 鏡頭零 finding）＋逐 finding 反駁）
- **決策 1（修，83 分）——話術卡藏內文**：`isTalkTrack` 對 section（heading+subheading）與 heading+paragraph/quote 形狀回 true → 卡上只顯示 heading，**subheading/paragraph/quote 的實質內容（如報價數字）零渲染、無縮圖、無編輯鈕**——報告者批准了自己沒看過的內容＝**I2 知情批准在最常見補充頁形狀上實質失效**（對舊 SlidePreview 的回退；wire/authz 機制本身完好）。修法照 verifier correctedFix：**isTalkTrack 僅在「整頁全部文字內容＝卡上顯示的那一行」時成立**（textual blocks ≤1 且無其他 block），其餘落縮圖分支（SlideRenderer 預覽＋編輯後加入）——回到使用者 07-30 拍板的形態。
- **決策 2（修，killed 中 refuted:false 撈回）**：`hud.nextUp` 孤兒鍵刪除（55 分，真孤兒）；`.mc-present*` 死 CSS 家族 ~98 行（60 分，W4 清理 grep 清單漏掃）——**刪前逐 selector grep 再驗**（verifier 指出區段內 613-620 疑似非死碼）。加 polish 回報的 `MeetingSimulator.tsx:595` pill 舊白膜底。
- **polish 追認**：eyebrow `#9b5e18`（紙底 4.81 ✓；section 反底頁 3.54 但 28.8px large text 門檻 3:1 過，接受）；**sim 六卡「清成 token」屬刻意視覺變化**（`.mc-card` class 全庫根本無 CSS 規則、外觀 100% 由 inline 決定——polish agent 查證推翻了我派工單的前提），淺色下變有框白卡與全站一致，**追認**。
- **後續**: 修正＋/simplify＋總回歸 → WORKLOG → commit 提案待核准。

### 2026-07-31 15:10 | W4 雙路總驗證 PASS；殘餘裁決（warn 族接受／slide eyebrow 修／載入 $0 修）＋agent 裁決項全數追認
- **誰決定**: Fable
- **W4 結果**：fix（話術卡誠實化＋chart 防炸＋deckErr 5.91:1＋死 CSS −232 行）∥ backend（首頁**零新端點**自湊、usage 加 `budget` optional 欄＋`by-meeting` 端點含跨 org join 鎖、train lastScore 一次查回貼非 N+1、team 動態**查證後不做**——activities 表恆空無寫入點）→ wire（home KPI 單支失敗只滅那格不兜 0、spend 預算條 env 未設整條消失、「會中成本」誠實文案、train 徽章無紀錄不渲染）。**regression PASS＋adversarial PASS**。server 66 檔 456 測、parity 476/476、12 態截圖零 console error。
- **裁決（修，併入 polish）**：(a) `.slide__eyebrow` 預設色 4.18:1——全部 flag 中**唯一上舞台（觀眾可見）**者，預設值調至 ≥4.5（per-deck theme 不動）；(b) spend 首載 `data===null` 期大數字閃 `$0.00`——改佔位符「—」，與「拿不到不渲染」原則對齊；(c) sim :589 測試工具內嵌舊深色 inline 殘留順手清。
- **裁決（接受記檔）**：warn 琥珀 tag 族 3.98–4.30（9.5–12px metadata 級非內文，與 mute 同屬 kicker 家族，併日後 a11y 總議）；mute on sunk 3.65 三處小 badge（11:50 裁決精神涵蓋）；by-meeting 回不透明外 org meeting_id（標題已被 org-join 擋死、測試明文預期）；last-score ORDER BY 無索引（org 報告破萬才需物化，記債）。
- **agent 裁決項追認**：keysSlide/keysTalk 暫同文（保留分化空間、不發明文案）✓；chart guard 測試放 apps/server（沿 slide-legacy-lock 既有跨包手法）✓；今日議程含 canceled＋灰徽章（誠實呈現）✓；spend/PersonaPicker 沿檔內 zh 硬寫慣例（整檔 i18n 化另立工項）✓；`home.agendaPending` 刪除 ✓。**仍刻意不渲染**（後端無來源，非漏做）：講到%／採用率／月底預測／週配額。
- **後續**: polish 3 項 → /code-review（全重設計 diff 五鏡頭＋對抗驗證）→ /simplify → WORKLOG 收尾 → commit 提案待使用者核准。

### 2026-07-31 13:05 | W3 對抗驗證 PASS；三項裁決（話術卡誠實文案／chart 防炸補洞／deckErr 對比）＋W4 開跑
- **誰決定**: Fable（審 W2.5 復驗 11 條＋W3 對抗驗證 3 條）
- **W3 結果**：對抗驗證 **PASS**——I2 批准卡兩型實測（掐 WS 不樂觀更新、A/S 快捷、EDIT 保留、wire 只有既有 `suggestion_action`）；I3（stage shell=0、hudWords=[]、import 白名單零擴充、**stage 截圖 light/dark 位元組相同＝舞台不吃 app 主題**）；consent 閘不可繞；hud 430px 無溢出；parity 461/461。W3 也正確識別 PresentStart diff 是 W1 的成果而未觸碰（續作紀律成立）。
- **裁決 1（修）——話術卡「照這樣說」按下去其實會 append 一頁進客戶看得到的簡報**（W3 驗證 finding，行為 100% 確認）：現行後端**只有一種建議實體＝補充頁建議**，`isTalkTrack()` 只是 UI 對「標題＋至多一段」形狀的呈現分類——accept 一律 appendSlide。「照這樣說」文案**未揭露後果**＝報告者以為只是確認話術、客戶端簡報卻多一頁。→ **兩型卡 primary 按鈕統一「加入簡報」**（話術型保留大字呈現與「現在可以這樣說」kicker，僅按鈕誠實化）；鍵盤提示 `hud.suggest.keys` 隨型別給對應文案。**backlog**：真正的「純話術建議」（不 append）需要 server 端新建議型別＋wire 擴充，屬產品功能非本輪。
- **裁決 2（修）——chart 防炸洞（信心 95）**：`renderSlideBlock` 的 try/catch 只護同步階段，chart 分支回傳 `<SlideChart/>` 惰性元件，`series.filter` 在 React render 期 throw 逃出包裝（10 形狀 probe：9 接住、`series:null` 炸頁）；且 apps/web **全庫零 ErrorBoundary**。可達路徑＝presenter EDIT 寫入＋舊 DB 資料。→ chart 分支建立元件前先驗形狀（`Array.isArray(series)` 等），SlideChart 內部再守一層。
- **裁決 3（修）——/sim deckErr 4.22:1**：W2.5 換上的 `--mc-danger` 壓在 `--mc-sunk` 上差 0.28——錯誤字壓深（color-mix 或墊 card 底），量測 ≥4.5。
- **W4 範圍凍結**：(a) 上述三修＋W3 列的死 CSS 清理（舊 `.mc-cockpit*`/`.mc-hud__*` 等零引用規則，例外 `MeetingSimulator.tsx:572` 一處消費者要一併遷移）；(b) **後端小端點**（08:30 拍板）——首頁議程/KPI 優先用**既有** meetings/usage API 湊、真缺的才加端點；spend 月上限（env）＋單場成本（usage 依 meetingId 分組）；train 上次分數（既有 report 表帶出）；**team「最近做了什麼」判定無便宜資料來源＝維持不渲染記 backlog**；(c) 前端接線；(d) 總驗證雙路；(e) 之後照家規 /code-review＋/simplify。
- **W3 另兩項刻意偏離追認**：手機版逐字稿/深查改摺疊保留（設計稿砍掉＝第二裝置回退，不跟）；stage 控制列兩句提 HUD 常駐文字不做（I3）。「逐字稿標色」不做（`SignalItem` 無 segmentId，憑 label 猜＝假資料）記 backlog。
- **影響**: W4 workflow（fix∥backend → wiring → verify×2）→ code-review/simplify → commit 提案。

### 2026-07-31 11:50 | W2.5 完成；mute 對比裁決（以 card 為基準）＋W3 斷點續作
- **誰決定**: Fable
- **W2.5 結果**：七項全落地（server **63 檔 430 測**、/sim 淺色實測 6.33:1、pptx 預設淺紙含 `resolveTheme.muted` 連帶修——原恆用深藍主題的 `96A2C2` 在淺紙上 2.4:1）。agent 兩處合理擴修獲追認：:311 同顆寫死紅一併 token 化、:509 純黑預覽底改 `--mc-sunk`（不改則剛修好的字壓在黑上更糟）。
- **裁決——mute 對比以 card 為基準、頁底 3.92:1 接受**：裁決值 `#7d766a`/`#8f8a81` 在 `--mc-card` 上恰 4.50:1（兩值顯然照 card 校準），在頁底 `--mc-bg` 只有 3.92:1。**接受**：mute 絕大多數位於卡片內；再壓深會逼近次級文字色、壓扁三級層次。若日後正式 a11y audit 要求全面 AA 再議。
- **W3 斷點續作**：W3 於 session 上限中斷時已改 15 檔（含刪 SlidePreview.tsx、新增 use-elapsed.ts、**動到 W1 的 PresentStart.tsx**——越界待它自查還原）；重跑帶續作指令（先 git status/diff 盤點、續作不重練、越界檔只移除自己的改動**嚴禁 checkout 掉 W1 成果**）。
- **平行建置教訓（第二次撞）**：W2.5 的 `next build` 兩度被 W3 in-flight 的半成品卡住（tsc 錯＋`.next` 併發 chunk 遺失）——**同 workspace 平行包的 build 驗收必須等對方停筆**；已在派工單寫明，日後平行契約直接鎖「build 驗收序」。
- **影響**: 等 W3＋雙驗證回來 → W4。

### 2026-07-31 09:05 | W1/W2 補驗裁決：7 小修（W2.5）＋pptx 預設主題同步淺紙＋W3 平行開跑
- **誰決定**: Fable（審兩路補驗 findings）
- **W2.5 修正清單（全數採納）**：
  1. `/sim` 淺色 5+ 處 2.2:1 灰字（`--mc-text-dim` 未定義永遠吃冷灰 fallback＋硬寫色）——掉在 W1/W2 契約接縫（sim 入口列 W1 義務、components/sim/** 卻劃給 W2），兩包都沒動 → 修 9 個 inline color 改 token。**契約教訓：檔案所有權表與義務表要交叉核對。**
  2. **落實 08:30 裁決 1**：`--mc-text-muted` 淺 `#9c9488`→`#7d766a`、深 `#7b776f`→`#8f8a81`（≥4.5:1）。
  3. 成對雙序列**圖例 swatch 與長條色不符**（swatch accent/accent-2、實際長條 sunk/accent）＝觀眾會看反前後對比 → swatch 改 sunk/accent。
  4. 成對雙序列 **pptx 配色與螢幕相反** → pptx paired 分支對齊螢幕（灰、accent）。
  5. `bullets.marker`（✓/✕/—）語意**不進 pptx** → 匯出端映射記號（前綴字符或 bullet code）。
  6. supplement 空殼頁可進批准佇列（新模板核心 block 被 sanitize 全濾後只剩標題仍 suggest）→ 生成端補「新模板缺核心 block＝不 suggest」守門。
  7. `renderSlideBlock` 對畸形 block 整頁炸（**既有類別**，probe 實測 8 種形狀 throw、web 無 ErrorBoundary）→ 逐 block try/catch 落防（壞 block 跳過不炸頁，舊新 block 同受益）；BlockEditor TableFields 補最少 2 欄下限（與 server sanitize 同規）。另 SlideEditor `gradientFallback` 舊紫粉漸層→新設計 teal 系。
- **裁決（pptx 預設主題）——同步淺紙，接受舊 themeless deck 匯出外觀改變**：驗證指出契約兩要求互斥（螢幕預設已淺紙 vs 舊 spec 匯出逐字相同），W2 保守選了保舊等價 → 我裁決**匯出端 DEFAULT_THEME 同步淺紙**。理由：使用者明示「直接套用新的、不分新舊版」，themeless deck 螢幕淺、匯出深＝**WYSIWYG 斷裂才是怪異**；「匯出逐字相同」回歸鎖的本意是防意外漂移，不是把舊外觀凍進刻意的全面重設計。有 per-deck theme 的 deck 不受影響。
- **假陽性紀錄（供日後驗證方法論）**：深色首頁按鈕量到 1.24:1 白底白字＝`.mc-btn` 的 `transition: background .15s` 在瞬切主題後立即量測撞過渡中間值——**自動對比稽核切主題後必須等 transition 結束再量**。
- **W3 與 W2.5 平行**（檔案零重疊：W3=copilot/hud/PresentStage；W2.5=sim/slide-chart/studio-present/pptx-render/slide-gen/globals tokens 兩值）。
- **環境待清（使用者）**：殘留行程 PID 33864（next start :3100）、PID 2020（fakechat :8787）、:8799 API stub——kill 被權限攔，請使用者手動清。
- **影響**: W2.5 修正包＋W3 派工；DESIGN_APPLY_CONTRACT 不改版（修正皆在原範圍內；pptx 預設主題裁決以本則為準）。

### 2026-07-31 08:30 | W1/W2 完成；W1 四項設計疑義裁決（mute 對比破例調整＋三項維持）
- **誰決定**: Fable（審 W1/W2 實作回報後裁決；兩路驗證撞週上限延至今晨補跑）
- **W1/W2 結果摘要**：W1＝tokens 全套替換（`--mc-*` 名沿用、值換設計稿雙主題）＋9 畫面重做＋12 項未設計畫面重調；**自抓一個全綠工具鏈都測不到的真 bug**——next/font 變數掛 `<body>` 而 `--mc-font` 在 `:root` 引用＝guaranteed-invalid → 全站掉回 Times New Roman、三字族零下載（tsc/build/console 全綠，只有量 computed font-family 才抓得到）→ 已修（`:root` 純 fallback、`body` 接 next/font）。W2＝shared 6→8 模板＋3 新 block＋17 版式（15 個不增 enum 用 template×block＋選擇器表達）＋supplement 版型規則納新版式**＋事實紀律**（競品欄/數值只能引用逐字稿已現或已驗證資訊，湊不出退回純文字——防會中幻覺數字上簡報）＋pptx 全映射實測產檔＋舊 spec A/B 逐字等價實證。數字：server **63 檔 421 測**（+46）、web build 19 路由、parity **359/359**。
- **裁決 1（破例調整）——mute 文字對比 2.4–2.6:1 不合格**：設計稿凍結色表的 `--mute`（淺 `#9c9488`／深 `#7b776f`）用在 10.5px mono kicker/meta/頁數＝實測最差 2.4:1，遠低於小字所需。**這正是使用者 /goal「前端沒有怪異的地方」要防的**（灰到讀不到的小字）。→ 契約「逐值照抄」在此破例：淺色 `--mute` 壓深至 ≈`#7d766a`（≥4.5:1）、深色提亮至 ≈`#8f8a81`；其餘 17 變數不動。屬可及性凌駕逐 px 忠實，視覺位移極小。
- **裁決 2（維持）——側欄圖示保留既有 SVG**：設計稿的幾何字符（◆▣▤…）跨平台字型渲染不穩＋可及性差，W1 判斷正確；`en` 縮寫欄照設計補上。
- **裁決 3（維持）——設計稿沒畫的既有能力一律保留**：CRM 分頁/新增表單、present 兩條播放路徑、train 全部設定、spend 明細、team 管理、/sim 入口——單一 shell 原型的展示缺漏≠產品下架決策。使用者若要砍任何一項需明示。
- **裁決 4（維持）——train 不改抽象客戶類型**：設計稿把對練對象畫成 3 個抽象類型＝產品語意變更（現行綁 CRM persona），契約未授權，W1 只換皮不換語意，正確。
- **附帶**：W1/W2 平行 `next build` 搶 `.next` 撞 ENOENT 一次（清掉重建即綠）——**教訓：同 workspace 平行包的 build 驗收要錯開或各自 BUILD_DIR**，記入日後平行派工注意。
- **影響**: mute 調整＋兩路補驗（W1 對比度攻擊會順帶驗 mute 修後值）＋W3 派工在補驗綠後發。

### 2026-07-30 21:17 | 全站前端重設計套用立項（claude.ai/design 交付）＋新 slide 模板入會中生成——四項拍板
- **誰決定**: 使用者（提供 claude.ai/design 專案「MeetCopilot 前端重设计」＋指示「逐一把新的前端套用上去，不必分新舊版，直接套用新的；並確認會中 AI 可自動套用新 slide 模板生成簡報」＋/goal「全部前端都要套上，前後端都有接上，所有功能正常，前端沒有怪異的地方」＋2 個 AskUserQuestion 拍板）＋Fable（盤點後的風險裁決與分工凍結）
- **設計交付物**: 經 DesignSync MCP 讀入（projectId 254c5bd4…），存 session scratchpad `design-handoff/`（MeetCopilot.dc.html 116KB＋support.js＋Directions 早期三方向稿＋github.md）。Opus 盤點產出 `design-handoff/DESIGN_INVENTORY.md`（**後續實作的唯一設計真相**）：11 畫面＋17 個 slide 版式（10 換皮／5 半新／2 全新）；設計語言＝暖米白淺色預設＋中性暖灰黑深色（`data-theme` 雙主題、18 個同名變數）、Space Grotesk＋IBM Plex Mono＋Noto Sans TC，與現行 `--mc-*` 零名稱交集＝全套替換。
- **決策 1（使用者拍板）——I2 批准形態＝「建議卡即批准卡」**：盤點揪出設計稿建議卡只有「照這樣說／跳過／幫我查」、**沒有補充頁批准入口＝I2 斷路**（觸及不變量、依憲法停下來問）。拍板：補充頁建議也走主舞台卡＝附頁面縮圖預覽＋「加入簡報／**編輯後加入**／跳過」三鈕（**EDIT 路徑保留**）；話術建議與補充頁建議同一個主舞台位、按鈕隨類型切換，維持設計稿的單主舞台節奏。
- **決策 2（使用者拍板）——資料缺口＝順帶補後端小端點**：設計稿 30+ 個後端沒有的欄位（首頁今日議程＋4 KPI、花費月上限＋單場成本、對練上次分數、團隊動態…）——便宜的彙總端點這輪順手補（月上限走 env、上次分數從既有 report 表帶出、議程/KPI 從既有 meetings/usage 彙總），真沒有的資料**不渲染不留假數字**。
- **決策 3（Fable 裁決）——I3/合規紅線**：(a) 設計稿原型結構會把側欄帶進 `/present` 舞台（sc-if 兄弟節點）——**照抄即違反 I3**；實作一律維持舞台獨立 route＋零 chrome＋import 白名單，只取設計稿「框內」視覺；控制列兩句提及 HUD 的常駐文字刪除。(b) **consent 同意閘與 session setup 相位在設計稿消失——不可移除**，以新皮重做。(c) 設計稿為純桌機（0 個 @media）——**不得回退 hud 手機可用性**（第二裝置是產品模型的一部分）；高密度畫面桌面優先可接受。
- **決策 4（Fable 裁決）——模板系統擴充路線**：新增 block 型別 `table`／`timeline`／`steps`＋既有 block 擴充（`stat.desc`、`bullets.marker`、chart 多序列＋donut 中心值）；2 個全新版式（timeline-gantt、comparison-matrix）入 `SLIDE_TEMPLATES` enum。**這是對「SlideSpec 契約不變」既有凍結的刻意解凍**（使用者明示要 AI 會中用新模板）——全鏈波及：shared zod／Gemini responseSchema enum／SlideRenderer／studio-present.css／EditableSlide／pptx 匯出／**supplement 生成 prompt 的版型選擇規則**（會中自動選新模板的入口就在這）。單位一律換算 `cqw`（設計稿 px 在編輯器/舞台字級差 1.8×）。`--slide-*` per-deck theme override 機制不動（anchor 繼承基礎）；slide 預設 fallback 由深色卡改淺色紙張。
- **分工凍結（平行先鎖檔案所有權）**: W1 tokens/AppShell/一般畫面（globals.css＋非會中元件）∥ W2 slide 模板全鏈（shared slide-spec＋server generation＋studio-present.css＋SlideRenderer/EditableSlide/pptx＋sim）→ W3 cockpit/hud/stage（吃 W1 tokens＋W2 renderer，落決策 1 的批准卡）→ W4 後端小端點＋接線＋i18n＋全面驗證（I3 攻擊、I2 攻擊者憑證含 EDIT、雙主題截圖走查）＋code-review/simplify。未設計到的 12 項畫面（login/sim/wizard/ScoreReport/ui 元件…）＝**換 tokens 重調、同語言不逐 px**。
- **影響**: 契約檔 `docs/DESIGN_APPLY_CONTRACT.md`（本輪凍結）；apps/web 全域；packages/shared slide-spec；apps/server generation/decks；後端小端點。

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
