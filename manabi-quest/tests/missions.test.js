// きょうのミッション・がんばりスタンプ・つぎの なかま

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planMissions,
  ensureMissions,
  missionsOnAnswer,
  missionsOnStage,
  claimMission,
  missionText,
  stampDay,
  weekStamps,
  weekStartKey,
  nextStampGoal,
  ALL_CLEAR_BONUS,
  MISSION_KINDS,
  STAMP_GOALS,
} from '../public/js/game/missions.js';
import { defaultState, mergeWithDefaults, dateKey } from '../public/js/game/state.js';
import { nextFriendGoal } from '../public/js/game/shop.js';

const SUBJECTS = ['kokugo', 'sansu', 'rika', 'shakai', 'eigo'];
const INFO = { dueCount: 0, furikaeri: false, golden: true, subjectIds: SUBJECTS, weakSubject: null, dailyDone: false };
// 2026年9月28日（月）のお昼
const MON = new Date(2026, 8, 28, 12).getTime();
const DAY = 86400000;

function withMissions(kinds, now = MON) {
  const st = defaultState();
  st.missions = {
    date: dateKey(now),
    bonus: false,
    list: kinds.map((kind) => ({ kind, goal: MISSION_KINDS[kind].goal, coins: MISSION_KINDS[kind].coins, n: 0, done: false, claimed: false, seen: [], ...(kind === 'subject' ? { subject: 'rika' } : {}) })),
  };
  return st;
}

test('ミッション：日づけで決まる3つ（同じ日は同じ、1つずつ ちがう種類）', () => {
  const a = planMissions('2026-09-28', INFO);
  assert.deepEqual(planMissions('2026-09-28', INFO), a, '同じ日は同じ');
  assert.equal(a.length, 3);
  for (let d = 1; d <= 60; d += 1) {
    const date = dateKey(MON + d * DAY);
    const list = planMissions(date, INFO);
    const kinds = list.map((m) => m.kind);
    assert.equal(new Set(kinds).size, 3, `${date} ${kinds}`);
    assert.ok(['stages', 'correct'].includes(kinds[0]));
    assert.ok(['combo', 'perfect', 'ex', 'golden'].includes(kinds[1]));
    for (const m of list) {
      assert.ok(missionText(m, (id) => id).length > 3);
      assert.equal(m.n, 0);
      if (m.kind === 'subject') assert.ok(SUBJECTS.includes(m.subject));
    }
  }
  // いろいろな日で、いろいろなミッションが出る
  const all = new Set();
  for (let d = 0; d < 60; d += 1) planMissions(dateKey(MON + d * DAY), { ...INFO, dueCount: 5, furikaeri: true }).forEach((m) => all.add(m.kind));
  for (const k of Object.keys(MISSION_KINDS)) assert.ok(all.has(k), `${k} も出る`);
});

test('ミッション：学習に役立つものを多めに（できないミッションは出さない）', () => {
  const count = (info, kind) => {
    let n = 0;
    for (let d = 0; d < 200; d += 1) if (planMissions(dateKey(MON + d * DAY), info).some((m) => m.kind === kind)) n += 1;
    return n;
  };
  assert.equal(count({ ...INFO, dueCount: 2 }, 'review'), 0, 'ノートの問題が3問ないときは ふくしゅうミッションなし');
  assert.ok(count({ ...INFO, dueCount: 3 }, 'review') > 40, 'ノートに問題があれば よく出る');
  assert.equal(count(INFO, 'furikaeri'), 0, 'つまずいていなければ ふりかえりミッションなし');
  assert.ok(count({ ...INFO, furikaeri: true }, 'furikaeri') > 40);
  assert.equal(count({ ...INFO, golden: false }, 'golden'), 0, 'ゴールデン問題がオフなら 出さない');
  assert.equal(count({ ...INFO, dailyDone: true }, 'daily'), 0, 'きょうの5教科が おわっていれば 出さない');
  const weak = planMissionsUntil('subject', { ...INFO, weakSubject: 'shakai' });
  assert.equal(weak.subject, 'shakai', 'にがてな教科の ミッション');
  const none = planMissions('2026-09-28', { subjectIds: [] });
  assert.equal(new Set(none.map((m) => m.kind)).size, 3, '情報が少なくても3つ');
});

function planMissionsUntil(kind, info) {
  for (let d = 0; d < 400; d += 1) {
    const m = planMissions(dateKey(MON + d * DAY), info).find((x) => x.kind === kind);
    if (m) return m;
  }
  throw new Error(`${kind} が出ない`);
}

