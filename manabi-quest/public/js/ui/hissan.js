// 筆算（たし算・ひき算）の画面。右のくらいから1けたずつ答えを入れる。
// まちがえたら、そのけたの「くり上がり・くり下がり」のヒントを出す。

import { decimalsOf } from '../lib/numfmt.js';

const PLACE_LABEL = { 3: '千の位', 2: '百の位', 1: '十の位', 0: '一の位', '-1': '1/10の位', '-2': '1/100の位', '-3': '1/1000の位' };

function splitNum(s, fd) {
  const [i, f = ''] = String(s).split('.');
  return { int: i, frac: f, fd };
}

/** 位（10のe乗）の数字。なければ null */
function digitAt(num, e) {
  if (e >= 0) {
    const idx = num.int.length - 1 - e;
    return idx >= 0 ? Number(num.int[idx]) : null;
  }
  const idx = -e - 1;
  return idx < num.frac.length ? Number(num.frac[idx]) : null;
}

/** 筆算の計算手順（各けたの答え・くり上がり・くり下がり）を作る */
export function planHissan({ op, a, b, result }) {
  const fd = Math.max(decimalsOf(a), decimalsOf(b), decimalsOf(result));
  const A = splitNum(a, fd);
  const B = splitNum(b, fd);
  const R = splitNum(result, fd);
  const maxExp = Math.max(A.int.length, B.int.length, R.int.length) - 1;
  const answerExps = [];
  for (let e = -fd; e <= R.int.length - 1; e += 1) answerExps.push(e);

  const hints = {}; // e -> 表示する小さな数字
  const adjusted = {}; // ひき算で書きかえた上の数字
  let carry = 0;
  for (let e = -fd; e <= maxExp; e += 1) {
    const da = digitAt(A, e) ?? 0;
    const db = digitAt(B, e) ?? 0;
    if (op === '+') {
      if (carry) hints[e] = '1';
      const sum = da + db + carry;
      carry = sum >= 10 ? 1 : 0;
    } else {
      let t = da - carry;
      let borrowOut = 0;
      if (t < db) {
        t += 10;
        borrowOut = 1;
      }
      if (carry || borrowOut) {
        adjusted[e] = t;
        hints[e] = String(t);
      }
      carry = borrowOut;
    }
  }
  return { fd, A, B, R, maxExp, answerExps, hints, adjusted };
}

/**
 * @param {HTMLElement} container
 * @param {{op:string,a:string,b:string,result:string}} spec
 * @param {{hintMode:'auto'|'onError', onDigit:(result:'ok'|'fixed'|'wrong'|'shown', el:HTMLElement)=>void, onComplete:(r:{correct:boolean, mistakes:number})=>void}} opts
 *   onDigit の result … ok=せいかい / fixed=まちがえた後に せいかい / wrong=まちがい / shown=2回まちがえたので答えを出した
 */
