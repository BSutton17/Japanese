import { useEffect } from "react";
import { api, type VocabQuestion } from "../api";
import { useQuiz, type QuizResult } from "../quiz/useQuiz";
import { getSettings } from "../settings";
import { speakJapanese, stopSpeaking } from "../speech";
import { FuriganaText, WordWithReading } from "./JapaneseText";

const CORRECT_PAUSE_MS = 900;

export function VocabSession(props: {
  questions: VocabQuestion[];
  onFinish(result: QuizResult<VocabQuestion>): void;
  onQuit(): void;
}) {
  const { questions, onFinish, onQuit } = props;
  const quiz = useQuiz({
    questions,
    save: api.saveVocabReview,
    onFinish,
    correctPauseMs: CORRECT_PAUSE_MS,
    // The reading rather than the written word, because a device's voice can guess a kanji wrong.
    onAnswered: (answered) => (getSettings().readAloud ? speakJapanese(answered.reading) : undefined),
  });
  useEffect(() => stopSpeaking, []);
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
        <p className="eyebrow">New word</p>
        <p className="word-prompt"><WordWithReading word={question.word} reading={question.reading} /></p>
        <p className="word-romaji muted">{question.romaji}</p>
        <p className="teach-meaning">{question.gloss}</p>
        {question.example && (
          <div className="example">
            <p className="example-ja"><FuriganaText text={question.example.furigana} /></p>
            <p className="muted">{question.example.en}</p>
          </div>
        )}
        <button className="primary" onClick={quiz.markTaught}>Got it</button>
      </section>
    );
  }

  const asksEnglish = question.direction === "ja-to-en";
  return (
    <section className="stack session">
      {progress}
      <p className="eyebrow">{asksEnglish ? "What does this mean?" : "Which word means this?"}</p>
      {asksEnglish ? (
        <p className="word-prompt">
          <WordWithReading word={question.word} reading={question.showReading ? question.reading : undefined} />
        </p>
      ) : (
        <p className="meaning-prompt">{question.gloss}</p>
      )}

      <div className="options options-single">
        {question.options.map((option) => {
          const state =
            picked === undefined ? "" : option.text === question.answer ? " option-right" : option.text === picked ? " option-wrong" : " option-dim";
          return (
            <button
              key={option.text}
              className={`option option-word${asksEnglish ? "" : " option-japanese"}${state}`}
              onClick={() => quiz.pick(option.text)}
              disabled={picked !== undefined}
            >
              {asksEnglish ? option.text : <WordWithReading word={option.text} reading={option.reading} />}
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="feedback">
        {picked !== undefined && (
          <p className={isCorrect ? "right-text" : "wrong-text"}>
            <span lang="ja">{question.word}</span>
            {question.word !== question.reading && <> (<span lang="ja">{question.reading}</span>)</>}
            {", "}{question.romaji}: <strong>{question.gloss}</strong>.
            {!isCorrect && quiz.comesBack && " It'll come back at the end."}
          </p>
        )}
        {picked !== undefined && !isCorrect && (
          <button className="primary" onClick={quiz.advance}>Next</button>
        )}
      </div>
    </section>
  );
}
