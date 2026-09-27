// けっか画面：★・コイン・EXステージへのさそい・まちがえた問題のふりかえり

import { $, $$, esc, md, onAct, starsHtml } from './dom.js';
import { openModal } from './modal.js';
import { STAGE_INFO, titleFor, CHEST_RANKS } from '../game/rewards.js';
import { reachableStampGoal, weekStamps } from '../game/missions.js';
import { plainText } from '../lib/markup.js';
import { friendById, nextFriendGoal } from '../game/shop.js';
import { withCommas } from '../lib/numfmt.js';
import { startUnitStage, startMix, startReview, startRevenge, startDaily } from './session.js';
import { furikaeriFor } from '../data/furikaeri.js';

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

// たからばこの色は ランク（chest--r1〜r4）ごとに CSS でかえる
const CHEST_SVG = `<svg class="chest__svg" viewBox="0 0 64 56" aria-hidden="true">
  <defs>
    <linearGradient id="chest-rainbow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff5d8f"/><stop offset="0.3" stop-color="#ffc300"/><stop offset="0.55" stop-color="#1fb574"/><stop offset="0.8" stop-color="#2f8dff"/><stop offset="1" stop-color="#8a63ff"/>
    </linearGradient>
  </defs>
  <rect class="chest__body" x="6" y="24" width="52" height="27" rx="4" stroke="#2b2a4c" stroke-width="3"/>
  <rect class="chest__band" x="28" y="24" width="8" height="27" stroke="#2b2a4c" stroke-width="2"/>
  <rect x="26.5" y="28" width="11" height="9" rx="2" fill="#fff4c4" stroke="#2b2a4c" stroke-width="2"/>
  <g class="chest__lid">
    <path class="chest__top" d="M6 24 Q6 7 32 7 Q58 7 58 24 Z" stroke="#2b2a4c" stroke-width="3" stroke-linejoin="round"/>
    <rect class="chest__band" x="28" y="7.5" width="8" height="16.5" stroke="#2b2a4c" stroke-width="2"/>
  </g>
</svg>`;

