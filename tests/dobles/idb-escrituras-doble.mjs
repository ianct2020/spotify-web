// Doble de `src/js/idb.js` para la suite de la guarda del import (v=298).
//
// Lo que se afirma son ESCRITURAS, así que este doble las anota todas, en orden,
// en `globalThis.__IDB_ESCR.escrituras` (la clave de cada `idbSetCached`) y los
// borrados en `.borrados`. Lee de `.kv`, que el test puede sembrar.

function e() {
  if (!globalThis.__IDB_ESCR) globalThis.__IDB_ESCR = { kv: new Map(), escrituras: [], borrados: [] };
  return globalThis.__IDB_ESCR;
}

export async function idbGetCached(key) { return e().kv.get(key) ?? null; }
export async function idbSetCached(key, value) { e().escrituras.push(key); e().kv.set(key, value); }
export async function idbDel(key) { e().borrados.push(key); e().kv.delete(key); }
