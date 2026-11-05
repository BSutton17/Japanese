import { describe, expect, it } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { WORDS_BY_ID, buildSession, buildSummary, exampleFor, linkedOrder, newBatchSize, normalizeMeaning } from "./session.js";
import { SIMPLE_EXAMPLES } from "./simple-examples.js";
import { WORDS } from "./words.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function cardDueIn(days: number, stability = 5): Card {
  return { ...createEmptyCard(NOW), due: new Date(NOW.getTime() + days * DAY), stability };
}

const rankOf = (word: string, reading?: string) =>
  WORDS.find((candidate) => candidate.word === word && (!reading || candidate.reading === reading))!.rank;

describe("word list", () => {
  it("has unique ids and everything a question needs", () => {
    expect(WORDS.length).toBeGreaterThan(7000);
    expect(WORDS_BY_ID.size).toBe(WORDS.length);
    for (const word of WORDS) {
      expect(word.word && word.reading && word.romaji && word.meanings[0]).toBeTruthy();
    }
  });

  it("gives every example sentence text to display", () => {
    for (const word of WORDS) {
      for (const example of word.examples) {
        expect(example.furigana, word.word).toBeTruthy();
        expect(example.en, word.word).toBeTruthy();
      }
    }
  });

  it("uses the everyday reading of 私", () => {
    const watashi = WORDS.find((word) => word.word === "私" && word.level === "N5")!;
    expect(watashi.reading).toBe("わたし");
    expect(watashi.romaji).toBe("watashi");
    expect(watashi.rank).toBeLessThan(60);
  });

  it("filters out unsuitable sentences", () => {
    for (const word of WORDS) {
      for (const example of word.examples) {
        expect(example.furigana, word.word).not.toMatch(/アソコ|おっぱい|ちんちん/);
        expect(example.en, word.word).not.toMatch(/\b(sex|naked|penis|fuck|murder)\b/i);
      }
    }
  });
});

describe("frequency table", () => {
  it("orders the list by unique, continuous rank", () => {
    WORDS.forEach((word, index) => expect(word.rank).toBe(index + 1));
  });

  it("ranks everyday words ahead of rare ones", () => {
    expect(rankOf("する")).toBeLessThan(10);
    expect(rankOf("言う", "いう")).toBeLessThan(20);
    expect(rankOf("行く")).toBeLessThan(rankOf("電車"));
    expect(rankOf("先生")).toBeLessThan(rankOf("万年筆"));
  });

  it("doesn't let a rare reading borrow a common word's count", () => {
    expect(rankOf("僕", "ぼく")).toBeLessThan(150);
    expect(rankOf("僕", "しもべ")).toBeGreaterThan(1000);
  });

  it("doesn't let a word borrow the count of a particle or homophone", () => {
    expect(rankOf("蚊")).toBeGreaterThan(1000);
    expect(rankOf("活ける")).toBeGreaterThan(1000);
  });

  it("keeps common phrases the corpus splits into parts from sinking to the bottom", () => {
    for (const phrase of ["すみません", "もう一度", "どうして", "だから", "飛行機", "お母さん"]) {
      expect(rankOf(phrase), phrase).toBeLessThan(3000);
    }
  });
});

