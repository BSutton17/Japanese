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
    return days.map((day) => ({ date: day._id, answers: day.answers, correct: day.correct }));
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
