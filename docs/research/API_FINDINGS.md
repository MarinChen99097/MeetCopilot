# API 研究結論（載重假設，2026-07-06 實際查證）

> 來源＝研究工作流三個 agent（gemini-live-api / tab-audio-capture / gemini-image-gen），對照 ai.google.dev、MDN、caniuse、context7 `/googleapis/js-genai` v2.0.1。
> **這份是「寫計畫時不能猜、必須照的事實」。** 每個 model ID / 限制都標 VERIFIED 或 UNCERTAIN(連線時再確認)。
>（內部註記，不可攜：原始研究 brief 存於產生本檔的 session 工作目錄、不在 repo 內；本檔已收錄全部載重結論，後續模型以本檔為準。）

---

## A. Gemini Live API（語音模擬訓練用；**不用於會議 ASR**）

### A1. 關鍵結論：兩種用途的適配
- **(a) 被動轉寫會議「混音多人」音訊 → 不適合。** Live API 能轉寫輸入音訊（`inputAudioTranscription`），但**無 speaker diarization / 無 speaker label**（schema 裡沒有 speaker 欄位）。它是為「單一互動使用者 + VAD 輪替」設計，會把整個房間當成一個 user、套 barge-in、可能想回話、單場 ~15 分鐘上限、持續計 audio-in token。→ **會議 ASR 走專用串流 STT**（見 §D）。
- **(b) AI 扮演客戶做口語對練 → 強適配，這就是它的用途。** 雙向、低延遲、原生音訊、可打斷。**語音模擬訓練用 Live API。**

### A2. Model IDs（VERIFIED，from ai.google.dev/gemini-api/docs/models）
| Model ID | 角色 |
|---|---|
| `gemini-3.1-flash-live-preview` | 旗艦原生音訊 Live，高品質低延遲對話（模擬訓練首選） |
| `gemini-2.5-flash-native-audio-preview-12-2025` | 原生音訊 Live，次秒級串流（備選） |
| `gemini-3.5-live-translate-preview` | 語音對語音翻譯 70+ 語言（特化，暫不用） |
- **不要**拿一次性 TTS 模型當 Live：`gemini-3.1-flash-tts-preview` 等。
- UNCERTAIN：舊 half-cascade ID（`gemini-2.0-flash-live-001`）已不在清單，視為淘汰，連線時確認。

### A3. Transport ＋ SDK（VERIFIED）
- WebSocket 全雙工：`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`（**v1beta**）。
- Node SDK：`ai.live.connect({ model, config, callbacks })` → `Session`。SDK 自動送 `setup`。送：`session.sendRealtimeInput({ audio: { data, mimeType } })`；收：`callbacks.onmessage(LiveServerMessage)`；關：`session.close()`。
- **瀏覽器可直連、不外洩主 key ＝ 用 ephemeral token**：伺服器 `ai.authTokens.create({ config: { uses:1, expireTime, newSessionExpireTime } })` → 把 `token.name` 交給前端當 `apiKey`。**這讓模擬訓練的語音不必經我們伺服器中轉（延遲最小）。** UNCERTAIN：ephemeral token 歷來需在 client `httpOptions.apiVersion:'v1alpha'`，wiring 前確認。
- 沒有 ephemeral token 就**必須經伺服器 proxy**，絕不把原始 key 送瀏覽器。

### A4. 音訊 I/O（VERIFIED）
- 輸入：raw **16-bit PCM, 16kHz, mono, little-endian**，MIME `audio/pcm;rate=16000`，base64。結束送 `audioStreamEnd:true`。
- 輸出：raw **16-bit PCM, 24kHz**，chunk over socket。
- 打斷/barge-in：`serverContent.interrupted===true` → 前端停播、清佇列。
- VAD：預設自動（可調 `silenceDurationMs` 等）；也可手動 `activityStart/activityEnd`。
- 轉寫：`config` 開 `inputAudioTranscription:{}` / `outputAudioTranscription:{}` → `serverContent.inputTranscription/outputTranscription`（做即時字幕＋課後評分）。

### A5. Session 限制 ＋ 定價（VERIFIED）
- 單場：**音訊 ~15 分鐘**、單 WS 連線 ~10 分鐘。要更長：`contextWindowCompression`（延到近乎無限）+ `sessionResumption`（token 於結束後 2hr 有效，伺服器發 `GoAway` 前重連）。→ **模擬對練可能超過 15 分鐘，必須開這兩個。**
- 定價 `gemini-3.1-flash-live-preview`（付費 /1M token）：audio-in $3.00（≈$0.005/分）、audio-out **$12.00（≈$0.018/分，成本主項）**。一場 20 分鐘對練 ≈ 音訊 in+out 幾毛美金。UNCERTAIN：並發 session 上限依方案 tier，載入前查配額頁。

