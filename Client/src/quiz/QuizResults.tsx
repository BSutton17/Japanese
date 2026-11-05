import type { ReactNode } from "react";

export function QuizResults(props: {
  total: number;
  firstTryCorrect: number;
  unsaved: number;
  error?: string;
  missed?: ReactNode;
  children: ReactNode;
}) {
  const { total, firstTryCorrect, unsaved, error, missed, children } = props;
  return (
    <section className="stack results">
      <p className="score">{firstTryCorrect}<small> / {total}</small></p>
      <p className="muted">right on the first try</p>

      {missed && (
        <div>
          <h2 className="group-title">Keep an eye on</h2>
          {missed}
        </div>
      )}

      {unsaved > 0 && (
        <p className="error" role="alert">
          {unsaved} {unsaved === 1 ? "answer" : "answers"} couldn't be saved, so that progress is missing.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      {children}
    </section>
  );
}
