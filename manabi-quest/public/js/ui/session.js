// ステージを始める（問題をえらんでクイズ画面へ）

import { buildStage, buildMixStage, buildReviewStage, buildDailyStage, prepareForPlay } from '../game/stage.js';
import { dueEntries } from '../game/review.js';
import { GOLDEN_RATE, pickGoldenIndex } from '../game/rewards.js';
import { ensureMissions } from '../game/missions.js';
import { dateKey } from '../game/state.js';
import { toast } from './modal.js';
import { isGrade4 } from '../data/subjects.js';
import { FURIKAERI_FOR, isStruggling } from '../data/furikaeri.js';

/** この端末で出せる問題か（読み上げ専用の問題は、読み上げが使えるときだけ） */
const canUseOn = (ctx) => (q) => !q.listenOnly || ctx.speech.available();

function begin(ctx, { subjectId, unitId = null, homeUnitId = unitId, unitTitle, stageKind, questions, prev = null }) {
  if (!questions.length) {
    toast('いま出せる問題がありません');
    return false;
  }
  if (ctx.playtime.status().timeUp) {
    ctx.go('#/rest');
    return false;
  }
  refreshMissions(ctx);
  // ゴールデン問題（おうちの人の設定でオフにできる。テストでは ctx.goldenRate で決められる）
  const goldenRate = ctx.store.state.settings.golden ? (ctx.goldenRate ?? GOLDEN_RATE) : 0;
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
    golden: pickGoldenIndex(questions.length, stageKind, ctx.rng, goldenRate),
    used: new Set([...(prev?.used ?? []), ...questions.map((q) => q.id)]),
    mastered: [],
    missionsDone: [],
    startedAt: Date.now(),
    startEarned: ctx.store.state.totalEarned, // けっか画面の「しょうごうゲージ」用
  };
  // 前のけっか画面には もどれないようにする（「もどる」でEXステージに何度も入れないように）
  ctx.lastResult = null;
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
    canUse: canUseOn(ctx),
  });
  return begin(ctx, { subjectId: unit.subject, unitId, unitTitle: unit.title, stageKind, questions, prev });
}

export function startMix(ctx, subjectId) {
  const units = (ctx.subjects[subjectId]?.units ?? []).filter(isGrade4);
  const questions = buildMixStage({ units, rng: ctx.rng, qstats: ctx.store.state.qstats, canUse: canUseOn(ctx) });
  return begin(ctx, { subjectId, unitTitle: 'ミックスチャレンジ', stageKind: 'mix', questions });
}

/** ミッションを決めるための情報（学習のためになるミッションを多めに出すため） */
export function missionInfo(ctx) {
  const st = ctx.store.state;
  const subjectIds = ctx.SUBJECTS.map((s) => s.id).filter((id) => (ctx.subjects[id]?.units ?? []).some(isGrade4));
  // にがてな教科：10問以上といて、正答率が7わりより低い教科のうち いちばん低い教科
  let weakSubject = null;
  let worst = 0.7;
  for (const id of subjectIds) {
    const r = st.subjects[id];
    if (r && r.n >= 10 && r.c / r.n < worst) {
      worst = r.c / r.n;
      weakSubject = id;
    }
  }
  const furikaeri = subjectIds.some((id) => ctx.subjects[id].units.some((u) => isGrade4(u) && FURIKAERI_FOR[u.id]?.length && isStruggling(st, u.id)));
  return {
    dueCount: reviewableEntries(ctx).length,
    furikaeri,
    golden: st.settings.golden,
    subjectIds,
    weakSubject,
    dailyDone: st.daily.date === dateKey(ctx.now()) && st.daily.cleared,
  };
}

/** 日づけが変わっていたら、きょうのミッションを作る。自動で うけとったコインを返す */
export function refreshMissions(ctx) {
  const st = ctx.store.state;
  if (st.missions.date === dateKey(ctx.now()) && st.missions.list.length) return 0;
  const info = missionInfo(ctx);
  let carried = 0;
  ctx.store.update((state) => {
    carried = ensureMissions(state, ctx.now(), info).carried;
  });
  return carried;
}

/** きょう ふくしゅうできる問題（この端末で出せるものだけ） */
export function reviewableEntries(ctx) {
  // 問題データがあとで直されていたら、ノートに保存した古い内容ではなく新しい内容で出す
  return dueEntries(ctx.store.state.notebook, ctx.now())
    .map((e) => {
      const latest = ctx.questionById?.(e.q.id);
      return latest ? { ...e, q: latest } : e;
    })
    .filter((e) => canUseOn(ctx)(e.q));
}

export function startReview(ctx) {
  const questions = buildReviewStage({ entries: reviewableEntries(ctx), rng: ctx.rng });
  return begin(ctx, { subjectId: 'review', unitTitle: 'まちがいノート', stageKind: 'review', questions });
}

export function startDaily(ctx) {
  const unitsBySubject = ctx.SUBJECTS.map((subj) => (ctx.subjects[subj.id]?.units ?? []).filter(isGrade4));
  const questions = buildDailyStage({ unitsBySubject, rng: ctx.rng, qstats: ctx.store.state.qstats, canUse: canUseOn(ctx) });
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
