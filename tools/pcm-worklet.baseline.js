/*
 * ══ FROZEN GOLDEN BASELINE — DO NOT EDIT, DO NOT LOAD IN THE APP ═══════════════════════════════
 *
 * This is a byte copy of apps/web/public/pcm-worklet.js taken at the moment the stereo (dual-channel
 * capture) implementation was finished and verified, on 2026-08-19, and BEFORE the /simplify cleanup
 * that extracted `joinCarry()` and renamed `step = this.channels` to `step = stereo ? 2 : 1`.
 * The two sources therefore differ TEXTUALLY but must produce byte-identical audio — that equality is
 * exactly what `tools/worklet-diff.mjs` asserts.
 *
 * WHY IT IS A FILE AND NOT `git show <sha>:apps/web/public/pcm-worklet.js`:
 *   1. It is not in any commit. It is a mid-session working-tree state; the last commit that touched
 *      the worklet (e1f7ffd, HEAD 5bab897 at the time of writing) predates stereo entirely and
 *      emits the old 8000-byte mono-only frames, so diffing against it would go red for the wrong
 *      reason and tell you nothing.
 *   2. Even if it were committable, a git-relative baseline is a MOVING target: the harness would go
 *      green the instant a broken change was committed — i.e. it would stop guarding precisely when
 *      it matters. A frozen file pins the golden to a state that was actually audited.
 *
 * This file is never fetched by the browser (only /public is served). It exists solely as the
 * reference input of tools/worklet-diff.mjs and tools/worklet-diff-mutation.mjs.
 * Re-baselining rules: see the header of tools/worklet-diff.mjs.
 */

/*
 * pcm-downsampler — AudioWorkletProcessor for the /copilot capture pipeline.
 *
 * Resamples its input to 16 kHz and emits **raw 16-bit little-endian PCM, headerless** frames
 * (~250 ms each) as transferable ArrayBuffers to the main thread, which relays them over the WS
 * binary channel (API_CONTRACT §6 audio frame layout). The input arrives at the AudioContext rate —
 * normally 16 kHz because we request `new AudioContext({ sampleRate: 16000 })`, but we resample
 * defensively in case a browser ignores the requested rate.
 *
 * ── TWO OUTPUT MODES — selected by `processorOptions.channels` (only the number 2 means stereo;
 *    absent / 1 / anything else ⇒ mono, so old callers are unaffected) ──────────────────────────
 *
 *   channels: 1 — MONO (legacy layout, unchanged). Reads input channel 0 only.
 *     frame = 4000 samples × 2 bytes = **8000 bytes**
 *     bytes: [S0][S1]…[S3999]
 *     Used by the mic-denied fallback and by `/sim` (`lib/mp3-capture.ts` produces the same layout).
 *
 *   channels: 2 — STEREO, INTERLEAVED, **LEFT FIRST**. Reads input channels 0 and 1.
 *     frame = 4000 sample-pairs × 2 ch × 2 bytes = **16000 bytes**
 *     bytes: [L0][R0][L1][R1]…[L3999][R3999]
 *     Frozen channel semantics: **LEFT = microphone = presenter**, **RIGHT = tab audio = the other
 *     side**. The caller wires a ChannelMergerNode to match (`lib/audio-capture.ts`) and negotiates
 *     `?channels=2` on the WS handshake.
 *
 * ── L/R ALIGNMENT is the load-bearing invariant ──────────────────────────────────────────────────
 * A single-sample slip would swap two people's words for the rest of the meeting. Therefore:
 *   - both channels are driven by ONE shared fractional read cursor (`readPos`) and ONE shared
 *     `consumed` count, so `carryL`/`carryR` are always the same length and stay index-aligned;
 *   - `bufLen` counts sample-FRAMES and is advanced only after BOTH slots of a pair are written, so a
 *     frame boundary can never land between an L and its R;
 *   - if a render quantum ever delivers fewer than 2 channels (node not yet settled, or a source that
 *     is momentarily mono) the right channel is replaced by SILENCE of the exact same length — never
 *     a copy of left (that would put the presenter's voice on the other side's track) and never a
 *     differently-sized buffer (that would desync the cursor and swap the channels from then on).
 *
 * Plain JS on purpose: this file is served statically and loaded via `audioWorklet.addModule('/pcm-worklet.js')`;
 * it is NOT bundled/typechecked by Next. Keep it dependency-free and ES2017-safe.
 *
 * ── THE ONE ALLOWED COPY OF THE `channels` RULE ─────────────────────────────────────────────────
 * Everywhere else in the repo (server handshake, WS URL builder, every `1 | 2` type) the rule lives in
 * ONE place: `parseAudioChannels` / `AudioChannels` in `@meetcopilot/shared` (packages/shared/src/protocol.ts).
 * This file CANNOT import it — an AudioWorklet module is fetched raw by the browser, so pulling it into the
 * bundle would break the very `addModule('/pcm-worklet.js')` load path it exists for. So it keeps its own
 * literal check (`opts.channels === 2 ? 2 : 1` below) and **shared is the authority**: if that fail-safe rule
 * ever changes, change it there first and mirror it here. Do NOT make this file the exception that drifts.
 */

