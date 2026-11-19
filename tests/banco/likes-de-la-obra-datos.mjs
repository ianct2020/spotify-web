// Los datos INVENTADOS del banco `likes-de-la-obra` (v=371, tanda 134). El repo es público: nada de esto es de nadie.
//
//   · La playlist de escuchados: dos discos de «Banda Obra Inventada», una pista registrada de cada uno.
//       - «Disco Obra Inventado» (el caso 1 de la tanda): 6 pistas en su tracklist.
//       - «Disco Sin Likes Inventado»: 4 pistas, ninguna en me gusta (la conservación, puerta C).
//   · La caché de me gusta: 3 pistas de «Disco Obra Inventado (Deluxe Edition)», OTRO id de álbum y otros ids de pista. Dos están
//     en el tracklist de la normal por nombre; la tercera es la bonus, que la normal no tiene. Más dos likes de un disco ajeno, que
//     no tienen que contar en ninguno de los dos.
//
// Lo esperado, escrito ANTES de correr nada:
//   · la tarjeta de «Disco Obra Inventado»: ♥ 3;
//   · su ficha: «2 de 6 pistas en tus me gusta», ♥ lleno en las pistas 1 y 2, y debajo, «2 de ellas están en otra edición y 1 más
//     que este disco no tiene»;
//   · «Disco Sin Likes Inventado»: ningún ♥ en la tarjeta; la ficha, «0 de 4 pistas en tus me gusta» y ninguna línea debajo.

const id22 = (prefijo, i) => (prefijo + String(i).padStart(3, '0')).padEnd(22, 'x').slice(0, 22);
export const PLAYLIST_ID = id22('playlistObraInv', 1);
export const PLAYLIST_NOMBRE = 'Escuchados de mentira';
export const ARTISTA = 'Banda Obra Inventada';
const ARTISTA_OBJ = { id: id22('bandaObraInv', 0), name: ARTISTA };

export const DISCO = { id: id22('discoObraInv', 1), name: 'Disco Obra Inventado', total: 6 };
export const DELUXE = { id: id22('discoObraDlx', 1), name: 'Disco Obra Inventado (Deluxe Edition)', total: 8 };
export const SIN_LIKES = { id: id22('discoSinLikes', 2), name: 'Disco Sin Likes Inventado', total: 4 };
const AJENO = { id: id22('discoAjenoObra', 3), name: 'Disco Ajeno Inventado', total: 10 };

const TEMAS = ['Primer Tema Inventado', 'Segundo Tema Inventado', 'Tercer Tema Inventado', 'Cuarto Tema Inventado', 'Quinto Tema Inventado', 'Sexto Tema Inventado'];
const pistaDe = (disco, i, nombre) => ({ id: id22(`p${disco.id.slice(0, 6)}`, i), name: nombre, track_number: i + 1 });

/** El tracklist de cada disco, con la forma de `GET /albums/{id}/tracks`. */
export const TRACKLISTS = {
  [DISCO.id]: TEMAS.map((n, i) => pistaDe(DISCO, i, n)),
  [SIN_LIKES.id]: ['Uno Sin Like Inventado', 'Dos Sin Like Inventado', 'Tres Sin Like Inventado', 'Cuatro Sin Like Inventado'].map((n, i) => pistaDe(SIN_LIKES, i, n)),
};

const albumObj = (d) => ({ id: d.id, name: d.name, album_type: 'album', total_tracks: d.total, release_date: '2020-01-01', images: [], artists: [ARTISTA_OBJ] });

// La playlist de escuchados: una pista de cada disco (la primera), como la registra Ian.
export const LISTA = [DISCO, SIN_LIKES].map((d, i) => {
  const p = TRACKLISTS[d.id][0];
  return {
    added_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
    item: { type: 'track', id: p.id, uri: `spotify:track:${p.id}`, name: p.name, duration_ms: 200000, explicit: false, is_playable: true, track_number: 1, artists: [ARTISTA_OBJ], album: albumObj(d) },
  };
});

// Los me gusta: la forma de la caché (`all_liked_tracks`), `{ added_at, track }`.
const like = (disco, i, nombre, artista = ARTISTA_OBJ) => {
  const id = id22(`l${disco.id.slice(0, 6)}`, i);
  return { added_at: '2026-02-01T00:00:00Z', track: { id, uri: `spotify:track:${id}`, name: nombre, track_number: i + 1, duration_ms: 200000, explicit: false, artists: [artista], album: albumObj(disco) } };
};
export const LIKES = [
  like(DELUXE, 0, 'Primer Tema Inventado'),
  like(DELUXE, 1, 'Segundo Tema Inventado'),
  like(DELUXE, 7, 'Tema Extra Inventado (Bonus Track)'),
  like(AJENO, 0, 'Tema Ajeno Inventado', { id: id22('bandaAjenaObra', 0), name: 'Banda Ajena Inventada' }),
  like(AJENO, 1, 'Otro Tema Ajeno Inventado', { id: id22('bandaAjenaObra', 0), name: 'Banda Ajena Inventada' }),
];

/** Lo esperado, escrito antes de medir. */
export const ESPERADO = {
  tarjetaDisco: 3,
  fichaDisco: '2 de 6 pistas en tus me gusta',
  filasConCorazon: ['Primer Tema Inventado', 'Segundo Tema Inventado'],
  linea: '2 de ellas están en otra edición y 1 más que este disco no tiene',
  tarjetaSinLikes: 0,
  fichaSinLikes: '0 de 4 pistas en tus me gusta',
};
