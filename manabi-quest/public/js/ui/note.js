// まちがいノート：まちがえた問題を、間をあけて ふくしゅうする

import { esc, md, onAct } from './dom.js';
import { dueEntries, upcomingEntries, startOfDay, DAY_MS, REVIEW_INTERVAL_DAYS } from '../game/review.js';
import { startReview, reviewableEntries } from './session.js';
import { STAGE_INFO } from '../game/rewards.js';

function whenText(due, now) {
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY_MS);
  if (days <= 0) return 'きょう';
  if (days === 1) return 'あした';
  return `${days}日後`;
}

function boxDots(box) {
  const n = REVIEW_INTERVAL_DAYS.length;
  return `<span class="box-dots" role="img" aria-label="${n}だんかい中${box}だんかい">${Array.from({ length: n }, (_, i) => `<i class="${i < box ? 'on' : ''}"></i>`).join('')}</span>`;
}

function entryHtml(e, ctx, now, due) {
  const subj = ctx.subjectMeta(e.q.subject);
  const ans = e.q.kind === 'input' ? e.q.fields.map((f) => `${f.label ? `${f.label} ` : ''}${f.answer}${f.suffix ?? ''}`).join('、') : e.q.answer;
  return `<li class="note-item" style="--c:${subj?.color ?? '#888'}">
    <div class="note-item__top">
      <span class="subj-mini">${subj?.emoji ?? ''} ${esc(subj?.name ?? '')}</span>
      ${boxDots(e.box)}
      <span class="note-item__when">${due ? 'ふくしゅうOK' : `つぎは ${whenText(e.due, now)}`}</span>
    </div>
    <div class="note-item__q">${md(e.q.q)} ${e.q.big ? `<b>${md(e.q.big)}</b>` : ''}</div>
    ${due ? '' : `<details><summary>こたえを見る</summary><div class="note-item__a">${md(ans)}</div></details>`}
  </li>`;
}

export function mountNote(root, ctx) {
  const st = ctx.store.state;
  const now = ctx.now();
  const due = dueEntries(st.notebook, now);
  const upcoming = upcomingEntries(st.notebook, now);
  // 読み上げが使えない端末では「聞く問題」を出さないので、その分をのぞいた数
  const playable = reviewableEntries(ctx).length;

  root.innerHTML = `
    <section class="note">
      <h1 class="page-title">📒 まちがいノート</h1>
      <div class="card note-guide">
        <p>まちがえた問題は、ここに入るよ。<b>きょう → あした → 3日後 → 7日後</b> と、間をあけて ふくしゅうすると しっかり おぼえられる！</p>
        <p class="note-guide__stat">「おぼえた！」になった問題：<b>${st.mastered}</b> もん</p>
      </div>
      ${
        playable
          ? `<button class="btn btn--primary btn--big" data-act="start">📒 ふくしゅうスタート（${Math.min(STAGE_INFO.review.count, playable)}もん）</button>`
          : due.length
            ? '<div class="card empty">🔊 のこりは「聞く問題」だよ。音が出せるときに ふくしゅうしよう！</div>'
            : `<div class="card empty">${Object.keys(st.notebook).length ? '🎉 きょう ふくしゅうする問題は ないよ！' : 'まだ まちがえた問題は ないよ。いろいろな単元に ちょうせんしよう！'}</div>`
      }
      ${due.length ? `<h2 class="section-title">きょう ふくしゅうする問題（${due.length}）</h2><ul class="note-list">${due.map((e) => entryHtml(e, ctx, now, true)).join('')}</ul>` : ''}
      ${upcoming.length ? `<h2 class="section-title">これから ふくしゅうする問題（${upcoming.length}）</h2><ul class="note-list">${upcoming.map((e) => entryHtml(e, ctx, now, false)).join('')}</ul>` : ''}
    </section>`;

  return onAct(root, {
    start: () => startReview(ctx),
  });
}
