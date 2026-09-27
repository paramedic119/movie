// ブラウザでアプリを動かして、遊びの流れを通しで確かめる
// 使い方: npm install && npx playwright install chromium && npm run e2e
// （Chromium の場所を指定するときは CHROMIUM_PATH=/path/to/chrome npm run e2e）

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startServer } from '../scripts/serve.mjs';

const PORT = 8900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}/`;
let server;
let browser;

before(async () => {
  server = await startServer(PORT);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // プロキシを使わない（外のサイトへの通信は下の route でとめる）
    args: ['--no-proxy-server'],
  });
});

after(async () => {
  await browser?.close();
  server?.close();
});

const SEEN_GUIDE = () => {
  if (!localStorage.getItem('manabi-quest:v1')) localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, seenGuide: true }));
};

async function openApp({ width = 390, height = 844, init = SEEN_GUIDE, reducedMotion } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...(reducedMotion ? { reducedMotion } : {}) });
  await context.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('net::ERR_FAILED')) errors.push(m.text());
  });
  await page.goto(`${BASE}?debug`);
  await page.waitForSelector('body.ready');
  return { page, errors, context };
}

async function currentQuestion(page) {
  await page.waitForFunction(() => globalThis.__mqQuiz?.question && !globalThis.__mqQuiz.answered);
  return page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__mqQuiz.question)));
}

/** 今の問題に答える（correct=false ならわざとまちがえる。next=false なら「つぎへ」をおさない） */
async function answer(page, correct = true, { next = true } = {}) {
  const q = await currentQuestion(page);
  if (q.kind === 'choice') {
    const idx = correct ? q.choices.indexOf(q.answer) : q.choices.findIndex((c) => c !== q.answer);
    await page.keyboard.press(String(idx + 1));
  } else if (q.kind === 'input') {
    for (let i = 0; i < q.fields.length; i += 1) {
      await page.click(`.field[data-i="${i}"]`);
      const a = q.fields[i].answer;
      await page.keyboard.type(correct ? a : a === '1' ? '2' : '1');
    }
    await page.keyboard.press('Enter');
  } else {
    for (const d of q.hissan.result.replace('.', '').split('').reverse()) {
      const key = correct ? d : d === '1' ? '2' : '1';
      await page.click(`.key[data-k="${key}"]`);
      if (!correct) await page.click(`.key[data-k="${key}"]`);
    }
  }
  await page.waitForSelector('#feedback:not([hidden])');
  const ok = await page.$eval('#feedback', (el) => el.classList.contains('feedback--ok'));
  assert.equal(ok, correct, `答え合わせ: ${q.id}`);
  if (next) await page.click('[data-act="next"]');
  return q;
}

/** ブラウザの「もどる」「すすむ」 */
async function historyGo(page, delta) {
  const from = await page.evaluate(() => location.href);
  await page.evaluate((d) => history.go(d), delta);
  await page.waitForFunction((h) => location.href !== h, from);
}

async function playStage(page, n, correct = true) {
  for (let i = 0; i < n; i += 1) await answer(page, typeof correct === 'function' ? correct(i) : correct);
  await page.waitForFunction(() => location.hash === '#/result');
}

const coins = (page) => page.evaluate(() => globalThis.__mq.store.state.coins);
/** ゴールデン問題を出さない（コインの数を決まった値で確かめるとき） */
const noGolden = (page) => page.evaluate(() => (globalThis.__mq.goldenRate = 0));

/** この端末の きょうの日づけ（'YYYY-MM-DD'） */
const TODAY_KEY = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('ホーム：はじめての案内が出て、5教科がそろっていて、エラーが出ない', async () => {
  const { page, errors, context } = await openApp({ init: null });
  await page.waitForSelector('.modal--guide');
  await page.click('.modal--guide .btn--primary');
  await page.waitForSelector('.modal--guide', { state: 'detached' });
  const cards = await page.$$('.subject-card:not([disabled])');
  assert.equal(cards.length, 5);
  assert.deepEqual(errors, []);
  await context.close();
});

for (const subject of ['kokugo', 'sansu', 'rika', 'shakai', 'eigo']) {
  test(`${subject}：全問正解で EX ステージに進め、コインがふえる`, async () => {
    const { page, errors, context } = await openApp();
    await page.click(`.subject-card[data-id="${subject}"]`);
    // 4年生の単元のうち、いちばん下の単元（ふりかえりの単元は のぞく）
    const units = await page.$$eval('.unit-card:not(.unit-card--review)', (els) => els.map((e) => e.dataset.id));
    assert.ok(units.length >= 5);
    await page.click(`.unit-card[data-id="${units[units.length - 1]}"]`);
    const before0 = await coins(page);
    await playStage(page, 5);
    assert.ok((await coins(page)) > before0, 'コインがふえる');
    await page.waitForSelector('[data-act="ex"]');
    const before1 = await coins(page);
    await page.click('[data-act="ex"]');
    await page.waitForSelector('.stage-tag--ex1');
    await playStage(page, 3);
    assert.match(await page.textContent('.result-title'), /EX 1 クリア/);
    assert.ok((await coins(page)) - before1 >= 60, 'EXは コインが多い');
    await page.waitForSelector('[data-act="ex"]');
    const st = await page.evaluate(() => globalThis.__mq.store.state.units);
    assert.equal(st[units[units.length - 1]].ex, 1);
    assert.equal(st[units[units.length - 1]].stars, 3);
    assert.deepEqual(errors, []);
    await context.close();
  });
}

test('まちがえた問題はノートに入り、ふくしゅうで1だんかい上がる', async () => {
  const { page, context } = await openApp();
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  await playStage(page, 5, (i) => i !== 0);
  assert.equal(await page.$$eval('.mistakes li', (els) => els.length), 1, 'けっか画面に まちがえた問題と解説');
  assert.equal(await page.$('[data-act="ex"]'), null, '全問せいかいでなければ EX はない');
  await page.goto(`${BASE}?debug#/`);
  await page.waitForSelector('.review-cta');
  await page.click('.review-cta');
  const q = await currentQuestion(page);
  assert.ok(q.fromNotebook);
  await answer(page, true);
  const entry = await page.evaluate((id) => globalThis.__mq.store.state.notebook[id], q.id);
  assert.equal(entry.box, 1);
  assert.ok(entry.due > Date.now(), 'つぎは あした以降');
  await context.close();
});

