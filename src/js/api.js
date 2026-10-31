import { getValidToken, refreshAccessToken } from './auth.js';
import { cacheGet, cacheGetRaw, cacheGetTimestamp, cacheSet, cacheClear, prefKey, migratePrefKey } from './storage.js';
import { idbDel, idbDelByPrefix, idbGetCached, idbGetCachedRaw, idbGetTimestamp, idbSetCached, idbGet, idbAllKeys, idbEntriesByPrefix, idbSetVarios } from './idb.js';
import { OWNER_KEY_LIST } from './history-keys.js';
import { OCULTOS_ITEMS_PREFIX } from './util/ocultos-items-clave.js';
import { showToast } from './ui/toast.js';
import { artistIsSame, limpiaParaQuery } from './util/track-match.js';
import { contadorCuota, cuotaDeEndpoint } from './util/cuota.js';
import { exportarEtiquetas, importarEtiquetas } from './api/lastfm.js';
import { leerNavegador, armarCopia, serializar, contieneSecreto, CENSO } from './util/copia-completa.js';
import { leerCopia, planDeImport, segundaRed, importEscribio, TEXTOS as TEXTOS_IMPORT } from './util/copia-importar.js';
import { MARCA_DESDE_COPIA, leerMarca, marcaTrasImport } from './util/ocultos-desde-copia.js';
import { avisarCopiaImportada } from './util/canal-copia.js';
import { BORRADOS_LOG_MAX } from './util/topes-registros.js';
import { LIKES_DE_OTRO_KEY, hayLikesDeOtro } from './util/likes-de-otro.js';

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
// vista quedaba con 0 likes y "Sin registrar (0)". ⚠️ Este comentario decía
// hasta v=255 que «la caché ya tiene TTL de 24 h y se renueva sola»: es falso
// desde v=187, cuando `saveLikes()` pasó a escribirla SIN caducidad (ver ahí).
// La frescura la da `syncLikesIncremental()`, que compara el total en UNA
// petición. Mientras tanto releaseKind() en listened.js deduce el tipo y lo
// avisa con "tipo estimado".
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
  const esSearch = endpoint.startsWith('/search') || endpoint.includes('/v1/search');
  // La cuota a la vista (v=310, `util/cuota.js`): de cuál de las dos cuotas es este
  // pedido, si es de alguna. Contar no cambia ninguna espera ni ningún reintento.
  const cuota = cuotaDeEndpoint(endpoint);

  // ⚠️ Puerta cerrada: si `/search` ya dio 429 hace poco, ni siquiera se pega
  // al servidor. Los 5 reintentos del retry loop, aplicados a un endpoint cuya
  // cuota va POR PETICIONES ACUMULADAS (429 en el request 697), son 5
  // peticiones más contra el mismo tope: agravan lo que intentan sobrellevar.
  // El idiom es el mismo que `_nativoPausaHasta` usa para el nativo de discos.
  if (esSearch && Date.now() < _searchPausaHasta) {
    contadorCuota.cortada('busqueda');   // no salió: no gastó cuota
    const err = new Error(`Spotify 429: /search en pausa hasta ${new Date(_searchPausaHasta).toISOString()} (cuota agotada).`);
    err.status = 429;
    err.searchEnPausa = true;
    throw err;
  }

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
      // Volvió una respuesta, o sea que salió a la red: gastó cuota (un 429 también).
      if (cuota) contadorCuota.peticion(cuota, response.status);
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
      // ⚠️ Un 429 en `/search` cierra la puerta y sale: la cuota va por
      // peticiones ACUMULADAS y reintentar 5 veces son 5 peticiones más contra
      // el mismo tope. Se marca la pausa (mismo idiom que el nativo, doblándose)
      // y las llamadas siguientes de este mismo endpoint las corta la guarda
      // de arriba SIN pegar al servidor. Ver `_searchPausaHasta`.
      if (esSearch) {
        if (Date.now() >= _searchPausaHasta) {
          _searchPausaMs = _searchPausaMs
            ? Math.min(SEARCH_PAUSA_MAX_MS, _searchPausaMs * 2)
            : SEARCH_PAUSA_MIN_MS;
          _searchPausaHasta = Date.now() + _searchPausaMs;
        }
        contadorCuota.pausa('busqueda', _searchPausaHasta);
        console.info(`[rate-limit] 429 en /search — pausa ${Math.round(_searchPausaMs / 1000)} s (endpoint: ${endpoint})`);
        const err = new Error(`Spotify 429: /search agotó su cuota; pausa ${Math.round(_searchPausaMs / 1000)} s.`);
        err.status = 429;
        err.searchEnPausa = true;
        throw err;
      }
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
      avisarRateLimit({ endpoint, wait, intento: rateLimitRetries, maxRetries, pedidos: loDijoSpotify ? pedidos : null, retryAfterCrudo: retryAfterHeader });
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
    // (v=346) La misma regla que `saveLikes`: con la marca, el parcial no se escribe.
    if (hayLikesDeOtro()) {
      console.warn(`[likes] descarto guardar el parcial (${payload?.items?.length ?? 0} likes): la caché es de otra cuenta`);
      return { ok: false, likesDeOtro: true };
    }
    try { await idbSetCached(LIKES_PARTIAL_KEY, payload, null); } catch (e) { console.warn('savePartial IDB:', e); }
  } else {
    cacheSet(key + '_partial', payload, 60);
  }
}

async function loadPartial(key) {
  if (key === LIKES_CACHE_KEY || key === LIKES_PARTIAL_KEY) {
    // (v=345) Con la marca, el parcial es de la cuenta anterior: no se retoma (ver `borrarLikesDeOtro`).
    if (hayLikesDeOtro()) return null;
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
    // (v=300) Si `/me/playlists` lo trae, se guarda; si no, `null` y todo lo
    // demás queda como antes. NADIE lo lee todavía. Ojo: esta lista vive hasta
    // 24 h en localStorage, así que es el snapshot de cuando se guardó — para
    // validar un caché de items NO sirve (ver «El caché de los items de la
    // playlist espejo» en `util/hidden-sync.js`, que lo tiene prohibido). Que la
    // API real lo devuelva en el objeto simplificado no está verificado.
    snapshot_id: p.snapshot_id ?? null,
  };
}

