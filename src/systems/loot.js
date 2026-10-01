/**
 * MONO — 抽奖系统
 * 稀有度抽选（含软保底 / 硬保底）→ 物品挑选（长尾权重）→ 品相与模板 → 入包。
 * 掉落数量对低价物品放大（成色货成批出货），保证白/绿档不至于毫无价值。
 */
import { ITEMS, BY_RARITY, getItem, rollCondition, rollPattern, priceFactor } from '../core/catalog.js';
import { RARITY, RARITY_ORDER, ECON, clamp } from '../core/const.js';
import { S, addXp, pushLedger, bagCount, bagLimit } from '../core/state.js';
import { RNG } from '../core/rng.js';
import * as inv from './inventory.js';
import { bus } from '../core/util.js';

const PITY_GOLD = { gold: 0.015, red: 0.005 };

/** 当前稀有度概率（含保底加成），用于公示与抽选 */
export function odds() {
  const pity = S.player.pity;
  const base = {};
  for (const r of RARITY_ORDER) base[r] = RARITY[r].weight;
  // 软保底：连续 >=10 抽未出金后，金/红概率逐级提升
  const misses = pity.sinceGold || 0;
  let boost = 0;
  if (misses >= ECON.pitySoft) boost = Math.min(ECON.pityBoost, (misses - ECON.pitySoft + 1) * 0.35);
  // 硬保底：60 抽必出金/红
  const hard = (pity.sinceGold || 0) + 1 >= ECON.pityHard;
  if (hard) {
    return { red: 0.08, gold: 0.92, purple: 0, blue: 0, green: 0, white: 0 };
  }
  const gold = base.gold * (1 + boost);
  const red = base.red * (1 + boost * 0.6);
  const gained = gold - base.gold + (red - base.red);
  const restScale = Math.max(0, 1 - gained / (base.white + base.green + base.blue + base.purple));
  const out = {
    red,
    gold,
    purple: base.purple * restScale,
    blue: base.blue * restScale,
    green: base.green * restScale,
    white: base.white * restScale,
  };
  let sum = 0;
  for (const k in out) sum += out[k];
  for (const k in out) out[k] /= sum;
  return out;
}

/** 稀有度抽选 */
function rollRarity(rng) {
  const o = odds();
  const order = ['white', 'green', 'blue', 'purple', 'gold', 'red'];
  const idx = rng.weightedIndex(order.map((k) => o[k]));
  return order[idx];
}

/**
 * 长期生效概率：连抽统计下的实际分布（含保底影响）。
 * 用于「概率公示」——单抽概率与长期概率分开写清楚，避免公示与实际不符。
 */
export function effectiveOdds(samples = 6000) {
  const rng = new RNG('odds-probe-' + samples);
  const save = S.player.pity;
  S.player.pity = { sinceGold: 0, sinceRed: 0, total: 0 };
  const tally = { white: 0, green: 0, blue: 0, purple: 0, gold: 0, red: 0 };
  for (let i = 0; i < samples; i++) {
    const r = rollRarity(rng);
    tally[r]++;
    if (r === 'gold' || r === 'red') S.player.pity.sinceGold = 0;
    else S.player.pity.sinceGold++;
    if (r === 'red') S.player.pity.sinceRed = 0;
    else S.player.pity.sinceRed++;
  }
  S.player.pity = save;
  const out = {};
  for (const k in tally) out[k] = tally[k] / samples;
  return out;
}

/** 品类分布：饰品略重、资产略轻，让抽奖池不至于过度集中在某一类 */
const CAT_BIAS = { cs2: 1.25, compute: 0.85, hardware: 1.0, assets: 0.8 };

/** 在指定稀有度中挑选物品 */
function pickDef(rarity, rng) {
  const pool = BY_RARITY[rarity] || [];
  if (!pool.length) return null;
  const weights = pool.map((d) => d.dropWeight * (CAT_BIAS[d.category] || 1));
  return pool[rng.weightedIndex(weights)];
}

/**
 * 掉落实物价值的全局缩放。
 * 与「回收折价随等级收窄」配合，把单抽期望回收控制在：
 *   Lv.1 ≈ 50% → Lv.60 ≈ 90%（始终 < 100%，抽奖不会变成印钞机）。
 * 真正赚钱靠市场判断、稀缺品与耐心。
 */
const DROP_SCALE = 1.5;

/**
 * 等级带来的单次掉落加成。
 * 必须严格有界：无界加成 × 上升的回收率会让高等级抽奖变成无限套利。
 */
const LEVEL_BOOST_MAX = 1.2;
function levelBoost() {
  const lv = S.player.level || 1;
  // 平方根曲线：早期增长快、后期趋平
  return clamp(1 + Math.sqrt(Math.max(0, lv - 1)) / 25, 1, LEVEL_BOOST_MAX);
}

