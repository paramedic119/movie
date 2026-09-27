// ゲームのしくみ：コイン・★・EX・まちがいノート・ステージの問題えらび・保存・時間

import test from 'node:test';
import assert from 'node:assert/strict';
import { comboMultiplier, coinsForAnswer, starsFor, stageBonus, titleFor, nextExStage, TITLES, comboTier, COMBO_TIERS, FEVER_COMBO } from '../public/js/game/rewards.js';
import { addMistake, recordReview, dueEntries, startOfDay, DAY_MS, NOTEBOOK_LIMIT } from '../public/js/game/review.js';
import { buildStage, buildMixStage, buildReviewStage, buildDailyStage, questionWeight } from '../public/js/game/stage.js';
import { createStore, recordAnswer, recordStage, remainingSeconds, dateKey, mergeWithDefaults, defaultState, STORAGE_KEY } from '../public/js/game/state.js';
import { buyFriend, buyTheme, unlockSecretFriends, FRIENDS, THEMES } from '../public/js/game/shop.js';
import { createPlaytime } from '../public/js/game/playtime.js';
import { createRng } from '../public/js/lib/rng.js';

function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

function bankUnit(id, perLevel = 5) {
  const questions = [];
  for (const level of [1, 2, 3]) {
    for (let i = 0; i < perLevel; i += 1) {
      questions.push({ id: `${id}-${level}${i}`, level, kind: 'choice', q: `Q${level}-${i}`, choices: ['a', 'b', 'c'], answer: 'a', explain: 'e', subject: 'rika', unit: id });
    }
  }
  return { id, subject: 'rika', title: id, questions };
}

test('コンボでコインがふえ、上限は3倍', () => {
  assert.equal(comboMultiplier(1), 1);
  assert.equal(comboMultiplier(2), 1.25);
  assert.equal(comboMultiplier(5), 2);
  assert.equal(comboMultiplier(99), 3);
  const seq = [1, 2, 3, 4, 5].map((c) => coinsForAnswer({ stageKind: 'normal', combo: c }));
  assert.deepEqual(seq, [10, 13, 15, 18, 20]);
  for (let i = 1; i < seq.length; i += 1) assert.ok(seq[i] > seq[i - 1], '正解が続くほど1問のコインがふえる');
  assert.equal(coinsForAnswer({ stageKind: 'ex1', combo: 1 }), 20);
  assert.equal(coinsForAnswer({ stageKind: 'ex3', combo: 12 }), 150);
  assert.equal(coinsForAnswer({ stageKind: 'normal', combo: 1, usedHint: true }), 5, 'ヒントを使うと半分');
});

test('コンボの段階（演出）：3でいいかんじ、5でフィーバー、あとは段階的に', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 7, 8, 10, 11, 14, 30].map(comboTier), [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 5]);
  assert.equal(FEVER_COMBO, 5);
  assert.equal(COMBO_TIERS[comboTier(FEVER_COMBO) - 1].label, 'フィーバー！');
  // 演出の段階はコインの計算を変えない
  assert.equal(coinsForAnswer({ stageKind: 'normal', combo: 5 }), 20);
});

test('★・ボーナス・EXの順番・しょうごう', () => {
  assert.equal(starsFor(5, 5), 3);
  assert.equal(starsFor(4, 5), 2);
  assert.equal(starsFor(3, 5), 1);
  assert.equal(starsFor(2, 5), 0);
  assert.equal(stageBonus('normal', 5, 5), 30);
  assert.equal(stageBonus('normal', 4, 5), 0);
  assert.equal(stageBonus('ex3', 3, 3), 300);
  assert.equal(nextExStage('normal'), 'ex1');
  assert.equal(nextExStage('ex1'), 'ex2');
  assert.equal(nextExStage('ex2'), 'ex3');
  assert.equal(nextExStage('ex3'), null);
  assert.equal(nextExStage('review'), null);
  assert.equal(titleFor(0).current.name, TITLES[0].name);
  const t = titleFor(650);
  assert.equal(t.current.min, 300);
  assert.ok(t.progress > 0 && t.progress < 1);
  assert.equal(titleFor(10 ** 9).next, null);
});

