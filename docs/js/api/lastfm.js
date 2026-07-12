const LASTFM_KEY_STORAGE = 'lastfm_api_key';
const LASTFM_USER_STORAGE = 'lastfm_username';
const BASE = 'https://ws.audioscrobbler.com/2.0/';

function getKey() {
  return localStorage.getItem(LASTFM_KEY_STORAGE);
}

function setKey(k) {
  localStorage.setItem(LASTFM_KEY_STORAGE, k.trim());
}

function clearKey() {
  localStorage.removeItem(LASTFM_KEY_STORAGE);
}

function hasKey() {
  return !!getKey();
}

function getUsername() {
  return localStorage.getItem(LASTFM_USER_STORAGE);
}

function setUsername(u) {
  localStorage.setItem(LASTFM_USER_STORAGE, u.trim());
}

function hasUsername() {
  return !!getUsername();
}

async function lastfmFetch(method, params = {}) {
  const key = getKey();
  if (!key) throw new Error('Last.fm API key no configurada');
  const qs = new URLSearchParams({
    method,
    api_key: key,
    format: 'json',
    ...params,
  });
  const res = await fetch(`${BASE}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(`Last.fm ${data.error}: ${data.message}`);
  if (!res.ok) throw new Error(`Last.fm ${res.status}`);
  return data;
}

async function getSimilarArtists(artistName, limit = 50) {
  const data = await lastfmFetch('artist.getsimilar', { artist: artistName, limit });
  const list = data.similarartists?.artist || [];
  return list.map(a => ({
    name: a.name,
    match: parseFloat(a.match) || 0,
    mbid: a.mbid,
    url: a.url,
    image: (a.image || []).find(i => i.size === 'medium')?.['#text'] || null,
  }));
}

async function getArtistTopTracks(artistName, limit = 20) {
  const data = await lastfmFetch('artist.gettoptracks', { artist: artistName, limit });
  const list = data.toptracks?.track || [];
  return list.map(t => ({
    name: t.name,
    artist: t.artist?.name || artistName,
    playcount: parseInt(t.playcount) || 0,
    listeners: parseInt(t.listeners) || 0,
  }));
}

async function getTopArtistsByTag(tag, limit = 50) {
  const data = await lastfmFetch('tag.gettopartists', { tag, limit });
  const list = data.topartists?.artist || [];
  return list.map(a => ({
    name: a.name,
    mbid: a.mbid,
    url: a.url,
    image: (a.image || []).find(i => i.size === 'medium')?.['#text'] || null,
  }));
}

async function getArtistTopTags(artistName) {
  const data = await lastfmFetch('artist.gettoptags', { artist: artistName, autocorrect: 1 });
  const list = data.toptags?.tag || [];
  return list
    .map(t => ({ name: (t.name || '').toLowerCase(), count: parseInt(t.count) || 0 }))
    .filter(t => t.name && t.count >= 5);
}

async function getSimilarTags(tag) {
  const data = await lastfmFetch('tag.getsimilar', { tag });
  const list = data.similartags?.tag || [];
  return list.map(t => ({ name: t.name, url: t.url }));
}

async function getUserTopArtists(username, period = '6month', limit = 30) {
  const data = await lastfmFetch('user.gettopartists', { user: username, period, limit });
  const list = data.topartists?.artist || [];
  return list.map(a => ({
    name: a.name,
    playcount: parseInt(a.playcount) || 0,
    rank: parseInt(a['@attr']?.rank) || 0,
  }));
}

const TAGS_CACHE_KEY = 'lastfm_artist_tags_cache';
const TAGS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function loadTagsCache() {
  try {
    return JSON.parse(localStorage.getItem(TAGS_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveTagsCache(cache) {
  try {
    localStorage.setItem(TAGS_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('No se pudo guardar cache de tags:', e.message);
  }
}

function getCachedTags(artistName) {
  const cache = loadTagsCache();
  const key = artistName.toLowerCase();
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.at > TAGS_CACHE_TTL_MS) return null;
  return entry.tags;
}

function setCachedTags(artistName, tags) {
  const cache = loadTagsCache();
  cache[artistName.toLowerCase()] = { tags, at: Date.now() };
  saveTagsCache(cache);
}

function exportTagsCache() {
  const cache = loadTagsCache();
  return {
    _format: 'spotify-tools-genres',
    _version: 1,
    _exportedAt: new Date().toISOString(),
    entries: cache,
  };
}

function importTagsCache(parsed, { mode = 'merge' } = {}) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido: no es JSON.');
  const entries = parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : parsed;
  const incoming = Object.entries(entries).filter(([k, v]) =>
    typeof k === 'string' && v && Array.isArray(v.tags)
  );
  if (incoming.length === 0) throw new Error('No se encontraron entradas válidas en el archivo.');

  const current = mode === 'replace' ? {} : loadTagsCache();
  let added = 0;
  let updated = 0;
  const now = Date.now();
  for (const [key, entry] of incoming) {
    const at = typeof entry.at === 'number' ? entry.at : now;
    const tags = entry.tags.filter(t => t && typeof t.name === 'string');
    if (current[key]) updated++;
    else added++;
    current[key] = { tags, at };
  }
  saveTagsCache(current);
  return { added, updated, total: incoming.length };
}

export {
  getKey,
  setKey,
  clearKey,
  hasKey,
  getUsername,
  setUsername,
  hasUsername,
  lastfmFetch,
  getSimilarArtists,
  getArtistTopTracks,
  getTopArtistsByTag,
  getArtistTopTags,
  getSimilarTags,
  getUserTopArtists,
  getCachedTags,
  setCachedTags,
  exportTagsCache,
  importTagsCache,
};
