// 算数の自動生成問題を、たくさん作って答えを別の方法で検算する

import test from 'node:test';
import assert from 'node:assert/strict';
import sansu from '../public/js/data/sansu.js';
import { createRng } from '../public/js/lib/rng.js';
import { normalizeNumber, decAdd, decSub } from '../public/js/lib/numfmt.js';
import { checkText } from '../scripts/lib/validate-content.mjs';
import { planHissan } from '../public/js/ui/hissan.js';
import { parseFraction, fracEq, evalExpr, kanjiToNumber, plain } from './helpers.js';

const N = 400;
const unit = (id) => sansu.units.find((u) => u.id === id);

function* generated(id, levels = [1, 2, 3], n = N, seed = 7) {
  const rng = createRng(seed);
  for (const level of levels) for (let i = 0; i < n; i += 1) yield unit(id).generate(level, rng);
}

test('全単元：形・レベル・選択肢・漢字の学年', () => {
  const rng = createRng(2026);
  for (const u of sansu.units) {
    const errs = [];
    checkText(u.title, `${u.id} title`, { errors: errs, required: true });
    checkText(u.description, `${u.id} description`, { errors: errs, required: true });
    for (const level of [1, 2, 3]) {
      for (let i = 0; i < N; i += 1) {
        const q = u.generate(level, rng);
        const where = `${u.id} L${level} ${q.id}`;
        assert.match(q.id, /^sansu-[a-z]+-[gb]-[a-z0-9-]+$/, where);
        assert.ok(q.id.startsWith(`${u.id}-`), where);
        assert.equal(q.level, level, `${where} level`);
        assert.ok(['choice', 'input', 'hissan'].includes(q.kind), where);
        assert.ok(q.q && q.explain, `${where} 問題文と解説`);
        for (const field of ['q', 'big', 'explain', 'hint']) {
          if (q[field] !== undefined) checkText(q[field], `${where} ${field}`, { errors: errs, required: false, max: 220 });
        }
        if (q.kind === 'choice') {
          assert.ok(q.choices.length >= 2 && q.choices.length <= 4, `${where} 選択肢の数 ${q.choices}`);
          assert.equal(new Set(q.choices).size, q.choices.length, `${where} 選択肢が重複 ${q.choices}`);
          assert.ok(q.choices.includes(q.answer), `${where} 答えが選択肢にない`);
          for (const c of q.choices) checkText(c, `${where} choice`, { errors: errs, required: true });
        }
        if (q.kind === 'input') {
          assert.ok(q.fields.length >= 1, where);
          for (const f of q.fields) assert.equal(normalizeNumber(f.answer), f.answer, `${where} 答えは正規化済み ${f.answer}`);
        }
      }
    }
    assert.deepEqual(errs, [], `${u.id} の文字チェック`);
  }
});

test('わり算：商とあまりが正しい', () => {
  for (const q of generated('sansu-warizan')) {
    const text = `${q.big ?? ''} ${q.q}`;
    let m = (q.big ?? '').match(/^(\d+) ÷ (\d+)$/);
    if (m) {
      const [n, d] = [Number(m[1]), Number(m[2])];
      assert.equal(Number(q.fields[0].answer), Math.floor(n / d), text);
      if (q.fields[1]) assert.equal(Number(q.fields[1].answer), n % d, text);
      else assert.equal(n % d, 0, `${text} 商だけの問題はわり切れる`);
      continue;
    }
    if ((m = q.q.match(/^(\d+)まいの色紙を、(\d+)人で/))) {
      const [n, d] = [Number(m[1]), Number(m[2])];
      assert.equal(Number(q.fields[0].answer), Math.floor(n / d), text);
      assert.equal(Number(q.fields[1].answer), n % d, text);
    } else if ((m = q.q.match(/^(\d+)人の子どもが、長いす1きゃくに(\d+)人ずつ/))) {
      const [n, d] = [Number(m[1]), Number(m[2])];
      assert.equal(Number(q.fields[0].answer), Math.ceil(n / d), text);
      assert.notEqual(n % d, 0, `${text} あまりがある問題にする`);
    } else if ((m = q.q.match(/^(\d+)円で、1こ(\d+)円の/))) {
      const [n, d] = [Number(m[1]), Number(m[2])];
      assert.equal(Number(q.fields[0].answer), Math.floor(n / d), text);
    } else {
      assert.fail(`知らない形の問題: ${text}`);
    }
  }
});

test('計算のきまり：式を計算した値と答えが同じ', () => {
  for (const q of generated('sansu-keisan')) {
    const v = evalExpr(q.big);
    assert.ok(Number.isInteger(v) && v > 0, `${q.big} = ${v}`);
    assert.equal(Number(q.fields[0].answer), v, q.big);
  }
});

