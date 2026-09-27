// 算数：問題をプログラムで自動生成する（毎回ちがう数で何度でも練習できる）
// どの単元も generate(level, rng) で1問を返す。level: 1=きほん 2=ひょうじゅん 3=チャレンジ(EX)

import {
  toMixedJa,
  toKanjiJa,
  decAdd,
  decSub,
  decMul,
  decDivExact,
  decimalsOf,
  groupBy4,
} from '../lib/numfmt.js';

// ---------- 問題を作る小さな道具 ----------

const slug = (...parts) =>
  parts
    .join('-')
    .replace(/\./g, 'p')
    .replace(/[^a-z0-9-]/gi, 'x')
    .toLowerCase();

function choiceQ(unit, key, level, { q, big, choices, answer, explain, hint }) {
  return { id: `${unit}-g-${slug(key)}`, level, kind: 'choice', q, big, choices, answer, explain, hint, generated: true };
}

/** fields: [{ label, answer, suffix, prefix, group4, decimal }] */
function inputQ(unit, key, level, { q, big, fields, explain, hint, figure }) {
  return {
    id: `${unit}-g-${slug(key)}`,
    level,
    kind: 'input',
    q,
    big,
    fields,
    answer: fields.map((f) => f.answer).join(' / '),
    explain,
    hint,
    figure,
    generated: true,
  };
}

/** 選択肢をそろえる（正解＋ちがう値のまちがい選択肢） */
function withDistractors(rng, answer, candidates, n = 4) {
  const out = [answer];
  for (const c of rng.shuffle(candidates)) {
    if (out.length >= n) break;
    if (c !== undefined && c !== null && !out.includes(c)) out.push(c);
  }
  return out;
}

const OP = { '+': '＋', '-': '−', '*': '×', '/': '÷' };

// ---------- 大きな数 ----------

const PLACE_NAMES = [
  '一', '十', '百', '千',
  '一万', '十万', '百万', '千万',
  '一億', '十億', '百億', '千億',
  '一兆', '十兆', '百兆', '千兆',
];

function randomManPart(rng) {
  // 1万を何こ？ の「何こ」（1〜9999、教科書に出やすい形）
  return rng.pick([
    rng.int(1, 9) * 1000,
    rng.int(11, 99) * 100,
    rng.int(1, 9) * 100 + rng.int(1, 9) * 10,
    rng.int(1001, 9999),
  ]);
}

function genOokinakazu(level, rng) {
  const U = 'sansu-ookinakazu';
  const OKU = 100000000n;
  const MAN = 10000n;
  const CHO = 1000000000000n;

  if (level === 1) {
    if (rng.chance(0.5)) {
      const a = rng.pick([rng.int(1, 9), rng.int(11, 99)]);
      const b = randomManPart(rng);
      const n = BigInt(a) * OKU + BigInt(b) * MAN;
      return inputQ(U, `compose-${a}-${b}`, 1, {
        q: `1億を${a}こ、1万を${b}こ あわせた数を、数字で書きましょう。`,
        fields: [{ label: '', answer: n.toString(), group4: true }],
        explain: `1億が${a}こで${a}億、1万が${b}こで${b}万。あわせて${toMixedJa(n)}なので、数字で書くと ${groupBy4(n.toString())} です。`,
        hint: '右から4けたずつ区切ると、万・億のまとまりが見えるよ。',
      });
    }
    // 漢字で読む
    const a = rng.int(1, 99);
    const b = rng.pick([rng.int(1, 9) * 1000, rng.int(1, 9) * 1000 + rng.int(1, 9) * 100, rng.int(1, 9) * 100]);
    const n = BigInt(a) * OKU + BigInt(b) * MAN;
    const wrong = [
      BigInt(a) * OKU + BigInt(b) * 10n * MAN,
      BigInt(a) * 10n * OKU + BigInt(b) * MAN,
      BigInt(a) * MAN + BigInt(b) * OKU,
      BigInt(a) * OKU + BigInt(b),
      BigInt(a) * OKU + (BigInt(b) / 10n) * MAN,
    ].filter((x) => x !== n && x > 0n && x < 100000n * OKU);
    const answer = toKanjiJa(n);
    return choiceQ(U, `read-${a}-${b}`, 1, {
      q: 'この数を漢字で書くと、どれですか。',
      big: groupBy4(n.toString()),
      choices: withDistractors(rng, answer, wrong.map(toKanjiJa)),
      answer,
      explain: `右から4けたずつ区切ると「${groupBy4(n.toString())}」。${toMixedJa(n)} だから「${answer}」と書きます。`,
    });
  }

  if (level === 2) {
    const kind = rng.int(0, 2);
    if (kind === 0) {
      const a = rng.int(1, 9);
      const b = rng.pick([rng.int(1, 9) * 1000, rng.int(11, 99) * 100]);
      const x = BigInt(a) * OKU + BigInt(b) * MAN;
      const ops = [
        { label: '10倍した数', f: (v) => v * 10n },
        { label: '100倍した数', f: (v) => v * 100n },
        { label: '10でわった数', f: (v) => v / 10n },
        { label: '1000倍した数', f: (v) => v * 1000n },
      ];
      const op = rng.pick(ops.slice(0, 3));
      const answer = toMixedJa(op.f(x));
      const wrong = ops.filter((o) => o !== op).map((o) => toMixedJa(o.f(x)));
      return choiceQ(U, `times-${a}-${b}-${op.label}`, 2, {
        q: `${toMixedJa(x)} を${op.label}は、どれですか。`,
        choices: withDistractors(rng, answer, wrong),
        answer,
        explain:
          op.label === '10でわった数'
            ? `10でわると、位が1つ下がります。${toMixedJa(x)} → ${answer}`
            : `${op.label.replace('した数', '')}すると、位が${op.label.startsWith('100倍') ? '2つ' : op.label.startsWith('1000') ? '3つ' : '1つ'}上がります。${toMixedJa(x)} → ${answer}`,
      });
    }
    if (kind === 1) {
      const facts = [
        { q: '1兆は、1億の何倍ですか。', a: '10000', e: '1億の10倍が10億、100倍が100億、1000倍が1000億、10000倍が1兆です。' },
        { q: '1億は、1万の何倍ですか。', a: '10000', e: '1万の10倍が10万、100倍が100万、1000倍が1000万、10000倍が1億です。' },
        { q: '1億は、1000万の何倍ですか。', a: '10', e: '1000万の10倍が1億です。' },
        { q: '1兆は、1000億の何倍ですか。', a: '10', e: '1000億の10倍が1兆です。' },
        { q: '10億は、1000万の何倍ですか。', a: '100', e: '1000万の10倍が1億、100倍が10億です。' },
      ];
      const f = rng.pick(facts);
      return inputQ(U, `bai-${facts.indexOf(f)}`, 2, {
        q: f.q,
        fields: [{ label: '', answer: f.a, suffix: '倍' }],
        explain: f.e,
      });
    }
    // 位の数字
    const digits = rng.int(9, 13);
    let s = String(rng.int(1, 9));
    for (let i = 1; i < digits; i += 1) s += String(rng.int(0, 9));
    const placeIdx = rng.int(4, digits - 1);
    const digit = s[s.length - 1 - placeIdx];
    return inputQ(U, `place-${s}-${placeIdx}`, 2, {
      q: `この数の${PLACE_NAMES[placeIdx]}の位の数字は何ですか。`,
      big: groupBy4(s),
      fields: [{ label: '', answer: digit }],
      explain: `右から4けたずつ区切って、一・万・億・兆のまとまりで考えよう。${PLACE_NAMES[placeIdx]}の位の数字は ${digit} です。`,
      hint: '右から4けたずつ区切ってみよう。',
    });
  }

  // level 3
  const kind = rng.int(0, 2);
  if (kind === 0) {
    const a = rng.int(1, 99);
    const b = rng.pick([rng.int(1, 9) * 1000, rng.int(11, 99) * 100, rng.int(1001, 9999)]);
    const n = BigInt(a) * CHO + BigInt(b) * OKU;
    return inputQ(U, `compose-cho-${a}-${b}`, 3, {
      q: `1兆を${a}こ、1億を${b}こ あわせた数を、数字で書きましょう。`,
      fields: [{ label: '', answer: n.toString(), group4: true }],
      explain: `${a}兆と${b}億をあわせて ${toMixedJa(n)}。万の位の4けた、一の位の4けたは0がならびます → ${groupBy4(n.toString())}`,
      hint: '兆・億・万・一の4けたずつのまとまりで書こう。',
    });
  }
  if (kind === 1) {
    const cards = [
      { q: 'いちばん大きい数', a: '9876543210', e: '大きい数字から順に左からならべます。' },
      { q: 'いちばん小さい数', a: '1023456789', e: 'いちばん上の位に0は使えないので、1を先頭にして、あとは小さい順にならべます。' },
      { q: '2番目に大きい数', a: '9876543201', e: 'いちばん大きい 9876543210 の、一の位と十の位を入れかえた数です。' },
      { q: '2番目に小さい数', a: '1023456798', e: 'いちばん小さい 1023456789 の、一の位と十の位を入れかえた数です。' },
    ];
    const c = rng.pick(cards);
    return inputQ(U, `cards-${cards.indexOf(c)}`, 3, {
      q: `0から9までの10まいのカードを1回ずつ全部使って10けたの数をつくります。${c.q}は？`,
      fields: [{ label: '', answer: c.a, group4: true }],
      explain: `${c.e}答えは ${groupBy4(c.a)}（${toMixedJa(c.a)}）です。`,
    });
  }
  const calcs = [
    () => {
      const a = rng.int(12, 89);
      const b = rng.int(11, 89);
      return { q: `${a}億 ＋ ${b}億`, v: BigInt(a + b) * OKU, e: `億が ${a}+${b}=${a + b} こ分なので ${a + b}億。` };
    },
    () => {
      const a = rng.int(2, 9);
      const b = rng.int(1, 9) * 1000;
      return { q: `${a}兆 − ${b}億`, v: BigInt(a) * CHO - BigInt(b) * OKU, e: `1兆は1億が10000こ。${a}兆は1億が${a}0000こ分と考えて計算します。` };
    },
    () => {
      const a = rng.int(12, 99);
      return { q: `${a}万 × 1000`, v: BigInt(a) * MAN * 1000n, e: `1000倍すると位が3つ上がります。${a}万の1000倍は${a}000万。` };
    },
    () => {
      const a = rng.int(2, 9) * 100;
      return { q: `${a}億 ÷ 100`, v: (BigInt(a) * OKU) / 100n, e: `100でわると位が2つ下がります。` };
    },
  ];
  const c = rng.pick(calcs)();
  const answer = toMixedJa(c.v);
  const wrong = [c.v * 10n, c.v / 10n, c.v * 100n, c.v / 100n].filter((x) => x > 0n && x !== c.v).map(toMixedJa);
  return choiceQ(U, `calc-${c.q}`, 3, {
    q: '計算しましょう。',
    big: c.q,
    choices: withDistractors(rng, answer, wrong),
    answer,
    explain: `${c.e} 答えは ${answer} です。`,
  });
}

