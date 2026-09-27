// まちがいノート（間をあけて復習する：その日 → 1日後 → 3日後 → 7日後 で「おぼえた！」）

export const DAY_MS = 24 * 60 * 60 * 1000;
export const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7];
export const NOTEBOOK_LIMIT = 300;

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** ノートに保存する問題（出題時のシャッフルなどは入れない） */
export function snapshot(q) {
  const keys = ['id', 'subject', 'unit', 'level', 'kind', 'q', 'big', 'choices', 'answer', 'explain', 'hint', 'speak', 'listenOnly', 'fields', 'hissan', 'figure', 'kanjiQuiz'];
  const out = {};
  for (const k of keys) if (q[k] !== undefined) out[k] = q[k];
  if (q.originalChoices) out.choices = q.originalChoices;
  return out;
}

/** まちがえた問題をノートに入れる（すでにあれば最初の箱にもどす） */
export function addMistake(notebook, q, now) {
  const prev = notebook[q.id];
  notebook[q.id] = {
    q: snapshot(q),
    box: 0,
    due: now,
    wrong: (prev?.wrong ?? 0) + 1,
    added: prev?.added ?? now,
    last: now,
  };
  trimNotebook(notebook);
}

/**
 * 復習の結果をノートに反映する。
 * @returns {'mastered'|'up'|'reset'|'none'}
 */
export function recordReview(notebook, id, correct, now) {
  const e = notebook[id];
  if (!e) return 'none';
  e.last = now;
  if (!correct) {
    e.box = 0;
    e.due = now;
    e.wrong += 1;
    return 'reset';
  }
  e.box += 1;
  if (e.box >= REVIEW_INTERVAL_DAYS.length) {
    delete notebook[id];
    return 'mastered';
  }
  e.due = startOfDay(now) + REVIEW_INTERVAL_DAYS[e.box] * DAY_MS;
  return 'up';
}

/** 今日ふくしゅうする問題（古い順・まちがいの多い順） */
export function dueEntries(notebook, now) {
  return Object.values(notebook)
    .filter((e) => e.due <= now)
    .sort((a, b) => a.due - b.due || b.wrong - a.wrong);
}

export function upcomingEntries(notebook, now) {
  return Object.values(notebook)
    .filter((e) => e.due > now)
    .sort((a, b) => a.due - b.due);
}

function trimNotebook(notebook) {
  const ids = Object.keys(notebook);
  if (ids.length <= NOTEBOOK_LIMIT) return;
  ids
    .sort((a, b) => notebook[a].last - notebook[b].last)
    .slice(0, ids.length - NOTEBOOK_LIMIT)
    .forEach((id) => delete notebook[id]);
}
