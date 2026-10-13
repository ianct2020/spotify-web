// Doble de `src/js/idb.js` para los tests de `util/hidden-sync.js` (v=299).
//
// El caché de items de la playlist espejo vive en IndexedDB. El estado va
// DENTRO de `globalThis.__DOBLE` (en `.idb`), así que cada test que rearma el
// doble arranca también con la IndexedDB vacía: las suites que ya existían
// siguen bajando la playlist como hasta v=298. La suite del caché comparte el
// mismo `__DOBLE` entre dos almacenes, que es «dos cargas de página».
//
// Lo que se afirma son escrituras y borrados: se anotan en orden en
// `.idbEscrituras` y `.idbBorrados`. No imita el vencimiento del envoltorio
// (`expiry`): la regla de las 24 h vive en `guardadoEn` y es la que se prueba.

function e() {
  const d = globalThis.__DOBLE;
  if (!d.idb) d.idb = new Map();
  if (!d.idbEscrituras) d.idbEscrituras = [];
  if (!d.idbBorrados) d.idbBorrados = [];
  return d;
}

export async function idbGetCached(key) { return e().idb.get(key) ?? null; }
export async function idbSetCached(key, value) { e().idbEscrituras.push(key); e().idb.set(key, structuredClone(value)); }
export async function idbDel(key) { e().idbBorrados.push(key); e().idb.delete(key); }
