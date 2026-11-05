import { SignJWT, createRemoteJWKSet, jwtVerify } from "jose";
import { requireEnv } from "./env.js";

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  name?: string;
}

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyGoogleToken(idToken: string): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, GOOGLE_KEYS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: requireEnv("GOOGLE_CLIENT_ID"),
  });
  return {
    email: String(payload.email ?? ""),
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

export function isAllowedEmail(email: string): boolean {
  return email.trim().toLowerCase() === requireEnv("ALLOWED_EMAIL").trim().toLowerCase();
}

function sessionKey(): Uint8Array {
  const secret = requireEnv("SESSION_SECRET");
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return new TextEncoder().encode(secret);
}

export async function createSession(email: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(sessionKey());
}

/** Returns the signed-in email, or undefined if the session is invalid or no longer allowed. */
export async function readSession(token: string): Promise<string | undefined> {
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { algorithms: ["HS256"] });
    return payload.sub && isAllowedEmail(payload.sub) ? payload.sub : undefined;
  } catch (error) {
    // A missing or short secret is a server misconfiguration, not a bad session.
    if (error instanceof Error && /SESSION_SECRET/.test(error.message)) throw error;
    return undefined;
  }
}
