export type Script = "hiragana" | "katakana";
export type KanaStatus = "new" | "learning" | "due" | "strong";

export interface KanaQuestion {
  itemId: string;
  kana: string;
  romaji: string;
  direction: "kana-to-romaji" | "romaji-to-kana";
  isNew: boolean;
  options: string[];
  answer: string;
}

export interface KanaSummary {
  script: Script;
  total: number;
  seen: number;
  due: number;
  strong: number;
  items: { kana: string; romaji: string; group: "basic" | "dakuten" | "combo"; status: KanaStatus }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? "Something went wrong.", response.status);
  return body as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

/** The learner's own calendar date, so streaks follow their days rather than UTC. */
function localDate(): string {
  return new Date().toLocaleDateString("en-CA");
}

export const api = {
  me: () => request<{ email: string }>("/auth/me"),
  signIn: (credential: string) => post<{ email: string }>("/auth/google", { credential }),
  signOut: () => post<{ ok: true }>("/auth/logout", {}),
  kanaSummary: (script: Script) => request<KanaSummary>(`/kana/summary?script=${script}`),
  kanaSession: (script: Script) =>
    request<{ questions: KanaQuestion[] }>(`/kana/session?script=${script}`),
  saveKanaReview: (itemId: string, correct: boolean) =>
    post<{ ok: true }>("/kana/reviews", { itemId, correct, localDate: localDate() }),
};