// ---------- わり算 ----------

function genWarizan(level, rng) {
  const U = 'sansu-warizan';
  const check = (n, d, qt, r) => `たしかめ：${d} × ${qt}${r ? ` ＋ ${r}` : ''} ＝ ${n}`;

  if (level === 1) {
    const d = rng.int(2, 9);
    // 2けた÷1けた（わり切れる）と、3けた÷1けた（わり切れる）
    const qt = rng.chance(0.6) ? rng.int(11, Math.max(12, Math.floor(99 / d))) : rng.int(Math.ceil(100 / d), Math.floor(999 / d));
    const n = d * qt;
    return inputQ(U, `${n}d${d}`, 1, {
      q: 'わり算をしましょう。',
      big: `${n} ÷ ${d}`,
      fields: [{ label: '商', answer: String(qt) }],
      explain: `${n} ÷ ${d} ＝ ${qt}（${check(n, d, qt, 0)}）。十の位から順にわっていこう。`,
      hint: `${d}のだんの九九を使おう。`,
    });
  }

  if (level === 2) {
    const d = rng.int(2, 9);
    const qt = rng.int(11, Math.floor(990 / d));
    const r = rng.chance(0.85) ? rng.int(1, d - 1) : 0;
    const n = d * qt + r;
    if (rng.chance(0.35)) {
      return inputQ(U, `word-${n}d${d}`, 2, {
        q: `${n}まいの色紙を、${d}人で同じ数ずつ分けます。1人分は何まいで、何まいあまりますか。`,
        fields: [
          { label: '1人分', answer: String(qt), suffix: 'まい' },
          { label: 'あまり', answer: String(r), suffix: 'まい' },
        ],
        explain: `${n} ÷ ${d} ＝ ${qt} あまり ${r}。1人分は${qt}まいで、${r}まいあまります。（${check(n, d, qt, r)}）`,
        hint: 'あまりがないときは 0 を入れよう。',
      });
    }
    return inputQ(U, `${n}d${d}`, 2, {
      q: 'わり算をしましょう。あまりがないときは 0 を入れます。',
      big: `${n} ÷ ${d}`,
      fields: [
        { label: '商', answer: String(qt) },
        { label: 'あまり', answer: String(r) },
      ],
      explain: `${n} ÷ ${d} ＝ ${qt}${r ? ` あまり ${r}` : '（わり切れる）'}。${check(n, d, qt, r)}。あまりは、わる数 ${d} より小さくなるよ。`,
    });
  }

  // level 3
  const kind = rng.int(0, 2);
  if (kind === 0) {
    const d = rng.int(12, 39);
    const qt = rng.int(2, Math.min(29, Math.floor(999 / d) - 1));
    const r = rng.chance(0.8) ? rng.int(1, d - 1) : 0;
    const n = d * qt + r;
    return inputQ(U, `${n}d${d}`, 3, {
      q: '2けたでわるわり算です。あまりがないときは 0 を入れます。',
      big: `${n} ÷ ${d}`,
      fields: [
        { label: '商', answer: String(qt) },
        { label: 'あまり', answer: String(r) },
      ],
      explain: `${n} ÷ ${d} ＝ ${qt}${r ? ` あまり ${r}` : '（わり切れる）'}。${check(n, d, qt, r)}。${d}を何十とみて、商の見当をつけよう。`,
      hint: `${d}を${Math.round(d / 10) * 10}とみて、商の見当をつけよう。`,
    });
  }
  const d = rng.int(3, 9);
  const qt = rng.int(4, 30);
  const r = rng.int(1, d - 1);
  const n = d * qt + r;
  if (kind === 1) {
    return inputQ(U, `bench-${n}d${d}`, 3, {
      q: `${n}人の子どもが、長いす1きゃくに${d}人ずつすわります。全員がすわるには、長いすは何きゃくいりますか。`,
      fields: [{ label: '', answer: String(qt + 1), suffix: 'きゃく' }],
      explain: `${n} ÷ ${d} ＝ ${qt} あまり ${r}。あまりの${r}人もすわるので、長いすはもう1きゃくいります。${qt} ＋ 1 ＝ ${qt + 1}きゃく。`,
      hint: 'あまった人はどうする？',
    });
  }
  const price = d * 10;
  const money = n * 10;
  return inputQ(U, `buy-${money}d${price}`, 3, {
    q: `${money}円で、1こ${price}円のおかしは何こ買えますか。`,
    fields: [{ label: '', answer: String(qt), suffix: 'こ' }],
    explain: `${money} ÷ ${price} ＝ ${qt} あまり ${r * 10}。あまりの${r * 10}円では、もう1こは買えないので ${qt}こです。`,
    hint: 'あまりのお金で、もう1こ買えるかな？',
  });
}

