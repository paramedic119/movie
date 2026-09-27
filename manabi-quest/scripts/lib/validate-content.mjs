// 問題データ（国語・理科・社会・英語）のチェック。
// scripts/check-content.mjs と tests/content.test.js から使う。

import { parseMarkup, plainText, textOutsideRuby } from '../../public/js/lib/markup.js';
import { isKanji, isLearnedBy4th } from '../../public/js/data/kanji-grades.js';

const QUESTION_KEYS = new Set(['id', 'level', 'q', 'big', 'choices', 'answer', 'explain', 'hint', 'speak', 'listenOnly', 'kanjiQuiz']);
const UNIT_KEYS = new Set(['id', 'title', 'icon', 'description', 'questions']);
const KANA_RE = /^[ぁ-ゖァ-ヺー・]+$/u;
const BANNED_CHOICES = ['すべて', 'どれでもない', '全部正しい', 'ぜんぶ'];

export const LIMITS = {
  q: 140,
  big: 30,
  choice: 40,
  explain: 220,
  hint: 80,
};

/**
 * 1つの教科データをチェックする。
 * @param {any} data  data/<教科>.js の default export
 * @param {string} subjectId
 */
export function validateSubject(data, subjectId) {
  const errors = [];
  const warnings = [];
  const stats = [];
  const seenIds = new Set();
  const seenUnitIds = new Set();

  if (!data || typeof data !== 'object') {
    return { errors: ['default export がオブジェクトではありません'], warnings, stats };
  }
  if (data.subject !== subjectId) errors.push(`subject が "${subjectId}" ではありません（${data.subject}）`);
  if (!Array.isArray(data.units) || data.units.length === 0) {
    errors.push('units が空です');
    return { errors, warnings, stats };
  }

  for (const unit of data.units) {
    const uw = `[${unit?.id ?? '?'}]`;
    for (const key of Object.keys(unit ?? {})) {
      if (!UNIT_KEYS.has(key)) errors.push(`${uw} 単元に知らないキー "${key}" があります`);
    }
    if (typeof unit.id !== 'string' || !new RegExp(`^${subjectId}-[a-z0-9-]+$`).test(unit.id)) {
      errors.push(`${uw} 単元 id は "${subjectId}-英小文字" の形にしてください`);
    }
    if (seenUnitIds.has(unit.id)) errors.push(`${uw} 単元 id が重複しています`);
    seenUnitIds.add(unit.id);
    checkText(unit.title, `${uw} title`, { errors, required: true, max: 16 });
    checkText(unit.description, `${uw} description`, { errors, required: true, max: 40 });
    if (typeof unit.icon !== 'string' || unit.icon.length === 0) errors.push(`${uw} icon（絵文字1つ）がありません`);

    const qs = Array.isArray(unit.questions) ? unit.questions : [];
    if (qs.length === 0) errors.push(`${uw} questions が空です`);
    const perLevel = { 1: 0, 2: 0, 3: 0 };
    const seenPrompts = new Set();

    for (const q of qs) {
      const w = `[${q?.id ?? '?'}]`;
      for (const key of Object.keys(q ?? {})) {
        if (!QUESTION_KEYS.has(key)) errors.push(`${w} 知らないキー "${key}" があります`);
      }
      if (typeof q.id !== 'string' || !/^[a-z0-9-]+$/.test(q.id)) errors.push(`${w} id は英小文字・数字・ハイフンだけにしてください`);
      else if (!q.id.startsWith(`${unit.id}-`)) errors.push(`${w} id は "${unit.id}-" で始めてください`);
      if (seenIds.has(q.id)) errors.push(`${w} id が重複しています`);
      seenIds.add(q.id);

      if (![1, 2, 3].includes(q.level)) errors.push(`${w} level は 1・2・3 のどれかにしてください`);
      else perLevel[q.level] += 1;

      checkText(q.q, `${w} q`, { errors, required: true, max: LIMITS.q });
      checkText(q.big, `${w} big`, { errors, required: false, max: LIMITS.big });
      checkText(q.explain, `${w} explain`, { errors, required: true, max: LIMITS.explain });
      checkText(q.hint, `${w} hint`, { errors, required: false, max: LIMITS.hint });

      if (q.speak !== undefined && (typeof q.speak !== 'string' || !/^[\x20-\x7E]+$/.test(q.speak))) {
        errors.push(`${w} speak は英語（半角）だけにしてください`);
      }
      if (q.kanjiQuiz !== undefined && typeof q.kanjiQuiz !== 'boolean') errors.push(`${w} kanjiQuiz は true/false`);
      if (q.listenOnly !== undefined && (typeof q.listenOnly !== 'boolean' || (q.listenOnly && !q.speak))) {
        errors.push(`${w} listenOnly は true/false で、speak といっしょに使ってください`);
      }

      if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 4) {
        errors.push(`${w} choices は2〜4こにしてください`);
      } else {
        const plains = new Set();
        for (const c of q.choices) {
          checkText(c, `${w} choice「${c}」`, { errors, required: true, max: LIMITS.choice, skipKanji: q.kanjiQuiz === true });
          const p = plainText(c).trim();
          if (plains.has(p)) errors.push(`${w} 同じ選択肢「${p}」があります`);
          plains.add(p);
          if (BANNED_CHOICES.some((b) => p.includes(b))) warnings.push(`${w} 「すべて」「どれでもない」のような選択肢はさけてください`);
        }
        if (!q.choices.includes(q.answer)) errors.push(`${w} answer「${q.answer}」が choices の中にありません`);
      }

      const promptKey = `${plainText(q.q ?? '')}|${plainText(q.big ?? '')}`;
      if (seenPrompts.has(promptKey)) errors.push(`${w} 同じ単元に同じ問題文があります`);
      seenPrompts.add(promptKey);
    }

    if (qs.length < 12) warnings.push(`${uw} 問題が ${qs.length} 問です（12問以上がおすすめ）`);
    for (const lv of [1, 2, 3]) {
      if (perLevel[lv] < 4) warnings.push(`${uw} level ${lv} が ${perLevel[lv]} 問です（4問以上がおすすめ）`);
    }
    stats.push({ unit: unit.id, title: unit.title, total: qs.length, ...perLevel });
  }
  return { errors, warnings, stats };
}

