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

// れんぞく正解のたびに1音ずつ上がる音階（ド・レ・ミ・ソ・ラ…）
const RISE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

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
  /** 正解。combo が大きいほど音が高くなる */
  correct(combo = 1) {
    const step = RISE[Math.min(Math.max(1, combo), RISE.length) - 1];
    const f = 659 * 2 ** (step / 12);
    tone(f, 0, 0.13, { type: 'triangle', vol: 0.7 });
    tone(f * 1.335, 0.09, 0.22, { type: 'triangle', vol: 0.7 });
    if (combo >= 5) tone(f * 2, 0.17, 0.26, { type: 'sine', vol: 0.3 });
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
  /** フィーバー！ */
  fever() {
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.07, 0.14, { type: 'square', vol: 0.16 }));
    tone(2093, 0.3, 0.4, { type: 'triangle', vol: 0.4 });
  },
  /** ラスト1問のドラムロール */
  drumroll() {
    for (let i = 0; i < 12; i += 1) tone(120 + (i % 2) * 10, i * 0.055, 0.05, { type: 'triangle', vol: 0.18 + i * 0.03 });
    tone(262, 0.7, 0.22, { type: 'triangle', vol: 0.5 });
  },
  /** EXステージに入るときの「シュッ」 */
  whoosh() {
    tone(180, 0, 0.3, { type: 'sawtooth', vol: 0.1, slideTo: 900 });
  },
  /** けっかの★（1つめ・2つめ・3つめで音が上がる） */
  star(i = 0) {
    const f = [1047, 1319, 1568][i] ?? 1568;
    tone(f, 0, 0.18, { type: 'triangle', vol: 0.55 });
    tone(f * 2, 0.03, 0.22, { type: 'sine', vol: 0.2 });
  },
  /** ハンコを「ポン」 */
  stamp() {
    tone(150, 0, 0.2, { type: 'sine', vol: 0.9, slideTo: 60 });
    tone(95, 0, 0.12, { type: 'triangle', vol: 0.5 });
  },
  /** たからばこが開く */
  chest() {
    [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, i * 0.06, 0.16, { type: 'triangle', vol: 0.45 }));
  },
  /** しょうごうゲージがのびる */
  gauge() {
    tone(330, 0, 0.8, { type: 'triangle', vol: 0.22, slideTo: 1320 });
  },
  /** しょうごうアップ！ */
  levelUp() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.18, { type: 'square', vol: 0.18 }));
    tone(1568, 0.63, 0.55, { type: 'triangle', vol: 0.5 });
  },
  /** ゴールデン問題が出た！（キラキラと上がる音） */
  golden() {
    [1319, 1568, 1976, 2637].forEach((f, i) => tone(f, i * 0.06, 0.18, { type: 'sine', vol: 0.35 }));
    tone(3136, 0.26, 0.4, { type: 'triangle', vol: 0.25 });
  },
  /** ゴールデン問題に せいかい！（大当たり） */
  jackpot() {
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => tone(f, i * 0.05, 0.16, { type: 'square', vol: 0.15 }));
    [1047, 1319, 1568].forEach((f) => tone(f, 0.4, 0.6, { type: 'triangle', vol: 0.3 }));
    for (let i = 0; i < 6; i += 1) tone(2637 + (i % 2) * 400, 0.45 + i * 0.07, 0.08, { type: 'sine', vol: 0.18 });
  },
  /** たからばこの ランクアップ（i が大きいほど高い音） */
  rankUp(i = 0) {
    const f = [784, 988, 1175, 1568][i] ?? 1568;
    tone(f, 0, 0.1, { type: 'square', vol: 0.18 });
    tone(f * 1.26, 0.07, 0.1, { type: 'square', vol: 0.18 });
    tone(f * 1.5, 0.14, 0.28, { type: 'triangle', vol: 0.4 });
  },
  /** ミッション クリア */
  mission() {
    [880, 1109, 1319].forEach((f, i) => tone(f, i * 0.08, 0.14, { type: 'triangle', vol: 0.45 }));
    tone(1760, 0.24, 0.3, { type: 'sine', vol: 0.3 });
  },
  buy() {
    tone(988, 0, 0.1, { type: 'square', vol: 0.2 });
    tone(1319, 0.08, 0.25, { type: 'square', vol: 0.2 });
  },
};
