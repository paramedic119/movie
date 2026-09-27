// まなびクエスト：アプリの起動と画面の切りかえ

import { SUBJECTS, subjectById, loadAllSubjects } from './data/subjects.js';
import { createStore, pruneDays } from './game/state.js';
import { createPlaytime } from './game/playtime.js';
import { createRng } from './lib/rng.js';
import { withCommas } from './lib/numfmt.js';
import { createFx } from './fx/effects.js';
import { sfx } from './fx/sound.js';
import { speech } from './fx/speech.js';
import { toast } from './ui/modal.js';
import { minutesText } from './ui/dom.js';
import { mountHome } from './ui/home.js';
import { mountSubject } from './ui/subject.js';
import { mountQuiz } from './ui/quiz.js';
import { mountResult } from './ui/result.js';
import { mountNote } from './ui/note.js';
import { mountFriends } from './ui/friends.js';
import { mountParent } from './ui/parent.js';
import { mountRest } from './ui/rest.js';

const ROUTES = {
  '': { mount: mountHome, tab: 'home' },
  subject: { mount: mountSubject, tab: 'home' },
  play: { mount: mountQuiz, mode: 'quiz' },
  result: { mount: mountResult, mode: 'result' },
  note: { mount: mountNote, tab: 'note' },
  friends: { mount: mountFriends, tab: 'friends' },
  parent: { mount: mountParent, tab: 'parent', allowWhenTimeUp: true },
  rest: { mount: mountRest, allowWhenTimeUp: true },
};

async function boot() {
  const debug = new URLSearchParams(location.search).has('debug');
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const store = createStore({ reducedMotion });
  pruneDays(store.state, Date.now());

  const screen = document.getElementById('screen');
  const hudCoins = document.getElementById('hud-coin-count');
  const hudTime = document.getElementById('hud-time');
  const tabbar = document.getElementById('tabbar');

  const subjects = await loadAllSubjects();
  const unitIndex = new Map();
  for (const s of Object.values(subjects)) for (const u of s.units) unitIndex.set(u.id, u);

  const ctx = {
    debug,
    store,
    subjects,
    SUBJECTS,
    rng: createRng(),
    now: () => Date.now(),
    session: null,
    lastResult: null,
    sfx,
    speech,
    subjectMeta: (id) => subjectById(id),
    unitById: (id) => unitIndex.get(id),
    effectsLevel: () => store.state.settings.effects,
    friendCtx: () => ({
      subjectIds: SUBJECTS.map((s) => s.id),
      unitIdsBySubject: Object.fromEntries(Object.entries(subjects).map(([id, s]) => [id, s.units.map((u) => u.id)])),
    }),
    go(hash) {
      if (location.hash === hash) render();
      else location.hash = hash;
    },
    applyTheme() {
      document.body.dataset.theme = store.state.theme;
    },
    applySettings() {
      const set = store.state.settings;
      sfx.setEnabled(set.sound);
      speech.setEnabled(set.voice);
      document.body.dataset.effects = set.effects;
      refreshHud();
    },
    refreshHud,
  };
  ctx.fx = createFx({ layer: document.getElementById('fx-layer'), getLevel: () => store.state.settings.effects });

  let warned = false;
  ctx.playtime = createPlaytime({
    store,
    onChange: (status) => {
      updateTime(status);
      if (status.warn && !warned) {
        warned = true;
        toast('⏰ きょうの のこり時間は あと5分だよ');
      }
    },
  });

  function updateTime(status = ctx.playtime.status()) {
    hudTime.textContent = store.state.settings.limitMin ? `⏰ ${minutesText(status.remain)}` : '';
    hudTime.setAttribute('aria-label', `きょうの のこり時間 ${minutesText(status.remain)}`);
    hudTime.hidden = !store.state.settings.limitMin;
  }

  function refreshHud() {
    hudCoins.textContent = withCommas(store.state.coins);
    updateTime();
  }

  let unmount = () => {};
  function parseHash() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const name = parts[0] ?? '';
    const params = {};
    if (name === 'subject') params.id = parts[1];
    if (name === 'friends') params.tab = parts[1];
    return { name: ROUTES[name] ? name : '', params };
  }

  function render() {
    let { name, params } = parseHash();
    const status = ctx.playtime.status();
    // 時間になったら、クイズのとちゅう・けっか画面以外は「きょうはここまで」へ
    if (status.timeUp && !ROUTES[name].allowWhenTimeUp && !['play', 'result'].includes(name)) {
      name = 'rest';
      params = {};
      if (location.hash !== '#/rest') history.replaceState(null, '', '#/rest');
    }
    const route = ROUTES[name];
    unmount();
    screen.innerHTML = '';
    document.body.dataset.mode = route.mode ?? 'normal';
    tabbar.querySelectorAll('[data-tab]').forEach((a) => {
      const on = a.dataset.tab === route.tab;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    refreshHud();
    unmount = route.mount(screen, ctx, params) ?? (() => {});
    window.scrollTo(0, 0);
    screen.focus({ preventScroll: true });
  }

  store.subscribe(() => {
    hudCoins.textContent = withCommas(store.state.coins);
  });

  // 最初のタップで効果音を使えるようにする
  document.addEventListener('pointerdown', () => sfx.unlock(), { once: true, capture: true });

  ctx.applyTheme();
  ctx.applySettings();
  ctx.playtime.start();
  window.addEventListener('hashchange', render);
  render();
  document.body.classList.add('ready');

  if (store.memoryOnly) toast('この ブラウザでは きろくが のこりません（プライベートモードかも）', 5000);
  if (debug) globalThis.__mq = ctx;
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('screen');
  if (el) el.innerHTML = '<div class="card boot-error"><h1>読みこみに失敗しました</h1><p>ページを読みこみなおしてください。</p></div>';
});
