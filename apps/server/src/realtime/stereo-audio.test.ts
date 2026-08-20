/**
 * 雙聲道擷取（API_CONTRACT §6 `channels=2`）的回歸測試。
 *
 * 為什麼這一支必須存在：`chunker` / `asr` 在此之前**完全沒有測試**，而 `checklist.test.ts` 的音訊時鐘測試是
 * 直接注入 `t` 值、繞過 PCM 路徑的——也就是說「交錯資料誤流進 Chunker 讓音訊時鐘跑兩倍快」這種迴歸，
 * 現有測試一條都抓不到。本次改動的正確性完全押在 `hub.pushAudio` 那一層有沒有把 buffer 拆乾淨，
 * 所以在這裡把它釘死：
 *   1. deinterleave 正確性（已知交錯 buffer → 兩條各自正確）
 *   2. 長度非 4 倍數時尾端丟棄，且**連續兩個這種 frame 不會讓 L/R 對調**（最難查的無聲 bug）
 *   3. mono 路徑逐位元不受影響（原 Buffer 原樣進單一 provider，且不會多建一條軌）
 *   4. `channels` 解析 fail-safe（缺席／空字串／"abc"／"3" 全落 mono）
 *   5. consent gate 在 stereo 下仍然有效（兩路都不推、也不建右軌）
 *   6. `dispose()` 兩軌都 reset（漏掉第二軌＝consent 撤回後客戶那路仍在轉寫＝隱私破口）
 *
 * 第二批（對抗式 review 抓出的三個缺口，都建立在「同一場 runtime 先 mono 後 stereo」這條**正常操作路徑**上）：
 *   7. **共用音訊時鐘**：中途才建立的右軌與左軌落在同一條時間軸（各自從 0 起算會讓分析滾動窗單向清空客戶那路）
 *   8. **模式切換不錯貼 speaker**：跨切換點的緩衝音訊以**擷取當下**的模式結算，mono 混音絕不會變成 `presenter`
 *   9. **stereo→mono 反向**：右軌殘留的客戶語音在切換點被切出去（不遺失、不與數分鐘後的音訊黏在一起）
 *  10. **告警去重升到 session 層**：兩軌同時中斷只發一次 toast，全部恢復後下次中斷仍會發
 *
 * 7–9 必須跑**真的 chunker**（`spyTranscribe` 而不是 `spyPushAudio`）——這三個 bug 正是躲在「把 chunker
 * 整個 mock 掉」的測試盲區裡。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { WebSocket } from "ws";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { parseAudioChannels, type AudioChannels } from "@meetcopilot/shared";
import { RealtimeHub } from "./hub.js";
import { deinterleaveStereo } from "./stereo.js";
import type { GeminiAsrProvider } from "../asr/gemini-asr.js";
import type { LiveSessionRuntime } from "./session-runtime.js";
import { RollingWindowAnalysisEngine } from "../analysis/gemini-analysis.js";
import type { AsrSegment } from "../asr/asr-provider.js";
import { createGeminiClient } from "../gemini.js";
import type { GeminiClient } from "../gemini.js";
import { fakeSocket, testConfig, tick } from "./test-support.js";
import type { ConnMeta } from "./types.js";

/** Int16 samples → interleaved stereo PCM16LE (L first). `l[i]`/`r[i]` are the i-th sample-pair. */
function interleave(l: number[], r: number[]): Buffer {
  const buf = Buffer.alloc(l.length * 4);
  for (let i = 0; i < l.length; i++) {
    buf.writeInt16LE(l[i]!, i * 4);
    buf.writeInt16LE(r[i]!, i * 4 + 2);
  }
  return buf;
}

/** Mono PCM16LE Buffer → Int16 array (assertion helper; independent of production decode paths). */
function toInt16(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i * 2 < buf.byteLength; i++) out.push(buf.readInt16LE(i * 2));
  return out;
}

/** A live hub + materialized runtime for `meta` (capture role). Caller must `hub.disposeAll()` + `core.close()`. */
async function liveHub(channels?: AudioChannels) {
  const core: CrmCore = await createCrmCore(":memory:");
  await core.migrate();
  const cfg = testConfig();
  const hub = new RealtimeHub(core, cfg, createGeminiClient(cfg.gemini));
  const org = await core.orgs.create({ name: "Org" });
  const meeting = await hub.store.create(org.id, { title: "M", presenterUserId: "pres" });
  hub.registerMeeting(meeting.id, { orgId: org.id, presenterUserId: "pres" });
  const meta: ConnMeta = {
    userId: "pres",
    orgId: org.id,
    meetingId: meeting.id,
    role: "capture",
    isPresenter: true,
    channels,
  };
  hub.attach(fakeSocket() as unknown as WebSocket, meta);
  await tick();
  const runtime = hub.getRuntime(meeting.id)!;
  return { core, hub, meta, runtime };
}

/**
 * The prototype the hub's OWN provider instances actually use.
 *
 * ⚠️ Deliberately `Object.getPrototypeOf(liveInstance)` rather than the imported `GeminiAsrProvider.prototype`:
 * vitest occasionally evaluates a module twice inside one run, and then this file's imported class object is a
 * DIFFERENT object from the one `hub.ts` constructed with — a spy on the imported `.prototype` silently never
 * fires (observed in this repo as `expected [] to have a length of 1`, and as the same-shaped
 * `emit is not a function` / `to be an instance of I1ViolationError` flakes elsewhere). Resolving the prototype
 * from a live instance is immune: it is by definition the object those instances dispatch through.
 * The lazily-built right track comes from the same `hub.ts` module, so it shares this prototype.
 */
function livePrototype(runtime: LiveSessionRuntime): GeminiAsrProvider {
  return Object.getPrototypeOf(runtime.asr) as GeminiAsrProvider;
}

