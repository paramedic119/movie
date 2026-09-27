// きょうのミッション（毎日3つ）と、1週間の がんばりスタンプ
// ・ミッションは日づけで決まる（同じ日は何度ひらいても同じ）。3つめは、まちがいノート・ふりかえり・
//   にがてな教科など「学習のためになること」を多めにえらぶ
// ・休んでも へるものはない（うけとりわすれたコインは、つぎの日に自動でうけとる）

import { createRng } from '../lib/rng.js';
import { FEVER_COMBO } from './rewards.js';
import { addCoins, dateKey, dayRecord } from './state.js';

export const MISSION_KINDS = {
  stages: { icon: '🚩', goal: 3, coins: 20 },
  correct: { icon: '⭕', goal: 15, coins: 20 },
  combo: { icon: '🔥', goal: 1, coins: 30 },
  perfect: { icon: '💯', goal: 1, coins: 30 },
  golden: { icon: '✨', goal: 1, coins: 30 },
  ex: { icon: '🚀', goal: 1, coins: 30 },
  review: { icon: '📒', goal: 3, coins: 30 },
  furikaeri: { icon: '🔁', goal: 1, coins: 30 },
  subjects: { icon: '🎒', goal: 3, coins: 30 },
  daily: { icon: '🌟', goal: 1, coins: 20 },
  subject: { icon: '📘', goal: 5, coins: 20 },
};

/** 3つ ぜんぶ うけとったときの ボーナス */
export const ALL_CLEAR_BONUS = 50;

/** ミッションの文。subjectName は 教科ID → 教科の名前 */
export function missionText(m, subjectName = (id) => id) {
  switch (m.kind) {
    case 'stages':
      return `ステージを ${m.goal}かい クリアしよう`;
    case 'correct':
      return `せいかいを ${m.goal}もん 出そう`;
    case 'combo':
      return `${FEVER_COMBO}れんぞく せいかいで フィーバーしよう`;
    case 'perfect':
      return 'パーフェクト（全問せいかい）を とろう';
    case 'golden':
      return 'ゴールデン問題に せいかいしよう';
    case 'ex':
      return 'EXステージに ちょうせんしよう';
    case 'review':
      return `まちがいノートで ${m.goal}もん せいかいしよう`;
    case 'furikaeri':
      return 'ふりかえり（1〜3年）を 1かい クリアしよう';
    case 'subjects':
      return `${m.goal}つの 教科で ステージを クリアしよう`;
    case 'daily':
      return 'きょうの5教科チャレンジを クリアしよう';
    case 'subject':
      return `${subjectName(m.subject)}で ${m.goal}もん せいかいしよう`;
    default:
      return 'ミッション';
  }
}

