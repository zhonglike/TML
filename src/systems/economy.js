/**
 * MONO — 经济系统
 * 所有涉及现金、价格、手续费、回收折价、经验与声望的运算都在这里。
 * 设计目标：抽奖长期小亏（靠交易与判断翻盘）、回收价随等级上升、手续费随等级下降。
 */
import { getItem, priceFactor } from '../core/catalog.js';
import { ECON, RARITY_ORDER } from '../core/const.js';
import {
  S, mstate, feeRate, recycleRate, recycleRateFor, repBonus, addXp, pushLedger, day,
} from '../core/state.js';
import { applyImpact } from '../core/market.js';
import * as inv from './inventory.js';
import { bus, clamp } from '../core/util.js';

/* ------------------------------------------------------------------ 现金 */

export function canPay(amount) {
  return S.player.cash >= amount - 1e-9;
}

export function pay(amount, note = '') {
  if (!canPay(amount)) return false;
  S.player.cash -= amount;
  S.player.stats.feesPaid += 0;
  if (note) bus.emit('cash', { delta: -amount, note });
  return true;
}

export function earn(amount, note = '') {
  S.player.cash += amount;
  if (note) bus.emit('cash', { delta: amount, note });
  return amount;
}

/* ------------------------------------------------------------------ 定价 */

/** 实例在市场上的「公允单价」 */
export function marketUnit(def, inst) {
  const m = mstate(def.id);
  const p = m ? m.p : def.base;
  return p * priceFactor(def, inst);
}

/** 回收商（系统回收）单价 —— 折价最狠，但瞬间成交 */
export function recycleUnit(def, inst) {
  return marketUnit(def, inst) * recycleRateFor(def);
}

/** 一口价卖给 NPC：在公允价上让一点，含手续费 */
export function quoteSell(def, inst, buyer = null) {
  const base = marketUnit(def, inst);
  const spreadCut = 1 - 0.14 / Math.max(1, def.liq + 0.35);
  const buyerMult = buyer ? buyer.bid : 1;
  const gross = base * Math.pow(spreadCut, 1) * buyerMult * (1 + repBonus());
  const fee = gross * feeRate();
  return { gross, fee, net: Math.max(0.01, gross - fee), unit: base };
}

/** 一口价从 NPC 买入：在公允价上加价 */
export function quoteBuy(def, inst, seller = null) {
  const base = marketUnit(def, inst);
  const premium = 1 + 0.16 / Math.max(1, def.liq + 0.35);
  const sellerMult = seller ? seller.ask : 1;
  const gross = base * premium * sellerMult * (1 - repBonus() * 0.6);
  const fee = gross * feeRate() * 0.5;
  return { gross, fee, total: gross + fee, unit: base };
}

/* ------------------------------------------------------------- 交易动作 */

/** 记录统计与经验 */
function afterTrade({ volume, profit, type }) {
  const p = S.player;
  p.stats.trades++;
  p.daily.tradesToday++;
  if (type === 'sell') p.stats.sellVolume += volume;
  else p.stats.buyVolume += volume;
  if (profit > 0) {
    p.stats.wins++;
    p.stats.realizedPnl += profit;
    if (profit > p.stats.bestTrade) p.stats.bestTrade = profit;
  } else if (profit < 0) {
    p.stats.losses++;
    p.stats.realizedPnl += profit;
    if (profit < p.stats.worstTrade) p.stats.worstTrade = profit;
  }
  addXp(volume * ECON.xpPerTradeVolume + Math.max(0, profit) * ECON.xpPerProfit);
  p.rep += ECON.repPerTrade;
}

/**
 * 卖出单个实例（一口价 / 回收）
 * @param {string} key 背包键
 * @param {number} qty
 * @param {object} opt { instant:boolean, buyer:object }
 */
export function sell(key, qty, opt = {}) {
  const inst = S.player.bag[key];
  if (!inst) return { ok: false, reason: 'missing' };
  const def = getItem(inst.defId);
  if (!def) return { ok: false, reason: 'missing' };
  const n = Math.min(qty, inst.qty);
  if (n <= 0) return { ok: false, reason: 'qty' };
  if (S.player.daily.tradesToday >= ECON.dailyTradeCap) {
    return { ok: false, reason: 'daily-cap' };
  }
  const instant = opt.instant !== false;
  const unit = instant ? recycleUnit(def, inst) : quoteSell(def, inst, opt.buyer).net;
  const gross = unit * n;
  if (gross <= 0) return { ok: false, reason: 'price' };
  const cost = (inst.cost || 0) * n;
  const profit = gross - cost;
  inv.remove(key, n);
  earn(gross, 'sell');
  if (!instant) applyImpact(def, gross, -1);
  afterTrade({ volume: gross, profit, type: 'sell' });
  pushLedger({
    type: 'sell',
    itemId: def.id,
    name: def.name,
    wear: inst.wear,
    qty: n,
    price: unit,
    amount: gross,
    cost,
    profit,
    instant,
  });
  bus.emit('trade', { side: 'sell', def, inst, qty: n, unit, total: gross, profit });
  return { ok: true, unit, total: gross, profit, qty: n };
}

