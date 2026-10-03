// Service worker de Fonoteca (PWA).
//
// Qué hace, de verdad:
// - Cross-origin (Spotify API, iTunes, Last.fm, tapas): no se toca, va directo a
//   la red.
// - Navegaciones: `fetch(req)` primero y, solo si falla, la copia guardada
//   (modo offline). Las que llevan query no se guardan nunca (v=258: la de
//   `callback.html?code=…` es el código PKCE del login). OJO: ese `fetch` pasa por la caché HTTP del navegador, y
//   GitHub Pages manda `cache-control: max-age=600`, así que hasta 10 minutos
//   después de un deploy puede salir el `index.html` VIEJO sin haber tocado la
//   red. «Red primero» es red-primero-salvo-caché-HTTP, no «siempre fresco».
//   Medido el 2026-09-29 en Chrome contra un servidor con esas cabeceras: una
//   navegación normal tras el deploy muestra el index viejo con 0 peticiones,
//   igual que SIN service worker; solo F5 revalida. Por eso el ritual de
//   verificación necesita el `?frio=N` (URL nueva = otra clave de caché HTTP).
//   Con `fetch(req, { cache: 'no-cache' })` la misma prueba da el index nuevo
//   con una petición condicional; no está aplicado.
// - Estáticos same-origin: stale-while-revalidate. Si hay copia se sirve ESA, y
//   la red solo refresca la copia para la vez siguiente. Como los imports y
//   las hojas de estilo llevan `?v=N` (lo escribe build.sh), un deploy cambia
//   sus URLs y no encuentran copia: van a la red. Lo que NO lleva el `?v=` del
//   despliegue se sirve una carga atrasado: `manifest.webmanifest`, los
//   iconos, el favicon y los JSON de `data/` (esos llevan la versión de su
//   FORMATO, que se bumpea a mano).
// - `caches.match()` busca en TODAS las cachés del origen, no solo en CACHE.
//
// Limpieza: el nombre de CACHE lleva el `?v=` del despliegue (build.sh lo
// escribe en docs/sw.js, igual que versiona los imports), así que cada deploy
// cambia los bytes de este archivo, el navegador instala el SW nuevo y su
// `activate` borra las cachés de los despliegues anteriores. Esto y el
// estampado de build.sh los cubre tests/sw.test.mjs; lo de la caché HTTP de
// arriba se midió a mano y no tiene test.
//
// Hasta v=256 CACHE valía siempre 'fonoteca-sw-v1' y esa limpieza no corrió
// nunca: la copia de cada URL versionada de cada deploy se quedaba para
// siempre y «Limpiar caché» no la tocaba (no toca la Cache API).
//
// Alcance del `activate`: solo borra cachés que empiecen con PREFIJO. La Cache
// API es por ORIGEN, no por ruta, y este origen (ianct2020.github.io) es
// compartido con cualquier otro proyecto de Pages de la cuenta. Tampoco toca la
// IndexedDB (base de discografías, mosaico_colores_v1, me gusta): este archivo
// no la nombra.

// En src/ vale 'dev' a propósito: es un marcador. build.sh lo reemplaza por
// `v<N>` al copiar a docs/ y falla si no puede. En dev el SW ni se registra
// (ver ES_DEV en app.js).
const CACHE = 'fonoteca-sw-v268';
const PREFIJO = 'fonoteca-sw-';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith(PREFIJO) && k !== CACHE)
      .map(k => caches.delete(k)));
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
        // Una navegación CON query no se guarda (v=258). La clave de la caché
        // es la URL entera, y `callback.html?code=…&state=…` lleva el código
        // PKCE del login: quedaba escrito en la Cache API hasta el despliegue
        // siguiente. Tampoco sirve de nada guardarla: el `?frio=N` del ritual y
        // el `?code=` son de un solo uso, y el modo offline cae igual a
        // `index.html` por el `ignoreSearch` de abajo.
        if (!url.search) {
          const c = await caches.open(CACHE);
          c.put(req, res.clone());
        }
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
