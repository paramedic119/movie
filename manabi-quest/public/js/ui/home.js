// ホーム画面

import { esc, onAct, minutesText } from './dom.js';
import { titleFor } from '../game/rewards.js';
import { dueEntries } from '../game/review.js';
import { friendById } from '../game/shop.js';
import { remainingSeconds, dayRecord, unitMastery } from '../game/state.js';
import { startReview } from './session.js';
import { withCommas } from '../lib/numfmt.js';

const GREETINGS = [
  'きょうも いっしょに がんばろう！',
  'すこしずつでも、まいにち つづけると 力になるよ。',
  'まちがえた問題は、ノートで ふくしゅうしよう！',
  '全問せいかいで EXステージが あらわれるよ！',
  'コインをためて、なかまを ふやそう！',
];

export function mountHome(root, ctx) {
  const st = ctx.store.state;
  const now = ctx.now();
  const partner = friendById(st.partner);
  const title = titleFor(st.totalEarned);
  const due = dueEntries(st.notebook, now).length;
  const remain = remainingSeconds(st, now);
  const today = dayRecord(st, now);
  const limitMin = st.settings.limitMin;
  const usedMin = Math.floor(today.sec / 60);
  const greeting = GREETINGS[Math.floor(now / 60000) % GREETINGS.length];

  const subjectCards = ctx.SUBJECTS.map((subj) => {
    const units = ctx.subjects[subj.id]?.units ?? [];
    const stars = units.reduce((sum, u) => sum + (st.units[u.id]?.stars ?? 0), 0);
    const masters = units.filter((u) => (st.units[u.id]?.ex ?? 0) >= 3).length;
    const mastery = units.length ? units.reduce((sum, u) => sum + unitMastery(st, u.id), 0) / units.length : 0;
    const broken = ctx.subjects[subj.id]?.error;
    return `<button class="subject-card" style="--c:${subj.color};--l:${subj.light}" data-act="subject" data-id="${subj.id}" ${broken || !units.length ? 'disabled' : ''}>
      <span class="subject-card__emoji" aria-hidden="true">${subj.emoji}</span>
      <span class="subject-card__name">${esc(subj.name)}</span>
      <span class="subject-card__meta">${broken || !units.length ? 'じゅんび中' : `★ ${stars} / ${units.length * 3}${masters ? `・👑${masters}` : ''}`}</span>
      <span class="meter" aria-hidden="true"><i style="width:${Math.round(mastery * 100)}%"></i></span>
    </button>`;
  }).join('');

  root.innerHTML = `
    <section class="home">
      <div class="card hero">
        <button class="hero__partner" data-act="partner" aria-label="${esc(partner.name)}">${partner.emoji}</button>
        <div class="hero__body">
          <div class="hero__bubble">${esc(greeting)}</div>
          <div class="hero__title"><span aria-hidden="true">${title.current.emoji}</span> ${esc(title.current.name)}</div>
          <div class="meter meter--gold" aria-hidden="true"><i style="width:${Math.round(title.progress * 100)}%"></i></div>
          <div class="hero__next">${title.next ? `つぎの しょうごう「${esc(title.next.name)}」まで あと ${withCommas(title.next.min - st.totalEarned)} コイン` : 'さいこうの しょうごうだ！'}</div>
        </div>
      </div>

      ${
        due
          ? `<button class="review-cta" data-act="review">
              <span class="review-cta__icon" aria-hidden="true">📒</span>
              <span class="review-cta__text"><b>ふくしゅう ${due}もん</b><small>まちがえた問題に もういちど！ コイン ×1.5</small></span>
              <span class="review-cta__go" aria-hidden="true">▶</span>
            </button>`
          : ''
      }

      <h2 class="section-title">きょうかを えらぼう</h2>
      <div class="subject-grid">${subjectCards}</div>

      <div class="card today">
        <div class="today__row">
          <span>⏰ きょう あそんだ時間</span>
          <b>${usedMin}分${limitMin ? ` / ${limitMin}分` : ''}</b>
        </div>
        ${limitMin ? `<div class="meter meter--time" aria-hidden="true"><i style="width:${Math.min(100, Math.round((today.sec / 60 / limitMin) * 100))}%"></i></div>` : ''}
        <div class="today__row small">
          <span>きょう といた問題 ${today.n}もん（せいかい ${today.c}）</span>
          <span>${limitMin ? `のこり ${minutesText(remain)}` : ''}</span>
        </div>
      </div>
    </section>`;

  return onAct(root, {
    subject: (el) => ctx.go(`#/subject/${el.dataset.id}`),
    review: () => startReview(ctx),
    partner: (el) => {
      ctx.sfx.tap();
      ctx.fx.hop([el]);
      const bubble = root.querySelector('.hero__bubble');
      bubble.textContent = partner.line;
    },
  });
}
