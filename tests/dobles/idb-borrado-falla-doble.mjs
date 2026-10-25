// Doble de `src/js/idb.js` para `tests/errores-que-dicen-hecho.test.mjs` (tanda 86).
//
// Como `idb-escrituras-doble.mjs` (anota escrituras y borrados en `globalThis.__IDB_ESCR`), con
// una cosa más: las claves de `.fallanBorrar` hacen que `idbDel` TIRE sin borrar, como un
// IndexedDB que se queda sin cuota o una transacción abortada. El intento se anota igual en
// `.intentos`, así el test puede ver que se intentaron las ocho aunque alguna falle.
function e() {
  if (!globalThis.__IDB_ESCR) globalThis.__IDB_ESCR = { kv: new Map(), escrituras: [], borrados: [], intentos: [], fallanBorrar: new Set() };
  return globalThis.__IDB_ESCR;
}

export async function idbGetCached(key) { return e().kv.get(key) ?? null; }
export async function idbSetCached(key, value) { e().escrituras.push(key); e().kv.set(key, value); }
export async function idbDel(key) {
  e().intentos.push(key);
  if (e().fallanBorrar?.has(key)) throw new Error(`doble: la transacción se abortó borrando ${key}`);
  e().borrados.push(key);
  e().kv.delete(key);
}
