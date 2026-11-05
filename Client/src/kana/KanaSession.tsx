import { useEffect, useRef, useState } from "react";
import { api, type KanaQuestion } from "../api";

export interface SessionResult {
  total: number;
  missed: KanaQuestion[];
  unsaved: number;
}

const CORRECT_PAUSE_MS = 650;

export function KanaSession(props: {
  questions: KanaQuestion[];
  onFinish(result: SessionResult): void;
  onQuit(): void;
}) {
  const { questions, onFinish, onQuit } = props;
  // Missed characters come back once at the end of the session.
  const [queue, setQueue] = useState(questions);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string>();
  const [taught, setTaught] = useState<ReadonlySet<string>>(new Set());
  const [finishing, setFinishing] = useState(false);

  const missed = useRef(new Map<string, KanaQuestion>());
  const pendingSaves = useRef<Promise<boolean>[]>([]);

  const question = queue[index];

  const advance = () => {
    setPicked(undefined);
    if (index + 1 < queue.length) {
      setIndex(index + 1);
      return;
    }
    setFinishing(true);
    void Promise.all(pendingSaves.current).then((saves) => {
      onFinish({
        total: questions.length,
        missed: [...missed.current.values()],
        unsaved: saves.filter((saved) => !saved).length,
      });
    });
  };

  const isCorrect = picked !== undefined && picked === question?.answer;

  useEffect(() => {
    if (!isCorrect) return;
    const timer = setTimeout(advance, CORRECT_PAUSE_MS);
    return () => clearTimeout(timer);
  });

  if (!question || finishing) return <p className="center muted">Saving your progress…</p>;

  const pick = (option: string) => {
    if (picked !== undefined) return;
    setPicked(option);
    const correct = option === question.answer;
    pendingSaves.current.push(
      api.saveKanaReview(question.itemId, correct).then(
        () => true,
        () => false,
      ),
    );
    if (!correct && !missed.current.has(question.itemId)) {
      missed.current.set(question.itemId, question);
      setQueue((current) => [...current, { ...question, isNew: false }]);
    }
  };

  const progress = (
    <div className="session-top">
      <button className="link" onClick={onQuit}>Quit</button>
      <span className="muted" aria-label={`Question ${index + 1} of ${queue.length}`}>{index + 1} / {queue.length}</span>
    </div>
  );

  if (question.isNew && !taught.has(question.itemId)) {
    return (
      <section className="stack session">
        {progress}
        <p className="eyebrow">New character</p>
        <p className="prompt" lang="ja">{question.kana}</p>
        <p className="teach-reading">{question.romaji}</p>
        <button className="primary" onClick={() => setTaught(new Set(taught).add(question.itemId))}>
          Got it
        </button>
      </section>
    );
  }

  const asksReading = question.direction === "kana-to-romaji";
  return (
    <section className="stack session">
      {progress}
      <p className="eyebrow">{asksReading ? "How is this read?" : "Which character is this?"}</p>
      <p className={asksReading ? "prompt" : "prompt prompt-latin"} lang={asksReading ? "ja" : "en"}>
        {asksReading ? question.kana : question.romaji}
      </p>

      <div className="options">
        {question.options.map((option) => {
          const state =
            picked === undefined ? "" : option === question.answer ? " option-right" : option === picked ? " option-wrong" : " option-dim";
          return (
            <button
              key={option}
              className={`option${asksReading ? "" : " option-kana"}${state}`}
              lang={asksReading ? "en" : "ja"}
              onClick={() => pick(option)}
              disabled={picked !== undefined}
            >
              {option}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="feedback">
        {isCorrect && <p className="right-text">Correct</p>}
        {picked !== undefined && !isCorrect && (
          <>
            <p className="wrong-text">
              <span lang="ja">{question.kana}</span> is read <strong>{question.romaji}</strong>.
              {index < questions.length && " It'll come back at the end."}
            </p>
            <button className="primary" onClick={advance}>Next</button>
          </>
        )}
      </div>
    </section>
  );
}
