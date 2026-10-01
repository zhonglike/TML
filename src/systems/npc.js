/**
 * MONO — NPC 商人
 * 6 种人格（保守 / 激进 / 囤货 / 割肉 / 庄家 / 散户），各自有现金、库存、报价与偏好。
 * NPC 会周期性地重组库存、挂出买单与卖单、吃玩家的挂单，并在拍卖中出价。
 */
import { ITEMS, getItem, BY_CATEGORY, BY_RARITY, priceFactor } from '../core/catalog.js';
import { NPC_ARCHETYPES, NPC_NAMES, clamp, RARITY_ORDER } from '../core/const.js';
import { S, mstate, repBonus } from '../core/state.js';
import { bus } from '../core/util.js';

/** 生成初始 NPC 群体 */
export function initNpcs(rng, count = 18) {
  S.npcs = [];
  // 用固定标签派生独立子流：同一种子下 NPC 的名字与人格永远一致，
  // 不会因为「谁先谁后多调用了一次随机」而错位。
  const baseRng = rng;
  const nrng = baseRng && typeof baseRng.derive === 'function' ? baseRng.derive('npc-init') : baseRng;
  const names = nrng.shuffle(NPC_NAMES.slice());
  for (let i = 0; i < count; i++) {
    const a = NPC_ARCHETYPES[i % NPC_ARCHETYPES.length];
    const cash = nrng.range(a.cash[0], a.cash[1]);
    const npc = {
      id: 'npc' + (i + 1),
      name: names[i % names.length],
      arch: a.id,
      archName: a.name,
      tag: a.tag,
      cash,
      /** itemId -> {qty, cost} */
      stock: {},
      /** 关注的品类（偏好） */
      focus: nrng.shuffle(['cs2', 'compute', 'hardware', 'assets']).slice(0, nrng.int(1, 3)),
      /** 品牌/品类偏好度 */
      bias: {},
      bid: a.bid,
      ask: a.ask,
      greed: a.greed,
      patience: a.patience,
      vol: a.vol,
      /** 下次重组的游戏小时 */
      nextRebuild: nrng.int(12, 72),
      lastActive: S.clock.hours,
      /** 挂出的买单：{id, itemId, price, qty, expires, wear} */
      bids: [],
      /** 挂出的卖单 */
      asks: [],
      seq: 1,
      mood: nrng.float(),
      trades: 0,
    };
    for (const c of npc.focus) npc.bias[c] = nrng.range(0.85, 1.35);
    seedStock(npc, rng);
    S.npcs.push(npc);
  }
  return S.npcs;
}

/** 给 NPC 填充初始库存：按现金规模决定持仓档次 */
function seedStock(npc, rng) {
  const budget = npc.cash * rng.range(0.25, 0.6);
  const n = rng.int(3, 9);
  for (let i = 0; i < n; i++) {
    const cat = rng.pick(npc.focus);
    const pool = BY_CATEGORY[cat] || ITEMS;
    // 高净值 NPC 更可能持有高端物品
    const power = clamp(Math.log10(npc.cash) - 4.6, 0.05, 1.4);
    const def = pool[rng.weightedIndex(pool.map((d) => Math.pow(0.15 + d.base, 1 - power) * (d.rarity === 'white' ? 1.1 : 1)))];
    if (!def) continue;
    const unit = def.base * rng.range(0.9, 1.1);
    const qty = unit > 20000 ? 1 : rng.int(1, unit > 2000 ? 3 : 20);
    if (unit * qty > budget) continue;
    npc.stock[def.id] = npc.stock[def.id] || { qty: 0, cost: 0 };
    const st = npc.stock[def.id];
    st.cost = (st.cost * st.qty + unit * qty) / (st.qty + qty);
    st.qty += qty;
  }
}

/** NPC 现金总量（用于衡量市场深度） */
export function totalNpcCash() {
  return S.npcs.reduce((s, n) => s + n.cash, 0);
}

export function npcsWithStock(defId) {
  return S.npcs.filter((n) => n.stock[defId] && n.stock[defId].qty > 0);
}

/** NPC 对该物品的隐含卖价 / 买价（含声望改善） */
export function npcSellOffer(npc, def) {
  const m = mstate(def.id);
  const p = m ? m.p : def.base;
  const bias = npc.bias[def.category] || 1;
  return p * npc.ask * bias;
}

export function npcBuyOffer(npc, def) {
  const m = mstate(def.id);
  const p = m ? m.p : def.base;
  const bias = npc.bias[def.category] || 1;
  const rep = 1 + repBonus();
  return p * npc.bid * bias * rep;
}

/** 市场上最优的卖价（玩家买入价）与买价（玩家卖出价） */
export function bestOffer(def) {
  let sell = null;
  let buy = null;
  for (const npc of S.npcs) {
    const s = npcSellOffer(npc, def);
    if (!sell || s < sell.price) sell = { npc, price: s };
    const b = npcBuyOffer(npc, def);
    if (!buy || b > buy.price) buy = { npc, price: b };
  }
  return { sell, buy };
}