describe("example sentences", () => {
  const entries = Object.entries(SIMPLE_EXAMPLES);
  const plainText = (furigana: string) => furigana.replace(/\{([^|}]+)\|[^}]+\}/g, "$1");
  const word = (overrides: Partial<(typeof WORDS)[0]>) => ({ ...WORDS[0]!, word: "テスト", reading: "テスト", ...overrides });

  it("have a simple sentence for each word a beginner meets first", () => {
    const first = WORDS.filter((candidate) => candidate.level === "N5" || candidate.level === "N4").slice(0, 150);
    for (const candidate of first) {
      expect(SIMPLE_EXAMPLES[`${candidate.word}|${candidate.reading}`], candidate.word).toBeDefined();
    }
  });

  it("only cover words that exist, and use the word in the sentence", () => {
    const known = new Set(WORDS.map((candidate) => `${candidate.word}|${candidate.reading}`));
    for (const [key, example] of entries) {
      expect(known.has(key), key).toBe(true);
      const [spelling] = key.split("|") as [string];
      // する changes to し when conjugated, so its first character isn't in the sentence.
      if (spelling !== "する") expect(plainText(example.furigana), key).toContain(spelling[0]);
    }
  });

  it("have well-formed furigana on every kanji", () => {
    for (const [key, example] of entries) {
      const leftover = example.furigana.replace(/\{[^|}]+\|[^}]+\}/g, "");
      expect(leftover, key).not.toMatch(/[{}|\u4e00-\u9fff]/);
      expect(example.en, key).toBeTruthy();
    }
  });

  it("give a beginner the simple sentence, then harder ones as they level up", () => {
    const easy = { furigana: "やさしい。", en: "easy", difficulty: 0 };
    const medium = { furigana: "ふつう。", en: "medium", difficulty: 1 };
    const hard = { furigana: "むずかしい。", en: "hard", difficulty: 2 };
    const both = word({ examples: [easy, medium, hard] });

    const suru = WORDS.find((candidate) => candidate.word === "する")!;
    expect(exampleFor(suru, 0)).toEqual(SIMPLE_EXAMPLES["する|する"]);
    expect(exampleFor(suru, 1.5)).toEqual(SIMPLE_EXAMPLES["する|する"]);

    expect(exampleFor(both, 0)?.en).toBe("easy");
    expect(exampleFor(both, 1.5)?.en).toBe("medium");
    expect(exampleFor(both, 3)?.en).toBe("hard");
  });

  it("hide a hard sentence from a beginner rather than show it", () => {
    const hard = { furigana: "むずかしい。", en: "hard", difficulty: 2 };
    expect(exampleFor(word({ examples: [hard] }), 0)).toBeUndefined();
    expect(exampleFor(word({ examples: [hard] }), 3.5)?.en).toBe("hard");
  });

  it("fall back to the simple sentence when nothing else fits", () => {
    const suru = WORDS.find((candidate) => candidate.word === "する")!;
    const onlyHard = { ...suru, examples: [{ furigana: "むずかしい。", en: "hard", difficulty: 2 }] };
    expect(exampleFor(onlyHard, 2.5)).toEqual(SIMPLE_EXAMPLES["する|する"]);
  });

  it("reach new-word questions at the learner's level", () => {
    const [first] = buildSession({ type: "new", cards: new Map(), recentAccuracy: undefined, now: NOW });
    expect(first!.word).toBe("する");
    expect(first!.example).toEqual(SIMPLE_EXAMPLES["する|する"]);
  });
});

