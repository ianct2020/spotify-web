// tests/guardar-tira-biblioteca.test.mjs — lo que guardás cuenta como «en tu biblioteca» al instante (v=372, tanda 135)
//
// POR QUÉ ESTA SUITE EXISTE: hasta v=371 un guardado CONFIRMADO de «Guardar álbum» / «Guardar single» (`guardarLanzamiento()`,
// `features/discover-common.js`) no tocaba la caché de `getSavedAlbums()` (`saved_albums_v2`, 60 minutos, `api.js`). El chip «Solo los de
// tu biblioteca» y «📚 Por escuchar» de `#listened` seguían leyendo la biblioteca de ANTES de guardar durante una hora, también después
// de recargar (la caché vive en IndexedDB). Desde v=372, cuando `albumsInLibrary()` dice `true`, `guardarLanzamiento()` llama a
// `olvidarBibliotecaGuardada()` (`api.js`, nueva), que borra `saved_albums_v2` con `idbDel` y espera. Si el borrado falla, el guardado
// sigue siendo un éxito (el disco SÍ quedó en Spotify) y el error crudo va a `console.warn('[guardar] …')`. Un guardado que no se confirma
// no toca nada.
//
// ⚠️ Lo que NO hace, a propósito: anotar el id en el contexto memoizado de los filtros de descubrir (`ctxCache` de
// `util/discover-filters.js`). Después de guardar, la vista llama a `markAlbumResolved()` y `albumIsUnheard()` saca el disco de la lista
// ANTES de los filtros, así que el chip «Fuera los de tu biblioteca» no lo vería aunque el contexto lo tuviera (medido en el banco
// `novedades` contra 6b1087b: el contador queda igual antes y después de guardar). La suite afirma que el guardado no pide nada más.
//
// Los casos, cada uno con su resultado esperado escrito ANTES de correrlo:
//   1. confirmado → `saved_albums_v2` ya no está, `saved_albums_v1` no se toca, el borrado va DESPUÉS del `contains`, y la siguiente
//      `getSavedAlbums()` hace `GET /me/albums` y trae el disco nuevo;
//   2. confirmado → 0 `fetch` después del `contains` (el guardado no relee la biblioteca);
//   3. `contains` [false], `contains` que tira (corte y 500), `PUT` 403 → la caché sigue, ningún `idbDel`, y el error es el mismo texto
//      que en v=371;
//   4. el `idbDel` que tira → devuelve `{ destino: 'biblioteca' }`, hay un `console.warn('[guardar] …')` con el error crudo, y con el
//      aviso el toast verde de siempre;
//   5. sin ninguna caché (la ficha de `#similar` también pasa por aquí) → no tira y no queda nada;
//   6. conservación: las peticiones del guardado son las mismas 2 que en v=371 (`PUT` + `GET contains`);
//   7. lecturas estáticas: la invalidación vive en `guardarLanzamiento` y en ningún otro sitio de `src/js`; `getSavedAlbums` igual que en
//      6b1087b (texto); `main.css` y `components.css` iguales byte a byte.
//
// 🔴 Todo INVENTADO (el repo es público). `discover-common.js` y `api.js` REALES en Node; el resto de `src/js/` lo dobla
// `dobles/loader-t110.mjs` (sin tocar). La IndexedDB es un `Map` en los stubs de `idb.js`, que anota cada borrado en la misma línea de
// tiempo que las peticiones. `RAIZ_T135=<carpeta>` corre la suite contra otra copia (p. ej. 6b1087b, para verla en rojo); el fuente de
// referencia de las lecturas estáticas sale siempre de `git show 6b1087b:…` sobre el repo de este archivo.

import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const raiz = process.env.RAIZ_T135 ? resolve(process.env.RAIZ_T135) : repo;
const SRC = join(raiz, 'src', 'js');
const url = (rel) => pathToFileURL(join(SRC, rel)).href;

const decir = console.log.bind(console);
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}

