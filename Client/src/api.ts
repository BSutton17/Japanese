export type Script = "hiragana" | "katakana";
export type CardStatus = "new" | "learning" | "due" | "strong";

export type KanaSelection = { mode: "row"; rowId: string } | { mode: "all" } | { mode: "review" };

export interface KanaQuestion {
  itemId: string;
  kana: string;
  romaji: string;
  direction: "kana-to-romaji" | "romaji-to-kana";
  isNew: boolean;
  options: string[];
  answer: string;
}

export interface KanaRowSummary {
  id: string;
  group: "basic" | "dakuten" | "combo";
  items: { kana: string; romaji: string; status: CardStatus }[];
}

export interface KanaSummary {
  script: Script;
  total: number;
  seen: number;
  due: number;
  strong: number;
  nextRowId: string | null;
  rows: KanaRowSummary[];
}

export type VocabDirection = "ja-to-en" | "en-to-ja";
export type VocabSessionType = "new" | "review";

export interface VocabOption {
  text: string;
  reading?: string;
}

export interface VocabQuestion {
  itemId: string;
  word: string;
  reading: string;
  romaji: string;
  gloss: string;
  example?: { furigana: string; en: string };
  direction: VocabDirection;
  isNew: boolean;
  showReading: boolean;
  options: VocabOption[];
  answer: string;
}

export interface VocabSummary {
  levels: { level: string; total: number; seen: number; strong: number }[];
  due: number;
  seen: number;
  currentLevel: string;
  nextBatch: number;
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

function kanaSessionQuery(script: Script, selection: KanaSelection): string {
  const params = new URLSearchParams({ script, mode: selection.mode });
  if (selection.mode === "row") params.set("row", selection.rowId);
  return params.toString();
}

export const api = {
  me: () => request<{ email: string }>("/auth/me"),
  signIn: (credential: string) => post<{ email: string }>("/auth/google", { credential }),
  signOut: () => post<{ ok: true }>("/auth/logout", {}),

  kanaSummary: (script: Script) => request<KanaSummary>(`/kana/summary?script=${script}`),
  kanaSession: (script: Script, selection: KanaSelection) =>
    request<{ questions: KanaQuestion[] }>(`/kana/session?${kanaSessionQuery(script, selection)}`),
  saveKanaReview: (itemId: string, correct: boolean) =>
    post<{ ok: true }>("/kana/reviews", { itemId, correct, localDate: localDate() }),

  vocabSummary: () => request<VocabSummary>("/vocab/summary"),
  vocabSession: (type: VocabSessionType) => request<{ questions: VocabQuestion[] }>(`/vocab/session?type=${type}`),
  saveVocabReview: (wordId: string, correct: boolean) =>
    post<{ ok: true }>("/vocab/reviews", { wordId, correct, localDate: localDate() }),
};
