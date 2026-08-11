// Añadir pistas a VARIAS playlists de una vez, compartido por #sin-clasificar,
// #new-releases y #discover-artists.
//
// Reglas:
//   - un solo POST por playlist elegida (addTracksToPlaylist ya trocea de a 100
//     si hacen falta varias llamadas para la misma playlist);
//   - si una playlist falla, las demás siguen: el resultado dice a cuáles se
//     añadió y cuáles fallaron;
//   - el caché de items de cada playlist se parchea en el sitio cuando se puede,
//     para que el próximo escaneo de #sin-clasificar no la re-descargue entera.

import {
  getAllUserPlaylists, getCurrentUserId,
  addTracksToPlaylist, updatePlaylistItemsCache,
} from '../api.js';
import { idbGetCached } from '../idb.js';
import { showToast } from '../ui/toast.js';

// Playlists propias (las ajenas no se pueden escribir). Se memoiza en el módulo
// porque las tres vistas piden lo mismo y getAllUserPlaylists ya cachea aparte.
let _own = null;
export async function getOwnPlaylists({ force = false } = {}) {
  if (_own && !force) return _own;
  const [me, todas] = await Promise.all([
    getCurrentUserId(),
    getAllUserPlaylists(null, { force }),
  ]);
  _own = todas.filter(p => p.owner?.id === me);
  return _own;
}

export function invalidateOwnPlaylists() { _own = null; }

async function patchItemsCache(playlistId, snapshot, appendItems) {
  try {
    if (snapshot && appendItems && appendItems.length) {
      const cached = await idbGetCached(`playlist_items_${playlistId}`);
      if (cached && Array.isArray(cached.items)) {
        for (const it of appendItems) cached.items.push({ item: it });
        await updatePlaylistItemsCache(playlistId, cached.items, snapshot);
        return;
      }
    }
  } catch { /* caemos a invalidar */ }
  await updatePlaylistItemsCache(playlistId, null, null);
}

// Devuelve { ok: [playlist], failed: [{ playlist, message }] }.
export async function addUrisToPlaylists(uris, playlists, { appendItems = null } = {}) {
  const limpias = [...new Set((uris || []).filter(Boolean))];
  if (!limpias.length) throw new Error('no hay ninguna pista con URI de Spotify');

  const ok = [];
  const failed = [];
  for (const pl of playlists) {
    try {
      const snapshot = await addTracksToPlaylist(pl.id, limpias);
      await patchItemsCache(pl.id, snapshot, appendItems);
      ok.push(pl);
    } catch (e) {
      console.warn(`[playlist-add] «${pl.name}»:`, e.message);
      failed.push({ playlist: pl, message: e.message });
    }
  }
  return { ok, failed };
}

export function listaNombres(nombres) {
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return nombres[0];
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// `what` es el sujeto ya compuesto: «CANNIBALISM!», «3 canciones», «12 pistas de
// "Donda"». `plural` decide entre "se añadió" y "se añadieron".
export function toastAddResult({ ok, failed }, { what, plural = false } = {}) {
  const verbo = plural ? 'se añadieron' : 'se añadió';
  if (!ok.length) {
    const detalle = failed[0]?.message ? ` (${failed[0].message})` : '';
    showToast(`${what}: no se pudo añadir a ninguna playlist${detalle}`, 'error');
    return;
  }
  const destino = listaNombres(ok.map(p => p.name));
  if (!failed.length) {
    showToast(`${what} ${verbo} a ${destino}`, 'success');
    return;
  }
  const fallidas = listaNombres(failed.map(f => f.playlist.name));
  showToast(`${what} ${verbo} a ${destino}. Falló en ${fallidas}: ${failed[0].message}`, 'warning');
}
