// Doble de `src/js/idb.js` para `tests/me-gusta-de-otra-cuenta.test.mjs` (v=345, tanda 98).
//
// El estado va en `globalThis.__IDB_OTRA`:
//   kv            Map clave → valor envuelto (`{ value, storedAt, expiry }`, como el de verdad)
//   lecturas      cada clave leída, en orden (para el rojo estructural de L6: «con la marca, no lee la clave»)
//   intentos      cada borrado pedido (también los de prefijo, como `prefijo:<p>`), haya salido o no
//   borrados      los que salieron
//   escrituras    cada `put`, en orden
//   fallanBorrar  claves cuyo `idbDel` TIRA sin borrar (una transacción abortada, un disco lleno)
//   demoraBorrar  ms que tarda cada `idbDel` en terminar (la carrera)
//
// 🔴 ORDENA las operaciones como IndexedDB: todas van a la misma store (`kv`), así que una lectura pedida después de
// un borrado espera a que el borrado termine. Sin esto el doble inventaría una carrera que el navegador no tiene
// (es lo que pide el encargo: «no se inventa un rojo»). La cola es FIFO y un fallo no la corta.
function e() {
  const d = (globalThis.__IDB_OTRA ??= {});
  d.kv ??= new Map();
  d.lecturas ??= [];
  d.intentos ??= [];
  d.borrados ??= [];
  d.escrituras ??= [];
  d.fallanBorrar ??= new Set();
  d.demoraBorrar ??= 0;
  d.cola ??= Promise.resolve();
  return d;
}
function enCola(op) {
  const d = e();
  const p = d.cola.then(op);
  d.cola = p.catch(() => {});
  return p;
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const leer = (k) => { e().lecturas.push(k); return structuredClone(e().kv.get(k)); };
const escribir = (k, v) => { e().escrituras.push(k); e().kv.set(k, structuredClone(v)); };
async function borrar(k) {
  const d = e();
  d.intentos.push(k);
  if (d.demoraBorrar) await dormir(d.demoraBorrar);
  if (d.fallanBorrar.has(k)) throw new Error(`doble: la transacción se abortó borrando ${k}`);
  d.borrados.push(k);
  d.kv.delete(k);
}

export async function idbGet(key) { return enCola(() => leer(key)); }
export async function idbSet(key, value) { return enCola(() => escribir(key, value)); }
export async function idbSetVarios(pares) { return enCola(() => { for (const [k, v] of pares) escribir(k, v); }); }
export async function idbDel(key) { return enCola(() => borrar(key)); }
export async function idbGetCached(key) {
  const w = await idbGet(key);
  if (!w) return null;
  if (typeof w.expiry === 'number' && Date.now() > w.expiry) { idbDel(key).catch(() => {}); return null; }
  return w.value ?? null;
}
export async function idbGetCachedRaw(key) { return (await idbGet(key))?.value ?? null; }
export async function idbGetTimestamp(key) { const w = await idbGet(key); return typeof w?.storedAt === 'number' ? w.storedAt : null; }
export async function idbSetCached(key, value, ttl) {
  const now = Date.now();
  return idbSet(key, { value, storedAt: now, expiry: Number.isFinite(ttl) ? now + ttl * 60000 : null });
}
export function idbAvailable() { return true; }
export async function idbAllKeys() { return enCola(() => [...e().kv.keys()]); }
export async function idbEntriesByPrefix(prefix) {
  return enCola(() => [...e().kv.keys()].filter((k) => typeof k === 'string' && k.startsWith(prefix)).map((k) => [k, leer(k)]));
}
export async function idbEntriesEnRango(prefix) { return idbEntriesByPrefix(prefix); }
export async function idbDelByPrefix(prefix) {
  return enCola(async () => {
    const d = e();
    d.intentos.push(`prefijo:${prefix}`);
    let n = 0;
    for (const k of [...d.kv.keys()]) if (typeof k === 'string' && k.startsWith(prefix)) { d.borrados.push(k); d.kv.delete(k); n++; }
    return n;
  });
}
export async function idbClearAll() { return 0; }
export function clavesABorrar(keys) { return keys; }
