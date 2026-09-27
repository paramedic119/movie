// ごほうび（コイン）の計算
// 正解が続くほど1問のコインがふえる（コンボ）。EXステージはさらに倍率アップ。
// まちがえてもコインはへらない。

export const BASE_COIN = 10;

export const STAGE_INFO = {
  normal: { label: 'ステージ', count: 5, mult: 1, levels: [1, 1, 2, 2, 2] },
  ex1: { label: 'EX 1', count: 3, mult: 2, levels: [2, 3, 3] },
  ex2: { label: 'EX 2', count: 3, mult: 3, levels: [3, 3, 3] },
  ex3: { label: 'EX 3', count: 3, mult: 5, levels: [3, 3, 3] },
  mix: { label: 'ミックス', count: 5, mult: 1.2, levels: [1, 1, 2, 2, 3] },
  daily: { label: 'きょうの5教科', count: 5, mult: 1.5, levels: [1, 2, 2, 2, 2] },
  review: { label: 'ふくしゅう', count: 5, mult: 1.5, levels: [] },
  revenge: { label: 'リベンジ', count: 5, mult: 0.5, levels: [] },
};

export const EX_ORDER = ['normal', 'ex1', 'ex2', 'ex3'];

/** 全問正解したときに次に進めるEXステージ（なければ null） */
export function nextExStage(kind) {
  const i = EX_ORDER.indexOf(kind);
  return i >= 0 && i < EX_ORDER.length - 1 ? EX_ORDER[i + 1] : null;
}

/** コンボ倍率：1問目 ×1.0 → 1問ごとに +0.25 → 最大 ×3 */
export function comboMultiplier(combo) {
  return Math.min(3, 1 + 0.25 * Math.max(0, combo - 1));
}

/** ゴールデン問題：正解すると コインが この倍率 */
export const GOLDEN_MULT = 3;
/** 1問あたり ゴールデン問題になる確率のめやす（1ステージに1問まで。5問のステージなら 約半分で出る） */
export const GOLDEN_RATE = 0.12;

/** 1問正解したときのコイン */
export function coinsForAnswer({ stageKind, combo, usedHint = false, golden = false }) {
  const mult = STAGE_INFO[stageKind]?.mult ?? 1;
  let coins = BASE_COIN * mult * comboMultiplier(combo);
  if (golden) coins *= GOLDEN_MULT;
  if (usedHint) coins *= 0.5;
  return Math.max(1, Math.round(coins));
}

/**
 * ステージの中で ゴールデン問題にする番号（なければ -1）。
 * どの問題が ゴールデンになるかは、出てくるまで ひみつ。リベンジ（その場のやり直し）には出さない。
 */
export function pickGoldenIndex(count, stageKind, rng, rate = GOLDEN_RATE) {
  if (!(rate > 0) || count <= 0 || stageKind === 'revenge') return -1;
  const perStage = 1 - (1 - Math.min(1, rate)) ** count;
  return rng.chance(perStage) ? rng.int(0, count - 1) : -1;
}

/** コンボの段階（演出だけに使う。コインの計算は comboMultiplier） */
export const COMBO_TIERS = [
  { min: 3, label: 'いいかんじ！' },
  { min: 5, label: 'フィーバー！' },
  { min: 8, label: 'スーパーフィーバー！' },
  { min: 11, label: 'ハイパーフィーバー！' },
  { min: 14, label: 'レジェンド！' },
];

/** この れんぞく正解から「フィーバー」 */
export const FEVER_COMBO = COMBO_TIERS[1].min;

/** いまのコンボの段階（0 = まだ、1〜5） */
export function comboTier(combo) {
  let tier = 0;
  COMBO_TIERS.forEach((t, i) => {
    if (combo >= t.min) tier = i + 1;
  });
  return tier;
}

/**
 * ステージの終わりの たからばこ。★の数でランクが決まり、ゴールデン問題に せいかいすると 1つ上がる。
 * 金（パーフェクト）の中身は、ふつう30・EX1 60・EX2 120・EX3 300・ミックス40・きょうの5教科50・ふくしゅう30。
 */
export const CHEST_RANKS = [
  null,
  { id: 'bronze', name: '{銅|どう}の たからばこ', coins: 10 },
  { id: 'silver', name: '銀の たからばこ', coins: 20 },
  { id: 'gold', name: '金の たからばこ', coins: 30 },
  { id: 'rainbow', name: 'にじの たからばこ', coins: 60 },
];
const CHEST_FACTOR = { normal: 1, ex1: 2, ex2: 4, ex3: 10, mix: 4 / 3, daily: 5 / 3, review: 1 };
const STAR_STEP = [null, 'クリア', '★★', 'パーフェクト！'];

/**
 * @returns {{rank:number, coins:number, steps:{rank:number,label:string}[]}}
 *   rank 0 は たからばこなし。steps は ランクが上がったわけ（けっか画面で1つずつ見せる）
 */
export function chestFor({ stageKind, correct, total, goldenHit = false }) {
  const factor = CHEST_FACTOR[stageKind];
  const none = { rank: 0, coins: 0, steps: [] };
  if (!factor || total <= 0) return none;
  const stars = starsFor(correct, total);
  const steps = [];
  for (let r = 1; r <= stars; r += 1) steps.push({ rank: r, label: STAR_STEP[r] });
  if (goldenHit) steps.push({ rank: stars + 1, label: 'ゴールデン！' });
  const rank = Math.min(CHEST_RANKS.length - 1, steps.length);
  if (!rank) return none;
  return { rank, coins: Math.round(CHEST_RANKS[rank].coins * factor), steps: steps.slice(0, rank) };
}

/** ★の数（0〜3） */
export function starsFor(correct, total) {
  if (total <= 0) return 0;
  const r = correct / total;
  if (r >= 1) return 3;
  if (r >= 0.8) return 2;
  if (r >= 0.6) return 1;
  return 0;
}

export const TITLES = [
  { min: 0, name: 'まなびのたまご', emoji: '🥚' },
  { min: 300, name: 'まなびのひよこ', emoji: '🐣' },
  { min: 1000, name: 'がんばりやさん', emoji: '⭐' },
  { min: 3000, name: 'ものしりさん', emoji: '📚' },
  { min: 7000, name: 'はかせ', emoji: '🎓' },
  { min: 15000, name: 'だいはかせ', emoji: '🏅' },
  { min: 30000, name: 'まなびマスター', emoji: '👑' },
  { min: 60000, name: 'でんせつのマスター', emoji: '🌈' },
];

/** これまでにかせいだコインから、しょうごうと次までの進みぐあいを出す */
export function titleFor(totalEarned) {
  let idx = 0;
  TITLES.forEach((t, i) => {
    if (totalEarned >= t.min) idx = i;
  });
  const current = TITLES[idx];
  const next = TITLES[idx + 1] ?? null;
  const progress = next ? (totalEarned - current.min) / (next.min - current.min) : 1;
  return { index: idx, current, next, progress: Math.max(0, Math.min(1, progress)) };
}