async function migrateLikesFromLocalStorage() {
  // (v=345) Con la marca, la heredada es de la cuenta anterior: no se muda nada a IndexedDB.
  if (hayLikesDeOtro()) return;
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
// ⚠️ Salvo una cosa (v=345): si la caché es de OTRA cuenta (la marca de `util/likes-de-otro.js`), reintenta el borrado
// que dejó pendiente el cambio de usuario (`borrarLikesDeOtro`, la misma función) y, salga o no, devuelve «no hay
// caché». Eso no destruye nada tuyo: lo que hay ahí no es tuyo.
async function leerLikesCacheados() {
  if (hayLikesDeOtro()) {
    await borrarLikesDeOtro();
    return null;
  }
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
//
// 🔴 (v=346, tanda 103) La regla de los que ESCRIBEN, en un solo sitio: con la marca de `util/likes-de-otro.js` puesta,
// no se escribe y se devuelve `{ ok: false, likesDeOtro: true }`. Un escritor nuevo queda cubierto sin acordarse (lo
// vigila la guarda estática de `tests/me-gusta-de-otra-cuenta.test.mjs`). ⚠️ Cierra «la marca sigue puesta cuando llego a
// escribir»; NO cierra que otra pestaña ponga la marca, borre bien y la quite mientras este escritor espera: ahí ya no
// hay marca que ver (ver CLAUDE.md, «Los que escriben (v=346)»).
async function saveLikes(items, { complete = true, total = null } = {}) {
  if (!complete) {
    console.warn(`[likes] descarto guardar ${items.length} likes: carga incompleta` + (total != null ? ` (total real ${total})` : ''));
    return { ok: false, skipped: true };
  }
  if (hayLikesDeOtro()) {
    console.warn(`[likes] descarto guardar ${items.length} likes: la caché es de otra cuenta (la marca de util/likes-de-otro.js sigue puesta)`);
    return { ok: false, likesDeOtro: true };
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
      // (v=345) Con la marca, el parcial es de la otra cuenta: se reintenta el borrado y, si sale, la descarga arranca
      // de cero. Si no sale, se tira: retomar mezclaría sus me gusta con los tuyos y, si cuadrara con tu total, se
      // guardaría como completa.
      if (hayLikesDeOtro() && !(await borrarLikesDeOtro())) throw new Error(TEXTO_LIKES_DE_OTRO);
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

// ── Los me gusta del usuario anterior (v=345, tanda 98) ─────────────────────
//
// La caché de me gusta NO lleva el uid en la clave. Cuando cambia la cuenta, `revisarCambioDeUsuario()` pone la marca
// (`fonoteca_likes_de_otro_v1`, sincrónica, ANTES del primer borrado) y llama a esta función, que borra las tres
// copias —la completa y el parcial de IndexedDB, y la heredada de `localStorage`— y, SOLO si salen todas, quita la
// marca. Mientras la marca esté, los seis caminos que leen la caché hacen como si no hubiera (ver CLAUDE.md, «👤 Los me
// gusta del usuario anterior»): un borrado que falla, una lectura a mitad del borrado o una pestaña cerrada a mitad no
// pueden enseñarle a la cuenta nueva los me gusta de la anterior.
//
// Hasta v=344 esto era `invalidateLikesCache()`: los `idbDel` con `.catch(() => {})`, sin esperarlos y sin marca. Si
// fallaba, nadie se enteraba y la carga siguiente ya no veía «cambio de usuario» que lo reintentara.
//
// Devuelve `true` si quedó limpia y `false` si no (o si pasó el tope: el borrado sigue, y si termina bien, quita la marca
// igual). 🔴 NUNCA TIRA: la llama `getCurrentUserId()`, de la que cuelga media app. El error crudo va a `console.warn`.
// La llaman la revisión del cambio de cuenta y los lectores que reintentan (L1 y L3): una sola copia de la regla.
const TOPE_BORRADO_LIKES_MS = 3000;
const TEXTO_LIKES_DE_OTRO = 'No se han podido borrar los me gusta de la otra cuenta que usó este navegador, así que no se cargan los tuyos para no mezclarlos. Recarga la página para reintentarlo.';

async function borrarLikesDeOtro() {
  const borrado = (async () => {
    cacheClear(LIKES_CACHE_KEY);
    cacheClear(LIKES_CACHE_KEY + '_partial');
    const r = await Promise.allSettled([idbDel(LIKES_CACHE_KEY), idbDel(LIKES_PARTIAL_KEY)]);
    const fallo = r.find((x) => x.status === 'rejected');
    if (fallo) throw fallo.reason;
    localStorage.removeItem(LIKES_DE_OTRO_KEY);
    return true;
  })().catch((e) => {
    console.warn('[likes] no se pudo borrar la caché de me gusta de la cuenta anterior:', e);
    return false;
  });
  let reloj;
  const tope = new Promise((res) => { reloj = setTimeout(() => res(false), TOPE_BORRADO_LIKES_MS); });
  try {
    return await Promise.race([borrado, tope]);
  } finally {
    clearTimeout(reloj);
  }
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
  // (v=346) Hasta v=345 no se miraba el resultado y el Dashboard decía «+N likes nuevos traídos» con la caché sin
  // escribir. Si no se guardó, se tira: `handleRefresh` lo pinta en rojo.
  const guardado = await saveLikes(finalItems);
  if (!guardado.ok) {
    throw new Error(guardado.likesDeOtro ? TEXTO_LIKES_DE_OTRO
      : `Se han traído ${newOnes.length.toLocaleString('es-ES')} likes nuevos, pero el navegador no ha podido guardarlos${guardado.error ? ` (${guardado.error.message})` : ''}.`);
  }
  return { hadCache: true, added: newOnes.length, removed: 0, totalNow, cachedCount: finalItems.length };
}

// Devuelve SIEMPRE la biblioteca entera o nada. Hasta v=129 esta función caía
// al caché parcial y lo devolvía con `source:'partial'`, pero como ninguna de
// las 17 vistas que la usan miraba el `source`, un parcial de 100 canciones se
// mostraba como "100 likes" — el bug que vio Ian al abrir #skips mientras
// #sin-clasificar escaneaba. Ahora el parcial no se sirve nunca: solo existe
// para que paginateAll pueda retomar la descarga donde la dejó.
//
// ⚠️ `allowFetch` es `false` POR DEFECTO, y la razón es el censo de v=255.
//
// Hasta v=254 el defecto era `true`: 24 llamadores, 21 de ellos sin pasar nada,
// y CERO de esos 21 querían una descarga. Se comprobó uno por uno. Las vistas
// que bajan la biblioteca a propósito ya no pasan por acá: usan
// `getAllLikedTracks()` (sync.js, versions.js, smart.js, zombies.js,
// orphans.js, recommendations.js, y los botones de by-genre, by-artist y el
// Dashboard), siempre detrás de un click y con barra de progreso.
//
// Los 21 estaban escritos dando por sentado lo contrario de lo que pasaba:
// `by-artist.js` pinta «Leyendo caché local…» y después decide, `search-likes`
// contesta «No hay likes cacheados todavía», `handleExportCsv` dice «Cárgalos
// primero». Con el defecto en `true` ninguno leía: los tres disparaban ~190
// peticiones a `/me/tracks` con la caché fría, que es lo que pega el 429.
//
// Invertir el defecto es lo único que cierra la clase entera. Parchear llamador
// por llamador deja armada la trampa para la vista número 25, que se va a
// escribir igual que las otras 21: sin pasar nada.
async function getBestAvailableLikes({ onProgress, signal, allowFetch = false } = {}) {
  await migrateLikesFromLocalStorage();

  // Por `leerLikesCacheados()` y no a mano: esta función era la CUARTA copia de
  // esa lectura, justo lo que el comentario de esa otra advertía que volvería a
  // pasar. Ver arriba.
  const full = await leerLikesCacheados();
  if (full) return { items: full, source: 'full' };

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
  // (v=345) Con la marca, el parcial no es tuyo: no hay nada que retomar.
  if (hayLikesDeOtro()) return null;
  try {
    const p = await loadPartial(LIKES_CACHE_KEY);
    if (p && Array.isArray(p.items) && p.items.length > 0) {
      return { items: p.items.length, offset: p.offset ?? p.items.length };
    }
  } catch { /* sin IDB: como si no hubiera parcial */ }
  return null;
}

async function getLikesCacheTimestamp() {
  // (v=345) Con la marca, la fecha sería la de la sincronización de la otra cuenta.
  if (hayLikesDeOtro()) return null;
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
  // v=312: las etiquetas salen de IndexedDB (por usuario) con el formato de siempre,
  // `{ nombre: { tags, at } }`, así un archivo de v=312 se importa en v=311 y al revés.
  // Sin uid no hay de quién leerlas: el archivo sale sin etiquetas y se avisa.
  let tagsCache = {};
  if (spotifyUserId) tagsCache = await exportarEtiquetas(spotifyUserId);
  else console.warn('[export] sin usuario: el archivo sale sin las etiquetas de género');
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

// «Exportar todo» (v=333): enchufa `util/copia-completa.js` (puro) a IndexedDB y a `localStorage`. 🔴 SOLO LEE: ni una
// escritura en todo el camino (ni `readLocalConfig()` ni `getBestAvailableLikes()`, que por debajo mudan claves; ni
// `idbGetCached`, que borra lo vencido al leerlo). 0 peticiones: el uid sale del memo de `getCurrentUserId()` o, si
// todavía no se pidió, de `fonoteca_last_user_id`; nunca de un `/me`. Lo vigila `tests/copia-completa.test.mjs`.
// Devuelve `{ copia, texto, secretos, errores, bytes }`: si `secretos` no viene vacío, el que llama NO descarga.
async function exportarCopiaCompleta({ ahora = new Date() } = {}) {
  const leido = await leerNavegador({
    idbTodo: () => idbEntriesByPrefix(''),
    idbClaves: () => idbAllKeys(),
    idbLeer: (k) => idbGet(k),
    lsClaves: () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)),
    lsLeer: (k) => localStorage.getItem(k),
  });
  const uid = _cachedUserId || leido.ls[LAST_USER_KEY] || null;
  const copia = await armarCopia({ ...leido, uid, configKeys: CONFIG_LOCAL_KEYS, ahora });
  const texto = serializar(copia);
  return { copia, texto, secretos: contieneSecreto(texto, leido.ls), errores: copia._errores, bytes: new Blob([texto]).size };
}

// «Importar todo» (v=334): enchufa `util/copia-importar.js` (puro) a IndexedDB y a `localStorage`. Lee con las MISMAS
// lecturas sin efectos de `exportarCopiaCompleta` (el test compara las dos, letra por letra) y NO ESCRIBE: devuelve el
// plan para que el usuario lo confirme. 0 peticiones con el memo de `getCurrentUserId()` lleno: `motivoSinImportCompleto()`
// va por él y el uid sale de él. ⚠️ Si en esta carga todavía nadie preguntó (un perfil sin me gusta: el Dashboard no lo
// pregunta), la guarda pide UN `/me`, y es a propósito: es la confirmación de identidad sin la cual no se escribe nada.
// Va por `import()` porque `history-data.js` importa este archivo (un import estático sería un ciclo).
async function leerParaImportar() {
  return leerNavegador({
    idbTodo: () => idbEntriesByPrefix(''),
    idbClaves: () => idbAllKeys(),
    idbLeer: (k) => idbGet(k),
    lsClaves: () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)),
    lsLeer: (k) => localStorage.getItem(k),
  });
}

// `localStorage` entero, SINCRÓNICO: lo usa `aplicarPlan()` para releer y escribir sin soltar el hilo.
function leerLsAhora() {
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    const v = localStorage.getItem(k);
    if (v != null) ls[k] = v;
  }
  return ls;
}