/** 批量卖出（回收 / 一口价） */
export function sellBatch(entries, opt = {}) {
  let total = 0;
  let profit = 0;
  let n = 0;
  const problems = [];
  for (const e of entries) {
    const r = sell(e.key, e.qty || (S.player.bag[e.key] ? S.player.bag[e.key].qty : 1), opt);
    if (r.ok) {
      total += r.total;
      profit += r.profit;
      n += r.qty;
    } else problems.push(r.reason);
  }
  return { ok: n > 0, total, profit, n, problems };
}

/**
 * 买入：从市场（挂单簿）买下某个 def 的一定数量
 */
export function buy(defId, qty, opt = {}) {
  const def = getItem(defId);
  if (!def || qty <= 0) return { ok: false, reason: 'bad-args' };
  const m = mstate(def.id);
  const instSpec = opt.inst || {};
  const q = quoteBuy(def, instSpec, opt.seller);
  const total = q.total * qty;
  if (!canPay(total)) return { ok: false, reason: 'no-cash', need: total };
  const room = ECON.bagBase + (S.player.level - 1) * ECON.bagPerLevel
    - Object.values(S.player.bag).reduce((s, x) => s + x.qty, 0);
  if (room < qty) return { ok: false, reason: 'bag-full' };
  pay(total, 'buy');
  const key = inv.add(def.id, {
    qty,
    cost: q.total / qty,
    from: 'buy',
    wear: instSpec.wear || null,
    float: instSpec.float != null ? instSpec.float : null,
    st: !!instSpec.st,
    pattern: instSpec.pattern || null,
    patternScore: instSpec.patternScore != null ? instSpec.patternScore : null,
  });
  applyImpact(def, total, 1);
  afterTrade({ volume: total, profit: 0, type: 'buy' });
  pushLedger({
    type: 'buy', itemId: def.id, name: def.name, qty, price: q.total / qty, amount: -total,
  });
  bus.emit('trade', { side: 'buy', def, qty, unit: q.total / qty, total });
  if (m) m.flow += total;
  return { ok: true, total, key, qty };
}

/* ------------------------------------------------------------- 熔炼 / 拆解 */

/**
 * 熔炼：把低价值物品换成材料（材料可用于抽奖折扣与扩容）
 * 材料价值 = 回收价的 55%，换取 40% 的通用性溢价（材料可用于抵扣）
 */
export function scrapValue(def, inst, qty) {
  return recycleUnit(def, inst) * qty * 0.55;
}

export function scrap(keys) {
  let gained = 0;
  let n = 0;
  for (const k of keys) {
    const inst = S.player.bag[k];
    if (!inst) continue;
    const def = getItem(inst.defId);
    if (!def) continue;
    gained += scrapValue(def, inst, inst.qty);
    n += inst.qty;
    delete S.player.bag[k];
  }
  S.player.scrap += gained;
  if (n) pushLedger({ type: 'scrap', qty: n, amount: 0, note: `熔炼 ${n} 件，获得材料` });
  return { gained, n };
}

/** 自动挑选可熔炼的低价值物品 */
export function autoScrapKeys(maxUnitPrice = 60, keepRarityFrom = 'blue') {
  const keepFloor = RARITY_ORDER.indexOf(keepRarityFrom);
  const keys = [];
  for (const k in S.player.bag) {
    const inst = S.player.bag[k];
    const def = getItem(inst.defId);
    if (!def) continue;
    if (RARITY_ORDER.indexOf(def.rarity) >= keepFloor) continue;
    if (inv.instValue(def, inst) <= maxUnitPrice) keys.push(k);
  }
  return keys;
}

/** 每日交易限流重置 */
export function resetDaily() {
  const d = day();
  if (S.player.daily.resetDay !== d) {
    S.player.daily.resetDay = d;
    S.player.daily.tradesToday = 0;
    S.player.daily.quests = {};
    S.player.quests.daily = {};
    bus.emit('daily-reset', d);
    return true;
  }
  return false;
}

export function dailyTradeLeft() {
  return Math.max(0, ECON.dailyTradeCap - S.player.daily.tradesToday);
}

export { feeRate, recycleRate, recycleRateFor, repBonus, inv };
