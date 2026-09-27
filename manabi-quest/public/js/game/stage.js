// ステージの問題をえらぶ
// ・まだ出ていない問題、前にまちがえた問題を出やすくする（くり返し学習）
// ・EXステージは むずかしい問題（level 2〜3）から、同じ流れで出た問題は出さない

import { STAGE_INFO } from './rewards.js';

const GEN_RETRIES = 25;

/** 出やすさ：まだ出ていない=3、前回まちがい=4、正解が続くほど下がる */
export function questionWeight(stat) {
  if (!stat) return 3;
  if (stat.last === 0) return 4;
  return Math.max(0.25, 1.5 / Math.max(1, stat.c));
}

/** 出題用に選択肢をシャッフルしたコピーを作る */
export function prepareForPlay(q, rng) {
  if (q.kind !== 'choice') return { ...q };
  return { ...q, originalChoices: q.choices, choices: rng.shuffle(q.choices) };
}

function fromGenerator(unit, level, rng, used) {
  let q = null;
  for (let i = 0; i < GEN_RETRIES; i += 1) {
    q = unit.generate(level, rng);
    if (!used.has(q.id)) break;
  }
  return { ...q, subject: unit.subject, unit: unit.id };
}

function levelOrder(level) {
  // 足りないときに代わりに使う level の順番
  return { 1: [1, 2, 3], 2: [2, 1, 3], 3: [3, 2, 1] }[level] ?? [1, 2, 3];
}

function fromBank(pool, level, rng, used, qstats, canUse = () => true) {
  for (const lv of levelOrder(level)) {
    const candidates = pool.filter((q) => q.level === lv && !used.has(q.id) && canUse(q));
    if (candidates.length) return rng.weighted(candidates, (q) => questionWeight(qstats[q.id]));
  }
  return null;
}

/**
 * 単元のステージの問題リストを作る。
 * @param {object} p
 * @param {any} p.unit 単元（generate か questions をもつ）
 * @param {string} p.stageKind normal / ex1 / ex2 / ex3
 * @param {any} p.rng
 * @param {Record<string, any>} [p.qstats] 問題ごとの成績
 * @param {Set<string>} [p.used] すでにこの流れで出た問題ID
 * @param {any[]} [p.siblings] 同じ教科のほかの単元（問題が足りないときの予備）
 * @param {(q:any)=>boolean} [p.canUse] この端末で出せる問題か（読み上げ専用の問題など）
 */
export function buildStage({ unit, stageKind, rng, qstats = {}, used = new Set(), siblings = [], canUse = () => true }) {
  const info = STAGE_INFO[stageKind] ?? STAGE_INFO.normal;
  const usedHere = new Set(used);
  const out = [];
  for (const level of info.levels.slice(0, info.count)) {
    let q = null;
    if (unit.generate) {
      q = fromGenerator(unit, level, rng, usedHere);
    } else {
      q = fromBank(unit.questions, level, rng, usedHere, qstats, canUse);
      if (!q) {
        // この単元の問題を出しつくしたら、同じ教科のほかの単元のむずかしい問題から
        const extra = siblings.filter((u) => u.id !== unit.id && u.questions).flatMap((u) => u.questions);
        q = fromBank(extra, level, rng, usedHere, qstats, canUse);
      }
    }
    if (!q) continue;
    usedHere.add(q.id);
    out.push(prepareForPlay(q, rng));
  }
  return out;
}

/** 教科ミックス：いろいろな単元から出す */
export function buildMixStage({ units, rng, qstats = {}, canUse = () => true }) {
  const info = STAGE_INFO.mix;
  const used = new Set();
  const out = [];
  const order = rng.shuffle(units);
  info.levels.forEach((level, i) => {
    const unit = order[i % order.length];
    const q = unit.generate ? fromGenerator(unit, level, rng, used) : fromBank(unit.questions, level, rng, used, qstats, canUse);
    if (q) {
      used.add(q.id);
      out.push(prepareForPlay(q, rng));
    }
  });
  return rng.shuffle(out).sort((a, b) => a.level - b.level);
}

/** きょうの5教科：教科ごとに1問ずつ（いろいろな教科をまぜて練習する） */
export function buildDailyStage({ unitsBySubject, rng, qstats = {}, canUse = () => true }) {
  const info = STAGE_INFO.daily;
  const used = new Set();
  const out = [];
  unitsBySubject.forEach((units, i) => {
    if (!units.length) return;
    const unit = rng.pick(units);
    const level = info.levels[i] ?? 2;
    const q = unit.generate ? fromGenerator(unit, level, rng, used) : fromBank(unit.questions, level, rng, used, qstats, canUse);
    if (q) {
      used.add(q.id);
      out.push(prepareForPlay(q, rng));
    }
  });
  return out;
}

/** まちがいノートの問題でステージを作る */
export function buildReviewStage({ entries, rng, count = STAGE_INFO.review.count }) {
  return entries.slice(0, count).map((e) => prepareForPlay({ ...e.q, fromNotebook: true }, rng));
}
