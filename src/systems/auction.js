/**
 * MONO — 拍卖行
 * 玩家可竞拍 NPC 放出的标的，也可以把自己的物品送上拍卖台。
 * 竞价在游戏时间中推进，NPC 按人格与估值自动加价，可能一口价成交。
 */
import { getItem, priceFactor } from '../core/catalog.js';
import { ECON, TIME, clamp } from '../core/const.js';
import { S, mstate, feeRate, pushLedger, repBonus, auctionLimit } from '../core/state.js';
import { bus, uid } from '../core/util.js';
import { pay, earn, marketUnit } from './economy.js';
import * as inv from './inventory.js';
import { auctionBidders } from './npc.js';

/** NPC 对标的的最高心理价 */
function npcCeiling(npc, def, m) {
  const p = m ? m.p : def.base;
  const bias = npc.bias[def.category] || 1;
  // 人格越激进 / 庄家型越可能溢价
  const heat = 1 + npc.vol * 0.08 + (npc.arch === 'whale' ? 0.16 : npc.arch === 'aggressive' ? 0.1 : 0) + npc.mood * 0.05;
  const budgetK = clamp(Math.log10(Math.max(10, npc.cash)) / 6, 0.2, 1.2);
  return p * bias * heat * 1.06 * (0.75 + budgetK * 0.35);
}

/** 生成一场 NPC 拍卖 */
export function spawnNpcAuction(rng) {
  const pool = [];
  for (const rar of ['blue', 'purple', 'gold', 'red']) {
    const list = Object.keys(S.market).filter((id) => {
      const d = getItem(id);
      return d && d.rarity === rar && d.base > 400 && d.base < 400000;
    });
    if (list.length) pool.push(...list);
  }
  if (!pool.length) return null;
  const itemId = pool[Math.floor(rng.float() * pool.length)];
  const def = getItem(itemId);
  if (!def) return null;
  const m = mstate(itemId);
  const inst = rng.chance(0.4) && def.patternSensitive
    ? { patternScore: 0.4 + rng.float() * 0.6, pattern: def.pattern }
    : {};
  const value = marketUnit(def, inst);
  const start = value * rng.range(0.55, 0.85);
  const buyout = value * rng.range(1.25, 1.9);
  const bidders = auctionBidders(def, rng, 3);
  if (!bidders.length) return null;
  const a = {
    id: 'A' + S.player.auctionSeq++,
    itemId,
    name: def.name,
    qty: 1,
    sellerId: null,
    sellerName: bidders[0].name + ' 等服务商',
    inst,
    start,
    reserve: start * 0.92,
    buyout,
    high: null,
    history: [],
    endsAt: S.clock.hours + rng.range(6, TIME.auctionHours),
    startedAt: S.clock.hours,
    status: 'live',
    bidders: bidders.map((b) => b.id),
    nextBidAt: S.clock.hours + rng.range(1.5, 6),
    mine: false,
  };
  S.player.auctions.unshift(a);
  return a;
}

/** 玩家把自己的物品送上拍卖 */
export function createAuction(key, qty, startPrice, buyoutPrice) {
  const inst = S.player.bag[key];
  if (!inst) return { ok: false, reason: 'missing' };
  const def = getItem(inst.defId);
  if (!def) return { ok: false, reason: 'missing' };
  const mine = S.player.auctions.filter((a) => a.mine && a.status === 'live').length;
  if (mine >= auctionLimit()) return { ok: false, reason: 'limit' };
  const n = Math.min(qty, inst.qty);
  if (n <= 0) return { ok: false, reason: 'qty' };
  if (!(startPrice > 0)) return { ok: false, reason: 'price' };
  const fee = startPrice * n * ECON.auctionFee;
  if (!pay(fee, 'auction-fee')) return { ok: false, reason: 'fee' };
  S.player.stats.feesPaid += fee;
  inv.remove(key, n);
  const a = {
    id: 'A' + S.player.auctionSeq++,
    itemId: def.id,
    name: def.name,
    qty: n,
    sellerId: 'player',
    sellerName: S.player.name,
    inst: {
      wear: inst.wear, float: inst.float, st: inst.st,
      pattern: inst.pattern, patternScore: inst.patternScore, cost: inst.cost,
    },
    start: startPrice,
    reserve: startPrice,
    buyout: buyoutPrice > 0 ? buyoutPrice : null,
    high: null,
    history: [],
    endsAt: S.clock.hours + TIME.auctionHours,
    startedAt: S.clock.hours,
    status: 'live',
    /** 玩家标的的潜在买家由拍卖推进时随机唤醒 */
    bidders: [],
    nextBidAt: S.clock.hours + 2,
    mine: true,
    fee,
  };
  S.player.auctions.unshift(a);
  bus.emit('auction', a);
  return { ok: true, auction: a };
}

