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
