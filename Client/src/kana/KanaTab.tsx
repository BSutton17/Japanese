import { useEffect, useState } from "react";
import { api, type KanaQuestion, type KanaRowSummary, type KanaSelection, type KanaSummary, type Script } from "../api";
import { QuizResults } from "../quiz/QuizResults";
import type { QuizResult } from "../quiz/useQuiz";
import { KanaSession } from "./KanaSession";

const SCRIPT_LABELS: Record<Script, { name: string; sample: string }> = {
  hiragana: { name: "Hiragana", sample: "あ" },
  katakana: { name: "Katakana", sample: "ア" },
};

const GROUPS = [
  { id: "basic", label: "Basic" },
  { id: "dakuten", label: "Voiced" },
  { id: "combo", label: "Combinations" },
] as const;

type View =
  | { kind: "home" }
  | { kind: "session"; selection: KanaSelection; questions: KanaQuestion[] }
  | { kind: "results"; selection: KanaSelection; result: QuizResult<KanaQuestion> };

export function KanaTab() {
  const [script, setScript] = useState<Script>("hiragana");
  const [view, setView] = useState<View>({ kind: "home" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  const start = async (selection: KanaSelection) => {
    setStarting(true);
    setStartError(undefined);
    try {
      const { questions } = await api.kanaSession(script, selection);
      setView({ kind: "session", selection, questions });
    } catch {
      setStartError("Couldn't start the session. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  };

  const startNextRow = async () => {
    setStarting(true);
    setStartError(undefined);
    try {
      const { nextRowId } = await api.kanaSummary(script);
      if (nextRowId) {
        await start({ mode: "row", rowId: nextRowId });
      } else {
        setView({ kind: "home" });
      }
    } catch {
      setStartError("Couldn't start the next row. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  };

  if (view.kind === "session") {
    return (
      <KanaSession
        key={JSON.stringify(view.selection)}
        questions={view.questions}
        onFinish={(result) => setView({ kind: "results", selection: view.selection, result })}
        onQuit={() => setView({ kind: "home" })}
      />
    );
  }

  if (view.kind === "results") {
    const { result, selection } = view;
    return (
      <QuizResults
        total={result.total}
        firstTryCorrect={result.firstTryCorrect}
        unsaved={result.unsaved}
        error={startError}
        missed={
          result.missed.length > 0 && (
            <ul className="missed">
              {result.missed.map((question) => (
                <li key={question.itemId}>
                  <span lang="ja">{question.kana}</span> <small>{question.romaji}</small>
                </li>
              ))}
            </ul>
          )
        }
      >
        {selection.mode === "row" ? (
          <>
            <button className="primary" onClick={() => void startNextRow()} disabled={starting}>
              {starting ? "Starting…" : "Next row"}
            </button>
            <button className="secondary" onClick={() => void start(selection)} disabled={starting}>
              Practice this row again
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => void start(selection)} disabled={starting}>
            {starting ? "Starting…" : "Practice again"}
          </button>
        )}
        <button className="secondary" onClick={() => setView({ kind: "home" })}>Done</button>
      </QuizResults>
    );
  }

  return (
    <section className="stack">
      <div className="segmented" role="group" aria-label="Choose a script">
        {(Object.keys(SCRIPT_LABELS) as Script[]).map((option) => (
          <button
            key={option}
            aria-pressed={script === option}
            className={script === option ? "segment segment-on" : "segment"}
            onClick={() => {
              setScript(option);
              setStartError(undefined);
            }}
          >
            <span lang="ja" aria-hidden="true">{SCRIPT_LABELS[option].sample}</span> {SCRIPT_LABELS[option].name}
          </button>
        ))}
      </div>

      {startError && <p className="error" role="alert">{startError}</p>}

      <KanaHome key={script} script={script} starting={starting} onStart={(selection) => void start(selection)} />
    </section>
  );
}

function KanaHome(props: { script: Script; starting: boolean; onStart(selection: KanaSelection): void }) {
  const { script, starting, onStart } = props;
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

  const nextRow = summary.rows.find((row) => row.id === summary.nextRowId);

  return (
    <>
      {nextRow && (
        <button
          className="primary"
          onClick={() => onStart({ mode: "row", rowId: nextRow.id })}
          disabled={starting}
        >
          Learn next row: <span lang="ja">{nextRow.items.map((item) => item.kana).join(" ")}</span>
        </button>
      )}

      <div className="button-pair">
        <button className="secondary" onClick={() => onStart({ mode: "all" })} disabled={starting}>
          All at once
        </button>
        <button className="secondary" onClick={() => onStart({ mode: "review" })} disabled={starting || summary.due === 0}>
          Review{summary.due > 0 ? ` (${summary.due} due)` : ""}
        </button>
      </div>

      <dl className="stats">
        <div><dt>Learned</dt><dd>{summary.seen}<small> / {summary.total}</small></dd></div>
        <div><dt>Due now</dt><dd>{summary.due}</dd></div>
        <div><dt>Strong</dt><dd>{summary.strong}</dd></div>
      </dl>

      <p className="muted hint">Tap a row to practice just that row.</p>

      {GROUPS.map((group) => (
        <div key={group.id}>
          <h2 className="group-title">{group.label}</h2>
          <ul className="row-list">
            {summary.rows
              .filter((row) => row.group === group.id)
              .map((row) => (
                <li key={row.id}>
                  <RowButton row={row} disabled={starting} onClick={() => onStart({ mode: "row", rowId: row.id })} />
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

function RowButton(props: { row: KanaRowSummary; disabled: boolean; onClick(): void }) {
  const { row, disabled, onClick } = props;
  return (
    <button
      className={row.group === "combo" ? "row-button row-button-wide" : "row-button"}
      onClick={onClick}
      disabled={disabled}
      aria-label={`Practice the ${row.items.map((item) => item.romaji).join(", ")} row`}
    >
      {row.items.map((item) => (
        <span key={item.kana} lang="ja" className={`kana-cell kana-${item.status}`}>{item.kana}</span>
      ))}
    </button>
  );
}
