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
    daily: { date: '', cleared: false },
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
  return sanitizeState(out, defaults);
}

// ---------- 読みこんだデータの中身をととのえる（こわれた記録があっても起動できるように） ----------

const EFFECT_LEVELS = ['calm', 'normal', 'exciting'];

/** 0以上の有限の数（ちがえば def）。max をこえたら max */
function count(v, def = 0, max = Infinity) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : def;
}

/** id → 記録 のマップを、1件ずつ fix で直す（fix が null を返したら捨てる） */
function mapRecords(obj, fix) {
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    const fixed = isPlainObject(val) ? fix(val, key) : null;
    if (fixed) out[key] = fixed;
  }
  return out;
}

/** ノートに入っている問題が、出題できる形か */
function playableQuestion(q, key) {
  if (!isPlainObject(q) || q.id !== key || typeof q.q !== 'string') return false;
  if (q.kind === 'choice') return Array.isArray(q.choices) && q.choices.includes(q.answer);
  if (q.kind === 'input') return Array.isArray(q.fields) && q.fields.length > 0 && q.fields.every(isPlainObject);
  if (q.kind === 'hissan') return isPlainObject(q.hissan);
  return false;
}

function fixNotebookEntry(e, key) {
  if (!playableQuestion(e.q, key)) return null;
  const now = Date.now();
  return {
    ...e,
    box: Math.floor(count(e.box, 0, 3)),
    due: count(e.due, now),
    wrong: count(e.wrong, 1),
    added: count(e.added, now),
    last: count(e.last, now),
  };
}

export function sanitizeState(st, defaults = defaultState()) {
  st.coins = count(st.coins);
  st.totalEarned = Math.max(count(st.totalEarned), st.coins);
  st.mastered = count(st.mastered);
  st.friends = [...new Set(['pao', ...st.friends.filter((f) => typeof f === 'string')])];
  st.themes = [...new Set(['sky', ...st.themes.filter((t) => typeof t === 'string')])];
  if (!st.friends.includes(st.partner)) st.partner = 'pao';
  if (!st.themes.includes(st.theme)) st.theme = 'sky';
  st.units = mapRecords(st.units, (u) => ({
    ...u,
    stars: Math.floor(count(u.stars, 0, 3)),
    best: count(u.best),
    plays: count(u.plays),
    ex: Math.floor(count(u.ex, 0, 3)),
  }));
  st.qstats = mapRecords(st.qstats, (q) => ({ n: count(q.n), c: count(q.c), last: q.last === 0 ? 0 : 1 }));
  st.subjects = mapRecords(st.subjects, (x) => ({ n: count(x.n), c: count(x.c) }));
  st.unitStats = mapRecords(st.unitStats, (x) => ({
    n: count(x.n),
    c: count(x.c),
    recent: Array.isArray(x.recent) ? x.recent.filter((v) => v === 0 || v === 1).slice(-RECENT_LEN) : [],
  }));
  st.notebook = mapRecords(st.notebook, fixNotebookEntry);
  st.days = mapRecords(st.days, (d) => ({ sec: count(d.sec), n: count(d.n), c: count(d.c), coins: count(d.coins) }));

  const set = st.settings;
  const def = defaults.settings;
  set.limitMin = count(set.limitMin, def.limitMin, 24 * 60);
  set.breakMin = count(set.breakMin, def.breakMin, 24 * 60);
  if (!EFFECT_LEVELS.includes(set.effects)) set.effects = def.effects;
  if (typeof set.sound !== 'boolean') set.sound = def.sound;
  if (typeof set.voice !== 'boolean') set.voice = def.voice;

  st.extra = { date: typeof st.extra.date === 'string' ? st.extra.date : '', min: count(st.extra.min) };
  if (st.pin !== null && !(typeof st.pin === 'string' && /^\d{4}$/.test(st.pin))) st.pin = null;
  st.daily = { date: typeof st.daily.date === 'string' ? st.daily.date : '', cleared: st.daily.cleared === true };
  return st;
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
