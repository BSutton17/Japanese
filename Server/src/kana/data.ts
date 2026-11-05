export type Script = "hiragana" | "katakana";
export type KanaGroup = "basic" | "dakuten" | "combo";

export interface KanaItem {
  id: string;
  script: Script;
  kana: string;
  romaji: string;
  group: KanaGroup;
}

// Written in hiragana and listed in teaching order. Katakana is derived from these.
const BASIC = `あ a,い i,う u,え e,お o,か ka,き ki,く ku,け ke,こ ko,さ sa,し shi,す su,せ se,そ so,
た ta,ち chi,つ tsu,て te,と to,な na,に ni,ぬ nu,ね ne,の no,は ha,ひ hi,ふ fu,へ he,ほ ho,
ま ma,み mi,む mu,め me,も mo,や ya,ゆ yu,よ yo,ら ra,り ri,る ru,れ re,ろ ro,わ wa,を wo,ん n`;

const DAKUTEN = `が ga,ぎ gi,ぐ gu,げ ge,ご go,ざ za,じ ji,ず zu,ぜ ze,ぞ zo,だ da,ぢ ji,づ zu,で de,ど do,
ば ba,び bi,ぶ bu,べ be,ぼ bo,ぱ pa,ぴ pi,ぷ pu,ぺ pe,ぽ po`;

const COMBO = `きゃ kya,きゅ kyu,きょ kyo,しゃ sha,しゅ shu,しょ sho,ちゃ cha,ちゅ chu,ちょ cho,
にゃ nya,にゅ nyu,にょ nyo,ひゃ hya,ひゅ hyu,ひょ hyo,みゃ mya,みゅ myu,みょ myo,
りゃ rya,りゅ ryu,りょ ryo,ぎゃ gya,ぎゅ gyu,ぎょ gyo,じゃ ja,じゅ ju,じょ jo,
びゃ bya,びゅ byu,びょ byo,ぴゃ pya,ぴゅ pyu,ぴょ pyo`;

// Characters that learners commonly mix up, tried first as wrong answers.
const LOOKALIKES: Record<Script, string[]> = {
  hiragana: ["はほ", "ねれわ", "めぬ", "るろ", "さちき", "いり", "こに", "あお", "たな", "うつ", "しも", "ばぱ", "びぴ", "ぶぷ", "べぺ", "ぼぽ"],
  katakana: ["シツ", "ソン", "ノメ", "クケタ", "ウワフ", "コユ", "ヌス", "チテ", "アマ", "ナメ", "ルレ", "ラヲ", "ハバパ", "ヒビピ", "フブプ", "ヘベペ", "ホボポ"],
};

function toKatakana(hiragana: string): string {
  return [...hiragana].map((char) => String.fromCodePoint(char.codePointAt(0)! + 0x60)).join("");
}

function parseGroup(table: string, group: KanaGroup, script: Script): KanaItem[] {
  return table
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hiragana, romaji] = entry.split(" ") as [string, string];
      const kana = script === "hiragana" ? hiragana : toKatakana(hiragana);
      return { id: `${script}:${kana}`, script, kana, romaji, group };
    });
}

function buildScript(script: Script): KanaItem[] {
  return [
    ...parseGroup(BASIC, "basic", script),
    ...parseGroup(DAKUTEN, "dakuten", script),
    ...parseGroup(COMBO, "combo", script),
  ];
}

export const KANA: Record<Script, KanaItem[]> = {
  hiragana: buildScript("hiragana"),
  katakana: buildScript("katakana"),
};

export const KANA_BY_ID = new Map(
  [...KANA.hiragana, ...KANA.katakana].map((item) => [item.id, item]),
);

export function lookalikesOf(item: KanaItem): string[] {
  const set = LOOKALIKES[item.script].find((chars) => chars.includes(item.kana));
  return set ? [...set].filter((char) => char !== item.kana) : [];
}

export function isScript(value: unknown): value is Script {
  return value === "hiragana" || value === "katakana";
}
