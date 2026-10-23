/* ============================================================
   AgriNav Pro — Service Worker v1.0.0
   استراتيجية: Cache-First دائم (يعمل دون إنترنت بشكل دائم)
   ============================================================ */

const CACHE_VERSION = 'agrinav-v1.0.0'; // ⚠️ غيّر الرقم عند كل تحديث

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  // Leaflet
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  // Leaflet Rotate
  'https://cdn.jsdelivr.net/npm/@tomickigrzegorz/leaflet-rotate/dist/leaflet-rotate.css',
  'https://cdn.jsdelivr.net/npm/@tomickigrzegorz/leaflet-rotate/dist/leaflet-rotate.umd.min.js',
  // Font Awesome
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  // Libraries
  'https://cdn.jsdelivr.net/npm/leaflet-geometryutil@0.10.3/src/leaflet.geometryutil.js',
  'https://cdn.jsdelivr.net/npm/@turf/turf@6/turf.min.js',
  'https://cdn.jsdelivr.net/npm/nosleep.js@0.12.0/dist/NoSleep.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
];

/* ---------- INSTALL: تخزين كل الأصول مسبقاً ---------- */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const results = await Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(new Request(url, { mode: 'cors', credentials: 'omit' }))
            .catch(err => console.warn('[SW] Precache failed:', url, err.message))
        )
      );
      const failed = results.filter(r => r.status === 'rejected').length;
      console.log(`[SW] Precache done. Failed: ${failed}/${PRECACHE_URLS.length}`);
    }).then(() => self.skipWaiting())
  );
});

/* ---------- ACTIVATE: تنظيف الكاشات القديمة ---------- */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_VERSION && k.startsWith('agrinav-'))
          .map(k => { console.log('[SW] Deleting old cache:', k); return caches.delete(k); })
    )).then(() => self.clients.claim())
  );
});

/* ---------- FETCH: Cache-First دائم ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith('http')) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then((cached) => {
      if (cached) return cached;

      return fetch(req).then((response) => {
        if (!response || response.status !== 200) return response;
        if (response.type === 'opaque' && !req.url.match(/tile|png|jpg|jpeg|webp|css|js/i)) {
          return response;
        }
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => {
          cache.put(req, clone).catch(err => {
            if (err.name === 'QuotaExceededError') {
              console.warn('[SW] Cache quota exceeded, purging oldest tiles...');
              purgeOldTiles();
            }
          });
        });
        return response;
      }).catch(() => {
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

/* ---------- تنظيف بلاطات قديمة عند امتلاء الكاش ---------- */
async function purgeOldTiles() {
  const cache = await caches.open(CACHE_VERSION);
  const keys = await cache.keys();
  const tileKeys = keys.filter(r => r.url.match(/tile.*\.(png|jpg|jpeg|webp)/i));
  const toDelete = tileKeys.slice(0, Math.floor(tileKeys.length * 0.25));
  await Promise.all(toDelete.map(k => cache.delete(k)));
  console.log(`[SW] Purged ${toDelete.length} old tiles`);
}

/* ---------- رسائل من الصفحة ---------- */
self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') self.skipWaiting();

  if (type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys =>
        Promise.all(keys.map(k => caches.delete(k)))
      ).then(() => event.source?.postMessage({ type: 'CACHE_CLEARED' }))
    );
  }

  if (type === 'GET_STATS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const keys = await cache.keys();
      const tileCount = keys.filter(r => r.url.match(/tile.*\.(png|jpg|jpeg|webp)/i)).length;
      event.source?.postMessage({
        type: 'STATS_RESULT',
        payload: { total: keys.length, tiles: tileCount, version: CACHE_VERSION }
      });
    })());
  }
});