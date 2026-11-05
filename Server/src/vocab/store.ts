import type { Card } from "ts-fsrs";
import { getDb } from "../db.js";
import type { JlptLevel, Word } from "./types.js";

export interface VocabReview {
  word: Word;
  card: Card;
  correct: boolean;
  at: Date;
  localDate: string;
}

export interface VocabStore {
  getCards(): Promise<Map<string, Card>>;
  getCard(wordId: string): Promise<Card | undefined>;
  recentAccuracy(): Promise<number | undefined>;
  saveReview(review: VocabReview): Promise<void>;
}

interface CardDoc {
  _id: string;
  level: JlptLevel;
  card: Card;
}

interface ReviewDoc {
  kind: "vocab";
  itemId: string;
  level: JlptLevel;
  correct: boolean;
  at: Date;
  localDate: string;
}

const RECENT_REVIEW_COUNT = 40;
// Too few answers say little about how much to take on next.
const MIN_REVIEWS_FOR_ACCURACY = 10;

export const mongoVocabStore: VocabStore = {
  async getCards() {
    const db = await getDb();
    const docs = await db.collection<CardDoc>("vocabCards").find().toArray();
    return new Map(docs.map((doc) => [doc._id, doc.card]));
  },

  async getCard(wordId) {
    const db = await getDb();
    const doc = await db.collection<CardDoc>("vocabCards").findOne({ _id: wordId });
    return doc?.card;
  },

  async recentAccuracy() {
    const db = await getDb();
    const recent = await db
      .collection<ReviewDoc>("reviews")
      .find({ kind: "vocab" })
      .sort({ at: -1 })
      .limit(RECENT_REVIEW_COUNT)
      .toArray();
    if (recent.length < MIN_REVIEWS_FOR_ACCURACY) return undefined;
    return recent.filter((review) => review.correct).length / recent.length;
  },

  async saveReview({ word, card, correct, at, localDate }) {
    const db = await getDb();
    await db
      .collection<CardDoc>("vocabCards")
      .updateOne({ _id: word.id }, { $set: { level: word.level, card } }, { upsert: true });
    await db.collection<ReviewDoc>("reviews").insertOne({
      kind: "vocab",
      itemId: word.id,
      level: word.level,
      correct,
      at,
      localDate,
    });
  },
};
