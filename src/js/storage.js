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

function cacheGetRaw(key) {
  const raw = localStorage.getItem(CACHE_PREFIX + key);
  if (!raw) return null;
  try {
    const { value } = JSON.parse(raw);
    return value;
  } catch {
    return null;
  }
}

function cacheGetTimestamp(key) {
  const raw = localStorage.getItem(CACHE_PREFIX + key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.storedAt === 'number') return parsed.storedAt;
    if (typeof parsed.expiry === 'number') return parsed.expiry - DEFAULT_TTL * 60 * 1000;
    return null;
  } catch {
    return null;
  }
}

function cacheSet(key, value, ttlMinutes = DEFAULT_TTL) {
  const now = Date.now();
  const data = {
    value,
    storedAt: now,
    expiry: now + (ttlMinutes * 60 * 1000),
  };
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      console.warn('localStorage full, clearing cache and retrying');
      cacheClearAll();
      try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(data));
      } catch (e2) {
        console.warn(`Cache value too large for "${key}", skipping cache`);
      }
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


// ── Claves de PREFERENCIA por usuario (v=159) ───────────────────────────────
//
// El guard multi-user de v=86 limpia los caches de IDB cuando cambia el user
// id, pero las preferencias viven en claves globales de localStorage: dos
// personas en el mismo navegador se pisan la paleta, el toggle de animaciones y
// el resto. `prefKey()` les pone el user id delante.
//
// ⚠️ POR QUÉ NO SE USA `getCurrentUserId()`: es ASYNC (hace `GET /me` la primera
// vez), y `applyStoredTheme()` corre SINCRÓNICO al arrancar, antes del primer
// frame. Prefijar con un id que llega async significa pintar la paleta de
// fábrica y saltar a la elegida un momento después: flash de tema, justo en la
// feature que se estrenó en v=157. `fonoteca_last_user_id` lo escribe
// `getCurrentUserId()` en localStorage de forma sincrónica y lo mantiene al día,
// así que la lectura de arranque no espera a nadie.
//
// Sin id todavía (primerísima carga del navegador) se cae a la clave pelada, y
// `migratePrefKey()` la muda cuando el id aparece.
const LAST_USER_KEY = 'fonoteca_last_user_id';

function prefKey(base) {
  let u = '';
  try { u = localStorage.getItem(LAST_USER_KEY) || ''; } catch { /* sin localStorage */ }
  return u ? `${base}__${u}` : base;
}

/**
 * Muda el valor de la clave pelada a la prefijada, una sola vez.
 *
 * Sin esto, la primera carga con user id conocido lee una clave vacía y la
 * preferencia guardada se PIERDE (Ian ya tiene una paleta en
 * `fonoteca_theme_v1` sin prefijo desde v=157).
 *
 * Solo migra si la clave prefijada está vacía: si el usuario ya eligió algo con
 * su clave propia, manda lo suyo y la vieja se descarta.
 *
 * ⚠️ Caso raro asumido: si el usuario A nunca llegó a migrar y B entra primero
 * en ese navegador, B hereda la preferencia de A. Como la migración corre en
 * CADA arranque, la ventana es la de una sola sesión, y lo que se hereda es una
 * paleta de colores.
 */
function migratePrefKey(base) {
  const k = prefKey(base);
  if (k === base) return;              // todavía sin user id: nada que mudar
  try {
    if (localStorage.getItem(k) !== null) { localStorage.removeItem(base); return; }
    const viejo = localStorage.getItem(base);
    if (viejo === null) return;
    localStorage.setItem(k, viejo);
    localStorage.removeItem(base);
  } catch { /* sin localStorage o lleno: se sigue con la clave pelada */ }
}

export { prefKey, migratePrefKey, cacheGet, cacheGetRaw, cacheGetTimestamp, cacheSet, cacheClear, cacheClearAll };
