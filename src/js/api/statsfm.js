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

export {
  getUsername,
  setUsername,
  clearUsername,
  hasUsername,
  getUserProfile,
  getTopArtists,
};
