/** A word with its reading above it, or just the word when no reading should show. */
export function WordWithReading({ word, reading }: { word: string; reading?: string }) {
  if (!reading || reading === word) return <span lang="ja">{word}</span>;
  return (
    <ruby lang="ja">
      {word}
      <rt>{reading}</rt>
    </ruby>
  );
}

/** Renders furigana markup like "もう{会|あ}いました" as text with readings above the kanji. */
export function FuriganaText({ text }: { text: string }) {
  const parts = text.split(/(\{[^|}]+\|[^}]+\})/);
  return (
    <span lang="ja">
      {parts.map((part, index) => {
        const match = /^\{([^|}]+)\|([^}]+)\}$/.exec(part);
        return match ? (
          <ruby key={index}>
            {match[1]}
            <rt>{match[2]}</rt>
          </ruby>
        ) : (
          part
        );
      })}
    </span>
  );
}
