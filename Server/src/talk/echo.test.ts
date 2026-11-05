import { describe, expect, it } from "vitest";
import { EchoDetector, soundsLikeHer } from "../../../Client/src/talk/echo.js";

describe("recognizing her own voice in the microphone", () => {
  const her = ["こんにちは!今日はどんな一日でしたか?", "That sounds fun. What movie did you see?"];

  it("matches her words, ignoring punctuation, spacing, and capitals", () => {
    expect(soundsLikeHer("今日はどんな一日でしたか", her)).toBe(true);
    expect(soundsLikeHer("that sounds FUN, what movie", her)).toBe(true);
    expect(soundsLikeHer("こんにちは。", her)).toBe(true);
  });

  it("doesn't match what the learner would really say", () => {
    expect(soundsLikeHer("昨日友達と映画を見ました", her)).toBe(false);
    expect(soundsLikeHer("I watched a comedy with my friend", her)).toBe(false);
  });

  it("needs enough words to judge, and copes with nothing to compare", () => {
    expect(soundsLikeHer("はい", her)).toBe(false);
    expect(soundsLikeHer("", her)).toBe(false);
    expect(soundsLikeHer("今日はどんな一日", [])).toBe(false);
  });
});

describe("deciding she's hearing herself", () => {
  it("doesn't react to one odd moment", () => {
    expect(new EchoDetector().suspect(0)).toBe(false);
  });

  it("reacts to a second one soon after", () => {
    const detector = new EchoDetector();
    detector.suspect(0);
    expect(detector.suspect(10_000)).toBe(true);
  });

  it("forgets one from long ago", () => {
    const detector = new EchoDetector();
    detector.suspect(0);
    expect(detector.suspect(60_000)).toBe(false);
  });
});
