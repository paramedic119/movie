// 算数の自動生成問題を、たくさん作って答えを別の方法で検算する

import test from 'node:test';
import assert from 'node:assert/strict';
import sansuMain from '../public/js/data/sansu.js';
import sansuFurikaeri from '../public/js/data/sansu-furikaeri.js';
import { createRng } from '../public/js/lib/rng.js';
import { normalizeNumber, decAdd, decSub } from '../public/js/lib/numfmt.js';
import { checkText } from '../scripts/lib/validate-content.mjs';
import { planHissan, createHissan } from '../public/js/ui/hissan.js';
import { parseFraction, fracEq, evalExpr, kanjiToNumber, plain } from './helpers.js';

const N = 400;
// 4年生の単元と、ふりかえり（1〜3年）の単元
const sansu = { units: [...sansuMain.units, ...sansuFurikaeri.units] };
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

test('筆算の入力：まちがえた後に正しく入れたら「まちがい」あつかいにしない', () => {
  const container = { innerHTML: '', querySelector: () => null };
  const events = [];
  const h = createHissan(container, { op: '-', a: '430', b: '36', result: '394' }, {
    onDigit: (result) => events.push(result),
    onComplete: (r) => events.push(r),
  });
  h.input('6'); // 一の位（正しくは 4）
  h.input('4');
  h.input('1'); // 十の位（正しくは 9）
  h.input('1'); // 2回まちがえたら答えを見せて次のけたへ
  h.input('3');
  assert.deepEqual(events, ['wrong', 'fixed', 'wrong', 'shown', 'ok', { correct: false, mistakes: 3 }]);
  assert.equal(h.finished, true);
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

// ---------- 折れ線グラフと表・垂直と平行・変わり方・何倍（2026年9月に追加した単元） ----------

const ans = (q) => (q.kind === 'input' ? Number(q.fields[0].answer) : q.answer);
const DAY = ['午前9時', '午前10時', '午前11時', '正午', '午後1時', '午後2時', '午後3時'];

test('折れ線グラフと表：答えをグラフ・表のデータから計算しなおす', () => {
  let seen = 0;
  for (const q of generated('sansu-graph', [1, 2, 3], 500)) {
    const t = plain(q.q);
    const f = q.figure;
    let m;
    if (f.type === 'line') {
      const { ys, xs } = f;
      const lo = f.yMin ?? 0;
      for (const v of ys) {
        assert.ok(v >= lo && v <= f.yMax, `目もりの中 ${v}`);
        assert.equal((v - lo) % f.yStep, 0, `点は目もりの線の上 ${v}`);
      }
      const year = xs.length === 12;
      const idx = (name) => (year ? Number(name.replace('月', '')) - 1 : DAY.indexOf(name));
      const nameRe = year ? '(\\d+月)' : '(午前\\d+時|正午|午後\\d+時)';
      if ((m = t.match(new RegExp(`${nameRe}の気温は何度`)))) assert.equal(ans(q), ys[idx(m[1])], t);
      else if ((m = t.match(/いちばん(高い|低い|高かった)のは何/))) {
        const best = m[1] === '低い' ? Math.min(...ys) : Math.max(...ys);
        assert.equal(ys.filter((v) => v === best).length, 1, '1つに決まる');
        assert.equal(idx(q.answer), ys.indexOf(best), t);
      } else if ((m = t.match(new RegExp(`${nameRe}から${nameRe}までに、気温は何度(上がり|下がり)`)))) {
        const d = ys[idx(m[2])] - ys[idx(m[1])];
        assert.equal(ans(q), m[3] === '上がり' ? d : -d, t);
        assert.ok(ans(q) > 0, t);
      } else if ((m = t.match(/(上がり|下がり)方がいちばん大きいのは/))) {
        const sign = m[1] === '上がり' ? 1 : -1;
        const diffs = ys.slice(1).map((v, i) => (v - ys[i]) * sign);
        const best = Math.max(...diffs);
        assert.equal(diffs.filter((d) => d === best).length, 1, '1つに決まる');
        const [a, b] = q.answer.split('から');
        assert.equal(idx(a), diffs.indexOf(best), t);
        assert.equal(idx(b), diffs.indexOf(best) + 1, t);
        for (const c of q.choices) if (c !== q.answer) assert.notEqual(idx(c.split('から')[0]), idx(a));
      } else assert.fail(`知らない形の問題: ${t}`);
    } else {
      assert.equal(f.type, 'table');
      const body = f.rows.slice(0, -1).map((r) => r.slice(1, -1).map(Number));
      const rowSum = body.map((r) => r.reduce((a, b) => a + b, 0));
      const colSum = body[0].map((_, c) => body.reduce((a, r) => a + r[c], 0));
      const total = rowSum.reduce((a, b) => a + b, 0);
      f.rows.slice(0, -1).forEach((r, i) => assert.equal(Number(r.at(-1)), rowSum[i], '場所ごとの合計'));
      f.rows.at(-1).slice(1, -1).forEach((v, c) => assert.equal(Number(v), colSum[c], '種類ごとの合計'));
      const place = f.rows.slice(0, -1).map((r) => r[0]);
      const kinds = f.head.slice(1, -1);
      if ((m = t.match(/(校庭|体育館|教室|ろうか)で(すりきず|切りきず|つき指)をした人は/))) {
        assert.equal(ans(q), body[place.indexOf(m[1])][kinds.indexOf(m[2])], t);
      } else if (t.includes('合計）は何人')) {
        assert.equal(f.rows.at(-1).at(-1), '？');
        assert.equal(ans(q), total, t);
      } else if (t.includes('いちばん多い けがの種類')) {
        const best = Math.max(...colSum);
        assert.equal(colSum.filter((v) => v === best).length, 1);
        assert.equal(q.answer, kinds[colSum.indexOf(best)], t);
      } else if (t.includes('いちばん多い場所')) {
        const best = Math.max(...rowSum);
        assert.equal(rowSum.filter((v) => v === best).length, 1);
        assert.equal(q.answer, place[rowSum.indexOf(best)], t);
      } else assert.fail(`知らない形の問題: ${t}`);
    }
    seen += 1;
  }
  assert.ok(seen > 1000);
});

/** 2本の半直線（向きを角度で表す）の間の角を、ベクトルから計算する */
function angleBetween(d1, d2) {
  const r = (d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)];
  const [a, b] = [r(d1), r(d2)];
  return Math.round((Math.acos(a[0] * b[0] + a[1] * b[1]) * 180) / Math.PI);
}

test('垂直・平行と四角形：平行四辺形・ひし形・平行線と角', async () => {
  const { figureSvg } = await import('../public/js/ui/figure.js');
  for (const q of generated('sansu-heikou')) {
    const t = plain(q.q);
    const f = q.figure;
    let m;
    if (q.id.includes('-b-')) continue; // 用語の問題（選択肢の形は全単元のテストで確認）
    if ((m = t.match(/辺(AD|CD)の長さは/))) assert.equal(ans(q), m[1] === 'AD' ? f.b : f.a, t);
    else if (t.includes('角Dの大きさ')) assert.equal(ans(q), f.angle, t);
    else if (t.includes('角Aの大きさ')) assert.equal(ans(q), 180 - f.angle, t);
    else if (t.includes('平行四辺形ABCDの まわり')) assert.equal(ans(q), 2 * (f.a + f.b), t);
    else if ((m = t.match(/^1辺が (\d+)cm のひし形/))) {
      assert.equal(ans(q), 4 * Number(m[1]), t);
      assert.equal(f.a, f.b, 'ひし形の図は4辺が同じ');
    } else if ((m = t.match(/まわりの長さが (\d+)cm の平行四辺形ABCDがあります。辺ABが (\d+)cm/))) {
      assert.equal(ans(q), Number(m[1]) / 2 - Number(m[2]), t);
    } else if (t.includes('直線アとイは平行です')) {
      const { theta } = f;
      // 右=0°、直線の上向き=theta、左=180°、直線の下向き=180+theta
      const rays = { ur: [0, theta], ul: [theta, 180], ll: [180, 180 + theta], lr: [180 + theta, 360] };
      const g = angleBetween(...rays[f.given]);
      assert.equal(ans(q), angleBetween(...rays[f.ask]), t);
      assert.ok(figureSvg(f).includes(`>${g}°<`), '図に書いてある角');
      if (q.level === 2) assert.equal(f.given, f.ask);
      else assert.notEqual(f.given, f.ask);
    } else assert.fail(`知らない形の問題: ${t}`);
    if (f) assert.ok(figureSvg(f).startsWith('<svg'), '図が描ける');
  }
});

/** 1辺1の正方形の集まりのまわりの長さ（外がわの辺を数える） */
function perimeterOf(cells) {
  const has = new Set(cells.map(([x, y]) => `${x},${y}`));
  let n = 0;
  for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!has.has(`${x + dx},${y + dy}`)) n += 1;
  return n;
}