/** Record every `pushAudio` on any provider the hub owns (left track + the lazily-built right one). */
function spyPushAudio(runtime: LiveSessionRuntime) {
  const calls: { self: unknown; sessionId: string; pcm: Buffer }[] = [];
  vi.spyOn(livePrototype(runtime), "pushAudio").mockImplementation(function (
    this: GeminiAsrProvider,
    sessionId: string,
    pcm: Buffer,
  ) {
    calls.push({ self: this, sessionId, pcm });
  });
  return calls;
}

/** Record every `reset()` (the dispose/privacy path) on any provider the hub owns. */
function spyReset(runtime: LiveSessionRuntime) {
  const resets: unknown[] = [];
  vi.spyOn(livePrototype(runtime), "reset").mockImplementation(function (this: GeminiAsrProvider) {
    resets.push(this);
  });
  return resets;
}

/**
 * The final-segment callback the hub registered on a provider (`hub.wireAsr` → `asr.onFinal(cb)`).
 *
 * Read straight off the instance instead of spying on `onFinal`: the left track's callback is registered
 * during `ensureRuntime`, i.e. BEFORE any instance exists to derive a prototype from, so the spy would have to
 * go through the imported class — the exact fragility described in `livePrototype`. Reading the field the hub
 * just wrote is deterministic; if it is ever renamed this fails loudly instead of flaking.
 */
function finalCbOf(asr: unknown): (seg: AsrSegment) => void {
  const cb = (asr as { finalCb?: (seg: AsrSegment) => void }).finalCb;
  if (typeof cb !== "function") throw new Error("hub did not register an onFinal callback on this ASR track");
  return cb;
}

/** The outage / recovery callbacks the hub registered on a track (same rationale as `finalCbOf`). */
function outageCbOf(asr: unknown): () => void {
  const cb = (asr as { unavailableCb?: () => void }).unavailableCb;
  if (typeof cb !== "function") throw new Error("hub did not register an onUnavailable callback on this ASR track");
  return cb;
}
function recoveryCbOf(asr: unknown): () => void {
  const cb = (asr as { availableCb?: () => void }).availableCb;
  if (typeof cb !== "function") throw new Error("hub did not register an onAvailable callback on this ASR track");
  return cb;
}

/** Attach a HUD socket that records the transcript segments broadcast to it (I3 target for transcripts). */
function attachHud(hub: RealtimeHub, meta: ConnMeta) {
  const segments: { speaker: string; text: string }[] = [];
  const sock = {
    OPEN: 1 as const,
    readyState: 1,
    send(data: string): void {
      const msg = JSON.parse(data) as { type: string; segment?: { speaker: string; text: string } };
      if (msg.type === "transcript" && msg.segment) segments.push(msg.segment);
    },
    close(): void {
      sock.readyState = 3;
    },
  };
  hub.attach(sock as unknown as WebSocket, { ...meta, role: "hud" });
  return segments;
}

/** Attach a HUD socket that records the `error` codes broadcast to it (I3 target for asr_unavailable). */
function attachHudErrors(hub: RealtimeHub, meta: ConnMeta): string[] {
  const codes: string[] = [];
  const sock = {
    OPEN: 1 as const,
    readyState: 1,
    send(data: string): void {
      const msg = JSON.parse(data) as { type: string; code?: string };
      if (msg.type === "error" && msg.code) codes.push(msg.code);
    },
    close(): void {
      sock.readyState = 3;
    },
  };
  hub.attach(sock as unknown as WebSocket, { ...meta, role: "hud" });
  return codes;
}

/** 250ms @16kHz — the real capture frame size. */
const FRAME_SAMPLES = 4_000;

/**
 * 一段**非靜音**的 mono PCM16LE（RMS 遠高於 SILENCE_RMS_THRESHOLD=400）。
 * 刻意不用 0：靜音會在 ≥1 秒時提前切段，切點就不再由「4 秒硬切」決定，測試也就失去可預期的段落邊界。
 */
function monoFrame(samples: number, value = 8_000): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(value, i * 2);
  return buf;
}

/**
 * 一段**安靜但確實有人講話**的 mono：只有開頭 `loudSamples` 個取樣是人聲，其餘是數位靜音。
 * 用來釘住「丟棄靜音段」的判準是 **peak** 而不是 RMS（見該測試的算式）。
 */
function burstFrame(samples: number, loudSamples: number, value = 8_000): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < loudSamples; i++) buf.writeInt16LE(value, i * 2);
  return buf;
}

/** 同上，但交錯成 stereo（左右給不同值，拆錯軌會立刻看得出來）。 */
function stereoFrame(samples: number, l = 8_000, r = -8_000): Buffer {
  const buf = Buffer.alloc(samples * 4);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(l, i * 4);
    buf.writeInt16LE(r, i * 4 + 2);
  }
  return buf;
}

/** 連推 `count` 個 250ms frame（`channels` 決定模式）。 */
function pushFrames(hub: RealtimeHub, meta: ConnMeta, channels: AudioChannels, count: number): void {
  const frame = channels === 2 ? stereoFrame(FRAME_SAMPLES) : monoFrame(FRAME_SAMPLES);
  for (let i = 0; i < count; i++) hub.pushAudio({ ...meta, channels }, frame);
}

/** One chunker cut that actually reached the transcription call. */
interface Cut {
  self: unknown;
  tMs: number;
  channels?: AudioChannels;
  samples: number;
}

/**
 * Record every segment the REAL chunker cuts out (`tMs` / captured `channels` / sample count).
 *
 * ⚠️ Deliberately spies the provider-private `transcribe`: with no GEMINI_API_KEY the upstream call always
 * throws, so `onFinal` never fires and this is the ONLY seam where a cut is observable. Everything above it
 * (`spyPushAudio`) mocks the chunker away entirely, which is exactly what the clock/mode-switch bugs hid behind.
 * Prototype resolved via `livePrototype` for the module-duplication reason documented there; a rename fails
 * loudly (`transcribe` missing) instead of silently recording nothing.
 */