async function importarCopiaCompleta(texto, { ahora = new Date() } = {}) {
  let copia;
  try {
    copia = leerCopia(texto);
  } catch (e) {
    const plan = planDeImport({ copia: null });
    plan.rechazo = { motivo: 'roto', texto: `El archivo no es un JSON válido (${e?.message || e}).` };
    return { plan };
  }
  const { motivoSinImportCompleto } = await import('./features/history-data.js');
  const motivoOwner = await motivoSinImportCompleto();
  const uid = motivoOwner === 'identidad' ? null : _cachedUserId;
  const leido = await leerParaImportar();
  const entrada = { copia, uid, motivoOwner, ahora };
  const plan = planDeImport({ ...entrada, idb: leido.idb, ls: leido.ls });
  // Una clave que no se pudo leer parecería «que falta» y se escribiría encima: no se carga nada.
  if (!plan.rechazo && leido.errores.length) return { plan: { ...plan, idb: [], ls: [], rechazo: { motivo: 'lectura', texto: TEXTOS_IMPORT.lectura } } };
  plan.entrada = entrada;
  return { plan };
}

// Aplica un plan de `importarCopiaCompleta()`. 🔴 Las únicas escrituras: UNA `idbSetVarios` (una transacción) y los
// `setItem` de las claves del plan. Ni un `removeItem`, ni un `idbDel`, ni `importAllData`.
//   1. la segunda red sobre el plan que se confirmó: si trae una clave que el censo no deja entrar, nada;
//   2. vuelve a leer y a decidir con la MISMA copia, uid y motivo: si entre el modal y el clic cambió algo (otra
//      pestaña), se une con lo de ahora, no con lo de hace un rato; y la segunda red otra vez;
//   3. IndexedDB, todo en una transacción. Si tira: 0 escrituras en `localStorage`;
//   4. `localStorage`, releído y redecidido de forma SINCRÓNICA (ningún `await` entre leer y escribir), clave por
//      clave. Si una tira (cuota), se para ahí y vuelven las que faltaron: lo ya escrito fueron solo agregados y
//      uniones, así que lo que había sigue entero.
// Devuelve `{ ok, … }`; nunca tira por algo del plan.
// (v=335) Toda salida que ESCRIBIÓ algo pasa por `alTerminarImport()`: la marca de los ocultos que llegaron
// (`ocultos_desde_copia_v1`) y el aviso a las OTRAS pestañas. Las salidas sin escrituras, no.
async function aplicarPlan(plan) {
  const malas = segundaRed(plan);
  if (plan?.rechazo || !plan?.entrada || malas.length) return { ok: false, motivo: 'red', malas, idb: 0, ls: 0 };
  const leido = await leerParaImportar();
  if (leido.errores.length) return { ok: false, motivo: 'lectura', texto: TEXTOS_IMPORT.lectura, idb: 0, ls: 0 };
  const fresco = planDeImport({ ...plan.entrada, idb: leido.idb, ls: leido.ls });
  const malasFresco = segundaRed(fresco);
  if (fresco.rechazo || malasFresco.length) return { ok: false, motivo: fresco.rechazo ? fresco.rechazo.motivo : 'red', texto: fresco.rechazo?.texto, malas: malasFresco, idb: 0, ls: 0 };

  if (fresco.idb.length) {
    try {
      await idbSetVarios(fresco.idb);
    } catch (e) {
      return { ok: false, motivo: 'idb', error: e?.message || String(e), idb: 0, ls: 0 };
    }
  }

  let final, lsAhora = {};
  try {
    lsAhora = leerLsAhora();
    final = planDeImport({ ...plan.entrada, idb: leido.idb, ls: lsAhora });
  } catch (e) {
    return alTerminarImport({ ok: false, motivo: 'ls', error: e?.message || String(e), idb: fresco.idb.length, ls: 0, faltaron: [] });
  }
  if (final.rechazo || segundaRed(final).length) return alTerminarImport({ ok: false, motivo: final.rechazo ? final.rechazo.motivo : 'red', texto: final.rechazo?.texto, idb: fresco.idb.length, ls: 0, faltaron: [] });
  let escritas = 0;
  for (const [clave, texto] of final.ls) {
    try {
      localStorage.setItem(clave, texto);
      escritas++;
    } catch (e) {
      return alTerminarImport({ ok: false, motivo: 'ls', error: e?.message || String(e), idb: fresco.idb.length, ls: escritas, faltaron: final.ls.slice(escritas).map(([k]) => k), resumen: final.resumen }, { lsAntes: lsAhora, escritas: final.ls.slice(0, escritas), uid: plan.entrada.uid });
    }
  }
  return alTerminarImport({ ok: true, idb: fresco.idb.length, ls: escritas, resumen: final.resumen }, { lsAntes: lsAhora, escritas: final.ls, uid: plan.entrada.uid });
}

