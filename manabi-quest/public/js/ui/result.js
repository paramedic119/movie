// けっか画面：★・コイン・EXステージへのさそい・まちがえた問題のふりかえり

import { $, $$, esc, md, onAct, starsHtml } from './dom.js';
import { openModal } from './modal.js';
import { STAGE_INFO, titleFor } from '../game/rewards.js';
import { withCommas } from '../lib/numfmt.js';
import { startUnitStage, startMix, startReview, startRevenge, startDaily } from './session.js';

const EX_TEXT = {
  ex1: { name: 'EX 1', mult: 2, lead: '全問せいかい！ 追加テストに ちょうせんできるよ！' },
  ex2: { name: 'EX 2', mult: 3, lead: 'EX 1 も 全問せいかい！ さらに むずかしい EX 2 へ！' },
  ex3: { name: 'EX 3', mult: 5, lead: 'すごすぎる！ さいごの EX 3 をクリアすれば「マスター」！' },
};

function headline(r) {
  const perfect = r.correct === r.total;
  if (r.stageKind === 'ex3' && perfect) return '👑 マスター！';
  if (perfect) return r.stageKind.startsWith('ex') ? `${STAGE_INFO[r.stageKind].label} クリア！` : 'パーフェクト！';
  if (r.stars >= 2) return 'よくできました！';
  if (r.stars >= 1) return 'いいちょうし！';
  return 'よくがんばったね！';
}

/** 先生のハンコ（★の数で文字がかわる） */
function stampHtml(stars) {
  if (stars >= 3) return '<div class="stamp stamp--great" aria-hidden="true"><span>たいへん</span><span>よく</span><span>できました</span></div>';
  if (stars === 2) return '<div class="stamp" aria-hidden="true"><span>よく</span><span>できました</span></div>';
  return '<div class="stamp stamp--try" aria-hidden="true"><span>がんばり</span><span>ました</span></div>';
}

const CHEST_SVG = `<svg class="chest__svg" viewBox="0 0 64 56" aria-hidden="true">
  <rect x="6" y="24" width="52" height="27" rx="4" fill="#b8651f" stroke="#2b2a4c" stroke-width="3"/>
  <rect x="28" y="24" width="8" height="27" fill="#ffc21a" stroke="#2b2a4c" stroke-width="2"/>
  <rect x="26.5" y="28" width="11" height="9" rx="2" fill="#fff4c4" stroke="#2b2a4c" stroke-width="2"/>
  <g class="chest__lid">
    <path d="M6 24 Q6 7 32 7 Q58 7 58 24 Z" fill="#d9822f" stroke="#2b2a4c" stroke-width="3" stroke-linejoin="round"/>
    <rect x="28" y="7.5" width="8" height="16.5" fill="#ffc21a" stroke="#2b2a4c" stroke-width="2"/>
  </g>
</svg>`;

