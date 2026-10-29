// Datos INVENTADOS para el banco de la postal del año (v=326, tanda 73). El repo es público: ningún
// nombre ni número de acá es de nadie. Desde v=344 la postal no lleva tapas ni nombres: las tapas y los
// nombres largos siguen acá porque los pinta la TARJETA del año (y la puerta J mira que la postal no pida
// las de 2023). Lo que la postal usa de cada año es `days`, `min`, `longest_streak` y `peak_day`.
//
// Tres años:
//   · 2025 arranca `2025-01-01T00:00:28Z` (la trampa del 31 dic en UTC−3) y termina el 30/09; sus cinco
//     tapas son BUENAS (las fabrica `tapasInventadas()` con un <canvas>, como `data:` URL: no hay ningún
//     PNG en el repo y no sale nada a la red) y su primer artista y su primer disco tienen un nombre muy
//     largo, para el recorte;
//   · 2024 arranca a mitad de año (15/06) y dos de sus cinco tapas FALLAN de verdad, por la red: una es
//     un 404 del propio servidor del banco y la otra es `atardecer-prueba.png` (un archivo que ya está en
//     el banco) pedida desde OTRO origen (`localhost` en vez de `127.0.0.1`, el mismo puerto), que el
//     servidor contesta sin `access-control-allow-origin`: con `mode: 'cors'` el `fetch` se rechaza;
//   · 2023 (v=327, la puerta J) trae las cinco `img` con la FORMA del CDN de Spotify, como el JSON del
//     repo: `http://localhost:<puerto>/image/ab67616d0000b273<24 hex INVENTADOS>` (la de 640). La postal
//     tiene que pedir la de 300 (`ab67616d00001e02`), que es lo único que el servidor del banco sirve
//     (con CORS; cualquier otro prefijo es un 404, ver `scripts/dev-server.mjs`). Los seis primeros hex
//     del final son el color de la tapa (`COLORES_CDN`).

export const LARGO = 'Orquesta Imaginaria de los Martes por la Tarde y Sus Amigos Ficticios del Barrio';
export const COLORES_TAPA = [[220, 70, 60], [60, 140, 220], [240, 190, 40], [70, 180, 110], [180, 90, 200]];
export const COLORES_CDN = [[200, 60, 140], [40, 160, 160], [230, 120, 30], [90, 90, 210], [150, 200, 60]];
const hex2 = (v) => v.toString(16).padStart(2, '0');
/** Las cinco `img` de 2023, con la forma del CDN y la variante de 640 (la postal pide la de 300). */
export const urlsCdn = (puerto) => COLORES_CDN.map((c, i) => `http://localhost:${puerto}/image/ab67616d0000b273${c.map(hex2).join('')}${'0'.repeat(17)}${i}`);

/** Las cinco tapas buenas: 300×300, un color liso con una franja diagonal más oscura, como `data:` URL. */
export function tapasInventadas(doc = document) {
  return COLORES_TAPA.map(([r, g, b]) => {
    const c = doc.createElement('canvas');
    c.width = c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = `rgb(${r},${g},${b})`;
    x.fillRect(0, 0, 300, 300);
    x.strokeStyle = `rgb(${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)})`;
    x.lineWidth = 56;
    x.beginPath(); x.moveTo(0, 0); x.lineTo(300, 300); x.stroke();
    return c.toDataURL('image/png');
  });
}

export const urlTapa404 = (origen) => `${origen}/banco/postal-tapa-que-no-existe.png`;
export const urlTapaAjena = (puerto) => `http://localhost:${puerto}/banco/atardecer-prueba.png`;

const ARTISTAS = ['Banda Inventada Dos', 'Coro de Mentira', 'Dúo Ficticio', 'Solista Imaginaria', 'Trío de Prueba', 'Grupo Sexto'];

function dias(desde, n, semilla) {
  const min = [];
  let s = semilla;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; min.push(s % 7 === 0 ? 0 : Math.round((s % 4000) / 10) / 1); }
  return { from: desde, min };
}

function anio({ year, first, last, n, tapas, semilla }) {
  const top_artists = [LARGO, ...ARTISTAS].slice(0, 6).map((name, i) => ({ name, min: 9000 - i * 1100, plays: 900 - i * 90 }));
  const top_albums = tapas.map((img, i) => ({
    name: i === 0 ? LARGO : `Disco Inventado ${i + 1}`,
    artist: i === 0 ? LARGO : ARTISTAS[i - 1],
    min: 3000 - i * 300, plays: 300 - i * 30, img,
  }));
  const top_tracks = [1, 2, 3, 4, 5].map((i) => ({ name: `Tema Inventado ${i}`, artist: ARTISTAS[i % ARTISTAS.length], min: 400 - i * 30, plays: 80 - i * 5, uri: `spotify:track:${String(i).padStart(22, 'x')}` }));
  return {
    year, min: 61234.5, plays: 12345, days_active: 234, longest_streak: 47, skip_pct: 55.5,
    first_play: first, last_play: last,
    peak_day: { date: `${year}-03-09`, min: 668.4 },
    peak_month: { month: 3, min: 9000 },
    discovery: { artist: 'Coro de Mentira', min: 1200 },
    days: dias(first.slice(0, 10), n, semilla),
    top_artists, top_albums, top_tracks,
    plays_raw: 20000, skips: 9000, plays_junk: 10,
  };
}

