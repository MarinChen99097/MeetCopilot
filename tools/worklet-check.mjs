/**
 * Drives apps/web/public/pcm-worklet.js in plain node with a shimmed AudioWorkletGlobalScope.
 *
 * Proves:
 *   (1) MONO is a real DOWN-MIX, not "keep left, drop right" — the node options set in
 *       lib/audio-capture.ts make Web Audio deliver (L+R)/2 to the worklet, and the worklet's output
 *       is the resample of that average. A genuinely-mono source is still bit-identical to the
 *       pre-change implementation.
 *   (2) STEREO interleaves L-first with no drift; a missing/short right channel yields silence
 *       (never a shifted/copied L).
 *   (3) The resampler does NOT over-consume on ratio > 1: total emitted samples match the real
 *       elapsed duration (this is the audio clock the whole server pipeline is driven by).
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url)); // tools/
const REPO = join(HERE, "..");
const SRC = readFileSync(`${REPO}/apps/web/public/pcm-worklet.js`, "utf8");
const CAPTURE_SRC = readFileSync(`${REPO}/apps/web/lib/audio-capture.ts`, "utf8");

function load(ctxRate) {
  let Registered = null;
  const sandbox = {
    sampleRate: ctxRate,
    Float32Array,
    Int16Array,
    Math,
    AudioWorkletProcessor: class {
      constructor() {
        const frames = [];
        this.port = {
          onmessage: null,
          postMessage: (buf) => frames.push(buf),
          _frames: frames,
        };
      }
    },
    registerProcessor: (_name, cls) => {
      Registered = cls;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return Registered;
}

/** Run `total` samples through the processor in 128-sample quanta. Returns the live processor. */
function runP(rate, processorOptions, genL, genR, total, dropRight = false) {
  const P = load(rate);
  const p = new P({ processorOptions });
  for (let base = 0; base < total; base += 128) {
    const n = Math.min(128, total - base);
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = genL(base + i);
    const chans = [L];
    if (genR && !dropRight) {
      const R = new Float32Array(n);
      for (let i = 0; i < n; i++) R[i] = genR(base + i);
      chans.push(R);
    }
    p.process([chans]);
  }
  return p;
}

/** Same, but returns just the emitted frames as Int16Arrays. */
function run(rate, processorOptions, genL, genR, total, dropRight = false) {
  return runP(rate, processorOptions, genL, genR, total, dropRight).port._frames.map((b) => new Int16Array(b));
}

/**
 * Independent single-channel reference resampler.
 *   clamp=false → the ORIGINAL pre-change algorithm, verbatim (including the `consumed = pos|0`
 *                 overshoot bug), used to prove the 16 kHz production path is byte-for-byte unchanged.
 *   clamp=true  → the same algorithm with the overshoot carried into readPos, i.e. the CORRECT oracle.
 */
function runOld(rate, total, genL, clamp = false) {
  const targetRate = 16000;
  const frameSamples = Math.round((targetRate * 250) / 1000);
  const ratio = rate / targetRate;
  const buf = new Int16Array(frameSamples);
  let bufLen = 0;
  let readPos = 0;
  let carry = new Float32Array(0);
  const out = [];
  for (let base = 0; base < total; base += 128) {
    const n = Math.min(128, total - base);
    const chan = new Float32Array(n);
    for (let i = 0; i < n; i++) chan[i] = genL(base + i);
    let data;
    if (carry.length) {
      data = new Float32Array(carry.length + chan.length);
      data.set(carry, 0);
      data.set(chan, carry.length);
    } else data = chan;
    let pos = readPos;
    const N = data.length;
    while (pos + 1 < N) {
      const i = pos | 0;
      const frac = pos - i;
      let s = data[i] * (1 - frac) + data[i + 1] * frac;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      buf[bufLen++] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
      if (bufLen >= frameSamples) {
        out.push(buf.slice(0, frameSamples));
        bufLen = 0;
      }
      pos += ratio;
    }
    const consumed = clamp ? Math.min(pos | 0, N) : pos | 0;
    carry = data.slice(consumed);
    readPos = pos - consumed;
  }
  return out;
}
/** Total sample-frames a reference run produced, counting only whole emitted frames. */
const refSamples = (frames) => frames.reduce((a, f) => a + f.length, 0);