test('きょうの5教科チャレンジ：5教科から1問ずつ、ボーナスは1日1回', async () => {
  const { page, context } = await openApp();
  await noGolden(page);
  await page.click('.daily-cta');
  const subjects = [];
  for (let i = 0; i < 5; i += 1) subjects.push((await answer(page, true)).subject);
  await page.waitForFunction(() => location.hash === '#/result');
  assert.deepEqual([...new Set(subjects)].sort(), ['eigo', 'kokugo', 'rika', 'sansu', 'shakai']);
  assert.ok(await page.$('.notice'), 'クリアのお知らせ');
  const first = await page.evaluate(() => globalThis.__mq.lastResult.bonus);
  assert.equal(first, 50);
  await page.click('[data-act="retry"]');
  await playStage(page, 5);
  assert.equal(await page.evaluate(() => globalThis.__mq.lastResult.bonus), 0, '2回目はボーナスなし');
  await context.close();
});

test('リベンジ：まちがえた問題に その場で もういちど', async () => {
  const { page, context } = await openApp();
  await page.click('.subject-card[data-id="sansu"]');
  await page.click('.unit-card[data-id="sansu-warizan"]');
  await playStage(page, 5, (i) => i >= 2);
  await page.click('[data-act="revenge"]');
  await page.waitForSelector('.stage-tag--revenge');
  await playStage(page, 2);
  assert.match(await page.textContent('.result-title'), /パーフェクト/);
  await context.close();
});