// Los seis almacenes de ocultos con playlist espejo, del CENSO (las filas de clase 3 que son un conjunto): no una lista
// copiada.
const ALMACENES_DE_OCULTOS = CENSO.filter((c) => c.donde === 'ls' && c.clase === 3 && c.fusion === 'conjunto').map((c) => c.clave);

// (v=335) Después de un import que escribió algo. Dos cosas, y ninguna puede hacer fallar el import:
//   1. la marca de los ocultos que llegaron (`util/ocultos-desde-copia.js`): lo que la app LEE de cada almacén después
//      menos lo que leía antes, unido a la marca que hubiera. UN `setItem`, el de la marca, fuera del plan (ni
//      `planDeImport` ni `segundaRed` la ven). Si tira, el `sync()` avisa como en v=334 y nada más;
//   2. el aviso a las OTRAS pestañas (`util/canal-copia.js`), si se escribió algo. ⚠️ También en una cuota que cortó a
//      mitad: lo ya escrito es justo lo que otra pestaña puede pisar. (v=336) «Si se escribió algo» es
//      `importEscribio()`, la MISMA función con la que `handleImportTodo` decide recargar esta pestaña.
function alTerminarImport(r, { lsAntes = null, escritas = [], uid = null } = {}) {
  if (lsAntes && escritas.length && uid) {
    try {
      const despues = { ...lsAntes };
      for (const [k, v] of escritas) despues[k] = v;
      const claveMarca = `${MARCA_DESDE_COPIA}__${uid}`;
      const m = marcaTrasImport({ marca: leerMarca(localStorage.getItem(claveMarca)), antes: lsAntes, despues, uid, almacenes: ALMACENES_DE_OCULTOS });
      if (m.cambio) localStorage.setItem(claveMarca, JSON.stringify(m.marca));
    } catch (e) {
      console.warn('[import-todo] no pude dejar la marca de los ocultos importados (el aviso del próximo sync dirá «habían desaparecido»):', e);
    }
  }
  if (importEscribio(r)) avisarCopiaImportada();
  return r;
}

// (v=346, tanda 103) Por qué no entraron los me gusta de un archivo (`likesSkipped`), dicho para el toast. Los usan los
// dos llamadores de `importAllData` (`handleImportAll` del Dashboard y `handleImport` de `#genre`).
const TEXTOS_LIKES_SIN_IMPORTAR = {
  'otra-cuenta': 'Los me gusta del archivo no se han importado: el archivo es de otra cuenta.',
  'sin-dueno': 'Los me gusta del archivo no se han importado: el archivo no dice de qué cuenta es.',
  'sin-identidad': 'Los me gusta del archivo no se han importado: no se ha podido comprobar con qué cuenta has entrado.',
};

async function importAllData(parsed, onProgress, { currentUserId = null } = {}) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido');

  const result = {
    likesImported: 0,
    likesAdded: 0,
    likesSkipped: null,
    tagsImported: 0,
    tagsUpdated: 0,
    configApplied: 0,
    configSkipped: false,
    format: parsed._format || 'desconocido',
  };

  // El uid de ahora: el que pasen o, si no viene (`#genre` no lo pasa), `getCurrentUserId()`. Se pide UNA vez y solo si
  // hace falta; si tira, el error se guarda para las etiquetas, que siguen con su regla de siempre (sin uid, tiran).
  let uidAhora = currentUserId || null;
  let errorUid = null;
  const resolverUid = async () => {
    if (!uidAhora && !errorUid) {
      try { uidAhora = await getCurrentUserId(); } catch (e) { errorUid = e; }
    }
    return uidAhora;
  };

  const hasNewLikes = parsed.likes?.items && Array.isArray(parsed.likes.items);
  const isOldLikes = Array.isArray(parsed.items) && parsed._format === 'spotify-tools-likes';
  if (hasNewLikes || isOldLikes) {
    const likesPayload = hasNewLikes ? parsed.likes : parsed;
    // 🔴 (v=346) Los me gusta del archivo entran SOLO si el archivo es de la cuenta de ahora. Un archivo sin dueño (el
    // formato viejo, o `spotifyUserId: null`) o sin saber quién sos tampoco entra: los me gusta se vuelven a bajar de
    // Spotify («Cargar desde Spotify»), así que rechazar no pierde nada; mezclar los de otra persona sí. Hasta v=345 la
    // comparación era solo para `_config` y los me gusta entraban siempre. Un archivo sin me gusta no avisa de nada.
    let motivo = null;
    if (likesPayload.items.length > 0) {
      const dueno = parsed.spotifyUserId || null;
      if (!dueno) motivo = 'sin-dueno';
      else if (!(await resolverUid())) motivo = 'sin-identidad';
      else if (dueno !== uidAhora) motivo = 'otra-cuenta';
    }
    if (motivo) {
      result.likesSkipped = motivo;
      console.warn(`[likes] no importo los ${likesPayload.items.length} me gusta del archivo: ${motivo}`);
    } else {
      const r = await importLikesData(likesPayload, onProgress);
      result.likesImported = r.imported;
      result.likesAdded = r.added;
    }
  }

  const hasNewTags = parsed.tags?.entries && typeof parsed.tags.entries === 'object';
  const isOldTags = parsed.entries && parsed._format === 'spotify-tools-genres';
  const tagsPayload = hasNewTags ? parsed.tags : parsed;
  // (v=346) Sin ninguna etiqueta en el archivo no hay nada que guardar y no se pregunta quién sos: hasta v=345 un archivo
  // con `tags.entries: {}` (todos los de «Exportar JSON» sin etiquetas) tiraba si fallaba el `/me`, y eso tapaba el aviso
  // de los me gusta (`'sin-identidad'`). Con etiquetas, la regla de siempre.
  if ((hasNewTags || isOldTags) && Object.keys(tagsPayload.entries || {}).length > 0) {
    // v=312: a IndexedDB, del usuario de ahora, como `migrado` (el archivo no dice de
    // qué fuente salió cada etiqueta). Lo vencido del archivo también entra.
    const uid = await resolverUid();
    if (!uid) throw errorUid;
    const r = await importarEtiquetas(uid, tagsPayload.entries || {});
    result.tagsImported = r.added;
    result.tagsUpdated = r.updated;
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

async function importLikesData(parsed, onProgress) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido');
  const imported = Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed) ? parsed : null);
  if (!imported) throw new Error('El archivo no tiene items');

  const totalAtExport = typeof parsed.totalAtExport === 'number' ? parsed.totalAtExport : imported.length;

  if (imported.length === 0) {
    if (onProgress) onProgress({ phase: 'empty', message: 'El archivo está vacío' });
    return { imported: 0, added: 0, totalNow: null, totalAtExport, empty: true };
  }

  // (v=346) Con la marca, lo mismo que `startLikesLoad`, y ANTES de pedir nada: se reintenta el borrado de la caché de
  // la otra cuenta y, si no sale, se tira sin escribir. Hasta v=345 se escribía igual y el lector siguiente
  // (`leerLikesCacheados` → `borrarLikesDeOtro`) borraba lo recién importado con el toast de «Importado» ya dado.
  if (hayLikesDeOtro() && !(await borrarLikesDeOtro())) throw new Error(TEXTO_LIKES_DE_OTRO);

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

  // (v=346) Nada dice «hecho» sin haberlo hecho: si no se escribió (la marca llegó durante las peticiones, o el
  // navegador no guardó), se tira y el toast de «Importado: N likes» no sale.
  const guardado = await saveLikes(finalItems);
  if (!guardado.ok) {
    throw new Error(guardado.likesDeOtro ? TEXTO_LIKES_DE_OTRO
      : `No se han podido guardar los me gusta del archivo en el navegador${guardado.error ? ` (${guardado.error.message})` : ''}.`);
  }
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