// ── La IndexedDB de mentira y la línea de tiempo ────────────────────────────────────────────────
const idb = new Map();
const tiempo = [];                       // 'fetch METODO ruta' | 'idbDel clave'
const falla = { idbDel: null };          // si trae un Error, `idbDel` lo tira
const toasts = [];
globalThis.__T110 = {
  valores: { 'util/copia-completa.js:CENSO': [] },
  stubs: {
    'ui/toast.js:showToast': (message, type = 'info') => { toasts.push({ message, type }); },
    'ui/components.js:escapeHtml': (s) => String(s ?? ''),
    'idb.js:idbGetCached': async (k) => (idb.has(k) ? idb.get(k) : null),
    'idb.js:idbGet': async (k) => (idb.has(k) ? idb.get(k) : undefined),
    'idb.js:idbSetCached': async (k, v) => { idb.set(k, v); },
    'idb.js:idbDel': async (k) => { tiempo.push(`idbDel ${k}`); if (falla.idbDel) throw falla.idbDel; idb.delete(k); },
  },
};
globalThis.document = { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: {} };
globalThis.window ??= globalThis;
globalThis.requestAnimationFrame = () => 0;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const setTimeoutReal = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...a) => setTimeoutReal(fn, 0, ...a);

const avisos = [];
console.warn = (...a) => { avisos.push(a.map((x) => (x instanceof Error ? `${x.message}` : String(x))).join(' ')); };
console.error = () => {};
console.info = () => {};

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
const ID = 'lanzT135Inventado00001';
const AL = { id: ID, name: 'Single Inventado T135', total: 1 };
const VIEJO = { added_at: '2026-01-01T00:00:00Z', album: { id: 'guardadoT135Inventado1', name: 'Disco Viejo Inventado T135', artists: [{ id: 'bandaT135Inventadaxxxx', name: 'Banda Inventada T135' }] } };
const NUEVO = { added_at: '2026-11-19T00:00:00Z', album: { id: ID, name: AL.name, artists: [{ id: 'bandaT135Inventadaxxxx', name: 'Banda Inventada T135' }] } };
const red = { put: '200', contains: '[true]', biblioteca: [VIEJO, NUEVO] };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (u, opciones = {}) => {
  const x = new URL(String(u));
  const metodo = String(opciones.method || 'GET').toUpperCase();
  const ruta = decodeURIComponent(x.pathname.replace(/^\/v1/, '') + x.search);
  tiempo.push(`fetch ${metodo} ${ruta}`);
  if (x.hostname !== 'api.spotify.com') throw new TypeError('doble t135: host no esperado ' + x.hostname);
  if (metodo === 'PUT' && x.pathname === '/v1/me/library') {
    if (red.put === '403') return json({ error: { status: 403, message: 'Forbidden (inventado t135)' } }, 403);
    return new Response('', { status: 200 });
  }
  if (metodo === 'GET' && x.pathname === '/v1/me/library/contains') {
    if (red.contains === '500') return new Response('error inventado t135', { status: 500 });
    if (red.contains === 'corte') throw new TypeError('Failed to fetch (corte inventado t135)');
    return json(JSON.parse(red.contains));
  }
  if (metodo === 'GET' && x.pathname === '/v1/me/albums') return json({ items: red.biblioteca, limit: 50, offset: 0, total: red.biblioteca.length, next: null });
  return json({ error: { status: 404, message: `doble t135: ruta sin simular (${metodo} ${ruta})` } }, 404);
};

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/features/discover-common.js', '/js/api.js'] },
});
const dc = await import(url('features/discover-common.js'));
const api = await import(url('api.js'));
decir(`src bajo prueba: ${SRC}`);

const PUT = `fetch PUT /me/library?uris=spotify:album:${ID}`;
const GET = `fetch GET /me/library/contains?uris=spotify:album:${ID}`;
const TEXTO_NO_APARECE = (n) => `Spotify ha aceptado guardar «${n}», pero todavía no aparece en tu biblioteca de álbumes. Compruébalo en Spotify antes de volver a intentarlo.`;
const PREFIJO_SIN_COMPROBAR = (n) => `No se ha podido comprobar si «${n}» ha quedado guardado en tu biblioteca: `;

async function caso(nombre, { put = '200', contains = '[true]', cache = true, idbDel = null } = {}, fn) {
  decir(`\n${nombre}`);
  red.put = put; red.contains = contains; falla.idbDel = idbDel;
  idb.clear();
  if (cache) { idb.set('saved_albums_v2', [VIEJO]); idb.set('saved_albums_v1', [VIEJO]); }
  tiempo.length = 0; toasts.length = 0; avisos.length = 0;
  let r, e;
  try { r = await fn(); } catch (err) { e = err; }
  decir(`    línea de tiempo: ${tiempo.join(' , ') || '(nada)'}`);
  decir(`    ${e ? `tiró: ${e.message}` : `devolvió: ${JSON.stringify(r)}`}`);
  return { r, e, tiempo: [...tiempo], toasts: [...toasts], avisos: [...avisos], v2: idb.get('saved_albums_v2'), v1: idb.get('saved_albums_v1') };
}

