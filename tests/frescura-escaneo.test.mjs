// Suite «la vista pinta lo que ya está pagado» (v=262).
//
// Con el caché del escaneo (7 días) vencido o perdido, #new-releases y
// #discover-artists abrían VACÍAS (desde v=261 nada las repuebla solo) aunque las
// 351 bases de discografías siguieran en IndexedDB: 805 peticiones y una cuota.
// El caché de escaneo es la MARCA de «cuándo miré si salió algo nuevo», no los
// datos. Ahora la vista pinta desde la base, sin red, y dice en qué estado está.
//
// Lo que corre de verdad: `util/frescura-escaneo.js` (el estado, el texto y la
// marca que impide que un escaneo parcial rejuvenezca la fecha). Lo que depende
// del DOM y de IndexedDB se cuida LEYENDO EL FUENTE, con guardas del guarda: que
// el camino de apertura no pueda llegar a la red, que no se lea el caché con la
// lectura que lo BORRA, y que las dos vistas estén cableadas igual.

process.env.TZ = 'Europe/Madrid';   // las fechas de la cabecera van en hora local

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

const {
  SCAN_TTL_MS, escaneoVencido, estadoFrescura, textoFrescura, haceCuanto, fechaCorta, crearMarcasDeFrescura,
} = await import('../src/js/util/frescura-escaneo.js');

const DIA = 24 * 60 * 60 * 1000;
const HOY = new Date('2026-09-30T12:00:00+02:00').getTime();

// ── 1. ¿Vencido? ──────────────────────────────────────────────────────────
eq(SCAN_TTL_MS, 7 * DIA, 'el caché del escaneo dura 7 días');
eq(escaneoVencido({ ts: HOY - 6 * DIA, expiry: HOY + DIA }, HOY), false, 'de hace 6 días, con expiry por delante: vigente');
eq(escaneoVencido({ ts: HOY - 8 * DIA, expiry: null }, HOY), true, 'de hace 8 días: vencido aunque no traiga expiry');
eq(escaneoVencido({ ts: HOY - DIA, expiry: HOY - 1 }, HOY), true, 'el expiry del envoltorio pasado manda aunque el ts sea reciente');
eq(escaneoVencido({ ts: null, expiry: HOY + DIA }, HOY), true, 'sin fecha no se puede decir que está al día');
eq(escaneoVencido({ ts: 0, expiry: HOY + DIA }, HOY), true, 'ts 0 es «no consta», no «1970»');
eq(escaneoVencido({ ts: HOY - 7 * DIA + 1000, expiry: null }, HOY), false, 'a un segundo de cumplir los 7 días sigue vigente');

// ── 2. Los tres estados ──────────────────────────────────────────────────
{
  const vigente = { ts: HOY - 2 * DIA, vencido: false };
  eq(estadoFrescura({ guardado: vigente, nConBase: 351 }), { estado: 'al-dia', ts: HOY - 2 * DIA }, 'caché vigente: al día, con su fecha');
  eq(estadoFrescura({ guardado: vigente, nConBase: 0 }).estado, 'al-dia', 'vigente es al día aunque no se haya podido pintar ninguna base');

  const vencido = { ts: HOY - 9 * DIA, vencido: true };
  eq(estadoFrescura({ guardado: vencido, nConBase: 351, recienteMax: HOY - 1 * DIA }), { estado: 'vencida', ts: HOY - 9 * DIA },
    'vencido con bases: se pinta y dice la fecha de ESE caché, no la del recienteAt');
  eq(estadoFrescura({ guardado: null, nConBase: 351, recienteMax: HOY - 3 * DIA }), { estado: 'vencida', ts: HOY - 3 * DIA },
    'sin caché (perdido) con bases: vencida, con la fecha más nueva en que se miró lo reciente');
  eq(estadoFrescura({ guardado: null, nConBase: 351, recienteMax: null }), { estado: 'vencida', ts: null },
    'sin caché y sin recienteAt: vencida y se dice que no consta la fecha');
  eq(estadoFrescura({ guardado: vencido, nConBase: 0 }), { estado: 'sin-base', ts: null }, 'vencido y sin ninguna base: no hay nada que pintar');
  eq(estadoFrescura({ guardado: null, nConBase: 0 }), { estado: 'sin-base', ts: null }, 'nada de nada: sin base');
}

