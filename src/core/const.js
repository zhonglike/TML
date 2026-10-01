import { clamp } from './util.js';

/**
 * MONO — 全局常量与静态表
 * 所有模块共享的枚举、稀有度表、磨损表、货币与时间换算。
 */

export { clamp };

export const APP = {
  name: 'MONO',
  cn: '极简 · 暗黑经营模拟',
  version: '1.0.0',
  saveKey: 'mono.save.v1',
  settingsKey: 'mono.settings.v1',
  slotsKey: 'mono.slots.v1',
  saveSchema: 3,
  autosaveMs: 30000,
  /** 金币符号 */
  cur: '¥',
};

/* ------------------------------------------------------------------ 品类 */

export const CATS = {
  cs2: { id: 'cs2', name: 'CS2 饰品', short: '饰品', icon: 'crosshair' },
  compute: { id: 'compute', name: 'AI 算力资产', short: '算力', icon: 'chip' },
  hardware: { id: 'hardware', name: '电脑配件', short: '配件', icon: 'cpu' },
  assets: { id: 'assets', name: '虚拟股票 / 房产 / 收藏', short: '资产', icon: 'vault' },
};

export const CAT_LIST = Object.values(CATS);

/* ---------------------------------------------------------------- 稀有度 */

export const RARITY = {
  white: { id: 'white', cn: '普通', cs: '消费级', color: '#B0B0B0', weight: 0.6, equity: 0.5 },
  green: { id: 'green', cn: '军规', cs: '军规级', color: '#4A9E4A', weight: 0.25, equity: 0.65 },
  blue: { id: 'blue', cn: '受限', cs: '受限级', color: '#5B8FD6', weight: 0.1, equity: 0.78 },
  purple: { id: 'purple', cn: '保密', cs: '保密级', color: '#8B5FBF', weight: 0.03, equity: 0.88 },
  gold: { id: 'gold', cn: '隐秘', cs: '隐秘级', color: '#D4A843', weight: 0.015, equity: 0.94 },
  red: { id: 'red', cn: '罕见', cs: '罕见级', color: '#C0392B', weight: 0.005, equity: 1.0 },
};

export const RARITY_ORDER = ['white', 'green', 'blue', 'purple', 'gold', 'red'];
export const RARITY_RANK = RARITY_ORDER.reduce((m, k, i) => ((m[k] = i), m), {});

/* -------------------------------------------------------------- 磨损度 */

export const WEARS = [
  { id: 'FN', cn: '崭新出厂', en: 'Factory New', min: 0.0, max: 0.07, scale: 1.0 },
  { id: 'MW', cn: '略有磨损', en: 'Minimal Wear', min: 0.07, max: 0.15, scale: 0.68 },
  { id: 'FT', cn: '久经沙场', en: 'Field-Tested', min: 0.15, max: 0.38, scale: 0.42 },
  { id: 'WW', cn: '破损不堪', en: 'Well-Worn', min: 0.38, max: 0.45, scale: 0.3 },
  { id: 'BS', cn: '战痕累累', en: 'Battle-Scarred', min: 0.45, max: 1.0, scale: 0.22 },
];

export const WEAR_BY_ID = WEARS.reduce((m, w) => ((m[w.id] = w), m), {});

/** float -> 磨损档位 */
export function wearOf(float) {
  for (const w of WEARS) if (float >= w.min && float < w.max) return w;
  return WEARS[WEARS.length - 1];
}

/** float 与档位中值的偏离度（0..1，越小越“干净”），用于价格微调 */
export function floatQuality(float, wear) {
  const w = wear || wearOf(float);
  const span = Math.max(1e-6, w.max - w.min);
  return 1 - Math.min(1, Math.max(0, (float - w.min) / span));
}

/* ------------------------------------------------------------------ 时间 */

export const TIME = {
  /** 一次引擎 tick 推进的游戏小时数 */
  hoursPerTick: 6,
  /** 每种速度档每 tick 的真实毫秒数 */
  speeds: [
    { id: 0, label: '暂停', ms: 0 },
    { id: 1, label: '1×', ms: 1600, cn: '1 秒 ≈ 6 小时' },
    { id: 2, label: '2×', ms: 800, cn: '1 秒 ≈ 12 小时' },
    { id: 3, label: '4×', ms: 400, cn: '1 秒 ≈ 1 天' },
    { id: 4, label: '8×', ms: 200, cn: '1 秒 ≈ 2 天' },
  ],
  /** 挂单/拍卖的结算统一以游戏小时推进 */
  listingHours: 72,
  auctionHours: 48,
  /** 离线推进上限（游戏天） */
  offlineCapDays: 30,
};

