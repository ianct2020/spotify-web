import { getValidToken, refreshAccessToken } from './auth.js?v=54';
import { cacheGet, cacheGetRaw, cacheGetTimestamp, cacheSet, cacheClear } from './storage.js?v=54';
import { idbGet, idbSet, idbDel, idbGetCached, idbGetCachedRaw, idbGetTimestamp, idbSetCached, idbAvailable } from './idb.js?v=54';
import { showToast } from './ui/toast.js?v=54';

const BASE = 'https://api.spotify.com/v1';
const MIN_RETRY_WAIT = 5000;
const DEFAULT_MAX_RETRIES = 5;
const LIKES_CACHE_KEY = 'all_liked_tracks';
const PLAYLISTS_CACHE_KEY = 'all_user_playlists';
const CACHE_TTL_MIN = 60 * 24;

async function spotifyFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const maxRetries = options._maxRetries ?? DEFAULT_MAX_RETRIES;

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
    } catch (netErr) {
      // Error de red sin respuesta HTTP: "Failed to fetch", conexión cortada,
      // rate-limit enmascarado como CORS, etc. Reintentamos con backoff.
      networkRetries++;
      if (networkRetries > maxRetries) {
        throw new Error(`No se pudo conectar con Spotify (${netErr.message}). Revisá tu conexión y reintentá.`);
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

const LIKES_PARTIAL_KEY = LIKES_CACHE_KEY + '_partial';

async function savePartial(key, payload) {
  if (key === LIKES_CACHE_KEY || key === LIKES_PARTIAL_KEY) {
    try { await idbSetCached(LIKES_PARTIAL_KEY, payload, 24 * 60); } catch (e) { console.warn('savePartial IDB:', e); }
  } else {
    cacheSet(key + '_partial', payload, 60);
  }
}

async function loadPartial(key) {
  if (key === LIKES_CACHE_KEY || key === LIKES_PARTIAL_KEY) {
    try { return await idbGetCached(LIKES_PARTIAL_KEY); } catch { return null; }
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

async function paginateAll(endpoint, { limit = 50, onProgress, partialCacheKey, transform, maxItems, startOffset = 0, signal } = {}) {
  let items = [];
  let offset = startOffset;
  const initialOffset = startOffset;
  let total = Infinity;
  let page = 0;
  const sep = endpoint.includes('?') ? '&' : '?';

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

      if (!data.next) break;
      await sleep(600);
    } catch (e) {
      if (partialCacheKey && items.length > 0) {
        await savePartial(partialCacheKey, { items, offset, startOffset: initialOffset });
        console.warn(`Saved partial progress: ${items.length} items at offset ${offset}`);
      }
      throw e;
    }
  }

  if (partialCacheKey) {
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

async function migrateLikesFromLocalStorage() {
  const legacy = cacheGetRaw(LIKES_CACHE_KEY);
  if (Array.isArray(legacy) && legacy.length > 0) {
    try {
      await idbSetCached(LIKES_CACHE_KEY, legacy, CACHE_TTL_MIN);
      cacheClear(LIKES_CACHE_KEY);
      console.log(`Migrated ${legacy.length} likes from localStorage to IndexedDB`);
    } catch (e) {
      console.warn('Migration failed:', e);
    }
  }
  const legacyPartial = cacheGetRaw(LIKES_CACHE_KEY + '_partial');
  if (legacyPartial && legacyPartial.items?.length > 0) {
    try {
      await idbSetCached(LIKES_PARTIAL_KEY, legacyPartial, CACHE_TTL_MIN);
      cacheClear(LIKES_CACHE_KEY + '_partial');
    } catch (e) {
      console.warn('Partial migration failed:', e);
    }
  }
}

async function saveLikes(items) {
  try {
    await idbSetCached(LIKES_CACHE_KEY, items, CACHE_TTL_MIN);
    return { ok: true };
  } catch (e) {
    console.error('IDB saveLikes failed:', e);
    showToast(`Error guardando ${items.length.toLocaleString()} likes en el navegador: ${e.message}. Exportá el JSON YA para no perderlos.`, 'error');
    return { ok: false, error: e };
  }
}

async function getAllLikedTracks(onProgress, { force = false, signal } = {}) {
  await migrateLikesFromLocalStorage();

  if (!force) {
    const cached = await idbGetCached(LIKES_CACHE_KEY);
    if (cached && Array.isArray(cached)) {
      if (onProgress) onProgress({ loaded: cached.length, total: cached.length, page: 1, cached: true });
      return cached;
    }
  } else {
    await clearPartial(LIKES_CACHE_KEY);
  }

  const items = await paginateAll('/me/tracks', {
    limit: 50,
    onProgress,
    partialCacheKey: LIKES_CACHE_KEY,
    transform: item => ({ added_at: item.added_at, track: slimTrack(item.track) }),
    signal,
  });
  await saveLikes(items);
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
  idbDel(LIKES_CACHE_KEY).catch(() => {});
  idbDel(LIKES_PARTIAL_KEY).catch(() => {});
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
  const cached = await idbGetCached(LIKES_CACHE_KEY);
  if (!cached || cached.length === 0) {
    return { hadCache: false };
  }

  if (onProgress) onProgress({ phase: 'checking', message: 'Chequeando total con Spotify (1 request)...' });
  const totalNow = await getLikesTotal();
  const delta = totalNow - cached.length;

  if (delta <= 0) {
    return { hadCache: true, added: 0, totalNow, cachedCount: cached.length };
  }

  if (onProgress) onProgress({ phase: 'fetching', message: `Trayendo ${delta} likes nuevos...`, delta });
  const knownUris = new Set(cached.map(i => i?.track?.uri).filter(Boolean));
  const recent = await getRecentLikes(delta + 20);
  const newOnes = recent.filter(r => r?.track?.uri && !knownUris.has(r.track.uri));
  const finalItems = [...newOnes, ...cached];
  await saveLikes(finalItems);
  return { hadCache: true, added: newOnes.length, totalNow, cachedCount: finalItems.length };
}

async function getBestAvailableLikes() {
  await migrateLikesFromLocalStorage();
  const full = await idbGetCachedRaw(LIKES_CACHE_KEY);
  if (Array.isArray(full) && full.length > 0) {
    return { items: full, source: 'full' };
  }
  const partial = await idbGetCachedRaw(LIKES_PARTIAL_KEY);
  if (partial && Array.isArray(partial.items) && partial.items.length > 0) {
    return { items: partial.items, source: 'partial' };
  }
  const legacyFull = cacheGetRaw(LIKES_CACHE_KEY);
  if (Array.isArray(legacyFull) && legacyFull.length > 0) {
    return { items: legacyFull, source: 'full' };
  }
  const legacyPartial = cacheGetRaw(LIKES_CACHE_KEY + '_partial');
  if (legacyPartial && Array.isArray(legacyPartial.items) && legacyPartial.items.length > 0) {
    return { items: legacyPartial.items, source: 'partial' };
  }
  return { items: [], source: 'empty' };
}

async function getLikesCacheTimestamp() {
  const ts = await idbGetTimestamp(LIKES_CACHE_KEY);
  if (ts) return ts;
  const tsPartial = await idbGetTimestamp(LIKES_PARTIAL_KEY);
  if (tsPartial) return tsPartial;
  return cacheGetTimestamp(LIKES_CACHE_KEY) || cacheGetTimestamp(LIKES_CACHE_KEY + '_partial');
}

async function exportLikesData() {
  const { items } = await getBestAvailableLikes();
  return {
    _format: 'spotify-tools-likes',
    _version: 1,
    _exportedAt: new Date().toISOString(),
    totalAtExport: items.length,
    items,
  };
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

function readLocalConfig() {
  const cfg = {};
  for (const k of CONFIG_LOCAL_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) cfg[k] = v;
  }
  return cfg;
}

function applyLocalConfig(cfg, { overwrite = false } = {}) {
  if (!cfg || typeof cfg !== 'object') return 0;
  let applied = 0;
  for (const k of CONFIG_LOCAL_KEYS) {
    if (cfg[k] == null) continue;
    if (overwrite || localStorage.getItem(k) == null) {
      localStorage.setItem(k, String(cfg[k]));
      applied++;
    }
  }
  return applied;
}

async function exportAllData(spotifyUserId) {
  const { items: likes, source } = await getBestAvailableLikes();
  const tagsCache = JSON.parse(localStorage.getItem('lastfm_artist_tags_cache') || '{}');
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

async function importAllData(parsed, onProgress, { currentUserId = null } = {}) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Archivo inválido');

  const result = {
    likesImported: 0,
    likesAdded: 0,
    tagsImported: 0,
    tagsUpdated: 0,
    configApplied: 0,
    configSkipped: false,
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

async function tryAutoLoadUserBackup(spotifyUserId) {
  if (!spotifyUserId) return { loaded: false };
  await migrateLikesFromLocalStorage();

  const cachedLikes = await idbGetCached(LIKES_CACHE_KEY);
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

    let configApplied = 0;
    if (parsed._config && typeof parsed._config === 'object' && parsed.spotifyUserId === spotifyUserId) {
      configApplied = applyLocalConfig(parsed._config, { overwrite: false });
    }

    return { loaded: true, likesCount, tagsCount, delta, configApplied };
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

  if (imported.length === 0) {
    if (onProgress) onProgress({ phase: 'empty', message: 'El archivo está vacío' });
    return { imported: 0, added: 0, totalNow: null, totalAtExport, empty: true };
  }

  if (onProgress) onProgress({ phase: 'checking', message: 'Chequeando total con Spotify (1 request)...' });
  const totalNow = await getLikesTotal();
  const delta = totalNow - totalAtExport;

  let finalItems = imported;

  if (delta > 0) {
    if (delta > 1000) {
      if (onProgress) onProgress({ phase: 'skip-big', message: `El archivo tiene ${imported.length} likes pero Spotify tiene ${totalNow} (delta ${delta}). Se importa solo lo del archivo. Para sincronizar todo usá "Actualizar datos".` });
    } else {
      if (onProgress) onProgress({ phase: 'fetching', message: `Trayendo ${delta} likes nuevos...`, delta });
      const knownUris = new Set(imported.map(i => i?.track?.uri).filter(Boolean));
      const fetchCount = delta + 20;
      const recent = await getRecentLikes(fetchCount);
      const newOnes = recent.filter(r => r?.track?.uri && !knownUris.has(r.track.uri));
      finalItems = [...newOnes, ...imported];
    }
  }

  await saveLikes(finalItems);
  return {
    imported: imported.length,
    added: finalItems.length - imported.length,
    totalNow,
    totalAtExport,
    skippedBigDelta: delta > 1000,
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
  syncLikesIncremental,
  exportLikesData,
  importLikesData,
  exportAllData,
  importAllData,
  tryAutoLoadUserBackup,
  getBestAvailableLikes,
  getLikesCacheTimestamp,
  readLocalConfig,
  applyLocalConfig,
  CONFIG_LOCAL_KEYS,
};
