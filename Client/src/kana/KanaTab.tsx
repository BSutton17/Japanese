import { useCallback, useEffect, useState } from "react";
import { api, type KanaQuestion, type KanaSummary, type Script } from "../api";
import { KanaSession, type SessionResult } from "./KanaSession";

const SCRIPT_LABELS: Record<Script, { name: string; sample: string }> = {
  hiragana: { name: "Hiragana", sample: "あ" },
  katakana: { name: "Katakana", sample: "ア" },
};

const GROUP_LABELS = { basic: "Basic", dakuten: "Voiced", combo: "Combinations" } as const;

type View =
  | { kind: "home" }
  | { kind: "session"; questions: KanaQuestion[] }
  | { kind: "results"; result: SessionResult };

export function KanaTab() {
  const [script, setScript] = useState<Script>("hiragana");
  const [view, setView] = useState<View>({ kind: "home" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  const start = useCallback(async () => {
    setStarting(true);
    setStartError(undefined);
    try {
      const { questions } = await api.kanaSession(script);
      setView({ kind: "session", questions });
    } catch {
      setStartError("Couldn't start the session. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }, [script]);

  if (view.kind === "session") {
    return (
      <KanaSession
        questions={view.questions}
        onFinish={(result) => setView({ kind: "results", result })}
        onQuit={() => setView({ kind: "home" })}
      />
    );
  }

  if (view.kind === "results") {
    return <Results result={view.result} starting={starting} startError={startError} onAgain={start} onHome={() => setView({ kind: "home" })} />;
  }

  return (
    <section className="stack">
      <div className="segmented" role="group" aria-label="Choose a script">
        {(Object.keys(SCRIPT_LABELS) as Script[]).map((option) => (
          <button
            key={option}
            aria-pressed={script === option}
            className={script === option ? "segment segment-on" : "segment"}
            onClick={() => setScript(option)}
          >
            <span lang="ja" aria-hidden="true">{SCRIPT_LABELS[option].sample}</span> {SCRIPT_LABELS[option].name}
          </button>
        ))}
      </div>

      <button className="primary" onClick={start} disabled={starting}>
        {starting ? "Starting…" : `Practice ${SCRIPT_LABELS[script].name}`}
      </button>
      {startError && <p className="error" role="alert">{startError}</p>}

      <KanaProgress key={script} script={script} />
    </section>
  );
}

function KanaProgress({ script }: { script: Script }) {
  const [summary, setSummary] = useState<KanaSummary>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .kanaSummary(script)
      .then((result) => active && setSummary(result))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [script]);

  if (failed) return <p className="error" role="alert">Couldn't load your progress.</p>;
  if (!summary) return <p className="muted">Loading progress…</p>;

  return (
    <>
      <dl className="stats">
        <div><dt>Learned</dt><dd>{summary.seen}<small> / {summary.total}</small></dd></div>
        <div><dt>Due now</dt><dd>{summary.due}</dd></div>
        <div><dt>Strong</dt><dd>{summary.strong}</dd></div>
      </dl>

      {(["basic", "dakuten", "combo"] as const).map((group) => (
        <div key={group}>
          <h2 className="group-title">{GROUP_LABELS[group]}</h2>
          <ul className={group === "combo" ? "kana-grid kana-grid-wide" : "kana-grid"}>
            {summary.items
              .filter((item) => item.group === group)
              .map((item) => (
                <li key={item.kana} lang="ja" className={`kana-cell kana-${item.status}`} title={`${item.romaji} (${item.status})`}>
                  {item.kana}
                </li>
              ))}
          </ul>
        </div>
      ))}

      <ul className="legend">
        <li><i className="kana-new" />New</li>
        <li><i className="kana-learning" />Learning</li>
        <li><i className="kana-due" />Due</li>
        <li><i className="kana-strong" />Strong</li>
      </ul>
    </>
  );
}

function Results(props: {
  result: SessionResult;
  starting: boolean;
  startError?: string;
  onAgain(): void;
  onHome(): void;
}) {
  const { result, starting, startError, onAgain, onHome } = props;
  const firstTry = result.total - result.missed.length;
  return (
    <section className="stack results">
      <p className="score">{firstTry}<small> / {result.total}</small></p>
      <p className="muted">right on the first try</p>

      {result.missed.length > 0 && (
        <div>
          <h2 className="group-title">Keep an eye on</h2>
          <ul className="missed">
            {result.missed.map((question) => (
              <li key={question.itemId}>
                <span lang="ja">{question.kana}</span> <small>{question.romaji}</small>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.unsaved > 0 && (
        <p className="error" role="alert">
          {result.unsaved} {result.unsaved === 1 ? "answer" : "answers"} couldn't be saved, so that progress is missing.
        </p>
      )}
      {startError && <p className="error" role="alert">{startError}</p>}

      <button className="primary" onClick={onAgain} disabled={starting}>
        {starting ? "Starting…" : "Practice again"}
      </button>
      <button className="secondary" onClick={onHome}>Done</button>
    </section>
  );
}
