import { getValidToken, refreshAccessToken } from './auth.js?v=202';
import { cacheGet, cacheGetRaw, cacheGetTimestamp, cacheSet, cacheClear, prefKey, migratePrefKey } from './storage.js?v=202';
import { idbDel, idbDelByPrefix, idbGetCached, idbGetCachedRaw, idbGetTimestamp, idbSetCached } from './idb.js?v=202';
import { OWNER_KEY_LIST } from './history-keys.js?v=202';
import { showToast } from './ui/toast.js?v=202';
import { artistIsSame, limpiaParaQuery } from './util/track-match.js?v=202';

const BASE = 'https://api.spotify.com/v1';
const MIN_RETRY_WAIT = 5000;
// Techo de la espera por 429. `MIN_RETRY_WAIT` es un PISO; sin un tope, la
// cuenta `Retry-After * 1000` no tiene límite superior y un `Retry-After: 36000`
// duerme la pestaña DIEZ HORAS dentro de un `await`, sin error, sin banner y sin
// tocar la red. Hoy no pasa porque el header no es legible (ver abajo), pero era
// un bug latente esperando a que Spotify lo expusiera. 60 s: `paginateAll`
// reintenta 2 veces, así que el peor caso queda en ~2 min — por encima de las
// ráfagas cortas de Spotify y por debajo de donde uno da la app por muerta.
const MAX_RETRY_WAIT = 60000;
const DEFAULT_MAX_RETRIES = 5;
// NO cambiar este nombre para forzar recargas. Se probó en v=127 ponerle _v2
// (para que la caché vieja, guardada con un slimTrack sin album_type, dejara de
// usarse) y el resultado fue que getBestAvailableLikes devolvía source:"empty":
// la clave nueva no existía y nada dispara un fetch desde #listened, así que la
// vista quedaba con 0 likes y "Sin registrar (0)". La caché ya tiene TTL de 24h
// y se renueva sola; hasta entonces releaseKind() en listened.js deduce el tipo
// y lo avisa con "tipo estimado".
const LIKES_CACHE_KEY = 'all_liked_tracks';
const PLAYLISTS_CACHE_KEY = 'all_user_playlists';
const CACHE_TTL_MIN = 60 * 24;

// ── Aviso de que estamos esperando a Spotify ────────────────────────────────
//
// Un `console.info` solo lo ve quien tenga la consola abierta. Cuando la app se
// duerme por un 429, la interfaz tiene que DECIRLO: si no, un spinner que dice
// «Leyendo cache local…» miente durante toda la espera y no hay forma de
// distinguir «bajando» de «dormido». Esto lo emite `spotifyFetch` una vez por
// cada espera y lo escucha `app.js`, que pinta un aviso global — así vale para
// TODAS las vistas de una, sin que cada una tenga que acordarse.
const oyentesRateLimit = new Set();

/** Devuelve la función para desuscribirse. */
function onRateLimit(fn) {
  oyentesRateLimit.add(fn);
  return () => oyentesRateLimit.delete(fn);
}

function avisarRateLimit(info) {
  for (const fn of oyentesRateLimit) {
    try { fn(info); } catch (e) { console.info('[rate-limit] oyente falló:', e.message); }
  }
}

async function spotifyFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const maxRetries = options._maxRetries ?? DEFAULT_MAX_RETRIES;

  let rateLimitRetries = 0;
  let networkRetries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const token = await getValidToken();

    const headers = {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }

    let response;
    try {
      response = await fetch(url, { ...options, headers });
    } catch (netErr) {
      // Error de red sin respuesta HTTP: "Failed to fetch", conexión cortada,
      // rate-limit enmascarado como CORS, etc. Reintentamos con backoff.
      networkRetries++;
      if (networkRetries > maxRetries) {
        throw new Error(`No se pudo conectar con Spotify (${netErr.message}). Revisa tu conexión y vuelve a intentarlo.`);
      }
      const wait = Math.min(4000, 800 * networkRetries);
      console.warn(`fetch de red falló en ${endpoint} (${netErr.message}), reintento ${networkRetries}/${maxRetries} en ${(wait / 1000).toFixed(1)}s`);
      await sleep(wait);
      continue;
    }

    if (response.status === 401) {
      if (attempt < 2) {
        console.warn(`401 on ${endpoint}, forcing token refresh`);
        await refreshAccessToken();
        continue;
      }
      throw new Error('No se pudo autenticar después de refrescar el token');
    }

    if (response.status === 429) {
      rateLimitRetries++;
      if (rateLimitRetries > maxRetries) {
        const err = new Error(`Rate limited después de ${maxRetries} reintentos. Espera unos minutos y recarga.`);
        err.status = 429;
        throw err;
      }
      // ⚠️ `Retry-After` NO es legible desde el navegador: Spotify no lo incluye
      // en `Access-Control-Expose-Headers`, así que `headers.get()` devuelve
      // null aunque el header viaje. `app.js` lo sabe desde v=173 y lo maneja;
      // acá se hacía `parseInt(header || '5')`, que INVENTABA un 5 y lo hacía
      // pasar por dato de Spotify. Ahora, si no viene, se dice que no viene.
      const retryAfterHeader = response.headers.get('Retry-After');
      const pedidos = parseInt(retryAfterHeader, 10);
      const loDijoSpotify = Number.isFinite(pedidos) && pedidos > 0;
      const wait = loDijoSpotify
        ? Math.min(MAX_RETRY_WAIT, Math.max(MIN_RETRY_WAIT, pedidos * 1000))
        : MIN_RETRY_WAIT;
      // console.info y no console.warn: la extensión de Chrome solo captura
      // INFO/LOG, así que un warn acá es lo mismo que no avisar (v=163).
      console.info(`[rate-limit] 429 en ${endpoint} — espero ${(wait / 1000).toFixed(0)}s `
        + `(intento ${rateLimitRetries}/${maxRetries}, `
        + `${loDijoSpotify ? `Spotify pidió ${pedidos}s` : 'Spotify no dice cuánto (header oculto por CORS)'})`);
      avisarRateLimit({ endpoint, wait, intento: rateLimitRetries, maxRetries, pedidos: loDijoSpotify ? pedidos : null });
      await sleep(wait);
      continue;
    }

    // Errores transitorios del backend de Spotify (500, 502, 503, 504): backoff exponencial.
    if ([500, 502, 503, 504].includes(response.status)) {
      networkRetries++;
      if (networkRetries > maxRetries) {
        throw new Error(`Spotify ${response.status}: el servicio no responde después de ${maxRetries} reintentos. Prueba de nuevo en un rato.`);
      }
      const wait = Math.min(8000, 500 * Math.pow(2, networkRetries - 1));
      console.warn(`Spotify ${response.status} en ${endpoint}, backoff ${(wait / 1000).toFixed(1)}s (retry ${networkRetries}/${maxRetries})`);
      await sleep(wait);
      continue;
    }

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();

    if (!response.ok) {
      let msg;
      try {
        const json = JSON.parse(text);
        msg = json.error?.message || text;
      } catch {
        msg = text;
      }
      console.error(`Spotify ${response.status} on ${endpoint}:`, text);
      const err = new Error(`Spotify ${response.status}: ${msg}`);
      err.status = response.status;
      throw err;
    }

    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  throw new Error('Request falló después de reintentos');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const LIKES_PARTIAL_KEY = LIKES_CACHE_KEY + '_partial';

// ⚠️ El parcial NO caduca (antes: TTL de 24 h) y se lee con `idbGetCachedRaw`.
//
// El 2026-09-02 el caché de likes llevaba tres días sin poder completarse: la
// Puerta 6 del 30/08 borró IndexedDB, el resync de ~190 requests pegaba 429 y
// dejaba un parcial, y el parcial se moría a las 24 h. Al morirse, la carga
// siguiente arrancaba de `offset 0` — o sea las 190 requests otra vez, que es
// justo lo que dispara el 429. Un parcial que caduca GARANTIZA el peor caso:
// cuanto más tiempo lleva sin completarse, más caro es el intento siguiente.
//
// Un parcial viejo no puede corromper nada: `paginateAll` lo valida contra
// `startOffset` antes de retomarlo, y si la lista final no cuadra con el total
// que declara Spotify, `saveLikes()` la descarta igual. El TTL no protegía de
// nada. Ver PENDIENTES.md, «Riesgos abiertos» ítem 0.
async function savePartial(key, payload) {
  if (key === LIKES_CACHE_KEY || key === LIKES_PARTIAL_KEY) {
    try { await idbSetCached(LIKES_PARTIAL_KEY, payload, null); } catch (e) { console.warn('savePartial IDB:', e); }
  } else {
    cacheSet(key + '_partial', payload, 60);
  }
}

async function loadPartial(key) {
  if (key === LIKES_CACHE_KEY || key === LIKES_PARTIAL_KEY) {
    try { return await idbGetCachedRaw(LIKES_PARTIAL_KEY); } catch { return null; }
  }
  return cacheGet(key + '_partial');
}

