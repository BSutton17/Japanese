import type { Card } from "ts-fsrs";
import { isDue, isStrong, shuffled } from "../srs.js";
import type { JlptLevel, Word } from "./types.js";
import { WORDS } from "./words.js";

export type VocabDirection = "ja-to-en" | "en-to-ja";
export type VocabSessionType = "new" | "review";

export interface VocabOption {
  text: string;
  reading?: string;
}

export interface VocabQuestion {
  itemId: string;
  word: string;
  reading: string;
  romaji: string;
  gloss: string;
  example?: Word["example"];
  direction: VocabDirection;
  isNew: boolean;
  showReading: boolean;
  options: VocabOption[];
  answer: string;
}

const LEVELS: JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];
const REVIEW_WORD_COUNT = 10;
const WRONG_OPTION_COUNT = 3;
// Past this many waiting reviews, new words shrink to the smallest batch.
const BACKLOG_LIMIT = 50;
// A word's linked question comes this many questions after its first one.
const LINK_GAPS = [2, 3, 4, 5];
// Once this share of a level is studied, the next level joins the pool. Its rarest words then wait
// their turn by frequency instead of holding back much more common words from the level above.
const LEVEL_UNLOCK_SHARE = 0.6;

export const WORDS_BY_ID = new Map(WORDS.map((word) => [word.id, word]));

function glossOf(word: Word): string {
  return word.meanings.slice(0, 2).join("; ");
}

/** Reduces a meaning to a comparable form, so "to open (a door)" matches "to open". */
export function normalizeMeaning(meaning: string): string {
  return meaning
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/^\s*to /, "")
    .trim();
}

function meaningsOf(word: Word): string[] {
  return word.meanings.map(normalizeMeaning);
}

/** Wrong answers match the kind of word, so grammar alone doesn't give the answer away. */
function kindOf(word: Word): string {
  // A bare "vs" tag marks a noun that can take する, but "vs-i" and the like are real verbs.
  if (word.pos.startsWith("v") && word.pos !== "vs") return "verb";
  if (word.pos.startsWith("adj")) return "adjective";
  if (word.pos.startsWith("adv")) return "adverb";
  return "noun";
}

function pickWrongWords(target: Word, random: () => number): Word[] {
  const taken = new Set(meaningsOf(target));
  const readings = new Set([target.reading]);
  const picked: Word[] = [];

  const tiers = [
    WORDS.filter((word) => word.level === target.level && kindOf(word) === kindOf(target)),
    WORDS.filter((word) => kindOf(word) === kindOf(target)),
    WORDS,
  ];
  for (const tier of tiers) {
    for (const word of shuffled(tier, random)) {
      if (picked.length === WRONG_OPTION_COUNT) return picked;
      // Words sharing a meaning could also be right, so they can't be wrong answers.
      const meanings = meaningsOf(word);
      if (word.id === target.id || readings.has(word.reading) || meanings.some((meaning) => taken.has(meaning))) {
        continue;
      }
      picked.push(word);
      readings.add(word.reading);
      meanings.forEach((meaning) => taken.add(meaning));
    }
  }
  return picked;
}

function buildQuestion(
  word: Word,
  direction: VocabDirection,
  isNew: boolean,
  card: Card | undefined,
  random: () => number,
): VocabQuestion {
  // Readings fade once a word is strong, which turns the word into real reading practice.
  const showReading = !isStrong(card);
  const toOption = (option: Word): VocabOption =>
    direction === "ja-to-en"
      ? { text: glossOf(option) }
      : { text: option.word, ...(showReading && option.word !== option.reading ? { reading: option.reading } : {}) };

  const answer = toOption(word);
  return {
    itemId: word.id,
    word: word.word,
    reading: word.reading,
    romaji: word.romaji,
    gloss: glossOf(word),
    example: word.example,
    direction,
    isNew,
    showReading: showReading && word.word !== word.reading,
    options: shuffled([answer, ...pickWrongWords(word, random).map(toOption)], random),
    answer: answer.text,
  };
}

/** Takes on more when recent answers are strong, and less when they slip or reviews pile up. */
export function newBatchSize(recentAccuracy: number | undefined, dueCount: number): number {
  if (dueCount >= BACKLOG_LIMIT) return 5;
  if (recentAccuracy === undefined) return 8;
  if (recentAccuracy >= 0.9) return 12;
  if (recentAccuracy < 0.7) return 5;
  return 8;
}

