// 教科の画面：単元をえらぶ

import { esc, md, onAct, starsHtml, exBadgesHtml } from './dom.js';
import { unitMastery } from '../game/state.js';
import { startUnitStage, startMix } from './session.js';
import { isGrade4 } from '../data/subjects.js';
import { FURIKAERI_FOR, isStruggling } from '../data/furikaeri.js';

export function mountSubject(root, ctx, params) {
  const subj = ctx.subjectMeta(params.id);
  const data = ctx.subjects[params.id];
  if (!subj || !data) {
    ctx.go('#/');
    return () => {};
  }
  const st = ctx.store.state;
  const units = data.units.filter(isGrade4);
  const reviews = data.units.filter((u) => !isGrade4(u));
  // つまずいている4年生の単元の「もと」になる ふりかえり単元には「おすすめ」をつける
  const recommended = new Set(
    units.filter((u) => isStruggling(st, u.id)).flatMap((u) => FURIKAERI_FOR[u.id] ?? []),
  );

  const card = (u) => {
    const rec = st.units[u.id] ?? { stars: 0, ex: 0, plays: 0 };
    const mastery = unitMastery(st, u.id);
    const review = !isGrade4(u);
    return `<li>
      <button class="unit-card ${rec.ex >= 3 ? 'is-master' : ''} ${review ? 'unit-card--review' : ''}" data-act="unit" data-id="${u.id}">
        <span class="unit-card__icon" aria-hidden="true">${u.icon}</span>
        <span class="unit-card__body">
          <span class="unit-card__title">${review ? `<span class="grade-tag">${esc(u.gradeLabel)}</span>` : ''}${md(u.title)}${recommended.has(u.id) ? '<span class="tag tag--osusume">おすすめ</span>' : ''}</span>
          <span class="unit-card__desc">${md(u.description)}</span>
          <span class="unit-card__meta">${starsHtml(rec.stars)} ${exBadgesHtml(rec.ex)}</span>
          <span class="meter" aria-hidden="true"><i style="width:${Math.round(mastery * 100)}%"></i></span>
        </span>
        <span class="unit-card__go" aria-hidden="true">▶</span>
      </button>
    </li>`;
  };

  root.innerHTML = `
    <section class="subject" style="--c:${subj.color};--l:${subj.light}">
      <div class="subject-head">
        <button class="icon-btn" data-act="home" aria-label="ホームへ">←</button>
        <h1><span aria-hidden="true">${subj.emoji}</span> ${esc(subj.name)}</h1>
      </div>
      <p class="subject-lead">単元をえらんでね。<b>5問 全問せいかい</b>で <b class="ex-word">EXステージ</b>（追加テスト）に ちょうせんできるよ！</p>
      <ul class="unit-list">${units.map(card).join('')}</ul>
      ${units.length > 1 ? `<button class="mix-btn" data-act="mix">🎲 ミックスチャレンジ <small>いろいろな単元から5問</small></button>` : ''}
      ${
        reviews.length
          ? `<h2 class="section-title review-head">🔁 ふりかえり（1〜3年）</h2>
             <p class="review-lead">下の学年で習った 大事なところを もういちど。4年生の問題で こまったときの「じゅんびうんどう」にしよう！</p>
             <ul class="unit-list">${reviews.map(card).join('')}</ul>`
          : ''
      }
    </section>`;

  return onAct(root, {
    home: () => ctx.go('#/'),
    unit: (el) => startUnitStage(ctx, { unitId: el.dataset.id, stageKind: 'normal' }),
    mix: () => startMix(ctx, params.id),
  });
}
