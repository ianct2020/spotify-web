// La resolución de UN tema de Last.fm en Spotify (v=369, tanda 132).
//
// Hasta v=368 vivía dentro del bucle de `resolveTracksOnSpotify()` de `features/recommendations.js`.
// Ahora la usan los dos caminos de `#recs`: el de un artista (`pickArtist`) y el de un estilo
// («Armar la lista»). Una regla escrita dos veces diverge (v=219): la query, `limpiaParaQuery`,
// `limit=5` y la verificación `titleMatches` + `artistMatches` están acá y en ningún otro sitio de
// esta vista. (`#similar` y `#rabbit` tienen sus propias copias, de antes: FUERA de esta tanda.)
//
// ⚠️ El apóstrofo dentro de las comillas rompe la búsqueda de Spotify (ver `limpiaParaQuery` en
// `util/track-match.js`): por eso se limpia, y como la query queda más laxa el resultado se
// verifica contra el nombre real antes de darlo por bueno, entre los 5 primeros (no el primero).
//
// 🔴 Distingue TRES salidas, y es lo nuevo:
//   · `{ estado: 'encontrado', fila }`: la fila, con la MISMA forma que pintaba `#recs`;
//   · `{ estado: 'sin-match' }`: Spotify contestó y ninguno de los 5 es ese tema;
//   · `{ estado: 'error', error }`: la búsqueda TIRÓ (un 429, un corte, una respuesta ilegible).
// Los dos caminos PARAN en el primer `error`: el de un estilo desde v=369 y el de un artista desde
// v=378 (tanda 141), que hasta entonces lo pintaba como «sin match».

import { spotifyFetch } from '../api.js?v=378';
import { limpiaParaQuery, titleMatches, artistMatches } from './track-match.js?v=378';

/**
 * @param {{ name: string, artist: string }} t   un top track de Last.fm
 * @param {object} [opciones]   lo que se le pasa a `spotifyFetch` (el camino de un estilo manda
 *   `{ _maxRetries: 0 }`: ningún reintento automático). Sin opciones, la llamada de siempre.
 */
export async function resolverTemaEnSpotify(t, opciones) {
  try {
    const q = `track:"${limpiaParaQuery(t.name)}" artist:"${limpiaParaQuery(t.artist)}"`;
    const url = `/search?q=${encodeURIComponent(q)}&type=track&limit=5`;
    const data = await (opciones ? spotifyFetch(url, opciones) : spotifyFetch(url));
    const hit = (data.tracks?.items || []).find(c =>
      titleMatches(t.name, c.name) && artistMatches(t.artist, (c.artists || []).map(a => a.name).join(', ')));
    if (!hit) return { estado: 'sin-match' };
    const artistas = (hit.artists || []).map(a => a.name).filter(Boolean);
    return {
      estado: 'encontrado',
      fila: {
        uri: hit.uri,
        trackId: hit.id,
        name: hit.name,
        artist: artistas.join(', '),
        // La lista entera, no el string unido: la cadena de proveedores acepta el match si
        // coincide CUALQUIER artista, y con el string unido no hay más que un nombre imposible
        // («A, B & C») contra el que comparar.
        artistList: artistas,
        album: hit.album?.name,
        albumId: hit.album?.id,
        image: hit.album?.images?.[hit.album.images.length - 1]?.url,
        imageBig: hit.album?.images?.[0]?.url,
        matched: true,
      },
    };
  } catch (error) {
    return { estado: 'error', error };
  }
}
