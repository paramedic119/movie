// テスト用の小さな道具

import { plainText } from '../public/js/lib/markup.js';

/** 分数の記法 [[a/b]] / [[w a/b]] / 整数 を 分子・分母 にする */
export function parseFraction(s) {
  const t = String(s).trim();
  let m = t.match(/^\[\[(\d+)\s+(\d+)\/(\d+)\]\]$/);
  if (m) return { n: Number(m[1]) * Number(m[3]) + Number(m[2]), d: Number(m[3]) };
  m = t.match(/^\[\[(\d+)\/(\d+)\]\]$/);
  if (m) return { n: Number(m[1]), d: Number(m[2]) };
  m = t.match(/^(\d+)$/);
  if (m) return { n: Number(m[1]), d: 1 };
  return null;
}

export const fracEq = (a, b) => a.n * b.d === b.n * a.d;

/** 「（12 ＋ 8）÷ 4」のような式を計算する（テスト用のかんたんな計算機） */
export function evalExpr(expr) {
  const src = expr.replace(/（/g, '(').replace(/）/g, ')').replace(/＋/g, '+').replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  let i = 0;
  const peek = () => src[i];
  function num() {
    const start = i;
    while (/[\d.]/.test(src[i] ?? '')) i += 1;
    return Number(src.slice(start, i));
  }
  function factor() {
    if (peek() === '(') {
      i += 1;
      const v = expr1();
      i += 1; // ')'
      return v;
    }
    return num();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = src[i++];
      const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr1() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = src[i++];
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = expr1();
  if (i !== src.length) throw new Error(`式を読めません: ${expr}`);
  return v;
}

const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const SMALL = { 十: 10n, 百: 100n, 千: 1000n };
const BIG = { 万: 10n ** 4n, 億: 10n ** 8n, 兆: 10n ** 12n };

/** 漢数字（三億五千万）を BigInt にもどす */
export function kanjiToNumber(s) {
  let total = 0n;
  let section = 0n;
  let digit = null;
  for (const ch of s) {
    if (KANJI_NUM[ch] !== undefined) digit = BigInt(KANJI_NUM[ch]);
    else if (SMALL[ch]) {
      section += (digit ?? 1n) * SMALL[ch];
      digit = null;
    } else if (BIG[ch]) {
      section += digit ?? 0n;
      total += section * BIG[ch];
      section = 0n;
      digit = null;
    } else throw new Error(`知らない字: ${ch}`);
  }
  return total + section + (digit ?? 0n);
}

export const plain = plainText;
