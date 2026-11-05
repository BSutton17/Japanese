import { describe, expect, it } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { KANA, lookalikesOf } from "./data.js";
import { applyReview, buildSession, buildSummary, newItemLimit, statusOf } from "./session.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function cardDueIn(days: number, stability = 5): Card {
  return { ...createEmptyCard(NOW), due: new Date(NOW.getTime() + days * DAY), stability };
}

describe("kana data", () => {
  it("has 104 unique characters per script", () => {
    for (const items of Object.values(KANA)) {
      expect(items).toHaveLength(104);
      expect(new Set(items.map((item) => item.id)).size).toBe(104);
    }
  });

  it("derives katakana that matches the hiragana readings", () => {
    const find = (kana: string) => KANA.katakana.find((item) => item.kana === kana);
    expect(find("シ")?.romaji).toBe("shi");
    expect(find("ツ")?.romaji).toBe("tsu");
    expect(find("キャ")?.romaji).toBe("kya");
    expect(find("ン")?.romaji).toBe("n");
  });

  it("only lists lookalikes that exist in the same script", () => {
    for (const items of Object.values(KANA)) {
      const known = new Set(items.map((item) => item.kana));
      for (const item of items) {
        for (const lookalike of lookalikesOf(item)) expect(known.has(lookalike)).toBe(true);
      }
    }
  });
});

describe("buildSession", () => {
  it("starts a first session with new characters in teaching order", () => {
    const questions = buildSession({ script: "hiragana", cards: new Map(), recentAccuracy: undefined, now: NOW });
    expect(questions).toHaveLength(5);
    expect(questions.every((question) => question.isNew)).toBe(true);
    expect(questions.map((question) => question.kana).sort()).toEqual(["あ", "い", "う", "え", "お"].sort());
    expect(questions.every((question) => question.direction === "kana-to-romaji")).toBe(true);
  });

  it("puts due reviews ahead of new characters and pauses new ones during a backlog", () => {
    const cards = new Map(KANA.hiragana.slice(0, 25).map((item) => [item.id, cardDueIn(-1)]));
    const questions = buildSession({ script: "hiragana", cards, recentAccuracy: 1, now: NOW });
    expect(questions).toHaveLength(20);
    expect(questions.some((question) => question.isNew)).toBe(false);
  });

  it("repeats no character within a session", () => {
    const cards = new Map(KANA.hiragana.slice(0, 12).map((item, index) => [item.id, cardDueIn(index - 6)]));
    const questions = buildSession({ script: "hiragana", cards, recentAccuracy: 0.8, now: NOW });
    expect(new Set(questions.map((question) => question.itemId)).size).toBe(questions.length);
  });

  it("gives four distinct options that include the only right answer", () => {
    const cards = new Map(KANA.hiragana.map((item) => [item.id, cardDueIn(-1)]));
    for (let run = 0; run < 50; run++) {
      for (const question of buildSession({ script: "hiragana", cards, recentAccuracy: 0.8, now: NOW })) {
        expect(new Set(question.options).size).toBe(4);
        expect(question.options).toContain(question.answer);
      }
    }
  });

  it("never offers a same-sounding character as a wrong answer", () => {
    const ji = KANA.hiragana.find((item) => item.kana === "じ")!;
    const cards = new Map([[ji.id, cardDueIn(-1)]]);
    for (let run = 0; run < 200; run++) {
      const question = buildSession({ script: "hiragana", cards, recentAccuracy: 0.8, now: NOW }).find(
        (candidate) => candidate.itemId === ji.id,
      )!;
      expect(question.options).not.toContain("ぢ");
    }
  });

  it("uses lookalikes as wrong answers when they exist", () => {
    const shi = KANA.katakana.find((item) => item.kana === "シ")!;
    const cards = new Map([[shi.id, cardDueIn(-1)]]);
    const question = buildSession({
      script: "katakana",
      cards,
      recentAccuracy: 0.8,
      now: NOW,
      random: () => 0.1, // Below 0.5 picks kana-to-romaji, so options show readings.
    }).find((candidate) => candidate.itemId === shi.id)!;
    expect(question.direction).toBe("kana-to-romaji");
    expect(question.options).toContain("tsu");
  });
});

describe("pacing and scheduling", () => {
  it("adjusts new characters to recent accuracy", () => {
    expect(newItemLimit(undefined)).toBe(5);
    expect(newItemLimit(0.95)).toBe(10);
    expect(newItemLimit(0.8)).toBe(5);
    expect(newItemLimit(0.5)).toBe(2);
  });

  it("schedules a correct answer later than a wrong one", () => {
    const right = applyReview(undefined, true, NOW);
    const wrong = applyReview(undefined, false, NOW);
    expect(right.due.getTime()).toBeGreaterThan(wrong.due.getTime());
    expect(right.reps).toBe(1);
  });

  it("reads dates back after they've been stored as strings", () => {
    const stored = { ...cardDueIn(-1), due: new Date(NOW.getTime() - DAY).toISOString() } as unknown as Card;
    expect(statusOf(stored, NOW)).toBe("due");
  });

  it("summarizes status for each character", () => {
    const [first, second, third] = KANA.hiragana as [typeof KANA.hiragana[0], typeof KANA.hiragana[0], typeof KANA.hiragana[0]];
    const summary = buildSummary(
      "hiragana",
      new Map([
        [first.id, cardDueIn(-1)],
        [second.id, cardDueIn(3)],
        [third.id, cardDueIn(30, 40)],
      ]),
      NOW,
    );
    expect(summary).toMatchObject({ total: 104, seen: 3, due: 1, strong: 1 });
    expect(summary.items[1]?.status).toBe("learning");
    expect(summary.items[3]?.status).toBe("new");
  });
});
