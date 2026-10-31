// Doble de `api.js`, `idb.js` y `ui/degraded-banner.js` para
// `tests/fallo-lectura-historial.test.mjs` (tanda 109). `history-data.js` es el REAL: lo que
// se dobla es lo que no existe en Node (la red de Spotify, IndexedDB, el DOM). El `fetch` de
// los JSON del owner lo dobla el test sobre `globalThis.fetch`.
//
// Estado en `globalThis.__T109`:
//   · `me`: lo que contesta `getCurrentUserId()`;
//   · `meFalla`: si está, `getCurrentUserId()` TIRA (identidad sin confirmar);
//   · `idbTira`: una RegExp; toda lectura de IndexedDB cuya clave la cumpla TIRA (el fallo
//     de lectura que se simula). Sin ella, la IndexedDB está vacía: toda lectura da `null`.
const s = () => globalThis.__T109;

export async function getCurrentUserId() {
  if (s().meFalla) throw new Error(s().meFalla);
  return s().me;
}
export async function getBestAvailableLikes() { return { items: [] }; }

function leer(key) {
  s().lecturasIdb.push(key);
  if (s().idbTira && s().idbTira.test(key)) throw new Error('doble: IndexedDB inventada caída al leer ' + key);
  return null;
}
export async function idbGetCached(key) { return leer(key); }
export async function idbGetCachedRaw(key) { return leer(key); }
export async function idbSetCached(key) { s().escriturasIdb.push(key); }
export async function idbDel(key) { s().borradosIdb.push(key); }

export function mostrarBannerDegradadoVista() { s().banners++; }
