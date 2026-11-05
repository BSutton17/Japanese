import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSession,
  isAllowedEmail,
  readSession,
  type GoogleIdentity,
} from "./auth.js";
import { KANA, KANA_BY_ID, isScript } from "./kana/data.js";
import { buildSession as buildKanaSession, buildSummary as buildKanaSummary, findRow, type KanaSelection } from "./kana/session.js";
import type { KanaStore } from "./kana/store.js";
import { buildCalendar, buildProgress, computeStreak, describeAbility } from "./progress/progress.js";
import type { ProgressStore } from "./progress/store.js";
import { applyReview } from "./srs.js";
import type { AnalysisRequest } from "./talk/analysis.js";
import type { LiveToken, LiveTokenRequest } from "./talk/live.js";
import { mergeAnalysis, speakingLevelName, type ConversationAnalysis } from "./talk/memory.js";
import { MONTHLY_BUDGET_USD, NO_USAGE, isPlan, usageCost, type AiPlan, type TalkUsage } from "./talk/plan.js";
import { GREETING_PROMPT, QUIET_PROMPT, buildTutorInstructions } from "./talk/prompt.js";
import type { TalkStore, TalkTurn } from "./talk/store.js";
import { specialDaysOn, type DailyTopic, type TopicRequest } from "./talk/topics.js";
import { WORDS_BY_ID, buildSession as buildVocabSession, buildSummary as buildVocabSummary } from "./vocab/session.js";
import type { VocabStore } from "./vocab/store.js";

export interface AppDeps {
  verifyGoogleToken(idToken: string): Promise<GoogleIdentity>;
  kanaStore: KanaStore;
  vocabStore: VocabStore;
  progressStore: ProgressStore;
  talkStore: TalkStore;
  createLiveToken(request: LiveTokenRequest): Promise<LiveToken>;
  availablePlans(): Record<AiPlan, boolean>;
  analyzeConversation(request: AnalysisRequest): Promise<ConversationAnalysis>;
  chooseDailyTopics(request: TopicRequest): Promise<DailyTopic[]>;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_ID = /^[\w-]{8,64}$/;
const MAX_HANDLE_LENGTH = 4096;
const MAX_TURNS = 3000;
const MAX_TURN_LENGTH = 5000;
// Too little was said in a shorter conversation to learn anything from it.
const MIN_LEARNER_TURNS_TO_LEARN = 2;

function parseUsage(value: unknown): TalkUsage | undefined {
  if (value === undefined) return NO_USAGE;
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const parts = [usage.textIn, usage.audioIn, usage.textOut, usage.audioOut];
  if (!parts.every((part) => typeof part === "number" && Number.isFinite(part) && part >= 0)) return undefined;
  const [textIn, audioIn, textOut, audioOut] = parts as [number, number, number, number];
  return { textIn, audioIn, textOut, audioOut };
}

function parseTurns(value: unknown): TalkTurn[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_TURNS) return undefined;
  const turns: TalkTurn[] = [];
  for (const turn of value as { role?: unknown; text?: unknown }[]) {
    if ((turn?.role !== "learner" && turn?.role !== "tutor") || typeof turn.text !== "string") return undefined;
    turns.push({ role: turn.role, text: turn.text.slice(0, MAX_TURN_LENGTH) });
  }
  return turns;
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseKanaSelection(mode: string | undefined, rowId: string | undefined): KanaSelection | undefined {
  if (mode === "all" || mode === "review") return { mode };
  if (mode === "row" && rowId) return { mode, rowId };
  return undefined;
}

async function startSession(c: Context, email: string): Promise<void> {
  setCookie(c, SESSION_COOKIE, await createSession(email), {
    httpOnly: true,
    secure: Boolean(process.env.VERCEL),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** The learner's date from their device, since the server's clock may be in another time zone. */
function todayFrom(value: string | undefined, now: Date): string {
  return value && LOCAL_DATE.test(value) ? value : now.toISOString().slice(0, 10);
}

export function createApp({
  verifyGoogleToken,
  kanaStore,
  vocabStore,
  progressStore,
  talkStore,
  createLiveToken,
  availablePlans,
  analyzeConversation,
  chooseDailyTopics,
}: AppDeps) {
  const app = new Hono().basePath("/api");

  /** The choice in Settings. Until one is made, paid is the private option, so it comes first. */
  const currentPlan = async (): Promise<AiPlan> => {
    const stored = await talkStore.getPlan();
    if (stored) return stored;
    return availablePlans().paid ? "paid" : "free";
  };

  const monthSpend = async (today: string) => {
    const { usage, seconds } = await talkStore.monthUsage(today.slice(0, 7));
    return { spent: usageCost(usage), minutes: seconds / 60 };
  };

  /** Updates the tutor's memory from finished conversations, on the plan each one was held on. */
  const learnFromConversations = async (finishedId: string | undefined, now: Date, fallbackPlan: AiPlan) => {
    const available = availablePlans();
    for (const session of await talkStore.pendingSessions(finishedId, now)) {
      const learnerTurns = session.turns.filter((turn) => turn.role === "learner").length;
      if (learnerTurns < MIN_LEARNER_TURNS_TO_LEARN) {
        await talkStore.markLearned([session.id]);
        continue;
      }
      const plan = session.plan ?? fallbackPlan;
      // A conversation is never sent to a different plan's key, so it waits until this one is back.
      if (!available[plan]) continue;
      const memory = await talkStore.getMemory();
      const analysis = await analyzeConversation({ memory, turns: session.turns, plan });
      await talkStore.saveMemory(mergeAnalysis(memory, analysis, session.localDate));
      await talkStore.markLearned([session.id]);
    }
  };

  const refreshTopics = async (today: string, plan: AiPlan) => {
    if (!availablePlans()[plan] || (await talkStore.getTopics(today))) return;
    await talkStore.saveTopics(today, await chooseDailyTopics({ today, plan }));
  };

  const loadVocabProgress = async (today: string, now: Date) => {
    const [cards, activity, storedPeak] = await Promise.all([
      vocabStore.getCards(),
      progressStore.getActivity(),
      progressStore.getPeak(),
    ]);
    const progress = buildProgress({ cards, activity, storedPeak, today, now });
    if (progress.peak > storedPeak) await progressStore.savePeak(progress.peak, now);
    return { cards, activity, progress };
  };

  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: "Something went wrong on the server." }, 500);
  });