/* ------------------------------------------------------------ 挂单簿 */

const ASK_REFRESH_HOURS = 6;

/** 重建某物品的挂单簿（NPC 卖单 / 买单），供详情页展示与成交 */
export function refreshBook(def, rng) {
  const m = mstate(def.id);
  if (!m) return;
  const mkt = m.p;
  m.asks = [];
  m.bids = [];
  // 参与者数量由流动性决定
  const depth = Math.max(1, Math.round(6 * def.liq * (1 + Math.abs(m.mom) * 3)));
  for (const npc of S.npcs) {
    const focusK = (npc.bias[def.category] || 1);
    if (!rng.chance(clamp(0.25 * focusK * def.liq, 0.02, 0.85))) continue;
    // 卖单：npc 持有则挂高一点
    if (npc.stock[def.id] && npc.stock[def.id].qty > 0 && rng.chance(0.5 * npc.patience)) {
      const q = npc.stock[def.id].qty;
      const size = Math.max(1, Math.round(q * rng.range(0.15, 0.7)));
      const price = mkt * (npc.ask + rng.range(-0.01, 0.09)) * (npc.bias[def.category] || 1);
      m.asks.push({ npcId: npc.id, price, qty: size, kind: 'npc-ask' });
    }
    // 买单：有现金就会挂，价格偏低于市价
    if (npc.cash > mkt * 2 && rng.chance(0.55 * npc.patience)) {
      const size = Math.max(1, Math.round((npc.cash * rng.range(0.02, 0.14) * def.liq) / mkt));
      const price = mkt * (npc.bid - rng.range(0, 0.06)) * (npc.bias[def.category] || 1);
      m.bids.push({ npcId: npc.id, price, qty: Math.min(size, 5000), kind: 'npc-bid' });
    }
    if (m.asks.length + m.bids.length > depth * 3) break;
  }
  m.asks.sort((a, b) => a.price - b.price);
  m.bids.sort((a, b) => b.price - a.price);
  m.asks = m.asks.slice(0, 14);
  m.bids = m.bids.slice(0, 14);
  m.bookHour = S.clock.hours;
}

/** 挂单簿是否过期 */
export function bookStale(def) {
  const m = mstate(def.id);
  if (!m) return true;
  return m.bookHour == null || S.clock.hours - m.bookHour >= ASK_REFRESH_HOURS;
}

/** 取挂单簿（按需刷新） */
export function book(def, rng) {
  if (bookStale(def)) refreshBook(def, rng);
  const m = mstate(def.id);
  const asks = m.asks.slice().sort((a, b) => a.price - b.price);
  const bids = m.bids.slice().sort((a, b) => b.price - a.price);
  return { asks, bids, mid: m.p };
}

/**
 * 从挂单簿吃单买入：逐档吃掉卖单
 * @returns {{fills:[{npc,price,qty}], total, qty, avg}}
 */
export function takeAsks(def, qty, rng) {
  book(def, rng);
  const m = mstate(def.id);
  const fills = [];
  let total = 0;
  let got = 0;
  const remaining = [];
  for (const a of m.asks) {
    if (got >= qty) {
      remaining.push(a);
      continue;
    }
    const npc = S.npcs.find((x) => x.id === a.npcId);
    if (!npc) continue;
    const n = Math.min(a.qty, qty - got);
    if (n <= 0) {
      remaining.push(a);
      continue;
    }
    const cost = n * a.price;
    fills.push({ npc, price: a.price, qty: n });
    total += cost;
    got += n;
    a.qty -= n;
    if (a.qty > 0) remaining.push(a);
    if (npc.stock[def.id]) {
      npc.stock[def.id].qty = Math.max(0, npc.stock[def.id].qty - n);
      if (npc.stock[def.id].qty === 0) delete npc.stock[def.id];
    }
    npc.cash += cost;
    npc.trades++;
  }
  m.asks = remaining;
  if (got > 0) {
    m.lastTradeHour = S.clock.hours;
    m.v += got;
  }
  return { fills, total, qty: got, avg: got ? total / got : 0 };
}

/**
 * 卖给买盘：逐档吃掉买单
 */
export function takeBids(def, qty, rng) {
  book(def, rng);
  const m = mstate(def.id);
  const fills = [];
  let total = 0;
  let got = 0;
  const remaining = [];
  for (const b of m.bids) {
    if (got >= qty) {
      remaining.push(b);
      continue;
    }
    const npc = S.npcs.find((x) => x.id === b.npcId);
    if (!npc) continue;
    const n = Math.min(b.qty, qty - got, Math.floor(npc.cash / Math.max(0.01, b.price)));
    if (n <= 0) {
      remaining.push(b);
      continue;
    }
    const value = n * b.price;
    fills.push({ npc, price: b.price, qty: n });
    total += value;
    got += n;
    b.qty -= n;
    if (b.qty > 0) remaining.push(b);
    npc.cash -= value;
    npc.stock[def.id] = npc.stock[def.id] || { qty: 0, cost: 0 };
    const st = npc.stock[def.id];
    st.cost = (st.cost * st.qty + value) / (st.qty + n);
    st.qty += n;
    npc.trades++;
  }
  m.bids = remaining;
  if (got > 0) {
    m.lastTradeHour = S.clock.hours;
    m.v += got;
  }
  return { fills, total, qty: got, avg: got ? total / got : 0 };
}

