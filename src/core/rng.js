/**
 * MONO — 确定性随机
 * mulberry32 + xmur3：同一 seed 必然产生同一市场序列，
 * 便于复现、离线推进与防改档校验。
 */

export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed) {
    this.seed = String(seed == null ? 'mono' : seed);
    const h = xmur3(this.seed);
    this.next = mulberry32(h());
    this.calls = 0;
  }
  /** [0,1) */
  float() {
    this.calls++;
    return this.next();
  }
  /** [a,b) */
  range(a, b) {
    return a + this.float() * (b - a);
  }
  /** 整数 [a,b] */
  int(a, b) {
    return Math.floor(a + this.float() * (b - a + 1));
  }
  /** 概率 */
  chance(p) {
    return this.float() < p;
  }
  /** 正态分布（Box-Muller），均值 0 方差 1 */
  gauss() {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.float();
    while (v === 0) v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** 帕累托式长尾 0..1（偏向 0），alpha 越大越偏 */
  tail(alpha = 2.2) {
    return Math.pow(1 - this.float(), alpha);
  }
  pick(arr) {
    return arr[Math.floor(this.float() * arr.length)];
  }
  shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /** weights: number[]；返回命中下标 */
  weightedIndex(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i] > 0 ? weights[i] : 0;
    if (total <= 0) return 0;
    let r = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if ((r -= w) <= 0) return i;
    }
    return weights.length - 1;
  }
  weighted(arr, weightFn) {
    const w = arr.map(weightFn);
    return arr[this.weightedIndex(w)];
  }
  /** 派生一个独立的子流（不破坏本流序列） */
  derive(tag) {
    const h = xmur3(this.seed + '|' + tag);
    return new RNG(String(h()));
  }
  snapshot() {
    return { seed: this.seed, calls: this.calls };
  }
}

/** 全局会话随机（与存档分离，用于纯表现层） */
export const ui = new RNG('ui-' + Math.floor(performance.now()));

/** 快速字符串 hash（用于防改档校验，非加密） */
export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
