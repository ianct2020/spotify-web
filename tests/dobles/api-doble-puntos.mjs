// El doble de `api.js` de siempre (`api-doble.mjs`), con un punto de espera antes y después de cada llamada asíncrona
// (ver `puntos.mjs`). `globalThis.__FALLA_ESCRITURA = { metodo: 'add' | 'remove', n }` hace tirar la n-ésima escritura de
// ese tipo (contando desde que el test pone `cuenta: 0`), como un 5xx de Spotify.

import * as base from './api-doble.mjs';
import { punto } from './puntos.mjs';
export * from './api-doble.mjs';

function envolver(nombre, fn) {
  return async (...args) => {
    await punto(nombre, 'antes');
    const r = await fn(...args);
    await punto(nombre, 'despues');
    return r;
  };
}
function fallaSiToca(metodo) {
  const f = globalThis.__FALLA_ESCRITURA;
  if (!f) return;
  f.cuenta = (f.cuenta || 0) + (f.metodo === metodo ? 1 : 0);
  if (f.metodo === metodo && f.cuenta === f.n) throw new Error('Spotify 502: falla a propósito (doble)');
}

export const getCurrentUserId = envolver('getCurrentUserId', base.getCurrentUserId);
export const spotifyFetch = envolver('spotifyFetch', base.spotifyFetch);
export const getAllUserPlaylists = envolver('getAllUserPlaylists', base.getAllUserPlaylists);
export const getAllPlaylistItems = envolver('getAllPlaylistItems', base.getAllPlaylistItems);
export const createPlaylist = envolver('createPlaylist', base.createPlaylist);
export const addTracksToPlaylist = envolver('addTracksToPlaylist', async (...a) => { fallaSiToca('add'); return base.addTracksToPlaylist(...a); });
export const removeTracksFromPlaylist = envolver('removeTracksFromPlaylist', async (...a) => { fallaSiToca('remove'); return base.removeTracksFromPlaylist(...a); });
