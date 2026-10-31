// Doble de `api.js`, `idb.js` y `ui/degraded-banner.js` para
// `tests/escuchadas-caidas-94a.test.mjs` (tanda 108). `history-data.js` y
// `mosaico-colores.js` son los REALES: lo que se dobla es lo que no existe en
// Node (la red de Spotify, IndexedDB, el DOM). El `fetch` de los JSON del owner
// lo dobla el test sobre `globalThis.fetch`.
//
// Estado en `globalThis.__T108`:
//   · `me`: lo que contesta `getCurrentUserId()` (el id del owner, otra cuenta inventada…);
//   · `meFalla`: si está, `getCurrentUserId()` TIRA (identidad sin confirmar);
//   · `likes`: lo que devuelve `getBestAvailableLikes()` (solo lee caché, como el real);
//   · la IndexedDB doblada está VACÍA: toda lectura da `null`, toda escritura se cuenta.
const s = () => globalThis.__T108;

export async function getCurrentUserId() {
  if (s().meFalla) throw new Error(s().meFalla);
  return s().me;
}
export async function getBestAvailableLikes() {
  return { items: s().likes || [] };
}

export async function idbGetCached(key) { s().lecturasIdb.push(key); return null; }
export async function idbGetCachedRaw(key) { s().lecturasIdb.push(key); return null; }
export async function idbSetCached(key) { s().escriturasIdb.push(key); }
export async function idbDel(key) { s().borradosIdb.push(key); }

export function mostrarBannerDegradadoVista() { s().banners++; }
