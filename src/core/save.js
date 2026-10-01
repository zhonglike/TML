/**
 * MONO — 存档
 * 双层持久化：
 *   1) IndexedDB：完整快照（含市场状态、NPC、背包……）
 *   2) localStorage：最新快照的同步缓存 + 槽位索引（保证冷启动可立即读档）
 * 另支持导出 / 导入 JSON 文件，以及轻量完整性校验（防手改）。
 */
import { APP } from './const.js';
import { S, newPlayer } from './state.js';
import { ITEMS } from './catalog.js';
import { hash32 } from './rng.js';
import { idb } from './idb.js';
import { bus, deepClone } from './util.js';

const LS_CACHE = (slot) => `${APP.saveKey}.cache.${slot}`;
const LS_INDEX = APP.slotsKey;

/** 需要序列化的市场字段（其余从锚价重新生成） */
const M_FIELDS = ['p', 'o', 'h', 'l', 'c', 'v', 'mom', 'trend', 'trendLeft', 'flow', 'trades', 'vol24', 'impact', 'bookHour'];

function checksum(payload) {
  return hash32(JSON.stringify(payload));
}

/* ------------------------------------------------------------------ 打包 */

export function pack() {
  const market = {};
  for (const def of ITEMS) {
    const m = S.market[def.id];
    if (!m) continue;
    market[def.id] = M_FIELDS.map((f) => m[f]);
  }
  const payload = {
    v: APP.saveSchema,
    app: APP.version,
    savedAt: Date.now(),
    seed: S.__seed || null,
    clock: {
      hours: S.clock.hours,
      speed: S.clock.speed,
      startedAt: S.clock.startedAt,
      playingMs: S.clock.playingMs,
    },
    player: S.player,
    settings: S.settings,
    market,
    /** 最近 6 天的当日 K 线（长历史在 IndexedDB） */
    daily: S.session.dailyCandles,
    events: S.events,
    npcs: S.npcs.map((n) => ({
      id: n.id, name: n.name, arch: n.arch, archName: n.archName, tag: n.tag,
      cash: n.cash, stock: n.stock, focus: n.focus, bias: n.bias,
      bid: n.bid, ask: n.ask, greed: n.greed, patience: n.patience, vol: n.vol,
      nextRebuild: n.nextRebuild, lastActive: n.lastActive, seq: n.seq, mood: n.mood, trades: n.trades,
    })),
    mood: S.session.mood,
    indexHist: S.session.index.history.slice(-240),
  };
  payload.checksum = checksum({ ...payload, checksum: undefined });
  return payload;
}

export function seedOf() {
  return S.__seed || null;
}

export function setSeed(seed) {
  S.__seed = seed;
}

/* ------------------------------------------------------------------ 写入 */

export async function save(slot = 0, opt = {}) {
  const payload = pack();
  S.meta.slot = slot;
  S.meta.savedAt = payload.savedAt;
  S.meta.schema = APP.saveSchema;
  let ok = true;
  let where = 'idb';
  try {
    const text = JSON.stringify(payload);
    localStorage.setItem(LS_CACHE(slot), text);
  } catch (e) {
    // localStorage 满了：清掉缓存，只留 IndexedDB
    try {
      localStorage.removeItem(LS_CACHE(slot));
    } catch (e2) { /* noop */ }
    where = 'idb-only';
  }
  try {
    await idb.saveSnapshot(slot, payload);
  } catch (e) {
    ok = false;
  }
  writeIndex(slot, payload, where);
  if (!opt.silent) bus.emit('saved', { slot, at: payload.savedAt, where, ok });
  return { ok, slot, at: payload.savedAt, where };
}

function writeIndex(slot, payload, where) {
  let idx = [];
  try {
    idx = JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
  } catch (e) {
    idx = [];
  }
  const meta = {
    slot,
    at: payload.savedAt,
    day: Math.floor((payload.clock ? payload.clock.hours : 0) / 24),
    level: payload.player.level,
    equity: Math.round(payload.player.cash),
    name: payload.player.name,
    where,
    app: payload.app,
  };
  const i = idx.findIndex((x) => x.slot === slot);
  if (i >= 0) idx[i] = meta;
  else idx.push(meta);
  try {
    localStorage.setItem(LS_INDEX, JSON.stringify(idx));
  } catch (e) { /* noop */ }
}

export function slotIndex() {
  try {
    return JSON.parse(localStorage.getItem(LS_INDEX) || '[]');
  } catch (e) {
    return [];
  }
}

/* ------------------------------------------------------------------ 读取 */

export function readCache(slot) {
  try {
    const text = localStorage.getItem(LS_CACHE(slot));
    return text ? JSON.parse(text) : null;
  } catch (e) {
    return null;
  }
}

/** 同步取最新存档（优先 localStorage 缓存） */
export function latestSlot() {
  const idx = slotIndex();
  if (!idx.length) return null;
  return idx.reduce((a, b) => (a.at > b.at ? a : b)).slot;
}

export async function load(slot = 0, opt = {}) {
  let payload = readCache(slot);
  if (!payload || opt.preferIdb) {
    const fromIdb = await idb.loadSnapshot(slot);
    if (fromIdb && (!payload || fromIdb.savedAt > payload.savedAt)) payload = fromIdb;
  }
  if (!payload) return { ok: false, reason: 'empty' };
  const res = apply(payload);
  return { ok: true, payload, ...res };
}

