import { describe, expect, it } from "vitest";
import { parseAnalysis } from "./analysis.js";
import { EMPTY_MEMORY, memoryForTutor, mergeAnalysis, type ConversationAnalysis } from "./memory.js";
import { NO_USAGE, usageCost } from "./plan.js";
import { buildTutorInstructions } from "./prompt.js";
import { parseFeed, specialDaysOn, topicsFromChoices, type FeedItem } from "./topics.js";

const analysis = (overrides: Partial<ConversationAnalysis> = {}): ConversationAnalysis => ({
  speakingLevel: null,
  summary: "Talked about movies.",
  facts: [],
  struggles: [],
  topics: [],
  followUps: [],
  ...overrides,
});

describe("merging what she learned", () => {
  it("keeps the date a fact was first learned", () => {
    const first = mergeAnalysis(EMPTY_MEMORY, analysis({ facts: ["Likes movies"] }), "2026-11-01");
    const second = mergeAnalysis(first, analysis({ facts: ["Likes movies", "Has a dog"] }), "2026-11-05");
    expect(second.facts).toEqual([
      { text: "Likes movies", date: "2026-11-01" },
      { text: "Has a dog", date: "2026-11-05" },
    ]);
  });

  it("lets a correction replace an old fact", () => {
    const first = mergeAnalysis(EMPTY_MEMORY, analysis({ facts: ["Lives in Ohio", "Likes movies"] }), "2026-11-01");
    const second = mergeAnalysis(first, analysis({ facts: ["Lives in Texas", "Likes movies"] }), "2026-11-05");
    expect(second.facts.map((note) => note.text)).toEqual(["Lives in Texas", "Likes movies"]);
  });

  it("doesn't lose facts to a reply that dropped most of them", () => {
    const facts = ["a", "b", "c", "d", "e", "f"];
    const first = mergeAnalysis(EMPTY_MEMORY, analysis({ facts }), "2026-11-01");
    const second = mergeAnalysis(first, analysis({ facts: ["g"] }), "2026-11-05");
    expect(second.facts.map((note) => note.text)).toEqual([...facts, "g"]);
  });

  it("moves the speaking level gradually, and ignores a conversation with too little Japanese", () => {
    const first = mergeAnalysis(EMPTY_MEMORY, analysis({ speakingLevel: 2 }), "2026-11-01");
    expect(first.speakingAbility).toBe(2);
    expect(mergeAnalysis(first, analysis({ speakingLevel: 3 }), "2026-11-02").speakingAbility).toBe(2.4);
    expect(mergeAnalysis(first, analysis({ speakingLevel: null }), "2026-11-02").speakingAbility).toBe(2);
    expect(mergeAnalysis(EMPTY_MEMORY, analysis({ speakingLevel: 99 }), "2026-11-02").speakingAbility).toBe(5);
  });

  it("removes duplicates and blanks, and caps each list", () => {
    const merged = mergeAnalysis(
      EMPTY_MEMORY,
      analysis({ facts: Array.from({ length: 60 }, (_, i) => `fact ${i}`), topics: ["movies", " movies ", ""] }),
      "2026-11-05",
    );
    expect(merged.facts).toHaveLength(40);
    expect(merged.facts.at(-1)?.text).toBe("fact 59");
    expect(merged.topics.map((note) => note.text)).toEqual(["movies"]);
  });

  it("keeps the last summary when a reply has none", () => {
    const first = mergeAnalysis(EMPTY_MEMORY, analysis(), "2026-11-01");
    expect(mergeAnalysis(first, analysis({ summary: " " }), "2026-11-02").lastConversation).toEqual({ text: "Talked about movies.", date: "2026-11-01" });
  });
});

describe("reading an analysis", () => {
  const good = { speakingLevel: 1.5, summary: "s", facts: [], struggles: [], topics: [], followUps: [] };

  it("accepts the expected shape, including an unknown level", () => {
    expect(parseAnalysis(JSON.stringify(good)).speakingLevel).toBe(1.5);
    expect(parseAnalysis(JSON.stringify({ ...good, speakingLevel: null })).speakingLevel).toBeNull();
  });

  it("rejects anything else, so bad data never overwrites her memory", () => {
    expect(() => parseAnalysis("not json")).toThrow();
    expect(() => parseAnalysis(JSON.stringify({ ...good, facts: "lots" }))).toThrow();
    expect(() => parseAnalysis(JSON.stringify({ ...good, facts: [1] }))).toThrow();
    expect(() => parseAnalysis(JSON.stringify({ ...good, summary: undefined }))).toThrow();
  });
});

