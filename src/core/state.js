/**
 * MONO — 全局状态
 * 单一可变状态树。所有模块通过 import { S } 读写；
 * 所有写入都集中在 engine / 各 system 模块内，UI 只读 + 发指令。
 */
import { APP, ECON, TIME, MARKET } from './const.js';
import { ITEMS } from './catalog.js';
import { clamp } from './util.js';

/** 新建玩家档案 */
export function newPlayer(name = '经营者') {
  return {
    name,
    cash: ECON.startCash,
    level: 1,
    xp: 0,
    rep: 0,
    createdAt: Date.now(),
    /** 背包：instId -> instance */
    bag: {},
    bagSeq: 1,
    /** 挂单 / 买单 */
    listings: [],
    buyOrders: [],
    orderSeq: 1,
    /** 拍卖 */
    auctions: [],
    auctionSeq: 1,
    /** 交易流水（保留最近 500 条） */
    ledger: [],
    ledgerSeq: 1,
    /** 统计 */
    stats: {
      draws: 0, spentOnDraws: 0, sellVolume: 0, buyVolume: 0, realizedPnl: 0,
      wins: 0, losses: 0, feesPaid: 0, bestTrade: 0, worstTrade: 0,
      redsFound: 0, goldsFound: 0, trades: 0, auctionsWon: 0, auctionsLost: 0,
      maxEquity: ECON.startCash, minEquity: ECON.startCash, dayStartEquity: ECON.startCash,
      peakEquity: ECON.startCash, maxDrawdown: 0,
    },
    /** 每日签到 / 每日限流 */
    daily: { lastSignDay: -1, streak: 0, tradesToday: 0, day: 0, quests: {}, resetDay: -1 },
    /** 任务链进度 */
    quests: { chain: 0, completed: [], daily: {}, counter: {} },
    /** 成就 */
    achievements: {},
    /** 价格提醒 itemId -> {above, below} */
    alerts: {},
    /** 抽奖计数（保底） */
    pity: { sinceGold: 0, sinceRed: 0, total: 0 },
    /** 已解锁的图鉴（见过的物品） */
    seen: {},
    /** 熔炼材料 */
    scrap: 0,
    /** 标记：首次进入的引导进度 */
    tutorial: { step: 0, done: false },
    /** 离线结算的提示缓存 */
    lastOffline: null,
  };
}

export const S = {
  /** 存档元信息 */
  meta: { slot: 0, savedAt: 0, schema: APP.saveSchema, checksum: '' },
  /** 真实时间 -> 游戏时间 */
  clock: {
    hours: 0,
    speed: 1,
    lastReal: Date.now(),
    startedAt: Date.now(),
    playingMs: 0,
  },
  player: newPlayer(),
  /** playerside 市场状态：itemId -> mstate */
  market: {},
  npcs: [],
  events: [],
  settings: {
    sound: true,
    haptics: true,
    lum: 'default',
    motion: 'on',
    confirmTrade: true,
    numbersRoll: true,
    compact: false,
    tutorialSeen: false,
  },
  /** 会话级（不存档） */
  session: {
    index: { index: 1, prev: 1, history: [] },
    /** 资产净值历史（每天一根，供交易记录页画曲线） */
    equity: [],
    mood: 0,
    dailyCandles: {},
    dirty: new Set(),
    uiTick: 0,
  },
  /** 运行状态 */
  run: { paused: false, booted: false, offlineDays: 0 },
};

/* ------------------------------------------------------------ 市场状态 */

export function newMarketState(def, rng) {
  // 初始价格围绕锚价小幅随机（±12%），避免所有物品同一起跑线
  const jitter = rng ? 0.88 + rng.float() * 0.24 : 1;
  const price = clamp(def.base * jitter, def.min, def.max);
  return {
    p: price,
    o: price,
    h: price,
    l: price,
    c: price,
    /** 当天累计成交量 */
    v: 0,
    /** 累计涨跌（相对锚价） */
    mom: 0,
    /** 趋势强度 */
    trend: 0,
    trendLeft: 0,
    /** 玩家净流向记忆（正 = 玩家在买，推涨） */
    flow: 0,
    /** 当日/累计成交笔数 */
    trades: 0,
    vol24: 0,
    volLast: 0,
    /** 大单冲击残留 */
    impact: 0,
    /** 事件临时乘数 */
    event: 1,
    eventLeft: 0,
    /** 挂单簿（由 npc 模块维护） */
    bids: [],
    asks: [],
    /** 最后成交时间（游戏小时） */
    lastTradeHour: 0,
  };
}

export function initMarket(rng) {
  S.market = {};
  for (const def of ITEMS) S.market[def.id] = newMarketState(def, rng);
  S.session.dailyCandles = {};
}

/** 取市场状态（保证存在） */
export function mstate(itemId) {
  let m = S.market[itemId];
  if (!m) {
    const def = ITEMS.find((x) => x.id === itemId);
    if (!def) return null;
    m = newMarketState(def, null);
    S.market[itemId] = m;
  }
  return m;
}

/* ------------------------------------------------------------ 便捷读取 */

export const hour = () => S.clock.hours;
export const day = () => Math.floor(S.clock.hours / 24);
export const player = () => S.player;

/** 背包物品数量 */
export function bagCount() {
  let n = 0;
  const bag = S.player.bag;
  for (const k in bag) n += bag[k].qty;
  return n;
}

/** 背包上限 */
export function bagLimit() {
  return ECON.bagBase + (S.player.level - 1) * ECON.bagPerLevel;
}

/** 挂单上限 */
export function listingLimit() {
  return ECON.listingsBase + Math.floor(S.player.level / 5) * ECON.listingsPerLevel5;
}

/** 拍卖位 */
export function auctionLimit() {
  return ECON.auctionSlotsBase + Math.floor(S.player.level / 12);
}

export function xpForLevel(level) {
  return Math.round(ECON.xpBase * Math.pow(ECON.xpGrowth, level - 1));
}

export function addXp(n) {
  const p = S.player;
  if (p.level >= ECON.maxLevel) return 0;
  p.xp += n;
  let ups = 0;
  while (p.level < ECON.maxLevel && p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    ups++;
  }
  return ups;
}

/** 当前档位的费率与折价 */
export function feeRate() {
  return Math.max(ECON.feeMin, ECON.feeBase - (S.player.level - 1) * ECON.feePerLevel);
}

export function recycleRate() {
  const repBonus = Math.min(ECON.repPriceBonus, S.player.rep / 4000);
  return Math.min(
    ECON.recycleMax,
    ECON.recycleBase + (S.player.level - 1) * ECON.recyclePerLevel + repBonus,
  );
}

/** 声望对报价的改善（0 ~ +6%） */
export function repBonus() {
  return Math.min(ECON.repPriceBonus, Math.log10(1 + S.player.rep / 50) * 0.03);
}

/** 完成一笔交易后记录（供统计/报表） */
export function pushLedger(entry) {
  const p = S.player;
  entry.id = p.ledgerSeq++;
  entry.hour = Math.round(S.clock.hours);
  p.ledger.unshift(entry);
  if (p.ledger.length > 500) p.ledger.length = 500;
  return entry;
}

/** 会话内标记某物品价格变化（UI 增量刷新） */
export function markDirty(itemId) {
  S.session.dirty.add(itemId);
  if (S.session.dirty.size > 4000) S.session.dirty.clear();
}

export { MARKET };
