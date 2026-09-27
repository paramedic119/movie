// おうちの人向けページ：学習のようす・時間の設定・演出の設定
// （暗証番号はこの端末の中だけの「かんたんなカギ」です）

import { esc, md, onAct } from './dom.js';
import { openModal, toast } from './modal.js';
import { dateKey, dayRecord, remainingSeconds } from '../game/state.js';
import { dueEntries } from '../game/review.js';
import { furikaeriFor } from '../data/furikaeri.js';
import { withCommas } from '../lib/numfmt.js';
import { plainText } from '../lib/markup.js';

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];
const LIMIT_OPTIONS = [0, 15, 20, 30, 45, 60, 90, 120];
const BREAK_OPTIONS = [0, 15, 20, 30, 45];

let unlocked = false;

// ---------- グラフ（1週間のあそんだ時間：たて棒） ----------

function niceMax(v) {
  const steps = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 60) * 60;
}

function weekData(st, now) {
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    const ts = now - i * 86400000;
    const key = dateKey(ts);
    const d = st.days[key] ?? { sec: 0, n: 0, c: 0, coins: 0 };
    const date = new Date(ts);
    out.push({
      key,
      label: WEEKDAY[date.getDay()],
      sub: `${date.getMonth() + 1}/${date.getDate()}`,
      min: Math.round(d.sec / 60),
      n: d.n,
      c: d.c,
      today: i === 0,
    });
  }
  return out;
}

function weekChartSvg(data, limitMin) {
  const W = 340;
  const plotTop = 22;
  const plotH = 130;
  const axisBand = 38;
  const left = 34;
  const right = 12;
  const plotW = W - left - right;
  const maxV = niceMax(Math.max(10, limitMin || 0, ...data.map((d) => d.min)));
  const y = (v) => plotTop + plotH - (v / maxV) * plotH;
  const band = plotW / data.length;
  const bw = Math.min(24, band * 0.5);
  const ticks = [0, maxV / 2, maxV];
  const bars = data
    .map((d, i) => {
      const cx = left + band * i + band / 2;
      const top = y(d.min);
      const h = plotTop + plotH - top;
      const r = Math.min(4, h);
      const x0 = cx - bw / 2;
      const x1 = cx + bw / 2;
      const base = plotTop + plotH;
      const path =
        h > 0
          ? `M${x0},${base} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x1 - r},${top} Q${x1},${top} ${x1},${top + r} L${x1},${base} Z`
          : '';
      return `<g class="wk-bar ${d.today ? 'is-today' : ''}" tabindex="0" data-i="${i}" role="img" aria-label="${d.sub}（${d.label}） ${d.min}分、問題${d.n}問、せいかい${d.c}問">
        <rect class="wk-hit" x="${left + band * i}" y="${plotTop - 10}" width="${band}" height="${plotH + axisBand}" fill="transparent"/>
        ${path ? `<path class="wk-mark" d="${path}"/>` : ''}
        ${d.today && d.min > 0 ? `<text class="wk-cap" x="${cx}" y="${top - 6}" text-anchor="middle">${d.min}分</text>` : ''}
        <text class="wk-x ${d.today ? 'strong' : ''}" x="${cx}" y="${plotTop + plotH + 16}" text-anchor="middle">${d.today ? 'きょう' : d.label}</text>
        <text class="wk-x sub" x="${cx}" y="${plotTop + plotH + 30}" text-anchor="middle">${d.sub}</text>
      </g>`;
    })
    .join('');
  const grid = ticks
    .map(
      (t) => `<line class="wk-grid" x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="wk-y" x="${left - 6}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${t}</text>`,
    )
    .join('');
  const limit =
    limitMin && limitMin <= maxV
      ? `<line class="wk-limit" x1="${left}" x2="${W - right}" y1="${y(limitMin)}" y2="${y(limitMin)}"/>
         <text class="wk-limit-label" x="${W - right}" y="${y(limitMin) - 5}" text-anchor="end">上限 ${limitMin}分</text>`
      : '';
  return `<svg class="wk-chart" viewBox="0 0 ${W} ${plotTop + plotH + axisBand}" role="group" aria-label="この1週間の学習時間（分）">
    <text class="wk-y unit" x="${left - 6}" y="10" text-anchor="end">分</text>
    ${grid}${limit}${bars}
  </svg>`;
}

