import { getValidToken, refreshAccessToken } from './auth.js';
import { cacheGet, cacheSet, cacheClear } from './storage.js';

const BASE = 'https://api.spotify.com/v1';
const MIN_RETRY_WAIT = 5000;
const DEFAULT_MAX_RETRIES = 5;
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
      throw new Error(`Spotify ${response.status}: ${msg}`);
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

let _requestQueue = Promise.resolve();
function throttledFetch(endpoint, options) {
  _requestQueue = _requestQueue.then(() => sleep(100)).then(() => spotifyFetch(endpoint, options));
  return _requestQueue;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function paginateAll(endpoint, { limit = 50, onProgress, partialCacheKey, transform, maxItems, startOffset = 0, signal } = {}) {
  let items = [];
  let offset = startOffset;
  const initialOffset = startOffset;
  let total = Infinity;
  let page = 0;
  const sep = endpoint.includes('?') ? '&' : '?';

  if (partialCacheKey) {
    const partial = cacheGet(partialCacheKey + '_partial');
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
        cacheSet(partialCacheKey + '_partial', { items, offset, startOffset: initialOffset }, 60);
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
        cacheSet(partialCacheKey + '_partial', { items, offset, startOffset: initialOffset }, 60);
        pagesSinceSave = 0;
      }

      if (!data.next) break;
      await sleep(400);
    } catch (e) {
      if (partialCacheKey && items.length > 0) {
        cacheSet(partialCacheKey + '_partial', { items, offset, startOffset: initialOffset }, 60);
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
  const imgs = p.images || [];
  const smallest = imgs.length > 0 ? imgs[imgs.length - 1].url : null;
  return {
    id: p.id,
    name: p.name,
    owner: p.owner ? { id: p.owner.id, display_name: p.owner.display_name } : undefined,
    tracks: p.tracks ? { total: p.tracks.total } : undefined,
    public: p.public,
    collaborative: p.collaborative,
    image: smallest,
  };
}

async function getAllLikedTracks(onProgress, { force = false, signal } = {}) {
  const cacheKey = LIKES_CACHE_KEY;

  if (!force) {
    const cached = cacheGet(cacheKey);
    if (cached) {
      if (onProgress) onProgress({ loaded: cached.length, total: cached.length, page: 1, cached: true });
      return cached;
    }
  } else {
    cacheClear(cacheKey + '_partial');
  }

  const items = await paginateAll('/me/tracks', {
    limit: 50,
    onProgress,
    partialCacheKey: cacheKey,
    transform: item => ({ added_at: item.added_at, track: slimTrack(item.track) }),
    signal,
  });
  cacheSet(cacheKey, items, CACHE_TTL_MIN);
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

function exportLikesData() {
  const cached = cacheGet(LIKES_CACHE_KEY) || [];
  return {
    _format: 'spotify-tools-likes',
    _version: 1,
    _exportedAt: new Date().toISOString(),
    totalAtExport: cached.length,
    items: cached,
  };
}

function exportAllData(spotifyUserId) {
  const likes = cacheGet(LIKES_CACHE_KEY) || [];
  const tagsCache = JSON.parse(localStorage.getItem('lastfm_artist_tags_cache') || '{}');
  return {
    _format: 'spotify-tools-data',
    _version: 1,
    _exportedAt: new Date().toISOString(),
    spotifyUserId: spotifyUserId || null,
    likes: {
      totalAtExport: likes.length,
      items: likes,
    },
    tags: {
      entries: tagsCache,
    },
  };
}

async function importAllData(parsed, onProgress) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido');

  const result = {
    likesImported: 0,
    likesAdded: 0,
    tagsImported: 0,
    tagsUpdated: 0,
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

  return result;
}

async function tryAutoLoadUserBackup(spotifyUserId) {
  if (!spotifyUserId) return { loaded: false };

  const cachedLikes = cacheGet(LIKES_CACHE_KEY);
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

    return { loaded: true, likesCount, tagsCount, delta };
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
  if (onProgress) onProgress({ phase: 'checking', message: 'Chequeando total con Spotify...' });
  const totalNow = await getLikesTotal();
  const delta = totalNow - totalAtExport;

  let finalItems = imported;

  if (delta > 0) {
    if (onProgress) onProgress({ phase: 'fetching', message: `Trayendo ${delta} likes nuevos...`, delta });
    const knownUris = new Set(imported.map(i => i?.track?.uri).filter(Boolean));
    const fetchCount = delta + 20;
    const recent = await getRecentLikes(fetchCount);
    const newOnes = recent.filter(r => r?.track?.uri && !knownUris.has(r.track.uri));
    finalItems = [...newOnes, ...imported];
  }

  cacheSet(LIKES_CACHE_KEY, finalItems, CACHE_TTL_MIN);
  return {
    imported: imported.length,
    added: finalItems.length - imported.length,
    totalNow,
    totalAtExport,
  };
}

function invalidatePlaylistsCache() {
  cacheClear(PLAYLISTS_CACHE_KEY);
}

async function getAllPlaylistItems(playlistId, onProgress) {
  return paginateAll(`/playlists/${playlistId}/items`, {
    limit: 100,
    onProgress,
  });
}

async function getUserProfile() {
  return spotifyFetch('/me');
}

let _cachedUserId = null;
async function getCurrentUserId() {
  if (_cachedUserId) return _cachedUserId;
  const me = await spotifyFetch('/me');
  _cachedUserId = me.id;
  return _cachedUserId;
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

async function unfollowPlaylist(playlistId) {
  await spotifyFetch(`/playlists/${playlistId}/followers`, { method: 'DELETE' });
  invalidatePlaylistsCache();
}

export {
  spotifyFetch,
  paginateAll,
  getAllLikedTracks,
  getAllUserPlaylists,
  getAllPlaylistItems,
  getUserProfile,
  getCurrentUserId,
  addTracksToPlaylist,
  removeTracksFromPlaylist,
  removePlaylistItemsAtPositions,
  removeLikedTracks,
  createPlaylist,
  unfollowPlaylist,
  invalidateLikesCache,
  invalidatePlaylistsCache,
  getLikesTotal,
  exportLikesData,
  importLikesData,
  exportAllData,
  importAllData,
  tryAutoLoadUserBackup,
};
