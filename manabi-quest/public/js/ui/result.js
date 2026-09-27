// けっか画面：★・コイン・EXステージへのさそい・まちがえた問題のふりかえり

import { $, esc, md, onAct, starsHtml } from './dom.js';
import { openModal } from './modal.js';
import { STAGE_INFO } from '../game/rewards.js';
import { startUnitStage, startMix, startReview, startRevenge, startDaily } from './session.js';

const EX_TEXT = {
  ex1: { name: 'EX 1', mult: 2, lead: '全問せいかい！ 追加テストに ちょうせんできるよ！' },
  ex2: { name: 'EX 2', mult: 3, lead: 'EX 1 も 全問せいかい！ さらに むずかしい EX 2 へ！' },
  ex3: { name: 'EX 3', mult: 5, lead: 'すごすぎる！ さいごの EX 3 をクリアすれば「マスター」！' },
};

function titleFor(r) {
  const perfect = r.correct === r.total;
  if (r.stageKind === 'ex3' && perfect) return '👑 マスター！';
  if (perfect) return r.stageKind.startsWith('ex') ? `${STAGE_INFO[r.stageKind].label} クリア！` : 'パーフェクト！';
  if (r.stars >= 2) return 'よくできました！';
  if (r.stars >= 1) return 'いいちょうし！';
  return 'よくがんばったね！';
}

