/**
 * MONO — Service Worker
 *
 * 策略（重要，别改回缓存优先）：
 *   · 代码与文档类（HTML / JS / CSS / manifest / 种子数据）→ **网络优先**，
 *     离线时回退缓存。这样每次部署用户刷新就能拿到新版本。
 *   · 静态资源（图标等）→ 缓存优先（内容不变，省流量）。
 *   · 一旦装上新的 SW，立刻跳到 waiting 并接管，同时清掉所有旧版本缓存。
 *
 * 曾经的问题：代码用缓存优先 + 版本号固定 → 用户永远停在旧版本，刷新无效。
 */
const VERSION = 'mono-v1.1.0';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/main.js',
  './src/styles/main.css',
  './src/core/const.js',
  './src/core/util.js',
  './src/core/rng.js',
  './src/core/catalog.js',
  './src/core/state.js',
  './src/core/market.js',
  './src/core/engine.js',
  './src/core/save.js',
  './src/core/idb.js',
  './src/data/catalog-cs2.js',
  './src/data/catalog-compute.js',
  './src/data/catalog-hardware.js',
  './src/data/catalog-assets.js',
  './src/systems/loot.js',
  './src/systems/economy.js',
  './src/systems/inventory.js',
  './src/systems/trade.js',
  './src/systems/auction.js',
  './src/systems/npc.js',
  './src/systems/quest.js',
  './src/ui/ui.js',
  './src/ui/charts.js',
  './src/ui/sound.js',
  './src/ui/reel.js',
  './src/ui/views.js',
  './src/ui/views/dashboard.js',
  './src/ui/views/bag.js',
  './src/ui/views/draw.js',
  './src/ui/views/market.js',
  './src/ui/views/item.js',
  './src/ui/views/orders.js',
  './src/ui/views/auction.js',
  './src/ui/views/records.js',
  './src/ui/views/quests.js',
  './src/ui/views/settings.js',
  './assets/icons/favicon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

/** 需要「网络优先」的请求：任何会影响功能行为的东西 */
function isCodeRequest(url) {
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) return true;
  return /\.(js|mjs|css|webmanifest|json)$/i.test(url.pathname);
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(
        CORE.map((url) => c.add(new Request(url, { cache: 'reload' })).catch(() => null)),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'CLEAR_CACHES') {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 代码 / 文档：网络优先，失败回退缓存，再失败回退首页
  if (isCodeRequest(url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  // 静态资源：缓存优先，命中即返回，否则取网络并缓存
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html'))),
  );
});
