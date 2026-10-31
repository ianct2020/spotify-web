// tests/escuchadas-caidas-94a.test.mjs — tanda 108 (v=351).
//
// El aviso de la 94A («No se han podido leer tus álbumes escuchados…» en #debug)
// sale si `armarCatalogo()` marca `cuentas.escuchadasFallo`. Hasta v=350 eso solo
// pasaba si `loadListenedAlbums()` TIRABA, y nunca tiraba: con el owner, el
// `catch` final del `fetch` de `loadOne()` se tragaba el 500, el corte de red y el
// JSON roto y devolvía `null`, lo mismo que «no hay historial». La 94A lo probó
// con un doble de `loadListenedAlbums` que tiraba y por eso nunca lo vio.
//
// Acá `history-data.js` y `mosaico-colores.js` son los REALES. Se doblan:
//   · `api.js`, `idb.js` y `ui/degraded-banner.js` (tests/dobles/escuchadas-caidas-doble.mjs,
//     por tests/dobles/loader-escuchadas-caidas.mjs): `/me` contesta lo que diga
//     `__T108.me`, la IndexedDB está VACÍA (toda lectura da `null`);
//   · `globalThis.fetch`: contesta según `modo` con un `Response` de Node.
//
// `T108_SRC` (opcional) apunta a otra copia de `src/` (los rojos contra 87a6d2b).
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const RAIZ_SRC = process.env.T108_SRC ? resolve(process.env.T108_SRC) : resolve(import.meta.dirname, '../src');
const url = (p) => pathToFileURL(resolve(RAIZ_SRC, p)).href;

// El id del owner aparece acá SOLO para simular su `/me` (es el `HISTORY_OWNER_ID` de history-data.js).
const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';
const OTRA = 't108inventada-otra-cuenta';

const tapa = (h) => `https://i.scdn.co/image/ab67616d0000b273${h}`;
const ID_HIST = 'c108'.padEnd(24, '0'), ID_LIKE = 'd108'.padEnd(24, '0');
const LISTENED = { years: [{ year: 2024, albums: [{ img: tapa(ID_HIST) }] }] };
const LIKES = [{ track: { album: { images: [{ width: 64, url: tapa(ID_LIKE) }] } } }];

