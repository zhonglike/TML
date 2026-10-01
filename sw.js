/**
 * MONO — Service Worker
 * 目标：首屏极快 + 离线可玩。采用「缓存优先 + 后台更新」策略，
 * 静态资源按版本号整体失效，避免新版本与旧缓存混用。
 */
const VERSION = 'mono-v1.0.0';
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

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => Promise.all(
      CORE.map((url) => c.add(new Request(url, { cache: 'reload' })).catch(() => null)),
    )).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 价格种子：网络优先，失败回退缓存
  if (url.pathname.endsWith('prices.seed.json')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }
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