// ── 3. La línea de la cabecera ───────────────────────────────────────────
{
  const t = textoFrescura(HOY - 8 * DIA, HOY);
  ok(/guardado en este navegador/.test(t), 'dice que lo que se ve es lo guardado');
  ok(/hace 8 días/.test(t) && /22 sept/.test(t), `dice cuándo: «${t}»`);
  ok(/puede faltar/.test(t), 'dice que puede faltar lo reciente');
  ok(/no consta/.test(textoFrescura(null, HOY)) && !/hace/.test(textoFrescura(null, HOY)), 'sin fecha no inventa una');
  ok(/no consta/.test(textoFrescura(0, HOY)), 'ts 0 tampoco es una fecha');
  // Copy de España: «solo» sin tilde y nada de voseo.
  for (const s of [t, textoFrescura(null)]) {
    ok(!/sólo|tenés|podés|acá\b/.test(s), 'castellano de España');
  }
  eq(haceCuanto(HOY, HOY), 'hoy', 'hoy');
  eq(haceCuanto(HOY - DIA, HOY), 'ayer', 'ayer');
  eq(haceCuanto(HOY - 8 * DIA, HOY), 'hace 8 días', 'hace 8 días');
  eq(haceCuanto(new Date('2026-09-29T23:50:00+02:00').getTime(), new Date('2026-09-30T00:10:00+02:00').getTime()), 'ayer',
    'cuenta días de CALENDARIO: 20 minutos pueden ser «ayer»');
  eq(fechaCorta(new Date('2026-09-03T10:00:00+02:00').getTime()), '3 sept', 'la fecha corta es «3 sept»');
}

// ── 4. La marca que impide rejuvenecer la fecha ──────────────────────────
{
  const m = crearMarcasDeFrescura();
  const AHORA = HOY;
  eq(m.de('nr'), null, 'sin marca: la frescura está al día');
  eq(m.tsAlGuardar('nr', AHORA), AHORA, 'sin marca se guarda con la hora de ahora (un escaneo completo)');

  m.fijar('nr', HOY - 9 * DIA);
  eq(m.de('nr'), HOY - 9 * DIA, 'con marca se sabe la fecha vieja');
  eq(m.tsAlGuardar('nr', AHORA), HOY - 9 * DIA,
    'un escaneo PARCIAL guardado con la marca puesta NO adelanta la fecha (si no, la próxima apertura diría «al día» con 350 sin mirar)');
  eq(m.tsAlGuardar('da', AHORA), AHORA, 'la marca es por vista: la otra sigue guardando con la hora de ahora');

  m.fijar('nr', undefined);
  eq(m.de('nr'), null, 'fijar con null/undefined suelta la marca (render con caché vigente)');

  m.fijar('nr', null);
  eq(m.tsAlGuardar('nr', AHORA), AHORA, 'suelta con null');

  m.fijar('nr', HOY - DIA);
  m.soltar('nr');
  eq(m.tsAlGuardar('nr', AHORA), AHORA, '«Actualizar» (clearScanCache) suelta la marca: el siguiente guardado es una comprobación de verdad');

  // Sin fecha conocida: se guarda 0 («no consta»), y 0 NO es una fecha buena.
  m.fijar('nr', 0);
  eq(m.tsAlGuardar('nr', AHORA), 0, 'sin fecha conocida se guarda 0, no la de ahora');
  eq(escaneoVencido({ ts: m.tsAlGuardar('nr', AHORA), expiry: HOY + DIA }, HOY), true, 'y un caché guardado con 0 se lee como vencido');
  m.fijar('nr', NaN);
  eq(m.de('nr'), 0, 'un valor que no es fecha se guarda como 0');
}

// ── 5. El fuente: el camino de apertura no puede llegar a la red ─────────
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const leer = (p) => sinComentarios(readFileSync(new URL(`../src/js/${p}`, import.meta.url), 'utf8'));
const common = leer('features/discover-common.js');
const VISTAS = { 'new-releases.js': leer('features/new-releases.js'), 'discover-artists.js': leer('features/discover-artists.js') };

function cuerpo(src, cabecera) {
  const i = src.indexOf(cabecera);
  if (i < 0) return null;
  const j = src.indexOf(') {', i) + 2;   // el `{` del cuerpo, no el de un parámetro desestructurado
  let d = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) break; }
  }
  return src.slice(i, k + 1);
}

// Todo lo que puede salir a Spotify desde discover-common.js.
const RED = ['getArtistAlbumsConFuente', 'buscarDiscografiaPorNombre', 'searchArtistByName', 'getAlbumTracks',
  'getArtistIdCached', 'getArtistDiscoCached', 'refrescarReciente', 'fetch(', 'spotifyFetch', 'saveToLibrary',
  'createPlaylist', 'addTracksToPlaylist'];

