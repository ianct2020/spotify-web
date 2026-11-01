// tests/ficha-album-historial-caido.test.mjs — tanda 111 (v=354), T111c (la fila 9 de la tanda 110).
//
// La ficha de álbum (`features/album-card.js`) pinta sus números con lo que le da `lookupAlbumStats()`
// (`util/album-stats.js`), que los saca de `history-track-plays.json`. Con ese JSON caído (500, `fetch` que
// rechaza, 200 con HTML), `lookupAlbumStats()` da ceros —lo mismo que «no hay»— y la ficha decía «Sin datos de
// escucha», como si no hubiera datos. Desde v=354 la ficha lee el registro de la tanda 109
// (`falloDeLecturaDelHistorial('plays')`) después del `await` y antes de pintar, y si falló y la ficha estaba
// diciendo «Sin datos de escucha», en su lugar va `AVISO_HISTORIAL_ILEGIBLE` con el mismo estilo
// (`.album-modal-no-data`). `album-stats.js` no cambió ni lo que devuelve.
//
// `album-card.js`, `history-data.js`, `history-keys.js`, `util/album-stats.js` y `util/album-key.js` son los
// REALES; el resto de `src/js/` lo dobla `tests/dobles/loader-t110.mjs` (sin tocar). Datos INVENTADOS
// (`t111inventada…`). `T111_SRC` (opcional) apunta a otra copia de `src/` (el rojo contra 9fee7ba9);
// `T111_MEDIR=1` imprime los `sha256` sin compararlos (así se midieron contra 9fee7ba9).
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
const SIN_DATOS = '<div class="album-modal-no-data">Sin datos de escucha</div>';
const ARTISTA = 'Artista t111inventada';
const ESTA = { name: 'Disco t111inventada que sonó', artist: ARTISTA, img: 'https://i.scdn.co/image/ab67616d0000b273a11100000000000000000001' };
const NO_ESTA = { name: 'Disco t111inventada que nunca sonó', artist: ARTISTA, img: 'https://i.scdn.co/image/ab67616d0000b273a11100000000000000000002' };
const CON_NUMEROS = { name: 'Disco t111inventada con números del llamador', artist: ARTISTA, img: '', plays: 9, min: 40 };

// Medidos con este mismo test contra la copia de 9fee7ba9 (v=353), con el JSON bien.
const SHA_353 = process.env.T111_MEDIR ? null : { esta: 'd574ec93382b98af5715e26897a8edd60b93b2d5bfaccdcb69f1307e40087ab5', noEsta: 'f207fba7af9fef179aa6147eb25eb9ef9238cfee01cd27df1123013068127f45' };

const PLAYS = { tracks: {}, albums: [[ESTA.name, ESTA.artist, 31, 95 * 60000, '2024-02-10']] };
const LISTENED = { years: [{ year: 2024, albums: [{ name: ESTA.name, artist: ESTA.artist, date: '2024-02-10', tracks_that_day: 5, min_that_day: 25, img: ESTA.img }] }] };

