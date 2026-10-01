/**
 * MONO — 任务 / 成就
 * 计数器在引擎里统一累加，任务与成就都是「对计数器的判定 + 领奖」，
 * 因此新增任务只需往表里加一行，不需要额外的状态机。
 */
import { ECON } from '../core/const.js';
import { getItem } from '../core/catalog.js';
import { S, addXp, pushLedger, day } from '../core/state.js';
import { bus } from '../core/util.js';
import { earn } from './economy.js';

/* --------------------------------------------------------------- 计数器 */

export function bump(key, n = 1) {
  if (!S.player.quests.counter[key]) S.player.quests.counter[key] = 0;
  S.player.quests.counter[key] += n;
  bus.emit('counter', { key, value: S.player.quests.counter[key] });
}

export function counter(key) {
  return S.player.quests.counter[key] || 0;
}

export function daily(key, n = 1) {
  if (!S.player.quests.dailyCounter) S.player.quests.dailyCounter = {};
  if (S.player.quests.dailyResetDay !== day()) {
    S.player.quests.dailyCounter = {};
    S.player.quests.dailyResetDay = day();
  }
  if (key) {
    S.player.quests.dailyCounter[key] = (S.player.quests.dailyCounter[key] || 0) + n;
    return S.player.quests.dailyCounter[key];
  }
  return S.player.quests.dailyCounter;
}

export function dayCounter(key) {
  if (S.player.quests.dailyResetDay !== day()) return 0;
  return (S.player.quests.dailyCounter || {})[key] || 0;
}

/* ------------------------------------------------------------ 新手任务链 */

export const CHAIN = [
  { id: 'c1', cn: '领取启动资金', desc: '从家族信托拿到第一笔本钱。', counter: 'started', target: 1, reward: { cash: 0, xp: 5 } },
  { id: 'c2', cn: '第一次开箱', desc: '在抽奖中心完成一次单抽。', counter: 'draws', target: 1, reward: { cash: 800, xp: 10 } },
  { id: 'c3', cn: '认识市场', desc: '打开市场总览，看一遍 K 线与涨跌榜。', counter: 'views', target: 1, reward: { cash: 500, xp: 8 } },
  { id: 'c4', cn: '第一笔交易', desc: '卖出任意一件物品（一口价或挂单）。', counter: 'sells', target: 1, reward: { cash: 1200, xp: 12 } },
  { id: 'c5', cn: '学会挂单', desc: '用挂单卖出一件物品，等 NPC 来吃单。', counter: 'limitSells', target: 1, reward: { cash: 2500, xp: 18, scrap: 200 } },
  { id: 'c6', cn: '进入拍卖行', desc: '在拍卖行出价一次，或送拍一件物品。', counter: 'auctionActs', target: 1, reward: { cash: 4000, xp: 20 } },
  { id: 'c7', cn: '理解波动', desc: '在同一物品上观察价格变化：设置一次价格提醒。', counter: 'alerts', target: 1, reward: { cash: 3000, xp: 15 } },
  { id: 'c8', cn: '完成首笔盈利交易', desc: '单笔卖出实现正收益。', counter: 'profitableTrades', target: 1, reward: { cash: 8000, xp: 30, scrap: 500 } },
  { id: 'c9', cn: '十连首秀', desc: '完成一次十连抽。', counter: 'multi10', target: 1, reward: { cash: 6000, xp: 25 } },
  { id: 'c10', cn: '资产过十万', desc: '总资产（现金 + 持仓市值）突破 10 万。', counter: 'equity100k', target: 1, reward: { cash: 20000, xp: 60, scrap: 1500 } },
  { id: 'c11', cn: '第一把红装', desc: '抽到或买下一件红色（罕见级）物品。', counter: 'redOwned', target: 1, reward: { cash: 50000, xp: 120 } },
  { id: 'c12', cn: '资产过百万', desc: '总资产突破 100 万。', counter: 'equity1m', target: 1, reward: { cash: 200000, xp: 300, scrap: 8000 } },
];

/* -------------------------------------------------------------- 每日任务 */

export const DAILY_POOL = [
  { id: 'd-draw5', cn: '开箱 5 次', counter: 'd_draws', target: 5, daily: true, reward: { cash: 900, xp: 10 } },
  { id: 'd-draw20', cn: '开箱 20 次', counter: 'd_draws', target: 20, daily: true, reward: { cash: 3200, xp: 26 } },
  { id: 'd-sell5', cn: '卖出 5 件物品', counter: 'd_sells', target: 5, daily: true, reward: { cash: 1400, xp: 12 } },
  { id: 'd-sell20', cn: '卖出 20 件物品', counter: 'd_sells', target: 20, daily: true, reward: { cash: 4200, xp: 30 } },
  { id: 'd-limit3', cn: '挂单成交 3 次', counter: 'd_limitFills', target: 3, daily: true, reward: { cash: 2600, xp: 22 } },
  { id: 'd-profit', cn: '单日实现盈利 20000', counter: 'd_profit', target: 20000, daily: true, reward: { cash: 5200, xp: 34 } },
  { id: 'd-buy3', cn: '在市场上买入 3 笔', counter: 'd_buys', target: 3, daily: true, reward: { cash: 1800, xp: 14 } },
  { id: 'd-auction', cn: '参与一次拍卖出价', counter: 'd_bids', target: 1, daily: true, reward: { cash: 2200, xp: 18 } },
  { id: 'd-scrap', cn: '熔炼 20 件库存', counter: 'd_scraps', target: 20, daily: true, reward: { cash: 1500, xp: 12, scrap: 300 } },
  { id: 'd-volume', cn: '成交额达到 80000', counter: 'd_volume', target: 80000, daily: true, reward: { cash: 6400, xp: 40 } },
];

