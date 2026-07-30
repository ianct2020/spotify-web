// Loader compartido de los agregados del Extended Streaming History.
// DOS FUENTES:
//   1. Local del user: si el user subió su propio ZIP, los agregados quedan
//      en IDB bajo claves local_<uid>_history_*. Se prioriza esta fuente.
//   2. Owner (Ian): si no hay local Y el user logueado es el owner, se baja
//      del repo (los JSONs precomputados por scripts/gen-stats.py).
//
// Otro user cualquiera sin historial local ve el ownerLockedMessage que
// invita a subir su ZIP.

import { idbGetCached, idbSetCached, idbDel } from '../idb.js?v=98';
import { getCurrentUserId } from '../api.js?v=98';

const HISTORY_OWNER_ID = 'orhs6wu5ykk7ql80u92ujn74o';

async function isOwner() {
  try { return (await getCurrentUserId()) === HISTORY_OWNER_ID; }
  catch { return false; }
}

const STATS_VERSION = 2;
const PLAYS_VERSION = 2;
const LISTENED_VERSION = 2;
const SKIP_VERSION = 1;
const DETAIL_VERSION = 1;
const RECORDS_VERSION = 2;

// Claves del cache del owner (repo → IDB)
const OWNER_KEYS = {
  stats: `history_stats_v${STATS_VERSION}`,
  plays: `history_track_plays_v${PLAYS_VERSION}`,
  listened: `history_listened_albums_v${LISTENED_VERSION}`,
  skip: `history_skip_stats_v${SKIP_VERSION}`,
  detail: `history_track_detail_v${DETAIL_VERSION}`,
  records: `history_records_v${RECORDS_VERSION}`,
};

// Claves para historial local por user (BYOH). No usan TTL porque los subió el
// user a mano — se borran solo cuando pide "borrar mi historial".
const LOCAL_TTL_MIN = 100 * 365 * 24 * 60; // ~100 años

function localKey(uid, kind) {
  return `local_${uid}_history_${kind}`;
}

// Caches en memoria (por sesión de página). Se resetean al cambiar de user.
let memCache = { uid: null, stats: null, plays: null, listened: null, skip: null, detail: null, records: null };

async function ensureFreshMem() {
  const uid = await getCurrentUserId().catch(() => null);
  if (memCache.uid !== uid) memCache = { uid, stats: null, plays: null, listened: null, skip: null, detail: null, records: null };
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

async function loadOne(kind, cacheField, sanityCheck, fetchUrlForOwner) {
  const uid = await ensureFreshMem();
  if (memCache[cacheField]) return memCache[cacheField];

  // 1) local del user (cualquier user — owner o no)
  if (uid) {
    try {
      const cached = await idbGetCached(localKey(uid, kind));
      if (cached && sanityCheck(cached)) { memCache[cacheField] = cached; return cached; }
    } catch { /* ignora */ }
  }

  // 2) cache del owner (histórico) — el resto de los users cae acá si son Ian,
  //    o sale por null si no lo son.
  const owner = uid === HISTORY_OWNER_ID;
  if (!owner) return null;

  try {
    const cached = await idbGetCached(OWNER_KEYS[kind]);
    if (cached && sanityCheck(cached)) { memCache[cacheField] = cached; return cached; }
  } catch { /* ignora */ }

  try {
    const res = await fetch(fetchUrlForOwner());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    memCache[cacheField] = data;
    try { await idbSetCached(OWNER_KEYS[kind], data, 30 * 24 * 60); } catch { /* ignora */ }
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
  return loadOne('plays', 'plays', d => !!d.tracks, () => dataUrl('history-track-plays.json', PLAYS_VERSION));
}
async function loadListenedAlbums() {
  return loadOne('listened', 'listened', d => !!d.years, () => dataUrl('history-listened-albums.json', LISTENED_VERSION));
}
async function loadSkipStats() {
  return loadOne('skip', 'skip', d => !!d.tracks, () => dataUrl('history-skip-stats.json', SKIP_VERSION));
}
async function loadTrackDetail() {
  return loadOne('detail', 'detail', d => !!d.tracks, () => dataUrl('history-track-detail.json', DETAIL_VERSION));
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
  ]);
  // Invalido memoria para que la próxima carga vaya al IDB fresco
  memCache = { uid: null, stats: null, plays: null, listened: null, skip: null, detail: null, records: null };
}

async function clearMyHistory() {
  const uid = await getCurrentUserId().catch(() => null);
  if (!uid) return;
  await Promise.all(['stats', 'plays', 'listened', 'skip', 'detail', 'records'].map(k => idbDel(localKey(uid, k)).catch(() => {})));
  memCache = { uid: null, stats: null, plays: null, listened: null, skip: null, detail: null, records: null };
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
function ownerLockedMessage(featureName = 'esta vista') {
  return `<div class="card"><h3 style="margin-bottom:8px">Historial no disponible</h3>
    <p style="color:var(--color-text-secondary);margin:0 0 14px">
      ${featureName} necesita el <strong>Extended Streaming History</strong>. El del dueño de esta instancia (Ian) queda oculto para el resto — vos podés cargar el tuyo y usar todas las features con tus propios datos.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button class="btn btn-primary btn-sm" data-open-import>Ya tengo mi ZIP — subirlo</button>
      <button class="btn btn-secondary btn-sm" data-open-spotify-privacy>Todavía no lo tengo — abrir Privacidad de Spotify</button>
    </div>
    <p style="color:var(--color-text-muted);font-size:12px;margin:0">
      Cómo conseguirlo: en Privacidad de Spotify, bajá hasta <strong>«Descargar tus datos»</strong>, marcá <strong>Historial de reproducción ampliado</strong>, confirmá y esperá el mail (unos días). Después subís acá el ZIP entero. Todo se procesa <strong>en tu navegador</strong> — nada sale de tu compu.
    </p>
    </div>`;
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
  loadHistoryStats, loadTrackPlays, loadListenedAlbums, loadSkipStats, loadTrackDetail, loadRecords,
  playsFor, trackIdOf, isOwner, HISTORY_OWNER_ID, ownerLockedMessage,
  hasLocalHistory, saveMyHistory, clearMyHistory, bindOwnerLockedButtons,
};
