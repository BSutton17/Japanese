import { useEffect, useRef, useState } from "react";

export interface QuizItem {
  itemId: string;
  direction: string;
  isNew: boolean;
  answer: string;
}

export interface QuizResult<Q> {
  total: number;
  firstTryCorrect: number;
  missed: Q[];
  unsaved: number;
}

/** Runs a multiple-choice session: saves each answer and brings missed questions back once at the end. */
export function useQuiz<Q extends QuizItem>(options: {
  questions: Q[];
  save(itemId: string, correct: boolean): Promise<unknown>;
  onFinish(result: QuizResult<Q>): void;
  correctPauseMs: number;
}) {
  const { questions, save, onFinish, correctPauseMs } = options;
  const [queue, setQueue] = useState(questions);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string>();
  const [taught, setTaught] = useState<ReadonlySet<string>>(new Set());
  const [finishing, setFinishing] = useState(false);

  const firstTryMisses = useRef(0);
  const requeued = useRef(new Set<string>());
  const missed = useRef(new Map<string, Q>());
  const pendingSaves = useRef<Promise<boolean>[]>([]);

  const question = queue[index];
  const isOriginal = index < questions.length;
  const isCorrect = picked !== undefined && picked === question?.answer;

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
        firstTryCorrect: questions.length - firstTryMisses.current,
        missed: [...missed.current.values()],
        unsaved: saves.filter((saved) => !saved).length,
      });
    });
  };

  useEffect(() => {
    if (!isCorrect) return;
    const timer = setTimeout(advance, correctPauseMs);
    return () => clearTimeout(timer);
  });

  const pick = (option: string) => {
    if (picked !== undefined || !question) return;
    setPicked(option);
    const correct = option === question.answer;
    pendingSaves.current.push(
      save(question.itemId, correct).then(
        () => true,
        () => false,
      ),
    );
    if (correct) return;

    if (isOriginal) firstTryMisses.current++;
    if (!missed.current.has(question.itemId)) missed.current.set(question.itemId, question);
    const key = `${question.itemId}:${question.direction}`;
    if (!requeued.current.has(key)) {
      requeued.current.add(key);
      setQueue((current) => [...current, { ...question, isNew: false }]);
    }
  };

  return {
    question,
    index,
    length: queue.length,
    picked,
    pick,
    advance,
    isCorrect,
    // Only a first miss sends a question to the end, so a miss on the retry doesn't promise another.
    comesBack: isOriginal,
    needsTeaching: Boolean(question?.isNew && !taught.has(question.itemId)),
    markTaught: () => question && setTaught(new Set(taught).add(question.itemId)),
    finishing,
  };
}
