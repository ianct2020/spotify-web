// Doble de `src/js/idb.js` para `tests/generos-artista.test.mjs` (v=312, tanda 60).
//
// Las etiquetas de género viven en IndexedDB, una clave por artista, y se leen de a
// un prefijo con `idbEntriesEnRango`. El estado va en `globalThis.__IDB_GENEROS`
// (`kv`: un Map clave → valor), así el test puede «recargar la página» importando
// `lastfm.js` otra vez sin perder lo escrito, y puede hacer fallar una escritura
// (`fallar`: un Set de claves cuya escritura tira).

function e() {
  const d = (globalThis.__IDB_GENEROS ??= {});
  d.kv ??= new Map();
  d.fallar ??= new Set();
  d.escrituras ??= [];
  return d;
}

export async function idbGet(key) { return structuredClone(e().kv.get(key)); }
export async function idbSet(key, value) {
  const d = e();
  if (d.fallar.has(key)) throw new Error('doble: escritura que falla (' + key + ')');
  d.escrituras.push(key);
  d.kv.set(key, structuredClone(value));
}
// Todas o ninguna, como una transacción de verdad.
export async function idbSetVarios(pares) {
  const d = e();
  for (const [k] of pares) if (d.fallar.has(k)) throw new Error('doble: escritura que falla (' + k + ')');
  for (const [k, v] of pares) { d.escrituras.push(k); d.kv.set(k, structuredClone(v)); }
}
export async function idbEntriesEnRango(prefix) {
  return [...e().kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)]);
}
// Lo que `lastfm.js` no usa pero otro módulo podría importar: que no reviente al cargar.
export async function idbDel(key) { e().kv.delete(key); }
export async function idbEntriesByPrefix(prefix) { return idbEntriesEnRango(prefix); }
