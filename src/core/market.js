/**
 * MONO — 市场引擎
 * 价格 = 锚价 * (随机游走 + 趋势动量 + 均值回归 + 玩家冲击 + 事件乘数)
 * 每 tick（默认 6 游戏小时）推进一次；同时维护日 K 线、成交量、市场指数与情绪。
 */
import { ITEMS, ITEM_MAP, getItem } from './catalog.js';
import { MARKET, EVENT_KINDS, RARITY_RANK, clamp, moodOf, TIME } from './const.js';
import { S, mstate, markDirty } from './state.js';
import { bus, gameDate } from './util.js';
import { idb } from './idb.js';

/* ------------------------------------------------------------ 事件库 */

const EVENT_POOL = [
  { id: 'valve-tradeup', kind: 'cs2', cn: 'Valve 更新合成与交易规则', detail: '稀有度分布被改动，高端饰品定价体系短期失效。', mult: -0.12, dur: 96, vol: 1.5, weight: 6 },
  { id: 'major-start', kind: 'cs2', cn: 'Major 赛事开赛', detail: '玩家活跃度飙升，赛事期间饰品需求整体上移。', mult: 0.1, dur: 168, vol: 1.15, weight: 10 },
  { id: 'major-final', kind: 'cs2', cn: 'Major 决赛夜', detail: '观赛峰值带来集中开箱，低价位皮肤成交放量。', mult: 0.06, dur: 48, vol: 1.3, weight: 8 },
  { id: 'case-new', kind: 'cs2', cn: '新武器箱上线', detail: '新箱子分流资金，旧箱子皮肤短期承压。', mult: -0.07, dur: 120, vol: 1.2, weight: 9 },
  { id: 'case-retire', kind: 'cs2', cn: '武器箱停落', detail: '箱子停止掉落，存量皮肤进入长期升值通道。', mult: 0.09, dur: 240, vol: 0.9, weight: 7 },
  { id: 'streamer-ruby', kind: 'cs2', cn: '主播开出红宝石蝴蝶刀', detail: '话题冲上热搜，刀皮短期被情绪资金扫货。', mult: 0.13, dur: 36, vol: 1.6, weight: 5 },
  { id: 'hbm-squeeze', kind: 'compute', cn: '存储原厂产能转向 HBM', detail: 'GDDR 供给被挤压，消费级显卡成本全线上抬。', mult: 0.11, dur: 200, vol: 1.25, weight: 8 },
  { id: 'gpu-launch', kind: 'compute', cn: '新一代卡皇发布', detail: '上代旗舰现货价格快速松动，二手市场承压。', mult: -0.09, dur: 168, vol: 1.2, weight: 9 },
  { id: 'ai-funding', kind: 'compute', cn: 'AI 行业融资热潮', detail: '算力需求预期上修，高端加速卡一卡难求。', mult: 0.14, dur: 220, vol: 1.35, weight: 8 },
  { id: 'export-control', kind: 'compute', cn: '出口管制政策调整', detail: '特定型号合规成本上升，现货价格剧烈重估。', mult: 0.17, dur: 150, vol: 1.7, weight: 5 },
  { id: 'model-gen', kind: 'compute', cn: '新模型代际发布', detail: '上一代 Token 包与权重快速贬值。', mult: -0.1, dur: 180, vol: 1.25, weight: 8 },
  { id: 'token-war', kind: 'compute', cn: '推理价格战开打', detail: '厂商集体降价，Token 包回收价值下移。', mult: -0.13, dur: 140, vol: 1.4, weight: 7 },
  { id: 'mining-surge', kind: 'hardware', cn: '挖矿收益回升', detail: '显卡被矿工扫货，二手卡价格脱离游戏市场。', mult: 0.16, dur: 190, vol: 1.5, weight: 6 },
  { id: 'nand-cut', kind: 'hardware', cn: '存储原厂减产', detail: '固态与内存报价连续上调，整机成本上移。', mult: 0.12, dur: 210, vol: 1.2, weight: 8 },
  { id: 'platform-launch', kind: 'hardware', cn: '新平台发布', detail: '旧世代主板与 CPU 二手价格加速下行。', mult: -0.08, dur: 160, vol: 1.1, weight: 9 },
  { id: 'good-wine', kind: 'hardware', cn: '老旗舰停产引发抢购', detail: '口碑型号停产后反而涨价，二手盘惜售。', mult: 0.13, dur: 240, vol: 1.15, weight: 7 },
  { id: 'fx-shock', kind: 'macro', cn: '汇率剧烈波动', detail: '进口硬件报价被动重估，渠道价差扩大。', mult: 0.05, dur: 120, vol: 1.45, weight: 7 },
  { id: 'earnings-beat', kind: 'assets', cn: '科技股财报超预期', detail: '虚拟股与算力资产同步上涨，风险偏好回升。', mult: 0.09, dur: 96, vol: 1.2, weight: 9 },
  { id: 'earnings-miss', kind: 'assets', cn: '财报不及预期', detail: '算法与算力开支预期下修，相关资产回落。', mult: -0.09, dur: 96, vol: 1.3, weight: 9 },
  { id: 'crypto-crash', kind: 'assets', cn: '加密市场闪崩', detail: '杠杆连环清算，比特币与相关持仓大幅回撤。', mult: -0.18, dur: 72, vol: 1.9, weight: 5 },
  { id: 'crypto-melt', kind: 'assets', cn: '主流资金涌入加密', detail: '避险与投机资金推动加密封闭上涨。', mult: 0.16, dur: 120, vol: 1.7, weight: 6 },
  { id: 'policy-rate', kind: 'macro', cn: '利率政策转向', detail: '贴现率变化重估所有资产，久期长的品种波动最大。', mult: -0.06, dur: 200, vol: 1.3, weight: 8 },
  { id: 'policy-loose', kind: 'macro', cn: '流动性宽松预期', detail: '资金成本下行，投机盘活跃度提升。', mult: 0.08, dur: 200, vol: 1.25, weight: 8 },
  { id: 'metaverse-boom', kind: 'assets', cn: '虚拟世界用户激增', detail: '数字地块与虚拟商铺租金预期上修。', mult: 0.12, dur: 180, vol: 1.4, weight: 6 },
  { id: 'collectible-auction', kind: 'assets', cn: '顶级藏品拍出天价', detail: '收藏板块被重新定价，稀缺品领涨。', mult: 0.11, dur: 130, vol: 1.3, weight: 6 },
  { id: 'demand-crash', kind: 'macro', cn: '消费需求疲软', detail: '投机需求退潮，成交萎缩、折价扩大。', mult: -0.11, dur: 180, vol: 1.15, weight: 8 },
  { id: 'liquidity-tight', kind: 'macro', cn: '资金面收紧', detail: '参与者集体降杠杆，挂单堆积难以成交。', mult: -0.08, dur: 150, vol: 1.1, weight: 7 },
  { id: 'whale-dump', kind: 'item', cn: '大户集中抛售', detail: '某品类的存量被一次性砸向市场。', mult: -0.15, dur: 60, vol: 1.8, weight: 6 },
  { id: 'whale-sweep', kind: 'item', cn: '大户扫货囤积', detail: '流通盘被快速吸收，短期价格脱离基本面。', mult: 0.15, dur: 60, vol: 1.8, weight: 6 },
];