const estado = { me: OWNER, modo: {}, pedidos: [] };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function elemento() { return { innerHTML: '', textContent: '', style: {}, onclick: null, dataset: {} }; }
let overlay = null;
function nuevoOverlay(html) {
  const els = new Map();
  return { html, isConnected: true, els,
    querySelector: (sel) => { if (sel.startsWith('[data-alb-accion')) return null; if (!els.has(sel)) els.set(sel, elemento()); return els.get(sel); },
    querySelectorAll: () => [] };
}
globalThis.__T110 = {
  valores: {},
  stubs: {
    'api.js:getCurrentUserId': async () => estado.me,
    'api.js:getBestAvailableLikes': async () => ({ items: [] }),
    'api.js:getAlbumTracks': async () => { throw new Error('doble t111: sin tracklist'); },
    'idb.js:idbGetCached': async () => null,
    'idb.js:idbGetCachedRaw': async () => null,
    'idb.js:idbSetCached': async () => {},
    'idb.js:idbDel': async () => {},
    'ui/components.js:escapeHtml': esc,
    'ui/modal-stack.js:openModal': ({ html }) => { overlay = nuevoOverlay(html); return overlay; },
    'ui/skeleton.js:skelTracklist': () => '<div class="skel"></div>',
    'util/artist-name.js:firstArtistName': (s) => s,
    'util/artist-name.js:resolveArtistName': (s) => s,
    'util/fecha.js:fmtDia': (s) => `día ${s}`,
    'util/album-resolver.js:resolveAlbumId': async () => null,
  },
};
globalThis.document = { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], documentElement: {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

function respuesta(modo, cuerpo) {
  if (modo === '500') return new Response('error inventado t111', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
const CUERPOS = { 'history-track-plays.json': PLAYS, 'history-listened-albums.json': LISTENED, 'history-records.json': { top_days: [] } };
globalThis.fetch = async (u) => {
  const s = String(u);
  estado.pedidos.push(s);
  for (const [archivo, cuerpo] of Object.entries(CUERPOS)) if (s.includes(archivo)) return respuesta(estado.modo[archivo] || 'ok', cuerpo);
  throw new TypeError('doble t111: fetch no esperado ' + s);
};
console.warn = () => {};
console.log = ((log) => (...a) => { if (!/^\[(history-data|album-card|album-stats)\]/.test(String(a[0]))) log(...a); })(console.log);

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/features/album-card.js', '/js/features/history-data.js', '/js/history-keys.js', '/js/util/album-stats.js', '/js/util/album-key.js'] },
});
const hd = await import(url('js/features/history-data.js'));
const stats = await import(url('js/util/album-stats.js'));
const ac = await import(url('js/features/album-card.js'));
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const medidos = {};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// La ficha como queda: el HTML del modal y, si se repintó, lo que quedó en `#alb-stats`.
async function ficha(album, modo) {
  estado.me = OTRO; await hd.loadRecords(); estado.me = OWNER;   // cambia de uid: vacía memCache y el registro
  stats.invalidateAlbumStatsIndex();
  estado.modo = modo; estado.pedidos.length = 0; overlay = null;
  ac.openAlbumCard({ ...album });
  await pausa(60);
  const inicial = (overlay.html.match(/<div id="alb-stats">([\s\S]*?)<\/div>\s*<div class="album-modal-actions">/) || [])[1] || '';
  const repintado = overlay.els.get('#alb-stats')?.innerHTML || '';
  return { visible: repintado || inicial, todo: overlay.html + '\n----\n' + repintado };
}

for (const [m, como] of [['500', 'Response 500'], ['rechaza', 'fetch rechaza con TypeError'], ['nojson', '200 con HTML (res.json() tira)']]) {
  console.log(`\n[T111c · ${m}] owner, history-track-plays.json → ${como}; history-listened-albums.json bien; «${ESTA.name}»`);
  const { visible } = await ficha(ESTA, { 'history-track-plays.json': m });
  ok(estado.pedidos.some((p) => p.includes('history-track-plays.json')), 'pidió history-track-plays.json');
  ok(!visible.includes('Sin datos de escucha'), '«Sin datos de escucha» NO queda en la ficha');
  ok(visible.includes(`<div class="album-modal-no-data">${AVISO}</div>`), `en su lugar, AVISO_HISTORIAL_ILEGIBLE con el mismo estilo (.album-modal-no-data) (queda: ${visible.replace(/\s+/g, ' ').slice(0, 120)}…)`);
}
console.log(`\n[T111c · el llamador trajo números] plays → 500; «${CON_NUMEROS.name}» (plays: 9, min: 40)`);
{
  const { visible } = await ficha(CON_NUMEROS, { 'history-track-plays.json': '500' });
  ok(/>9<\/div>\s*<div class="album-modal-stat-l">plays/.test(visible) && !visible.includes(AVISO), 'deja los números del llamador, sin el aviso (la regla de siempre: con ceros no se pisa nada)');
}

for (const [clave, album, que] of [['esta', ESTA, 'un disco que SÍ sonó'], ['noEsta', NO_ESTA, 'uno que nunca sonó («Sin datos de escucha» de verdad)']]) {
  console.log(`\n[sano · ${clave}] owner con los dos JSON bien, ${que}`);
  const { visible, todo } = await ficha(album, {});
  medidos[clave] = sha(todo);
  if (SHA_353) ok(SHA_353[clave] === medidos[clave], `la ficha con el mismo sha256 que en 9fee7ba9 (${medidos[clave].slice(0, 12)}…)`);
  if (clave === 'esta') ok(/>31<\/div>\s*<div class="album-modal-stat-l">plays/.test(visible), 'con sus 31 plays');
  if (clave === 'noEsta') ok(visible.includes(SIN_DATOS), 'dice «Sin datos de escucha», byte a byte el de siempre');
  ok(!visible.includes(AVISO), 'sin el aviso');
}

console.log(`\nsha256 medidos: ${JSON.stringify(medidos)}`);
console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
