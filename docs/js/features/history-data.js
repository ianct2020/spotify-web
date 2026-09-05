// Loader compartido de los agregados del Extended Streaming History.
// DOS FUENTES:
//   1. Local del user: si el user subió su propio ZIP, los agregados quedan
//      en IDB bajo claves local_<uid>_history_*. Se prioriza esta fuente.
//   2. Owner (Ian): si no hay local Y el user logueado es el owner, se baja
//      del repo (los JSONs precomputados por scripts/gen-stats.py).
//
// Otro user cualquiera sin historial local ve el ownerLockedMessage que
// invita a subir su ZIP.

import { idbGetCached, idbSetCached, idbDel } from '../idb.js?v=205';
import { getCurrentUserId } from '../api.js?v=205';
import { OWNER_KEYS, STATS_VERSION, PLAYS_VERSION, LISTENED_VERSION, SKIP_VERSION, DETAIL_VERSION, RECORDS_VERSION, ARTIST_TRACKS_VERSION } from '../history-keys.js?v=205';
import { mostrarBannerDegradadoVista } from '../ui/degraded-banner.js?v=205';

const HISTORY_OWNER_ID = 'orhs6wu5ykk7ql80u92ujn74o';

// Mismo literal que `LAST_USER_KEY` en api.js/app.js (no se exporta desde
// ninguno de los dos, así que se repite — es lo que ya hace app.js).
const LAST_USER_KEY = 'fonoteca_last_user_id';

function idGuardado() {
  try { return localStorage.getItem(LAST_USER_KEY) || null; }
  catch { return null; }
}

// [v178] Si `/me` falla (429, red, token), `getCurrentUserId()` agota sus
// reintentos y tira. Antes eso hacía caer todo lo que depende de saber quién
// sos —incluida la carga de los JSON precomputados del owner, no solo
// `isOwner()`— aunque ninguno de los dos necesite el PERFIL, solo el id. Acá
// se cae a `fonoteca_last_user_id`, que `getCurrentUserId()` ya escribe de
// forma SÍNCRONA la primera vez que resuelve — el mismo atajo del arranque
// degradado de `app.js` (v=173). Nunca tira: en el peor caso (navegador que
// nunca vio sesión) devuelve `id: null`.
//
// [v180] Lo de arriba no alcanzaba: `getCurrentUserId()` memoiza el ÉXITO
// (`_cachedUserId`, api.js) pero NUNCA el fracaso, así que cada vista que
// llama a `isOwner()`/`ensureFreshMem()` volvía a pagar la batería completa de
// `spotifyFetch` contra `/me` (hasta 6 requests, ~25-30s de backoff) antes de
// caer al mismo fallback de siempre. Con Wrapped + Récords + #covers en la
// misma sesión eran hasta 18 requests de más contra el endpoint YA bloqueado.
//
// `meFalloEnEstaCarga` es memoria de ESTA carga de página, nada más: variable
// de módulo, nunca `localStorage`. Tiene que morir con la pestaña — si
// Spotify se destraba, un F5 vuelve a intentar desde cero, no arrastra un
// fracaso viejo. Con `/me` sano no cambia nada: `getCurrentUserId()` responde
// y esta bandera ni se toca.
let meFalloEnEstaCarga = false;

async function resolvedUserId() {
  if (meFalloEnEstaCarga) return { id: idGuardado(), degradado: true };
  try {
    return { id: await getCurrentUserId(), degradado: false };
  } catch {
    meFalloEnEstaCarga = true;
    return { id: idGuardado(), degradado: true };
  }
}

/**
 * ¿La identidad de esta carga vino del fallback en vez de `/me`?
 *
 * Vale para toda la carga de página, igual que `meFalloEnEstaCarga`. Se usa
 * para decidir si se puede servir historial y para explicar por qué no.
 */
function identidadSinConfirmar() {
  return meFalloEnEstaCarga;
}

