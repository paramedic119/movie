// 教科の画面：単元をえらぶ

import { esc, md, onAct, starsHtml, exBadgesHtml } from './dom.js';
import { unitMastery } from '../game/state.js';
import { startUnitStage, startMix } from './session.js';

export function mountSubject(root, ctx, params) {
  const subj = ctx.subjectMeta(params.id);
  const data = ctx.subjects[params.id];
  if (!subj || !data) {
    ctx.go('#/');
    return () => {};
  }
  const st = ctx.store.state;
  const units = data.units;

  root.innerHTML = `
    <section class="subject" style="--c:${subj.color};--l:${subj.light}">
      <div class="subject-head">
        <button class="icon-btn" data-act="home" aria-label="ホームへ">←</button>
        <h1><span aria-hidden="true">${subj.emoji}</span> ${esc(subj.name)}</h1>
      </div>
      <p class="subject-lead">単元をえらんでね。<b>5問 全問せいかい</b>で <b class="ex-word">EXステージ</b>（追加テスト）に ちょうせんできるよ！</p>
      <ul class="unit-list">
        ${units
          .map((u) => {
            const rec = st.units[u.id] ?? { stars: 0, ex: 0, plays: 0 };
            const mastery = unitMastery(st, u.id);
            return `<li>
              <button class="unit-card ${rec.ex >= 3 ? 'is-master' : ''}" data-act="unit" data-id="${u.id}">
                <span class="unit-card__icon" aria-hidden="true">${u.icon}</span>
                <span class="unit-card__body">
                  <span class="unit-card__title">${md(u.title)}</span>
                  <span class="unit-card__desc">${md(u.description)}</span>
                  <span class="unit-card__meta">${starsHtml(rec.stars)} ${exBadgesHtml(rec.ex)}</span>
                  <span class="meter" aria-hidden="true"><i style="width:${Math.round(mastery * 100)}%"></i></span>
                </span>
                <span class="unit-card__go" aria-hidden="true">▶</span>
              </button>
            </li>`;
          })
          .join('')}
      </ul>
      ${units.length > 1 ? `<button class="mix-btn" data-act="mix">🎲 ミックスチャレンジ <small>いろいろな単元から5問</small></button>` : ''}
    </section>`;

  return onAct(root, {
    home: () => ctx.go('#/'),
    unit: (el) => startUnitStage(ctx, { unitId: el.dataset.id, stageKind: 'normal' }),
    mix: () => startMix(ctx, params.id),
  });
}