### A6. 最小 Node/TS（VERIFIED SDK surface）
```ts
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
const session = await ai.live.connect({
  model: 'gemini-3.1-flash-live-preview',
  config: {
    responseModalities: [Modality.AUDIO],
    systemInstruction: 'You are Dana, a skeptical VP of Ops… Grounding: <persona/product sheet>',
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    inputAudioTranscription: {}, outputAudioTranscription: {},
    // contextWindowCompression: {...}, sessionResumption: {...}  // 長對練必開
  },
  callbacks: {
    onmessage: (msg: LiveServerMessage) => {
      if (msg.data) playPcm24k(Buffer.from(msg.data, 'base64'));        // AI 語音
      const sc = msg.serverContent;
      if (sc?.outputTranscription?.text) appendAiCaption(sc.outputTranscription.text);
      if (sc?.inputTranscription?.text)  appendUserCaption(sc.inputTranscription.text);
      if (sc?.interrupted) stopPlaybackAndFlush();
    },
    onerror: (e)=>{}, onclose: (e)=>{},
  },
});
session.sendRealtimeInput({ audio: { data: base64Chunk, mimeType: 'audio/pcm;rate=16000' } });
```

---

## B. 雙帳號擷取 Meet 分頁音訊（會議模型的地基 → S1 spike）

### B1. 結論：**可行，但只在 Chromium 桌面，且有「同瀏覽器」硬限制**
`getDisplayMedia({ video:true, audio:true })` 擷取所選分頁的**渲染音訊輸出**＝該分頁播給喇叭的聲音。帳號 B 的 Meet 分頁作為真實與會者，渲染的是**遠端混音（報告者 A + 客戶）**，故擷取 B 的 Meet 分頁 ＝ 拿到 presenter+client 混音。這是會議轉寫類 web app 的成熟 pattern（Chrome 137+ 明確支援）。

### B2. 六個要點（VERIFIED）
1. **內容**：使用者在 picker 選 Meet 分頁並勾「Share tab audio」→ 拿到 Meet 混音。**只有「分頁」surface 有預勾的 share-tab-audio**；整螢幕只在 Win/ChromeOS 給系統音、window 音訊不穩。**用分頁 surface**。
2. **⚠️ 同瀏覽器約束（分頁路徑；2026-07-07 二次查核校準）**：picker 的「Chrome Tab」清單只列**同一個 Chromium instance** 的分頁——此為 UA 實作行為（W3C 規範/MDN 未載明，picker 內容屬實作自定），實務成立但無文件背書。**可靠路徑**＝B 的 Meet 分頁與 Copilot 擷取分頁放**同一個瀏覽器 profile**（帳號 A 用另一個 profile 分享簡報）。**跨 profile/瀏覽器有備援**：改選「Window」surface 也可附音訊（Chrome 文件稱 tab 與 window 皆提供音訊選項），但 window 音訊可得性隨 OS/版本浮動——S1 spike 兩條都驗，預設教學走同 profile 分頁路徑。
3. **權限**：`getDisplayMedia()` 每次需 transient activation（一次點擊），權限不可持久。→ Copilot UI 一顆「開始聆聽」鈕。
4. **擷取音軌不是麥克風**，預設無 AEC/降噪；為 ASR 乾淨度應顯式 `echoCancellation:false, noiseSuppression:false, autoGainControl:false`。
5. **背景執行**：擷取是 pipeline tap，Copilot 分頁被切到背景仍持續（發聲分頁豁免節流）。**用 AudioWorklet 不要 rAF/ScriptProcessor**。
6. **無自身麥克風/回音迴圈**：display-audio 與 mic 是不同來源；擷取分頁音訊不會拉到 B 的麥克風；B 在 Meet 靜音是雙保險；Copilot 只讀不回送 Meet，無迴圈。

### B3. 擷取管線（建議）
```
[Copilot 分頁點「開始聆聽」]  // transient activation
 → getDisplayMedia({ video:true, audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false} })
 → 使用者選 B 的 Meet 分頁 + 勾「Share tab audio」
 → stop() 掉 video track；留 audioTrack
 → 守衛：if getAudioTracks().length===0 → 提示重選並勾「share tab audio」（漏勾＝靜音流、無錯誤）
 → new AudioContext({ sampleRate:16000 }) → createMediaStreamSource → AudioWorkletNode
 → worklet: 降混 mono、Float32→Int16、post ~100–250ms frame
 → WebSocket → 串流 ASR
 → 監聽 audioTrack 'ended'（使用者按停止分享）→ 重新提示
```

