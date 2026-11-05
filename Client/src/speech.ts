// Speaks Japanese with the voice built into the device, so it works without any AI cost.

// A voice that never reports finishing must not be able to freeze a quiz.
const MAX_SPEECH_WAIT_MS = 2500;

function japaneseVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("ja"));
  return voices.find((voice) => voice.localService) ?? voices[0];
}

export function canSpeak(): boolean {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** Whether this device has a Japanese voice. Voices can load late, so this waits briefly. */
export function hasJapaneseVoice(): Promise<boolean> {
  if (!canSpeak()) return Promise.resolve(false);
  if (japaneseVoice()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const check = () => resolve(Boolean(japaneseVoice()));
    window.speechSynthesis.addEventListener("voiceschanged", check, { once: true });
    setTimeout(check, 1000);
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

/**
 * Says the text in Japanese, and resolves when it's done or the wait runs out. Call this directly
 * from a tap, because iPhones only allow speech that starts from one.
 */
export function speakJapanese(text: string): Promise<void> {
  if (!canSpeak()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => resolve();
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = 0.9;
    const voice = japaneseVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = finish;
    utterance.onerror = finish;
    setTimeout(finish, MAX_SPEECH_WAIT_MS);
    synth.speak(utterance);
  });
}
