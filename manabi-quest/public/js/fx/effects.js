// 演出（コイン・キラキラ・紙ふぶき・バナー）
// 演出の強さは設定で「おだやか / ふつう / にぎやか」を選べる。
// 「おだやか」では動きの大きい演出を出さない（OS の「視差効果を減らす」設定の人も最初はこれ）。

import { withCommas } from '../lib/numfmt.js';

const LEVELS = {
  calm: { particles: 0, coins: 0, confetti: 0, ring: false },
  normal: { particles: 14, coins: 6, confetti: 70, ring: true },
  exciting: { particles: 26, coins: 12, confetti: 150, ring: true },
};

const SHAPES = ['★', '●', '♥', '✦', '▲'];
const COLORS = ['#ff5d8f', '#ffc300', '#2f8dff', '#1fb574', '#8a63ff', '#ff8a1f'];

const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

export function createFx({ layer, getLevel }) {
  const cfg = () => LEVELS[getLevel()] ?? LEVELS.normal;
  const add = (el) => {
    layer.appendChild(el);
    return el;
  };
  const done = (anim, el) => {
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
    return anim;
  };

  let canvas = null;
  let confettiRaf = 0;

  const fx = {
    /** キラキラがはじける */
    burst(x, y, { count } = {}) {
      const n = count ?? cfg().particles;
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
      if (!cfg().ring) return;
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
      const calm = getLevel() === 'calm';
      done(
        el.animate(
          [
            { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
            { transform: 'translate(-50%,-90%) scale(1.15)', opacity: 1, offset: 0.25 },
            { transform: `translate(-50%,${calm ? '-110%' : '-220%'}) scale(1)`, opacity: 0 },
          ],
          { duration: calm ? 900 : 1100, easing: 'ease-out' },
        ),
        el,
      );
    },

    /** コインが上のコイン表示へ飛んでいく。onEach は1まいとどくごとに呼ばれる */
    coins(fromEl, toEl, amount, onEach = () => {}) {
      const n = Math.min(cfg().coins, Math.max(1, Math.ceil(amount / 8)));
      if (!fromEl || !toEl || n === 0) {
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
    banner(text, { sub = '', variant = 'ex', duration = 1300 } = {}) {
      const el = add(document.createElement('div'));
      el.className = `fx-banner fx-banner--${variant}`;
      el.innerHTML = `<div class="fx-banner__strip"><span class="fx-banner__text"></span><span class="fx-banner__sub"></span></div>`;
      el.querySelector('.fx-banner__text').textContent = text;
      el.querySelector('.fx-banner__sub').textContent = sub;
      const strip = el.firstElementChild;
      const calm = getLevel() === 'calm';
      const frames = calm
        ? [
            { opacity: 0, transform: 'translateY(-50%) scale(0.96)' },
            { opacity: 1, transform: 'translateY(-50%) scale(1)', offset: 0.15 },
            { opacity: 1, transform: 'translateY(-50%) scale(1)', offset: 0.85 },
            { opacity: 0, transform: 'translateY(-50%) scale(1)' },
          ]
        : [
            { transform: 'translate(-120%, -50%) rotate(-6deg)' },
            { transform: 'translate(4%, -50%) rotate(-6deg)', offset: 0.18 },
            { transform: 'translate(0, -50%) rotate(-6deg)', offset: 0.26 },
            { transform: 'translate(0, -50%) rotate(-6deg)', offset: 0.8 },
            { transform: 'translate(120%, -50%) rotate(-6deg)' },
          ];
      const anim = strip.animate(frames, { duration: duration + 500, easing: 'ease-in-out', fill: 'forwards' });
      return new Promise((resolve) => {
        const finish = () => {
          el.remove();
          resolve();
        };
        anim.onfinish = finish;
        anim.oncancel = finish;
        el.addEventListener('click', () => anim.finish(), { once: true });
      });
    },

    /** 紙ふぶき */
    confetti(ms = 1800) {
      const n = cfg().confetti;
      if (!n) return;
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
      const d = getLevel() === 'calm' ? 3 : 8;
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
      if (!el || getLevel() === 'calm') return;
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.25)' }, { transform: 'scale(1)' }], {
        duration: 280,
        easing: 'ease-out',
      });
    },

    /** なかまがジャンプ */
    hop(els) {
      if (getLevel() === 'calm') return;
      els.forEach((el, i) =>
        el.animate(
          [{ transform: 'translateY(0)' }, { transform: 'translateY(-18px) rotate(-6deg)' }, { transform: 'translateY(0)' }],
          { duration: 420, delay: i * 60, easing: 'cubic-bezier(.3,1.6,.5,1)' },
        ),
      );
    },

    /** 数字をカウントアップ */
    countUp(el, from, to, ms = 700) {
      if (!el) return;
      if (getLevel() === 'calm' || from === to) {
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
