// 面積の問題の図（SVG）

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
  return '';
}