/** 事件影响的品类（macro 影响全部） */
const KIND_CATS = {
  cs2: ['cs2'],
  compute: ['compute'],
  hardware: ['hardware'],
  assets: ['assets'],
  macro: ['cs2', 'compute', 'hardware', 'assets'],
  item: null,
};

export function eventPool() {
  return EVENT_POOL;
}

/** 计算某物品此刻受事件影响的乘数贡献 */
function eventMultFor(def, hourNow) {
  let mult = 1;
  for (const e of S.events) {
    if (e.endsAt <= hourNow) continue;
    const cats = KIND_CATS[e.kind];
    const hit = cats ? cats.includes(def.category) : e.itemId === def.id;
    if (!hit) continue;
    const remain = clamp((e.endsAt - hourNow) / Math.max(1, e.dur), 0, 1);
    mult *= 1 + e.mult * Math.pow(remain, 0.6);
  }
  return mult;
}

function eventVolFor(def, hourNow) {
  let v = 1;
  for (const e of S.events) {
    if (e.endsAt <= hourNow || !e.vol) continue;
    const cats = KIND_CATS[e.kind];
    const hit = cats ? cats.includes(def.category) : e.itemId === def.id;
    if (hit) v *= e.vol;
  }
  return v;
}

/* ------------------------------------------------------------ tick */

