import { getValidToken, refreshAccessToken } from './auth.js';

const BASE = 'https://api.spotify.com/v1';
const MIN_RETRY_WAIT = 5000;
const DEFAULT_MAX_RETRIES = 3;

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

async function paginateAll(endpoint, { limit = 50, onProgress } = {}) {
  const items = [];
  let url = `${BASE}${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=${limit}`;
  let page = 0;

  while (url) {
    const data = await spotifyFetch(url, { _maxRetries: 5 });
    if (data.items) {
      items.push(...data.items);
    }
    page++;
    if (onProgress) {
      onProgress({ loaded: items.length, total: data.total, page });
    }
    url = data.next;
    if (url) await sleep(250);
  }

  return items;
}

async function getAllLikedTracks(onProgress) {
  return paginateAll('/me/tracks', { limit: 50, onProgress });
}

async function getAllUserPlaylists(onProgress) {
  return paginateAll('/me/playlists', { limit: 50, onProgress });
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
      body: JSON.stringify({ tracks: chunk.map(uri => ({ uri })) }),
    });
  }
}

async function removeLikedTracks(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 40) {
    chunks.push(ids.slice(i, i + 40));
  }
  for (const chunk of chunks) {
    const uris = chunk.map(id => `spotify:track:${id}`).join(',');
    await spotifyFetch(`/me/library?uris=${encodeURIComponent(uris)}`, {
      method: 'DELETE',
    });
  }
}

async function createPlaylist(name, description = '', isPublic = false) {
  return spotifyFetch('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({ name, description, public: isPublic }),
  });
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
};