function spyTranscribe(runtime: LiveSessionRuntime): Cut[] {
  const cuts: Cut[] = [];
  const proto = livePrototype(runtime) as unknown as {
    transcribe: (wav: Buffer, tMs: number, channels?: AudioChannels) => Promise<void>;
  };
  if (typeof proto.transcribe !== "function") throw new Error("GeminiAsrProvider.transcribe not found on prototype");
  vi.spyOn(proto, "transcribe").mockImplementation(function (
    this: unknown,
    wav: Buffer,
    tMs: number,
    channels?: AudioChannels,
  ) {
    cuts.push({ self: this, tMs, channels, samples: (wav.byteLength - 44) / 2 }); // 44 = WAV header
    return Promise.resolve();
  });
  return cuts;
}

const cutsOf = (cuts: Cut[], track: unknown): Cut[] => cuts.filter((c) => c.self === track);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deinterleaveStereo (interleaved Int16 LE, left first)", () => {
  it("splits a known frame into two correct mono buffers", () => {
    const pcm = interleave(Array(8).fill(1000), Array(8).fill(-1000));
    expect(pcm.byteLength).toBe(32); // 8 pairs × 4 bytes

    const { left, right } = deinterleaveStereo(pcm);
    expect(left.byteLength).toBe(16); // 8 mono samples
    expect(right.byteLength).toBe(16);
    expect(toInt16(left)).toEqual(Array(8).fill(1000));
    expect(toInt16(right)).toEqual(Array(8).fill(-1000));
  });

  it("preserves per-sample ORDER and offsets (a ramp, so an off-by-one pair would show)", () => {
    const l = [1, 2, 3, 4, 5];
    const r = [-11, -12, -13, -14, -15];
    const { left, right } = deinterleaveStereo(interleave(l, r));
    expect(toInt16(left)).toEqual(l);
    expect(toInt16(right)).toEqual(r);
  });

  it("real 250ms frame: 16000 bytes → two 8000-byte mono buffers (4000 samples each)", () => {
    const pairs = 4000;
    const pcm = interleave(Array(pairs).fill(32767), Array(pairs).fill(-32768));
    expect(pcm.byteLength).toBe(16_000);
    const { left, right } = deinterleaveStereo(pcm);
    expect(left.byteLength).toBe(8_000);
    expect(right.byteLength).toBe(8_000);
    // Extremes survive the byte-wise copy untouched (no sign/endianness damage).
    expect(toInt16(left).every((v) => v === 32767)).toBe(true);
    expect(toInt16(right).every((v) => v === -32768)).toBe(true);
  });

  it("drops a trailing partial sample-pair and NEVER flips L/R on the next frame", () => {
    // 3 complete pairs + 2 stray bytes (a lone left sample with no right partner).
    const complete = interleave([1, 2, 3], [-1, -2, -3]);
    const stray = Buffer.alloc(2);
    stray.writeInt16LE(999, 0);
    const frame = Buffer.concat([complete, stray]);
    expect(frame.byteLength).toBe(14); // 14 % 4 === 2

    const first = deinterleaveStereo(frame);
    expect(toInt16(first.left)).toEqual([1, 2, 3]); // stray 999 discarded, not carried
    expect(toInt16(first.right)).toEqual([-1, -2, -3]);
    expect(toInt16(first.left)).not.toContain(999);
    expect(toInt16(first.right)).not.toContain(999);

    // THE bug this guards: if the leftover byte-pair were carried (or the alignment were `% 2` like the mono
    // `pcmBufferToInt16`), the next frame would start on a RIGHT sample → presenter/client silently swapped
    // for the rest of the meeting. Stateless `% 4` truncation ⇒ frame N+1 is split identically to frame N.
    const second = deinterleaveStereo(frame);
    expect(toInt16(second.left)).toEqual([1, 2, 3]);
    expect(toInt16(second.right)).toEqual([-1, -2, -3]);

    // Same guarantee across N frames (parity never drifts).
    for (let i = 0; i < 5; i++) {
      const s = deinterleaveStereo(frame);
      expect(toInt16(s.left)).toEqual([1, 2, 3]);
      expect(toInt16(s.right)).toEqual([-1, -2, -3]);
    }
  });

  it("a fragment shorter than one pair (and an empty buffer) yields two empty buffers", () => {
    for (const len of [0, 1, 2, 3]) {
      const { left, right } = deinterleaveStereo(Buffer.alloc(len));
      expect(left.byteLength).toBe(0);
      expect(right.byteLength).toBe(0);
    }
  });
});

describe("parseAudioChannels handshake fail-safe (API_CONTRACT §6)", () => {
  it('only the literal "2" is stereo; everything else falls back to mono', () => {
    expect(parseAudioChannels("2")).toBe(2); // the ONLY stereo case
    // Back-compat + junk: absent (/sim's mp3-capture.ts never sends it), empty, garbage, out-of-range.
    for (const v of [null, "", "1", "abc", "3", "0", "-2", "2.0", "02", " 2", "2 ", "two", "TWO", "1,2"]) {
      expect(parseAudioChannels(v)).toBe(1);
    }
  });
});

