// Los datos INVENTADOS del banco `preview-adelantar` (v=374, tanda 137). El repo es público: nada de esto es de nadie.
//
// El mismo molde que `preview-siguiente-datos.mjs`: una playlist de escuchados con un disco, «Disco Adelantar Inventado» de
// «Banda Adelantar Inventada», 3 pistas, las tres con preview en el iTunes de mentira. La ficha se abre desde la tarjeta de
// `#listened` y se aprieta el ▶ de la 1.ª.
//
// Sin audio real, el `<audio>` lo dobla el caso (`preview-adelantar-caso.html`): `duration` da 30 después de `play()` (con
// `loadedmetadata` y `durationchange`) y `currentTime` se lee y se escribe en una propiedad propia. Con eso la madre ve lo que la
// app le hace al `<audio>`; NO ve si un audio de verdad salta bien.
//
// Lo esperado, escrito ANTES de correr nada:
//   · A: clic al 50 % de la pista → currentTime 15 ± 0,5; «faltan» dice −0:15.
//   · B: arrastrar del 20 % al 70 % → currentTime 21 ± 0,5; en el medio (50 %), aria-valuenow 15.
//   · C: con foco en la barra, desde 10: → 15, ↑ 20, ← 15, ↓ 10, Home 0. Un espía de `keydown` en `document` ve 0 flechas.
//   · D: en pausa, un clic al 40 % la deja en pausa en 12; un arrastre hasta el 100 % queda en 29,5 y el pill sigue abierto.
//   · E: el pill 360 × 62 en los cuatro estados a 1366 × 591 y lo de hoy a 390 × 844; la pista ≥ 16 px de alto; 0 peticiones
//     a Spotify, iTunes y Deezer desde que el preview suena; 0 errores de consola.
//   · F: el contorno del foco contra el fondo del pill ≥ 3:1 en los cuatro presets.

const id22 = (prefijo, i) => (prefijo + String(i).padStart(3, '0')).padEnd(22, 'x').slice(0, 22);
export const PLAYLIST_ID = id22('playlistAdeInv', 1);
export const PLAYLIST_NOMBRE = 'Escuchados de mentira';
export const ARTISTA = 'Banda Adelantar Inventada';
const ARTISTA_OBJ = { id: id22('bandaAdeInv', 0), name: ARTISTA };

export const DISCO = { id: id22('discoAdeInv', 1), name: 'Disco Adelantar Inventado', total: 3 };
export const TEMAS = ['Uno Adelantar Inventado', 'Dos Adelantar Inventado', 'Tres Adelantar Inventado'];

/** El tracklist, con la forma de `GET /albums/{id}/tracks`. */
export const TRACKLIST = TEMAS.map((n, i) => ({ id: id22('pistaAdeInv', i + 1), name: n, track_number: i + 1 }));

const albumObj = { id: DISCO.id, name: DISCO.name, album_type: 'album', total_tracks: DISCO.total, release_date: '2021-01-01', images: [], artists: [ARTISTA_OBJ] };

// La playlist de escuchados: la primera pista.
export const LISTA = [{
  added_at: '2026-01-01T00:00:00.000Z',
  item: { type: 'track', id: TRACKLIST[0].id, uri: `spotify:track:${TRACKLIST[0].id}`, name: TEMAS[0], duration_ms: 200000, explicit: false, is_playable: true, track_number: 1, artists: [ARTISTA_OBJ], album: albumObj },
}];

/** iTunes de mentira: las tres pistas. */
export function itunesInventado(url) {
  const termino = url.searchParams.get('term') || '';
  const tema = TEMAS.find((t) => termino.includes(t));
  if (!tema || !termino.includes(ARTISTA)) return { results: [] };
  return { resultCount: 1, results: [{ kind: 'song', trackName: tema, artistName: ARTISTA, collectionName: DISCO.name, previewUrl: `/banco/preview-adelantar-${encodeURIComponent(tema)}.m4a` }] };
}

// Los cuatro presets, para la puerta F (los nombres de `ui/theme-panel.js`).
export const PRESETS = ['violeta', 'ambar', 'aguamarina', 'papel'];
