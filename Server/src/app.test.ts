import { beforeEach, describe, expect, it } from "vitest";
import type { Card } from "ts-fsrs";
import { SignJWT } from "jose";
import { createApp } from "./app.js";
import type { KanaReview, KanaStore } from "./kana/store.js";
import type { DayActivity } from "./progress/progress.js";
import { mergeActivity, type ProgressStore } from "./progress/store.js";
import type { LiveTokenRequest } from "./talk/live.js";
import { EMPTY_MEMORY, type ConversationAnalysis, type TutorMemory } from "./talk/memory.js";
import type { AiPlan } from "./talk/plan.js";
import type { TalkSession, TalkStore } from "./talk/store.js";
import type { DailyTopic } from "./talk/topics.js";
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

function fakeProgressStore() {
  const state = { peak: 0, activity: [] as DayActivity[] };
  const store: ProgressStore = {
    getActivity: async () => state.activity,
    getPeak: async () => state.peak,
    savePeak: async (peak) => {
      state.peak = peak;
    },
  };
  return { store, state };
}

function setup() {
  const fake = fakeStore();
  const vocab = fakeVocabStore();
  const progress = fakeProgressStore();
  const talk = {
    saved: [] as TalkSession[],
    tokenRequests: [] as LiveTokenRequest[],
    failToken: false,
    plan: null as AiPlan | null,
    available: { free: true, paid: true } as Record<AiPlan, boolean>,
    memory: EMPTY_MEMORY as TutorMemory,
    pending: [] as TalkSession[],
    learned: [] as string[],
    allLearned: false,
    analysisPlans: [] as AiPlan[],
    analysis: { speakingLevel: 2, summary: "Talked about movies.", facts: ["Likes movies"], struggles: [], topics: ["movies"], followUps: [] } as ConversationAnalysis,
    failAnalysis: false,
    topics: new Map<string, DailyTopic[]>(),
    topicRequests: 0,
    failTopics: false,
    spentUsage: { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 },
  };
  const talkStore: TalkStore = {
    saveSession: async (session) => void talk.saved.push(session),
    pendingSessions: async () => talk.pending.filter((session) => !talk.learned.includes(session.id)),
    markLearned: async (ids) => void talk.learned.push(...ids),
    markAllLearned: async () => {
      talk.allLearned = true;
    },
    monthUsage: async () => ({ usage: talk.spentUsage, seconds: 600 }),
    getPlan: async () => talk.plan,
    savePlan: async (plan) => {
      talk.plan = plan;
    },
    getMemory: async () => talk.memory,
    saveMemory: async (memory) => {
      talk.memory = memory;
    },
    clearMemory: async () => {
      talk.memory = EMPTY_MEMORY;
    },
    getTopics: async (date) => talk.topics.get(date) ?? null,
    saveTopics: async (date, topics) => void talk.topics.set(date, [...topics]),
  };
  const app = createApp({
    kanaStore: fake.store,
    vocabStore: vocab.store,
    progressStore: progress.store,
    talkStore,
    availablePlans: () => talk.available,
    analyzeConversation: async ({ plan }) => {
      talk.analysisPlans.push(plan);
      if (talk.failAnalysis) throw new Error("analysis failed");
      return talk.analysis;
    },
    chooseDailyTopics: async () => {
      talk.topicRequests += 1;
      if (talk.failTopics) throw new Error("feeds down");
      return [{ title: "Happy otters", summary: "Otters held hands.", source: "BBC", url: "https://example.com/otters" }];
    },
    createLiveToken: async (request) => {
      talk.tokenRequests.push(request);
      if (talk.failToken) throw new Error("no key");
      return { token: "auth_tokens/test", model: "gemini-3.8-live", apiVersion: "v1alpha", config: { responseModalities: ["AUDIO"] } };
    },
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
  return { app, post, signIn, vocab, progress, talk, ...fake };
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

  it("renews a long-lasting session each time the app opens", async () => {
    const { app, signIn } = setup();
    const cookie = await signIn();
    const response = await app.request("/api/auth/me", { headers: { Cookie: cookie } });
    const renewed = response.headers.get("set-cookie") ?? "";
    expect(renewed).toMatch(/^session=/);
    expect(renewed).toMatch(/Max-Age=2592000/);
    expect(renewed).toMatch(/HttpOnly/i);
  });

  it("doesn't renew an invalid session", async () => {
    const { app } = setup();
    const response = await app.request("/api/auth/me", { headers: { Cookie: "session=nonsense" } });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
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

describe("progress route", () => {
  it("requires a session", async () => {
    const { app } = setup();
    expect((await app.request("/api/progress")).status).toBe(401);
  });

  it("starts empty and below N5", async () => {
    const { app, signIn } = setup();
    const Cookie = await signIn();
    const response = await app.request("/api/progress?today=2026-11-04", { headers: { Cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      level: { reached: null, next: "N5" },
      comeback: { active: false },
      streak: { current: 0, practicedToday: false },
      totalAnswers: 0,
    });
  });

  it("reports streak, today, kana, and the calendar from saved activity", async () => {
    const { app, signIn, progress } = setup();
    const Cookie = await signIn();
    progress.state.activity = [
      { date: "2026-11-03", answers: 10, correct: 8 },
      { date: "2026-11-04", answers: 20, correct: 15 },
    ];
    const response = await app.request("/api/progress?today=2026-11-04", { headers: { Cookie } });
    const body = (await response.json()) as {
      calendar: { date: string; answers: number }[];
      kana: { script: string; total: number }[];
    };
    expect(body).toMatchObject({
      streak: { current: 2, practicedToday: true },
      today: { answers: 20, correct: 15 },
      totalAnswers: 30,
    });
    expect(body.calendar.at(-1)).toMatchObject({ date: "2026-11-04", answers: 20 });
    expect(body.kana[0]).toMatchObject({ script: "Hiragana", total: 104 });
  });

  it("follows the learner's date, not the server's", async () => {
    const { app, signIn, progress } = setup();
    const Cookie = await signIn();
    progress.state.activity = [{ date: "2030-01-01", answers: 5, correct: 5 }];
    const response = await app.request("/api/progress?today=2030-01-01", { headers: { Cookie } });
    expect(await response.json()).toMatchObject({ streak: { current: 1, practicedToday: true } });
  });

  it("eases vocab back after a break, and keeps the peak", async () => {
    const { app, signIn, progress } = setup();
    const Cookie = await signIn();
    progress.state.peak = 2.5;
    progress.state.activity = [{ date: "2026-10-21", answers: 20, correct: 20 }];

    const summary = await app.request("/api/vocab/summary?today=2026-11-04", { headers: { Cookie } });
    expect(await summary.json()).toMatchObject({ easingBack: true, nextBatch: 5 });

    const report = await app.request("/api/progress?today=2026-11-04", { headers: { Cookie } });
    expect(await report.json()).toMatchObject({
      comeback: { active: true, daysAway: 14 },
      peak: { reached: "N4", next: "N3" },
    });
    expect(progress.state.peak).toBe(2.5);
  });
});

describe("talk routes", () => {
  const session = {
    localDate: "2026-11-04",
    startedAt: "2026-11-04T12:00:00.000Z",
    seconds: 95,
    tokens: 1200,
    turns: [
      { role: "tutor", text: "こんにちは！" },
      { role: "learner", text: "こんにちは" },
    ],
  };

  it("require a session", async () => {
    const { app, post } = setup();
    expect((await post("/talk/token", {})).status).toBe(401);
    expect((await app.request("/api/talk/sessions/abcdefgh", { method: "PUT", body: "{}" })).status).toBe(401);
  });

  it("create a token with instructions built from the learner's level", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    const response = await post("/talk/token", { today: "2026-11-04" }, Cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: "auth_tokens/test", model: "gemini-3.8-live" });
    expect(talk.tokenRequests[0]?.instructions).toMatch(/below N5/);
    expect(talk.tokenRequests[0]?.handle).toBeUndefined();
  });

  it("never send the API key or instructions outside the token's config", async () => {
    process.env.GEMINI_API_KEY = "real-secret-value";
    const { post, signIn } = setup();
    const Cookie = await signIn();
    const text = await (await post("/talk/token", {}, Cookie)).text();
    expect(text).not.toContain("real-secret-value");
    delete process.env.GEMINI_API_KEY;
  });

  it("pass a resume handle and history request through", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    await post("/talk/token", { handle: "resume-me", seedHistory: true }, Cookie);
    expect(talk.tokenRequests[0]).toMatchObject({ handle: "resume-me", seedHistory: true });
  });

  it("reject a bad handle", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    expect((await post("/talk/token", { handle: 5 }, Cookie)).status).toBe(400);
    expect((await post("/talk/token", { handle: "x".repeat(5000) }, Cookie)).status).toBe(400);
    expect(talk.tokenRequests).toHaveLength(0);
  });

  it("explain when Gemini can't be reached, without details", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.failToken = true;
    const response = await post("/talk/token", {}, Cookie);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("no key");
  });

  it("save a conversation", async () => {
    const { app, signIn, talk } = setup();
    const Cookie = await signIn();
    const response = await app.request("/api/talk/sessions/session-12345", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie },
      body: JSON.stringify(session),
    });
    expect(response.status).toBe(200);
    expect(talk.saved[0]).toMatchObject({ id: "session-12345", seconds: 95, localDate: "2026-11-04" });
    expect(talk.saved[0]?.turns).toHaveLength(2);
  });

  it("reject a malformed conversation", async () => {
    const { app, signIn, talk } = setup();
    const Cookie = await signIn();
    const put = (id: string, body: unknown) =>
      app.request(`/api/talk/sessions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie },
        body: JSON.stringify(body),
      });
    expect((await put("short", session)).status).toBe(400);
    expect((await put("session-12345", { ...session, localDate: "soon" })).status).toBe(400);
    expect((await put("session-12345", { ...session, startedAt: "never" })).status).toBe(400);
    expect((await put("session-12345", { ...session, seconds: -1 })).status).toBe(400);
    expect((await put("session-12345", { ...session, turns: [{ role: "system", text: "hi" }] })).status).toBe(400);
    expect((await put("session-12345", { ...session, turns: "nope" })).status).toBe(400);
    expect(talk.saved).toHaveLength(0);
  });

  it("cut off an oversized turn", async () => {
    const { app, signIn, talk } = setup();
    const Cookie = await signIn();
    await app.request("/api/talk/sessions/session-12345", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie },
      body: JSON.stringify({ ...session, turns: [{ role: "learner", text: "あ".repeat(9000) }] }),
    });
    expect(talk.saved[0]?.turns[0]?.text).toHaveLength(5000);
  });

  it("save which plan a conversation used, and reject bad usage", async () => {
    const { app, signIn, talk } = setup();
    const Cookie = await signIn();
    const put = (body: unknown) =>
      app.request("/api/talk/sessions/session-12345", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie },
        body: JSON.stringify(body),
      });
    const usage = { textIn: 100, audioIn: 50, textOut: 10, audioOut: 20 };
    expect((await put({ ...session, plan: "paid", usage })).status).toBe(200);
    expect(talk.saved[0]).toMatchObject({ plan: "paid", usage });
    expect((await put({ ...session, plan: "gold" })).status).toBe(400);
    expect((await put({ ...session, usage: { ...usage, textIn: -1 } })).status).toBe(400);
  });
});

describe("AI plan", () => {
  it("starts on paid when it's set up, and on free when it isn't", async () => {
    const { app, signIn, talk } = setup();
    const Cookie = await signIn();
    const plan = async () => (await (await app.request("/api/talk/plan", { headers: { Cookie } })).json()) as { plan: string };
    expect((await plan()).plan).toBe("paid");
    talk.available = { free: true, paid: false };
    expect((await plan()).plan).toBe("free");
  });

  it("uses the choice from Settings for a new conversation", async () => {
    const { app, post, signIn, talk } = setup();
    const Cookie = await signIn();
    const response = await app.request("/api/talk/plan", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie },
      body: JSON.stringify({ plan: "free" }),
    });
    expect(response.status).toBe(200);
    const token = (await (await post("/talk/token", {}, Cookie)).json()) as { plan: string };
    expect(token.plan).toBe("free");
    expect(talk.tokenRequests[0]?.plan).toBe("free");
  });

  it("keeps a reconnect on the plan its conversation started on", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.plan = "free";
    await post("/talk/token", { handle: "resume-me", plan: "paid" }, Cookie);
    expect(talk.tokenRequests[0]?.plan).toBe("paid");
  });

  it("never falls back to the other plan when the chosen one isn't set up", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.plan = "paid";
    talk.available = { free: true, paid: false };
    const response = await post("/talk/token", {}, Cookie);
    expect(response.status).toBe(409);
    expect(await response.text()).toMatch(/paid AI isn't set up/);
    expect(talk.tokenRequests).toHaveLength(0);
  });

  it("refuses to choose a plan that isn't set up, or one that doesn't exist", async () => {
    const { app, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.available = { free: false, paid: true };
    const put = (plan: string) =>
      app.request("/api/talk/plan", { method: "PUT", headers: { "Content-Type": "application/json", Cookie }, body: JSON.stringify({ plan }) });
    expect((await put("free")).status).toBe(409);
    expect((await put("gold")).status).toBe(400);
    expect(talk.plan).toBeNull();
  });

  it("reports this month's estimated spending", async () => {
    const { app, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.spentUsage = { textIn: 0, audioIn: 1_000_000, textOut: 0, audioOut: 0 };
    const report = (await (await app.request("/api/talk/plan?today=2026-11-05", { headers: { Cookie } })).json()) as { month: unknown };
    expect(report.month).toEqual({ spent: 3, minutes: 10, budget: 15 });
  });

  it("stops new paid conversations at the monthly limit, but not reconnects or free ones", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.spentUsage = { textIn: 0, audioIn: 5_000_000, textOut: 0, audioOut: 0 };
    const stopped = await post("/talk/token", {}, Cookie);
    expect(stopped.status).toBe(409);
    expect(await stopped.text()).toMatch(/\$15 paid limit/);
    expect((await post("/talk/token", { plan: "paid", handle: "resume-me" }, Cookie)).status).toBe(200);
    talk.plan = "free";
    expect((await post("/talk/token", {}, Cookie)).status).toBe(200);
  });
});

describe("tutor memory", () => {
  const conversation = (id: string, learnerTurns: number, plan?: AiPlan): TalkSession => ({
    id,
    localDate: "2026-11-04",
    startedAt: new Date("2026-11-04T12:00:00Z"),
    updatedAt: new Date("2026-11-04T12:10:00Z"),
    seconds: 600,
    tokens: 100,
    turns: Array.from({ length: learnerTurns }, () => ({ role: "learner" as const, text: "映画を見ました" })),
    ...(plan ? { plan } : {}),
  });

  it("learns from a finished conversation and uses it next time", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.pending = [conversation("session-12345", 4, "paid")];
    await post("/talk/prepare", { today: "2026-11-05", finished: "session-12345" }, Cookie);
    expect(talk.memory.facts.map((note) => note.text)).toEqual(["Likes movies"]);
    expect(talk.memory.speakingAbility).toBe(2);
    expect(talk.learned).toEqual(["session-12345"]);

    await post("/talk/token", { today: "2026-11-05" }, Cookie);
    const instructions = talk.tokenRequests[0]?.instructions;
    expect(instructions).toMatch(/Likes movies/);
    expect(instructions).toMatch(/they've spoken at about N4/);
  });

  it("doesn't spend anything on a conversation too short to learn from", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.pending = [conversation("session-12345", 1, "paid")];
    await post("/talk/prepare", {}, Cookie);
    expect(talk.analysisPlans).toHaveLength(0);
    expect(talk.learned).toEqual(["session-12345"]);
  });

  it("reads a conversation only with the plan it was held on", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.plan = "free";
    talk.pending = [conversation("session-12345", 4, "paid")];
    await post("/talk/prepare", {}, Cookie);
    expect(talk.analysisPlans).toEqual(["paid"]);
  });

  it("leaves a conversation waiting when its plan isn't available", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.available = { free: true, paid: false };
    talk.pending = [conversation("session-12345", 4, "paid")];
    await post("/talk/prepare", {}, Cookie);
    expect(talk.analysisPlans).toHaveLength(0);
    expect(talk.learned).toHaveLength(0);
  });

  it("tries again later when learning fails, without failing the request", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.failAnalysis = true;
    talk.pending = [conversation("session-12345", 4, "paid")];
    expect((await post("/talk/prepare", {}, Cookie)).status).toBe(200);
    expect(talk.learned).toHaveLength(0);
    talk.failAnalysis = false;
    await post("/talk/prepare", {}, Cookie);
    expect(talk.learned).toEqual(["session-12345"]);
  });

  it("shows what she remembers, and forgets it on request", async () => {
    const { app, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.memory = { ...EMPTY_MEMORY, speakingAbility: 2.4, facts: [{ text: "Likes movies", date: "2026-11-04" }] };
    const shown = (await (await app.request("/api/talk/memory", { headers: { Cookie } })).json()) as { speakingLevel: string; facts: unknown[] };
    expect(shown.speakingLevel).toBe("N4");
    expect(shown.facts).toHaveLength(1);

    const forgotten = await app.request("/api/talk/memory", { method: "DELETE", headers: { Cookie } });
    expect(forgotten.status).toBe(200);
    expect(talk.memory).toEqual(EMPTY_MEMORY);
    expect(talk.allLearned).toBe(true);
  });

  it("requires a session", async () => {
    const { app, post } = setup();
    expect((await post("/talk/prepare", {})).status).toBe(401);
    expect((await app.request("/api/talk/memory")).status).toBe(401);
    expect((await app.request("/api/talk/memory", { method: "DELETE" })).status).toBe(401);
    expect((await app.request("/api/talk/plan")).status).toBe(401);
  });
});

describe("daily topics", () => {
  it("fetches once a day and offers them to the tutor", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    await post("/talk/prepare", { today: "2026-11-05" }, Cookie);
    await post("/talk/prepare", { today: "2026-11-05" }, Cookie);
    expect(talk.topicRequests).toBe(1);
    await post("/talk/token", { today: "2026-11-05" }, Cookie);
    expect(talk.tokenRequests[0]?.instructions).toMatch(/Happy otters: Otters held hands\./);
  });

  it("tries again later if the news can't be read, and still starts the conversation", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    talk.failTopics = true;
    expect((await post("/talk/prepare", { today: "2026-11-05" }, Cookie)).status).toBe(200);
    expect((await post("/talk/token", { today: "2026-11-05" }, Cookie)).status).toBe(200);
    talk.failTopics = false;
    await post("/talk/prepare", { today: "2026-11-05" }, Cookie);
    expect(talk.topics.get("2026-11-05")).toHaveLength(1);
  });

  it("includes today's holiday without any news at all", async () => {
    const { post, signIn, talk } = setup();
    const Cookie = await signIn();
    await post("/talk/token", { today: "2026-11-03" }, Cookie);
    expect(talk.tokenRequests[0]?.instructions).toMatch(/Today is Culture Day in Japan/);
  });
});

describe("activity", () => {
  it("counts a day of only talking", () => {
    expect(mergeActivity([], [{ date: "2026-11-04", spoken: 7 }])).toEqual([
      { date: "2026-11-04", answers: 0, correct: 0, spoken: 7 },
    ]);
  });

  it("combines talking and answers on one day, in date order", () => {
    const merged = mergeActivity(
      [{ date: "2026-11-04", answers: 10, correct: 8 }, { date: "2026-11-01", answers: 5, correct: 5 }],
      [{ date: "2026-11-04", spoken: 3 }, { date: "2026-11-02", spoken: 2 }],
    );
    expect(merged.map((day) => day.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-04"]);
    expect(merged[2]).toEqual({ date: "2026-11-04", answers: 10, correct: 8, spoken: 3 });
  });

  it("keeps talking out of the right and wrong totals", async () => {
    const { app, signIn, progress } = setup();
    const Cookie = await signIn();
    progress.state.activity = [{ date: "2026-11-04", answers: 0, correct: 0, spoken: 12 }];
    const report = await app.request("/api/progress?today=2026-11-04", { headers: { Cookie } });
    const body = (await report.json()) as { streak: { current: number }; today: { answers: number }; calendar: { answers: number }[] };
    expect(body.streak.current).toBe(1);
    expect(body.today.answers).toBe(0);
    expect(body.calendar.at(-1)?.answers).toBe(12);
  });
});
