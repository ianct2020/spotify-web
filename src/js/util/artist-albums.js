// Los álbumes de un artista QUE IAN ESCUCHÓ, sacados del historial.
//
// A propósito NO es la discografía de Spotify: esa sale de `/artists/{id}/albums`,
// que post-migración pagina de a 10 (ver CLAUDE.md) y cuesta una ristra de
// requests por ficha para traer, encima, discos que nunca sonaron. Acá la fuente
// es `history-track-plays.json` (`albums`: todo álbum con al menos una play
// válida), que ya está descargado porque lo usan las stats de la misma ficha.
//
// Las tapas salen de `history-listened-albums.json`, la única fuente que trae
// imagen por álbum. Un disco que nunca llegó al umbral de esa lista aparece sin
// tapa, con el placeholder — no se pide nada a la red para completarlo.

import { albumKey } from './album-key.js';
import { loadTrackPlays, loadListenedAlbums } from '../features/history-data.js';
import { lookupAlbumStats } from './album-stats.js';

let _imgs = null;   // albumKey(name, artist) → url   +   albumKey(name, '') → url

async function buildImgIndex() {
  if (_imgs) return _imgs;
  const idx = new Map();
  try {
    const data = await loadListenedAlbums();
    for (const y of (data?.years || [])) {
      for (const al of (y.albums || [])) {
        if (!al?.img) continue;
        const k = albumKey(al.name, al.artist);
        if (!idx.has(k)) idx.set(k, al.img);
        // Segunda entrada solo por nombre: rescata los colaborativos, que el
        // export acredita a un artista distinto del que abrió la ficha.
        const kn = albumKey(al.name, '');
        if (!idx.has(kn)) idx.set(kn, al.img);
      }
    }
  } catch (e) {
    console.warn('[artist-albums] no pude indexar tapas:', e.message);
  }
  _imgs = idx;
  return _imgs;
}

/**
 * @param {string} nombre nombre exacto del artista (como lo trae el historial)
 * @param {{max?: number}} opts
 * @returns {Promise<Array<{name, artist, img, plays, min, first}>>} ordenados por
 *   plays desc. Vacío si no hay historial.
 */
export async function albumsDeArtista(nombre, { max = 60 } = {}) {
  if (!nombre) return [];
  const buscado = nombre.toLowerCase().trim();
  let data = null;
  try { data = await loadTrackPlays(); } catch { return []; }
  const imgs = await buildImgIndex();

  const vistos = new Set();
  const crudos = [];
  for (const entry of (data?.albums || [])) {
    const [name, artist, plays, ms] = entry;
    if (!name || (artist || '').toLowerCase().trim() !== buscado) continue;
    if (!(plays > 0)) continue;
    const k = albumKey(name, artist);
    if (vistos.has(k)) continue;
    vistos.add(k);
    crudos.push({ name, artist, k, plays, ms: ms || 0 });
  }

  const out = [];
  for (const c of crudos) {
    const img = imgs.get(c.k) || imgs.get(albumKey(c.name, '')) || null;
    // Los totales unificados por tapa: un colaborativo está partido en varias
    // claves y con los crudos mostraría la mitad de sus plays (VULTURES 1).
    const t = await lookupAlbumStats({ name: c.name, artist: c.artist, img });
    out.push({
      name: c.name,
      artist: c.artist,
      img,
      plays: Math.max(t.plays || 0, c.plays),
      min: t.min > 0 ? t.min : c.ms / 60000,
      first: t.first || null,
    });
  }
  out.sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name, 'es'));
  return out.slice(0, max);
}

export function invalidateArtistAlbums() { _imgs = null; }
