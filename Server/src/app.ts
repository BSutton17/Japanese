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
import { KANA_BY_ID, isScript } from "./kana/data.js";
import { applyReview, buildSession, buildSummary } from "./kana/session.js";
import type { KanaStore } from "./kana/store.js";

export interface AppDeps {
  verifyGoogleToken(idToken: string): Promise<GoogleIdentity>;
  kanaStore: KanaStore;
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

export function createApp({ verifyGoogleToken, kanaStore }: AppDeps) {
  const app = new Hono().basePath("/api");

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
    return c.json(buildSummary(script, await kanaStore.getCards(script), new Date()));
  });

  app.get("/kana/session", async (c) => {
    const script = c.req.query("script");
    if (!isScript(script)) return c.json({ error: "Unknown script." }, 400);
    const [cards, recentAccuracy] = await Promise.all([
      kanaStore.getCards(script),
      kanaStore.recentAccuracy(script),
    ]);
    return c.json({ questions: buildSession({ script, cards, recentAccuracy, now: new Date() }) });
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

  return app;
}
