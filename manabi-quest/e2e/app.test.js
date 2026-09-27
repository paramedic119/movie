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

async function openApp({ width = 390, height = 844, init } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
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

/** 今の問題に答える（correct=false ならわざとまちがえる） */
async function answer(page, correct = true) {
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
  await page.click('[data-act="next"]');
  return q;
}

async function playStage(page, n, correct = true) {
  for (let i = 0; i < n; i += 1) await answer(page, typeof correct === 'function' ? correct(i) : correct);
  await page.waitForFunction(() => location.hash === '#/result');
}

const coins = (page) => page.evaluate(() => globalThis.__mq.store.state.coins);

test('ホーム：5教科がそろっていて、エラーが出ない', async () => {
  const { page, errors, context } = await openApp();
  const cards = await page.$$('.subject-card:not([disabled])');
  assert.equal(cards.length, 5);
  assert.deepEqual(errors, []);
  await context.close();
});

for (const subject of ['kokugo', 'sansu', 'rika', 'shakai', 'eigo']) {
  test(`${subject}：全問正解で EX ステージに進め、コインがふえる`, async () => {
    const { page, errors, context } = await openApp();
    await page.click(`.subject-card[data-id="${subject}"]`);
    const units = await page.$$eval('.unit-card', (els) => els.map((e) => e.dataset.id));
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
    localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, settings: { limitMin: 15 }, days: { [key]: { sec: 15 * 60, n: 3, c: 2, coins: 30 } } }));
  };
  const { page, context } = await openApp({ init });
  await page.waitForSelector('.rest-card');
  assert.equal(await page.evaluate(() => location.hash), '#/rest');
  await page.goto(`${BASE}?debug#/subject/sansu`);
  await page.waitForSelector('.rest-card');
  assert.equal(await page.$('.unit-card'), null, 'ほかの画面には行けない');
  await context.close();
});

test('おうちの方ページ：暗証番号と設定（演出を おだやかに）', async () => {
  const { page, context } = await openApp();
  await page.click('[data-tab="parent"]');
  await page.fill('input[name="pin"]', '2468');
  await page.fill('input[name="pin2"]', '2468');
  await page.click('.gate__form button[type="submit"]');
  await page.waitForSelector('.kpi-row');
  await page.click('.seg__opt:has(input[value="calm"])');
  await page.waitForFunction(() => document.body.dataset.effects === 'calm');
  await page.selectOption('select[data-setting="limitMin"]', '45');
  const settings = await page.evaluate(() => globalThis.__mq.store.state.settings);
  assert.equal(settings.effects, 'calm');
  assert.equal(settings.limitMin, 45);
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
    init: () => localStorage.setItem('manabi-quest:v1', JSON.stringify({ v: 1, coins: 500, totalEarned: 500 })),
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
