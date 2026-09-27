// ダイアログとお知らせ

import { esc } from './dom.js';

let root = null;
let toastTimer = 0;
const openDismissers = new Set();

function ensureRoot() {
  if (!root) root = document.getElementById('modal-root');
  return root;
}

/**
 * ダイアログを開く。えらんだボタンの value で resolve する。
 * @param {{title:string, body?:string, actions?:{label:string,value:any,variant?:string}[], dismissValue?:any, className?:string}} opts
 */
export function openModal({ title, body = '', actions = [{ label: 'OK', value: true, variant: 'primary' }], dismissValue = null, className = '' }) {
  const host = ensureRoot();
  const prevFocus = document.activeElement;
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = `modal ${className}`;
    wrap.innerHTML = `
      <div class="modal__backdrop" data-close></div>
      <div class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 class="modal__title" id="modal-title">${title}</h2>
        <div class="modal__body">${body}</div>
        <div class="modal__actions">
          ${actions
            .map((a, i) => `<button type="button" class="btn btn--${a.variant ?? 'plain'}" data-i="${i}">${esc(a.label)}</button>`)
            .join('')}
        </div>
      </div>`;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      openDismissers.delete(dismiss);
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      if (prevFocus && typeof prevFocus.focus === 'function') prevFocus.focus();
      resolve(value);
    };
    const dismiss = () => close(dismissValue);
    openDismissers.add(dismiss);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(dismissValue);
      }
    };
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-i]');
      if (btn) close(actions[Number(btn.dataset.i)].value);
      else if (e.target.matches('[data-close]')) close(dismissValue);
    });
    document.addEventListener('keydown', onKey, true);
    host.appendChild(wrap);
    const primary = wrap.querySelector('.btn--primary, .btn--ex') ?? wrap.querySelector('button');
    primary?.focus();
  });
}

/** 画面を切りかえるときに、開いているダイアログを「とじる」をえらんだあつかいで閉じる */
export function closeAllModals() {
  [...openDismissers].forEach((dismiss) => dismiss());
}

/** 画面の下に短いお知らせを出す */
export function toast(text, ms = 2600) {
  const host = ensureRoot();
  let el = host.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    host.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
