import { getValidToken, refreshAccessToken } from './auth.js';
import { cacheGet, cacheSet, cacheClear } from './storage.js';

const BASE = 'https://api.spotify.com/v1';
const MIN_RETRY_WAIT = 5000;
const DEFAULT_MAX_RETRIES = 3;
const LIKES_CACHE_KEY = 'all_liked_tracks';
const PLAYLISTS_CACHE_KEY = 'all_user_playlists';
const CACHE_TTL_MIN = 60;

async function spotifyFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const maxRetries = options._maxRetries ?? DEFAULT_MAX_RETRIES;

  let rateLimitRetries = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const token = await getValidToken();

    const headers = {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    };
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, { ...options, headers });

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
        throw new Error(`Rate limited después de ${maxRetries} reintentos. Esperá unos minutos y recargá.`);
      }
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSecs = parseInt(retryAfterHeader || '5');
      const wait = Math.max(MIN_RETRY_WAIT, retryAfterSecs * 1000);
      console.warn(`429 rate limited, waiting ${(wait / 1000).toFixed(0)}s (retry ${rateLimitRetries}/${maxRetries}, Retry-After: ${retryAfterHeader})`);
      await sleep(wait);
      continue;
    }

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      let msg;
      try {
        const json = JSON.parse(text);
        msg = json.error?.message || text;
      } catch {
        msg = text;
      }
      console.error(`Spotify ${response.status} on ${endpoint}:`, text);
      throw new Error(`Spotify ${response.status}: ${msg}`);
    }

    return response.json();
  }

  throw new Error('Request falló después de reintentos');
}

let _requestQueue = Promise.resolve();
function throttledFetch(endpoint, options) {
  _requestQueue = _requestQueue.then(() => sleep(100)).then(() => spotifyFetch(endpoint, options));
  return _requestQueue;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function paginateAll(endpoint, { limit = 50, onProgress, partialCacheKey, transform } = {}) {
  let items = [];
  let offset = 0;
  let total = Infinity;
  let page = 0;
  const sep = endpoint.includes('?') ? '&' : '?';

  if (partialCacheKey) {
    const partial = cacheGet(partialCacheKey + '_partial');
    if (partial && partial.items) {
      items = partial.items;
      offset = partial.offset;
      console.log(`Resuming from offset ${offset} (${items.length} items already cached)`);
    }
  }

  let pagesSinceSave = 0;
  while (offset < total) {
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
        cacheSet(partialCacheKey + '_partial', { items, offset }, 60);
        pagesSinceSave = 0;
      }

      if (!data.next) break;
      await sleep(400);
    } catch (e) {
      if (partialCacheKey && items.length > 0) {
        cacheSet(partialCacheKey + '_partial', { items, offset }, 60);
        console.warn(`Saved partial progress: ${items.length} items at offset ${offset}`);
      }
      throw e;
    }
  }

  if (partialCacheKey) {
    cacheClear(partialCacheKey + '_partial');
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
    external_ids: t.external_ids ? { isrc: t.external_ids.isrc } : undefined,
    artists: (t.artists || []).map(a => ({ id: a.id, name: a.name })),
    album: t.album ? {
      id: t.album.id,
      name: t.album.name,
      release_date: t.album.release_date,
      images: (t.album.images || []).slice(-1),
    } : undefined,
  };
}

function slimPlaylist(p) {
  if (!p) return p;
  return {
    id: p.id,
    name: p.name,
    owner: p.owner ? { id: p.owner.id, display_name: p.owner.display_name } : undefined,
    tracks: p.tracks ? { total: p.tracks.total } : undefined,
    public: p.public,
    collaborative: p.collaborative,
  };
}

async function getAllLikedTracks(onProgress, { force = false } = {}) {
  if (!force) {
    const cached = cacheGet(LIKES_CACHE_KEY);
    if (cached) {
      if (onProgress) onProgress({ loaded: cached.length, total: cached.length, page: 1, cached: true });
      return cached;
    }
  }
  if (force) cacheClear(LIKES_CACHE_KEY + '_partial');
  const items = await paginateAll('/me/tracks', {
    limit: 50,
    onProgress,
    partialCacheKey: LIKES_CACHE_KEY,
    transform: item => ({ added_at: item.added_at, track: slimTrack(item.track) }),
  });
  cacheSet(LIKES_CACHE_KEY, items, CACHE_TTL_MIN);
  return items;
}

async function getAllUserPlaylists(onProgress, { force = false } = {}) {
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
  });
  cacheSet(PLAYLISTS_CACHE_KEY, items, CACHE_TTL_MIN);
  return items;
}

function invalidateLikesCache() {
  cacheClear(LIKES_CACHE_KEY);
}

function invalidatePlaylistsCache() {
  cacheClear(PLAYLISTS_CACHE_KEY);
}

async function getAllPlaylistItems(playlistId, onProgress) {
  return paginateAll(`/playlists/${playlistId}/items`, { limit: 100, onProgress });
}

async function getUserProfile() {
  return spotifyFetch('/me');
}

async function addTracksToPlaylist(playlistId, uris) {
  const chunks = [];
  for (let i = 0; i < uris.length; i += 100) {
    chunks.push(uris.slice(i, i + 100));
  }
  for (const chunk of chunks) {
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: chunk }),
    });
  }
}

async function removeTracksFromPlaylist(playlistId, uris) {
  const chunks = [];
  for (let i = 0; i < uris.length; i += 100) {
    chunks.push(uris.slice(i, i + 100));
  }
  for (const chunk of chunks) {
    await spotifyFetch(`/playlists/${playlistId}/items`, {
      method: 'DELETE',
      body: JSON.stringify({ items: chunk.map(uri => ({ uri })) }),
    });
  }
}

async function removeLikedTracks(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 40) {
    chunks.push(ids.slice(i, i + 40));
  }
  for (const chunk of chunks) {
    const uris = chunk.map(id => encodeURIComponent(`spotify:track:${id}`)).join(',');
    await spotifyFetch(`/me/library?uris=${uris}`, {
      method: 'DELETE',
    });
  }
  invalidateLikesCache();
}

async function createPlaylist(name, description = '', isPublic = false) {
  const result = await spotifyFetch('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description, public: isPublic }),
  });
  invalidatePlaylistsCache();
  return result;
}

export {
  spotifyFetch,
  paginateAll,
  getAllLikedTracks,
  getAllUserPlaylists,
  getAllPlaylistItems,
  getUserProfile,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  removeLikedTracks,
  createPlaylist,
  invalidateLikesCache,
  invalidatePlaylistsCache,
};
