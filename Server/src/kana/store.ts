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