describe("RealtimeHub.pushAudio channel routing", () => {
  it("mono (channels absent) passes the frame through byte-identical to a SINGLE track", async () => {
    const { core, hub, meta, runtime } = await liveHub(undefined);
    try {
      runtime.consent = true;
      const calls = spyPushAudio(runtime);
      const frame = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

      hub.pushAudio(meta, frame);

      expect(calls).toHaveLength(1);
      expect(calls[0]!.self).toBe(runtime.asr); // the one and only track
      expect(calls[0]!.sessionId).toBe(meta.meetingId);
      expect(calls[0]!.pcm).toBe(frame); // same object → not copied, not split, not re-encoded
      expect(runtime.asrRight).toBeUndefined(); // no second provider built for a mono meeting
      expect(runtime.audioChannels).toBe(1);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("channels=1 behaves exactly like mono", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      runtime.consent = true;
      const calls = spyPushAudio(runtime);
      const frame = interleave([1, 2], [3, 4]); // bytes are irrelevant in mono — must NOT be split
      hub.pushAudio(meta, frame);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.pcm).toBe(frame);
      expect(runtime.asrRight).toBeUndefined();
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("stereo splits one frame into left→track A (presenter) and right→track B (client)", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      runtime.consent = true;
      const calls = spyPushAudio(runtime);
      const frame = interleave([10, 20, 30, 40], [-10, -20, -30, -40]);

      hub.pushAudio(meta, frame);

      expect(calls).toHaveLength(2);
      expect(runtime.asrRight).toBeDefined();
      expect(runtime.audioChannels).toBe(2);

      const leftCall = calls.find((c) => c.self === runtime.asr)!;
      const rightCall = calls.find((c) => c.self === runtime.asrRight)!;
      expect(leftCall).toBeDefined();
      expect(rightCall).toBeDefined();
      expect(toInt16(leftCall.pcm)).toEqual([10, 20, 30, 40]); // left = mic = presenter
      expect(toInt16(rightCall.pcm)).toEqual([-10, -20, -30, -40]); // right = tab audio = client
      expect(leftCall.sessionId).toBe(meta.meetingId);
      expect(rightCall.sessionId).toBe(meta.meetingId);

      // The right track is built ONCE and reused (no per-frame provider churn).
      const rightProvider = runtime.asrRight;
      hub.pushAudio(meta, frame);
      expect(calls).toHaveLength(4);
      expect(runtime.asrRight).toBe(rightProvider);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("consent gate: stereo frames push NEITHER track and build no right provider until consent", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      const calls = spyPushAudio(runtime);
      expect(runtime.consent).toBe(false); // default: no analysis before consent (M5 §A)

      hub.pushAudio(meta, interleave([1, 2, 3], [-1, -2, -3]));

      expect(calls).toHaveLength(0); // BOTH channels blocked, not just the left one
      expect(runtime.asrRight).toBeUndefined(); // gate sits BEFORE the lazy right-track build

      // Positive control: once consent is granted both tracks flow.
      runtime.consent = true;
      hub.pushAudio(meta, interleave([1, 2, 3], [-1, -2, -3]));
      expect(calls).toHaveLength(2);

      // …and revoking consent stops both again.
      runtime.consent = false;
      hub.pushAudio(meta, interleave([1, 2, 3], [-1, -2, -3]));
      expect(calls).toHaveLength(2);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("a capture that switches back to mono mid-session stops being treated as stereo", async () => {
    // Real scenario: the presenter reconnects after DENYING mic permission → the frontend falls back to mono
    // on the SAME meeting (the runtime survives the disconnect grace period). A sticky "once stereo, always
    // stereo" flag would keep labelling the mixed audio as `presenter` forever.
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      runtime.consent = true;
      const calls = spyPushAudio(runtime);
      hub.pushAudio(meta, interleave([1, 2], [-1, -2]));
      expect(runtime.audioChannels).toBe(2);
      expect(calls).toHaveLength(2);

      const monoFrame = Buffer.from([9, 9, 8, 8]);
      hub.pushAudio({ ...meta, channels: 1 }, monoFrame);

      expect(runtime.audioChannels).toBe(1); // mirror follows the CURRENT frame, it does not stick
      expect(calls).toHaveLength(3);
      expect(calls[2]!.self).toBe(runtime.asr); // mono → left track only…
      expect(calls[2]!.pcm).toBe(monoFrame); // …and byte-identical (not split)
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("a stereo frame too short for one sample-pair pushes nothing and builds no right track", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      runtime.consent = true;
      const calls = spyPushAudio(runtime);
      hub.pushAudio(meta, Buffer.alloc(3)); // < 4 bytes → no complete pair
      expect(calls).toHaveLength(0);
      expect(runtime.asrRight).toBeUndefined();
    } finally {
      hub.disposeAll();
      core.close();
    }
  });
});

describe("speaker is decided by the CHANNEL in stereo (LLM inferSpeaker bypassed)", () => {
  it("left track → presenter, right track → client (an LLM guess could not produce either)", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      const hudSegments = attachHud(hub, meta);
      await tick();
      runtime.consent = true;

      hub.pushAudio(meta, interleave([1, 2], [-1, -2])); // materializes + wires the right track
      expect(runtime.asrRight).toBeDefined();

      finalCbOf(runtime.asr)({ t: 1_000, text: "我們這個方案可以幫你們把導入時間縮短一半" });
      finalCbOf(runtime.asrRight)({ t: 2_000, text: "價格聽起來有點超出我們今年的預算" });
      await tick();

      expect(hudSegments).toHaveLength(2);
      expect(hudSegments[0]!.speaker).toBe("presenter"); // left = microphone
      expect(hudSegments[1]!.speaker).toBe("client"); // right = tab audio
      // This IS the proof that `inferSpeaker` was bypassed: Gemini is unconfigured here, so the LLM path can
      // only ever return "unknown" (see the mono control below). presenter/client can come from nowhere else.
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("mono STILL goes through inferSpeaker (the mic-denied fallback path must keep working)", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      const hudSegments = attachHud(hub, meta);
      await tick();
      runtime.consent = true;

      hub.pushAudio(meta, Buffer.alloc(8));
      finalCbOf(runtime.asr)({ t: 1_000, text: "這樣的話我們下一步怎麼安排" });
      await tick();

      expect(hudSegments).toHaveLength(1);
      // Unconfigured Gemini → inferSpeaker degrades to "unknown" (unchanged mono behaviour). The contrast with
      // the stereo case above is exactly what proves the two paths are still distinct.
      expect(hudSegments[0]!.speaker).toBe("unknown");
      expect(runtime.asrRight).toBeUndefined();
    } finally {
      hub.disposeAll();
      core.close();
    }
  });
});

describe("analysis window carries the speaker into the prompt", () => {
  /** GeminiClient stand-in that records the prompt it was asked to run. */
  function recordingGemini(prompts: string[]): GeminiClient {
    const usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };
    return {
      isConfigured: () => true,
      embed: async () => [],
      embedMetered: async () => ({ value: [] as number[], usage }),
      generateJson: async <T>(opts: { prompt: string }) => {
        prompts.push(opts.prompt);
        return { signals: [] } as T;
      },
      generateJsonMetered: async <T>(opts: { prompt: string }) => {
        prompts.push(opts.prompt);
        return { value: { signals: [] } as T, usage };
      },
      generateGrounded: async () => ({ answer: "", citations: [] }),
    } as unknown as GeminiClient;
  }

  it('prefixes 報告者／客戶 and leaves an unknown speaker BARE (never "未知：")', async () => {
    const prompts: string[] = [];
    const engine = new RollingWindowAnalysisEngine(recordingGemini(prompts), "model-x", "sess-stereo");
    engine.onSignals(() => {});

    // The engine throttles analysis to one call per 5s, so push the wall clock forward (Date.now only —
    // `t` is the AUDIO clock and must stay untouched) to get a second analysis that sees the whole window.
    const realNow = Date.now;
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);

    engine.ingest("sess-stereo", { t: 0, text: "我們的導入時間大約兩週" }, "presenter");
    engine.ingest("sess-stereo", { t: 1_000, text: "兩週會不會太趕" }, "client");
    engine.ingest("sess-stereo", { t: 2_000, text: "背景有人在講話" }, "unknown");
    await tick(30);
    skew = 10_000;
    engine.ingest("sess-stereo", { t: 3_000, text: "沒有帶說話者的舊呼叫" }); // mono/legacy 2-arg call site
    await tick(30);

    expect(prompts.length).toBeGreaterThan(0);
    const prompt = prompts[prompts.length - 1]!;
    expect(prompt).toContain("報告者：我們的導入時間大約兩週");
    expect(prompt).toContain("客戶：兩週會不會太趕");
    expect(prompt).toContain("\n背景有人在講話"); // bare line, no prefix
    expect(prompt).toContain("\n沒有帶說話者的舊呼叫");
    expect(prompt).not.toContain("未知"); // a fake third participant would confuse the model
    expect(prompt).not.toContain("unknown：");
  });

  // ── 滾動窗的上限＝**字元預算**（WINDOW_MAX_CHARS=300），不是段數 ─────────────────────
  // 段數上限在兩種擷取模式下不是同一個量：stereo 時兩條 ASR 軌各自產生 final 段，`ingest` 頻率翻倍
  //（右軌吃掉一半的名額）。先前為了補償 stereo 把段數上限 10→20，卻讓 mono 場次的 prompt 逐字稿也翻倍
  // ——而 mono 正是麥克風被拒時的 fallback，整場都走它。改成字元預算後兩種模式收斂到同一個 prompt 成本。

  /** 30 字的逐字段，末字元唯一（`seg(0)`…`seg(13)` → …A…N），好斷言哪幾段還留在窗裡。 */
  const seg = (i: number): string => "阿".repeat(29) + String.fromCharCode(65 + i);

  /**
   * 餵完 `texts` 後強制跑一次分析，回傳那一輪的 prompt。
   * 節流是 5 秒一次，所以最後一段餵之前把**牆鐘**推 10 秒（`t` 是音訊時鐘，一律不動）。
   */
  async function promptFor(texts: string[], speakerOf?: (i: number) => "presenter" | "client"): Promise<string> {
    const prompts: string[] = [];
    const engine = new RollingWindowAnalysisEngine(recordingGemini(prompts), "model-x", "sess-budget");
    engine.onSignals(() => {});
    const realNow = Date.now;
    let skew = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    const last = texts.length - 1;
    for (let i = 0; i < last; i++) engine.ingest("sess-budget", { t: i * 1_000, text: texts[i]! }, speakerOf?.(i));
    await tick(30);
    skew = 10_000;
    engine.ingest("sess-budget", { t: last * 1_000, text: texts[last]! }, speakerOf?.(last));
    await tick(30);
    clock.mockRestore();
    return prompts[prompts.length - 1]!;
  }

  it("trims by total CHARACTERS, not by segment count", async () => {
    // 14 段 × 30 字 ＝ 420 字。預算 300 → 只留最新 10 段（累計正好 300），第 11 新的（330）被擠出去。
    const texts = Array.from({ length: 14 }, (_, i) => seg(i));
    const prompt = await promptFor(texts);

    expect(prompt).toContain(seg(13)); // 最新的一定在
    expect(prompt).toContain(seg(4)); // 第 10 新的：累計 300 字，剛好在預算內
    expect(prompt).not.toContain(seg(3)); // 第 11 新的：累計 330 字 → 出局
    expect(texts.filter((t) => prompt.includes(t))).toHaveLength(10);
  });

  it("mono and stereo converge on the SAME prompt cost for the same conversation", async () => {
    // 同一份逐字稿餵兩次：一次全部不帶說話者（mono 混音），一次左右輪流（stereo 兩軌交替 ingest）。
    // 段數上限時代 stereo 的窗會被兩軌各吃一半；字元預算只看逐字稿總量，與聲道模式無關。
    const texts = Array.from({ length: 14 }, (_, i) => seg(i));
    const survivors = (prompt: string): string[] => texts.filter((t) => prompt.includes(t));

    const mono = await promptFor(texts);
    const stereo = await promptFor(texts, (i) => (i % 2 === 0 ? "presenter" : "client"));

    expect(survivors(stereo)).toEqual(survivors(mono));
    expect(survivors(stereo)).toHaveLength(10);
    // …而且 stereo 那一輪確實走了「由聲道決定 speaker」的路徑（否則這個等價是空洞的）。
    expect(stereo).toContain(`報告者：${seg(12)}`);
    expect(stereo).toContain(`客戶：${seg(13)}`);
    expect(mono).toContain(`\n${seg(12)}`); // mono：裸行，沒有說話者前綴（前綴只出現在 prompt 的說明句裡）
    expect(mono).not.toContain(`報告者：${seg(12)}`);
  });

  it("the 90s age limit still evicts an old segment the character budget would have kept", async () => {
    // 兩段共 60 字，遠低於預算 → 只有 WINDOW_MAX_AGE_MS 能趕走舊的那段（兩道上限同時生效）。
    const prompts: string[] = [];
    const engine = new RollingWindowAnalysisEngine(recordingGemini(prompts), "model-x", "sess-age");
    engine.onSignals(() => {});
    const realNow = Date.now;
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);

    engine.ingest("sess-age", { t: 0, text: seg(0) });
    await tick(30);
    skew = 10_000;
    engine.ingest("sess-age", { t: 90_001, text: seg(1) }); // 音訊時鐘走過一整個窗
    await tick(30);

    const prompt = prompts[prompts.length - 1]!;
    expect(prompt).toContain(seg(1));
    expect(prompt).not.toContain(seg(0));
  });

  it("a single segment bigger than the whole budget is still kept (the window never goes blind)", async () => {
    const prompts: string[] = [];
    const engine = new RollingWindowAnalysisEngine(recordingGemini(prompts), "model-x", "sess-huge");
    engine.onSignals(() => {});
    const huge = "長".repeat(400); // > WINDOW_MAX_CHARS
    engine.ingest("sess-huge", { t: 0, text: huge });
    await tick(30);

    expect(prompts[prompts.length - 1]).toContain(huge); // 砍到一段不剩＝那一輪分析瞎掉
  });
});

describe("LiveSessionRuntime.dispose resets EVERY ASR track (privacy)", () => {
  it("resets both the left and the right track (a missed right track keeps transcribing the client)", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      runtime.consent = true;
      spyPushAudio(runtime);
      const resets = spyReset(runtime);

      hub.pushAudio(meta, interleave([1, 2], [-1, -2])); // materializes the right track
      const left = runtime.asr;
      const right = runtime.asrRight;
      expect(right).toBeDefined();

      runtime.dispose();

      expect(resets).toHaveLength(2);
      expect(resets).toContain(left);
      expect(resets).toContain(right);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("mono runtime still resets its single track exactly once", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      runtime.consent = true;
      spyPushAudio(runtime);
      const resets = spyReset(runtime);

      hub.pushAudio(meta, Buffer.alloc(8));
      runtime.dispose();

      expect(resets).toEqual([runtime.asr]);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 以下四組針對「同一場 runtime 先 mono 後 stereo」這條**正常操作路徑**（不是邊角案例）：
// 第一次按「開始聆聽」麥克風權限泡泡沒回應 → 前端 10 秒後降級 mono → 停止 → 再按一次並給了授權 → stereo。
// server 端 runtime 不會消失（斷線只排 5 分鐘寬限回收，而且 cockpit 另有一條 hud socket 讓 room 不歸零）。
// ────────────────────────────────────────────────────────────────────────────

describe("shared audio clock: a mid-meeting right track lands on the SAME timeline as the left", () => {
  it("5s mono → switch to stereo: the right track's FIRST segment starts at 5000ms, not 0", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);
      const left = runtime.asr;

      // 20 × 250ms mono = 5s → one 4s hard cut at t=0, 1s still buffered in the left chunker.
      pushFrames(hub, meta, 1, 20);
      expect(runtime.capturedAudioMs()).toBe(5_000);
      expect(cutsOf(cuts, left).map((c) => c.tMs)).toEqual([0]);
      expect(runtime.asrRight).toBeUndefined(); // mono never builds a second provider

      // …now the presenter grants the mic and the capture reconnects as stereo on the SAME meeting.
      pushFrames(hub, meta, 2, 16);
      const right = runtime.asrRight;
      expect(right).toBeDefined();

      const leftCuts = cutsOf(cuts, left);
      const rightCuts = cutsOf(cuts, right);
      // left: [4s mono @0] [1s mono residue @4000, forced out AT the switch] [4s stereo @5000]
      expect(leftCuts.map((c) => c.tMs)).toEqual([0, 4_000, 5_000]);
      expect(leftCuts.map((c) => c.samples)).toEqual([64_000, 16_000, 64_000]);
      // right only exists from the switch onwards — and starts on the SHARED clock.
      expect(rightCuts).toHaveLength(1);
      expect(rightCuts[0]!.tMs).toBe(5_000);
      expect(rightCuts[0]!.tMs).not.toBe(0); // THE regression: a per-provider clock would start here at 0…
      expect(rightCuts[0]!.tMs).toBe(leftCuts[2]!.tMs); // …and never line up with the left track again.

      // Why it matters (gemini-analysis.ts `trimWindow`): segments older than WINDOW_MAX_AGE_MS relative to
      // the newest one are dropped. A 5s offset is survivable; a whole mono prelude (minutes) is not — one
      // left segment entering the window would evict EVERY right (=client) segment, and objection/budget/
      // competitor signals come almost exclusively from the client.
      expect(Math.abs(rightCuts[0]!.tMs - leftCuts[2]!.tMs)).toBe(0);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("a mono-only meeting keeps its byte-identical, 0-based segment clock", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);
      pushFrames(hub, meta, 1, 32); // 8s → two 4s cuts
      expect(cuts.map((c) => c.tMs)).toEqual([0, 4_000]);
      expect(cuts.every((c) => c.self === runtime.asr && c.channels === 1)).toBe(true);
      expect(runtime.asrRight).toBeUndefined();
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("an all-stereo meeting keeps both tracks in lockstep from the first frame", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);
      pushFrames(hub, meta, 2, 32); // 8s → two 4s cuts per track
      const leftCuts = cutsOf(cuts, runtime.asr);
      const rightCuts = cutsOf(cuts, runtime.asrRight);
      expect(leftCuts.map((c) => c.tMs)).toEqual([0, 4_000]);
      expect(rightCuts.map((c) => c.tMs)).toEqual([0, 4_000]); // identical axis, 1:1 pairing
      expect(runtime.capturedAudioMs()).toBe(8_000); // the clock advances ONCE per frame, not twice
    } finally {
      hub.disposeAll();
      core.close();
    }
  });
});

describe("mode switches never mislabel the audio buffered across them", () => {
  it("mono→stereo: the residue flushed at the switch is tagged MONO and is never `presenter`", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      const hudSegments = attachHud(hub, meta);
      await tick();
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);

      pushFrames(hub, meta, 1, 20); // 5s mono → 1s left in the chunker (MIXED audio: BOTH speakers)
      pushFrames(hub, meta, 2, 1); // ← the switch
      expect(runtime.audioChannels).toBe(2); // the session IS in stereo now…

      const residue = cutsOf(cuts, runtime.asr)[1]!;
      expect(residue.tMs).toBe(4_000);
      expect(residue.channels).toBe(1); // …but that segment was CAPTURED in mono and says so.

      // Replay it exactly as the provider would once transcription returns (which is always AFTER the
      // switch — transcription is async with a 20s deadline).
      finalCbOf(runtime.asr)({ t: residue.tMs, text: "價格聽起來有點超出我們今年的預算", channels: residue.channels });
      await tick();

      expect(hudSegments).toHaveLength(1);
      // THE bug: reading the CURRENT mode here yields "presenter" → the client's words are attributed to the
      // presenter and persisted that way (meeting_transcript_segments.speaker). Mono semantics = inferSpeaker,
      // which degrades to "unknown" with Gemini unconfigured.
      expect(hudSegments[0]!.speaker).not.toBe("presenter");
      expect(hudSegments[0]!.speaker).toBe("unknown");

      // Positive control: audio actually captured in stereo on the left track IS the presenter.
      finalCbOf(runtime.asr)({ t: 5_000, text: "我們這個方案可以幫你們把導入時間縮短一半", channels: 2 });
      await tick();
      expect(hudSegments[1]!.speaker).toBe("presenter");
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("stereo→mono: BOTH tracks are flushed, so the client's buffered speech is neither lost nor time-shifted", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      const hudSegments = attachHud(hub, meta);
      await tick();
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);

      pushFrames(hub, meta, 2, 20); // 5s stereo → 1s buffered in EACH track
      const left = runtime.asr;
      const right = runtime.asrRight;
      expect(cutsOf(cuts, right).map((c) => c.tMs)).toEqual([0]);

      pushFrames(hub, meta, 1, 16); // ← reverse switch (mic denied on reconnect) + 4s of mono

      const rightCuts = cutsOf(cuts, right);
      // The right track's 1s of CLIENT speech is cut out at the switch instead of rotting in the buffer:
      // nothing more will ever be pushed to it, so without this it is either lost at dispose() or glued to
      // whatever arrives minutes later if the capture flips back to stereo (with a wildly wrong start time).
      expect(rightCuts.map((c) => c.tMs)).toEqual([0, 4_000]);
      expect(rightCuts[1]!.samples).toBe(16_000); // the full second, nothing dropped
      expect(rightCuts.every((c) => c.channels === 2)).toBe(true); // right NEVER sees mono data

      const leftCuts = cutsOf(cuts, left);
      expect(leftCuts.map((c) => c.tMs)).toEqual([0, 4_000, 5_000]);
      expect(leftCuts.map((c) => c.channels)).toEqual([2, 2, 1]); // no segment straddles the switch

      // Attribution across the reverse switch: the right track stays "client" (it can only ever carry the
      // tab audio), and the post-switch MIXED segment goes back to inferSpeaker instead of "presenter".
      finalCbOf(right!)({ t: 4_000, text: "我們今年的預算大概只有這個數", channels: 2 });
      finalCbOf(left)({ t: 4_000, text: "這部分我們可以分階段導入", channels: 2 });
      finalCbOf(left)({ t: 5_000, text: "那我們下次再約時間細談", channels: 1 });
      await tick();
      expect(hudSegments.map((s) => s.speaker)).toEqual(["client", "presenter", "unknown"]);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("a residue shorter than one minimum segment is DROPPED, never glued to the new mode", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);

      pushFrames(hub, meta, 1, 2); // 500ms mono — below MIN_SEGMENT_SAMPLES (1s)
      pushFrames(hub, meta, 2, 16); // switch + 4s stereo

      const leftCuts = cutsOf(cuts, runtime.asr);
      expect(leftCuts).toHaveLength(1); // the 500ms residue produced NO segment (matches the existing
      // silence-cut rule, which also refuses to emit under 1s)…
      expect(leftCuts[0]!.channels).toBe(2);
      expect(leftCuts[0]!.samples).toBe(64_000); // …and was not prepended to the stereo segment either.
      expect(leftCuts[0]!.tMs).toBe(500); // the shared clock still counted it (no timeline hole)
      expect(cutsOf(cuts, runtime.asrRight)[0]!.tMs).toBe(500);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });
});

