// Runs on the browser's audio thread. Turns microphone audio into the 16 kHz, 16-bit chunks
// Gemini expects, about 40 ms at a time as its docs recommend.
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 640;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.chunk = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
    this.sum = 0;
    this.summed = 0;
    this.peak = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      // Averaging while reducing the rate keeps high tones from turning into noise.
      this.sum += channel[i];
      this.summed += 1;
      if (this.summed < this.ratio) continue;

      const sample = Math.max(-1, Math.min(1, this.sum / this.summed));
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.chunk[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.sum = 0;
      this.summed -= this.ratio;

      if (this.filled === CHUNK_SAMPLES) {
        const buffer = this.chunk.buffer.slice(0);
        this.port.postMessage({ pcm: buffer, peak: this.peak }, [buffer]);
        this.filled = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