// ⚠️ REGLA (v=190): CON LA IDENTIDAD SIN CONFIRMAR, `isOwner()` DICE QUE NO.
//
// Hasta v=189 el fallback podía decir «sí sos el owner»: si `/me` daba 429,
// `resolvedUserId()` caía a `fonoteca_last_user_id`, que es el id del ÚLTIMO
// que usó este navegador. O sea que la persona siguiente heredaba la identidad
// de la anterior mientras durase el bloqueo —y hay precedente de `/me` en 429
// más de diez horas (28/08)—, y veía Wrapped, Récords, #covers, #skips y
// #zeroplays con el historial de escuchas ajeno presentado como suyo.
//
// El fallback se hizo en v=178/v=180 para que el owner no se quedara fuera de
// su propia app con `/me` caído. Se conserva para todo lo que NO depende de ser
// owner (arrancar, la biblioteca, las playlists, las preferencias); lo único
// que pierde es el poder de CONCEDER acceso al historial. El intercambio es
// deliberado: es preferible no ver el historial propio con Spotify caído que
// arriesgarse a enseñárselo a otro.
async function isOwner() {
  const { id, degradado } = await resolvedUserId();
  if (degradado) {
    // Se avisa siempre, no solo cuando el id guardado coincide: la persona
    // tiene que saber por qué la vista no le muestra lo de siempre.
    mostrarBannerDegradadoVista();
    return false;
  }
  return id === HISTORY_OWNER_ID;
}

// Las versiones y las claves viven en `history-keys.js`, que no importa nada.
// Ahí está el porqué: `api.js` también las necesita para el guarda multiusuario
// y tenía una copia a mano que se quedó vieja (v=188).

// Claves para historial local por user (BYOH). No usan TTL porque los subió el
// user a mano — se borran solo cuando pide "borrar mi historial".
const LOCAL_TTL_MIN = 100 * 365 * 24 * 60; // ~100 años

function localKey(uid, kind) {
  return `local_${uid}_history_${kind}`;
}

// Caches en memoria (por sesión de página). Se resetean al cambiar de user.
let memCache = { uid: null, stats: null, plays: null, listened: null, skip: null, detail: null, records: null, artistTracks: null };

async function ensureFreshMem() {
  // [v178] Mismo fallback que `isOwner()`: sin esto, con `/me` caído el uid
  // quedaba en `null`, el chequeo `uid === HISTORY_OWNER_ID` de más abajo
  // fallaba igual que antes, y `isOwner()` podía decir "sí sos el owner"
  // mientras `loadOne()` seguía sirviendo `null` — banner sin contenido atrás.
  const { id: uid } = await resolvedUserId();
  if (memCache.uid !== uid) memCache = { uid, stats: null, plays: null, listened: null, skip: null, detail: null, records: null, artistTracks: null };
  return uid;
}

// Chequeo rápido: ¿el user actual tiene historial cargado localmente?
async function hasLocalHistory() {
  const uid = await getCurrentUserId().catch(() => null);
  if (!uid) return false;
  try {
    const s = await idbGetCached(localKey(uid, 'stats'));
    return !!(s && s.years);
  } catch { return false; }
}

// Claves de versiones anteriores por kind — si aparecen en IDB y la nueva
// versión no está en cache, las usamos como fallback y migramos la data.
// Evita el re-fetch cuando bumpeamos una _VERSION del pipeline pero el JSON
// remoto no cambió estructuralmente.
const OWNER_PREV_KEYS = {
  // Vacía A PROPÓSITO desde v3 (2026-09-04). El bump a v3 existe SOLO para que
  // el navegador vuelva a bajar el JSON con las tapas horneadas por
  // `scripts/bake-covers.py`; migrar el v2 —o peor, el v1— desde IDB
  // devolvería exactamente el archivo sin tapas que el bump quiere reemplazar,
  // y la vista se pintaría igual que antes sin fallar, o sea EN SILENCIO.
  stats: [],
  // Ninguna versión anterior sirve: v1/v2 no traen `albums`, v3 lo trae sin
  // plays ni ms (que es lo que necesita la ficha de álbum) y v4 sin el día de
  // la primera play (v=157). Lista vacía a propósito, para forzar el refetch
  // del JSON nuevo.
  plays: [],
  // Vacía A PROPÓSITO desde v3, por el mismo motivo que `stats`: cualquier
  // versión anterior es el JSON con los 91 `img` en null.
  listened: [],
  // Vacía A PROPÓSITO, igual que `plays` en v=140: v1 era {id: [ok, skip]} y v2
  // es {id: [ok, skip, fwd_ms, close_ms, gid]}. Un v1 reciclado dejaría a
  // skips.js sin los ms de cada play y sin el agrupado, y los tres toggles
  // nuevos no harían nada en silencio. Que refetchee.
  skip: [],
  detail: [],
  records: ['history_records_v1'],
  // Vacía por el mismo motivo: el v1 de `totals` no trae el día de la primera
  // play y la ficha de artista se quedaría sin «primera vez», en silencio.
  artistTracks: [],
};