test('ミッション：答えやステージで すすみ、クリアした ときに1回だけ知らせる', () => {
  const st = withMissions(['correct', 'combo', 'review']);
  const ans = (o) => missionsOnAnswer(st, MON, { correct: true, combo: 1, subject: 'rika', ...o });
  for (let i = 0; i < 14; i += 1) assert.deepEqual(ans({}), []);
  assert.deepEqual(ans({}).map((m) => m.kind), ['correct'], '15問目で クリア');
  assert.deepEqual(ans({}), [], '2回は知らせない');
  assert.equal(st.missions.list[0].n, 15, 'ゴールより ふえない');
  assert.deepEqual(missionsOnAnswer(st, MON, { correct: false, combo: 9 }), [], 'まちがいでは すすまない');
  assert.deepEqual(ans({ combo: 4 }), []);
  assert.deepEqual(ans({ combo: 5 }).map((m) => m.kind), ['combo'], '5れんぞくで フィーバー');
  ans({ fromNotebook: true });
  ans({ fromNotebook: true });
  assert.equal(st.missions.list[2].n, 2);
  assert.deepEqual(ans({ fromNotebook: true }).map((m) => m.kind), ['review']);
  // ほかの日づけのミッションは すすまない
  const other = withMissions(['correct'], MON - DAY);
  assert.deepEqual(missionsOnAnswer(other, MON, { correct: true }), []);
  assert.equal(other.missions.list[0].n, 0);
});

test('ミッション：ステージのクリア（★1つ以上）・パーフェクト・3つの教科・ふりかえり など', () => {
  const st = withMissions(['stages', 'subjects', 'perfect']);
  const stage = (o) => missionsOnStage(st, MON, { stageKind: 'normal', stars: 1, perfect: false, subject: 'rika', ...o });
  assert.deepEqual(stage({ stars: 0 }), [], '★0は クリアではない');
  stage({});
  stage({ stageKind: 'revenge', stars: 3, perfect: true, subject: 'sansu' });
  assert.equal(st.missions.list[0].n, 1, 'リベンジは 数えない');
  stage({ subject: 'rika' });
  assert.equal(st.missions.list[1].n, 1, '同じ教科は1つ');
  assert.deepEqual(stage({ subject: '', stageKind: 'review' }).map((m) => m.kind), ['stages']);
  assert.equal(st.missions.list[1].n, 1, 'ふくしゅうは 教科に 数えない');
  stage({ subject: 'sansu' });
  assert.deepEqual(stage({ subject: 'eigo', stars: 3, perfect: true }).map((m) => m.kind), ['subjects', 'perfect']);

  const st2 = withMissions(['ex', 'furikaeri', 'daily']);
  const stage2 = (o) => missionsOnStage(st2, MON, { stageKind: 'normal', stars: 1, perfect: false, subject: 'sansu', ...o });
  assert.deepEqual(stage2({}), []);
  assert.deepEqual(stage2({ stageKind: 'ex1', stars: 0 }).map((m) => m.kind), ['ex'], 'EXは ちょうせんすれば OK');
  assert.deepEqual(stage2({ furikaeri: true }).map((m) => m.kind), ['furikaeri']);
  assert.deepEqual(stage2({ stageKind: 'daily', subject: '' }).map((m) => m.kind), ['daily']);
});

test('ミッション：うけとる → 3つ ぜんぶで ボーナス。うけとりわすれは つぎの日に自動で', () => {
  const st = withMissions(['correct', 'combo', 'golden']);
  assert.deepEqual(claimMission(st, 0, MON), { coins: 0, bonus: 0 }, 'まだ クリアしていない');
  st.missions.list.forEach((m) => {
    m.n = m.goal;
    m.done = true;
  });
  assert.deepEqual(claimMission(st, 0, MON), { coins: 20, bonus: 0 });
  assert.deepEqual(claimMission(st, 0, MON), { coins: 0, bonus: 0 }, '2回は うけとれない');
  assert.deepEqual(claimMission(st, 1, MON), { coins: 30, bonus: 0 });
  assert.deepEqual(claimMission(st, 2, MON), { coins: 30, bonus: ALL_CLEAR_BONUS });
  assert.equal(st.coins, 20 + 30 + 30 + ALL_CLEAR_BONUS);
  assert.equal(st.totalEarned, st.coins);

  const st2 = withMissions(['correct', 'combo', 'golden'], MON - DAY);
  st2.missions.list[0].done = true;
  st2.missions.list[1].done = true;
  st2.missions.list[1].claimed = true;
  const res = ensureMissions(st2, MON, INFO);
  assert.deepEqual(res, { fresh: true, carried: 20 }, 'うけとっていない分だけ');
  assert.equal(st2.coins, 20);
  assert.equal(st2.missions.date, dateKey(MON));
  assert.equal(st2.missions.list.length, 3);
  assert.deepEqual(ensureMissions(st2, MON + 1000, INFO), { fresh: false, carried: 0 }, '同じ日は そのまま');

  const st3 = withMissions(['correct', 'combo', 'golden'], MON - DAY);
  st3.missions.list.forEach((m) => (m.done = true));
  assert.equal(ensureMissions(st3, MON, INFO).carried, 20 + 30 + 30 + ALL_CLEAR_BONUS, 'ぜんぶ クリアしていれば ボーナスも');
});

