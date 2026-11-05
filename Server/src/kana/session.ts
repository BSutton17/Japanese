import { Rating, createEmptyCard, fsrs, type Card } from "ts-fsrs";
import { KANA, lookalikesOf, type KanaItem, type Script } from "./data.js";

export type Direction = "kana-to-romaji" | "romaji-to-kana";
export type KanaStatus = "new" | "learning" | "due" | "strong";

export interface KanaQuestion {
  itemId: string;
  kana: string;
  romaji: string;
  direction: Direction;
  isNew: boolean;
  options: string[];
  answer: string;
}

const SESSION_SIZE = 20;
const OPTION_COUNT = 4;
// A card this stable is remembered for about three weeks, so it counts as strong.
const STRONG_STABILITY_DAYS = 21;

const scheduler = fsrs();

export function applyReview(card: Card | undefined, correct: boolean, now: Date): Card {
  const rating = correct ? Rating.Good : Rating.Again;
  return scheduler.next(card ?? createEmptyCard(now), now, rating).card;
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** Introduces more new characters when recent answers are strong and fewer when they aren't. */
export function newItemLimit(recentAccuracy: number | undefined): number {
  if (recentAccuracy === undefined) return 5;
  if (recentAccuracy >= 0.9) return 10;
  if (recentAccuracy < 0.7) return 2;
  return 5;
}

function buildQuestion(item: KanaItem, isNew: boolean, random: () => number): KanaQuestion {
  // New characters are always shown first, since nobody can recall one they haven't met.
  const direction: Direction = isNew || random() < 0.5 ? "kana-to-romaji" : "romaji-to-kana";
  const display = (other: KanaItem) => (direction === "kana-to-romaji" ? other.romaji : other.kana);

  const lookalikes = new Set(lookalikesOf(item));
  // Some characters share a reading (じ and ぢ are both "ji"), so those can't be wrong answers.
  const pool = KANA[item.script].filter((other) => other.romaji !== item.romaji);
  const candidates = [
    ...shuffled(pool.filter((other) => lookalikes.has(other.kana)), random),
    ...shuffled(pool.filter((other) => !lookalikes.has(other.kana) && other.group === item.group), random),
    ...shuffled(pool.filter((other) => !lookalikes.has(other.kana) && other.group !== item.group), random),
  ];

  const answer = display(item);
  const wrong = [...new Set(candidates.map(display))].slice(0, OPTION_COUNT - 1);
  return {
    itemId: item.id,
    kana: item.kana,
    romaji: item.romaji,
    direction,
    isNew,
    options: shuffled([answer, ...wrong], random),
    answer,
  };
}

export function buildSession(options: {
  script: Script;
  cards: ReadonlyMap<string, Card>;
  recentAccuracy: number | undefined;
  now: Date;
  random?: () => number;
  size?: number;
}): KanaQuestion[] {
  const { script, cards, recentAccuracy, now, random = Math.random, size = SESSION_SIZE } = options;
  const items = KANA[script];
  const seen = items.filter((item) => cards.has(item.id));
  const dueTime = (item: KanaItem) => new Date(cards.get(item.id)!.due).getTime();

  const due = seen
    .filter((item) => dueTime(item) <= now.getTime())
    .sort((a, b) => dueTime(a) - dueTime(b))
    .slice(0, size);

  // Reviews come first, so a backlog pauses new characters rather than piling more on.
  const unseen = items.filter((item) => !cards.has(item.id));
  const fresh = unseen.slice(0, Math.min(newItemLimit(recentAccuracy), size - due.length));

  // Short sessions are topped up with the characters closest to being forgotten.
  const chosen = new Set([...due, ...fresh]);
  const extra = seen
    .filter((item) => !chosen.has(item))
    .sort((a, b) => cards.get(a.id)!.stability - cards.get(b.id)!.stability)
    .slice(0, size - chosen.size);

  const freshIds = new Set(fresh.map((item) => item.id));
  return shuffled([...due, ...fresh, ...extra], random).map((item) =>
    buildQuestion(item, freshIds.has(item.id), random),
  );
}

export function statusOf(card: Card | undefined, now: Date): KanaStatus {
  if (!card) return "new";
  if (new Date(card.due).getTime() <= now.getTime()) return "due";
  return card.stability >= STRONG_STABILITY_DAYS ? "strong" : "learning";
}

export function buildSummary(script: Script, cards: ReadonlyMap<string, Card>, now: Date) {
  const items = KANA[script].map((item) => ({
    kana: item.kana,
    romaji: item.romaji,
    group: item.group,
    status: statusOf(cards.get(item.id), now),
  }));
  const count = (status: KanaStatus) => items.filter((item) => item.status === status).length;
  return {
    script,
    total: items.length,
    seen: items.length - count("new"),
    due: count("due"),
    strong: count("strong"),
    items,
  };
}
