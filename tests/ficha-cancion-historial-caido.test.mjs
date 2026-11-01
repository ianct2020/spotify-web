// tests/ficha-cancion-historial-caido.test.mjs — tanda 110 (v=353), T110a.
//
// La ficha de canción del owner, cuando la lectura de su historial FALLA. Hasta v=352, con
// `history-track-plays.json` caído (500, corte, un 200 que no es JSON), `loadTrackPlays()` daba el
// mismo `null` que «no hay historial» y la ficha decía, falso: «Este tema no aparece en tu historial
// (o solo tuvo plays de menos de 30s). Nunca lo escuchaste entero desde 2018.». Y con
// `history-track-detail.json` caído, «Curva mensual disponible solo para temas con 5+ plays.».
// Desde v=353 la ficha lee el registro de la tanda 109 (`falloDeLecturaDelHistorial(kind)`) después
// del `await` y antes de pintar, y lo dice.
//
// `track-card.js`, `history-data.js` y `history-keys.js` son los REALES. Todo lo demás de `src/js/`
// lo dobla `tests/dobles/loader-t110.mjs` (stubs en `globalThis.__T110`); `globalThis.fetch` es el
// doble de los JSON del owner. Ids INVENTADOS (`t110inventada…`); el del owner aparece solo para
// simular su `/me` (es el `HISTORY_OWNER_ID` público del repo).
//
// `T110_SRC` (opcional) apunta a otra copia de `src/` (los rojos contra 27a0e64d).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const RAIZ_SRC = process.env.T110_SRC ? resolve(process.env.T110_SRC) : resolve(import.meta.dirname, '../src');
const url = (p) => pathToFileURL(resolve(RAIZ_SRC, p)).href;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';
const OTRO = 't110inventada-otra-cuenta';
const SI = 't110inventadatemasi';        // está en plays y en detail
const SOLO_PLAYS = 't110inventadatemasolo';  // está en plays, no en detail (menos de 5 plays)
const NO = 't110inventadatemano';        // no está en ninguno
const FRASE_FALSA = 'Nunca lo escuchaste entero desde 2018.';
const FRASE_NUEVA = 'No se ha podido leer tu historial, así que no sé cuántas veces escuchaste este tema. Recarga la página para volver a intentarlo.';
const AVISO = 'No se ha podido leer tu historial, así que esta parte sale sin él. Recarga la página para volver a intentarlo.';
const CURVA_5 = 'Curva mensual disponible solo para temas con 5+ plays.';

// Los `sha256` de 27a0e64d (v=352), con el JSON bien: los tres caminos sanos de la ficha y el
// candado con un fallo anotado. Se midieron con este mismo test contra la copia de 27a0e64d.
const SHA_352 = {
  si: 'ca271ad72bc05b34e10d78229e71f5962261e512320874f27302905f1f5dfd0a',
  soloPlays: '0b58bd00afc27c445002d620a38cfb8944be8350efebbcf2b1d76393fe5b6b2a',
  no: '42121b960b10e7b928da6d2db4d031addd818a21dd95606faa2c182abf31166a',
  candadoConFallo: '45227d479af1e26204f30b18a5243e6a87baccb91575efff535441fcaa357fda',
};

const PLAYS = { tracks: { [SI]: [12, 2400], [SOLO_PLAYS]: [3, 600] }, albums: [] };
const DETAIL = { tracks: { [SI]: { m: { '2024-01': 7, '2024-03': 5 }, f: '2024-01-02', l: '2024-03-09', d: 6, x: 3 } } };

