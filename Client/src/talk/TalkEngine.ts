import { api, ApiError, localDate, type AiPlan, type TalkTurn, type TalkUsage } from "../api";
import { getSettings } from "../settings";
import { AudioPlayer, MicCapture, bytesToBase64 } from "./audio";

export type TalkStatus = "idle" | "starting" | "connecting" | "listening" | "speaking" | "reconnecting" | "ended" | "error";

export interface TalkDiagnostics {
  mic: string;
  micDetails: string;
  audio: string;
  wakeLock: string;
  connections: number;
  drops: number;
  tokens: number;
  installed: boolean;
  plan: string;
}

export interface TalkState {
  status: TalkStatus;
  turns: TalkTurn[];
  micLevel: number;
  seconds: number;
  error?: string;
  /** The line being replayed right now. */
  replayingId?: number;
  diagnostics: TalkDiagnostics;
}

// The SDK's session and messages, narrowed to the parts used here.
interface LiveSession {
  close(): void;
  sendRealtimeInput(input: { audio: { data: string; mimeType: string } } | { text: string }): void;
  sendClientContent(input: { turns: { role: string; parts: { text: string }[] }[]; turnComplete: boolean }): void;
}

interface LiveMessage {
  sessionResumptionUpdate?: { resumable?: boolean; newHandle?: string };
  goAway?: unknown;
  usageMetadata?: {
    promptTokenCount?: number;
    totalTokenCount?: number;
    thoughtsTokenCount?: number;
    promptTokensDetails?: { modality?: string; tokenCount?: number }[];
    responseTokensDetails?: { modality?: string; tokenCount?: number }[];
  };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
  };
}

const SAVE_EVERY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 6;
const GO_AWAY_GRACE_MS = 5_000;
// A new connection gets this much of the conversation back, when it can't resume.
const HISTORY_TURNS = 30;
// Gemini sometimes writes notes like "<no speech>" or "{pause}" into its transcript.
const STAGE_DIRECTIONS = /<[^<>]*>|\{[^{}]*\}/g;
// Every turn is charged for the whole conversation so far, and audio costs far more than text. Past
// this size, a new connection carries the conversation over as text, which is a fraction of the price.
const CONTEXT_REFRESH_TOKENS = 5000;
// The SDK waits forever if a connection closes before it opens, so this bounds that wait.
const CONNECT_TIMEOUT_MS = 15_000;
// How long a silence lasts before Yuki offers something to talk about. Then she leaves them be.
const QUIET_NUDGES_MS = [20_000, 60_000];
// Her audio is about 50 KB a second, so only her most recent lines can be replayed.
const MAX_RECORDINGS = 40;
// The server's answer when a plan isn't set up or is over its limit, which retrying can't fix.
const STATUS_CONFLICT = 409;

function tokensOf(details: { modality?: string; tokenCount?: number }[] | undefined, modality: string): number {
  return (details ?? []).filter((part) => part.modality === modality).reduce((sum, part) => sum + (part.tokenCount ?? 0), 0);
}

function installedAsApp(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function micErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Microphone access is blocked. Allow it in your browser's settings, then try again.";
  if (name === "NotFoundError") return "No microphone was found.";
  return "The microphone couldn't start. Close other apps using it, then try again.";
}

/** Runs one conversation: microphone, Gemini connection, playback, reconnects, and saving. */
export class TalkEngine {
  private state: TalkState = {
    status: "idle",
    turns: [],
    micLevel: 0,
    seconds: 0,
    diagnostics: { mic: "off", micDetails: "off", audio: "off", wakeLock: "off", connections: 0, drops: 0, tokens: 0, installed: installedAsApp(), plan: "not started" },
  };
  private context?: AudioContext;
  private mic?: MicCapture;
  private player?: AudioPlayer;
  private session?: LiveSession;
  private wakeLock?: WakeLockSentinel;
  private handle?: string;
  private sessionId = "";
  private startedAt = new Date();
  private stopped = true;
  private reconnectAttempts = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private goAwayTimer?: ReturnType<typeof setTimeout>;
  private leavingConnection = false;
  private clock?: ReturnType<typeof setInterval>;
  private saver?: ReturnType<typeof setInterval>;
  private lastSaved = "";
  private plan?: AiPlan;
  private usage: TalkUsage = { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 };
  private quietPrompt = "";
  private lastActivityAt = 0;
  private quietNudges = 0;
  private contextTokens = 0;
  /** So what's said next starts its own line, even from the same speaker. */
  private turnEnded = false;
  private recordings = new Map<number, string[]>();
  private recordingId?: number;
  private nextRecordingId = 1;
  private replayPlayer?: AudioPlayer;
  /** After a conversation ends its audio is shut down, so replays need their own. */
  private replayContext?: AudioContext;

