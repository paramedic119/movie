// 問題文で使える小さな記法
//   {漢字|かんじ}  … ふりがな（ルビ）
//   **ことば**     … 強調（太字＋マーカー）
//   __ことば__     … 下線（「――線の言葉」用）
//   [[3/7]]        … 分数、[[2 3/7]] … 帯分数
//   改行は \n

const TOKEN_RE = /(\{[^{}|\n]+\|[^{}|\n]+\})|(\*\*)|(__)|(\[\[\s*(?:\d+\s+)?\d+\s*\/\s*\d+\s*\]\])|(\n)/g;

/**
 * 記法を木構造に変換する。
 * @returns {{nodes: any[], errors: string[]}}
 */
export function parseMarkup(src) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  const errors = [];
  const top = () => stack[stack.length - 1];
  const pushText = (text) => {
    if (!text) return;
    const kids = top().children;
    const last = kids[kids.length - 1];
    if (last && last.type === 'text') last.text += text;
    else kids.push({ type: 'text', text });
  };
  const toggle = (type) => {
    const current = top();
    if (current.type === type) {
      stack.pop();
      return;
    }
    if (stack.some((n) => n.type === type)) {
      errors.push(`「${type === 'strong' ? '**' : '__'}」の組み合わせがおかしい`);
      return;
    }
    const node = { type, children: [] };
    current.children.push(node);
    stack.push(node);
  };

  let last = 0;
  const text = String(src ?? '');
  for (const m of text.matchAll(TOKEN_RE)) {
    pushText(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      const [base, rt] = m[1].slice(1, -1).split('|');
      top().children.push({ type: 'ruby', base, rt });
    } else if (m[2]) {
      toggle('strong');
    } else if (m[3]) {
      toggle('u');
    } else if (m[4]) {
      const body = m[4].slice(2, -2).trim();
      const mixed = body.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
      const simple = body.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (mixed) top().children.push({ type: 'frac', whole: mixed[1], num: mixed[2], den: mixed[3] });
      else if (simple) top().children.push({ type: 'frac', whole: '', num: simple[1], den: simple[2] });
    } else if (m[5]) {
      top().children.push({ type: 'br' });
    }
  }
  pushText(text.slice(last));
  if (stack.length > 1) errors.push('「**」または「__」が閉じられていない');
  if (/[{}]/.test(text.replace(TOKEN_RE, ''))) errors.push('ふりがな記法 {漢字|よみ} の形がおかしい');
  return { nodes: root.children, errors };
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]);
}

function nodesToHtml(nodes) {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return escapeHtml(n.text);
        case 'ruby':
          return `<ruby>${escapeHtml(n.base)}<rt>${escapeHtml(n.rt)}</rt></ruby>`;
        case 'strong':
          return `<strong class="mk-em">${nodesToHtml(n.children)}</strong>`;
        case 'u':
          return `<span class="mk-u">${nodesToHtml(n.children)}</span>`;
        case 'br':
          return '<br>';
        case 'frac': {
          const whole = n.whole ? `<span class="frac-whole">${escapeHtml(n.whole)}</span>` : '';
          const label = n.whole ? `${n.whole}と${n.den}ぶんの${n.num}` : `${n.den}ぶんの${n.num}`;
          return `<span class="frac" role="img" aria-label="${label}">${whole}<span class="frac-body"><span class="frac-num">${escapeHtml(n.num)}</span><span class="frac-den">${escapeHtml(n.den)}</span></span></span>`;
        }
        default:
          return '';
      }
    })
    .join('');
}

/** 記法を安全な HTML に変換する */
export function renderMarkup(src) {
  return nodesToHtml(parseMarkup(src).nodes);
}

function nodesToText(nodes, { rubyAs = 'base', skipRuby = false } = {}) {
  return nodes
    .map((n) => {
      switch (n.type) {
        case 'text':
          return n.text;
        case 'ruby':
          if (skipRuby) return '';
          return rubyAs === 'rt' ? n.rt : n.base;
        case 'strong':
        case 'u':
          return nodesToText(n.children, { rubyAs, skipRuby });
        case 'br':
          return ' ';
        case 'frac':
          return n.whole ? `${n.whole}と${n.num}/${n.den}` : `${n.num}/${n.den}`;
        default:
          return '';
      }
    })
    .join('');
}

/** 記法を取りのぞいた文字列（比較・読み上げ用） */
export function plainText(src) {
  return nodesToText(parseMarkup(src).nodes);
}

/** ふりがなの付いていない部分だけの文字列（漢字チェック用） */
export function textOutsideRuby(src) {
  return nodesToText(parseMarkup(src).nodes, { skipRuby: true });
}
