import { describe, expect, it } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { WORDS } from "../vocab/words.js";
import { buildTutorInstructions, GREETING_PROMPT } from "./prompt.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const studied = (count: number) =>
  new Map<string, Card>(WORDS.slice(0, count).map((word) => [word.id, createEmptyCard(NOW)]));
const instructions = (overrides: Partial<Parameters<typeof buildTutorInstructions>[0]> = {}) =>
  buildTutorInstructions({ ability: 0, levelName: null, nextLevel: "N5", easingBack: false, cards: new Map(), ...overrides });

describe("tutor instructions", () => {
  it("gives her a Japanese accent in both languages, starting with that rule", () => {
    const text = instructions();
    expect(text.startsWith("# Your voice")).toBe(true);
    expect(text).toMatch(/Tokyo pronunciation and pitch accent/);
    expect(text).toMatch(/ALWAYS with an obvious Japanese accent, and never an American one/);
    expect(text).not.toMatch(/natural American English/);
  });

  it("keeps her to Japanese and English, even if the learner's accent sounds like something else", () => {
    expect(instructions()).toMatch(/such as Spanish, it's their accent/);
    expect(instructions()).toMatch(/Never reply in any other language/);
  });

  it("converses in Japanese at every level, keeping English for teaching, correcting, and asking", () => {
    for (const ability of [0, 1.5, 2.5, 3.5]) {
      const text = instructions({ ability });
      expect(text).toMatch(/Reply in Japanese by default/);
      expect(text).toMatch(/never answer Japanese with an English reply/);
      expect(text).toMatch(/Use English ONLY to teach a new word or grammar point, to correct a mistake/);
      expect(text).not.toMatch(/Speak mostly English/);
    }
  });

  it("makes her Japanese harder as the level rises", () => {
    expect(instructions({ ability: 0.2 })).toMatch(/very short, simple Japanese/);
    expect(instructions({ ability: 1.5, levelName: "N5", nextLevel: "N4" })).toMatch(/common N5 words/);
    expect(instructions({ ability: 2.5, levelName: "N4", nextLevel: "N3" })).toMatch(/N4 words and grammar/);
    expect(instructions({ ability: 3.5, levelName: "N3", nextLevel: "N2" })).toMatch(/as you would with a Japanese friend/);
  });

  it("states the learner's level, but trusts how they really speak over it", () => {
    expect(instructions()).toMatch(/about below N5/);
    expect(instructions({ ability: 2.5, levelName: "N4", nextLevel: "N3" })).toMatch(/about N4, working toward N3/);
    expect(instructions()).toMatch(/if they speak in full Japanese sentences, match that level right away/);
  });

  it("doesn't correct spelling, since nothing is written", () => {
    expect(instructions()).toMatch(/never correct spelling or how something is written/);
  });

  it("opens the session in Japanese", () => {
    expect(GREETING_PROMPT).toMatch(/Greet them warmly in Japanese/);
  });

  it("lists words the learner has studied, and not others", () => {
    const text = instructions({ cards: studied(3) });
    expect(text).toContain(WORDS[0]!.word);
    const studiedSection = text.split("Words they have studied:")[1]!.split("Good new words")[0]!;
    expect(studiedSection).not.toContain(WORDS[3]!.meanings[0]!);
  });

  it("says so when nothing has been studied", () => {
    expect(instructions()).toMatch(/Words they have studied:\nNone yet\./);
  });

  it("caps the word list so the instructions stay small", () => {
    const text = instructions({ cards: studied(1000) });
    const section = text.split("Words they have studied:\n")[1]!.split("\n\nGood new words")[0]!;
    expect(section.split("\n")).toHaveLength(150);
  });

  it("suggests new words the learner hasn't studied yet", () => {
    const text = instructions({ cards: studied(5) });
    const section = text.split("when one fits naturally:\n")[1]!.split("\n\n#")[0]!;
    const lines = section.split("\n");
    expect(lines.some((line) => line.startsWith(`${WORDS[0]!.word}:`))).toBe(false);
    expect(lines).toHaveLength(8);
  });

  it("only mentions a comeback after a break", () => {
    expect(instructions()).not.toMatch(/coming back after a break/);
    expect(instructions({ easingBack: true })).toMatch(/coming back after a break/);
  });

  it("tells the tutor to stay quiet around noise and not to make up news", () => {
    const text = instructions();
    expect(text).toMatch(/TV, a game/);
    expect(text).toMatch(/Never make up news/);
  });
});
