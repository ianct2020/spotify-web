// Índice canónico de "álbumes escuchados" para #discover-artists y #new-releases.
//
// Un álbum cuenta como ESCUCHADO si se cumple CUALQUIERA de estas:
//   1. alguna de sus pistas apareció en el historial completo de plays
//      (history-track-plays.json v=3, campo `albums`).
//   2. alguna de sus pistas está en tus likes (album de cada like).
//   3. el álbum está en history-listened-albums.json (umbral samestay met).
//   4. el álbum está en la playlist W-Three (por track).
//
// El bug que arregla esta capa: antes solo se cruzaba contra (3), que es un
// subset (álbumes que en un mismo día tuvieron ≥4 tracks distintos o ≥25 min).
// Por eso a Ian le aparecían como "sin escuchar" álbumes que sí había tocado.
//
// Todas las claves pasan por `albumKey()` (util/album-key.js) — normalizado
// con strip diacríticos + sufijos de edición.

import { albumKey } from './album-key.js?v=150';
import { loadTrackPlays, loadListenedAlbums, isOwner } from '../features/history-data.js?v=150';
import { getBestAvailableLikes, getAllPlaylistItems } from '../api.js?v=150';
import { coverUrl } from './cover-size.js?v=150';

const LS_WTHREE_ID = 'wthree_playlist_id';

// Caché en memoria — la sesión de página no cambia estos sets.
let cache = null;

export async function buildAlbumHeardIndex({ force = false } = {}) {
  if (cache && !force) return cache;

  const heard = new Set();
  const likedIds = new Set();
  const likesByArtist = new Map();       // artistNameLower -> Set<track.id>
  const artistDisplay = new Map();       // artistNameLower -> display name
  const artistImage = new Map();         // artistNameLower -> url album approx
  const artistIds = new Map();           // artistNameLower -> spotify artist id

  // 1) Likes: fuente autoritativa, no depende de owner-guard.
  let likes = [];
  try {
    const res = await getBestAvailableLikes();
    likes = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
  } catch { /* seguimos con lo que tengamos */ }

  for (const it of likes) {
    const t = it?.track || it;
    if (!t) continue;
    if (t.id) likedIds.add(t.id);
    const a0 = t.artists?.[0];
    const artistName = a0?.name || '';
    const nameLower = artistName.toLowerCase().trim();
    const albName = t.album?.name || '';
    if (albName && artistName) heard.add(albumKey(albName, artistName));
    if (nameLower) {
      let s = likesByArtist.get(nameLower);
      if (!s) { s = new Set(); likesByArtist.set(nameLower, s); }
      if (t.id) s.add(t.id);
      if (!artistDisplay.has(nameLower)) artistDisplay.set(nameLower, artistName);
      if (a0?.id && !artistIds.has(nameLower)) artistIds.set(nameLower, a0.id);
      if (!artistImage.get(nameLower)) {
        artistImage.set(nameLower, coverUrl(t.album?.images, 'grande'));
      }
    }
  }

  // 2) Historial completo de plays (solo owner o BYOH).
  try {
    if (await isOwner() || true /* BYOH también */) {
      const plays = await loadTrackPlays();
      if (plays && Array.isArray(plays.albums)) {
        for (const [name, artist] of plays.albums) {
          if (name || artist) heard.add(albumKey(name, artist));
        }
      }
    }
  } catch { /* ignora */ }

  // 3) history-listened-albums.json (umbral).
  try {
    const data = await loadListenedAlbums();
    if (data?.years) {
      for (const y of data.years) {
        for (const al of (y.albums || [])) heard.add(albumKey(al.name, al.artist));
      }
    }
  } catch { /* ignora */ }

  // 4) Playlist W-Three: cada track expresa un álbum escuchado.
  try {
    const wid = localStorage.getItem(LS_WTHREE_ID);
    if (wid) {
      const items = await getAllPlaylistItems(wid);
      for (const it of (items || [])) {
        const t = it?.item || it?.track;
        if (!t) continue;
        const albName = t.album?.name || '';
        const artistName = t.artists?.[0]?.name || '';
        if (albName && artistName) heard.add(albumKey(albName, artistName));
      }
    }
  } catch { /* ignora */ }

  cache = {
    heard,
    likedIds,
    likesByArtist,
    artistDisplay,
    artistImage,
    artistIds,
  };
  return cache;
}

export function invalidateAlbumHeardIndex() {
  cache = null;
}

// Acá vivía `markAlbumHeard(name, artist)`, que marcaba el álbum SOLO en el
// índice en memoria: la tarjeta desaparecía y volvía en la siguiente sesión.
// Lo que persiste es el store `heardAlbums` de `features/discover-common.js`
// (localStorage), y por eso el que se usa hoy es `markAlbumResolved()`.
