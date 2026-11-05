import { useEffect, useState } from "react";
import { api, type AbilityDescription, type ProgressReport } from "../api";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function levelName(description: AbilityDescription): string {
  return description.reached ?? "Below N5";
}

function levelCaption({ next, percentToNext }: AbilityDescription): string {
  return next ? `${percentToNext}% of the way to ${next}` : "You've reached the top level";
}

function heatStep(answers: number): number {
  if (answers === 0) return 0;
  if (answers < 10) return 1;
  if (answers < 30) return 2;
  if (answers < 60) return 3;
  return 4;
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function dayReadout(day: ProgressReport["calendar"][number]): string {
  const answers = `${day.answers} ${day.answers === 1 ? "answer" : "answers"}`;
  return `${formatDate(day.date)}: ${day.frozen ? "covered by a streak freeze" : answers}`;
}

export function ProgressTab() {
  const [report, setReport] = useState<ProgressReport>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .progress()
      .then((result) => active && setReport(result))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed) return <p className="error" role="alert">Couldn't load your progress. Check your connection and try again.</p>;
  if (!report) return <p className="muted">Loading progress…</p>;

  return (
    <section className="stack">
      <LevelCard report={report} />
      <StreakCard report={report} />
      <ActivityCard report={report} />
      <VocabularyCard report={report} />
      <dl className="stats">
        <div><dt>Answers today</dt><dd>{report.today.answers}</dd></div>
        <div>
          <dt>Right today</dt>
          <dd>{report.today.answers > 0 ? `${Math.round((report.today.correct / report.today.answers) * 100)}%` : "–"}</dd>
        </div>
        <div><dt>All answers</dt><dd>{report.totalAnswers.toLocaleString()}</dd></div>
      </dl>
      <KanaCard report={report} />
    </section>
  );
}

function LevelCard({ report }: { report: ProgressReport }) {
  const { level, peak, comeback } = report;
  const belowPeak = peak.ability > level.ability;
  return (
    <div className="card">
      <h2 className="group-title">Your level</h2>
      <p className="hero-figure">{levelName(level)}</p>
      <p className="hero-caption">{levelCaption(level)}</p>
      {comeback.active && (
        <p className="note">
          Welcome back. After {comeback.daysAway} days away, things start a little easier. Your peak is saved, and
          strong answers will get you back there quickly.
        </p>
      )}
      {belowPeak && (
        <p className="fine-print">
          Your peak: {levelName(peak)}. {levelCaption(peak)}.
        </p>
      )}
      <p className="fine-print">An estimate from the vocabulary you remember right now. N-levels are unofficial.</p>
    </div>
  );
}

function StreakCard({ report }: { report: ProgressReport }) {
  const { current, longest, freezes, practicedToday } = report.streak;
  const encouragement = practicedToday
    ? "Today counts. Nice work."
    : current > 0
      ? "Answer anything today to keep it going."
      : "Answer anything today to start one.";
  return (
    <div className="card">
      <h2 className="group-title">Streak</h2>
      <p className="streak-hero">
        <strong className="hero-figure">{current}</strong>
        <span>{current === 1 ? "day" : "days"} in a row</span>
      </p>
      <p className="hero-caption">{encouragement}</p>
      <p className="fine-print">
        Longest: {longest} {longest === 1 ? "day" : "days"}. Streak freezes: {freezes}. Every 7 days earns one, and it
        covers a missed day automatically.
      </p>
    </div>
  );
}

function ActivityCard({ report }: { report: ProgressReport }) {
  const { calendar } = report;
  const today = calendar.at(-1)!;
  const [selected, setSelected] = useState(today.date);
  const selectedDay = calendar.find((day) => day.date === selected) ?? today;

  // Lines the first day up under its weekday, so each column is a real day of the week.
  const [year, month, day] = calendar[0]!.date.split("-").map(Number) as [number, number, number];
  const offset = new Date(year, month - 1, day).getDay();

  return (
    <div className="card">
      <h2 className="group-title">Last 4 weeks</h2>
      <div className="calendar-head" aria-hidden="true">
        {WEEKDAYS.map((weekday, index) => <span key={index}>{weekday}</span>)}
      </div>
      <div className="calendar" role="group" aria-label="Answers per day. Select a day to read its count.">
        {Array.from({ length: offset }, (_, index) => <span key={index} aria-hidden="true" />)}
        {calendar.map((entry) => (
          <button
            key={entry.date}
            className={[
              "calendar-cell",
              entry.frozen ? "frozen" : `heat-${heatStep(entry.answers)}`,
              entry.date === selected ? "selected" : "",
            ].join(" ")}
            aria-label={dayReadout(entry)}
            aria-pressed={entry.date === selected}
            onClick={() => setSelected(entry.date)}
          >
            {Number(entry.date.slice(8))}
          </button>
        ))}
      </div>
      <p className="calendar-readout" aria-live="polite">{dayReadout(selectedDay)}</p>
      <div className="scale" aria-hidden="true">
        <span>Fewer answers</span>
        {[0, 1, 2, 3, 4].map((step) => <i key={step} style={{ background: `var(--heat-${step})` }} />)}
        <span>More</span>
        <i className="scale-gap calendar-cell frozen" />
        <span>Streak freeze</span>
      </div>
    </div>
  );
}

function VocabularyCard({ report }: { report: ProgressReport }) {
  const { levels, peak } = report;
  const peakRow = Math.min(Math.floor(peak.ability), levels.length - 1);
  const peakWithinRow = peak.ability - peakRow;
  return (
    <div className="card">
      <h2 className="group-title">Words you remember</h2>
      <ul className="level-rows">
        {levels.map((level, index) => (
          <li key={level.level} className="level-row">
            <div className="level-head">
              <span className="level-name">{level.level}</span>
              <span className="muted">{level.remembered.toLocaleString()} of {level.total.toLocaleString()}</span>
            </div>
            <div
              className="level-bar"
              role="progressbar"
              aria-label={`Progress toward ${level.level}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level.progress * 100)}
            >
              <i style={{ width: `${level.progress * 100}%` }} />
              {index === peakRow && peakWithinRow > level.progress && (
                <i className="peak-tick" title="Your peak" style={{ left: `${peakWithinRow * 100}%` }} />
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="fine-print">A full bar means you remember enough of that level's words to count as reaching it. The rarest words aren't required. A black mark shows your peak.</p>
    </div>
  );
}

function KanaCard({ report }: { report: ProgressReport }) {
  return (
    <div className="card">
      <h2 className="group-title">Kana learned</h2>
      <ul className="level-rows">
        {report.kana.map((kana) => (
          <li key={kana.script} className="level-row">
            <div className="level-head">
              <span className="level-name">{kana.script}</span>
              <span className="muted">{kana.learned} of {kana.total}</span>
            </div>
            <div
              className="level-bar"
              role="progressbar"
              aria-label={`${kana.script} learned`}
              aria-valuemin={0}
              aria-valuemax={kana.total}
              aria-valuenow={kana.learned}
            >
              <i style={{ width: `${(kana.learned / kana.total) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