/** 当天抽到的 3 个每日任务（按日期确定性选取） */
export function dailyQuests() {
  const d = day();
  const seed = (d * 2654435761) % 2147483647;
  const idx = [];
  let x = Math.abs(seed) || 1;
  while (idx.length < 3) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const i = x % DAILY_POOL.length;
    if (!idx.includes(i)) idx.push(i);
  }
  return idx.map((i) => DAILY_POOL[i]);
}

/* ---------------------------------------------------------------- 成就 */

export const ACHIEVEMENTS = [
  { id: 'a1', cn: '第一桶金', desc: '总资产达到 10 万', check: () => equity() >= 1e5 },
  { id: 'a2', cn: '小有积蓄', desc: '总资产达到 100 万', check: () => equity() >= 1e6 },
  { id: 'a3', cn: '资本玩家', desc: '总资产达到 1000 万', check: () => equity() >= 1e7 },
  { id: 'a4', cn: '千万富翁', desc: '总资产达到 1 亿', check: () => equity() >= 1e8 },
  { id: 'a5', cn: '开箱成瘾', desc: '累计开箱 500 次', reward: { cash: 12000 }, check: () => counter('draws') >= 500 },
  { id: 'a6', cn: '千抽老手', desc: '累计开箱 2000 次', reward: { cash: 60000 }, check: () => counter('draws') >= 2000 },
  { id: 'a7', cn: '红装猎人', desc: '累计开出 3 件红色物品', reward: { cash: 80000 }, check: () => (S.player.stats.redsFound || 0) >= 3 },
  { id: 'a8', cn: '金光闪闪', desc: '累计开出 10 件金色物品', reward: { cash: 26000 }, check: () => (S.player.stats.goldsFound || 0) >= 10 },
  { id: 'a9', cn: '交易大户', desc: '累计成交 200 笔', reward: { cash: 15000 }, check: () => S.player.stats.trades >= 200 },
  { id: 'a10', cn: '手续费之痛', desc: '累计支付手续费超过 5 万', check: () => S.player.stats.feesPaid >= 50000 },
  { id: 'a11', cn: '首次垄断', desc: '同一物品持仓超过 200 件', reward: { cash: 30000 }, check: () => maxHold() >= 200 },
  { id: 'a12', cn: '硬通货收藏家', desc: '同时持有 5 件红色物品', reward: { cash: 120000 }, check: () => redCount() >= 5 },
  { id: 'a13', cn: '拍卖行常客', desc: '拍卖中标 10 次', reward: { cash: 40000 }, check: () => S.player.stats.auctionsWon >= 10 },
  { id: 'a14', cn: '从不割肉', desc: '实现盈利 100 笔且亏损不超过 10 笔', check: () => S.player.stats.wins >= 100 && S.player.stats.losses <= 10 },
  { id: 'a15', cn: '满级经营者', desc: '等级达到 30 级', reward: { cash: 200000 }, check: () => S.player.level >= 30 },
  { id: 'a16', cn: '声望经营', desc: '声望达到 5000', reward: { cash: 60000 }, check: () => S.player.rep >= 5000 },
  { id: 'a17', cn: '雪茄与香槟', desc: '单笔盈利超过 50 万', reward: { cash: 100000 }, check: () => S.player.stats.bestTrade >= 500000 },
  { id: 'a18', cn: '抗住回撤', desc: '在一次 30% 以上回撤后重新创出新高', check: () => S.player.stats.maxDrawdown >= 0.3 && equity() >= S.player.stats.peakEquity * 0.995 },
  { id: 'a19', cn: '图鉴狂人', desc: '见过 300 种不同物品', check: () => Object.keys(S.player.seen).length >= 300 },
  { id: 'a20', cn: '首富', desc: '总资产进入本地最佳记录前三', check: () => true, hidden: true },
];

function equity() {
  let v = S.player.cash;
  for (const k in S.player.bag) {
    const inst = S.player.bag[k];
    const def = getItem(inst.defId);
    if (!def) continue;
    const m = S.market[def.id];
    v += (m ? m.p : def.base) * inst.qty;
  }
  return v;
}

