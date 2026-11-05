export type AiPlan = "free" | "paid";

export const MONTHLY_BUDGET_USD = 15;

// Gemini 3.8 Live's paid prices, in dollars per million tokens.
const PRICE_PER_MILLION = { textIn: 0.75, audioIn: 3, textOut: 4.5, audioOut: 12 };

export interface TalkUsage {
  textIn: number;
  audioIn: number;
  textOut: number;
  audioOut: number;
}

export const NO_USAGE: TalkUsage = { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 };

/** An estimate from the tokens Gemini reports. Google's usage page has the real bill. */
export function usageCost(usage: TalkUsage): number {
  return (
    (usage.textIn * PRICE_PER_MILLION.textIn +
      usage.audioIn * PRICE_PER_MILLION.audioIn +
      usage.textOut * PRICE_PER_MILLION.textOut +
      usage.audioOut * PRICE_PER_MILLION.audioOut) /
    1_000_000
  );
}

export function isPlan(value: unknown): value is AiPlan {
  return value === "free" || value === "paid";
}

/** Billing belongs to a Google project, so each plan needs a key from its own project. */
export function apiKeyFor(plan: AiPlan): string | undefined {
  return (plan === "paid" ? process.env.GEMINI_API_KEY : process.env.GEMINI_FREE_API_KEY) || undefined;
}

export function availablePlans(): Record<AiPlan, boolean> {
  return { free: Boolean(apiKeyFor("free")), paid: Boolean(apiKeyFor("paid")) };
}