test('変わり方：表と式が合い、答えが正しい', () => {
  for (const q of generated('sansu-kawarikata')) {
    const t = plain(q.q);
    const f = q.figure;
    let m;
    const pairs = f.head.slice(1).map((x, i) => [Number(x), Number(f.rows[0][i + 1])]);
    if (q.kind === 'choice') {
      // 式の選択肢：表のどの組にもあてはまるのは、答えの式だけ
      const holds = (formula) =>
        pairs.every(([a, b]) => {
          const [l, r] = formula.replace(/□/g, `(${a})`).replace(/○/g, `(${b})`).split('＝');
          return evalExpr(l) === evalExpr(r);
        });
      assert.ok(holds(q.answer), `${t} ${q.answer}`);
      for (const c of q.choices) if (c !== q.answer) assert.ok(!holds(c), `${t} ${c} もあてはまる`);
      continue;
    }
    if ((m = t.match(/まわりの長さが (\d+)cm の長方形.*たてが (\d+)cm のとき/))) assert.equal(ans(q), Number(m[1]) / 2 - Number(m[2]), t);
    else if ((m = t.match(/1辺が (\d+)cm のとき、まわり/))) assert.equal(ans(q), 4 * Number(m[1]), t);
    else if ((m = t.match(/まわりの長さが (\d+)cm のとき、1辺/))) assert.equal(ans(q) * 4, Number(m[1]), t);
    else if ((m = t.match(/弟より (\d+)才年上.*弟が (\d+)才のとき/))) assert.equal(ans(q), Number(m[1]) + Number(m[2]), t);
    else if ((m = t.match(/1本 (\d+)円.*[^\d](\d+)本買うと/))) assert.equal(ans(q), Number(m[1]) * Number(m[2]), t);
    else if ((m = t.match(/だんの数が (\d+)だん/))) {
      const n = Number(m[1]);
      const cells = [];
      for (let x = 0; x < n; x += 1) for (let y = 0; y <= x; y += 1) cells.push([x, y]);
      assert.equal(ans(q), perimeterOf(cells), t);
      for (const [k, v] of pairs) {
        const c = [];
        for (let x = 0; x < k; x += 1) for (let y = 0; y <= x; y += 1) c.push([x, y]);
        assert.equal(v, perimeterOf(c), '表の数');
      }
    } else if ((m = t.match(/正方形を (\d+)こつくるとき、ぼうは/))) {
      // ぼうの数 ＝ となりどうしで同じ辺を1本にしたときの辺の数
      const sticks = (k) => {
        const edges = new Set();
        for (let x = 0; x < k; x += 1) ['h' + x + ',0', 'h' + x + ',1', 'v' + x + ',0', 'v' + (x + 1) + ',0'].forEach((e) => edges.add(e));
        return edges.size;
      };
      assert.equal(ans(q), sticks(Number(m[1])), t);
      for (const [k, v] of pairs) assert.equal(v, sticks(k), '表の数');
    } else if ((m = t.match(/水が (\d+)L 入っている水そうに、1分間に (\d+)L ずつ.*[^\d](\d+)分後/))) {
      assert.equal(ans(q), Number(m[1]) + Number(m[2]) * Number(m[3]), t);
    } else assert.fail(`知らない形の問題: ${t}`);
  }
});

