// 算数のふりかえり（1〜3年生の大事なところ）。4年生の単元でつまずいたときの「じゅんびうんどう」。
// どの単元も generate(level, rng) で1問を返す（sansu.js と同じ形）。grade は その内容を習う学年。

import { slug, choiceQ, inputQ, withDistractors, OP } from './sansu.js';

// ---------- 九九とかけ算（2・3年） ----------

function genKuku(level, rng) {
  const U = 'sansu-kuku';
  if (level === 1) {
    const a = rng.int(2, 9);
    const b = rng.int(1, 9);
    if (rng.chance(0.65)) {
      return inputQ(U, `kuku-${a}-${b}`, 1, {
        q: 'かけ算をしましょう。',
        big: `${a} × ${b}`,
        fields: [{ label: '', answer: String(a * b) }],
        explain: `${a}のだんの九九で、${a} × ${b} ＝ ${a * b} です。${a}のだんは、かける数が1ふえると答えが${a}ずつふえます。`,
      });
    }
    // □を使った式（3年）
    const left = rng.chance(0.5);
    return inputQ(U, `box-${left ? 'l' : 'r'}-${a}-${b}`, 1, {
      q: '□にあてはまる数はいくつですか。',
      big: left ? `□ × ${b} ＝ ${a * b}` : `${a} × □ ＝ ${a * b}`,
      fields: [{ label: '□', answer: String(left ? a : b) }],
      explain: `${a} × ${b} ＝ ${a * b} なので、□は ${left ? a : b} です。九九をとなえて、答えが ${a * b} になるところをさがそう。`,
      hint: '九九をとなえて、答えが同じになるところをさがそう。',
    });
  }
  if (level === 2) {
    const t = rng.int(0, 2);
    if (t === 0) {
      // 0 や 10 のかけ算（3年）
      const a = rng.int(2, 9);
      const forms = [
        { big: `${a} × 0`, v: 0, e: 'どんな数に 0 をかけても、答えは 0 です。' },
        { big: `0 × ${a}`, v: 0, e: '0 にどんな数をかけても、答えは 0 です。' },
        { big: `${a} × 10`, v: a * 10, e: `${a} × 10 は、${a} × 9 ＝ ${a * 9} より ${a} 大きいので ${a * 10} です。` },
        { big: `10 × ${a}`, v: a * 10, e: `10 × ${a} は、10 が ${a}こ分で ${a * 10} です。` },
      ];
      const f = rng.pick(forms);
      return inputQ(U, `zero-ten-${slug(f.big.replace(/ × /, 'x'))}`, 2, {
        q: 'かけ算をしましょう。',
        big: f.big,
        fields: [{ label: '', answer: String(f.v) }],
        explain: f.e,
      });
    }
    if (t === 1) {
      // 2けた × 1けた（3年）
      const x = rng.int(12, 49);
      const y = rng.int(2, 9);
      const tens = Math.floor(x / 10) * 10;
      const ones = x % 10;
      return inputQ(U, `m21-${x}-${y}`, 2, {
        q: 'かけ算をしましょう。',
        big: `${x} × ${y}`,
        fields: [{ label: '', answer: String(x * y) }],
        explain: `${x} を ${tens} と ${ones} に分けて、${tens} × ${y} ＝ ${tens * y}、${ones} × ${y} ＝ ${ones * y}。あわせて ${tens * y} ＋ ${ones * y} ＝ ${x * y} です。`,
        hint: '十の位と一の位に分けて計算しよう。',
      });
    }
    // 何十 × 1けた（3年）
    const x = rng.int(2, 9) * 10;
    const y = rng.int(2, 9);
    return inputQ(U, `m10-${x}-${y}`, 2, {
      q: 'かけ算をしましょう。',
      big: `${x} × ${y}`,
      fields: [{ label: '', answer: String(x * y) }],
      explain: `${x} は 10 が ${x / 10}こ。${x / 10} × ${y} ＝ ${(x / 10) * y} なので、10 が ${(x / 10) * y}こで ${x * y} です。`,
    });
  }
  const t = rng.int(0, 2);
  if (t === 0) {
    // 3けた × 1けた（3年）
    const x = rng.int(102, 489);
    const y = rng.int(2, 9);
    return inputQ(U, `m31-${x}-${y}`, 3, {
      q: 'かけ算をしましょう。',
      big: `${x} × ${y}`,
      fields: [{ label: '', answer: String(x * y) }],
      explain: `一の位から順に計算します。${x} × ${y} ＝ ${x * y}。くり上がりを たしわすれないようにしよう。`,
      hint: '一の位 → 十の位 → 百の位の順にかけよう。',
    });
  }
  if (t === 1) {
    // 2けた × 2けた（3年）
    const x = rng.int(12, 59);
    const y = rng.int(12, 39);
    const yt = Math.floor(y / 10) * 10;
    const yo = y % 10;
    return inputQ(U, `m22-${x}-${y}`, 3, {
      q: 'かけ算をしましょう。',
      big: `${x} × ${y}`,
      fields: [{ label: '', answer: String(x * y) }],
      explain: `${x} × ${yo} ＝ ${x * yo} と、${x} × ${yt} ＝ ${x * yt} をたして、${x * yo} ＋ ${x * yt} ＝ ${x * y} です。`,
      hint: 'かける数を、十の位と一の位に分けて考えよう。',
    });
  }
  const price = rng.int(12, 48);
  const n = rng.int(3, 9);
  return inputQ(U, `buy-${price}-${n}`, 3, {
    q: `1こ ${price}円のおかしを ${n}こ買います。代金は何円ですか。`,
    fields: [{ label: '', answer: String(price * n), suffix: '円' }],
    explain: `1こ分 × いくつ分 で、${price} × ${n} ＝ ${price * n}（円）です。`,
  });
}