async function clearPartial(key) {
  if (key === LIKES_CACHE_KEY || key === LIKES_PARTIAL_KEY) {
    try { await idbDel(LIKES_PARTIAL_KEY); } catch {}
  } else {
    cacheClear(key + '_partial');
  }
}

// `meta` (opcional) es un objeto que paginateAll rellena con `{ total, complete }`.
// `complete` solo es true si la paginación llegó hasta el final por sus propios
// medios (sin abortos ni errores) Y la cantidad de items cuadra con el `total`
// que reportó Spotify. Sirve para que el caller sepa si lo que tiene en la mano
// es la lista entera o un pedazo — ver saveLikes().
// `keepPartial: true` → paginateAll NO borra el parcial al terminar y deja esa
// decisión al caller. Ver el porqué en `startLikesLoad()`: el parcial es la red
// de seguridad y no se puede soltar antes de saber que hay suelo.
async function paginateAll(endpoint, { limit = 50, onProgress, partialCacheKey, transform, maxItems, startOffset = 0, signal, meta, keepPartial = false } = {}) {
  let items = [];
  let offset = startOffset;
  const initialOffset = startOffset;
  let total = Infinity;
  let page = 0;
  const sep = endpoint.includes('?') ? '&' : '?';
  if (meta) { meta.total = null; meta.complete = false; }

  if (partialCacheKey) {
    const partial = await loadPartial(partialCacheKey);
    if (partial && partial.items && partial.startOffset === initialOffset) {
      items = partial.items;
      offset = partial.offset;
      console.log(`Resuming from offset ${offset} (${items.length} items already cached)`);
    }
  }

  let pagesSinceSave = 0;
  while (offset < total && (!maxItems || items.length < maxItems)) {
    if (signal?.aborted) {
      if (partialCacheKey && items.length > 0) {
        await savePartial(partialCacheKey, { items, offset, startOffset: initialOffset });
      }
      throw new Error('Carga cancelada');
    }
    const url = `${BASE}${endpoint}${sep}limit=${limit}&offset=${offset}`;
    try {
      const data = await spotifyFetch(url, { _maxRetries: 2 });
      if (data.items) {
        const newItems = transform ? data.items.map(transform) : data.items;
        items.push(...newItems);
      }
      if (data.total != null) {
        total = data.total;
      }
      page++;
      offset += limit;
      pagesSinceSave++;
      if (onProgress) {
        onProgress({ loaded: items.length, total, page });
      }

      if (partialCacheKey && pagesSinceSave >= 10) {
        await savePartial(partialCacheKey, { items, offset, startOffset: initialOffset });
        pagesSinceSave = 0;
      }

      if (!data.next) { if (meta) meta.reachedEnd = true; break; }
      await sleep(600);
    } catch (e) {
      if (partialCacheKey && items.length > 0) {
        await savePartial(partialCacheKey, { items, offset, startOffset: initialOffset });
        console.warn(`Saved partial progress: ${items.length} items at offset ${offset}`);
      }
      throw e;
    }
  }

  if (meta) {
    meta.total = Number.isFinite(total) ? total : null;
    // Completa = terminó la paginación por sus medios y la cuenta cuadra con el
    // total que declaró Spotify. Si `total` no vino (endpoints que no lo mandan),
    // nos quedamos con haber llegado al final.
    const ended = meta.reachedEnd || offset >= total;
    meta.complete = !!ended && (meta.total == null || items.length + initialOffset >= meta.total);
  }

  if (partialCacheKey && !keepPartial) {
    await clearPartial(partialCacheKey);
  }

  return items;
}

function slimTrack(t) {
  if (!t) return t;
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    popularity: t.popularity,
    duration_ms: t.duration_ms,
    explicit: t.explicit,
    is_playable: t.is_playable,
    // v=142: sin esto, la ficha de álbum no sabía el número de pista de ningún
    // like (ordenaba alfabético y pintaba un "·" de relleno en cada fila). Las
    // cachés viejas no lo traen; ahí la fila queda sin número, como hasta ahora.
    track_number: t.track_number,
    external_ids: t.external_ids ? { isrc: t.external_ids.isrc } : undefined,
    artists: (t.artists || []).map(a => ({ id: a.id, name: a.name })),
    album: t.album ? {
      id: t.album.id,
      name: t.album.name,
      release_date: t.album.release_date,
      // v=127: hasta ahora los tirábamos y sin ellos no hay forma de saber si
      // un like viene de un álbum o de un single suelto. Los necesita el filtro
      // por tipo de "Quizás escuchaste y no registraste" (#listened), donde los
      // singles con un solo like tapaban a los álbumes de verdad.
      album_type: t.album.album_type,
      total_tracks: t.album.total_tracks,
      // v=138: las DOS más chicas (300 y 64), no solo la de 64. #sin-clasificar
      // pinta la tapa a 96px y con la de 64 se ve borrosa. Es una URL más por
      // like (~0,6 MB de caché con 9.500 likes). Las cachés viejas siguen
      // trayendo una sola: util/cover-size.js deduce la de 300 desde la de 64.
      images: (t.album.images || []).slice(-2),
    } : undefined,
  };
}

function slimPlaylist(p) {
  if (!p) return p;
  const imgs = p.images || [];
  const smallest = imgs.length > 0 ? imgs[imgs.length - 1].url : null;
  return {
    id: p.id,
    name: p.name,
    owner: p.owner ? { id: p.owner.id, display_name: p.owner.display_name } : undefined,
    // Post-migración la API expone `items`, no `tracks`. Se sigue guardando
    // bajo `tracks` para no tocar a los que ya lo leen (#dedupe,
    // #duplicate-albums, el orden de #wthree), que hasta ahora recibían
    // `undefined` y mostraban «?».
    tracks: p.tracks ? { total: p.tracks.total }
          : p.items  ? { total: p.items.total }
          : undefined,
    public: p.public,
    collaborative: p.collaborative,
    image: smallest,
  };
}

async function migrateLikesFromLocalStorage() {
  const legacy = cacheGetRaw(LIKES_CACHE_KEY);
  if (Array.isArray(legacy) && legacy.length > 0) {
    try {
      await idbSetCached(LIKES_CACHE_KEY, legacy, null);   // sin caducidad, igual que saveLikes()
      cacheClear(LIKES_CACHE_KEY);
      console.log(`Migrated ${legacy.length} likes from localStorage to IndexedDB`);
    } catch (e) {
      console.warn('Migration failed:', e);
    }
  }
  const legacyPartial = cacheGetRaw(LIKES_CACHE_KEY + '_partial');
  if (legacyPartial && legacyPartial.items?.length > 0) {
    try {
      await idbSetCached(LIKES_PARTIAL_KEY, legacyPartial, null);  // sin caducidad, igual que savePartial()
      cacheClear(LIKES_CACHE_KEY + '_partial');
    } catch (e) {
      console.warn('Partial migration failed:', e);
    }
  }
}

// ── La ÚNICA forma de leer el caché completo de likes ───────────────────────
//
// Antes había CUATRO lecturas de `LIKES_CACHE_KEY` repartidas por el archivo y
// no se comportaban igual: `getBestAvailableLikes()` usaba `idbGetCachedRaw()`
// (ignora la caducidad) y las otras tres —`getAllLikedTracks()`,
// `syncLikesIncremental()` y `tryAutoLoadUserBackup()`— usaban
// `idbGetCached()`, que además de devolver null BORRA la clave vencida
// (`idb.js`). Con el TTL de 24 h que tenía el caché, eso significaba que un día
// después de una carga buena la primera de nueve vistas que pasara por acá
// DESTRUÍA las ~9.400 canciones y forzaba el resync entero de ~190 requests,
// que es lo que dispara el 429. Ese era el motor del círculo del 30/08.
//
// Ahora el caché se escribe sin caducidad (ver `saveLikes`) y se lee siempre
// por acá. Que quede UNA sola función es la mitad importante del arreglo: con
// dos formas de leer lo mismo, en tres meses vuelven a divergir.
//
// Nunca borra nada. Si el caché no sirve, se rehace; no se destruye.
async function leerLikesCacheados() {
  try {
    const full = await idbGetCachedRaw(LIKES_CACHE_KEY);
    if (Array.isArray(full) && full.length > 0) return full;
  } catch (e) {
    console.info('[likes] no pude leer el caché de IDB:', e.message);
  }
  // Caché heredado de localStorage (pre-v=86). Mismo criterio: entero o nada.
  const legacy = cacheGetRaw(LIKES_CACHE_KEY);
  if (Array.isArray(legacy) && legacy.length > 0) return legacy;
  return null;
}

