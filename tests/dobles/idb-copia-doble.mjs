// Doble de `src/js/idb.js` para `tests/copia-completa.test.mjs` (v=333). El estado va en `globalThis.__IDB_COPIA`:
// `kv` (Map clave → valor), `escrituras` (cada `put`/`delete`, en orden) y `fallar` (claves cuya LECTURA tira, para
// probar `_errores`; con alguna, `idbEntriesByPrefix` tira también, como un cursor que se rompe a mitad).

function e() {
  const d = (globalThis.__IDB_COPIA ??= {});
  d.kv ??= new Map();
  d.escrituras ??= [];
  d.fallar ??= new Set();
  return d;
}
const leer = (k) => { if (e().fallar.has(k)) throw new Error('doble: lectura que falla (' + k + ')'); return structuredClone(e().kv.get(k)); };
const escribir = (k, v) => { e().escrituras.push(['put', k]); e().kv.set(k, structuredClone(v)); };

export async function idbGet(key) { return leer(key); }
export async function idbSet(key, value) { escribir(key, value); }
export async function idbSetVarios(pares) { for (const [k, v] of pares) escribir(k, v); }
export async function idbDel(key) { e().escrituras.push(['del', key]); e().kv.delete(key); }
export async function idbGetCached(key) {
  const w = leer(key);
  if (!w) return null;
  if (typeof w.expiry === 'number' && Date.now() > w.expiry) { await idbDel(key); return null; }
  return w.value ?? null;
}
export async function idbGetCachedRaw(key) { return leer(key)?.value ?? null; }
export async function idbGetTimestamp(key) { const w = leer(key); return typeof w?.storedAt === 'number' ? w.storedAt : null; }
export async function idbSetCached(key, value, ttl) {
  const now = Date.now();
  escribir(key, { value, storedAt: now, expiry: Number.isFinite(ttl) ? now + ttl * 60000 : null });
}
export function idbAvailable() { return true; }
export async function idbAllKeys() { return [...e().kv.keys()]; }
export async function idbEntriesByPrefix(prefix) {
  const out = [];
  for (const k of e().kv.keys()) if (typeof k === 'string' && k.startsWith(prefix)) out.push([k, leer(k)]);
  return out;
}
export async function idbEntriesEnRango(prefix) { return idbEntriesByPrefix(prefix); }
export async function idbDelByPrefix(prefix) {
  let n = 0;
  for (const k of [...e().kv.keys()]) if (typeof k === 'string' && k.startsWith(prefix)) { await idbDel(k); n++; }
  return n;
}
export async function idbClearAll() { return 0; }
export function clavesABorrar(keys) { return keys; }
