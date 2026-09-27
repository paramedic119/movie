// 算数の問題の図（面積の図形・折れ線グラフ・表・平行四辺形）

import { esc } from './dom.js';

const INK = 'var(--ink)';

function label(x, y, text, anchor = 'middle') {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle" class="fig-label">${esc(text)}</text>`;
}

export function figureSvg(fig) {
  if (!fig) return '';
  if (fig.type === 'rect') {
    const maxW = 220;
    const maxH = 130;
    const s = Math.min(maxW / fig.w, maxH / fig.h);
    const w = fig.w * s;
    const h = fig.h * s;
    const ox = 58;
    const oy = 14;
    return `<svg class="figure" viewBox="0 0 ${ox + w + 20} ${oy + h + 40}" role="img" aria-label="たて${esc(fig.labelH)}、横${esc(fig.labelW)}の四角形">
      <rect x="${ox}" y="${oy}" width="${w}" height="${h}" rx="3" fill="var(--fig-fill)" stroke="${INK}" stroke-width="3"/>
      ${label(ox + w / 2, oy + h + 22, fig.labelW)}
      ${label(ox - 10, oy + h / 2, fig.labelH, 'end')}
    </svg>`;
  }
  if (fig.type === 'lshape') {
    const { W, H, w, h } = fig;
    const s = Math.min(230 / W, 150 / H);
    const ox = 58;
    const oy = 28;
    const X = (v) => ox + v * s;
    const Y = (v) => oy + v * s;
    const pts = [
      [0, 0],
      [W - w, 0],
      [W - w, h],
      [W, h],
      [W, H],
      [0, H],
    ]
      .map(([x, y]) => `${X(x)},${Y(y)}`)
      .join(' ');
    const unit = fig.unit ?? 'cm';
    return `<svg class="figure" viewBox="0 0 ${X(W) + 64} ${Y(H) + 40}" role="img" aria-label="たて${H}${unit}、横${W}${unit}の長方形から、右上のたて${h}${unit}、横${w}${unit}を切りとった形">
      <rect x="${X(W - w)}" y="${Y(0)}" width="${w * s}" height="${h * s}" fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-dasharray="6 5"/>
      <polygon points="${pts}" fill="var(--fig-fill)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
      ${label(X(W / 2), Y(H) + 22, `${W}${unit}`)}
      ${label(X(0) - 10, Y(H / 2), `${H}${unit}`, 'end')}
      ${label(X(W - w / 2), Y(0) - 14, `${w}${unit}`)}
      ${label(X(W) + 8, Y(h / 2), `${h}${unit}`, 'start')}
    </svg>`;
  }
  if (fig.type === 'line') return lineGraph(fig);
  if (fig.type === 'table') return tableHtml(fig);
  if (fig.type === 'para') return parallelogram(fig);
  if (fig.type === 'parallel') return parallelLines(fig);
  return '';
}

/**
 * 平行な2本の直線ア・イに、1本の直線が交わった図。
 * { theta: 直線のかたむき（右がわから左回りに はかった角）, given: 上の交わりで示す角, ask: 下の交わりで「？」にする角 }
 * 角の場所：ur=右上 ul=左上 ll=左下 lr=右下
 */