// El caché de likes es o completo o nada. Antes cualquier paginación cortada
// (aborto, 429, respuesta sin `next`) podía escribir una lista truncada encima
// de las 9.548 canciones buenas, y el resto de la app la leía como si fuera la
// biblioteca entera. Ahora una escritura solo pisa el caché si viene marcada
// como completa; si no, se descarta y queda el caché anterior intacto.
async function saveLikes(items, { complete = true, total = null } = {}) {
  if (!complete) {
    console.warn(`[likes] descarto guardar ${items.length} likes: carga incompleta` + (total != null ? ` (total real ${total})` : ''));
    return { ok: false, skipped: true };
  }
  try {
    // ⚠️ SIN caducidad (antes: CACHE_TTL_MIN, 24 h). Ver `leerLikesCacheados()`
    // arriba: con TTL, el día siguiente a una carga buena cualquier vista que
    // leyera con `idbGetCached()` borraba la biblioteca entera y forzaba el
    // resync de ~190 requests. La frescura NO se resuelve caducando 9.400
    // canciones: la resuelve `syncLikesIncremental()`, que compara el total con
    // Spotify en UNA request y trae solo el delta.
    await idbSetCached(LIKES_CACHE_KEY, items, null);
    return { ok: true };
  } catch (e) {
    console.error('IDB saveLikes failed:', e);
    showToast(`Error guardando ${items.length.toLocaleString('es-ES')} likes en el navegador: ${e.message}. Exporta el JSON YA para no perderlos.`, 'error');
    return { ok: false, error: e };
  }
}

// ── Carga de likes compartida entre vistas ──────────────────────────────────
// Sin esto, dos vistas abiertas a la vez (p. ej. #sin-clasificar escaneando e
// Ian entrando a #skips) lanzaban dos paginaciones de ~190 requests sobre la
// MISMA clave de parcial, pisándose el progreso: la que iba por el ítem 9.000
// quedaba reemplazada por la que recién llevaba 100. Ahora la primera que llega
// crea la carga y las demás se cuelgan de la misma promesa.
//
// El aborto es por refcount: cancelar en una vista solo la desuscribe; la carga
// se corta únicamente cuando se van TODOS los interesados.
let likesInFlight = null;

function startLikesLoad({ force }) {
  const state = {
    controller: new AbortController(),
    listeners: new Set(),
    subscribers: new Set(),
  };
  state.promise = (async () => {
    try {
      if (force) await clearPartial(LIKES_CACHE_KEY);
      const meta = {};
      const items = await paginateAll('/me/tracks', {
        limit: 50,
        onProgress: (p) => {
          for (const l of state.listeners) {
            try { l(p); } catch (e) { console.warn('[likes] onProgress:', e); }
          }
        },
        partialCacheKey: LIKES_CACHE_KEY,
        transform: item => ({ added_at: item.added_at, track: slimTrack(item.track) }),
        signal: state.controller.signal,
        meta,
        // La red de seguridad no se suelta acá — ver abajo.
        keepPartial: true,
      });

      // ⚠️ ORDEN, y es lo importante de este bloque.
      //
      // Antes `paginateAll` borraba el parcial al terminar el bucle y RECIÉN
      // DESPUÉS se llamaba a `saveLikes()`, que descarta la escritura entera si
      // la cuenta no cuadra con el total de Spotify. O sea que una carga que
      // terminaba pero no cuadraba dejaba las dos manos vacías: sin parcial y
      // sin completo, y la vista siguiente arrancaba de `offset 0` con las ~190
      // requests que disparan el 429. Bastaba con que una página volviera con
      // menos de 50 items.
      //
      // Ahora el parcial se borra SOLO después de que el completo esté escrito
      // y confirmado. Si algo falla, se conserva el progreso: siempre es mejor
      // retomar en 8.500 que volver a empezar de 0.
      const guardado = await saveLikes(items, { complete: meta.complete, total: meta.total });

      if (!meta.complete || !guardado.ok) {
        // Dos fallos distintos, y confundirlos manda a buscar donde no es:
        //  - la descarga no llegó al final → faltan canciones
        //  - la descarga cuadró pero NO SE PUDO ESCRIBIR (IDB lleno, cuota,
        //    modo incógnito) → no falta nada, falla el navegador
        const detalle = `${items.length.toLocaleString('es-ES')}${meta.total != null ? ` de ${meta.total.toLocaleString('es-ES')}` : ''}`;
        const motivo = !meta.complete
          ? `La descarga se ha cortado antes de acabar (${detalle}).`
          : `Se han descargado las ${detalle}, pero el navegador no ha podido guardarlas`
            + `${guardado.error ? ` (${guardado.error.message})` : ''}.`;
        console.info(`[likes] carga no consolidada — ${motivo} Conservo el parcial para retomar.`);
        throw new Error(`${motivo} No se ha tocado la caché anterior, y el progreso queda guardado para retomarlo.`);
      }

      await clearPartial(LIKES_CACHE_KEY);
      console.log(`[likes] caché consolidado: ${items.length.toLocaleString('es-ES')} canciones, sin caducidad`);
      return items;
    } finally {
      if (likesInFlight === state) likesInFlight = null;
    }
  })();
  return state;
}

async function loadLikesShared(onProgress, { force = false, signal } = {}) {
  if (!likesInFlight) likesInFlight = startLikesLoad({ force });
  const state = likesInFlight;

  const token = {};
  state.subscribers.add(token);
  if (onProgress) state.listeners.add(onProgress);

  const detach = () => {
    if (!state.subscribers.has(token)) return;
    state.subscribers.delete(token);
    if (onProgress) state.listeners.delete(onProgress);
    if (state.subscribers.size === 0) state.controller.abort();
  };

  if (signal) {
    if (signal.aborted) { detach(); throw new Error('Carga cancelada'); }
    signal.addEventListener('abort', detach, { once: true });
  }

  try {
    return await state.promise;
  } finally {
    if (signal) signal.removeEventListener('abort', detach);
    state.subscribers.delete(token);
    if (onProgress) state.listeners.delete(onProgress);
  }
}

async function getAllLikedTracks(onProgress, { force = false, signal } = {}) {
  await migrateLikesFromLocalStorage();

  if (!force) {
    const cached = await leerLikesCacheados();
    if (cached) {
      if (onProgress) onProgress({ loaded: cached.length, total: cached.length, page: 1, cached: true });
      return cached;
    }
  }

  return loadLikesShared(onProgress, { force, signal });
}

async function getAllUserPlaylists(onProgress, { force = false, signal } = {}) {
  if (!force) {
    const cached = cacheGet(PLAYLISTS_CACHE_KEY);
    if (cached) {
      if (onProgress) onProgress({ loaded: cached.length, total: cached.length, page: 1, cached: true });
      return cached;
    }
  }
  if (force) cacheClear(PLAYLISTS_CACHE_KEY + '_partial');
  const items = await paginateAll('/me/playlists', {
    limit: 50,
    onProgress,
    partialCacheKey: PLAYLISTS_CACHE_KEY,
    transform: slimPlaylist,
    signal,
  });
  cacheSet(PLAYLISTS_CACHE_KEY, items, CACHE_TTL_MIN);
  return items;
}

function invalidateLikesCache() {
  cacheClear(LIKES_CACHE_KEY);
  idbDel(LIKES_CACHE_KEY).catch(() => {});
  idbDel(LIKES_PARTIAL_KEY).catch(() => {});
}

async function getLikesTotal() {
  const data = await spotifyFetch('/me/tracks?limit=1');
  return data?.total ?? 0;
}

async function getRecentLikes(count) {
  if (count <= 0) return [];
  const items = await paginateAll('/me/tracks', {
    limit: Math.min(50, count),
    transform: item => ({ added_at: item.added_at, track: slimTrack(item.track) }),
    maxItems: count,
  });
  return items.slice(0, count);
}

