// ホーム画面

import { $, esc, onAct, minutesText } from './dom.js';
import { titleFor } from '../game/rewards.js';
import { friendById, nextFriendGoal } from '../game/shop.js';
import { remainingSeconds, dayRecord, unitMastery, dateKey } from '../game/state.js';
import { MISSION_KINDS, ALL_CLEAR_BONUS, STAMP_GOALS, missionText, claimMission, weekStamps, weekStartKey, reachableStampGoal } from '../game/missions.js';
import { startReview, startDaily, reviewableEntries, refreshMissions } from './session.js';
import { openModal, toast } from './modal.js';
import { isGrade4 } from '../data/subjects.js';
import { withCommas } from '../lib/numfmt.js';

function showGuide(ctx) {
  const limit = ctx.store.state.settings.limitMin;
  return openModal({
    title: '🐘 まなびクエストへ ようこそ！',
    body: `<ol class="guide-list">
      <li><b>きょうか</b>と<b>単元</b>をえらんで、5問にちょうせん！</li>
      <li>せいかいで <span class="coin" aria-hidden="true"></span>コイン。つづけてせいかいすると、どんどんふえるよ。</li>
      <li><b>5問 全問せいかい</b>で <b>EXステージ</b>（追加テスト）が出てくる！</li>
      <li>まちがえた問題は <b>📒ノート</b>で ふくしゅうしよう。</li>
      <li>コインで <b>🐾なかま</b>を ふやそう。</li>
      <li>毎日の <b>🎯ミッション</b>や、ときどき出る <b>✨ゴールデン問題</b>で コインが もっと もらえるよ！</li>
    </ol>
    <p class="small muted">${limit ? `1日に あそべる時間は ${limit}分だよ。` : ''}おうちの人は「👪おうちの人」から 時間や音の せっていが できます。</p>`,
    actions: [{ label: 'はじめる！', value: true, variant: 'primary' }],
    className: 'modal--guide',
  });
}

/** きょうのミッション（クリアしたら「うけとる」でコイン） */
function missionsHtml(ctx) {
  const st = ctx.store.state;
  const list = st.missions.list;
  const subjectName = (id) => ctx.subjectMeta(id)?.name ?? id;
  const rows = list
    .map((m, i) => {
      const icon = (m.kind === 'subject' && ctx.subjectMeta(m.subject)?.emoji) || MISSION_KINDS[m.kind]?.icon || '🎯';
      const side = m.claimed
        ? '<span class="mission__ok" role="img" aria-label="うけとりずみ">✅</span>'
        : m.done
          ? `<button class="btn btn--small btn--claim" data-act="claim" data-i="${i}" aria-label="${m.coins}コイン うけとる"><b>うけとる</b><small><span class="coin" aria-hidden="true"></span>${m.coins}</small></button>`
          : `<span class="mission__reward"><span class="coin" aria-hidden="true"></span>${m.coins}</span>`;
      return `<li class="mission ${m.done ? 'done' : ''} ${m.claimed ? 'claimed' : ''}">
        <span class="mission__icon" aria-hidden="true">${icon}</span>
        <span class="mission__body">
          <span class="mission__text">${esc(missionText(m, subjectName))}</span>
          <span class="mission__bar"><span class="meter meter--mission" aria-hidden="true"><i style="width:${Math.round((m.n / m.goal) * 100)}%"></i></span><small>${m.n}/${m.goal}</small></span>
        </span>
        ${side}
      </li>`;
    })
    .join('');
  return `<div class="missions__head"><h2 tabindex="-1">🎯 きょうの ミッション</h2><span class="missions__count">${list.filter((m) => m.done).length}/${list.length}</span></div>
    <ul class="missions__list">${rows}</ul>
    <p class="missions__foot">${
      st.missions.bonus
        ? '🎉 ミッション コンプリート！ また あしたね'
        : `3つ ぜんぶで ボーナス <span class="coin" aria-hidden="true"></span>${ALL_CLEAR_BONUS}`
    } <small>（ステージは ★1つ以上で クリア）</small></p>`;
}

/** 1週間の がんばりスタンプ（ステージをクリアした日に1つ） */
function stampsHtml(ctx) {
  const st = ctx.store.state;
  const now = ctx.now();
  const days = weekStamps(st, now);
  const count = days.filter((d) => d.stamped).length;
  const next = reachableStampGoal(days);
  const got = st.week.start === weekStartKey(now) ? st.week.got : [];
  const partner = friendById(st.partner);
  return `<div class="stampcard__head"><b>📅 こんしゅうの がんばりスタンプ</b><small>${next ? `あと ${next.need}日で ボーナス` : count >= 7 ? 'ぜんぶ あつめた！ すごい！' : 'つぎの週も がんばろう！'}</small></div>
    <ol class="stampcard__days" aria-label="こんしゅうの スタンプ ${count}こ">${days
      .map(
        (d) => `<li class="${d.stamped ? 'on' : ''} ${d.today ? 'is-today' : ''} ${d.future ? 'is-future' : ''}" aria-label="${d.label} ${d.stamped ? 'スタンプあり' : 'まだ'}">
          <span class="stampcard__label" aria-hidden="true">${d.today ? 'きょう' : d.label}</span>
          <span class="stampcard__mark" aria-hidden="true">${d.stamped ? partner.emoji : ''}</span>
        </li>`,
      )
      .join('')}</ol>
    <p class="stampcard__goals">${STAMP_GOALS.map((g) => `<span class="${got.includes(g.days) ? 'got' : ''}">${got.includes(g.days) ? '✅' : '🎁'} ${g.days}日 <span class="coin" aria-hidden="true"></span>${g.coins}</span>`).join('')}</p>`;
}

