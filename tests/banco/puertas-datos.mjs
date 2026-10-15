// Los datos de mentira de `banco/puertas.html` (v=308, tanda 56).
//
// 🔴 TODO INVENTADO: artistas, temas, ids, fechas y minutos. El repo es público y
// ningún dato de escucha de nadie entra acá.
//
// `totals[a]` con la forma de `history-artist-tracks` v3:
//   [plays, minutos, primer año, último año, curva, [5] día de entrada, [6] [tema, id], [7] día del 2.º tema o null]
// `artists[a]` = [[título, plays, minutos, id], …]; el primero es el top.

const T = (min, d5, entrada, d7) => [10, min, +d5.slice(0, 4), 2026, [[+d5.slice(0, 4), min, 10]], d5, entrada, d7];
const id = (n) => `banco${String(n).padStart(17, '0')}`;   // 22 caracteres, como los de Spotify

/** El historial del owner (sembrado en `OWNER_KEYS.artistTracks`): diez artistas en el universo y dos fuera. */
export const HISTORIAL = {
  version: 3, generated_at: '2026-10-15T00:00:00Z',
  totals: {
    'Aurora Lenta': T(200, '2019-04-02', ['Mar de fondo', id(1)], '2019-04-02'),         // el 2.º tema el mismo día; sigue siendo el top
    'Bosque Quieto': T(150, '2020-01-30', ['Hojas', id(2)], '2020-02-02'),               // cruza un fin de mes; el top es otro
    'Cometa Azul': T(120, '2021-06-01', ['Polvo', id(3)], null),                         // un solo tema
    'Delta Sur': T(100, '2018-09-15', ['Corriente', id(4)], '2019-09-15'),               // la entrada es una versión del top
    'Eco Lejano': T(90, '2022-12-31', ['Voz', id(5)], '2023-01-01'),                     // cruza un año; el top es otro
    'Faro Rojo': T(75, '2023-03-03', ['Luz', id(6)], '2023-03-10'),
    'Gaviota': T(60, '2024-02-28', ['Ala', id(7)], '2024-03-01'),                        // año bisiesto
    'Isla': T(45, '2025-05-05', ['Arena', id(9)], '2025-05-06'),                         // empata en minutos con Humo: va después por el nombre
    'Humo': T(45, '2024-07-07', ['Ceniza', id(8)], '2024-08-06'),
    'Junco': T(12, '2025-09-09', ['Agua', id(10)], null),
    'Kiwi': T(9.9, '2025-10-01', ['Semilla', id(11)], '2025-10-02'),                     // 9,9 min: fuera del universo
    'Lima': T(2, '2026-01-01', ['Gota', id(12)], null),                                  // fuera
  },
  artists: {
    'Aurora Lenta': [['Mar de fondo', 30, 120, id(1)], ['Ola', 10, 40, id(21)]],
    'Bosque Quieto': [['Raíces', 25, 90, id(22)], ['Hojas', 8, 30, id(2)]],
    'Cometa Azul': [['Polvo', 40, 120, id(3)]],
    'Delta Sur': [['Corriente - Remastered 2020', 20, 70, id(24)], ['Corriente', 6, 20, id(4)], ['Cauce', 2, 10, id(25)]],
    'Eco Lejano': [['Silencio', 22, 60, id(26)], ['Voz', 9, 30, id(5)]],
    'Faro Rojo': [['Luz', 15, 50, id(6)], ['Sombra', 6, 25, id(27)]],
    'Gaviota': [['Ala', 12, 40, id(7)], ['Pluma', 5, 20, id(28)]],
    'Humo': [['Brasa', 9, 30, id(29)], ['Ceniza', 4, 15, id(8)]],
    'Isla': [['Arena', 10, 30, id(9)], ['Coral', 4, 15, id(30)]],
    'Junco': [['Agua', 4, 12, id(10)]],
    'Kiwi': [['Semilla', 3, 9.9, id(11)]],
    'Lima': [['Gota', 1, 2, id(12)]],
  },
};

/**
 * La cuenta, HECHA A MANO (no con el código): una fila por artista del universo
 * (10 min o más), por minutos y a igualdad por nombre. Cada fila:
 * [artista, tema de entrada, su día (como `fmtDia`), ¿sigue?, hasta el segundo tema].
 */
export const ESPERADO = [
  ['Aurora Lenta', 'Mar de fondo', '2 abr 2019', 'Sí', 'el mismo día'],
  ['Bosque Quieto', 'Hojas', '30 ene 2020', 'No: ahora «Raíces»', '3 días'],
  ['Cometa Azul', 'Polvo', '1 jun 2021', 'Sí', 'solo un tema'],
  ['Delta Sur', 'Corriente', '15 sep 2018', 'Sí', '365 días'],
  ['Eco Lejano', 'Voz', '31 dic 2022', 'No: ahora «Silencio»', '1 día'],
  ['Faro Rojo', 'Luz', '3 mar 2023', 'Sí', '7 días'],
  ['Gaviota', 'Ala', '28 feb 2024', 'Sí', '2 días'],
  ['Humo', 'Ceniza', '7 jul 2024', 'No: ahora «Brasa»', '30 días'],
  ['Isla', 'Arena', '5 may 2025', 'Sí', '1 día'],
  ['Junco', 'Agua', '9 sep 2025', 'Sí', 'solo un tema'],
];

/** Un amigo (BYOH) con SU historial v3, distinto del del owner. */
export const AMIGO_V3 = {
  version: 3, generated_at: '2026-10-15T00:00:00Z',
  totals: {
    'Pino Alto': T(40, '2021-01-01', ['Copa', id(40)], '2021-01-11'),
    'Roble': T(30, '2022-02-02', ['Tronco', id(41)], null),
  },
  artists: {
    'Pino Alto': [['Copa', 9, 30, id(40)], ['Resina', 3, 10, id(42)]],
    'Roble': [['Tronco', 8, 30, id(41)]],
  },
};
export const ESPERADO_AMIGO = [
  ['Pino Alto', 'Copa', '1 ene 2021', 'Sí', '10 días'],
  ['Roble', 'Tronco', '2 feb 2022', 'Sí', 'solo un tema'],
];

/** El mismo amigo importado ANTES de v=308: `totals` de seis campos, sin [6] ni [7]. */
export const AMIGO_VIEJO = {
  version: 2, generated_at: '2026-09-01T00:00:00Z',
  totals: Object.fromEntries(Object.entries(AMIGO_V3.totals).map(([k, t]) => [k, t.slice(0, 6)])),
  artists: AMIGO_V3.artists,
};

/** N artistas sintéticos, todos con 10 minutos o más (para «Mostrar 100 más»). */
export function historialDe(n) {
  const totals = {}, artists = {};
  for (let i = 0; i < n; i++) {
    const nombre = `Artista sintético ${String(i).padStart(3, '0')}`;
    totals[nombre] = T(10 + (n - i), '2020-01-01', [`Tema ${i}`, id(1000 + i)], i % 3 ? '2020-01-02' : null);
    artists[nombre] = [[`Tema ${i}`, 5, 10, id(1000 + i)]];
  }
  return { version: 3, generated_at: '2026-10-15T00:00:00Z', totals, artists };
}