test('何倍でくらべる：何倍・もとの大きさ・差と倍のちがい', () => {
  for (const q of generated('sansu-bai')) {
    const t = plain(q.q);
    let m;
    if ((m = t.match(/^(\d+)cm は、(\d+)cm の何倍/))) assert.equal(ans(q) * Number(m[2]), Number(m[1]), t);
    else if ((m = t.match(/^(\d+)cm の (\d+)倍は/))) assert.equal(ans(q), Number(m[1]) * Number(m[2]), t);
    else if ((m = t.match(/長さの (\d+)倍は (\d+)cm です。もとの/))) assert.equal(ans(q) * Number(m[1]), Number(m[2]), t);
    else if ((m = t.match(/赤いゴムは (\d+)cm が (\d+)cm に、青いゴムは (\d+)cm が (\d+)cm に/))) {
      const [a1, b1, a2, b2] = m.slice(1, 5).map(Number);
      if (t.includes('ちがい')) {
        assert.equal(b1 - a1, b2 - a2, '差は同じ');
        assert.equal(q.answer, 'どちらも同じ', t);
      } else {
        assert.notEqual(b1 * a2, b2 * a1, '何倍かはちがう');
        assert.equal(q.answer, b1 * a2 > b2 * a1 ? '赤いゴム' : '青いゴム', t);
      }
    } else if ((m = t.match(/青いリボンの (\d+)倍、青いリボンの長さは 黄色いリボンの (\d+)倍/))) {
      assert.equal(ans(q), Number(m[1]) * Number(m[2]), t);
    } else assert.fail(`知らない形の問題: ${t}`);
  }
});