// ---------- 小数の筆算（1けたずつ入力） ----------

function hissanQ(level, op, a, b) {
  const U = 'sansu-hissan';
  const full = op === '+' ? decAdd(a, b, { keepZeros: true }) : decSub(a, b, { keepZeros: true });
  const answer = op === '+' ? decAdd(a, b) : decSub(a, b);
  const trimmed = full !== answer;
  return {
    id: `${U}-g-${slug(a, op === '+' ? 'a' : 's', b)}`,
    level,
    kind: 'hissan',
    q: '小数の筆算をしましょう。右のくらいから1けたずつ入れよう。',
    hissan: { op, a, b, result: full },
    answer,
    explain:
      `${a} ${OP[op]} ${b} ＝ ${answer}。小数点の位置をたてにそろえて、整数と同じように計算します。` +
      (trimmed ? `答えの ${full} は、さいごの0を消して ${answer} と書きます。` : ''),
    generated: true,
  };
}

function randDec(rng, minTimes, maxTimes, scale) {
  // scale: 小数点以下のけた数。minTimes〜maxTimes は 10^scale 倍した整数の範囲
  let v;
  do {
    v = rng.int(minTimes, maxTimes);
  } while (v % 10 === 0 && scale > 0);
  const s = String(v).padStart(scale + 1, '0');
  return scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
}

function genHissan(level, rng) {
  if (level === 1) {
    const a = randDec(rng, 11, 99, 1);
    const b = randDec(rng, 11, 99, 1);
    if (rng.chance(0.5) || a === b) return hissanQ(1, '+', a, b);
    const [x, y] = Number(a) > Number(b) ? [a, b] : [b, a];
    return hissanQ(1, '-', x, y);
  }
  if (level === 2) {
    const forms = [
      () => [randDec(rng, 101, 999, 2), randDec(rng, 11, 99, 1)],
      () => [randDec(rng, 101, 999, 1), randDec(rng, 101, 999, 2)],
      () => [randDec(rng, 101, 999, 2), randDec(rng, 101, 999, 2)],
    ];
    let [a, b] = rng.pick(forms)();
    if (rng.chance(0.5)) return hissanQ(2, '+', a, b);
    if (Number(a) < Number(b)) [a, b] = [b, a];
    if (a === b) return hissanQ(2, '+', a, b);
    return hissanQ(2, '-', a, b);
  }
  // level 3：整数ひく小数、答えの0を消す、など
  const kind = rng.int(0, 2);
  if (kind === 0) {
    const a = String(rng.int(2, 10));
    const b = randDec(rng, 101, Number(a) * 100 - 1, 2);
    return hissanQ(3, '-', a, b);
  }
  if (kind === 1) {
    // たすと 0 で終わる（4.00 → 4）
    const total = rng.int(3, 15) * 100 + rng.pick([0, 0, 50, 10]);
    let x;
    do x = rng.int(101, total - 101); while (x % 10 === 0);
    const toDec = (v) => {
      const s = String(v).padStart(3, '0');
      return `${s.slice(0, -2)}.${s.slice(-2)}`;
    };
    return hissanQ(3, '+', toDec(x), toDec(total - x));
  }
  // くり下がりが小数点をまたぐひき算
  const a = randDec(rng, 1001, 1999, 2);
  const b = randDec(rng, 101, 999, 1);
  return Number(a) > Number(b) ? hissanQ(3, '-', a, b) : hissanQ(3, '+', a, b);
}

// ---------- 小数のかけ算・わり算 ----------

function genShousuu(level, rng) {
  const U = 'sansu-shousuu';
  const dec = (v, scale) => {
    const s = String(v).padStart(scale + 1, '0');
    return `${s.slice(0, -scale)}.${s.slice(-scale)}`;
  };

  if (level === 1) {
    const kind = rng.int(0, 2);
    if (kind === 0) {
      const n = rng.int(11, 99);
      const ans = dec(n, 1).replace(/\.0$/, '');
      if (n % 10 === 0) return genShousuu(level, rng);
      return inputQ(U, `tenth-${n}`, 1, {
        q: `0.1 を ${n}こ 集めた数はいくつですか。`,
        fields: [{ label: '', answer: ans, decimal: true }],
        explain: `0.1 が10こで 1。${n}こは 1 が${Math.floor(n / 10)}こと 0.1 が${n % 10}こで ${ans} です。`,
      });
    }
    if (kind === 1) {
      const n = rng.int(11, 99);
      if (n % 10 === 0) return genShousuu(level, rng);
      const x = dec(n, 1);
      return inputQ(U, `howmany-${n}`, 1, {
        q: `${x} は、0.1 を何こ集めた数ですか。`,
        fields: [{ label: '', answer: String(n), suffix: 'こ' }],
        explain: `${x} は 1 が${Math.floor(n / 10)}こ（0.1 が${Math.floor(n / 10) * 10}こ）と 0.1 が${n % 10}こ。あわせて 0.1 が${n}こです。`,
      });
    }
    const x = randDec(rng, 2, 99, 1);
    const k = rng.int(2, 9);
    const ans = decMul(x, String(k));
    return inputQ(U, `${x}m${k}`, 1, {
      q: 'かけ算をしましょう。',
      big: `${x} × ${k}`,
      fields: [{ label: '', answer: ans, decimal: true }],
      explain: `${x} を 10倍した ${Math.round(Number(x) * 10)} に ${k} をかけて ${Math.round(Number(x) * 10) * k}、それを10でわって ${ans}。`,
    });
  }

  if (level === 2) {
    const kind = rng.int(0, 2);
    if (kind === 0) {
      const x = randDec(rng, 101, 999, 2);
      const k = rng.int(2, 9);
      const ans = decMul(x, String(k));
      return inputQ(U, `${x}m${k}`, 2, {
        q: 'かけ算をしましょう。答えの小数点の位置に気をつけよう。',
        big: `${x} × ${k}`,
        fields: [{ label: '', answer: ans, decimal: true }],
        explain: `${x} × ${k} ＝ ${ans}。かけられる数の小数点に合わせて、積の小数点をうちます。さいごの0は消します。`,
      });
    }
    if (kind === 1) {
      const x = randDec(rng, 11, 99, 1);
      const k = rng.int(11, 25);
      const ans = decMul(x, String(k));
      return inputQ(U, `${x}m${k}`, 2, {
        q: 'かけ算をしましょう。',
        big: `${x} × ${k}`,
        fields: [{ label: '', answer: ans, decimal: true }],
        explain: `${x} × ${k} ＝ ${ans}。整数のかけ算と同じように計算してから、小数点をうちます。`,
      });
    }
    const k = rng.int(2, 9);
    const qt = randDec(rng, 11, 99, 1);
    const x = decMul(qt, String(k));
    return inputQ(U, `${x}d${k}`, 2, {
      q: 'わり算をしましょう。',
      big: `${x} ÷ ${k}`,
      fields: [{ label: '', answer: qt, decimal: true }],
      explain: `${x} ÷ ${k} ＝ ${qt}。わられる数の小数点にそろえて、商の小数点をうちます。（たしかめ：${qt} × ${k} ＝ ${x}）`,
    });
  }

  // level 3
  const kind = rng.int(0, 2);
  if (kind === 0) {
    for (let tries = 0; tries < 50; tries += 1) {
      const k = rng.pick([4, 5, 8, 2]);
      const x = rng.chance(0.4) ? String(rng.int(1, 9)) : randDec(rng, 11, 99, 1);
      const ans = decDivExact(x, k, 3);
      if (ans && decimalsOf(ans) >= 2) {
        return inputQ(U, `${x}d${k}`, 3, {
          q: 'わり切れるまで計算しましょう。',
          big: `${x} ÷ ${k}`,
          fields: [{ label: '', answer: ans, decimal: true }],
          explain: `${x} ÷ ${k} ＝ ${ans}。わりきれないときは、わられる数の右に0があると考えて、わり進めます。`,
        });
      }
    }
  }
  if (kind === 1) {
    const x = randDec(rng, 11, 29, 1);
    const n = rng.int(3, 12);
    const ans = decMul(x, String(n));
    return inputQ(U, `juice-${x}m${n}`, 3, {
      q: `1本 ${x}L 入りのジュースが ${n}本 あります。ジュースは全部で何Lですか。`,
      fields: [{ label: '', answer: ans, suffix: 'L', decimal: true }],
      explain: `1本分 × 本数 なので ${x} × ${n} ＝ ${ans}（L）です。`,
    });
  }
  const n = rng.int(3, 8);
  const each = randDec(rng, 11, 99, 1);
  const total = decMul(each, String(n));
  return inputQ(U, `ribbon-${total}d${n}`, 3, {
    q: `${total}m のリボンを、${n}人で同じ長さずつ分けます。1人分は何mですか。`,
    fields: [{ label: '', answer: each, suffix: 'm', decimal: true }],
    explain: `全部の長さ ÷ 人数 なので ${total} ÷ ${n} ＝ ${each}（m）です。`,
  });
}