test('がんばりスタンプ：ステージをクリアした日に1つ。1週間で 3日・5日・7日の ボーナス', () => {
  const st = defaultState();
  assert.equal(weekStartKey(MON), '2026-09-28');
  assert.equal(weekStartKey(MON + 6 * DAY), '2026-09-28', '日曜日までは 同じ週');
  assert.equal(weekStartKey(MON + 7 * DAY), '2026-10-05');
  const first = stampDay(st, MON);
  assert.deepEqual(first, { newStamp: true, count: 1, rewards: [] });
  assert.deepEqual(stampDay(st, MON + 1000), { newStamp: false, count: 1, rewards: [] }, '同じ日は1つだけ');
  assert.equal(st.days[dateKey(MON)].stages, 2, 'クリアした数は 数える');
  stampDay(st, MON + DAY);
  const third = stampDay(st, MON + 3 * DAY);
  assert.deepEqual(third.rewards, [STAMP_GOALS[0]], '3日目で ボーナス（つづけてでなくても OK）');
  assert.equal(st.coins, STAMP_GOALS[0].coins);
  const days = weekStamps(st, MON + 3 * DAY);
  assert.deepEqual(days.map((d) => d.stamped), [true, true, false, true, false, false, false]);
  assert.deepEqual(days.map((d) => d.label), ['月', '火', '水', '木', '金', '土', '日']);
  assert.equal(days.findIndex((d) => d.today), 3);
  assert.deepEqual(days.map((d) => d.future), [false, false, false, false, true, true, true]);
  stampDay(st, MON + 4 * DAY);
  assert.deepEqual(stampDay(st, MON + 5 * DAY).rewards, [STAMP_GOALS[1]], '5日目で ボーナス');
  assert.deepEqual(stampDay(st, MON + 6 * DAY), { newStamp: true, count: 6, rewards: [] }, '水曜日を休んだので 7日は なし');
  assert.equal(st.coins, 30 + 60);
  // つぎの週は また 0 から（前の週の分は へらない）。7日 ぜんぶで 3つのボーナス
  const next = stampDay(st, MON + 7 * DAY);
  assert.deepEqual(next, { newStamp: true, count: 1, rewards: [] });
  const got = [];
  for (let d = 8; d <= 13; d += 1) got.push(...stampDay(st, MON + d * DAY).rewards);
  assert.deepEqual(got, STAMP_GOALS);
  assert.equal(st.coins, 90 + 30 + 60 + 100);
  assert.deepEqual(st.week, { start: '2026-10-05', got: [3, 5, 7] });
  assert.equal(nextStampGoal(0).days, 3);
  assert.equal(nextStampGoal(4).days, 5);
  assert.equal(nextStampGoal(7), null);
});

test('保存データ：ミッション・スタンプ・設定がこわれていても 読みこめる', () => {
  const now = Date.now();
  const bad = mergeWithDefaults(
    { missions: { date: 5, list: 'x' }, week: { start: 3, got: [3, 'x', 9, 3] }, settings: { golden: 'yes' }, days: { [dateKey(now)]: { sec: 1, stages: -2 } } },
    defaultState(),
  );
  assert.deepEqual(bad.missions, { date: '', list: [], bonus: false });
  assert.deepEqual(bad.week, { start: '', got: [3] });
  assert.equal(bad.settings.golden, true);
  assert.equal(bad.days[dateKey(now)].stages, 0);
  const half = mergeWithDefaults(
    { missions: { date: '2026-09-28', bonus: 'no', list: [{ kind: 'correct', goal: 15, coins: 20, n: 99, claimed: 1 }] } },
    defaultState(),
  );
  assert.deepEqual(half.missions.list[0], { kind: 'correct', goal: 15, coins: 20, n: 15, done: true, claimed: false, seen: [] });
  assert.equal(half.missions.bonus, false);
  const broken = mergeWithDefaults({ missions: { date: '2026-09-28', list: [{ kind: 'correct' }] } }, defaultState());
  assert.deepEqual(broken.missions.list, [], 'ゴールのないミッションがあれば 作りなおす');
  // 前の版の記録（ミッションなし）でも ミッションを作れる
  const old = mergeWithDefaults({ coins: 10 }, defaultState());
  assert.equal(ensureMissions(old, now, INFO).fresh, true);
  assert.equal(old.missions.list.length, 3);
});

test('つぎの なかま：いちばん安い まだの子と、あと何コインか', () => {
  const st = defaultState();
  st.coins = 40;
  const g = nextFriendGoal(st);
  assert.equal(g.friend.id, 'koala');
  assert.equal(g.need, 60);
  assert.equal(g.affordable, false);
  assert.ok(Math.abs(g.progress - 0.4) < 1e-9);
  st.coins = 150;
  st.friends.push('koala');
  assert.equal(nextFriendGoal(st).friend.id, 'usagi');
  assert.equal(nextFriendGoal(st).affordable, true);
});
