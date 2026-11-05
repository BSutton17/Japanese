import { beforeEach, describe, expect, it } from "vitest";
import type { Card } from "ts-fsrs";
import { SignJWT } from "jose";
import { createApp } from "./app.js";
import type { KanaReview, KanaStore } from "./kana/store.js";
import type { VocabReview, VocabStore } from "./vocab/store.js";
import { WORDS } from "./vocab/words.js";

const ALLOWED = "learner@example.com";
const SECRET = "test-secret-test-secret-test-secret-1234";

function fakeStore() {
  const cards = new Map<string, Card>();
  const reviews: KanaReview[] = [];
  const store: KanaStore = {
    getCards: async (script) =>
      new Map([...cards].filter(([id]) => id.startsWith(`${script}:`))),
    getCard: async (itemId) => cards.get(itemId),
    saveReview: async (review) => {
      cards.set(review.item.id, review.card);
      reviews.push(review);
    },
  };
  return { store, reviews, cards };
}

function fakeVocabStore() {
  const cards = new Map<string, Card>();
  const reviews: VocabReview[] = [];
  const store: VocabStore = {
    getCards: async () => new Map(cards),
    getCard: async (wordId) => cards.get(wordId),
    recentAccuracy: async () => undefined,
    saveReview: async (review) => {
      cards.set(review.word.id, review.card);
      reviews.push(review);
    },
  };
  return { store, reviews, cards };
}