  constructor(private readonly onChange: (state: TalkState) => void) {}

  private update(changes: Partial<TalkState>): void {
    this.state = { ...this.state, ...changes };
    this.onChange(this.state);
  }

  private diagnose(changes: Partial<TalkDiagnostics>): void {
    this.update({ diagnostics: { ...this.state.diagnostics, ...changes } });
  }

  /** Call this directly from a tap, because phones only allow audio that starts from one. */
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.handle = undefined;
    this.sessionId = crypto.randomUUID();
    this.startedAt = new Date();
    this.reconnectAttempts = 0;
    this.lastSaved = "";
    this.plan = undefined;
    this.usage = { textIn: 0, audioIn: 0, textOut: 0, audioOut: 0 };
    this.quietNudges = 0;
    this.stopReplay();
    void this.replayContext?.close();
    this.replayContext = undefined;
    this.recordings.clear();
    this.recordingId = undefined;
    this.turnEnded = false;
    this.update({
      status: "starting",
      turns: [],
      seconds: 0,
      micLevel: 0,
      error: undefined,
      diagnostics: { mic: "starting", micDetails: "off", audio: "starting", wakeLock: "off", connections: 0, drops: 0, tokens: 0, installed: installedAsApp(), plan: "starting" },
    });

    const context = new AudioContext();
    this.context = context;
    context.onstatechange = () => this.diagnose({ audio: context.state });
    void context.resume();
    this.player = new AudioPlayer(context);
    this.mic = new MicCapture(context, (pcm, peak) => this.onMicChunk(pcm, peak));

    try {
      await this.mic.start();
    } catch (error) {
      this.fail(micErrorMessage(error));
      return;
    }
    if (this.stopped) return;
    this.diagnose({ mic: "live", micDetails: this.mic.details, audio: context.state });

    void this.keepScreenOn();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    window.addEventListener("pagehide", this.onPageHide);
    this.clock = setInterval(() => {
      this.update({ seconds: Math.round((Date.now() - this.startedAt.getTime()) / 1000) });
      this.offerTopicIfQuiet();
    }, 1000);
    this.saver = setInterval(() => void this.save(), SAVE_EVERY_MS);

