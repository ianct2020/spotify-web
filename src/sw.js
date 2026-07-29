// Service worker de Fonoteca (PWA).
// Estrategia:
// - Cross-origin (Spotify API, iTunes, Last.fm, tapas): va directo a la red, no se toca.
// - Navegaciones (index.html): red primero para agarrar el ?v= nuevo apenas se
//   deploya; cache solo si no hay red (modo offline).
// - Estáticos same-origin (css/js/assets/data): stale-while-revalidate. Como
//   todos los imports van versionados con ?v=N, cada deploy son URLs nuevas y
//   nunca se sirve JS viejo; el ?v= anterior queda huérfano y se limpia al
//   bumpear CACHE.

const CACHE = 'fonoteca-sw-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req))
          || (await caches.match('./index.html', { ignoreSearch: true }))
          || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(req);
    const fetching = fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => null);
    return cached || (await fetching) || Response.error();
  })());
});