const estado = { me: OWNER, plays: 'ok', detail: 'ok', pedidos: [] };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let overlay = null;
function elemento() { return { innerHTML: '', textContent: '', style: {}, onclick: null, dataset: {} }; }
function nuevoOverlay(html) {
  const els = new Map();
  return {
    html, isConnected: true,
    querySelector: (sel) => { if (!els.has(sel)) els.set(sel, elemento()); return els.get(sel); },
    querySelectorAll: () => [],
    els,
  };
}
globalThis.__T110 = {
  valores: {},
  stubs: {
    'api.js:getCurrentUserId': async () => estado.me,
    'api.js:getBestAvailableLikes': async () => ({ items: [] }),
    'idb.js:idbGetCached': async () => null,
    'idb.js:idbGetCachedRaw': async () => null,
    'idb.js:idbSetCached': async () => {},
    'idb.js:idbDel': async () => {},
    'ui/components.js:escapeHtml': esc,
    'util/artist-name.js:resolveArtistList': (t) => t.artists || [],
    'ui/modal-stack.js:openModal': ({ html }) => { overlay = nuevoOverlay(html); return overlay; },
    'ui/skeleton.js:skelCardBody': () => '<div class="skel"></div>',
    'ui/skeleton.js:skelBox': () => '',
    'ui/letra-ficha.js:botonLetraHtml': () => '',
    'ui/letra-ficha.js:bloqueLetraHtml': () => '',
    'api/statsfm.js:hasUsername': () => false,
    'ui/preview-player.js:playingKey': () => null,
  },
};
globalThis.document = { addEventListener() {}, getElementById: () => null, documentElement: {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

function respuesta(modo, cuerpo) {
  if (modo === '500') return new Response('error inventado t110', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
globalThis.fetch = async (u) => {
  const s = String(u);
  estado.pedidos.push(s);
  if (/history-track-plays\.json/.test(s)) return respuesta(estado.plays, PLAYS);
  if (/history-track-detail\.json/.test(s)) return respuesta(estado.detail, DETAIL);
  throw new TypeError('doble t110: fetch no esperado ' + s);
};
const avisos = [];
console.warn = (...a) => avisos.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
console.log = ((log) => (...a) => { if (!String(a[0]).startsWith('[history-data]')) log(...a); })(console.log);

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/features/track-card.js', '/js/features/history-data.js', '/js/history-keys.js'] },
});
const hd = await import(url('js/features/history-data.js'));
const tc = await import(url('js/features/track-card.js'));
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const medidos = {};

// Vacía `memCache` y el registro: un `/me` de otra cuenta y después el owner otra vez
// (`ensureFreshMem()` los resetea al cambiar de uid). No pide nada (el otro no es owner).
async function limpiar() {
  estado.me = OTRO; await hd.loadRecords(); estado.me = OWNER;
}
async function ficha(id, modos) {
  await limpiar();
  Object.assign(estado, modos); estado.pedidos.length = 0; avisos.length = 0;
  await tc.openTrackCard({ id, name: `Tema inventado ${id}`, artists: ['Artista inventado t110'], album: 'Disco inventado t110', img: 'https://t110inventada.invalid/tapa.png' });
  const cuerpo = overlay.els.get('#tc-body')?.innerHTML || '';
  return { cuerpo, todo: overlay.html + '\n' + cuerpo };
}
const pidio = (re) => estado.pedidos.filter((p) => re.test(p)).length;

// ── T110a, fila 1: history-track-plays.json caído (el trío) ───────────────
for (const [m, como] of [['500', 'Response 500'], ['rechaza', 'fetch rechaza con TypeError("Failed to fetch")'], ['nojson', 'Response 200 con HTML (res.json() tira SyntaxError)']]) {
  console.log(`\n[fila 1 · ${m}] owner, history-track-plays.json → ${como}; history-track-detail.json bien; tema ${NO}`);
  const { cuerpo } = await ficha(NO, { plays: m, detail: 'ok' });
  ok(pidio(/history-track-plays\.json/) === 1, `pidió history-track-plays.json una vez (${pidio(/history-track-plays\.json/)})`);
  ok(!cuerpo.includes(FRASE_FALSA), 'la frase «Nunca lo escuchaste entero desde 2018.» NO sale');
  ok(cuerpo.includes(FRASE_NUEVA), `sale «No se ha podido leer tu historial, así que no sé cuántas veces…» (cuerpo: ${cuerpo.replace(/\s+/g, ' ').slice(0, 140)}…)`);
  ok(/--color-text-secondary/.test(cuerpo) && !/--color-text-muted/.test(cuerpo), 'en --color-text-secondary, sin el muted');
  if (m === '500') {
    medidos.candadoConFallo = sha(hd.ownerLockedMessage('Las que menos te saltas'));
    ok(SHA_352.candadoConFallo === medidos.candadoConFallo, `ownerLockedMessage() con el fallo anotado: el mismo sha256 que en 27a0e64d (${medidos.candadoConFallo.slice(0, 12)}…)`);
  }
}

console.log(`\n[fila 1 · detail caído] owner, plays bien, history-track-detail.json → 500; tema ${NO} (no está en plays)`);
{
  const { cuerpo } = await ficha(NO, { plays: 'ok', detail: '500' });
  ok(!cuerpo.includes(FRASE_FALSA), 'la frase falsa NO sale (sin el detalle no se puede saber)');
  ok(cuerpo.includes(FRASE_NUEVA), 'sale la frase nueva');
}

// ── T110a, fila 2: la curva, con el detalle caído ─────────────────────────
console.log(`\n[fila 2] owner, plays bien, history-track-detail.json → 500; tema ${SI} (está en plays)`);
{
  const { cuerpo } = await ficha(SI, { plays: 'ok', detail: '500' });
  ok(!cuerpo.includes(CURVA_5), `«${CURVA_5}» NO sale`);
  ok(cuerpo.includes(AVISO), 'sale AVISO_HISTORIAL_ILEGIBLE donde iría la curva');
  ok(/12<\/div><div class="tc-stat-l">plays válidas/.test(cuerpo), 'las stats del tema siguen (12 plays válidas)');
  ok(!cuerpo.includes(FRASE_FALSA) && !cuerpo.includes(FRASE_NUEVA), 'y ninguna de las dos frases de «no aparece»');
}

// ── Conservación: con el historial bien, byte a byte lo de 27a0e64d ───────
for (const [clave, id, que] of [['si', SI, 'un tema que SÍ está (con curva)'], ['soloPlays', SOLO_PLAYS, 'uno que está solo en plays (sin curva: «5+ plays»)'], ['no', NO, 'uno que NO está (la frase de siempre)']]) {
  console.log(`\n[sano · ${clave}] owner con los dos JSON bien, ${que}`);
  const { cuerpo, todo } = await ficha(id, { plays: 'ok', detail: 'ok' });
  medidos[clave] = sha(todo);
  ok(SHA_352[clave] === medidos[clave], `la ficha con el mismo sha256 que en 27a0e64d (${medidos[clave].slice(0, 12)}…)`);
  if (clave === 'no') ok(cuerpo.includes(FRASE_FALSA), 'dice la frase de siempre: el tema de verdad no está');
  ok(!cuerpo.includes(AVISO) && !cuerpo.includes(FRASE_NUEVA), 'sin ningún aviso de lectura');
}

console.log(`\nsha256 medidos: ${JSON.stringify(medidos)}`);
console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
