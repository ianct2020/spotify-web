const LASTFM_KEY_STORAGE = 'lastfm_api_key';
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

export {
  getKey,
  setKey,
  clearKey,
  hasKey,
  lastfmFetch,
  getSimilarArtists,
  getArtistTopTracks,
  getTopArtistsByTag,
};