    await this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const resuming = Boolean(this.handle);
    const seedHistory = !resuming && this.state.turns.length > 0;
    if (this.state.status === "starting") this.update({ status: "connecting" });
    try {
      // Every connection needs its own token, including one that resumes a conversation.
      // A conversation stays on one plan, even if Settings changes while it's running.
      const token = await api.talkToken({ handle: this.handle, seedHistory, plan: this.plan });
      if (this.stopped) return;
      this.plan = token.plan;
      this.quietPrompt = token.quietPrompt;

      const { GoogleGenAI } = await import("@google/genai");
      if (this.stopped) return;
      const client = new GoogleGenAI({ apiKey: token.token, httpOptions: { apiVersion: token.apiVersion } });
      let opened: LiveSession | undefined;
      let closedDuringSetup = false;
      let abandoned = false;
      let setupTimer: ReturnType<typeof setTimeout> | undefined;
      let failSetup: (error: Error) => void = () => {};
      const setupFailed = new Promise<never>((_, reject) => {
        failSetup = reject;
        setupTimer = setTimeout(() => reject(new Error("Timed out connecting.")), CONNECT_TIMEOUT_MS);
      });
      const connecting = client.live.connect({
        model: token.model,
        config: token.config,
        callbacks: {
          onmessage: (message: unknown) => this.onMessage(message as LiveMessage),
          onerror: () => {
            // A failed connection also closes, and that's what starts the retry.
          },
          onclose: () => {
            if (opened) {
              this.onClose(opened);
              return;
            }
            closedDuringSetup = true;
            failSetup(new Error("Closed while connecting."));
          },
        },
      }) as unknown as Promise<LiveSession>;
      // If it opens after the wait was given up on, nothing will use it, so it's closed.
      void connecting.then((late) => {
        if (abandoned) late.close();
      }, () => {});
      let session: LiveSession;
      try {
        session = await Promise.race([connecting, setupFailed]);
      } catch (error) {
        abandoned = true;
        throw error;
      } finally {
        clearTimeout(setupTimer);
      }
      opened = session;

      if (this.stopped) {
        session.close();
        return;
      }
      if (closedDuringSetup) {
        this.scheduleReconnect();
        return;
      }
      this.session = session;
      this.reconnectAttempts = 0;
      this.lastActivityAt = Date.now();
      this.contextTokens = 0;
      this.diagnose({ connections: this.state.diagnostics.connections + 1, plan: token.plan === "paid" ? "Paid" : "Free" });
      if (seedHistory) this.sendHistory(session);
      else if (!resuming) session.sendClientContent({ turns: [{ role: "user", parts: [{ text: token.greeting }] }], turnComplete: true });
      this.update({ status: this.player?.isPlaying ? "speaking" : "listening" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.fail("You've been signed out. Reload the app and sign in again.");
        return;
      }
      if (error instanceof ApiError && error.status === STATUS_CONFLICT) {
        this.fail(error.message);
        return;
      }
      this.scheduleReconnect();
    }
  }

  private sendHistory(session: LiveSession): void {
    const turns = this.state.turns.slice(-HISTORY_TURNS).map((turn) => ({
      role: turn.role === "learner" ? "user" : "model",
      parts: [{ text: turn.text }],
    }));
    if (turns.length) session.sendClientContent({ turns, turnComplete: false });
  }

  private onMicChunk(pcm: ArrayBuffer, peak: number): void {
    // Smoothed so the meter falls gently rather than flickering.
    const level = Math.max(peak, this.state.micLevel * 0.8);
    if (Math.abs(level - this.state.micLevel) > 0.02) this.update({ micLevel: level });
    if (!this.session || this.leavingConnection) return;
    // Silence rather than nothing, so Gemini's speech detection keeps seeing a steady stream.
    // A replay is always muted, or she'd hear herself and answer.
    const muted = this.replayPlayer !== undefined || (getSettings().noisyRoom && this.player?.isPlaying);
    try {
      this.session.sendRealtimeInput({ audio: { data: bytesToBase64(muted ? new ArrayBuffer(pcm.byteLength) : pcm), mimeType: "audio/pcm;rate=16000" } });
    } catch {
      // The connection just dropped, and its close event starts the reconnect.
    }
  }

  /** After a long silence, asks Yuki to offer something to talk about. The learner never sees the request. */
  private offerTopicIfQuiet(): void {
    const wait = QUIET_NUDGES_MS[this.quietNudges];
    if (wait === undefined || !getSettings().offerTopics) return;
    if (!this.session || this.state.status !== "listening" || this.player?.isPlaying || this.replayPlayer) return;
    if (Date.now() - this.lastActivityAt < wait) return;
    this.quietNudges += 1;
    this.lastActivityAt = Date.now();
    try {
      this.session.sendRealtimeInput({ text: this.quietPrompt });
    } catch {
      // The connection just dropped, and its close event starts the reconnect.
    }
  }

  /** The recording for the line she's saying now, starting one if this is its first piece. */
  private currentRecording(): number {
    if (this.recordingId !== undefined) return this.recordingId;
    const id = this.nextRecordingId++;
    this.recordingId = id;
    this.recordings.set(id, []);
    for (const oldest of this.recordings.keys()) {
      if (this.recordings.size <= MAX_RECORDINGS) break;
      this.recordings.delete(oldest);
      this.update({
        turns: this.state.turns.map((turn) => (turn.replayId === oldest ? { role: turn.role, text: turn.text } : turn)),
      });
    }
    return id;
  }

