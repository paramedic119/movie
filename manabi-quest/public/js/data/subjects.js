// 教科の一覧と、問題データの読みこみ

import sansu from './sansu.js';
import sansuFurikaeri from './sansu-furikaeri.js';
import { todofukenUnits } from './todofuken.js';

export const SUBJECTS = [
  { id: 'kokugo', name: '国語', yomi: 'こくご', emoji: '📖', color: '#ff5d8f', light: '#ffe1eb' },
  { id: 'sansu', name: '算数', yomi: 'さんすう', emoji: '🔢', color: '#2f8dff', light: '#dcebff' },
  { id: 'rika', name: '理科', yomi: 'りか', emoji: '🔬', color: '#1fb574', light: '#d4f5e5' },
  { id: 'shakai', name: '社会', yomi: 'しゃかい', emoji: '🗾', color: '#ff8a1f', light: '#ffe7cf' },
  { id: 'eigo', name: '英語', yomi: 'えいご', emoji: '🔤', color: '#8a63ff', light: '#e9e1ff' },
];

/** 教科をまたぐモード（ふくしゅう・きょうの5教科）の表示用 */
export const MODE_META = {
  review: { id: 'review', name: 'ふくしゅう', yomi: 'ふくしゅう', emoji: '📒', color: '#8a63ff', light: '#efe8ff' },
  daily: { id: 'daily', name: 'きょうの5教科', yomi: 'きょうのごきょうか', emoji: '🌟', color: '#f08c00', light: '#fff1d6' },
};

export const subjectById = (id) => SUBJECTS.find((s) => s.id === id);

// 問題バンク（国語・理科・社会・英語）は教科ごとのファイル。
// 1つのファイルがこわれていても、ほかの教科は遊べるように別々に読みこむ。
// 1つめが4年生の単元、2つめ以降（ふりかえり）は読みこめなくても4年生の単元は遊べる。
const BANK_LOADERS = {
  kokugo: [() => import('./kokugo.js')],
  rika: [() => import('./rika.js')],
  shakai: [() => import('./shakai.js')],
  eigo: [() => import('./eigo.js')],
};

/** ふりかえり（下の学年）の単元の学年表示 */
function gradeInfo(unit) {
  if (!unit.grade) return {};
  return { grade: unit.grade, gradeLabel: unit.gradeLabel ?? `${unit.grade}年` };
}

function normalizeBankUnit(subjectId, unit) {
  return {
    id: unit.id,
    subject: subjectId,
    title: unit.title,
    icon: unit.icon,
    description: unit.description,
    ...gradeInfo(unit),
    questions: (unit.questions ?? []).map((q) => ({
      ...q,
      kind: 'choice',
      subject: subjectId,
      unit: unit.id,
    })),
  };
}

function normalizeGenUnit(subjectId, unit) {
  return {
    id: unit.id,
    subject: subjectId,
    title: unit.title,
    icon: unit.icon,
    description: unit.description,
    ...gradeInfo(unit),
    generate: unit.generate,
  };
}

/** 4年生の単元か（ふりかえりの単元ではない） */
export const isGrade4 = (unit) => !unit.grade;

/**
 * すべての教科の単元を読みこむ。
 * @returns {Promise<Record<string, {units: any[], error?: string}>>}
 */
export async function loadAllSubjects() {
  const out = {};
  out.sansu = { units: [...sansu.units, ...sansuFurikaeri.units].map((u) => normalizeGenUnit('sansu', u)) };
  await Promise.all(
    Object.entries(BANK_LOADERS).map(async ([id, [loadMain, ...loadExtra]]) => {
      try {
        const mod = await loadMain();
        out[id] = { units: mod.default.units.map((u) => normalizeBankUnit(id, u)) };
      } catch (err) {
        console.warn(`[まなびクエスト] ${id} の問題を読みこめませんでした`, err);
        out[id] = { units: [], error: String(err?.message ?? err) };
        return;
      }
      for (const load of loadExtra) {
        try {
          const mod = await load();
          out[id].units.push(...mod.default.units.map((u) => normalizeBankUnit(id, u)));
        } catch (err) {
          console.warn(`[まなびクエスト] ${id} のふりかえりの問題を読みこめませんでした`, err);
        }
      }
    }),
  );
  // 社会は、都道府県の自動生成単元を先頭に入れる
  out.shakai.units = [...todofukenUnits.map((u) => normalizeGenUnit('shakai', u)), ...out.shakai.units];
  return out;
}
