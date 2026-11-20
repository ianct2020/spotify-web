// Los datos INVENTADOS del banco `preview-siguiente` (v=373, tanda 136). El repo es público: nada de esto es de nadie.
//
//   · La playlist de escuchados: un disco, «Disco Siguiente Inventado» de «Banda Siguiente Inventada», con su primera pista registrada.
//   · Su tracklist: 5 pistas. La 3.ª llega SIN id (como una pista local): así `getPreview` no tiene `spotifyId` para el embed y, sin
//     iTunes ni Deezer, da `null` → la fila queda con «Sin preview». Con un id, la ficha le pediría el embed de Spotify (ver
//     `api/preview-providers.js`): una pista CON id nunca da «Sin preview» en la ficha, cae al embed, y el embed corta la cola.
//   · iTunes (por `rutaExterna`) contesta las pistas 1, 2, 4 y 5 y nada para la 3.ª. Deezer va por JSONP: el resolutor de Chrome del
//     corredor lo corta y `getPreview` sigue.
//
// Lo esperado, escrito ANTES de correr nada:
//   · A: ▶ de la 1.ª → suena la 1.ª. `nexttrack` → la 2.ª; la tecla → la 4.ª (la 3.ª queda «Sin preview»); el botón 4 → la 5.ª. En cada
//     paso, el pill dice ese nombre y el ⏸ está en esa fila y en ninguna otra. 0 peticiones a Spotify; una búsqueda en iTunes por pista
//     nueva (la 3.ª también se busca y no está).
//   · B: en la 5.ª, «siguiente» no cambia nada (ni pill, ni filas, ni peticiones).
//   · C: el botón 3 con la ficha abierta y con la cola: no queda `defaultPrevented`. Con la ficha cerrada, el botón 4 tampoco, y
//     `mediaSession` queda sin handler de `nexttrack`.

const id22 = (prefijo, i) => (prefijo + String(i).padStart(3, '0')).padEnd(22, 'x').slice(0, 22);
export const PLAYLIST_ID = id22('playlistSigInv', 1);
export const PLAYLIST_NOMBRE = 'Escuchados de mentira';
export const ARTISTA = 'Banda Siguiente Inventada';
const ARTISTA_OBJ = { id: id22('bandaSigInv', 0), name: ARTISTA };

export const DISCO = { id: id22('discoSigInv', 1), name: 'Disco Siguiente Inventado', total: 5 };
export const TEMAS = ['Uno Siguiente Inventado', 'Dos Siguiente Inventado', 'Tres Sin Preview Inventado', 'Cuatro Siguiente Inventado', 'Cinco Siguiente Inventado'];
export const SIN_PREVIEW = 2;   // el índice de la que no tiene preview

/** El tracklist, con la forma de `GET /albums/{id}/tracks`. La 3.ª, sin id. */
export const TRACKLIST = TEMAS.map((n, i) => ({ id: i === SIN_PREVIEW ? null : id22('pistaSigInv', i + 1), name: n, track_number: i + 1 }));

const albumObj = { id: DISCO.id, name: DISCO.name, album_type: 'album', total_tracks: DISCO.total, release_date: '2021-01-01', images: [], artists: [ARTISTA_OBJ] };

// La playlist de escuchados: la primera pista, como la registra Ian.
export const LISTA = [{
  added_at: '2026-01-01T00:00:00.000Z',
  item: { type: 'track', id: TRACKLIST[0].id, uri: `spotify:track:${TRACKLIST[0].id}`, name: TEMAS[0], duration_ms: 200000, explicit: false, is_playable: true, track_number: 1, artists: [ARTISTA_OBJ], album: albumObj },
}];

/** iTunes de mentira: las pistas 1, 2, 4 y 5; la 3.ª, nada. */
export function itunesInventado(url) {
  const termino = url.searchParams.get('term') || '';
  const tema = TEMAS.find((t) => termino.includes(t));
  if (!tema || tema === TEMAS[SIN_PREVIEW] || !termino.includes(ARTISTA)) return { results: [] };
  return { resultCount: 1, results: [{ kind: 'song', trackName: tema, artistName: ARTISTA, collectionName: DISCO.name, previewUrl: `/banco/preview-inventado-${encodeURIComponent(tema)}.m4a` }] };
}
