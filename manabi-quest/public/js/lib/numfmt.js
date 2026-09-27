// 数の表記・小数の計算（小数は BigInt で計算して誤差を出さない）

const KANJI_DIGITS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const GROUP_UNITS = ['', '万', '億', '兆', '京'];

/** 入力された答えを比べやすい形にする（"007"→"7"、"7.20"→"7.2"、".5"→"0.5"）。数でなければ null */
export function normalizeNumber(raw) {
  const s = String(raw ?? '').replace(/[\s,， ]/g, '');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  let [intPart, frac = ''] = s.split('.');
  intPart = intPart.replace(/^0+(?=\d)/, '') || '0';
  frac = frac.replace(/0+$/, '');
  return frac ? `${intPart}.${frac}` : intPart;
}

/** 整数を4けたごとに区切って表示（"350000000" → "3 5000 0000"） */
export function groupBy4(digits) {
  const s = String(digits);
  const [intPart, frac] = s.split('.');
  const out = [];
  for (let end = intPart.length; end > 0; end -= 4) out.unshift(intPart.slice(Math.max(0, end - 4), end));
  const joined = out.join(' ');
  return frac !== undefined ? `${joined}.${frac}` : joined;
}

function groupsOf(n) {
  let v = BigInt(n);
  const groups = [];
  while (v > 0n) {
    groups.push(Number(v % 10000n));
    v /= 10000n;
  }
  return groups;
}

/** 数字と漢字まじり（教科書の「3億5000万」の形） */
export function toMixedJa(n) {
  const v = BigInt(n);
  if (v === 0n) return '0';
  const groups = groupsOf(v);
  let out = '';
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (groups[i] !== 0) out += `${groups[i]}${GROUP_UNITS[i]}`;
  }
  return out;
}

function fourDigitsToKanji(n) {
  const units = ['千', '百', '十', ''];
  const digits = String(n).padStart(4, '0').split('').map(Number);
  let out = '';
  digits.forEach((d, i) => {
    if (d === 0) return;
    if (units[i] && d === 1) out += units[i];
    else out += KANJI_DIGITS[d] + units[i];
  });
  return out;
}

/** 漢数字（「三億五千万」） */
export function toKanjiJa(n) {
  const v = BigInt(n);
  if (v === 0n) return 'ゼロ';
  const groups = groupsOf(v);
  let out = '';
  for (let i = groups.length - 1; i >= 0; i -= 1) {
    if (groups[i] !== 0) out += fourDigitsToKanji(groups[i]) + GROUP_UNITS[i];
  }
  return out;
}

/** 3けたごとのカンマ（コインの表示用） */
export function withCommas(n) {
  return Math.round(Number(n)).toLocaleString('ja-JP');
}

// ---- 小数（10進数の文字列）を正確に計算する ----

/** "3.45" → { v: 345n, scale: 2 } */
export function parseDec(str) {
  const s = String(str);
  const [i, f = ''] = s.split('.');
  return { v: BigInt(i + f), scale: f.length };
}

function rescale(d, scale) {
  return d.v * 10n ** BigInt(scale - d.scale);
}

/** BigInt と小数点以下のけた数から文字列を作る（keepZeros=true なら末尾の0を残す） */
export function formatDec(v, scale, { keepZeros = false } = {}) {
  const neg = v < 0n;
  let s = (neg ? -v : v).toString().padStart(scale + 1, '0');
  let out = scale > 0 ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  if (!keepZeros && scale > 0) out = out.replace(/\.?0+$/, '');
  return (neg ? '-' : '') + out;
}

export function decAdd(a, b, opts) {
  const x = parseDec(a);
  const y = parseDec(b);
  const scale = Math.max(x.scale, y.scale);
  return formatDec(rescale(x, scale) + rescale(y, scale), scale, opts);
}

export function decSub(a, b, opts) {
  const x = parseDec(a);
  const y = parseDec(b);
  const scale = Math.max(x.scale, y.scale);
  return formatDec(rescale(x, scale) - rescale(y, scale), scale, opts);
}

/** 小数 × 小数（4年生では 小数 × 整数） */
export function decMul(a, b) {
  const x = parseDec(a);
  const y = parseDec(b);
  return formatDec(x.v * y.v, x.scale + y.scale);
}

/** 小数 ÷ 整数（わり切れるときだけ。わり切れなければ null） */
export function decDivExact(a, b, maxScale = 4) {
  const x = parseDec(a);
  const d = BigInt(b);
  for (let scale = x.scale; scale <= maxScale; scale += 1) {
    const num = rescale(x, scale);
    if (num % d === 0n) return formatDec(num / d, scale);
  }
  return null;
}

export function decimalsOf(str) {
  const f = String(str).split('.')[1];
  return f ? f.length : 0;
}