/** つぎの なかままで あと何コイン */
function friendGoalHtml(st) {
  const nf = nextFriendGoal(st);
  if (!nf) return '';
  return `<a class="hero__friend ${nf.affordable ? 'ready' : ''}" href="#/friends"><span aria-hidden="true">${nf.friend.emoji}</span> ${
    nf.affordable ? 'なかまに できるよ！ ▶' : `あと${withCommas(nf.need)}コインで なかまに！`
  }</a>`;
}

const GREETINGS = [
  'きょうも いっしょに がんばろう！',
  'すこしずつでも、まいにち つづけると 力になるよ。',
  'まちがえた問題は、ノートで ふくしゅうしよう！',
  '全問せいかいで EXステージが あらわれるよ！',
  'コインをためて、なかまを ふやそう！',
];

export function mountHome(root, ctx) {
  // 日づけが変わっていたら きょうのミッションを作る（前の日に うけとりわすれたコインは 自動で うけとる）
  const carried = refreshMissions(ctx);
  const st = ctx.store.state;
  const now = ctx.now();
  const partner = friendById(st.partner);
  const title = titleFor(st.totalEarned);
  const due = reviewableEntries(ctx).length;
  const remain = remainingSeconds(st, now);
  const today = dayRecord(st, now);
  const limitMin = st.settings.limitMin;
  const usedMin = Math.floor(today.sec / 60);
  const greeting = GREETINGS[Math.floor(now / 60000) % GREETINGS.length];
  const dailyDone = st.daily?.date === dateKey(now) && st.daily.cleared;

  const subjectCards = ctx.SUBJECTS.map((subj) => {
    const units = (ctx.subjects[subj.id]?.units ?? []).filter(isGrade4);
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
          <div class="hero__friend-slot">${friendGoalHtml(st)}</div>
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

      <button class="daily-cta ${dailyDone ? 'done' : ''}" data-act="daily">
        <span class="daily-cta__icon" aria-hidden="true">${dailyDone ? '✅' : '🌟'}</span>
        <span class="daily-cta__text"><b>きょうの5教科チャレンジ</b><small>${dailyDone ? 'きょうは クリアずみ！ れんしゅうは なんどでも OK' : '5教科から1問ずつ。全問せいかいで たからばこ（1日1回）'}</small></span>
        <span class="daily-cta__go" aria-hidden="true">▶</span>
      </button>

      <div class="card missions" id="missions">${missionsHtml(ctx)}</div>

      <h2 class="section-title">きょうかを えらぼう</h2>
      <div class="subject-grid">${subjectCards}</div>

      <div class="card stampcard">${stampsHtml(ctx)}</div>

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

  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  if (carried) later(() => toast(`きのうの ミッションの コイン ＋${withCommas(carried)} を うけとったよ`, 3200), 400);

  /** ミッションのコインを うけとる（コインが上のコイン表示へ飛んでいく） */
  function claim(el) {
    const before = ctx.store.state.coins;
    let res = { ok: false, coins: 0, bonus: 0 };
    ctx.store.update((state) => {
      res = claimMission(state, Number(el.dataset.i), ctx.now());
    });
    if (!res.ok) return;
    const { fx, sfx } = ctx;
    const hud = document.getElementById('hud-coins');
    const hudCount = document.getElementById('hud-coin-count');
    // 上のコイン表示は、コインがとどいてから ふやす（先に ふえた数が出て もどるのを ふせぐ）
    hudCount.textContent = withCommas(before);
    sfx.chest();
    const c = fx.centerOf(el);
    fx.burst(c.x, c.y);
    fx.shockwave(c.x, c.y);
    fx.fountain(c.x, c.y, 8);
    let started = false;
    fx.coins(el, hud, res.coins + res.bonus, (k) => {
      sfx.coin(k);
      if (!started) {
        started = true;
        fx.countUp(hudCount, before, ctx.store.state.coins, 600);
        fx.pop(hud);
      }
    });
    const card = $('#missions', root);
    card.innerHTML = missionsHtml(ctx);
    $('.hero__friend-slot', root).innerHTML = friendGoalHtml(ctx.store.state);
    // キーボードで うけとったときも、つぎの「うけとる」か 見出しに もどる
    ($('.btn--claim', card) ?? $('h2', card)).focus({ preventScroll: true });
    if (res.bonus) {
      later(() => {
        sfx.levelUp();
        if (ctx.effectsLevel() !== 'calm') fx.banner('ミッション コンプリート！', { sub: `ボーナス ＋${res.bonus}`, variant: 'gold', duration: 1100, pass: true });
        else toast(`🎉 ミッション コンプリート！ ボーナス ＋${res.bonus}`);
        fx.confetti(1600);
        fx.streamers();
        const m = fx.centerOf(card);
        fx.explode(m.x, m.y, ['🎯', '🎉', '⭐', '💖']);
      }, 450);
    }
  }

  let guideTimer = 0;
  if (!st.seenGuide) {
    ctx.store.update((state) => {
      state.seenGuide = true;
    });
    guideTimer = setTimeout(() => showGuide(ctx), 300);
  }

  const offAct = onAct(root, {
    subject: (el) => ctx.go(`#/subject/${el.dataset.id}`),
    review: () => startReview(ctx),
    daily: () => startDaily(ctx),
    claim,
    partner: (el) => {
      ctx.sfx.tap();
      ctx.fx.hop([el]);
      const bubble = root.querySelector('.hero__bubble');
      bubble.textContent = partner.line;
    },
  });
  return () => {
    offAct();
    clearTimeout(guideTimer);
    timers.forEach(clearTimeout);
    ctx.fx.clearBanners();
  };
}
