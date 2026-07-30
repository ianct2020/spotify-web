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

export {
  getUsername,
  setUsername,
  clearUsername,
  hasUsername,
  getUserProfile,
  getTopArtists,
  findTrackId,
  getTrackCurrentStats,
};