const ANGLE_SPAN = { ur: (t) => [0, t], ul: (t) => [t, 180], ll: (t) => [180, 180 + t], lr: (t) => [180 + t, 360] };
const ANGLE_WHERE = { ur: '右上', ul: '左上', ll: '左下', lr: '右下' };
/** 交わってできる角の大きさ（場所ごと） */
export const angleAt = (theta, where) => (where === 'ur' || where === 'll' ? theta : 180 - theta);
function parallelLines(fig) {
  const { theta } = fig;
  const W = 320;
  const yTop = 58;
  const yBot = 142;
  const run = (yBot - yTop) / Math.tan((theta * Math.PI) / 180);
  const xTop = 160 + run / 2;
  const xBot = 160 - run / 2;
  const ext = 42 / Math.sin((theta * Math.PI) / 180);
  const c = Math.cos((theta * Math.PI) / 180);
  const sn = Math.sin((theta * Math.PI) / 180);
  const pt = (x, y, deg, r) => [x + r * Math.cos((deg * Math.PI) / 180), y - r * Math.sin((deg * Math.PI) / 180)];
  const mark = (x, y, where, text, color) => {
    const [a0, a1] = ANGLE_SPAN[where](theta);
    const r = 20;
    const [sx, sy] = pt(x, y, a0, r);
    const [ex, ey] = pt(x, y, a1, r);
    const [lx, ly] = pt(x, y, (a0 + a1) / 2, r + 17);
    return `<path d="M ${sx} ${sy} A ${r} ${r} 0 0 0 ${ex} ${ey}" fill="none" stroke="${color}" stroke-width="2.5"/>${label(lx, ly, text)}`;
  };
  const given = angleAt(theta, fig.given);
  return `<svg class="figure" viewBox="0 0 ${W} 200" role="img" aria-label="平行な直線アとイに、1本の直線が交わっている図。アとの交わりの${ANGLE_WHERE[fig.given]}の角が ${given}度、イとの交わりの${ANGLE_WHERE[fig.ask]}の角が「？」">
    <line x1="24" x2="${W - 24}" y1="${yTop}" y2="${yTop}" stroke="${INK}" stroke-width="3"/>
    <line x1="24" x2="${W - 24}" y1="${yBot}" y2="${yBot}" stroke="${INK}" stroke-width="3"/>
    ${label(12, yTop, 'ア')}
    ${label(12, yBot, 'イ')}
    <line x1="${xTop + ext * c}" y1="${yTop - ext * sn}" x2="${xBot - ext * c}" y2="${yBot + ext * sn}" stroke="${INK}" stroke-width="3"/>
    ${mark(xTop, yTop, fig.given, `${given}°`, 'var(--ng)')}
    ${mark(xBot, yBot, fig.ask, '？', 'var(--blue, #2f8dff)')}
  </svg>`;
}

/**
 * 折れ線グラフ
 * { xs: ['1','2',…], ys: [数], yMax, yStep: 1目もり, yLabelEvery: 数字を書く間かく, xUnit, yUnit, name }
 */
function lineGraph(fig) {
  const { xs, ys, yMax, yStep, yLabelEvery, xUnit = '', yUnit = '' } = fig;
  const yMin = fig.yMin ?? 0;
  const gap = yMin > 0 ? 24 : 0; // 0 から yMin までを波線で省くときの すき間
  const W = 330;
  const H = 230 + gap;
  const L = 44;
  const R = 14;
  const T = 26;
  const B = 40 + gap;
  const pw = W - L - R;
  const ph = H - T - B;
  const X = (i) => L + (pw * (i + 0.5)) / xs.length;
  const Y = (v) => T + ph - (ph * (v - yMin)) / (yMax - yMin);
  const base = T + ph + gap; // よこのじく
  let grid = '';
  for (let v = yMin; v <= yMax; v += yStep) {
    const major = v % yLabelEvery === 0;
    grid += `<line x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}" class="${major ? 'fig-grid fig-grid--major' : 'fig-grid'}"/>`;
    if (major) grid += label(L - 6, Y(v), String(v), 'end');
  }
  const wave = gap
    ? `<path d="M ${L - 7} ${T + ph + 11} l 7 -3 l 7 3 M ${L - 7} ${T + ph + 16} l 7 -3 l 7 3" class="fig-wave"/>${label(L - 10, base, '0', 'end')}`
    : '';
  const xl = xs.map((x, i) => label(X(i), base + 14, x)).join('');
  const pts = ys.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
  const dots = ys.map((v, i) => `<circle cx="${X(i)}" cy="${Y(v)}" r="4" class="fig-dot"/>`).join('');
  const desc = xs.map((x, i) => `${x}${xUnit.replace(/[（）]/g, '')} ${ys[i]}${yUnit.replace(/[（）]/g, '')}`).join('、');
  return `<svg class="figure figure--graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(fig.name ?? '折れ線グラフ')}：${esc(desc)}">
    ${grid}
    <line x1="${L}" x2="${L}" y1="${T - 6}" y2="${base}" class="fig-axis"/>
    <line x1="${L}" x2="${L + pw}" y1="${base}" y2="${base}" class="fig-axis"/>
    ${wave}
    ${label(L - 6, T - 14, yUnit, 'start')}
    ${xl}
    ${label(L + pw, base + 30, xUnit, 'end')}
    <polyline points="${pts}" class="fig-line"/>
    ${dots}
  </svg>`;
}

