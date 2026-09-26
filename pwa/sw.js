/* Aletheia service worker: makes the app open offline once it has loaded online.
 *
 * Built by pwa/vite-plugin.ts, which fills in VERSION and PRECACHE per build.
 * - Page loads go to the network first, so a new deploy is picked up on the
 *   next open; the cached app is used only when the network fails.
 * - Built files (/assets/*, hashed names) come from the cache.
 * - /api/* (sync) is never touched: the browser handles it as if there were no
 *   service worker, so sync always talks to the server.
 */
const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const CACHE = `aletheia-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/', ...PRECACHE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('aletheia-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Any route is the single-page app, so the cached "/" stands in offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/', { cacheName: CACHE }).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request, { cacheName: CACHE }).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && url.pathname.startsWith('/assets/')) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
