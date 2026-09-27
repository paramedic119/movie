// シードを指定できる乱数（テストで同じ問題を再現できるように）

export function createRng(seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** min 以上 max 以下の整数 */
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle(arr) {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    chance(p) {
      return next() < p;
    },
    /** 重みつきで1つ選ぶ */
    weighted(items, weightOf) {
      const total = items.reduce((s, it) => s + Math.max(0, weightOf(it)), 0);
      if (total <= 0) return items[Math.floor(next() * items.length)];
      let r = next() * total;
      for (const it of items) {
        r -= Math.max(0, weightOf(it));
        if (r < 0) return it;
      }
      return items[items.length - 1];
    },
  };
}