// ---------- 分数 ----------

const F = (n, d) => `[[${n}/${d}]]`;
const M = (w, n, d) => (n === 0 ? String(w) : w === 0 ? F(n, d) : `[[${w} ${n}/${d}]]`);
const asMixed = (num, d) => M(Math.floor(num / d), num % d, d);

/** 選択肢の分数（分子num / 分母d）で、答えと大きさが同じものは入れない */
function fracChoices(rng, answerNum, d, answerStr, candidates, render) {
  const seen = new Set([answerNum]);
  const out = [answerStr];
  for (const c of rng.shuffle(candidates)) {
    if (out.length >= 4) break;
    if (c <= 0 || seen.has(c)) continue;
    const s = render(c);
    if (out.includes(s)) continue;
    seen.add(c);
    out.push(s);
  }
  return out;
}

function genBunsuu(level, rng) {
  const U = 'sansu-bunsuu';
  if (level === 1) {
    const kind = rng.int(0, 3);
    if (kind === 0) {
      const d = rng.int(3, 9);
      const k = rng.int(2, d - 1);
      const answer = F(k, d);
      const wrong = [F(d, k), F(k + 1, d), F(k - 1 || k + 2, d), F(1, d * k)];
      return choiceQ(U, `unit-${k}-${d}`, 1, {
        q: `${F(1, d)} を ${k}こ 集めた数は、どれですか。`,
        choices: withDistractors(rng, answer, wrong),
        answer,
        explain: `${F(1, d)} が${k}こで、分子が ${k} の ${answer} になります。分母はそのままだよ。`,
      });
    }
    if (kind === 1) {
      const d = rng.int(2, 9);
      let n;
      do n = rng.int(d + 1, d * 4); while (n % d === 0);
      const w = Math.floor(n / d);
      const r = n % d;
      const answer = M(w, r, d);
      const cands = [n + 1, n - 1, n + d, n - d].filter((v) => v % d !== 0 && v > 0);
      return choiceQ(U, `k2t-${n}-${d}`, 1, {
        q: `${F(n, d)} を帯分数になおすと、どれですか。`,
        choices: fracChoices(rng, n, d, answer, cands, (v) => asMixed(v, d)),
        answer,
        explain: `${n} ÷ ${d} ＝ ${w} あまり ${r}。整数の部分が ${w}、分子が ${r} なので ${answer} です。`,
      });
    }
    if (kind === 2) {
      const d = rng.int(2, 9);
      const w = rng.int(1, 4);
      const r = rng.int(1, d - 1);
      const n = w * d + r;
      const answer = F(n, d);
      const cands = [w + r, n + 1, n - 1, n + d, w * r + d].filter((v) => v > 0);
      return choiceQ(U, `t2k-${w}-${r}-${d}`, 1, {
        q: `${M(w, r, d)} を{仮分数|かぶんすう}になおすと、どれですか。`,
        choices: fracChoices(rng, n, d, answer, cands, (v) => F(v, d)),
        answer,
        explain: `1 は ${F(d, d)}。${w} は ${F(w * d, d)} なので、${F(w * d, d)} と ${F(r, d)} で ${answer} です。`,
      });
    }
    const d = rng.int(2, 9);
    const answer = F(d, d);
    return choiceQ(U, `one-${d}`, 1, {
      q: `1 を、分母が ${d} の分数で表すと、どれですか。`,
      choices: withDistractors(rng, answer, [F(1, d), F(d - 1, d), F(d + 1, d)]),
      answer,
      explain: `${F(1, d)} が ${d}こ 集まると 1 になります。だから 1 ＝ ${answer} です。`,
    });
  }

  if (level === 2) {
    const d = rng.int(3, 9);
    const kind = rng.int(0, 2);
    if (kind === 0) {
      const a = rng.int(1, d - 1);
      const b = rng.int(1, d - 1);
      const s = a + b;
      const answer = s === d ? '1' : F(s, d);
      // 分母どうしもたしてしまう（s/2d）のが、いちばん多いまちがい
      const wrong = [F(s, d * 2), F(s + 1, d), F(s - 1, d), F(Math.abs(a - b), d)].filter((c) => c !== F(d, d) && c !== F(0, d));
      return choiceQ(U, `add-${a}-${b}-${d}`, 2, {
        q: '計算しましょう。',
        big: `${F(a, d)} ＋ ${F(b, d)}`,
        choices: withDistractors(rng, answer, wrong),
        answer,
        explain: `分母が同じ分数のたし算は、分母はそのままで分子どうしをたします。${a}＋${b}＝${s} なので ${answer}${s === d ? `（${F(d, d)} ＝ 1）` : ''}。分母はたさないよ。`,
      });
    }
    if (kind === 1) {
      const a = rng.int(2, d - 1);
      const b = rng.int(1, a - 1);
      const s = a - b;
      const answer = F(s, d);
      const cands = [a + b, s + 1, s - 1 || s + 2];
      return choiceQ(U, `sub-${a}-${b}-${d}`, 2, {
        q: '計算しましょう。',
        big: `${F(a, d)} − ${F(b, d)}`,
        choices: fracChoices(rng, s, d, answer, cands, (v) => F(v, d)),
        answer,
        explain: `分母はそのままで、分子どうしをひきます。${a}−${b}＝${s} なので ${answer} です。`,
      });
    }
    const b = rng.int(1, d - 1);
    const s = d - b;
    const answer = F(s, d);
    const cands = [s + 1, s - 1 || s + 2, b];
    return choiceQ(U, `onesub-${b}-${d}`, 2, {
      q: '計算しましょう。',
      big: `1 − ${F(b, d)}`,
      choices: fracChoices(rng, s, d, answer, cands, (v) => F(v, d)),
      answer,
      explain: `1 を ${F(d, d)} と考えると、${F(d, d)} − ${F(b, d)} ＝ ${answer} です。`,
    });
  }

  // level 3
  const d = rng.int(3, 9);
  const kind = rng.int(0, 3);
  if (kind === 0) {
    const w1 = rng.int(1, 3);
    const w2 = rng.int(1, 3);
    const a = rng.int(1, d - 1);
    const b = rng.int(1, d - 1);
    const total = (w1 + w2) * d + a + b;
    const answer = asMixed(total, d);
    const cands = [total + 1, total - 1, total + d, total - d];
    return choiceQ(U, `madd-${w1}-${a}-${w2}-${b}-${d}`, 3, {
      q: '計算しましょう。',
      big: `${M(w1, a, d)} ＋ ${M(w2, b, d)}`,
      choices: fracChoices(rng, total, d, answer, cands, (v) => asMixed(v, d)),
      answer,
      explain: `整数どうし、分数どうしをたします。${w1}＋${w2}＝${w1 + w2}、${F(a, d)}＋${F(b, d)}＝${F(a + b, d)}。${a + b >= d ? `${F(a + b, d)} は ${asMixed(a + b, d)} なので、` : ''}答えは ${answer} です。`,
    });
  }
  if (kind === 1) {
    const w1 = rng.int(2, 4);
    const w2 = rng.int(1, w1 - 1);
    const a = rng.int(1, d - 2);
    const b = rng.int(a + 1, d - 1);
    const total = (w1 * d + a) - (w2 * d + b);
    const answer = asMixed(total, d);
    const cands = [total + 1, total - 1, total + d, total - d];
    return choiceQ(U, `msub-${w1}-${a}-${w2}-${b}-${d}`, 3, {
      q: '計算しましょう。',
      big: `${M(w1, a, d)} − ${M(w2, b, d)}`,
      choices: fracChoices(rng, total, d, answer, cands, (v) => asMixed(v, d)),
      answer,
      explain: `${F(a, d)} から ${F(b, d)} はひけないので、${M(w1, a, d)} を ${M(w1 - 1, a + d, d)} と考えてから計算します。答えは ${answer} です。`,
    });
  }
  if (kind === 2) {
    const n = rng.int(1, 5);
    let d1 = rng.int(n + 1, 9);
    let d2 = rng.int(n + 1, 9);
    if (d1 === d2) d2 = d1 === 9 ? d1 - 1 : d1 + 1;
    const answer = d1 < d2 ? F(n, d1) : F(n, d2);
    return choiceQ(U, `cmp-${n}-${d1}-${d2}`, 3, {
      q: `${F(n, d1)} と ${F(n, d2)}、大きいのはどちらですか。`,
      choices: [F(n, d1), F(n, d2), '同じ大きさ'],
      answer,
      explain: `分子が同じときは、分母が小さいほうが大きい分数です（1つ分が大きいから）。だから ${answer} が大きいです。`,
    });
  }
  const bases = [
    [1, 2],
    [1, 3],
    [2, 3],
    [1, 4],
    [3, 4],
  ];
  const [bn, bd] = rng.pick(bases);
  const k = rng.int(2, 3);
  const answer = F(bn * k, bd * k);
  const wrong = [F(bn * k + 1, bd * k), F(bn * k, bd * k + 1), F(bn + k, bd + k), F(bn * k - 1 || bn * k + 2, bd * k)].filter(
    (s) => {
      const m = s.match(/\[\[(\d+)\/(\d+)\]\]/);
      return m && Number(m[1]) * bd !== Number(m[2]) * bn;
    },
  );
  return choiceQ(U, `eq-${bn}-${bd}-${k}`, 3, {
    q: `${F(bn, bd)} と大きさの等しい分数は、どれですか。`,
    choices: withDistractors(rng, answer, wrong),
    answer,
    explain: `数直線で見ると、${F(bn, bd)} と ${answer} は同じ位置にあります。分母と分子に同じ数（${k}）をかけた分数は、大きさが等しくなります。`,
  });
}

