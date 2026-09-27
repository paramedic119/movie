// 英語の読み上げ（ブラウザの音声合成を使う。使えない端末では文字を表示する）

let enabled = true;
let voice = null;

function synth() {
  return globalThis.speechSynthesis ?? null;
}

function pickVoice() {
  const s = synth();
  if (!s) return null;
  const voices = s.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
  const prefer = ['Samantha', 'Google US English', 'Microsoft Aria', 'Microsoft Jenny', 'Karen', 'Daniel'];
  for (const name of prefer) {
    const v = voices.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return voices.find((v) => /en[-_]US/i.test(v.lang)) ?? voices[0] ?? null;
}

if (synth()) {
  voice = pickVoice();
  synth().addEventListener?.('voiceschanged', () => {
    voice = pickVoice();
  });
}

export const speech = {
  setEnabled(v) {
    enabled = Boolean(v);
    if (!enabled) synth()?.cancel();
  },
  /** 読み上げが使えるか（設定でオフのときも false） */
  available() {
    return enabled && Boolean(synth()) && typeof globalThis.SpeechSynthesisUtterance === 'function';
  },
  speak(text, { rate = 0.85 } = {}) {
    if (!speech.available() || !text) return false;
    const s = synth();
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = rate;
    u.pitch = 1.05;
    if (voice) u.voice = voice;
    s.speak(u);
    return true;
  },
  cancel() {
    synth()?.cancel();
  },
};
