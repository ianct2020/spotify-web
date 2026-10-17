const DB_NAME = 'spotify-tools';
const DB_VERSION = 1;
const STORE = 'kv';

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  return tx('readonly', store => reqPromise(store.get(key)));
}

async function idbSet(key, value) {
  return tx('readwrite', store => reqPromise(store.put(value, key)));
}

// Varias claves en UNA transacción: o se escriben todas o ninguna (v=312, la migración
// de las etiquetas de género: un corte a mitad no puede dejar la mitad migrada).
async function idbSetVarios(pares) {
  return tx('readwrite', store => { for (const [k, v] of pares) store.put(v, k); });
}

async function idbDel(key) {
  return tx('readwrite', store => reqPromise(store.delete(key)));
}

async function idbGetCached(key) {
  const wrapped = await idbGet(key);
  if (!wrapped) return null;
  if (typeof wrapped.expiry === 'number' && Date.now() > wrapped.expiry) {
    idbDel(key).catch(() => {});
    return null;
  }
  return wrapped.value ?? null;
}

async function idbGetCachedRaw(key) {
  const wrapped = await idbGet(key);
  if (!wrapped) return null;
  return wrapped.value ?? null;
}

async function idbGetTimestamp(key) {
  const wrapped = await idbGet(key);
  if (!wrapped) return null;
  return typeof wrapped.storedAt === 'number' ? wrapped.storedAt : null;
}

// `ttlMinutes` null / undefined / no finito = SIN caducidad, y se guarda
// `expiry: null` para que se vea en el volcado que es a propósito.
//
// ⚠️ Antes cualquier llamada sin ttl escribía `expiry: NaN`, que NO caducaba
// —`Date.now() > NaN` es false— pero por accidente, no por decisión. Un caché
// que se borra solo garantiza el peor caso: cuanto más viejo, más caro es
// rehacerlo. Ver PENDIENTES.md, «Riesgos abiertos» ítem 0.
async function idbSetCached(key, value, ttlMinutes) {
  const now = Date.now();
  const caduca = Number.isFinite(ttlMinutes);
  const wrapped = {
    value,
    storedAt: now,
    expiry: caduca ? now + (ttlMinutes * 60 * 1000) : null,
  };
  return idbSet(key, wrapped);
}

function idbAvailable() {
  return typeof indexedDB !== 'undefined';
}

// Borra TODO el cache de IndexedDB (grouped de playlists, análisis, etc.),
// menos las keys en keepKeys y las que empiezan por algún `keepPrefixes` (por
// defecto no se conserva nada). Devuelve cuántas borró.
//
// `keepPrefixes` existe por la base de discografías (v=229): una clave por
// artista, así que no se pueden nombrar de antemano, y rehacerla cuesta dos
// cuotas de Spotify quemadas.
//
// El filtro está aparte (`clavesABorrar`) para poder mirar qué borraría sin
// borrar nada: lo usan el test de «Limpiar caché» y la comprobación en vivo.
function clavesABorrar(keys, keepKeys = [], keepPrefixes = []) {
  const keepSet = new Set(keepKeys);
  const keep = (k) => keepSet.has(k) || (typeof k === 'string' && keepPrefixes.some(p => k.startsWith(p)));
  return keys.filter(k => !keep(k));
}

async function idbAllKeys() {
  const db = await openDb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readonly');
    const r = t.objectStore(STORE).getAllKeys();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbClearAll(keepKeys = [], keepPrefixes = []) {
  const db = await openDb();
  const toDel = clavesABorrar(await idbAllKeys(), keepKeys, keepPrefixes);
  if (toDel.length === 0) return 0;
  await new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    toDel.forEach(k => store.delete(k));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return toDel.length;
}

/**
 * Borra todas las claves que empiecen por `prefix`. Devuelve cuántas borró.
 *
 * Hace falta para el guarda multiusuario: los caches con el CONTENIDO de las
 * playlists son una clave por playlist (`playlist_items_{id}`), así que no se
 * pueden nombrar de antemano. Hasta v=189 no los borraba nadie —
 * `invalidatePlaylistsCache()` solo limpiaba la LISTA— y quedaban en el
 * navegador para el usuario siguiente.
 */
async function idbDelByPrefix(prefix) {
  const db = await openDb();
  const keys = await new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readonly');
    const r = t.objectStore(STORE).getAllKeys();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const toDel = keys.filter(k => typeof k === 'string' && k.startsWith(prefix));
  if (toDel.length === 0) return 0;
  await new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    toDel.forEach(k => store.delete(k));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
  return toDel.length;
}

/**
 * Todas las entradas cuya clave empieza por `prefix`, como `[clave, envoltorio]`
 * CRUDAS: sin mirar `expiry` y sin borrar nada. `idbGetCached` borra lo
 * caducado al leerlo; esto no, porque lo usa la migración a la base de
 * discografías (v=229), que tiene que rescatar incluso lo que ya venció.
 */
async function idbEntriesByPrefix(prefix) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const out = [];
    const t = db.transaction(STORE, 'readonly');
    const r = t.objectStore(STORE).openCursor();
    r.onsuccess = () => {
      const cur = r.result;
      if (!cur) { res(out); return; }
      if (typeof cur.key === 'string' && cur.key.startsWith(prefix)) out.push([cur.key, cur.value]);
      cur.continue();
    };
    r.onerror = () => rej(r.error);
  });
}

/**
 * Lo mismo que `idbEntriesByPrefix` —`[clave, envoltorio]` CRUDOS, sin mirar
 * `expiry` y sin borrar nada—, pero leyendo SOLO el rango de claves del
 * prefijo (v=304, `#mapa`). El cursor de arriba recorre la base ENTERA y
 * deserializa cada valor, incluidos los me gusta y la base de colores del
 * mosaico (megas): para abrir una vista que lee una clave por artista, eso es
 * pagar toda la base cada vez. El rango es exacto: el límite de arriba es el
 * prefijo con su último carácter + 1, excluido, así que entra toda cadena que
 * empiece por el prefijo y ninguna otra.
 */
async function idbEntriesEnRango(prefix) {
  const db = await openDb();
  const fin = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, 'readonly');
    const store = t.objectStore(STORE);
    const rango = IDBKeyRange.bound(prefix, fin, false, true);
    const claves = store.getAllKeys(rango);
    const valores = store.getAll(rango);
    t.oncomplete = () => res(claves.result.map((k, i) => [k, valores.result[i]]));
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export {
  idbEntriesByPrefix, idbEntriesEnRango,
  idbGet, idbSet, idbSetVarios, idbDel,
  idbGetCached, idbGetCachedRaw, idbGetTimestamp, idbSetCached,
  idbAvailable, idbClearAll, idbDelByPrefix,
  idbAllKeys, clavesABorrar,
};