/** 市场事件与全局总线共用 */
export const ev = bus;
export { bus };

/**
 * 推进一个 tick
 * @param {import('./rng.js').RNG} rng
 * @param {object} opt { silent, mul } 倍速时按次数连推
 */
export function tick(rng, opt = {}) {
  const { hours = TIME.hoursPerTick } = opt;
  S.clock.hours += hours;

  // 1) 事件推进与触发
  const now = S.clock.hours;
  S.events = S.events.filter((e) => e.endsAt > now);
  if (rng.chance(MARKET.eventChance * (hours / 6))) spawnEvent(rng);

  // 2) 全局情绪：波动放大 + 均值回归速度变化
  const mood = S.session.mood;
  const volK = 1 + mood * mood * MARKET.moodVol;

  // 3) 逐物品推进
  for (const def of ITEMS) {
    const m = S.market[def.id];
    if (!m) continue;
    const prev = m.p;

    // 趋势生命周期
    if (m.trendLeft <= 0) {
      // 新趋势：多数时间接近 0（横盘），少数情况出现明确方向
      const t = rng.gauss();
      m.trend = clamp(t * 0.0022, -0.012, 0.012);
      m.trendLeft = rng.int(7 * 4, 30 * 4); // 7~30 天（以 6 小时为一个单位）
    } else {
      m.trendLeft--;
      m.trend *= MARKET.trendDecay;
    }

    const eventMult = eventMultFor(def, now);
    const volBoost = eventVolFor(def, now);

    // 随机游走（几何）
    const sigma = def.sigma * volK * volBoost * (1.15 - 0.5 * def.liq);
    const shock = rng.gauss() * sigma;

    // 均值回归：价格越偏离锚价，回归越强（锚价本身也会被事件推动）
    const anchor = def.base * eventMult;
    const deviation = Math.log(m.p / anchor);
    const revert = -deviation * MARKET.revert * (1 + Math.abs(deviation) * 2.2);

    // 趋势 + 玩家冲击残留
    const impact = m.impact;
    m.impact *= MARKET.impactDecay;
    if (Math.abs(m.impact) < 1e-5) m.impact = 0;

    // 流动性阻尼：流动性差的物品更容易被一根大单打出长影线
    const liqDamp = 1.35 - 0.45 * def.liq;

    const logRet = (shock + m.trend + revert) * liqDamp + impact;
    let p = m.p * Math.exp(logRet);

    // 情绪溢价：狂热时整体上偏，恐慌时下偏
    p *= 1 + mood * 0.0012;

    const lo = def.min * (1 + (eventMult - 1) * 0.35);
    const hi = def.max * (1 + (eventMult - 1) * 0.35);
    p = clamp(p, Math.max(0.02, lo), Math.max(0.04, hi));
    m.p = p;

    // 日 K 聚合
    if (p > m.h) m.h = p;
    if (p < m.l) m.l = p;
    m.c = p;

    // 累计动量（相对锚价），用于排行榜
    m.mom = p / def.base - 1;

    // 虚拟成交：低价与高流动性物品成交更频繁
    const tradeChance = clamp(0.24 * def.liq * (1 + Math.abs(m.mom) * 2.2) * (1 + mood * 0.15), 0.02, 0.95);
    if (rng.chance(tradeChance)) {
      const base = def.rarity === 'white' ? 26 : def.rarity === 'green' ? 12 : def.rarity === 'blue' ? 7 : def.rarity === 'purple' ? 3 : 1.4;
      const n = Math.max(1, Math.round(rng.range(0.4, 1.6) * base * (1 + mood * 0.2)));
      m.v += n;
      m.trades += n;
      m.lastTradeHour = now;
    }

    if (Math.abs(m.p - prev) > 1e-9) markDirty(def.id);
  }

  // 4) 情绪推进
  updateMood();
  // 5) 指数推进：先记住上一刻点位，再重算（保证涨跌幅有正确的基准）
  S.session.index = computeIndex({ prevTick: S.session.index.index });

  const hourMark = Math.floor(S.clock.hours);
  if (hourMark % 6 === 0) ev.emit('hour', hourMark);
  if (hourMark % 24 === 0) {
    commitDay();
    ev.emit('day', Math.floor(S.clock.hours / 24));
  }
  return S.session.index;
}