async function syncLikesIncremental(onProgress) {
  await migrateLikesFromLocalStorage();
  const cached = await leerLikesCacheados();
  if (!cached || cached.length === 0) {
    return { hadCache: false };
  }

  if (onProgress) onProgress({ phase: 'checking', message: 'Chequeando total con Spotify (1 request)...' });
  const totalNow = await getLikesTotal();
  const delta = totalNow - cached.length;

  // Igual: nada que hacer.
  if (delta === 0) {
    return { hadCache: true, added: 0, removed: 0, totalNow, cachedCount: cached.length };
  }

  // Borraste likes en Spotify (o desde otra herramienta). Bajamos todo de nuevo
  // para reconciliar — un incremental no sabe QUÉ desaparecieron.
  if (delta < 0) {
    const removed = -delta;
    if (onProgress) onProgress({ phase: 'reconciling', message: `En Spotify hay ${removed.toLocaleString('es-ES')} likes menos que en caché. Re-bajando todo para reconciliar...` });
    // ⚠️ Antes acá se llamaba a `invalidateLikesCache()` ANTES de bajar nada: se
    // destruían las ~9.400 canciones y recién después se intentaba la descarga.
    // Si esa descarga pegaba 429 —lo normal, son ~190 requests— quedaba sin
    // caché y sin reemplazo. `force: true` hace lo mismo sin el estropicio: se
    // salta la lectura del caché y solo lo pisa cuando la carga nueva está
    // completa y confirmada (ver `saveLikes`). Si falla, el viejo sigue ahí.
    const fresh = await getAllLikedTracks(({ loaded, total }) => {
      if (onProgress) onProgress({ phase: 'fetching-full', message: `Re-bajando likes (${loaded.toLocaleString('es-ES')} / ${(total || totalNow).toLocaleString('es-ES')})...`, loaded, total: total || totalNow });
    }, { force: true });
    return { hadCache: true, added: 0, removed, totalNow, cachedCount: fresh.length, reconciled: true };
  }

  // delta > 0: hay likes nuevos → los agregamos al frente.
  if (onProgress) onProgress({ phase: 'fetching', message: `Trayendo ${delta} likes nuevos...`, delta });
  const knownUris = new Set(cached.map(i => i?.track?.uri).filter(Boolean));
  const recent = await getRecentLikes(delta + 20);
  const newOnes = recent.filter(r => r?.track?.uri && !knownUris.has(r.track.uri));
  const finalItems = [...newOnes, ...cached];
  await saveLikes(finalItems);
  return { hadCache: true, added: newOnes.length, removed: 0, totalNow, cachedCount: finalItems.length };
}

// Devuelve SIEMPRE la biblioteca entera o nada. Hasta v=129 esta función caía
// al caché parcial y lo devolvía con `source:'partial'`, pero como ninguna de
// las 17 vistas que la usan miraba el `source`, un parcial de 100 canciones se
// mostraba como "100 likes" — el bug que vio Ian al abrir #skips mientras
// #sin-clasificar escaneaba. Ahora el parcial no se sirve nunca: solo existe
// para que paginateAll pueda retomar la descarga donde la dejó.
async function getBestAvailableLikes({ onProgress, signal, allowFetch = true } = {}) {
  await migrateLikesFromLocalStorage();

  const full = await idbGetCachedRaw(LIKES_CACHE_KEY);
  if (Array.isArray(full) && full.length > 0) {
    return { items: full, source: 'full' };
  }
  const legacyFull = cacheGetRaw(LIKES_CACHE_KEY);
  if (Array.isArray(legacyFull) && legacyFull.length > 0) {
    return { items: legacyFull, source: 'full' };
  }

  if (!allowFetch) return { items: [], source: 'empty' };

  // No hay caché completo. Puede haber un parcial: completarlo es justamente lo
  // que hace loadLikesShared (paginateAll retoma desde el offset guardado), y si
  // otra vista ya está descargando nos colgamos de su misma carga.
  try {
    const items = await loadLikesShared(onProgress, { signal });
    return { items, source: 'full' };
  } catch (e) {
    console.warn('[likes] no pude completar la carga:', e.message);
    return { items: [], source: 'empty', error: e };
  }
}

/**
 * Qué hay a medias, sin bajar nada. La pantalla de arranque necesita saber si
 * quedó una descarga cortada para poder DECIRLO en vez de fingir que no hay
 * nada — y para ofrecer «retomar», que cuesta 18 requests en vez de 190.
 */
async function getLikesPartialInfo() {
  try {
    const p = await loadPartial(LIKES_CACHE_KEY);
    if (p && Array.isArray(p.items) && p.items.length > 0) {
      return { items: p.items.length, offset: p.offset ?? p.items.length };
    }
  } catch { /* sin IDB: como si no hubiera parcial */ }
  return null;
}

async function getLikesCacheTimestamp() {
  const ts = await idbGetTimestamp(LIKES_CACHE_KEY);
  if (ts) return ts;
  const tsPartial = await idbGetTimestamp(LIKES_PARTIAL_KEY);
  if (tsPartial) return tsPartial;
  return cacheGetTimestamp(LIKES_CACHE_KEY) || cacheGetTimestamp(LIKES_CACHE_KEY + '_partial');
}

const CONFIG_LOCAL_KEYS = [
  'listened_albums_playlist_id',
  'listened_albums_playlist_name',
  'lastfm_username',
  'statsfm_username',
  'genre_sort_mode',
  'genre_groups_mode',
  'artist_sort_mode',
];

// ⚠️ v=183: las claves de CONFIG_LOCAL_KEYS pasaron a vivir prefijadas por
// usuario (`prefKey()`, ver storage.js). El export/import sigue guardando el
// nombre BASE en el JSON (no cambia el formato del backup) — lo que cambia es
// dónde se lee/escribe en ESTE navegador.
function readLocalConfig() {
  const cfg = {};
  for (const k of CONFIG_LOCAL_KEYS) {
    migratePrefKey(k);
    const v = localStorage.getItem(prefKey(k));
    if (v != null) cfg[k] = v;
  }
  return cfg;
}

function applyLocalConfig(cfg, { overwrite = false } = {}) {
  if (!cfg || typeof cfg !== 'object') return 0;
  let applied = 0;
  for (const k of CONFIG_LOCAL_KEYS) {
    if (cfg[k] == null) continue;
    migratePrefKey(k);
    if (overwrite || localStorage.getItem(prefKey(k)) == null) {
      localStorage.setItem(prefKey(k), String(cfg[k]));
      applied++;
    }
  }
  return applied;
}

async function exportAllData(spotifyUserId) {
  const { items: likes, source } = await getBestAvailableLikes();
  const tagsCache = JSON.parse(localStorage.getItem('lastfm_artist_tags_cache') || '{}');
  return {
    _format: 'spotify-tools-data',
    _version: 2,
    _exportedAt: new Date().toISOString(),
    spotifyUserId: spotifyUserId || null,
    _likesSource: source,
    likes: {
      totalAtExport: likes.length,
      items: likes,
    },
    tags: {
      entries: tagsCache,
    },
    _config: readLocalConfig(),
  };
}

async function importAllData(parsed, onProgress, { currentUserId = null } = {}) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido');

  const result = {
    likesImported: 0,
    likesAdded: 0,
    tagsImported: 0,
    tagsUpdated: 0,
    configApplied: 0,
    configSkipped: false,
    format: parsed._format || 'desconocido',
  };

  const hasNewLikes = parsed.likes?.items && Array.isArray(parsed.likes.items);
  const isOldLikes = Array.isArray(parsed.items) && parsed._format === 'spotify-tools-likes';
  if (hasNewLikes || isOldLikes) {
    const likesPayload = hasNewLikes ? parsed.likes : parsed;
    const r = await importLikesData(likesPayload, onProgress);
    result.likesImported = r.imported;
    result.likesAdded = r.added;
  }

  const hasNewTags = parsed.tags?.entries && typeof parsed.tags.entries === 'object';
  const isOldTags = parsed.entries && parsed._format === 'spotify-tools-genres';
  if (hasNewTags || isOldTags) {
    const tagsPayload = hasNewTags ? parsed.tags : parsed;
    const cache = JSON.parse(localStorage.getItem('lastfm_artist_tags_cache') || '{}');
    let added = 0;
    let updated = 0;
    for (const [key, entry] of Object.entries(tagsPayload.entries || {})) {
      if (!entry || !Array.isArray(entry.tags)) continue;
      if (cache[key]) updated++;
      else added++;
      cache[key] = { tags: entry.tags, at: entry.at || Date.now() };
    }
    localStorage.setItem('lastfm_artist_tags_cache', JSON.stringify(cache));
    result.tagsImported = added;
    result.tagsUpdated = updated;
  }

  if (parsed._config && typeof parsed._config === 'object') {
    const backupUserId = parsed.spotifyUserId || null;
    if (currentUserId && backupUserId && currentUserId === backupUserId) {
      result.configApplied = applyLocalConfig(parsed._config, { overwrite: true });
    } else {
      result.configSkipped = true;
    }
  }

  return result;
}