/** 文字列フィールドのチェック（長さ・記法・漢字の学年・ふりがな） */
export function checkText(value, where, { errors, required, max, skipKanji = false }) {
  if (value === undefined || value === null) {
    if (required) errors.push(`${where} がありません`);
    return;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${where} が空です`);
    return;
  }
  const { nodes, errors: markupErrors } = parseMarkup(value);
  for (const e of markupErrors) errors.push(`${where}: ${e}`);
  const plain = plainText(value);
  if (max && [...plain].length > max) errors.push(`${where} が長すぎます（${[...plain].length}/${max}文字）`);
  for (const r of collectRuby(nodes)) {
    if (![...r.base].some(isKanji)) errors.push(`${where}: ふりがな {${r.base}|${r.rt}} の漢字部分に漢字がありません`);
    if (!KANA_RE.test(r.rt)) errors.push(`${where}: ふりがな {${r.base}|${r.rt}} の読みはひらがな・カタカナだけにしてください`);
  }
  if (!skipKanji) {
    const outside = textOutsideRuby(value);
    const bad = [...new Set([...outside].filter((ch) => isKanji(ch) && !isLearnedBy4th(ch)))];
    if (bad.length) {
      errors.push(`${where}: 「${bad.join('」「')}」は4年生までに習わない漢字です → {漢字|よみ} でふりがなをつけるか、ひらがなにしてください`);
    }
  }
}

function collectRuby(nodes, out = []) {
  for (const n of nodes) {
    if (n.type === 'ruby') out.push(n);
    if (n.children) collectRuby(n.children, out);
  }
  return out;
}
