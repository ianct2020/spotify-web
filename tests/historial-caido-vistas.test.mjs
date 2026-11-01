// tests/historial-caido-vistas.test.mjs — tanda 110 (v=353), T110b.
//
// Las vistas que, con el owner y el historial que no se pudo leer, se escondían, salían vacías o decían algo falso
// sin una palabra. Desde v=353 leen el registro de la tanda 109 (`falloDeLecturaDelHistorial(kind)`, sincrónica)
// después del `await` del cargador y antes de pintar, y ponen la línea de `AVISO_HISTORIAL_ILEGIBLE`.
//
//   · fila 3, `#dashboard` «Del historial de reproducción» (`hydrateHistorySection`): se escondía → se muestra con la
//     línea y sin números.
//   · fila 4, `#dashboard` «Álbumes escuchados por año» (`hydrateListenedYearTiles`): se escondía → la línea.
//   · fila 6, `#covers` sin ningún álbum: «Todavía no hay álbumes en tu historial. Importa el ZIP…» → la línea.
//   · fila 8, la ficha de artista: el cuerpo vacío (stats caído) y «sus temas» sin el índice (artistTracks caído).
//
// `history-data.js`, `history-keys.js`, `artist-card.js` y `covers.js` son los REALES (dobles por
// `tests/dobles/loader-t110.mjs`). Las dos funciones del Dashboard se sacan del FUENTE (`dashboard.js` arrastra media
// app) y se evalúan con sus dependencias a mano, con el `loadHistoryStats` / `loadListenedAlbums` REALES. El `fetch`
// de los JSON del owner es un doble. Datos INVENTADOS (`t110inventada…`).
//
// `T110_SRC` (opcional) apunta a otra copia de `src/` (los rojos contra 27a0e64d).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RAIZ_SRC = process.env.T110_SRC ? resolve(process.env.T110_SRC) : resolve(import.meta.dirname, '../src');
const url = (p) => pathToFileURL(resolve(RAIZ_SRC, p)).href;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';
const OTRO = 't110inventada-otra-cuenta';
const AVISO = 'No se ha podido leer tu historial, así que esta parte sale sin él. Recarga la página para volver a intentarlo.';
const ARTISTA = 'Artista inventado t110';

// Medidos con este mismo test contra la copia de 27a0e64d (v=352), con el historial bien (o sin fallo).
const SHA_352 = {
  dashSano: 'fc1d77f31833fe58a05db543848b8b35043a8d3417a38139159d661df396f3ad',
  dashSinHistorial: 'bd2dd320926ffddb47ce5a9989ab71ab2b16a14adfc36c1ca200adc538fb1f66',
  anioSano: 'ae2a02c929b27abaf80da8fe5cc98c71b0fcb71a2370a50a5088a45a5dfe10fc',
  anioSinHistorial: '5c060207655928bd05d37e58d1b9aac0b579cc1d1f910b6d26b5441d5f876147',
  coversVacio: 'c6b3dd8c4270310a4b2e265f7736fcd187efd5e6df2cad9f97730c6948389c2d',
  artistaSano: 'b2590a06b3d1f425a21a6bb3d2de0bfc409eae65dc934f1253cfa3da8418edcf',
  artistaNoEsta: '0c2c6c8dd3857d3902b7d8a2a1f29b80c2b3612cddc0137f0ff57f167017bb19',
};

const STATS = {
  years: [{ year: 2024, top_artists: [{ name: ARTISTA, min: 90, plays: 20 }], top_tracks: [{ name: 'Tema inventado t110 a', artist: ARTISTA, min: 30, plays: 9, uri: 'spotify:track:t110inventadaa' }] }],
  totals: { min: 6000, plays_valid: 1234, days_active: 50, longest_streak: 7, skip_pct: 12.3, unique_artists: 40 },
  top_albums_all_time: [{ name: 'Disco inventado t110', artist: ARTISTA, min: 120, plays: 30, img: '' }],
  top_artists_all_time: [{ name: ARTISTA, min: 90, plays: 20, first_year: 2024 }],
};
const LISTENED = { years: [{ year: 2024, count: 3, albums: [] }, { year: 2023, count: 1, albums: [] }], criteria: { min_tracks_sameday: 4, min_min_sameday: 25 }, totals: { albums: 4 } };
const ARTIST_TRACKS = { artists: { [ARTISTA]: [['Tema inventado t110 a', 9, 30, 't110inventadaa'], ['Tema inventado t110 b', 4, 12, 't110inventadab']] }, totals: { [ARTISTA]: [13, 42, 2024, 2024, [[2024, 42, 13]], '2024-02-03'] } };

