import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(new URL("../../../Client/public/pcm-capture.js", import.meta.url), "utf8");
const OUTPUT_RATE = 16000;
const AMPLITUDE = 0.5;

/** Feeds a pure tone through the real worklet, in the browser's 128-sample blocks. */
function capture(rate: number, frequency: number): number[] {
  const output: number[] = [];
  let Processor: (new () => { process(inputs: Float32Array[][]): boolean }) | undefined;
  vm.runInNewContext(SOURCE, {
    sampleRate: rate,
    Math,
    Int16Array,
    Float32Array,
    AudioWorkletProcessor: class {
      port = { postMessage: ({ pcm }: { pcm: ArrayBuffer }) => output.push(...new Int16Array(pcm)) };
    },
    registerProcessor: (_name: string, processor: typeof Processor) => {
      Processor = processor;
    },
  });
  const processor = new Processor!();
  for (let at = 0; at < rate; at += 128) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i++) block[i] = AMPLITUDE * Math.sin((2 * Math.PI * frequency * (at + i)) / rate);
    processor.process([[block]]);
  }
  // The start is skipped, while the filter is still filling up.
  return output.slice(800).map((value) => value / 32768);
}

function loudness(samples: number[]): number {
  return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
}

/** How strongly a tone of this frequency appears in the output, from 0 to 1. */
function toneStrength(samples: number[], frequency: number): number {
  let real = 0;
  let imaginary = 0;
  samples.forEach((value, i) => {
    real += value * Math.cos((2 * Math.PI * frequency * i) / OUTPUT_RATE);
    imaginary += value * Math.sin((2 * Math.PI * frequency * i) / OUTPUT_RATE);
  });
  return (2 * Math.hypot(real, imaginary)) / samples.length;
}

describe.each([16000, 24000, 44100, 48000])("microphone audio captured at %i Hz", (rate) => {
  it.each([300, 1000, 3400, 6000])("keeps a %i Hz speech tone clean and full strength", (frequency) => {
    const samples = capture(rate, frequency);
    const strength = toneStrength(samples, frequency);
    expect(strength).toBeGreaterThan(AMPLITUDE * 0.97);
    const everythingElse = Math.max(loudness(samples) ** 2 - strength ** 2 / 2, 1e-12);
    expect(10 * Math.log10(strength ** 2 / 2 / everythingElse)).toBeGreaterThan(50);
  });

  it("produces audio at the rate Gemini expects", () => {
    expect(capture(rate, 1000).length + 800).toBeGreaterThan(OUTPUT_RATE - 700);
    expect(capture(rate, 1000).length + 800).toBeLessThanOrEqual(OUTPUT_RATE);
  });
});

describe.each([24000, 44100, 48000])("microphone audio captured at %i Hz", (rate) => {
  it("doesn't fold sounds too high for 16 kHz back over the speech", () => {
    expect(loudness(capture(rate, 11000))).toBeLessThan(0.002);
  });
});
