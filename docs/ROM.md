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
| [`rom_archives/ROM_002.md`](rom_archives/ROM_002.md) | 2026-07-25 ～ 2026-08-19 | 模擬對練一般化為「情境模式」（銷售/合作/政府/面試登錄表＋可變維度評分＋對練語言可設定），並在此期立下**全項目「操作簡單低門檻」原則**；登入收斂為純 Google（拔前端帳密 UI）。新產品線「會中待講清單」契約凍結＋「會中進行」兩入口改造（改名·同分頁導覽·準備頁解死路）。DynamicSlide/Studio C2 契約（匯入 deck 抽字·讀圖 fallback·回填，頁序對齊列為最高風險）＋§7.5 時鐘域更正。全站前端重設計 W1–W4 分批套用＋新 slide 模板入會中生成，多輪 /code-review 與 /simplify 裁決（L20「門檻是降噪工具、不是裁決依據」三度生效）。上線後修：RECITATION 誤報為「安全性限制」＋重取樣拆兩層；版型 prompt/schema 瘦身（一次過率 38%→100%、耗時中位 -83%）；前端接縫掃蕩收官 31 修。收尾大改＝**雙聲道收音**（L＝自己/R＝對方、deinterleave 置於 `hub.pushAudio` 最上游、握手 query param 協商、speaker 由聲道決定跳過 inferSpeaker）＋「結束這場會議」接線＋**殭屍會議 server 端握手閘**（close code 1000 判 terminal、跨 org 與不存在同等且逐位元相同地拒絕）。 |

---

<!-- ROM_BELOW -->

### 2026-08-20 07:05 | 部署順序約束：協定擴充時「server 先上、web 後上」，並在 server `ready:true` 後才動 web
- **誰決定**: Fable（部署現場發現，未在任何既有 SOP 中）
- **決策**: 本輪 web build 先 SUCCESS，但**刻意不先部署它**，等 server build 完成、部署、驗到 `ready:true` 之後才部署 web。並把這條寫進 `docs/DEPLOY.md` 成為日後同類改動的通則。
- **脈絡與理由**: 本輪前後端有協定擴充（WS 握手新增 `channels` query param、音訊 frame 從 mono 8000 bytes 變 stereo 16000 bytes）。兩種部署順序**不對稱**：
  - **web 先上（危險）**：新 web 在握手帶 `channels=2` 並送**交錯 stereo** PCM，但舊 server 不認得該 param → 走 fail-safe 當 mono 處理 → 交錯資料被當單聲道解讀 → **嚴重混疊噪音 ＋ 音訊時鐘跑兩倍快**（`chunker` 的 `consumedSamples` 會把 L/R 交替樣本全算成同一條時間軸）。而且**這是靜默失敗**：不會 throw、不會有 error log、frame 大小「正確」、音量表照跳，只有逐字稿變成垃圾。
  - **server 先上（安全）**：新 server ＋ 舊 web ＝ 舊 web 不送該 param → 新 server 的 fail-safe 落 mono → 而它收到的**確實**是 mono 資料 → 完全正確。
  Cloud Run 兩個 service 是獨立部署的，中間必然有一段兩版不一致的時間窗；順序決定那個窗是安全的還是壞的。
- **考慮過的替代**:
  - **兩個 build 好了就一起部署**——否決：`gcloud run` 是逐 service 的，不存在原子性；先跑完的那個必然先生效。
  - **讓新 server 靠 frame 長度自動偵測 stereo**（不依賴 param）——否決：250ms mono 與 125ms stereo 的 byte 長度相同，**不具唯一性**，這在稍早的 server 調查中已列為不可行的協商機制。
  - **在 web 端加版本協商握手**——否決：為了一次部署窗口引入常設複雜度，且 `channels` param 的 fail-safe 設計本來就已經讓「server 新 web 舊」安全，只需管住順序即可。
- **影響**: `docs/DEPLOY.md` 版本節新增此警告（放在「目前版本」段內，與部署指令同屏可見）；`docs/WORKLOG.md` 同步。**通則**：任何「前端送出的資料格式改變、且 server 需靠新旗標才能正確解讀」的改動，一律 server 先上。判準不是「誰改得多」而是「哪一邊的舊版遇到新版資料會靜默誤解」。
- **附帶記錄的部署陷阱**: `packages/shared/dist/` 在本機需重建才會被 server vitest 吃到（symlink 吃 dist 不吃 src），而 `tsconfig.json` 的 `composite: true` 會讓 incremental build **靜默跳過**——最終回歸 agent 實測發現「build 回 exit 0」不足以證明它真的重建，需刪 `dist/`＋`tsbuildinfo` 做 clean rebuild 才能確認（Cloud Build 走 Docker 從 source 建，不受影響）。

