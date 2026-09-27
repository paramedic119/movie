// 社会：47都道府県のデータから問題を自動生成する
// （都道府県名・地方・県庁所在地。都道府県名の漢字は4年生で習う）

// [都道府県名, よみ, 地方, 県庁所在地, よみ]
export const PREFECTURES = [
  ['北海道', 'ほっかいどう', '北海道地方', '札幌市', 'さっぽろし'],
  ['青森県', 'あおもりけん', '東北地方', '青森市', 'あおもりし'],
  ['岩手県', 'いわてけん', '東北地方', '盛岡市', 'もりおかし'],
  ['宮城県', 'みやぎけん', '東北地方', '仙台市', 'せんだいし'],
  ['秋田県', 'あきたけん', '東北地方', '秋田市', 'あきたし'],
  ['山形県', 'やまがたけん', '東北地方', '山形市', 'やまがたし'],
  ['福島県', 'ふくしまけん', '東北地方', '福島市', 'ふくしまし'],
  ['茨城県', 'いばらきけん', '関東地方', '水戸市', 'みとし'],
  ['栃木県', 'とちぎけん', '関東地方', '宇都宮市', 'うつのみやし'],
  ['群馬県', 'ぐんまけん', '関東地方', '前橋市', 'まえばしし'],
  ['埼玉県', 'さいたまけん', '関東地方', 'さいたま市', 'さいたまし'],
  ['千葉県', 'ちばけん', '関東地方', '千葉市', 'ちばし'],
  ['東京都', 'とうきょうと', '関東地方', '東京', 'とうきょう'],
  ['神奈川県', 'かながわけん', '関東地方', '横浜市', 'よこはまし'],
  ['新潟県', 'にいがたけん', '中部地方', '新潟市', 'にいがたし'],
  ['富山県', 'とやまけん', '中部地方', '富山市', 'とやまし'],
  ['石川県', 'いしかわけん', '中部地方', '金沢市', 'かなざわし'],
  ['福井県', 'ふくいけん', '中部地方', '福井市', 'ふくいし'],
  ['山梨県', 'やまなしけん', '中部地方', '甲府市', 'こうふし'],
  ['長野県', 'ながのけん', '中部地方', '長野市', 'ながのし'],
  ['岐阜県', 'ぎふけん', '中部地方', '岐阜市', 'ぎふし'],
  ['静岡県', 'しずおかけん', '中部地方', '静岡市', 'しずおかし'],
  ['愛知県', 'あいちけん', '中部地方', '名古屋市', 'なごやし'],
  ['三重県', 'みえけん', '近畿地方', '津市', 'つし'],
  ['滋賀県', 'しがけん', '近畿地方', '大津市', 'おおつし'],
  ['京都府', 'きょうとふ', '近畿地方', '京都市', 'きょうとし'],
  ['大阪府', 'おおさかふ', '近畿地方', '大阪市', 'おおさかし'],
  ['兵庫県', 'ひょうごけん', '近畿地方', '神戸市', 'こうべし'],
  ['奈良県', 'ならけん', '近畿地方', '奈良市', 'ならし'],
  ['和歌山県', 'わかやまけん', '近畿地方', '和歌山市', 'わかやまし'],
  ['鳥取県', 'とっとりけん', '中国・四国地方', '鳥取市', 'とっとりし'],
  ['島根県', 'しまねけん', '中国・四国地方', '松江市', 'まつえし'],
  ['岡山県', 'おかやまけん', '中国・四国地方', '岡山市', 'おかやまし'],
  ['広島県', 'ひろしまけん', '中国・四国地方', '広島市', 'ひろしまし'],
  ['山口県', 'やまぐちけん', '中国・四国地方', '山口市', 'やまぐちし'],
  ['徳島県', 'とくしまけん', '中国・四国地方', '徳島市', 'とくしまし'],
  ['香川県', 'かがわけん', '中国・四国地方', '高松市', 'たかまつし'],
  ['愛媛県', 'えひめけん', '中国・四国地方', '松山市', 'まつやまし'],
  ['高知県', 'こうちけん', '中国・四国地方', '高知市', 'こうちし'],
  ['福岡県', 'ふくおかけん', '九州地方', '福岡市', 'ふくおかし'],
  ['佐賀県', 'さがけん', '九州地方', '佐賀市', 'さがし'],
  ['長崎県', 'ながさきけん', '九州地方', '長崎市', 'ながさきし'],
  ['熊本県', 'くまもとけん', '九州地方', '熊本市', 'くまもとし'],
  ['大分県', 'おおいたけん', '九州地方', '大分市', 'おおいたし'],
  ['宮崎県', 'みやざきけん', '九州地方', '宮崎市', 'みやざきし'],
  ['鹿児島県', 'かごしまけん', '九州地方', '鹿児島市', 'かごしまし'],
  ['沖縄県', 'おきなわけん', '九州地方', '那覇市', 'なはし'],
].map(([name, yomi, region, capital, capitalYomi]) => ({ name, yomi, region, capital, capitalYomi }));

