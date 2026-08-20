/**
 * DIFFERENTIAL harness for apps/web/public/pcm-worklet.js — the byte-level regression lock.
 *
 * Loads BOTH `tools/pcm-worklet.baseline.js` (the frozen golden copy — see that file's header for
 * exactly which state it captures) and the CURRENT apps/web/public/pcm-worklet.js into separate
 * shimmed AudioWorkletGlobalScopes, drives them with the SAME input, and asserts:
 *   - every emitted frame is byte-for-byte identical (raw ArrayBuffer bytes, not just Int16 values);
 *   - the internal resampler state after the run is identical (bufLen, readPos, carryL, carryR,
 *     and the not-yet-emitted contents of `buf`) — i.e. the two are indistinguishable going forward.
 *
 * WHEN IT MUST GO GREEN: any refactor of the worklet that is not supposed to change what goes on the
 * wire (renames, extractions, comments, reordering). A red result then means you changed the audio.
 *
 * WHEN IT IS SUPPOSED TO GO RED: a deliberate change to the emitted bytes. In that case re-baseline
 * ONLY after `worklet-check.mjs` still passes and you have re-read the L/R alignment note in the
 * worklet header, by copying the new file over `tools/pcm-worklet.baseline.js` and saying so in the
 * commit message. Re-baselining silently defeats the entire point of this file.
 *
 * Coverage is deliberately nastier than production: odd quantum sizes, a right channel that is
 * absent / short / long, all four plausible context rates, both channel modes, and inputs shaped to
 * exercise the empty-carry vs non-empty-carry branch (`joinCarry`).
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url)); // tools/
const REPO = join(HERE, "..");
const NEW_SRC = readFileSync(`${REPO}/apps/web/public/pcm-worklet.js`, "utf8");
const OLD_SRC = readFileSync(`${HERE}/pcm-worklet.baseline.js`, "utf8");

function load(src, ctxRate) {
  let Registered = null;
  const sandbox = {
    sampleRate: ctxRate,
    Float32Array,
    Int16Array,
    Math,
    AudioWorkletProcessor: class {
      constructor() {
        const frames = [];
        this.port = { onmessage: null, postMessage: (buf) => frames.push(buf), _frames: frames };
      }
    },
    registerProcessor: (_n, cls) => {
      Registered = cls;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return Registered;
}

/** Deterministic PRNG so both implementations see literally the same numbers. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * One scripted run: a list of quanta, each `{ L: Float32Array, R: Float32Array|null }`.
 * `rightMode` decides how the right channel is delivered (this is the branch the header calls out).
 */
function makeScript({ seed, quanta, sizes, rightMode, amp = 0.95 }) {
  const r = rng(seed);
  const script = [];
  for (let q = 0; q < quanta; q++) {
    const n = sizes[q % sizes.length];
    const L = new Float32Array(n);
    for (let i = 0; i < n; i++) L[i] = (r() * 2 - 1) * amp;
    let R = null;
    if (rightMode === "ok") {
      R = new Float32Array(n);
      for (let i = 0; i < n; i++) R[i] = (r() * 2 - 1) * amp;
    } else if (rightMode === "short" && q % 3 === 0) {
      R = new Float32Array(Math.max(0, n - 7)).fill(-0.5);
    } else if (rightMode === "long" && q % 4 === 0) {
      R = new Float32Array(n + 5).fill(0.25);
    } else if (rightMode === "absent") {
      R = null;
    } else if (rightMode === "short" || rightMode === "long") {
      R = new Float32Array(n);
      for (let i = 0; i < n; i++) R[i] = (r() * 2 - 1) * amp;
    }
    script.push({ L, R });
  }
  return script;
}

function drive(src, rate, processorOptions, script) {
  const P = load(src, rate);
  const p = new P({ processorOptions });
  for (const { L, R } of script) {
    p.process([R ? [L, R] : [L]]);
  }
  return {
    frames: p.port._frames.map((b) => Buffer.from(new Uint8Array(b))),
    state: {
      bufLen: p.bufLen,
      readPos: p.readPos,
      channels: p.channels,
      ratio: p.ratio,
      frameSamples: p.frameSamples,
      carryL: Array.from(p.carryL),
      carryR: Array.from(p.carryR),
      // the partially-filled frame that has not been posted yet
      bufTail: Array.from(p.buf.slice(0, p.bufLen * (p.channels === 2 ? 2 : 1))),
    },
  };
}

let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) fails++;
};