// Seguir artistas usa la API unificada post-migración: 40 URIs, no los
// antiguos endpoints following. Sin reintentos ocultos: cada lote se informa.
export const ARTISTAS_POR_LOTE = LIBRARY_URIS_POR_REQUEST;
function idsDeArtistas(ids) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9]{22}$/.test(id))) {
    throw new Error('Hay un artista sin un id válido de Spotify.');
  }
  return [...new Set(ids)];
}

export async function consultarSeguimientoArtistas(ids, { signal, onBatch = () => {} } = {}) {
  const unicos = idsDeArtistas(ids);
  const estado = new Map();
  for (let i = 0; i < unicos.length; i += ARTISTAS_POR_LOTE) {
    const lote = unicos.slice(i, i + ARTISTAS_POR_LOTE);
    const uris = lote.map(id => `spotify:artist:${id}`).join(',');
    const respuesta = await spotifyFetch(`/me/library/contains?uris=${encodeURIComponent(uris)}`, { signal, _maxRetries: 0 });
    if (!Array.isArray(respuesta) || respuesta.length !== lote.length || respuesta.some(v => typeof v !== 'boolean')) {
      throw new Error('Spotify no ha devuelto un estado válido para cada artista.');
    }
    lote.forEach((id, j) => estado.set(id, respuesta[j]));
    onBatch(new Map(lote.map((id, j) => [id, respuesta[j]])));
  }
  return estado;
}

export async function seguirArtistas(ids, { onBatch = () => {} } = {}) {
  const unicos = idsDeArtistas(ids);
  const seguidos = [];
  for (let i = 0; i < unicos.length; i += ARTISTAS_POR_LOTE) {
    const lote = unicos.slice(i, i + ARTISTAS_POR_LOTE);
    const uris = lote.map(id => `spotify:artist:${id}`).join(',');
    try {
      await spotifyFetch(`/me/library?uris=${encodeURIComponent(uris)}`, { method: 'PUT', _maxRetries: 0 });
    } catch (error) {
      return { seguidos, pendientes: unicos.slice(i), error };
    }
    seguidos.push(...lote);
    onBatch(lote);
  }
  return { seguidos, pendientes: [], error: null };
}


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
let _userIdEnVuelo = null;
const LAST_USER_KEY = 'fonoteca_last_user_id';
// (v=345) La promesa del `/me` + la revisión va guardada: dos llamadas a la vez con el memo frío piden UN `/me`, no dos
// (lo vio la tanda 90). Un fracaso no se memoiza: si el `/me` falla, la promesa se suelta y la llamada siguiente vuelve
// a pedir. `_cachedUserId` se escribe DESPUÉS de la revisión: quien recibe el id ya encuentra la marca puesta (o la
// caché borrada). Sigue tirando SOLO cuando falla el `/me`, como siempre.
async function getCurrentUserId() {
  if (_cachedUserId) return _cachedUserId;
  if (!_userIdEnVuelo) {
    _userIdEnVuelo = (async () => {
      const me = await spotifyFetch('/me');
      await revisarCambioDeUsuario(me.id);
      _cachedUserId = me.id;
      return _cachedUserId;
    })().finally(() => { _userIdEnVuelo = null; });
  }
  return _userIdEnVuelo;
}

