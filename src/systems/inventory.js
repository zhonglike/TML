/**
 * MONO — 背包 / 库存
 * 物品实例（instance）是带品相的：磨损、暗金、模板分数、成本价。
 * 同一物品同一品相 + 同一成本价会被堆叠（qty）。
 */
import { getItem, priceFactor } from '../core/catalog.js';
import { S, bagCount, bagLimit, mstate, pushLedger, markDirty } from '../core/state.js';
import { WEAR_BY_ID, RARITY_RANK } from '../core/const.js';
import { uid, clamp } from '../core/util.js';

/** 实例的品相签名（用于堆叠判定） */
export function condKey(inst) {
  return [
    inst.defId,
    inst.wear || '-',
    inst.st ? 'st' : '-',
    inst.float != null ? inst.float.toFixed(4) : '-',
    inst.patternScore != null ? inst.patternScore.toFixed(3) : '-',
  ].join('|');
}

/** 简短品相标签：FN / MW / FT / WW / BS */
export function wearTag(inst) {
  if (!inst) return '';
  if (inst.wear) return inst.wear;
  return '';
}

export function makeInstance(defId, opt = {}) {
  const def = getItem(defId);
  if (!def) return null;
  return {
    defId,
    qty: opt.qty || 1,
    /** 加权平均成本（单件） */
    cost: opt.cost != null ? opt.cost : 0,
    /** 来源：draw / buy / auction / quest */
    from: opt.from || 'draw',
    at: S.clock.hours,
    wear: opt.wear || null,
    float: opt.float != null ? opt.float : null,
    st: !!opt.st,
    pattern: opt.pattern || null,
    patternScore: opt.patternScore != null ? opt.patternScore : null,
    /** 标记（锁定不出售） */
    lock: !!opt.lock,
  };
}

export function instValue(def, inst) {
  const m = mstate(def.id);
  const price = m ? m.p : def.base;
  return price * priceFactor(def, inst);
}

/** 背包条目（含实时估值），供 UI 使用 */
export function bagEntries(opts = {}) {
  const { filter = null, sort = 'price-desc', search = '' } = opts;
  const out = [];
  const bag = S.player.bag;
  for (const k in bag) {
    const inst = bag[k];
    const def = getItem(inst.defId);
    if (!def) continue;
    if (search) {
      const q = search.toLowerCase();
      if (!def.name.toLowerCase().includes(q) && !def.subType.includes(search)) continue;
    }
    if (filter && !filter(def, inst)) continue;
    const m = mstate(def.id);
    const unit = instValue(def, inst);
    const cost = inst.cost || 0;
    out.push({
      inst,
      def,
      key: k,
      price: m ? m.p : def.base,
      unitValue: unit,
      market: m,
      qty: inst.qty,
      total: unit * inst.qty,
      totalCost: cost * inst.qty,
      pnl: (unit - cost) * inst.qty,
      pnlPct: cost > 0 ? unit / cost - 1 : 0,
      change: m ? m.mom : 0,
    });
  }
  const sorters = {
    'price-desc': (a, b) => b.total - a.total,
    'price-asc': (a, b) => a.total - b.total,
    'rarity-desc': (a, b) => RARITY_RANK[b.def.rarity] - RARITY_RANK[a.def.rarity] || b.total - a.total,
    'change-desc': (a, b) => b.change - a.change,
    'change-asc': (a, b) => a.change - b.change,
    'qty-desc': (a, b) => b.qty - a.qty || b.total - a.total,
    'name': (a, b) => a.def.name.localeCompare(b.def.name, 'zh-Hans-CN'),
    'pnl-desc': (a, b) => b.pnl - a.pnl,
    'volume-desc': (a, b) => (b.market ? b.market.vol24 : 0) - (a.market ? a.market.vol24 : 0),
  };
  const key = sorters[sort];
  if (key) out.sort(key);
  return out;
}