// 1) Confirmado: la caché se tira, después del contains, y la siguiente lectura va a la red.
{
  const c = await caso('1. PUT 200 y contains [true]', {}, () => dc.guardarLanzamiento(AL));
  ok(!c.e && c.r?.destino === 'biblioteca', '1: devuelve { destino: "biblioteca" }, como en v=371');
  ok(c.v2 === undefined, '1: `saved_albums_v2` ya no está en la IndexedDB');
  ok(Array.isArray(c.v1), '1: `saved_albums_v1` no se toca');
  ok(c.tiempo.filter((t) => t.startsWith('idbDel')).join() === 'idbDel saved_albums_v2', `1: un solo borrado, el de saved_albums_v2 (${c.tiempo.filter((t) => t.startsWith('idbDel')).join(' , ') || 'ninguno'})`);
  ok(c.tiempo.indexOf('idbDel saved_albums_v2') > c.tiempo.indexOf(GET) && c.tiempo.indexOf(GET) >= 0, '1: el borrado va DESPUÉS del contains');
  tiempo.length = 0;
  const leidos = await api.getSavedAlbums();
  ok(tiempo.includes('fetch GET /me/albums?limit=50'), `1: la siguiente getSavedAlbums() hace GET /me/albums (${tiempo.join(' , ') || 'nada'})`);
  ok(Array.isArray(leidos) && leidos.some((g) => g.album.id === ID), '1: y trae el disco recién guardado');
}

// 2) El guardado no relee la biblioteca: 0 fetch después del contains.
{
  const c = await caso('2. confirmado: nada después del contains', {}, () => dc.guardarLanzamiento(AL));
  const tras = c.tiempo.slice(c.tiempo.indexOf(GET) + 1).filter((t) => t.startsWith('fetch'));
  ok(c.tiempo.includes(GET) && tras.length === 0, `2: 0 fetch después del contains (${tras.join(' , ') || 'ninguno'})`);
}

// 3) Lo que no se confirma no toca nada, con el mismo texto que en v=371.
{
  const c = await caso('3a. contains [false]', { contains: '[false]' }, () => dc.guardarLanzamiento(AL));
  ok(c.e?.message === TEXTO_NO_APARECE(AL.name), '3a: tira con el texto de v=371');
  ok(Array.isArray(c.v2) && !c.tiempo.some((t) => t.startsWith('idbDel')), '3a: la caché sigue y no hay ningún idbDel');
}
for (const [modo, crudo] of [['corte', /No se pudo conectar con Spotify/], ['500', /Spotify 500/]]) {
  const c = await caso(`3b. contains ${modo}`, { contains: modo }, () => dc.guardarLanzamiento(AL));
  ok(!!c.e && c.e.message.startsWith(PREFIJO_SIN_COMPROBAR(AL.name)) && crudo.test(c.e.message), `3b ${modo}: tira con el texto de v=371 y el error crudo`);
  ok(Array.isArray(c.v2) && !c.tiempo.some((t) => t.startsWith('idbDel')), `3b ${modo}: la caché sigue y no hay ningún idbDel`);
}
{
  const c = await caso('3c. PUT 403', { put: '403' }, () => dc.guardarLanzamiento(AL));
  ok(!!c.e && /Spotify 403/.test(c.e.message), '3c: tira con el error de Spotify, como en v=371');
  ok(Array.isArray(c.v2) && !c.tiempo.some((t) => t.startsWith('idbDel')), '3c: la caché sigue y no hay ningún idbDel');
}

