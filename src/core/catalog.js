/**
 * MONO — 物品图鉴
 * 把静态数据表标准化为运行时物品定义（含波动率、价格上下界、磨损/模板定价）。
 * 运行时所有价格都是「定义 + 市场状态」的组合，本模块只负责定义与定价规则。
 */
import { CS2 } from '../data/catalog-cs2.js';
import { COMPUTE } from '../data/catalog-compute.js';
import { HARDWARE } from '../data/catalog-hardware.js';
import { ASSETS } from '../data/catalog-assets.js';
import {
  RARITY, RARITY_RANK, WEAR_BY_ID, wearOf, floatQuality, clamp,
} from './const.js';
/** 从数组里随机取一个（此处仅为图鉴 API 的便利再导出） */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}


/** 子类型 → 品类（数据表已按品类分文件，这里补一层映射便于筛选 UI） */
const CAT_OF = {
  cs2: CS2,
  compute: COMPUTE,
  hardware: HARDWARE,
  assets: ASSETS,
};

export const CATEGORY_ORDER = ['cs2', 'compute', 'hardware', 'assets'];

/** 稀有度 → 基准周波动率 */
const VOL_BY_RARITY = { white: 0.1, green: 0.06, blue: 0.05, purple: 0.045, gold: 0.03, red: 0.025 };

/** 稀有度 → 流动性（1 = 极好出手，0.2 = 有价无市） */
const LIQ_BY_RARITY = { white: 1, green: 0.92, blue: 0.78, purple: 0.55, gold: 0.34, red: 0.2 };

export const ITEMS = [];
export const ITEM_MAP = new Map();
export const BY_CATEGORY = { cs2: [], compute: [], hardware: [], assets: [] };
export const BY_RARITY = { white: [], green: [], blue: [], purple: [], gold: [], red: [] };
export const SUBTYPES = new Map();

/**
 * 生成一个物品定义
 */
function makeItem(raw, category, seq) {
  const [id, name, subType, rarity, basePrice, extra = {}] = raw;
  const r = RARITY[rarity] || RARITY.white;
  const floatable = !!extra.float;
  const tradable = extra.vol != null;
  const volRaw = extra.vol != null
    ? extra.vol
    : VOL_BY_RARITY[rarity] * (floatable ? 1.15 : 1);
  // 每周波动率 → 每 tick(6h) 波动率：按 sqrt(时间) 缩放
  const perTick = volRaw / Math.sqrt(28);
  const it = {
    id,
    seq,
    name,
    category,
    subType,
    rarity,
    color: r.color,
    rarCn: r.cn,
    /** 市场锚价（崭新出厂 / 基准品相） */
    base: basePrice,
    min: Math.max(0.05, basePrice * (rarity === 'red' ? 0.45 : 0.18)),
    max: basePrice * (rarity === 'red' ? 2.4 : 5.5),
    /** 周波动率（展示用） */
    volWeek: volRaw,
    /** 每 tick 的 sigma */
    sigma: perTick,
    /** 流动性 0.2~1 */
    liq: LIQ_BY_RARITY[rarity] || 1,
    equity: r.equity,
    /** CS2 是否带磨损 */
    float: floatable,
    stattrak: !!extra.st,
    pattern: extra.pattern || null,
    /** 模板敏感度：多普勒 / 淬火 / 深红之网 / 大理石渐变 的价格极度依赖模板 */
    patternSensitive: !!(extra.pattern || /多普勒|淬火|深红之网|渐变大理石|渐变之色|屠夫/.test(name)),
    desc: extra.desc || '',
    unit: extra.unit || null,
    tradable,
    /** 抽奖权重：便宜的东西更容易被开出（长尾） */
    dropWeight: 1,
  };
  it.min = Math.min(it.min, it.base * 0.9);
  it.max = Math.max(it.max, it.base * 1.2);
  return it;
}

function init() {
  let seq = 0;
  for (const cat of CATEGORY_ORDER) {
    const rows = CAT_OF[cat] || [];
    for (const raw of rows) {
      const it = makeItem(raw, cat, seq++);
      ITEMS.push(it);
      ITEM_MAP.set(it.id, it);
      BY_CATEGORY[cat].push(it);
      BY_RARITY[it.rarity].push(it);
      if (!SUBTYPES.has(it.subType)) SUBTYPES.set(it.subType, []);
      SUBTYPES.get(it.subType).push(it);
    }
  }
  // 抽奖权重：以稀有度内部的中位价为基准做长尾衰减（便宜的更容易出）
  for (const rar of Object.keys(BY_RARITY)) {
    const list = BY_RARITY[rar];
    if (!list.length) continue;
    const sorted = list.slice().sort((a, b) => a.base - b.base);
    const p25 = sorted[Math.floor(sorted.length * 0.25)].base;
    const p90 = sorted[Math.floor(sorted.length * 0.9)].base;
    const mid = Math.sqrt(Math.max(0.2, p25) * Math.max(0.2, p90));
    for (const it of list) {
      // exponent 0.8：低价物品权重显著更高，但高价物品仍保持一个下限权重（有机会出货）
      it.dropWeight = clamp(Math.pow(mid / Math.max(0.2, it.base), 0.8), 0.02, 12);
    }
  }
}

init();

/* ------------------------------------------------------------------ 查询 */

export const getItem = (id) => ITEM_MAP.get(id) || null;

