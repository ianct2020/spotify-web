import { idbGetCached, idbSetCached } from '../idb.js?v=120';

const STATSFM_USER_STORAGE = 'statsfm_username';
const BASE = 'https://api.stats.fm/api/v1';

function getUsername() {
  return localStorage.getItem(STATSFM_USER_STORAGE);
}

function setUsername(u) {
  localStorage.setItem(STATSFM_USER_STORAGE, u.trim());
}

function clearUsername() {
  localStorage.removeItem(STATSFM_USER_STORAGE);
}

function hasUsername() {
  return !!getUsername();
}

function splitGenre(g) {
  return String(g).toLowerCase().split(/\s*[\/,]\s*/).map(s => s.trim()).filter(Boolean);
}

async function getUserProfile(username) {
  const res = await fetch(`${BASE}/users/${encodeURIComponent(username)}`);
  if (!res.ok) throw new Error(`Stats.fm ${res.status}: perfil no encontrado o privado`);
  const data = await res.json();
  return data.item || null;
}

async function getTopArtists(username, { range = 'lifetime', limit = 1000 } = {}) {
  const url = `${BASE}/users/${encodeURIComponent(username)}/top/artists?range=${range}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stats.fm ${res.status}`);
  const data = await res.json();
  const items = data.items || [];
  return items.map(it => ({
    name: it.artist?.name,
    genres: (it.artist?.genres || []).flatMap(splitGenre),
    streams: it.streams || 0,
    playedMs: it.playedMs || 0,
    rank: it.position || 0,
    spotifyId: it.artist?.externalIds?.spotify?.[0] || null,
  })).filter(a => a.name);
}

// ---- Plays actuales por track (2026-07-29) ----
// El Extended Streaming History quedó congelado al día del export; Stats.fm
// sigue trackeando en vivo. Búsqueda elástica → id interno (cacheado) →
// /streams/tracks/{id}/stats con los conteos de HOY. Confirmado que funciona
// SIN Plus (perfil público con historial importado).

const TRACK_ID_CACHE_KEY = 'statsfm_track_ids_v1';
const TRACK_ID_CACHE_MAX = 600;

function normName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadIdCache() {
  try { return JSON.parse(localStorage.getItem(TRACK_ID_CACHE_KEY)) || {}; } catch { return {}; }
}

function saveIdCache(cache) {
  const keys = Object.keys(cache);
  if (keys.length > TRACK_ID_CACHE_MAX) {
    for (const k of keys.slice(0, keys.length - TRACK_ID_CACHE_MAX)) delete cache[k];
  }
  try { localStorage.setItem(TRACK_ID_CACHE_KEY, JSON.stringify(cache)); } catch { /* ignora */ }
}

// Devuelve el id interno de Stats.fm para un track, o null si no lo encuentra.
async function findTrackId(name, artist) {
  const key = `${normName(artist)}|${normName(name)}`;
  const cache = loadIdCache();
  if (key in cache) return cache[key]; // solo hits persistidos
  // Buscar SOLO por nombre y filtrar por artista después: si metés el artista
  // en el query, elastic prioriza covers basura titulados "Tema Artista".
  const q = encodeURIComponent(name);
  const res = await fetch(`${BASE}/search/elastic?query=${q}&type=track&limit=10`);
  if (!res.ok) throw new Error(`Stats.fm ${res.status}`);
  const data = await res.json();
  const tracks = data.items?.tracks || [];
  const na = normName(artist);
  const hit = tracks.find(t => (t.artists || []).some(a => {
    const n = normName(a.name);
    return n === na || n.includes(na) || na.includes(n);
  })) || null;
  if (hit) {
    cache[key] = hit.id;
    saveIdCache(cache);
    return hit.id;
  }
  return null;
}

