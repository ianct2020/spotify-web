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
// (tanda 129) Dos más para «📚 Por escuchar», que el chip no ve (el chip cruza por id):
//   · POR_CLAVE: otro id, pero el mismo nombre y el mismo artista que el disco 10 de la lista → para «Por escuchar» ya está registrado;
//   · CON_PISTA: un ajeno que trae `tracks.items` como lo trae `/me/albums`, para la fuente (b) de la pista representativa.
// Quedan 122 guardados (3 páginas). Pendientes para «Por escuchar»: 122 − 9 (por id) − 1 (por clave) = 112; la otra edición (9) va con
// otro artista («Banda Guardada Inventada»), así que no cruza ni por id ni por clave y sí está pendiente.
export const POR_CLAVE = id22('discoPorClave', 10);
export const CON_PISTA = id22('discoConPista', 0);
export const PISTA_GUARDADA = `spotify:track:${id22('pistaGuardada', 0)}`;
const guardadoDe = (id, name, artista, added_at, extra = {}) => ({ added_at, album: { id, name, album_type: 'album', total_tracks: 10, images: [], artists: [{ id: id22('bandaLista', 0), name: artista }], ...extra } });
export const BIBLIOTECA = [
  ...Array.from({ length: 9 }, (_, i) => guardado(idDeLista(i), nombreDeLista(i))),
  guardado(id22('discoOtraEdicion', OTRA_EDICION), `${nombreDeLista(OTRA_EDICION)} (Deluxe Edition)`),
  ...Array.from({ length: 110 }, (_, i) => guardado(id22('discoAjeno', i), `Disco Ajeno Inventado ${i}`)),
  guardadoDe(POR_CLAVE, nombreDeLista(10), artistaDeLista(10), '2026-02-01T00:00:00Z'),
  guardadoDe(CON_PISTA, 'Disco Con Pista Inventado', 'Banda Con Pista Inventada', '2026-03-01T00:00:00Z', { tracks: { items: [{ uri: PISTA_GUARDADA, name: 'Tema Guardado Inventado' }] } }),
];
/** Los ids que «Por escuchar» tiene que listar, del guardado más nuevo al más viejo (a igual `added_at`, el orden de la biblioteca). */
export const PENDIENTES_ESPERADOS = (() => {
  const fuera = new Set([...Array.from({ length: 9 }, (_, i) => idDeLista(i)), POR_CLAVE]);
  return BIBLIOTECA.filter((g) => !fuera.has(g.album.id))
    .map((g, i) => ({ id: g.album.id, t: Date.parse(g.added_at), i }))
    .sort((a, b) => b.t - a.t || a.i - b.i).map((x) => x.id);
})();

/** Una página de `GET /me/albums`, con el `next` absoluto de la API de verdad. */
export function paginaDeBiblioteca(url) {
  const limit = +(url.searchParams.get('limit') || 20), offset = +(url.searchParams.get('offset') || 0);
  const items = BIBLIOTECA.slice(offset, offset + limit);
  const siguiente = offset + limit;
  return { items, limit, offset, total: BIBLIOTECA.length, next: siguiente < BIBLIOTECA.length ? `https://api.spotify.com/v1/me/albums?offset=${siguiente}&limit=${limit}` : null };
}
