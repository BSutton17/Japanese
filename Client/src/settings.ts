export interface Settings {
  readAloud: boolean;
  /** Yuki offers something to talk about after a long silence. */
  offerTopics: boolean;
  /** Mutes the microphone while Yuki speaks, so a TV or game can't interrupt her. */
  noisyRoom: boolean;
}

const STORAGE_KEY = "tutor.settings";
const DEFAULTS: Settings = { readAloud: true, offerTopics: true, noisyRoom: false };

// A conversation checks these many times a second, so they're only read from storage once.
let current: Settings | undefined;

export function getSettings(): Settings {
  if (current) return current;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    current = { ...DEFAULTS, ...(stored as Partial<Settings>) };
  } catch {
    current = DEFAULTS;
  }
  return current;
}

export function saveSettings(settings: Settings): void {
  current = settings;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the setting still applies until the app closes.
  }
}
