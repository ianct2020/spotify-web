// Reproducciones INVENTADAS de la tanda 131 (v=368): el día local dentro del detalle por día.
//
// 🔴 TODO INVENTADO: los temas, los artistas, los ids y las horas. El repo es público: esto no es el
// historial de nadie. Lo usan `tests/lluvia-dia-detalle.test.mjs` y la medición del tamaño del payload.
//
// Dos juegos:
//   · `BORDES` (dos archivos, con una reproducción repetida entre los dos, como los `_N` del export): los
//     cortes de la hora de Mar del Plata (UTC−3 fija), contados a mano en `ESPERADO_LOCAL`;
//   · `GENERADO`: 120 días con horas repartidas por todo el día, para la paridad con `gen-stats.py` y
//     para el tamaño. Sale de un generador con semilla fija: da lo mismo en cada corrida.

const ARTISTAS = { A: 'Artista Inventado Uno', B: 'Artista Inventado Dos', C: 'Artista Inventado Uno', D: 'Artista Inventado Tres', E: 'Artista Inventado Dos', F: 'Ruido Inventado' };

/** Una reproducción con la forma del export. `tid` es el id del tema (inventado). */
export function p(ts, tid, seg, extra = {}) {
  return {
    ts,
    ms_played: Math.round(seg * 1000),
    master_metadata_track_name: extra.track ?? `Tema Inventado ${tid}`,
    master_metadata_album_artist_name: extra.artista ?? ARTISTAS[tid] ?? `Artista Inventado ${tid}`,
    master_metadata_album_album_name: extra.album ?? `Disco Inventado ${tid}`,
    spotify_track_uri: tid === null ? null : `spotify:track:t131inventado${tid}`,
    reason_end: extra.reason_end ?? 'trackdone',
    skipped: extra.skipped ?? false,
  };
}

export const BORDES = [
  [
    p('2024-03-09T15:00:00Z', 'A', 200),                 // local 09/03 · UTC 09/03
    p('2024-03-10T02:59:59Z', 'B', 120),                 // local 09/03 (un segundo antes del corte) · UTC 10/03
    p('2024-03-10T03:00:00Z', 'C', 240),                 // local 10/03 (justo en el corte) · UTC 10/03
    p('2024-03-12T02:30:00Z', 'D', 180),                 // local 11/03 · UTC 12/03
    p('2024-03-12T04:00:00Z', 'D', 90),                  // local 12/03 · UTC 12/03: el MISMO tema, el mismo día UTC, dos días locales
    p('2024-03-12T05:00:00Z', 'E', 20),                  // 20 s: cuenta en crudas, no en minutos
    p('2024-03-12T06:00:00Z', null, 600),                // sin uri: fuera
    p('2024-03-12T07:00:00Z', 'F', 600, { track: 'Sonido Para Sacar Agua Del Movil', artista: 'nbeats' }),   // basura: fuera de los minutos
    p('2024-03-12T08:00:00Z', 'A', 95, { skipped: true }),   // válida y saltada
    p('2024-12-31T23:30:00Z', 'C', 60),                  // local 31/12 (20:30) · UTC 31/12
    p('2025-01-01T02:00:00Z', 'E', 150),                 // local 31/12/2024 · UTC 01/01/2025: el borde del año
    p('2025-01-01T03:00:01Z', 'A', 30),                  // 30 s justos: cuenta · local 01/01
  ],
  [
    p('2024-03-10T03:00:00Z', 'C', 240),                 // la MISMA del primer archivo: no cuenta dos veces
    p('2025-01-02T12:00:00Z', 'B', 300),                 // local 02/01 · UTC 02/01
  ],
];

// Contado a mano (minutos con un decimal; los temas, en orden de su primera vez DENTRO del día local).
export const ESPERADO_LOCAL = {
  '2024-03-09': { min: 5.3, crudas: 2, validas: 2, saltos: 0, temas: [['A', 3.3, 1], ['B', 2, 1]] },
  '2024-03-10': { min: 4, crudas: 1, validas: 1, saltos: 0, temas: [['C', 4, 1]] },
  '2024-03-11': { min: 3, crudas: 1, validas: 1, saltos: 0, temas: [['D', 3, 1]] },
  // 04:00 D (90) · 05:00 E (20 s, cruda) · 06:00 sin uri (no es cruda) · 07:00 basura (cruda, sin minutos) · 08:00 A (95, saltada)
  '2024-03-12': { min: 3.1, crudas: 4, validas: 2, saltos: 1, temas: [['D', 1.5, 1], ['A', 1.6, 1]] },
  '2024-12-31': { min: 3.5, crudas: 2, validas: 2, saltos: 0, temas: [['C', 1, 1], ['E', 2.5, 1]] },
  '2025-01-01': { min: 0.5, crudas: 1, validas: 1, saltos: 0, temas: [['A', 0.5, 1]] },
  '2025-01-02': { min: 5, crudas: 1, validas: 1, saltos: 0, temas: [['B', 5, 1]] },
};

// El generado: 120 días desde el 01/05/2023, de 0 a 11 reproducciones por día, a cualquier hora,
// de 15 temas de 5 artistas. Algunas cortas (< 30 s) y alguna saltada.
function generar() {
  let s = 131;
  const azar = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const out = [];
  const base = Date.UTC(2023, 4, 1);
  for (let dia = 0; dia < 120; dia++) {
    const n = Math.floor(azar() * 12);
    for (let k = 0; k < n; k++) {
      const seg = Math.floor(azar() * 86400);
      const ts = new Date(base + dia * 86400000 + seg * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const t = 1 + Math.floor(azar() * 15);
      const dur = azar() < 0.15 ? 5 + Math.floor(azar() * 24) : 30 + Math.floor(azar() * 270);
      out.push(p(ts, `G${t}`, dur, { artista: `Artista Inventado G${1 + (t % 5)}`, skipped: azar() < 0.05 }));
    }
  }
  return out;
}
export const GENERADO = generar();

// ── El panel de `#calendario`: un año mínimo y un detalle hecho a mano ─────────
// Tres días: el 05/03 con detalle; el 06/03 con minutos y sin detalle; el 07/03 sin nada. Un nombre con
// `&` y `<` para que el escape cuente; un tema con `veces: 0` y otro sin id, que la lista no enseña.
const minMarzo = Array.from({ length: 31 }, (_, i) => (i === 4 ? 21.5 : i === 5 ? 40 : i === 6 ? 0 : (i * 7) % 50));
export const PANEL_STATS = {
  years: [{ year: 2024, min: minMarzo.reduce((a, b) => a + b, 0), plays: 321, days: { from: '2024-03-01', min: minMarzo } }],
};
export const PANEL_DETALLE = {
  version: 1,
  generated_at: '2026-11-14T00:00:00Z',
  temas: [
    ['t131panelA', 'Tema & <Inventado> Uno', 'Artista Inventado Uno'],
    ['t131panelB', 'Tema Inventado Dos', 'Artista Inventado Dos'],
    ['t131panelC', 'Tema Inventado Tres', 'Artista Inventado Uno'],
    ['', 'Tema Sin Id', 'Artista Inventado Tres'],
    ['t131panelE', 'Tema Inventado Cinco', 'Artista Inventado Tres'],
  ],
  dias: {
    '2024-03-05': { min: 21.5, crudas: 9, validas: 6, saltos: 2, temas: [[1, 4, 1], [0, 12.5, 3], [3, 2, 1], [2, 3, 1], [4, 0, 0]] },
  },
};
export const PANEL_DIAS = ['2024-03-05', '2024-03-06', '2024-03-07'];
