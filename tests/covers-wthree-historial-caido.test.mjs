// tests/covers-wthree-historial-caido.test.mjs — tanda 111 (v=354), T111a, punto 5.
//
// Lo que la tanda 110 (v=353) no midió: `#covers` CON la playlist «w three» configurada y
// `history-listened-albums.json` caído (500, `fetch` que rechaza con `TypeError`, 200 con HTML). Es conservación de
// lo que hizo la 110 (`covers.js` lee `falloDeLecturaDelHistorial('listened')` después del `await` y pone la línea de
// `AVISO_HISTORIAL_ILEGIBLE` arriba de la grilla): no cambia código.
//
//   · con el JSON caído: la línea sale, y la grilla trae las tapas de W-Three (y ninguna que solo viniera del historial);
//   · con el JSON bien: la grilla trae las de W-Three y las del historial, y el HTML (el de `#covers-content` más lo
//     que pinta cada celda) tiene el mismo `sha256` que en 9fee7ba9 (v=353).
//
// `covers.js`, `history-data.js`, `history-keys.js`, `util/album-stats.js` y los `util/` puros que usa la grilla son
// los REALES; el resto de `src/js/` lo dobla `tests/dobles/loader-t110.mjs` (sin tocar). La lista incremental es un
// doble que guarda los `items` y el `renderItem` que le pasa `covers.js`: eso es «lo que trae la grilla».
// Datos INVENTADOS (`t111inventada…`). `T111_SRC` (opcional) apunta a otra copia de `src/` (la de 9fee7ba9).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const RAIZ_SRC = process.env.T111_SRC ? resolve(process.env.T111_SRC) : resolve(import.meta.dirname, '../src');
const url = (p) => pathToFileURL(resolve(RAIZ_SRC, p)).href;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';
const OTRO = 't111inventada-otra-cuenta';
const AVISO = 'No se ha podido leer tu historial, así que esta parte sale sin él. Recarga la página para volver a intentarlo.';
// Medido con este mismo test contra la copia de 9fee7ba9 (v=353), con el JSON bien.
const SHA_353_SANO = process.env.T111_MEDIR ? null : '4995b24040a26ae59065c546f5954dd7a6460fbcfa8176098127c5a6fbe8da0f';

// ── Datos inventados: 3 discos en W-Three y en el historial, 2 solo en W-Three, 2 solo en el historial ──
const hex24 = (n) => ('a111' + n.toString(16).padStart(20, '0')).slice(0, 24);
const TAPA = (n) => `https://i.scdn.co/image/ab67616d0000b273${hex24(n)}`;
const disco = (n) => ({ n, name: `Disco t111inventada ${n}`, artist: `Artista t111inventada ${n}`, img: TAPA(n) });
const WT = [1, 2, 3, 4, 5].map(disco);
const HIST = [1, 2, 3, 7, 8].map(disco);
const SOLO_WT = [4, 5].map((n) => hex24(n));
const SOLO_HIST = [7, 8].map((n) => hex24(n));
const itemsWt = WT.flatMap((d) => [1, 2].map((k) => ({ added_at: '2026-01-01T00:00:00Z', item: {
  id: `t111inventada${String(d.n * 10 + k).padStart(9, '0')}`, uri: `spotify:track:t111inventada${String(d.n * 10 + k).padStart(9, '0')}`, type: 'track',
  name: `Tema t111inventada ${d.n}.${k}`, artists: [{ id: `t111inventadaart0000${String(d.n).padStart(2, '0')}`, name: d.artist }],
  album: { id: `t111inventadaalb0000${String(d.n).padStart(2, '0')}`, name: d.name, release_date: '2022-01-01', images: [{ url: d.img, width: 640, height: 640 }] } } })));
const LISTENED = { version: 1, criteria: { min_tracks_sameday: 4, min_min_sameday: 25 }, years: [{ year: 2024, albums: HIST.map((d, i) => ({ name: d.name, artist: d.artist, date: `2024-0${1 + i}-10`, tracks_that_day: 5, min_that_day: 25, img: d.img })) }] };
const PLAYS = { tracks: {}, albums: HIST.map((d, i) => [d.name, d.artist, 40 - i, (200 - i * 10) * 60000, `2024-0${1 + i}-10`]) };

const estado = { me: OWNER, modo: {}, pedidos: [] };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── DOM de mentira ──
const nada = () => new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => '' : nada()), apply: () => nada() });
function crearElemento(nombre) {
  return { nombre, innerHTML: '', textContent: '', style: {}, hidden: false, dataset: {}, isConnected: true, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: (sel) => crearElemento(`${nombre} ${sel}`), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null, getBoundingClientRect: () => ({ width: 1000, height: 600, top: 0, left: 0 }) };
}
let porId = new Map();
const getElementById = (id) => { if (!porId.has(id)) porId.set(id, crearElemento('#' + id)); return porId.get(id); };
globalThis.document = { getElementById, addEventListener() {}, removeEventListener() {}, querySelectorAll: () => [], querySelector: () => null, documentElement: { style: {} }, body: crearElemento('body') };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.requestAnimationFrame = () => 0;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: (k) => (k === 'wthree_playlist_id' ? 't111inventadaplwthree0' : null), setItem() {}, removeItem() {} };

