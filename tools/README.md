# MeetCopilot — 音訊工具（擷取相容性測試 × worklet 驗證）

> 本檔含兩組工具：**`capture-test.html`**（瀏覽器音訊擷取相容性實測，下方主體）與 **worklet 驗證腳本**（`worklet-*.mjs`，見最末節——動 `apps/web/public/pcm-worklet.js` 前後**必跑**）。

`capture-test.html` 是一個**單檔、零外部資源**的瀏覽器測試頁，用來在正式開發 MeetCopilot v2 之前，親手驗證「監聽帳號擷取會議分頁音訊」這條路徑，在你手上的各種**裝置 × 開會軟體 × 瀏覽器**上到底能不能成功。

## 目的

MeetCopilot v2 採用**雙帳號會議模型**：一個「監聽」瀏覽器 profile 加入會議（Google Meet／Zoom 網頁版／Teams 網頁版），我們的網頁再透過 `getDisplayMedia` 擷取**會議分頁的音訊**。

這裡有一條硬性技術限制要先驗證清楚：

- 分頁音訊擷取是 **Chromium 系桌面瀏覽器限定**（Chrome／Edge 有文件背書；**Brave 已於 2026-07-07 在使用者裝置實測通過**——注意 Brave 的 UA 偽裝成 Chrome，工具已內建偵測更正）。
- 來源選擇器裡的**「同時分享分頁音訊 / Share tab audio」核取方塊**是關鍵，沒勾就是 0 音軌。
- 選「視窗（Window）」surface 是備援方案，**視窗音訊是否可用會隨作業系統不同**（Windows 較常有、macOS 常常沒有）。
- **LINE／Zoom 桌面版這類原生程式沒有分頁可選**，只能改走「整個螢幕＋系統音訊」——這條路**尚未驗證**，見下方〈測試 D〉。

這支工具會逐項把上述能力測出 PASS／FAIL，並讓你**實際回聽**錄下來的內容，避免「表面上有音軌、其實是靜音」的假陽性。

## 怎麼開

**方式一：直接雙擊（最快）**

1. 直接用 Chrome 或 Edge 開啟 `capture-test.html`（雙擊，或把檔案拖進瀏覽器）。
2. 測試 C（環境檢查）會自動跑；測試 A／B 需手動按按鈕。

> 注意：少數環境下瀏覽器會在 `file://` 封鎖 `getDisplayMedia`（按鈕沒反應或報 `NotAllowedError`）。若遇到，改用方式二。頁面偵測到 `file://` 時也會在說明卡顯示提醒。

**方式二：用靜態伺服器（最穩）**

在 `tools/` 的上層資料夾執行任一靜態伺服器，再用 `http://localhost` 開啟：

```bash
# 用 npx serve（Node 環境）
npx serve MeetCopilot_v2/tools
# 然後瀏覽器開 http://localhost:3000/capture-test.html （埠號以終端機顯示為準）

# 或用 Python
cd MeetCopilot_v2/tools
python -m http.server 8000
# 然後開 http://localhost:8000/capture-test.html
```

## 測試步驟（雙帳號）

1. 在**同一個瀏覽器 profile**開兩個分頁：一個「會議分頁」（Meet／Zoom 網頁版／Teams 網頁版），一個「本測試頁」。
2. 會議接通後回到本頁，按**測試 A → 開始擷取測試**。
3. 在來源選擇器選 **「Chrome／Edge 分頁」**，挑會議分頁，**務必勾「同時分享分頁音訊」**。
4. 想測備援：改選 **「視窗」** surface，看該 OS 是否給視窗音訊。
5. **讓會議裡有人講話、或播一段有聲音的影片**，否則音量表不會動、也聽不出錄音。
6. 錄完按「回放」聆聽，確認擷取到的是**會議聲音**而非靜音。
7. 填「裝置名稱」「開會軟體+情境」，按**複製結果**，貼進下方矩陣。

工具內含的檢查：環境（isSecureContext / AudioWorklet / AudioContext@16kHz / MediaRecorder 格式）、測試 A（畫面/分頁串流、是否含音軌、錄音可回放）、測試 B（麥克風串流、錄音可回放）。

---

## 測試 D — 系統音訊（原生 app 通話）｜實驗性

**在測什麼**：`LINE`、`Zoom 桌面版`、`Teams 桌面版`、`Discord` 這類**原生程式**不是瀏覽器分頁，分享來源選擇器裡根本找不到它們，所以測試 A（分享分頁）對它們完全無效。純瀏覽器唯一可能的路是：`getDisplayMedia` 選「**整個螢幕**」＋勾「**同時分享系統音訊 / Share system audio**」，收下整台機器播出來的聲音。測試 D 就是驗這條路在你的機器上通不通。

