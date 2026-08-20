/**
 * Anti-vacuity check for worklet-diff.mjs: mutate the NEW worklet IN MEMORY (never on disk) and
 * confirm the differential comparison turns red. A diff harness that cannot fail proves nothing.
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
  let R = null;
  const sandbox = {
    sampleRate: ctxRate,
    Float32Array,
    Int16Array,
    Math,
    AudioWorkletProcessor: class {
      constructor() {
        const frames = [];
        this.port = { onmessage: null, postMessage: (b) => frames.push(b), _frames: frames };
      }
    },
    registerProcessor: (_n, c) => {
      R = c;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return R;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

function drive(src, rate, opts, quanta = 900) {
  const P = load(src, rate);
  const p = new P({ processorOptions: opts });
  const r = rng(999);
  for (let q = 0; q < quanta; q++) {
    const L = new Float32Array(128);
    const R = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      L[i] = r() * 2 - 1;
      R[i] = r() * 2 - 1;
    }
    p.process([[L, R]]);
  }
  return {
    frames: p.port._frames.map((b) => Buffer.from(new Uint8Array(b))),
    state: JSON.stringify({ bufLen: p.bufLen, readPos: p.readPos, carryL: Array.from(p.carryL), carryR: Array.from(p.carryR) }),
  };
}

const identical = (src, rate, opts) => {
  const a = drive(OLD_SRC, rate, opts);
  const b = drive(src, rate, opts);
  return a.frames.length === b.frames.length && a.frames.every((f, i) => f.equals(b.frames[i])) && a.state === b.state;
};

const MUTATIONS = [
  // R carry sliced one sample off L's → the exact failure mode the invariant guards against
  ["carryR sliced with consumed+1", (s) => s.replace("if (stereo) this.carryR = dataR.slice(consumed);", "if (stereo) this.carryR = dataR.slice(consumed + 1);")],
  // joinCarry drops the carry entirely
  ["joinCarry returns chan unconditionally", (s) => s.replace("  if (carry.length === 0) return chan;", "  return chan;")],
  // joinCarry appends in the wrong order
  ["joinCarry order swapped", (s) => s.replace("  out.set(carry, 0);\n  out.set(chan, carry.length);", "  out.set(chan, 0);\n  out.set(carry, chan.length);")],
  // step decoupled from stereo
  ["step forced to 1", (s) => s.replace("const step = stereo ? 2 : 1;", "const step = 1;")],
];

let bad = 0;
for (const [name, mutate] of MUTATIONS) {
  const src = mutate(NEW_SRC);
  if (src === NEW_SRC) {
    console.log(`FAIL  mutation "${name}" did not apply (source text moved)`);
    bad++;
    continue;
  }
  const still = identical(src, 48000, { targetSampleRate: 16000, frameMs: 250, channels: 2 });
  console.log(`${still ? "FAIL" : "PASS"}  mutation "${name}" is detected by the differential comparison`);
  if (still) bad++;
}

// control: the real (unmutated) file must still be identical
const ctrl = identical(NEW_SRC, 48000, { targetSampleRate: 16000, frameMs: 250, channels: 2 });
console.log(`${ctrl ? "PASS" : "FAIL"}  control: unmutated current file is identical to baseline`);
if (!ctrl) bad++;

console.log(bad === 0 ? "\nMUTATION CHECK PASSED (harness is not vacuous)" : `\n${bad} MUTATION CHECK(S) FAILED`);
process.exit(bad === 0 ? 0 : 1);
