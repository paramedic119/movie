// ステージを始める（問題をえらんでクイズ画面へ）

import { buildStage, buildMixStage, buildReviewStage, buildDailyStage, prepareForPlay } from '../game/stage.js';
import { dueEntries } from '../game/review.js';
import { toast } from './modal.js';

function begin(ctx, { subjectId, unitId = null, homeUnitId = unitId, unitTitle, stageKind, questions, prev = null }) {
  if (!questions.length) {
    toast('いま出せる問題がありません');
    return false;
  }
  if (ctx.playtime.status().timeUp) {
    ctx.go('#/rest');
    return false;
  }
  ctx.session = {
    subjectId,
    unitId,
    homeUnitId,
    unitTitle,
    stageKind,
    questions,
    index: 0,
    results: [],
    combo: prev?.combo ?? 0,
    maxCombo: prev?.maxCombo ?? 0,
    stageCoins: 0,
    chainCoins: prev?.chainCoins ?? 0,
    used: new Set([...(prev?.used ?? []), ...questions.map((q) => q.id)]),
    mastered: [],
    startedAt: Date.now(),
  };
  ctx.go('#/play');
  return true;
}

export function startUnitStage(ctx, { unitId, stageKind = 'normal', prev = null }) {
  const unit = ctx.unitById(unitId);
  if (!unit) return false;
  const questions = buildStage({
    unit,
    stageKind,
    rng: ctx.rng,
    qstats: ctx.store.state.qstats,
    used: prev?.used ?? new Set(),
    siblings: ctx.subjects[unit.subject]?.units ?? [],
  });
  return begin(ctx, { subjectId: unit.subject, unitId, unitTitle: unit.title, stageKind, questions, prev });
}

export function startMix(ctx, subjectId) {
  const units = ctx.subjects[subjectId]?.units ?? [];
  const questions = buildMixStage({ units, rng: ctx.rng, qstats: ctx.store.state.qstats });
  return begin(ctx, { subjectId, unitTitle: 'ミックスチャレンジ', stageKind: 'mix', questions });
}

export function startReview(ctx) {
  // 問題データがあとで直されていたら、ノートに保存した古い内容ではなく新しい内容で出す
  const entries = dueEntries(ctx.store.state.notebook, ctx.now()).map((e) => {
    const latest = ctx.questionById?.(e.q.id);
    return latest ? { ...e, q: latest } : e;
  });
  const questions = buildReviewStage({ entries, rng: ctx.rng });
  return begin(ctx, { subjectId: 'review', unitTitle: 'まちがいノート', stageKind: 'review', questions });
}

export function startDaily(ctx) {
  const unitsBySubject = ctx.SUBJECTS.map((subj) => ctx.subjects[subj.id]?.units ?? []);
  const questions = buildDailyStage({ unitsBySubject, rng: ctx.rng, qstats: ctx.store.state.qstats });
  return begin(ctx, { subjectId: 'daily', unitTitle: 'きょうの5教科チャレンジ', stageKind: 'daily', questions });
}

/** まちがえた問題にもう一度（その場でのやり直し） */
export function startRevenge(ctx, lastResult) {
  const wrong = lastResult.results.filter((r) => !r.correct).map((r) => r.q);
  const questions = wrong.map((q) => prepareForPlay({ ...q, choices: q.originalChoices ?? q.choices, fromNotebook: false }, ctx.rng));
  return begin(ctx, {
    subjectId: lastResult.subjectId,
    unitId: null,
    homeUnitId: lastResult.homeUnitId,
    unitTitle: lastResult.unitTitle.replace(/（リベンジ）$/, '') + '（リベンジ）',
    stageKind: 'revenge',
    questions,
  });
}