// ---------- たし算・ひき算の筆算（2・3年） ----------

function intHissanQ(level, op, a, b) {
  const U = 'sansu-tashihiki';
  const r = op === '+' ? a + b : a - b;
  return {
    id: `${U}-g-${slug(a, op === '+' ? 'a' : 's', b)}`,
    level,
    kind: 'hissan',
    q: `${op === '+' ? 'たし算' : 'ひき算'}の筆算をしましょう。一の位から1けたずつ入れよう。`,
    hissan: { op, a: String(a), b: String(b), result: String(r) },
    answer: String(r),
    explain:
      `${a} ${OP[op]} ${b} ＝ ${r}。位をたてにそろえて、一の位から計算します。` +
      (op === '+' ? '10 をこえたら、1つ上の位に 1 くり上げます。' : 'ひけないときは、1つ上の位から 1 くり下げて 10 にします。'),
    generated: true,
  };
}

/** 位ごとに見て、くり上がり（たし算）・くり下がり（ひき算）が1回以上あるか */
function regroups(op, a, b) {
  const da = String(a).split('').reverse().map(Number);
  const db = String(b).split('').reverse().map(Number);
  for (let i = 0; i < da.length; i += 1) {
    if (op === '+' && da[i] + (db[i] ?? 0) >= 10) return true;
    if (op === '-' && da[i] < (db[i] ?? 0)) return true;
  }
  return false;
}

function genTashihiki(level, rng) {
  for (;;) {
    let op = rng.pick(['+', '-']);
    let a;
    let b;
    if (level === 1) {
      // 2けたの たし算・ひき算（2年）
      a = rng.int(12, 98);
      b = rng.int(12, 98);
    } else if (level === 2) {
      // 3けたの たし算・ひき算。十の位が 0 の数からのひき算も（3年）
      if (op === '-' && rng.chance(0.4)) {
        a = rng.int(1, 9) * 100 + rng.pick([0, 0, 1, 2, 3]) + rng.pick([0, 30, 50]);
        b = rng.int(12, a - 11);
      } else {
        a = rng.int(123, 987);
        b = rng.int(123, 987);
      }
    } else {
      // 4けた、何千から ひくひき算（3年）
      const t = rng.int(0, 2);
      if (t === 0) {
        op = '-';
        a = rng.int(1, 9) * 1000;
        b = rng.int(123, a - 11);
      } else if (t === 1) {
        op = '-';
        a = rng.int(1, 9) * 1000 + rng.int(1, 9);
        b = rng.int(123, a - 11);
      } else {
        a = rng.int(1234, 8765);
        b = rng.int(123, 9876 - a);
      }
    }
    if (op === '-' && a < b) [a, b] = [b, a];
    if (a === b || !regroups(op, a, b)) continue;
    return intHissanQ(level, op, a, b);
  }
}

// ---------- わり算とあまり（3年） ----------