/** 把快照灌回状态树 */
export function apply(payload) {
  const warnings = [];
  if (payload.v !== APP.saveSchema) warnings.push(`存档版本 ${payload.v} 与当前 ${APP.saveSchema} 不同，已尽力兼容`);
  // 玩家
  const base = newPlayer();
  S.player = Object.assign(base, payload.player || {});
  S.player.bag = S.player.bag || {};
  S.player.listings = S.player.listings || [];
  S.player.buyOrders = S.player.buyOrders || [];
  S.player.auctions = S.player.auctions || [];
  S.player.ledger = S.player.ledger || [];
  S.player.quests = Object.assign({ chain: 0, completed: [], daily: {}, counter: {} }, S.player.quests || {});
  S.player.stats = Object.assign(base.stats, S.player.stats || {});
  S.player.daily = Object.assign(base.daily, S.player.daily || {});
  S.player.pity = Object.assign(base.pity, S.player.pity || {});
  // 时钟
  const c = payload.clock || {};
  S.clock.hours = c.hours || 0;
  S.clock.speed = c.speed != null ? c.speed : 1;
  S.clock.startedAt = c.startedAt || Date.now();
  S.clock.playingMs = c.playingMs || 0;
  // 市场
  const mk = payload.market || {};
  for (const def of ITEMS) {
    const row = mk[def.id];
    const m = S.market[def.id];
    if (!m) continue;
    if (!row) continue;
    M_FIELDS.forEach((f, i) => {
      if (row[i] !== undefined) m[f] = row[i];
    });
    if (!m.p || m.p <= 0) m.p = def.base;
  }
  // NPC
  if (Array.isArray(payload.npcs) && payload.npcs.length) {
    S.npcs = payload.npcs.map((n) => Object.assign({ bids: [], asks: [], stock: {} }, n));
  }
  S.events = Array.isArray(payload.events) ? payload.events : [];
  S.session.dailyCandles = payload.daily || {};
  S.session.mood = payload.mood || 0;
  S.session.index = { index: 1000, prev: 1000, history: payload.indexHist || [] };
  if (payload.settings) S.settings = Object.assign(S.settings, payload.settings);
  S.__seed = payload.seed || null;
  S.meta.slot = payload.slot || 0;
  S.meta.savedAt = payload.savedAt || 0;
  const expect = payload.checksum;
  if (expect) {
    const now = checksum({ ...payload, checksum: undefined });
    if (now !== expect) warnings.push('存档校验不一致（可能被外部修改过），已继续载入');
  }
  bus.emit('loaded', { warnings });
  return { warnings };
}

export async function remove(slot) {
  try {
    localStorage.removeItem(LS_CACHE(slot));
  } catch (e) { /* noop */ }
  await idb.deleteSnapshot(slot);
  let idx = slotIndex().filter((x) => x.slot !== slot);
  try {
    localStorage.setItem(LS_INDEX, JSON.stringify(idx));
  } catch (e) { /* noop */ }
}

export async function clearAll() {
  for (const s of [0, 1, 2]) await remove(s);
  try {
    localStorage.removeItem(LS_INDEX);
  } catch (e) { /* noop */ }
}

/* ------------------------------------------------------------ 导入 / 导出 */

export function exportBlob() {
  const payload = pack();
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

/** 存档文件名：带上游戏内天数与等级，方便在手机的「文件」里认出来 */
export function saveFileName() {
  const p = pack();
  const d = Math.floor((p.clock ? p.clock.hours : 0) / 24) + 1;
  const ymd = new Date().toISOString().slice(0, 10);
  return `MONO-存档-第${d}天-Lv${p.player.level}-${ymd}.json`;
}

export function downloadSave(name) {
  const blob = exportBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name || saveFileName();
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** 存档体积（字节），用于界面提示 */
export function saveSize() {
  try {
    return JSON.stringify(pack()).length;
  } catch (e) {
    return 0;
  }
}

/**
 * 手机首选：走系统分享面板，可以直接「存到文件」或发到自己的聊天窗口。
 * 浏览器不支持 Web Share 时回退成普通下载。
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareSave() {
  const name = saveFileName();
  try {
    const blob = exportBlob();
    const file = new File([blob], name, { type: 'application/json' });
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'MONO 存档', text: 'MONO 存档备份' });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  downloadSave(name);
  return 'downloaded';
}

export async function importText(text, slot = 0) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'json' };
  }
  if (!payload || !payload.player || !payload.market) return { ok: false, reason: 'shape' };
  apply(payload);
  await save(slot, { silent: true });
  return { ok: true, warnings: [] };
}

export function importFile(file, slot = 0) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => {
      importText(String(fr.result), slot).then(resolve);
    };
    fr.onerror = () => resolve({ ok: false, reason: 'read' });
    fr.readAsText(file, 'utf-8');
  });
}

/** 本地最佳记录 */
const LS_BEST = 'mono.best.v1';
export function bestRecords() {
  try {
    return JSON.parse(localStorage.getItem(LS_BEST) || '[]');
  } catch (e) {
    return [];
  }
}

export function pushBest(entry) {
  const list = bestRecords();
  list.push({ ...entry, at: Date.now() });
  list.sort((a, b) => b.equity - a.equity);
  const top = list.slice(0, 10);
  try {
    localStorage.setItem(LS_BEST, JSON.stringify(top));
  } catch (e) { /* noop */ }
  return top;
}

/** 存档大小估算（用于设置页展示） */
export async function usage() {
  const est = await idb.estimate();
  let ls = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('mono.')) continue;
      ls += (localStorage.getItem(k) || '').length * 2;
    }
  } catch (e) { /* noop */ }
  return { ...est, localBytes: ls };
}

export { deepClone };
