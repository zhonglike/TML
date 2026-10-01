/**
 * MONO — IndexedDB 层
 * 只用于两类大数据：K 线历史、多档存档快照。
 * 全部接口在 IndexedDB 不可用时降级为内存实现，游戏仍可运行（只是不持久）。
 */

const DB_NAME = 'mono-db';
const DB_VER = 1;
const ST_CANDLES = 'candles';
const ST_SAVES = 'saves';

const mem = {
  candles: [],
  saves: new Map(),
};

let dbp = null;
let unsupported = false;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      unsupported = true;
      reject(new Error('indexeddb unavailable'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VER);
    } catch (e) {
      unsupported = true;
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ST_CANDLES)) {
        const st = db.createObjectStore(ST_CANDLES, { keyPath: ['itemId', 'day'] });
        st.createIndex('byItem', 'itemId', { unique: false });
        st.createIndex('byDay', 'day', { unique: false });
      }
      if (!db.objectStoreNames.contains(ST_SAVES)) {
        db.createObjectStore(ST_SAVES, { keyPath: 'slot' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      unsupported = true;
      reject(req.error || new Error('idb open failed'));
    };
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const os = t.objectStore(store);
        let out;
        try {
          out = fn(os);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('tx aborted'));
      }),
  );
}

/* --------------------------------------------------------------- K 线 */

/**
 * 批量写入 [{itemId, day, o,h,l,c,v,tr}]
 */
async function putCandles(rows) {
  if (unsupported) {
    for (const r of rows) mem.candles.push(r);
    return;
  }
  try {
    await tx(ST_CANDLES, 'readwrite', (os) => {
      for (const r of rows) {
        os.put({
          itemId: r[0], day: r[1], o: r[2], h: r[3], l: r[4], c: r[5], v: r[6], tr: r[7],
        });
      }
    });
  } catch (e) {
    for (const r of rows) mem.candles.push(r);
  }
}

/** 读取某物品最近 limit 天（升序） */
async function getCandles(itemId, limit = 180) {
  if (unsupported) {
    return mem.candles.filter((r) => r.itemId === itemId).slice(-limit);
  }
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(ST_CANDLES, 'readonly');
      const idx = t.objectStore(ST_CANDLES).index('byItem');
      const req = idx.openCursor(IDBKeyRange.only(itemId), 'prev');
      const out = [];
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || out.length >= limit) {
          resolve(out.reverse());
          return;
        }
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

async function clearCandles() {
  mem.candles.length = 0;
  if (unsupported) return;
  try {
    await tx(ST_CANDLES, 'readwrite', (os) => os.clear());
  } catch (e) { /* noop */ }
}

/* --------------------------------------------------------------- 存档 */

async function saveSnapshot(slot, payload) {
  if (unsupported) {
    mem.saves.set(slot, payload);
    return false;
  }
  try {
    await tx(ST_SAVES, 'readwrite', (os) => os.put({ slot, payload, at: Date.now() }));
    return true;
  } catch (e) {
    mem.saves.set(slot, payload);
    return false;
  }
}

async function loadSnapshot(slot) {
  if (unsupported) return mem.saves.get(slot) || null;
  try {
    const rec = await tx(ST_SAVES, 'readonly', (os) => os.get(slot));
    return rec ? rec.payload : null;
  } catch (e) {
    return mem.saves.get(slot) || null;
  }
}

async function deleteSnapshot(slot) {
  mem.saves.delete(slot);
  if (unsupported) return;
  try {
    await tx(ST_SAVES, 'readwrite', (os) => os.delete(slot));
  } catch (e) { /* noop */ }
}

async function listSnapshots() {
  if (unsupported) return Array.from(mem.saves.keys()).map((slot) => ({ slot }));
  try {
    const recs = await tx(ST_SAVES, 'readonly', (os) => os.getAll());
    return (recs || []).map((r) => ({ slot: r.slot, at: r.at }));
  } catch (e) {
    return [];
  }
}

async function estimate() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try {
      const e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    } catch (err) { /* noop */ }
  }
  return { usage: 0, quota: 0 };
}

export const idb = {
  get supported() { return !unsupported; },
  putCandles,
  getCandles,
  clearCandles,
  saveSnapshot,
  loadSnapshot,
  deleteSnapshot,
  listSnapshots,
  estimate,
};