### B4. 硬約束與風險（排序）
1. **必須引導使用者勾「Share tab audio」**；漏勾 → 靜音流無錯 → 必須偵測 `getAudioTracks().length===0` 並教學。checkbox 預設狀態 UNCERTAIN（版本/surface 相關）→ 一律建 zero-track 守衛。（S1 spike 驗）
2. **同瀏覽器（分頁路徑）＝UA 行為、非規範保證**（見 B2.2）→ 端到端實測真實 setup，並順驗 Window-surface 跨 profile 備援的音訊可得性。（S1 spike 驗）
3. **只 Chromium 桌面**：Chrome 74+/Edge 79+ ✅；**Brave ✅（2026-07-07 使用者裝置實測 9 項全 PASS**——UA 偽裝 Chrome 需 `navigator.brave.isBrave()` 判別；防指紋 farbling 對 Web Audio 加極微噪聲，理論上不影響 ASR，S2 順帶確認）；**Firefox ❌**（丟音訊無錯）、**Safari ❌**、**行動裝置全 ❌**。→ **硬性產品約束：報告者接收端限 Chromium 系桌面**。（注意：HUD 檢視端可以是手機，因為 HUD 只是看，不擷取。）
4. 分享 session 脆弱：按「停止分享」、耳機插拔、關分頁都會殺 track → 需健壯 `ended` 處理 + 重新提示。
5. 備援：`chrome.tabCapture` 更乾淨但**需 Chrome 擴充**（非純 web），日後要才做。

---

## C.（備選）Gemini 生圖——2026-07-07 起主力供應商改 OpenAI（見 §F），本節保留作備選參考

### C1. 結論：**AI 生圖預設走會前/預取路徑；會中即時以 CSS 路徑優先**（2026-07-07 二次查核校準）
延遲**無官方數字**（模型頁不給 SLA）；第三方稱 flash-lite 目標 sub-2s、flash 級 ~2–4s（1K）——**全部當工程估計、S5 spike 實測校準**，不得當事實引用。預設政策：**會中即時**用「沿用風格的 CSS 路徑」＋重用會前已生背景圖——理由除延遲變異外，更因**會中被內容安全誤擋（§C5）不可在客戶面前發生**。若 S5 實測 flash-lite 1K 穩定 <2–3s，可開「會中 1K 快速生圖」選配（嚴格逾時＋漸層 fallback），由使用者決定。

### C2. Model IDs（VERIFIED）— 用 `ai.models.generateContent`（Imagen 已淘汰，Aug 17 2026 關閉，不要用）
| Model ID | 別名 | 特性 |
|---|---|---|
| `gemini-3-pro-image`（**API 參數用 `gemini-3-pro-image-preview`**——`-preview` 是現行 API 字串，無後綴版是文件/model-card 代號） | Nano Banana Pro | 1K/2K/4K，官方定位「最佳 in-image 文字」：**單行文字錯誤率多 <10%（含亞洲語系，官方 heatmap）**——「97%」是第三方轉述、勿當官方數字；有 grounding，**延遲最高**（僅會前純視覺頁用） |
| `gemini-3.1-flash-image` | Nano Banana 2 | 通用主力，低延遲（背景圖用） |
| `gemini-3.1-flash-lite-image` | Nano Banana 2 Lite | **僅 1K**，最快最便宜 ~4s（要極速時用） |

### C3. 呼叫（VERIFIED）
- `config.imageConfig.aspectRatio: "16:9"`（支援）、`imageSize: "1K"|"2K"|"4K"`。回應 base64 在 `res.candidates[0].content.parts[].inlineData.data`（`.mimeType` 如 `image/png`）。
- 風格：無 style enum，用 prompt 文字（"minimalist corporate, muted navy, soft lighting, no words, negative space for text"）。
```ts
const res = await ai.models.generateContent({
  model: 'gemini-3.1-flash-image',
  contents: 'Atmospheric abstract corporate background, deep navy gradient, soft bokeh, generous negative space on the left, no words, no logos',
  config: { imageConfig: { aspectRatio: '16:9', imageSize: '2K' } },
});
for (const part of res.candidates![0].content!.parts!)
  if (part.inlineData?.data) buf = Buffer.from(part.inlineData.data, 'base64');
```

