// Plays y minutos REALES por álbum, desde el historial completo.
//
// Por qué existe (v=140). La ficha de álbum de `#covers` mostraba
// «20m tiempo escuchado · 0 plays» para VULTURES 1. Dos cosas distintas
// estaban mal:
//
//   1. `covers.js` pasaba `plays: 0` fijo. No había ningún índice de plays por
//      álbum, así que el número era literalmente una constante.
//   2. Los minutos salían de sumar los `min_that_day` de
//      `history-listened-albums.json`, que son los del PRIMER día que el álbum
//      cumplió el umbral (4 pistas o 25 min el mismo día) — no el total
//      escuchado nunca. Sumarlos entre entradas no da nada que se pueda leer.
//
// Y encima el álbum estaba partido: el export acredita cada play al artista
// principal del TRACK que sonó, así que un disco colaborativo entra con varias
// claves. VULTURES 1 aparece como «¥$» (109 plays / 271 min) y como
// «Kanye West» (39 plays / 102 min): 148 plays y 6h 13m de verdad.
//
// El mosaico ya junta esas dos entradas por `coverId()` (identidad real de la
// tapa). Este índice devuelve los números por `albumKey()` y quien lo use suma
// las claves que el dedup por tapa haya unido — que es lo que hace `covers.js`.
//
// Lo que NO se hace, a propósito: normalizar más agresivamente los nombres de
// álbum. Eso fusiona American Football LP3/LP4, Crystal Castles I/II y Ed
// Sheeran `-` vs `÷`. Está decidido desde v=127.

import { albumKey, coverId } from './album-key.js?v=141';
import { loadTrackPlays, loadListenedAlbums } from '../features/history-data.js?v=141';

let cache = null;
let porTapa = null;

/**
 * @returns {Promise<Map<string, {plays: number, ms: number}>>} albumKey → totales.
 *   Vacío si no hay historial (usuario sin owner ni BYOH) o si el JSON es v3.
 */
export async function buildAlbumStatsIndex({ force = false } = {}) {
  if (cache && !force) return cache;

  const idx = new Map();
  try {
    const data = await loadTrackPlays();
    for (const entry of (data?.albums || [])) {
      // v3 emitía [name, artist] a secas: ahí no hay números que dar y el
      // índice queda vacío, que es exactamente el caso "sin datos".
      const [name, artist, plays, ms] = entry;
      if (plays == null || ms == null) continue;
      const k = albumKey(name, artist);
      const prev = idx.get(k);
      if (prev) { prev.plays += plays; prev.ms += ms; }
      else idx.set(k, { plays, ms });
    }
  } catch (e) {
    console.warn('[album-stats] no pude cargar el historial:', e.message);
  }

  cache = idx;
  return cache;
}

// coverId → suma de plays y ms de TODAS las claves de álbum que comparten esa
// tapa. Es el mismo criterio con el que el mosaico decide que dos entradas son
// la misma celda: si el hash de la imagen coincide, es el mismo disco, aunque
// el export lo haya acreditado a artistas distintos.
//
// Las tapas salen de `history-listened-albums.json`, que es la única fuente que
// trae imagen por álbum. Un álbum que nunca cumplió el umbral de esa lista no
// tiene tapa acá y se resuelve por `albumKey` a secas — que es exactamente lo
// que se hacía antes, o sea que no se pierde nada.
async function buildPorTapa() {
  if (porTapa) return porTapa;

  const stats = await buildAlbumStatsIndex();
  const idx = new Map();
  try {
    const data = await loadListenedAlbums();
    for (const y of (data?.years || [])) {
      for (const al of (y.albums || [])) {
        const cid = coverId(al.img);
        if (!cid) continue;
        const t = stats.get(albumKey(al.name, al.artist));
        if (!t) continue;
        const prev = idx.get(cid);
        // Una clave de álbum puede aparecer en varios años; sus totales ya son
        // globales, así que se cuenta una sola vez por clave.
        if (prev) {
          if (prev.claves.has(albumKey(al.name, al.artist))) continue;
          prev.claves.add(albumKey(al.name, al.artist));
          prev.plays += t.plays;
          prev.ms += t.ms;
        } else {
          idx.set(cid, { plays: t.plays, ms: t.ms, claves: new Set([albumKey(al.name, al.artist)]) });
        }
      }
    }
  } catch (e) {
    console.warn('[album-stats] no pude indexar por tapa:', e.message);
  }

  porTapa = idx;
  return porTapa;
}

/**
 * Plays y minutos de un álbum para la ficha. Unifica por `coverId()` (que junta
 * los discos colaborativos partidos en varias claves) y, si no hay tapa
 * conocida, cae a `albumKey()`.
 *
 * @param {{name?: string, artist?: string, img?: string}} a
 * @returns {Promise<{plays: number, min: number}>} ceros si no hay historial.
 */
export async function lookupAlbumStats(a) {
  if (!a?.name) return { plays: 0, min: 0 };
  const cid = coverId(a.img);
  if (cid) {
    const hit = (await buildPorTapa()).get(cid);
    if (hit) return { plays: hit.plays, min: hit.ms / 60000 };
  }
  const hit = (await buildAlbumStatsIndex()).get(albumKey(a.name, a.artist));
  return hit ? { plays: hit.plays, min: hit.ms / 60000 } : { plays: 0, min: 0 };
}

export function invalidateAlbumStatsIndex() { cache = null; porTapa = null; }
