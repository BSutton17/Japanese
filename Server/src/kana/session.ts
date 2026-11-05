import type { Card } from "ts-fsrs";
import { isDue, shuffled, statusOf } from "../srs.js";
import { KANA, KANA_ROWS, lookalikesOf, type KanaItem, type KanaRow, type Script } from "./data.js";

export type Direction = "kana-to-romaji" | "romaji-to-kana";

export type KanaSelection = { mode: "row"; rowId: string } | { mode: "all" } | { mode: "review" };

export interface KanaQuestion {
  itemId: string;
  kana: string;
  romaji: string;
  direction: Direction;
  isNew: boolean;
  options: string[];
  answer: string;
}

const REVIEW_SESSION_SIZE = 20;
const OPTION_COUNT = 4;

function buildQuestion(
  item: KanaItem,
  direction: Direction,
  isNew: boolean,
  random: () => number,
  preferred: readonly KanaItem[] = [],
): KanaQuestion {
  const display = (other: KanaItem) => (direction === "kana-to-romaji" ? other.romaji : other.kana);

  const lookalikes = new Set(lookalikesOf(item));
  const preferredIds = new Set(preferred.map((other) => other.id));
  // Some characters share a reading (じ and ぢ are both "ji"), so those can't be wrong answers.
  const pool = KANA[item.script].filter((other) => other.romaji !== item.romaji);
  const rest = pool.filter((other) => !preferredIds.has(other.id) && !lookalikes.has(other.kana));
  const candidates = [
    ...shuffled(pool.filter((other) => preferredIds.has(other.id)), random),
    ...shuffled(pool.filter((other) => !preferredIds.has(other.id) && lookalikes.has(other.kana)), random),
    ...shuffled(rest.filter((other) => other.group === item.group), random),
    ...shuffled(rest.filter((other) => other.group !== item.group), random),
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

/** Only this row's characters: read each one, then pick each one out from its reading. */
function buildRowSession(row: KanaRow, cards: ReadonlyMap<string, Card>, random: () => number): KanaQuestion[] {
  const reading = row.items.map((item) =>
    buildQuestion(item, "kana-to-romaji", !cards.has(item.id), random, row.items),
  );
  const recognizing = shuffled(row.items, random).map((item) =>
    buildQuestion(item, "romaji-to-kana", false, random, row.items),
  );
  return [...reading, ...recognizing];
}

/** Every character in random order, as a straight test with no introductions. */
function buildAllSession(script: Script, cards: ReadonlyMap<string, Card>, random: () => number): KanaQuestion[] {
  return shuffled(KANA[script], random).map((item) => {
    // Nobody can pick out a character from its reading before they've seen it.
    const direction = !cards.has(item.id) || random() < 0.5 ? "kana-to-romaji" : "romaji-to-kana";
    return buildQuestion(item, direction, false, random);
  });
}

/** Only characters already studied that are due again, taking the most overdue first. */
function buildReviewSession(script: Script, cards: ReadonlyMap<string, Card>, now: Date, random: () => number): KanaQuestion[] {
  const dueTime = (item: KanaItem) => new Date(cards.get(item.id)!.due).getTime();
  const due = KANA[script]
    .filter((item) => {
      const card = cards.get(item.id);
      return card !== undefined && isDue(card, now);
    })
    .sort((a, b) => dueTime(a) - dueTime(b))
    .slice(0, REVIEW_SESSION_SIZE);
  return shuffled(due, random).map((item) =>
    buildQuestion(item, random() < 0.5 ? "kana-to-romaji" : "romaji-to-kana", false, random),
  );
}

export function findRow(script: Script, rowId: string): KanaRow | undefined {
  return KANA_ROWS[script].find((row) => row.id === rowId);
}

export function buildSession(options: {
  script: Script;
  selection: KanaSelection;
  cards: ReadonlyMap<string, Card>;
  now: Date;
  random?: () => number;
}): KanaQuestion[] {
  const { script, selection, cards, now, random = Math.random } = options;
  if (selection.mode === "all") return buildAllSession(script, cards, random);
  if (selection.mode === "review") return buildReviewSession(script, cards, now, random);
  const row = findRow(script, selection.rowId);
  return row ? buildRowSession(row, cards, random) : [];
}

export function buildSummary(script: Script, cards: ReadonlyMap<string, Card>, now: Date) {
  const rows = KANA_ROWS[script].map((row) => ({
    id: row.id,
    group: row.group,
    items: row.items.map((item) => ({
      kana: item.kana,
      romaji: item.romaji,
      status: statusOf(cards.get(item.id), now),
    })),
  }));
  const items = rows.flatMap((row) => row.items);
  const count = (status: string) => items.filter((item) => item.status === status).length;
  return {
    script,
    total: items.length,
    seen: items.length - count("new"),
    due: count("due"),
    strong: count("strong"),
    // The first row with a character not yet studied, offered as the next thing to learn.
    nextRowId: rows.find((row) => row.items.some((item) => item.status === "new"))?.id ?? null,
    rows,
  };
}