/* ------------------------------------------------------------------ 经济 */

export const ECON = {
  startCash: 5000,
  startLevel: 1,
  /** 单抽价格 */
  drawPrice: 1000,
  multi10: 0.9,
  multi100: 0.85,
  /** 保底：连续 N 抽未出金后第 N+1 抽起提升金/红概率 */
  pitySoft: 20,
  pityBoost: 3,
  pityHard: 90,
  /** 回收商基础折价（对锚价的百分比）；随等级与声望收窄，但永远保留折价 */
  recycleBase: 0.55,
  recyclePerLevel: 0.0045,
  recycleMax: 0.82,
  /**
   * 稀有度折价系数：回收商对高价品杀价更狠（真实二手市场的常态），
   * 同时也让「红色/金色物件必须走市场才能兑现」成为核心玩法。
   */
  recycleTier: { white: 1.0, green: 0.95, blue: 0.88, purple: 0.76, gold: 0.55, red: 0.32 },
  /** 一口价交易手续费 */
  feeBase: 0.06,
  feePerLevel: 0.0025,
  feeMin: 0.01,
  /** 挂单费率 */
  listFee: 0.005,
  /** 拍卖佣金 */
  auctionFee: 0.05,
  /** 声望对买价/卖价的改善（最高 6%） */
  repPriceBonus: 0.06,
  repPerTrade: 0.35,
  repDecayHours: 240,
  /** 背包 */
  bagBase: 60,
  bagPerLevel: 3,
  /** 挂单位 */
  listingsBase: 3,
  listingsPerLevel5: 1,
  /** 拍卖位 */
  auctionSlotsBase: 1,
  /** 每日签到 */
  dailyBase: 1200,
  dailyStreakBonus: 300,
  dailyStreakCap: 7,
  /** 等级经验：交易流水 / 抽奖 / 卖出利润 换算 */
  xpPerTradeVolume: 0.002,
  xpPerDraw: 1,
  xpPerProfit: 0.01,
  xpBase: 120,
  xpGrowth: 1.28,
  maxLevel: 60,
  /** 防刷 */
  dailyTradeCap: 400,
  /** 巨量买/卖的价格冲击系数 */
  impact: 0.0009,
  impactDecay: 0.94,
};

/* --------------------------------------------------------------- 市场模型 */

export const MARKET = {
  /** 每个 tick 的基准随机游走方差 */
  sigma: 0.012,
  /** 均值回归速度（相对锚价） */
  revert: 0.008,
  /** 趋势动量衰减 */
  trendDecay: 0.995,
  /** 价格相对锚价的最小/最大倍数 */
  floorMult: 0.18,
  ceilMult: 5.5,
  /** 情绪 -> 波动放大 */
  moodVol: 0.6,
  /** 每 tick 全局事件触发概率 */
  eventChance: 0.02,
  /** 玩家/大单价格冲击的残留衰减 */
  impactDecay: 0.93,
  /** 单件物品每 tick 的成交笔数范围 */
  tradesMin: 0,
  tradesMax: 9,
  /** K 线保留天数 */
  candleDays: 180,
};

/** 事件类别（用于 UI 与筛选） */
export const EVENT_KINDS = {
  cs2: '饰品',
  compute: '算力',
  hardware: '硬件',
  assets: '资产',
  macro: '宏观',
  item: '单品',
};

/* ---------------------------------------------------------------- 市场情绪 */

export const MOODS = [
  { min: -1.0, id: 'panic', cn: '恐慌', en: 'PANIC' },
  { min: -0.55, id: 'fear', cn: '悲观', en: 'FEAR' },
  { min: -0.2, id: 'weak', cn: '偏弱', en: 'WEAK' },
  { min: 0.2, id: 'calm', cn: '平静', en: 'CALM' },
  { min: 0.55, id: 'warm', cn: '偏热', en: 'WARM' },
  { min: 1.01, id: 'mania', cn: '狂热', en: 'MANIA' },
];

export function moodOf(v) {
  for (const m of MOODS) if (v < m.min) return m;
  return MOODS[MOODS.length - 1];
}

/* ------------------------------------------------------------------ NPC */