// ---------- ふりかえり（1〜3年） ----------

test('ふりかえりの単元：学年の表示がある', () => {
  for (const u of sansuFurikaeri.units) {
    assert.ok([1, 2, 3].includes(u.grade), u.id);
    if (u.gradeLabel) assert.match(u.gradeLabel, /^[1-3](・[1-3])?年$/, u.id);
  }
  const ids = sansu.units.map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length, '単元IDが重複しない');
});

test('九九とかけ算：答えが正しい', () => {
  for (const q of generated('sansu-kuku')) {
    const t = plain(q.q);
    const b = plain(q.big ?? '');
    let m;
    if ((m = b.match(/^(\d+) × (\d+)$/))) assert.equal(ans(q), Number(m[1]) * Number(m[2]), b);
    else if ((m = b.match(/^□ × (\d+) ＝ (\d+)$/))) assert.equal(ans(q) * Number(m[1]), Number(m[2]), b);
    else if ((m = b.match(/^(\d+) × □ ＝ (\d+)$/))) assert.equal(ans(q) * Number(m[1]), Number(m[2]), b);
    else if ((m = t.match(/^1こ (\d+)円のおかしを (\d+)こ買います/))) assert.equal(ans(q), Number(m[1]) * Number(m[2]), t);
    else assert.fail(`知らない形の問題: ${t} ${b}`);
  }
});

test('たし算・ひき算の筆算：答えと、くり上がり・くり下がりがある', () => {
  for (const q of generated('sansu-tashihiki')) {
    assert.equal(q.kind, 'hissan');
    const { op, a, b, result } = q.hissan;
    const want = op === '+' ? BigInt(a) + BigInt(b) : BigInt(a) - BigInt(b);
    assert.equal(result, String(want), `${a} ${op} ${b}`);
    assert.ok(want > 0n);
    const plan = planHissan(q.hissan);
    assert.ok(Object.keys(plan.hints).length > 0, `くり上がり・くり下がりがある ${a} ${op} ${b}`);
    // 1けたずつ正しく入れると、せいかいで終わる
    let done = null;
    const h = createHissan({ innerHTML: '', querySelector: () => null }, q.hissan, { onComplete: (r) => (done = r) });
    for (const d of result.split('').reverse()) h.input(d);
    assert.deepEqual(done, { correct: true, mistakes: 0 }, `${a} ${op} ${b}`);
  }
});

