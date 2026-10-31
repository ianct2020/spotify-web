// Datos INVENTADOS del banco `rehacer-me-gusta` (v=349, tanda 106). El repo es público: nada de esto es de nadie.
//
// `pista(n)` es un me gusta con la forma de `slimTrack` (la de la caché) y con la de `/me/tracks` (la simulada contesta
// `{ added_at, track }`). Los ids son de 22 caracteres alfanuméricos, como los de Spotify (el contrato del doble, ver
// `simulado.mjs`); la uri lleva `t106inventada` para que se vea de dónde sale.

export const UID = 't106-banco-cuenta-a-inventada';
const id22 = (n, p) => (p + 't106inventada' + String(n).padStart(9, '0')).slice(0, 22).padEnd(22, '0');

export function pista(n) {
  const id = id22(n, 'p');
  return {
    added_at: new Date(Date.UTC(2025, 0, 1) + n * 3_600_000).toISOString(),
    track: {
      id, uri: `spotify:track:t106inventada${n}`, name: `Tema inventado ${n}`,
      popularity: null, duration_ms: 180000 + (n % 60) * 1000, explicit: false, is_playable: true, track_number: 1 + (n % 10),
      artists: [{ id: id22(n % 7, 'a'), name: `Artista inventado ${n % 7}` }],
      album: { id: id22(n % 11, 'd'), name: `Disco inventado ${n % 11}`, release_date: '2021-03-04', album_type: 'album', total_tracks: 10, images: [] },
    },
  };
}

/** Los me gusta u<desde>..u<hasta>, los dos incluidos. */
export const rango = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => pista(desde + i));