let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fails++;
};
const eqFrames = (a, b) =>
  a.length === b.length && a.every((f, i) => f.length === b[i].length && f.every((v, j) => v === b[i][j]));

// Signals: L is a positive sawtooth, R the exact negation of the same instant.
const saw = (k) => ((k % 1000) / 1000) * 0.9;
const negSaw = (k) => -saw(k);
/** Standard Web Audio "speakers" 2→1 down-mix. */
const downmix = (l, r) => (k) => (l(k) + r(k)) / 2;

// ── 0. MONO NODE-OPTIONS CONTRACT (the down-mix itself is done by Web Audio, before the worklet) ──
{
  const region = CAPTURE_SRC.slice(
    CAPTURE_SRC.indexOf("const workletOptions"),
    CAPTURE_SRC.indexOf('new AudioWorkletNode(ctx, "pcm-downsampler"'),
  );
  const hasElse = /else\s*\{/.test(region);
  check(
    "audio-capture: mono branch pins channelCount 1 / explicit / speakers (real down-mix)",
    hasElse &&
      /channelCount\s*=\s*1/.test(region) &&
      /channelCountMode\s*=\s*"explicit"/.test(region) &&
      /channelInterpretation\s*=\s*"speakers"/.test(region),
  );
  check(
    "audio-capture: stereo branch still pins 2 / explicit / discrete (unchanged)",
    /channelCount\s*=\s*2/.test(region) &&
      /channelInterpretation\s*=\s*"discrete"/.test(region),
  );
}

// ── 1. MONO = DOWN-MIX, not "drop the right half" ────────────────────────────────────────────────
// The worklet reads input[0]; with the node options above, input[0] IS (L+R)/2. So we feed the
// down-mixed signal and assert the output is the average — explicitly NOT equal to left-only.
for (const rate of [16000, 44100, 48000]) {
  const total = 200000;
  const opts = { targetSampleRate: 16000, frameMs: 250, channels: 1 };
  const konst = () => 0.5;

  // Case A — crisp: R is the exact negation of L ⇒ the average is digital silence.
  // "keep left, drop right" would emit the full-amplitude sawtooth instead.
  const cancel = run(rate, opts, downmix(saw, negSaw), null, total);
  const leftOnly = runOld(rate, total, saw, true);
  const allZero = cancel.every((f) => f.every((v) => v === 0));
  const leftOnlyLoud = leftOnly.some((f) => f.some((v) => v !== 0));
  check(
    `mono @${rate}Hz down-mix of L=+s / R=-s is silence (left-only would be loud)`,
    allZero && leftOnlyLoud,
    `frames=${cancel.length} leftOnlyPeak=${Math.max(...leftOnly[0])}`,
  );

  // Case B — general: L = sawtooth, R = constant +0.5 ⇒ output must be resample((L+R)/2),
  // and must DIFFER from resample(L).
  const avg = run(rate, opts, downmix(saw, konst), null, total);
  check(`mono @${rate}Hz output == resample((L+R)/2)`, eqFrames(avg, runOld(rate, total, downmix(saw, konst), true)));
  check(`mono @${rate}Hz output != resample(L) (right half is NOT discarded)`, !eqFrames(avg, leftOnly));

  // Case C — a genuinely mono source: a 1→1 down-mix is the identity, so the samples themselves
  // must be exactly what a correct resampler produces for that one channel.
  const pureMono = run(rate, opts, saw, null, total);
  const pureMonoNoOpt = run(rate, { targetSampleRate: 16000, frameMs: 250 }, saw, null, total); // channels absent
  check(`mono @${rate}Hz mono SOURCE == correct resample of that channel`, eqFrames(pureMono, leftOnly), `frames=${pureMono.length} len=${pureMono[0]?.length}`);
  check(`mono @${rate}Hz identical with channels absent`, eqFrames(pureMonoNoOpt, leftOnly));
  check(`mono @${rate}Hz frame = 8000 bytes`, pureMono.every((f) => f.byteLength === 8000));

  // Case D — relation to the PRE-CHANGE implementation, stated per rate:
  //   16 kHz (what Chrome actually gives us) never overshoots ⇒ must stay byte-for-byte identical.
  //   44.1/48 kHz DID overshoot ⇒ the old output was too long (ran fast); it MUST now differ.
  const buggy = runOld(rate, total, saw, false);
  if (rate === 16000) {
    check(`mono @${rate}Hz (production rate) byte-identical to the pre-change impl`, eqFrames(pureMono, buggy));
  } else {
    // Whole-frame emission quantises the length difference away over this run, so the observable
    // statement here is that the SAMPLES differ (the old stream was running ahead of real time);
    // the duration claim itself is measured exactly in section 6.
    let firstDiff = -1;
    outer: for (let f = 0; f < Math.min(pureMono.length, buggy.length); f++) {
      for (let i = 0; i < pureMono[f].length; i++)
        if (pureMono[f][i] !== buggy[f][i]) {
          firstDiff = f * 4000 + i;
          break outer;
        }
    }
    check(
      `mono @${rate}Hz intentionally differs from the pre-change impl (drift removed)`,
      !eqFrames(pureMono, buggy) && firstDiff >= 0,
      `first differing sample @${firstDiff} (${(firstDiff / 16000).toFixed(3)}s in)`,
    );
  }
}

// ── 2. STEREO layout + L/R pairing ────────────────────────────────────────────────────────────
for (const rate of [16000, 44100, 48000]) {
  const frames = run(rate, { targetSampleRate: 16000, frameMs: 250, channels: 2 }, saw, negSaw, 300000);
  check(`stereo @${rate}Hz frame = 16000 bytes (4000 pairs)`, frames.every((f) => f.byteLength === 16000 && f.length === 8000), `frames=${frames.length}`);

  let signOk = true;
  let magOk = true;
  let worstMag = 0;
  for (const f of frames) {
    for (let i = 0; i < f.length; i += 2) {
      const l = f[i];
      const r = f[i + 1];
      if (l < 0 || r > 0) signOk = false; // L must be the positive saw, R the negative one
      // Same instant ⇒ equal magnitude (±2 for the asymmetric 0x7fff/0x8000 scaling + rounding).
      const d = Math.abs(Math.abs(l) - Math.abs(r));
      if (d > worstMag) worstMag = d;
      if (d > 2) magOk = false;
    }
  }
  check(`stereo @${rate}Hz L always +, R always − (no swap, no 1-slot shift)`, signOk);
  check(`stereo @${rate}Hz |L| == |R| per pair (no inter-channel drift)`, magOk, `worst delta=${worstMag}`);

  // L of the stereo run must equal the mono run of the same signal (same resampler, same cursor).
  const mono = run(rate, { targetSampleRate: 16000, frameMs: 250, channels: 1 }, saw, null, 300000);
  const left = frames.map((f) => f.filter((_, i) => i % 2 === 0));
  const same = left.length === mono.length && left.every((f, i) => f.every((v, j) => v === mono[i][j]));
  check(`stereo @${rate}Hz left channel == mono output of the same signal`, same);
}

// ── 3. Right channel missing mid-stream ⇒ silence, never a copy/shift of left ─────────────────
{
  const frames = run(16000, { targetSampleRate: 16000, frameMs: 250, channels: 2 }, saw, negSaw, 64000, true);
  check("stereo with only 1 input channel: still 16000-byte frames", frames.every((f) => f.byteLength === 16000));
  let rAllZero = true;
  let lNonZero = false;
  for (const f of frames)
    for (let i = 0; i < f.length; i += 2) {
      if (f[i + 1] !== 0) rAllZero = false;
      if (f[i] !== 0) lNonZero = true;
    }
  check("stereo with only 1 input channel: R is silence (not a copy of L)", rAllZero && lNonZero);
  const mono = run(16000, { targetSampleRate: 16000, frameMs: 250, channels: 1 }, saw, null, 64000);
  const left = frames.map((f) => f.filter((_, i) => i % 2 === 0));
  check(
    "stereo with only 1 input channel: L identical to mono output",
    left.length === mono.length && left.every((f, i) => f.every((v, j) => v === mono[i][j])),
  );
}

// ── 4. Right channel of the WRONG length is rejected (would desync the cursor) ─────────────────
{
  const P = load(16000);
  const p = new P({ processorOptions: { targetSampleRate: 16000, frameMs: 250, channels: 2 } });
  for (let base = 0; base < 64000; base += 128) {
    const L = new Float32Array(128);
    for (let i = 0; i < 128; i++) L[i] = saw(base + i);
    const R = new Float32Array(base % 1280 === 0 ? 64 : 128).fill(-0.5); // occasionally short
    p.process([[L, R]]);
  }
  const frames = p.port._frames.map((b) => new Int16Array(b));
  check("short right channel: frames still exactly 16000 bytes", frames.every((f) => f.byteLength === 16000), `frames=${frames.length}`);
  let signOk = true;
  for (const f of frames)
    for (let i = 0; i < f.length; i += 2) if (f[i] < 0 || f[i + 1] > 0) signOk = false;
  check("short right channel: L stays +, R stays ≤0 (silence substituted, no shift)", signOk);
}

// ── 5. "stop" halts the processor ─────────────────────────────────────────────────────────────
{
  const P = load(16000);
  const p = new P({ processorOptions: { targetSampleRate: 16000, frameMs: 250, channels: 2 } });
  p.port.onmessage({ data: "stop" });
  check("stop → process() returns false", p.process([[new Float32Array(128), new Float32Array(128)]]) === false);
}

// ── 6. RESAMPLER DRIFT: total emitted duration must equal the real elapsed duration ────────────
// The loop can exit with the cursor PAST the end of the block (e.g. ratio 3, n 128: 126 → 129).
// If that overshoot is thrown away instead of carried into readPos, every block re-reads ~1 sample
// and the stream runs fast. `chunker.ts` counts these samples as the ONE audio clock of the whole
// system (transcript t, the 90 s analysis window, the uncheck cool-down), so 0.8% fast = ~30 s of
// skew per hour of meeting.
console.log("\n── resampler drift (produced vs. true duration) ──");
{
  const BLOCKS = 1000;
  const total = 128 * BLOCKS; // whole number of render quanta
  const TOL = 2; // samples; a continuous cursor can only lose the partial tail
  for (const rate of [16000, 32000, 44100, 48000]) {
    for (const channels of [1, 2]) {
      const p = runP(
        rate,
        { targetSampleRate: 16000, frameMs: 250, channels },
        saw,
        channels === 2 ? negSaw : null,
        total,
      );
      // frames are complete 4000-sample-FRAME buffers; bufLen holds the not-yet-emitted remainder
      const produced = p.port._frames.length * 4000 + p.bufLen;
      const expected = (total * 16000) / rate;
      const deltaPct = ((produced - expected) / expected) * 100;
      check(
        `drift @${rate}Hz ch=${channels}: produced == ${expected.toFixed(2)} sample-frames`,
        Math.abs(produced - expected) <= TOL,
        `produced=${produced} expected=${expected.toFixed(2)} delta=${(produced - expected).toFixed(2)} (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(3)}%)`,
      );
    }
  }

  // L/R must survive the overshoot together: carryL and carryR are sliced with the SAME `consumed`,
  // so a clamp that fixed only one of them would swap the two speakers from the first overshoot on.
  const p = runP(48000, { targetSampleRate: 16000, frameMs: 250, channels: 2 }, saw, negSaw, 128 * 4000);
  const frames = p.port._frames.map((b) => new Int16Array(b));
  let signOk = true;
  for (const f of frames) for (let i = 0; i < f.length; i += 2) if (f[i] < 0 || f[i + 1] > 0) signOk = false;
  check("drift @48000Hz stereo: L/R still aligned across every overshoot", signOk, `frames=${frames.length}`);
}

console.log(fails === 0 ? "\nALL WORKLET CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
