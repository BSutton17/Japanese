import { useEffect, useRef, useState } from "react";
import { api, type AiPlan, type TalkPlanReport, type TutorMemory } from "./api";
import { getSettings, saveSettings, type Settings } from "./settings";
import { hasJapaneseVoice, speakJapanese } from "./speech";

const PLAN_NOTES: Record<AiPlan, string> = {
  paid: "Google doesn't use your conversations to improve its products. You pay for what you use.",
  free: "No charge, but Google may use your conversations to improve its products, and people may review them.",
};

function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function ToggleRow({ title, note, checked, onChange }: { title: string; note: string; checked: boolean; onChange(checked: boolean): void }) {
  return (
    <label className="setting-row">
      <span>
        <strong>{title}</strong>
        <small>{note}</small>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function PlanSection() {
  const [report, setReport] = useState<TalkPlanReport>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    api.talkPlan().then(
      (loaded) => active && setReport(loaded),
      () => active && setError("Couldn't load your AI plan."),
    );
    return () => {
      active = false;
    };
  }, []);

  const choose = (plan: AiPlan) => {
    if (!report || plan === report.plan) return;
    setError(undefined);
    api.saveTalkPlan(plan).then(
      () => setReport({ ...report, plan }),
      () => setError("Couldn't change your AI plan. Try again."),
    );
  };

  if (!report) return error ? <p className="error" role="alert">{error}</p> : <p className="fine-print">Loading your AI plan…</p>;

  const missing = (["free", "paid"] as const).find((plan) => !report.available[plan]);
  const { spent, budget } = report.month;
  return (
    <section className="setting-section">
      <strong id="plan-label">AI plan</strong>
      <div className="segmented" role="group" aria-labelledby="plan-label">
        {(["free", "paid"] as const).map((plan) => (
          <button
            key={plan}
            className={`segment${report.plan === plan ? " segment-on" : ""}`}
            aria-pressed={report.plan === plan}
            disabled={!report.available[plan]}
            onClick={() => choose(plan)}
          >
            {plan === "free" ? "Free" : "Paid"}
          </button>
        ))}
      </div>
      <p className="fine-print">{PLAN_NOTES[report.plan]} A change starts with your next conversation.</p>
      {missing && (
        <p className="fine-print">The {missing} AI isn't set up yet, because it needs its own key from a separate Google project.</p>
      )}
      {report.available.paid && (
        <p className="fine-print">
          Paid use this month: about {formatDollars(spent)} of your {formatDollars(budget)} limit. This is an estimate, and Google's usage page has the real bill.
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

function MemorySection() {
  const [memory, setMemory] = useState<TutorMemory>();
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    api.tutorMemory().then(
      (loaded) => active && setMemory(loaded),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, []);

  if (failed) return <p className="error" role="alert">Couldn't load what Yuki remembers.</p>;
  if (!memory) return null;

  const notes = [...memory.facts, ...memory.followUps, ...memory.struggles];
  const forget = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    api.forgetTutorMemory().then(
      () => setMemory({ speakingLevel: null, lastConversation: null, facts: [], struggles: [], followUps: [] }),
      () => setFailed(true),
    );
  };

  return (
    <section className="setting-section">
      <strong>What Yuki remembers</strong>
      {notes.length === 0 && !memory.lastConversation && !memory.speakingLevel ? (
        <p className="fine-print">Nothing yet. She takes notes after each conversation.</p>
      ) : (
        <>
          {memory.speakingLevel && <p className="fine-print">She thinks you speak at about {memory.speakingLevel}.</p>}
          {memory.lastConversation && <p className="fine-print">Last time: {memory.lastConversation.text}</p>}
          {notes.length > 0 && (
            <ul className="memory-list">
              {notes.map((note) => <li key={note.text}>{note.text}</li>)}
            </ul>
          )}
          <button className="secondary" onClick={forget}>{confirming ? "Tap again to forget everything" : "Forget everything"}</button>
        </>
      )}
    </section>
  );
}

export function SettingsPanel({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState(getSettings);
  const [voiceMissing, setVoiceMissing] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    let active = true;
    void hasJapaneseVoice().then((found) => active && setVoiceMissing(!found));
    return () => {
      active = false;
    };
  }, []);

  const change = (changes: Partial<Settings>) => {
    const next = { ...settings, ...changes };
    setSettings(next);
    saveSettings(next);
  };

  return (
    <dialog ref={dialog} className="settings" aria-labelledby="settings-title" onClose={onClose}>
      <h2 id="settings-title">Settings</h2>

      <PlanSection />

      <ToggleRow
        title="Offer topics when it's quiet"
        note="If you go quiet in Talk, Yuki suggests something to talk about, twice at most."
        checked={settings.offerTopics}
        onChange={(offerTopics) => change({ offerTopics })}
      />
      <ToggleRow
        title="Car or speakers"
        note="Always pauses your mic while Yuki talks, so her voice or a TV can't set her off. You can't interrupt her. If this is off, the app turns it on by itself when it notices an echo."
        checked={settings.noisyRoom}
        onChange={(noisyRoom) => change({ noisyRoom })}
      />

      <MemorySection />

      <ToggleRow
        title="Read words aloud"
        note="In Vocab, hear each Japanese word after you answer."
        checked={settings.readAloud}
        onChange={(readAloud) => change({ readAloud })}
      />

      <button className="secondary" onClick={() => void speakJapanese("こんにちは")}>Test the voice</button>
      {voiceMissing && (
        <p className="error" role="alert">This device doesn't seem to have a Japanese voice, so words may not play.</p>
      )}
      <p className="fine-print">If you don't hear anything on an iPhone, check that its silent switch is off.</p>

      <button className="primary" onClick={onClose}>Done</button>
    </dialog>
  );
}