globalThis.__T108 = { me: OWNER, meFalla: null, likes: LIKES, lecturasIdb: [], escriturasIdb: [], borradosIdb: [], banners: 0 };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let modo = 'ok';
const pedidos = [];
globalThis.fetch = async (u) => {
  const s = String(u);
  pedidos.push(s);
  if (!/history-listened-albums\.json/.test(s)) throw new TypeError('doble: fetch no esperado ' + s);
  if (modo === '500') return new Response('error inventado t108', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return new Response(JSON.stringify(LISTENED), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const avisos = [];
console.warn = (...a) => avisos.push(a.map(x => x instanceof Error ? x.message : String(x)).join(' '));
console.log = ((log) => (...a) => { if (!String(a[0]).startsWith('[history-data]')) log(...a); })(console.log);

register('./dobles/loader-escuchadas-caidas.mjs', pathToFileURL(import.meta.filename));
const hd = await import(url('js/features/history-data.js'));
const mosaico = await import(url('js/features/mosaico-colores.js'));
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const pedidosListened = () => pedidos.filter(p => /history-listened-albums/.test(p)).length;
async function catalogo(m) {
  modo = m; pedidos.length = 0; avisos.length = 0;
  try { return { cat: await mosaico.armarCatalogo(), tiro: null }; }
  catch (e) { return { cat: null, tiro: e }; }
}

// ── Los tres fallos, con el owner ──────────────────────────────────────────
for (const [m, como] of [['500', 'fetch → Response 500'], ['rechaza', 'fetch rechaza con TypeError("Failed to fetch")'], ['nojson', 'fetch → Response 200 con HTML (res.json() tira SyntaxError)']]) {
  console.log(`\n[${m}] owner (/me = owner, IndexedDB vacía), ${como}`);
  const { cat, tiro } = await catalogo(m);
  ok(!tiro, `armarCatalogo() no tira${tiro ? ` (tiró: ${tiro.message})` : ''}`);
  ok(pedidosListened() === 1, `pidió history-listened-albums.json una vez (pidió ${pedidosListened()})`);
  ok(cat?.cuentas?.escuchadasFallo === true, `cuentas.escuchadasFallo === true (dio ${JSON.stringify(cat?.cuentas?.escuchadasFallo)})`);
  ok(JSON.stringify(cat?.items.map(x => x.id)) === JSON.stringify([ID_LIKE]), 'el catálogo sigue con el me gusta');
  ok(avisos.some(a => a.includes('[mosaico-colores]')), 'console.warn de [mosaico-colores] con el error');
}

// ── Conservación ───────────────────────────────────────────────────────────
console.log('\n[memo] un segundo armarCatalogo() después del fallo vuelve a pedir');
{
  const { cat } = await catalogo('500');
  ok(pedidosListened() === 1, `volvió a pedir (pidió ${pedidosListened()})`);
  ok(cat?.cuentas?.escuchadasFallo === true, 'y vuelve a marcar el fallo');
}

console.log('\n[sin-opcion] loadListenedAlbums() SIN la opción ante el 500 sigue devolviendo null');
{
  modo = '500'; pedidos.length = 0;
  let r, tiro = null;
  try { r = await hd.loadListenedAlbums(); } catch (e) { tiro = e; }
  ok(!tiro && r === null, `devuelve null sin tirar${tiro ? ` (tiró: ${tiro.message})` : ` (dio ${JSON.stringify(r)})`}`);
  ok(pedidosListened() === 1, 'y sí pidió el JSON');
}

console.log('\n[days] loadDays() del owner sin detalle sigue devolviendo null sin tirar');
{
  pedidos.length = 0;
  let r, tiro = null;
  try { r = await hd.loadDays(); } catch (e) { tiro = e; }
  ok(!tiro && r === null, `null sin tirar${tiro ? ` (tiró: ${tiro.message})` : ''}`);
  ok(pedidos.length === 0, '0 fetch');
}

console.log('\n[sano] owner con el JSON bien: el catálogo de siempre y sin marca');
{
  const { cat } = await catalogo('ok');
  ok(pedidosListened() === 1, 'pidió el JSON una vez');
  ok(JSON.stringify(cat?.cuentas) === JSON.stringify({ total: 2, escuchadas: 1, filasEscuchadas: 1, likes: 1, likesSinTapa: 0, deLikes: 1, soloLikes: 1, enLasDos: 0 }), `cuentas de siempre, sin escuchadasFallo (dio ${JSON.stringify(cat?.cuentas)})`);
  ok(JSON.stringify(cat?.items.map(x => x.id)) === JSON.stringify([ID_HIST, ID_LIKE]), 'catálogo de siempre');
  ok(avisos.length === 0, 'sin warnings');
}

console.log(`\n[otra] cuenta que no es el owner (/me = ${OTRA}) y sin historial propio`);
{
  globalThis.__T108.me = OTRA;
  const { cat } = await catalogo('500');
  ok(pedidos.length === 0, `0 fetch (hubo ${pedidos.length})`);
  ok(cat && !('escuchadasFallo' in cat.cuentas), 'sin marca');
  ok(cat?.cuentas?.escuchadas === 0 && cat?.cuentas?.likes === 1, 'el catálogo sale con los me gusta');
}

// Va ÚLTIMO: `meFalloEnEstaCarga` queda puesto para el resto del proceso.
console.log('\n[sin-identidad] /me tira (identidad sin confirmar)');
{
  globalThis.__T108.me = OWNER; globalThis.__T108.meFalla = 'doble: /me en 429';
  const { cat, tiro } = await catalogo('500');
  ok(!tiro && cat && !('escuchadasFallo' in cat.cuentas), 'sin marca y sin tirar');
  ok(pedidos.length === 0, `0 fetch (hubo ${pedidos.length})`);
}

console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