function setup() {
  const fake = fakeStore();
  const vocab = fakeVocabStore();
  const app = createApp({
    kanaStore: fake.store,
    vocabStore: vocab.store,
    verifyGoogleToken: async (token) => {
      if (token === "bad") throw new Error("invalid signature");
      if (token === "unverified") return { email: ALLOWED, emailVerified: false };
      if (token === "stranger") return { email: "someone@example.com", emailVerified: true };
      return { email: "Learner@Example.com", emailVerified: true };
    },
  });
  const post = (path: string, body: unknown, cookie?: string) =>
    app.request(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
  const signIn = async () => {
    const response = await post("/auth/google", { credential: "good" });
    return response.headers.get("set-cookie")!.split(";")[0]!;
  };
  return { app, post, signIn, vocab, ...fake };
}

beforeEach(() => {
  process.env.ALLOWED_EMAIL = ALLOWED;
  process.env.SESSION_SECRET = SECRET;
});

describe("auth", () => {
  it("signs in the allowed account with a protected cookie", async () => {
    const { post } = setup();
    const response = await post("/auth/google", { credential: "good" });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it.each([
    ["bad", 401],
    ["stranger", 403],
    ["unverified", 403],
  ])("rejects the %s credential", async (credential, status) => {
    const { post } = setup();
    const response = await post("/auth/google", { credential });
    expect(response.status).toBe(status);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a missing credential", async () => {
    const { post } = setup();
    expect((await post("/auth/google", {})).status).toBe(400);
  });

  it("recognizes a signed-in session, and not a tampered or foreign one", async () => {
    const { app, signIn } = setup();
    const cookie = await signIn();
    const me = (headers?: Record<string, string>) => app.request("/api/auth/me", { headers });

    expect((await me({ Cookie: cookie })).status).toBe(200);
    expect((await me()).status).toBe(401);
    expect((await me({ Cookie: `${cookie}x` })).status).toBe(401);

    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(ALLOWED)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-completely-different-secret-value-000"));
    expect((await me({ Cookie: `session=${forged}` })).status).toBe(401);
  });

  it("drops a session once its email is no longer allowed", async () => {
    const { app, signIn } = setup();
    const cookie = await signIn();
    process.env.ALLOWED_EMAIL = "new-owner@example.com";
    expect((await app.request("/api/auth/me", { headers: { Cookie: cookie } })).status).toBe(401);
  });
});

describe("kana routes", () => {
  it("require a session", async () => {
    const { app, post } = setup();
    expect((await app.request("/api/kana/summary?script=hiragana")).status).toBe(401);
    expect((await app.request("/api/kana/session?script=hiragana&mode=all")).status).toBe(401);
    expect((await post("/kana/reviews", {})).status).toBe(401);
  });

  it("serve a session and record a review", async () => {
    const { app, post, signIn, reviews, cards } = setup();
    const Cookie = await signIn();

    const session = await app.request("/api/kana/session?script=katakana&mode=row&row=ka", { headers: { Cookie } });
    const { questions } = (await session.json()) as { questions: { itemId: string }[] };
    expect(questions.length).toBeGreaterThan(0);

    const itemId = questions[0]!.itemId;
    const saved = await post("/kana/reviews", { itemId, correct: true, localDate: "2026-11-04" }, Cookie);
    expect(saved.status).toBe(200);
    expect(reviews[0]).toMatchObject({ correct: true, localDate: "2026-11-04" });
    expect(cards.get(itemId)?.reps).toBe(1);

    const summary = await app.request("/api/kana/summary?script=katakana", { headers: { Cookie } });
    expect(await summary.json()).toMatchObject({ seen: 1, total: 104 });
  });

  it("reject bad input", async () => {
    const { app, post, signIn, reviews } = setup();
    const Cookie = await signIn();
    expect((await app.request("/api/kana/summary?script=klingon", { headers: { Cookie } })).status).toBe(400);
    for (const query of ["script=hiragana", "script=hiragana&mode=row", "script=hiragana&mode=row&row=zzz", "script=hiragana&mode=other"]) {
      expect((await app.request(`/api/kana/session?${query}`, { headers: { Cookie } })).status).toBe(400);
    }
    for (const body of [
      { itemId: "hiragana:nope", correct: true, localDate: "2026-11-04" },
      { itemId: "hiragana:あ", correct: "yes", localDate: "2026-11-04" },
      { itemId: "hiragana:あ", correct: true, localDate: "yesterday" },
    ]) {
      expect((await post("/kana/reviews", body, Cookie)).status).toBe(400);
    }
    expect(reviews).toHaveLength(0);
  });
});

describe("vocab routes", () => {
  it("require a session", async () => {
    const { app, post } = setup();
    expect((await app.request("/api/vocab/summary")).status).toBe(401);
    expect((await app.request("/api/vocab/session?type=new")).status).toBe(401);
    expect((await post("/vocab/reviews", {})).status).toBe(401);
  });

  it("serve new words and record a review", async () => {
    const { app, post, signIn, vocab } = setup();
    const Cookie = await signIn();

    const session = await app.request("/api/vocab/session?type=new", { headers: { Cookie } });
    const { questions } = (await session.json()) as { questions: { itemId: string; direction: string }[] };
    expect(questions.length).toBeGreaterThan(0);
    expect(new Set(questions.map((question) => question.direction))).toEqual(new Set(["ja-to-en", "en-to-ja"]));

    const wordId = questions[0]!.itemId;
    const saved = await post("/vocab/reviews", { wordId, correct: false, localDate: "2026-11-04" }, Cookie);
    expect(saved.status).toBe(200);
    expect(vocab.reviews[0]).toMatchObject({ correct: false, localDate: "2026-11-04" });
    expect(vocab.cards.has(wordId)).toBe(true);

    const summary = await app.request("/api/vocab/summary", { headers: { Cookie } });
    expect(await summary.json()).toMatchObject({ seen: 1, currentLevel: "N5" });
  });

  it("reject bad input", async () => {
    const { app, post, signIn, vocab } = setup();
    const Cookie = await signIn();
    for (const query of ["", "type=old"]) {
      expect((await app.request(`/api/vocab/session?${query}`, { headers: { Cookie } })).status).toBe(400);
    }
    const wordId = WORDS[0]!.id;
    for (const body of [
      { wordId: "nope", correct: true, localDate: "2026-11-04" },
      { wordId, correct: 1, localDate: "2026-11-04" },
      { wordId, correct: true, localDate: "soon" },
    ]) {
      expect((await post("/vocab/reviews", body, Cookie)).status).toBe(400);
    }
    expect(vocab.reviews).toHaveLength(0);
  });
});