### C4. 兩路建議
- **(a) 背景圖＋CSS 真文字（產品預設）**：`gemini-3.1-flash-image`（1K/2K）或 `gemini-3.1-flash-lite-image`（1K 極速）。prompt 明講「no words / 留 negative space」。**保留 CSS 真文字疊層當預設**：文字可編輯、中文銳利、pptx 可用、是唯一能過會中延遲的路。
- **(b) 整頁生圖（純視覺、含中文 in-image 字）**：`gemini-3-pro-image-preview`（官方定位「最佳 in-image 文字」、亞洲語系錯誤率多 <10%；「flash 級中文 in-image 較弱」是推論非官方文件——S5 一併實測比較）。**預設只會前生**，接受其延遲/成本。

### C5. 安全與浮水印（VERIFIED）
- 內容安全會擋善意商業圖：高風險＝可辨識**人臉/公眾人物/品牌 logo**。→ **必須設 fallback**：被擋/空結果就退回漸層/CSS 背景，絕不讓會中出現壞掉的頁。Imagen 有 `personGeneration`/`includeRaiReason`。
- 浮水印：所有輸出帶 SynthID（付費 API 為隱形，不擾投影片）。

---

## D. 會議 ASR 路徑（因 A1(a) Live 不適合而獨立列出）

- **需求**：串流轉寫 + 混音多人。因雙帳號模型拿到的是一條混音，**diarization 走「轉逐字後 LLM 依內容/語氣推斷誰在講」**（DECISIONS 已定），不靠 STT 的 speaker label。
- **候選**：
  1. **Gemini 非 Live 音訊理解**（分段上傳轉寫，如 v1 做法）——同一把 key、最省事，MVP 首選；diarization 交給下游 LLM。
  2. Google Cloud Speech-to-Text v2（串流 + 原生 diarization + 長音訊）——品質更好但要另接 GCP。
- **決策**：MVP 用候選 1（沿用 v1 的 Gemini 分段轉寫），把 ASR 藏在 `AsrProvider` 介面後面，日後品質不足可換候選 2 不動上層。（這與 v1 WORKLOG「ASR flash-lite 音訊能力未實測」的待驗項一致 → 併入 S2 spike。）

## E. 文字與 embedding 模型（沿用 v1 實測；補列於此以符「model ID 不能猜」規則）

- `gemini-3.1-flash-lite`（文字/分析/生成主力）：**VERIFIED-in-v1**——v1 於 2026-07-05 對實際可用模型清單查證 API ID、並在生產流程實測（生成 0 空白頁）。v2 wiring 時以 models.list 再確認一次即可。
- `gemini-embedding-001`（embedding）：同上，v1 實測可用（flash-lite 非 embedding 模型，不可混用）。
- 兩者經 .env（`GEMINI_TEXT_MODEL`／`GEMINI_EMBED_MODEL`）可換，不寫死；生成品質不足時的升級路＝換 `gemini-3.5-flash`（.env 一行）。
- **`gemini-3.5-flash`（`GEMINI_EXTRACT_MODEL`，研究引擎爬蟲抽取專用）**：**已實測必要**（2026-07-08）——`gemini-3.1-flash-lite` 對「爬頁文字→CRM 結構化欄位」這種較複雜的結構化抽取**不穩**：會在某欄位吐雜引號使 JSON 結構坍縮（仍是合法 JSON 故不觸發重試、欄位靜默掉光）、或陷入 283KB unterminated string 的 runaway、或偷懶把描述塞錯欄位。改用 `gemini-3.5-flash` 後 CyberPower 台灣站抽出 industry/description/legalName（碩天科技）＋5 個產品、繁中乾淨無幻覺。故抽取單獨升 3.5-flash、一般文字維持 flash-lite。搭配 `maxOutputTokens` 上限（runaway fail-fast）＋`stripJsonFences`。

## F. OpenAI 生圖（主力供應商，2026-07-07 使用者拍板＋同日查證；決策 15）

### F1. Model 與呼叫（VERIFIED，developers.openai.com）
- 使用者說的「image-2」＝**`gpt-image-2`**（snapshot `gpt-image-2-2026-04-21`，2026-04 發布、5 月開放 API，現任旗艦）。全系列：`gpt-image-2`／`gpt-image-1.5`／`gpt-image-1`／**`gpt-image-1-mini`（便宜快速級）**。第三方路由的「gpt-5.4-image-2」等名稱不是 OpenAI API ID，勿用。
- Node SDK（openai npm）：`openai.images.generate({ model:'gpt-image-2', prompt, size, quality, moderation })` → **只回 base64**（`result.data[0].b64_json`，無 url 欄位）。參數：`size`、`quality: low|medium|high|auto`（預設 auto，可能自動選 high——**要顯式指定**）、`moderation: auto|low`、`background`（**不支援 transparent**）、`output_format: png|jpeg|webp`＋`output_compression`。
- Responses API 的 `image_generation` tool 是另一條路（model 填文字模型非 gpt-image-2）——我們用不到，直接 Image API 即可。

