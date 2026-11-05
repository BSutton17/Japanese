import { getDb } from "../db.js";
import { EMPTY_MEMORY, type TutorMemory } from "./memory.js";
import { NO_USAGE, type AiPlan, type TalkUsage } from "./plan.js";
import type { DailyTopic } from "./topics.js";

export interface TalkTurn {
  role: "learner" | "tutor";
  text: string;
}

export interface TalkSession {
  id: string;
  localDate: string;
  startedAt: Date;
  updatedAt: Date;
  seconds: number;
  tokens: number;
  turns: TalkTurn[];
  /** Conversations from before the plan switch don't have these. */
  plan?: AiPlan;
  usage?: TalkUsage;
}

export interface TalkStore {
  saveSession(session: TalkSession): Promise<void>;
  /** Conversations not yet learned from. Anything still being saved is left alone, unless it just finished. */
  pendingSessions(finishedId: string | undefined, now: Date): Promise<TalkSession[]>;
  markLearned(ids: readonly string[]): Promise<void>;
  markAllLearned(): Promise<void>;
  monthUsage(month: string): Promise<{ usage: TalkUsage; seconds: number }>;
  getPlan(): Promise<AiPlan | null>;
  savePlan(plan: AiPlan): Promise<void>;
  getMemory(): Promise<TutorMemory>;
  saveMemory(memory: TutorMemory): Promise<void>;
  clearMemory(): Promise<void>;
  getTopics(date: string): Promise<DailyTopic[] | null>;
  saveTopics(date: string, topics: readonly DailyTopic[]): Promise<void>;
}

interface TalkDoc extends Omit<TalkSession, "id"> {
  _id: string;
  learnerTurns: number;
  learnedAt?: Date;
}

interface SettingsDoc {
  _id: "plan";
  plan: AiPlan;
}

interface MemoryDoc extends TutorMemory {
  _id: "main";
}

interface TopicsDoc {
  _id: string;
  topics: DailyTopic[];
}

const STILL_RUNNING_MS = 2 * 60 * 1000;
// A few per request keeps any one request quick. The rest are picked up next time.
const MAX_PENDING = 3;

export const mongoTalkStore: TalkStore = {
  async saveSession({ id, ...session }) {
    const db = await getDb();
    const learnerTurns = session.turns.filter((turn) => turn.role === "learner").length;
    // Saved repeatedly during a conversation, so a crash loses very little.
    await db
      .collection<TalkDoc>("talkSessions")
      .replaceOne({ _id: id }, { ...session, learnerTurns }, { upsert: true });
  },

  async pendingSessions(finishedId, now) {
    const db = await getDb();
    const docs = await db
      .collection<TalkDoc>("talkSessions")
      .find({
        learnedAt: { $exists: false },
        $or: [{ updatedAt: { $lt: new Date(now.getTime() - STILL_RUNNING_MS) } }, ...(finishedId ? [{ _id: finishedId }] : [])],
      })
      .sort({ startedAt: 1 })
      .limit(MAX_PENDING)
      .toArray();
    return docs.map(({ _id, learnerTurns: _turns, learnedAt: _learned, ...session }) => ({ id: _id, ...session }));
  },

  async markLearned(ids) {
    const db = await getDb();
    await db.collection<TalkDoc>("talkSessions").updateMany({ _id: { $in: [...ids] } }, { $set: { learnedAt: new Date() } });
  },

  async markAllLearned() {
    const db = await getDb();
    await db.collection<TalkDoc>("talkSessions").updateMany({ learnedAt: { $exists: false } }, { $set: { learnedAt: new Date() } });
  },

  async monthUsage(month) {
    const db = await getDb();
    const docs = await db
      .collection<TalkDoc>("talkSessions")
      .find({ plan: "paid", localDate: { $regex: `^${month}-` } }, { projection: { usage: 1, seconds: 1 } })
      .toArray();
    const usage = { ...NO_USAGE };
    let seconds = 0;
    for (const doc of docs) {
      seconds += doc.seconds ?? 0;
      usage.textIn += doc.usage?.textIn ?? 0;
      usage.audioIn += doc.usage?.audioIn ?? 0;
      usage.textOut += doc.usage?.textOut ?? 0;
      usage.audioOut += doc.usage?.audioOut ?? 0;
    }
    return { usage, seconds };
  },

  async getPlan() {
    const db = await getDb();
    return (await db.collection<SettingsDoc>("tutorSettings").findOne({ _id: "plan" }))?.plan ?? null;
  },

  async savePlan(plan) {
    const db = await getDb();
    await db.collection<SettingsDoc>("tutorSettings").updateOne({ _id: "plan" }, { $set: { plan } }, { upsert: true });
  },

  async getMemory() {
    const db = await getDb();
    const doc = await db.collection<MemoryDoc>("tutorMemory").findOne({ _id: "main" });
    if (!doc) return EMPTY_MEMORY;
    const { _id, ...memory } = doc;
    return memory;
  },

  async saveMemory(memory) {
    const db = await getDb();
    await db.collection<MemoryDoc>("tutorMemory").replaceOne({ _id: "main" }, memory, { upsert: true });
  },

  async clearMemory() {
    const db = await getDb();
    await db.collection<MemoryDoc>("tutorMemory").deleteOne({ _id: "main" });
  },

  async getTopics(date) {
    const db = await getDb();
    return (await db.collection<TopicsDoc>("dailyTopics").findOne({ _id: date }))?.topics ?? null;
  },

  async saveTopics(date, topics) {
    const db = await getDb();
    await db.collection<TopicsDoc>("dailyTopics").replaceOne({ _id: date }, { topics: [...topics] }, { upsert: true });
  },
};