**什麼時候該跑它**：只有在要回答「**某個原生 app 的通話聲音能不能被我們收到**」時才需要。日常驗主流程（會議分頁擷取）跑 A/B/C 就夠了，D 跟主流程無關、也不是產品預設路徑。

**怎麼跑**

1. 先讓 LINE（或你要測的 app）**真的正在出聲**——通話中，或播一段語音訊息。
2. 在頁面測試 D 區塊把「測的是哪個 app」填好（預設 `LINE`），按**開始系統音訊測試**。
3. 分享視窗選「**整個螢幕 / Entire Screen**」（**不是**分頁、**不是**視窗），勾「**同時分享系統音訊**」，按分享。
4. 接下來 10 秒讓那個 app 持續有聲音，**本頁保持在前景不要縮小**（背景分頁的量測會被瀏覽器凍結；頁面偵測到有切背景會在判定裡附註）。
5. 10 秒後頁面自動給判定，並自動停止分享。按「回放」親耳確認錄到的是不是那個 app 的聲音。

**判定怎麼讀**（只看音軌數量會有假陽性——拿到 1 軌也可能整段全靜音，所以工具跑 10 秒取樣視窗，量峰值＋超過 −50 dB 的取樣佔比）

| 判定 | 條件 | 意思 |
|---|---|---|
| **成功** `success` | 有音軌 且 峰值 ≥ −40 dBFS 且 超門檻取樣 ≥ 2% | 抓得到系統音訊，這條路可行 |
| **靜音** `silent` | 有音軌但幾乎整段無聲 | 拿到音軌但沒有聲音——多半是沒勾系統音訊、或 app 當下沒出聲。**請重測** |
| **失敗** `fail` | 0 條音軌 | 這個平台／這次的選擇不給系統音訊 |

工具同時顯示你實際選到的 `displaySurface`（`monitor` / `window` / `browser`）：選成 `browser`（分頁）或 `window`（視窗）時會跳警告，**該輪不能當作系統音訊的結論**。所有數值都併進「複製結果」的 JSON `systemAudioTest` 欄位（沒跑過時是 `ran:false` / `verdict:"not_run"`）。

---

## 測試結果矩陣（範本）

每測一個組合就新增一列。「擷取 surface」填你在選擇器實際挑的類型；「有音軌?」看測試 A 的音軌數；「錄放回聽品質」是你按回放後的主觀評分。

| 日期 | 裝置 / OS | 瀏覽器 + 版本 | 開會軟體 | 擷取 surface（分頁/視窗/螢幕） | 有音軌? | 錄放回聽品質 | 備註 |
|---|---|---|---|---|---|---|---|
| 2026-07-07 | 使用者主力機 / Win11 | **Brave** 150（Chromium；UA 顯示 Chrome） | **Meet 網頁版（真實雙帳號）** | 分頁 | 是（1） | 可回放（160KB／10s） | file:// 開啟、9 項全 PASS；48kHz 立體聲、echoCancellation=false；**使用者確認此輪即為 Meet＋兩帳號實測 → S1 spike PASS 結案** |
| **待實測** | — | — | **LINE 桌面版（原生 app）** | **整個螢幕（系統音訊）** | 待實測 | 待實測 | **測試 D**——純瀏覽器抓原生 app 通話聲的唯一可能路徑，目前是**未驗證假設**。請跑測試 D，把判定（`success`／`silent`／`fail`）＋峰值 dBFS ＋ `displaySurface` 填回本列 |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |
| | | | | | | | |

**填寫指引**

- **擷取 surface**：`分頁` = Chrome/Edge 分頁；`視窗` = 單一應用程式視窗；`螢幕` = 整個螢幕/監視器（＝測試 D 的系統音訊路徑，填「整個螢幕（系統音訊）」）。工具會顯示瀏覽器回報的 `displaySurface`（`browser`／`window`／`monitor`），**以它為準**，不要憑印象填。
- **有音軌?**：`是（N）` / `否（0）`。若為「否」，多半是沒勾分享分頁音訊，或該 surface 不含音訊。
- **錄放回聽品質**：`清晰` / `有雜訊` / `破音` / `延遲大` / `靜音（假陽性）` / `無法回放`。
- **備註**：是否勾了分享分頁音訊、對方是否正在講話、是否播共享影片等情境。

---

## 已知預期（拿來對照你的實測）

