// tests/historial-caido-wthree-112.test.mjs — tanda 112 (v=355), T112a, punto 1.
//
// `#wthree` con el owner y `history-stats.json` caído (500, `fetch` que rechaza con `TypeError`, 200 con HTML). Desde
// v=353 la línea de `AVISO_HISTORIAL_ILEGIBLE` sale arriba de los cubos, pero hasta v=354 el cubo seguía titulado
// «Sin picks — priorizados por tiempo escuchado» (sin ningún tiempo: el orden cae al año de los escuchados) y el pie
// decía «0 álbumes del top historial · N más detectados…», que se lee como un resultado. Desde v=355, con la
// anotación de `stats`, el título queda «🔴 Sin picks» y el pie no cuenta el top historial (lo demás sigue).
//
// A diferencia de `historial-caido-wthree.test.mjs` (que no se tocó), acá `history-listened-albums.json` trae dos
// discos INVENTADOS que no están en la playlist: así el cubo «Sin picks» se pinta y el título se puede mirar.
// `wthree.js`, `history-data.js` y `history-keys.js` son los REALES, con el loader y el doble de la tanda 108 sin
// tocar (`loader-escuchadas-caidas-92b.mjs`, `escuchadas-caidas-92b-doble.mjs`). Datos INVENTADOS (`t112inventada…`).
// `T112_SRC` (opcional) apunta a otra copia de `src/` (los rojos contra d33e0749); con `T112_MEDIR=1` solo imprime
// el sha256 sano.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const RAIZ_SRC = process.env.T112_SRC ? resolve(process.env.T112_SRC) : resolve(import.meta.dirname, '../src');
const OWNER = 'orhs6wu5ykk7ql80u92ujn74o';
const AVISO = 'No se ha podido leer tu historial, así que esta parte sale sin él. Recarga la página para volver a intentarlo.';
// El HTML sano (normalizado) de `#wthree-content` con estos datos, medido con este mismo test contra d33e0749 (v=354).
const SHA_SANO = process.env.T112_MEDIR ? null : 'd48ab3e2efaa29f56fc740f5c7ccc9429a0fe36da3bfb244ac73927c4e3fd85c';

const LISTENED = { version: 1, criteria: { min_tracks_sameday: 4, min_min_sameday: 25 }, years: [
  { year: 2023, albums: [{ name: 'Disco t112inventada 2', artist: 'Artista t112inventada 2', date: '2023-05-10', img: '' }] },
  { year: 2024, albums: [{ name: 'Disco t112inventada 1', artist: 'Artista t112inventada 1', date: '2024-03-10', img: '' }] },
] };
const STATS = { top_albums_all_time: [{ name: 'Disco t112inventada 3', artist: 'Artista t112inventada 3', img: '', min: 180, plays: 54 }] };

globalThis.__T92B_WTHREE = { historialError: null, historialCalls: 0, playlistCalls: 0 };
globalThis.__T108_92B = { me: OWNER };
const avisos = [];
console.warn = (...a) => avisos.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' '));
console.log = ((log) => (...a) => { if (!String(a[0]).startsWith('[history-data]')) log(...a); })(console.log);
globalThis.localStorage = { getItem: (k) => (k === 'wthree_playlist_id' ? 't112inventadaplwthree0' : k === 'wthree_playlist_name' ? 'Playlist t112inventada' : null), setItem() {}, removeItem() {} };
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
  if (/history-listened-albums\.json/.test(s)) return json(LISTENED);
  if (!/history-stats\.json/.test(s)) throw new TypeError('doble: fetch no esperado ' + s);
  if (modo === '500') return new Response('error inventado t112', { status: 500 });
  if (modo === 'rechaza') throw new TypeError('Failed to fetch');
  if (modo === 'nojson') return new Response('<!doctype html><p>no es JSON</p>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  return json(STATS);
};

register('./dobles/loader-escuchadas-caidas-92b.mjs', pathToFileURL(import.meta.filename));
const wthree = await import(pathToFileURL(resolve(RAIZ_SRC, 'js/features/wthree.js')).href);
console.log(`src bajo prueba: ${RAIZ_SRC}`);

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const hash = (x) => createHash('sha256').update(x.replace(/\s+/g, ' ').trim()).digest('hex');
const plano = (x) => x.replace(/\s+/g, ' ');
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
  console.log(`\n[T112a · ${m}] owner (/me = owner, IndexedDB vacía), history-stats.json: ${como}; los escuchados, bien (2 discos)`);
  const html = await pintar(m);
  const p = plano(html);
  ok(pedidosStats() === 1, `pidió history-stats.json una vez (pidió ${pedidosStats()})`);
  ok(html.includes(AVISO), 'la línea de AVISO_HISTORIAL_ILEGIBLE sigue');
  ok(/Disco t112inventada 1/.test(html) && /Disco t112inventada 2/.test(html), 'el cubo «Sin picks» trae los dos discos escuchados');
  ok(!/priorizados por tiempo escuchado/.test(html), 'el título del cubo NO dice «priorizados por tiempo escuchado»');
  ok(/<h3>🔴 Sin picks<\/h3>/.test(html), 'el título del cubo es «🔴 Sin picks»');
  ok(!/del top historial/.test(html), 'el pie NO dice «… álbumes del top historial»');
  ok(p.includes('2 detectados en tu historial de escucha · 0 álbumes en la playlist'), 'el pie dice lo que sí se sabe: «2 detectados en tu historial de escucha · 0 álbumes en la playlist»');
}

console.log('\n[sano] owner con los dos JSON bien: la vista de siempre');
{
  const html = await pintar('ok');
  ok(!html.includes(AVISO), 'sin la línea');
  ok(/priorizados por tiempo escuchado/.test(html), 'el título dice «priorizados por tiempo escuchado»');
  ok(plano(html).includes('1 álbumes del top historial · 2 más detectados en tu historial de escucha · 0 álbumes en la playlist'), 'el pie de siempre');
  const medido = hash(html);
  console.log(`  sha256 sano medido: ${medido}`);
  if (SHA_SANO) ok(medido === SHA_SANO, `HTML normalizado idéntico al sano de d33e0749 (${medido.slice(0, 12)}…)`);
}

console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
