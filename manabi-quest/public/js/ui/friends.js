// なかま（コレクション）ときせかえ。コインで決まった値段で買う。

import { esc, onAct } from './dom.js';
import { openModal, toast } from './modal.js';
import { FRIENDS, SECRET_FRIENDS, THEMES, buyFriend, buyTheme, friendById } from '../game/shop.js';
import { withCommas } from '../lib/numfmt.js';

export function mountFriends(root, ctx, params) {
  const tab = params.tab === 'theme' ? 'theme' : 'friend';

  function render() {
    const st = ctx.store.state;
    const owned = new Set(st.friends);
    const partner = friendById(st.partner);
    const friendCards = FRIENDS.map((f) => {
      const has = owned.has(f.id);
      const isPartner = st.partner === f.id;
      const affordable = st.coins >= f.price;
      return `<li class="friend-card ${has ? 'owned' : 'locked'} ${isPartner ? 'partner' : ''}">
        <span class="friend-card__emoji" aria-hidden="true">${f.emoji}</span>
        <span class="friend-card__name">${has ? esc(f.name) : '？？？'}</span>
        ${
          has
            ? isPartner
              ? '<span class="tag tag--partner">パートナー</span>'
              : `<button class="btn btn--small" data-act="partner" data-id="${f.id}">パートナーにする</button>`
            : `<button class="btn btn--small btn--buy" data-act="buy" data-id="${f.id}" ${affordable ? '' : 'disabled'}><span class="coin" aria-hidden="true"></span>${withCommas(f.price)}</button>`
        }
      </li>`;
    }).join('');
    const secretCards = SECRET_FRIENDS.map((f) => {
      const has = owned.has(f.id);
      const isPartner = st.partner === f.id;
      return `<li class="friend-card secret ${has ? 'owned' : 'locked'} ${isPartner ? 'partner' : ''}">
        <span class="friend-card__emoji" aria-hidden="true">${f.emoji}</span>
        <span class="friend-card__name">${has ? esc(f.name) : 'ひみつのなかま'}</span>
        ${
          has
            ? isPartner
              ? '<span class="tag tag--partner">パートナー</span>'
              : `<button class="btn btn--small" data-act="partner" data-id="${f.id}">パートナーにする</button>`
            : `<span class="friend-card__how">${esc(f.how)}</span>`
        }
      </li>`;
    }).join('');
    const themeCards = THEMES.map((t) => {
      const has = st.themes.includes(t.id);
      const using = st.theme === t.id;
      const affordable = st.coins >= t.price;
      return `<li class="theme-card theme-preview--${t.id} ${using ? 'using' : ''}">
        <span class="theme-card__emoji" aria-hidden="true">${t.emoji}</span>
        <span class="theme-card__name">${esc(t.name)}</span>
        ${
          has
            ? using
              ? '<span class="tag tag--partner">つかっている</span>'
              : `<button class="btn btn--small" data-act="use-theme" data-id="${t.id}">つかう</button>`
            : `<button class="btn btn--small btn--buy" data-act="buy-theme" data-id="${t.id}" ${affordable ? '' : 'disabled'}><span class="coin" aria-hidden="true"></span>${withCommas(t.price)}</button>`
        }
      </li>`;
    }).join('');

    root.innerHTML = `
      <section class="friends">
        <h1 class="page-title">🐾 なかま</h1>
        <div class="card partner-card">
          <span class="partner-card__emoji" aria-hidden="true">${partner.emoji}</span>
          <div>
            <div class="partner-card__name">パートナー：${esc(partner.name)}</div>
            <div class="partner-card__line">「${esc(partner.line)}」</div>
          </div>
        </div>
        <div class="tabs" role="tablist">
          <button role="tab" class="tab ${tab === 'friend' ? 'on' : ''}" aria-selected="${tab === 'friend'}" data-act="tab" data-tab="friend">なかま（${st.friends.length}/${FRIENDS.length + SECRET_FRIENDS.length}）</button>
          <button role="tab" class="tab ${tab === 'theme' ? 'on' : ''}" aria-selected="${tab === 'theme'}" data-act="tab" data-tab="theme">きせかえ</button>
        </div>
        ${
          tab === 'friend'
            ? `<p class="hint-text">コインで なかまを ふやそう。なかまは クイズで おうえんしてくれるよ！</p>
               <ul class="friend-grid">${friendCards}</ul>
               <h2 class="section-title">ひみつのなかま</h2>
               <p class="hint-text">コインでは 買えない。がんばると なかまになるよ。</p>
               <ul class="friend-grid">${secretCards}</ul>`
            : `<p class="hint-text">画面の <ruby>背景<rt>はいけい</rt></ruby>を かえられるよ。</p><ul class="theme-grid">${themeCards}</ul>`
        }
      </section>`;
  }

  async function buy(kind, id) {
    const item = kind === 'friend' ? FRIENDS.find((f) => f.id === id) : THEMES.find((t) => t.id === id);
    if (!item) return;
    const ok = await openModal({
      title: kind === 'friend' ? `${item.emoji} なかまにする？` : `${item.emoji} きせかえを買う？`,
      body: `<p><span class="coin" aria-hidden="true"></span><b>${withCommas(item.price)}</b> コインで「${esc(kind === 'friend' ? '？？？' : item.name)}」を ${kind === 'friend' ? 'なかまにします' : '買います'}。</p><p class="small">いまのコイン：${withCommas(ctx.store.state.coins)}</p>`,
      actions: [
        { label: kind === 'friend' ? 'なかまにする！' : '買う！', value: true, variant: 'primary' },
        { label: 'やめておく', value: false, variant: 'plain' },
      ],
      dismissValue: false,
    });
    if (!ok) return;
    let done = false;
    ctx.store.update((st) => {
      done = kind === 'friend' ? buyFriend(st, id) : buyTheme(st, id);
      if (done && kind === 'theme') st.theme = id;
    });
    if (!done) {
      toast('コインが たりないよ');
      return;
    }
    ctx.sfx.buy();
    ctx.applyTheme();
    ctx.refreshHud();
    render();
    const c = ctx.fx.centerOf(root.querySelector('.page-title'));
    ctx.fx.burst(c.x, c.y + 120);
    if (kind === 'friend') {
      ctx.fx.confetti(1200);
      // あたらしい なかまが いっぱい とびだして、リボンが ビュン
      ctx.fx.explode(c.x, c.y + 160, [item.emoji, item.emoji, '🎉', '💖'], 16);
      ctx.fx.streamers(4);
      await openModal({
        title: `${item.emoji} ${esc(item.name)} が なかまになった！`,
        body: `<p class="big-emoji">${item.emoji}</p><p>「${esc(item.line)}」</p>`,
        actions: [
          { label: 'パートナーにする', value: 'partner', variant: 'primary' },
          { label: 'とじる', value: null, variant: 'plain' },
        ],
      }).then((v) => {
        if (v === 'partner') {
          ctx.store.update((st) => {
            st.partner = id;
          });
          render();
        }
      });
    }
  }

  render();
  return onAct(root, {
    tab: (el) => ctx.go(el.dataset.tab === 'theme' ? '#/friends/theme' : '#/friends'),
    buy: (el) => buy('friend', el.dataset.id),
    'buy-theme': (el) => buy('theme', el.dataset.id),
    partner: (el) => {
      ctx.store.update((st) => {
        st.partner = el.dataset.id;
      });
      ctx.sfx.tap();
      render();
    },
    'use-theme': (el) => {
      ctx.store.update((st) => {
        st.theme = el.dataset.id;
      });
      ctx.applyTheme();
      render();
    },
  });
}
