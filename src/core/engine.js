/**
 * MONO — 主引擎
 * 游戏时钟（可暂停 / 倍速）、每 tick 的市场推进、系统调度、事件计数器、
 * 价格提醒、离线推进、自动保存。
 */
import { TIME, ECON, MARKET, clamp, rankOf } from './const.js';
import { ITEMS, ITEM_MAP, getItem } from './catalog.js';
import { RNG } from './rng.js';
import {
  S, initMarket, mstate, newPlayer, bagCount, bagLimit, pushLedger, day, xpForLevel,
} from './state.js';
import * as market from './market.js';
import { bus, dateTimeStr, durStr, gameDate, thousands } from './util.js';
import * as inv from '../systems/inventory.js';
import * as economy from '../systems/economy.js';
import * as trade from '../systems/trade.js';
import * as auction from '../systems/auction.js';
import * as npc from '../systems/npc.js';
import * as loot from '../systems/loot.js';
import * as quest from '../systems/quest.js';
import * as save from './save.js';

const TICK_MS = 100;

export const engine = {
  rng: null,
  seed: 'mono',
  timer: 0,
  acc: 0,
  lastReal: 0,
  running: false,
  ticks: 0,
  listeners: [],
};

/* ------------------------------------------------------------ 事件计数 */

/**
 * 把总线事件翻译成任务计数器。
 * 独立成可重复调用的函数：引擎启动时调用一次，测试也可直接调用。
 */
export function wireCounters() {
  bus.on('trade', (e) => {
    if (e.side === 'sell') {
      quest.bump('sells', e.qty || 1);
      quest.daily('d_sells', e.qty || 1);
      quest.daily('d_volume', e.total || 0);
      if ((e.profit || 0) > 0) quest.bump('profitableTrades', 1);
      if (e.total) quest.daily('d_profit', Math.max(0, e.profit || 0));
    } else {
      quest.bump('buys', 1);
      quest.daily('d_buys', 1);
    }
    quest.checkAchievements();
  });
  bus.on('fill', (e) => {
    if (e.side === 'sell') {
      quest.bump('limitSells', e.qty || 1);
      quest.daily('d_limitFills', 1);
      quest.daily('d_volume', (e.price || 0) * (e.qty || 1));
      quest.bump('sells', e.qty || 1);
      quest.daily('d_sells', e.qty || 1);
    }
    quest.checkAchievements();
  });
  bus.on('draw', (list) => {
    quest.bump('draws', list.length);
    quest.daily('d_draws', list.length);
    const multi = list.length;
    if (multi >= 10) quest.bump('multi10', 1);
    if (multi >= 100) quest.bump('multi100', 1);
    quest.checkAchievements();
    checkAlerts(true);
  });
  bus.on('auction-settled', (e) => {
    quest.bump('auctionActs', 1);
    quest.checkAchievements();
  });
  bus.on('bid', () => {
    quest.bump('auctionActs', 1);
    quest.daily('d_bids', 1);
  });
  bus.on('auction', () => {
    quest.bump('auctionActs', 1);
  });
  bus.on('scrap', (n) => {
    quest.daily('d_scraps', n);
  });
  bus.on('day', () => {
    economy.resetDaily();
    quest.syncMilestones();
    quest.checkAchievements();
    autoSave();
  });
}

/* ------------------------------------------------------------ 初始化 */

