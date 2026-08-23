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

import { albumKey, coverId } from './album-key.js?v=152';
import { loadTrackPlays, loadListenedAlbums } from '../features/history-data.js?v=152';

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
// albumKey → coverId. Es el PUENTE que hace que la unificación funcione aunque
// el llamador traiga otra tapa (v=150).
//
// El caso real: la ficha abierta desde una canción pasa la tapa que está en el
// caché de likes, y esa imagen puede tener otro hash que la del export del
// historial — VULTURES 1 llega como `…b2e4a1ea…` desde los likes y el
// historial la tiene como `…9c654f31…`. Con la tapa distinta, el índice por
// `coverId` no matcheaba y se caía a `albumKey`, que devuelve UNA sola de las
// dos claves en las que el export parte el disco: 109 plays / 4h 31m en vez de
// los 148 / 6h 13m reales.
//
// Con este mapa, la caída a `albumKey` ya no termina ahí: se pregunta qué tapa
// tiene esa clave según el historial y se vuelve a entrar por `porTapa`, que sí
// tiene la suma de las dos.
let porClave = null;

async function buildPorTapa() {
  if (porTapa) return porTapa;

  const stats = await buildAlbumStatsIndex();
  const idx = new Map();
  porClave = new Map();
  try {
    const data = await loadListenedAlbums();
    for (const y of (data?.years || [])) {
      for (const al of (y.albums || [])) {
        const cid = coverId(al.img);
        if (!cid) continue;
        const k = albumKey(al.name, al.artist);
        // El puente se llena aunque el álbum no tenga totales: sirve igual para
        // llegar a la tapa desde la clave.
        if (!porClave.has(k)) porClave.set(k, cid);
        const t = stats.get(k);
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
  const tapas = await buildPorTapa();

  // 1. Por la tapa que trajo el llamador.
  const cid = coverId(a.img);
  if (cid) {
    const hit = tapas.get(cid);
    if (hit) return { plays: hit.plays, min: hit.ms / 60000 };
  }

  // 2. Por la clave, pero VOLVIENDO a entrar por la tapa: así se suman las
  //    otras claves del mismo disco aunque el llamador haya traído otra imagen
  //    (o ninguna). Sin este salto, un colaborativo devuelve solo la mitad.
  const k = albumKey(a.name, a.artist);
  const cidDeLaClave = porClave?.get(k);
  if (cidDeLaClave) {
    const hit = tapas.get(cidDeLaClave);
    if (hit) return { plays: hit.plays, min: hit.ms / 60000 };
  }

  // 3. Sin tapa conocida en ninguna de las dos puntas: la clave a secas.
  const hit = (await buildAlbumStatsIndex()).get(k);
  return hit ? { plays: hit.plays, min: hit.ms / 60000 } : { plays: 0, min: 0 };
}

export function invalidateAlbumStatsIndex() { cache = null; porTapa = null; porClave = null; }
