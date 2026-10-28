// Los datos de mentira de `banco/menos-salteas.html` (tanda 90).
//
// 🔴 TODO INVENTADO: temas, artistas, ids y cuentas. El repo es público y ningún
// dato de escucha de nadie entra acá.
//
// `skip.tracks[id]` con la forma de `history-skip-stats` v5:
//   [ok, skip, fwd_ms[], close_ms[], gid, completas desde el corte, saltos desde el corte]
// `stats.years[]` solo con lo que lee `lineaBaseSaltos()`: dos años con el campo
// (2023 y 2024) dan una base de 60,0 % → la mitad es 30 %.

const id = (n) => `banco${String(n).padStart(17, '0')}`;   // 22 caracteres, como los de Spotify
const T = (gid, completas, saltos) => [completas, saltos, [], [], gid, completas, saltos];

export const YEARS = [
  { year: 2021, skips: 50, plays_raw: 1000, plays_junk: 0 },   // sin el campo: no cuenta para la base
  { year: 2023, skips: 600, plays_raw: 1000, plays_junk: 0 },
  { year: 2024, skips: 300, plays_raw: 500, plays_junk: 0 },
];
export const STATS = { version: 5, generated_at: '2026-10-27T00:00:00Z', totals: {}, years: YEARS };

/** El historial de saltos del owner: nueve grupos, siete entran. */
export const SKIP = {
  version: 5, generated_at: '2026-10-27T00:00:00Z', min_plays: 1, skip_min_ms: 5000, complete_closes: [], groups: 9,
  tracks: {
    [id(1)]: T(0, 20, 0),      // «Mar de fondo»…
    [id(2)]: T(0, 5, 1),       // …y su remaster: el grupo suma 25 y 1 (3,8 %)
    [id(3)]: T(1, 12, 0),      // 0 %, 12 enteras
    [id(4)]: T(2, 30, 3),      // 9,1 %
    [id(5)]: T(3, 14, 6),      // 30 % JUSTO: entra
    [id(6)]: T(4, 14, 7),      // 33,3 %: fuera
    [id(7)]: T(5, 9, 0),       // 9 enteras: fuera
    [id(8)]: T(6, 40, 10),     // 20 %
    [id(9)]: T(7, 10, 0),      // 0 %, 10 enteras: va detrás del de 12
    [id(10)]: T(8, 18, 2),     // 10 %, y NO está en artist-tracks: sin nombre
  },
};

/** Los nombres: `history-artist-tracks` (`artists[a]` = [[título, plays, minutos, id], …]). */
export const ARTIST_TRACKS = {
  version: 3, generated_at: '2026-10-27T00:00:00Z',
  totals: {},
  artists: {
    'Aurora Lenta': [['Mar de fondo', 30, 120, id(1)], ['Brisa', 12, 40, id(3)], ['Mar de fondo - Remastered 2020', 6, 20, id(2)]],
    'Delta Sur': [['Corriente', 33, 100, id(4)]],
    'Eco Lejano': [['Voz', 20, 60, id(5)], ['Eco', 21, 60, id(6)]],
    'Faro Rojo': [['Isla de sal', 10, 30, id(9)], ['Luz', 9, 30, id(7)]],
    'Bosque Quieto': [['Hojas', 50, 150, id(8)]],
  },
};

/**
 * La lista, HECHA A MANO (no con el código): por porcentaje de menor a mayor y, a igualdad,
 * por completas de mayor a menor. Cada fila: [tema, artista, cuentas, porcentaje].
 */
export const ESPERADO = [
  ['Brisa', 'Aurora Lenta', '12 enteras, 0 saltadas', '0,0 %'],
  ['Isla de sal', 'Faro Rojo', '10 enteras, 0 saltadas', '0,0 %'],
  ['Mar de fondo', 'Aurora Lenta', '25 enteras, 1 saltada', '3,8 %'],
  ['Corriente', 'Delta Sur', '30 enteras, 3 saltadas', '9,1 %'],
  ['Sin nombre en tus datos', '—', '18 enteras, 2 saltadas', '10,0 %'],
  ['Hojas', 'Bosque Quieto', '40 enteras, 10 saltadas', '20,0 %'],
  ['Voz', 'Eco Lejano', '14 enteras, 6 saltadas', '30,0 %'],
];
export const INTRO = 'Temas que escuchaste enteros al menos 10 veces desde el 15/10/2022 y que saltas como mucho la mitad que tu promedio (60,0 %).';

/** Un amigo (BYOH) con SU historial v5. */
export const AMIGO_SKIP = {
  version: 5, generated_at: '2026-10-27T00:00:00Z', groups: 2,
  tracks: { [id(40)]: T(0, 11, 1), [id(41)]: T(1, 50, 40) },
};
export const AMIGO_AT = { version: 3, totals: {}, artists: { 'Pino Alto': [['Copa', 12, 40, id(40)], ['Resina', 90, 200, id(41)]] } };
export const ESPERADO_AMIGO = [['Copa', 'Pino Alto', '11 enteras, 1 saltada', '8,3 %']];

/** El mismo amigo importado ANTES de la tanda 90: `version` 4 y `tracks[id]` de cinco campos. */
export const AMIGO_VIEJO_SKIP = {
  version: 4, generated_at: '2026-09-01T00:00:00Z', groups: 2,
  tracks: Object.fromEntries(Object.entries(AMIGO_SKIP.tracks).map(([k, t]) => [k, t.slice(0, 5)])),
};

/** Un amigo con pocos datos: nada cumple. */
export const POCOS_SKIP = { version: 5, generated_at: '2026-10-27T00:00:00Z', groups: 1, tracks: { [id(50)]: T(0, 4, 0) } };

/** N grupos sintéticos que entran todos (0 %, completas 10 + N − 1 … 10), con nombre. */
export function historialDe(n) {
  const tracks = {}, artists = {};
  for (let i = 0; i < n; i++) {
    tracks[id(1000 + i)] = T(i, 10 + (n - 1 - i), 0);
    artists[`Artista sintético ${String(i).padStart(3, '0')}`] = [[`Tema ${String(i).padStart(3, '0')}`, 10, 30, id(1000 + i)]];
  }
  return { skip: { version: 5, generated_at: '2026-10-27T00:00:00Z', groups: n, tracks }, at: { version: 3, totals: {}, artists } };
}