test('まちがいノート：きょう→1日後→3日後→7日後で「おぼえた！」', () => {
  const nb = {};
  const t0 = new Date(2026, 8, 1, 10, 0).getTime();
  addMistake(nb, { id: 'q1', q: 'x', answer: 'a', choices: ['a', 'b'], originalChoices: ['b', 'a'] }, t0);
  assert.deepEqual(nb.q1.q.choices, ['b', 'a'], '出題前の選択肢で保存');
  assert.equal(dueEntries(nb, t0).length, 1, 'すぐ復習できる');
  assert.equal(recordReview(nb, 'q1', true, t0), 'up');
  assert.equal(nb.q1.box, 1);
  assert.equal(nb.q1.due, startOfDay(t0) + DAY_MS, 'つぎは あした');
  assert.equal(dueEntries(nb, t0).length, 0);
  const t1 = startOfDay(t0) + DAY_MS + 3600000;
  assert.equal(dueEntries(nb, t1).length, 1);
  assert.equal(recordReview(nb, 'q1', true, t1), 'up');
  assert.equal(nb.q1.due, startOfDay(t1) + 3 * DAY_MS);
  assert.equal(recordReview(nb, 'q1', false, t1), 'reset', 'まちがえたら最初から');
  assert.equal(nb.q1.box, 0);
  assert.equal(nb.q1.wrong, 2);
  for (const r of ['up', 'up', 'up']) assert.equal(recordReview(nb, 'q1', true, t1), r);
  assert.equal(recordReview(nb, 'q1', true, t1), 'mastered');
  assert.equal(nb.q1, undefined);
  for (let i = 0; i < NOTEBOOK_LIMIT + 20; i += 1) addMistake(nb, { id: `z${i}` }, t0 + i);
  assert.equal(Object.keys(nb).length, NOTEBOOK_LIMIT, 'ノートがふくらみすぎない');
});

test('ステージの問題えらび：レベル・重複なし・EXは同じ流れで出た問題を出さない', () => {
  const rng = createRng(3);
  const unit = bankUnit('rika-a');
  const normal = buildStage({ unit, stageKind: 'normal', rng });
  assert.equal(normal.length, 5);
  assert.deepEqual(normal.map((q) => q.level), [1, 1, 2, 2, 2]);
  assert.equal(new Set(normal.map((q) => q.id)).size, 5);
  const used = new Set(normal.map((q) => q.id));
  const ex1 = buildStage({ unit, stageKind: 'ex1', rng, used });
  assert.equal(ex1.length, 3);
  assert.ok(ex1.every((q) => !used.has(q.id)));
  ex1.forEach((q) => used.add(q.id));
  const ex2 = buildStage({ unit, stageKind: 'ex2', rng, used });
  ex2.forEach((q) => used.add(q.id));
  const ex3 = buildStage({ unit, stageKind: 'ex3', rng, used, siblings: [unit, bankUnit('rika-b')] });
  assert.equal(ex3.length, 3, '問題が足りなければ同じ教科のほかの単元から');
  assert.ok(ex3.every((q) => !used.has(q.id)));
  for (const q of normal) assert.deepEqual([...q.choices].sort(), [...q.originalChoices].sort());
});

test('読み上げ専用の問題は、読み上げが使えない端末では出さない', () => {
  const unit = bankUnit('eigo-l', 5);
  unit.questions = unit.questions.map((q, i) => (i % 2 === 0 ? { ...q, listenOnly: true, speak: 'dog' } : q));
  const rng = createRng(21);
  for (let i = 0; i < 50; i += 1) {
    const qs = buildStage({ unit, stageKind: 'normal', rng, canUse: (q) => !q.listenOnly });
    assert.ok(qs.length > 0 && qs.every((q) => !q.listenOnly));
  }
});

test('前にまちがえた問題・まだ出ていない問題が出やすい', () => {
  assert.ok(questionWeight({ n: 3, c: 2, last: 0 }) > questionWeight(undefined));
  assert.ok(questionWeight(undefined) > questionWeight({ n: 5, c: 5, last: 1 }));
  const unit = bankUnit('rika-w', 10);
  const qstats = {};
  for (const q of unit.questions) qstats[q.id] = { n: 5, c: 5, last: 1 };
  qstats['rika-w-10'] = { n: 1, c: 0, last: 0 };
  let hits = 0;
  const rng = createRng(9);
  for (let i = 0; i < 200; i += 1) if (buildStage({ unit, stageKind: 'normal', rng, qstats }).some((q) => q.id === 'rika-w-10')) hits += 1;
  assert.ok(hits > 150, `まちがえた問題がよく出る（${hits}/200）`);
});