async function tryAutoLoadUserBackup(spotifyUserId) {
  if (!spotifyUserId) return { loaded: false };
  await migrateLikesFromLocalStorage();

  const cachedLikes = await leerLikesCacheados();
  if (cachedLikes && cachedLikes.length > 0) {
    return { loaded: false, reason: 'ya-hay-cache-local' };
  }

  const safeId = spotifyUserId.replace(/[^A-Za-z0-9._-]/g, '');
  const url = `data/user-${safeId}.json`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return { loaded: false, reason: 'sin-archivo' };
    if (!res.ok) return { loaded: false, reason: `http-${res.status}` };
    const parsed = await res.json();

    let likesCount = 0;
    let tagsCount = 0;
    let delta = 0;

    if (parsed.likes?.items && Array.isArray(parsed.likes.items)) {
      const result = await importLikesData(parsed.likes);
      likesCount = result.imported;
      delta = result.added;
    } else if (Array.isArray(parsed.items) && parsed._format === 'spotify-tools-likes') {
      const result = await importLikesData(parsed);
      likesCount = result.imported;
      delta = result.added;
    }

    if (parsed.tags?.entries || parsed._format === 'spotify-tools-genres') {
      const cache = JSON.parse(localStorage.getItem('lastfm_artist_tags_cache') || '{}');
      const entries = parsed.tags?.entries || parsed.entries || {};
      let merged = 0;
      for (const [key, entry] of Object.entries(entries)) {
        if (entry && Array.isArray(entry.tags) && !cache[key]) {
          cache[key] = entry;
          merged++;
        }
      }
      localStorage.setItem('lastfm_artist_tags_cache', JSON.stringify(cache));
      tagsCount = merged;
    }

    let configApplied = 0;
    if (parsed._config && typeof parsed._config === 'object' && parsed.spotifyUserId === spotifyUserId) {
      configApplied = applyLocalConfig(parsed._config, { overwrite: false });
    }

    return { loaded: true, likesCount, tagsCount, delta, configApplied };
  } catch (e) {
    console.warn('Auto-load falló:', e.message);
    return { loaded: false, reason: e.message };
  }
}

async function importLikesData(parsed, onProgress) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido');
  const imported = Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed) ? parsed : null);
  if (!imported) throw new Error('El archivo no tiene items');

  const totalAtExport = typeof parsed.totalAtExport === 'number' ? parsed.totalAtExport : imported.length;

  if (imported.length === 0) {
    if (onProgress) onProgress({ phase: 'empty', message: 'El archivo está vacío' });
    return { imported: 0, added: 0, totalNow: null, totalAtExport, empty: true };
  }

  if (onProgress) onProgress({ phase: 'checking', message: 'Chequeando total con Spotify (1 request)...' });
  const totalNow = await getLikesTotal();
  const delta = totalNow - totalAtExport;

  let finalItems = imported;

  if (delta > 0) {
    if (delta > 1000) {
      if (onProgress) onProgress({ phase: 'skip-big', message: `El archivo tiene ${imported.length} likes pero Spotify tiene ${totalNow} (delta ${delta}). Se importa solo lo del archivo. Para sincronizar todo usa "Actualizar datos".` });
    } else {
      if (onProgress) onProgress({ phase: 'fetching', message: `Trayendo ${delta} likes nuevos...`, delta });
      const knownUris = new Set(imported.map(i => i?.track?.uri).filter(Boolean));
      const fetchCount = delta + 20;
      const recent = await getRecentLikes(fetchCount);
      const newOnes = recent.filter(r => r?.track?.uri && !knownUris.has(r.track.uri));
      finalItems = [...newOnes, ...imported];
    }
  }

  await saveLikes(finalItems);
  return {
    imported: imported.length,
    added: finalItems.length - imported.length,
    totalNow,
    totalAtExport,
    skippedBigDelta: delta > 1000,
  };
}

// Suscriptores a la invalidación del cache de playlists. Existe para que los
// memos de módulo (hoy el de `util/playlist-add.js`) se enteren de un
// POST /me/playlists hecho desde CUALQUIER vista sin que api.js tenga que
// importarlos — eso sería un ciclo, porque playlist-add.js importa api.js.
// Así queda un solo punto de invalidación en vez de doce call sites de
// createPlaylist que hay que acordarse de tocar (incluido util/hidden-sync.js,
// que crea las playlists de ocultos).
const _playlistsInvalidationSubs = new Set();

function onPlaylistsInvalidated(fn) {
  _playlistsInvalidationSubs.add(fn);
  return () => _playlistsInvalidationSubs.delete(fn);
}

function invalidatePlaylistsCache() {
  cacheClear(PLAYLISTS_CACHE_KEY);
  for (const fn of _playlistsInvalidationSubs) {
    try { fn(); } catch (e) { console.warn('[api] suscriptor de invalidación falló:', e.message); }
  }
}

// Tope de uris por request en TODA la ruta /me/library (contains, PUT y DELETE).
//
// Medido en vivo el 2026-08-28 con token real: 40 → 200; 41, 42, 43, 44, 45, 48,
// 49, 50 y 60 → 400 «Too many uris requested»; 100 → 414 (URL demasiado larga).
// Vale igual para `spotify:track:` y `spotify:album:`.
//
// Hasta esa fecha las dos funciones de `contains` iban de a 50 y por lo tanto
// **fallaban siempre en el primer chunk**. Como la única llamadora las envolvía
// en un catch con `console.warn`, la verificación posterior a un borrado de más
// de 40 pistas nunca corrió y nadie se enteró. De ahí sale la constante: que el
// número viva en un solo sitio y no se pueda volver a desincronizar.
const LIBRARY_URIS_POR_REQUEST = 40;

// Confirma cuáles ids siguen en la biblioteca. Post-migración feb 2026:
// GET /me/tracks/contains → 403; el que vive es GET /me/library/contains con URIs.
// Devuelve Map<id, bool>.
//
// TIRA si Spotify responde con error, y tiene que seguir tirando: es una
// verificación, y una verificación que se traga su propio fallo es peor que no
// tenerla —da la misma cara que un resultado limpio. Quien la llame decide qué
// hacer con la excepción, pero no puede ignorarla en silencio.
async function checkLibraryContains(ids) {
  const clean = [...new Set((ids || []).filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < clean.length; i += LIBRARY_URIS_POR_REQUEST) {
    const chunk = clean.slice(i, i + LIBRARY_URIS_POR_REQUEST);
    const uris = chunk.map(id => `spotify:track:${id}`).join(',');
    const r = await spotifyFetch(`/me/library/contains?uris=${encodeURIComponent(uris)}`);
    if (!Array.isArray(r) || r.length !== chunk.length) {
      throw new Error(`/me/library/contains devolvió algo inesperado (esperaba ${chunk.length} booleanos)`);
    }
    chunk.forEach((id, j) => out.set(id, !!r[j]));
    if (i + LIBRARY_URIS_POR_REQUEST < clean.length) await sleep(300);
  }
  if (out.size !== clean.length) {
    throw new Error(`/me/library/contains: pedí ${clean.length} ids y volvieron ${out.size}`);
  }
  return out;
}

const PLAYLIST_ITEMS_TTL_MIN = 30 * 24 * 60; // el snapshot_id valida frescura; el TTL solo limpia playlists abandonadas

// Items de playlist con cache en IDB validado por snapshot_id: un request barato
// pide el snapshot actual; si coincide con el cacheado, la carga es instantánea.
// Clave para playlists grandes (anothertwo ~9k tracks = ~93 requests sin cache).
async function getAllPlaylistItems(playlistId, onProgress, { signal, useCache = true } = {}) {
  const key = `playlist_items_${playlistId}`;
  let snapshot = null;
  if (useCache) {
    try {
      const meta = await spotifyFetch(`/playlists/${playlistId}?fields=snapshot_id`);
      snapshot = meta?.snapshot_id || null;
      if (snapshot) {
        const cached = await idbGetCached(key);
        if (cached && cached.snapshot === snapshot && Array.isArray(cached.items)) {
          if (onProgress) onProgress({ loaded: cached.items.length, total: cached.items.length });
          return cached.items;
        }
      }
    } catch { /* sin snapshot o sin IDB: carga paginada normal */ }
  }
  const items = await paginateAll(`/playlists/${playlistId}/items`, {
    limit: 100,
    onProgress,
    signal,
  });
  if (snapshot) {
    try { await idbSetCached(key, { snapshot, items }, PLAYLIST_ITEMS_TTL_MIN); } catch { /* ignora */ }
  }
  return items;
}

// Actualiza (o borra, si falta snapshot/items) el cache de items después de que
// NOSOTROS escribimos en la playlist — así el próximo análisis no re-baja todo.
async function updatePlaylistItemsCache(playlistId, items, snapshot) {
  const key = `playlist_items_${playlistId}`;
  try {
    if (snapshot && Array.isArray(items)) {
      await idbSetCached(key, { snapshot, items }, PLAYLIST_ITEMS_TTL_MIN);
    } else {
      await idbDel(key);
    }
  } catch { /* ignora */ }
}

// Tops del user logueado (scope user-top-read, ya pedido en auth).
// type: 'artists' | 'tracks' · timeRange: short_term (~1 mes) | medium_term (~6 meses) | long_term (~1 año+)
// No verificado post-migración feb 2026: los callers degradan con try/catch.
async function getMyTop(type, timeRange = 'medium_term', limit = 50) {
  const d = await spotifyFetch(`/me/top/${type}?time_range=${timeRange}&limit=${limit}`);
  return d?.items || [];
}

async function getUserProfile() {
  return spotifyFetch('/me');
}

let _cachedUserId = null;
const LAST_USER_KEY = 'fonoteca_last_user_id';
async function getCurrentUserId() {
  if (_cachedUserId) return _cachedUserId;
  const me = await spotifyFetch('/me');
  _cachedUserId = me.id;
  // Si el user id cambió respecto al último que estuvo en este browser,
  // limpio caches de likes/playlists para que no se mezclen. También limpio
  // los caches del historial pre-cargado (JSONs del owner) en IDB.
  try {
    const prev = localStorage.getItem(LAST_USER_KEY);
    if (prev && prev !== _cachedUserId) {
      console.info(`Fonoteca: user cambió (${prev} → ${_cachedUserId}), limpiando caché local`);
      invalidateLikesCache();
      invalidatePlaylistsCache();
      // Caches del historial del owner: si el nuevo user no es el owner, sobran;
      // si es el owner de vuelta, los re-baja del JSON del repo.
      // ⚠️ Esta lista era una copia escrita a mano y se quedó vieja: borraba
      // `history_track_plays_v2` y `history_skip_stats_v1` cuando las reales ya
      // eran la v5 y la v2, así que al entrar otra persona en este navegador NO
      // se limpiaba el historial del owner y lo veía como suyo. Ahora sale de
      // `history-keys.js`, que es de donde salen también las que se escriben.
      for (const k of OWNER_KEY_LIST) {
        idbDel(k).catch(() => {});
      }
      // Contenido de las playlists: una clave por playlist, así que no se
      // pueden nombrar de antemano. `invalidatePlaylistsCache()` solo limpia la
      // LISTA; hasta v=189 los items —que son las canciones de las playlists de
      // la otra persona— se quedaban acá hasta caducar.
      idbDelByPrefix('playlist_items_')
        .then(n => { if (n) console.info(`Fonoteca: ${n} caches de items de playlist borrados al cambiar de usuario`); })
        .catch(() => {});
      // Top de Stats.fm: clave global, sin el user delante. Desde v=190 la
      // clave lleva el usuario de Stats.fm, pero puede quedar la vieja de una
      // sesión anterior a la actualización.
      idbDelByPrefix('statsfm_top_lifetime_v1').catch(() => {});
    }
    localStorage.setItem(LAST_USER_KEY, _cachedUserId);
  } catch { /* ignora si no hay localStorage */ }
  return _cachedUserId;
}

// Devuelven el snapshot_id de la última escritura para poder actualizar el
// cache de items en el caller (updatePlaylistItemsCache) sin re-bajar todo.
async function addTracksToPlaylist(playlistId, uris, options = {}) {
  const { position } = options;
  const chunks = [];
  for (let i = 0; i < uris.length; i += 100) {
    chunks.push(uris.slice(i, i + 100));
  }
  let snapshot = null;
  let pos = position;
  for (const chunk of chunks) {
    const body = { uris: chunk };
    if (pos != null) body.position = pos;
    const r = await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (r?.snapshot_id) snapshot = r.snapshot_id;
    if (pos != null) pos += chunk.length;
  }
  return snapshot;
}

async function removeTracksFromPlaylist(playlistId, uris) {
  const chunks = [];
  for (let i = 0; i < uris.length; i += 100) {
    chunks.push(uris.slice(i, i + 100));
  }
  let snapshot = null;
  for (const chunk of chunks) {
    const r = await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'DELETE',
      body: JSON.stringify({ items: chunk.map(uri => ({ uri })) }),
    });
    if (r?.snapshot_id) snapshot = r.snapshot_id;
  }
  return snapshot;
}

