import type { Card } from "ts-fsrs";
import { getDb } from "../db.js";
import type { KanaItem, Script } from "./data.js";

export interface KanaReview {
  item: KanaItem;
  card: Card;
  correct: boolean;
  at: Date;
  localDate: string;
}

export interface KanaStore {
  getCards(script: Script): Promise<Map<string, Card>>;
  getCard(itemId: string): Promise<Card | undefined>;
  recentAccuracy(script: Script): Promise<number | undefined>;
  saveReview(review: KanaReview): Promise<void>;
}

interface CardDoc {
  _id: string;
  script: Script;
  card: Card;
}

interface ReviewDoc {
  kind: "kana";
  itemId: string;
  script: Script;
  correct: boolean;
  at: Date;
  localDate: string;
}

const RECENT_REVIEW_COUNT = 30;
// Too few answers say little about how a session should be paced.
const MIN_REVIEWS_FOR_ACCURACY = 10;

export const mongoKanaStore: KanaStore = {
  async getCards(script) {
    const db = await getDb();
    const docs = await db.collection<CardDoc>("kanaCards").find({ script }).toArray();
    return new Map(docs.map((doc) => [doc._id, doc.card]));
  },

  async getCard(itemId) {
    const db = await getDb();
    const doc = await db.collection<CardDoc>("kanaCards").findOne({ _id: itemId });
    return doc?.card;
  },

  async recentAccuracy(script) {
    const db = await getDb();
    const recent = await db
      .collection<ReviewDoc>("reviews")
      .find({ kind: "kana", script })
      .sort({ at: -1 })
      .limit(RECENT_REVIEW_COUNT)
      .toArray();
    if (recent.length < MIN_REVIEWS_FOR_ACCURACY) return undefined;
    return recent.filter((review) => review.correct).length / recent.length;
  },

  async saveReview({ item, card, correct, at, localDate }) {
    const db = await getDb();
    await db
      .collection<CardDoc>("kanaCards")
      .updateOne({ _id: item.id }, { $set: { script: item.script, card } }, { upsert: true });
    // The review log also feeds daily streaks, so it keeps the learner's local date.
    await db.collection<ReviewDoc>("reviews").insertOne({
      kind: "kana",
      itemId: item.id,
      script: item.script,
      correct,
      at,
      localDate,
    });
  },
};