/* ------------------------------------------------------------ 周期行为 */

/** 每 tick 调用：NPC 现金恢复、库存重组、挂单簿过期清理 */
export function tickNpcs(rng, hours) {
  for (const npc of S.npcs) {
    // 现金缓慢回流（模拟持续经营）
    const a = NPC_ARCHETYPES.find((x) => x.id === npc.arch) || NPC_ARCHETYPES[0];
    const cap = a.cash[1] * 2.2;
    npc.cash = Math.min(cap, npc.cash + (cap - npc.cash) * 0.004 * (hours / 6) + cap * 0.0004);
    npc.nextRebuild -= hours / 6;
    if (npc.nextRebuild <= 0) {
      rebuildStock(npc, rng);
      npc.nextRebuild = rng.int(12, 96);
    }
    // 情绪漂移
    npc.mood = clamp(npc.mood * 0.96 + rng.gauss() * 0.08, -1, 1);
  }
}

/** NPC 重组库存：卖出不看好的，买入看好的 */
function rebuildStock(npc, rng) {
  const keys = Object.keys(npc.stock);
  const a = NPC_ARCHETYPES.find((x) => x.id === npc.arch) || NPC_ARCHETYPES[0];
  const keep = [];
  for (const id of keys) {
    const def = getItem(id);
    if (!def) continue;
    const m = mstate(def.id);
    const st = npc.stock[id];
    const price = m ? m.p : def.base;
    const pnl = price / Math.max(1e-6, st.cost) - 1;
    // 割肉型：一亏就抛；囤货型：越跌越拿；激进型：追涨杀跌
    let sellProb = 0.06;
    if (npc.arch === 'cutter') sellProb = pnl < -0.02 ? 0.55 : pnl > 0.05 ? 0.35 : 0.12;
    else if (npc.arch === 'stacker') sellProb = pnl > 0.35 ? 0.3 : 0.03;
    else if (npc.arch === 'aggressive') sellProb = pnl > 0.08 ? 0.28 : 0.1;
    else if (npc.arch === 'whale') sellProb = pnl > 0.6 ? 0.2 : 0.02;
    else if (npc.arch === 'retail') sellProb = pnl < -0.05 ? 0.3 : 0.08;
    if (rng.chance(sellProb)) {
      // 卖给市场：现金回流
      const q = st.qty;
      npc.cash += price * q * 0.96;
      delete npc.stock[id];
    } else keep.push(id);
  }
  // 买入新的标的
  const buys = rng.int(1, 4);
  for (let i = 0; i < buys; i++) {
    const cat = rng.chance(0.7) ? rng.pick(npc.focus) : rng.pick(['cs2', 'compute', 'hardware', 'assets']);
    const pool = (BY_CATEGORY[cat] || ITEMS).filter((d) => d.base < npc.cash / 6);
    if (!pool.length) continue;
    // 偏好相对锚价被低估的物品
    const def = pool[rng.weightedIndex(pool.map((d) => {
      const m = mstate(d.id);
      const discount = m ? clamp(1.4 - m.p / d.base, 0.2, 2) : 1;
      return discount;
    }))];
    if (!def) continue;
    const m = mstate(def.id);
    const price = m ? m.p : def.base;
    const budget = npc.cash * rng.range(0.04, 0.18);
    const qty = Math.max(1, Math.floor(budget / price));
    if (qty * price > npc.cash) continue;
    npc.stock[def.id] = npc.stock[def.id] || { qty: 0, cost: 0 };
    const st = npc.stock[def.id];
    st.cost = (st.cost * st.qty + price * qty) / (st.qty + qty);
    st.qty += qty;
    npc.cash -= price * qty;
  }
  bus.emit('npc-rebuild', npc);
}

/** 为拍卖挑选 NPC 出价者 */
export function auctionBidders(def, rng, n = 3) {
  const list = S.npcs.filter((x) => x.cash > def.base * 0.4);
  const out = [];
  const pool = rng.shuffle(list);
  for (const npc of pool) {
    if (out.length >= n) break;
    const bias = npc.bias[def.category] || 1;
    if (rng.chance(clamp(0.35 * bias * npc.vol, 0.05, 0.95))) out.push(npc);
  }
  return out;
}

export { NPC_ARCHETYPES, RARITY_ORDER, priceFactor, BY_RARITY };
