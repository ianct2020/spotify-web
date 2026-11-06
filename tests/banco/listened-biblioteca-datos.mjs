// Los datos INVENTADOS del banco `listened-biblioteca` (v=363, tanda 122). El repo es público: nada de esto es de nadie.
//
//   · La playlist «listened albums»: 30 discos, una pista cada uno. Los pares los firma «Banda Par Inventada» y los impares, «Banda Impar Inventada».
//   · La biblioteca: 120 guardados, o sea 3 páginas de `GET /me/albums?limit=50`. 10 de ellos son de la lista: del 0 al 8 con su mismo id
//     y el 9 como OTRA EDICIÓN (el mismo disco con otro id: por id no cuenta). Los otros 110 no están en la lista.

const id22 = (prefijo, i) => (prefijo + String(i).padStart(3, '0')).padEnd(22, 'x');
export const PLAYLIST_ID = id22('playlistInventada', 1);
export const PLAYLIST_NOMBRE = 'Discos de mentira';
export const OTRA_EDICION = 9;

export const idDeLista = (i) => id22('discoLista', i);
export const nombreDeLista = (i) => `Disco Inventado ${String(i).padStart(2, '0')}`;
export const artistaDeLista = (i) => (i % 2 ? 'Banda Impar Inventada' : 'Banda Par Inventada');

export const LISTA = Array.from({ length: 30 }, (_, i) => ({
  added_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
  item: {
    type: 'track', id: id22('pistaLista', i), uri: `spotify:track:${id22('pistaLista', i)}`, name: `Tema Inventado ${i}`,
    duration_ms: 200000, explicit: false, is_playable: true, track_number: 1,
    artists: [{ id: id22('bandaLista', i % 2), name: artistaDeLista(i) }],
    album: {
      id: idDeLista(i), name: nombreDeLista(i), album_type: 'album', total_tracks: 10, release_date: `20${String(i % 20).padStart(2, '0')}-01-01`,
      images: [], artists: [{ id: id22('bandaLista', i % 2), name: artistaDeLista(i) }],
    },
  },
}));

const guardado = (id, name) => ({ added_at: '2026-01-01T00:00:00Z', album: { id, name, album_type: 'album', total_tracks: 10, images: [], artists: [{ id: id22('bandaGuardada', 0), name: 'Banda Guardada Inventada' }] } });
export const BIBLIOTECA = [
  ...Array.from({ length: 9 }, (_, i) => guardado(idDeLista(i), nombreDeLista(i))),
  guardado(id22('discoOtraEdicion', OTRA_EDICION), `${nombreDeLista(OTRA_EDICION)} (Deluxe Edition)`),
  ...Array.from({ length: 110 }, (_, i) => guardado(id22('discoAjeno', i), `Disco Ajeno Inventado ${i}`)),
];

/** Una página de `GET /me/albums`, con el `next` absoluto de la API de verdad. */
export function paginaDeBiblioteca(url) {
  const limit = +(url.searchParams.get('limit') || 20), offset = +(url.searchParams.get('offset') || 0);
  const items = BIBLIOTECA.slice(offset, offset + limit);
  const siguiente = offset + limit;
  return { items, limit, offset, total: BIBLIOTECA.length, next: siguiente < BIBLIOTECA.length ? `https://api.spotify.com/v1/me/albums?offset=${siguiente}&limit=${limit}` : null };
}