export const REGIONS = ['北海道地方', '東北地方', '関東地方', '中部地方', '近畿地方', '中国・四国地方', '九州地方'];

// 教科書では「中国・四国地方」を1つにまとめて7地方とすることが多い（8地方区分とする場合もある）ので、
// 問題では「中国・四国地方」として出す。

/** 4年生までに習わない漢字をふくむ市の名前は、ふりがなつきで出す */
const RUBY_CAPITAL = {
  札幌市: '{札幌|さっぽろ}市',
  盛岡市: '{盛岡|もりおか}市',
  仙台市: '{仙台|せんだい}市',
  水戸市: '水戸市',
  宇都宮市: '{宇都宮|うつのみや}市',
  前橋市: '前橋市',
  横浜市: '{横浜|よこはま}市',
  金沢市: '金{沢|ざわ}市',
  甲府市: '{甲府|こうふ}市',
  名古屋市: '名古屋市',
  津市: '{津|つ}市',
  大津市: '大{津|つ}市',
  神戸市: '神戸市',
  松江市: '松{江|え}市',
  高松市: '高松市',
  松山市: '松山市',
  那覇市: '{那覇|なは}市',
};

const displayCapital = (p) => RUBY_CAPITAL[p.capital] ?? p.capital;
const displayRegion = (r) => (r === '近畿地方' ? '{近畿|きんき}地方' : r);
const prefKey = (p) => PREFECTURES.indexOf(p);

/** 北海道は道庁、京都府・大阪府は府庁、東京都は都庁 */
function office(p) {
  if (p.name === '北海道') return '{道庁所在地|どうちょうしょざいち}';
  if (p.name.endsWith('府')) return '{府庁所在地|ふちょうしょざいち}';
  if (p.name.endsWith('都')) return '{都庁所在地|とちょうしょざいち}';
  return '{県庁所在地|けんちょうしょざいち}';
}
const NOT_TOKYO = PREFECTURES.filter((p) => p.name !== '東京都');

function choice(unit, key, level, fields) {
  return { id: `${unit}-g-${key}`, level, kind: 'choice', generated: true, ...fields };
}

function pickOthers(rng, list, exclude, n, keyOf = (x) => x) {
  const out = [];
  for (const x of rng.shuffle(list)) {
    if (out.length >= n) break;
    if (keyOf(x) === keyOf(exclude) || out.some((y) => keyOf(y) === keyOf(x))) continue;
    out.push(x);
  }
  return out;
}

/** 県庁所在地の名前が都道府県名とちがうところ（東京都は除く） */
const DIFFERENT_NAME = PREFECTURES.filter((p) => p.name !== '東京都' && p.name.replace(/[都道府県]$/, '') !== p.capital.replace(/市$/, ''));

