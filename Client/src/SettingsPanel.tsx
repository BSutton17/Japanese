import { useEffect, useRef, useState } from "react";
import { getSettings, saveSettings } from "./settings";
import { hasJapaneseVoice, speakJapanese } from "./speech";

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

  const setReadAloud = (readAloud: boolean) => {
    const next = { ...settings, readAloud };
    setSettings(next);
    saveSettings(next);
  };

  return (
    <dialog ref={dialog} className="settings" aria-labelledby="settings-title" onClose={onClose}>
      <h2 id="settings-title">Settings</h2>

      <label className="setting-row">
        <span>
          <strong>Read words aloud</strong>
          <small>In Vocab, hear each Japanese word after you answer.</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={settings.readAloud}
          onChange={(event) => setReadAloud(event.target.checked)}
        />
      </label>

      <button className="secondary" onClick={() => void speakJapanese("こんにちは")}>Test the voice</button>
      {voiceMissing && (
        <p className="error" role="alert">This device doesn't seem to have a Japanese voice, so words may not play.</p>
      )}
      <p className="fine-print">If you don't hear anything on an iPhone, check that its silent switch is off.</p>

      <button className="primary" onClick={onClose}>Done</button>
    </dialog>
  );
}