| 組合 | 預期分頁音訊擷取 | 說明 |
|---|---|---|
| Chrome 桌面版 — 分頁 + 勾分享分頁音訊 | ✅ 應 PASS | 主要支援路徑 |
| Edge 桌面版 — 分頁 + 勾分享分頁音訊 | ✅ 應 PASS | 同為 Chromium |
| Brave 桌面版 — 分頁 + 勾分享分頁音訊 | ✅ **實測 PASS**（2026-07-07） | Chromium 系；UA 偽裝 Chrome，工具已加 `navigator.brave` 偵測。防指紋 farbling 對 Web Audio 加極微噪聲，理論上不影響 ASR（S2 順帶確認） |
| Chrome/Edge — 沒勾分享分頁音訊 | ❌ 0 音軌 | 核取方塊沒勾就取不到 |
| Firefox（桌面/行動） | ❌ 預期 FAIL | 不支援分頁音訊擷取 |
| Safari（桌面/iOS） | ❌ 預期 FAIL | 不提供分頁音訊 |
| 任何行動瀏覽器（Android/iOS） | ❌ 預期 FAIL | 行動端無 `getDisplayMedia` 音訊 |
| 「視窗」surface 音訊 | ⚠ 僅部分 OS | **Windows 較常提供視窗音訊**；macOS 多半只有畫面沒有音訊 |
| 「整個螢幕」surface 音訊（＝測試 D／原生 app 唯一路徑） | ⚠ **待驗證假設**（尚無任何實測） | **這一列是假設，不是結論。**目前掌握的說法：(1) **Windows／ChromeOS 必須選「整個螢幕」**才會給系統音訊（選分頁只有該分頁的聲音、選視窗多半沒有）；(2) **macOS 要 Chrome 141 以上＋macOS 14.2 以上**才支援系統音訊，更舊的組合沒有；(3) Firefox／Safari／行動瀏覽器一律沒有。**來源是 vendor blog 等級，非 W3C 規範保證**——[Screen Capture spec](https://www.w3.org/TR/screen-capture/) 明講 user agent 可以不提供音訊，所以每台機器都要用測試 D 親自驗。 |

> 這張表是「先驗假設」，不是結論。實測若和預期不符（例如某版 Chrome 分頁擷取失敗、或某台 Mac 視窗竟有音訊），**以矩陣裡的實測結果為準**，並在備註記下瀏覽器版本與 OS 版本。
>
> **「整個螢幕」那一列尤其要注意**：它從來沒被實測過（`docs/rom_archives/ROM_001.md:604` 記為「殘項：Window-surface 備援未測（非阻斷）」）。在測試 D 有實測結果之前，**不要拿它去回答「LINE 的會議語音能不能錄到」**——目前的正確答案是「未驗證，請跑測試 D」。

---

## worklet 驗證腳本（`worklet-check.mjs` / `worklet-diff.mjs` / `worklet-diff-mutation.mjs`）

**先講為什麼要特別小心**：`apps/web/public/pcm-worklet.js` 是全 repo **最不該手滑**的檔案。它把麥克風（L＝報告者）與分頁音訊（R＝對方）交錯成 `[L0][R0][L1][R1]…`，server 端 `stereo.ts` 再照這個順序 deinterleave 成兩路 ASR。**只要 L/R 錯開一個 sample，從那一刻起整場會議的兩個人就被對調**——報告者說的話被記成客戶說的、客戶的異議變成報告者的承諾，而 CRM／HUD／逐字稿全部照著錯的說話者落庫。

最要命的是**這種失敗是靜默的**：不會 throw、不會有 console error、frame 大小完全正確、音量表照常跳動、聽起來也還是人聲。TypeScript 幫不上忙（這支檔案是**原生 JS、不進 Next bundle、不被 typecheck**——它必須能被瀏覽器用 `addModule('/pcm-worklet.js')` 生吞），`npm test` 也跑不到它（`apps/web` 沒有 test runner）。**這三支腳本是這個檔案唯一的自動化防線。**

### 三支各在證什麼

| 腳本 | 在證什麼 |
|---|---|
| `worklet-check.mjs` | **功能正確性**（50 項檢查）。在 node 裡用 shim 過的 `AudioWorkletGlobalScope` 真的跑這支 worklet：mono 是真的 down-mix `(L+R)/2` 而非「留左丟右」、stereo 一定 L 先且無位移、右聲道缺席／長度不對時補**靜音**而不是複製左聲道、`stop` 有效、以及**重取樣不會跑快**（總產出樣本數 == 真實經過時間，這是整條 server pipeline 唯一的音訊時鐘）。四種 context 取樣率（16k/32k/44.1k/48k）× 兩種聲道模式各驗一輪。 |
| `worklet-diff.mjs` | **位元級回歸鎖**。把 `tools/pcm-worklet.baseline.js`（凍結的黃金副本）與**當前**的 worklet 各自載進獨立沙箱，餵**完全相同**的輸入，比對 240 種組態、2708 個 frame 是否**逐位元組相同**，連跑完後的內部狀態（`bufLen`／`readPos`／`carryL`／`carryR`／未送出的尾巴）都要一致。輸入刻意比實機刁鑽：1/2/3/127/128/129 的畸形 quantum、右聲道缺席/太短/太長。 |
| `worklet-diff-mutation.mjs` | **證明上面那支不是空的**。在**記憶體裡**（絕不寫回磁碟）對當前 worklet 植入四種 L/R 錯位突變——`carryR` 多切一個 sample、`joinCarry` 直接丟掉 carry、`joinCarry` 接反、`step` 寫死成 1——確認 `worklet-diff.mjs` 的比對**每一種都會轉紅**。一個抓不到 bug 的 harness 等於沒有 harness。 |

### 什麼時候必須跑

**動 `apps/web/public/pcm-worklet.js` 之前跑一次、之後再跑一次**，兩次都要三支全綠。之前那次是為了確認你是從一個乾淨的基準出發（不然事後紅了會分不清是誰弄的）。

改到 `apps/web/lib/audio-capture.ts` 的 node options（`channelCount`／`channelCountMode`／`channelInterpretation`／ChannelMergerNode 接線）或 `packages/shared` 的 `parseAudioChannels` 時也要跑——`worklet-check.mjs` 第 0 節直接讀 `audio-capture.ts` 的原始碼驗那幾個選項，而 worklet 裡的 `channels === 2 ? 2 : 1` 是 shared 那條規則**唯一被允許的複本**。

### 怎麼跑

在 **repo 根目錄**執行（三支都是零相依的原生 node ESM，不需要 install，也不需要先 build）：

```bash
node tools/worklet-check.mjs           # 約 10 秒
node tools/worklet-diff.mjs            # 約 1–2 分鐘（240 組態全跑）
node tools/worklet-diff-mutation.mjs   # 約 10 秒
```

三支都以 exit code 表示結果（0＝通過、1＝失敗），可以直接串起來：

```bash
node tools/worklet-check.mjs && node tools/worklet-diff.mjs && node tools/worklet-diff-mutation.mjs
```

> 這三支**沒有**掛在 `npm test` 底下（`apps/web` 目前沒有 test runner，本輪決定不為它另建一套 vitest）。也就是說 **CI 不會替你跑，你得自己跑**。

### 結果怎麼判讀

| 結果 | 意思 | 該做什麼 |
|---|---|---|
| 三支全綠（`ALL WORKLET CHECKS PASSED`＋`OUTPUT IS BYTE-FOR-BYTE IDENTICAL`＋`MUTATION CHECK PASSED`） | 你的改動沒有動到送上線的任何一個位元組 | 可以往下走 |
| `worklet-check` 紅 | **功能壞了**——L/R 對調、右聲道被左聲道汙染、frame 大小錯、或重取樣開始跑快（時鐘漂移）。訊息會指出是哪一個取樣率／聲道模式 | **一定是 bug，修掉**。不要改腳本去遷就程式 |
| `worklet-check` 綠、`worklet-diff` 紅 | 功能仍正確，但**輸出的位元組變了**。純重構絕不該出現這個結果 | 若這次**不是**刻意要改音訊 → 你的「重構」改到了行為，回頭找。若**是**刻意要改（例如換演算法）→ 先確認 check 全綠，讀過 worklet 檔頭那段 L/R 對齊說明，再把新檔複製成 `tools/pcm-worklet.baseline.js` 重建基準，並在 commit message 明講重建了基準。**默默重建基準等於把這道防線拆掉。** |
| `worklet-diff-mutation` 紅 | 有兩種可能：(a) `mutation "…" did not apply (source text moved)` ＝ 突變要找的那段原始碼被你改名／搬走了，**去把突變的字串改成新的寫法**，否則那條就是空跑；(b) 某個突變**沒被偵測到** ＝ 差分比對出現盲點，`worklet-diff.mjs` 的綠燈不能採信 | 先修好這支，再回頭看 `worklet-diff.mjs` 的結果 |

`tools/pcm-worklet.baseline.js` 是 `worklet-diff.mjs` 的比對對象——**它是資料，不是程式**，永遠不會被瀏覽器載入，除了刻意重建基準之外**不要編輯它**。它為什麼是一份實體檔案而不是 `git show <sha>:…`，理由寫在該檔檔頭。