  const requireSession = createMiddleware(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (!token || !(await readSession(token))) return c.json({ error: "Not signed in." }, 401);
    await next();
  });

  app.post("/auth/google", async (c) => {
    const { credential } = await readJson(c);
    if (typeof credential !== "string") return c.json({ error: "Missing Google credential." }, 400);

    let identity: GoogleIdentity;
    try {
      identity = await verifyGoogleToken(credential);
    } catch (error) {
      console.warn("Rejected Google sign-in:", error);
      return c.json({ error: "Google sign-in could not be verified." }, 401);
    }
    if (!identity.emailVerified || !isAllowedEmail(identity.email)) {
      return c.json({ error: "This Google account isn't allowed to use this app." }, 403);
    }

    await startSession(c, identity.email);
    return c.json({ email: identity.email });
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/auth/me", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const email = token ? await readSession(token) : undefined;
    if (!email) return c.json({ error: "Not signed in." }, 401);
    // The app asks this each time it opens, so regular use keeps pushing the expiry back.
    await startSession(c, email);
    return c.json({ email });
  });

  app.use("/kana/*", requireSession);

  app.get("/kana/summary", async (c) => {
    const script = c.req.query("script");
    if (!isScript(script)) return c.json({ error: "Unknown script." }, 400);
    return c.json(buildKanaSummary(script, await kanaStore.getCards(script), new Date()));
  });

  app.get("/kana/session", async (c) => {
    const script = c.req.query("script");
    if (!isScript(script)) return c.json({ error: "Unknown script." }, 400);
    const selection = parseKanaSelection(c.req.query("mode"), c.req.query("row"));
    if (!selection || (selection.mode === "row" && !findRow(script, selection.rowId))) {
      return c.json({ error: "Unknown session type." }, 400);
    }
    const cards = await kanaStore.getCards(script);
    return c.json({ questions: buildKanaSession({ script, selection, cards, now: new Date() }) });
  });

  app.post("/kana/reviews", async (c) => {
    const { itemId, correct, localDate } = await readJson(c);
    const item = typeof itemId === "string" ? KANA_BY_ID.get(itemId) : undefined;
    if (!item || typeof correct !== "boolean" || typeof localDate !== "string" || !LOCAL_DATE.test(localDate)) {
      return c.json({ error: "Invalid review." }, 400);
    }
    const now = new Date();
    const card = applyReview(await kanaStore.getCard(item.id), correct, now);
    await kanaStore.saveReview({ item, card, correct, at: now, localDate });
    return c.json({ ok: true });
  });

  app.use("/vocab/*", requireSession);

  app.get("/vocab/summary", async (c) => {
    const now = new Date();
    const [{ cards, progress }, recentAccuracy] = await Promise.all([
      loadVocabProgress(todayFrom(c.req.query("today"), now), now),
      vocabStore.recentAccuracy(),
    ]);
    return c.json(buildVocabSummary(cards, recentAccuracy, now, progress.comeback.active));
  });

  app.get("/vocab/session", async (c) => {
    const type = c.req.query("type");
    if (type !== "new" && type !== "review") return c.json({ error: "Unknown session type." }, 400);
    const now = new Date();
    const [{ cards, progress }, recentAccuracy] = await Promise.all([
      loadVocabProgress(todayFrom(c.req.query("today"), now), now),
      vocabStore.recentAccuracy(),
    ]);
    const easingBack = progress.comeback.active;
    const { ability } = progress;
    return c.json({ questions: buildVocabSession({ type, cards, recentAccuracy, easingBack, ability, now }) });
  });

  app.post("/vocab/reviews", async (c) => {
    const { wordId, correct, localDate } = await readJson(c);
    const word = typeof wordId === "string" ? WORDS_BY_ID.get(wordId) : undefined;
    if (!word || typeof correct !== "boolean" || typeof localDate !== "string" || !LOCAL_DATE.test(localDate)) {
      return c.json({ error: "Invalid review." }, 400);
    }
    const now = new Date();
    const card = applyReview(await vocabStore.getCard(word.id), correct, now);
    await vocabStore.saveReview({ word, card, correct, at: now, localDate });
    return c.json({ ok: true });
  });

  app.use("/talk/*", requireSession);

  app.post("/talk/token", async (c) => {
    const { handle, seedHistory, today, plan: sessionPlan } = await readJson(c);
    if (handle !== undefined && (typeof handle !== "string" || handle.length > MAX_HANDLE_LENGTH)) {
      return c.json({ error: "Invalid handle." }, 400);
    }
    if (sessionPlan !== undefined && !isPlan(sessionPlan)) return c.json({ error: "Unknown plan." }, 400);
    const now = new Date();
    const date = todayFrom(typeof today === "string" ? today : undefined, now);

    // A reconnect stays on the plan its conversation started on, whatever Settings says now.
    const plan = sessionPlan ?? (await currentPlan());
    if (!availablePlans()[plan]) {
      const error = plan === "free"
        ? "The free AI isn't set up yet. Switch to paid in Settings, or add its key."
        : "The paid AI isn't set up yet. Switch to free in Settings, or add its key.";
      return c.json({ error }, 409);
    }
    // Only stops new conversations, so nobody gets cut off mid-sentence.
    if (plan === "paid" && !sessionPlan && (await monthSpend(date)).spent >= MONTHLY_BUDGET_USD) {
      return c.json({ error: `You've reached your $${MONTHLY_BUDGET_USD} paid limit for this month. Switch to free in Settings to keep talking.` }, 409);
    }

    const [{ cards, progress }, memory, topics] = await Promise.all([
      loadVocabProgress(date, now),
      talkStore.getMemory(),
      talkStore.getTopics(date),
    ]);
    const level = describeAbility(progress.ability);
    const instructions = buildTutorInstructions({
      ability: progress.ability,
      levelName: level.reached,
      nextLevel: level.next,
      easingBack: progress.comeback.active,
      cards,
      memory,
      topics: topics ?? [],
      specialDays: specialDaysOn(date),
    });
    try {
      const token = await createLiveToken({ plan, instructions, handle, seedHistory: seedHistory === true });
      return c.json({ ...token, plan, greeting: GREETING_PROMPT, quietPrompt: QUIET_PROMPT });
    } catch (error) {
      console.error("Couldn't create a Gemini token:", error);
      return c.json({ error: "The tutor isn't available right now." }, 503);
    }
  });

  app.put("/talk/sessions/:id", async (c) => {
    const id = c.req.param("id");
    const { localDate, startedAt, seconds, tokens, turns, plan, usage } = await readJson(c);
    const parsedTurns = parseTurns(turns);
    const parsedUsage = parseUsage(usage);
    const started = new Date(typeof startedAt === "string" ? startedAt : NaN);
    if (
      !SESSION_ID.test(id) ||
      !parsedTurns ||
      !parsedUsage ||
      (plan !== undefined && !isPlan(plan)) ||
      typeof localDate !== "string" ||
      !LOCAL_DATE.test(localDate) ||
      Number.isNaN(started.getTime()) ||
      typeof seconds !== "number" ||
      seconds < 0 ||
      typeof tokens !== "number" ||
      tokens < 0
    ) {
      return c.json({ error: "Invalid session." }, 400);
    }
    await talkStore.saveSession({
      id,
      localDate,
      startedAt: started,
      updatedAt: new Date(),
      seconds,
      tokens,
      turns: parsedTurns,
      ...(plan ? { plan } : {}),
      usage: parsedUsage,
    });
    return c.json({ ok: true });
  });

  // The slow background work, called when the app opens and when a conversation ends, so
  // starting a conversation never has to wait for it. Anything that fails is retried next time.
  app.post("/talk/prepare", async (c) => {
    const { today, finished } = await readJson(c);
    const now = new Date();
    const date = todayFrom(typeof today === "string" ? today : undefined, now);
    const finishedId = typeof finished === "string" && SESSION_ID.test(finished) ? finished : undefined;
    const plan = await currentPlan();
    const results = await Promise.allSettled([learnFromConversations(finishedId, now, plan), refreshTopics(date, plan)]);
    for (const result of results) {
      if (result.status === "rejected") console.error("Couldn't prepare the tutor:", result.reason);
    }
    return c.json({ ok: true });
  });

  app.get("/talk/plan", async (c) => {
    const date = todayFrom(c.req.query("today"), new Date());
    return c.json({
      plan: await currentPlan(),
      available: availablePlans(),
      month: { ...(await monthSpend(date)), budget: MONTHLY_BUDGET_USD },
    });
  });

  app.put("/talk/plan", async (c) => {
    const { plan } = await readJson(c);
    if (!isPlan(plan)) return c.json({ error: "Unknown plan." }, 400);
    if (!availablePlans()[plan]) return c.json({ error: `The ${plan} AI isn't set up yet.` }, 409);
    await talkStore.savePlan(plan);
    return c.json({ plan });
  });

  app.get("/talk/memory", async (c) => {
    const memory = await talkStore.getMemory();
    return c.json({
      ...memory,
      speakingLevel: memory.speakingAbility === null ? null : speakingLevelName(memory.speakingAbility),
    });
  });

  // Also retires anything not yet learned from, so forgotten things don't come straight back.
  app.delete("/talk/memory", async (c) => {
    await Promise.all([talkStore.clearMemory(), talkStore.markAllLearned()]);
    return c.json({ ok: true });
  });

  app.use("/progress", requireSession);

  app.get("/progress", async (c) => {
    const now = new Date();
    const today = todayFrom(c.req.query("today"), now);
    const [{ activity, progress }, hiragana, katakana] = await Promise.all([
      loadVocabProgress(today, now),
      kanaStore.getCards("hiragana"),
      kanaStore.getCards("katakana"),
    ]);
    const streak = computeStreak(activity, today);
    const todayActivity = activity.find((day) => day.date === today);
    return c.json({
      level: describeAbility(progress.ability),
      peak: describeAbility(progress.peak),
      comeback: progress.comeback,
      levels: progress.levels,
      streak: {
        current: streak.current,
        longest: streak.longest,
        freezes: streak.freezes,
        practicedToday: streak.practicedToday,
      },
      calendar: buildCalendar(activity, streak.frozenDays, today),
      today: { answers: todayActivity?.answers ?? 0, correct: todayActivity?.correct ?? 0 },
      totalAnswers: activity.reduce((sum, day) => sum + day.answers, 0),
      kana: [
        { script: "Hiragana", learned: hiragana.size, total: KANA.hiragana.length },
        { script: "Katakana", learned: katakana.size, total: KANA.katakana.length },
      ],
    });
  });

  return app;
}