/** Float −1..1 → Int16, clamped. Kept bit-for-bit identical to the original mono path. */
function toPcm16(sample) {
  let s = sample;
  if (s > 1) s = 1;
  else if (s < -1) s = -1;
  return s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
}

class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetSampleRate || 16000;
    const frameMs = opts.frameMs || 250;
    // Only the literal number 2 selects stereo; absent/1/garbage ⇒ mono (fail-safe to the legacy layout).
    // MIRROR of shared's `parseAudioChannels` — see the header note on why this file may not import it.
    this.channels = opts.channels === 2 ? 2 : 1;
    // `sampleRate` is a global in AudioWorkletGlobalScope = the context's actual rate.
    this.inRate = sampleRate;
    this.ratio = this.inRate / this.targetRate; // input samples consumed per output sample-frame
    this.frameSamples = Math.max(1, Math.round((this.targetRate * frameMs) / 1000)); // PER CHANNEL
    this.buf = new Int16Array(this.frameSamples * this.channels); // interleaved when stereo
    this.bufLen = 0; // in sample-FRAMES (L+R pairs when stereo), not Int16 slots
    this.readPos = 0; // fractional read cursor carried across process() calls (shared by both channels)
    this.carryL = new Float32Array(0); // leftover input tail for gapless resampling
    this.carryR = new Float32Array(0); // always the same length as carryL (sliced with the same cursor)
    this.closed = false;
    this.port.onmessage = (e) => {
      if (e.data === "stop") this.closed = true;
    };
  }

  process(inputs) {
    if (this.closed) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const chanL = input[0];
    if (!chanL || chanL.length === 0) return true;

    const stereo = this.channels === 2;

    // Right channel is trusted ONLY when present AND exactly as long as left; otherwise silence of the
    // identical length (see the alignment note in the header — never a copy of L, never a short buffer).
    let chanR = null;
    if (stereo) {
      const raw = input.length > 1 ? input[1] : null;
      chanR = raw && raw.length === chanL.length ? raw : new Float32Array(chanL.length);
    }

    // Prepend any carried tail so resampling is continuous across quantum boundaries. carryL/carryR
    // have equal length, so dataL[i] and dataR[i] always describe the SAME instant.
    let dataL;
    let dataR = null;
    if (this.carryL.length) {
      dataL = new Float32Array(this.carryL.length + chanL.length);
      dataL.set(this.carryL, 0);
      dataL.set(chanL, this.carryL.length);
      if (stereo) {
        dataR = new Float32Array(this.carryR.length + chanR.length);
        dataR.set(this.carryR, 0);
        dataR.set(chanR, this.carryR.length);
      }
    } else {
      dataL = chanL;
      dataR = chanR;
    }

    const step = this.channels; // Int16 slots written per output sample-frame (1 mono / 2 stereo)
    let pos = this.readPos;
    const n = dataL.length;
    while (pos + 1 < n) {
      const i = pos | 0;
      const frac = pos - i;
      const base = this.bufLen * step;
      // Linear interpolation, applied to each channel independently with the SAME i/frac.
      this.buf[base] = toPcm16(dataL[i] * (1 - frac) + dataL[i + 1] * frac);
      if (stereo) {
        this.buf[base + 1] = toPcm16(dataR[i] * (1 - frac) + dataR[i + 1] * frac);
      }
      this.bufLen++; // advance only after BOTH slots of the pair are written
      if (this.bufLen >= this.frameSamples) {
        const out = this.buf.slice(0, this.frameSamples * step); // copy → its own ArrayBuffer
        this.port.postMessage(out.buffer, [out.buffer]); // transfer (zero-copy)
        this.bufLen = 0;
      }
      pos += this.ratio;
    }

    // The loop can exit with the cursor PAST the end of this block (ratio 3, n 128: the last iteration
    // starts at 126 and leaves pos = 129). `consumed` must be clamped to what actually exists, so the
    // overshoot survives in `readPos` and is skipped at the start of the NEXT block. Without the clamp
    // `consumed` would be 129, the carry would be empty AND `readPos` would collapse to 0 — re-reading
    // ~1 sample per block, i.e. the stream runs ~0.8% fast at 48 kHz. That number is not cosmetic: the
    // server counts these samples as the one audio clock of the whole system (chunker.ts consumedSamples
    // → transcript timestamps, the 90 s analysis window, the uncheck cool-down), so an hour-long meeting
    // would drift by ~30 s. `n` is dataL.length, and dataR (when stereo) is exactly the same length.
    // BOTH carries are sliced with this SAME value — slicing them differently would shift one channel
    // against the other and swap the two speakers for the rest of the meeting.
    const consumed = Math.min(pos | 0, n);
    this.carryL = dataL.slice(consumed);
    if (stereo) this.carryR = dataR.slice(consumed);
    this.readPos = pos - consumed;
    return true;
  }
}

registerProcessor("pcm-downsampler", PcmDownsampler);
