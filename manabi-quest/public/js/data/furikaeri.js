// 4年生の単元と、そのもとになる「ふりかえり（1〜3年）」の単元の つながり。
// 4年生の単元でつまずいたときに、けっか画面や単元えらびで おすすめする。

export const FURIKAERI_FOR = {
  // 算数
  'sansu-ookinakazu': ['sansu-tashihiki'],
  'sansu-graph': ['sansu-tashihiki'],
  'sansu-warizan': ['sansu-amari', 'sansu-kuku'],
  'sansu-hissan': ['sansu-tashihiki'],
  'sansu-shousuu': ['sansu-shoubun', 'sansu-kuku'],
  'sansu-bunsuu': ['sansu-shoubun'],
  'sansu-gaisuu': ['sansu-tashihiki'],
  'sansu-keisan': ['sansu-kuku', 'sansu-tashihiki'],
  'sansu-kakudo': ['sansu-zukei'],
  'sansu-heikou': ['sansu-zukei'],
  'sansu-menseki': ['sansu-kuku', 'sansu-tani'],
  'sansu-kawarikata': ['sansu-kuku'],
  'sansu-bai': ['sansu-kuku', 'sansu-amari'],
  // 国語
  'kokugo-yomi': ['kokugo-kanji3', 'kokugo-kanji12'],
  'kokugo-kaki': ['kokugo-kanji3', 'kokugo-kanji12'],
  'kokugo-bushu': ['kokugo-kanji3'],
  'kokugo-jukugo': ['kokugo-kanji3'],
  'kokugo-jiten': ['kokugo-jisho'],
  'kokugo-bun': ['kokugo-kana'],
  'kokugo-tsunagi': ['kokugo-kana'],
};

/** 最近の正答率が低い（つまずいている）か。数問だけでは決めない */
export function isStruggling(state, unitId) {
  const us = state.unitStats[unitId];
  if (!us || us.recent.length < 5) return false;
  return us.recent.reduce((a, b) => a + b, 0) / us.recent.length < 0.6;
}

/**
 * 4年生の単元IDの一覧から、おすすめのふりかえり単元（ある単元だけ・重ならない）を返す。
 * @param {string[]} unitIds
 * @param {(id: string) => any} unitById
 */
export function furikaeriFor(unitIds, unitById) {
  const out = [];
  for (const id of unitIds) {
    for (const rid of FURIKAERI_FOR[id] ?? []) {
      const u = unitById(rid);
      if (u && !out.includes(u)) out.push(u);
    }
  }
  return out;
}
