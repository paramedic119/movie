// 演出（コイン・キラキラ・紙ふぶき・バナー・看板・リボン・ふうせん など）
// 演出は いつも いちばん派手に出す（設定で弱くすることは しない）。
// ただし、点滅（フラッシュ）のような 強い光の演出は 使わない。

import { withCommas } from '../lib/numfmt.js';

// 1回の演出で出す数
const FX = { particles: 26, coins: 12, confetti: 150, streamers: 9, balloons: 14, explode: 32, fountain: 20 };

const SHAPES = ['★', '●', '♥', '✦', '▲'];
const COLORS = ['#ff5d8f', '#ffc300', '#2f8dff', '#1fb574', '#8a63ff', '#ff8a1f'];
const STREAMER_COLORS = ['#ffcf33', '#ff5d8f', '#2fc4b2', '#5b8dff', '#a26bff', '#ff9f1c'];
const BALLOON_COLORS = ['#ff8fb8', '#b59cff', '#62dca8', '#ffd23f', '#6cb8ff', '#ff9f6b'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const rand = (a, b) => a + Math.random() * (b - a);

const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

/**
 * @param {{layer:HTMLElement, back?:HTMLElement|null}} opts
 *   layer … 画面の いちばん上（ボタンは押せる）。back … 画面の うしろ（ひかりの線・ふうせん）
 */
export function createFx({ layer, back = null }) {
  const add = (el) => {
    layer.appendChild(el);
    return el;
  };
  const addBack = (el) => {
    (back ?? layer).appendChild(el);
    return el;
  };
  const done = (anim, el) => {
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
    return anim;
  };

  let canvas = null;
  let confettiRaf = 0;
  const banners = new Set();

  const fx = {
    /** キラキラがはじける */
    burst(x, y, { count } = {}) {
      const n = count ?? FX.particles;
      for (let i = 0; i < n; i += 1) {
        const el = add(document.createElement('span'));
        el.className = 'fx-particle';
        el.textContent = SHAPES[i % SHAPES.length];
        el.style.color = COLORS[i % COLORS.length];
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
        const dist = 60 + Math.random() * 90;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        done(
          el.animate(
            [
              { transform: 'translate(-50%,-50%) scale(0.4) rotate(0deg)', opacity: 1 },
              { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.7 },
              { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy * 1.15 + 30}px)) scale(0.6)`, opacity: 0 },
            ],
            { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(.2,.8,.3,1)' },
          ),
          el,
        );
      }
    },

    /** にじ色のわっか */
    ring(x, y) {
      const el = add(document.createElement('div'));
      el.className = 'fx-ring';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      done(
        el.animate(
          [
            { transform: 'translate(-50%,-50%) scale(0.2) rotate(0deg)', opacity: 0.95 },
            { transform: 'translate(-50%,-50%) scale(1.5) rotate(160deg)', opacity: 0 },
          ],
          { duration: 750, easing: 'cubic-bezier(.1,.7,.3,1)' },
        ),
        el,
      );
    },

    /** 「+15」のような文字がうかぶ */
    floatText(x, y, text, className = '') {
      const el = add(document.createElement('div'));
      el.className = `fx-float ${className}`;
      el.textContent = text;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      done(
        el.animate(
          [
            { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
            { transform: 'translate(-50%,-90%) scale(1.15)', opacity: 1, offset: 0.25 },
            { transform: 'translate(-50%,-220%) scale(1)', opacity: 0 },
          ],
          { duration: 1100, easing: 'ease-out' },
        ),
        el,
      );
    },

    /** コインが上のコイン表示へ飛んでいく。onEach は1まいとどくごとに呼ばれる */
    coins(fromEl, toEl, amount, onEach = () => {}) {
      const n = Math.min(FX.coins, Math.max(1, Math.ceil(amount / 8)));
      if (!fromEl || !toEl) {
        onEach(0, 1);
        return Promise.resolve();
      }
      const from = centerOf(fromEl);
      const to = centerOf(toEl);
      const jobs = [];
      for (let i = 0; i < n; i += 1) {
        const el = add(document.createElement('span'));
        el.className = 'coin fx-coin';
        el.style.left = `${from.x}px`;
        el.style.top = `${from.y}px`;
        const sx = (Math.random() - 0.5) * 140;
        const sy = -40 - Math.random() * 80;
        const anim = el.animate(
          [
            { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
            { transform: `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px)) scale(1.2)`, opacity: 1, offset: 0.35 },
            { transform: `translate(calc(-50% + ${to.x - from.x}px), calc(-50% + ${to.y - from.y}px)) scale(0.7)`, opacity: 0.9 },
          ],
          { duration: 650 + i * 70, delay: i * 45, easing: 'cubic-bezier(.5,0,.4,1)', fill: 'forwards' },
        );
        jobs.push(
          new Promise((resolve) => {
            anim.onfinish = () => {
              el.remove();
              onEach(i, n);
              resolve();
            };
            anim.oncancel = () => {
              el.remove();
              resolve();
            };
          }),
        );
      }
      return Promise.all(jobs);
    },

    /** ななめストライプのバナー（「EX 1」「パーフェクト！」など） */
    /**
     * @param {string} text
     * @param {{sub?:string, variant?:string, duration?:number, pass?:boolean}} [opts]
     *   pass=true … バナーの下のボタンをそのまま押せる（遊びを止めない）
     */
    banner(text, { sub = '', variant = 'ex', duration = 1300, pass = false } = {}) {
      const el = add(document.createElement('div'));
      el.className = `fx-banner fx-banner--${variant} ${pass ? 'fx-banner--pass' : ''}`;
      el.innerHTML = `<div class="fx-banner__strip"><span class="fx-banner__text"></span><span class="fx-banner__sub"></span></div>`;
      el.querySelector('.fx-banner__text').textContent = text;
      el.style.setProperty('--len', String(Math.max(4, [...text].length))); // 長い文字は小さくして画面におさめる
      el.querySelector('.fx-banner__sub').textContent = sub;
      const strip = el.firstElementChild;
      const frames = [
        { transform: 'translate(-120%, -50%) rotate(-6deg)' },
        { transform: 'translate(4%, -50%) rotate(-6deg)', offset: 0.18 },
        { transform: 'translate(0, -50%) rotate(-6deg)', offset: 0.26 },
        { transform: 'translate(0, -50%) rotate(-6deg)', offset: 0.8 },
        { transform: 'translate(120%, -50%) rotate(-6deg)' },
      ];
      const anim = strip.animate(frames, { duration: duration + 500, easing: 'ease-in-out', fill: 'forwards' });
      banners.add(anim);
      return new Promise((resolve) => {
        const finish = () => {
          banners.delete(anim);
          el.remove();
          resolve();
        };
        anim.onfinish = finish;
        anim.oncancel = finish;
        if (!pass) el.addEventListener('click', () => anim.finish(), { once: true });
      });
    },

    /** 出ているバナー・看板をすぐに終わらせる（画面を切りかえるとき） */
    clearBanners() {
      [...banners].forEach((anim) => anim.finish());
    },

    // ---------- 参考動画のような 派手な演出 ----------

    /**
     * なかまが 上から ロープで ぶらさがって、看板を見せる（ゆらゆら ゆれて 上へ もどる）。
     * 下のボタンは そのまま押せる。前の看板は すぐに しまう
     */
    sign(text, { emoji = '🐘', variant = '' } = {}) {
      [...banners].filter((a) => a.sign).forEach((a) => a.finish());
      const el = add(document.createElement('div'));
      el.className = `fx-sign ${variant ? `fx-sign--${variant}` : ''}`;
      el.innerHTML = '<span class="fx-sign__rope"></span><span class="fx-sign__board"></span><span class="fx-sign__buddy"></span>';
      el.querySelector('.fx-sign__board').textContent = text;
      el.querySelector('.fx-sign__buddy').textContent = emoji;
      el.style.setProperty('--len', String(Math.max(4, [...text].length)));
      const anim = el.animate(
        [
          { transform: 'translate(-50%, -110%) rotate(0deg)' },
          { transform: 'translate(-50%, 6%) rotate(-8deg)', offset: 0.2 },
          { transform: 'translate(-50%, -3%) rotate(6deg)', offset: 0.34 },
          { transform: 'translate(-50%, 1%) rotate(-3deg)', offset: 0.48 },
          { transform: 'translate(-50%, 0) rotate(1.5deg)', offset: 0.62 },
          { transform: 'translate(-50%, 0) rotate(0deg)', offset: 0.78 },
          { transform: 'translate(-50%, -120%) rotate(5deg)' },
        ],
        { duration: 1300, easing: 'ease-in-out', fill: 'forwards' },
      );
      anim.sign = true;
      banners.add(anim);
      return new Promise((resolve) => {
        const finish = () => {
          banners.delete(anim);
          el.remove();
          resolve();
        };
        anim.onfinish = finish;
        anim.oncancel = finish;
      });
    },

    /** 色とりどりの リボンが 画面を ビュンと よこぎる */
    streamers(count) {
      const n = count ?? FX.streamers;
      if (!n) return;
      const w = globalThis.innerWidth;
      const h = globalThis.innerHeight;
      const svg = add(document.createElementNS(SVG_NS, 'svg'));
      svg.setAttribute('class', 'fx-streamers');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      let left = n;
      for (let i = 0; i < n; i += 1) {
        // 画面の上から下へ、くねくね まがる線
        let x = rand(-0.1, 1.1) * w;
        let y = -40;
        let d = `M${x.toFixed(1)} ${y}`;
        const drift = rand(-0.35, 0.35) * w;
        const steps = 3;
        for (let k = 1; k <= steps; k += 1) {
          const nx = x + drift / steps + rand(-0.12, 0.12) * w;
          const ny = ((h + 80) * k) / steps;
          const bend = rand(0.25, 0.45) * w * (k % 2 ? 1 : -1);
          d += ` C${(x + bend).toFixed(1)} ${(y + (ny - y) * 0.33).toFixed(1)} ${(nx + bend).toFixed(1)} ${(y + (ny - y) * 0.66).toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
          x = nx;
          y = ny;
        }
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', STREAMER_COLORS[i % STREAMER_COLORS.length]);
        path.setAttribute('stroke-width', String(Math.round(rand(9, 15))));
        svg.appendChild(path);
        const len = path.getTotalLength?.() || h * 1.6;
        const dash = len * 0.38;
        path.style.strokeDasharray = `${dash} ${len + dash}`;
        const anim = path.animate([{ strokeDashoffset: `${dash}px` }, { strokeDashoffset: `${-len}px` }], {
          duration: rand(850, 1150),
          delay: i * 55,
          easing: 'cubic-bezier(.45,.05,.4,1)',
          fill: 'both',
        });
        const end = () => {
          left -= 1;
          if (left === 0) svg.remove();
        };
        anim.onfinish = end;
        anim.oncancel = end;
      }
    },

    /** 黄色い しょうげきはの わっか */
    shockwave(x, y, { color = '#ffc21a', size = 1 } = {}) {
      const el = add(document.createElement('div'));
      el.className = 'fx-shock';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.borderColor = color;
      done(
        el.animate(
          [
            { transform: 'scale(0.3)', opacity: 1, borderWidth: '10px' },
            { transform: `scale(${5 * size})`, opacity: 0, borderWidth: '2px' },
          ],
          { duration: 600, easing: 'cubic-bezier(.1,.7,.3,1)' },
        ),
        el,
      );
    },

    /** 「+15」「コンボ×1.5」のような ふきだしが ポンと出て うかぶ */
    scorePop(x, y, text, { variant = 'coin', delay = 0, dx = 0 } = {}) {
      const el = add(document.createElement('div'));
      el.className = `fx-pop fx-pop--${variant}`;
      el.textContent = text;
      el.style.left = `${x + dx}px`;
      el.style.top = `${y}px`;
      const tilt = rand(-8, 8);
      done(
        el.animate(
          [
            { transform: `translate(-50%,-50%) scale(0.2) rotate(${tilt}deg)`, opacity: 0 },
            { transform: `translate(-50%,-50%) scale(1.3) rotate(${-tilt / 2}deg)`, opacity: 1, offset: 0.2 },
            { transform: `translate(-50%,-50%) scale(1) rotate(0deg)`, opacity: 1, offset: 0.35 },
            { transform: `translate(-50%,-170%) scale(0.95) rotate(0deg)`, opacity: 0 },
          ],
          { duration: 1150, delay, easing: 'ease-out', fill: 'backwards' },
        ),
        el,
      );
    },

    /** コイン・ハート・星が ふんすいのように とびだして 落ちる */
    fountain(x, y, count) {
      const n = count ?? FX.fountain;
      if (!n) return;
      const h = globalThis.innerHeight;
      for (let i = 0; i < n; i += 1) {
        const el = add(document.createElement('span'));
        const kind = i % 3;
        if (kind === 0) {
          el.className = 'coin fx-coin';
        } else {
          el.className = 'fx-particle';
          el.textContent = kind === 1 ? '♥' : '★';
          el.style.color = COLORS[i % COLORS.length];
        }
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        const dx = rand(-140, 140);
        const up = rand(90, 220);
        const spin = rand(-540, 540);
        done(
          el.animate(
            [
              { transform: 'translate(-50%,-50%) scale(0.4) rotate(0deg)', opacity: 1 },
              { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% - ${up}px)) scale(1.15) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.4 },
              { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${h - y + 60}px)) scale(0.9) rotate(${spin}deg)`, opacity: 0.9 },
            ],
            { duration: rand(1100, 1500), delay: i * 22, easing: 'cubic-bezier(.3,.6,.6,1)', fill: 'backwards' },
          ),
          el,
        );
      }
    },

    /** なかまや ハートが まん中から ドカンと とびちる */
    explode(x, y, emojis = ['🎉'], count) {
      const n = count ?? FX.explode;
      if (!n) return;
      for (let i = 0; i < n; i += 1) {
        const el = add(document.createElement('span'));
        el.className = 'fx-emoji';
        el.textContent = emojis[i % emojis.length];
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        const angle = (Math.PI * 2 * i) / n + rand(-0.2, 0.2);
        const dist = rand(120, 260);
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const spin = rand(-360, 360);
        done(
          el.animate(
            [
              { transform: 'translate(-50%,-50%) scale(0.2) rotate(0deg)', opacity: 1 },
              { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.35) rotate(${spin}deg)`, opacity: 1, offset: 0.55 },
              { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy * 1.2 + 120}px)) scale(0.8) rotate(${spin * 1.4}deg)`, opacity: 0 },
            ],
            { duration: rand(1100, 1500), delay: i * 12, easing: 'cubic-bezier(.15,.8,.35,1)', fill: 'backwards' },
          ),
          el,
        );
      }
    },

    /** 画面の うしろで ひかりの線が まわる（点めつは しない） */
    sunburst(ms = 1600) {
      const el = addBack(document.createElement('div'));
      el.className = 'fx-sunburst';
      done(
        el.animate(
          [
            { transform: 'rotate(0deg) scale(0.6)', opacity: 0 },
            { transform: 'rotate(12deg) scale(1)', opacity: 1, offset: 0.25 },
            { transform: 'rotate(40deg) scale(1.05)', opacity: 1, offset: 0.7 },
            { transform: 'rotate(55deg) scale(1.1)', opacity: 0 },
          ],
          { duration: ms, easing: 'ease-out' },
        ),
        el,
      );
    },

    /** 画面の うしろを 大きな ふうせんが のぼっていく */
    balloons(count) {
      const n = count ?? FX.balloons;
      if (!n) return;
      const w = globalThis.innerWidth;
      const h = globalThis.innerHeight;
      for (let i = 0; i < n; i += 1) {
        const el = addBack(document.createElement('div'));
        el.className = 'fx-balloon';
        el.style.setProperty('--bc', BALLOON_COLORS[i % BALLOON_COLORS.length]);
        el.style.left = `${((i + rand(0, 0.8)) / n) * w - 40}px`;
        const s = rand(0.8, 1.5);
        const sway = rand(-40, 40);
        done(
          el.animate(
            [
              { transform: `translate(0, 0) scale(${s}) rotate(${-sway / 4}deg)` },
              { transform: `translate(${sway}px, ${-(h * 0.6)}px) scale(${s}) rotate(${sway / 4}deg)`, offset: 0.55 },
              { transform: `translate(${-sway / 2}px, ${-(h + 260)}px) scale(${s}) rotate(${-sway / 6}deg)` },
            ],
            { duration: rand(1700, 2400), delay: i * 60, easing: 'cubic-bezier(.3,.2,.6,1)', fill: 'backwards' },
          ),
          el,
        );
      }
    },

    /** ぷるんと はずむ（正解の カードなど） */
    bounce(el) {
      if (!el) return;
      el.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(1.05, 0.95)', offset: 0.25 },
          { transform: 'scale(0.97, 1.03)', offset: 0.55 },
          { transform: 'scale(1)' },
        ],
        { duration: 380, easing: 'ease-out' },
      );
    },

    /** カードが ななめに かたむきながら とびこんでくる */
    flyIn(el, { strong = false } = {}) {
      if (!el) return;
      const t = strong ? 'translateY(140px) rotate(-12deg) scale(0.6)' : 'translateY(60px) rotate(-5deg) scale(0.85)';
      el.animate(
        [
          { transform: t, opacity: 0 },
          { transform: 'translateY(-8px) rotate(3deg) scale(1.04)', opacity: 1, offset: 0.6 },
          { transform: 'translateY(2px) rotate(-1deg) scale(0.99)', offset: 0.8 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: strong ? 700 : 480, easing: 'cubic-bezier(.2,.8,.3,1)' },
      );
    },

    /** 筆算の答えの数字が 大きく出て、マスに すいこまれる */
    digitPop(el, digit) {
      if (!el) return;
      const c = centerOf(el);
      const big = add(document.createElement('div'));
      big.className = 'fx-digit';
      big.textContent = String(digit);
      big.style.left = `${c.x}px`;
      big.style.top = `${c.y}px`;
      done(
        big.animate(
          [
            { transform: 'translate(-50%,-50%) scale(3.2)', opacity: 0 },
            { transform: 'translate(-50%,-50%) scale(2.4)', opacity: 1, offset: 0.25 },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 },
          ],
          { duration: 420, easing: 'cubic-bezier(.5,0,.7,1)' },
        ),
        big,
      );
      fx.shockwave(c.x, c.y, { size: 0.6 });
    },

    /** ハンコを「ポン」とおす（el はハンコの要素） */
    stamp(el) {
      if (!el) return;
      el.classList.add('on');
      el.animate(
        [
          { transform: 'scale(2.6) rotate(-30deg)', opacity: 0 },
          { transform: 'scale(0.9) rotate(-12deg)', opacity: 1, offset: 0.55 },
          { transform: 'scale(1.06) rotate(-12deg)', offset: 0.78 },
          { transform: 'scale(1) rotate(-12deg)', opacity: 1 },
        ],
        { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1)' },
      );
    },

    /** 「ドン」と下にゆれる */
    thud(el) {
      if (!el) return;
      el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(5px)' }, { transform: 'translateY(-2px)' }, { transform: 'translateY(0)' }], {
        duration: 260,
        easing: 'ease-out',
      });
    },

    /** 紙ふぶき */
    confetti(ms = 1800) {
      const n = FX.confetti;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'fx-confetti';
        layer.appendChild(canvas);
      }
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      const w = globalThis.innerWidth;
      const h = globalThis.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const c2d = canvas.getContext('2d');
      if (!c2d) return; // 描画できない環境では紙ふぶきなし
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      const parts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: -20 - Math.random() * h * 0.5,
        vx: (Math.random() - 0.5) * 2.4,
        vy: 2 + Math.random() * 3.5,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        s: 6 + Math.random() * 7,
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
      }));
      const start = performance.now();
      cancelAnimationFrame(confettiRaf);
      const frame = (t) => {
        const elapsed = t - start;
        c2d.clearRect(0, 0, w, h);
        const fade = elapsed > ms ? Math.max(0, 1 - (elapsed - ms) / 500) : 1;
        c2d.globalAlpha = fade;
        for (const p of parts) {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.035;
          p.r += p.vr;
          c2d.save();
          c2d.translate(p.x, p.y);
          c2d.rotate(p.r);
          c2d.fillStyle = p.c;
          c2d.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
          c2d.restore();
        }
        if (fade > 0) confettiRaf = requestAnimationFrame(frame);
        else c2d.clearRect(0, 0, w, h);
      };
      confettiRaf = requestAnimationFrame(frame);
    },

    shake(el) {
      if (!el) return;
      const d = 8;
      el.animate(
        [
          { transform: 'translateX(0)' },
          { transform: `translateX(-${d}px)` },
          { transform: `translateX(${d}px)` },
          { transform: `translateX(-${d / 2}px)` },
          { transform: 'translateX(0)' },
        ],
        { duration: 360, easing: 'ease-in-out' },
      );
    },

    pop(el) {
      if (!el) return;
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], {
        duration: 280,
        easing: 'ease-out',
      });
    },

    /** なかまがジャンプ（power が大きいほど 高く。3 からは くるっと回る） */
    hop(els, power = 1) {
      const jump = 18 + Math.min(power, 4) * 7;
      els.forEach((el, i) => {
        const tilt = (i % 2 ? 1 : -1) * (6 + power * 3);
        const spin = power >= 3 && i % 2 === 0 ? 360 : 0;
        el.animate(
          [
            { transform: 'translateY(0) rotate(0deg) scale(1)' },
            { transform: `translateY(4px) scale(1.15, 0.85)`, offset: 0.15 },
            { transform: `translateY(-${jump}px) rotate(${tilt + spin / 2}deg) scale(0.95, 1.1)`, offset: 0.5 },
            { transform: `translateY(0) rotate(${spin}deg) scale(1)` },
          ],
          { duration: 460 + power * 40, delay: i * 55, easing: 'cubic-bezier(.3,1.4,.5,1)' },
        );
      });
    },

    /** 数字をカウントアップ */
    countUp(el, from, to, ms = 700) {
      if (!el) return;
      if (from === to) {
        el.textContent = withCommas(to);
        return;
      }
      const start = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - start) / ms);
        const eased = 1 - (1 - k) ** 3;
        el.textContent = withCommas(from + (to - from) * eased);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },

    centerOf,
  };
  return fx;
}
