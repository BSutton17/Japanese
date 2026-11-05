import { describe, expect, it } from "vitest";
import { createEmptyCard, type Card } from "ts-fsrs";
import { applyReview } from "../srs.js";
import { WORDS } from "../vocab/words.js";
import {
  abilityFrom,
  buildCalendar,
  buildProgress,
  computeComeback,
  computeLevels,
  computeStreak,
  describeAbility,
  type DayActivity,
} from "./progress.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const day = (date: string, answers = 20, correct = answers): DayActivity => ({ date, answers, correct });
const run = (start: string, count: number) =>
  Array.from({ length: count }, (_, index) => day(new Date(Date.parse(start) + index * DAY).toISOString().slice(0, 10)));

function knownCard(stability: number, lastReviewDaysAgo = 0): Card {
  const lastReview = new Date(NOW.getTime() - lastReviewDaysAgo * DAY);
  return {
    ...createEmptyCard(lastReview),
    state: 2,
    reps: 5,
    stability,
    last_review: lastReview,
    due: new Date(lastReview.getTime() + stability * DAY),
  };
}

const wordsAt = (level: string) => WORDS.filter((word) => word.level === level);

describe("streak", () => {
  it("is zero with no practice", () => {
    expect(computeStreak([], "2026-11-04")).toMatchObject({ current: 0, longest: 0, practicedToday: false });
  });

  it("counts consecutive days ending today", () => {
    expect(computeStreak(run("2026-11-02", 3), "2026-11-04")).toMatchObject({ current: 3, practicedToday: true });
  });

  it("stays alive when today hasn't been practiced yet", () => {
    expect(computeStreak(run("2026-11-01", 3), "2026-11-04")).toMatchObject({ current: 3, practicedToday: false });
  });

  it("breaks after a full missed day", () => {
    expect(computeStreak(run("2026-11-01", 2), "2026-11-04")).toMatchObject({ current: 0, longest: 2 });
  });

  it("restarts after a break and remembers the longest", () => {
    const activity = [...run("2026-10-01", 5), ...run("2026-11-03", 2)];
    expect(computeStreak(activity, "2026-11-04")).toMatchObject({ current: 2, longest: 5 });
  });

  it("earns a freeze every 7 days, up to 2", () => {
    expect(computeStreak(run("2026-10-29", 7), "2026-11-04").freezes).toBe(1);
    expect(computeStreak(run("2026-10-22", 14), "2026-11-04").freezes).toBe(2);
    expect(computeStreak(run("2026-10-08", 28), "2026-11-04").freezes).toBe(2);
  });

  it("spends a freeze to cover a missed day", () => {
    const activity = [...run("2026-10-20", 7), ...run("2026-10-28", 8)];
    const streak = computeStreak(activity, "2026-11-04");
    expect(streak.current).toBe(15);
    expect(streak.frozenDays).toEqual(["2026-10-27"]);
  });

  it("covers missed days before today with a freeze", () => {
    const streak = computeStreak(run("2026-10-26", 8), "2026-11-04");
    expect(streak.current).toBe(8);
    expect(streak.frozenDays).toEqual(["2026-11-03"]);
    expect(streak.freezes).toBe(0);
  });

  it("breaks when a gap is longer than the freezes available", () => {
    const streak = computeStreak(run("2026-10-20", 7), "2026-11-04");
    expect(streak.current).toBe(0);
    expect(streak.frozenDays).toEqual([]);
  });

  it("handles month and year boundaries", () => {
    expect(computeStreak(run("2026-12-30", 4), "2027-01-02").current).toBe(4);
  });
});

describe("comeback", () => {
  const PEAK = 4; // N2

  it("doesn't apply without a break", () => {
    expect(computeComeback(run("2026-11-01", 4), PEAK, "2026-11-04").active).toBe(false);
    expect(computeComeback(run("2026-11-01", 2), PEAK, "2026-11-04").active).toBe(false);
  });

  it("doesn't apply to someone with no peak", () => {
    expect(computeComeback(run("2026-10-01", 2), 0, "2026-11-04").active).toBe(false);
  });

  it("drops an N2 learner into N3 after two weeks away", () => {
    const comeback = computeComeback(run("2026-10-16", 6), PEAK, "2026-11-04");
    expect(comeback.daysAway).toBe(14);
    expect(comeback.active).toBe(true);
    expect(PEAK - comeback.remainingDrop).toBeGreaterThanOrEqual(3);
    expect(PEAK - comeback.remainingDrop).toBeLessThan(4);
  });

  it("drops further for longer breaks, up to a limit", () => {
    const twoWeeks = computeComeback([day("2026-10-21")], PEAK, "2026-11-04").remainingDrop;
    const twoMonths = computeComeback([day("2026-09-05")], PEAK, "2026-11-04").remainingDrop;
    const oneYear = computeComeback([day("2025-11-04")], PEAK, "2026-11-04").remainingDrop;
    expect(twoMonths).toBeGreaterThan(twoWeeks);
    expect(oneYear).toBeCloseTo(PEAK * 0.3);
  });

  it("scales with the peak, so a beginner doesn't fall to nothing", () => {
    const comeback = computeComeback([day("2026-10-21")], 0.2, "2026-11-04");
    expect(0.2 - comeback.remainingDrop).toBeGreaterThan(0.1);
  });

  const returning = (answers: number, correct: number) => [day("2026-10-21"), day("2026-11-04", answers, correct)];

  it("climbs back fast when answers show the level is still there", () => {
    const afterOneStrongSession = computeComeback(returning(40, 40), PEAK, "2026-11-04");
    expect(afterOneStrongSession.active).toBe(false);
  });

  it("climbs back slowly when answers are shaky", () => {
    const start = computeComeback([day("2026-10-21")], PEAK, "2026-11-04").remainingDrop;
    const shaky = computeComeback(returning(40, 24), PEAK, "2026-11-04");
    expect(shaky.active).toBe(true);
    expect(shaky.remainingDrop).toBeGreaterThan(start * 0.7);
  });

  it("doesn't drop further when answers are mostly wrong", () => {
    const start = computeComeback([day("2026-10-21")], PEAK, "2026-11-04").remainingDrop;
    expect(computeComeback(returning(40, 5), PEAK, "2026-11-04").remainingDrop).toBeCloseTo(start);
  });

  it("counts recovery across days after returning", () => {
    const activity = [day("2026-10-01"), day("2026-11-01", 20, 20), day("2026-11-02", 20, 20)];
    expect(computeComeback(activity, PEAK, "2026-11-02").active).toBe(false);
  });

  it("ignores answers from before the break", () => {
    const activity = [day("2026-10-10", 500, 500), day("2026-10-21", 500, 500)];
    expect(computeComeback(activity, PEAK, "2026-11-04").active).toBe(true);
  });
});

