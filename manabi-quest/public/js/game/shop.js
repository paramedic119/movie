// なかま（キャラクター）ときせかえ。コインで買う（くじ引きのような運まかせの仕組みは使わない）

export const FRIENDS = [
  { id: 'pao', emoji: '🐘', name: 'パオ', price: 0, line: 'いっしょにがんばろう！' },
  { id: 'koala', emoji: '🐨', name: 'ユーカ', price: 100, line: 'のんびり、こつこつね。' },
  { id: 'usagi', emoji: '🐰', name: 'ぴょんた', price: 150, line: 'ぴょーんと、レベルアップ！' },
  { id: 'neko', emoji: '🐱', name: 'ミケ', price: 200, line: 'まちがえても、だいじょうぶにゃ。' },
  { id: 'inu', emoji: '🐶', name: 'ポチ', price: 260, line: 'しっぽをふって おうえんするワン！' },
  { id: 'hiyoko', emoji: '🐥', name: 'ピヨ', price: 330, line: 'ピヨピヨ、きょうも1もん！' },
  { id: 'panda', emoji: '🐼', name: 'パンダン', price: 420, line: 'ささをたべて、元気いっぱい！' },
  { id: 'kitsune', emoji: '🦊', name: 'コン', price: 520, line: 'コンコン、よく考えよう。' },
  { id: 'pengin', emoji: '🐧', name: 'ペンタ', price: 640, line: 'すいすい とけるペン！' },
  { id: 'kaeru', emoji: '🐸', name: 'ケロスケ', price: 780, line: 'くり返しが 力になるケロ。' },
  { id: 'hamster', emoji: '🐹', name: 'モグ', price: 940, line: 'ほおぶくろに ちしきをためよう！' },
  { id: 'kuma', emoji: '🐻', name: 'クマキチ', price: 1120, line: 'どっしり、あわてずに。' },
  { id: 'tora', emoji: '🐯', name: 'トラノスケ', price: 1350, line: 'ガオー！ ぜっこうちょう！' },
  { id: 'lion', emoji: '🦁', name: 'ガオ', price: 1600, line: 'ほえるほど、すごいぞ！' },
  { id: 'fukurou', emoji: '🦉', name: 'ホーはかせ', price: 1900, line: 'ホッホー、ものしりになろう。' },
  { id: 'iruka', emoji: '🐬', name: 'キュイ', price: 2250, line: 'ひらめきは、波のように！' },
  { id: 'kirin', emoji: '🦒', name: 'ジラフィ', price: 2650, line: 'せのびして、つぎの問題へ。' },
  { id: 'kujira', emoji: '🐳', name: 'ザブン', price: 3100, line: '大きなゆめを もとう！' },
  { id: 'unicorn', emoji: '🦄', name: 'ユニ', price: 3800, line: 'キラキラの せいかいだね！' },
  { id: 'ryu', emoji: '🐲', name: 'リュウ', price: 4700, line: 'ここまで来たきみは すごい！' },
  { id: 'kyouryu', emoji: '🦕', name: 'ドン', price: 5800, line: 'ずっと つづけてきたね。' },
  { id: 'tyranno', emoji: '🦖', name: 'ガブ', price: 7200, line: 'さいきょうの まなびなかま！' },
];

/** がんばると仲間になる「ひみつのなかま」（コインでは買えない） */
export const SECRET_FRIENDS = [
  {
    id: 'kame',
    emoji: '🐢',
    name: 'カメせんせい',
    how: 'まちがいノートで 10問「おぼえた！」にする',
    line: 'ゆっくりでも、くり返せば おぼえられる。',
    check: (s) => s.mastered >= 10,
  },
  {
    id: 'kujaku',
    emoji: '🦚',
    name: 'クジャクン',
    how: '5教科すべてで ★3 をとる',
    line: 'どの教科も かがやいているよ！',
    check: (s, ctx) => ctx.subjectIds.every((sid) => ctx.unitIdsBySubject[sid]?.some((uid) => (s.units[uid]?.stars ?? 0) >= 3)),
  },
  {
    id: 'hebi',
    emoji: '🐍',
    name: 'ニョロ',
    how: 'EX 3 をクリアして「マスター」を 3つ とる',
    line: 'マスターへの道は、ながーく つづく！',
    check: (s) => Object.values(s.units).filter((u) => u.ex >= 3).length >= 3,
  },
];

export const ALL_FRIENDS = [...FRIENDS, ...SECRET_FRIENDS];
export const friendById = (id) => ALL_FRIENDS.find((f) => f.id === id) ?? FRIENDS[0];

export const THEMES = [
  { id: 'sky', name: 'はれぞら', emoji: '☀️', price: 0 },
  { id: 'sakura', name: 'さくら', emoji: '🌸', price: 300 },
  { id: 'sea', name: 'うみ', emoji: '🌊', price: 700 },
  { id: 'forest', name: 'もり', emoji: '🌳', price: 1100 },
  { id: 'candy', name: 'おかし', emoji: '🍭', price: 1600 },
  { id: 'space', name: 'うちゅう', emoji: '🪐', price: 2400 },
];

/** つぎに なかまにできる子（いちばん安い まだの子）と、あと何コインか */
export function nextFriendGoal(state) {
  const f = FRIENDS.filter((x) => !state.friends.includes(x.id)).sort((a, b) => a.price - b.price)[0];
  if (!f) return null;
  return { friend: f, need: Math.max(0, f.price - state.coins), progress: Math.min(1, state.coins / f.price), affordable: state.coins >= f.price };
}

export function buyFriend(state, id) {
  const f = FRIENDS.find((x) => x.id === id);
  if (!f || state.friends.includes(id) || state.coins < f.price) return false;
  state.coins -= f.price;
  state.friends.push(id);
  return true;
}

export function buyTheme(state, id) {
  const t = THEMES.find((x) => x.id === id);
  if (!t || state.themes.includes(id) || state.coins < t.price) return false;
  state.coins -= t.price;
  state.themes.push(id);
  return true;
}

/** ひみつのなかまの条件をみたしたら仲間にする。新しく仲間になった子を返す */
export function unlockSecretFriends(state, ctx) {
  const added = [];
  for (const f of SECRET_FRIENDS) {
    if (!state.friends.includes(f.id) && f.check(state, ctx)) {
      state.friends.push(f.id);
      added.push(f);
    }
  }
  return added;
}
