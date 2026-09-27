import test from 'node:test';
import assert from 'node:assert/strict';
import { KANJI_BY_GRADE, kanjiGrade, isKanji } from '../public/js/data/kanji-grades.js';
import { parseMarkup, renderMarkup, plainText, textOutsideRuby } from '../public/js/lib/markup.js';
import {
  normalizeNumber,
  groupBy4,
  toMixedJa,
  toKanjiJa,
  decAdd,
  decSub,
  decMul,
  decDivExact,
} from '../public/js/lib/numfmt.js';
import { createRng } from '../public/js/lib/rng.js';
import { kanjiToNumber, evalExpr } from './helpers.js';

test('学年別漢字配当表：1〜4年の字数が正しい', () => {
  assert.equal([...KANJI_BY_GRADE[1]].length, 80);
  assert.equal([...KANJI_BY_GRADE[2]].length, 160);
  assert.equal([...KANJI_BY_GRADE[3]].length, 200);
  assert.equal([...KANJI_BY_GRADE[4]].length, 202);
  const all = Object.values(KANJI_BY_GRADE).join('');
  assert.equal(new Set(all).size, 642, '学年をまたいだ重複がない');
  assert.equal(kanjiGrade('一'), 1);
  assert.equal(kanjiGrade('億'), 4);
  assert.equal(kanjiGrade('茨'), 4, '2020年から都道府県の漢字は4年');
  assert.equal(kanjiGrade('災'), 0, '5年の漢字は 0');
  assert.equal(isKanji('々'), false);
});

test('記法：ルビ・強調・下線・分数・改行', () => {
  const html = renderMarkup('{地震|じしん}の**とき**、__線__ [[2 3/7]]\n<b>');
  assert.match(html, /<ruby>地震<rt>じしん<\/rt><\/ruby>/);
  assert.match(html, /<strong class="mk-em">とき<\/strong>/);
  assert.match(html, /<span class="mk-u">線<\/span>/);
  assert.match(html, /frac-whole">2</);
  assert.match(html, /<br>/);
  assert.match(html, /&lt;b&gt;/, 'HTML はエスケープされる');
  assert.equal(plainText('{地震|じしん}の**とき**'), '地震のとき');
  assert.equal(textOutsideRuby('{地震|じしん}の**とき**'), 'のとき');
  assert.deepEqual(parseMarkup('**あ').errors.length, 1);
  assert.deepEqual(parseMarkup('{あ|い').errors.length, 1);
});

test('数の正規化と表示', () => {
  assert.equal(normalizeNumber('007'), '7');
  assert.equal(normalizeNumber('7.20'), '7.2');
  assert.equal(normalizeNumber('.5'), '0.5');
  assert.equal(normalizeNumber('5.'), '5');
  assert.equal(normalizeNumber('3 5000 0000'), '350000000');
  assert.equal(normalizeNumber('abc'), null);
  assert.equal(normalizeNumber(''), null);
  assert.equal(groupBy4('350000000'), '3 5000 0000');
  assert.equal(toMixedJa(350000000n), '3億5000万');
  assert.equal(toMixedJa(4300000000000n), '4兆3000億');
  assert.equal(toKanjiJa(350000000n), '三億五千万');
  assert.equal(toKanjiJa(100000000n), '一億');
  assert.equal(toKanjiJa(1110000n), '百十一万');
  for (const n of [1n, 10n, 11n, 1001n, 350000000n, 9876543210n, 12003400005n]) {
    assert.equal(kanjiToNumber(toKanjiJa(n)), n, `${n} の漢数字を読みもどせる`);
  }
});

test('小数の計算は誤差が出ない', () => {
  assert.equal(decAdd('0.1', '0.2'), '0.3');
  assert.equal(decAdd('2.35', '1.65'), '4');
  assert.equal(decAdd('2.35', '1.65', { keepZeros: true }), '4.00');
  assert.equal(decSub('5', '2.36'), '2.64');
  assert.equal(decSub('6.3', '2.47'), '3.83');
  assert.equal(decMul('1.25', '4'), '5');
  assert.equal(decMul('3.6', '12'), '43.2');
  assert.equal(decDivExact('7.2', 3), '2.4');
  assert.equal(decDivExact('3', 4), '0.75');
  assert.equal(decDivExact('1', 3), null);
});

test('乱数：同じシードなら同じ並び', () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 20; i += 1) assert.equal(a.next(), b.next());
  const r = createRng(1);
  for (let i = 0; i < 1000; i += 1) {
    const v = r.int(3, 7);
    assert.ok(v >= 3 && v <= 7 && Number.isInteger(v));
  }
  const arr = [1, 2, 3, 4, 5];
  assert.deepEqual([...r.shuffle(arr)].sort(), arr);
});

test('テスト用の計算機', () => {
  assert.equal(evalExpr('（12 ＋ 8）÷ 4'), 5);
  assert.equal(evalExpr('3 ＋ 4 × 5'), 23);
  assert.equal(evalExpr('7 ×（2 ＋ 3）− 20 ÷ 4'), 30);
});