test('ミックスとふくしゅうのステージ', () => {
  const rng = createRng(5);
  const units = [bankUnit('rika-a'), bankUnit('rika-b'), bankUnit('rika-c')];
  const mix = buildMixStage({ units, rng });
  assert.equal(mix.length, 5);
  assert.ok(new Set(mix.map((q) => q.unit)).size >= 2);
  const entries = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ q: { id: `n${i}`, kind: 'choice', choices: ['a', 'b'], answer: 'a' } }));
  const review = buildReviewStage({ entries, rng });
  assert.equal(review.length, 5);
  assert.ok(review.every((q) => q.fromNotebook));
});

test('きょうの5教科：教科ごとに1問ずつ', () => {
  const rng = createRng(11);
  const subjects = ['kokugo', 'sansu', 'rika', 'shakai', 'eigo'].map((sid) => [
    { ...bankUnit(`${sid}-a`), subject: sid, questions: bankUnit(`${sid}-a`).questions.map((q) => ({ ...q, subject: sid })) },
  ]);
  const daily = buildDailyStage({ unitsBySubject: subjects, rng });
  assert.equal(daily.length, 5);
  assert.deepEqual(daily.map((q) => q.subject), ['kokugo', 'sansu', 'rika', 'shakai', 'eigo']);
  assert.equal(stageBonus('daily', 5, 5), 50);
});

test('保存：読みこみ・こわれたデータ・初期値でうめる', () => {
  const storage = memoryStorage();
  const store = createStore({ storage });
  store.update((s) => {
    s.coins = 123;
  });
  const again = createStore({ storage });
  assert.equal(again.state.coins, 123);
  const broken = createStore({ storage: memoryStorage({ [STORAGE_KEY]: '{oops' }) });
  assert.equal(broken.state.coins, 0);
  const merged = mergeWithDefaults({ coins: 'x', settings: { limitMin: 45 }, friends: ['koala'] }, defaultState());
  assert.equal(merged.coins, 0, '型がちがう値は初期値');
  assert.equal(merged.settings.limitMin, 45);
  assert.equal(merged.settings.sound, true, 'たりない設定は初期値');
  assert.deepEqual(merged.friends, ['pao', 'koala']);
  assert.equal(defaultState({ reducedMotion: true }).settings.effects, 'calm', '動きをへらす設定の人は「おだやか」から');
});

test('保存データの一部がこわれていても、読みこんで遊べる', () => {
  const now = Date.now();
  const today = dateKey(now);
  const good = { q: { id: 'rika-a-1', q: 'もんだい', kind: 'choice', choices: ['a', 'b'], answer: 'a' }, box: 1, due: now - 1, wrong: 1, added: now, last: now };
  const raw = {
    coins: -5,
    friends: ['koala', 3, null],
    partner: 'nobody',
    units: { 'rika-a': { stars: 9, ex: '2' }, x: null },
    unitStats: { 'rika-a': { n: 3, c: 2 }, 'rika-b': { recent: [1, 'x', 0] } },
    qstats: { 'rika-a-1': 'oops' },
    notebook: { x: null, y: { q: null }, z: { q: { id: 'other', q: 'a', kind: 'choice', choices: ['a'], answer: 'a' } }, 'rika-a-1': good },
    days: { [today]: { sec: 100 } },
    settings: { limitMin: '30', breakMin: -1, effects: 'wild', sound: 'yes' },
    extra: { date: today },
    pin: 1234,
    daily: null,
  };
  const st = mergeWithDefaults(raw, defaultState());
  assert.equal(st.coins, 0);
  assert.deepEqual(st.friends, ['pao', 'koala']);
  assert.equal(st.partner, 'pao');
  assert.deepEqual(st.units, { 'rika-a': { stars: 3, best: 0, plays: 0, ex: 0 } });
  assert.deepEqual(st.unitStats['rika-a'].recent, []);
  assert.deepEqual(st.unitStats['rika-b'].recent, [1, 0]);
  assert.deepEqual(Object.keys(st.notebook), ['rika-a-1'], '出題できないノートの記録は捨てる');
  assert.deepEqual(st.qstats, {});
  assert.deepEqual(st.days[today], { sec: 100, n: 0, c: 0, coins: 0 });
  assert.equal(st.settings.limitMin, 30);
  assert.equal(st.settings.breakMin, 20);
  assert.equal(st.settings.effects, 'normal');
  assert.equal(st.settings.sound, true);
  assert.equal(st.extra.min, 0);
  assert.equal(st.pin, null);
  assert.deepEqual(st.daily, { date: '', cleared: false });
  // こわれていた記録の上に、ふつうに記録できる
  const q = { id: 'rika-a-2', subject: 'rika', unit: 'rika-a', kind: 'choice', choices: ['a', 'b'], answer: 'a' };
  recordAnswer(st, q, true, now);
  recordAnswer(st, { ...q, unit: 'rika-b' }, false, now);
  assert.equal(remainingSeconds(st, now), 30 * 60 - 100);
  assert.equal(dueEntries(st.notebook, now).length, 2);
});

