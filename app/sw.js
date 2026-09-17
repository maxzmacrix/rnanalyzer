/* RN Analyzer service worker – app shell precache + runtime caching of map tiles. */
const VERSION = 'rn-analyzer-v2.0.21';
const SHELL = `${VERSION}-shell`;
const TILES = `${VERSION}-tiles`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js', './js/state.js', './js/db.js', './js/i18n.js', './js/ui.js', './js/zip.js', './js/rnparser.js', './js/analysis.js',
  './js/import.js', './js/chart.js', './js/map.js', './js/device.js', './js/deviceNative.js', './js/update.js', './js/tour.js', './demo/index.json', './demo/demo-lap6.rnz', './demo/demo-lap13.rnz', './demo/demo-lap62.rnz', './js/deviceControl.js', './js/sync.js', './js/xlsx.js', './js/share.js',
  './js/views/laps.js', './js/views/analyze.js', './js/views/analyzer.js', './js/views/gforce.js', './js/views/video.js', './js/views/device.js', './js/views/devices.js', './js/views/control.js', './js/views/settings.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/icon.svg', './icons/logo.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(ASSETS.map(async (a) => { try { await c.add(new Request(a, { cache: 'reload' })); } catch (err) { console.warn('precache miss', a, err); } }));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== TILES).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles (any cross-origin image: OpenStreetMap, Esri satellite, custom provider): cache-first, bounded cache
  if (url.origin !== location.origin && (req.destination === 'image' || /tile\.openstreetmap\.org$|arcgisonline\.com$/.test(url.hostname))) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) {
          c.put(req, res.clone());
          trimCache(c, 1500);
        }
        return res;
      } catch (err) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // Same-origin app shell: stale-while-revalidate
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const cached = await c.match(req, { ignoreSearch: true });
      const network = fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { network.catch(() => {}); return cached; }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') { const idx = await c.match('./index.html'); if (idx) return idx; }
      return new Response('Offline', { status: 503 });
    })());
  }
});

async function trimCache(cache, max) {
  const keys = await cache.keys();
  if (keys.length <= max) return;
  const del = keys.slice(0, keys.length - max);
  await Promise.all(del.map((k) => cache.delete(k)));
}
