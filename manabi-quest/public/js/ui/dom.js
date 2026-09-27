// 画面づくりの小さな道具

import { escapeHtml, renderMarkup } from '../lib/markup.js';

export const esc = escapeHtml;
/** 問題文などの記法（ふりがな・分数など）を HTML にする */
export const md = (s) => renderMarkup(s ?? '');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * data-act="名前" のついたボタンのクリックをまとめて受け取る。
 * @returns {() => void} 解除する関数
 */
export function onAct(root, handlers) {
  const listener = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !root.contains(el) || el.disabled) return;
    const fn = handlers[el.dataset.act];
    if (fn) {
      e.preventDefault();
      fn(el, e);
    }
  };
  root.addEventListener('click', listener);
  return () => root.removeEventListener('click', listener);
}

export function starsHtml(n, max = 3) {
  let out = '';
  for (let i = 0; i < max; i += 1) out += `<span class="star ${i < n ? 'on' : ''}" aria-hidden="true">★</span>`;
  return `<span class="stars" role="img" aria-label="${max}つ中${n}つ">${out}</span>`;
}

export function exBadgesHtml(ex) {
  return `<span class="ex-badges">${[1, 2, 3]
    .map((i) => `<span class="ex-badge ${ex >= i ? 'on' : ''}">EX${i}</span>`)
    .join('')}${ex >= 3 ? '<span class="master-badge">👑 マスター</span>' : ''}</span>`;
}

export function minutesText(sec) {
  if (sec === Infinity) return 'せいげんなし';
  const m = Math.max(0, Math.ceil(sec / 60));
  return `${m}分`;
}