const RATES = [16000, 32000, 44100, 48000];
const CHANNEL_OPTS = [
  { label: "ch=1", opts: { targetSampleRate: 16000, frameMs: 250, channels: 1 } },
  { label: "ch=2", opts: { targetSampleRate: 16000, frameMs: 250, channels: 2 } },
  { label: "ch absent", opts: { targetSampleRate: 16000, frameMs: 250 } },
  { label: "ch garbage", opts: { targetSampleRate: 16000, frameMs: 250, channels: "2" } },
  { label: "ch=2 frameMs=100", opts: { targetSampleRate: 16000, frameMs: 100, channels: 2 } },
];
const SIZE_SETS = [
  { label: "128 (real quantum)", sizes: [128] },
  { label: "mixed 1/2/3/127/128/129", sizes: [128, 1, 128, 2, 127, 129, 3, 128] },
  { label: "tiny 1s (forces carry every block)", sizes: [1] },
];
const RIGHT_MODES = ["ok", "absent", "short", "long"];

let totalFrames = 0;
let comparisons = 0;
for (const rate of RATES) {
  for (const { label: cl, opts } of CHANNEL_OPTS) {
    for (const { label: sl, sizes } of SIZE_SETS) {
      for (const rightMode of RIGHT_MODES) {
        const script = makeScript({ seed: 12345 + rate + sizes.length, quanta: sizes[0] === 1 ? 9000 : 900, sizes, rightMode });
        const a = drive(OLD_SRC, rate, opts, script);
        const b = drive(NEW_SRC, rate, opts, script);
        comparisons++;
        totalFrames += a.frames.length;
        const sameCount = a.frames.length === b.frames.length;
        const sameBytes = sameCount && a.frames.every((f, i) => f.equals(b.frames[i]));
        const sameState = JSON.stringify(a.state) === JSON.stringify(b.state);
        if (!(sameCount && sameBytes && sameState)) {
          check(
            `@${rate} ${cl} sizes=${sl} R=${rightMode}`,
            false,
            `frames old=${a.frames.length} new=${b.frames.length} bytesEqual=${sameBytes} stateEqual=${sameState}`,
          );
        }
      }
    }
  }
}
check(
  `byte-for-byte identical across ${comparisons} configurations (${totalFrames} emitted frames compared)`,
  fails === 0,
);

// ── "stop" path and the degenerate inputs handled before the carry splice ────────────────────────
for (const rate of [16000, 48000]) {
  const P0 = load(OLD_SRC, rate);
  const P1 = load(NEW_SRC, rate);
  const o = new P0({ processorOptions: { targetSampleRate: 16000, frameMs: 250, channels: 2 } });
  const n = new P1({ processorOptions: { targetSampleRate: 16000, frameMs: 250, channels: 2 } });
  const cases = [
    [], // inputs[0] missing
    [[]], // zero channels
    [[new Float32Array(0)]], // empty left
    [[new Float32Array(1).fill(0.5)]], // 1 sample, no right
  ];
  let same = true;
  for (const c of cases) if (o.process(c) !== n.process(c)) same = false;
  o.port.onmessage({ data: "stop" });
  n.port.onmessage({ data: "stop" });
  const stopSame = o.process([[new Float32Array(128), new Float32Array(128)]]) === n.process([[new Float32Array(128), new Float32Array(128)]]);
  check(`@${rate} degenerate inputs + stop: identical return values`, same && stopSame);
}

// ── the two names are the same bit: step must equal this.channels for every accepted option ──────
{
  const P = load(NEW_SRC, 48000);
  let ok = true;
  for (const [given, expect] of [[2, 2], [1, 1], [undefined, 1], ["2", 1], [3, 1], [0, 1], [null, 1]]) {
    const p = new P({ processorOptions: { targetSampleRate: 16000, frameMs: 250, channels: given } });
    if (p.channels !== expect) ok = false;
    // frame size is the observable consequence of `step`
    const want = expect === 2 ? 16000 : 8000;
    for (let q = 0; q < 600; q++) {
      const L = new Float32Array(128).fill(0.3);
      const R = new Float32Array(128).fill(-0.3);
      p.process([[L, R]]);
    }
    if (!p.port._frames.every((b) => b.byteLength === want)) ok = false;
  }
  check("fail-safe channels parse unchanged (only literal 2 ⇒ stereo) and step matches frame size", ok);
}

console.log(fails === 0 ? "\nWORKLET DIFF: OUTPUT IS BYTE-FOR-BYTE IDENTICAL" : `\n${fails} DIFF CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