export function searchItems(q, opts = {}) {
  const { category, rarity, subType, limit = 0 } = opts;
  const needle = (q || '').trim().toLowerCase();
  let out = ITEMS;
  if (category && category !== 'all') out = BY_CATEGORY[category] || [];
  let list = out;
  if (rarity && rarity !== 'all') list = list.filter((x) => x.rarity === rarity);
  if (subType && subType !== 'all') list = list.filter((x) => x.subType === subType);
  if (needle) {
    list = list.filter(
      (x) => x.name.toLowerCase().includes(needle) || x.id.includes(needle) || x.subType.includes(needle),
    );
  }
  return limit ? list.slice(0, limit) : list;
}

export function sortItems(list, sortId, priceOf = null, extra = null) {
  const arr = list.slice();
  const p = priceOf || ((x) => x.base);
  const e = extra || (() => 0);
  switch (sortId) {
    case 'price-desc': return arr.sort((a, b) => p(b) - p(a));
    case 'price-asc': return arr.sort((a, b) => p(a) - p(b));
    case 'rarity-desc': return arr.sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity] || p(b) - p(a));
    case 'change-desc': return arr.sort((a, b) => e(b) - e(a));
    case 'change-asc': return arr.sort((a, b) => e(a) - e(b));
    case 'volume-desc': return arr.sort((a, b) => e(b, true) - e(a, true));
    case 'qty-desc': return arr.sort((a, b) => e(b, true) - e(a, true) || p(b) - p(a));
    case 'name': return arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    default: return arr;
  }
}

/** 图鉴统计（用于 UI 展示与概率公示） */
export function stats() {
  const byCat = {};
  for (const c of CATEGORY_ORDER) {
    const l = BY_CATEGORY[c];
    byCat[c] = { count: l.length, avg: l.reduce((s, x) => s + x.base, 0) / Math.max(1, l.length) };
  }
  const byRar = {};
  for (const r of Object.keys(BY_RARITY)) {
    const l = BY_RARITY[r];
    byRar[r] = { count: l.length, avg: l.reduce((s, x) => s + x.base, 0) / Math.max(1, l.length) };
  }
  return { total: ITEMS.length, byCat, byRar };
}

/* -------------------------------------------------------- 品相 / 磨损 / 模板 */

/**
 * 生成一件实例化物品的品相信息（CS2 才有磨损）
 * @param {object} def
 * @param {number} roll 0..1 随机数
 * @param {boolean} fresh 是否偏好崭新（高稀有度掉落偏向好品相）
 */
export function rollCondition(def, roll, fresh = false) {
  if (!def.float) {
    // 非磨损物品：给一个「成色」修饰，影响 ±6% 价格
    return { wear: null, float: null, cond: fresh ? 1 : roll, tag: null };
  }
  // 高稀有度 / 偏好崭新时把 float 往低端压
  const r = fresh ? Math.pow(roll, 1.9) : Math.pow(roll, 0.85);
  const float = clamp(r, 0.0005, 0.9995);
  const w = wearOf(float);
  return { wear: w.id, float, cond: floatQuality(float, w), tag: w };
}

/** 模板碰撞值：稀有模板（蓝宝石 / 红宝石 / 完美网）的概率极低 */
export function rollPattern(def, rng, cond) {
  if (!def.patternSensitive) return { pattern: def.pattern || null, patternScore: 0.5 };
  const roll = rng ? rng.float() : Math.random();
  let score = 0.2 + Math.pow(roll, 2.6) * 0.8;
  if (cond && cond.tag && cond.tag.id === 'FN') score = Math.min(1, score + 0.08);
  return { pattern: def.pattern || null, patternScore: score };
}

/**
 * 计算此实例相对锚价的价格系数
 * 磨损档位 * 档内品相 * 暗金 * 模板
 */
export function priceFactor(def, inst) {
  let f = 1;
  if (def.float && inst && inst.wear) {
    const w = WEAR_BY_ID[inst.wear] || wearOf(inst.float);
    f *= w.scale;
    const span = Math.max(1e-6, w.max - w.min);
    const q = clamp(1 - (inst.float - w.min) / span, 0, 1);
    // 档内位置在 FN/MW 影响更大（同样崭新，0.001 与 0.069 差价巨大）
    const weight = w.id === 'FN' ? 0.85 : w.id === 'MW' ? 0.45 : 0.18;
    f *= 1 - weight * 0.42 + weight * 0.42 * Math.pow(q, 1.6);
  } else if (inst && inst.cond != null) {
    f *= 0.94 + 0.12 * clamp(inst.cond, 0, 1);
  }
  if (inst && inst.st && def.stattrak) f *= 1.32;
  if (inst && inst.patternScore != null && def.patternSensitive) {
    const s = clamp(inst.patternScore, 0, 1);
    f *= 0.72 + Math.pow(s, 3.2) * 2.1;
  }
  return f;
}

/** 实例参考价（人民币） */
export function instanceValue(def, inst, marketPrice) {
  const base = marketPrice != null ? marketPrice : def.base;
  return base * priceFactor(def, inst);
}

/** 稀有度 / 品相的展示标签 */
export function conditionLabel(inst) {
  if (!inst) return '';
  const parts = [];
  if (inst.wear) {
    const w = WEAR_BY_ID[inst.wear];
    if (w) parts.push(`${w.cn} ${w.id}`);
  }
  if (inst.st) parts.push('暗金');
  if (inst.pattern) parts.push(inst.pattern);
  return parts.join(' · ');
}

export { floatQuality, wearOf };