/** 触发一个事件 */
export function spawnEvent(rng, forceId) {
  let pick;
  if (forceId) pick = EVENT_POOL.find((e) => e.id === forceId);
  else {
    const weights = EVENT_POOL.map((e) => e.weight);
    pick = EVENT_POOL[rng.weightedIndex(weights)];
  }
  if (!pick) return null;
  const e = {
    id: pick.id + '-' + Math.floor(S.clock.hours),
    defId: pick.id,
    kind: pick.kind,
    cn: pick.cn,
    detail: pick.detail,
    mult: pick.mult * rng.range(0.7, 1.3),
    dur: Math.round(pick.dur * rng.range(0.75, 1.3)),
    vol: pick.vol,
    startedAt: S.clock.hours,
    endsAt: S.clock.hours + Math.round(pick.dur * rng.range(0.75, 1.3)),
    itemId: null,
  };
  if (pick.kind === 'item') {
    // 单品事件：指向一个当前价位段中流动性尚可的物品
    const pool = ITEMS.filter((x) => RARITY_RANK[x.rarity] >= 2 && x.base > 500);
    const t = pool[Math.floor(rng.float() * pool.length)];
    if (t) {
      e.itemId = t.id;
      e.cn = `${t.name} 出现${pick.mult > 0 ? '扫货' : '砸盘'}`;
      e.detail = pick.detail;
    }
  }
  S.events.unshift(e);
  if (S.events.length > 40) S.events.length = 40;
  ev.emit('event', e);
  return e;
}

/** 玩家成交对价格的冲击（买卖量越大越明显） */
export function applyImpact(def, notional, dir) {
  const m = mstate(def.id);
  if (!m) return;
  // 以「该物品典型单笔规模」为基准衡量冲击
  const scale = Math.max(200, def.base * 1.2);
  const raw = (notional / scale) * 0.0016 * dir;
  m.impact = clamp(m.impact + raw, -0.12, 0.12);
  m.p = clamp(m.p * (1 + raw * 0.6), def.min, def.max);
  m.mom = m.p / def.base - 1;
  markDirty(def.id);
}

/* ------------------------------------------------------------ K 线 */

/** 把当天累计的 OHLC 落盘 */
export function commitDay() {
  const dayIdx = Math.floor(S.clock.hours / 24);
  const store = [];
  for (const def of ITEMS) {
    const m = S.market[def.id];
    if (!m) continue;
    const candle = [m.o, m.h, m.l, m.c, m.v];
    m.volLast = m.vol24;
    m.vol24 = m.v;
    S.session.dailyCandles[def.id] = candle;
    store.push([def.id, dayIdx, m.o, m.h, m.l, m.c, m.v, m.trades]);
    // 重置下一根
    m.o = m.p;
    m.h = m.p;
    m.l = m.p;
    m.v = 0;
    m.trades = 0;
    const hist = candles(def.id);
    hist.push(candle);
    if (hist.length > MARKET.candleDays) hist.shift();
  }
  if (store.length) idb.putCandles(store).catch(() => {});
  // 会话指数历史
  S.session.index.history.push(S.session.index.index);
  if (S.session.index.history.length > MARKET.candleDays * 4) S.session.index.history.shift();
  // 资产净值曲线（交易记录页使用）
  if (Array.isArray(S.session.equity)) {
    S.session.equity.push(S.player.cash + portfolioValue(null, null));
    if (S.session.equity.length > 400) S.session.equity.shift();
  }
}

