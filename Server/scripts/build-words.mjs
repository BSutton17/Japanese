// Regenerates src/vocab/words.ts from OpenJLPT and TUBELEX, ordered from most to least common.
// Run with: node scripts/build-words.mjs (needs xz on the PATH, which Git Bash includes)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OPENJLPT_COMMIT = "0d1d3410bec90bd4098a7c72de820543cb4f707c";
const TUBELEX_COMMIT = "7cb5fb36add76b83a266d1967536e1a1d3faa513";
const LEVELS = ["n5", "n4", "n3", "n2", "n1"];

// A kanji word's kana spelling also counts toward it, but homophones could otherwise swamp it.
const MAX_READING_SHARE = 10;
const READING_ONLY_SHARE = 0.1;
// A rarer reading of the same written word can't claim that word's whole count.
const SECONDARY_READING_SHARE = 0.02;
// A compound can't be more common than its rarest part, and it's usually well below that.
const COMPOUND_SHARE = 0.5;
// Parts like particles are so common that they say little about the whole, so estimates stay below
// the most common words. This is about the count of a word ranked around 300.
const COMPOUND_COUNT_CAP = 30000;
// Shorter words are too often split by chance for their parts to say anything about them.
const MIN_COMPOUND_LENGTH = 3;

async function fetchLevel(level) {
  const url = `https://raw.githubusercontent.com/evanclan/OpenJLPT/${OPENJLPT_COMMIT}/data/json/vocab/${level}.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchCounts(file) {
  const url = `https://raw.githubusercontent.com/naist-nlp/tubelex/${TUBELEX_COMMIT}/frequencies/${file}.tsv.xz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);

  const dir = mkdtempSync(join(tmpdir(), "tubelex-"));
  try {
    const path = join(dir, `${file}.tsv.xz`);
    writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    const text = execFileSync("xz", ["-dc", path], { maxBuffer: 1024 * 1024 * 1024 }).toString("utf8");
    const counts = new Map();
    for (const line of text.split(/\r?\n/).slice(1)) {
      const [word, count, , , pos] = line.split("\t");
      if (word && word !== "[TOTAL]") counts.set(word, { count: Number(count), pos: pos ?? "" });
    }
    return counts;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const isKana = (text) => /^[぀-ヿ]+$/.test(text);
const isFunctionWord = (pos) => /^(助詞|助動詞)/.test(pos);

function directCount(entry, baseForms) {
  const forms = [entry.word, ...(entry.other_forms ?? [])];
  return forms.reduce((sum, form) => sum + (baseForms.get(form)?.count ?? 0), 0);
}

function countWithReading(entry, baseForms, readingUses) {
  const direct = directCount(entry, baseForms);
  if (isKana(entry.word)) return direct;

  // Skip readings shared with another listed word, or with a particle: 蚊 is read か, a question marker.
  const reading = baseForms.get(entry.reading);
  const usable =
    reading && entry.reading.length >= 2 && readingUses.get(entry.reading) === 1 && !isFunctionWord(reading.pos);
  if (!usable) return direct;
  return direct === 0
    ? reading.count * READING_ONLY_SHARE
    : direct + Math.min(reading.count, direct * MAX_READING_SHARE);
}

/**
 * Estimates a compound the corpus splits up. All-kanji words like 飛行機 use their fewest known parts.
 * Words with kana like どうして use the split with the strongest evidence, since a short stray token
 * would otherwise drag them down.
 */
function compoundCount(word, known) {
  const allKanji = /^[一-鿿々]+$/.test(word);
  const isBetter = (next, current) =>
    allKanji
      ? next.parts < current.parts || (next.parts === current.parts && next.rarest > current.rarest)
      : next.rarest > current.rarest;
  const best = Array(word.length + 1).fill(null);
  best[0] = { parts: 0, rarest: Infinity };
  for (let end = 1; end <= word.length; end++) {
    for (let start = 0; start < end; start++) {
      if (!best[start]) continue;
      // The whole word doesn't count as a part: a few stray hits would hide a better estimate.
      if (start === 0 && end === word.length) continue;
      const count = known.get(word.slice(start, end))?.count;
      if (!count) continue;
      const next = { parts: best[start].parts + 1, rarest: Math.min(best[start].rarest, count) };
      if (!best[end] || isBetter(next, best[end])) best[end] = next;
    }
  }
  const result = best[word.length];
  return result ? Math.min(result.rarest * COMPOUND_SHARE, COMPOUND_COUNT_CAP) : 0;
}

/** The best available estimate. A long word's own count can be a few stray hits, so its parts may beat it. */
function estimateCount(entry, baseForms, surfaceForms, known, readingUses) {
  const direct = countWithReading(entry, baseForms, readingUses) || (surfaceForms.get(entry.word)?.count ?? 0);
  const canUseParts = direct === 0 || entry.word.length >= MIN_COMPOUND_LENGTH;
  return canUseParts ? Math.max(direct, compoundCount(entry.word, known)) : direct;
}

function toWord(entry, rank) {
  // The shortest sentence is usually the easiest to read. Not every sentence has furigana, so those
  // with it come first, and the rest fall back to the plain sentence.
  const examples = [...(entry.examples ?? [])].sort((a, b) => a.ja.length - b.ja.length);
  const example = examples.find((candidate) => candidate.furigana) ?? examples[0];
  return {
    id: entry.id,
    word: entry.word,
    reading: entry.reading,
    romaji: entry.romaji,
    meanings: entry.meanings.slice(0, 3),
    level: entry.level,
    pos: entry.pos?.[0] ?? "n",
    rank,
    ...(example ? { example: { furigana: example.furigana ?? example.ja, en: example.en } } : {}),
  };
}

const entries = (await Promise.all(LEVELS.map(fetchLevel))).flat();
const [baseForms, surfaceForms] = await Promise.all([fetchCounts("tubelex-ja-base-pos"), fetchCounts("tubelex-ja")]);
const known = new Map([...surfaceForms, ...baseForms]);

const readingUses = new Map();
for (const entry of entries) readingUses.set(entry.reading, (readingUses.get(entry.reading) ?? 0) + 1);

const scored = entries.map((entry) => ({
  entry,
  count: estimateCount(entry, baseForms, surfaceForms, known, readingUses),
}));

// Listed levels run from easiest to hardest, so the first reading of a written word is its primary one.
const seenSpellings = new Set();
for (const item of scored) {
  if (seenSpellings.has(item.entry.word)) item.count *= SECONDARY_READING_SHARE;
  seenSpellings.add(item.entry.word);
}

// Uncounted words fall back to a stable order based on their hashed ids.
scored.sort((a, b) => b.count - a.count || a.entry.id.localeCompare(b.entry.id));

const lines = scored.map(({ entry }, index) => `  ${JSON.stringify(JSON.stringify(toWord(entry, index + 1)))},`);

// Each word is a JSON string, because TypeScript can't type an object literal this large.
writeFileSync(
  new URL("../src/vocab/words.ts", import.meta.url),
  `// Generated by scripts/build-words.mjs from OpenJLPT and TUBELEX. See NOTICE.md. Do not edit by hand.
import type { Word } from "./types.js";

/** Every word, from most to least common in everyday spoken Japanese. */
const RAW_WORDS: string[] = [
${lines.join("\n")}
];

export const WORDS: Word[] = RAW_WORDS.map((line) => JSON.parse(line) as Word);
`,
);

const uncounted = scored.filter((item) => item.count === 0);
console.log(`Wrote ${lines.length} words, ${uncounted.length} without a frequency`);
console.log("Uncounted:", uncounted.slice(0, 30).map(({ entry }) => entry.word).join(" "));
console.log("Top 100:", scored.slice(0, 100).map(({ entry }) => `${entry.word}(${entry.level[1]})`).join(" "));
const firstN5 = scored.filter(({ entry }) => entry.level === "N5" || entry.level === "N4");
console.log("First 40 to learn:", firstN5.slice(0, 40).map(({ entry }) => entry.word).join(" "));
console.log("Last N5:", scored.filter(({ entry }) => entry.level === "N5").slice(-20).map(({ entry }) => entry.word).join(" "));
for (const word of ["飛行機", "お母さん", "お金", "日曜日", "一つ", "映画館", "いただきます", "冷蔵庫", "もう一度", "だから", "ください", "だが", "それなのに", "万年筆", "すみません", "ごめんなさい", "どうして", "今に", "何か", "僕", "活ける", "蚊", "先生", "今年"]) {
  const matches = scored.map((item, rank) => ({ ...item, rank: rank + 1 })).filter((item) => item.entry.word === word);
  console.log(word, matches.map((item) => `${item.entry.reading} ${item.entry.level} rank ${item.rank}`).join("; ") || "not in list");
}
