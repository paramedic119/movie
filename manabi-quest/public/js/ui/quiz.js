// クイズ画面：1問ずつ出して、正解ならコインと演出、まちがいなら解説を出す

import { $, $$, esc, md, onAct } from './dom.js';
import { createHissan } from './hissan.js';
import { figureSvg } from './figure.js';
import { openModal, toast } from './modal.js';
import { normalizeNumber, groupBy4, withCommas } from '../lib/numfmt.js';
import { plainText } from '../lib/markup.js';
import { coinsForAnswer, comboMultiplier, comboTier, COMBO_TIERS, FEVER_COMBO, chestFor, GOLDEN_MULT, starsFor, STAGE_INFO, nextExStage } from '../game/rewards.js';
import { recordAnswer, recordStage, addCoins, dateKey } from '../game/state.js';
import { missionsOnAnswer, missionsOnStage, stampDay } from '../game/missions.js';
import { friendById, unlockSecretFriends } from '../game/shop.js';
import { refreshMissions } from './session.js';

const LEVEL_TAG = { 1: 'きほん', 2: 'ひょうじゅん', 3: 'チャレンジ' };
const PRAISE = ['すごい！', 'やったね！', 'そのちょうし！', 'かんぺき！', 'さすが！', 'いいね！', 'ばっちり！'];
const COMFORT = ['おしい！ かいせつを見てみよう', 'だいじょうぶ、つぎはできるよ', 'まちがいは のびるチャンス！', 'ノートに入れたから、あとで ふくしゅうしよう'];
const isEnglish = (s) => /^[\x20-\x7E]+$/.test(s) && /[A-Za-z]/.test(s);
const LAST_ONE_GOAL = { normal: 'EXステージ', ex1: 'EX 2 かいほう', ex2: 'EX 3 かいほう', ex3: 'マスター' };
// 正解したときに なかまが見せる 看板
const SIGN_WORDS = ['せいかい！', 'やったね！', 'すごい！', 'ナイス！', 'ばっちり！', 'さすが！'];
const multText = (m) => m.toFixed(2).replace(/\.?0+$/, '');