function countDue(cards: ReadonlyMap<string, Card>, now: Date): number {
  let due = 0;
  for (const card of cards.values()) if (isDue(card, now)) due++;
  return due;
}

/**
 * Lays out each word twice, so its second question falls 2 to 5 questions after its first.
 * Returns word indexes by position, in order of first appearance. A lone word has nothing
 * to go between its two questions, so it simply repeats.
 */
export function linkedOrder(wordCount: number, random: () => number): number[] {
  if (wordCount === 1) return [0, 0];
  const slots = Array<number | undefined>(wordCount * 2).fill(undefined);

  const place = (nextWord: number): boolean => {
    if (nextWord === wordCount) return true;
    const first = slots.indexOf(undefined);
    slots[first] = nextWord;
    for (const gap of shuffled(LINK_GAPS, random)) {
      const second = first + gap;
      if (second >= slots.length || slots[second] !== undefined) continue;
      slots[second] = nextWord;
      if (place(nextWord + 1)) return true;
      slots[second] = undefined;
    }
    slots[first] = undefined;
    return false;
  };

  place(0);
  return slots as number[];
}

const opposite = (direction: VocabDirection): VocabDirection =>
  direction === "ja-to-en" ? "en-to-ja" : "ja-to-en";

function buildLinkedQuestions(
  words: readonly Word[],
  firstDirection: (word: Word) => VocabDirection,
  isNew: boolean,
  cards: ReadonlyMap<string, Card>,
  random: () => number,
): VocabQuestion[] {
  const appeared = new Map<number, VocabDirection>();
  return linkedOrder(words.length, random).map((wordIndex) => {
    const word = words[wordIndex]!;
    const firstFormat = appeared.get(wordIndex);
    const direction = firstFormat ? opposite(firstFormat) : firstDirection(word);
    appeared.set(wordIndex, direction);
    return buildQuestion(word, direction, isNew && !firstFormat, cards.get(word.id), random);
  });
}

/** The lowest level still being worked through, which sets how far ahead new words can come from. */
function currentLevelIndex(cards: ReadonlyMap<string, Card>): number {
  const index = LEVELS.findIndex((level) => {
    const words = WORDS.filter((word) => word.level === level);
    return words.filter((word) => cards.has(word.id)).length < words.length * LEVEL_UNLOCK_SHARE;
  });
  return index === -1 ? LEVELS.length - 1 : index;
}

export function buildSession(options: {
  type: VocabSessionType;
  cards: ReadonlyMap<string, Card>;
  recentAccuracy: number | undefined;
  now: Date;
  random?: () => number;
}): VocabQuestion[] {
  const { type, cards, recentAccuracy, now, random = Math.random } = options;

  if (type === "review") {
    const dueTime = (word: Word) => new Date(cards.get(word.id)!.due).getTime();
    const due = WORDS.filter((word) => {
      const card = cards.get(word.id);
      return card !== undefined && isDue(card, now);
    })
      .sort((a, b) => dueTime(a) - dueTime(b))
      .slice(0, REVIEW_WORD_COUNT);
    return buildLinkedQuestions(
      shuffled(due, random),
      () => (random() < 0.5 ? "ja-to-en" : "en-to-ja"),
      false,
      cards,
      random,
    );
  }

  // New words only, most common first. A level beyond the current one can join in, but no further,
  // so a common word from a much harder level can't arrive too early.
  const unlocked = new Set(LEVELS.slice(0, currentLevelIndex(cards) + 2));
  const batch = WORDS.filter((word) => !cards.has(word.id) && unlocked.has(word.level)).slice(
    0,
    newBatchSize(recentAccuracy, countDue(cards, now)),
  );
  // A new word is read first, since recognizing it is easier than recalling it.
  return buildLinkedQuestions(batch, () => "ja-to-en", true, cards, random);
}

export function buildSummary(cards: ReadonlyMap<string, Card>, recentAccuracy: number | undefined, now: Date) {
  const due = countDue(cards, now);
  const levels = LEVELS.map((level) => {
    const words = WORDS.filter((word) => word.level === level);
    return {
      level,
      total: words.length,
      seen: words.filter((word) => cards.has(word.id)).length,
      strong: words.filter((word) => isStrong(cards.get(word.id))).length,
    };
  });
  return {
    levels,
    due,
    seen: cards.size,
    currentLevel: LEVELS[currentLevelIndex(cards)]!,
    nextBatch: Math.min(newBatchSize(recentAccuracy, due), WORDS.length - cards.size),
  };
}