// ---------- 画面 ----------

export function mountParent(root, ctx) {
  let cleanup = () => {};

  function renderGate() {
    const st = ctx.store.state;
    const setup = !st.pin;
    root.innerHTML = `
      <section class="parent">
        <h1 class="page-title">👪 おうちの方へ</h1>
        <div class="card gate">
          <p>${setup ? 'はじめに、おうちの方用の<b>4けたの暗証番号</b>を決めてください。' : '暗証番号を入力してください。'}</p>
          <form class="gate__form" data-form="pin">
            <input class="pin-input" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}" maxlength="4" required aria-label="暗証番号（4けた）" name="pin" placeholder="••••">
            ${setup ? '<input class="pin-input" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{4}" maxlength="4" required aria-label="確認のためもう一度" name="pin2" placeholder="もう一度">' : ''}
            <button class="btn btn--primary" type="submit">${setup ? '決定' : 'ひらく'}</button>
          </form>
          <p class="small muted">暗証番号はこの端末の中だけに保存される、お子さま向けの簡単なカギです。忘れたときは、ブラウザのサイトデータを消すとリセットされます（学習記録も消えます）。</p>
        </div>
      </section>`;
    const form = root.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = form.pin.value.trim();
      if (!/^\d{4}$/.test(pin)) return toast('4けたの数字を入れてください');
      if (setup) {
        if (pin !== form.pin2.value.trim()) return toast('2つの番号がちがいます');
        ctx.store.update((s) => {
          s.pin = pin;
        });
        unlocked = true;
        render();
      } else if (pin === st.pin) {
        unlocked = true;
        render();
      } else {
        toast('暗証番号がちがいます');
        ctx.fx.shake(form);
        form.pin.value = '';
      }
    });
    setTimeout(() => form.pin.focus(), 50);
  }

  function renderDashboard() {
    const st = ctx.store.state;
    const now = ctx.now();
    const today = dayRecord(st, now);
    const week = weekData(st, now);
    const weekMin = week.reduce((a, d) => a + d.min, 0);
    const weekN = week.reduce((a, d) => a + d.n, 0);
    const remain = remainingSeconds(st, now);
    const due = dueEntries(st.notebook, now);
    const notebook = Object.values(st.notebook).sort((a, b) => b.last - a.last).slice(0, 12);

    const subjRows = ctx.SUBJECTS.map((s) => {
      const r = st.subjects[s.id] ?? { n: 0, c: 0 };
      const pct = r.n ? Math.round((r.c / r.n) * 100) : null;
      return { ...s, n: r.n, c: r.c, pct };
    });
    const weak = Object.entries(st.unitStats)
      .map(([uid, us]) => ({ unit: ctx.unitById(uid), n: us.n, rate: us.recent.length ? us.recent.reduce((a, b) => a + b, 0) / us.recent.length : 0 }))
      .filter((x) => x.unit && x.n >= 5)
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 3);
    const set = st.settings;

    root.innerHTML = `
      <section class="parent">
        <div class="parent-head">
          <h1 class="page-title">👪 おうちの方へ</h1>
          <button class="btn btn--small" data-act="lock">🔒 閉じる</button>
        </div>

        <div class="card">
          <h2 class="card-title">今日のようす</h2>
          <div class="kpi-row">
            <div class="kpi"><span class="kpi__label">学習時間</span><span class="kpi__value">${Math.floor(today.sec / 60)}<small>分</small></span><span class="kpi__sub">${set.limitMin ? `上限 ${set.limitMin}分${st.extra.date === dateKey(now) && st.extra.min ? `＋延長${st.extra.min}分` : ''}` : '上限なし'}</span></div>
            <div class="kpi"><span class="kpi__label">解いた問題</span><span class="kpi__value">${today.n}<small>問</small></span><span class="kpi__sub">正解 ${today.c}問</span></div>
            <div class="kpi"><span class="kpi__label">正答率</span><span class="kpi__value">${today.n ? Math.round((today.c / today.n) * 100) : '–'}<small>${today.n ? '%' : ''}</small></span><span class="kpi__sub">今日の分</span></div>
            <div class="kpi"><span class="kpi__label">復習待ち</span><span class="kpi__value">${due.length}<small>問</small></span><span class="kpi__sub">覚えた ${st.mastered}問</span></div>
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">この1週間の学習時間</h2>
          <p class="card-sub">合計 ${weekMin}分・${weekN}問</p>
          <div class="chart-box" id="wk-box">
            ${weekChartSvg(week, set.limitMin)}
            <div class="chart-tip" id="wk-tip" hidden></div>
          </div>
          <details class="table-view"><summary>表で見る</summary>
            <table><thead><tr><th>日付</th><th>時間</th><th>問題</th><th>正解</th></tr></thead>
            <tbody>${week.map((d) => `<tr><td>${d.sub}（${d.label}）</td><td>${d.min}分</td><td>${d.n}</td><td>${d.c}</td></tr>`).join('')}</tbody></table>
          </details>
        </div>

        <div class="card">
          <h2 class="card-title">教科ごとの正答率（これまで）</h2>
          <ul class="acc-list">
            ${subjRows
              .map(
                (s) => `<li class="acc-row">
                  <span class="acc-row__name"><span class="acc-row__dot" style="background:${s.color}" aria-hidden="true"></span>${s.name}</span>
                  <span class="acc-meter" role="img" aria-label="${s.name} 正答率 ${s.pct ?? 'なし'}%"><i style="width:${s.pct ?? 0}%"></i></span>
                  <span class="acc-row__val">${s.pct === null ? '<span class="muted">まだ</span>' : `<b>${s.pct}%</b> <small>${s.c}/${s.n}問</small>`}</span>
                </li>`,
              )
              .join('')}
          </ul>
          ${
            weak.length
              ? `<h3 class="card-sub-title">最近つまずいている単元</h3>
                 <ul class="weak-list">${weak
                   .map((w) => {
                     const back = furikaeriFor([w.unit.id], ctx.unitById);
                     return `<li>${ctx.subjectMeta(w.unit.subject).emoji} ${esc(plainText(w.unit.title))}：最近の正答率 <b>${Math.round(w.rate * 100)}%</b>${
                       back.length ? `<br><small class="muted">おすすめのふりかえり：${back.map((u) => `${esc(u.gradeLabel)}「${esc(plainText(u.title))}」`).join('・')}</small>` : ''
                     }</li>`;
                   })
                   .join('')}</ul>`
              : ''
          }
        </div>

        <div class="card">
          <h2 class="card-title">まちがいノート（最近の${notebook.length}問）</h2>
          ${
            notebook.length
              ? `<ul class="parent-mistakes">${notebook
                  .map((e) => {
                    const s = ctx.subjectMeta(e.q.subject);
                    const ans = e.q.kind === 'input' ? e.q.fields.map((f) => `${f.label ? `${f.label} ` : ''}${f.answer}${f.suffix ?? ''}`).join('、') : e.q.answer;
                    return `<li><span class="subj-mini" style="--c:${s?.color}">${s?.emoji ?? ''} ${esc(s?.name ?? '')}</span> ${md(e.q.q)} ${e.q.big ? `<b>${md(e.q.big)}</b>` : ''}<br><span class="muted">答え：</span>${md(ans)}<span class="muted">（まちがい ${e.wrong}回）</span></li>`;
                  })
                  .join('')}</ul>
                 <p class="small muted">まちがえた問題は「今日→1日後→3日後→7日後」の間隔で復習に出ます。一緒に解説を読んであげると効果的です。</p>`
              : '<p class="muted">まだありません。</p>'
          }
        </div>

        <div class="card settings">
          <h2 class="card-title">設定</h2>
          <label class="setting"><span>1日に遊べる時間</span>
            <select data-setting="limitMin">${LIMIT_OPTIONS.map((m) => `<option value="${m}" ${set.limitMin === m ? 'selected' : ''}>${m ? `${m}分` : '制限なし'}</option>`).join('')}</select>
          </label>
          <div class="setting setting--row">
            <span>今日だけ延長</span>
            <span class="muted small">${set.limitMin ? `残り ${remain === Infinity ? '―' : Math.max(0, Math.ceil(remain / 60))}分` : ''}</span>
            <button class="btn btn--small" data-act="extend" ${set.limitMin ? '' : 'disabled'}>＋15分</button>
          </div>
          <label class="setting"><span>休けいのお知らせ（続けて遊んだとき）</span>
            <select data-setting="breakMin">${BREAK_OPTIONS.map((m) => `<option value="${m}" ${set.breakMin === m ? 'selected' : ''}>${m ? `${m}分ごと` : 'なし'}</option>`).join('')}</select>
          </label>
          <fieldset class="setting">
            <legend>演出の強さ</legend>
            <div class="seg">
              ${[
                ['calm', 'おだやか'],
                ['normal', 'ふつう'],
                ['exciting', 'にぎやか'],
              ]
                .map(([v, l]) => `<label class="seg__opt"><input type="radio" name="effects" value="${v}" ${set.effects === v ? 'checked' : ''} data-setting="effects"><span>${l}</span></label>`)
                .join('')}
            </div>
            <p class="small muted">「おだやか」はコインが飛ぶ・紙ふぶきなどの動きを止め、刺激をおさえます。</p>
          </fieldset>
          <label class="setting setting--row"><span>ゴールデン問題<small class="setting__note">ときどき出る、正解するとコインが3倍になる問題</small></span><input type="checkbox" class="toggle" data-setting="golden" ${set.golden ? 'checked' : ''}></label>
          <label class="setting setting--row"><span>効果音</span><input type="checkbox" class="toggle" data-setting="sound" ${set.sound ? 'checked' : ''}></label>
          <label class="setting setting--row"><span>英語の読み上げ</span><input type="checkbox" class="toggle" data-setting="voice" ${set.voice ? 'checked' : ''}></label>
          <div class="setting setting--row">
            <span>暗証番号</span>
            <button class="btn btn--small" data-act="change-pin">変更する</button>
          </div>
          <div class="setting setting--row danger-zone">
            <span>学習データをすべて消す</span>
            <button class="btn btn--small btn--danger" data-act="reset">リセット</button>
          </div>
        </div>

        <div class="card about">
          <h2 class="card-title">このアプリの考え方</h2>
          <ul class="small">
            <li>正解するとコインが増え、連続正解（コンボ）で増え方が大きくなります。まちがえてもコインは減りません。</li>
            <li>5問すべて正解すると「EXステージ（追加テスト）」に進めます。EXは難しめの問題で、最大3段階です。</li>
            <li>ステージの終わりの「たからばこ」は、成績（★の数）で銅・銀・金になり、ゴールデン問題に正解するとさらに1つ上がります（全問正解＋ゴールデンで「にじ」）。中身のコインはランクで決まります。</li>
            <li>「ゴールデン問題」は、出るかどうか・どの問題かがランダムです（5問のステージで約半分）。コインが増えるのは正解したときだけで、コインを使うくじ引きではありません。上の設定でオフにできます。</li>
            <li>毎日の「ミッション」（3つ）と、1週間の「がんばりスタンプ」で、毎日少しずつ続ける目標をつくっています。ミッションには、まちがいノートの復習や、正答率の低い教科・下の学年のふりかえりが多めに出ます。休んでも減るものはありません。</li>
            <li>まちがえた問題には必ず解説を表示し、「まちがいノート」で間隔をあけて復習させます。</li>
            <li>コインで買える「なかま」は値段が決まっており、くじ引き（ガチャ）のような運まかせの仕組みはありません。</li>
            <li>1日の時間の上限・休けいのお知らせ・演出の強さを、このページで調整できます。</li>
            <li>記録はこの端末のブラウザの中にだけ保存され、外部には送信されません。</li>
          </ul>
        </div>
      </section>`;

    // グラフのツールチップ（ポインター・キーボードの両方）
    const box = root.querySelector('#wk-box');
    const tip = root.querySelector('#wk-tip');
    const show = (g) => {
      const d = week[Number(g.dataset.i)];
      tip.replaceChildren();
      const v = document.createElement('b');
      v.textContent = `${d.min}分`;
      const l = document.createElement('span');
      l.textContent = `${d.sub}（${d.label}）・問題 ${d.n}・正解 ${d.c}`;
      tip.append(v, l);
      tip.hidden = false;
      const br = box.getBoundingClientRect();
      const gr = g.querySelector('.wk-hit').getBoundingClientRect();
      const x = gr.left - br.left + gr.width / 2;
      tip.style.left = `${Math.max(60, Math.min(br.width - 60, x))}px`;
      g.classList.add('hover');
    };
    const hide = (g) => {
      tip.hidden = true;
      g?.classList.remove('hover');
    };
    root.querySelectorAll('.wk-bar').forEach((g) => {
      g.addEventListener('pointerenter', () => show(g));
      g.addEventListener('pointerleave', () => hide(g));
      g.addEventListener('focus', () => show(g));
      g.addEventListener('blur', () => hide(g));
    });

    // 設定の変更
    root.querySelectorAll('[data-setting]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.dataset.setting;
        let val;
        if (el.type === 'checkbox') val = el.checked;
        else if (el.type === 'radio') val = el.value;
        else val = Number(el.value);
        ctx.store.update((s) => {
          s.settings[key] = val;
        });
        ctx.applySettings();
        toast('設定を保存しました');
        if (key === 'limitMin') render();
      });
    });
  }

  function render() {
    cleanup();
    if (unlocked) renderDashboard();
    else renderGate();
    cleanup = onAct(root, {
      lock: () => {
        unlocked = false;
        ctx.go('#/');
      },
      extend: () => {
        const key = dateKey(ctx.now());
        ctx.store.update((s) => {
          if (s.extra.date !== key) s.extra = { date: key, min: 0 };
          s.extra.min += 15;
        });
        toast('今日だけ 15分 延長しました');
        render();
      },
      'change-pin': async () => {
        const ok = await openModal({
          title: '暗証番号を変更しますか？',
          body: '<p>次の画面で新しい番号を決めます。</p>',
          actions: [
            { label: '変更する', value: true, variant: 'primary' },
            { label: 'やめる', value: false },
          ],
          dismissValue: false,
        });
        if (!ok) return;
        ctx.store.update((s) => {
          s.pin = null;
        });
        unlocked = false;
        render();
      },
      reset: async () => {
        const ok = await openModal({
          title: '学習データをすべて消しますか？',
          body: '<p>コイン・なかま・記録・まちがいノートがすべて消えます。元にはもどせません。</p>',
          actions: [
            { label: 'やめる', value: false, variant: 'primary' },
            { label: 'すべて消す', value: true, variant: 'danger' },
          ],
          dismissValue: false,
        });
        if (!ok) return;
        ctx.store.reset();
        unlocked = false;
        ctx.applySettings();
        ctx.applyTheme();
        toast('リセットしました');
        ctx.go('#/');
      },
    });
  }

  render();
  return () => {
    cleanup();
    unlocked = false;
  };
}

export { weekChartSvg, weekData };