const candleStore = new Map();
const candleLoaded = new Set();

export function candles(itemId) {
  if (!candleStore.has(itemId)) candleStore.set(itemId, []);
  return candleStore.get(itemId);
}

export function hasLoadedCandles(itemId) {
  return candleLoaded.has(itemId);
}

export async function loadCandles(itemId) {
  if (candleLoaded.has(itemId)) return candles(itemId);
  candleLoaded.add(itemId);
  try {
    const rows = await idb.getCandles(itemId, MARKET.candleDays);
    const arr = candles(itemId);
    for (const r of rows) {
      const ohlc = [r.o, r.h, r.l, r.c, r.v];
      const idx = r.day;
      const baseDay = idx - (rows[0] ? rows[0].day : 0);
      arr[baseDay] = ohlc;
    }
    // 压掉空洞
    const clean = arr.filter(Boolean);
    candleStore.set(itemId, clean);
  } catch (e) {
    /* 无历史时忽略 */
  }
  return candles(itemId);
}

/** 用日 K 聚合出周 K / 月 K */
export function aggregate(list, size) {
  if (size <= 1) return list;
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    const chunk = list.slice(i, i + size).filter(Boolean);
    if (!chunk.length) continue;
    const o = chunk[0][0];
    const c = chunk[chunk.length - 1][3];
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (const k of chunk) {
      if (k[1] > h) h = k[1];
      if (k[2] < l) l = k[2];
      v += k[4] || 0;
    }
    out.push([o, h, l, c, v]);
  }
  return out;
}

/** 取（可能含今日实时）的 K 线序列 */
export function series(itemId, size = 1, limit = 120) {
  const hist = candles(itemId).slice();
  const cur = S.session.dailyCandles[itemId];
  if (cur) hist.push(cur);
  const agg = aggregate(hist, size);
  return agg.slice(Math.max(0, agg.length - limit));
}

/* ------------------------------------------------------------ 指数 / 情绪 / 榜单 */

/** 指数成分：每个品类挑代表物品，覆盖各价位段 */
let indexBasket = null;
function basket() {
  if (indexBasket) return indexBasket;
  const byCat = {};
  for (const def of ITEMS) (byCat[def.category] = byCat[def.category] || []).push(def);
  const out = [];
  for (const cat in byCat) {
    const list = byCat[cat].slice().sort((a, b) => a.base - b.base);
    const picks = 14;
    for (let i = 0; i < picks; i++) {
      const idx = Math.floor((i / (picks - 1)) * (list.length - 1));
      if (list[idx]) out.push(list[idx]);
    }
  }
  indexBasket = out;
  return out;
}

/**
 * 市场指数。
 * 单位约定（重要）：`history` 存的是**指数点位**（1000 × 成分比值），
 * 不是比值本身。之前这里是比值与点位混用，导致涨跌幅显示成 ↓99.90%。
 */
export function computeIndex(opt = {}) {
  const list = basket();
  let sum = 0;
  let n = 0;
  for (const def of list) {
    const m = S.market[def.id];
    if (!m) continue;
    sum += m.p / def.base;
    n++;
  }
  const raw = n ? sum / n : 1;
  /** 指数点位：基准 1000 = 全部成分都在锚价 */
  const point = raw * 1000;
  const history = S.session.index.history;
  const prevTick = opt.prevTick != null ? opt.prevTick : S.session.index.prevTick;
  // 相对上一个 tick（主循环里展示的即时涨跌）
  const change = prevTick ? point / prevTick - 1 : 0;
  // 相对上一个已结算交易日（日涨跌）
  const lastClose = history.length ? history[history.length - 1] : null;
  const changeDay = lastClose ? point / lastClose - 1 : 0;
  return {
    index: point,
    prev: prevTick || point,
    prevTick: point,
    raw,
    change,
    changeDay,
    history,
  };
}

