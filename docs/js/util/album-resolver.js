// EL resolutor de id de álbum. Uno solo, para todo el repo.
//
// Hasta v=218 había DOS, resolviendo el mismo problema con criterios distintos:
//
//   - `resolveAlbumId()` en `features/album-card.js` — `limit=5`, limpiaba el
//     apóstrofo con `limpiaParaQuery` y COMPARABA el resultado contra el nombre
//     y el artista pedidos;
//   - la búsqueda de adentro de `fetchAlbumTracks()` en `features/wthree.js` —
//     `limit=1`, `items[0]` a ciegas, sin limpiar el apóstrofo y sin comparar
//     nada después.
//
// El que no verificaba es el que rompía: el tracklist del modal de W-Three
// salía del primer resultado que Spotify quisiera devolver. Dos copias del
// mismo criterio vuelven a divergir sí o sí, así que acá queda UNA.
//
// El criterio, entero:
//   1. `limit=5` como mínimo, nunca 1. Sacado el apóstrofo la query queda más
//      laxa y puede devolver vecinos: el que decide es el filtro, no el orden.
//   2. El apóstrofo se limpia con `limpiaParaQuery` (medido contra la API el
//      2026-08-19: `album:"Don't Be Dumb"` da 0 resultados, `"Dont Be Dumb"`
//      da 2). Lo hace el resolutor, así que ningún llamador se puede olvidar.
//   3. Se acepta el candidato solo si el nombre normalizado es igual, el
//      artista pedido está de verdad entre los del álbum, y el candidato NO
//      trae marcadores de versión que el pedido no traía
//      (`util/album-version-guard.js`).
//
// ⚠️ Nada de esto afloja `albumKey`. La clave sigue igual de estricta — es lo
// que mantiene separados American Football LP2/LP3, Crystal Castles I/II y el
// ÷/=/+ de Ed Sheeran. Lo que cambia es a QUÉ id de Spotify apunta esa clave.

import { spotifyFetch } from '../api.js?v=236';
import { limpiaParaQuery, normText } from './track-match.js?v=236';
import { albumKey } from './album-key.js?v=236';
import { firstArtistName, artistNames, resolveArtistName } from './artist-name.js?v=236';
import { candidatoTraeVersionDeMas } from './album-version-guard.js?v=236';

// ⚠️ SOLO ÉXITOS. Un fracaso memoizado se lee después como un éxito de que «no
// hay álbum» y se queda pegado hasta recargar la página: si Spotify estaba
// rate-limiteado, o la red se cayó, o el catálogo cambia, la ficha queda
// condenada a degradar el resto de la sesión. Los fracasos se reintentan.
const _memo = new Map();   // albumKey → id (string, nunca null)

// El apóstrofo se saca a los DOS lados antes de normalizar: `normText` lo
// convierte en espacio, así que «Don't Be Dumb» daría «don t be dumb» y
// «Dont Be Dumb» daría «dont be dumb» — distintos. Sacándolo primero, las dos
// escrituras del mismo disco caen en la misma clave.
const clave = (s) => normText(String(s || '').replace(/['‘’ʼ`´]/g, ''));

/**
 * @param {{name:string, artist?:string, albumId?:string, id?:string}} a
 * @param {{esArtistaConocido?:(n:string)=>boolean, limit?:number}} [opts]
 * @returns {Promise<{id:string|null, motivo:string|null, artista:string}>}
 *   `motivo` es null cuando resolvió. Cuando no, dice POR QUÉ — el llamador lo
 *   muestra en pantalla (ver `features/album-card.js`); no alcanza con un
 *   `console.warn`, que la extensión de Chrome no captura.
 */
export async function resolveAlbumId(a, opts = {}) {
  const directo = a?.albumId || a?.id || null;
  const artista = firstArtistName(resolveArtistName(a?.artist || '', opts.esArtistaConocido));
  if (directo) return { id: directo, motivo: null, artista };

  const k = albumKey(a?.name, artista);
  if (_memo.has(k)) return { id: _memo.get(k), motivo: null, artista };

  const limit = Math.max(5, opts.limit || 5);
  let items = [];
  try {
    const q = `album:"${limpiaParaQuery(a?.name)}" artist:"${limpiaParaQuery(artista)}"`;
    const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=${limit}`);
    items = res?.albums?.items || [];
  } catch (e) {
    // El mensaje lleva el error CRUDO: un catch que traduce cualquier
    // excepción a un mensaje de dominio esconde los errores de programación
    // con el disfraz de un resultado normal (la lección de v=154).
    return { id: null, motivo: `la búsqueda falló (${e.message})`, artista };
  }

  const nombreOk = clave(a?.name);
  const artistaOk = clave(artista);
  const elegido = items.find(it => {
    if (clave(it?.name) !== nombreOk) return false;
    if (artistaOk && !artistNames(it).some(n => clave(n) === artistaOk)) return false;
    // Lo nuevo de v=219, y va al REVÉS que `versionesCompatibles()` de
    // track-match: un pedido sin versión RECHAZA al candidato con versión.
    if (candidatoTraeVersionDeMas(a?.name, it?.name)) return false;
    return true;
  }) || null;

  if (!elegido?.id) {
    return {
      id: null,
      artista,
      motivo: items.length
        ? `${items.length} resultado${items.length === 1 ? '' : 's'} y ninguno coincide`
        : 'Spotify no devolvió ningún álbum con ese nombre',
    };
  }

  _memo.set(k, elegido.id);
  return { id: elegido.id, motivo: null, artista };
}

/** Para los tests y para vaciar el memo entre sesiones de datos distintas. */
export function _vaciarMemoDeAlbumes() { _memo.clear(); }