const estado = { me: OWNER, modo: {}, pedidos: [] };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── DOM de mentira: elementos por id y, dentro de cada uno, por selector ──
function crearElemento(nombre) {
  const hijos = new Map();
  const el = {
    nombre, innerHTML: '', textContent: '', style: {}, hidden: false, dataset: {}, onclick: null, isConnected: true,
    classList: { add() {}, remove() {} },
    querySelector: (sel) => { if (!hijos.has(sel)) hijos.set(sel, crearElemento(`${nombre} ${sel}`)); return hijos.get(sel); },
    querySelectorAll: () => [],
    addEventListener() {},
    hijos,
  };
  return el;
}
let porId = new Map();
const getElementById = (id) => { if (!porId.has(id)) porId.set(id, crearElemento('#' + id)); return porId.get(id); };
function foto() {
  const plano = (el) => ({ innerHTML: el.innerHTML, textContent: el.textContent, style: el.style, hidden: el.hidden, hijos: [...el.hijos].sort().map(([k, v]) => [k, plano(v)]) });
  return JSON.stringify([...porId].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, plano(v)]));
}
globalThis.document = { getElementById, addEventListener() {}, querySelectorAll: () => [], documentElement: {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let overlay = null;
globalThis.__T110 = {
  valores: {
    'util/corte-saltos.js:AVISO_MEZCLA': 'mezcla dos formas de contar',
    // `covers.js` los usa al cargarse (fuera de `render`).
    'util/orden-tapas.js:ORDENES_TAPAS': [], 'util/familia-color.js:FAMILIAS': [], 'util/familia-color.js:SIN_COLOR': 'sin-color',
  },
  stubs: {
    'api.js:getCurrentUserId': async () => estado.me,
    'api.js:getBestAvailableLikes': async () => ({ items: [] }),
    'idb.js:idbGetCached': async () => null,
    'idb.js:idbGetCachedRaw': async () => null,
    'idb.js:idbSetCached': async () => {},
    'idb.js:idbDel': async () => {},
    'ui/components.js:escapeHtml': esc,
    'ui/components.js:pageHeader': ({ title }) => `<h1>${title}</h1>`,
    'ui/modal-stack.js:openModal': ({ html }) => { overlay = crearElemento('overlay'); overlay.html = html; return overlay; },
    'ui/skeleton.js:skelCardBody': () => '<div class="skel"></div>',
    'ui/skeleton.js:skelBox': () => '',
    'ui/skeleton.js:skelTrackRows': () => '',
    'util/artist-name.js:firstArtistName': (s) => s,
    'util/artist-name.js:looksLikeArtistChain': () => false,
    'util/artist-name.js:resolveArtistName': (s) => s,
    'util/fecha.js:fmtDia': (s) => s,
    'util/artist-albums.js:albumsDeArtista': async () => [],
    'util/vigencia-ruta.js:vigilarRuta': () => ({ vigente: () => true }),
    'util/album-stats.js:buildAlbumStatsIndex': async () => new Map(),
    'storage.js:prefKey': (k) => k,
    'api/statsfm.js:hasUsername': () => false,
    'ui/preview-player.js:playingKey': () => null,
  },
};

function respuesta(modo, cuerpo) {
  if (modo === '500') return new Response('error inventado t110', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
const CUERPOS = { 'history-stats.json': STATS, 'history-listened-albums.json': LISTENED, 'history-artist-tracks.json': ARTIST_TRACKS, 'history-track-plays.json': { tracks: {}, albums: [] } };
globalThis.fetch = async (u) => {
  const s = String(u);
  estado.pedidos.push(s);
  for (const [archivo, cuerpo] of Object.entries(CUERPOS)) {
    if (s.includes(archivo)) return respuesta(estado.modo[archivo] || 'ok', cuerpo);
  }
  throw new TypeError('doble t110: fetch no esperado ' + s);
};
console.warn = () => {};
console.log = ((log) => (...a) => { if (!/^\[(history-data|covers)\]/.test(String(a[0]))) log(...a); })(console.log);

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/features/history-data.js', '/js/history-keys.js', '/js/features/artist-card.js', '/js/features/covers.js'] },
});
const hd = await import(url('js/features/history-data.js'));
const ac = await import(url('js/features/artist-card.js'));
const covers = await import(url('js/features/covers.js'));
console.log(`src bajo prueba: ${RAIZ_SRC}`);

// ── Las dos funciones del Dashboard, sacadas del fuente ──────────────────
const FUENTE = readFileSync(resolve(RAIZ_SRC, 'js/features/dashboard.js'), 'utf8');
function sacar(nombre) {
  const i = FUENTE.indexOf(`async function ${nombre}(`);
  if (i < 0) throw new Error(`no encuentro ${nombre} en dashboard.js`);
  const f = FUENTE.indexOf('\n}\n', i);
  return FUENTE.slice(i, f + 2);
}
const DEPS = {
  ...hd, document: globalThis.document, armRevealAll() {}, AVISO_MEZCLA: 'mezcla dos formas de contar', pintarGraficosHistorial() {},
  marqueeSpan: (x) => x, escapeHtml: esc, activateMarquee() {}, openAlbumCard() {}, openModal() {}, openHistoryYearModal() {}, _lastHistory: null,
};
function evaluar(nombre) {
  const claves = Object.keys(DEPS);
  return new Function(...claves, `return (${sacar(nombre)});`)(...claves.map((k) => DEPS[k]));
}
const hydrateHistorySection = evaluar('hydrateHistorySection');
const hydrateListenedYearTiles = evaluar('hydrateListenedYearTiles');

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const medidos = {};
function conserva(clave, valor, que) {
  medidos[clave] = sha(valor);
  ok(SHA_352[clave] === medidos[clave], `${que}: el mismo sha256 que en 27a0e64d (${medidos[clave].slice(0, 12)}…)`);
}
async function limpiar(me = OWNER) { estado.me = OTRO; await hd.loadRecords(); estado.me = me; }
async function preparar(modo, me = OWNER) { await limpiar(me); estado.modo = modo; estado.pedidos.length = 0; porId = new Map(); }

const TRIO = [['500', 'Response 500'], ['rechaza', 'fetch rechaza con TypeError'], ['nojson', '200 con HTML (res.json() tira)']];

// ── fila 3: #dashboard, la sección del historial ─────────────────────────
for (const [m, como] of TRIO) {
  console.log(`\n[fila 3 · ${m}] owner, history-stats.json → ${como}: hydrateHistorySection()`);
  await preparar({ 'history-stats.json': m });
  await hydrateHistorySection();
  const sec = getElementById('history-section'), tiles = getElementById('history-stat-tiles');
  ok(sec.style.display !== 'none', `la sección se muestra (display: ${JSON.stringify(sec.style.display)})`);
  ok(tiles.innerHTML.includes(AVISO), 'con la línea de AVISO_HISTORIAL_ILEGIBLE');
  ok(!/stat-card/.test(tiles.innerHTML), 'sin sus números (ningún .stat-card: no inventa un cero)');
  ok(sec.hijos.get('.dash-grid')?.style.display === 'none', 'los gráficos vacíos, escondidos');
}
console.log('\n[fila 3 · sano] owner con history-stats.json bien');
await preparar({}); await hydrateHistorySection();
conserva('dashSano', foto(), 'el DOM que pinta');
console.log('\n[fila 3 · sin historial] una cuenta que no es el owner, sin historial ni fallo');
await preparar({}, OTRO); await hydrateHistorySection();
ok(getElementById('history-section').style.display === 'none', 'la sección sigue escondida (no hay historial: es un resultado)');
conserva('dashSinHistorial', foto(), 'el DOM que pinta');

// ── fila 4: #dashboard, álbumes escuchados por año ───────────────────────
for (const [m, como] of TRIO) {
  console.log(`\n[fila 4 · ${m}] owner, history-listened-albums.json → ${como}: hydrateListenedYearTiles()`);
  await preparar({ 'history-listened-albums.json': m });
  await hydrateListenedYearTiles();
  const card = getElementById('listened-year-card'), holder = getElementById('listened-year-tiles');
  ok(card.style.display !== 'none', `la tarjeta se muestra (display: ${JSON.stringify(card.style.display)})`);
  ok(holder.innerHTML.includes(AVISO), 'con la línea');
  ok(getElementById('listened-year-info').style.display === 'none', 'sin el botón ⓘ (no hay criterio que explicar)');
}
console.log('\n[fila 4 · sano] owner con el JSON bien');
await preparar({}); await hydrateListenedYearTiles();
conserva('anioSano', foto(), 'el DOM que pinta');
console.log('\n[fila 4 · sin historial] cuenta que no es el owner');
await preparar({}, OTRO); await hydrateListenedYearTiles();
ok(getElementById('listened-year-card').style.display === 'none', 'la tarjeta sigue escondida');
conserva('anioSinHistorial', foto(), 'el DOM que pinta');

// ── fila 6: #covers sin álbumes ──────────────────────────────────────────
for (const [m, como] of TRIO) {
  console.log(`\n[fila 6 · ${m}] owner sin W-Three, history-listened-albums.json → ${como}: covers.render()`);
  await preparar({ 'history-listened-albums.json': m });
  await covers.render(crearElemento('contenedor'));
  const html = getElementById('covers-content').innerHTML;
  ok(!/Todavía no hay álbumes en tu historial/.test(html), '«Todavía no hay álbumes en tu historial. Importa el ZIP…» NO sale');
  ok(html.includes(AVISO), `sale la línea (es: ${html.replace(/\s+/g, ' ').slice(0, 110)}…)`);
}
console.log('\n[fila 6 · sano] owner con el JSON bien y vacío ({ years: [] })');
CUERPOS['history-listened-albums.json'] = { years: [] };
await preparar({}); await covers.render(crearElemento('contenedor'));
ok(/Todavía no hay álbumes en tu historial/.test(getElementById('covers-content').innerHTML), 'dice lo de siempre: de verdad no hay');
conserva('coversVacio', foto(), 'el DOM que pinta');
CUERPOS['history-listened-albums.json'] = LISTENED;

// ── fila 8: la ficha de artista ──────────────────────────────────────────
async function fichaArtista(modo, nombre = ARTISTA) {
  await preparar(modo);
  await ac.openArtistCard({ name: nombre });
  return { cuerpo: overlay.hijos.get('#ac-body')?.innerHTML || '', todo: overlay.html + '\n' + (overlay.hijos.get('#ac-body')?.innerHTML || '') };
}
for (const [m, como] of TRIO) {
  console.log(`\n[fila 8 · stats ${m}] owner, history-stats.json → ${como}: openArtistCard()`);
  const { cuerpo } = await fichaArtista({ 'history-stats.json': m });
  ok(cuerpo.includes(AVISO), `el cuerpo dice la línea (es: ${JSON.stringify(cuerpo.slice(0, 60))})`);
}
console.log('\n[fila 8 · artistTracks 500] owner, stats bien, history-artist-tracks.json → 500');
{
  const { cuerpo } = await fichaArtista({ 'history-artist-tracks.json': '500' });
  ok(cuerpo.includes(AVISO), 'la ficha dice la línea');
  ok(/tc-stat-v/.test(cuerpo), 'y sigue con lo que sale de history-stats.json');
}
console.log('\n[fila 8 · artistTracks 500, artista fuera de los tops] stats bien, history-artist-tracks.json → 500');
{
  const { cuerpo } = await fichaArtista({ 'history-artist-tracks.json': '500' }, 'Otro artista inventado t110');
  ok(!/No aparece en tu historial/.test(cuerpo), '«No aparece en tu historial…» NO sale (sin el índice no se puede saber)');
  ok(cuerpo.includes(AVISO), 'sale la línea');
}
console.log('\n[fila 8 · sano] owner con los JSON bien');
{
  const { todo, cuerpo } = await fichaArtista({});
  ok(!cuerpo.includes(AVISO), 'sin la línea');
  conserva('artistaSano', todo, 'la ficha');
}
console.log('\n[fila 8 · sano, no está] owner con los JSON bien, un artista que no está');
{
  const { todo, cuerpo } = await fichaArtista({}, 'Otro artista inventado t110');
  ok(/No aparece en tu historial/.test(cuerpo), 'dice lo de siempre');
  conserva('artistaNoEsta', todo, 'la ficha');
}

console.log(`\nsha256 medidos: ${JSON.stringify(medidos)}`);
console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