/** 加入背包（自动堆叠），返回实例键 */
export function add(defId, opt = {}) {
  const def = getItem(defId);
  if (!def) return null;
  const inst = makeInstance(defId, opt);
  if (!inst) return null;
  const sig = condKey(inst) + '|' + Math.round(inst.cost * 100);
  let target = null;
  const bag = S.player.bag;
  for (const k in bag) {
    if (condKey(bag[k]) + '|' + Math.round(bag[k].cost * 100) === sig && !bag[k].lock) {
      target = bag[k];
      break;
    }
  }
  if (target) {
    // 加权平均成本
    const total = target.cost * target.qty + inst.cost * inst.qty;
    target.qty += inst.qty;
    target.cost = total / target.qty;
    return condKey(target);
  }
  const id = 'i' + S.player.bagSeq++;
  inst.id = id;
  bag[id] = inst;
  return id;
}

/** 移除（返回取出的实例数量） */
export function remove(key, qty = 1) {
  const inst = S.player.bag[key];
  if (!inst) return 0;
  const n = Math.min(qty, inst.qty);
  inst.qty -= n;
  if (inst.qty <= 0) delete S.player.bag[key];
  return n;
}

/** 按物品定义查找背包中可用的实例（优先成本最低的） */
export function findStack(defId, opt = {}) {
  const { wear = null, maxCost = Infinity, unstaked = true } = opt;
  let best = null;
  let bestKey = null;
  const bag = S.player.bag;
  for (const k in bag) {
    const inst = bag[k];
    if (inst.defId !== defId || inst.qty <= 0) continue;
    if (inst.lock && unstaked) continue;
    if (wear && inst.wear !== wear) continue;
    if (inst.cost > maxCost) continue;
    if (!best || inst.cost < best.cost) {
      best = inst;
      bestKey = k;
    }
  }
  return best ? { key: bestKey, inst: best } : null;
}

export function spaceLeft() {
  return bagLimit() - bagCount();
}

export function canFit(n = 1) {
  return bagCount() + n <= bagLimit();
}

/* ------------------------------------------------------------- 组合统计 */

export function portfolioStats(opts = {}) {
  const rateOf = opts.rateOf || (() => 1);
  let marketValue = 0;
  let costValue = 0;
  let count = 0;
  let best = null;
  let worst = null;
  const bag = S.player.bag;
  for (const k in bag) {
    const inst = bag[k];
    const def = getItem(inst.defId);
    if (!def) continue;
    const v = instValue(def, inst) * inst.qty;
    marketValue += v;
    costValue += (inst.cost || 0) * inst.qty;
    count += inst.qty;
    const pnl = v - (inst.cost || 0) * inst.qty;
    if (!best || pnl > best.pnl) best = { def, inst, pnl, key: k };
    if (!worst || pnl < worst.pnl) worst = { def, inst, pnl, key: k };
  }
  return {
    count,
    marketValue,
    costValue,
    unrealized: marketValue - costValue,
    recoveryValue: marketValue * rateOf(),
    best,
    worst,
    equity: S.player.cash + marketValue,
  };
}

/** 按品类 / 稀有度汇总（用于仪表盘） */
export function bagBreakdown() {
  const byCat = {};
  const byRar = {};
  const bag = S.player.bag;
  for (const k in bag) {
    const inst = bag[k];
    const def = getItem(inst.defId);
    if (!def) continue;
    const v = instValue(def, inst) * inst.qty;
    byCat[def.category] = (byCat[def.category] || 0) + v;
    byRar[def.rarity] = byRar[def.rarity] || { value: 0, count: 0 };
    byRar[def.rarity].value += v;
    byRar[def.rarity].count += inst.qty;
  }
  return { byCat, byRar };
}

/** 批量卖出（回收商 / 一口价），由 economy 调用计算价格 */
export function takeAll(keys, qtyOf) {
  const taken = [];
  for (const k of keys) {
    const inst = S.player.bag[k];
    if (!inst) continue;
    const qty = qtyOf ? Math.min(qtyOf(k), inst.qty) : inst.qty;
    if (qty <= 0) continue;
    taken.push({ key: k, inst, qty });
  }
  return taken;
}

export { RARITY_RANK };
