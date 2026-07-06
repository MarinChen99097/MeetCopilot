# API 研究結論（載重假設，2026-07-06 實際查證）

> 來源＝研究工作流三個 agent（gemini-live-api / tab-audio-capture / gemini-image-gen），對照 ai.google.dev、MDN、caniuse、context7 `/googleapis/js-genai` v2.0.1。
> **這份是「寫計畫時不能猜、必須照的事實」。** 每個 model ID / 限制都標 VERIFIED 或 UNCERTAIN(連線時再確認)。
> 完整原始 brief 在 workflow journal（`subagents/workflows/wf_dd7636ee-fde/journal.jsonl`）。

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
2. **⚠️ 同瀏覽器硬限制（關鍵）**：picker 的「Chrome Tab」清單只含**同一個 Chromium instance** 的分頁。所以 **B 的 Meet 分頁與 B 的 Copilot 分頁必須在同一個瀏覽器/profile**。「兩個瀏覽器」的說法是陷阱——正解是：帳號 A（報告）用一個 profile 分享簡報；帳號 B（接收）用**另一個 profile**，B 的 profile 裡有 [Meet 分頁] + [Copilot 擷取分頁] 兩個分頁，Copilot 擷取 Meet 分頁。
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
2. **同瀏覽器**（見 B2.2）→ 端到端實測真實 setup。（S1 spike 驗）
3. **只 Chromium 桌面**：Chrome 74+/Edge 79+ ✅；**Firefox ❌**（丟音訊無錯）、**Safari ❌**、**行動裝置全 ❌**。→ **硬性產品約束：報告者接收端限 Chrome/Edge 桌面**。（注意：HUD 檢視端可以是手機，因為 HUD 只是看，不擷取。）
4. 分享 session 脆弱：按「停止分享」、耳機插拔、關分頁都會殺 track → 需健壯 `ended` 處理 + 重新提示。
5. 備援：`chrome.tabCapture` 更乾淨但**需 Chrome 擴充**（非純 web），日後要才做。

---

## C. Gemini 生圖（DynamicSlide 第二生成路徑；**一律 pre-meeting**）

### C1. 結論：**整頁生圖無法進 <4s 會中預算 → 所有 AI 生圖是會前/預取路徑**
最快模型光生成就 ~2–4s（1K），還沒算 prompt 組裝 + 網路 + base64 解碼 + 渲染。**會中即時**只用「沿用風格的 CSS 路徑」（快）＋重用會前已生的背景圖；**不在會中跑整頁生圖**。

### C2. Model IDs（VERIFIED）— 用 `ai.models.generateContent`（Imagen 已淘汰，Aug 17 2026 關閉，不要用）
| Model ID | 別名 | 特性 |
|---|---|---|
| `gemini-3-pro-image` | Nano Banana Pro | 1K/2K/4K，**最佳 in-image 文字 97%（含中文）**，有 grounding，**延遲最高**（僅會前純視覺頁用） |
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
- **(b) 整頁生圖（純視覺、含中文 in-image 字）**：`gemini-3-pro-image`（唯一可信中文 in-image 97%）。**只會前生**，接受其延遲/成本。

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