export function boot(seedOrSave = null) {
  engine.seed = typeof seedOrSave === 'string' ? seedOrSave : 'mono-' + Math.floor(Math.random() * 1e9);
  engine.rng = new RNG(engine.seed);
  // 种子写入状态树：存档要记住它，才能复现同一台「市场机器」
  save.setSeed(engine.seed);
  initMarket(engine.rng);
  npc.initNpcs(engine.rng, 18);
  market.updateMood();

  // 让市场先「跑」一段时间，开局就有历史 K 线与既定价格结构
  const warm = 24 * 20; // 20 天
  for (let i = 0; i < warm / TIME.hoursPerTick; i++) {
    market.tick(engine.rng, { hours: TIME.hoursPerTick });
    auction.tickAuctions(engine.rng, TIME.hoursPerTick);
    npc.tickNpcs(engine.rng, TIME.hoursPerTick);
  }
  S.clock.hours = 24 * 20;

  // 记录起始资产基线
  S.player.stats.dayStartEquity = quest.equity();
  S.player.stats.peakEquity = quest.equity();
  quest.bump('started', 1);
  quest.checkAchievements();
  S.run.booted = true;
  bus.emit('boot', engine.seed);
  return engine.seed;
}

/** 换一台新机器（新存档） */
export function newGame(opts = {}) {
  S.player = newPlayer(opts.name || '经营者');
  S.clock.hours = 0;
  S.clock.speed = opts.speed != null ? opts.speed : 1;
  S.events = [];
  S.session = { index: { index: 1, prev: 1, history: [] }, mood: 0, dailyCandles: {}, dirty: new Set(), uiTick: 0 };
  boot(opts.seed || null);
  save.save(0);
  return S;
}

/* ------------------------------------------------------------ 循环 */

export function startLoop() {
  if (engine.running) return;
  engine.running = true;
  engine.lastReal = Date.now();
  engine.timer = setInterval(step, TICK_MS);
}

export function stopLoop() {
  engine.running = false;
  clearInterval(engine.timer);
  engine.timer = 0;
}

/** 单步（真实时间 -> 游戏时间） */
function step() {
  const now = Date.now();
  const dt = Math.min(2000, now - engine.lastReal);
  engine.lastReal = now;
  const sp = TIME.speeds[S.clock.speed] || TIME.speeds[1];
  if (!sp.ms || S.clock.speed === 0) return;
  engine.acc += dt;
  let guard = 0;
  while (engine.acc >= sp.ms && guard < 64) {
    engine.acc -= sp.ms;
    guard++;
    advance(TIME.hoursPerTick);
  }
  S.clock.playingMs += dt;
}

/**
 * 推进游戏内 hours 小时（会拆成 tick）
 */
export function advance(hours) {
  const r = engine.rng;
  const ticks = Math.max(1, Math.round(hours / TIME.hoursPerTick));
  for (let i = 0; i < ticks; i++) {
    market.tick(r, { hours: TIME.hoursPerTick });
    trade.tickOrders(r, TIME.hoursPerTick);
    auction.tickAuctions(r, TIME.hoursPerTick);
    npc.tickNpcs(r, TIME.hoursPerTick);
    engine.ticks++;
    checkAlerts(false);
  }
  S.clock.lastReal = Date.now();
  quest.syncMilestones();
  bus.emit('advanced', S.clock.hours);
}

export function setSpeed(n) {
  S.clock.speed = clamp(Math.round(n), 0, TIME.speeds.length - 1);
  engine.acc = 0;
  bus.emit('speed', S.clock.speed);
}

/* ------------------------------------------------------------ 离线推进 */

/**
 * 离线推进：根据真实时间差推进游戏时间（有上限，防止时间穿越）
 */
export function applyOffline(saveRealTime) {
  const elapsedMs = Math.max(0, Date.now() - saveRealTime);
  const speed = TIME.speeds[1].ms;
  const capHours = TIME.offlineCapDays * 24;
  const rawHours = (elapsedMs / speed) * TIME.hoursPerTick;
  const hours = Math.min(capHours, rawHours);
  if (hours < 1) return null;
  const before = quest.equity();
  const beforeHour = S.clock.hours;
  // 离线期间不做逐笔挂单结算（避免刷单），但价格照常波动
  const r = engine.rng;
  const ticks = Math.max(1, Math.min(720, Math.round(hours / (TIME.hoursPerTick * 4))));
  const per = (hours / ticks) / TIME.hoursPerTick * TIME.hoursPerTick;
  for (let i = 0; i < ticks; i++) {
    market.tick(r, { hours: per });
    npc.tickNpcs(r, per);
  }
  const after = quest.equity();
  const info = {
    ms: elapsedMs,
    hours,
    capped: rawHours > capHours,
    fromHour: beforeHour,
    toHour: S.clock.hours,
    pnl: after - before,
    equity: after,
  };
  S.player.lastOffline = info;
  S.run.offlineDays = hours / 24;
  bus.emit('offline', info);
  return info;
}