async function loadOne(kind, cacheField, sanityCheck, fetchUrlForOwner) {
  const uid = await ensureFreshMem();

  // ⚠️ Y ACÁ ESTÁ LA MITAD QUE IMPORTA DE LA REGLA DE `isOwner()`.
  //
  // Arreglar solo `isOwner()` no cerraba nada: las vistas piden los datos
  // PRIMERO y preguntan por el owner solo si vienen vacíos (mirá `records.js`:
  // `const r = await loadRecords(); if (!r || !r.top_days?.length) { …
  // isOwner() … }`). Como el `owner` de más abajo se decidía con el MISMO uid
  // del fallback, `loadOne()` servía los JSON del owner igual y la vista los
  // pintaba sin llegar a preguntar. El candado tiene que estar donde se
  // entregan los datos, no donde se dibuja el cartel.
  //
  // Sin identidad confirmada no se sirve historial de NADIE: ni el del owner ni
  // el BYOH local, que también se busca por `localKey(uid, …)` y sería el del
  // usuario anterior.
  if (identidadSinConfirmar()) return null;

  if (memCache[cacheField]) return memCache[cacheField];

  // 1) local del user (cualquier user — owner o no)
  if (uid) {
    try {
      const cached = await idbGetCached(localKey(uid, kind));
      if (cached && sanityCheck(cached)) {
        console.log(`[history-data] ${kind}: hit local BYOH (${uid})`);
        memCache[cacheField] = cached; return cached;
      }
    } catch { /* ignora */ }
  }

  // 2) cache del owner (histórico) — el resto de los users cae acá si son Ian,
  //    o sale por null si no lo son.
  const owner = uid === HISTORY_OWNER_ID;
  if (!owner) return null;

  try {
    const cached = await idbGetCached(OWNER_KEYS[kind]);
    if (cached && sanityCheck(cached)) {
      console.log(`[history-data] ${kind}: hit IDB owner (${OWNER_KEYS[kind]})`);
      memCache[cacheField] = cached; return cached;
    }
  } catch { /* ignora */ }

  // 2b) fallback a versión anterior si existe — migra a la nueva key.
  for (const prevKey of (OWNER_PREV_KEYS[kind] || [])) {
    try {
      const prev = await idbGetCached(prevKey);
      if (prev && sanityCheck(prev)) {
        console.log(`[history-data] ${kind}: migrando ${prevKey} → ${OWNER_KEYS[kind]}`);
        memCache[cacheField] = prev;
        try { await idbSetCached(OWNER_KEYS[kind], prev, 365 * 24 * 60); } catch { /* ignora */ }
        return prev;
      }
    } catch { /* ignora */ }
  }

  try {
    const url = fetchUrlForOwner();
    console.log(`[history-data] ${kind}: FETCH ${url.toString ? url.toString() : url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    memCache[cacheField] = data;
    // TTL 1 año: los JSON del owner casi nunca cambian (solo cuando bumpeo el
    // pipeline y subo _VERSION — ahí la key cambia y esta entrada queda
    // huérfana igual, así que el TTL corto no ayuda a nada). El único costo
    // real del cache viejo es un fetch inútil por 365 días.
    try { await idbSetCached(OWNER_KEYS[kind], data, 365 * 24 * 60); } catch { /* ignora */ }
    return data;
  } catch (e) {
    console.warn(`No se pudo cargar ${kind}:`, e.message);
    return null;
  }
}

const dataUrl = (name, v) => new URL(`../../data/${name}?v=${v}`, import.meta.url);

async function loadHistoryStats() {
  return loadOne('stats', 'stats', d => !!d.years, () => dataUrl('history-stats.json', STATS_VERSION));
}
async function loadTrackPlays() {
  // requerimos `albums` para invalidar cualquier v2 stale (v2 solo traía tracks).
  return loadOne('plays', 'plays', d => !!d.tracks && Array.isArray(d.albums), () => dataUrl('history-track-plays.json', PLAYS_VERSION));
}
async function loadListenedAlbums() {
  return loadOne('listened', 'listened', d => !!d.years, () => dataUrl('history-listened-albums.json', LISTENED_VERSION));
}
async function loadSkipStats() {
  // Exijo `version >= 2`: un BYOH viejo guardado en IDB (que no lleva versión en
  // la key, a diferencia del cache del owner) traería el formato v1 y pasaría
  // el `!!d.tracks` de antes. Así se descarta y el user reimporta su ZIP.
  return loadOne('skip', 'skip', d => !!d.tracks && (d.version || 1) >= 2, () => dataUrl('history-skip-stats.json', SKIP_VERSION));
}
async function loadTrackDetail() {
  return loadOne('detail', 'detail', d => !!d.tracks, () => dataUrl('history-track-detail.json', DETAIL_VERSION));
}
// v=126 — top de tracks por artista sacado del historial COMPLETO. Se carga
// bajo demanda (solo lo abre la ficha de artista): ~930 KB.
async function loadArtistTracks() {
  return loadOne('artistTracks', 'artistTracks', d => !!d.artists, () => dataUrl('history-artist-tracks.json', ARTIST_TRACKS_VERSION));
}
async function loadRecords() {
  return loadOne('records', 'records', d => !!d.top_days, () => dataUrl('history-records.json', RECORDS_VERSION));
}

// Guarda el historial procesado (BYOH) en IDB del user actual.
// payload = { stats, trackPlays, listened, skipStats, detail, records }
async function saveMyHistory(payload) {
  const uid = await getCurrentUserId();
  if (!uid) throw new Error('No se pudo detectar tu user de Spotify');
  await Promise.all([
    idbSetCached(localKey(uid, 'stats'), payload.stats, LOCAL_TTL_MIN),
    idbSetCached(localKey(uid, 'plays'), payload.trackPlays, LOCAL_TTL_MIN),
    idbSetCached(localKey(uid, 'listened'), payload.listened, LOCAL_TTL_MIN),
    idbSetCached(localKey(uid, 'skip'), payload.skipStats, LOCAL_TTL_MIN),
    idbSetCached(localKey(uid, 'detail'), payload.detail, LOCAL_TTL_MIN),
    idbSetCached(localKey(uid, 'records'), payload.records, LOCAL_TTL_MIN),
    idbSetCached(localKey(uid, 'artistTracks'), payload.artistTracks, LOCAL_TTL_MIN),
  ]);
  // Invalido memoria para que la próxima carga vaya al IDB fresco
  memCache = { uid: null, stats: null, plays: null, listened: null, skip: null, detail: null, records: null, artistTracks: null };
}

async function clearMyHistory() {
  const uid = await getCurrentUserId().catch(() => null);
  if (!uid) return;
  await Promise.all(['stats', 'plays', 'listened', 'skip', 'detail', 'records', 'artistTracks'].map(k => idbDel(localKey(uid, k)).catch(() => {})));
  memCache = { uid: null, stats: null, plays: null, listened: null, skip: null, detail: null, records: null, artistTracks: null };
}

function trackIdOf(uri) {
  return (uri || '').startsWith('spotify:track:') ? uri.slice(14) : null;
}

function playsFor(uri, index) {
  if (!index || !index.tracks) return null;
  const id = trackIdOf(uri);
  if (!id) return null;
  return index.tracks[id] || null;
}

// HTML para el estado "el user no tiene historial disponible". Antes solo mostraba
// el mensaje "esto es de Ian"; ahora ofrece subir el propio ZIP como alternativa.
/**
 * Por qué esta vista no muestra el historial cuando NO se pudo confirmar quién
 * sos. Es un caso distinto del de «sos otra persona»: acá puede que seas el
 * owner, así que decirte «necesito tu historial» y ofrecerte importarlo sería
 * mentira — el historial está, lo que falta es la confirmación de identidad.
 */
function identityLockedMessage(featureName = 'esta vista') {
  return `<div class="olm-card">
    <div class="olm-header">
      <div class="olm-header-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div style="flex:1;min-width:0">
        <h3 style="margin:0;font-size:16px">No hemos podido confirmar tu identidad</h3>
        <div style="color:var(--color-text-muted);font-size:12px;margin-top:2px">${escapeHtmlLite(featureName)} necesita saber de quién es el historial</div>
      </div>
    </div>
    <div style="padding:14px 16px;font-size:13px;line-height:1.5;color:var(--color-text-secondary)">
      <p style="margin:0 0 10px">
        Spotify está limitando las peticiones (429) y no responde a quién
        corresponde esta sesión. Este navegador recuerda al último usuario que
        entró, pero <strong>no basta</strong>: si el historial no es tuyo, se lo
        estaríamos enseñando a quien no es.
      </p>
      <p style="margin:0 0 12px">
        Por eso queda oculto hasta que Spotify vuelva a responder. No se ha
        perdido nada: sigue guardado en este navegador.
      </p>
      <button class="btn btn-secondary btn-sm" data-recargar-identidad>Volver a intentarlo</button>
    </div>
  </div>`;
}

function ownerLockedMessage(featureName = 'esta vista') {
  // Dos motivos muy distintos para no enseñar el historial, y confundirlos
  // manda al usuario a hacer algo que no le sirve: si sos el owner y lo que
  // falla es `/me`, importar un historial que ya tenés no arregla nada.
  if (identidadSinConfirmar()) return identityLockedMessage(featureName);
  return `<div class="olm-card">
    <div class="olm-header">
      <div class="olm-header-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
          <path d="M3 3v18h18"/><path d="M18.7 8L14 12.7l-3-3L8 13l-2-2"/>
        </svg>
      </div>
      <div style="flex:1;min-width:0">
        <h3 style="margin:0;font-size:16px">Necesito tu historial</h3>
        <div style="color:var(--color-text-muted);font-size:12px;margin-top:2px">${escapeHtmlLite(featureName)} usa el Extended Streaming History — el de Ian queda oculto</div>
      </div>
    </div>
    <div class="olm-options">
      <button class="olm-option olm-option-primary" data-open-import>
        <div class="olm-option-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="olm-option-body">
          <div class="olm-option-title">Ya tengo mi ZIP</div>
          <div class="olm-option-sub">Súbelo y en ~5s tienes todo funcionando</div>
        </div>
      </button>
      <button class="olm-option" data-open-spotify-privacy>
        <div class="olm-option-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div class="olm-option-body">
          <div class="olm-option-title">Todavía no lo tengo</div>
          <div class="olm-option-sub">Pedile el historial a Spotify (tarda unos días)</div>
        </div>
      </button>
    </div>
    <p class="olm-note">Todo se procesa <strong>en tu navegador</strong> — tus datos nunca salen de tu compu.</p>
    </div>`;
}

// Micro-escape para no tener que importar escapeHtml acá y evitar el ciclo con components
function escapeHtmlLite(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Bootstrap: engancha los botones del ownerLockedMessage globalmente (una vez).
// Los delego a través del document para que sirvan en cualquier feature que
// haya insertado el mensaje.
let _boundLockedButtons = false;
function bindOwnerLockedButtons(openImportFn) {
  if (_boundLockedButtons) return;
  _boundLockedButtons = true;
  document.addEventListener('click', (e) => {
    const importBtn = e.target.closest('[data-open-import]');
    if (importBtn) { e.preventDefault(); openImportFn(); return; }
    // Botón del cartel de identidad sin confirmar: `meFalloEnEstaCarga` muere
    // con la pestaña a propósito, así que recargar es exactamente lo que hay
    // que hacer para volver a preguntarle a `/me`.
    const idBtn = e.target.closest('[data-recargar-identidad]');
    if (idBtn) { e.preventDefault(); location.reload(); return; }
    const privBtn = e.target.closest('[data-open-spotify-privacy]');
    if (privBtn) {
      e.preventDefault();
      const w = Math.round(screen.width * 0.67);
      const h = Math.round(screen.height * 0.85);
      window.open('https://www.spotify.com/account/privacy/', 'sp_privacy', `width=${w},height=${h},left=${Math.round(screen.width * 0.16)}`);
    }
  });
}

export {
  loadHistoryStats, loadTrackPlays, loadListenedAlbums, loadSkipStats, loadTrackDetail, loadRecords, loadArtistTracks,
  playsFor, trackIdOf, isOwner, HISTORY_OWNER_ID, ownerLockedMessage,
  hasLocalHistory, saveMyHistory, clearMyHistory, bindOwnerLockedButtons,
  identidadSinConfirmar,
};
