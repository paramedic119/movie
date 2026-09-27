// 子どもが見る画面の文字に、4年生までに習わない漢字（ふりがななし）がないか調べる
// （おうちの方向けページ parent.js は対象外）

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isKanji, isLearnedBy4th } from '../public/js/data/kanji-grades.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');
const FILES = [
  ...readdirSync(path.join(root, 'ui'))
    .filter((f) => f.endsWith('.js') && f !== 'parent.js')
    .map((f) => path.join('ui', f)),
  'game/shop.js',
  'game/rewards.js',
  'main.js',
  path.join('..', 'index.html'),
];

/** 文字列リテラル・テンプレートの中身だけを取り出す（コメントは除く） */
function literals(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of noComments.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

test('子ども向けの画面の文字は 4年生までの漢字（またはふりがなつき）', () => {
  const problems = [];
  for (const rel of FILES) {
    const src = readFileSync(path.join(root, rel), 'utf8');
    const texts = rel.endsWith('.html') ? [src.replace(/<!--[\s\S]*?-->/g, '')] : literals(src);
    for (const t of texts) {
      const stripped = t.replace(/\{[^{}|]+\|[^{}|]+\}/g, '').replace(/<ruby>[\s\S]*?<\/ruby>/g, '');
      const bad = [...new Set([...stripped].filter((ch) => isKanji(ch) && !isLearnedBy4th(ch)))];
      if (bad.length) problems.push(`${rel}: 「${bad.join('')}」 … ${t.slice(0, 40).replace(/\s+/g, ' ')}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});
