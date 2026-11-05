const OUTPUT_RATE = 24000;
// A small head start, so the first chunk of a reply doesn't get clipped.
const PLAYBACK_LEAD_SECONDS = 0.05;

export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/** Plays Gemini's replies gaplessly, and can stop instantly when the learner interrupts. */
export class AudioPlayer {
  private nextStart = 0;
  private playing = new Set<AudioBufferSourceNode>();

  constructor(private readonly context: AudioContext) {}

  get isPlaying(): boolean {
    return this.playing.size > 0;
  }

  play(base64: string): void {
    const binary = atob(base64);
    const samples = Math.floor(binary.length / 2);
    if (samples === 0) return;

    const buffer = this.context.createBuffer(1, samples, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) {
      const value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
      channel[i] = (value >= 0x8000 ? value - 0x10000 : value) / 0x8000;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.onended = () => this.playing.delete(source);

    const start = Math.max(this.nextStart, this.context.currentTime + PLAYBACK_LEAD_SECONDS);
    source.start(start);
    this.nextStart = start + buffer.duration;
    this.playing.add(source);
  }

  /** Drops everything queued, because the learner has started talking. */
  stop(): void {
    for (const source of this.playing) {
      source.onended = null;
      source.stop();
    }
    this.playing.clear();
    this.nextStart = 0;
  }
}

/** Streams the microphone as 16 kHz chunks. */
export class MicCapture {
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private silence?: GainNode;
  private moduleLoaded = false;

  constructor(
    private readonly context: AudioContext,
    private readonly onChunk: (pcm: ArrayBuffer, peak: number) => void,
  ) {}

  get isLive(): boolean {
    return this.stream?.getAudioTracks().some((track) => track.readyState === "live") ?? false;
  }

  /** What the device actually gave us, since browsers can quietly ignore what was asked for. */
  get details(): string {
    const settings = this.stream?.getAudioTracks()[0]?.getSettings();
    if (!settings) return "off";
    const cleanup = [settings.echoCancellation && "echo", settings.noiseSuppression && "noise", settings.autoGainControl && "volume"].filter(Boolean);
    return `${this.context.sampleRate} Hz, cleaning ${cleanup.length ? cleanup.join(", ") : "nothing"}`;
  }

  async start(): Promise<void> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    if (!this.moduleLoaded) {
      await this.context.audioWorklet.addModule("/pcm-capture.js");
      this.moduleLoaded = true;
    }
    this.source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "pcm-capture");
    this.node.port.onmessage = ({ data }: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
      this.onChunk(data.pcm, data.peak);
    };
    // Audio only flows through a node that reaches the output, so this path is kept silent.
    this.silence = this.context.createGain();
    this.silence.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.silence);
    this.silence.connect(this.context.destination);
  }

  stop(): void {
    this.source?.disconnect();
    this.node?.disconnect();
    this.silence?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.source = undefined;
    this.node = undefined;
    this.silence = undefined;
  }
}
