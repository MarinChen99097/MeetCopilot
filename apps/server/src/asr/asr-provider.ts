/**
 * AsrProvider — M3 frozen interface (M234_CONTRACT §M3). NO IMPLEMENTATION here.
 * The M3 build agent implements against this signature (borrows v1; Gemini segmented transcription).
 * Behind this seam so a future swap to Google STT v2 (S2) touches nothing else.
 * Audio in = raw 16-bit LE PCM 16kHz mono frames (API_CONTRACT §6). External sockets MUST be bounded (deadline+kill, L13).
 * `mono` is still exact for a stereo (`channels=2`) capture: `realtime/hub.ts`'s `pushAudio` de-interleaves the
 * frame ONE LAYER UPSTREAM and drives two provider instances (left = presenter, right = client), so an
 * implementation of this seam never sees interleaved data and needs no channel handling of its own.
 *
 * 雙軌之後新增的：
 *  - `AsrFrameContext`（`pushAudio` 第三參數，**必填**）：hub 隨每個 frame 下傳的擷取脈絡。
 *    **音訊時鐘的所有權因此上移到 session 層**（`LiveSessionRuntime.advanceAudioClock`）——右軌是會議中途
 *    才 lazily 建立的，若讓每個 provider 各自從 0 起算樣本數，兩軌的 `AsrSegment.t` 就會相差整個 mono 時段
 *    （分析滾動窗會單向清空客戶那一路，HUD/DB 時間軸也錯亂）。**必填是刻意的**：時鐘只能有一個擁有者，
 *    留一條「不給脈絡就自己數樣本」的後路等於在型別上宣告有第二個時鐘擁有者（實作端也真的養了一份
 *    永遠沒人讀的計數）。既有實作只要多收一個它可以忽略的參數即可（0/2 參數的函式仍然相容）。
 *  - `AsrSegment.channels`（**選配**）：這一段音訊**被擷取當下**的聲道模式。speaker 判定必須看它而不是
 *    「final 抵達當下的模式」——轉寫是非同步的，模式在段落飛行途中可能已經換過。缺席時下游 fallback 到
 *    `runtime.audioChannels`（測試與精簡替身會直接注入兩欄位的 segment）。
 *  - `flushPending()`（**選配**）：模式切換時由 hub 強制切段，避免一段音訊橫跨 mono／stereo 兩種語意。
 */
import type { AudioChannels } from "@meetcopilot/shared";

/**
 * 一個 capture frame 的擷取脈絡（由 `realtime/hub.ts` 隨 frame 下傳；同一個 stereo frame 的左右兩軌共用同一份）。
 */
export interface AsrFrameContext {
  /**
   * 這個 frame 的**起點**在本場共用音訊時鐘上的位置（ms）。
   * 單一真相在 `LiveSessionRuntime.advanceAudioClock`——不論哪一軌、何時建立，拿到的都是同一條時間軸。
   */
  tMs: number;
  /** 這個 frame 的擷取模式：1＝mono 混音、2＝stereo（已在 hub 拆成兩條純 mono）。 */
  channels: AudioChannels;
}

/** A finalized transcript segment emitted by ASR (minimal shape; speaker inference happens downstream). */
export interface AsrSegment {
  t: number; // ms
  text: string;
  /**
   * 這一段音訊**被擷取當下**的聲道模式（切段起點的快照，來自 `AsrFrameContext.channels`）。
   * 缺席＝呼叫端沒給脈絡 → 下游 fallback 到「目前模式」（舊行為）。
   *
   * **維持選配是刻意的**（不要「順手」改成必填）：`checklist.test.ts`／`mid-meeting-crm.test.ts` 直接注入
   * 兩欄位的 `{t, text}` literal，而 `hub.wireAsr` 的 `seg.channels ?? runtime.audioChannels` 那條 fallback
   * 是**真的會被取到**的（`stereo-audio.test.ts` 兩條 speaker 測試正是靠它）。
   */
  channels?: AudioChannels;
}

export interface AsrProvider {
  /** Accumulate a binary PCM frame for a session（`ctx` 必填：段落時間軸只能來自 session 共用時鐘）。 */
  pushAudio(sessionId: string, pcm: Buffer, ctx: AsrFrameContext): void;
  /** Register the final-segment callback (final segment → analysis). */
  onFinal(cb: (seg: AsrSegment) => void): void;
  /**
   * 強制把緩衝中的殘料切成一段送轉寫（hub 在**聲道模式切換**時呼叫）。
   * 選配：未實作＝維持「只有 4 秒硬切／靜音切」的原行為。
   */
  flushPending?(): void;
}