// Reorder mínimo: PUT /playlists/{id}/items con {range_start, insert_before,
// range_length, snapshot_id}. Devuelve el snapshot_id nuevo para encadenar la
// próxima llamada. Confirmado vivo 2026-08-02 (200) — el mismo endpoint con
// path /tracks da 403 post-migración.
async function reorderPlaylistItems(playlistId, { range_start, insert_before, range_length = 1, snapshot_id }) {
  const body = { range_start, insert_before, range_length };
  if (snapshot_id) body.snapshot_id = snapshot_id;
  const r = await spotifyFetch(`/playlists/${playlistId}/items`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return r?.snapshot_id || null;
}

async function getPlaylistSnapshotId(playlistId) {
  const r = await spotifyFetch(`/playlists/${playlistId}?fields=snapshot_id`);
  return r?.snapshot_id || null;
}

// Snapshot con el que guardamos el último cache de items de la playlist.
// Sirve para saber si las posiciones cacheadas siguen válidas sin refetch:
// si server snapshot === cached snapshot, nadie escribió → posiciones OK.
async function getCachedPlaylistSnapshot(playlistId) {
  try {
    const cached = await idbGetCached(`playlist_items_${playlistId}`);
    return cached?.snapshot || null;
  } catch { return null; }
}

// El cache completo (items + snapshot) para poder parchearlo en el lugar
// después de escribir, en vez de borrarlo y pagar un refetch entero al
// guardado siguiente. Ver util/playlist-cache-patch.js.
async function getCachedPlaylistItems(playlistId) {
  try {
    const cached = await idbGetCached(`playlist_items_${playlistId}`);
    if (!cached || !Array.isArray(cached.items) || !cached.snapshot) return null;
    return { items: cached.items, snapshot: cached.snapshot };
  } catch { return null; }
}

async function removePlaylistItemsAtPositions(playlistId, itemsWithPositions) {
  const meta = await spotifyFetch(`/playlists/${playlistId}?fields=snapshot_id`);
  const snapshotId = meta.snapshot_id;
  const chunks = [];
  for (let i = 0; i < itemsWithPositions.length; i += 100) {
    chunks.push(itemsWithPositions.slice(i, i + 100));
  }
  for (const chunk of chunks) {
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'DELETE',
      body: JSON.stringify({ items: chunk, snapshot_id: snapshotId }),
    });
  }
}

// Saca ids del cache de likes SIN re-bajar todo (evita el full-refetch y que por consistencia
// eventual de Spotify reaparezcan los recién borrados).
async function removeFromLikesCache(ids) {
  const idSet = new Set(ids);
  try {
    const cached = await leerLikesCacheados();
    if (Array.isArray(cached)) {
      const filtered = cached.filter(it => !idSet.has(it?.track?.id));
      await saveLikes(filtered, { complete: true, total: filtered.length });
    }
  } catch (e) {
    // ⚠️ Antes acá había un `invalidateLikesCache()`: si quitar 3 ids del caché
    // fallaba, se BORRABAN las ~9.400 canciones enteras y la vista siguiente se
    // comía el resync de ~190 requests → 429 → parcial → el círculo del 30/08.
    // Destruir el caché nunca es la respuesta correcta a un problema: un caché
    // con 3 canciones de más es infinitamente mejor que ninguno, y el borrado
    // real en Spotify ya se hizo igual. Se deja como está y se avisa.
    console.info('[likes] no pude actualizar el caché tras el borrado (queda con los ids viejos):', e.message);
    showToast('Los borré en Spotify, pero el caché local quedó desactualizado. Se corrige en la próxima sincronización.', 'info');
  }
  cacheClear(LIKES_CACHE_KEY); // limpia copia legacy en localStorage si existiera
}

// ── Registro local de borrados de me gusta ───────────────────────────────────
//
// El caché de likes NO es una copia de seguridad: `removeFromLikesCache()` lo
// filtra en el mismo momento en que se borra, y le pone `storedAt` de ese
// instante, así que después de un borrado parece recién sincronizado y ya no
// tiene las pistas. El 26/08/2026 eso dejó un borrado accidental de #versions
// sin ninguna copia previa: hubo que reconstruir la lista contra un export de
// hacía una semana.
//
// Por eso el registro vive ACÁ y no en cada vista: así lo escriben todas las
// que borran me gusta —#versions, #zombies, #zero-plays, #skips,
// #sin-clasificar— y también cualquiera que se agregue después, sin que nadie
// tenga que acordarse. Se escribe SIEMPRE antes del primer DELETE: si la
// operación se corta a la mitad, el registro tiene de más, que es el lado bueno
// del error.
//
// La metadata sale de `meta` si el llamador la trae (es la buena: es lo que la
// vista tenía a la vista) y, si no, del caché de likes, que en ese momento
// todavía está sin filtrar. Si no hay ninguna de las dos, se guardan los ids
// pelados: sirven igual para volver a likear con `PUT /me/library`.
const BORRADOS_LOG_KEY = 'likes_borrados_log_v1';
const BORRADOS_LOG_MAX = 20;

