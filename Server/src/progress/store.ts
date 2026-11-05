import { getDb } from "../db.js";
import type { DayActivity } from "./progress.js";

export interface ProgressStore {
  getActivity(): Promise<DayActivity[]>;
  getPeak(): Promise<number>;
  savePeak(peak: number, at: Date): Promise<void>;
}

interface PeakDoc {
  _id: "peak";
  ability: number;
  at: Date;
}

/** Combines graded answers with talk days, so a day of only talking still counts as practice. */
export function mergeActivity(
  graded: readonly DayActivity[],
  talk: readonly { date: string; spoken: number }[],
): DayActivity[] {
  const days = new Map(graded.map((day) => [day.date, { ...day }]));
  for (const { date, spoken } of talk) {
    const day = days.get(date);
    if (day) day.spoken = spoken;
    else days.set(date, { date, answers: 0, correct: 0, spoken });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const mongoProgressStore: ProgressStore = {
  async getActivity() {
    const db = await getDb();
    const days = await db
      .collection("reviews")
      .aggregate<{ _id: string; answers: number; correct: number }>([
        {
          $group: {
            _id: "$localDate",
            answers: { $sum: 1 },
            correct: { $sum: { $cond: ["$correct", 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    const talk = await db
      .collection("talkSessions")
      .aggregate<{ _id: string; spoken: number }>([{ $group: { _id: "$localDate", spoken: { $sum: "$learnerTurns" } } }])
      .toArray();
    return mergeActivity(
      days.map((day) => ({ date: day._id, answers: day.answers, correct: day.correct })),
      talk.map((day) => ({ date: day._id, spoken: day.spoken })),
    );
  },

  async getPeak() {
    const db = await getDb();
    const doc = await db.collection<PeakDoc>("progress").findOne({ _id: "peak" });
    return doc?.ability ?? 0;
  },

  async savePeak(peak, at) {
    const db = await getDb();
    await db.collection<PeakDoc>("progress").updateOne({ _id: "peak" }, { $set: { ability: peak, at } }, { upsert: true });
  },
};
