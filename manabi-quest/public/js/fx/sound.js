// 効果音（音声ファイルを使わず Web Audio で作る。音量はひかえめ）

let ctx = null;
let master = null;
let enabled = true;

function audio() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', vol = 1, slideTo = null } = {}) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sfx = {
  setEnabled(v) {
    enabled = Boolean(v);
  },
  /** 最初のタップで音を使えるようにする（スマホのブラウザの決まり） */
  unlock() {
    audio();
  },
  tap() {
    tone(660, 0, 0.06, { type: 'triangle', vol: 0.35 });
  },
  digit() {
    tone(880, 0, 0.08, { type: 'triangle', vol: 0.45 });
  },
  correct() {
    tone(784, 0, 0.14, { type: 'triangle', vol: 0.7 });
    tone(1047, 0.1, 0.22, { type: 'triangle', vol: 0.7 });
  },
  wrong() {
    tone(330, 0, 0.16, { type: 'sine', vol: 0.5 });
    tone(262, 0.14, 0.24, { type: 'sine', vol: 0.45 });
  },
  coin(i = 0) {
    const base = 1318 + (i % 4) * 90;
    tone(base, 0, 0.07, { type: 'square', vol: 0.18 });
    tone(base * 1.5, 0.05, 0.1, { type: 'square', vol: 0.14 });
  },
  combo(n) {
    const f = 523 * 2 ** (Math.min(n, 12) / 12);
    tone(f, 0, 0.1, { type: 'triangle', vol: 0.5 });
    tone(f * 1.26, 0.07, 0.1, { type: 'triangle', vol: 0.5 });
    tone(f * 1.5, 0.14, 0.16, { type: 'triangle', vol: 0.5 });
  },
  fanfare() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.2, { type: 'triangle', vol: 0.6 }));
    tone(1047, 0.46, 0.5, { type: 'triangle', vol: 0.55 });
    tone(1319, 0.46, 0.5, { type: 'sine', vol: 0.35 });
  },
  ex() {
    tone(392, 0, 0.12, { type: 'sawtooth', vol: 0.25 });
    tone(523, 0.1, 0.12, { type: 'sawtooth', vol: 0.25 });
    tone(784, 0.2, 0.3, { type: 'sawtooth', vol: 0.25, slideTo: 1046 });
  },
  buy() {
    tone(988, 0, 0.1, { type: 'square', vol: 0.2 });
    tone(1319, 0.08, 0.25, { type: 'square', vol: 0.2 });
  },
};
