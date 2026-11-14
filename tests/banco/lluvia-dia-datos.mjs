// Los datos de mentira de `banco/lluvia-dia.html` (v=368, tanda 131): qué escuchaste un día de lluvia.
//
// 🔴 TODO INVENTADO: los minutos, la lluvia, los temas, los artistas y los ids. El repo es público. Esto
// NO es el historial de nadie ni la lluvia de ningún sitio.
//
// 120 días desde el 01/01/2023 (k = 0…119). Los días PARES llueven (1 + k mod 7 mm: de 1 a 7); los impares,
// 0,4 mm (no cuentan). Los minutos, `(13·k) mod 90 + 5`, salvo los k ≡ 4 (mod 10), que son 0, y el k = 118
// (29/04/2023), que son 15: el día del detalle sembrado.
//
// La ventana deja fuera el primero y el último (k = 0 y 119), así que los días con lluvia son los pares de
// 2 a 118: 59, del 29/04/2023 (k = 118) al 03/01/2023 (k = 2). En páginas de 25: 25, 50 y 59.
const DESDE = Date.UTC(2023, 0, 1);
const iso = (k) => new Date(DESDE + k * 86400000).toISOString().slice(0, 10);
export const DIAS = Array.from({ length: 120 }, (_, k) => {
  const mm = k % 2 === 0 ? 1 + (k % 7) : 0.4;
  const min = k === 118 ? 15 : k % 10 === 4 ? 0 : ((13 * k) % 90) + 5;
  return [iso(k), min, mm];
});

export const DIAS_LOCAL = {
  version: 1, zona_horaria: 'America/Argentina/Buenos_Aires', utc_offset_seconds: -10800,
  generated_at: '2026-11-14T00:00:00Z', from: DIAS[0][0], min: DIAS.map((d) => d[1]),
};
export const LLUVIA = {
  version: 1, lugar: 'Sitio Inventado', desde: DIAS[0][0], hasta: DIAS[DIAS.length - 1][0], dias: DIAS.length,
  mm: DIAS.map((d) => d[2]),
  aviso: 'Aviso inventado para el banco: un modelo, no un pluviómetro.',
  atribucion: 'Datos meteorológicos de Open-Meteo.com (https://open-meteo.com), licencia CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).',
};

// El detalle: tres reproducciones alrededor del 29/04/2023, para que el día UTC y el local DIFIERAN.
//   Dos  20:00Z del 29/04 → local 29/04 17:00 · UTC 29/04 · 300 s (5 min)
//   Uno  01:00Z del 30/04 → local 29/04 22:00 · UTC 30/04 · 600 s (10 min)
//   Tres 02:00Z del 29/04 → local 28/04 23:00 · UTC 29/04 · 420 s (7 min)
// El 29/04 LOCAL: Dos y Uno (15 min, lo mismo que `DIAS_LOCAL` ese día). El 29/04 UTC: Tres y Dos.
const play = (ts, n, artista, seg) => ({
  ts, ms_played: seg * 1000,
  master_metadata_track_name: `Tema Inventado ${n}`,
  master_metadata_album_artist_name: artista,
  master_metadata_album_album_name: `Disco Inventado ${n}`,
  spotify_track_uri: `spotify:track:t131banco${n}`,
  reason_end: 'trackdone', skipped: false,
});
export const PLAYS_DETALLE = [
  play('2023-04-29T20:00:00Z', 'Dos', 'Artista Inventado Sur', 300),
  play('2023-04-30T01:00:00Z', 'Uno', 'Artista Inventado Norte', 600),
  play('2023-04-29T02:00:00Z', 'Tres', 'Artista Inventado Oeste', 420),
];

// ═══════════════════════════════════════════════════════════════════════════
// LA CUENTA, A MANO
// ═══════════════════════════════════════════════════════════════════════════
const fmtDia = (d) => {
  const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${+d.slice(8, 10)} ${M[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
};
const coma1 = (x) => x.toFixed(1).replace('.', ',');
/** «Todos los días con lluvia», del más nuevo al más viejo: `[fecha, «X,Y mm», «N min»]`. */
export const TODOS = DIAS.slice(1, -1).filter((d) => d[2] >= 1).reverse().map(([d, min, mm]) => [fmtDia(d), `${coma1(mm)} mm`, `${Math.round(min)} min`]);

export const ESPERADO = {
  cuantos: 59,
  paginas: [25, 50, 59],
  primero: '29 abr 2023', ultimo: '3 ene 2023',
  // El panel del 29/04 LOCAL.
  diaDetalle: '2023-04-29',
  cabecera: '7,0 mm · 15 min',
  artistas: [['Artista Inventado Norte', '10m'], ['Artista Inventado Sur', '5m']],
  temas: ['Tema Inventado Dos', 'Tema Inventado Uno'],
  temaUtc: 'Tema Inventado Tres',     // está en el 29/04 UTC y NO en el local: si sale, se leyó dias[iso]
  diaSinEntrada: '2023-04-27',          // llueve, tiene minutos y no está en diasLocal
  diaNada: '2023-04-15',                // llueve y no sonó nada (k = 104)
  textos: {
    nada: 'Ese día no sonó nada.',
    viejo: 'Tu detalle por día se cargó con una versión anterior de la app y no sabe separar los días a la hora de Mar del Plata. Vuelve a cargarlo desde tu export para verlo aquí.',
    sin: 'Qué sonó cada día vive solo en tu navegador y todavía no está cargado.',
    sinDia: 'El detalle cargado no tiene este día: vuelve a cargarlo desde tu export.',
    boton: 'Cargar el detalle por día desde tu export',
  },
};