describe("linked order", () => {
  it("places every word twice, 2 to 5 questions apart", () => {
    for (let words = 2; words <= 24; words++) {
      for (let run = 0; run < 100; run++) {
        const order = linkedOrder(words, Math.random);
        expect(order).toHaveLength(words * 2);
        for (let word = 0; word < words; word++) {
          const first = order.indexOf(word);
          const second = order.lastIndexOf(word);
          expect(first).not.toBe(second);
          expect(second - first).toBeGreaterThanOrEqual(2);
          expect(second - first).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it("varies the spacing", () => {
    const gaps = new Set<number>();
    for (let run = 0; run < 200; run++) {
      const order = linkedOrder(8, Math.random);
      for (let word = 0; word < 8; word++) gaps.add(order.lastIndexOf(word) - order.indexOf(word));
    }
    expect(gaps).toEqual(new Set([2, 3, 4, 5]));
  });

  it("introduces words in the order given", () => {
    const order = linkedOrder(10, Math.random);
    const firstAppearances = [...new Set(order)];
    expect(firstAppearances).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("handles a single word", () => {
    expect(linkedOrder(1, Math.random)).toEqual([0, 0]);
  });

  it("handles no words", () => {
    expect(linkedOrder(0, Math.random)).toEqual([]);
  });
});

describe("new word sessions", () => {
  const session = (cards = new Map<string, Card>(), recentAccuracy?: number) =>
    buildSession({ type: "new", cards, recentAccuracy, now: NOW });

  it("asks each word once in each direction", () => {
    const questions = session();
    expect(questions).toHaveLength(16);
    for (const id of new Set(questions.map((question) => question.itemId))) {
      const appearances = questions.filter((question) => question.itemId === id);
      expect(appearances.map((question) => question.direction)).toEqual(["ja-to-en", "en-to-ja"]);
    }
  });

  it("only teaches a word at its first appearance", () => {
    const questions = session();
    const seen = new Set<string>();
    for (const question of questions) {
      expect(question.isNew).toBe(!seen.has(question.itemId));
      seen.add(question.itemId);
    }
  });

  it("links each word's second question 2 to 5 questions later", () => {
    const questions = session();
    const ids = questions.map((question) => question.itemId);
    for (const id of new Set(ids)) {
      const gap = ids.lastIndexOf(id) - ids.indexOf(id);
      expect(gap).toBeGreaterThanOrEqual(2);
      expect(gap).toBeLessThanOrEqual(5);
    }
  });

  it("starts with the most common words", () => {
    const firstIds = [...new Set(session().map((question) => question.itemId))];
    const ranks = firstIds.map((id) => WORDS_BY_ID.get(id)!.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const unlocked = WORDS.filter((word) => word.level === "N5" || word.level === "N4");
    expect(ranks).toEqual(unlocked.slice(0, 8).map((word) => word.rank));
  });

  it("never mixes in words already studied", () => {
    const studied = WORDS.slice(0, 30);
    const cards = new Map(studied.map((word) => [word.id, cardDueIn(-3)]));
    const studiedIds = new Set(studied.map((word) => word.id));
    expect(session(cards, 0.8).some((question) => studiedIds.has(question.itemId))).toBe(false);
  });

  it("holds back words from levels too far ahead", () => {
    const levels = new Set(session().map((question) => WORDS_BY_ID.get(question.itemId)!.level));
    expect(levels.has("N3")).toBe(false);
    expect(levels.has("N2")).toBe(false);
    expect(levels.has("N1")).toBe(false);
  });

  it("unlocks the next level before a level is fully finished", () => {
    const n5 = WORDS.filter((word) => word.level === "N5");
    const n4 = WORDS.filter((word) => word.level === "N4");
    // Studying the most common 60% of N5 and all of the most common N4 leaves N3's best words next.
    const cards = new Map(
      [...n5.slice(0, Math.ceil(n5.length * 0.6)), ...n4.slice(0, 50)].map((word) => [word.id, cardDueIn(3)]),
    );
    const levels = session(cards, 0.8).map((question) => WORDS_BY_ID.get(question.itemId)!.level);
    expect(levels).toContain("N3");
    expect(levels).not.toContain("N2");
  });

  it("adjusts the batch to accuracy and backlog", () => {
    expect(newBatchSize(undefined, 0)).toBe(8);
    expect(newBatchSize(0.95, 0)).toBe(12);
    expect(newBatchSize(0.8, 0)).toBe(8);
    expect(newBatchSize(0.5, 0)).toBe(5);
    expect(newBatchSize(0.95, 50)).toBe(5);
  });

  it("takes on less while easing back from a break", () => {
    expect(newBatchSize(0.95, 0, true)).toBe(5);
    const words = (easingBack: boolean) =>
      new Set(
        buildSession({ type: "new", cards: new Map(), recentAccuracy: 0.95, easingBack, now: NOW }).map(
          (question) => question.itemId,
        ),
      ).size;
    expect(words(false)).toBe(12);
    expect(words(true)).toBe(5);
  });
});

describe("review sessions", () => {
  const review = (cards: Map<string, Card>) =>
    buildSession({ type: "review", cards, recentAccuracy: 0.8, now: NOW });

  it("only includes due words, taking the most overdue first", () => {
    const cards = new Map<string, Card>();
    WORDS.slice(0, 25).forEach((word, index) => cards.set(word.id, cardDueIn(-(index + 1))));
    WORDS.slice(25, 30).forEach((word) => cards.set(word.id, cardDueIn(5)));
    const questions = review(cards);
    expect(new Set(questions.map((question) => question.itemId))).toEqual(
      new Set(WORDS.slice(15, 25).map((word) => word.id)),
    );
    expect(questions.every((question) => !question.isNew)).toBe(true);
  });

  it("links every word to its opposite format, starting either way", () => {
    const cards = new Map(WORDS.slice(0, 10).map((word) => [word.id, cardDueIn(-1)]));
    const starts = new Set<string>();
    for (let run = 0; run < 20; run++) {
      const questions = review(cards);
      expect(questions).toHaveLength(20);
      for (const word of WORDS.slice(0, 10)) {
        const [first, second] = questions.filter((question) => question.itemId === word.id);
        expect(second!.direction).not.toBe(first!.direction);
        starts.add(first!.direction);
      }
    }
    expect(starts).toEqual(new Set(["ja-to-en", "en-to-ja"]));
  });

  it("still gives a lone due word both directions", () => {
    const word = WORDS[0]!;
    const questions = review(new Map([[word.id, cardDueIn(-1)]]));
    expect(questions).toHaveLength(2);
    expect(questions[0]!.direction).not.toBe(questions[1]!.direction);
  });

  it("is empty when nothing is due", () => {
    expect(review(new Map(WORDS.slice(0, 5).map((word) => [word.id, cardDueIn(5)])))).toEqual([]);
  });

  it("fades readings once a word is strong", () => {
    const kanjiWords = WORDS.filter((word) => word.word !== word.reading);
    const weak = kanjiWords[0]!;
    const strong = kanjiWords[1]!;
    const questions = review(new Map([[weak.id, cardDueIn(-1, 5)], [strong.id, cardDueIn(-1, 40)]]));
    const japanese = (id: string) =>
      questions.find((question) => question.itemId === id && question.direction === "en-to-ja")!;
    expect(japanese(weak.id).showReading).toBe(true);
    expect(japanese(weak.id).options.find((option) => option.text === weak.word)?.reading).toBe(weak.reading);
    expect(japanese(strong.id).showReading).toBe(false);
    expect(japanese(strong.id).options.every((option) => option.reading === undefined)).toBe(true);
  });
});

describe("answer options", () => {
  const appearances = (word: (typeof WORDS)[0]) => {
    const cards = new Map([[word.id, cardDueIn(-1)]]);
    const questions = buildSession({ type: "review", cards, recentAccuracy: 0.8, now: NOW });
    return {
      english: questions.find((question) => question.direction === "ja-to-en")!,
      japanese: questions.find((question) => question.direction === "en-to-ja")!,
    };
  };

  // Wrong answers must be clearly wrong, even though many words share a meaning.
  it("are distinct and never another correct meaning, for sampled words in both directions", () => {
    const step = Math.floor(WORDS.length / 200);
    const sampled = WORDS.filter((_, index) => index % step === 0);
    const byText = new Map(WORDS.map((word) => [word.word, word]));
    for (const word of sampled) {
      const own = new Set(word.meanings.map(normalizeMeaning));
      const { english, japanese } = appearances(word);

      expect(new Set(english.options.map((option) => option.text)).size).toBe(4);
      expect(english.options.map((option) => option.text)).toContain(english.answer);

      expect(new Set(japanese.options.map((option) => option.text)).size).toBe(4);
      for (const option of japanese.options) {
        if (option.text === japanese.answer) continue;
        const shown = byText.get(option.text)!;
        expect(shown.meanings.map(normalizeMeaning).some((meaning) => own.has(meaning))).toBe(false);
      }
    }
  }, 60000);

  it("match the kind of word, so grammar doesn't give the answer away", () => {
    const suru = WORDS.find((word) => word.word === "する")!;
    for (let run = 0; run < 20; run++) {
      const { english } = appearances(suru);
      for (const option of english.options) expect(option.text).toMatch(/^to /);
    }
  });

  it("keep a word with shared meanings from having a synonym as a wrong answer", () => {
    const meet = WORDS.find((word) => word.word === "会う")!;
    const synonyms = WORDS.filter(
      (word) => word.id !== meet.id && word.meanings.map(normalizeMeaning).includes("meet"),
    );
    expect(synonyms.length).toBeGreaterThan(0);
    for (let run = 0; run < 60; run++) {
      const { japanese } = appearances(meet);
      for (const synonym of synonyms) {
        expect(japanese.options.map((option) => option.text)).not.toContain(synonym.word);
      }
    }
  }, 30000);
});

describe("summary", () => {
  it("reports progress per level, due words, and the next batch", () => {
    const n5 = WORDS.filter((word) => word.level === "N5");
    const cards = new Map(n5.slice(0, 10).map((word, index) => [word.id, cardDueIn(index < 3 ? -1 : 5)]));
    const summary = buildSummary(cards, 0.95, NOW);
    expect(summary.due).toBe(3);
    expect(summary.seen).toBe(10);
    expect(summary.currentLevel).toBe("N5");
    expect(summary.nextBatch).toBe(12);
    expect(summary.levels[0]).toMatchObject({ level: "N5", seen: 10, total: n5.length });
    expect(summary.levels[1]).toMatchObject({ level: "N4", seen: 0 });
  });

  it("moves the current level on once most of a level is studied", () => {
    const n5 = WORDS.filter((word) => word.level === "N5");
    const cards = new Map(n5.slice(0, Math.ceil(n5.length * 0.6)).map((word) => [word.id, cardDueIn(5)]));
    expect(buildSummary(cards, 0.8, NOW).currentLevel).toBe("N4");
  });
});
