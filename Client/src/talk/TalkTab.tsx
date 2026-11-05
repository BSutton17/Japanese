import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { TalkEngine, type TalkState, type TalkStatus } from "./TalkEngine";

const STATUS_TEXT: Record<TalkStatus, string> = {
  idle: "Ready when you are",
  starting: "Starting your microphone…",
  connecting: "Connecting to Yuki…",
  listening: "Listening",
  speaking: "Yuki is speaking",
  reconnecting: "Reconnecting…",
  ended: "Session saved",
  error: "Something went wrong",
};

const ACTIVE: TalkStatus[] = ["starting", "connecting", "listening", "speaking", "reconnecting"];

function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TalkTab() {
  const [state, setState] = useState<TalkState>();
  const engine = useRef<TalkEngine>(undefined);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  if (!engine.current) engine.current = new TalkEngine(setState);
  useEffect(() => () => void engine.current?.stop(), []);
  // Done when the app opens, so today's topics and her notes are ready before a conversation starts.
  useEffect(() => {
    api.prepareTalk().catch(() => {});
  }, []);

  const status = state?.status ?? "idle";
  const active = ACTIVE.includes(status);
  const turns = state?.turns ?? [];

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  return (
    <section className="stack talk">
      <div className="card talk-card">
        <p className="talk-status" aria-live="polite">{STATUS_TEXT[status]}</p>
        {active && <p className="talk-time">{formatTime(state?.seconds ?? 0)}</p>}

        {active && (
          <div
            className="level-bar"
            role="meter"
            aria-label="Microphone level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((state?.micLevel ?? 0) * 100)}
          >
            <i style={{ width: `${Math.min((state?.micLevel ?? 0) * 100, 100)}%` }} />
          </div>
        )}

        {state?.error && <p className="error" role="alert">{state.error}</p>}

        {active ? (
          <button className="primary" onClick={() => void engine.current?.stop()}>End session</button>
        ) : (
          <button className="primary" onClick={() => void engine.current?.start()}>
            {status === "idle" ? "Start talking" : "Start a new session"}
          </button>
        )}

        {status === "idle" && (
          <p className="fine-print">
            Everything happens by voice. Keep this app open, and wear earbuds if there's a TV or game nearby. Ask anything in English whenever you need to.
          </p>
        )}
        {status === "ended" && (
          <p className="fine-print">
            You talked for {formatTime(state?.seconds ?? 0)}.
          </p>
        )}
      </div>

      {turns.length > 0 && (
        <div className="card">
          <h2 className="group-title">Conversation</h2>
          <ul className="transcript">
            {turns.map((turn, index) => (
              <li key={index} className={`turn turn-${turn.role}`}>
                <span className="turn-who">{turn.role === "tutor" ? "Yuki" : "You"}</span>
                <span>{turn.text}</span>
              </li>
            ))}
          </ul>
          <div ref={transcriptEnd} />
        </div>
      )}

      {state && (
        <details className="diagnostics">
          <summary>Connection details</summary>
          <dl>
            <div><dt>Microphone</dt><dd>{state.diagnostics.mic}</dd></div>
            <div><dt>Mic audio</dt><dd>{state.diagnostics.micDetails}</dd></div>
            <div><dt>Audio</dt><dd>{state.diagnostics.audio}</dd></div>
            <div><dt>Screen stays on</dt><dd>{state.diagnostics.wakeLock}</dd></div>
            <div><dt>Connections</dt><dd>{state.diagnostics.connections}</dd></div>
            <div><dt>Unexpected drops</dt><dd>{state.diagnostics.drops}</dd></div>
            <div><dt>AI plan</dt><dd>{state.diagnostics.plan}</dd></div>
            <div><dt>Tokens used</dt><dd>{state.diagnostics.tokens.toLocaleString()}</dd></div>
            <div><dt>Running as</dt><dd>{state.diagnostics.installed ? "Installed app" : "Browser"}</dd></div>
          </dl>
        </details>
      )}
    </section>
  );
}