describe("level", () => {
  it("starts below N5", () => {
    const levels = computeLevels(new Map(), NOW);
    expect(abilityFrom(levels)).toBe(0);
    expect(describeAbility(0)).toMatchObject({ reached: null, next: "N5", percentToNext: 0 });
  });

  it("describes progress between levels", () => {
    expect(describeAbility(0.5)).toMatchObject({ reached: null, next: "N5", percentToNext: 50 });
    expect(describeAbility(2.25)).toMatchObject({ reached: "N4", next: "N3", percentToNext: 25 });
    expect(describeAbility(5)).toMatchObject({ reached: "N1", next: null, percentToNext: 100 });
  });

  it("reaches a level before all of its rarest words are learned", () => {
    const n5 = wordsAt("N5");
    const cards = new Map(n5.slice(0, Math.ceil(n5.length * 0.75)).map((word) => [word.id, knownCard(30)]));
    expect(abilityFrom(computeLevels(cards, NOW))).toBeGreaterThanOrEqual(1);
  });

  it("doesn't count a level until the ones before it are reached", () => {
    const cards = new Map(wordsAt("N4").map((word) => [word.id, knownCard(30)]));
    const levels = computeLevels(cards, NOW);
    expect(levels[1]!.progress).toBe(1);
    expect(abilityFrom(levels)).toBe(0);
  });

  it("falls as memories fade", () => {
    const fresh = new Map(wordsAt("N5").map((word) => [word.id, knownCard(5, 0)]));
    const faded = new Map(wordsAt("N5").map((word) => [word.id, knownCard(5, 60)]));
    expect(abilityFrom(computeLevels(faded, NOW))).toBeLessThan(abilityFrom(computeLevels(fresh, NOW)));
  });

  it("reads cards whose dates came back as strings", () => {
    const review = applyReview(undefined, true, NOW);
    const stored = JSON.parse(JSON.stringify(review)) as Card;
    const levels = computeLevels(new Map([[wordsAt("N5")[0]!.id, stored]]), NOW);
    expect(levels[0]!.remembered).toBe(1);
  });
});

describe("overall progress", () => {
  const today = "2026-11-04";
  const allThrough = (levels: string[], stability: number, daysAgo = 0) =>
    new Map(WORDS.filter((word) => levels.includes(word.level)).map((word) => [word.id, knownCard(stability, daysAgo)]));

  it("raises the peak as ability grows", () => {
    const progress = buildProgress({ cards: allThrough(["N5"], 30), activity: [day(today)], storedPeak: 0, today, now: NOW });
    expect(progress.peak).toBeGreaterThanOrEqual(1);
    expect(progress.ability).toBe(progress.peak);
  });

  it("never lowers the peak", () => {
    const progress = buildProgress({ cards: new Map(), activity: [], storedPeak: 3.5, today, now: NOW });
    expect(progress.peak).toBe(3.5);
  });

  it("assumes a lower level after a break, even when memories look strong", () => {
    const cards = allThrough(["N5", "N4", "N3", "N2"], 3650, 14);
    const progress = buildProgress({ cards, activity: [day("2026-10-21")], storedPeak: 4, today, now: NOW });
    expect(progress.peak).toBe(4);
    expect(progress.ability).toBeGreaterThanOrEqual(3);
    expect(progress.ability).toBeLessThan(4);
    expect(progress.comeback.active).toBe(true);
  });

  it("returns to the peak after strong answers", () => {
    const cards = allThrough(["N5", "N4", "N3", "N2"], 3650, 14);
    const activity = [day("2026-10-21"), day(today, 45, 45)];
    const progress = buildProgress({ cards, activity, storedPeak: 4, today, now: NOW });
    expect(progress.comeback.active).toBe(false);
    expect(progress.ability).toBe(4);
  });

  it("uses the lower of faded memory and the comeback drop", () => {
    const cards = allThrough(["N5"], 1, 200);
    const progress = buildProgress({ cards, activity: [day("2026-10-21")], storedPeak: 4, today, now: NOW });
    expect(progress.ability).toBeLessThan(1);
  });
});

describe("calendar", () => {
  it("covers the last 28 days ending today", () => {
    const calendar = buildCalendar([day("2026-11-03", 12)], ["2026-11-01"], "2026-11-04");
    expect(calendar).toHaveLength(28);
    expect(calendar.at(-1)).toMatchObject({ date: "2026-11-04", answers: 0 });
    expect(calendar.at(-2)).toMatchObject({ date: "2026-11-03", answers: 12 });
    expect(calendar.find((entry) => entry.date === "2026-11-01")?.frozen).toBe(true);
    expect(calendar[0]?.date).toBe("2026-10-08");
  });
});