let grilla = null;   // lo que `covers.js` le pasa a la lista incremental
globalThis.__T110 = {
  valores: {},
  stubs: {
    'api.js:getCurrentUserId': async () => estado.me,
    'api.js:getBestAvailableLikes': async () => ({ items: [] }),
    'api.js:getAllPlaylistItems': async () => itemsWt,
    'idb.js:idbGetCached': async () => null,
    'idb.js:idbGetCachedRaw': async () => null,
    'idb.js:idbSetCached': async () => {},
    'idb.js:idbDel': async () => {},
    'ui/components.js:escapeHtml': esc,
    'ui/components.js:pageHeader': ({ title }) => `<h1>${title}</h1>`,
    'util/vigencia-ruta.js:vigilarRuta': () => ({ vigente: () => true }),
    'storage.js:prefKey': (k) => k,
    'storage.js:migratePrefKey': () => {},
    'features/mosaico-colores.js:leerColores': async () => null,
    'ui/incremental-list.js:createIncrementalList': (o) => { grilla = o; return nada(); },
    'ui/incremental-list.js:scrollRootOf': () => null,
    'ui/lazy-img.js:createLazyImages': () => nada(),
  },
};

function respuesta(modo, cuerpo) {
  if (modo === '500') return new Response('error inventado t111', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
const CUERPOS = { 'history-listened-albums.json': LISTENED, 'history-track-plays.json': PLAYS, 'history-records.json': { top_days: [] } };
globalThis.fetch = async (u) => {
  const s = String(u);
  estado.pedidos.push(s);
  for (const [archivo, cuerpo] of Object.entries(CUERPOS)) if (s.includes(archivo)) return respuesta(estado.modo[archivo] || 'ok', cuerpo);
  throw new TypeError('doble t111: fetch no esperado ' + s);
};
console.warn = () => {};
console.log = ((log) => (...a) => { if (!/^\[(history-data|covers)\]/.test(String(a[0]))) log(...a); })(console.log);

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/features/history-data.js', '/js/history-keys.js', '/js/features/covers.js', '/js/util/album-stats.js', '/js/util/album-key.js',
    '/js/util/orden-tapas.js', '/js/util/cover-size.js', '/js/util/familia-color.js', '/js/util/cover-color.js', '/js/util/junk.js', '/js/util/texto.js'] },
});
const hd = await import(url('js/features/history-data.js'));
const stats = await import(url('js/util/album-stats.js'));
const covers = await import(url('js/features/covers.js'));
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
async function preparar(modo) {
  estado.me = OTRO; await hd.loadRecords(); estado.me = OWNER;   // cambia de uid: vacía memCache y el registro
  stats.invalidateAlbumStatsIndex();
  estado.modo = modo; estado.pedidos.length = 0; porId = new Map(); grilla = null;
}
async function pintar() {
  let error = null;
  try { await covers.render(crearElemento('contenedor')); } catch (e) { error = e; }
  const html = getElementById('covers-content').innerHTML;
  const items = grilla?.items || [];
  const tapas = items.map((a) => String(a.img).slice(-24));
  const celdas = grilla ? items.map((a, i) => grilla.renderItem(a, i, 48)).join('\n') : '';
  return { html, tapas, celdas, error };
}

const TRIO = [['500', 'Response 500'], ['rechaza', 'fetch rechaza con TypeError'], ['nojson', '200 con HTML (res.json() tira)']];
for (const [m, como] of TRIO) {
  console.log(`\n[covers + W-Three · ${m}] owner con W-Three configurada, history-listened-albums.json → ${como}`);
  await preparar({ 'history-listened-albums.json': m });
  const r = await pintar();
  ok(!r.error, `render() no tira${r.error ? ' (tiró: ' + r.error.message + ')' : ''}`);
  ok(estado.pedidos.some((p) => p.includes('history-listened-albums.json')), 'pidió history-listened-albums.json');
  ok(r.html.includes(AVISO), 'la línea de AVISO_HISTORIAL_ILEGIBLE está en #covers-content');
  ok(r.html.indexOf(AVISO) >= 0 && r.html.indexOf(AVISO) < r.html.indexOf('id="covers-grid-wrap"'), 'la línea va arriba de la grilla');
  ok(SOLO_WT.every((h) => r.tapas.includes(h)), `la grilla trae las tapas que solo están en W-Three (${r.tapas.length} tapas)`);
  ok(WT.every((d) => r.tapas.includes(hex24(d.n))), 'la grilla trae las cinco de W-Three');
  ok(!SOLO_HIST.some((h) => r.tapas.includes(h)), 'y ninguna que solo viniera del historial');
}

console.log('\n[covers + W-Three · sano] owner con W-Three configurada y el JSON bien');
await preparar({});
const s = await pintar();
ok(!s.error, `render() no tira${s.error ? ' (tiró: ' + s.error.message + ')' : ''}`);
ok(!s.html.includes(AVISO), 'sin la línea');
ok([...WT.map((d) => hex24(d.n)), ...SOLO_HIST].every((h) => s.tapas.includes(h)) && s.tapas.length === 7, `la grilla trae las 7 (W-Three y el historial): ${s.tapas.length}`);
const medido = sha(s.html + '\n----\n' + s.celdas);
console.log(`  sha256 sano medido: ${medido}`);
if (SHA_353_SANO) ok(medido === SHA_353_SANO, `el HTML sano (#covers-content + las celdas), el mismo sha256 que en 9fee7ba9 (${medido.slice(0, 12)}…)`);

console.log(`\n${bien} bien · ${mal} mal`);
process.exit(mal ? 1 : 0);
