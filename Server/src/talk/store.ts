import { getDb } from "../db.js";

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
}

export interface TalkStore {
  saveSession(session: TalkSession): Promise<void>;
}

interface TalkDoc extends Omit<TalkSession, "id"> {
  _id: string;
  learnerTurns: number;
}

export const mongoTalkStore: TalkStore = {
  async saveSession({ id, ...session }) {
    const db = await getDb();
    const learnerTurns = session.turns.filter((turn) => turn.role === "learner").length;
    // Saved repeatedly during a conversation, so a crash loses very little.
    await db
      .collection<TalkDoc>("talkSessions")
      .replaceOne({ _id: id }, { ...session, learnerTurns }, { upsert: true });
  },
};