async function registrarBorradoDeLikes(ids, { origen = 'desconocido', meta = null } = {}) {
  let detalle = null;
  try {
    if (Array.isArray(meta) && meta.length) {
      detalle = meta;
    } else {
      const cached = await idbGetCachedRaw(LIKES_CACHE_KEY);
      if (Array.isArray(cached)) {
        const porId = new Map(cached.map(it => [it?.track?.id, it]));
        detalle = ids.map(id => {
          const t = porId.get(id)?.track;
          if (!t) return { id };
          return {
            id,
            nombre: t.name || '',
            artista: t.artists?.map(a => a.name).join(', ') || '',
            album: t.album?.name || '',
          };
        });
      }
    }
  } catch (e) {
    console.warn('registrarBorradoDeLikes: no se pudo resolver la metadata:', e.message);
  }

  const entrada = {
    fecha: new Date().toISOString(),
    origen,
    total: ids.length,
    ids,
    borradas: detalle,
  };

  // Escritura defensiva: un borrado grande (#zero-plays, #skips) puede ser de
  // miles de pistas. Si no entra, se degrada —primero sin metadata, después
  // tirando los registros más viejos— pero NUNCA se deja que el
  // QuotaExceededError salga de acá: el registro es una red, no un requisito, y
  // encima `cacheSet()` reacciona a la cuota borrando el caché entero.
  migratePrefKey(BORRADOS_LOG_KEY);
  const guardar = (lista) => localStorage.setItem(prefKey(BORRADOS_LOG_KEY), JSON.stringify(lista));
  let previo = [];
  try { previo = JSON.parse(localStorage.getItem(prefKey(BORRADOS_LOG_KEY)) || '[]'); } catch { previo = []; }

  const intentos = [
    () => guardar([entrada, ...previo].slice(0, BORRADOS_LOG_MAX)),
    () => guardar([{ ...entrada, borradas: null }, ...previo].slice(0, BORRADOS_LOG_MAX)),
    () => guardar([{ ...entrada, borradas: null }]),
  ];
  for (const intento of intentos) {
    try { intento(); return; } catch (e) { /* probamos la forma siguiente */ }
  }
  console.warn('registrarBorradoDeLikes: no se pudo guardar el registro del borrado');
}

async function removeLikedTracks(ids, opciones = {}) {
  await registrarBorradoDeLikes(ids, opciones);
  const chunks = [];
  for (let i = 0; i < ids.length; i += LIBRARY_URIS_POR_REQUEST) {
    chunks.push(ids.slice(i, i + LIBRARY_URIS_POR_REQUEST));
  }
  for (const chunk of chunks) {
    const uris = chunk.map(id => encodeURIComponent(`spotify:track:${id}`)).join(',');
    await spotifyFetch(`/me/library?uris=${uris}`, {
      method: 'DELETE',
    });
  }
  await removeFromLikesCache(ids);
}

async function createPlaylist(name, description = '', isPublic = false) {
  const safeName = String(name || '').trim().slice(0, 100);
  if (safeName.length === 0) throw new Error('El nombre de la playlist no puede estar vacío');
  if (safeName.length !== String(name).trim().length) {
    console.warn(`createPlaylist: nombre truncado de ${String(name).trim().length} a 100 chars`);
  }
  const result = await spotifyFetch('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name: safeName, description: String(description || '').slice(0, 300), public: isPublic }),
  });
  invalidatePlaylistsCache();
  return result;
}

async function unfollowPlaylist(playlistId) {
  await spotifyFetch(`/playlists/${playlistId}/followers`, { method: 'DELETE' });
  invalidatePlaylistsCache();
}

// PUT /me/library?uris=spotify:track:…,… — las uris van por QUERY, igual que
// en el DELETE.
//
// Verificado en vivo el 2026-08-15 con la sesión real, sobre el mismo track:
//   - body `{ ids: [...] }`  → 400
//   - body `{ uris: [...] }` → 400 «Missing required field: uris»
//   - query `?uris=…`        → 200, y `/me/library/contains` pasa a true
// O sea que esto estaba ROTO: «+ Biblioteca» de #discover-artists y
// #new-releases fallaba siempre (el 400 salía como toast «Error al añadir»).
//
// Chunks de 40, el mismo tope que el DELETE: no hay documentación del máximo y
// 40 es el único número confirmado para esta ruta.
async function saveToLibrary(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const uniq = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += LIBRARY_URIS_POR_REQUEST) {
    const chunk = uniq.slice(i, i + LIBRARY_URIS_POR_REQUEST);
    const uris = chunk.map(id => encodeURIComponent(`spotify:track:${id}`)).join(',');
    await spotifyFetch(`/me/library?uris=${uris}`, { method: 'PUT' });
  }
}