function genAmari(level, rng) {
  const U = 'sansu-amari';
  const d = rng.int(2, 9);
  const c = rng.int(1, 9);
  if (level === 1) {
    if (rng.chance(0.15)) {
      const f = rng.pick([
        { big: `0 ÷ ${d}`, v: 0, e: '0 を、0 でない数でわると、答えは 0 です。' },
        { big: `${d} ÷ ${d}`, v: 1, e: 'わられる数と わる数が同じとき、答えは 1 です。' },
        { big: `${d} ÷ 1`, v: d, e: '1 でわると、答えは わられる数と同じです。' },
      ]);
      return inputQ(U, `special-${slug(f.big.replace(/ ÷ /, 'd'))}`, 1, {
        q: 'わり算をしましょう。',
        big: f.big,
        fields: [{ label: '', answer: String(f.v) }],
        explain: f.e,
      });
    }
    return inputQ(U, `div-${d * c}d${d}`, 1, {
      q: 'わり算をしましょう。',
      big: `${d * c} ÷ ${d}`,
      fields: [{ label: '', answer: String(c) }],
      explain: `${d}のだんの九九で、${d} × ${c} ＝ ${d * c}。だから ${d * c} ÷ ${d} ＝ ${c} です。`,
      hint: `${d}のだんの九九を使おう。`,
    });
  }
  const r = rng.int(1, d - 1);
  const n = d * c + r;
  if (level === 2) {
    if (rng.chance(0.3)) {
      return inputQ(U, `check-${n}d${d}`, 2, {
        q: `${n} ÷ ${d} ＝ ${c} あまり ${r} の答えを たしかめます。□にあてはまる数はいくつですか。`,
        big: `${d} × ${c} ＋ ${r} ＝ □`,
        fields: [{ label: '□', answer: String(n) }],
        explain: `わる数 × 答え ＋ あまり ＝ わられる数 です。${d} × ${c} ＋ ${r} ＝ ${n} なので、答えは正しいです。`,
      });
    }
    return inputQ(U, `rem-${n}d${d}`, 2, {
      q: 'あまりのある わり算をしましょう。',
      big: `${n} ÷ ${d}`,
      fields: [
        { label: '答え', answer: String(c) },
        { label: 'あまり', answer: String(r) },
      ],
      explain: `${d} × ${c} ＝ ${d * c}、${n} − ${d * c} ＝ ${r}。${n} ÷ ${d} ＝ ${c} あまり ${r} です。あまりは、わる数 ${d} より小さくなるよ。`,
      hint: `${d}のだんで、${n}をこえない いちばん大きい答えはどれかな。`,
    });
  }
  const t = rng.int(0, 2);
  if (t === 0) {
    return inputQ(U, `boat-${n}d${d}`, 3, {
      q: `${n}人が、1そうに${d}人ずつ ボートに乗ります。全員が乗るには、ボートは何そういりますか。`,
      fields: [{ label: '', answer: String(c + 1), suffix: 'そう' }],
      explain: `${n} ÷ ${d} ＝ ${c} あまり ${r}。あまりの${r}人も乗るので、ボートはもう1そういります。${c} ＋ 1 ＝ ${c + 1}（そう）です。`,
      hint: 'あまった人も乗れるようにしよう。',
    });
  }
  if (t === 1) {
    return inputQ(U, `ribbon-${n}d${d}`, 3, {
      q: `${n}cmのリボンを、${d}cmずつに切ります。${d}cmのリボンは何本できますか。`,
      fields: [{ label: '', answer: String(c), suffix: '本' }],
      explain: `${n} ÷ ${d} ＝ ${c} あまり ${r}。あまりの${r}cmでは ${d}cmのリボンは作れないので、${c}本です。`,
      hint: 'あまりの長さで、もう1本作れるかな？',
    });
  }
  return inputQ(U, `share-${n}d${d}`, 3, {
    q: `あめが ${n}こあります。${d}人で同じ数ずつ分けると、1人分は何こで、何こあまりますか。`,
    fields: [
      { label: '1人分', answer: String(c), suffix: 'こ' },
      { label: 'あまり', answer: String(r), suffix: 'こ' },
    ],
    explain: `${n} ÷ ${d} ＝ ${c} あまり ${r}。1人分は${c}こで、${r}こあまります。`,
  });
}

// ---------- 長さ・かさ・重さ・時間（2・3年） ----------