test('記録はページを読みこみなおしても のこる', async () => {
  const { page, context } = await openApp();
  await page.click('.subject-card[data-id="sansu"]');
  await page.click('.unit-card[data-id="sansu-keisan"]');
  await playStage(page, 5);
  const c = await coins(page);
  await page.reload();
  await page.waitForSelector('body.ready');
  assert.equal(await coins(page), c);
  assert.equal(await page.textContent('#hud-coin-count'), c.toLocaleString('ja-JP'));
  await context.close();
});

test('1日の時間になったら「きょうは ここまで」', async () => {
  const init = () => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, seenGuide: true, settings: { limitMin: 15 }, days: { [key]: { sec: 15 * 60, n: 3, c: 2, coins: 30 } } }));
  };
  const { page, context } = await openApp({ init });
  await page.waitForSelector('.rest-card');
  assert.equal(await page.evaluate(() => location.hash), '#/rest');
  await page.goto(`${BASE}?debug#/subject/sansu`);
  await page.waitForSelector('.rest-card');
  assert.equal(await page.$('.unit-card'), null, 'ほかの画面には行けない');
  await context.close();
});

test('おうちの方ページ：暗証番号と設定（演出の強さは えらばない）', async () => {
  const { page, context } = await openApp();
  await page.click('[data-tab="parent"]');
  await page.waitForFunction(() => document.activeElement?.name === 'pin');
  await page.fill('input[name="pin"]', '2468');
  await page.fill('input[name="pin2"]', '2468');
  await page.click('.gate__form button[type="submit"]');
  await page.waitForSelector('.kpi-row');
  assert.equal(await page.$('input[name="effects"]'), null, '演出の強さの設定はない');
  await page.click('input[data-setting="sound"]');
  await page.selectOption('select[data-setting="limitMin"]', '45');
  const settings = await page.evaluate(() => globalThis.__mq.store.state.settings);
  assert.equal(settings.sound, false);
  assert.equal(settings.limitMin, 45);
  assert.equal(settings.effects, undefined);
  await page.click('[data-tab="home"]');
  await page.click('[data-tab="parent"]');
  await page.waitForSelector('.gate');
  await page.fill('input[name="pin"]', '0000');
  await page.click('.gate__form button[type="submit"]');
  assert.equal(await page.$('.kpi-row'), null, 'ちがう番号では ひらかない');
  await context.close();
});

test('なかま：コインで買って パートナーにできる', async () => {
  const { page, context } = await openApp({
    init: () => localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, seenGuide: true, coins: 500, totalEarned: 500 })),
  });
  await page.click('[data-tab="friends"]');
  await page.click('[data-act="buy"][data-id="koala"]');
  await page.click('.modal .btn--primary');
  await page.waitForSelector('.modal .btn--primary');
  await page.click('.modal .btn--primary');
  const st = await page.evaluate(() => globalThis.__mq.store.state);
  assert.equal(st.coins, 400);
  assert.ok(st.friends.includes('koala'));
  assert.equal(st.partner, 'koala');
  await context.close();
});

test('画面を開くときに別の画面へ転送されても、前の画面のボタン操作が残らない', async () => {
  const { page, errors, context } = await openApp({
    init: () => localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, seenGuide: true, friends: ['pao', 'koala'], partner: 'pao' })),
  });
  // 結果のデータがない「けっか画面」→ ホームへ転送される
  await page.goto(`${BASE}?debug#/result`);
  await page.waitForSelector('.hero');
  assert.equal(await page.evaluate(() => location.hash), '#/');
  await page.click('[data-tab="friends"]');
  await page.click('[data-act="partner"][data-id="koala"]');
  await page.waitForFunction(() => globalThis.__mq.store.state.partner === 'koala');
  assert.deepEqual(errors, []);
  await context.close();
});

