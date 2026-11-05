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

function ReplayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
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

        {active && state?.echoDetected && (
          <p className="fine-print">Yuki was hearing herself through your speakers, so your mic now pauses while she talks. Wait for her to finish before you answer.</p>
        )}

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
                <span className="turn-line">
                  <span>{turn.text}</span>
                  {turn.replayId !== undefined && (
                    <button
                      className="replay"
                      aria-label={state?.replayingId === turn.replayId ? "Stop replay" : "Replay what Yuki said"}
                      aria-pressed={state?.replayingId === turn.replayId}
                      disabled={status === "speaking"}
                      onClick={() => engine.current?.replay(turn.replayId!)}
                    >
                      {state?.replayingId === turn.replayId ? <StopIcon /> : <ReplayIcon />}
                    </button>
                  )}
                </span>
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
            <div><dt>Echo protection</dt><dd>{state.diagnostics.echoProtection}</dd></div>
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