// 4) El borrado que falla no convierte un guardado en un fracaso.
{
  const crudo = new Error('borrado inventado t135 que falla');
  const c = await caso('4. idbDel tira', { idbDel: crudo }, () => dc.guardarLanzamiento(AL));
  ok(!c.e && c.r?.destino === 'biblioteca', `4: el guardado devuelve éxito igual (${c.e ? c.e.message : 'ok'})`);
  ok(c.tiempo.includes('idbDel saved_albums_v2'), '4: intentó borrar saved_albums_v2');
  ok(c.avisos.some((a) => a.startsWith('[guardar]') && a.includes(crudo.message)), `4: console.warn('[guardar] …') con el error crudo (${c.avisos.join(' | ') || 'ninguno'})`);
  const c2 = await caso('4b. idbDel tira, con el aviso', { idbDel: crudo }, () => dc.guardarLanzamientoConAviso(AL));
  ok(!c2.e && c2.toasts.length === 1 && c2.toasts[0].type === 'success' && c2.toasts[0].message === `«${AL.name}» guardado en tu biblioteca de álbumes`,
    `4b: el toast verde de siempre (${c2.toasts.map((t) => `[${t.type}] ${t.message}`).join(' || ') || 'ninguno'})`);
}

// 5) Sin ninguna caché (por ejemplo, nadie abrió todavía #listened ni descubrir): no tira y no queda nada.
{
  const c = await caso('5. sin caché, con el aviso (el camino de #similar)', { cache: false }, () => dc.guardarLanzamientoConAviso(AL));
  ok(!c.e && c.toasts.some((t) => t.type === 'success'), '5: no tira y da el toast verde');
  ok(c.v2 === undefined && c.v1 === undefined, '5: no queda ninguna caché');
}

// 6) Conservación: las peticiones del guardado.
{
  const c = await caso('6. las peticiones del guardado', {}, () => dc.guardarLanzamiento(AL));
  const pedidas = c.tiempo.filter((t) => t.startsWith('fetch'));
  ok(pedidas.length === 2 && pedidas[0] === PUT && pedidas[1] === GET, `6: exactamente PUT + GET contains, las 2 de v=371 (${pedidas.join(' , ')})`);
}

// 7) Lecturas estáticas.
decir('\n7. lecturas estáticas');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const comun = readFileSync(join(SRC, 'features', 'discover-common.js'), 'utf8');
const iGL = comun.indexOf('export async function guardarLanzamiento(');
const cuerpoGL = iGL >= 0 ? comun.slice(iGL, comun.indexOf('\n}\n', iGL)) : '';
ok(/await olvidarBibliotecaGuardada\(\)/.test(sinComentarios(cuerpoGL)), '7: guardarLanzamiento llama (y espera) a olvidarBibliotecaGuardada()');
const archivos = [];
(function recorrer(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) recorrer(p); else if (n.endsWith('.js')) archivos.push(p); } })(SRC);
const llamadores = archivos.filter((p) => /olvidarBibliotecaGuardada\(\)/.test(sinComentarios(readFileSync(p, 'utf8')).replace(/function olvidarBibliotecaGuardada\(\)/g, '')));
ok(llamadores.length === 1 && llamadores[0].endsWith(join('features', 'discover-common.js')),
  `7: nadie más la llama en src/js (${llamadores.map((p) => p.split('/js/').pop()).join(', ') || 'nadie'})`);
const llamadas = (sinComentarios(comun).match(/olvidarBibliotecaGuardada\(\)/g) || []).length;
ok(llamadas === 1, `7: y discover-common.js la llama UNA vez (${llamadas})`);
const apiTexto = readFileSync(join(SRC, 'api.js'), 'utf8');
const textoDe = (fuente, nombre) => { const i = fuente.indexOf(`async function ${nombre}(`); return i >= 0 ? fuente.slice(i, fuente.indexOf('\n}\n', i)) : null; };
let apiVieja = '';
try { apiVieja = execFileSync('git', ['-C', repo, 'show', '6b1087b:src/js/api.js'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { /* lo dice el assert */ }
ok(!!textoDe(apiVieja, 'getSavedAlbums') && textoDe(apiTexto, 'getSavedAlbums') === textoDe(apiVieja, 'getSavedAlbums'), '7: getSavedAlbums, su paginado, su tope y su TTL, iguales que en 6b1087b (texto)');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
ok(sha(join(raiz, 'src', 'css', 'main.css')) === '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07', '7: main.css igual byte a byte');
ok(sha(join(raiz, 'src', 'css', 'components.css')) === 'd8f9ac141e2b28daf0d192885c8ff8a29c6dad2c8320382af41b30023be6738a', '7: components.css igual byte a byte');

decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
