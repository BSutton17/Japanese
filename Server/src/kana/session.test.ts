import { describe, expect, it } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { applyReview, statusOf } from "../srs.js";
import { KANA, KANA_ROWS, lookalikesOf } from "./data.js";
import { buildSession, buildSummary } from "./session.js";

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

  it("splits characters into uniquely named rows", () => {
    for (const rows of Object.values(KANA_ROWS)) {
      expect(rows).toHaveLength(26);
      expect(new Set(rows.map((row) => row.id)).size).toBe(26);
    }
    expect(KANA_ROWS.hiragana[1]?.items.map((item) => item.kana)).toEqual(["か", "き", "く", "け", "こ"]);
    expect(KANA_ROWS.katakana[9]?.items.map((item) => item.kana)).toEqual(["ワ", "ヲ", "ン"]);
  });

  it("derives katakana that matches the hiragana readings", () => {
    const find = (kana: string) => KANA.katakana.find((item) => item.kana === kana);
    expect(find("シ")?.romaji).toBe("shi");
    expect(find("ツ")?.romaji).toBe("tsu");
    expect(find("キャ")?.romaji).toBe("kya");
    expect(find("ン")?.romaji).toBe("n");
  });

  it("keeps ids compatible with progress that's already saved", () => {
    expect(KANA.hiragana[0]?.id).toBe("hiragana:あ");
    expect(KANA.katakana[0]?.id).toBe("katakana:ア");
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

describe("row sessions", () => {
  it("reads each character in order, then picks each one out", () => {
    const questions = buildSession({ script: "hiragana", selection: { mode: "row", rowId: "ka" }, cards: new Map(), now: NOW });
    expect(questions).toHaveLength(10);
    expect(questions.slice(0, 5).map((question) => question.kana)).toEqual(["か", "き", "く", "け", "こ"]);
    expect(questions.slice(0, 5).every((question) => question.direction === "kana-to-romaji" && question.isNew)).toBe(true);
    expect(questions.slice(5).every((question) => question.direction === "romaji-to-kana" && !question.isNew)).toBe(true);
  });

  it("never mixes in older characters, even when they're overdue", () => {
    const cards = new Map(KANA_ROWS.hiragana[0]!.items.map((item) => [item.id, cardDueIn(-5)]));
    const questions = buildSession({ script: "hiragana", selection: { mode: "row", rowId: "ka" }, cards, now: NOW });
    expect(new Set(questions.map((question) => question.kana))).toEqual(new Set(["か", "き", "く", "け", "こ"]));
  });

  it("uses the rest of the row as wrong answers", () => {
    const row = ["ka", "ki", "ku", "ke", "ko"];
    for (let run = 0; run < 30; run++) {
      const [question] = buildSession({ script: "hiragana", selection: { mode: "row", rowId: "ka" }, cards: new Map(), now: NOW });
      for (const option of question!.options) expect(row).toContain(option);
    }
  });

  it("only teaches characters not yet studied", () => {
    const cards = new Map([["hiragana:か", cardDueIn(5)]]);
    const questions = buildSession({ script: "hiragana", selection: { mode: "row", rowId: "ka" }, cards, now: NOW });
    expect(questions.slice(0, 5).map((question) => question.isNew)).toEqual([false, true, true, true, true]);
  });

  it("gives every row four distinct options, including short rows", () => {
    for (const script of ["hiragana", "katakana"] as const) {
      for (const { id: rowId } of KANA_ROWS[script]) {
        for (const question of buildSession({ script, selection: { mode: "row", rowId }, cards: new Map(), now: NOW })) {
          expect(new Set(question.options).size).toBe(4);
          expect(question.options).toContain(question.answer);
        }
      }
    }
  });

  it("returns nothing for an unknown row", () => {
    expect(buildSession({ script: "hiragana", selection: { mode: "row", rowId: "zzz" }, cards: new Map(), now: NOW })).toEqual([]);
  });
});

describe("all-at-once sessions", () => {
  it("asks every character once with no introductions", () => {
    const questions = buildSession({ script: "katakana", selection: { mode: "all" }, cards: new Map(), now: NOW });
    expect(questions).toHaveLength(104);
    expect(new Set(questions.map((question) => question.itemId)).size).toBe(104);
    expect(questions.some((question) => question.isNew)).toBe(false);
  });

  it("only asks to pick out characters already studied", () => {
    const questions = buildSession({ script: "hiragana", selection: { mode: "all" }, cards: new Map(), now: NOW });
    expect(questions.every((question) => question.direction === "kana-to-romaji")).toBe(true);
  });

  it("uses lookalikes as wrong answers when they exist", () => {
    const question = buildSession({ script: "katakana", selection: { mode: "all" }, cards: new Map(), now: NOW }).find(
      (candidate) => candidate.kana === "シ",
    )!;
    expect(question.options).toContain("tsu");
  });

  it("never offers a same-sounding character as a wrong answer", () => {
    const cards = new Map(KANA.hiragana.map((item) => [item.id, cardDueIn(-1)]));
    for (let run = 0; run < 100; run++) {
      const question = buildSession({ script: "hiragana", selection: { mode: "all" }, cards, now: NOW }).find(
        (candidate) => candidate.kana === "じ",
      )!;
      expect(question.options).not.toContain("ぢ");
    }
  });
});

describe("review sessions", () => {
  it("only includes studied characters that are due", () => {
    const [first, second, third] = KANA.hiragana as [typeof KANA.hiragana[0], typeof KANA.hiragana[0], typeof KANA.hiragana[0]];
    const cards = new Map([[first.id, cardDueIn(-1)], [second.id, cardDueIn(-2)], [third.id, cardDueIn(5)]]);
    const questions = buildSession({ script: "hiragana", selection: { mode: "review" }, cards, now: NOW });
    expect(questions.map((question) => question.itemId).sort()).toEqual([first.id, second.id].sort());
    expect(questions.some((question) => question.isNew)).toBe(false);
  });

  it("caps a large backlog, taking the most overdue first", () => {
    const cards = new Map(KANA.hiragana.slice(0, 30).map((item, index) => [item.id, cardDueIn(-(index + 1))]));
    const questions = buildSession({ script: "hiragana", selection: { mode: "review" }, cards, now: NOW });
    expect(questions).toHaveLength(20);
    const expected = new Set(KANA.hiragana.slice(10, 30).map((item) => item.id));
    expect(questions.every((question) => expected.has(question.itemId))).toBe(true);
  });
});

describe("scheduling and summary", () => {
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

  it("summarizes rows and points to the next row to learn", () => {
    const row = KANA_ROWS.hiragana[0]!.items;
    const cards = new Map(row.map((item, index) => [item.id, cardDueIn(index === 0 ? -1 : 30, index === 1 ? 40 : 5)]));
    const summary = buildSummary("hiragana", cards, NOW);
    expect(summary).toMatchObject({ total: 104, seen: 5, due: 1, strong: 1, nextRowId: "ka" });
    expect(summary.rows[0]?.items[0]?.status).toBe("due");
    expect(summary.rows[0]?.items[1]?.status).toBe("strong");
    expect(summary.rows[0]?.items[2]?.status).toBe("learning");
    expect(summary.rows[1]?.items[0]?.status).toBe("new");
  });

  it("has no next row once everything is studied", () => {
    const cards = new Map(KANA.hiragana.map((item) => [item.id, cardDueIn(5)]));
    expect(buildSummary("hiragana", cards, NOW).nextRowId).toBeNull();
  });
});