export function createHissan(container, spec, { hintMode = 'onError', onDigit = () => {}, onComplete = () => {} } = {}) {
  const plan = planHissan(spec);
  const { fd, A, B, R, maxExp, answerExps, hints, adjusted } = plan;
  const exps = [];
  for (let e = maxExp; e >= -fd; e -= 1) exps.push(e);
  const cols = ['op', ...exps.flatMap((e) => (e === -1 ? ['dot', e] : [e]))];
  const shownHints = new Set();
  const filled = {};
  let pos = 0; // answerExps のどこまで入れたか
  let mistakes = 0;
  let wrongHere = 0;
  let finished = false;

  const colTemplate = cols.map((c) => (c === 'dot' ? 'var(--hs-dot)' : 'var(--hs-cell)')).join(' ');
  const topPadZeros = spec.op === '-';

  function cellFor(row, c) {
    if (c === 'op') {
      if (row === 'b') return `<span class="hs-op">${spec.op === '+' ? '＋' : '−'}</span>`;
      return '<span></span>';
    }
    if (c === 'dot') {
      if (row === 'hint') return '<span></span>';
      const faint = row === 'a' && decimalsOf(spec.a) === 0;
      if (row === 'a' || row === 'b') {
        const show = row === 'a' ? decimalsOf(spec.a) > 0 || topPadZeros : decimalsOf(spec.b) > 0;
        return `<span class="hs-dot ${faint ? 'faint' : ''}">${show ? '.' : ''}</span>`;
      }
      if (row === 'ans') return '<span class="hs-dot hs-dot--ans">.</span>';
      return '<span></span>';
    }
    const e = c;
    if (row === 'hint') {
      const h = hints[e];
      const on = h !== undefined && shownHints.has(e);
      return `<span class="hs-hint ${on ? 'on' : ''} ${spec.op === '+' ? 'carry' : 'borrow'}" data-e="${e}">${h ?? ''}</span>`;
    }
    if (row === 'a' || row === 'b') {
      const num = row === 'a' ? A : B;
      let d = digitAt(num, e);
      let faint = false;
      if (d === null && row === 'a' && topPadZeros && e < 0) {
        d = 0;
        faint = true;
      }
      const struck = row === 'a' && adjusted[e] !== undefined && shownHints.has(e);
      return `<span class="hs-digit ${faint ? 'faint' : ''} ${struck ? 'struck' : ''}" data-row="${row}" data-e="${e}">${d ?? ''}</span>`;
    }
    if (row === 'ans') {
      if (!answerExps.includes(e)) return '<span></span>';
      const v = filled[e];
      const active = !finished && answerExps[pos] === e;
      return `<span class="hs-box ${active ? 'active' : ''} ${v ? `filled ${v.state}` : ''}" data-e="${e}">${v ? v.d : active ? '?' : ''}</span>`;
    }
    if (row === 'label') {
      const active = !finished && answerExps[pos] === e;
      return `<span class="hs-label">${active ? PLACE_LABEL[e] ?? '' : ''}</span>`;
    }
    return '<span></span>';
  }

  function render() {
    const rows = ['hint', 'a', 'b', 'ans', 'label'];
    container.innerHTML = `
      <div class="hissan" style="--hs-cols:${colTemplate}" role="group" aria-label="筆算 ${spec.a} ${spec.op === '+' ? 'たす' : 'ひく'} ${spec.b}">
        ${rows
          .map(
            (row) =>
              `<div class="hs-row hs-row--${row}" style="grid-template-columns:${colTemplate}">${cols.map((c) => cellFor(row, c)).join('')}</div>`,
          )
          .join('')}
        <div class="hs-left" aria-live="polite">${finished ? '' : `<span class="${answerExps.length - pos === 1 ? 'last' : ''}">あと ${answerExps.length - pos} けた${answerExps.length - pos === 1 ? '！' : ''}</span>`}</div>
      </div>`;
  }

  function showHintFor(e) {
    if (hints[e] !== undefined) shownHints.add(e);
  }

  function autoHints() {
    if (hintMode !== 'auto') return;
    // 今のけたと、もう終わったけたのヒントを出す
    answerExps.slice(0, pos + 1).forEach(showHintFor);
    if (spec.op === '-') {
      // ひき算は、次のけたでくり下げる「元の数字」を先に見せる
      const e = answerExps[pos];
      if (e !== undefined && adjusted[e] !== undefined) showHintFor(e);
    }
  }

  function expectedDigit(e) {
    return digitAt(R, e);
  }

  const api = {
    input(d) {
      if (finished) return;
      const e = answerExps[pos];
      const expected = expectedDigit(e);
      let result;
      if (Number(d) === expected) {
        result = wrongHere ? 'fixed' : 'ok';
        filled[e] = { d: expected, state: result };
        wrongHere = 0;
        pos += 1;
      } else {
        mistakes += 1;
        wrongHere += 1;
        showHintFor(e);
        result = 'wrong';
        if (wrongHere >= 2) {
          result = 'shown';
          filled[e] = { d: expected, state: result };
          wrongHere = 0;
          pos += 1;
        }
      }
      if (pos >= answerExps.length) finished = true;
      autoHints();
      render();
      onDigit(result, container.querySelector(`.hs-box[data-e="${e}"]`));
      if (finished) onComplete({ correct: mistakes === 0, mistakes });
    },
    revealHint() {
      const e = answerExps[pos];
      showHintFor(e);
      answerExps.slice(0, pos).forEach(showHintFor);
      render();
      return hints[e] !== undefined;
    },
    get mistakes() {
      return mistakes;
    },
    get finished() {
      return finished;
    },
    plan,
  };

  autoHints();
  render();
  return api;
}