// Guardar un ÁLBUM en la biblioteca (el disco entero como unidad, que es lo que
// hace el ♥ del álbum en la app de Spotify). NO es lo mismo que likear sus
// pistas una por una: eso es `saveToLibrary`.
//
// Verificado en vivo el 2026-08-18 con la sesión real, sobre «Kind Of Blue» de
// Miles Davis (ciclo completo guardar → comprobar → sacar, biblioteca 33 → 34
// → 33):
//   - `PUT /me/albums` body `{ ids: [...] }`  → **403 Forbidden**
//   - `PUT /me/albums?ids=...`                → **403 Forbidden**
//   - `PUT /me/library?uris=spotify:album:…`  → **200**, y el álbum aparece en
//     `GET /me/albums` con su `added_at`
//
// O sea: post-migración los álbumes viajan por la MISMA ruta unificada que las
// pistas, cambiando el tipo de la URI. La ruta `/me/albums` sobrevive solo para
// LEER (`GET /me/albums` → 200); su variante `contains` no (`GET
// /me/albums/contains?ids=` → 403, hay que preguntar por
// `/me/library/contains?uris=spotify:album:…`).
async function saveAlbumsToLibrary(albumIds) {
  if (!Array.isArray(albumIds) || albumIds.length === 0) return;
  const uniq = [...new Set(albumIds.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += LIBRARY_URIS_POR_REQUEST) {
    const chunk = uniq.slice(i, i + LIBRARY_URIS_POR_REQUEST);
    const uris = chunk.map(id => encodeURIComponent(`spotify:album:${id}`)).join(',');
    await spotifyFetch(`/me/library?uris=${uris}`, { method: 'PUT' });
  }
}

/** Saca álbumes de la biblioteca. Misma ruta unificada que el guardado. */
async function removeAlbumsFromLibrary(albumIds) {
  if (!Array.isArray(albumIds) || albumIds.length === 0) return;
  const uniq = [...new Set(albumIds.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += LIBRARY_URIS_POR_REQUEST) {
    const chunk = uniq.slice(i, i + LIBRARY_URIS_POR_REQUEST);
    const uris = chunk.map(id => encodeURIComponent(`spotify:album:${id}`)).join(',');
    await spotifyFetch(`/me/library?uris=${uris}`, { method: 'DELETE' });
  }
}

/**
 * Los álbumes guardados en la biblioteca. `GET /me/albums` es de las pocas
 * rutas por recurso que sobrevivieron a la migración para LEER (verificado en
 * vivo el 2026-08-22: 200, paginado, con `added_at` y el tracklist adentro).
 * Escribir sigue siendo `PUT /me/library?uris=spotify:album:…`.
 *
 * Devuelve los items crudos (`{ added_at, album }`). Cache de 60 min: lo usa el
 * filtro de descubrimiento en cada repintado y no tiene sentido repreguntarlo.
 */
const SAVED_ALBUMS_KEY = 'saved_albums_v1';
async function getSavedAlbums({ force = false } = {}) {
  if (!force) {
    const cached = await idbGetCached(SAVED_ALBUMS_KEY);
    if (Array.isArray(cached)) return cached;
  }
  const items = [];
  let url = '/me/albums?limit=50';
  // Tope de páginas por las dudas: 40 × 50 = 2.000 álbumes guardados.
  for (let i = 0; i < 40 && url; i++) {
    const r = await spotifyFetch(url);
    items.push(...(r?.items || []));
    url = r?.next ? r.next.replace('https://api.spotify.com/v1', '') : null;
  }
  try { await idbSetCached(SAVED_ALBUMS_KEY, items, 60); } catch { /* ignora */ }
  return items;
}

/**
 * ¿Están estos álbumes en la biblioteca? Devuelve Map<albumId, bool>.
 * Mismo tope de 40 que el `contains` de pistas: `LIBRARY_URIS_POR_REQUEST`.
 * Iba de a 50 y fallaba siempre; corregido el 2026-08-28.
 */
async function albumsInLibrary(albumIds) {
  const out = new Map();
  const uniq = [...new Set((albumIds || []).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += LIBRARY_URIS_POR_REQUEST) {
    const chunk = uniq.slice(i, i + LIBRARY_URIS_POR_REQUEST);
    const uris = chunk.map(id => encodeURIComponent(`spotify:album:${id}`)).join(',');
    const r = await spotifyFetch(`/me/library/contains?uris=${uris}`);
    if (!Array.isArray(r) || r.length !== chunk.length) {
      throw new Error(`/me/library/contains (álbumes) devolvió algo inesperado (esperaba ${chunk.length} booleanos)`);
    }
    chunk.forEach((id, j) => out.set(id, !!r[j]));
  }
  return out;
}

// Discografía de un artista.
//
// Estado verificado en vivo el 2026-08-06 con la sesión real:
//   - `GET /artists/{id}/albums` → **429 en TODAS las llamadas**, con cualquier
//     limit y sin market. NO es rate limit real: en el mismo segundo `/me`,
//     `GET /artists/{id}` y `/search` devuelven 200. Es un bloqueo de endpoint
//     disfrazado de 429 (antes del ajuste de v=122 el disfraz era 400).
//   - `/search` sí funciona, pero el límite máximo por página bajó a **10**
//     (11+ → 400 "Invalid limit"). El `offset` sí pagina de verdad.
//   - `total` de /search viene igual a los items devueltos, así que no sirve
//     para paginar: hay que ir hasta una página corta.
//
// Estrategia: un probe barato al nativo (sin reintentos, para no comerse 25s
// de esperas por 429) y, ante 400/403/429, pasamos a /search para el resto de
// la sesión. Si Spotify revive el endpoint, el probe de la próxima carga lo
// detecta solo.
let _artistAlbumsEndpoint = null; // 'native' | 'search'
const SEARCH_PAGE = 10;           // máximo que acepta hoy /search
// 4 páginas = 40 resultados por artista. Con 6 el escaneo de 100 artistas
// disparaba 429 en cadena (medido en vivo: artistas enteros caían por rate
// limit y desaparecían de la lista).
const SEARCH_MAX_PAGES = 4;

// El limit máximo de /artists/{id}/albums bajó de 20 a 10 (verificado en vivo
// 2026-08-11: 11..20 devuelven 400 "Invalid limit", 10 devuelve 200). Con 20
// hardcodeado el endpoint nativo fallaba SIEMPRE y todo caía al fallback por
// /search, que es más lento y trae artistas ajenos que hay que filtrar a mano.
const ARTIST_ALBUMS_MAX_LIMIT = 10;

async function getArtistAlbums(artistId, artistName, { includeSingles = true, limit = ARTIST_ALBUMS_MAX_LIMIT } = {}) {
  const groups = includeSingles ? 'album,single' : 'album';
  const tryNative = async () => {
    const items = [];
    let url = `/artists/${artistId}/albums?include_groups=${groups}&limit=${Math.min(limit, ARTIST_ALBUMS_MAX_LIMIT)}`;
    for (let i = 0; i < 25; i++) {
      // El primer request es el probe: sin reintentos, para que un endpoint
      // muerto no cueste 25 segundos por artista.
      const res = await spotifyFetch(url, i === 0 && _artistAlbumsEndpoint == null ? { _maxRetries: 0 } : {});
      if (!res) break;
      const batch = res.items || [];
      items.push(...batch);
      if (!res.next) break;
      url = res.next.replace('https://api.spotify.com/v1', '');
      if (items.length >= 200) break; // límite razonable — nadie tiene 200 lanzamientos
    }
    return items;
  };

  const trySearch = async () => {
    // /search devuelve cualquier cosa que matchee el texto: buscando
    // artist:"Drake" aparecen Nick Drake, Drake Bell y "draken". Filtramos por
    // **id** del artista (lo tenemos) y, si el álbum no lo trae, por nombre
    // exacto. Sin esto la vista de "sin escuchar" se llena de artistas ajenos.
    const wanted = (artistName || '').trim();
    if (!wanted) return [];
    const isMine = (al) => (al.artists || []).some(a =>
      (artistId && a.id === artistId) || artistIsSame(wanted, a.name));
    // ⚠️ Este `||` deja pasar a los HOMÓNIMOS EXACTOS: hay dos artistas
    // llamados literalmente «Steve Lacy» y el de jazz metía 17 discos. No se
    // aprieta acá a propósito — la identidad se decide al PINTAR, en
    // `util/discover-filters.js` (criterio 'artista'), para que el toggle de la
    // topbar pueda mostrarlos y esconderlos sin tirar el caché de IDB. Este
    // filtro queda como red gruesa contra el ruido de /search (Nick Drake).
    //
    // ⚠️ **El apóstrofo dentro de las comillas rompe la query** — el mismo bug
    // que ya se arregló en `features/album-card.js`. Medido en vivo el
    // 2026-08-22 contra la API real:
    //
    //   artist:"Sinéad O'Connor"  →  0 resultados
    //   artist:"Sinéad OConnor"   →  10 ✅
    //   artist:"Sinead O'Connor"  →  0 resultados
    //   artist:"Guns N' Roses"    →  10 (este NO se rompe)
    //
    // O sea que no falla siempre —parece necesitar el apóstrofo en mitad de una
    // palabra que no es la primera— pero BORRARLO no empeora ningún caso y
    // arregla los rotos, así que se borra siempre. Y se borra, no se cambia por
    // un espacio: Spotify indexa «don't» como el token `dont`, y «don t» no
    // encuentra nada. `isMine` compara después contra el nombre REAL.
    const q = `artist:"${limpiaParaQuery(wanted)}"`;
    const items = [];
    let emptyPages = 0;
    for (let page = 0; page < SEARCH_MAX_PAGES; page++) {
      const offset = page * SEARCH_PAGE;
      const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=${SEARCH_PAGE}&offset=${offset}`);
      const batch = res?.albums?.items || [];
      const mine = batch.filter(isMine);
      items.push(...mine);
      if (batch.length < SEARCH_PAGE) break;
      // Los resultados vienen por relevancia: si dos páginas seguidas no traen
      // nada del artista, lo que sigue es ruido.
      emptyPages = mine.length ? 0 : emptyPages + 1;
      if (emptyPages >= 2) break;
    }
    return items.filter(al => includeSingles || al.album_type === 'album');
  };

  if (_artistAlbumsEndpoint === 'search') return trySearch();

  try {
    const items = await tryNative();
    if (_artistAlbumsEndpoint == null) {
      _artistAlbumsEndpoint = 'native';
      console.log('[api] getArtistAlbums: /artists/{id}/albums OK — usando nativo');
    }
    return items;
  } catch (e) {
    // 400 (params inválidos), 403 (denegado) o 429 permanente → a /search.
    const status = e.status || (e.message.match(/\b(400|403|429)\b/) || [])[1];
    if (status && [400, 403, 429, '400', '403', '429'].includes(status)) {
      _artistAlbumsEndpoint = 'search';
      console.warn('[api] getArtistAlbums: /artists/{id}/albums →', String(e.message).slice(0, 60), '· fallback a /search');
      return trySearch();
    }
    throw e;
  }
}

// GET /albums/{id}/tracks (los items traen name, uri, track_number, duration_ms).
async function getAlbumTracks(albumId, { limit = 50 } = {}) {
  const items = [];
  let url = `/albums/${albumId}/tracks?limit=${limit}`;
  for (let i = 0; i < 5; i++) {
    const res = await spotifyFetch(url);
    if (!res) break;
    const batch = res.items || [];
    items.push(...batch);
    if (!res.next) break;
    url = res.next.replace('https://api.spotify.com/v1', '');
  }
  return items;
}

// Búsqueda de artista por nombre — devuelve el mejor match (id + name + image).
async function searchArtistByName(name) {
  if (!name) return null;
  const q = `artist:"${name.replace(/"/g, '')}"`;
  const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=artist&limit=5`);
  const items = res?.artists?.items || [];
  // El mejor match por exact name (case insensitive), si no el primero.
  const lc = name.toLowerCase();
  const exact = items.find(a => (a.name || '').toLowerCase() === lc);
  return exact || items[0] || null;
}

export {
  spotifyFetch,
  paginateAll,
  getAllLikedTracks,
  getAllUserPlaylists,
  getAllPlaylistItems,
  updatePlaylistItemsCache,
  getMyTop,
  getUserProfile,
  getCurrentUserId,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  reorderPlaylistItems,
  getPlaylistSnapshotId,
  getCachedPlaylistSnapshot,
  getCachedPlaylistItems,
  removePlaylistItemsAtPositions,
  removeLikedTracks,
  checkLibraryContains,
  createPlaylist,
  unfollowPlaylist,
  saveToLibrary,
  saveAlbumsToLibrary,
  removeAlbumsFromLibrary,
  albumsInLibrary,
  getSavedAlbums,
  getArtistAlbums,
  getAlbumTracks,
  searchArtistByName,
  invalidateLikesCache,
  onRateLimit,
  invalidatePlaylistsCache,
  onPlaylistsInvalidated,
  getLikesTotal,
  syncLikesIncremental,
  importLikesData,
  exportAllData,
  importAllData,
  tryAutoLoadUserBackup,
  getBestAvailableLikes,
  getLikesPartialInfo,
  getLikesCacheTimestamp,
  readLocalConfig,
  applyLocalConfig,
  CONFIG_LOCAL_KEYS,
};
