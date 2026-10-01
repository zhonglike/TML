/**
 * MONO — 挂单中心
 * 玩家可以挂出卖单（限价卖）与买单（限价买）：
 * 挂单进入市场后被 NPC「吃单」，成交概率与挂单价、物品流动性、NPC 需求强度有关。
 */
import { getItem } from '../core/catalog.js';
import { ECON, TIME, clamp } from '../core/const.js';
import { S, mstate, feeRate, pushLedger, repBonus } from '../core/state.js';
import { bus, uid } from '../core/util.js';
import { quoteBuy, quoteSell, marketUnit, pay, earn } from './economy.js';
import * as inv from './inventory.js';

/* ------------------------------------------------------------------- 卖单 */

/**
 * 挂出卖单
 * @param {string} key 背包键
 * @param {number} qty
 * @param {number} price 单件挂单价
 */
export function listSell(key, qty, price) {
  const inst = S.player.bag[key];
  if (!inst) return { ok: false, reason: 'missing' };
  const def = getItem(inst.defId);
  if (!def) return { ok: false, reason: 'missing' };
  const n = Math.min(qty, inst.qty);
  if (n <= 0) return { ok: false, reason: 'qty' };
  if (S.player.listings.length >= ECON.listingsBase + Math.floor(S.player.level / 5) * ECON.listingsPerLevel5) {
    return { ok: false, reason: 'limit' };
  }
  const reference = marketUnit(def, inst);
  if (price <= 0) return { ok: false, reason: 'price' };
  if (price > reference * 12) return { ok: false, reason: 'too-high' };
  const unitFair = quoteSell(def, inst).unit;
  const fee = Math.min(price * n * feeRate(), price * n * ECON.listFee * 4);
  if (!pay(fee, 'list-fee')) return { ok: false, reason: 'fee' };
  S.player.stats.feesPaid += fee;
  // 物品锁进挂单（从背包取出，移入挂单的快照）
  inv.remove(key, n);
  const order = {
    id: 'L' + S.player.orderSeq++,
    side: 'sell',
    itemId: def.id,
    name: def.name,
    qty: n,
    filled: 0,
    price,
    ref: reference,
    fair: unitFair,
    wear: inst.wear,
    float: inst.float,
    st: inst.st,
    pattern: inst.pattern,
    patternScore: inst.patternScore,
    cost: inst.cost || 0,
    created: S.clock.hours,
    expires: S.clock.hours + TIME.listingHours,
    fee,
    status: 'open',
  };
  S.player.listings.unshift(order);
  bus.emit('order', order);
  return { ok: true, order };
}

/** 撤单（未成交部分回到背包） */
export function cancel(orderId) {
  const i = S.player.listings.findIndex((o) => o.id === orderId);
  if (i < 0) return { ok: false, reason: 'missing' };
  const o = S.player.listings[i];
  const back = o.qty - o.filled;
  if (back > 0) {
    inv.add(o.itemId, {
      qty: back,
      cost: o.cost,
      from: 'cancel',
      wear: o.wear,
      float: o.float,
      st: o.st,
      pattern: o.pattern,
      patternScore: o.patternScore,
    });
  }
  S.player.listings.splice(i, 1);
  pushLedger({ type: 'cancel', itemId: o.itemId, name: o.name, qty: back, amount: 0, note: '撤单' });
  bus.emit('order-cancel', o);
  return { ok: true, order: o, back };
}

/* ------------------------------------------------------------------- 买单 */

/**
 * 挂出买单
 */
export function listBuy(itemId, qty, price, spec = {}) {
  const def = getItem(itemId);
  if (!def) return { ok: false, reason: 'missing' };
  if (qty <= 0 || price <= 0) return { ok: false, reason: 'bad-args' };
  if (S.player.buyOrders.length >= 4 + Math.floor(S.player.level / 8)) return { ok: false, reason: 'limit' };
  const total = price * qty;
  if (S.player.cash < total) return { ok: false, reason: 'no-cash', need: total };
  pay(total, 'buy-order');
  const order = {
    id: 'B' + S.player.orderSeq++,
    side: 'buy',
    itemId,
    name: def.name,
    qty,
    filled: 0,
    price,
    ref: def.base,
    wear: spec.wear || null,
    float: spec.float != null ? spec.float : null,
    st: !!spec.st,
    pattern: spec.pattern || null,
    patternScore: spec.patternScore != null ? spec.patternScore : null,
    escrow: total,
    created: S.clock.hours,
    expires: S.clock.hours + TIME.listingHours,
    status: 'open',
  };
  S.player.buyOrders.unshift(order);
  bus.emit('order', order);
  return { ok: true, order };
}

export function cancelBuy(orderId) {
  const i = S.player.buyOrders.findIndex((o) => o.id === orderId);
  if (i < 0) return { ok: false, reason: 'missing' };
  const o = S.player.buyOrders[i];
  const remaining = (o.qty - o.filled) * o.price;
  if (remaining > 0) earn(remaining, 'cancel-buy');
  S.player.buyOrders.splice(i, 1);
  pushLedger({ type: 'cancel', itemId: o.itemId, name: o.name, qty: o.qty - o.filled, amount: remaining, note: '撤销买单' });
  bus.emit('order-cancel', o);
  return { ok: true, order: o };
}

/* --------------------------------------------------------------- 成交引擎 */

/**
 * 挂单成交概率（导出给 UI 展示）
 * 相对市价越便宜（对买方）越容易成交；同时受物品流动性与随机波动影响。
 */