/* ------------------------------------------------------------ 价格提醒 */

export function setAlert(itemId, opt = {}) {
  const def = getItem(itemId);
  if (!def) return null;
  const m = mstate(itemId);
  S.player.alerts[itemId] = {
    above: opt.above != null && opt.above > 0 ? opt.above : null,
    below: opt.below != null && opt.below > 0 ? opt.below : null,
    base: opt.base != null ? opt.base : (m ? m.p : def.base),
    fired: null,
  };
  quest.bump('alerts', 1);
  quest.checkAchievements();
  bus.emit('alert-set', { itemId, alert: S.player.alerts[itemId] });
  return S.player.alerts[itemId];
}

export function clearAlert(itemId) {
  delete S.player.alerts[itemId];
  bus.emit('alert-set', { itemId, alert: null });
}

function checkAlerts(fromDraw) {
  for (const id in S.player.alerts) {
    const a = S.player.alerts[id];
    const m = S.market[id];
    if (!m) continue;
    const hitAbove = a.above && m.p >= a.above;
    const hitBelow = a.below && m.p <= a.below;
    if (!hitAbove && !hitBelow) continue;
    if (a.fired && S.clock.hours - a.fired < 24) continue;
    a.fired = S.clock.hours;
    const def = getItem(id);
    bus.emit('alert', {
      itemId: id,
      name: def ? def.name : id,
      price: m.p,
      up: !!hitAbove,
      target: hitAbove ? a.above : a.below,
    });
  }
}

/* ------------------------------------------------------------ 存档 */

export function saveNow(slot) {
  return save.save(slot != null ? slot : S.meta.slot);
}

export function autoSave() {
  if (S.run.paused) return;
  save.save(S.meta.slot, { silent: true });
}

/* ------------------------------------------------------------ 便捷统计 */

/** 仪表盘需要的所有数字 */
export function dashboard() {
  const st = quest.equity();
  const bagValue = st - S.player.cash;
  const stats = S.player.stats;
  const dayStart = stats.dayStartEquity || st;
  const idx = S.session.index;
  return {
    equity: st,
    cash: S.player.cash,
    bagValue,
    scrap: S.player.scrap,
    dayPnl: st - dayStart,
    dayPnlPct: dayStart ? st / dayStart - 1 : 0,
    totalPnl: st - ECON.startCash,
    realized: stats.realizedPnl,
    unrealized: bagValue - (inv.portfolioStats({ rateOf: () => 1 }).costValue || 0),
    level: S.player.level,
    xp: S.player.xp,
    xpNeed: xpForLevel(S.player.level),
    rep: S.player.rep,
    rank: rankOf(S.player.level),
    index: idx.index,
    indexChange: idx.change,
    indexChangeDay: idx.changeDay,
    mood: S.session.mood,
    moodInfo: market.mood(),
    bagCount: bagCount(),
    bagLimit: bagLimit(),
    listings: S.player.listings.length,
    buyOrders: S.player.buyOrders.length,
    auctionsLive: auction.liveAuctions().length,
    events: S.events,
    seed: engine.seed,
    hour: S.clock.hours,
    dateText: dateTimeStr(S.clock.hours),
    drawOdds: loot.odds(),
    canSignIn: quest.canSignIn(),
    dailyLeft: economy.dailyTradeLeft(),
    stats,
  };
}

// 循环依赖保护：save.js 需要引擎的 seed，这里在模块初始化完成后统一挂接
wireCounters();