test('わり算とあまり：答えとあまりが正しい', () => {
  for (const q of generated('sansu-amari')) {
    const t = plain(q.q);
    const b = plain(q.big ?? '');
    let m;
    if ((m = b.match(/^(\d+) ÷ (\d+)$/))) {
      const [n, d] = [Number(m[1]), Number(m[2])];
      assert.equal(Number(q.fields[0].answer), Math.floor(n / d), b);
      if (q.fields.length === 2) {
        assert.equal(Number(q.fields[1].answer), n % d, b);
        assert.ok(n % d > 0, 'あまりがある');
      } else assert.equal(n % d, 0, 'わり切れる');
    } else if ((m = b.match(/^(\d+) × (\d+) ＋ (\d+) ＝ □$/))) {
      assert.equal(ans(q), Number(m[1]) * Number(m[2]) + Number(m[3]), b);
      assert.ok(Number(m[3]) < Number(m[1]), 'あまりは わる数より小さい');
    } else if ((m = t.match(/^(\d+)人が、1そうに(\d+)人ずつ/))) assert.equal(ans(q), Math.ceil(Number(m[1]) / Number(m[2])), t);
    else if ((m = t.match(/^(\d+)cmのリボンを、(\d+)cmずつ/))) assert.equal(ans(q), Math.floor(Number(m[1]) / Number(m[2])), t);
    else if ((m = t.match(/^あめが (\d+)こあります。(\d+)人で/))) {
      assert.equal(Number(q.fields[0].answer), Math.floor(Number(m[1]) / Number(m[2])), t);
      assert.equal(Number(q.fields[1].answer), Number(m[1]) % Number(m[2]), t);
    } else assert.fail(`知らない形の問題: ${t} ${b}`);
  }
});

test('長さ・かさ・重さ・時間：たんいと時こくが正しい', () => {
  const PER = { m: { cm: 100 }, cm: { mm: 10 }, km: { m: 1000 }, L: { dL: 10, mL: 1000 }, kg: { g: 1000 }, t: { kg: 1000 }, 分: { 秒: 60 }, 時間: { 分: 60 } };
  const toMin = (s) => {
    if (s === '正午') return 12 * 60;
    const m = s.match(/^(午前|午後)(\d+)時(?:(\d+)分)?$/);
    return (Number(m[2]) + (m[1] === '午後' ? 12 : 0)) * 60 + Number(m[3] ?? 0);
  };
  for (const q of generated('sansu-tani')) {
    const t = plain(q.q);
    let m;
    if ((m = t.match(/^1(m|cm|km|L|kg|t|分|時間) ?は何(cm|mm|m|dL|mL|g|kg|秒|分)ですか/))) assert.equal(ans(q), PER[m[1]][m[2]], t);
    else if ((m = t.match(/^(\d+)(m|cm|km|L|kg) (\d+)(cm|mm|m|dL|mL|g) は何/))) {
      const f = PER[m[2]][m[4]];
      assert.ok(Number(m[3]) < f, '小さいほうのたんいは くり上がらない');
      assert.equal(ans(q), Number(m[1]) * f + Number(m[3]), t);
    } else if ((m = t.match(/^(\d+)(cm|mm|m|dL|mL|g) は何(m|cm|km|L|kg)何/))) {
      const f = PER[m[3]][m[2]];
      assert.equal(Number(q.fields[0].answer) * f + Number(q.fields[1].answer), Number(m[1]), t);
      assert.ok(Number(q.fields[1].answer) < f && Number(q.fields[1].answer) > 0, t);
    } else if ((m = t.match(/^(午前\d+時\d+分)から (\d+)分後の時こくは、午前何時何分/))) {
      const end = toMin(m[1]) + Number(m[2]);
      assert.ok(end < 12 * 60, '午前のうち');
      assert.equal(Number(q.fields[0].answer) * 60 + Number(q.fields[1].answer), end, t);
    } else if ((m = t.match(/^(午前\d+時(?:\d+分)?)から (午前\d+時(?:\d+分)?)までの時間は何分/))) {
      assert.equal(ans(q), toMin(m[2]) - toMin(m[1]), t);
    } else if ((m = t.match(/^(\d+)時間(\d+)分は何分/))) assert.equal(ans(q), Number(m[1]) * 60 + Number(m[2]), t);
    else assert.fail(`知らない形の問題: ${t}`);
  }
});