/** 每件掉落的数量：便宜的东西成批出货 */
function stackOf(def, rng) {
  if (def.category === 'assets' && def.rarity !== 'white') return 1;
  switch (def.rarity) {
    case 'white': {
      if (def.base <= 1) return rng.int(6, 20);
      if (def.base <= 5) return rng.int(3, 9);
      if (def.base <= 20) return rng.int(2, 5);
      if (def.base <= 60) return rng.int(1, 3);
      return rng.int(1, 2);
    }
    case 'green': {
      if (def.base <= 30) return rng.int(2, 5);
      if (def.base <= 120) return rng.int(1, 3);
      if (def.base <= 400) return rng.int(1, 2);
      return 1;
    }
    case 'blue': return rng.chance(0.18) ? 2 : 1;
    default: return 1;
  }
}

/**
 * 单次抽奖（不扣费，扣费在 economy / draw 入口）
 * @returns {{def, inst, rarity, qty, fresh, st, patternScore}}
 */
export function drawOne(rng, opt = {}) {
  const rarity = opt.rarity || rollRarity(rng);
  const def = pickDef(rarity, rng);
  if (!def) return null;
  const fresh = ['gold', 'red'].includes(rarity) ? true : rng.chance(0.35);
  const cond = rollCondition(def, rng.float(), fresh);
  const pat = rollPattern(def, rng, cond);
  const st = def.stattrak ? rng.chance(rarity === 'white' ? 0.04 : rarity === 'green' ? 0.08 : 0.14) : false;
  // 品相越好，出品数量越少（好品相本身就是稀缺的）
  const qtyRaw = opt.qty != null ? opt.qty : stackOf(def, rng);
  const condK = def.float ? (0.6 + cond.cond * 0.8) : 1;
  const qty = Math.max(1, Math.round(qtyRaw * DROP_SCALE * condK * levelBoost()));
  const inst = {
    wear: cond.wear,
    float: cond.float,
    cond: cond.cond,
    st,
    pattern: pat.pattern,
    patternScore: def.patternSensitive ? pat.patternScore : null,
    qty,
  };
  // 保底计数
  const p = S.player.pity;
  p.total++;
  if (rarity === 'gold' || rarity === 'red') p.sinceGold = 0;
  else p.sinceGold++;
  if (rarity === 'red') p.sinceRed = 0;
  else p.sinceRed++;
  return { def, inst, rarity, qty, cond };
}

/**
 * 批量抽奖
 * @param {number} n
 * @param {object} opt { charge:fn, rng }
 * @returns {{results:[], spent:number, blocked:number, reason:string}}
 */
export function drawMany(n, rng, opt = {}) {
  const { charge = null, onEach = null } = opt;
  const results = [];
  let spent = 0;
  let blocked = 0;
  let reason = '';
  const room = bagLimit() - bagCount();
  const max = Math.max(0, Math.min(n, room));
  if (max <= 0) {
    return { results, spent: 0, blocked: n, reason: 'bag-full' };
  }
  for (let i = 0; i < max; i++) {
    const unit = opt.priceEach != null ? opt.priceEach : ECON.drawPrice;
    if (charge && !charge(unit)) {
      blocked = n - i;
      reason = reason || 'no-cash';
      break;
    }
    spent += unit;
    const r = drawOne(rng);
    if (!r) continue;
    const key = inv.add(r.def.id, {
      qty: r.qty,
      cost: unit / r.qty,
      from: 'draw',
      wear: r.inst.wear,
      float: r.inst.float,
      st: r.inst.st,
      pattern: r.inst.pattern,
      patternScore: r.inst.patternScore,
    });
    const row = { ...r, key, unitPrice: unit };
    results.push(row);
    S.player.stats.draws++;
    S.player.stats.spentOnDraws += unit;
    if (r.rarity === 'red') S.player.stats.redsFound++;
    if (r.rarity === 'gold') S.player.stats.goldsFound++;
    S.player.seen[r.def.id] = 1;
    if (onEach) onEach(row, i);
  }
  if (results.length) {
    addXp(results.length * ECON.xpPerDraw);
    pushLedger({
      type: 'draw',
      n: results.length,
      amount: -spent,
      note: `${results.length} 连抽`,
      best: results.reduce((a, b) => (RARITY_ORDER.indexOf(b.rarity) > RARITY_ORDER.indexOf(a.rarity) ? b : a)).def.name,
    });
    bus?.emit?.('draw', results);
  }
  return { results, spent, blocked, reason };
}

/** 价格公示用：每个稀有度在池中的数量与均价 */
export function poolInfo() {
  const o = odds();
  return RARITY_ORDER.map((r) => {
    const list = BY_RARITY[r] || [];
    const avg = list.reduce((s, d) => s + d.base, 0) / Math.max(1, list.length);
    return { rarity: r, cn: RARITY[r].cn, color: RARITY[r].color, p: o[r], base: RARITY[r].weight, count: list.length, avg };
  });
}

/** 抽奖历史（从 ledger 里取，持久化在存档） */
export function drawHistory(limit = 40) {
  const out = [];
  for (const e of S.player.ledger) {
    if (e.type === 'draw') out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

export { PITY_GOLD };
