import { Rating, createEmptyCard, fsrs, type Card } from "ts-fsrs";

export type CardStatus = "new" | "learning" | "due" | "strong";

// A card this stable is remembered for about three weeks, so it counts as strong.
const STRONG_STABILITY_DAYS = 21;

const scheduler = fsrs();

export function applyReview(card: Card | undefined, correct: boolean, now: Date): Card {
  const rating = correct ? Rating.Good : Rating.Again;
  return scheduler.next(card ?? createEmptyCard(now), now, rating).card;
}

export function isDue(card: Card, now: Date): boolean {
  return new Date(card.due).getTime() <= now.getTime();
}

export function isStrong(card: Card | undefined): boolean {
  return card !== undefined && card.stability >= STRONG_STABILITY_DAYS;
}

export function statusOf(card: Card | undefined, now: Date): CardStatus {
  if (!card) return "new";
  if (isDue(card, now)) return "due";
  return isStrong(card) ? "strong" : "learning";
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