test('小数・分数のはじめ：答えが正しい', () => {
  const tenths = (s) => Math.round(Number(s) * 10);
  for (const q of generated('sansu-shoubun')) {
    const t = plain(q.q);
    const b = plain(q.big ?? '');
    let m;
    if ((m = t.match(/^0\.1 を (\d+)こ集めた数/))) assert.equal(tenths(q.fields[0].answer), Number(m[1]), t);
    else if ((m = t.match(/^([\d.]+) は、0\.1 を何こ/))) assert.equal(ans(q), tenths(m[1]), t);
    else if ((m = b.match(/^([\d.]+) (＋|−) ([\d.]+)$/))) {
      const want = m[2] === '＋' ? tenths(m[1]) + tenths(m[3]) : tenths(m[1]) - tenths(m[3]);
      assert.equal(tenths(q.fields[0].answer), want, b);
    } else if ((m = q.q.match(/^\[\[1\/(\d+)\]\] の (\d+)こ分/))) {
      assert.ok(fracEq(parseFraction(q.answer), { n: Number(m[2]), d: Number(m[1]) }), q.q);
    } else if ((m = q.q.match(/^1 は、\[\[1\/(\d+)\]\] の何こ分/))) assert.equal(ans(q), Number(m[1]), q.q);
    else if ((m = q.q.match(/^\[\[(\d+)\/(\d+)\]\] と \[\[(\d+)\/(\d+)\]\] では、どちらが大きい/))) {
      assert.equal(m[2], m[4]);
      const big = Math.max(Number(m[1]), Number(m[3]));
      assert.ok(fracEq(parseFraction(q.answer), { n: big, d: Number(m[2]) }), q.q);
    } else if ((m = q.q.match(/^\[\[(\d+)\/(\d+)\]\] ＋ \[\[(\d+)\/(\d+)\]\] は/))) {
      const f = parseFraction(q.answer);
      assert.ok(fracEq(f, { n: Number(m[1]) + Number(m[3]), d: Number(m[2]) }), q.q);
      for (const c of q.choices) if (c !== q.answer) assert.ok(!fracEq(parseFraction(c), f), `${q.q} ${c}`);
    } else if ((m = q.q.match(/^1 − \[\[(\d+)\/(\d+)\]\] は/))) {
      const f = parseFraction(q.answer);
      assert.ok(fracEq(f, { n: Number(m[2]) - Number(m[1]), d: Number(m[2]) }), q.q);
      for (const c of q.choices) if (c !== q.answer) assert.ok(!fracEq(parseFraction(c), f), `${q.q} ${c}`);
    } else assert.fail(`知らない形の問題: ${q.q} ${b}`);
    if (q.kind === 'choice' && /\[\[/.test(q.answer)) {
      for (const c of q.choices) if (c !== q.answer) assert.ok(!fracEq(parseFraction(c), parseFraction(q.answer)), `${q.q} ${c}`);
    }
  }
});

test('円と三角形：答えが正しい', () => {
  for (const q of generated('sansu-zukei')) {
    const t = plain(q.q);
    let m;
    if (q.id.includes('-g-b-')) continue; // 用語の問題
    if ((m = t.match(/^半径が (\d+)cm の円の、直径/))) assert.equal(ans(q), 2 * Number(m[1]), t);
    else if ((m = t.match(/^直径が (\d+)cm の円の、半径/))) assert.equal(ans(q) * 2, Number(m[1]), t);
    else if ((m = t.match(/^1辺が (\d+)cm の正三角形/))) assert.equal(ans(q), 3 * Number(m[1]), t);
    else if ((m = t.match(/^等しい2つの辺が (\d+)cm で、もう1つの辺が (\d+)cm/))) {
      const [e, o] = [Number(m[1]), Number(m[2])];
      assert.ok(o < e * 2, '三角形になる長さ');
      assert.equal(ans(q), 2 * e + o, t);
    } else if ((m = t.match(/^直径 (\d+)cm のボールが (\d+)こ/))) assert.equal(ans(q), Number(m[1]) * Number(m[2]), t);
    else if ((m = t.match(/^横の長さが (\d+)cm の箱に、同じ大きさのボールが (\d+)こ/))) assert.equal(ans(q) * 2 * Number(m[2]), Number(m[1]), t);
    else assert.fail(`知らない形の問題: ${t}`);
  }
});