function seedOf(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * その日のミッションを3つ決める（同じ日づけ・同じ情報なら、いつも同じ）
 * @param {string} date 'YYYY-MM-DD'
 * @param {{dueCount?:number, furikaeri?:boolean, golden?:boolean, subjectIds?:string[], weakSubject?:string|null, dailyDone?:boolean}} info
 *   dueCount … きょう ふくしゅうできる まちがいノートの問題の数
 *   furikaeri … つまずいていて、おすすめの ふりかえり単元がある
 *   golden … ゴールデン問題が出る設定か
 *   weakSubject … 正答率が低めの教科（なければ null）
 */
export function planMissions(date, info = {}) {
  const rng = createRng(seedOf(date));
  const subjectIds = info.subjectIds ?? [];
  // 1つめ：たくさん といてみる　2つめ：わざを きめる　3つめ：学習のためになること
  const kinds = [rng.pick(['stages', 'correct']), rng.pick(['combo', 'perfect', 'ex', ...(info.golden ? ['golden'] : [])])];
  const study = [];
  if ((info.dueCount ?? 0) >= MISSION_KINDS.review.goal) study.push('review', 'review');
  if (info.furikaeri) study.push('furikaeri', 'furikaeri');
  if (subjectIds.length) study.push('subject');
  if (subjectIds.length >= MISSION_KINDS.subjects.goal) study.push('subjects');
  if (!info.dailyDone) study.push('daily');
  const third = study.length ? rng.pick(study) : ['stages', 'correct'].find((k) => !kinds.includes(k));
  kinds.push(third);
  const subject = info.weakSubject && subjectIds.includes(info.weakSubject) ? info.weakSubject : rng.pick(subjectIds);
  return kinds.map((kind) => ({
    kind,
    goal: MISSION_KINDS[kind].goal,
    coins: MISSION_KINDS[kind].coins,
    n: 0,
    done: false,
    claimed: false,
    seen: [],
    ...(kind === 'subject' ? { subject } : {}),
  }));
}

/**
 * 日づけが変わっていたら、きょうのミッションを作る（前の日に うけとりわすれたコインは ここで うけとる）
 * @returns {{fresh:boolean, carried:number}} carried … 自動で うけとったコイン
 */
export function ensureMissions(st, now, info) {
  const today = dateKey(now);
  if (st.missions.date === today && st.missions.list.length) return { fresh: false, carried: 0 };
  let carried = 0;
  if (st.missions.date && st.missions.date !== today) {
    for (const m of st.missions.list) if (m.done && !m.claimed) carried += m.coins;
    if (st.missions.list.length && st.missions.list.every((m) => m.done) && !st.missions.bonus) carried += ALL_CLEAR_BONUS;
  }
  addCoins(st, carried, now);
  st.missions = { date: today, list: planMissions(today, info), bonus: false };
  return { fresh: true, carried };
}

function bump(m, to = m.n + 1) {
  if (m.done) return false;
  m.n = Math.min(m.goal, to);
  m.done = m.n >= m.goal;
  return m.done;
}

/**
 * 1問答えたとき。新しく クリアしたミッションを返す。
 * その場のやり直し（リベンジ）は、答えを見たあとなので数えない
 */
export function missionsOnAnswer(st, now, { stageKind = 'normal', correct, combo = 0, golden = false, subject = '', fromNotebook = false }) {
  if (!correct || stageKind === 'revenge' || st.missions.date !== dateKey(now)) return [];
  return st.missions.list.filter((m) => {
    if (m.kind === 'correct') return bump(m);
    if (m.kind === 'combo') return combo >= FEVER_COMBO && bump(m);
    if (m.kind === 'golden') return golden && bump(m);
    if (m.kind === 'review') return fromNotebook && bump(m);
    if (m.kind === 'subject') return subject === m.subject && bump(m);
    return false;
  });
}

/**
 * ステージが終わったとき。新しく クリアしたミッションを返す。
 * 「クリア」は ★1つ以上（6わり以上 せいかい）。その場のやり直し（リベンジ）は数えない。
 * subject は 教科のステージ・ミックスのときだけ（ふくしゅう・きょうの5教科は ''）
 */
export function missionsOnStage(st, now, { stageKind, stars, perfect, subject = '', furikaeri = false }) {
  if (stageKind === 'revenge' || st.missions.date !== dateKey(now)) return [];
  const clear = stars >= 1;
  return st.missions.list.filter((m) => {
    if (m.kind === 'stages') return clear && bump(m);
    if (m.kind === 'perfect') return perfect && bump(m);
    if (m.kind === 'ex') return stageKind.startsWith('ex') && bump(m);
    if (m.kind === 'furikaeri') return clear && furikaeri && bump(m);
    if (m.kind === 'daily') return clear && stageKind === 'daily' && bump(m);
    if (m.kind === 'subjects' && clear && subject && !m.seen.includes(subject)) {
      m.seen.push(subject);
      return bump(m, m.seen.length);
    }
    return false;
  });
}

/**
 * ミッションのコインを うけとる
 * @returns {{ok:boolean, coins:number, bonus:number}} bonus … 3つ ぜんぶ うけとったときの ボーナス（なければ 0）
 */
export function claimMission(st, index, now) {
  const m = st.missions.list[index];
  if (!m || !m.done || m.claimed) return { ok: false, coins: 0, bonus: 0 };
  m.claimed = true;
  addCoins(st, m.coins, now);
  let bonus = 0;
  if (!st.missions.bonus && st.missions.list.every((x) => x.claimed)) {
    st.missions.bonus = true;
    bonus = ALL_CLEAR_BONUS;
    addCoins(st, bonus, now);
  }
  return { ok: true, coins: m.coins, bonus };
}

/**
 * ゴールデン問題が オフになったら、まだの「ゴールデン問題に せいかい」ミッションを、
 * できるミッションに かえる（できないミッションが のこらないように）
 */
export function replaceGoldenMission(st) {
  const list = st.missions.list;
  const i = list.findIndex((m) => m.kind === 'golden' && !m.done);
  const kind = ['perfect', 'combo', 'ex'].find((k) => !list.some((m) => m.kind === k));
  if (i < 0 || !kind) return false;
  list[i] = { kind, goal: MISSION_KINDS[kind].goal, coins: MISSION_KINDS[kind].coins, n: 0, done: false, claimed: false, seen: [] };
  return true;
}

// ---------- 1週間の がんばりスタンプ（ステージを1つクリアした日に1つ） ----------

export const STAMP_GOALS = [
  { days: 3, coins: 30 },
  { days: 5, coins: 60 },
  { days: 7, coins: 100 },
];
const WEEK_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

function mondayOf(ts) {
  const d = new Date(ts);
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() - ((d.getDay() + 6) % 7) };
}