// たからばこの ランクアップの間かく（ミリ秒）
const RANK_STEP_MS = 520;
// ランクの色（しょうげきはの わっか）
const RANK_COLOR = { 1: '#c46b35', 2: '#b4c1d6', 3: '#ffc21a', 4: '#ff5d8f' };

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
  // まちがいが2問以上（または★1つ以下）のときは、もとになる下の学年の単元をおすすめ（EX・リベンジはのぞく）
  const struggled = !timeUp && !r.stageKind.startsWith('ex') && r.stageKind !== 'revenge' && (wrong.length >= 2 || r.stars <= 1);
  const furikaeri = struggled ? furikaeriFor([...new Set(wrong.map((x) => x.q.unit))], ctx.unitById).slice(0, 2) : [];
  const treasure = r.chest ?? { rank: 0, coins: 0, steps: [] };
  // たからばこは 銅から出てきて、ランクが1つずつ上がる
  const rankUps = Math.max(0, treasure.steps.length - 1);
  const firstRank = treasure.steps[0]?.rank ?? treasure.rank;
  // 演出のタイミング（ミリ秒）：★ → ハンコ → たからばこ（ランクアップ）→ しょうごうゲージ → EXパネル
  const T = { star: 250, stamp: 950, chest: 1450 };
  T.ready = T.chest + rankUps * RANK_STEP_MS;
  T.gauge = Math.max(1900, T.ready + 450);
  T.ex = T.gauge + 600;
  // 「もういちど」で同じステージに ちょうせんできるときだけ（EX・リベンジは「もういちど」が ふつうのステージになるので出さない）
  const nearMiss = !perfect && !timeUp && r.total >= 3 && r.correct === r.total - 1 && r.stageKind !== 'revenge' && !r.stageKind.startsWith('ex');
  const partner = friendById(ctx.store.state.partner);
  const stamp = r.stamp?.newStamp ? r.stamp : null;
  const stampNext = stamp ? reachableStampGoal(weekStamps(ctx.store.state, ctx.now())) : null;
  const missionsDone = r.missionsDone ?? [];
  const nextFriend = timeUp ? null : nextFriendGoal(ctx.store.state);
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
            treasure.rank
              ? `<button type="button" class="chest chest--r${firstRank}" data-act="chest" disabled aria-label="${esc(plainText(CHEST_RANKS[firstRank].name))}を あける">
                  <span class="chest__rays" aria-hidden="true"></span>${CHEST_SVG}<span class="chest__label">${md(CHEST_RANKS[firstRank].name)}</span>
                </button>`
              : ''
          }
        </div>
        <div class="result-extra">
          ${r.maxCombo >= 2 ? `<span class="chip">🔥 さいだい ${r.maxCombo} れんぞく</span>` : ''}
          ${r.goldenHit ? '<span class="chip chip--golden">✨ ゴールデン せいかい！</span>' : ''}
          ${r.newStars ? '<span class="chip chip--new">★ きろくこうしん！</span>' : ''}
          ${nearMiss ? '<span class="chip chip--near">おしい！ あと1問で パーフェクト</span>' : ''}
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
        stamp
          ? `<div class="card notice stamp-notice">
              <span class="stamp-notice__mark" aria-hidden="true">${partner.emoji}</span>
              <div class="stamp-notice__body">
                <b>がんばりスタンプ ゲット！</b>
                <small>こんしゅう ${stamp.count}日目</small>
                ${stampNext ? `<small>あと ${stampNext.need}日で ボーナス！</small>` : ''}
                ${stamp.rewards.map((g) => `<span class="stamp-notice__reward">🎁 ${g.days}日 たっせい！ <span class="coin" aria-hidden="true"></span>＋${withCommas(g.coins)}</span>`).join('')}
              </div>
            </div>`
          : ''
      }
      ${
        missionsDone.length
          ? `<div class="card notice mission-notice">
              <span class="mission-notice__text">🎯 ミッション クリア！ <small>${missionsDone.length}こ</small></span>
              ${timeUp ? '' : '<button class="btn btn--small btn--claim" data-act="home">ホームで うけとる ▶</button>'}
            </div>`
          : ''
      }
      ${
        nextFriend
          ? `<a class="card next-friend ${nextFriend.affordable ? 'ready' : ''}" href="#/friends">
              <span class="next-friend__emoji" aria-hidden="true">${nextFriend.friend.emoji}</span>
              <span class="next-friend__body">
                <b>${nextFriend.affordable ? 'なかまに できるよ！' : `あと <span class="coin" aria-hidden="true"></span>${withCommas(nextFriend.need)} で なかまに できる！`}</b>
                <span class="meter meter--gold" aria-hidden="true"><i style="width:${Math.round(nextFriend.progress * 100)}%"></i></span>
              </span>
              <span class="next-friend__go" aria-hidden="true">▶</span>
            </a>`
          : ''
      }

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
        furikaeri.length
          ? `<div class="card furikaeri-card">
              <h2>🔁 じゅんびうんどう しよう</h2>
              <p>むずかしかったところは、下の学年で習ったことが もとになっているよ。ふりかえって 力をつけよう！</p>
              ${furikaeri
                .map(
                  (u) => `<button class="furikaeri-btn" data-act="furikaeri" data-id="${u.id}">
                    <span class="furikaeri-btn__icon" aria-hidden="true">${u.icon}</span>
                    <span class="furikaeri-btn__body"><span class="grade-tag">${esc(u.gradeLabel)}</span>${md(u.title)}</span>
                    <span aria-hidden="true">▶</span>
                  </button>`,
                )
                .join('')}
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
              <button class="btn ${nearMiss ? 'btn--primary btn--near' : 'btn--plain'}" data-act="retry">🔄 もういちど</button>
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
      fx.burst(c.x, c.y, { count: 6 });
    }, T.star + i * 220);
  });

  // 先生のハンコを「ポン」。パーフェクトなら なかまが ドカンと とびだす
  later(() => {
    fx.stamp($('.stamp', root));
    sfx.stamp();
    fx.thud($card);
    if (perfect) {
      fx.confetti(r.stageKind === 'ex3' ? 3200 : 1800);
      const m = fx.centerOf($('.result-medal', root));
      const emojis = [...new Set(ctx.store.state.friends)].map((id) => friendById(id).emoji);
      fx.explode(m.x, m.y, [...emojis, '🎉', '⭐', '💖']);
      fx.streamers();
      fx.sunburst(2200);
      if (r.stageKind === 'ex3') fx.balloons();
    }
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
    chest.setAttribute('aria-label', `ボーナス ${r.bonus}コイン`);
    sfx.chest();
    const c = fx.centerOf(chest);
    fx.burst(c.x, c.y);
    fx.shockwave(c.x, c.y, { color: RANK_COLOR[treasure.rank] ?? '#ffc21a', size: 1.3 });
    fx.fountain(c.x, c.y);
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
  // ランクアップ！（銅 → 銀 → 金 → にじ）
  function rankUp(i) {
    const el = $('.chest', root);
    const step = treasure.steps[i];
    if (!el || !step || chestOpen || !mounted) return;
    el.className = el.className.replace(/chest--r\d/, `chest--r${step.rank}`);
    $('.chest__label', el).innerHTML = md(CHEST_RANKS[step.rank].name);
    el.setAttribute('aria-label', `${plainText(CHEST_RANKS[step.rank].name)}を あける`);
    sfx.rankUp(i - 1);
    fx.pop(el);
    const c = fx.centerOf(el);
    fx.burst(c.x, c.y, { count: 10 });
    fx.shockwave(c.x, c.y, { color: RANK_COLOR[step.rank] });
    // 文字が画面からはみ出さないように、よこは画面のまん中に出す
    fx.floatText(globalThis.innerWidth / 2, c.y - 50, `${step.label} ランクアップ！`, 'rank-text');
  }
  if (treasure.rank) {
    later(() => {
      const el = $('.chest', root);
      el.classList.add('shown');
      fx.pop(el);
    }, T.chest);
    for (let i = 1; i <= rankUps; i += 1) later(() => rankUp(i), T.chest + i * RANK_STEP_MS);
    later(() => {
      const el = $('.chest', root);
      if (chestOpen) return;
      el.disabled = false;
      el.classList.add('ready');
    }, T.ready);
    later(openChest, T.ready + 1300);
  }

  // しょうごうゲージがのびる（しょうごうが上がったら おいわい）
  function fillGauge() {
    const gauge = $('.gauge', root);
    const bar = $('.gauge__bar i', root);
    if (!gauge || !bar) return;
    const grow = (a, b, ms) =>
      bar.animate([{ transform: `scaleX(${a})` }, { transform: `scaleX(${b})` }], { duration: ms, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' });
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
      const e = fx.centerOf($('.gauge__emoji', gauge));
      fx.explode(e.x, e.y, [gTo.current.emoji, '✨', '⭐'], 14);
      fx.banner('しょうごう アップ！', { sub: `${gTo.current.emoji} ${gTo.current.name}`, variant: 'gold', duration: 1100, pass: true });
      grow(0, gTo.progress, 700);
    };
  }
  later(fillGauge, T.gauge);

  // がんばりスタンプを「ポン」
  if (stamp) {
    later(() => {
      fx.stamp($('.stamp-notice__mark', root));
      sfx.stamp();
    }, T.gauge + 350);
  }

  if (ex) {
    later(() => sfx.ex(), T.ex + 150);
    later(() => fx.streamers(4), T.ex + 100);
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
    furikaeri: (el) => startUnitStage(ctx, { unitId: el.dataset.id, stageKind: 'normal' }),
    ex: () => startUnitStage(ctx, { unitId: r.unitId, stageKind: r.nextEx, prev: r.chain }),
    revenge: () => startRevenge(ctx, r),
    retry,
    back: () => ctx.go(homeUnit ? `#/subject/${homeUnit.subject}` : r.stageKind === 'review' ? '#/note' : '#/'),
    rest: () => ctx.go('#/rest'),
    home: () => ctx.go('#/'),
  });
  return () => {
    mounted = false;
    offAct();
    timers.forEach(clearTimeout);
    fx.clearBanners();
  };
}

