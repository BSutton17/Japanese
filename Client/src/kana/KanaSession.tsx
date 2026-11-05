import { api, type KanaQuestion } from "../api";
import { useQuiz, type QuizResult } from "../quiz/useQuiz";

const CORRECT_PAUSE_MS = 650;

export function KanaSession(props: {
  questions: KanaQuestion[];
  onFinish(result: QuizResult<KanaQuestion>): void;
  onQuit(): void;
}) {
  const { questions, onFinish, onQuit } = props;
  const quiz = useQuiz({
    questions,
    save: api.saveKanaReview,
    onFinish,
    correctPauseMs: CORRECT_PAUSE_MS,
  });
  const { question, picked, isCorrect } = quiz;

  if (!question || quiz.finishing) return <p className="center muted">Saving your progress…</p>;

  const progress = (
    <div className="session-top">
      <button className="link" onClick={onQuit}>Quit</button>
      <span className="muted" aria-label={`Question ${quiz.index + 1} of ${quiz.length}`}>{quiz.index + 1} / {quiz.length}</span>
    </div>
  );

  if (quiz.needsTeaching) {
    return (
      <section className="stack session">
        {progress}
        <p className="eyebrow">New character</p>
        <p className="prompt" lang="ja">{question.kana}</p>
        <p className="teach-reading">{question.romaji}</p>
        <button className="primary" onClick={quiz.markTaught}>Got it</button>
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
              onClick={() => quiz.pick(option)}
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
              {quiz.comesBack && " It'll come back at the end."}
            </p>
            <button className="primary" onClick={quiz.advance}>Next</button>
          </>
        )}
      </div>
    </section>
  );
}