// Para las postales de ejemplo (v=327, `postal-caso.html?modo=foto&datos=…`): nombres muy largos en los
// cinco discos y en los artistas, o un año con 2 artistas y 3 discos. Inventados, como todo lo de acá.
const DISCOS_LARGOS = [
  LARGO,
  'Canciones Inventadas Para Una Tarde Muy Larga De Domingo En La Costa',
  'El Disco Imaginario De Las Luces Que Nunca Se Apagaron Del Todo',
  'Volumen Dos: Grabaciones Ficticias Del Sótano De Un Amigo Lejano',
  'Sesiones Perdidas Y Encontradas De Una Banda Que Nunca Existió',
];
const ARTISTAS_LARGOS = ['Conjunto Instrumental Imaginario De La Calle Sin Nombre', 'Los Hermanos Ficticios Y Su Orquesta De Prueba Del Lunes', 'Coro Municipal Inventado De Un Pueblo Que No Está', 'Solista Imaginaria Con Un Nombre Larguísimo De Prueba'];
function variar(y, variante) {
  if (variante === 'largos') {
    return {
      ...y,
      top_artists: y.top_artists.map((a, i) => (i === 0 ? a : { ...a, name: ARTISTAS_LARGOS[(i - 1) % 4] })),
      top_albums: y.top_albums.map((a, i) => ({ ...a, name: DISCOS_LARGOS[i], artist: i === 0 ? LARGO : ARTISTAS_LARGOS[(i - 1) % 4] })),
    };
  }
  if (variante === 'chico') return { ...y, top_artists: y.top_artists.slice(0, 2), top_albums: y.top_albums.slice(0, 3) };
  return y;
}

/** El `history-stats.json` inventado. `tapas` son las cinco buenas; `origen` y `puerto`, los del banco; `variante`, la de las postales de ejemplo. */
export function statsInventadas({ tapas, origen, puerto, variante = null }) {
  const y2024 = anio({ year: 2024, first: '2024-06-15T13:00:00Z', last: '2024-12-31T01:30:00Z', n: 200, semilla: 7,
    tapas: [tapas[0], urlTapa404(origen), urlTapaAjena(puerto), tapas[3], tapas[4]] });
  const y2023 = anio({ year: 2023, first: '2023-02-01T10:00:00Z', last: '2023-12-31T22:00:00Z', n: 334, semilla: 5, tapas: urlsCdn(puerto) });
  const y2025 = variar(anio({ year: 2025, first: '2025-01-01T00:00:28Z', last: '2025-09-30T02:10:00Z', n: 273, semilla: 11, tapas }), variante);
  const meses = [];
  for (const [y, desde, hasta] of [[2023, 2, 12], [2024, 6, 12], [2025, 1, 9]]) for (let m = desde; m <= hasta; m++) meses.push({ m: `${y}-${String(m).padStart(2, '0')}`, min: 5000 + m * 100 });
  return {
    version: 5, generated_at: '2031-01-01T00:00:00Z',
    totals: { plays_valid: 24690, plays_raw: 40000, min: 122469, days_active: 468, longest_streak: 47, unique_artists: 7, unique_albums: 9, unique_tracks: 5, skip_pct: 55.5, plays_junk: 20 },
    years: [y2023, y2024, y2025],
    monthly: meses,
    heatmap: {},
    top_artists_all_time: y2025.top_artists.map((a) => ({ ...a, first_year: 2024 })),
    top_albums_all_time: y2025.top_albums,
    top_tracks_all_time: y2025.top_tracks,
  };
}

/** Lo que la postal de 2025 tiene que decir (contado acá, a mano). Desde v=344, «El año en días»: el año, los
 *  minutos, la racha, el día pico y el pie (el rango, las reproducciones y los días con música ya no van). */
export const ESPERADO_2025 = {
  archivo: 'fonoteca-2025.png',
  min: '1020h 35m',
  racha: '47 días',
  pico: '9 mar 2025',
  picoEt: 'día pico · 11h 8m',
  pie: 'Fonoteca · 2025',
};
