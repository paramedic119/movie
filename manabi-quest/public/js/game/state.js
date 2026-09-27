// 学習記録の保存（この端末のブラウザの localStorage に保存）

import { addMistake, recordReview } from './review.js';

export const STORAGE_KEY = 'manabi-quest:v1';
const DAYS_TO_KEEP = 120;
const RECENT_LEN = 20;

export function defaultState({ reducedMotion = false } = {}) {
  return {
    v: 1,
    createdAt: Date.now(),
    coins: 0,
    totalEarned: 0,
    friends: ['pao'],
    partner: 'pao',
    themes: ['sky'],
    theme: 'sky',
    units: {},
    qstats: {},
    subjects: {},
    unitStats: {},
    notebook: {},
    mastered: 0,
    days: {},
    settings: {
      limitMin: 30,
      breakMin: 20,
      effects: reducedMotion ? 'calm' : 'normal',
      sound: true,
      voice: true,
    },
    extra: { date: '', min: 0 },
    pin: null,
    achievements: {},
    seenGuide: false,
  };
}

/** ブラウザの保存領域（使えないときはメモリだけで動かす） */
export function safeStorage() {
  try {
    const ls = globalThis.localStorage;
    const probe = '__mq_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    const mem = new Map();
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
      memoryOnly: true,
    };
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 保存データを読み、足りない項目は初期値でうめる */
export function mergeWithDefaults(raw, defaults) {
  if (!isPlainObject(raw)) return defaults;
  const out = { ...defaults };
  for (const [key, def] of Object.entries(defaults)) {
    const val = raw[key];
    if (val === undefined) continue;
    if (isPlainObject(def) && key === 'settings') out[key] = { ...def, ...(isPlainObject(val) ? val : {}) };
    else if (isPlainObject(def)) out[key] = isPlainObject(val) ? val : def;
    else if (Array.isArray(def)) out[key] = Array.isArray(val) ? val : def;
    else if (def === null || typeof def === typeof val) out[key] = val;
  }
  if (!out.friends.includes('pao')) out.friends.unshift('pao');
  if (!out.themes.includes('sky')) out.themes.unshift('sky');
  return out;
}

export function createStore({ storage = safeStorage(), reducedMotion = false } = {}) {
  const defaults = defaultState({ reducedMotion });
  let state = defaults;
  let loadError = null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) state = mergeWithDefaults(JSON.parse(raw), defaults);
  } catch (err) {
    loadError = err;
    state = defaults;
  }
  const listeners = new Set();
  const store = {
    get state() {
      return state;
    },
    memoryOnly: Boolean(storage.memoryOnly),
    loadError,
    save() {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (err) {
        console.warn('[まなびクエスト] 保存できませんでした', err);
      }
      listeners.forEach((fn) => fn(state));
    },
    update(fn) {
      fn(state);
      store.save();
    },
    reset() {
      state = defaultState({ reducedMotion });
      store.save();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return store;
}

// ---------- 記録の更新（state を直接書きかえる関数） ----------

export function dateKey(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function dayRecord(state, ts) {
  const key = dateKey(ts);
  if (!state.days[key]) state.days[key] = { sec: 0, n: 0, c: 0, coins: 0 };
  return state.days[key];
}

export function pruneDays(state, now) {
  const limit = dateKey(now - DAYS_TO_KEEP * 86400000);
  for (const key of Object.keys(state.days)) if (key < limit) delete state.days[key];
}

export function addCoins(state, n, now) {
  if (!(n > 0)) return;
  state.coins += n;
  state.totalEarned += n;
  dayRecord(state, now).coins += n;
}

/** 1問答えたときの記録 */
export function recordAnswer(state, q, correct, now) {
  const day = dayRecord(state, now);
  day.n += 1;
  if (correct) day.c += 1;

  const subj = (state.subjects[q.subject] ??= { n: 0, c: 0 });
  subj.n += 1;
  if (correct) subj.c += 1;

  const us = (state.unitStats[q.unit] ??= { n: 0, c: 0, recent: [] });
  us.n += 1;
  if (correct) us.c += 1;
  us.recent.push(correct ? 1 : 0);
  if (us.recent.length > RECENT_LEN) us.recent.splice(0, us.recent.length - RECENT_LEN);

  if (!q.generated) {
    const st = (state.qstats[q.id] ??= { n: 0, c: 0, last: 0 });
    st.n += 1;
    if (correct) st.c += 1;
    st.last = correct ? 1 : 0;
  }

  let reviewResult = 'none';
  if (q.fromNotebook) {
    reviewResult = recordReview(state.notebook, q.id, correct, now);
    if (reviewResult === 'mastered') state.mastered += 1;
  } else if (!correct) {
    addMistake(state.notebook, q, now);
  }
  return reviewResult;
}

/** ステージが終わったときの記録（★・EXのクリア） */
export function recordStage(state, { unitId, stageKind, correct, total, stars }) {
  if (!unitId) return { newStars: false, newEx: false };
  const u = (state.units[unitId] ??= { stars: 0, best: 0, plays: 0, ex: 0 });
  let newStars = false;
  let newEx = false;
  if (stageKind === 'normal') {
    u.plays += 1;
    u.best = Math.max(u.best, correct);
    if (stars > u.stars) {
      u.stars = stars;
      newStars = true;
    }
  }
  const exLevel = { ex1: 1, ex2: 2, ex3: 3 }[stageKind];
  if (exLevel && correct === total && total > 0 && exLevel > u.ex) {
    u.ex = exLevel;
    newEx = true;
  }
  return { newStars, newEx };
}

/** 単元のマスター度（0〜1）。最近の20問の正答率 */
export function unitMastery(state, unitId) {
  const us = state.unitStats[unitId];
  if (!us || us.recent.length === 0) return 0;
  return us.recent.reduce((a, b) => a + b, 0) / us.recent.length;
}

/** 今日の遊べる残り時間（秒）。制限なしなら Infinity */
export function remainingSeconds(state, now) {
  const limit = state.settings.limitMin;
  if (!limit) return Infinity;
  const today = dateKey(now);
  const extra = state.extra.date === today ? state.extra.min : 0;
  const used = state.days[today]?.sec ?? 0;
  return (limit + extra) * 60 - used;
}
