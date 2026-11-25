// AudioWorklet of the Mic's ElevenLabs agent (core/elevenAgent.ts): microphone samples → 16-bit PCM at
// the agent's input rate (16 kHz), posted to the page every ~100 ms. Plain JS loaded by URL (an
// AudioWorklet module must be a same-origin file: the CSP has no blob: scripts). Downsampling averages
// the input samples that fall into each output sample, which keeps speech clean from 44.1/48 kHz.
class TiePcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const rate = (options && options.processorOptions && options.processorOptions.rate) || 16000;
    // sampleRate: the AudioContext's rate (AudioWorkletGlobalScope).
    this.step = sampleRate / rate;
    this.out = new Int16Array(Math.max(160, Math.round(rate / 10)));
    this.n = 0;
    this.acc = 0;
    this.cnt = 0;
    this.pos = 0;
  }

  push(v) {
    const s = v > 1 ? 1 : v < -1 ? -1 : v;
    this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    if (this.n === this.out.length) {
      this.port.postMessage(this.out.buffer, [this.out.buffer]);
      this.out = new Int16Array(this.out.length);
      this.n = 0;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.step <= 1) {
      // Input slower than the target (rare): repeat samples.
      for (let i = 0; i < ch.length; i++) {
        this.pos += 1 / this.step;
        while (this.pos >= 1) {
          this.push(ch[i]);
          this.pos -= 1;
        }
      }
      return true;
    }
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.cnt++;
      this.pos += 1;
      if (this.pos >= this.step) {
        this.push(this.acc / this.cnt);
        this.pos -= this.step;
        this.acc = 0;
        this.cnt = 0;
      }
    }
    return true;
  }
}

registerProcessor('tie-pcm-capture', TiePcmCapture);