export function fillChance(order, def, m) {
  const ref = m ? m.p : def.base;
  const ratio = order.side === 'sell' ? order.price / ref : ref / order.price;
  // ratio < 1 表示比市价更有吸引力
  const attract = clamp((1 - ratio) / 0.35, -1, 1);
  const liq = def.liq;
  const momentum = m ? m.mom : 0;
  // 上涨时卖单更容易成交（有人追），下跌时买单更容易成交
  const momHelp = order.side === 'sell' ? momentum * 3 : -momentum * 3;
  const base = order.side === 'sell' ? 0.2 : 0.16;
  let p = base * liq * (0.35 + attract * 0.9 + 0.5) + momHelp * 0.3 * liq;
  p *= 0.9 + (def.rarity === 'white' ? 0.35 : def.rarity === 'green' ? 0.15 : 0);
  return clamp(p, 0.005, 0.92);
}

/** 每 tick 推进挂单成交 */
export function tickOrders(rng, hours) {
  const steps = Math.max(1, Math.round(hours / 6));
  for (let s = 0; s < steps; s++) {
    stepOnce(rng);
    S.clock.ordersStepped = (S.clock.ordersStepped || 0) + 1;
  }
}

function stepOnce(rng) {
  // ---- 卖单
  for (let i = S.player.listings.length - 1; i >= 0; i--) {
    const o = S.player.listings[i];
    if (o.status !== 'open') continue;
    const def = getItem(o.itemId);
    if (!def) continue;
    const m = mstate(def.id);
    const remain = o.qty - o.filled;
    if (remain <= 0) {
      S.player.listings.splice(i, 1);
      continue;
    }
    // 过期
    if (S.clock.hours >= o.expires) {
      inv.add(o.itemId, {
        qty: remain, cost: o.cost, from: 'expired',
        wear: o.wear, float: o.float, st: o.st, pattern: o.pattern, patternScore: o.patternScore,
      });
      S.player.listings.splice(i, 1);
      pushLedger({ type: 'expired', itemId: o.itemId, name: o.name, qty: remain, amount: 0, note: '挂单过期退回' });
      bus.emit('order-expired', o);
      continue;
    }
    const p = fillChance(o, def, m);
    // 大额挂单拆成多次成交
    const chunkMax = Math.max(1, Math.round(remain * rng.range(0.15, 0.6)));
    if (rng.chance(p)) {
      const n = Math.min(remain, chunkMax, rng.int(1, Math.max(1, Math.ceil(remain * 0.5))));
      const gross = o.price * n;
      const fee = gross * feeRate();
      earn(Math.max(0.01, gross - fee), 'limit-sell');
      S.player.stats.feesPaid += fee;
      o.filled += n;
      const profit = (o.price - o.cost) * n - fee;
      S.player.stats.realizedPnl += profit;
      if (profit > 0) S.player.stats.wins++;
      else S.player.stats.losses++;
      pushLedger({
        type: 'limit-sell', itemId: o.itemId, name: o.name, qty: n, price: o.price,
        amount: gross, profit, note: '挂单成交',
      });
      bus.emit('fill', { order: o, qty: n, price: o.price, side: 'sell' });
      if (o.filled >= o.qty) {
        S.player.listings.splice(i, 1);
        pushLedger({ type: 'list-done', itemId: o.itemId, name: o.name, qty: o.qty, amount: 0, note: '挂单全部成交' });
      }
    }
  }
  // ---- 买单
  for (let i = S.player.buyOrders.length - 1; i >= 0; i--) {
    const o = S.player.buyOrders[i];
    const def = getItem(o.itemId);
    if (!def) continue;
    const m = mstate(def.id);
    const remain = o.qty - o.filled;
    if (S.clock.hours >= o.expires) {
      earn(remain * o.price, 'buy-expired');
      S.player.buyOrders.splice(i, 1);
      pushLedger({ type: 'expired', itemId: o.itemId, name: o.name, qty: remain, amount: remain * o.price, note: '买单过期退回' });
      bus.emit('order-expired', o);
      continue;
    }
    if (remain <= 0) {
      S.player.buyOrders.splice(i, 1);
      continue;
    }
    const p = fillChance(o, def, m);
    if (rng.chance(p)) {
      const n = Math.min(remain, rng.int(1, Math.max(1, Math.ceil(remain * 0.5))));
      inv.add(o.itemId, {
        qty: n, cost: o.price, from: 'buy-order',
        wear: o.wear, float: o.float, st: o.st, pattern: o.pattern, patternScore: o.patternScore,
      });
      o.filled += n;
      pushLedger({ type: 'limit-buy', itemId: o.itemId, name: o.name, qty: n, price: o.price, amount: -o.price * n, note: '买单成交' });
      bus.emit('fill', { order: o, qty: n, price: o.price, side: 'buy' });
      if (o.filled >= o.qty) {
        S.player.buyOrders.splice(i, 1);
        pushLedger({ type: 'list-done', itemId: o.itemId, name: o.name, qty: o.qty, amount: 0, note: '买单全部成交' });
      }
    }
  }
}

/* ------------------------------------------------------------------ 统计 */

export function orderStats() {
  const open = S.player.listings.length + S.player.buyOrders.length;
  const locked = S.player.buyOrders.reduce((s, o) => s + (o.qty - o.filled) * o.price, 0);
  const listedValue = S.player.listings.reduce((s, o) => s + (o.qty - o.filled) * o.price, 0);
  return { open, locked, listedValue };
}

/** 建议挂单价（用于 UI 的一键填充） */
export function suggestPrice(def, inst, side = 'sell') {
  const q = side === 'sell' ? quoteSell(def, inst) : quoteBuy(def, inst);
  if (side === 'sell') return Math.round(q.unit * 1.02 * 100) / 100;
  return Math.round(q.unit * 0.98 * 100) / 100;
}

export { marketUnit, repBonus, inv, uid };