function maxHold() {
  const byDef = {};
  for (const k in S.player.bag) {
    const inst = S.player.bag[k];
    byDef[inst.defId] = (byDef[inst.defId] || 0) + inst.qty;
  }
  return Object.values(byDef).reduce((a, b) => Math.max(a, b), 0);
}

function redCount() {
  let n = 0;
  for (const k in S.player.bag) {
    const inst = S.player.bag[k];
    const def = getItem(inst.defId);
    if (def && def.rarity === 'red') n += inst.qty;
  }
  return n;
}

/* ------------------------------------------------------------ 判定与领奖 */

/** 通用进度查询 */
export function progressOf(q) {
  const cur = q.daily ? dayCounter(q.counter) : counter(q.counter);
  return { cur: Math.min(cur, q.target), raw: cur, target: q.target, done: cur >= q.target };
}

export function chainQuest() {
  const idx = S.player.quests.chain;
  return idx < CHAIN.length ? CHAIN[idx] : null;
}

export function chainInfo() {
  return CHAIN.map((q, i) => ({
    ...q,
    state: i < S.player.quests.chain ? 'done' : i === S.player.quests.chain ? 'active' : 'locked',
    progress: progressOf(q),
  }));
}

/** 领取奖励（返回结果，UI 负责提示） */
export function claim(id) {
  const all = CHAIN.concat(DAILY_POOL);
  const q = all.find((x) => x.id === id);
  if (!q) return { ok: false, reason: 'missing' };
  const key = q.daily ? `d:${day()}:${id}` : id;
  if (S.player.quests.completed.includes(key)) return { ok: false, reason: 'claimed' };
  const prog = progressOf(q);
  if (!prog.done) return { ok: false, reason: 'incomplete', progress: prog };
  const r = q.reward || {};
  if (r.cash) earn(r.cash, 'quest');
  if (r.scrap) S.player.scrap += r.scrap;
  if (r.xp) addXp(r.xp);
  S.player.rep += 8;
  S.player.quests.completed.push(key);
  if (!q.daily && CHAIN.some((c) => c.id === id)) {
    const idx = CHAIN.findIndex((c) => c.id === id);
    if (idx === S.player.quests.chain) S.player.quests.chain = idx + 1;
  }
  pushLedger({ type: 'quest', amount: r.cash || 0, note: `完成任务「${q.cn}」` });
  bus.emit('quest-done', q);
  return { ok: true, quest: q, reward: r };
}

/** 每日签到 */
export function signIn() {
  const d = day();
  const daily = S.player.daily;
  if (daily.lastSignDay === d) return { ok: false, reason: 'signed' };
  const cont = daily.lastSignDay === d - 1;
  daily.streak = cont ? Math.min(ECON.dailyStreakCap + 1, daily.streak + 1) : 1;
  daily.lastSignDay = d;
  const reward = ECON.dailyBase + Math.min(ECON.dailyStreakCap, daily.streak - 1) * ECON.dailyStreakBonus;
  earn(reward, 'signin');
  bump('signins');
  pushLedger({ type: 'signin', amount: reward, note: `第 ${daily.streak} 天签到` });
  bus.emit('signin', { reward, streak: daily.streak });
  return { ok: true, reward, streak: daily.streak };
}

export function canSignIn() {
  return S.player.daily.lastSignDay !== day();
}

/** 成就检测（每次交易/抽奖后调用） */
export function checkAchievements() {
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (S.player.achievements[a.id]) continue;
    let ok = false;
    try {
      ok = a.check();
    } catch (e) {
      ok = false;
    }
    if (ok) {
      S.player.achievements[a.id] = { at: S.clock.hours, atReal: Date.now() };
      const r = a.reward || {};
      if (r.cash) earn(r.cash, 'achievement');
      S.player.rep += 40;
      pushLedger({ type: 'achievement', amount: r.cash || 0, note: `达成成就「${a.cn}」` });
      unlocked.push(a);
    }
  }
  if (unlocked.length) bus.emit('achievements', unlocked);
  return unlocked;
}

export function achievementList() {
  return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: !!S.player.achievements[a.id] }));
}

/* ------------------------------------------------------------ 里程碑计数器 */

/** 引擎在关键事件后调用：把外部状态转写成计数器 */
export function syncMilestones() {
  const e = equity();
  const st = S.player.stats;
  st.maxEquity = Math.max(st.maxEquity, e);
  st.peakEquity = Math.max(st.peakEquity || 0, e);
  if (st.peakEquity > 0) {
    const dd = 1 - e / st.peakEquity;
    if (dd > (st.maxDrawdown || 0)) st.maxDrawdown = dd;
  }
  if (e >= 1e5) S.player.quests.counter.equity100k = Math.max(counter('equity100k'), 1);
  if (e >= 1e6) S.player.quests.counter.equity1m = Math.max(counter('equity1m'), 1);
  if (redCount() > 0) S.player.quests.counter.redOwned = Math.max(counter('redOwned'), 1);
  return e;
}

export { equity };