test('小数の筆算：答えと、けたごとのヒント', () => {
  for (const q of generated('sansu-hissan')) {
    const { op, a, b, result } = q.hissan;
    const expect = op === '+' ? decAdd(a, b, { keepZeros: true }) : decSub(a, b, { keepZeros: true });
    assert.equal(result, expect, `${a} ${op} ${b}`);
    assert.ok(Number(result) > 0, `${a} ${op} ${b} は正の数`);
    assert.equal(normalizeNumber(result), q.answer);
    const plan = planHissan(q.hissan);
    assert.equal(plan.answerExps.length, result.replace('.', '').length, '答えの箱の数');
  }
});

test('筆算のくり下がりヒント（参考動画の 430 − 36 と同じ）', () => {
  const plan = planHissan({ op: '-', a: '430', b: '36', result: '394' });
  assert.deepEqual(plan.hints, { 0: '10', 1: '12', 2: '3' });
  const add = planHissan({ op: '+', a: '147', b: '587', result: '734' });
  assert.deepEqual(add.hints, { 1: '1', 2: '1' });
  const dec = planHissan({ op: '-', a: '5', b: '2.36', result: '2.64' });
  assert.deepEqual(dec.hints, { '-2': '10', '-1': '9', 0: '4' });
});

test('小数のかけ算・わり算：答えが正しい', () => {
  for (const q of generated('sansu-shousuu')) {
    const ans = Number(q.fields[0].answer);
    let m = (q.big ?? '').match(/^([\d.]+) ([×÷]) (\d+)$/);
    if (m) {
      const [x, op, k] = [Number(m[1]), m[2], Number(m[3])];
      const v = op === '×' ? x * k : x / k;
      assert.ok(Math.abs(v - ans) < 1e-9, `${q.big} = ${v} / ${ans}`);
      continue;
    }
    if ((m = q.q.match(/^0\.1 を (\d+)こ 集めた数/))) assert.ok(Math.abs(Number(m[1]) / 10 - ans) < 1e-9, q.q);
    else if ((m = q.q.match(/^([\d.]+) は、0\.1 を何こ/))) assert.equal(Math.round(Number(m[1]) * 10), ans, q.q);
    else if ((m = q.q.match(/^1本 ([\d.]+)L 入りのジュースが (\d+)本/))) assert.ok(Math.abs(Number(m[1]) * Number(m[2]) - ans) < 1e-9, q.q);
    else if ((m = q.q.match(/^([\d.]+)m のリボンを、(\d+)人で/))) assert.ok(Math.abs(Number(m[1]) / Number(m[2]) - ans) < 1e-9, q.q);
    else assert.fail(`知らない形の問題: ${q.q}`);
  }
});

test('分数：答えの大きさが正しく、まちがい選択肢は答えと大きさがちがう', () => {
  for (const q of generated('sansu-bunsuu')) {
    const ans = parseFraction(q.answer);
    if (!ans) {
      assert.equal(q.answer, (q.choices.find((c) => !parseFraction(c)) ?? q.answer), q.q);
      continue;
    }
    const big = q.big ?? '';
    const m = big.match(/^(.+?) ([＋−]) (.+)$/);
    if (m) {
      const x = parseFraction(m[1]);
      const y = parseFraction(m[3]);
      const d = x.d * y.d;
      const n = m[2] === '＋' ? x.n * y.d + y.n * x.d : x.n * y.d - y.n * x.d;
      assert.ok(fracEq(ans, { n, d }), `${big} = ${q.answer}`);
    }
    for (const c of q.choices) {
      if (c === q.answer) continue;
      const f = parseFraction(c);
      if (f) assert.ok(!fracEq(f, ans), `${q.q} ${big}: まちがい選択肢 ${c} が答え ${q.answer} と同じ大きさ`);
    }
  }
});