  private finishLine(): void {
    this.recordingId = undefined;
    this.turnEnded = true;
  }

  /** Plays a line again from its recording, which costs nothing. Tapping the same line again stops it. */
  replay(id: number): void {
    const chunks = this.recordings.get(id);
    if (!chunks?.length) return;
    const alreadyPlaying = this.state.replayingId === id;
    this.stopReplay();
    if (alreadyPlaying) return;

    // Anything left of her current line would talk over the replay.
    this.player?.stop();
    const context = !this.stopped && this.context ? this.context : (this.replayContext ??= new AudioContext());
    void context.resume();
    this.replayPlayer = new AudioPlayer(context, () => this.endReplay());
    for (const chunk of chunks) this.replayPlayer.play(chunk);
    this.update({ replayingId: id });
  }

  private stopReplay(): void {
    if (!this.replayPlayer) return;
    this.replayPlayer.stop();
    this.endReplay();
  }

  private endReplay(): void {
    this.replayPlayer = undefined;
    this.lastActivityAt = Date.now();
    this.update({ replayingId: undefined });
  }

  private countUsage(usage: NonNullable<LiveMessage["usageMetadata"]>): void {
    this.usage = {
      textIn: this.usage.textIn + tokensOf(usage.promptTokensDetails, "TEXT"),
      audioIn: this.usage.audioIn + tokensOf(usage.promptTokensDetails, "AUDIO"),
      // Google charges for her thinking at the text output price.
      textOut: this.usage.textOut + tokensOf(usage.responseTokensDetails, "TEXT") + (usage.thoughtsTokenCount ?? 0),
      audioOut: this.usage.audioOut + tokensOf(usage.responseTokensDetails, "AUDIO"),
    };
    this.contextTokens = usage.promptTokenCount ?? this.contextTokens;
    this.diagnose({ tokens: this.state.diagnostics.tokens + (usage.totalTokenCount ?? 0) });
  }

  private onMessage(message: LiveMessage): void {
    const update = message.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) this.handle = update.newHandle;

    if (message.usageMetadata) this.countUsage(message.usageMetadata);

    if (message.goAway) this.leaveConnectionSoon();

    const content = message.serverContent;
    if (!content) return;

