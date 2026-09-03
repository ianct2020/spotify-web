// tests/likes-cache-policy.test.mjs — la caché de me gusta no caduca ni se
// destruye sola (2026-09-02)
//
// Lo que se protege acá es el círculo que tuvo la app rota tres días:
//
//   caché completa → a las 24 h una vista la BORRA al leerla → resync de ~190
//   peticiones → 429 → queda un parcial → el parcial también caduca a las 24 h
//   → la carga siguiente arranca de offset 0 → 190 peticiones → 429 → …
//
// Tres reglas, y las tres se comprueban sobre el código real, no sobre una
// copia: `idb.js` entero, y las funciones de política de `api.js` extraídas del
// fuente (api.js importa medio navegador, así que no se puede importar aquí).
//
//   1. Escribir sin TTL guarda `expiry: null`, y leer eso NUNCA borra.
//   2. El parcial se lee con `idbGetCachedRaw` (no caduca).
//   3. `clearPartial()` va DESPUÉS de que `saveLikes()` confirme `ok: true`.

import { readFileSync } from 'node:fs';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

// ── Doble de IndexedDB: lo mínimo que usa idb.js ────────────────────────────
function fakeIDB() {
  const datos = new Map();
  const req = (valor) => {
    const r = { result: valor, onsuccess: null, onerror: null };
    setTimeout(() => r.onsuccess && r.onsuccess(), 0);
    return r;
  };
  const store = {
    get: k => req(datos.get(k)),
    put: (v, k) => { datos.set(k, v); return req(undefined); },
    delete: k => { datos.delete(k); return req(undefined); },
    getAllKeys: () => req([...datos.keys()]),
  };
  const tx = () => {
    const t = { objectStore: () => store, oncomplete: null, onerror: null, onabort: null };
    // ⚠️ Node redondea `setTimeout(…, 0)` a 1 ms, así que dos timers de 0 y 1
    // se disparan en el ORDEN EN QUE SE PROGRAMARON, no por su retardo. `tx()`
    // se programa antes que la petición que hay dentro, de modo que con 1 ms el
    // `oncomplete` llegaba primero y `idb.js` resolvía con `result` sin asignar
    // — todas las lecturas daban undefined. Con holgura, el orden es el real.
    setTimeout(() => t.oncomplete && t.oncomplete(), 10);
    return t;
  };
  globalThis.indexedDB = {
    open: () => {
      const r = { result: { transaction: tx, objectStoreNames: { contains: () => true } }, onsuccess: null, onerror: null, onupgradeneeded: null };
      setTimeout(() => r.onsuccess && r.onsuccess(), 0);
      return r;
    },
  };
  return datos;
}

const datos = fakeIDB();
const { idbSetCached, idbGetCached, idbGetCachedRaw } = await import('../src/js/idb.js');

// ── 1. Sin TTL = sin caducidad, y leer no borra ─────────────────────────────
await idbSetCached('all_liked_tracks', [{ id: 'a' }, { id: 'b' }], null);
const guardado = datos.get('all_liked_tracks');
ok(guardado.expiry === null, 'sin TTL se guarda expiry:null (no NaN por accidente)');
ok(typeof guardado.storedAt === 'number', 'igual deja storedAt para «última sincronización»');

const leidoCached = await idbGetCached('all_liked_tracks');
ok(Array.isArray(leidoCached) && leidoCached.length === 2, 'idbGetCached devuelve la caché sin caducidad');
ok(datos.has('all_liked_tracks'), 'y NO la borra al leerla');

const leidoRaw = await idbGetCachedRaw('all_liked_tracks');
ok(Array.isArray(leidoRaw) && leidoRaw.length === 2, 'idbGetCachedRaw devuelve lo mismo');
ok(datos.has('all_liked_tracks'), 'los dos lectores coinciden: ninguno destruye');

// Contraste: con TTL vencido sí se borra — el comportamiento viejo, que es
// justo el que no queremos para los me gusta.
await idbSetCached('con_ttl', [1], 1);
datos.get('con_ttl').expiry = Date.now() - 1000;
ok((await idbGetCached('con_ttl')) === null, 'con TTL vencido idbGetCached devuelve null');
// El borrado es fire-and-forget dentro de idbGetCached: se le da un respiro.
await new Promise(r => setTimeout(r, 10));
ok(!datos.has('con_ttl'), 'y BORRA la clave — por eso los me gusta van sin TTL');

// ── 2 y 3. Política en api.js, comprobada sobre el fuente ───────────────────
const apiCrudo = readFileSync(new URL('../src/js/api.js', import.meta.url), 'utf8');

// ⚠️ Los comentarios de este repo CITAN el código que se quitó («antes acá había
// un invalidateLikesCache()»). Buscar sobre el fuente con comentarios da
// falsos positivos justo en las comprobaciones que más importan, así que se
// miran sobre el código pelado.
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const api = sinComentarios(apiCrudo);

const savePartialSrc = api.slice(api.indexOf('async function savePartial'), api.indexOf('async function loadPartial'));
ok(/idbSetCached\(LIKES_PARTIAL_KEY, payload, null\)/.test(savePartialSrc),
  'savePartial guarda el parcial SIN caducidad');

const loadPartialSrc = api.slice(api.indexOf('async function loadPartial'), api.indexOf('async function clearPartial'));
ok(/idbGetCachedRaw\(LIKES_PARTIAL_KEY\)/.test(loadPartialSrc),
  'loadPartial lee el parcial con idbGetCachedRaw (no lo puede borrar)');