const UNIT_FACTS = [
  { q: '1m は何cmですか。', a: 100, s: 'cm', e: '1m ＝ 100cm です。' },
  { q: '1cm は何mmですか。', a: 10, s: 'mm', e: '1cm ＝ 10mm です。' },
  { q: '1km は何mですか。', a: 1000, s: 'm', e: '1km ＝ 1000m です。' },
  { q: '1L は何dLですか。', a: 10, s: 'dL', e: '1L ＝ 10dL です。' },
  { q: '1L は何mLですか。', a: 1000, s: 'mL', e: '1L ＝ 1000mL です。' },
  { q: '1kg は何gですか。', a: 1000, s: 'g', e: '1kg ＝ 1000g です。' },
  { q: '1t は何kgですか。', a: 1000, s: 'kg', e: '1t ＝ 1000kg です。' },
  { q: '1分は何秒ですか。', a: 60, s: '秒', e: '1分 ＝ 60秒 です。' },
  { q: '1時間は何分ですか。', a: 60, s: '分', e: '1時間 ＝ 60分 です。' },
];

const MIXED = [
  { big: 'm', small: 'cm', f: 100, max: 9 },
  { big: 'cm', small: 'mm', f: 10, max: 30 },
  { big: 'km', small: 'm', f: 1000, max: 5 },
  { big: 'L', small: 'dL', f: 10, max: 9 },
  { big: 'L', small: 'mL', f: 1000, max: 3 },
  { big: 'kg', small: 'g', f: 1000, max: 5 },
];

/** 午前の時こくを「午前◯時◯分」に（12時をこえるときは午後） */
function clock(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 12) return `午前${h}時${m ? `${m}分` : ''}`;
  if (h === 12) return m ? `午後0時${m}分` : '正午';
  return `午後${h - 12}時${m ? `${m}分` : ''}`;
}

function genTani(level, rng) {
  const U = 'sansu-tani';
  if (level === 1) {
    const i = rng.int(0, UNIT_FACTS.length - 1);
    const f = UNIT_FACTS[i];
    return inputQ(U, `fact-${i}`, 1, {
      q: f.q,
      fields: [{ label: '', answer: String(f.a), suffix: f.s }],
      explain: f.e,
    });
  }
  if (level === 2) {
    const u = rng.pick(MIXED);
    const x = rng.int(1, u.max);
    const y = rng.int(1, u.f - 1);
    if (rng.chance(0.5)) {
      return inputQ(U, `join-${u.big}-${x}-${y}`, 2, {
        q: `${x}${u.big} ${y}${u.small} は何${u.small}ですか。`,
        fields: [{ label: '', answer: String(x * u.f + y), suffix: u.small }],
        explain: `1${u.big} ＝ ${u.f}${u.small} なので、${x}${u.big} ＝ ${x * u.f}${u.small}。${x * u.f} ＋ ${y} ＝ ${x * u.f + y}（${u.small}）です。`,
      });
    }
    return inputQ(U, `split-${u.big}-${x}-${y}`, 2, {
      q: `${x * u.f + y}${u.small} は何${u.big}何${u.small}ですか。`,
      fields: [
        { label: '', answer: String(x), suffix: u.big },
        { label: '', answer: String(y), suffix: u.small },
      ],
      explain: `1${u.big} ＝ ${u.f}${u.small} なので、${x * u.f + y}${u.small} は ${x}${u.big} と ${y}${u.small} です。`,
    });
  }
  const t = rng.int(0, 2);
  if (t === 0) {
    // 時こく：◯分後（午前中。答えが「ちょうど◯時」にならないように）
    let start;
    let add;
    let end;
    do {
      start = rng.int(7, 10) * 60 + rng.int(1, 11) * 5;
      add = rng.int(2, 11) * 5;
      end = start + add;
    } while (end % 60 === 0);
    return inputQ(U, `after-${start}-${add}`, 3, {
      q: `${clock(start)}から ${add}分後の時こくは、午前何時何分ですか。`,
      fields: [
        { label: '午前', answer: String(Math.floor(end / 60)), suffix: '時' },
        { label: '', answer: String(end % 60), suffix: '分' },
      ],
      explain: `${clock(start)}の ${add}分後は ${clock(end)}です。ちょうどの時こく（◯時）で区切って考えると わかりやすいよ。`,
      hint: 'まず、ちょうどの時こくまで あと何分かを考えよう。',
    });
  }
  if (t === 1) {
    // 時間：◯時◯分から◯時◯分まで（午前中）
    let start;
    let len;
    do {
      start = rng.int(8, 10) * 60 + rng.int(1, 11) * 5;
      len = rng.int(3, 14) * 5;
    } while (start + len >= 12 * 60);
    const end = start + len;
    const cross = Math.floor(end / 60) > Math.floor(start / 60);
    const toHour = 60 - (start % 60);
    return inputQ(U, `span-${start}-${end}`, 3, {
      q: `${clock(start)}から ${clock(end)}までの時間は何分ですか。`,
      fields: [{ label: '', answer: String(len), suffix: '分' }],
      explain: cross
        ? `${clock(start)}から ${clock(Math.ceil(start / 60) * 60)}までが ${toHour}分、そこから ${clock(end)}までが ${len - toHour}分。あわせて ${len}分です。`
        : `${end % 60} − ${start % 60} ＝ ${len} で、${len}分です。`,
      hint: 'ちょうどの時こく（◯時）で分けて考えよう。',
    });
  }
  const h = rng.int(1, 3);
  const m = rng.int(1, 11) * 5;
  return inputQ(U, `hm-${h}-${m}`, 3, {
    q: `${h}時間${m}分は何分ですか。`,
    fields: [{ label: '', answer: String(h * 60 + m), suffix: '分' }],
    explain: `1時間 ＝ 60分 なので、${h}時間 ＝ ${h * 60}分。${h * 60} ＋ ${m} ＝ ${h * 60 + m}（分）です。`,
  });
}

