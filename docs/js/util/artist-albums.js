// Los álbumes de un artista QUE IAN ESCUCHÓ, sacados del historial.
//
// A propósito NO es la discografía de Spotify: esa sale de `/artists/{id}/albums`,
// que post-migración pagina de a 10 (ver CLAUDE.md) y cuesta una ristra de
// requests por ficha para traer, encima, discos que nunca sonaron. Acá la fuente
// es `history-track-plays.json` (`albums`: todo álbum con al menos una play
// válida), que ya está descargado porque lo usan las stats de la misma ficha.
//
// Las tapas salen de DOS fuentes locales, en este orden:
//   1. `history-listened-albums.json`, la única del historial que trae imagen.
//   2. El cache de likes, que trae `album.images` en cada track. Hace falta
//      porque la primera solo cubre los discos que alguna vez cumplieron el
//      umbral de «escuchado» (4 pistas o 25 min el mismo día): los SINGLES no
//      lo cumplen nunca y quedaban todos con el placeholder ♪ (2 de los 7 de
//      «¥$», medido en producción).
// Ninguna de las dos pide nada a la red: las dos ya están en el navegador.

import { albumKey } from './album-key.js?v=207';
import { loadTrackPlays, loadListenedAlbums } from '../features/history-data.js?v=207';
import { lookupAlbumStats } from './album-stats.js?v=207';
import { getBestAvailableLikes } from '../api.js?v=207';
import { coverUrl } from './cover-size.js?v=207';

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
  try {
    const res = await getBestAvailableLikes();
    const likes = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
    for (const it of likes) {
      const t = it?.track || it;
      const alb = t?.album;
      if (!alb?.name) continue;
      const img = coverUrl(alb.images, 'grande');
      if (!img) continue;
      const k = albumKey(alb.name, t.artists?.[0]?.name || '');
      if (!idx.has(k)) idx.set(k, img);
      const kn = albumKey(alb.name, '');
      if (!idx.has(kn)) idx.set(kn, img);
    }
  } catch (e) {
    console.warn('[artist-albums] sin tapas de likes:', e.message);
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