/** その週の月曜日（'YYYY-MM-DD'） */
export function weekStartKey(ts) {
  const w = mondayOf(ts);
  return dateKey(new Date(w.y, w.m, w.d).getTime());
}

/** 今週（月〜日）の7日分のスタンプ */
export function weekStamps(st, now) {
  const w = mondayOf(now);
  const today = dateKey(now);
  return WEEK_LABELS.map((label, i) => {
    const key = dateKey(new Date(w.y, w.m, w.d + i).getTime());
    return { key, label, stamped: (st.days[key]?.stages ?? 0) > 0, today: key === today, future: key > today };
  });
}

/** つぎの週のボーナス（なければ null） */
export function nextStampGoal(count) {
  return STAMP_GOALS.find((g) => count < g.days) ?? null;
}

/**
 * 今週のうちに まだ とどく つぎのボーナスと、あと何日か（とどかなければ null）。
 * のこりの日（きょうの分も まだなら 数える）で足りないボーナスは 見せない
 * @param {{stamped:boolean, today:boolean, future:boolean}[]} days weekStamps の結果
 */
export function reachableStampGoal(days) {
  const count = days.filter((d) => d.stamped).length;
  const left = days.filter((d) => d.future || (d.today && !d.stamped)).length;
  const goal = nextStampGoal(count);
  return goal && goal.days - count <= left ? { ...goal, need: goal.days - count } : null;
}

/**
 * ステージをクリアしたときに よぶ。きょう はじめてなら スタンプをおして、週のボーナスを しらべる
 * @returns {{newStamp:boolean, count:number, rewards:{days:number,coins:number}[]}}
 */
export function stampDay(st, now) {
  const day = dayRecord(st, now);
  const first = day.stages === 0;
  day.stages += 1;
  const count = weekStamps(st, now).filter((x) => x.stamped).length;
  if (!first) return { newStamp: false, count, rewards: [] };
  const start = weekStartKey(now);
  if (st.week.start !== start) st.week = { start, got: [] };
  const rewards = STAMP_GOALS.filter((g) => count >= g.days && !st.week.got.includes(g.days));
  for (const g of rewards) {
    st.week.got.push(g.days);
    addCoins(st, g.coins, now);
  }
  return { newStamp: true, count, rewards };
}