const restaurar = cuerpo(common, 'export async function restaurarDesdeLaBase');
ok(restaurar && restaurar.length > 400, 'se encontró restaurarDesdeLaBase (guarda del guarda)');
for (const r of RED) ok(!restaurar.includes(r), `restaurarDesdeLaBase no toca la red: no nombra ${r}`);
ok(restaurar.includes('leerBase('), 'lee la base con leerBase');
ok(restaurar.includes('idbGet('), 'el id guardado se lee CRUDO con idbGet');
ok(!restaurar.includes('idbGetCached'), 'y NO con idbGetCached, que borra lo vencido al leerlo');

const leerGuardado = cuerpo(common, 'export async function leerEscaneoGuardado');
ok(leerGuardado && leerGuardado.length > 150, 'se encontró leerEscaneoGuardado (guarda del guarda)');
ok(leerGuardado.includes('idbGet(') && !leerGuardado.includes('idbGetCached') && !leerGuardado.includes('idbDel'),
  'leerEscaneoGuardado lee CRUDO: ni idbGetCached ni idbDel (la lectura vieja borraba el caché vencido, y con él la fecha)');

const guardar = cuerpo(common, 'export async function saveScanCache');
ok(guardar.includes('marcasFrescura.tsAlGuardar(viewKey)') && !/ts:\s*Date\.now\(\)/.test(guardar),
  'saveScanCache guarda con tsAlGuardar y no con Date.now() a secas');
const limpiar = cuerpo(common, 'export async function clearScanCache');
ok(limpiar.includes('marcasFrescura.soltar(viewKey)'), 'clearScanCache suelta la marca');
ok(limpiar.indexOf('soltar') < limpiar.indexOf('idbDel'), 'y la suelta ANTES de tirar el caché');

// El `render()` de cada vista.
for (const [nombre, src] of Object.entries(VISTAS)) {
  const render = cuerpo(src, 'export async function render');
  ok(render && render.length > 1500, `${nombre}: se encontró render() (guarda del guarda)`);
  ok(render.includes('leerEscaneoGuardado(SCAN_KEY)'), `${nombre}: lee el escaneo guardado CRUDO`);
  ok(!/\bloadScanCache\b/.test(src), `${nombre}: ya no usa loadScanCache (que borra el caché vencido al leerlo)`);
  ok(render.includes('restaurarDesdeLaBase('), `${nombre}: pinta desde la base`);
  ok(render.includes('estadoFrescura('), `${nombre}: decide la frescura con estadoFrescura`);
  ok(/fijarFrescuraVencida\(SCAN_KEY,\s*frescura\.estado === 'vencida'/.test(render), `${nombre}: fija la marca solo en el estado 'vencida'`);
  ok(/guardado && !guardado\.vencido/.test(render), `${nombre}: solo restaura del caché el que sigue vigente`);
  // Orden: leer → restaurar de la base → renderShell (la línea sale en el marcado).
  ok(render.indexOf('restaurarDesdeLaBase(') < render.indexOf('renderShell('), `${nombre}: la base se lee ANTES de armar el marcado`);
  for (const r of ['scanArtists(', 'getArtistDiscoCached(', 'getArtistIdCached(', 'buscarDiscografiaPorNombre(', 'fetch(']) {
    ok(!render.includes(r), `${nombre}: render() no nombra ${r}`);
  }
  ok(src.includes('avisoFrescuraHtml(') && src.includes('conectarAvisoFrescura(') && src.includes('repintarAvisoFrescura('),
    `${nombre}: la línea está en el marcado, conectada y se repinta`);
}
// La de #discover-artists parte lo no escuchado de lo que viene de la base.
{
  const render = cuerpo(VISTAS['discover-artists.js'], 'export async function render');
  ok(/alRestaurar:[\s\S]{0,400}albumIsUnheard\(/.test(render),
    '#discover-artists calcula `unheard` de lo que viene de la base (no pasó por processArtist)');
}
// El botón de la línea aprieta el «Actualizar» de la vista: un solo camino que gasta.
{
  const conectar = cuerpo(common, 'export function conectarAvisoFrescura');
  ok(conectar.includes('.click()') && conectar.includes('refreshId'), 'el botón de la línea aprieta el «Actualizar» de la vista');
  for (const r of RED) ok(!conectar.includes(r), `el botón de la línea no pide nada por su cuenta: no nombra ${r}`);
}

console.log(`OK — ${n} asserts`);