export function mountQuiz(root, ctx) {
  const s = ctx.session;
  if (!s) {
    ctx.go('#/');
    return () => {};
  }
  // 答えたあとに「もどる」→「すすむ」で この画面にもどってきたときは、同じ問題に二度答えられないように先へすすめる
  s.index = Math.max(s.index, s.results.length);
  const { fx, sfx, speech, store } = ctx;
  const titleSubject = ctx.subjectMeta(s.subjectId) ?? ctx.subjectMeta('review');
  const crossSubject = s.subjectId === 'review' || s.subjectId === 'daily';
  const friends = [store.state.partner, ...store.state.friends.filter((f) => f !== store.state.partner)].slice(0, 5).map(friendById);

  let q = null;
  let answered = false;
  let usedHint = false;
  let hissan = null;
  let fields = null; // { values: string[], active: number }
  let mounted = true;
  let shownAt = 0; // 問題を出した時刻（連打で次の問題に答えてしまわないように）
  const tooSoon = () => performance.now() - shownAt < 280;
  // 少しあとに動かす処理（画面をはなれたら取り消す）
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  root.innerHTML = `
    <section class="quiz" style="--c:${titleSubject.color};--l:${titleSubject.light}">
      <div class="quiz-top">
        <button class="icon-btn" data-act="quit" aria-label="やめる">✕</button>
        <div class="quiz-title">
          <span class="subj-pill">${titleSubject.emoji} ${esc(titleSubject.name)}</span>
          <span class="quiz-unit">${md(s.unitTitle)}</span>
        </div>
        <div class="coin-pill" id="quiz-coins"><span class="coin" aria-hidden="true"></span><b>${withCommas(store.state.coins)}</b></div>
      </div>
      <div class="quiz-status">
        <span class="stage-tag stage-tag--${s.stageKind}">${STAGE_INFO[s.stageKind].label}</span>
        <ol class="dots" aria-label="すすみぐあい"></ol>
        <span class="score-pill ok">せいかい <b id="ok-n">0</b></span>
        <span class="score-pill ng">ミス <b id="ng-n">0</b></span>
      </div>
      <div class="cheer">
        <div class="cheer__friends">${friends.map((f) => `<span class="cheer__f" title="${esc(f.name)}">${f.emoji}</span>`).join('')}</div>
        <div class="cheer__bubble" id="bubble" aria-live="polite">${s.combo >= FEVER_COMBO ? `フィーバー つづいてるよ！ ${s.combo}れんぞく中！` : s.stageKind.startsWith('ex') ? 'EXステージだ！ おちついていこう！' : 'がんばれ！'}</div>
      </div>
      <div class="combo" id="combo" aria-live="polite"></div>
      <div class="qcard" id="qcard"></div>
      <div class="answer" id="answer"></div>
      <div class="feedback" id="feedback" hidden></div>
    </section>`;

  const $card = $('#qcard', root);
  const $answer = $('#answer', root);
  const $feedback = $('#feedback', root);
  const $bubble = $('#bubble', root);
  const $coinPill = $('#quiz-coins', root);
  const $coinNum = $('#quiz-coins b', root);

  const say = (text) => {
    $bubble.textContent = text;
    fx.pop($bubble);
  };

  function subjectOf(question) {
    return ctx.subjectMeta(question.subject) ?? titleSubject;
  }

  function renderStatus() {
    const dots = s.questions
      .map((_, i) => {
        const r = s.results[i];
        const cls = r ? (r.correct ? 'ok' : 'ng') : i === s.index ? 'now' : '';
        // ゴールデン問題は、出てくるまで ひみつ
        const gold = r ? r.golden : i === s.index && isGolden();
        return `<li class="${cls} ${gold ? 'gold' : ''}">${r?.correct ? '★' : ''}</li>`;
      })
      .join('');
    $('.dots', root).innerHTML = dots;
    $('#ok-n', root).textContent = s.results.filter((r) => r.correct).length;
    $('#ng-n', root).textContent = s.results.filter((r) => !r.correct).length;
    const $combo = $('#combo', root);
    const tier = comboTier(s.combo);
    if (s.combo >= 2) {
      const label = tier >= 2 ? ` <em>${COMBO_TIERS[tier - 1].label}</em>` : '！';
      $combo.innerHTML = `🔥 <b>${s.combo}</b> れんぞく${label} <span>コイン ×${comboMultiplier(s.combo + 1).toFixed(2).replace(/\.?0+$/, '')}</span>`;
      $combo.classList.add('on');
    } else {
      $combo.classList.remove('on');
    }
    $combo.dataset.tier = String(tier);
    const $quiz = root.querySelector('.quiz');
    $quiz.classList.toggle('fever', s.combo >= FEVER_COMBO);
    $quiz.dataset.tier = String(tier);
    document.body.classList.toggle('fever-on', s.combo >= FEVER_COMBO);
  }

  /** いまの問題が ゴールデン問題か */
  function isGolden() {
    return s.golden === s.index;
  }

  /** 全問せいかいまで あと1問のとき（それまで ぜんぶ せいかい） */
  function isLastChance() {
    const n = s.questions.length;
    return n >= 3 && s.index === n - 1 && s.results.length === s.index && s.results.every((r) => r.correct);
  }

  // ---------- 問題カード ----------

  function speakText() {
    return q.speak ?? null;
  }

  function needsTextFallback() {
    if (!q.speak || speech.available()) return false;
    return plainText(q.big ?? '') !== q.speak && !plainText(q.q).includes(q.speak);
  }

  function renderCard() {
    const subj = subjectOf(q);
    $card.style.setProperty('--c', subj.color);
    $card.style.setProperty('--l', subj.light);
    const bigClass = subj.id === 'kokugo' ? 'qcard__big kyokasho' : isEnglish(plainText(q.big ?? '')) ? 'qcard__big en' : 'qcard__big';
    const canSpeak = q.speak && speech.available();
    const lastChance = isLastChance();
    const golden = isGolden();
    $card.classList.toggle('qcard--last', lastChance);
    $card.classList.toggle('qcard--golden', golden);
    $card.innerHTML = `
      ${lastChance ? `<div class="last-one" role="status"><b>ラスト1問！</b> あと1問で ${esc(LAST_ONE_GOAL[s.stageKind] && s.unitId ? LAST_ONE_GOAL[s.stageKind] : 'パーフェクト')}！</div>` : ''}
      <div class="qcard__head">
        <span class="level-tag lv${q.level}">${LEVEL_TAG[q.level] ?? ''}</span>
        ${golden ? `<span class="golden-tag">✨ ゴールデン <b>コイン×${GOLDEN_MULT}</b></span>` : ''}
        ${crossSubject ? `<span class="subj-mini" style="--c:${subj.color}">${subj.emoji} ${esc(subj.name)}</span>` : ''}
        ${q.hint || q.kind === 'hissan' ? '<button class="hint-btn" data-act="hint">💡 ヒント</button>' : ''}
      </div>
      <div class="qcard__q">${md(q.q)}</div>
      ${q.big ? `<div class="${bigClass}" ${subj.id === 'eigo' && isEnglish(plainText(q.big)) ? 'lang="en"' : ''}>${md(q.big)}</div>` : ''}
      ${canSpeak ? '<button class="speak-btn" data-act="speak">🔊 もういちど きく</button>' : ''}
      ${needsTextFallback() ? `<div class="qcard__big en" lang="en">${esc(q.speak)}</div><p class="note">（この きかいでは 読み上げが 使えないので、文字で 出しているよ）</p>` : ''}
      ${q.figure ? `<div class="qcard__figure">${figureSvg(q.figure)}</div>` : ''}
      <div class="qcard__hint" id="hint" hidden></div>
      ${q.kind === 'input' ? '<div class="fields" id="fields"></div>' : ''}
      ${q.kind === 'hissan' ? '<div class="hissan-wrap" id="hissan"></div>' : ''}
    `;
    if (canSpeak) later(() => speech.speak(speakText()), 350);
  }

  function renderFields() {
    const host = $('#fields', $card);
    if (!host) return;
    host.innerHTML = q.fields
      .map((f, i) => {
        const v = fields.values[i];
        const shown = v === '' ? '' : f.group4 ? groupBy4(v) : v;
        const active = !answered && i === fields.active;
        return `<button type="button" class="field ${active ? 'active' : ''}" data-act="field" data-i="${i}" aria-label="${esc(f.label || 'こたえ')} ${esc(v || 'みにゅうりょく')}">
          ${f.label ? `<span class="field__label">${esc(f.label)}</span>` : ''}
          <span class="field__box ${f.group4 ? 'wide' : ''}">${esc(shown)}${active ? '<i class="caret"></i>' : ''}</span>
          ${f.suffix ? `<span class="field__suffix">${esc(f.suffix)}</span>` : ''}
        </button>`;
      })
      .join('');
  }

  // ---------- 答えるところ ----------

  function renderChoices() {
    const texts = q.choices.map((c) => plainText(c));
    const long = texts.some((t) => [...t].length > 9);
    const emojiOnly = texts.every((t) => /^\p{Extended_Pictographic}/u.test(t) && [...t].length <= 3);
    const english = subjectOf(q).id === 'eigo';
    const sayable = english && speech.available();
    $answer.innerHTML = `<div class="choices ${long ? 'choices--list' : 'choices--grid'} ${emojiOnly ? 'choices--emoji' : ''} ${subjectOf(q).id === 'kokugo' && q.kanjiQuiz ? 'choices--kanji' : ''}">
      ${q.choices
        .map((c, i) => {
          const eng = sayable && isEnglish(texts[i]);
          return `<div class="choice-wrap">
            <button type="button" class="choice" data-act="choice" data-i="${i}">
              <span class="choice__no" aria-hidden="true">${i + 1}</span>
              <span class="choice__text ${isEnglish(texts[i]) ? 'en' : ''}" ${english && isEnglish(texts[i]) ? 'lang="en"' : ''}>${md(c)}</span>
            </button>
            ${eng ? `<button type="button" class="choice-say" data-act="say" data-i="${i}" aria-label="${esc(texts[i])} を読み上げる">🔊</button>` : ''}
          </div>`;
        })
        .join('')}
    </div>`;
  }

  function renderKeypad() {
    const decimal = q.kind === 'input' && q.fields.some((f) => f.decimal);
    const hs = q.kind === 'hissan';
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];
    $answer.innerHTML = `<div class="keypad ${hs ? 'keypad--hissan' : ''}">
      ${keys.map((k) => `<button type="button" class="key" data-act="key" data-k="${k}">${k}</button>`).join('')}
      ${
        hs
          ? `<button type="button" class="key key--zero-wide" data-act="key" data-k="0">0</button>`
          : `<button type="button" class="key ${decimal ? '' : 'key--ghost'}" data-act="key" data-k="." ${decimal ? '' : 'disabled aria-hidden="true"'}>.</button>
             <button type="button" class="key" data-act="key" data-k="0">0</button>
             <button type="button" class="key key--back" data-act="key" data-k="back" aria-label="1文字けす">⌫</button>
             <button type="button" class="key key--ok" data-act="submit">こたえる！</button>`
      }
    </div>`;
  }

  function showQuestion() {
    q = s.questions[s.index];
    shownAt = performance.now();
    answered = false;
    usedHint = false;
    hissan = null;
    $feedback.hidden = true;
    $feedback.innerHTML = '';
    root.querySelector('.quiz').classList.remove('answered', 'intro');
    renderStatus();
    renderCard();
    const golden = isGolden();
    if (golden) {
      // ゴールデン問題が あらわれた！（下のボタンは そのまま押せる）
      sfx.golden();
      if (ctx.effectsLevel() !== 'calm') {
        later(() => fx.banner('ゴールデン問題！', { sub: `せいかいで コイン ×${GOLDEN_MULT}`, variant: 'golden', duration: 650, pass: true }), 100);
        later(() => {
          const g = fx.centerOf($card);
          fx.shockwave(g.x, g.y, { size: 1.4 });
          fx.streamers(3);
        }, 150);
      }
    }
    if (isLastChance()) {
      if (golden) later(() => sfx.drumroll(), 650);
      else sfx.drumroll();
      say(golden ? 'ラスト1問は ゴールデン！ おちついて いこう！' : 'ラスト1問！ おちついて いこう！');
    } else if (golden) {
      say(`ゴールデン問題だ！ せいかいで コイン${GOLDEN_MULT}ばい！`);
    }
    if (q.kind === 'choice') {
      renderChoices();
    } else {
      renderKeypad();
      if (q.kind === 'input') {
        fields = { values: q.fields.map(() => ''), active: 0 };
        renderFields();
      } else {
        hissan = createHissan($('#hissan', $card), q.hissan, {
          hintMode: s.stageKind === 'normal' && q.level === 1 ? 'auto' : 'onError',
          onDigit: (result, el) => {
            if (result === 'ok' || result === 'fixed') {
              sfx.digit();
              if (el && result === 'ok') {
                const c = fx.centerOf(el);
                fx.burst(c.x, c.y, { count: ctx.effectsLevel() === 'calm' ? 0 : 6 });
                // 答えの数字が 大きく出て マスに すいこまれる
                fx.digitPop(el, el.textContent.trim());
                fx.hop($$('.cheer__f', root).slice(0, 2));
              }
            } else {
              sfx.wrong();
              fx.shake(el);
              say(q.hissan.op === '+' ? 'くり上がりに 気をつけてね' : 'くり下がりに 気をつけてね');
            }
          },
          onComplete: ({ correct }) => submit(correct, q.hissan.result),
        });
      }
    }
    // カードが ななめに とびこんでくる（ステージの1問目は 大きく）
    if ($card.animate) fx.flyIn($card, { strong: s.index === 0 });
  }

  // ---------- 答え合わせ ----------

  function answerText() {
    if (q.kind === 'choice') return q.answer;
    if (q.kind === 'hissan') return q.answer;
    return q.fields.map((f) => `${f.label ? `${f.label} ` : ''}${f.group4 ? groupBy4(f.answer) : f.answer}${f.suffix ?? ''}`).join('、');
  }

  function submit(correct, given) {
    if (answered) return;
    answered = true;
    const now = ctx.now();
    const prevCombo = s.combo;
    const golden = isGolden();
    s.combo = correct ? s.combo + 1 : 0;
    s.maxCombo = Math.max(s.maxCombo, s.combo);
    const coins = correct ? coinsForAnswer({ stageKind: s.stageKind, combo: s.combo, usedHint, golden }) : 0;
    const before = store.state.coins;
    const tierUp = correct && comboTier(s.combo) > comboTier(prevCombo);
    const feverEnded = !correct && prevCombo >= FEVER_COMBO;
    let reviewResult = 'none';
    let missions = [];
    refreshMissions(ctx); // 夜の12時をこえて答えたときは、あたらしい日のミッションに数える
    store.update((st) => {
      reviewResult = recordAnswer(st, q, correct, now);
      addCoins(st, coins, now);
      missions = missionsOnAnswer(st, now, { stageKind: s.stageKind, correct, combo: s.combo, golden, subject: q.subject, fromNotebook: Boolean(q.fromNotebook) });
    });
    if (reviewResult === 'mastered') s.mastered.push(q);
    s.results.push({ q, correct, coins, given, usedHint, golden });
    missionCleared(missions);
    s.stageCoins += coins;
    root.querySelector('.quiz').classList.add('answered');
    renderStatus();

    const c = fx.centerOf($card);
    fx.pop($(`.dots li:nth-child(${s.results.length})`, root));
    if (correct) {
      // この問題で ステージが パーフェクト（3問以上）
      const perfectFinish = s.results.length === s.questions.length && s.questions.length >= 3 && s.results.every((r) => r.correct);
      sfx.correct(s.combo);
      fx.ring(c.x, c.y);
      fx.burst(c.x, c.y);
      fx.shockwave(c.x, c.y);
      fx.bounce($card);
      // 「+15」「コンボ ×1.5」「ゴールデン ×3」の ふきだしが 次々に ポン
      const pops = [[`+${coins}`, 'coin']];
      if (s.combo >= 2) pops.push([`コンボ ×${multText(comboMultiplier(s.combo))}`, 'combo']);
      if (golden) pops.push([`ゴールデン ×${GOLDEN_MULT}`, 'gold']);
      pops.forEach(([text, variant], i) => fx.scorePop(c.x, c.y - 20 - i * 40, text, { variant, delay: i * 140, dx: (i % 2 ? 40 : -30) * Math.min(1, pops.length - 1) }));
      fx.hop($$('.cheer__f', root), 1 + Math.floor(Math.min(s.combo, 9) / 3));
      let started = false;
      fx.coins($card, $coinPill, coins, (i) => {
        sfx.coin(i);
        if (!started) {
          started = true;
          fx.countUp($coinNum, before, store.state.coins, 500);
          fx.pop($coinPill);
        }
      });
      const tier = comboTier(s.combo);
      const bigMoment = golden || perfectFinish || (tierUp && tier >= 2);
      if (!(tierUp && tier >= 2) || perfectFinish) {
        // なかまが 上から ぶらさがって 看板を見せる（フィーバーの帯と重なるときは パーフェクトのときだけ）
        const text = golden ? 'ゴールデン！' : perfectFinish ? 'パーフェクト！' : s.combo >= 2 ? `${s.combo}れんぞく！` : SIGN_WORDS[Math.floor(Math.random() * SIGN_WORDS.length)];
        const variant = golden ? 'gold' : perfectFinish || s.combo >= FEVER_COMBO ? 'rainbow' : '';
        fx.sign(text, { emoji: friends[0].emoji, variant });
      }
      // リボンが ビュン（れんぞく正解・大きな できごと。「にぎやか」では いつも）
      if (s.combo >= 3 || bigMoment || ctx.effectsLevel() === 'exciting') later(() => fx.streamers(), 120);
      if (bigMoment) {
        later(() => fx.fountain(c.x, c.y), 200);
        if (tierUp && tier >= 2) fx.sunburst(1400);
      }
      if (tierUp && tier >= 2) {
        // フィーバー！ など：画面をよこぎる帯（下のボタンはそのまま押せる）
        later(() => {
          sfx.fever();
          if (ctx.effectsLevel() !== 'calm') {
            fx.banner(COMBO_TIERS[tier - 1].label, { sub: `${s.combo} れんぞく せいかい！`, variant: 'fever', duration: 700, pass: true });
          }
          if (ctx.effectsLevel() === 'exciting') fx.confetti(900);
        }, 280);
        say(`${s.combo}れんぞく！ ${COMBO_TIERS[tier - 1].label}`);
      } else if (s.combo >= 3) {
        later(() => sfx.combo(s.combo), 250);
        say(`${s.combo}れんぞく！ ${PRAISE[s.combo % PRAISE.length]}`);
      } else {
        say(PRAISE[Math.floor(Math.random() * PRAISE.length)]);
      }
      if (golden) {
        // ゴールデン問題に せいかい！ 大当たりの演出
        later(() => sfx.jackpot(), 150);
        fx.burst(c.x, c.y);
        if (ctx.effectsLevel() !== 'calm') fx.confetti(700);
        if (!tierUp) say(`ゴールデン せいかい！ コイン${GOLDEN_MULT}ばい！`);
      }
    } else {
      sfx.wrong();
      fx.shake($card);
      say(feverEnded ? 'フィーバーは ここまで。また つなごう！' : golden ? 'ゴールデンは また こんど！ かいせつを 見てみよう' : COMFORT[Math.floor(Math.random() * COMFORT.length)]);
    }
    showFeedback(correct, coins, reviewResult, golden);
  }

  /** ミッションを クリアしたら、じゃまにならないように 下にお知らせ */
  function missionCleared(list) {
    if (!list.length) return;
    s.missionsDone.push(...list.map((m) => ({ ...m })));
    later(() => {
      sfx.mission();
      toast('🎯 ミッション クリア！');
    }, 900);
  }

  function showFeedback(correct, coins, reviewResult, golden = false) {
    const extra =
      (correct && golden ? `<div class="feedback__badge feedback__badge--golden">✨ ゴールデン ボーナス！ コイン ×${GOLDEN_MULT}</div>` : '') +
      (reviewResult === 'mastered'
        ? '<div class="feedback__badge">🎉 この問題を「おぼえた！」</div>'
        : reviewResult === 'up'
          ? '<div class="feedback__badge">📒 ふくしゅう 1だんかいアップ！</div>'
          : '');
    $feedback.className = `feedback ${correct ? 'feedback--ok' : 'feedback--ng'}`;
    $feedback.innerHTML = `
      <div class="feedback__head">
        <span class="feedback__mark" aria-hidden="true">${correct ? '⭕' : '❌'}</span>
        <b>${correct ? 'せいかい！' : 'おしい！'}</b>
        ${correct ? `<span class="feedback__coins"><span class="coin" aria-hidden="true"></span>+${coins}</span>` : ''}
      </div>
      ${correct ? '' : `<div class="feedback__answer">こたえ：<b>${md(answerText())}</b></div>`}
      ${extra}
      <div class="feedback__explain">💡 ${md(q.explain)}</div>
      <button type="button" class="btn btn--primary btn--big" data-act="next">${s.index + 1 >= s.questions.length ? 'けっかを見る ▶' : 'つぎへ ▶'}</button>
    `;
    $feedback.hidden = false;
    if (q.kind === 'choice') markChoices();
    renderFieldsIfAny();
    later(() => $('[data-act="next"]', $feedback)?.focus({ preventScroll: true }), 50);
  }

  function renderFieldsIfAny() {
    if (q.kind === 'input') renderFields();
  }

  function markChoices() {
    $$('.choice', $answer).forEach((btn) => {
      const i = Number(btn.dataset.i);
      btn.disabled = true;
      if (q.choices[i] === q.answer) btn.classList.add('is-answer');
    });
  }

  // ---------- 入力 ----------

  function pressKey(k) {
    if (answered || tooSoon()) return;
    if (q.kind === 'hissan') {
      if (/^\d$/.test(k)) hissan.input(k);
      return;
    }
    if (q.kind !== 'input') return;
    const f = q.fields[fields.active];
    let v = fields.values[fields.active];
    if (k === 'back') v = v.slice(0, -1);
    else if (k === '.') {
      if (f.decimal && !v.includes('.')) v = `${v || '0'}.`;
    } else if (/^\d$/.test(k) && v.replace('.', '').length < 16) {
      v = v === '0' ? k : v + k;
    }
    fields.values[fields.active] = v;
    sfx.tap();
    renderFields();
  }

  function submitInput() {
    if (answered || q.kind !== 'input') return;
    const empty = fields.values.findIndex((v) => v === '' || v === '.');
    if (empty >= 0) {
      fields.active = empty;
      renderFields();
      fx.shake($('#fields', $card));
      say(q.fields[empty].label ? `「${q.fields[empty].label}」も 入れてね` : 'こたえを 入れてね');
      return;
    }
    const correct = q.fields.every((f, i) => normalizeNumber(fields.values[i]) === normalizeNumber(f.answer));
    submit(correct, fields.values.join(' / '));
  }

  function choose(i) {
    if (answered || tooSoon()) return;
    const btn = $(`.choice[data-i="${i}"]`, $answer);
    const correct = q.choices[i] === q.answer;
    btn?.classList.add(correct ? 'is-correct' : 'is-wrong');
    submit(correct, q.choices[i]);
  }

  function next() {
    if (!answered) return;
    speech.cancel();
    s.index += 1;
    if (s.index >= s.questions.length) finish();
    else showQuestion();
  }

  function finish() {
    const now = ctx.now();
    const correct = s.results.filter((r) => r.correct).length;
    const total = s.results.length;
    const stars = starsFor(correct, total);
    const perfect = total > 0 && correct === total;
    const goldenHit = s.results.some((r) => r.golden && r.correct);
    // ステージの たからばこ（★の数で ランクが決まり、ゴールデン問題に せいかいすると 1つ上がる）
    let chest = chestFor({ stageKind: s.stageKind, correct, total, goldenHit });
    let rec = { newStars: false, newEx: false };
    let newFriends = [];
    let dailyFirst = false;
    let stamp = null;
    let stageMissions = [];
    refreshMissions(ctx);
    store.update((st) => {
      if (s.stageKind === 'daily') {
        // きょうの5教科の たからばこは 1日1回（全問せいかいしたとき）
        const today = dateKey(now);
        dailyFirst = perfect && !(st.daily.date === today && st.daily.cleared);
        if (!dailyFirst) chest = { rank: 0, coins: 0, steps: [] };
        if (dailyFirst) st.daily = { date: today, cleared: true };
      }
      rec = recordStage(st, { unitId: s.unitId, stageKind: s.stageKind, correct, total, stars });
      addCoins(st, chest.coins, now);
      // ステージをクリア（★1つ以上）した日には、がんばりスタンプ
      if (stars >= 1 && s.stageKind !== 'revenge') stamp = stampDay(st, now);
      stageMissions = missionsOnStage(st, now, {
        stageKind: s.stageKind,
        stars,
        perfect,
        subject: ['review', 'daily'].includes(s.subjectId) ? '' : s.subjectId,
        furikaeri: Boolean(s.unitId && ctx.unitById(s.unitId)?.grade),
      });
      newFriends = unlockSecretFriends(st, ctx.friendCtx());
    });
    const bonus = chest.coins;
    s.chainCoins += s.stageCoins + bonus;
    ctx.lastResult = {
      subjectId: s.subjectId,
      unitId: s.unitId,
      homeUnitId: s.homeUnitId,
      unitTitle: s.unitTitle,
      stageKind: s.stageKind,
      correct,
      total,
      stars,
      stageCoins: s.stageCoins,
      bonus,
      chest,
      goldenHit,
      stamp,
      missionsDone: [...s.missionsDone, ...stageMissions.map((m) => ({ ...m }))],
      maxCombo: s.maxCombo,
      results: s.results,
      mastered: s.mastered,
      newStars: rec.newStars,
      newEx: rec.newEx,
      newFriends,
      dailyFirst,
      nextEx: perfect && s.unitId ? nextExStage(s.stageKind) : null,
      chain: perfect ? { combo: s.combo, maxCombo: s.maxCombo, chainCoins: s.chainCoins, used: s.used } : null,
      chainCoins: s.chainCoins,
      // しょうごうゲージ用：このステージの前と後の「これまでにかせいだコイン」
      earnedBefore: s.startEarned ?? store.state.totalEarned,
      earnedAfter: store.state.totalEarned,
    };
    ctx.session = null;
    ctx.go('#/result');
  }

  async function quit() {
    const ok = await openModal({
      title: 'とちゅうで やめる？',
      body: '<p>ここまでに もらったコインは そのままだよ。</p>',
      actions: [
        { label: 'つづける', value: false, variant: 'primary' },
        { label: 'やめる', value: true, variant: 'plain' },
      ],
      dismissValue: false,
    });
    if (!ok) return;
    speech.cancel();
    ctx.session = null;
    const unitId = s.homeUnitId;
    const unit = unitId ? ctx.unitById(unitId) : null;
    ctx.go(unit ? `#/subject/${unit.subject}` : s.subjectId === 'review' ? '#/note' : '#/');
  }

  function hint() {
    if (answered) return;
    usedHint = true;
    if (q.kind === 'hissan') {
      const had = hissan.revealHint();
      say(had ? '小さい数字を見てね（コインは半分になるよ）' : 'このけたは くり上がり・くり下がりなし！');
    } else {
      const el = $('#hint', $card);
      el.innerHTML = `💡 ${md(q.hint)}`;
      el.hidden = false;
      say('ヒントを使うと コインは半分だよ');
    }
    $('[data-act="hint"]', $card)?.setAttribute('disabled', '');
  }

  const offAct = onAct(root, {
    quit,
    choice: (el) => choose(Number(el.dataset.i)),
    say: (el) => speech.speak(plainText(q.choices[Number(el.dataset.i)])),
    speak: () => speech.speak(speakText()),
    key: (el) => pressKey(el.dataset.k),
    submit: submitInput,
    field: (el) => {
      if (answered) return;
      fields.active = Number(el.dataset.i);
      renderFields();
    },
    next,
    hint,
  });

  const onKey = (e) => {
    if (!q || document.querySelector('.modal')) return;
    if (e.key === 'Escape') return quit();
    if (answered) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        next();
      }
      return;
    }
    if (q.kind === 'choice') {
      const n = Number(e.key);
      if (n >= 1 && n <= q.choices.length) choose(n - 1);
      return;
    }
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === '.' || e.key === ',') pressKey('.');
    else if (e.key === 'Backspace') pressKey('back');
    else if (e.key === 'Enter') submitInput();
    else if (e.key === 'Tab' && q.kind === 'input' && q.fields.length > 1) {
      e.preventDefault();
      fields.active = (fields.active + 1) % q.fields.length;
      renderFields();
    }
  };
  document.addEventListener('keydown', onKey);
  // 読み上げが使えないとわかったら、英語を文字で出しなおす
  const offSpeechFail = speech.onFail(() => {
    if (q && !answered && q.speak && q.kind === 'choice') {
      renderCard();
      renderChoices();
    }
  });

  // テスト用：いまの問題の答えを外から見られるようにする（?debug のときだけ）
  if (ctx.debug) {
    globalThis.__mqQuiz = {
      /** 答えられる状態になったら問題を返す（出した直後の連打よけの時間は null） */
      get question() {
        return tooSoon() ? null : q;
      },
      get answered() {
        return answered;
      },
    };
  }

  renderStatus();
  if (s.index >= s.questions.length) {
    finish();
  } else if (s.stageKind.startsWith('ex') && s.results.length === 0 && ctx.effectsLevel() !== 'calm') {
    // EXステージに入るときのカットイン（タップでとばせる）。終わったら1問目を出す
    sfx.whoosh();
    later(() => sfx.ex(), 300);
    const info = STAGE_INFO[s.stageKind];
    root.querySelector('.quiz').classList.add('intro');
    // うしろで ひかりの線が まわり、ふうせんが のぼって、リボンが とぶ
    fx.sunburst(1900);
    fx.balloons();
    later(() => fx.streamers(4), 200);
    fx.banner(info.label, { sub: `EXTRA STAGE・コイン ×${info.mult}`, variant: 'ex', duration: 900 }).then(() => {
      if (mounted) showQuestion();
    });
  } else {
    showQuestion();
  }

  return () => {
    mounted = false;
    offAct();
    offSpeechFail();
    document.removeEventListener('keydown', onKey);
    timers.forEach(clearTimeout);
    fx.clearBanners();
    document.body.classList.remove('fever-on');
    speech.cancel();
    if (ctx.debug) delete globalThis.__mqQuiz;
  };
}
