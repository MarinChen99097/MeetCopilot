/*
 * pcm-downsampler — AudioWorkletProcessor for the /copilot capture pipeline.
 *
 * Receives the Meet tab's mixed audio (Float32, mono, at the AudioContext rate — normally 16 kHz
 * because we request `new AudioContext({ sampleRate: 16000 })`, but we resample defensively in case
 * a browser ignores the requested rate) and emits **raw 16-bit little-endian PCM, 16 kHz, mono,
 * headerless** frames (~250 ms each) as transferable ArrayBuffers to the main thread, which relays
 * them over the WS binary channel (API_CONTRACT §6 audio frame layout).
 *
 * Plain JS on purpose: this file is served statically and loaded via `audioWorklet.addModule('/pcm-worklet.js')`;
 * it is NOT bundled/typechecked by Next. Keep it dependency-free and ES2017-safe.
 */
class PcmDownsampler extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetSampleRate || 16000;
    const frameMs = opts.frameMs || 250;
    // `sampleRate` is a global in AudioWorkletGlobalScope = the context's actual rate.
    this.inRate = sampleRate;
    this.ratio = this.inRate / this.targetRate; // input samples consumed per output sample
    this.frameSamples = Math.max(1, Math.round((this.targetRate * frameMs) / 1000));
    this.buf = new Int16Array(this.frameSamples);
    this.bufLen = 0;
    this.readPos = 0; // fractional read cursor carried across process() calls
    this.carry = new Float32Array(0); // leftover input tail for gapless resampling
    this.closed = false;
    this.port.onmessage = (e) => {
      if (e.data === "stop") this.closed = true;
    };
  }

  process(inputs) {
    if (this.closed) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const chan = input[0];
    if (!chan || chan.length === 0) return true;

    // Prepend any carried tail so resampling is continuous across quantum boundaries.
    let data;
    if (this.carry.length) {
      data = new Float32Array(this.carry.length + chan.length);
      data.set(this.carry, 0);
      data.set(chan, this.carry.length);
    } else {
      data = chan;
    }

    let pos = this.readPos;
    const n = data.length;
    while (pos + 1 < n) {
      const i = pos | 0;
      const frac = pos - i;
      let s = data[i] * (1 - frac) + data[i + 1] * frac;
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      this.buf[this.bufLen++] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
      if (this.bufLen >= this.frameSamples) {
        const out = this.buf.slice(0, this.frameSamples); // copy → its own ArrayBuffer
        this.port.postMessage(out.buffer, [out.buffer]); // transfer (zero-copy)
        this.bufLen = 0;
      }
      pos += this.ratio;
    }

    const consumed = pos | 0;
    this.carry = data.slice(consumed);
    this.readPos = pos - consumed;
    return true;
  }
}

registerProcessor("pcm-downsampler", PcmDownsampler);