test('答えの記録：成績・ノート・★・EX', () => {
  const st = defaultState();
  const now = Date.now();
  const q = { id: 'rika-a-1', subject: 'rika', unit: 'rika-a', kind: 'choice', choices: ['a', 'b'], answer: 'a' };
  recordAnswer(st, q, false, now);
  assert.equal(st.qstats['rika-a-1'].last, 0);
  assert.ok(st.notebook['rika-a-1'], 'まちがえたらノートへ');
  recordAnswer(st, { ...q, fromNotebook: true }, true, now);
  assert.equal(st.notebook['rika-a-1'].box, 1);
  assert.equal(st.subjects.rika.n, 2);
  assert.equal(st.days[dateKey(now)].n, 2);
  recordAnswer(st, { ...q, id: 'sansu-x-g-1', generated: true, subject: 'sansu', unit: 'sansu-x' }, true, now);
  assert.equal(st.qstats['sansu-x-g-1'], undefined, '自動生成の問題は1問ずつは記録しない');
  assert.deepEqual(recordStage(st, { unitId: 'rika-a', stageKind: 'normal', correct: 4, total: 5, stars: 2 }), { newStars: true, newEx: false });
  assert.deepEqual(recordStage(st, { unitId: 'rika-a', stageKind: 'normal', correct: 3, total: 5, stars: 1 }), { newStars: false, newEx: false });
  assert.equal(st.units['rika-a'].stars, 2, '★は いちばんよい記録');
  assert.deepEqual(recordStage(st, { unitId: 'rika-a', stageKind: 'ex2', correct: 3, total: 3, stars: 3 }), { newStars: false, newEx: true });
  assert.equal(st.units['rika-a'].ex, 2);
});

test('なかま・きせかえ：決まった値段で買える', () => {
  const st = defaultState();
  st.coins = 150;
  assert.equal(buyFriend(st, 'koala'), true);
  assert.equal(st.coins, 50);
  assert.equal(buyFriend(st, 'koala'), false, '2回は買えない');
  assert.equal(buyFriend(st, 'usagi'), false, 'たりないと買えない');
  assert.equal(buyTheme(st, 'sakura'), false);
  st.coins = 10000;
  assert.equal(buyTheme(st, 'sakura'), true);
  const prices = FRIENDS.map((f) => f.price);
  assert.deepEqual([...prices].sort((a, b) => a - b), prices, '値段は順番に高くなる');
  assert.equal(new Set(FRIENDS.map((f) => f.id)).size, FRIENDS.length);
  assert.equal(THEMES[0].price, 0);
  st.mastered = 10;
  const added = unlockSecretFriends(st, { subjectIds: [], unitIdsBySubject: {} });
  assert.ok(added.some((f) => f.id === 'kame'));
});

test('時間の上限と延長・ひと休みのお知らせ', () => {
  const st = defaultState();
  const now = Date.now();
  st.settings.limitMin = 30;
  st.days[dateKey(now)] = { sec: 29 * 60, n: 0, c: 0, coins: 0 };
  assert.equal(remainingSeconds(st, now), 60);
  st.extra = { date: dateKey(now), min: 15 };
  assert.equal(remainingSeconds(st, now), 16 * 60);
  st.extra = { date: '2000-01-01', min: 15 };
  assert.equal(remainingSeconds(st, now), 60, '延長はその日だけ');
  st.settings.limitMin = 0;
  assert.equal(remainingSeconds(st, now), Infinity);

  let t = now;
  const store = createStore({ storage: memoryStorage() });
  store.state.settings.breakMin = 1;
  const pt = createPlaytime({ store, now: () => t });
  pt.markActive();
  for (let i = 0; i < 61; i += 1) {
    t += 1000;
    pt._tick();
  }
  assert.equal(pt.status().needBreak, true);
  pt.breakShown();
  assert.equal(pt.status().needBreak, false, '同じ区切りでは1回だけ');
  t += 10 * 60 * 1000;
  pt._tick();
  assert.ok(store.state.days[dateKey(t)]?.sec <= 61 + 1, '操作していない時間は数えない');
});
