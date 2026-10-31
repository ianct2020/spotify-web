// tests/escuchadas-caidas-92b.test.mjs — tanda 108 (v=351).
//
// W-Three avisa «No se han podido leer tus álbumes escuchados: la vista sigue sin
// ellos.» si el `.catch` de `loadListenedAlbums()` en `loadAndRender()` corre. Hasta
// v=350 no corría nunca: `loadListenedAlbums()` no tiraba (la misma causa que la
// 94A). `catch-que-tapan-92b-wthree` lo probaba con un doble que tiraba.
//
// Acá `wthree.js` y `history-data.js` son los REALES. Se doblan las dependencias de
// la vista (`catch-92b-wthree-doble.mjs`, sin tocar) más `getCurrentUserId` (contesta
// el owner) y la IndexedDB (vacía), y `globalThis.fetch`:
//   · `history-stats.json` → 200 `{ top_albums_all_time: [] }` (lo mismo que daba el
//     doble de `loadHistoryStats` de la 92B);
//   · `history-listened-albums.json` → según `modo` (500, rechazo, 200 no-JSON, o bien
//     con `{ years: [] }`, lo mismo que daba el doble de la 92B).
// `T108_SRC` (opcional) apunta a otra copia de `src/` (los rojos contra 87a6d2b).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const RAIZ_SRC = process.env.T108_SRC ? resolve(process.env.T108_SRC) : resolve(import.meta.dirname, '../src');
// El id del owner aparece acá SOLO para simular su `/me` (es el `HISTORY_OWNER_ID` de history-data.js).
const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';

globalThis.__T92B_WTHREE = { historialError: null, historialCalls: 0, playlistCalls: 0 };
globalThis.__T108_92B = { me: OWNER };
const avisos = [];
console.warn = (...a) => avisos.push(a.map(x => x instanceof Error ? x.message : String(x)).join(' '));
console.log = ((log) => (...a) => { if (!String(a[0]).startsWith('[history-data]')) log(...a); })(console.log);
globalThis.localStorage = { getItem: k => k === 'wthree_playlist_id' ? 'playlist-inventada' : k === 'wthree_playlist_name' ? 'Playlist inventada' : null, setItem() {}, removeItem() {} };
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
  if (/history-stats\.json/.test(s)) return json({ top_albums_all_time: [] });
  if (!/history-listened-albums\.json/.test(s)) throw new TypeError('doble: fetch no esperado ' + s);
  if (modo === '500') return new Response('error inventado t108', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return json({ years: [] });
};

register('./dobles/loader-escuchadas-caidas-92b.mjs', pathToFileURL(import.meta.filename));
const wthree = await import(pathToFileURL(resolve(RAIZ_SRC, 'js/features/wthree.js')).href);
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const hash = x => createHash('sha256').update(x.replace(/\s+/g, ' ').trim()).digest('hex');
const AVISO = /No se han podido leer tus álbumes escuchados: la vista sigue sin ellos\./;
async function pintar(m) {
  modo = m; elementos.clear(); avisos.length = 0; pedidos.length = 0;
  Object.assign(globalThis.__T92B_WTHREE, { historialError: null, historialCalls: 0, playlistCalls: 0 });
  await wthree.render(elemento('contenedor'));
  for (let i = 0; i < 50 && /spinner/.test(elemento('wthree-content').innerHTML); i++) await new Promise(r => setTimeout(r, 0));
  return elemento('wthree-content').innerHTML;
}
const pedidosListened = () => pedidos.filter(p => /history-listened-albums/.test(p)).length;

// Los fallos van primero: un éxito queda en `memCache` y no se vuelve a pedir.
for (const [m, como] of [['500', 'fetch → Response 500'], ['rechaza', 'fetch rechaza con TypeError("Failed to fetch")'], ['nojson', 'fetch → Response 200 con HTML (res.json() tira SyntaxError)']]) {
  console.log(`\n[${m}] owner (/me = owner, IndexedDB vacía), ${como}`);
  const html = await pintar(m);
  ok(pedidosListened() === 1, `pidió history-listened-albums.json una vez (pidió ${pedidosListened()})`);
  ok(globalThis.__T92B_WTHREE.playlistCalls === 1, 'siguió leyendo la playlist');
  ok(AVISO.test(html), 'la vista pinta el aviso');
  ok(/Playlist inventada/.test(html), 'el resto de la vista sigue');
  ok(avisos.some(x => x.includes('[wthree]')), 'console.warn de [wthree] con el error');
}

console.log('\n[sano] owner con el JSON bien: la vista de siempre y sin aviso');
{
  const html = await pintar('ok');
  ok(pedidosListened() === 1, 'pidió el JSON una vez');
  ok(!AVISO.test(html), 'sin aviso');
  ok(avisos.length === 0, `sin warnings${avisos.length ? ` (${JSON.stringify(avisos)})` : ''}`);
  // El mismo hash que afirma `catch-que-tapan-92b-wthree` para su HTML sano.
  ok(hash(html) === '35ad0c8d8a79adf84fca38e421a46e9864cb7daf723558c489acb080233aecd2', `HTML normalizado idéntico al sano de la 92B (sha256 ${hash(html)})`);
}

console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
