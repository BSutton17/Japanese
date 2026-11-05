import { GoogleGenAI, Modality } from "@google/genai";
import { requireEnv } from "../env.js";

export const LIVE_MODEL = "gemini-3.8-live";
// Short-lived tokens are only available on this API version.
export const LIVE_API_VERSION = "v1alpha";
const VOICE = "Kore";
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TOKEN_START_WINDOW_MS = 60 * 1000;

export interface LiveTokenRequest {
  instructions: string;
  /** Resumes an earlier connection, keeping what was said. */
  handle?: string;
  /** Lets the first message of a new connection replay an earlier conversation. */
  seedHistory?: boolean;
}

export interface LiveToken {
  token: string;
  model: string;
  apiVersion: string;
  config: Record<string, unknown>;
}

/**
 * Creates a token the browser connects with, so the real API key never leaves the server.
 * The settings and the tutor's instructions are sealed inside it. A token can only start one
 * connection, even to resume a conversation, so every reconnect needs a new one.
 */
export async function createLiveToken({ instructions, handle, seedHistory }: LiveTokenRequest): Promise<LiveToken> {
  const config = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: instructions,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: handle ? { handle } : {},
    ...(seedHistory ? { historyConfig: { initialHistoryInClientContent: true } } : {}),
  };
  const client = new GoogleGenAI({
    apiKey: requireEnv("GEMINI_API_KEY"),
    httpOptions: { apiVersion: LIVE_API_VERSION },
  });
  const now = Date.now();
  const token = await client.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
      newSessionExpireTime: new Date(now + TOKEN_START_WINDOW_MS).toISOString(),
      liveConnectConstraints: { model: LIVE_MODEL, config },
    },
  });
  if (!token.name) throw new Error("Gemini didn't return a token.");
  return { token: token.name, model: LIVE_MODEL, apiVersion: LIVE_API_VERSION, config };
}
