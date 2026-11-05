export interface Settings {
  readAloud: boolean;
}

const STORAGE_KEY = "tutor.settings";
const DEFAULTS: Settings = { readAloud: true };

export function getSettings(): Settings {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...DEFAULTS, ...(stored as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked: the setting still applies until the app closes.
  }
}
