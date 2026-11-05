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
import { WORDS_BY_ID, buildSession as buildVocabSession, buildSummary as buildVocabSummary } from "./vocab/session.js";
import type { VocabStore } from "./vocab/store.js";

export interface AppDeps {
  verifyGoogleToken(idToken: string): Promise<GoogleIdentity>;
  kanaStore: KanaStore;
  vocabStore: VocabStore;
  progressStore: ProgressStore;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

/** The learner's date from their device, since the server's clock may be in another time zone. */
function todayFrom(value: string | undefined, now: Date): string {
  return value && LOCAL_DATE.test(value) ? value : now.toISOString().slice(0, 10);
}

export function createApp({ verifyGoogleToken, kanaStore, vocabStore, progressStore }: AppDeps) {
  const app = new Hono().basePath("/api");

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

    setCookie(c, SESSION_COOKIE, await createSession(identity.email), {
      httpOnly: true,
      secure: Boolean(process.env.VERCEL),
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return c.json({ email: identity.email });
  });

  app.post("/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/auth/me", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const email = token ? await readSession(token) : undefined;
    return email ? c.json({ email }) : c.json({ error: "Not signed in." }, 401);
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