/** 市场情绪：由成分涨幅与成交活跃度合成 -1..1 */
export function updateMood() {
  const list = basket();
  let sum = 0;
  let n = 0;
  let volSum = 0;
  for (const def of list) {
    const m = S.market[def.id];
    if (!m) continue;
    sum += m.mom;
    volSum += m.v;
    n++;
  }
  const avg = n ? sum / n : 0;
  const volK = n ? Math.min(1, volSum / (n * 30)) : 0.5;
  const target = clamp(avg * 6 + (volK - 0.5) * 0.5, -1, 1);
  S.session.mood = clamp(S.session.mood * 0.92 + target * 0.08, -1, 1);
  return S.session.mood;
}

export function mood() {
  return moodOf(S.session.mood);
}

/** 之前价格（用于计算涨跌幅） */
export function prevPrice(itemId, hoursAgo = 24) {
  const def = getItem(itemId);
  if (!def) return null;
  const hist = candles(itemId);
  const daysBack = Math.round(hoursAgo / 24);
  if (daysBack <= 0) return S.session.dailyCandles[itemId] ? S.session.dailyCandles[itemId][0] : def.base;
  const idx = hist.length - daysBack;
  if (idx >= 0 && hist[idx]) return hist[idx][3];
  return def.base;
}

/** 某物品涨跌幅 */
export function changeOf(itemId, hoursAgo = 24) {
  const m = mstate(itemId);
  const p0 = prevPrice(itemId, hoursAgo);
  if (!m || !p0) return 0;
  return m.p / p0 - 1;
}

/** 榜单：涨幅 / 跌幅 / 成交额 */
export function rankings(opts = {}) {
  const { category = 'all', rarity = 'all', minBase = 0, limit = 20, by = 'change-desc' } = opts;
  const rows = [];
  for (const def of ITEMS) {
    if (category !== 'all' && def.category !== category) continue;
    if (rarity !== 'all' && def.rarity !== rarity) continue;
    if (def.base < minBase) continue;
    const m = S.market[def.id];
    if (!m) continue;
    rows.push({
      def,
      price: m.p,
      change: changeOf(def.id, 24),
      changeWeek: changeOf(def.id, 168),
      volume: m.vol24,
      turnover: m.vol24 * m.p,
    });
  }
  switch (by) {
    case 'change-desc': rows.sort((a, b) => b.change - a.change); break;
    case 'change-asc': rows.sort((a, b) => a.change - b.change); break;
    case 'turnover': rows.sort((a, b) => b.turnover - a.turnover); break;
    case 'volume': rows.sort((a, b) => b.volume - a.volume); break;
    case 'price-desc': rows.sort((a, b) => b.price - a.price); break;
    default: rows.sort((a, b) => b.change - a.change);
  }
  return rows.slice(0, limit);
}

/** 指数序列（用于图表） */
export function indexSeries(limit = 120) {
  const h = S.session.index.history.slice();
  h.push(S.session.index.index);
  return h.slice(Math.max(0, h.length - limit));
}

/** 估值：把所有持仓折算成人民币（按回收价 / 市价） */
export function portfolioValue(rateOf, priceOf) {
  let total = 0;
  const bag = S.player.bag;
  for (const k in bag) {
    const inst = bag[k];
    const def = ITEM_MAP.get(inst.defId);
    if (!def) continue;
    const v = priceOf ? priceOf(def, inst) : (S.market[def.id] ? S.market[def.id].p : def.base);
    total += v * inst.qty * (rateOf ? rateOf(def, inst) : 1);
  }
  return total;
}

export function resetMarket(rng) {
  S.events = [];
  S.session.mood = 0;
  S.session.index = { index: 1000, prev: 1000, history: [] };
  candleStore.clear();
  candleLoaded.clear();
  indexBasket = null;
  for (const def of ITEMS) {
    const m = S.market[def.id];
    if (!m) continue;
    m.h = m.l = m.o = m.c = m.p;
    m.v = 0;
    m.trades = 0;
    m.impact = 0;
    m.trend = 0;
    m.trendLeft = 0;
  }
}

export { EVENT_KINDS };