/** 玩家出价 */
export function bid(auctionId, price) {
  const a = S.player.auctions.find((x) => x.id === auctionId);
  if (!a || a.status !== 'live') return { ok: false, reason: 'closed' };
  const min = a.high ? a.high.price * 1.02 : a.start;
  if (price < min) return { ok: false, reason: 'low', min };
  if (a.sellerId === 'player') return { ok: false, reason: 'own' };
  const needed = price * a.qty;
  // 之前出价先退回
  const refund = a.high && a.high.who === 'player' ? a.high.price * a.qty : 0;
  if (S.player.cash + refund < needed) return { ok: false, reason: 'no-cash', need: needed - refund };
  if (refund > 0) earn(refund, 'bid-refund');
  pay(needed, 'bid');
  a.high = { who: 'player', price, at: S.clock.hours, name: S.player.name };
  a.history.unshift({ who: S.player.name, price, at: S.clock.hours, mine: true });
  if (a.history.length > 30) a.history.length = 30;
  // 延长：最后 3 小时内出价则加时
  if (a.endsAt - S.clock.hours < 3) a.endsAt += 3;
  bus.emit('bid', { auction: a, price });
  return { ok: true, price, locked: needed };
}

/** NPC 自动加价 */
function npcAutoBid(a, rng) {
  if (a.status !== 'live') return;
  const def = getItem(a.itemId);
  if (!def) return;
  const m = mstate(def.id);
  // 玩家标的初始没有买家：随拍卖推进逐渐吸引进场
  if (!a.bidders.length) {
    const fresh = auctionBidders(def, rng, 3);
    a.bidders = fresh.map((b) => b.id);
    if (!a.bidders.length) return;
  }
  const active = a.bidders.map((id) => S.npcs.find((n) => n.id === id)).filter(Boolean);
  if (!active.length) return;
  const npc = rng.pick(active);
  const ceiling = npcCeiling(npc, def, m);
  const minNext = a.high ? a.high.price * rng.range(1.02, 1.09) : a.start;
  if (a.high && a.high.who === npc.id) return;
  if (minNext > ceiling) return;
  if (npc.cash < minNext * a.qty) return;
  // 一口价直接拿下
  if (a.buyout && a.high && a.high.price * 1.12 >= a.buyout && npc.arch === 'whale') {
    buyoutInternal(a, npc);
    return;
  }
  a.high = { who: npc.id, price: minNext, at: S.clock.hours, name: npc.name };
  a.history.unshift({ who: npc.name, price: minNext, at: S.clock.hours, mine: false });
  if (a.history.length > 30) a.history.length = 30;
  bus.emit('bid', { auction: a, price: minNext, npc });
}

function buyoutInternal(a, npc) {
  settle(a, { who: npc.id, price: a.buyout, name: npc.name });
}