### F2. 尺寸（VERIFIED）——**原生支援真 16:9**
- gpt-image-2 接受**任意尺寸**，約束＝邊長 ≤3840、兩邊皆 16 的倍數、長寬比 ≤3:1。
- **投影片用 `1536x864`（精確 16:9，864=16×54）**；要 4K 用 `3840x2160`（慢且貴）。不需 cover-crop（留作 fallback）。

### F3. 中文 in-image 文字（部分 VERIFIED）
- 官方把「多語文字渲染（含中文）」列為 2.0 頭條功能（VERIFIED）；社群實測稱 CJK 字元級正確率 ~99%、繁中宋體/楷體無錯字（**UNCERTAIN——非官方量測，S5 用我們自己的繁中銷售字串實測**）。
- 工程立場不變：關鍵文案仍優先 CSS 真文字疊層；in-image 文字給純視覺頁。

### F4. 延遲與價格（延遲＝關鍵警訊）
- **延遲（UNCERTAIN、離散大，但方向確定：比 Gemini 慢一個量級）**：gpt-image-2 有 agentic 規劃階段——社群實測 medium 1024² ≈ **~80s**、high ≈ 180s+；較低品質 p50 約 8–25s。**→ 「會中即時生圖」對 gpt-image-2 完全不可行；「一律 pre-meeting」由此坐實**（比 Gemini 時代更堅定）。若未來要會中視覺選配，唯一候選是 `gpt-image-1-mini`＋low——S5 實測後另議。
- **價格（VERIFIED，token 計價）**：1024² 每張約 low **$0.006**／medium **$0.053**／high **$0.211**；尺寸放大等比增。背景圖用 low/medium 即可。

### F5. 前置與供應鏈（VERIFIED）
- **組織驗證必做**：呼叫任何 `gpt-image-*` 前，OpenAI console 要完成 API Organization Verification——**使用者的 onboarding 前置**，M0 就提醒。
- `.env`：`OPENAI_API_KEY`（生圖必填）＋`OPENAI_IMAGE_MODEL`（預設 gpt-image-2）。
- **溯源**：所有輸出強制帶 C2PA metadata＋SynthID 浮水印（不可關）；C2PA 記錄產生組織——內部簡報無妨，對外展示須知情。
- 內容審核：`moderation: auto`；被拒絕的 fallback（保留原頁/漸層）照舊必做（具體封鎖清單未公開，UNCERTAIN）。
- 費率上限：入門 tier 的每月影像請求數很低（~5–250/月依 tier）——**S5 前先查自己帳號的 tier 配額**。

### F6. 對從 Gemini 來的工程師的驚訝點（照抄進實作備忘）
base64-only（無 CDN url）；quality 預設 auto 可能挑 high（貴＋慢）——顯式給值；不支援透明背景；`input_fidelity` 在 gpt-image-2 不可調（edit 時輸入 token 偏貴）；Responses tool 的 model 欄位不是 gpt-image-2。

## G. 社群平台資料取得（2026-07-13 查證，完整報告＝`SOCIAL_CRAWL_FINDINGS.md`）

- **YouTube（VERIFIED）**：Data API v3 免費 10,000 units/日（channel/video/留言多為 1 unit、search 100 units）；Gemini 可原生理解公開 YouTube URL 內容。→ 本專案採官方 API（env `YOUTUBE_API_KEY`，缺則優雅跳過）。
- **Facebook／Instagram**：官方讀「他人」公開粉專需 PPCA（App Review＋商業驗證，門檻高、欄位有限）；無登入自爬封鎖最兇（三層反爬）。**2025-07-10 起 Google 開始索引 FB/IG 公開專業帳號** → Gemini grounding 成為最低成本情報層。→ 本專案採 **grounding-only**（使用者 2026-07-13 拍板）。
- **Threads**：官方 API 僅 keyword search 可讀公開貼文（需 review）、無「他人時間軸」端點；公開 profile/貼文頁**無登入可爬**（資料在頁內 `<script>` JSON），封鎖較 FB/IG 寬鬆。→ 本專案自建 Playwright best-effort。
- **ToS/法律**：Meta v. Bright Data（2024-01）裁決——ToS 只禁**登入態**爬取。→ 本專案一律不做登入態爬取。
- 第三方資料服務（Apify 約 $0.5–2 美元/千則貼文、Bright Data $1.5/千則）已查證**未採用**；FB/IG 深度日後不足時的升級路徑。