// ---------- 小数・分数のはじめ（3年） ----------

const F = (n, d) => (n === d ? '1' : `[[${n}/${d}]]`);
const dec1 = (tenths) => (tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`);

function genShoubun(level, rng) {
  const U = 'sansu-shoubun';
  if (level === 1) {
    const t = rng.int(0, 2);
    if (t === 0) {
      const n = rng.int(2, 9);
      return inputQ(U, `tenth-${n}`, 1, {
        q: `0.1 を ${n}こ集めた数はいくつですか。`,
        fields: [{ label: '', answer: dec1(n), decimal: true }],
        explain: `0.1 が ${n}こで ${dec1(n)} です。`,
      });
    }
    if (t === 1) {
      const d = rng.int(3, 9);
      const n = rng.int(2, d - 1);
      return choiceQ(U, `unitfrac-${n}-${d}`, 1, {
        q: `[[1/${d}]] の ${n}こ分は いくつですか。`,
        choices: withDistractors(rng, F(n, d), [F(1, d), F(d, n > 1 ? n : 2), F(n, d + 1), F(Math.max(1, n - 1), d)].filter((c) => c !== F(n, d))),
        answer: F(n, d),
        explain: `[[1/${d}]] の ${n}こ分は ${F(n, d)} です。分母は同じで、分子が いくつ分かを表します。`,
      });
    }
    const d = rng.int(3, 9);
    return inputQ(U, `one-${d}`, 1, {
      q: `1 は、[[1/${d}]] の何こ分ですか。`,
      fields: [{ label: '', answer: String(d), suffix: 'こ分' }],
      explain: `[[1/${d}]] を ${d}こ集めると [[${d}/${d}]]、つまり 1 になります。`,
    });
  }
  if (level === 2) {
    const t = rng.int(0, 2);
    if (t === 0) {
      let n;
      do n = rng.int(11, 49); while (n % 10 === 0);
      return inputQ(U, `count-${n}`, 2, {
        q: `${dec1(n)} は、0.1 を何こ集めた数ですか。`,
        fields: [{ label: '', answer: String(n), suffix: 'こ' }],
        explain: `${Math.floor(n / 10)} は 0.1 が ${Math.floor(n / 10) * 10}こ、0.${n % 10} は 0.1 が ${n % 10}こ。あわせて ${n}こです。`,
      });
    }
    if (t === 1) {
      const d = rng.int(4, 9);
      let a = rng.int(1, d - 1);
      let b = rng.int(1, d - 1);
      if (a === b) b = a === 1 ? 2 : a - 1;
      const big = Math.max(a, b);
      return choiceQ(U, `cmp-${a}-${b}-${d}`, 2, {
        q: `[[${a}/${d}]] と [[${b}/${d}]] では、どちらが大きいですか。`,
        choices: [F(a, d), F(b, d)],
        answer: F(big, d),
        explain: `分母が同じ分数は、分子が大きいほうが大きいです。${F(big, d)} は [[1/${d}]] の ${big}こ分です。`,
      });
    }
    const a = rng.int(2, 9);
    const b = rng.int(2, 9);
    const add = rng.chance(0.5) || a <= b;
    const x = add ? a : Math.max(a, b) + 10;
    const y = add ? b : Math.min(a, b);
    const ans = add ? x + y : x - y;
    return inputQ(U, `dec-${add ? 'a' : 's'}-${x}-${y}`, 2, {
      q: '小数の計算をしましょう。',
      big: `${dec1(x)} ${add ? '＋' : '−'} ${dec1(y)}`,
      fields: [{ label: '', answer: dec1(ans), decimal: true }],
      explain: `0.1 が ${x}こ ${add ? '＋' : '−'} 0.1 が ${y}こ ＝ 0.1 が ${ans}こ で、${dec1(ans)} です。`,
      hint: '0.1 がいくつ分かで考えよう。',
    });
  }
  const d = rng.int(4, 9);
  if (rng.chance(0.5)) {
    const a = rng.int(1, d - 2);
    const b = rng.int(1, d - 1 - a);
    const s = a + b;
    return choiceQ(U, `fadd-${a}-${b}-${d}`, 3, {
      q: `[[${a}/${d}]] ＋ [[${b}/${d}]] は いくつですか。`,
      choices: withDistractors(rng, F(s, d), [F(s, d + d), F(s, d * 2 > 9 ? d + 1 : d * 2), F(Math.max(1, s - 1), d), F(s + 1 <= d ? s + 1 : 1, d)].filter((c) => c !== F(s, d))),
      answer: F(s, d),
      explain: `[[1/${d}]] が ${a}こ と ${b}こで ${s}こ。だから ${F(s, d)} です。分母は そのままです。`,
    });
  }
  const b = rng.int(1, d - 1);
  return choiceQ(U, `fsub1-${b}-${d}`, 3, {
    q: `1 − [[${b}/${d}]] は いくつですか。`,
    choices: withDistractors(rng, F(d - b, d), [F(b, d), F(Math.max(1, d - b - 1), d), F(d - b, d + 1), F(1, d)].filter((c) => c !== F(d - b, d))),
    answer: F(d - b, d),
    explain: `1 は [[${d}/${d}]] です。[[1/${d}]] が ${d}こ から ${b}こ ひいて ${d - b}こ。だから ${F(d - b, d)} です。`,
  });
}

// ---------- 円と三角形（3年） ----------

const SANKAKU_BANK = [
  {
    level: 1,
    q: '3つの辺の長さが、すべて等しい三角形を何といいますか。',
    choices: ['正三角形', '二等辺三角形', '直角三角形'],
    a: '正三角形',
    e: '3つの辺の長さが等しい三角形を正三角形といいます。',
  },
  {
    level: 1,
    q: '2つの辺の長さが等しい三角形を何といいますか。',
    choices: ['二等辺三角形', '正三角形', '直角三角形'],
    a: '二等辺三角形',
    e: '2つの辺の長さが等しい三角形を二等辺三角形といいます。',
  },
  {
    level: 2,
    q: '正三角形の3つの角の大きさは、どうなっていますか。',
    choices: ['3つとも等しい', '2つだけ等しい', '3つともちがう'],
    a: '3つとも等しい',
    e: '正三角形は、3つの角の大きさがすべて等しくなっています。',
  },
  {
    level: 2,
    q: '二等辺三角形の角の大きさは、どうなっていますか。',
    choices: ['2つの角が等しい', '3つの角が等しい', 'どの角もちがう'],
    a: '2つの角が等しい',
    e: '二等辺三角形は、2つの角の大きさが等しくなっています。',
  },
  {
    level: 3,
    q: '{球|きゅう}を どこで切っても、切り口は どんな形になりますか。',
    choices: ['円', '正方形', '三角形', '長方形'],
    a: '円',
    e: '{球|きゅう}は、どこで切っても切り口が円になります。まん中で切ったときが いちばん大きい円です。',
  },
];

function genZukei(level, rng) {
  const U = 'sansu-zukei';
  const bank = SANKAKU_BANK.map((item, i) => ({ item, i })).filter(({ item }) => item.level === level);
  if (rng.chance(0.35)) {
    const { item, i } = rng.pick(bank);
    return choiceQ(U, `b-${i}`, item.level, { q: item.q, choices: item.choices, answer: item.a, explain: item.e });
  }
  if (level === 1) {
    const r = rng.int(2, 12);
    if (rng.chance(0.5)) {
      return inputQ(U, `diam-${r}`, 1, {
        q: `半径が ${r}cm の円の、直径の長さは何cmですか。`,
        fields: [{ label: '', answer: String(r * 2), suffix: 'cm' }],
        explain: `直径は半径の2つ分です。${r} × 2 ＝ ${r * 2}（cm）です。`,
      });
    }
    return inputQ(U, `rad-${r}`, 1, {
      q: `直径が ${r * 2}cm の円の、半径の長さは何cmですか。`,
      fields: [{ label: '', answer: String(r), suffix: 'cm' }],
      explain: `半径は直径の半分です。${r * 2} ÷ 2 ＝ ${r}（cm）です。`,
    });
  }
  if (level === 2) {
    const eq = rng.int(3, 12);
    // 三角形になるように、もう1つの辺は 等しい辺2つ分より短く
    let other = rng.int(2, Math.min(12, eq * 2 - 1));
    if (other === eq) other = other > 2 ? other - 1 : other + 1;
    if (rng.chance(0.5)) {
      return inputQ(U, `seisan-${eq}`, 2, {
        q: `1辺が ${eq}cm の正三角形の、まわりの長さは何cmですか。`,
        fields: [{ label: '', answer: String(eq * 3), suffix: 'cm' }],
        explain: `正三角形は3つの辺の長さが等しいので、${eq} × 3 ＝ ${eq * 3}（cm）です。`,
      });
    }
    return inputQ(U, `nitou-${eq}-${other}`, 2, {
      q: `等しい2つの辺が ${eq}cm で、もう1つの辺が ${other}cm の二等辺三角形があります。まわりの長さは何cmですか。`,
      fields: [{ label: '', answer: String(eq * 2 + other), suffix: 'cm' }],
      explain: `${eq} ＋ ${eq} ＋ ${other} ＝ ${eq * 2 + other}（cm）です。`,
    });
  }
  // ボールが箱にぴったり（3年）
  const d = rng.pick([4, 6, 8, 10, 12]);
  const n = rng.int(2, 5);
  if (rng.chance(0.5)) {
    return inputQ(U, `balls-${d}-${n}`, 3, {
      q: `直径 ${d}cm のボールが ${n}こ、横1列に 箱にぴったり入っています。箱の横の長さは何cmですか。`,
      fields: [{ label: '', answer: String(d * n), suffix: 'cm' }],
      explain: `ボールの直径 ${d}cm の ${n}こ分なので、${d} × ${n} ＝ ${d * n}（cm）です。`,
      hint: 'ボール1こ分の横の長さは、直径と同じだよ。',
    });
  }
  return inputQ(U, `ballsback-${d}-${n}`, 3, {
    q: `横の長さが ${d * n}cm の箱に、同じ大きさのボールが ${n}こ、横1列にぴったり入っています。ボール1この半径は何cmですか。`,
    fields: [{ label: '', answer: String(d / 2), suffix: 'cm' }],
    explain: `ボール1この直径は ${d * n} ÷ ${n} ＝ ${d}（cm）。半径は直径の半分なので、${d} ÷ 2 ＝ ${d / 2}（cm）です。`,
  });
}

export default {
  subject: 'sansu',
  units: [
    { id: 'sansu-kuku', title: '九九とかけ算', icon: '🍡', description: '九九・0や10のかけ算・2けたのかけ算', grade: 3, gradeLabel: '2・3年', generate: genKuku },
    { id: 'sansu-tashihiki', title: 'たし算・ひき算の筆算', icon: '✏️', description: 'くり上がり・くり下がりのある筆算', grade: 3, gradeLabel: '2・3年', generate: genTashihiki },
    { id: 'sansu-amari', title: 'わり算とあまり', icon: '🍬', description: '九九を使うわり算・あまりのあるわり算', grade: 3, generate: genAmari },
    { id: 'sansu-tani', title: '長さ・かさ・重さ・時間', icon: '⚖️', description: 'たんいの直し方・時こくと時間', grade: 3, gradeLabel: '2・3年', generate: genTani },
    { id: 'sansu-shoubun', title: '小数・分数のはじめ', icon: '🍫', description: '0.1や[[1/4]]のいくつ分・かんたんな計算', grade: 3, generate: genShoubun },
    { id: 'sansu-zukei', title: '円と三角形', icon: '⭕', description: '半径と直径・二等辺三角形・正三角形', grade: 3, generate: genZukei },
  ],
};