// ---------- がい数 ----------

const roundHalfUp = (n, unit) => Math.floor((n + unit / 2) / unit) * unit;
const PLACE = { 10: '十', 100: '百', 1000: '千', 10000: '一万', 100000: '十万' };

function genGaisuu(level, rng) {
  const U = 'sansu-gaisuu';
  const R = '{四捨五入|ししゃごにゅう}';

  if (level === 1) {
    const unit = rng.pick([100, 1000]);
    const n = rng.int(unit === 100 ? 1001 : 10001, unit === 100 ? 9999 : 99999);
    const ans = roundHalfUp(n, unit);
    const lower = unit / 10;
    const digit = Math.floor(n / lower) % 10;
    return inputQ(U, `round-${n}-${unit}`, 1, {
      q: `${n} を${R}して、${PLACE[unit]}の位までのがい数にしましょう。`,
      fields: [{ label: '', answer: String(ans) }],
      explain: `${PLACE[unit]}の位までのがい数にするときは、1つ下の${PLACE[lower]}の位の数字を見ます。${digit} は${digit >= 5 ? '5以上なので切り上げ' : '4以下なので切り{捨|す}て'}て、${ans} です。`,
      hint: `${PLACE[lower]}の位の数字を見よう。`,
    });
  }

  if (level === 2) {
    const kind = rng.int(0, 2);
    if (kind === 0) {
      const top = rng.int(1, 2);
      const n = rng.int(10000, 999999);
      const unit = 10 ** (String(n).length - top);
      const ans = roundHalfUp(n, unit);
      return inputQ(U, `top${top}-${n}`, 2, {
        q: `${n} を${R}して、上から${top}けたのがい数にしましょう。`,
        fields: [{ label: '', answer: String(ans) }],
        explain: `上から${top}けたのがい数にするときは、上から${top + 1}けためを${R}します。答えは ${ans} です。`,
        hint: `上から${top + 1}けための数字を見よう。`,
      });
    }
    if (kind === 1) {
      const n = rng.int(100001, 999999);
      const ans = roundHalfUp(n, 10000);
      return inputQ(U, `man-${n}`, 2, {
        q: `${n} を${R}して、一万の位までのがい数にしましょう。`,
        fields: [{ label: '', answer: String(ans) }],
        explain: `一万の位までのがい数にするときは、千の位の数字を見ます。答えは ${ans} です。`,
      });
    }
    const n = rng.int(1001, 9999);
    const up = rng.chance(0.5);
    const ans = up ? Math.ceil(n / 100) * 100 : Math.floor(n / 100) * 100;
    if (n % 100 === 0) return genGaisuu(level, rng);
    return inputQ(U, `${up ? 'ceil' : 'floor'}-${n}`, 2, {
      q: `${n} を${up ? '切り上げて' : '切り{捨|す}てて'}、百の位までのがい数にしましょう。`,
      fields: [{ label: '', answer: String(ans) }],
      explain: up
        ? `切り上げは、百の位より下が 0 でなければ、百の位を1ふやして下を0にします。答えは ${ans} です。`
        : `切り{捨|す}ては、百の位より下の数を全部0にします。答えは ${ans} です。`,
    });
  }

  // level 3
  const kind = rng.int(0, 2);
  if (kind === 0) {
    const unit = rng.pick([10, 100]);
    const m = rng.int(3, 99) * unit;
    const small = rng.chance(0.5);
    const ans = small ? m - unit / 2 : m + unit / 2 - 1;
    return inputQ(U, `range-${m}-${unit}-${small ? 's' : 'l'}`, 3, {
      q: `${R}して${PLACE[unit]}の位までのがい数にすると ${m} になる整数のうち、いちばん${small ? '小さい' : '大きい'}数は何ですか。`,
      fields: [{ label: '', answer: String(ans) }],
      explain: `${R}して ${m} になるのは、${m - unit / 2} 以上 ${m + unit / 2 - 1} 以下の整数です。${m + unit / 2} になると ${m + unit} になってしまいます。`,
      hint: `${m} より少し小さい数・少し大きい数で、${R}してみよう。`,
    });
  }
  if (kind === 1) {
    const unit = rng.pick([100, 1000]);
    const a = rng.int(unit + 1, unit * 9);
    const b = rng.int(unit + 1, unit * 9);
    const ans = roundHalfUp(a, unit) + roundHalfUp(b, unit);
    return inputQ(U, `est-${a}-${b}-${unit}`, 3, {
      q: `${a} ＋ ${b} を、それぞれ${R}して${PLACE[unit]}の位までのがい数にしてから、見{積|つ}もりましょう。`,
      fields: [{ label: '', answer: String(ans) }],
      explain: `${a} → ${roundHalfUp(a, unit)}、${b} → ${roundHalfUp(b, unit)}。${roundHalfUp(a, unit)} ＋ ${roundHalfUp(b, unit)} ＝ ${ans} です。`,
    });
  }
  const price = rng.int(12, 98) * 10 + rng.pick([2, 8, 5]);
  const count = rng.int(11, 49);
  const p1 = roundHalfUp(price, 10 ** (String(price).length - 1));
  const c1 = roundHalfUp(count, 10 ** (String(count).length - 1));
  return inputQ(U, `shop-${price}-${count}`, 3, {
    q: `1こ ${price}円 のおかしを ${count}こ 買います。代金はおよそ何円ですか。それぞれ上から1けたのがい数にして見{積|つ}もりましょう。`,
    fields: [{ label: '', answer: String(p1 * c1), suffix: '円' }],
    explain: `${price} → ${p1}、${count} → ${c1} とみて、${p1} × ${c1} ＝ ${p1 * c1}。およそ ${p1 * c1}円です。`,
  });
}

