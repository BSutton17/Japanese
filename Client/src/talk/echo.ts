// How much of what was heard must match her own recent words for it to count as her echo.
const MATCH_THRESHOLD = 0.7;
const MIN_MATCH_LENGTH = 4;
// One odd moment could be the learner. A second one soon after means she's hearing herself.
const SUSPICIONS_NEEDED = 2;
const SUSPICION_WINDOW_MS = 45_000;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function pairsOf(text: string): string[] {
  return Array.from({ length: Math.max(text.length - 1, 0) }, (_, i) => text.slice(i, i + 2));
}

/** Whether the words heard from the microphone are mostly words she just said. */
export function soundsLikeHer(heard: string, herRecentLines: readonly string[]): boolean {
  const pairs = pairsOf(normalize(heard));
  if (pairs.length < MIN_MATCH_LENGTH - 1) return false;
  const hers = new Set(herRecentLines.flatMap((line) => pairsOf(normalize(line))));
  return pairs.filter((pair) => hers.has(pair)).length / pairs.length >= MATCH_THRESHOLD;
}

/** Decides when the speakers are feeding her voice back into the microphone. */
export class EchoDetector {
  private suspicions: number[] = [];

  /** Returns true once there's enough evidence. */
  suspect(now: number = Date.now()): boolean {
    this.suspicions = [...this.suspicions.filter((at) => now - at < SUSPICION_WINDOW_MS), now];
    return this.suspicions.length >= SUSPICIONS_NEEDED;
  }
}
