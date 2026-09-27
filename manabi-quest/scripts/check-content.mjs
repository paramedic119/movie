#!/usr/bin/env node
// 使い方: node scripts/check-content.mjs [kokugo|kokugo-furikaeri|rika|shakai|eigo ...]
// 問題データの形・答え・漢字の学年（ふりがな）をチェックします。

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { validateSubject } from './lib/validate-content.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BANK_FILES = ['kokugo', 'rika', 'shakai', 'eigo'];
const ALL = BANK_FILES;
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

let failed = false;
for (const subject of targets) {
  const file = path.join(root, 'public', 'js', 'data', `${subject}.js`);
  if (!existsSync(file)) {
    console.log(`- ${subject}: ファイルがありません（${path.relative(root, file)}）`);
    if (process.argv.slice(2).length) failed = true;
    continue;
  }
  let data;
  try {
    data = (await import(pathToFileURL(file).href)).default;
  } catch (err) {
    console.log(`✗ ${subject}: 読みこめません — ${err.message}`);
    failed = true;
    continue;
  }
  // ファイル名の「-」の前が教科ID（kokugo-furikaeri → kokugo）
  const { errors, warnings, stats } = validateSubject(data, subject.split('-')[0]);
  const total = stats.reduce((sum, s) => sum + s.total, 0);
  console.log(`\n${errors.length ? '✗' : '✓'} ${subject}: ${stats.length} 単元 / ${total} 問`);
  for (const s of stats) {
    console.log(`   ${s.unit.padEnd(24)} ${String(s.total).padStart(3)}問  (Lv1:${s[1]} Lv2:${s[2]} Lv3:${s[3]})`);
  }
  for (const w of warnings) console.log(`   ⚠ ${w}`);
  for (const e of errors) console.log(`   ✗ ${e}`);
  if (errors.length) failed = true;
}
process.exit(failed ? 1 : 0);