describe("asr_unavailable is deduped at the SESSION level, not per ASR track", () => {
  it("both tracks failing for real produces exactly ONE toast", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      const errors = attachHudErrors(hub, meta);
      await tick();
      runtime.consent = true;

      // No transcribe spy here: GEMINI_API_KEY is empty in tests, so the REAL transcribe throws on both
      // tracks the moment a 4s segment is cut — exactly what an exhausted API quota looks like in prod.
      pushFrames(hub, meta, 2, 16);
      await tick(20);

      expect(runtime.asrOutageCount()).toBe(2); // both tracks really are down…
      expect(errors).toEqual(["asr_unavailable"]); // …and the presenter sees ONE toast, not two.
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("recovery re-arms the warning; a partial recovery does not", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      const errors = attachHudErrors(hub, meta);
      await tick();
      runtime.consent = true;
      hub.pushAudio({ ...meta, channels: 2 }, stereoFrame(8)); // build the right track (far too short to cut)
      const left = runtime.asr;
      const right = runtime.asrRight!;
      expect(right).toBeDefined();

      // Drive the callbacks the hub registered. The provider's own `unavailableSignaled` is a separate,
      // per-track edge detector; what is pinned here is the SESSION-level gate that sits above it.
      outageCbOf(left)();
      outageCbOf(right)();
      expect(errors).toEqual(["asr_unavailable"]);

      outageCbOf(left)(); // still down, signals again → still no duplicate
      expect(errors).toHaveLength(1);

      recoveryCbOf(left)(); // one track back, the other still down
      expect(runtime.asrOutageCount()).toBe(1);
      outageCbOf(left)();
      expect(errors).toHaveLength(1); // ASR was never fully healthy → no new toast

      recoveryCbOf(left)();
      recoveryCbOf(right)();
      expect(runtime.asrOutageCount()).toBe(0); // fully healthy again
      outageCbOf(right)();
      expect(errors).toEqual(["asr_unavailable", "asr_unavailable"]); // the NEXT outage is announced
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("a mono meeting still warns once per outage and re-arms after recovery", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      const errors = attachHudErrors(hub, meta);
      await tick();
      runtime.consent = true;

      outageCbOf(runtime.asr)();
      outageCbOf(runtime.asr)();
      expect(errors).toHaveLength(1);
      recoveryCbOf(runtime.asr)();
      outageCbOf(runtime.asr)();
      expect(errors).toHaveLength(2);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("dispose() clears the outage set (L13 bounded teardown; no refs to reset providers)", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      runtime.consent = true;
      hub.pushAudio({ ...meta, channels: 2 }, stereoFrame(8));
      outageCbOf(runtime.asr)();
      expect(runtime.asrOutageCount()).toBe(1);
      runtime.dispose();
      expect(runtime.asrOutageCount()).toBe(0);
      expect(runtime.noteAsrUnavailable(runtime.asr)).toBe(false); // disposed → never broadcasts again
    } finally {
      hub.disposeAll();
      core.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 靜音段不送 ASR（成本）。切段規則是「≥1 秒且尾端 600ms RMS 低於底噪就切」，所以一條**完全沒人講話**的軌
// 每滿 1 秒就切一段 → 1 秒 WAV(≈32KB)→base64(≈43KB)→Gemini round trip，回來必定空字串。
// 雙軌之後這不是邊角案例：雙方輪流講話就代表整場幾乎隨時恰好有一條軌是靜音的。
// ────────────────────────────────────────────────────────────────────────────
describe("a silent track never reaches Gemini (peak gate, strictly more conservative than the silence cut)", () => {
  it("5s of pure silence produces ZERO transcription calls — but the clock still advances", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);

      for (let i = 0; i < 20; i++) hub.pushAudio(meta, monoFrame(FRAME_SAMPLES, 0)); // 20 × 250ms

      expect(cuts).toEqual([]); // 修補前：每滿 1 秒切一段 → 5 次零產出的呼叫
      expect(runtime.capturedAudioMs()).toBe(5_000); // 時鐘由 advanceAudioClock 驅動，與切段次數無關
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("the segment AFTER a silent stretch starts at the right time (no hole in the timeline)", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);

      for (let i = 0; i < 20; i++) hub.pushAudio(meta, monoFrame(FRAME_SAMPLES, 0)); // 5s 靜音，全部丟棄
      pushFrames(hub, meta, 1, 16); // 4s 有人講話 → 一次硬切

      expect(cuts).toHaveLength(1);
      expect(cuts[0]!.tMs).toBe(5_000); // 丟掉的靜音仍然被計時（起點不是 0）
      expect(cuts[0]!.samples).toBe(64_000); // 靜音沒有被黏進這一段
      expect(runtime.capturedAudioMs()).toBe(9_000);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("a QUIET segment that still contains speech IS transcribed (peak decides, not RMS)", async () => {
    const { core, hub, meta, runtime } = await liveHub(1);
    try {
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);

      // 1 秒＝4 個 frame：只有最前面 30 個取樣是人聲（±8000），之後全是數位靜音。
      //  - 尾端 600ms 全靜音 → 觸發**既有的**靜音切段規則（這一段本來就會被切出來）。
      //  - 整段 RMS = sqrt(30 × 8000² / 16000) ≈ 346 < 400 ⇒ 若用 RMS 當丟棄判準，這段會被**誤丟**。
      //  - peak = 8000 ≫ 400 ⇒ 留住。這就是「peak < 門檻 蘊含 RMS < 門檻，反之不然」的實證。
      hub.pushAudio(meta, burstFrame(FRAME_SAMPLES, 30));
      for (let i = 0; i < 3; i++) hub.pushAudio(meta, monoFrame(FRAME_SAMPLES, 0));

      expect(cuts).toHaveLength(1);
      expect(cuts[0]!.tMs).toBe(0);
      expect(cuts[0]!.samples).toBe(16_000);
    } finally {
      hub.disposeAll();
      core.close();
    }
  });

  it("in stereo only the SPEAKING track pays (this is the whole meeting, not an edge case)", async () => {
    const { core, hub, meta, runtime } = await liveHub(2);
    try {
      runtime.consent = true;
      const cuts = spyTranscribe(runtime);

      // 4 秒的「報告者在講、客戶沒出聲」——雙方輪流講話時，整場幾乎隨時是這個形狀。
      const frame = stereoFrame(FRAME_SAMPLES, 8_000, 0);
      for (let i = 0; i < 16; i++) hub.pushAudio(meta, frame);

      expect(cutsOf(cuts, runtime.asr)).toHaveLength(1); // 左軌：一次 4 秒硬切
      expect(cutsOf(cuts, runtime.asrRight)).toHaveLength(0); // 右軌：修補前是 4 次零產出的呼叫
    } finally {
      hub.disposeAll();
      core.close();
    }
  });
});