test('がい数：四捨五入・切り上げ・切り捨て・はんい', () => {
  const roundTo = (n, unit) => Math.floor((n + unit / 2) / unit) * unit;
  const UNIT = { 十: 10, 百: 100, 千: 1000, 一万: 10000 };
  for (const q of generated('sansu-gaisuu')) {
    const t = plain(q.q);
    const ans = Number(q.fields[0].answer);
    let m;
    if ((m = t.match(/^(\d+) を四捨五入して、(十|百|千|一万)の位までのがい数/))) assert.equal(ans, roundTo(Number(m[1]), UNIT[m[2]]), t);
    else if ((m = t.match(/^(\d+) を四捨五入して、上から(\d)けた/))) {
      const n = Number(m[1]);
      assert.equal(ans, roundTo(n, 10 ** (String(n).length - Number(m[2]))), t);
    } else if ((m = t.match(/^(\d+) を切り上げて、百の位/))) assert.equal(ans, Math.ceil(Number(m[1]) / 100) * 100, t);
    else if ((m = t.match(/^(\d+) を切り捨てて、百の位/))) assert.equal(ans, Math.floor(Number(m[1]) / 100) * 100, t);
    else if ((m = t.match(/^四捨五入して(十|百)の位までのがい数にすると (\d+) になる整数のうち、いちばん(小さい|大きい)/))) {
      const u = UNIT[m[1]];
      const target = Number(m[2]);
      assert.equal(roundTo(ans, u), target, `${t} → ${ans}`);
      assert.notEqual(roundTo(m[3] === '小さい' ? ans - 1 : ans + 1, u), target, `${t} はしの数`);
    } else if ((m = t.match(/^(\d+) ＋ (\d+) を、それぞれ四捨五入して(百|千)の位/))) {
      const u = UNIT[m[3]];
      assert.equal(ans, roundTo(Number(m[1]), u) + roundTo(Number(m[2]), u), t);
    } else if ((m = t.match(/^1こ (\d+)円 のおかしを (\d+)こ/))) {
      const p = Number(m[1]);
      const c = Number(m[2]);
      assert.equal(ans, roundTo(p, 10 ** (String(p).length - 1)) * roundTo(c, 10 ** (String(c).length - 1)), t);
    } else assert.fail(`知らない形の問題: ${t}`);
  }
});

test('面積：答えが正しい', () => {
  for (const q of generated('sansu-menseki')) {
    const t = plain(q.q);
    const ans = Number(q.fields[0].answer);
    let m;
    if ((m = t.match(/^たて (\d+)cm、横 (\d+)cm の長方形の面積/))) assert.equal(ans, Number(m[1]) * Number(m[2]), t);
    else if ((m = t.match(/^1辺が (\d+)cm の正方形/))) assert.equal(ans, Number(m[1]) ** 2, t);
    else if ((m = t.match(/^面積が (\d+)cm² で、たてが (\d+)cm/))) assert.equal(ans * Number(m[2]), Number(m[1]), t);
    else if ((m = t.match(/^たて (\d+)m、横 (\d+)m の花だん/))) assert.equal(ans, Number(m[1]) * Number(m[2]), t);
    else if ((m = t.match(/^(\d+)(m²|a|ha|km²) は何 (cm²|m²|a) ですか/))) {
      const F = { 'm²-cm²': 10000, 'a-m²': 100, 'ha-m²': 10000, 'ha-a': 100, 'km²-m²': 1000000 };
      assert.equal(ans, Number(m[1]) * F[`${m[2]}-${m[3]}`], t);
    } else if (t.startsWith('右上が切りとられた形')) {
      const { W, H, w, h } = q.figure;
      assert.equal(ans, W * H - w * h, t);
      assert.ok(w < W && h < H);
    } else if ((m = t.match(/^たて (\d+)m、横 (\d+)cm の長方形/))) assert.equal(ans, Number(m[1]) * 100 * Number(m[2]), t);
    else if ((m = t.match(/^たて (\d+)m、横 (\d+)m の畑の面積は何 a/))) assert.equal(ans * 100, Number(m[1]) * Number(m[2]), t);
    else assert.fail(`知らない形の問題: ${t}`);
  }
});

test('大きな数：数の組み立て・漢字・位・計算', () => {
  for (const q of generated('sansu-ookinakazu')) {
    const t = plain(q.q);
    let m;
    if ((m = t.match(/^1億を(\d+)こ、1万を(\d+)こ/))) {
      assert.equal(BigInt(q.fields[0].answer), BigInt(m[1]) * 10n ** 8n + BigInt(m[2]) * 10n ** 4n, t);
    } else if ((m = t.match(/^1兆を(\d+)こ、1億を(\d+)こ/))) {
      assert.equal(BigInt(q.fields[0].answer), BigInt(m[1]) * 10n ** 12n + BigInt(m[2]) * 10n ** 8n, t);
    } else if (t.startsWith('この数を漢字で')) {
      assert.equal(kanjiToNumber(q.answer), BigInt(q.big.replace(/\s| /g, '')), `${q.big} → ${q.answer}`);
      for (const c of q.choices) if (c !== q.answer) assert.notEqual(kanjiToNumber(c), kanjiToNumber(q.answer));
    } else if ((m = t.match(/^この数の(.+)の位の数字/))) {
      const PLACES = ['一', '十', '百', '千', '一万', '十万', '百万', '千万', '一億', '十億', '百億', '千億', '一兆', '十兆', '百兆', '千兆'];
      const digits = q.big.replace(/\s| /g, '');
      const idx = PLACES.indexOf(m[1]);
      assert.equal(q.fields[0].answer, digits[digits.length - 1 - idx], t);
    }
  }
});
