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
  /** Up to two sentences, easiest first. Difficulty 0 suits a beginner, and 2 is past N3. */
  examples: { furigana: string; en: string; difficulty: number }[];
}
