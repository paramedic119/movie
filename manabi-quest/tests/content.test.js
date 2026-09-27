// 問題データ（国語・理科・社会・英語）と、社会の都道府県クイズのチェック

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSubject, checkText } from '../scripts/lib/validate-content.mjs';
import { PREFECTURES, REGIONS, todofukenUnits } from '../public/js/data/todofuken.js';
import { loadAllSubjects, SUBJECTS } from '../public/js/data/subjects.js';
import { createRng } from '../public/js/lib/rng.js';
import { plainText } from '../public/js/lib/markup.js';

for (const file of ['kokugo', 'kokugo-furikaeri', 'rika', 'shakai', 'eigo']) {
  test(`${file}：データの形・答え・漢字の学年`, async () => {
    const data = (await import(`../public/js/data/${file}.js`)).default;
    const { errors, stats } = validateSubject(data, file.split('-')[0]);
    assert.deepEqual(errors, [], errors.join('\n'));
    assert.ok(stats.length >= 5, '5単元以上');
    for (const s of stats) {
      assert.ok(s.total >= 12, `${s.unit} は12問以上`);
      for (const lv of [1, 2, 3]) assert.ok(s[lv] >= 3, `${s.unit} の level ${lv} が少なすぎる`);
    }
  });
}

test('問題IDは、ファイルをまたいでも重複しない（ふりかえりもふくめて）', async () => {
  const all = await loadAllSubjects();
  const ids = Object.values(all).flatMap((s) => s.units.flatMap((u) => (u.questions ?? []).map((q) => q.id)));
  assert.equal(ids.length, new Set(ids).size);
  const kokugo = all.kokugo.units;
  assert.ok(kokugo.some((u) => u.grade), '国語のふりかえりの単元を読みこめる');
  for (const u of kokugo.filter((x) => x.grade)) assert.ok(u.gradeLabel, u.id);
});

test('すべての教科を読みこめて、単元IDが重複しない', async () => {
  const all = await loadAllSubjects();
  const ids = new Set();
  for (const s of SUBJECTS) {
    assert.ok(all[s.id], s.id);
    assert.equal(all[s.id].error, undefined, `${s.id} を読みこめない: ${all[s.id].error}`);
    assert.ok(all[s.id].units.length >= 5, `${s.id} の単元数`);
    for (const u of all[s.id].units) {
      assert.ok(!ids.has(u.id), `単元IDの重複 ${u.id}`);
      ids.add(u.id);
      assert.equal(u.subject, s.id);
      assert.ok(u.generate || u.questions?.length, u.id);
    }
  }
});

test('47都道府県のデータ', () => {
  assert.equal(PREFECTURES.length, 47);
  assert.equal(new Set(PREFECTURES.map((p) => p.name)).size, 47);
  const count = (r) => PREFECTURES.filter((p) => p.region === r).length;
  assert.deepEqual(REGIONS.map(count), [1, 6, 7, 9, 7, 9, 8]);
  const cap = Object.fromEntries(PREFECTURES.map((p) => [p.name, p.capital]));
  assert.equal(cap['宮城県'], '仙台市');
  assert.equal(cap['愛知県'], '名古屋市');
  assert.equal(cap['島根県'], '松江市');
  assert.equal(cap['沖縄県'], '那覇市');
  assert.equal(cap['兵庫県'], '神戸市');
  for (const p of PREFECTURES) assert.match(p.yomi, /^[ぁ-ん]+$/, p.name);
});

test('都道府県クイズ：答えが1つ・漢字の学年', () => {
  const rng = createRng(47);
  const errs = [];
  for (const u of todofukenUnits) {
    checkText(u.title, `${u.id} title`, { errors: errs, required: true });
    for (const level of [1, 2, 3]) {
      for (let i = 0; i < 300; i += 1) {
        const q = u.generate(level, rng);
        const where = `${q.id}`;
        assert.equal(q.level, level, where);
        assert.ok(q.choices.length >= 3, `${where} 選択肢 ${q.choices}`);
        assert.equal(new Set(q.choices.map(plainText)).size, q.choices.length, `${where} 選択肢の重複`);
        assert.ok(q.choices.includes(q.answer), where);
        checkText(q.q, `${where} q`, { errors: errs, required: true });
        checkText(q.explain, `${where} explain`, { errors: errs, required: true, max: 220 });
        if (!q.kanjiQuiz) for (const c of q.choices) checkText(c, `${where} choice`, { errors: errs, required: true });
        // 答えの正しさを表から確かめる
        const t = plainText(q.q);
        let m;
        if ((m = t.match(/^(.+?)は、どの地方にありますか/))) {
          const p = PREFECTURES.find((x) => x.name === m[1]);
          assert.equal(plainText(q.answer), p.region, where);
        } else if ((m = t.match(/^(.+?)の(県|府|道|都)庁所在地は/))) {
          const p = PREFECTURES.find((x) => x.name === m[1]);
          assert.equal(plainText(q.answer), p.capital, where);
          for (const c of q.choices) if (c !== q.answer) assert.notEqual(plainText(c), p.capital, where);
        } else if ((m = t.match(/^(.+?)に都道府県庁があるのは/))) {
          const p = PREFECTURES.find((x) => x.name === q.answer);
          assert.equal(p.capital, m[1], where);
          for (const c of q.choices) if (c !== q.answer) assert.notEqual(PREFECTURES.find((x) => x.name === c)?.capital, m[1], where);
        } else if ((m = t.match(/^「(.+)」を漢字で書くと/))) {
          const p = PREFECTURES.find((x) => x.yomi === m[1]);
          assert.equal(q.answer, p.name, where);
          for (const c of q.choices) if (c !== q.answer) assert.ok(!PREFECTURES.some((x) => x.name === c), `${where} まちがい選択肢 ${c} が本物の県名`);
        } else if (t === 'この都道府県名の読み方は？') {
          assert.equal(PREFECTURES.find((x) => x.name === q.big).yomi, q.answer, where);
        } else if ((m = t.match(/^(.+?)にある都道府県は、どれですか/))) {
          const region = m[1];
          assert.equal(PREFECTURES.find((x) => x.name === q.answer).region, region, where);
          for (const c of q.choices) if (c !== q.answer) assert.notEqual(PREFECTURES.find((x) => x.name === c).region, region, where);
        } else {
          assert.fail(`知らない形の問題: ${t}`);
        }
      }
    }
  }
  assert.deepEqual(errs, [], errs.join('\n'));
});
