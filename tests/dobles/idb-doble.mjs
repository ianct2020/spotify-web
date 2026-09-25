// Doble de `src/js/idb.js` para el test del estimador de coste.
//
// El estimador solo lee: una pasada por prefijo sobre las bases y, para los
// artistas sin `seedId`, la caché de ids. Nada más de `idb.js` hace falta, así
// que el doble expone esas dos y guarda su estado en `globalThis.__IDB`.

export async function idbEntriesByPrefix(prefix) {
  const kv = globalThis.__IDB?.kv || new Map();
  return [...kv.entries()].filter(([k]) => k.startsWith(prefix));
}

export async function idbGetCached(key) {
  return globalThis.__IDB?.ids?.get(key) ?? null;
}
