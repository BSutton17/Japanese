import type { Card } from "ts-fsrs";
import { recallChance } from "../srs.js";
import type { JlptLevel } from "../vocab/types.js";
import { WORDS } from "../vocab/words.js";

export interface DayActivity {
  date: string;
  answers: number;
  correct: number;
}

const LEVELS: JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];
const DAY_MS = 24 * 60 * 60 * 1000;
const CALENDAR_DAYS = 28;

// Remembering this share of a level's words counts as reaching it. The rarest words in a level
// shouldn't have to be learned before it counts, since they come last by frequency.
const LEVEL_REACHED_SHARE = 0.7;

const FREEZE_EVERY_DAYS = 7;
const MAX_FREEZES = 2;

// Shorter breaks don't lower the level at all.
const MIN_DAYS_AWAY = 3;
// Each day away lowers the level by this share of the peak, up to the maximum.
const DROP_PER_DAY = 0.015;
const MAX_DROP = 0.3;
// This many more right answers than wrong ones after a break earns the whole drop back.
// A strong return gets there within a session or two, while a shaky one takes much longer.
const RECOVERY_ANSWERS = 40;

function dayNumber(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function computeStreak(activity: readonly DayActivity[], today: string) {
  const practiced = activity.map((day) => dayNumber(day.date)).sort((a, b) => a - b);
  const todayNumber = dayNumber(today);
  const frozenDays: string[] = [];

  let current = 0;
  let longest = 0;
  let freezes = 0;
  let previous: number | undefined;

  const coverMissedDays = (from: number, to: number): boolean => {
    const missed = to - from - 1;
    if (missed <= 0) return true;
    if (missed > freezes) return false;
    freezes -= missed;
    for (let day = from + 1; day < to; day++) frozenDays.push(dateOfDay(day));
    return true;
  };

  for (const day of practiced) {
    if (previous !== undefined && !coverMissedDays(previous, day)) {
      current = 0;
      freezes = 0;
    }
    current++;
    longest = Math.max(longest, current);
    if (current % FREEZE_EVERY_DAYS === 0 && freezes < MAX_FREEZES) freezes++;
    previous = day;
  }

  // Today isn't missed until it's over, so only the days before it can break the streak.
  if (previous !== undefined && !coverMissedDays(previous, todayNumber)) {
    current = 0;
    freezes = 0;
  }

  return {
    current,
    longest,
    freezes,
    frozenDays,
    practicedToday: previous === todayNumber,
  };
}

/** How far below the peak a break puts the learner right now, after any recovery. */
export function computeComeback(activity: readonly DayActivity[], peak: number, today: string) {
  const none = { active: false, daysAway: 0, remainingDrop: 0 };
  if (peak <= 0) return none;

  const days = [...new Set([...activity.map((day) => dayNumber(day.date)), dayNumber(today)])].sort((a, b) => a - b);
  for (let index = days.length - 1; index > 0; index--) {
    const daysAway = days[index]! - days[index - 1]!;
    if (daysAway < MIN_DAYS_AWAY) continue;

    const returned = days[index]!;
    const net = activity
      .filter((day) => dayNumber(day.date) >= returned)
      .reduce((sum, day) => sum + day.correct - (day.answers - day.correct), 0);
    const earnedBack = Math.min(Math.max(net, 0) / RECOVERY_ANSWERS, 1);
    const remainingDrop = peak * Math.min(daysAway * DROP_PER_DAY, MAX_DROP) * (1 - earnedBack);
    return { active: remainingDrop > 0, daysAway, remainingDrop };
  }
  return none;
}

/** Per-level vocabulary remembered right now, which falls on its own as memories fade. */
export function computeLevels(cards: ReadonlyMap<string, Card>, now: Date) {
  return LEVELS.map((level) => {
    const words = WORDS.filter((word) => word.level === level);
    const remembered = words.reduce((sum, word) => {
      const card = cards.get(word.id);
      return card ? sum + recallChance(card, now) : sum;
    }, 0);
    return {
      level,
      total: words.length,
      remembered: Math.round(remembered),
      progress: Math.min(remembered / (words.length * LEVEL_REACHED_SHARE), 1),
    };
  });
}

/**
 * The whole scale as one number: 0 is below N5, 1 is N5 reached, and 5 is N1 reached.
 * A level only counts once every level before it is reached.
 */
export function abilityFrom(levels: readonly { progress: number }[]): number {
  let ability = 0;
  for (const { progress } of levels) {
    ability += progress;
    if (progress < 1) break;
  }
  return ability;
}

export function describeAbility(ability: number) {
  const reachedCount = Math.min(Math.floor(ability), LEVELS.length);
  return {
    ability,
    reached: reachedCount > 0 ? LEVELS[reachedCount - 1]! : null,
    next: LEVELS[reachedCount] ?? null,
    percentToNext: reachedCount === LEVELS.length ? 100 : Math.floor((ability - reachedCount) * 100),
  };
}

export function buildProgress(options: {
  cards: ReadonlyMap<string, Card>;
  activity: readonly DayActivity[];
  storedPeak: number;
  today: string;
  now: Date;
}) {
  const { cards, activity, storedPeak, today, now } = options;
  const levels = computeLevels(cards, now);
  const remembered = abilityFrom(levels);
  const peak = Math.max(storedPeak, remembered);
  const comeback = computeComeback(activity, peak, today);
  const ability = Math.max(Math.min(remembered, peak - comeback.remainingDrop), 0);
  return { levels, ability, peak, comeback };
}

export function buildCalendar(activity: readonly DayActivity[], frozenDays: readonly string[], today: string) {
  const answersByDate = new Map(activity.map((day) => [day.date, day.answers]));
  const frozen = new Set(frozenDays);
  const todayNumber = dayNumber(today);
  return Array.from({ length: CALENDAR_DAYS }, (_, index) => {
    const date = dateOfDay(todayNumber - CALENDAR_DAYS + 1 + index);
    return { date, answers: answersByDate.get(date) ?? 0, frozen: frozen.has(date) };
  });
}
