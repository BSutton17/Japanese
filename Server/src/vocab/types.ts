export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";

export interface Word {
  id: string;
  word: string;
  reading: string;
  romaji: string;
  meanings: string[];
  level: JlptLevel;
  pos: string;
  /** Position in the frequency table, where 1 is the most common word. */
  rank: number;
  example?: { furigana: string; en: string };
}