// ---------- 計算のきまり ----------

function genKeisan(level, rng) {
  const U = 'sansu-keisan';
  const make = (expr, value, steps, lv) =>
    inputQ(U, expr.replace(/\s/g, ''), lv, {
      q: '計算のじゅんじょに気をつけて計算しましょう。',
      big: expr,
      fields: [{ label: '', answer: String(value) }],
      explain: `${steps} 答えは ${value}。（ ）の中 → かけ算・わり算 → たし算・ひき算 の順だよ。`,
    });

  if (level === 1) {
    const t = rng.int(0, 3);
    const b = rng.int(2, 9);
    const c = rng.int(2, 9);
    if (t === 0) {
      const a = rng.int(2, 60);
      return make(`${a} ＋ ${b} × ${c}`, a + b * c, `先にかけ算 ${b}×${c}＝${b * c}、つぎに ${a}＋${b * c}。`, 1);
    }
    if (t === 1) {
      const a = b * c + rng.int(1, 50);
      return make(`${a} − ${b} × ${c}`, a - b * c, `先にかけ算 ${b}×${c}＝${b * c}、つぎに ${a}−${b * c}。`, 1);
    }
    if (t === 2) {
      const d = rng.int(2, 40);
      return make(`${b} × ${c} ＋ ${d}`, b * c + d, `先にかけ算 ${b}×${c}＝${b * c}、つぎに ${b * c}＋${d}。`, 1);
    }
    const a = rng.int(2, 50);
    return make(`${a} ＋ ${b * c} ÷ ${c}`, a + b, `先にわり算 ${b * c}÷${c}＝${b}、つぎに ${a}＋${b}。`, 1);
  }

  if (level === 2) {
    const t = rng.int(0, 4);
    if (t === 0) {
      const a = rng.int(2, 30);
      const b = rng.int(2, 30);
      const c = rng.int(2, 9);
      return make(`（${a} ＋ ${b}）× ${c}`, (a + b) * c, `（ ）の中 ${a}＋${b}＝${a + b}、つぎに ${a + b}×${c}。`, 2);
    }
    if (t === 1) {
      const b = rng.int(2, 30);
      const a = b + rng.int(2, 12);
      const c = rng.int(2, 9);
      return make(`（${a} − ${b}）× ${c}`, (a - b) * c, `（ ）の中 ${a}−${b}＝${a - b}、つぎに ${a - b}×${c}。`, 2);
    }
    if (t === 2) {
      const a = rng.int(2, 9);
      const b = rng.int(2, 20);
      const c = rng.int(2, 20);
      return make(`${a} ×（${b} ＋ ${c}）`, a * (b + c), `（ ）の中 ${b}＋${c}＝${b + c}、つぎに ${a}×${b + c}。`, 2);
    }
    if (t === 3) {
      const c = rng.int(2, 9);
      const q = rng.int(2, 12);
      const a = rng.int(1, c * q - 1);
      const b = c * q - a;
      return make(`（${a} ＋ ${b}）÷ ${c}`, q, `（ ）の中 ${a}＋${b}＝${a + b}、つぎに ${a + b}÷${c}。`, 2);
    }
    const b = rng.int(2, 40);
    const c = rng.int(2, 40);
    const a = b + c + rng.int(1, 60);
    return make(`${a} −（${b} ＋ ${c}）`, a - (b + c), `（ ）の中 ${b}＋${c}＝${b + c}、つぎに ${a}−${b + c}。`, 2);
  }

  // level 3
  const t = rng.int(0, 3);
  if (t === 0) {
    const a = rng.int(2, 9);
    const b = rng.int(2, 9);
    const c = rng.int(2, 9);
    const d = rng.int(2, 9);
    return make(`${a} × ${b} ＋ ${c} × ${d}`, a * b + c * d, `かけ算を先に ${a}×${b}＝${a * b}、${c}×${d}＝${c * d}、つぎに ${a * b}＋${c * d}。`, 3);
  }
  if (t === 1) {
    const a = rng.int(2, 9);
    const b = rng.int(2, 9);
    const c = rng.int(2, 9);
    const e = rng.int(2, 9);
    const q = rng.int(1, Math.max(1, Math.min(9, a * (b + c) - 1)));
    const d = e * q;
    return make(
      `${a} ×（${b} ＋ ${c}）− ${d} ÷ ${e}`,
      a * (b + c) - q,
      `（ ）の中 ${b}＋${c}＝${b + c}、かけ算 ${a}×${b + c}＝${a * (b + c)}、わり算 ${d}÷${e}＝${q}、さいごに ${a * (b + c)}−${q}。`,
      3,
    );
  }
  if (t === 2) {
    const k = rng.int(2, 9);
    return make(`25 × ${k} × 4`, 100 * k, `かける順番をかえて、25×4＝100 を先に計算するとかんたん。100×${k}。`, 3);
  }
  const n = rng.int(2, 9);
  if (rng.chance(0.5)) {
    return make(`98 × ${n}`, 98 * n, `98 を（100−2）と考えて、100×${n}＝${100 * n}、2×${n}＝${2 * n}、${100 * n}−${2 * n}。`, 3);
  }
  return make(`102 × ${n}`, 102 * n, `102 を（100＋2）と考えて、100×${n}＝${100 * n}、2×${n}＝${2 * n}、${100 * n}＋${2 * n}。`, 3);
}

// ---------- 角と図形 ----------

const SUIC = '{垂直|すいちょく}';
const CHO_TEN = '{頂点|ちょうてん}';

