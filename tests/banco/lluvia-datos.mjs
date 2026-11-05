// Los datos de mentira de `banco/lluvia.html` (v=358, tanda 117).
//
// 🔴 TODO INVENTADO: los minutos y la lluvia de cada día. El repo es público. Esto NO es el historial
// de nadie ni la lluvia de ningún sitio. Los sirve `lluvia-caso.html` en lugar de los dos JSON.
//
// `[día, minutos, mm]`. El historial va del 15/12/2020 al 13/01/2021. El primero y el último están
// inflados a propósito (999 min y 99 mm; 888 min y 77 mm): si entraran en la ventana, se nota en
// todos los números y en los más lluviosos.
const DIAS = [
  ['2020-12-15', 999, 99],     // el primero del historial: FUERA de la ventana
  ['2020-12-16', 60, 0],
  ['2020-12-17', 0, 0.9],      // 0,9 mm: NO es un día con lluvia
  ['2020-12-18', 120, 1],      // 1,0 mm: SÍ
  ['2020-12-19', 30, 0],
  ['2020-12-20', 0, 5.5],      // con lluvia y sin música
  ['2020-12-21', 45.5, 0],
  ['2020-12-22', 0, 0],
  ['2020-12-23', 90, 12.3],
  ['2020-12-24', 15, 0.2],     // algo de lluvia, menos de 1 mm: NO
  ['2020-12-25', 200, 0],
  ['2020-12-26', 0, 0],
  ['2020-12-27', 10, 30],      // empata con el 31: va primero, por más viejo
  ['2020-12-28', 75, 0],
  ['2020-12-29', 0, 2],
  ['2020-12-30', 33, 0],
  ['2020-12-31', 66, 30],
  ['2021-01-01', 240, 44.4],
  ['2021-01-02', 0, 0],
  ['2021-01-03', 20, 0],
  ['2021-01-04', 50, 3.3],
  ['2021-01-05', 0, 0],
  ['2021-01-06', 100, 1.5],
  ['2021-01-07', 5, 0],
  ['2021-01-08', 0, 8.8],
  ['2021-01-09', 25, 0],
  ['2021-01-10', 150, 2.2],
  ['2021-01-11', 0, 0],
  ['2021-01-12', 40, 1.1],
  ['2021-01-13', 888, 77],     // el último del historial: FUERA
];

export const DIAS_LOCAL = {
  version: 1, zona_horaria: 'America/Argentina/Buenos_Aires', utc_offset_seconds: -10800,
  generated_at: '2026-11-01T00:00:00Z', from: '2020-12-15', min: DIAS.map((d) => d[1]),
};

// La lluvia arranca antes y termina después que el historial.
const antes = Array.from({ length: 14 }, () => 7);    // 01/12 a 14/12: fuera (no hay historial)
const despues = Array.from({ length: 5 }, () => 66);  // 14/01 a 18/01: fuera
const AVISO = 'Aviso inventado para el banco: un modelo, no un pluviómetro.';
export const LLUVIA = {
  version: 1, lugar: 'Sitio Inventado', desde: '2020-12-01', hasta: '2021-01-18', dias: 49,
  mm: [...antes, ...DIAS.map((d) => d[2]), ...despues],
  aviso: AVISO,
  atribucion: 'Datos meteorológicos de Open-Meteo.com (https://open-meteo.com), licencia CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Reanálisis generado a partir de información del Copernicus Climate Change Service.',
};

// ═══════════════════════════════════════════════════════════════════════════
// LA CUENTA, HECHA A MANO (no con el código)
// ═══════════════════════════════════════════════════════════════════════════
//
// La ventana: del 16/12/2020 al 12/01/2021 = 28 días.
//
// CON LLUVIA (≥ 1 mm), 12 días: 120, 0, 90, 10, 0, 66, 240, 50, 100, 0, 150, 40 → Σ 866 min.
//   Sonó algo en 9 de 12: 75,0 %. Media 866 / 12 = 72,16… → 722 décimas (72,2) → «72».
//   Mediana: ordenados 0, 0, 0, 10, 40, 50, 66, 90, 100, 120, 150, 240 → (50 + 66) / 2 = 58 → «58».
//
// SIN LLUVIA, 16 días: 60, 0, 30, 45,5, 0, 15, 200, 0, 75, 33, 0, 20, 0, 5, 25, 0 → Σ 508,5 min.
//   Sonó algo en 10 de 16: 62,5 %. Media 508,5 / 16 = 31,78… → 318 décimas (31,8) → «32».
//   Mediana: seis ceros y 5, 15, 20, 25, 30, 33, 45,5, 60, 75, 200 → (15 + 20) / 2 = 17,5 → «18».
//
// La diferencia: 722 − 318 = 404 décimas = 40,4 → 40 min más.
export const ESPERADO = {
  linea: 'Del 16 dic 2020 al 12 ene 2021: 28 días. Un día con lluvia es uno con 1 mm o más.',
  con: { dias: '12', sono: '9', pct: '75,0 %', media: '72', mediana: '58' },
  sin: { dias: '16', sono: '10', pct: '62,5 %', media: '32', mediana: '18' },
  frase: 'Los días con lluvia escuchas de media 40 min más que los días sin lluvia.',
  causa: 'Esto compara días: no dice que la lluvia sea la causa.',
  // 2020: con 120, 0, 90, 10, 0, 66 = 286 / 6 = 47,66… → «48»; sin 458,5 / 10 = 45,85 → 459 décimas → «46».
  // 2021: con 240, 50, 100, 0, 150, 40 = 580 / 6 = 96,66… → «97»; sin 50 / 6 = 8,33… → «8».
  anios: [['2020', '6', '48', '46'], ['2021', '6', '97', '8']],
  lluviosos: [
    ['1 ene 2021', '44,4 mm', '240 min'],
    ['27 dic 2020', '30,0 mm', '10 min'],
    ['31 dic 2020', '30,0 mm', '66 min'],
    ['23 dic 2020', '12,3 mm', '90 min'],
    ['8 ene 2021', '8,8 mm', '0 min'],
    ['20 dic 2020', '5,5 mm', '0 min'],
    ['4 ene 2021', '3,3 mm', '50 min'],
    ['10 ene 2021', '2,2 mm', '150 min'],
    ['29 dic 2020', '2,0 mm', '0 min'],
    ['6 ene 2021', '1,5 mm', '100 min'],
  ],
  aviso: AVISO,
  credito: 'Datos meteorológicos de Open-Meteo.com, licencia CC BY 4.0. Reanálisis generado a partir de información del Copernicus Climate Change Service.',
  enlaces: [['Open-Meteo.com', 'https://open-meteo.com/'], ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/']],
};

/** El `stats` importado de un amigo: lo mínimo para que `hasLocalHistory()` diga que sí. */
export const AMIGO_STATS = { years: [{ year: 2020, min: 10, plays: 3 }], totals: { plays_valid: 3 } };
