// Runs on the browser's audio thread. Turns microphone audio into the 16 kHz, 16-bit chunks
// Gemini expects, about 40 ms at a time as its docs recommend.
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 640;
// Sounds above half the target rate can't be represented, and fold back as noise over the speech
// unless they're removed first. Stopping a little short leaves room for the filter to roll off.
const CUTOFF_HZ = 7000;
const FILTER_LOBES = 16;
const TABLE_STEPS_PER_SAMPLE = 64;

function sinc(x) {
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}

/** One side of a windowed-sinc low-pass filter, finely sampled so any rate ratio can use it. */
function buildFilter(rate) {
  const cutoff = Math.min(CUTOFF_HZ, rate * 0.45);
  const halfWidth = (FILTER_LOBES * rate) / (2 * cutoff);
  const table = new Float32Array(Math.ceil(halfWidth * TABLE_STEPS_PER_SAMPLE) + 2);
  for (let i = 0; i < table.length; i++) {
    const distance = i / TABLE_STEPS_PER_SAMPLE;
    if (distance >= halfWidth) break;
    const window = 0.5 + 0.5 * Math.cos((Math.PI * distance) / halfWidth);
    table[i] = ((2 * cutoff) / rate) * sinc((2 * cutoff * distance) / rate) * window;
  }
  return { table, halfWidth };
}

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    const { table, halfWidth } = buildFilter(sampleRate);
    this.table = table;
    this.halfWidth = halfWidth;
    this.step = sampleRate / TARGET_RATE;
    // Holds enough recent input for the filter to look both ways around each output sample.
    const history = Math.ceil(2 * halfWidth) + 1024;
    this.ring = new Float32Array(2 ** Math.ceil(Math.log2(history)));
    this.mask = this.ring.length - 1;
    this.written = 0;
    this.position = 0;
    this.chunk = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
    this.peak = 0;
  }

  filteredAt(position) {
    const first = Math.ceil(position - this.halfWidth);
    const last = Math.floor(position + this.halfWidth);
    let sum = 0;
    for (let i = first; i <= last; i++) {
      const at = Math.abs(i - position) * TABLE_STEPS_PER_SAMPLE;
      const below = Math.floor(at);
      const weight = this.table[below] + (this.table[below + 1] - this.table[below]) * (at - below);
      sum += this.ring[i & this.mask] * weight;
    }
    return sum;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.ring[this.written++ & this.mask] = channel[i];
    }

    while (this.position + this.halfWidth < this.written) {
      const sample = Math.max(-1, Math.min(1, this.filteredAt(this.position)));
      this.position += this.step;
      this.peak = Math.max(this.peak, Math.abs(sample));
      this.chunk[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

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