/** 表 { head: ['', '列1', …], rows: [['行の名前', 'セル', …], …] }（「？」のセルは強調） */
function tableHtml(fig) {
  const th = (c) => `<th scope="col">${esc(c)}</th>`;
  const td = (c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td class="${c === '？' ? 'ask' : ''}">${esc(c)}</td>`);
  return `<table class="fig-table">
    ${fig.caption ? `<caption>${esc(fig.caption)}</caption>` : ''}
    ${fig.head ? `<thead><tr>${fig.head.map(th).join('')}</tr></thead>` : ''}
    <tbody>${fig.rows.map((r) => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

/**
 * 平行四辺形 ABCD（ひし形も）。B が左下、C が右下。
 * { a: 辺ABの長さ, b: 辺BCの長さ, angle: 角Bの大きさ, sideA, sideB: 辺につける文字, angleText }
 */
function parallelogram(fig) {
  const { a, b, angle } = fig;
  const t = (angle * Math.PI) / 180;
  const dx = a * Math.cos(t);
  const dy = a * Math.sin(t);
  const minX = Math.min(0, dx);
  const maxX = Math.max(b, b + dx);
  const s = Math.min(230 / (maxX - minX), 120 / dy);
  const ox = 40 - minX * s;
  const oy = 30 + dy * s;
  const P = (x, y) => [ox + x * s, oy - y * s];
  const A = P(dx, dy);
  const B = P(0, 0);
  const C = P(b, 0);
  const D = P(b + dx, dy);
  const width = ox + maxX * s + 40;
  const pts = [A, B, C, D].map(([x, y]) => `${x},${y}`).join(' ');
  const r = 22;
  const arc = `M ${B[0] + r} ${B[1]} A ${r} ${r} 0 0 0 ${B[0] + r * Math.cos(t)} ${B[1] - r * Math.sin(t)}`;
  const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const [abx, aby] = mid(A, B);
  const [bcx, bcy] = mid(B, C);
  return `<svg class="figure" viewBox="0 0 ${width} ${oy + 34}" role="img" aria-label="${esc(fig.name ?? '平行四辺形')} ABCD${fig.angleText ? `、角B ${esc(fig.angleText)}` : ''}${fig.sideA ? `、辺AB ${esc(fig.sideA)}` : ''}${fig.sideB ? `、辺BC ${esc(fig.sideB)}` : ''}">
    <polygon points="${pts}" fill="var(--fig-fill)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    ${fig.angleText ? `<path d="${arc}" fill="none" stroke="var(--ng)" stroke-width="2.5"/>${label(B[0] + r + 16, B[1] - 12, fig.angleText, 'start')}` : ''}
    ${label(A[0] - 4, A[1] - 12, 'A')}
    ${label(B[0] - 12, B[1] + 6, 'B')}
    ${label(C[0] + 12, C[1] + 6, 'C')}
    ${label(D[0] + 4, D[1] - 12, 'D')}
    ${fig.sideA ? label(abx - 10, aby, fig.sideA, 'end') : ''}
    ${fig.sideB ? label(bcx, bcy + 20, fig.sideB) : ''}
  </svg>`;
}
