// Datos INVENTADOS para el banco `siempre-y-play` (tanda 119, v=360). El repo es público: ningún nombre ni número de
// acá es de nadie.

const anio = (year, n) => ({
  year, min: 12000 * n, plays: 1500 * n, days_active: 100 + n, longest_streak: 10 + n, skip_pct: 20 + n,
  first_play: `${year}-01-02T10:00:00Z`, last_play: `${year}-12-30T10:00:00Z`,
  peak_day: { date: `${year}-03-09`, min: 400 }, peak_month: { month: 3, min: 1800 },
  discovery: { artist: 'Coro de Mentira', min: 120 },
  days: { from: `${year}-01-02`, min: Array.from({ length: 363 }, (_, i) => (i * 37) % 300) },
  top_artists: [{ name: 'Banda Cinco Inventada', min: 900, plays: 90 }, { name: 'Coro de Mentira', min: 800, plays: 80 }, { name: 'Solista Imaginaria', min: 700, plays: 70 }],
  top_albums: [{ name: `Disco Inventado ${year}`, artist: 'Banda Cinco Inventada', min: 500, plays: 50, img: null }],
  top_tracks: [{ name: 'Primer Tema Inventado', artist: 'Banda Cinco Inventada', min: 200, plays: 40, uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaa1' }],
  plays_raw: 3000 * n, skips: 900 * n, plays_junk: n,
});

export function statsInventadas() {
  return {
    version: 5, generated_at: '2031-01-01T00:00:00Z',
    totals: { plays_valid: 9000, plays_raw: 18000, min: 72000, days_active: 309, longest_streak: 13, unique_artists: 40, unique_albums: 60, unique_tracks: 300, skip_pct: 31.4 },
    years: [anio(2022, 1), anio(2023, 2), anio(2024, 3)],
    monthly: [],
    heatmap: {},
    top_artists_all_time: [
      { name: 'Banda Cinco Inventada', min: 3000, plays: 300, first_year: 2022 },
      { name: 'Dúo Dos Inventado', min: 300, plays: 30, first_year: 2022 },
      { name: 'Artista Sin Temas Inventado', min: 200, plays: 20, first_year: 2023 },
    ],
    top_albums_all_time: [{ name: 'Disco Inventado de Siempre', artist: 'Banda Cinco Inventada', min: 1500, plays: 150, img: null }],
    top_tracks_all_time: [{ name: 'Tema Inventado de Siempre', artist: 'Banda Cinco Inventada', min: 600, plays: 120, uri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaa1' }],
  };
}

export const TEMAS_CINCO = ['Primer Tema Inventado', 'Segundo Tema Inventado', 'Tercer Tema Inventado', 'Cuarto Tema Inventado', 'Quinto Tema Con Un Nombre Larguísimo Que No Entra En La Fila De Ninguna Manera'];
export const TEMAS_DOS = ['Sol Inventado', 'Luna Inventada'];
// Este tema no lo tiene el iTunes simulado (y Deezer no se contesta): sale «Sin preview».
export const SIN_PREVIEW = 'Cuarto Tema Inventado';

export function indiceInventado() {
  const id = (p, i) => `${p.repeat(21)}${i + 1}`;
  return {
    artists: {
      'Banda Cinco Inventada': TEMAS_CINCO.map((n, i) => [n, 50 - i * 5, 300 - i * 30, id('a', i)]),
      'Dúo Dos Inventado': TEMAS_DOS.map((n, i) => [n, 30 - i * 5, 150 - i * 30, id('b', i)]),
    },
    totals: {},
  };
}

/** Lo que contesta el iTunes simulado: el tema pedido, del artista pedido, salvo `SIN_PREVIEW`. */
export function itunesInventado(url) {
  const termino = url.searchParams.get('term') || '';
  const artista = ['Banda Cinco Inventada', 'Dúo Dos Inventado'].find((a) => termino.startsWith(a));
  const tema = [...TEMAS_CINCO, ...TEMAS_DOS].find((t) => termino.endsWith(t));
  if (!artista || !tema || tema === SIN_PREVIEW) return { results: [] };
  return { results: [{ trackName: tema, artistName: artista, previewUrl: `/banco/preview-inventado-${encodeURIComponent(tema)}.m4a` }] };
}
