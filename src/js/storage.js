const CACHE_PREFIX = 'spc_';
const DEFAULT_TTL = 24 * 60;

function cacheGet(key) {
  const raw = localStorage.getItem(CACHE_PREFIX + key);
  if (!raw) return null;

  try {
    const { value, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return value;
  } catch {
    localStorage.removeItem(CACHE_PREFIX + key);
    return null;
  }
}

function cacheSet(key, value, ttlMinutes = DEFAULT_TTL) {
  const data = {
    value,
    expiry: Date.now() + (ttlMinutes * 60 * 1000),
  };
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('localStorage full, clearing cache');
      cacheClearAll();
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
    }
  }
}

function cacheClear(key) {
  localStorage.removeItem(CACHE_PREFIX + key);
}

function cacheClearAll() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
}

export { cacheGet, cacheSet, cacheClear, cacheClearAll };