export const NPC_ARCHETYPES = [
  {
    id: 'conservative',
    name: '保守型',
    tag: '低风险',
    bid: 0.9,
    ask: 1.16,
    greed: 0.2,
    patience: 0.85,
    vol: 0.5,
    cash: [90000, 260000],
  },
  {
    id: 'aggressive',
    name: '激进型',
    tag: '追涨',
    bid: 1.03,
    ask: 1.09,
    greed: 0.35,
    patience: 0.35,
    vol: 1.5,
    cash: [120000, 400000],
  },
  {
    id: 'stacker',
    name: '囤货型',
    tag: '长持',
    bid: 0.96,
    ask: 1.28,
    greed: 0.6,
    patience: 0.95,
    vol: 0.7,
    cash: [200000, 800000],
  },
  {
    id: 'cutter',
    name: '割肉型',
    tag: '急售',
    bid: 0.82,
    ask: 1.04,
    greed: 0.1,
    patience: 0.15,
    vol: 1.2,
    cash: [40000, 150000],
  },
  {
    id: 'whale',
    name: '庄家型',
    tag: '控盘',
    bid: 1.06,
    ask: 1.35,
    greed: 0.75,
    patience: 0.8,
    vol: 1.8,
    cash: [900000, 4200000],
  },
  {
    id: 'retail',
    name: '散户型',
    tag: '跟风',
    bid: 0.88,
    ask: 1.12,
    greed: 0.15,
    patience: 0.4,
    vol: 1.0,
    cash: [20000, 90000],
  },
];

/**
 * NPC 网名池。
 * 统一是「网名」而不是真名：多数带 **** 脱敏段，混合中文梗、字母数字、
 * 全角符号，覆盖早期互联网到当代各种风格。id 型的由 npc.js 追加后缀保证唯一。
 */
export const NPC_NAMES = [
  // === 脱敏型（主）：xxx****xxx ===
  '深夜挂单****人', 'AK不****了', '老陈****出货', '摸鱼****大师', '白手****套',
  '半仓****看戏', '缺货****中', '接盘****侠', '囤货****王', '割肉****手',
  '盘口****观察', '雪球****越滚', '长线****君', '冷启****动', '深呼吸****中',
  '光头****强', '一手********货源', '半夜****挂单', '明早****再看', '下班****再战',
  '我不****是韭菜', '再来****一把', '最后****一单', '稳如****老狗', '梭哈****算了',
  '清仓****跑路', '满仓****等涨', '追高****必死', '抄底****有风险', '本金****安全',
  '仓库****已满', '钱包****空空', '运气****用完了', '这波****稳了', '跌了****就买',
  '涨了****就卖', '手里****有货', '看盘****到天亮', '挂单****等成交', '成交****一瞬间',
  // === 字母数字型（混入 ****，避免直接是真实品牌/人名） ===
  'k1ng****maker', 'm0ney****flow', 'Nova****Trader', 'Zeno****_x', 'Lucid****dream',
  'null****ptr', 'grey****hat', 'echo****o_O', 'zero****sum', 'delta****one',
  'alpha****bet', 'quant****99', 'whale****_01', 'pump****dump', 'hodl****4ever',
  // === 符号型（中日韩网络风）===
  '轻舞****飞扬', '孤影****随行', '风过****无痕', '一叶****知秋', '月下****独酌',
  '深夜****食堂', '不晚****不早', '路过的****风', '沉默的****大多数', '下雨****收摊',
];


/* --------------------------------------------------------------- 成就/任务 */

export const XP_RANKS = [
  { lv: 1, cn: '散户' }, { lv: 4, cn: '倒爷' }, { lv: 8, cn: '小贩' },
  { lv: 12, cn: '摊主' }, { lv: 18, cn: '店主' }, { lv: 25, cn: '批发商' },
  { lv: 33, cn: '庄家' }, { lv: 42, cn: '大玩家' }, { lv: 52, cn: '资本' },
];

export function rankOf(level) {
  let r = XP_RANKS[0].cn;
  for (const x of XP_RANKS) if (level >= x.lv) r = x.cn;
  return r;
}

/** 偏好排序（背包 / 市场共用的排序键） */
export const SORTS = [
  { id: 'price-desc', cn: '价格 ↓' },
  { id: 'price-asc', cn: '价格 ↑' },
  { id: 'rarity-desc', cn: '稀有度 ↓' },
  { id: 'change-desc', cn: '涨幅 ↓' },
  { id: 'change-asc', cn: '跌幅 ↓' },
  { id: 'name', cn: '名称' },
  { id: 'volume-desc', cn: '热度 ↓' },
  { id: 'qty-desc', cn: '持有数量 ↓' },
];