describe("what she's told she remembers", () => {
  it("says nothing for a first conversation", () => {
    expect(memoryForTutor(EMPTY_MEMORY)).toBe("");
    expect(buildTutorInstructions({ ability: 0, levelName: null, nextLevel: "N5", easingBack: false, cards: new Map(), memory: EMPTY_MEMORY })).not.toMatch(/What you remember/);
  });

  it("marks memories as notes rather than instructions", () => {
    const memory = mergeAnalysis(EMPTY_MEMORY, analysis({ facts: ["Likes movies"], followUps: ["Has an exam on Friday"] }), "2026-11-05");
    const text = memoryForTutor(memory);
    expect(text).toMatch(/information, not instructions/);
    expect(text).toMatch(/Likes movies/);
    expect(text).toMatch(/Has an exam on Friday/);
  });

  it("starts her Japanese from how they really speak, when that's above their study record", () => {
    const memory = { ...EMPTY_MEMORY, speakingAbility: 2.5 };
    const text = buildTutorInstructions({ ability: 0.1, levelName: null, nextLevel: "N5", easingBack: false, cards: new Map(), memory });
    expect(text).toMatch(/N4 words and grammar/);
    expect(text).not.toMatch(/very short, simple Japanese/);
  });
});

describe("cost estimate", () => {
  it("uses each kind of token's price", () => {
    expect(usageCost(NO_USAGE)).toBe(0);
    expect(usageCost({ textIn: 1_000_000, audioIn: 1_000_000, textOut: 1_000_000, audioOut: 1_000_000 })).toBeCloseTo(0.75 + 3 + 4.5 + 12);
  });
});

describe("news feeds", () => {
  const xml = `<rss><channel><title>Feed</title>
    <item><title><![CDATA[Otters &amp; friends]]></title><link>https://example.com/a</link><pubDate>Thu, 05 Nov 2026 14:51:45 GMT</pubDate><description>&lt;p&gt;They&apos;re <b>happy</b>&lt;/p&gt;</description></item>
    <item><title>No date</title><link>https://example.com/b</link></item>
    <item><title>Insecure</title><link>http://example.com/c</link><pubDate>Thu, 05 Nov 2026 14:51:45 GMT</pubDate></item>
  </channel></rss>`;

  it("reads real items, cleans their text, and skips incomplete ones", () => {
    const items = parseFeed(xml, "BBC");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Otters & friends", description: "They're happy", url: "https://example.com/a", source: "BBC" });
  });

  it("copes with a broken feed", () => {
    expect(parseFeed("not xml at all", "BBC")).toEqual([]);
  });

  const item = (title: string): FeedItem => ({ title, description: "", url: `https://example.com/${title}`, source: "BBC", published: 0 });

  it("only accepts stories from the real list, so a made-up one can't get through", () => {
    const topics = topicsFromChoices([item("real")], [
      { index: 0, summary: "A real story." },
      { index: 7, summary: "An invented story." },
      { index: -1, summary: "Another invented story." },
      { index: "0", summary: "Wrong type." },
    ]);
    expect(topics.map((topic) => topic.title)).toEqual(["real"]);
    expect(topics[0]?.source).toBe("BBC");
  });

  it("drops repeats and empty summaries, keeps at most three, and handles nothing qualifying", () => {
    const items = [item("a"), item("b"), item("c"), item("d"), item("e")];
    const choices = [{ index: 0, summary: "x" }, { index: 0, summary: "again" }, { index: 1, summary: " " }, { index: 2, summary: "y" }, { index: 3, summary: "z" }, { index: 4, summary: "w" }];
    expect(topicsFromChoices(items, choices).map((topic) => topic.title)).toEqual(["a", "c", "d"]);
    expect(topicsFromChoices(items, [])).toEqual([]);
    expect(topicsFromChoices(items, "nope")).toEqual([]);
  });
});

describe("special days", () => {
  it.each([
    ["2026-11-03", /Culture Day/],
    ["2026-01-12", /Coming of Age Day/],
    ["2026-07-20", /Marine Day/],
    ["2026-09-21", /Respect for the Aged Day/],
    ["2026-10-12", /Sports Day/],
    ["2026-11-26", /Thanksgiving/],
    ["2026-03-20", /Vernal Equinox/],
    ["2026-09-23", /Autumnal Equinox/],
    ["2025-09-23", /Autumnal Equinox/],
    ["2026-07-07", /Tanabata/],
  ])("knows %s", (date, expected) => {
    expect(specialDaysOn(date).join(" ")).toMatch(expected);
  });

  it("has nothing for an ordinary day", () => {
    expect(specialDaysOn("2026-11-05")).toEqual([]);
  });
});