function genChiiki(level, rng) {
  const U = 'shakai-todofuken';
  if (level === 1) {
    const p = rng.pick(PREFECTURES);
    const others = pickOthers(rng, REGIONS, p.region, 3);
    return choice(U, `region-${prefKey(p)}`, 1, {
      q: `${p.name}は、どの地方にありますか。`,
      choices: [p.region, ...others].map(displayRegion),
      answer: displayRegion(p.region),
      explain: `${p.name}（${p.yomi}）は${displayRegion(p.region)}にあります。地図帳で場所をたしかめてみよう。`,
    });
  }
  if (level === 2) {
    if (rng.chance(0.5)) {
      const region = rng.pick(REGIONS.filter((r) => r !== '北海道地方'));
      const inRegion = PREFECTURES.filter((p) => p.region === region);
      const p = rng.pick(inRegion);
      const others = pickOthers(
        rng,
        PREFECTURES.filter((x) => x.region !== region),
        p,
        3,
        (x) => x.name,
      );
      return choice(U, `inregion-${REGIONS.indexOf(region)}-${prefKey(p)}`, 2, {
        q: `${displayRegion(region)}にある都道府県は、どれですか。`,
        choices: [p.name, ...others.map((x) => x.name)],
        answer: p.name,
        explain: `${p.name}は${displayRegion(region)}です。${displayRegion(region)}には ${inRegion.map((x) => x.name).join('・')} があります。`,
      });
    }
    const p = rng.pick(PREFECTURES.filter((x) => x.name !== '北海道'));
    const others = pickOthers(rng, PREFECTURES, p, 3, (x) => x.yomi);
    return choice(U, `yomi-${prefKey(p)}`, 2, {
      q: 'この都道府県名の読み方は？',
      big: p.name,
      choices: [p.yomi, ...others.map((x) => x.yomi)],
      answer: p.yomi,
      explain: `「${p.name}」は「${p.yomi}」と読みます。都道府県名の漢字は4年生で習うよ。`,
    });
  }
  // level 3：読みから漢字を選ぶ（まちがえやすい漢字の県）
  const tricky = PREFECTURES.filter((p) =>
    ['茨城県', '栃木県', '群馬県', '埼玉県', '神奈川県', '新潟県', '岐阜県', '滋賀県', '愛媛県', '香川県', '熊本県', '鹿児島県', '沖縄県', '奈良県', '山梨県', '大阪府', '岡山県', '長崎県', '宮崎県', '佐賀県', '徳島県', '富山県', '福岡県', '静岡県', '宮城県'].includes(p.name),
  );
  const p = rng.pick(tricky);
  const WRONG = {
    茨城県: ['茨木県', '荻城県', '茨域県'],
    栃木県: ['柿木県', '栃本県', '析木県'],
    群馬県: ['郡馬県', '君馬県', '群駒県'],
    埼玉県: ['崎玉県', '埼王県', '碕玉県'],
    神奈川県: ['神奈河県', '神那川県', '神余川県'],
    新潟県: ['新瀉県', '親潟県', '新渇県'],
    岐阜県: ['岐早県', '技阜県', '枝阜県'],
    滋賀県: ['磁賀県', '滋加県', '慈賀県'],
    愛媛県: ['愛援県', '愛姫県', '受媛県'],
    香川県: ['番川県', '香州県', '香河県'],
    熊本県: ['態本県', '熊木県', '能本県'],
    鹿児島県: ['鹿見島県', '麓児島県', '鹿児鳥県'],
    沖縄県: ['仲縄県', '沖網県', '沖綱県'],
    奈良県: ['奈郎県', '那良県', '奈食県'],
    山梨県: ['山利県', '山李県', '山梁県'],
    大阪府: ['大坂府', '大阪県', '太阪府'],
    岡山県: ['丘山県', '岡出県', '網山県'],
    長崎県: ['長埼県', '長岐県', '永崎県'],
    宮崎県: ['宮埼県', '官崎県', '宮岐県'],
    佐賀県: ['佐加県', '左賀県', '佐貨県'],
    徳島県: ['得島県', '徳鳥県', '聴島県'],
    富山県: ['宮山県', '富出県', '福山県'],
    福岡県: ['副岡県', '福丘県', '福網県'],
    静岡県: ['清岡県', '静丘県', '静網県'],
    宮城県: ['宮域県', '官城県', '宮成県'],
  };
  const wrong = rng.shuffle(WRONG[p.name]).slice(0, 3);
  return choice(U, `kaki-${prefKey(p)}`, 3, {
    q: `「${p.yomi}」を漢字で書くと、どれですか。`,
    choices: [p.name, ...wrong],
    answer: p.name,
    kanjiQuiz: true,
    explain: `正しくは「${p.name}」。形のにた字に気をつけよう。`,
  });
}

function genKenchou(level, rng) {
  const U = 'shakai-kenchou';
  if (level === 1) {
    // 都道府県名と同じ名前の県庁所在地
    const same = NOT_TOKYO.filter((p) => !DIFFERENT_NAME.includes(p));
    const p = rng.pick(same);
    const others = pickOthers(rng, NOT_TOKYO.filter((x) => x.region === p.region || rng.chance(0.3)), p, 3, (x) => x.capital);
    return choice(U, `same-${prefKey(p)}`, 1, {
      q: `${p.name}の${office(p)}は、どこですか。`,
      choices: [displayCapital(p), ...others.map(displayCapital)],
      answer: displayCapital(p),
      explain: `${p.name}の${office(p)}は${displayCapital(p)}です。都道府県名と同じ名前だね。`,
    });
  }
  const p = rng.pick(DIFFERENT_NAME);
  if (level === 2 || rng.chance(0.5)) {
    const others = pickOthers(rng, DIFFERENT_NAME, p, 3, (x) => x.capital);
    return choice(U, `diff-${prefKey(p)}`, level, {
      q: `${p.name}の${office(p)}は、どこですか。`,
      choices: [displayCapital(p), ...others.map(displayCapital)],
      answer: displayCapital(p),
      explain: `${p.name}の${office(p)}は${displayCapital(p)}（${p.capitalYomi}）。都道府県名とちがう名前なので、しっかり覚えよう。`,
    });
  }
  // level 3：市から都道府県をさがす
  const near = pickOthers(rng, NOT_TOKYO.filter((x) => x.region === p.region), p, 3, (x) => x.name);
  const far = pickOthers(rng, NOT_TOKYO.filter((x) => !near.includes(x)), p, 3 - near.length, (x) => x.name);
  return choice(U, `rev-${prefKey(p)}`, 3, {
    q: `${displayCapital(p)}に{都道府県庁|とどうふけんちょう}があるのは、どの都道府県ですか。`,
    choices: [p.name, ...near.map((x) => x.name), ...far.map((x) => x.name)],
    answer: p.name,
    explain: `${displayCapital(p)}（${p.capitalYomi}）は${p.name}の${office(p)}です。`,
  });
}

export const todofukenUnits = [
  {
    id: 'shakai-todofuken',
    title: '都道府県と地方',
    icon: '🗾',
    description: '47都道府県の名前・読み・地方',
    generate: genChiiki,
  },
  {
    id: 'shakai-kenchou',
    title: '{県庁所在地|けんちょうしょざいち}',
    icon: '🏛️',
    description: '都道府県の中心となる市',
    generate: genKenchou,
  },
];
