// tests/historial-caido-wthree.test.mjs — tanda 110 (v=353), T110b, fila 7.
//
// `#wthree` cruza la playlist con `loadHistoryStats()` (sin `tirarSiFalla`). Con el owner y
// `history-stats.json` caído (500, corte, un 200 que no es JSON), hasta v=352 el cruce salía sin las
// estadísticas —sin minutos ni plays— y sin una palabra. Desde v=353 `loadAndRender()` lee el registro de
// la tanda 109 (`falloDeLecturaDelHistorial('stats')`) después del `await` y pone la línea de
// `AVISO_HISTORIAL_ILEGIBLE` arriba de los cubos; la vista sigue con lo demás como antes.
//
// `wthree.js`, `history-data.js` y `history-keys.js` son los REALES, con el loader y el doble de la tanda
// 108 sin tocar (`loader-escuchadas-caidas-92b.mjs`, `escuchadas-caidas-92b-doble.mjs`). Datos INVENTADOS.
// `T110_SRC` (opcional) apunta a otra copia de `src/` (los rojos contra 27a0e64d).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const RAIZ_SRC = process.env.T110_SRC ? resolve(process.env.T110_SRC) : resolve(import.meta.dirname, '../src');
const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';
const AVISO = 'No se ha podido leer tu historial, así que esta parte sale sin él. Recarga la página para volver a intentarlo.';
// El HTML sano de W-Three en 27a0e64d (v=352): el mismo hash normalizado que afirman
// `catch-que-tapan-92b-wthree` y `escuchadas-caidas-92b`.
const SHA_SANO = '35ad0c8d8a79adf84fca38e421a46e9864cb7daf723558c489acb080233aecd2';

globalThis.__T92B_WTHREE = { historialError: null, historialCalls: 0, playlistCalls: 0 };
globalThis.__T108_92B = { me: OWNER };
const avisos = [];
console.warn = (...a) => avisos.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
console.log = ((log) => (...a) => { if (!String(a[0]).startsWith('[history-data]')) log(...a); })(console.log);
globalThis.localStorage = { getItem: (k) => (k === 'wthree_playlist_id' ? 'playlist-inventada' : k === 'wthree_playlist_name' ? 'Playlist inventada' : null), setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const elementos = new Map();
function elemento(id) {
  if (!elementos.has(id)) elementos.set(id, { id, innerHTML: '', style: {}, textContent: '', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null });
  return elementos.get(id);
}
globalThis.document = { getElementById: elemento, querySelectorAll: () => [], addEventListener() {} };

let modo = 'ok';
const pedidos = [];
globalThis.fetch = async (u) => {
  const s = String(u);
  pedidos.push(s);
  const json = (x) => new Response(JSON.stringify(x), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (/history-listened-albums\.json/.test(s)) return json({ years: [] });
  if (!/history-stats\.json/.test(s)) throw new TypeError('doble: fetch no esperado ' + s);
  if (modo === '500') return new Response('error inventado t110', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return json({ top_albums_all_time: [] });
};

register('./dobles/loader-escuchadas-caidas-92b.mjs', pathToFileURL(import.meta.filename));
const wthree = await import(pathToFileURL(resolve(RAIZ_SRC, 'js/features/wthree.js')).href);
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const hash = (x) => createHash('sha256').update(x.replace(/\s+/g, ' ').trim()).digest('hex');
async function pintar(m) {
  modo = m; elementos.clear(); avisos.length = 0; pedidos.length = 0;
  Object.assign(globalThis.__T92B_WTHREE, { historialError: null, historialCalls: 0, playlistCalls: 0 });
  await wthree.render(elemento('contenedor'));
  for (let i = 0; i < 50 && /spinner/.test(elemento('wthree-content').innerHTML); i++) await new Promise((r) => setTimeout(r, 0));
  return elemento('wthree-content').innerHTML;
}
const pedidosStats = () => pedidos.filter((p) => /history-stats/.test(p)).length;

// Los fallos van primero: un éxito queda en `memCache` y no se vuelve a pedir.
for (const [m, como] of [['500', 'fetch → Response 500'], ['rechaza', 'fetch rechaza con TypeError("Failed to fetch")'], ['nojson', 'fetch → Response 200 con HTML (res.json() tira SyntaxError)']]) {
  console.log(`\n[fila 7 · ${m}] owner (/me = owner, IndexedDB vacía), history-stats.json: ${como}`);
  const html = await pintar(m);
  ok(pedidosStats() === 1, `pidió history-stats.json una vez (pidió ${pedidosStats()})`);
  ok(html.includes(AVISO), 'la vista pinta la línea de AVISO_HISTORIAL_ILEGIBLE');
  ok(/--color-text-secondary/.test(html.slice(Math.max(0, html.indexOf(AVISO) - 200), html.indexOf(AVISO))), 'en --color-text-secondary');
  ok(/Playlist inventada/.test(html), 'el resto de la vista sigue');
  ok(!/No se han podido leer tus álbumes escuchados/.test(html), 'sin el aviso de la 92B (los escuchados se leyeron bien)');
}

console.log('\n[sano] owner con el JSON bien: la vista de siempre y sin la línea');
{
  const html = await pintar('ok');
  ok(!html.includes(AVISO), 'sin la línea');
  ok(hash(html) === SHA_SANO, `HTML normalizado idéntico al sano de 27a0e64d (sha256 ${hash(html).slice(0, 12)}…)`);
}

console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