    if (content.interrupted) {
      this.player?.stop();
      this.finishLine();
      this.update({ status: "listening" });
    }
    if (content.inputTranscription?.text) {
      this.addTranscript("learner", content.inputTranscription.text);
      this.lastActivityAt = Date.now();
      this.quietNudges = 0;
    }
    if (content.outputTranscription?.text) this.addTranscript("tutor", content.outputTranscription.text);

    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        this.stopReplay();
        this.recordings.get(this.currentRecording())?.push(part.inlineData.data);
        this.player?.play(part.inlineData.data);
        this.lastActivityAt = Date.now();
        if (this.state.status !== "speaking") this.update({ status: "speaking" });
      }
    }

    if (content.turnComplete) {
      this.finishLine();
      if (this.state.status === "speaking") this.update({ status: "listening" });
      if (this.goAwayTimer) {
        this.moveToNewConnection();
      } else if (this.contextTokens >= CONTEXT_REFRESH_TOKENS) {
        // Her reply is still playing from the queue at this point, so the switch goes unnoticed.
        this.handle = undefined;
        this.moveToNewConnection();
      }
    }
  }

  private addTranscript(role: TalkTurn["role"], text: string): void {
    const turns = [...this.state.turns];
    const last = turns.at(-1);
    const continuing = last?.role === role && !this.turnEnded;
    this.turnEnded = false;
    // Pieces arrive separately, so a direction can only be recognized once it's complete.
    const merged = ((continuing ? last.text : "") + text).replace(STAGE_DIRECTIONS, "");
    if (continuing) turns.pop();
    if (merged.trim()) {
      const line: TalkTurn = { role, text: merged.trimStart() };
      if (role === "tutor") line.replayId = this.currentRecording();
      turns.push(line);
    }
    this.update({ turns });
  }

  /** The server warned this connection is ending, so move between turns if one finishes in time. */
  private leaveConnectionSoon(): void {
    if (this.goAwayTimer) return;
    this.goAwayTimer = setTimeout(() => this.moveToNewConnection(), GO_AWAY_GRACE_MS);
  }

  private moveToNewConnection(): void {
    if (this.goAwayTimer) clearTimeout(this.goAwayTimer);
    this.goAwayTimer = undefined;
    const old = this.session;
    if (!old || this.stopped) return;
    this.leavingConnection = true;
    this.session = undefined;
    old.close();
    this.leavingConnection = false;
    void this.connect();
  }

  private onClose(closed: LiveSession): void {
    // A session this engine already replaced or stopped needs nothing further.
    if (this.stopped || this.session !== closed) return;
    this.session = undefined;
    this.diagnose({ drops: this.state.diagnostics.drops + 1 });
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      this.fail("Couldn't reach the tutor. Check your connection, then try again.");
      return;
    }
    this.update({ status: "reconnecting" });
    // A resume handle can go stale, so the last tries start fresh with the saved transcript.
    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS / 2) this.handle = undefined;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 8000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private async keepScreenOn(): Promise<void> {
    if (document.visibilityState !== "visible") return;
    if (!("wakeLock" in navigator)) {
      this.diagnose({ wakeLock: "not supported" });
      return;
    }
    try {
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.diagnose({ wakeLock: "on" });
      this.wakeLock.addEventListener("release", () => {
        if (!this.stopped) this.diagnose({ wakeLock: "released" });
      });
    } catch {
      this.diagnose({ wakeLock: "denied" });
    }
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      void this.save();
      return;
    }
    if (this.stopped) return;
    void this.context?.resume();
    void this.keepScreenOn();
    // Phones can stop the microphone while an app is in the background.
    if (this.mic && !this.mic.isLive) {
      this.diagnose({ mic: "restarting" });
      this.mic.start().then(
        () => this.diagnose({ mic: "live" }),
        (error: unknown) => this.fail(micErrorMessage(error)),
      );
    }
    if (!this.session && !this.reconnectTimer) void this.connect();
  };

  private onPageHide = (): void => void this.save();

  private async save(): Promise<void> {
    if (this.state.turns.length === 0) return;
    const snapshot = {
      localDate: localDate(),
      startedAt: this.startedAt.toISOString(),
      seconds: this.state.seconds,
      tokens: this.state.diagnostics.tokens,
      turns: this.state.turns,
      plan: this.plan,
      usage: this.usage,
    };
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.lastSaved) return;
    try {
      await api.saveTalkSession(this.sessionId, snapshot);
      this.lastSaved = serialized;
    } catch {
      // The next save carries the whole conversation, so a missed one isn't lost.
    }
  }

  private teardown(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.goAwayTimer) clearTimeout(this.goAwayTimer);
    this.reconnectTimer = undefined;
    this.goAwayTimer = undefined;
    if (this.clock) clearInterval(this.clock);
    if (this.saver) clearInterval(this.saver);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    window.removeEventListener("pagehide", this.onPageHide);
    const session = this.session;
    this.session = undefined;
    session?.close();
    this.stopReplay();
    this.recordingId = undefined;
    this.player?.stop();
    this.mic?.stop();
    void this.context?.close();
    void this.wakeLock?.release();
    this.wakeLock = undefined;
  }

  private fail(message: string): void {
    this.teardown();
    void this.save();
    this.update({
      status: "error",
      error: message,
      micLevel: 0,
      diagnostics: { ...this.state.diagnostics, mic: "off", audio: "off", wakeLock: "off" },
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.teardown();
    this.update({
      status: "ended",
      micLevel: 0,
      diagnostics: { ...this.state.diagnostics, mic: "off", audio: "off", wakeLock: "off" },
    });
    await this.save();
    // Yuki writes her notes on this conversation. Failing is fine, because the next app open retries it.
    api.prepareTalk(this.sessionId).catch(() => {});
  }
}