const KAKUDO_BANK = [
  { level: 1, q: '直角は何度ですか。', a: '90', suffix: '°', e: '直角は 90° です。直角2つ分で半回転の 180° になります。' },
  { level: 1, q: '半回転の角の大きさは何度ですか。', a: '180', suffix: '°', e: '半回転は直角2つ分で 180° です。' },
  { level: 1, q: '1回転の角の大きさは何度ですか。', a: '360', suffix: '°', e: '1回転は直角4つ分で 360° です。' },
  {
    level: 1,
    q: '角の大きさをはかる道具は、どれですか。',
    choices: ['分度器', 'コンパス', 'ものさし', '三角じょうぎ'],
    a: '分度器',
    e: '分度器を使うと、角の大きさを「度（°）」ではかれます。',
  },
  {
    level: 2,
    q: '向かい合った1組の辺が平行な四角形を何といいますか。',
    choices: ['台形', '平行四辺形', 'ひし形', '長方形'],
    a: '台形',
    e: '1組の辺が平行な四角形が台形、2組とも平行な四角形が平行四辺形です。',
  },
  {
    level: 2,
    q: '4つの辺の長さがすべて等しい四角形を何といいますか。',
    choices: ['ひし形', '台形', '平行四辺形', '長方形'],
    a: 'ひし形',
    e: '辺の長さがすべて等しい四角形をひし形といいます。向かい合った辺は平行で、向かい合った角の大きさも等しいです。',
  },
  {
    level: 2,
    q: `2本の直線が交わってできる角が直角のとき、この2本の直線は何であるといいますか。`,
    choices: [SUIC, '平行', '対角線', '辺'],
    a: SUIC,
    e: `2本の直線が直角に交わるとき、2本の直線は${SUIC}であるといいます。`,
  },
  {
    level: 2,
    q: `1本の直線に${SUIC}な2本の直線は、どんな関係ですか。`,
    choices: ['平行', SUIC, '対角線', '交わる'],
    a: '平行',
    e: `1本の直線に${SUIC}な2本の直線は平行です。平行な直線は、どこまでのばしても交わりません。`,
  },
  {
    level: 2,
    q: '平行な2本の直線のはばは、どうなっていますか。',
    choices: ['どこも等しい', 'だんだん広くなる', 'だんだんせまくなる', 'まん中だけ広い'],
    a: 'どこも等しい',
    e: '平行な2本の直線のはばは、どこではかっても等しくなっています。',
  },
  {
    level: 2,
    q: '平行四辺形の向かい合った角の大きさは、どうなっていますか。',
    choices: ['等しい', '合わせて90°', '合わせて360°', 'いつもちがう'],
    a: '等しい',
    e: '平行四辺形は、向かい合った辺の長さも、向かい合った角の大きさも等しくなっています。',
  },
  { level: 3, q: '直方体の面の数はいくつですか。', a: '6', suffix: 'つ', e: '直方体には、上下・前後・左右の6つの面があります。' },
  { level: 3, q: '直方体の辺の数はいくつですか。', a: '12', suffix: '本', e: '直方体の辺は、同じ長さの辺が4本ずつ3組で、12本です。' },
  { level: 3, q: `直方体の${CHO_TEN}の数はいくつですか。`, a: '8', suffix: 'つ', e: `直方体の${CHO_TEN}は、上に4つ・下に4つで8つです。` },
  { level: 3, q: '直方体の1つの面に平行な面は、いくつありますか。', a: '1', suffix: 'つ', e: '向かい合った面が平行です。1つの面に平行な面は1つです。' },
  { level: 3, q: `直方体の1つの面に${SUIC}な面は、いくつありますか。`, a: '4', suffix: 'つ', e: `となり合った面は${SUIC}です。1つの面に${SUIC}な面は4つあります。` },
  { level: 3, q: '直方体の1つの辺に平行な辺は、何本ありますか。', a: '3', suffix: '本', e: '同じ向きの辺は4本あるので、1つの辺に平行な辺はほかの3本です。' },
  { level: 3, q: `直方体の1つの辺に${SUIC}な辺は、何本ありますか。`, a: '4', suffix: '本', e: `辺の両はしの${CHO_TEN}に、${SUIC}な辺が2本ずつ、合わせて4本あります。` },
  {
    level: 3,
    q: '立方体の面は、どんな形ですか。',
    choices: ['正方形', '三角形', '台形', '円'],
    a: '正方形',
    e: '立方体は、正方形だけでかこまれた形です。6つの面がすべて同じ大きさの正方形です。',
  },
  {
    level: 3,
    q: `2本の対角線の長さが等しく、${SUIC}に交わる四角形はどれですか。`,
    choices: ['正方形', '長方形', 'ひし形'],
    a: '正方形',
    e: `長方形の対角線は長さが等しい、ひし形の対角線は${SUIC}に交わる。両方あてはまるのは正方形です。`,
  },
  {
    level: 3,
    q: '2本の対角線が、それぞれのまん中の点で交わらない四角形はどれですか。',
    choices: ['台形', '平行四辺形', 'ひし形', '長方形'],
    a: '台形',
    e: '平行四辺形・ひし形・長方形の対角線は、それぞれのまん中の点で交わります。台形はそうなりません。',
  },
];

function bankQuestion(U, item, idx) {
  if (item.choices) {
    return {
      id: `${U}-b-${idx}`,
      level: item.level,
      kind: 'choice',
      q: item.q,
      choices: item.choices,
      answer: item.a,
      explain: item.e,
    };
  }
  return {
    id: `${U}-b-${idx}`,
    level: item.level,
    kind: 'input',
    q: item.q,
    fields: [{ label: '', answer: item.a, suffix: item.suffix }],
    answer: item.a,
    explain: item.e,
  };
}

const RULER_COMBOS = [
  { v: 75, s: '45° ＋ 30°' },
  { v: 105, s: '45° ＋ 60°' },
  { v: 135, s: '90° ＋ 45°' },
  { v: 120, s: '90° ＋ 30°' },
  { v: 150, s: '90° ＋ 60°' },
  { v: 15, s: '45° − 30°' },
];

function genKakudo(level, rng) {
  const U = 'sansu-kakudo';
  const bank = KAKUDO_BANK.map((item, i) => ({ item, i })).filter(({ item }) => item.level === level);
  if (rng.chance(0.45)) {
    const { item, i } = rng.pick(bank);
    return bankQuestion(U, item, i);
  }
  if (level === 1) {
    const a = rng.int(3, 33) * 5;
    return inputQ(U, `line-${a}`, 1, {
      q: `一直線の角（180°）を2つに分けました。一方の角が ${a}° のとき、もう一方の角は何度ですか。`,
      fields: [{ label: '', answer: String(180 - a), suffix: '°' }],
      explain: `一直線の角は 180° なので、180 − ${a} ＝ ${180 - a}（°）です。`,
    });
  }
  if (level === 2) {
    const t = rng.int(0, 2);
    if (t === 0) {
      const x = rng.pick([30, 60, 90]);
      const y = rng.pick([45, 90]);
      return inputQ(U, `ruler-${x}-${y}`, 2, {
        q: `2まいの三角じょうぎの ${x}° の角と ${y}° の角を合わせると、何度の角ができますか。`,
        fields: [{ label: '', answer: String(x + y), suffix: '°' }],
        explain: `${x} ＋ ${y} ＝ ${x + y}（°）です。三角じょうぎの角は 30°・60°・90° と 45°・45°・90° だよ。`,
      });
    }
    if (t === 1) {
      const m = rng.pick([5, 10, 15, 20, 25, 30, 40, 45, 50]);
      return inputQ(U, `clock-${m}`, 2, {
        q: `時計の長いはりは、${m}分間に何度回りますか。`,
        fields: [{ label: '', answer: String(m * 6), suffix: '°' }],
        explain: `長いはりは60分で1回転（360°）するので、1分間に 6° 回ります。6 × ${m} ＝ ${m * 6}（°）です。`,
        hint: '60分で1回転（360°）だね。',
      });
    }
    const b = rng.int(38, 70) * 5;
    return inputQ(U, `over180-${b}`, 2, {
      q: `${b}° の角は、半回転の角（180°）より何度大きいですか。`,
      fields: [{ label: '', answer: String(b - 180), suffix: '°' }],
      explain: `${b} − 180 ＝ ${b - 180}（°）です。180° より大きい角は、180° といくつ分かで考えるとはかりやすいよ。`,
    });
  }
  const combo = rng.pick(RULER_COMBOS);
  const answer = combo.s;
  const wrong = RULER_COMBOS.filter((c) => c.v !== combo.v).map((c) => c.s);
  return choiceQ(U, `make-${combo.v}`, 3, {
    q: `2まいの三角じょうぎを組み合わせて ${combo.v}° の角をつくります。どの組み合わせですか。`,
    choices: withDistractors(rng, answer, wrong),
    answer,
    explain: `${answer.replace(/°/g, '')} ＝ ${combo.v}（°）です。`,
  });
}

