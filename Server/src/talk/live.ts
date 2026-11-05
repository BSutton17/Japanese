import { EndSensitivity, GoogleGenAI, Modality, StartSensitivity } from "@google/genai";
import { apiKeyFor, type AiPlan } from "./plan.js";

export const LIVE_MODEL = "gemini-3.8-live";
// Short-lived tokens are only available on this API version.
export const LIVE_API_VERSION = "v1alpha";
const VOICE = "Kore";
const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const TOKEN_START_WINDOW_MS = 60 * 1000;
// Listed in this order on purpose. Japanese spoken with an American accent came back as Spanish,
// German or English when English was listed first or the language was left automatic.
const SPOKEN_LANGUAGES = ["ja-JP", "en-US"];
// Long enough for a learner to stop and think mid-sentence without being answered too early.
const END_OF_TURN_SILENCE_MS = 1500;
// The app refreshes a conversation's context well before this size, which is what keeps turns cheap.
// This is only a backstop, in case a refresh can't happen.
const CONTEXT_TRIGGER_TOKENS = "8000";
const CONTEXT_TARGET_TOKENS = "4000";

export interface LiveTokenRequest {
  plan: AiPlan;
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
export async function createLiveToken({ plan, instructions, handle, seedHistory }: LiveTokenRequest): Promise<LiveToken> {
  const apiKey = apiKeyFor(plan);
  if (!apiKey) throw new Error(`No Gemini key for the ${plan} plan.`);
  const config = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: instructions,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
    inputAudioTranscription: { languageCodes: SPOKEN_LANGUAGES },
    outputAudioTranscription: {},
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
        silenceDurationMs: END_OF_TURN_SILENCE_MS,
      },
    },
    contextWindowCompression: { triggerTokens: CONTEXT_TRIGGER_TOKENS, slidingWindow: { targetTokens: CONTEXT_TARGET_TOKENS } },
    sessionResumption: handle ? { handle } : {},
    ...(seedHistory ? { historyConfig: { initialHistoryInClientContent: true } } : {}),
  };
  const client = new GoogleGenAI({
    apiKey,
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