test('答えたあとに「もどる」→「すすむ」しても、同じ問題に二度は答えられない', async () => {
  const { page, errors, context } = await openApp();
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  const q1 = await answer(page, true, { next: false });
  const coins1 = await coins(page);
  await historyGo(page, -1);
  await page.waitForSelector('.unit-card');
  await historyGo(page, 1);
  const q2 = await currentQuestion(page);
  assert.notEqual(q2.id, q1.id, 'つぎの問題から つづく');
  assert.equal(await page.textContent('#ok-n'), '1');
  assert.equal(await coins(page), coins1, 'もどっただけでは コインはふえない');
  await playStage(page, 4);
  assert.match(await page.textContent('.result-score'), /5\s*\/\s*5/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('EXのとちゅうで「もどる」をおしても、前のけっか画面から EX に入りなおせない', async () => {
  const { page, errors, context } = await openApp();
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  await playStage(page, 5);
  await page.click('[data-act="ex"]');
  await page.waitForSelector('.stage-tag--ex1');
  await answer(page, false, { next: false });
  await historyGo(page, -1);
  await page.waitForSelector('section.home');
  assert.equal(await page.$('[data-act="ex"]'), null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('演出：ラスト1問 → フィーバー → ハンコ・たからばこ・しょうごうゲージ → EXでもフィーバーがつづく', async () => {
  const { page, errors, context } = await openApp({
    init: () => localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, seenGuide: true, coins: 280, totalEarned: 280 })),
  });
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  for (let i = 0; i < 4; i += 1) await answer(page, true);
  await page.waitForSelector('.last-one');
  assert.match(await page.textContent('.last-one'), /あと1問で EXステージ/);
  await answer(page, true, { next: false });
  await page.waitForSelector('.quiz.fever');
  assert.match(await page.textContent('#combo'), /フィーバー/);
  await page.click('[data-act="next"]');
  await page.waitForFunction(() => location.hash === '#/result');
  await page.waitForSelector('.stamp.on');
  assert.match(await page.textContent('.stamp'), /たいへん/);
  await page.waitForSelector('.chest.open');
  await page.waitForSelector('.gauge.up');
  assert.match(await page.textContent('.gauge'), /まなびのひよこ/, '300コインをこえて しょうごうアップ');
  await page.waitForFunction(() => document.querySelector('#res-coins').textContent === String(globalThis.__mq.lastResult.stageCoins + globalThis.__mq.lastResult.bonus));
  await page.click('[data-act="ex"]');
  await page.waitForSelector('.stage-tag--ex1');
  await page.waitForSelector('.quiz.fever');
  await currentQuestion(page);
  assert.deepEqual(errors, []);
  await context.close();
});

test('まちがえると コンボとフィーバーは おわる（コインは へらない）', async () => {
  const { page, context } = await openApp();
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  await playStage(page, 5);
  await page.click('[data-act="ex"]');
  await page.waitForSelector('.quiz.fever');
  const before = await coins(page);
  await answer(page, false, { next: false });
  assert.equal(await page.$('.quiz.fever'), null);
  assert.equal(await coins(page), before);
  await context.close();
});

test('ふりかえり：4年の単元で つまずくと、下の学年の単元をおすすめして そのまま練習できる', async () => {
  const { page, errors, context } = await openApp();
  await page.click('.subject-card[data-id="sansu"]');
  await page.waitForSelector('.review-head');
  const reviewIds = await page.$$eval('.unit-card--review', (els) => els.map((e) => e.dataset.id));
  assert.ok(reviewIds.includes('sansu-kuku') && reviewIds.includes('sansu-amari'), 'ふりかえりの単元がある');
  assert.ok((await page.textContent('.unit-card--review .grade-tag')).includes('年'), '学年の表示');
  await page.click('.unit-card[data-id="sansu-warizan"]');
  await playStage(page, 5, (i) => i >= 2);
  await page.waitForSelector('.furikaeri-card');
  const suggested = await page.$$eval('.furikaeri-btn', (els) => els.map((e) => e.dataset.id));
  assert.deepEqual(suggested, ['sansu-amari', 'sansu-kuku']);
  await page.click('.furikaeri-btn');
  await page.waitForFunction(() => location.hash === '#/play');
  assert.equal(await page.evaluate(() => globalThis.__mq.session.unitId), 'sansu-amari');
  await answer(page, true);
  assert.deepEqual(errors, []);
  await context.close();
});

test('ふりかえり：最近の正答率が低い4年の単元があると、もとになる単元に「おすすめ」がつく', async () => {
  const { page, context } = await openApp({
    init: () =>
      localStorage.setItem(
        'manabi-quest:v1',
        JSON.stringify({ v: 1, seenGuide: true, unitStats: { 'sansu-warizan': { n: 8, c: 3, recent: [0, 1, 0, 0, 1, 0, 1, 0] } } }),
      ),
  });
  await page.click('.subject-card[data-id="sansu"]');
  await page.waitForSelector('.review-head');
  const osusume = await page.$$eval('.unit-card--review', (els) => els.filter((e) => e.querySelector('.tag--osusume')).map((e) => e.dataset.id));
  assert.deepEqual(osusume.sort(), ['sansu-amari', 'sansu-kuku']);
  await context.close();
});

test('スマホのせまい画面（360px）でも 横にはみ出さない', async () => {
  const { page, context } = await openApp({ width: 360, height: 740 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const hash of ['#/', '#/subject/kokugo', '#/subject/sansu', '#/note', '#/friends', '#/friends/theme', '#/parent']) {
    await page.goto(`${BASE}?debug${hash}`);
    await page.waitForSelector('body.ready');
    assert.ok((await overflow()) <= 0, `${hash} が はみ出している`);
  }
  await page.goto(`${BASE}?debug#/subject/sansu`);
  await page.click('.unit-card[data-id="sansu-menseki"]');
  await currentQuestion(page);
  assert.ok((await overflow()) <= 0, 'クイズ画面');
  await playStage(page, 5);
  assert.ok((await overflow()) <= 0, 'けっか画面');
  await context.close();
});

test('ゴールデン問題：金色のカードで、せいかいすると コイン3倍・たからばこは にじ色', async () => {
  const { page, errors, context } = await openApp();
  await page.evaluate(() => (globalThis.__mq.goldenRate = 1));
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  await page.waitForSelector('.qcard');
  const gi = await page.evaluate(() => globalThis.__mq.session.golden);
  assert.ok(gi >= 0 && gi < 5, 'ステージに1問 ゴールデン問題');
  for (let i = 0; i < 5; i += 1) {
    await currentQuestion(page);
    const golden = await page.$('.qcard--golden');
    assert.equal(Boolean(golden), i === gi, `${i + 1}問目`);
    if (i === gi) assert.match(await page.textContent('.golden-tag'), /コイン×3/);
    await answer(page, true, { next: false });
    if (i === gi) assert.match(await page.textContent('#feedback'), /ゴールデン ボーナス/);
    await page.click('[data-act="next"]');
  }
  await page.waitForFunction(() => location.hash === '#/result');
  const r = await page.evaluate(() => {
    const x = globalThis.__mq.lastResult;
    return { coins: x.results.map((y) => y.coins), golden: x.results.map((y) => Boolean(y.golden)), chest: x.chest, bonus: x.bonus };
  });
  // 10コイン × コンボ倍率（1, 1.25, 1.5, 1.75, 2）。ゴールデン問題は さらに3倍（まるめるのは さいご）
  const raw = [10, 12.5, 15, 17.5, 20];
  assert.deepEqual(r.coins, raw.map((c, i) => Math.round(i === gi ? c * 3 : c)), 'ゴールデン問題だけ コイン3倍');
  assert.deepEqual(r.golden, raw.map((_, i) => i === gi));
  assert.equal(r.chest.rank, 4);
  assert.equal(r.bonus, 60);
  assert.ok(await page.$('.chip--golden'));
  // 銅 → 銀 → 金 → にじ と ランクアップしてから ひらく
  await page.waitForSelector('.chest.chest--r1.shown');
  await page.waitForSelector('.chest.chest--r4.open');
  assert.match(await page.textContent('.chest__label'), /60/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('たからばこ：★2なら 銀。あと1問で パーフェクトなら「おしい！」', async () => {
  const { page, context } = await openApp();
  await noGolden(page);
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  await playStage(page, 5, (i) => i !== 2);
  const r = await page.evaluate(() => globalThis.__mq.lastResult);
  assert.equal(r.chest.rank, 2);
  assert.equal(r.bonus, 20);
  await page.waitForSelector('.chest.chest--r2.open');
  assert.match(await page.textContent('.chip--near'), /あと1問で パーフェクト/);
  assert.ok(await page.$('[data-act="retry"].btn--near'), 'もういちど ボタンを目立たせる');
  await context.close();
});

test('EXステージで あと1問だったときは「おしい！」を出さない（もういちど は ふつうのステージになるので）', async () => {
  const { page, context } = await openApp();
  await noGolden(page);
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  await playStage(page, 5);
  await page.click('[data-act="ex"]');
  await page.waitForSelector('.stage-tag--ex1');
  await playStage(page, 3, (i) => i !== 0);
  assert.equal(await page.evaluate(() => globalThis.__mq.lastResult.correct), 2);
  assert.equal(await page.$('.chip--near'), null);
  assert.equal(await page.$('.btn--near'), null);
  await context.close();
});

test('ミッション：クリアすると知らせて、ホームで うけとる。3つ ぜんぶで ボーナス', async () => {
  const init = (key) => {
    if (localStorage.getItem('manabi-quest:v1')) return;
    const m = (kind, goal, coins, n, claimed) => ({ kind, goal, coins, n, done: n >= goal, claimed, seen: [] });
    localStorage.setItem(
      'manabi-quest:v1',
      JSON.stringify({ v: 1, seenGuide: true, missions: { date: key, bonus: false, list: [m('correct', 15, 20, 14, false), m('combo', 1, 30, 1, true), m('golden', 1, 30, 1, true)] } }),
    );
  };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await context.addInitScript(init, TODAY_KEY());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?debug`);
  await page.waitForSelector('.missions');
  assert.equal(await page.$$eval('.mission', (els) => els.length), 3);
  assert.equal(await page.$$eval('.mission.claimed', (els) => els.length), 2);
  assert.equal(await page.$('.btn--claim'), null, 'まだ うけとれない');
  await page.click('.subject-card[data-id="sansu"]');
  await page.click('.unit-card[data-id="sansu-keisan"]');
  await answer(page, true, { next: false });
  await page.waitForSelector('.toast.show');
  assert.match(await page.textContent('.toast'), /ミッション クリア/);
  await page.click('[data-act="quit"]');
  await page.click('.modal .btn--plain');
  await page.click('[data-tab="home"]');
  await page.waitForSelector('.btn--claim');
  const before = await coins(page);
  await page.focus('.btn--claim');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => globalThis.__mq.store.state.missions.bonus === true);
  assert.equal(await page.evaluate(() => document.activeElement?.closest('#missions') !== null), true, 'キーボードの フォーカスが ミッションに のこる');
  assert.equal((await coins(page)) - before, 20 + 50, 'ミッションの20と コンプリートボーナス50');
  assert.equal(await page.$$eval('.mission.claimed', (els) => els.length), 3);
  assert.match(await page.textContent('.missions__foot'), /コンプリート/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('がんばりスタンプ：ステージを クリアした日に1つ（けっか画面と ホームに出る）', async () => {
  const { page, context } = await openApp();
  await noGolden(page);
  assert.equal(await page.$$eval('.stampcard__days li.on', (els) => els.length), 0);
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  await playStage(page, 5, (i) => i !== 0);
  await page.waitForSelector('.stamp-notice__mark.on');
  assert.match(await page.textContent('.stamp-notice'), /スタンプ ゲット/);
  await page.click('[data-act="retry"]');
  await playStage(page, 5, (i) => i !== 0);
  assert.equal(await page.$('.stamp-notice'), null, '同じ日は1つだけ');
  await page.click('[data-act="back"]');
  await page.click('[data-tab="home"]');
  await page.waitForSelector('.stampcard__days li.is-today.on');
  assert.equal(await page.$$eval('.stampcard__days li.on', (els) => els.length), 1);
  await context.close();
});

test('派手な演出：正解で 看板・ふきだし・リボン、EXの入口で ひかりの線とふうせん（いつも出す）', async () => {
  const fxCount = (page) =>
    page.evaluate(() => ({
      sign: document.querySelectorAll('#fx-layer .fx-sign').length,
      pop: document.querySelectorAll('#fx-layer .fx-pop').length,
      streamers: document.querySelectorAll('#fx-layer .fx-streamers').length,
      back: document.querySelectorAll('#fx-back > *').length,
    }));
  const { page, errors, context } = await openApp();
  await noGolden(page);
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  for (let i = 0; i < 3; i += 1) await answer(page, true, { next: i < 2 });
  const lively = await fxCount(page);
  assert.ok(lively.sign >= 1 && lively.pop >= 1, `看板とふきだし ${JSON.stringify(lively)}`);
  await page.waitForSelector('#fx-layer .fx-streamers', { state: 'attached' });
  await page.click('[data-act="next"]');
  await playStage(page, 2);
  await page.click('[data-act="ex"]');
  await page.waitForFunction(() => document.querySelectorAll('#fx-back .fx-balloon, #fx-back .fx-sunburst').length > 0);
  await currentQuestion(page);
  assert.deepEqual(errors, []);
  await context.close();

  // 前の版で「おだやか」にしていた記録・端末の「視差効果を減らす」設定でも、同じように派手に出す
  const old = await openApp({
    reducedMotion: 'reduce',
    init: () => localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, seenGuide: true, settings: { effects: 'calm' } })),
  });
  await noGolden(old.page);
  await old.page.click('.subject-card[data-id="rika"]');
  await old.page.click('.unit-card');
  await answer(old.page, true, { next: false });
  const shown = await fxCount(old.page);
  assert.ok(shown.sign >= 1 && shown.pop >= 1, `看板とふきだし ${JSON.stringify(shown)}`);
  await old.page.waitForSelector('#fx-layer .fx-streamers', { state: 'attached' });
  assert.equal(await old.page.evaluate(() => globalThis.__mq.store.state.settings.effects), undefined);
  assert.deepEqual(old.errors, []);
  await old.context.close();
});

test('おうちの方ページ：ゴールデン問題をオフにできる', async () => {
  const { page, context } = await openApp({
    init: () => localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, seenGuide: true, pin: '1234' })),
  });
  await page.evaluate(() => (globalThis.__mq.goldenRate = 1));
  await page.click('[data-tab="parent"]');
  await page.waitForFunction(() => document.activeElement?.name === 'pin');
  await page.fill('input[name="pin"]', '1234');
  await page.click('.gate__form button[type="submit"]');
  await page.click('input[data-setting="golden"]');
  assert.equal(await page.evaluate(() => globalThis.__mq.store.state.settings.golden), false);
  await page.click('[data-tab="home"]');
  await page.click('.subject-card[data-id="rika"]');
  await page.click('.unit-card');
  await page.waitForSelector('.qcard');
  assert.equal(await page.evaluate(() => globalThis.__mq.session.golden), -1, 'オフなら 出ない');
  await context.close();
});
