// あそんだ時間をはかる（画面が見えていて、さいきん操作しているときだけ数える）
// ・1日の時間制限（おうちの人が設定）
// ・つづけて遊んだら「ひと休み」のお知らせ

import { dayRecord, remainingSeconds } from './state.js';

const IDLE_MS = 90 * 1000; // 90秒さわっていなければ数えない
const SAVE_EVERY_SEC = 15;
const BREAK_RESET_MS = 5 * 60 * 1000; // 5分以上はなれたら「つづけて遊んだ時間」をリセット

export function createPlaytime({ store, now = () => Date.now(), onChange = () => {} }) {
  let lastActive = now();
  let lastTick = now();
  let continuousSec = 0;
  let unsaved = 0;
  let timer = null;
  let breakShownAt = 0;

  const markActive = () => {
    const t = now();
    if (t - lastActive > BREAK_RESET_MS) {
      continuousSec = 0;
      breakShownAt = 0;
    }
    lastActive = t;
  };

  function tick() {
    const t = now();
    const dt = Math.min(5, Math.max(0, (t - lastTick) / 1000));
    lastTick = t;
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    if (!visible || t - lastActive > IDLE_MS) return;
    const day = dayRecord(store.state, t);
    day.sec += dt;
    continuousSec += dt;
    unsaved += dt;
    if (unsaved >= SAVE_EVERY_SEC) {
      unsaved = 0;
      store.save();
    }
    onChange(api.status());
  }

  const api = {
    start() {
      if (timer) return;
      lastTick = now();
      timer = setInterval(tick, 1000);
      if (typeof document !== 'undefined') {
        ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, markActive, { passive: true }));
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') store.save();
          else lastTick = now();
        });
      }
    },
    stop() {
      clearInterval(timer);
      timer = null;
      store.save();
    },
    markActive,
    status() {
      const t = now();
      const remain = remainingSeconds(store.state, t);
      const breakMin = store.state.settings.breakMin;
      return {
        remain,
        timeUp: remain <= 0,
        warn: remain > 0 && remain <= 5 * 60,
        needBreak: Boolean(breakMin) && continuousSec >= breakMin * 60 && breakShownAt !== Math.floor(continuousSec / (breakMin * 60)),
        continuousSec,
      };
    },
    /** ひと休みのお知らせを出したことを記録（同じ区切りで何度も出さない） */
    breakShown() {
      const breakMin = store.state.settings.breakMin;
      if (breakMin) breakShownAt = Math.floor(continuousSec / (breakMin * 60));
    },
    /** テスト用 */
    _tick: tick,
  };
  return api;
}