// Si el user id cambió respecto al último que estuvo en este browser, limpio las cachés de likes/playlists para que no
// se mezclen, y las del historial pre-cargado (JSONs del owner) en IDB.
//
// (v=345) UNA sola función decide el cambio de cuenta, y la llaman DOS sitios: el arranque (`app.js`, con el id del
// `/me` que ya hizo `testConnection()`, antes de `showApp`; 0 peticiones nuevas) y `getCurrentUserId()`. Es idempotente:
// si `fonoteca_last_user_id` ya es ese id, no hace nada. Los me gusta van con la marca (`borrarLikesDeOtro`, arriba) y se
// ESPERAN, con un tope de 3 s; los demás borrados siguen como antes, sin esperarlos. `fonoteca_last_user_id` se escribe
// igual que siempre, también si el borrado falló (de él salen `prefKey()` y la guarda del import). 🔴 Nunca tira.
async function revisarCambioDeUsuario(id) {
  if (!id) return;
  let prev = null;
  try { prev = localStorage.getItem(LAST_USER_KEY); } catch { return; /* sin localStorage no hay contra qué comparar */ }
  if (prev === id) return;
  let borrado = null;
  if (prev) {
    console.info(`Fonoteca: user cambió (${prev} → ${id}), limpiando caché local`);
    // 🔴 La marca PRIMERO, sincrónica y antes del primer borrado.
    try { localStorage.setItem(LIKES_DE_OTRO_KEY, prev); } catch (e) { console.warn('[likes] no se pudo dejar la marca de los me gusta de la cuenta anterior:', e); }
    borrado = borrarLikesDeOtro();
    try {
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
      // ⚠️ Y las de versiones ANTERIORES, que `OWNER_KEY_LIST` no puede nombrar:
      // solo lleva la versión vigente, así que cada bump deja huérfana la clave
      // que acaba de dejar de usarse — `history_listened_albums_v2` y
      // `history_stats_v2` al subir a v3 el 2026-09-04, y lo mismo cada vez
      // antes. Esas huérfanas son historial de escuchas del owner y quedaban en
      // el navegador de la otra persona: el mismo agujero que arregló v=189 con
      // la lista escrita a mano, por el otro lado. El prefijo las cubre todas,
      // incluidas las de bumps futuros; el BYOH local va bajo `local_` y no lo
      // toca.
      idbDelByPrefix('history_')
        .then(n => { if (n) console.info(`Fonoteca: ${n} caches de historial borrados al cambiar de usuario`); })
        .catch(() => {});
      // Contenido de las playlists: una clave por playlist, así que no se
      // pueden nombrar de antemano. `invalidatePlaylistsCache()` solo limpia la
      // LISTA; hasta v=189 los items —que son las canciones de las playlists de
      // la otra persona— se quedaban acá hasta caducar.
      idbDelByPrefix('playlist_items_')
        .then(n => { if (n) console.info(`Fonoteca: ${n} caches de items de playlist borrados al cambiar de usuario`); })
        .catch(() => {});
      // (v=300) Lo mismo para las playlists de OCULTOS: desde v=299
      // `hidden-sync.js` guarda sus items en `ocultos_items_v1_<playlistId>`,
      // que son también canciones de las playlists de la otra persona. Nadie
      // las lee con otro usuario (la clave va por id de playlist), pero sin
      // esto se quedaban en su navegador hasta que alguien apretara «Limpiar
      // caché». El prefijo es la constante que usa `hidden-sync.js`.
      idbDelByPrefix(OCULTOS_ITEMS_PREFIX)
        .then(n => { if (n) console.info(`Fonoteca: ${n} caches de items de ocultos borrados al cambiar de usuario`); })
        .catch(() => {});
      // Top de Stats.fm: clave global, sin el user delante. Desde v=190 la
      // clave lleva el usuario de Stats.fm, pero puede quedar la vieja de una
      // sesión anterior a la actualización.
      idbDelByPrefix('statsfm_top_lifetime_v1').catch(() => {});
    } catch { /* ignora si no hay localStorage */ }
  }
  try { localStorage.setItem(LAST_USER_KEY, id); } catch { /* ignora si no hay localStorage */ }
  if (borrado) await borrado;
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
// El tope (20) vive en `util/topes-registros.js` desde v=334: «Importar todo» lo usa también, importado.

async function registrarBorradoDeLikes(ids, { origen = 'desconocido', meta = null } = {}) {
  let detalle = null;
  try {
    if (Array.isArray(meta) && meta.length) {
      detalle = meta;
    } else if (!hayLikesDeOtro()) {
      // (v=345) Con la marca no se lee la caché: los ids van pelados. No es un bug que se viera (un id de pista es la
      // misma canción en cualquier cuenta), es que ningún camino lea una caché que no es tuya.
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
// ── Añadir a me gusta, con la caché al día (v=267) ──────────────────────────
//
// `addToLikesCache` es el GEMELO de `removeFromLikesCache`. Hasta v=266 el lado
// de quitar tenía el suyo —desde v=162— y el de añadir no: después de un
// «+ Biblioteca» o un «Añadir pistas a mis likes», la caché seguía diciendo que
// la pista no estaba, así que la ficha de al lado pintaba el corazón hueco
// hasta la próxima sincronización. Y la sincronización no es barata: o un
// incremental que acierta, o ~190 peticiones a `/me/tracks`.
//
// Las entradas van con la MISMA forma que guarda `getAllLikedTracks`
// (`{ added_at, track }`, con la pista ya adelgazada). Si se guardara el objeto
// crudo de `/albums/{id}/tracks` —al que le falta `album`— las vistas que
// agrupan likes por disco lo verían como un like huérfano, que es justo el
// bicho que persigue #orphans.
//
// Nunca destruye: si no puede actualizar, lo dice y deja la caché como estaba.
// El mismo criterio que su gemelo, por la misma razón (una caché con pistas de
// menos es infinitamente mejor que ninguna, y la escritura en Spotify ya se
// hizo igual).
async function addToLikesCache(items) {
  const nuevos = (items || []).filter(it => it?.track?.id);
  if (nuevos.length === 0) return;
  try {
    const cached = await leerLikesCacheados();
    if (!Array.isArray(cached)) return; // caché fría: no se inventa una
    const conocidos = new Set(cached.map(it => it?.track?.id).filter(Boolean));
    const faltantes = nuevos.filter(it => !conocidos.has(it.track.id));
    if (faltantes.length === 0) return;
    // Al frente, como `syncLikesIncremental`: la caché está ordenada por
    // `added_at` descendente y lo recién añadido es lo más nuevo.
    const final = [...faltantes, ...cached];
    await saveLikes(final, { complete: true, total: final.length });
  } catch (e) {
    console.info('[likes] no pude meter lo añadido en la caché (queda sin ellos):', e.message);
    showToast('Los añadí en Spotify, pero la caché local quedó sin ellos. Se corrige en la próxima sincronización.', 'info');
  }
}

/**
 * Añade pistas a me gusta y deja la caché al día, en lote.
 *
 * Mismo reparto que `removeLikedTracks`: la ruta y el tamaño del lote los sabe
 * `api.js` y nadie más. Post-migración la ruta es `PUT /me/library?uris=` —
 * `PUT /me/tracks` no es la de esta app— y el tope son 40 uris por petición,
 * medido en vivo el 2026-08-28 (41 y en adelante dan 400 «Too many uris
 * requested»). Un disco entero entra en UNA petición.
 *
 * @param {Array} tracks  pistas con forma de caché (`{ added_at, track }`).
 * @returns {Promise<{anadidos:number}>}
 */
async function anadirLikes(tracks, opciones = {}) {
  const limpios = (tracks || []).filter(it => it?.track?.id);
  if (limpios.length === 0) return { anadidos: 0 };
  const ids = [...new Set(limpios.map(it => it.track.id))];
  await saveToLibrary(ids);
  await addToLikesCache(limpios);
  return { anadidos: ids.length, origen: opciones.origen || null };
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
// Estrategia hasta v=225: un probe barato al nativo y, ante 400/403/429, a
// /search PARA EL RESTO DE LA SESIÓN. Eso era memoizar un fracaso como si fuera
// un hecho (la misma forma que `_albumIdMemo` en v=219).
//
// Medido en vivo el 2026-09-16 (v=225, escaneo real de 50 artistas, diagnóstico
// leído desde la pestaña): el nativo da **429 `QUOTA_EXCEEDED` después de
// exactamente 100 requests en ~33 s** (20 artistas), `Retry-After` ilegible por
// CORS, y el bloqueo es **del endpoint, no de la app**: en el mismo momento
// `/artists/{id}`, `/albums/{id}/tracks`, `/search` y `/me` daban 200. Duración
// del bloqueo: ver `NATIVO_PAUSA_*` más abajo.
//
// Estrategia desde v=226:
//   - 429 → el nativo entra en PAUSA (no se abandona). Mientras dura, /search, y
//     la discografía queda marcada con su fuente. Pasada la pausa, el siguiente
//     artista vuelve a probar el nativo; si vuelve a dar 429, la pausa se dobla.
//   - 400/403 → sí se abandona para la sesión (reintentar lo mismo no cambia la
//     respuesta), pero queda en `estadoNativoDiscografia()` para decirlo en
//     pantalla, no en la consola.
//   - Los requests al nativo van SIN reintentos: con una cuota que dura minutos,
//     5 × 5 s de espera por worker solo retrasaban el mismo 429.
let _nativoPausaHasta = 0;        // ms epoch; 0 = sin pausa
let _nativoPausaMs = 0;           // última pausa aplicada (para doblarla)
let _nativoDenegado = null;       // { status, mensaje } si dio 400/403

// ── Pausa de `/search` (v=263) ──────────────────────────────────────────────
// La cuota de `/search` es POR PETICIONES ACUMULADAS (429 en el request 697,
// horas de bloqueo) y la comparte toda la app. Antes, un 429 en `/search`
// disparaba los 5 reintentos del retry loop de `spotifyFetch`: cinco
// peticiones más contra el mismo tope, cada tarjeta abierta costaba 6
// peticiones de una cuota agotada. Ahora el primer 429 cierra la puerta y las
// llamadas siguientes las corta la guarda de `spotifyFetch` sin pegar al
// servidor. Doblado como el nativo, con los mismos topes (5 a 60 min).
const SEARCH_PAUSA_MIN_MS = 5 * 60 * 1000;
const SEARCH_PAUSA_MAX_MS = 60 * 60 * 1000;
let _searchPausaHasta = 0;
let _searchPausaMs = 0;

// ── Diagnóstico del endpoint de discografía (v=225) ─────────────────────────
// El cambio a /search se avisaba con `console.warn`, que la extensión de Chrome
// no captura: en tres semanas nadie supo si era 400, 403 o 429. Ahora cada
// evento del nativo queda en este objeto (exportado) y en sessionStorage, para
// leerlo desde dentro de la pestaña. Es por pestaña y por carga, a propósito:
// lo que interesa es la historia de UNA sesión de escaneo.
const ARTIST_ALBUMS_DIAG_KEY = 'fonoteca_artist_albums_diag';
const artistAlbumsDiag = {
  inicio: null,            // ms del primer request al nativo
  nativoArtistasOk: 0,     // artistas cuya discografía vino entera del nativo
  nativoRequests: 0,       // requests al nativo que devolvieron 200
  busquedaArtistas: 0,     // artistas servidos por /search
  esperas429: [],          // cada 429 del nativo, con lo que se pudo leer del header
  cambios: [],             // cada paso a /search, con el motivo
};
function guardarDiag() {
  try { sessionStorage.setItem(ARTIST_ALBUMS_DIAG_KEY, JSON.stringify(artistAlbumsDiag)); } catch { /* ignora */ }
}
onRateLimit((info) => {
  if (!/^\/artists\/[^/]+\/albums/.test(info.endpoint || '')) return;
  artistAlbumsDiag.esperas429.push({
    t: Date.now(),
    endpoint: String(info.endpoint).slice(0, 120),
    intento: info.intento,
    maxRetries: info.maxRetries,
    // null = el header no es legible (CORS) o no vino; no se distingue desde acá.
    retryAfterCrudo: info.retryAfterCrudo ?? null,
    nativoArtistasOk: artistAlbumsDiag.nativoArtistasOk,
    nativoRequests: artistAlbumsDiag.nativoRequests,
  });
  if (artistAlbumsDiag.esperas429.length > 200) artistAlbumsDiag.esperas429.shift();
  guardarDiag();
});
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

// Pausa del nativo tras un 429. PROVISIONAL hasta medir cuánto dura la cuota:
// ver el comentario de arriba y ULTIMO-CAMBIO.md.
const NATIVO_PAUSA_MIN_MS = 5 * 60 * 1000;
const NATIVO_PAUSA_MAX_MS = 60 * 60 * 1000;

// La discografía por `/search?q=artist:"X"&type=album`, filtrada al artista.
// Es la ÚNICA copia de este filtro: la usan el fallback de
// `getArtistAlbumsConFuente` (4 páginas, sin año) y el refresco de lo reciente
// de la base de discografías (`year:`, v=229). Si se escribiera dos veces
// divergiría, que es lo que pasó con los dos resolutores de álbum de v=219.
//
// `year` = 'AAAA-AAAA' o null. `maxPages` corta el paginado; `cortada` dice si
// se cortó con la última página llena (Spotify tenía más y no se pidió).
async function buscarDiscografiaPorNombre(artistId, artistName, { includeSingles = true, year = null, maxPages = SEARCH_MAX_PAGES } = {}) {
  // /search devuelve cualquier cosa que matchee el texto: buscando
  // artist:"Drake" aparecen Nick Drake, Drake Bell y "draken". Filtramos por
  // **id** del artista (lo tenemos) y, si el álbum no lo trae, por nombre
  // exacto. Sin esto la vista de "sin escuchar" se llena de artistas ajenos.
  const wanted = (artistName || '').trim();
  if (!wanted) return { items: [], cortada: false };
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
  //
  // `year:` medido el 2026-09-18: `artist:"Maroon 5" year:2025-2026` trae en 1
  // request los 4 lanzamientos 2025+ que da el nativo, y el de Lana Del Rey trae
  // 4 singles de 2025-2026 que el nativo NO devuelve.
  const q = `artist:"${limpiaParaQuery(wanted)}"` + (year ? ` year:${year}` : '');
  const items = [];
  let emptyPages = 0;
  // Cortada = se gastaron las `maxPages` páginas y la última vino llena:
  // Spotify tenía más y no se pidió. Ojo, no es lo mismo que «40
  // lanzamientos»: el filtro de `isMine` puede dejar 37 de 40 y seguir
  // cortada. Si el bucle termina por una página corta, /search no tenía más.
  // ⚠️ El 40 NO es de la API (medido 2026-09-18): el tope real es
  // `limit + offset ≤ 1000` y con `artist:` los resultados se acaban solos.
  let cortada = false;
  let paginas = 0;   // requests gastados: el presupuesto de la base los cuenta
  for (let page = 0; page < maxPages; page++) {
    const offset = page * SEARCH_PAGE;
    paginas++;
    const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=${SEARCH_PAGE}&offset=${offset}`);
    const batch = res?.albums?.items || [];
    const mine = batch.filter(isMine);
    items.push(...mine);
    if (batch.length < SEARCH_PAGE) break;
    // Los resultados vienen por relevancia: si dos páginas seguidas no traen
    // nada del artista, lo que sigue es ruido. (Medido 2026-09-18 sobre 56
    // artistas paginados sin tope: esta regla corta antes de tiempo en 3 y
    // pierde 1-2 lanzamientos en cada uno.)
    emptyPages = mine.length ? 0 : emptyPages + 1;
    if (emptyPages >= 2) break;
    if (page === maxPages - 1) cortada = true;
  }
  return { items: items.filter(al => includeSingles || al.album_type === 'album'), cortada, paginas };
}

// Devuelve { items, fuente: 'nativo' | 'busqueda', cortada, motivo }.
// `cortada` = Spotify tenía más lanzamientos y no se pidieron.
async function getArtistAlbumsConFuente(artistId, artistName, { includeSingles = true, limit = ARTIST_ALBUMS_MAX_LIMIT } = {}) {
  const groups = includeSingles ? 'album,single' : 'album';
  const tryNative = async () => {
    const items = [];
    let url = `/artists/${artistId}/albums?include_groups=${groups}&limit=${Math.min(limit, ARTIST_ALBUMS_MAX_LIMIT)}`;
    for (let i = 0; i < 25; i++) {
      // El primer request es el probe: sin reintentos, para que un endpoint
      // muerto no cueste 25 segundos por artista.
      if (artistAlbumsDiag.inicio == null) artistAlbumsDiag.inicio = Date.now();
      let res;
      try {
        res = await spotifyFetch(url, { _maxRetries: 0 });
      } catch (e) {
        e.paginaNativa = i;
        e.itemsHastaAhora = items.length;
        throw e;
      }
      artistAlbumsDiag.nativoRequests++;
      if (!res) break;
      const batch = res.items || [];
      items.push(...batch);
      if (!res.next) break;
      url = res.next.replace('https://api.spotify.com/v1', '');
      // Límite razonable. Casi nadie llega (el máximo medido son 209, con la
      // última página entera), pero si se corta acá, se DICE: cortada.
      if (items.length >= 200) return { items, cortada: true };
    }
    return { items, cortada: false };
  };

  const trySearch = () => buscarDiscografiaPorNombre(artistId, artistName, { includeSingles });

  const porBusqueda = async (motivo) => {
    artistAlbumsDiag.busquedaArtistas++;
    guardarDiag();
    const r = await trySearch();
    return { ...r, fuente: 'busqueda', motivo };
  };

  if (_nativoDenegado) return porBusqueda('denegado');
  if (Date.now() < _nativoPausaHasta) {
    contadorCuota.cortada('discografia');   // el nativo no se pidió: no gastó cuota
    return porBusqueda('pausa');
  }

  try {
    const r = await tryNative();
    artistAlbumsDiag.nativoArtistasOk++;
    // Salió bien: la próxima pausa vuelve a empezar desde el mínimo.
    _nativoPausaMs = 0;
    guardarDiag();
    return { ...r, fuente: 'nativo', motivo: null };
  } catch (e) {
    const status = Number(e.status || (String(e.message).match(/\b(400|403|429)\b/) || [])[1]) || null;
    if (status === 429 || status === 400 || status === 403) {
      // Con dos workers en paralelo los dos se comen el mismo 429 casi a la
      // vez: el segundo no tiene que doblar la pausa que acaba de poner el primero.
      if (status === 429 && Date.now() >= _nativoPausaHasta) {
        _nativoPausaMs = _nativoPausaMs
          ? Math.min(NATIVO_PAUSA_MAX_MS, _nativoPausaMs * 2)
          : NATIVO_PAUSA_MIN_MS;
        _nativoPausaHasta = Date.now() + _nativoPausaMs;
      } else if (status !== 429) {
        _nativoDenegado = { status, mensaje: String(e.message).slice(0, 200) };
      }
      if (status === 429) contadorCuota.pausa('discografia', _nativoPausaHasta);
      artistAlbumsDiag.cambios.push({
        t: Date.now(),
        status,
        mensaje: String(e.message).slice(0, 200),
        artista: artistName,
        artistaId: artistId,
        pagina: e.paginaNativa ?? null,
        itemsHastaAhora: e.itemsHastaAhora ?? null,
        nativoArtistasOk: artistAlbumsDiag.nativoArtistasOk,
        nativoRequests: artistAlbumsDiag.nativoRequests,
        msDesdeInicio: artistAlbumsDiag.inicio ? Date.now() - artistAlbumsDiag.inicio : null,
        pausaMs: status === 429 ? _nativoPausaMs : null,
      });
      console.info(`[api] getArtistAlbums: /artists/{id}/albums → ${status} en «${artistName}»`
        + (status === 429 ? ` · nativo en pausa ${Math.round(_nativoPausaMs / 1000)} s, mientras tanto /search`
          : ' · nativo denegado para esta sesión, se usa /search'));
      return porBusqueda(status === 429 ? 'pausa' : 'denegado');
    }
    // Cualquier otro fallo del nativo no cambia de endpoint, pero también queda.
    artistAlbumsDiag.otrosErrores = (artistAlbumsDiag.otrosErrores || []).slice(-49);
    artistAlbumsDiag.otrosErrores.push({ t: Date.now(), status: e.status ?? null, mensaje: String(e.message).slice(0, 200), artista: artistName });
    guardarDiag();
    throw e;
  }
}

async function getArtistAlbums(artistId, artistName, opts) {
  return (await getArtistAlbumsConFuente(artistId, artistName, opts)).items;
}

/** Para la interfaz: si el nativo está en pausa o denegado, y desde cuándo. */
function estadoNativoDiscografia() {
  return {
    pausaHasta: _nativoPausaHasta > Date.now() ? _nativoPausaHasta : 0,
    denegado: _nativoDenegado,
  };
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
//
// ⚠️ La query va por `limpiaParaQuery` (v=256). Sacaba las comillas pero NO el
// apóstrofo, que es el que rompe la sintaxis `campo:"…"` de Spotify: era el
// mismo fallo que dejaba sin foto a los artistas con apóstrofo en
// `features/artist-card.js`, acá en la resolución del id. Su único llamador es
// `getArtistIdCached` (`discover-common.js:48`), o sea que un artista con
// apóstrofo podía no tener id resoluble nunca y quedarse sin discografía.
// `buscarDiscografiaPorNombre`, treinta líneas más arriba en este mismo archivo,
// ya lo limpiaba desde v=229.
//
// ⚠️ Y limpiar obliga a comparar: la query queda más laxa, así que el `items[0]`
// a ciegas de antes pasa a verificarse con `artistIsSame` —la versión ESTRICTA,
// la que existe justo para filtrar discografías (el «Drake» que traía a Nick
// Drake, v=124)—. Sin eso, aflojar la query es cambiar «no lo encuentro» por
// «encontré a otro», y este id se cachea 60 días.
async function searchArtistByName(name) {
  if (!name) return null;
  const q = `artist:"${limpiaParaQuery(name)}"`;
  const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=artist&limit=5`);
  const items = res?.artists?.items || [];
  // El mejor match por exact name (case insensitive), si no el que `artistIsSame`
  // dé por el mismo artista.
  const lc = name.toLowerCase();
  const exact = items.find(a => (a.name || '').toLowerCase() === lc);
  return exact || items.find(a => artistIsSame(name, a.name)) || null;
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
  revisarCambioDeUsuario,
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
  anadirLikes,
  saveAlbumsToLibrary,
  removeAlbumsFromLibrary,
  albumsInLibrary,
  getSavedAlbums,
  getArtistAlbums,
  getArtistAlbumsConFuente,
  buscarDiscografiaPorNombre,
  estadoNativoDiscografia,
  artistAlbumsDiag,
  getAlbumTracks,
  searchArtistByName,
  onRateLimit,
  invalidatePlaylistsCache,
  onPlaylistsInvalidated,
  getLikesTotal,
  syncLikesIncremental,
  importLikesData,
  exportAllData,
  exportarCopiaCompleta,
  importarCopiaCompleta,
  aplicarPlan,
  importAllData,
  TEXTOS_LIKES_SIN_IMPORTAR,
  getBestAvailableLikes,
  getLikesPartialInfo,
  getLikesCacheTimestamp,
  readLocalConfig,
  applyLocalConfig,
  CONFIG_LOCAL_KEYS,
};