function gaugeInner(t, earned) {
  const next = t.next ? `つぎの しょうごうまで あと ${withCommas(t.next.min - earned)}` : 'さいこうの しょうごう！';
  return `<div class="gauge__head">
      <span class="gauge__emoji" aria-hidden="true">${t.current.emoji}</span>
      <b class="gauge__name">${esc(t.current.name)}</b>
      <span class="gauge__up">しょうごう アップ！</span>
      <span class="gauge__next">${next}</span>
    </div>`;
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
  const calm = ctx.effectsLevel() === 'calm';
  // 演出のタイミング（ミリ秒）：★ → ハンコ → たからばこ → しょうごうゲージ → EXパネル
  const T = calm ? { star: 0, stamp: 150, chest: 300, gauge: 450, ex: 0 } : { star: 250, stamp: 950, chest: 1450, gauge: 1900, ex: 2500 };
  const earnedAfter = r.earnedAfter ?? ctx.store.state.totalEarned;
  const earnedBefore = Math.min(r.earnedBefore ?? earnedAfter, earnedAfter);
  const gFrom = titleFor(earnedBefore);
  const gTo = titleFor(earnedAfter);

  root.innerHTML = `
    <section class="result" style="--c:${subj.color};--l:${subj.light}">
      <div class="card result-card ${perfect ? 'perfect' : ''}">
        <div class="result-kind">${subj.emoji} ${esc(subj.name)}・${md(r.unitTitle)} <span class="stage-tag stage-tag--${r.stageKind}">${STAGE_INFO[r.stageKind].label}</span></div>
        <h1 class="result-title">${headline(r)}</h1>
        <div class="result-medal">
          <div class="result-stars">${starsHtml(r.stars)}</div>
          ${stampHtml(r.stars)}
        </div>
        <div class="result-score"><b>${r.correct}</b> / ${r.total} もん せいかい</div>
        <div class="result-money">
          <div class="result-coins"><span class="coin big" aria-hidden="true"></span>＋<b id="res-coins">0</b></div>
          ${
            r.bonus
              ? `<button type="button" class="chest" data-act="chest" disabled aria-label="ボーナスの たからばこを あける">
                  <span class="chest__rays" aria-hidden="true"></span>${CHEST_SVG}<span class="chest__label">ボーナス</span>
                </button>`
              : ''
          }
        </div>
        <div class="result-extra">
          ${r.maxCombo >= 2 ? `<span class="chip">🔥 さいだい ${r.maxCombo} れんぞく</span>` : ''}
          ${r.newStars ? '<span class="chip chip--new">★ きろくこうしん！</span>' : ''}
        </div>
        <div class="gauge">
          ${gaugeInner(gFrom, earnedBefore)}
          <div class="gauge__bar"><i style="transform:scaleX(${gFrom.progress})"></i></div>
        </div>
      </div>

      ${
        ex
          ? `<div class="ex-panel" style="--ex-delay:${T.ex}ms">
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

  // 演出（画面をはなれたら、まだ出ていない演出は出さない）
  let mounted = true;
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const $coins = $('#res-coins', root);
  const $card = $('.result-card', root);
  // コインは「ステージでかせいだ分」→ たからばこを開けると ボーナスが たされる
  later(() => fx.countUp($coins, 0, r.stageCoins, 900), 200);
  if (perfect) sfx.fanfare();

  // ★が1つずつ「キン！」
  $$('.result-stars .star.on', root).forEach((el, i) => {
    later(() => {
      sfx.star(i);
      const c = fx.centerOf(el);
      fx.burst(c.x, c.y, { count: calm ? 0 : 6 });
    }, T.star + i * 220);
  });

  // 先生のハンコを「ポン」
  later(() => {
    fx.stamp($('.stamp', root));
    sfx.stamp();
    fx.thud($card);
    if (perfect) fx.confetti(r.stageKind === 'ex3' ? 3200 : 1800);
  }, T.stamp);

  // ボーナスの たからばこ（タップで開く。しばらくすると自動で開く）
  let chestOpen = false;
  function openChest() {
    const chest = $('.chest', root);
    if (!chest || chestOpen || !mounted) return;
    chestOpen = true;
    chest.disabled = true;
    chest.classList.remove('ready');
    chest.classList.add('open');
    $('.chest__label', chest).textContent = `＋${withCommas(r.bonus)}`;
    sfx.chest();
    const c = fx.centerOf(chest);
    fx.burst(c.x, c.y);
    const pill = $('.result-coins', root);
    let started = false;
    fx.coins(chest, pill, r.bonus, (i) => {
      sfx.coin(i);
      if (!started) {
        started = true;
        fx.countUp($coins, r.stageCoins, r.stageCoins + r.bonus, 600);
        fx.pop(pill);
      }
    });
  }
  if (r.bonus) {
    later(() => {
      const chest = $('.chest', root);
      chest.disabled = false;
      chest.classList.add('ready');
    }, T.chest);
    later(openChest, T.chest + (calm ? 0 : 1300));
  }

  // しょうごうゲージがのびる（しょうごうが上がったら おいわい）
  function fillGauge() {
    const gauge = $('.gauge', root);
    const bar = $('.gauge__bar i', root);
    if (!gauge || !bar) return;
    const grow = (a, b, ms) =>
      bar.animate([{ transform: `scaleX(${a})` }, { transform: `scaleX(${b})` }], { duration: calm ? 1 : ms, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' });
    if (gTo.index === gFrom.index) {
      if (gTo.progress > gFrom.progress) {
        sfx.gauge();
        grow(gFrom.progress, gTo.progress, 900);
      }
      gauge.firstElementChild.outerHTML = gaugeInner(gTo, earnedAfter);
      return;
    }
    sfx.gauge();
    grow(gFrom.progress, 1, 700).onfinish = () => {
      if (!mounted) return;
      sfx.levelUp();
      gauge.firstElementChild.outerHTML = gaugeInner(gTo, earnedAfter);
      gauge.classList.add('up');
      fx.pop($('.gauge__emoji', gauge));
      const c = fx.centerOf(gauge);
      fx.burst(c.x, c.y);
      if (!calm) fx.banner('しょうごう アップ！', { sub: `${gTo.current.emoji} ${gTo.current.name}`, variant: 'gold', duration: 1100, pass: true });
      grow(0, gTo.progress, 700);
    };
  }
  later(fillGauge, T.gauge);

  if (ex) {
    later(() => sfx.ex(), T.ex + 150);
  } else if (r.stageKind === 'ex3' && perfect) {
    later(() => fx.banner('MASTER!', { sub: 'たんげんマスター', variant: 'gold', duration: 1800, pass: true }), T.stamp + 400);
  }

  // ひと休みのお知らせ
  if (!timeUp && status.needBreak) {
    later(() => {
      playtime.breakShown();
      openModal({
        title: '🌿 ひと休みしよう',
        body: `<p>つづけて ${ctx.store.state.settings.breakMin}分 あそんだよ。</p><p>遠くを見て 目を休めたり、のびをしたりしよう。</p>`,
        actions: [{ label: 'ひと休みした！', value: true, variant: 'primary' }],
        className: 'modal--break',
      });
    }, T.ex + 900);
  }

  function retry() {
    if (r.stageKind === 'review') return startReview(ctx);
    if (r.stageKind === 'daily') return startDaily(ctx);
    if (r.stageKind === 'mix') return startMix(ctx, r.subjectId);
    if (homeUnit) return startUnitStage(ctx, { unitId: homeUnit.id, stageKind: 'normal' });
    return ctx.go('#/');
  }

  const offAct = onAct(root, {
    chest: openChest,
    ex: () => startUnitStage(ctx, { unitId: r.unitId, stageKind: r.nextEx, prev: r.chain }),
    revenge: () => startRevenge(ctx, r),
    retry,
    back: () => ctx.go(homeUnit ? `#/subject/${homeUnit.subject}` : r.stageKind === 'review' ? '#/note' : '#/'),
    rest: () => ctx.go('#/rest'),
  });
  return () => {
    mounted = false;
    offAct();
    timers.forEach(clearTimeout);
    fx.clearBanners();
  };
}

