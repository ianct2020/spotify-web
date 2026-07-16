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

async function idbSetCached(key, value, ttlMinutes) {
  const now = Date.now();
  const wrapped = {
    value,
    storedAt: now,
    expiry: now + (ttlMinutes * 60 * 1000),
  };
  return idbSet(key, wrapped);
}

function idbAvailable() {
  return typeof indexedDB !== 'undefined';
}

export {
  idbGet, idbSet, idbDel,
  idbGetCached, idbGetCachedRaw, idbGetTimestamp, idbSetCached,
  idbAvailable,
};