ok(!/idbGetCached\(LIKES_PARTIAL_KEY\)/.test(loadPartialSrc),
  'loadPartial ya no usa el lector destructivo');

const saveLikesSrc = api.slice(api.indexOf('async function saveLikes'), api.indexOf('async function saveLikes') + 1200);
ok(/idbSetCached\(LIKES_CACHE_KEY, items, null\)/.test(saveLikesSrc),
  'saveLikes escribe la caché completa SIN caducidad');

// El orden del bug C: dentro de startLikesLoad, clearPartial va después del
// saveLikes y detrás de la comprobación de que salió bien.
const startSrc = api.slice(api.indexOf('function startLikesLoad'), api.indexOf('async function loadLikesShared'));
const iSave = startSrc.indexOf('await saveLikes(');
const iGuard = startSrc.indexOf('!guardado.ok');
// lastIndexOf: al principio de startLikesLoad hay otro clearPartial, el de `force`.
const iClear = startSrc.lastIndexOf('await clearPartial(');
ok(iSave > -1 && iGuard > iSave && iClear > iGuard,
  'clearPartial() va DESPUÉS de saveLikes() y de comprobar ok:true');
ok(/keepPartial: true/.test(startSrc),
  'la carga de me gusta le pide a paginateAll que no suelte el parcial');

// Y que paginateAll respete esa petición.
const pagSrc = api.slice(api.indexOf('async function paginateAll'), api.indexOf('function slimTrack'));
ok(/if \(partialCacheKey && !keepPartial\)/.test(pagSrc),
  'paginateAll solo borra el parcial si no le pidieron conservarlo');

// ── Ningún camino de error puede destruir la caché ──────────────────────────
const removeSrc = api.slice(api.indexOf('async function removeFromLikesCache'), api.indexOf('async function removeFromLikesCache') + 1400);
ok(!/invalidateLikesCache\(\)/.test(removeSrc),
  'removeFromLikesCache ya no borra la caché entera cuando falla');

const syncSrc = api.slice(api.indexOf('async function syncLikesIncremental'), api.indexOf('async function syncLikesIncremental') + 2500);
ok(!/invalidateLikesCache\(\)/.test(syncSrc),
  'syncLikesIncremental reconcilia con force, sin destruir antes de tener el reemplazo');

// ── El techo del 429 ────────────────────────────────────────────────────────
ok(/const MAX_RETRY_WAIT = \d+/.test(api), 'existe un techo para la espera por 429');
const espera = api.slice(api.indexOf('if (response.status === 429)'), api.indexOf('if (response.status === 429)') + 2200);
ok(/Math\.min\(MAX_RETRY_WAIT/.test(espera), 'la espera está acotada por arriba');
ok(/Math\.max\(MIN_RETRY_WAIT/.test(espera), 'y MIN_RETRY_WAIT sigue siendo el piso');
ok(!/parseInt\(retryAfterHeader \|\| '5'\)/.test(espera),
  'ya no se inventa un Retry-After de 5 s cuando el header no llega');
ok(/console\.info\(`\[rate-limit\]/.test(espera),
  'el aviso del 429 sale por console.info (la extensión no captura warn)');
ok(/avisarRateLimit\(/.test(espera), 'y se emite para que la interfaz lo pueda mostrar');

// ── La pantalla de arranque no descarga nada ────────────────────────────────
const dash = sinComentarios(readFileSync(new URL('../src/js/features/dashboard.js', import.meta.url), 'utf8'));
const startScreen = dash.slice(dash.indexOf('async function renderStartScreen'), dash.indexOf('async function refreshLastSyncLabel'));
ok(/getBestAvailableLikes\(\{ allowFetch: false \}\)/.test(startScreen),
  'renderStartScreen lee la caché sin disparar la descarga de ~190 peticiones');

// ── El guarda multiusuario borra las claves QUE EXISTEN ─────────────────────
//
// Tenía una copia a mano de los nombres y se quedó vieja: borraba
// history_track_plays_v2 y history_skip_stats_v1 cuando las reales ya eran la
// v5 y la v2. Resultado: al entrar otra persona en el mismo navegador, el
// historial del owner seguía ahí y lo veía como suyo.
const { OWNER_KEY_LIST, OWNER_KEYS } = await import('../src/js/history-keys.js');
const histData = readFileSync(new URL('../src/js/features/history-data.js', import.meta.url), 'utf8');

ok(/for \(const k of OWNER_KEY_LIST\)/.test(api),
  'el guarda multiusuario recorre la lista compartida, no una copia a mano');
ok(!/'history_track_plays_v2'/.test(api) && !/'history_skip_stats_v1'/.test(api),
  'api.js ya no menciona las versiones viejas de las claves de historial');
ok(!/const OWNER_KEYS = \{/.test(histData),
  'history-data.js ya no define su propia copia de OWNER_KEYS');
ok(/from '\.\.\/history-keys\.js'/.test(histData),
  'history-data.js las toma del módulo compartido');
ok(OWNER_KEY_LIST.length === Object.keys(OWNER_KEYS).length && OWNER_KEY_LIST.length === 7,
  'la lista cubre las siete claves del owner');
ok(OWNER_KEY_LIST.includes('history_track_plays_v5') && OWNER_KEY_LIST.includes('history_skip_stats_v2'),
  'y son las versiones que se escriben de verdad (plays v5, skips v2)');
ok(OWNER_KEY_LIST.includes('history_artist_tracks_v2'),
  'incluye history_artist_tracks_v2, que la copia vieja se olvidaba');

console.log(`\n  ${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
