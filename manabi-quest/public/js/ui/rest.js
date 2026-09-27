// 時間になったときの画面（「きょうは ここまで」）

import { esc, onAct } from './dom.js';
import { friendById } from '../game/shop.js';
import { dayRecord } from '../game/state.js';
import { withCommas } from '../lib/numfmt.js';

export function mountRest(root, ctx) {
  const st = ctx.store.state;
  const today = dayRecord(st, ctx.now());
  const partner = friendById(st.partner);
  const status = ctx.playtime.status();

  root.innerHTML = `
    <section class="rest">
      <div class="card rest-card">
        <div class="rest-card__moon" aria-hidden="true">🌙</div>
        <div class="rest-card__partner" aria-hidden="true">${partner.emoji}<span class="zzz">💤</span></div>
        <h1>${status.timeUp ? 'きょうは ここまで！' : 'おつかれさま！'}</h1>
        <p>${esc(partner.name)}も「またあした あそぼうね」って いってるよ。</p>
        <ul class="rest-stats">
          <li><span>あそんだ時間</span><b>${Math.floor(today.sec / 60)}分</b></li>
          <li><span>といた問題</span><b>${today.n}もん</b></li>
          <li><span>せいかい</span><b>${today.c}もん</b></li>
          <li><span>もらったコイン</span><b>${withCommas(today.coins)}</b></li>
        </ul>
        <p class="small">目を休めて、外で体を動かすのも 大事な べんきょうだよ。</p>
      </div>
      ${status.timeUp ? '' : '<button class="btn btn--primary btn--big" data-act="home">🏠 ホームへ</button>'}
      <button class="btn btn--plain" data-act="parent">👪 おうちの人へ（時間の せってい）</button>
    </section>`;

  return onAct(root, {
    home: () => ctx.go('#/'),
    parent: () => ctx.go('#/parent'),
  });
}