// ---------- 面積 ----------

function genMenseki(level, rng) {
  const U = 'sansu-menseki';
  if (level === 1) {
    if (rng.chance(0.3)) {
      const a = rng.int(3, 12);
      return inputQ(U, `sq-${a}`, 1, {
        q: `1辺が ${a}cm の正方形の面積は何 cm² ですか。`,
        fields: [{ label: '', answer: String(a * a), suffix: 'cm²' }],
        explain: `正方形の面積 ＝ 1辺 × 1辺。${a} × ${a} ＝ ${a * a}（cm²）です。`,
        figure: { type: 'rect', w: a, h: a, labelW: `${a}cm`, labelH: `${a}cm` },
      });
    }
    const h = rng.int(2, 12);
    let w = rng.int(3, 15);
    if (w === h) w += 1;
    return inputQ(U, `rect-${h}-${w}`, 1, {
      q: `たて ${h}cm、横 ${w}cm の長方形の面積は何 cm² ですか。`,
      fields: [{ label: '', answer: String(h * w), suffix: 'cm²' }],
      explain: `長方形の面積 ＝ たて × 横。${h} × ${w} ＝ ${h * w}（cm²）です。1cm² の正方形が ${h * w}こ分だよ。`,
      figure: { type: 'rect', w, h, labelW: `${w}cm`, labelH: `${h}cm` },
    });
  }
  if (level === 2) {
    const t = rng.int(0, 2);
    if (t === 0) {
      const h = rng.int(3, 12);
      const w = rng.int(4, 15);
      return inputQ(U, `rev-${h}-${w}`, 2, {
        q: `面積が ${h * w}cm² で、たてが ${h}cm の長方形があります。横の長さは何 cm ですか。`,
        fields: [{ label: '', answer: String(w), suffix: 'cm' }],
        explain: `たて × 横 ＝ 面積 なので、横 ＝ 面積 ÷ たて。${h * w} ÷ ${h} ＝ ${w}（cm）です。`,
        figure: { type: 'rect', w, h, labelW: '？cm', labelH: `${h}cm` },
      });
    }
    if (t === 1) {
      const units = [
        { from: 'm²', to: 'cm²', f: 10000, e: '1m² は 1辺100cm の正方形なので、100 × 100 ＝ 10000（cm²）。' },
        { from: 'a', to: 'm²', f: 100, e: '1a（アール）は 1辺10m の正方形の面積で、100m² です。' },
        { from: 'ha', to: 'm²', f: 10000, e: '1ha（ヘクタール）は 1辺100m の正方形の面積で、10000m² です。' },
        { from: 'ha', to: 'a', f: 100, e: '1ha ＝ 10000m²、1a ＝ 100m² なので、1ha ＝ 100a です。' },
        { from: 'km²', to: 'm²', f: 1000000, e: '1km² は 1辺1000m の正方形なので、1000 × 1000 ＝ 1000000（m²）。' },
      ];
      const u = rng.pick(units);
      const k = rng.int(1, 9);
      return inputQ(U, `unit-${u.from}-${k}`, 2, {
        q: `${k}${u.from} は何 ${u.to} ですか。`,
        fields: [{ label: '', answer: String(k * u.f), suffix: u.to, group4: k * u.f >= 100000 }],
        explain: `${u.e} だから ${k}${u.from} ＝ ${k * u.f}${u.to} です。`,
      });
    }
    const h = rng.int(3, 20);
    const w = rng.int(4, 25);
    return inputQ(U, `mrect-${h}-${w}`, 2, {
      q: `たて ${h}m、横 ${w}m の花だんの面積は何 m² ですか。`,
      fields: [{ label: '', answer: String(h * w), suffix: 'm²' }],
      explain: `たて × 横 で ${h} × ${w} ＝ ${h * w}（m²）です。`,
      figure: { type: 'rect', w, h, labelW: `${w}m`, labelH: `${h}m` },
    });
  }
  const t = rng.int(0, 3);
  if (t === 0 || t === 1) {
    const W = rng.int(7, 14);
    const H = rng.int(6, 12);
    const w = rng.int(2, W - 4);
    const h = rng.int(2, H - 3);
    const ans = W * H - w * h;
    return inputQ(U, `lshape-${W}-${H}-${w}-${h}`, 3, {
      q: '右上が切りとられた形の面積は何 cm² ですか。',
      fields: [{ label: '', answer: String(ans), suffix: 'cm²' }],
      explain: `大きな長方形 ${W} × ${H} ＝ ${W * H} から、切りとった長方形 ${w} × ${h} ＝ ${w * h} をひいて、${W * H} − ${w * h} ＝ ${ans}（cm²）。2つの長方形に分けて考えてもOK。`,
      hint: '大きな長方形から、切りとった部分をひいてみよう。',
      figure: { type: 'lshape', W, H, w, h, unit: 'cm' },
    });
  }
  if (t === 2) {
    const a = rng.int(2, 9);
    const b = rng.int(3, 9) * 10;
    return inputQ(U, `mix-${a}-${b}`, 3, {
      q: `たて ${a}m、横 ${b}cm の長方形の面積は何 cm² ですか。`,
      fields: [{ label: '', answer: String(a * 100 * b), suffix: 'cm²', group4: true }],
      explain: `単位をそろえます。${a}m ＝ ${a * 100}cm なので、${a * 100} × ${b} ＝ ${a * 100 * b}（cm²）です。`,
      hint: '長さの単位をそろえてから計算しよう。',
    });
  }
  const pairs = [
    [20, 30],
    [20, 50],
    [40, 50],
    [30, 40],
    [25, 40],
    [50, 60],
  ];
  const [a, b] = rng.pick(pairs);
  return inputQ(U, `are-${a}-${b}`, 3, {
    q: `たて ${a}m、横 ${b}m の畑の面積は何 a（アール）ですか。`,
    fields: [{ label: '', answer: String((a * b) / 100), suffix: 'a' }],
    explain: `${a} × ${b} ＝ ${a * b}（m²）。100m² ＝ 1a なので、${a * b}m² ＝ ${(a * b) / 100}a です。`,
  });
}

// ---------- 単元の一覧 ----------

export default {
  subject: 'sansu',
  units: [
    { id: 'sansu-ookinakazu', title: '大きな数', icon: '🔢', description: '億・兆のしくみ', generate: genOokinakazu },
    { id: 'sansu-warizan', title: 'わり算', icon: '➗', description: '1けた・2けたでわる計算', generate: genWarizan },
    { id: 'sansu-hissan', title: '小数の筆算', icon: '✍️', description: '小数のたし算・ひき算を筆算で', generate: genHissan },
    { id: 'sansu-shousuu', title: '小数のかけ算・わり算', icon: '✖️', description: '小数 × 整数、小数 ÷ 整数', generate: genShousuu },
    { id: 'sansu-bunsuu', title: '分数', icon: '🍰', description: '帯分数・分数のたし算ひき算', generate: genBunsuu },
    { id: 'sansu-gaisuu', title: 'がい数', icon: '🎯', description: '{四捨五入|ししゃごにゅう}と見積もり', generate: genGaisuu },
    { id: 'sansu-keisan', title: '計算のきまり', icon: '🧮', description: '計算のじゅんじょとくふう', generate: genKeisan },
    { id: 'sansu-kakudo', title: '角と図形', icon: '📐', description: '角度・四角形・直方体', generate: genKakudo },
    { id: 'sansu-menseki', title: '面積', icon: '🟩', description: 'cm²・m²・a・ha・km²', generate: genMenseki },
  ],
};