// Stats actuales del user para un track: { count, durationMs } o null si no hay datos.
async function getTrackCurrentStats(trackId) {
  const u = getUsername();
  if (!u || !trackId) return null;
  const res = await fetch(`${BASE}/users/${encodeURIComponent(u)}/streams/tracks/${trackId}/stats`);
  if (!res.ok) return null;
  const data = await res.json();
  const it = data.items;
  if (!it || typeof it.count !== 'number') return null;
  return { count: it.count, durationMs: it.durationMs || 0 };
}

// ---- Top lifetime cacheado (2026-07-29, Plus) ----
// El endpoint per-track /streams/tracks/{id}/stats NO incluye lo importado
// (limitación del backend, ni con Plus cambia). El único endpoint que sí trae
// TOTALES actuales con el import incluido es /top/tracks?range=lifetime, pero
// tope de limit=1000 (con más da 400). Ergo: bajamos el top-1000 una vez, lo
// cacheamos en IDB por 24h, y armamos un Map<spotifyId, {streams, playedMs, ...}>
// que sirve a Ficha / Skips / Sin plays. Cualquier tema con menos plays que el
// del puesto 1000 no está en el mapa (fallback: per-track live).

const TOP_LIFETIME_KEY = 'statsfm_top_lifetime_v1';
const TOP_LIFETIME_TTL_MIN = 24 * 60;
const TOP_LIFETIME_LIMIT = 1000;

let _topMemCache = null; // { map, meta, generatedAt }

// Devuelve { map: Map<spotifyId, {streams, playedMs, name, artist, statsfmId}>,
//            minStreams, totalItems, generatedAt } — o null si no hay username.
async function loadTopLifetime({ force = false } = {}) {
  const u = getUsername();
  if (!u) return null;
  if (!force && _topMemCache) return _topMemCache;

  if (!force) {
    try {
      const cached = await idbGetCached(TOP_LIFETIME_KEY);
      if (cached && cached.username === u && Array.isArray(cached.entries)) {
        _topMemCache = rehydrate(cached);
        return _topMemCache;
      }
    } catch { /* ignora */ }
  }

  const url = `${BASE}/users/${encodeURIComponent(u)}/top/tracks?range=lifetime&limit=${TOP_LIFETIME_LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stats.fm ${res.status}: no pude cargar el top lifetime`);
  const data = await res.json();
  const items = data.items || [];
  const entries = [];
  for (const it of items) {
    const t = it.track;
    if (!t) continue;
    const spotifyIds = t.externalIds?.spotify || [];
    if (!spotifyIds.length) continue;
    const firstArtist = t.artists?.[0]?.name || '';
    for (const sid of spotifyIds) {
      entries.push({
        sid,
        statsfmId: t.id,
        streams: it.streams || 0,
        playedMs: it.playedMs || 0,
        name: t.name || '',
        artist: firstArtist,
      });
    }
  }
  const generatedAt = Date.now();
  try {
    await idbSetCached(TOP_LIFETIME_KEY, { username: u, entries, generatedAt }, TOP_LIFETIME_TTL_MIN);
  } catch { /* ignora */ }
  _topMemCache = rehydrate({ entries, generatedAt });
  return _topMemCache;
}

function rehydrate({ entries, generatedAt }) {
  const map = new Map();
  let minStreams = Infinity;
  for (const e of entries) {
    // si el mismo spotifyId apareciera en varias entradas (raro), gana la de más streams
    const prev = map.get(e.sid);
    if (!prev || e.streams > prev.streams) map.set(e.sid, e);
    if (e.streams < minStreams) minStreams = e.streams;
  }
  return {
    map,
    minStreams: isFinite(minStreams) ? minStreams : 0,
    totalItems: entries.length,
    generatedAt,
  };
}

function clearTopLifetimeCache() {
  _topMemCache = null;
}

export {
  getUsername,
  setUsername,
  clearUsername,
  hasUsername,
  getUserProfile,
  getTopArtists,
  findTrackId,
  getTrackCurrentStats,
  loadTopLifetime,
  clearTopLifetimeCache,
};