/** 结算 */
function settle(a, winner) {
  const def = getItem(a.itemId);
  if (!def) return;
  a.status = 'sold';
  a.settledAt = S.clock.hours;
  const price = winner.price * a.qty;
  const npc = S.npcs.find((n) => n.id === winner.who);
  if (winner.who === 'player') {
    // 玩家中标：拿到物品，钱已锁定
    inv.add(a.itemId, {
      qty: a.qty,
      cost: winner.price,
      from: 'auction',
      wear: a.inst.wear, float: a.inst.float, st: a.inst.st,
      pattern: a.inst.pattern, patternScore: a.inst.patternScore,
    });
    S.player.stats.auctionsWon++;
    pushLedger({ type: 'auction-win', itemId: a.itemId, name: a.name, qty: a.qty, price: winner.price, amount: -price, note: '拍卖中标' });
    bus.emit('auction-settled', { auction: a, win: true });
  } else {
    if (a.high && a.high.who === 'player') earn(a.high.price * a.qty, 'outbid');
    S.player.stats.auctionsLost++;
    if (a.mine) {
      // 玩家是卖家：收钱（扣佣金）
      const fee = price * ECON.auctionFee;
      earn(price - fee, 'auction-sell');
      S.player.stats.feesPaid += fee;
      const cost = (a.inst.cost || 0) * a.qty;
      const profit = price - fee - cost;
      S.player.stats.realizedPnl += profit;
      if (profit > 0) S.player.stats.wins++;
      else S.player.stats.losses++;
      pushLedger({ type: 'auction-sell', itemId: a.itemId, name: a.name, qty: a.qty, price: winner.price, amount: price - fee, profit, note: `拍出 ${winner.name}` });
    } else if (npc) {
      npc.cash = Math.max(0, npc.cash - price);
      npc.stock[a.itemId] = npc.stock[a.itemId] || { qty: 0, cost: 0 };
      const st = npc.stock[a.itemId];
      st.cost = (st.cost * st.qty + price) / (st.qty + a.qty);
      st.qty += a.qty;
    }
    bus.emit('auction-settled', { auction: a, win: false });
  }
  a.winner = winner.name;
  a.winnerWho = winner.who;
}

/** 无人出价：流拍 */
function unsold(a) {
  a.status = 'unsold';
  a.settledAt = S.clock.hours;
  // 系统回收价兜底（仅 NPC 标的会消失；玩家标的退回背包）
  if (a.mine) {
    inv.add(a.itemId, {
      qty: a.qty,
      cost: a.inst.cost || 0,
      from: 'auction-unsold',
      wear: a.inst.wear, float: a.inst.float, st: a.inst.st,
      pattern: a.inst.pattern, patternScore: a.inst.patternScore,
    });
  }
  pushLedger({ type: 'auction-unsold', itemId: a.itemId, name: a.name, qty: a.qty, amount: 0, note: '流拍' });
  bus.emit('auction-settled', { auction: a, win: false, unsold: true });
}

/** 每 tick 推进拍卖 */
export function tickAuctions(rng, hours) {
  const steps = Math.max(1, Math.round(hours / 6));
  for (let s = 0; s < steps; s++) {
    for (const a of S.player.auctions) {
      if (a.status !== 'live') continue;
      if (S.clock.hours >= a.endsAt) {
        if (a.high) settle(a, a.high);
        else unsold(a);
        continue;
      }
      if (S.clock.hours >= a.nextBidAt) {
        npcAutoBid(a, rng);
        a.nextBidAt = S.clock.hours + rng.range(0.75, 4);
      }
    }
    // 清理过多历史
    if (S.player.auctions.length > 60) {
      const done = S.player.auctions.filter((a) => a.status !== 'live');
      const live = S.player.auctions.filter((a) => a.status === 'live');
      S.player.auctions = live.concat(done.slice(0, 24));
    }
  }
  // 维持一定的活跃拍卖数量
  const liveCount = S.player.auctions.filter((a) => a.status === 'live').length;
  if (liveCount < 4 && rng.chance(0.6)) spawnNpcAuction(rng);
}

export function liveAuctions() {
  return S.player.auctions.filter((a) => a.status === 'live');
}

export function auctionHistory(limit = 40) {
  return S.player.auctions.filter((a) => a.status !== 'live').slice(0, limit);
}

export function myAuctions() {
  return S.player.auctions.filter((a) => a.mine);
}

/** 当前最低加价 */
export function minBid(a) {
  return a.high ? a.high.price * 1.02 : a.start;
}