export function mountResult(root, ctx) {
  const r = ctx.lastResult;
  if (!r) {
    ctx.go('#/');
    return () => {};
  }
  const { fx, sfx, playtime } = ctx;
  const subj = ctx.subjectMeta(r.subjectId) ?? ctx.subjectMeta('review');
  const perfect = r.total > 0 && r.correct === r.total;
  const status = playtime.status();
  const timeUp = status.timeUp;
  const wrong = r.results.filter((x) => !x.correct);
  const ex = r.nextEx && !timeUp ? EX_TEXT[r.nextEx] : null;
  const homeUnit = r.homeUnitId ? ctx.unitById(r.homeUnitId) : null;

  root.innerHTML = `
    <section class="result" style="--c:${subj.color};--l:${subj.light}">
      <div class="card result-card ${perfect ? 'perfect' : ''}">
        <div class="result-kind">${subj.emoji} ${esc(subj.name)}・${md(r.unitTitle)} <span class="stage-tag stage-tag--${r.stageKind}">${STAGE_INFO[r.stageKind].label}</span></div>
        <h1 class="result-title">${titleFor(r)}</h1>
        <div class="result-stars">${starsHtml(r.stars)}</div>
        <div class="result-score"><b>${r.correct}</b> / ${r.total} もん せいかい</div>
        <div class="result-coins"><span class="coin big" aria-hidden="true"></span>＋<b id="res-coins">0</b></div>
        <div class="result-extra">
          ${r.bonus ? `<span class="chip">🎁 ボーナス ＋${r.bonus}</span>` : ''}
          ${r.maxCombo >= 2 ? `<span class="chip">🔥 さいだい ${r.maxCombo} れんぞく</span>` : ''}
          ${r.newStars ? '<span class="chip chip--new">★ きろくこうしん！</span>' : ''}
        </div>
      </div>

      ${
        ex
          ? `<div class="ex-panel">
              <div class="ex-panel__stripe">EXTRA STAGE</div>
              <p class="ex-panel__lead">${ex.lead}</p>
              <p class="ex-panel__mult">コイン <b>×${ex.mult}</b>・コンボも つづくよ！</p>
              <button class="btn btn--ex btn--big" data-act="ex">${ex.name} に ちょうせん！</button>
            </div>`
          : ''
      }
      ${r.nextEx && timeUp ? '<div class="card notice">⏰ きょうの時間は おわり。EXステージは また あした ちょうせんしよう！</div>' : ''}
      ${r.stageKind === 'ex3' && perfect ? '<div class="card master-panel">👑 この単元の「マスター」になったよ！ 単元えらびの画面に 王かんが つくよ。</div>' : ''}
      ${r.dailyFirst ? '<div class="card notice">🌟 きょうの5教科チャレンジ クリア！ また あした ちょうせんしてね。</div>' : ''}
      ${r.mastered.length ? `<div class="card notice">🎉 まちがいノートの問題を <b>${r.mastered.length}</b> もん「おぼえた！」</div>` : ''}
      ${r.newFriends
        .map((f) => `<div class="card notice new-friend"><span class="big-emoji">${f.emoji}</span> ひみつのなかま「${esc(f.name)}」が なかまになった！</div>`)
        .join('')}

      ${
        wrong.length
          ? `<div class="card mistakes">
              <h2>📒 まちがえた問題<small>まちがいノートに入れたよ。あとで ふくしゅうしよう！</small></h2>
              <ul>
                ${wrong
                  .map(
                    (w) => `<li>
                      <div class="mistakes__q">${md(w.q.q)} ${w.q.big ? `<b>${md(w.q.big)}</b>` : ''}</div>
                      <div class="mistakes__a">こたえ：<b>${md(w.q.kind === 'input' ? w.q.fields.map((f) => `${f.label ? `${f.label} ` : ''}${f.answer}${f.suffix ?? ''}`).join('、') : w.q.answer)}</b></div>
                      <div class="mistakes__e">💡 ${md(w.q.explain)}</div>
                    </li>`,
                  )
                  .join('')}
              </ul>
              ${timeUp ? '' : '<button class="btn btn--primary" data-act="revenge">🔁 まちがえた問題に もういちど ちょうせん</button>'}
            </div>`
          : ''
      }

      ${
        timeUp
          ? `<div class="card timeup">
              <p>⏰ きょうの あそぶ時間は ここまで！ よくがんばったね。</p>
              <button class="btn btn--primary btn--big" data-act="rest">おわる</button>
            </div>`
          : `<div class="btn-row">
              <button class="btn btn--plain" data-act="retry">🔄 もういちど</button>
              <button class="btn btn--plain" data-act="back">${homeUnit ? '📚 たんげんをえらぶ' : '🏠 ホーム'}</button>
            </div>`
      }
    </section>`;

  // 演出
  const totalCoins = r.stageCoins + r.bonus;
  setTimeout(() => fx.countUp($('#res-coins', root), 0, totalCoins, 900), 200);
  if (perfect) {
    sfx.fanfare();
    fx.confetti(r.stageKind === 'ex3' ? 3200 : 1800);
  }
  if (ex) {
    setTimeout(() => {
      sfx.ex();
      fx.banner('EXTRA!', { sub: `${ex.name} かいほう`, variant: 'ex' });
    }, 500);
  } else if (r.stageKind === 'ex3' && perfect) {
    setTimeout(() => fx.banner('MASTER!', { sub: 'たんげんマスター', variant: 'gold', duration: 1800 }), 500);
  }

  // ひと休みのお知らせ
  if (!timeUp && status.needBreak) {
    playtime.breakShown();
    setTimeout(
      () =>
        openModal({
          title: '🌿 ひと休みしよう',
          body: `<p>つづけて ${ctx.store.state.settings.breakMin}分 あそんだよ。</p><p>遠くを見て 目を休めたり、のびをしたりしよう。</p>`,
          actions: [{ label: 'ひと休みした！', value: true, variant: 'primary' }],
          className: 'modal--break',
        }),
      900,
    );
  }

  function retry() {
    if (r.stageKind === 'review') return startReview(ctx);
    if (r.stageKind === 'daily') return startDaily(ctx);
    if (r.stageKind === 'mix') return startMix(ctx, r.subjectId);
    if (homeUnit) return startUnitStage(ctx, { unitId: homeUnit.id, stageKind: 'normal' });
    return ctx.go('#/');
  }

  return onAct(root, {
    ex: () => startUnitStage(ctx, { unitId: r.unitId, stageKind: r.nextEx, prev: r.chain }),
    revenge: () => startRevenge(ctx, r),
    retry,
    back: () => ctx.go(homeUnit ? `#/subject/${homeUnit.subject}` : r.stageKind === 'review' ? '#/note' : '#/'),
    rest: () => ctx.go('#/rest'),
  });
}

