import { useEffect, useState } from "react";
import { api, type VocabQuestion, type VocabSessionType, type VocabSummary } from "../api";
import { QuizResults } from "../quiz/QuizResults";
import type { QuizResult } from "../quiz/useQuiz";
import { VocabSession } from "./VocabSession";

type View =
  | { kind: "home" }
  | { kind: "session"; type: VocabSessionType; questions: VocabQuestion[] }
  | { kind: "results"; type: VocabSessionType; result: QuizResult<VocabQuestion> };

export function VocabTab() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();

  const start = async (type: VocabSessionType) => {
    setStarting(true);
    setStartError(undefined);
    try {
      const { questions } = await api.vocabSession(type);
      if (questions.length === 0) {
        setStartError(type === "review" ? "Nothing is due right now." : "You've studied every word.");
        setView({ kind: "home" });
      } else {
        setView({ kind: "session", type, questions });
      }
    } catch {
      setStartError("Couldn't start the session. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  };

  if (view.kind === "session") {
    return (
      <VocabSession
        questions={view.questions}
        onFinish={(result) => setView({ kind: "results", type: view.type, result })}
        onQuit={() => setView({ kind: "home" })}
      />
    );
  }

  if (view.kind === "results") {
    const { result, type } = view;
    return (
      <QuizResults
        total={result.total}
        firstTryCorrect={result.firstTryCorrect}
        unsaved={result.unsaved}
        error={startError}
        missed={
          result.missed.length > 0 && (
            <ul className="missed missed-words">
              {result.missed.map((question) => (
                <li key={question.itemId}>
                  <span lang="ja">{question.word}</span> <small>{question.gloss}</small>
                </li>
              ))}
            </ul>
          )
        }
      >
        <button className="primary" onClick={() => void start(type)} disabled={starting}>
          {starting ? "Starting…" : type === "new" ? "Learn more words" : "Keep reviewing"}
        </button>
        <button className="secondary" onClick={() => setView({ kind: "home" })}>Done</button>
      </QuizResults>
    );
  }

  return (
    <section className="stack">
      {startError && <p className="error" role="alert">{startError}</p>}

      <VocabHome starting={starting} onStart={(type) => void start(type)} />
    </section>
  );
}

function VocabHome({ starting, onStart }: { starting: boolean; onStart(type: VocabSessionType): void }) {
  const [summary, setSummary] = useState<VocabSummary>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .vocabSummary()
      .then((result) => active && setSummary(result))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed) return <p className="error" role="alert">Couldn't load your progress.</p>;
  if (!summary) return <p className="muted">Loading progress…</p>;

  return (
    <>
      {summary.easingBack && (
        <p className="note">Welcome back. New words stay small for now while you ease back in.</p>
      )}
      {summary.nextBatch > 0 && (
        <button className="primary" onClick={() => onStart("new")} disabled={starting}>
          Learn {summary.nextBatch} new words
        </button>
      )}
      <button className="secondary" onClick={() => onStart("review")} disabled={starting || summary.due === 0}>
        {summary.due > 0 ? `Review (${summary.due} due)` : "Nothing to review yet"}
      </button>

      <div>
        <h2 className="group-title">Words by level</h2>
        <ul className="level-list">
          {summary.levels.map((level) => (
            <li key={level.level} className={level.level === summary.currentLevel ? "level level-current" : "level"}>
              <div className="level-head">
                <span className="level-name">{level.level}</span>
                <span className="muted">{level.seen} / {level.total}</span>
              </div>
              <div
                className="level-bar"
                role="progressbar"
                aria-label={`${level.level} words studied`}
                aria-valuemin={0}
                aria-valuemax={level.total}
                aria-valuenow={level.seen}
              >
                <i style={{ width: `${(level.seen / level.total) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="credit">
        Word data from <a href="https://github.com/evanclan/OpenJLPT">OpenJLPT</a> (
        <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>), using JMdict (EDRDG), Jonathan Waller's JLPT lists, and Tatoeba. Frequency from <a href="https://github.com/naist-nlp/tubelex">TUBELEX</a>. Levels are unofficial.
      </p>
    </>
  );
}
