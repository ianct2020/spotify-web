// tests/guardar-verificado.test.mjs — «guardado» solo si Spotify dice que está (v=365, tanda 128)
//
// POR QUÉ ESTA SUITE EXISTE: hasta v=364 `guardarLanzamiento()` (`features/discover-common.js`) mandaba el
// `PUT /me/library?uris=spotify:album:{id}` y, con un 200, devolvía «guardado» sin preguntarle nada a Spotify. Que ese
// `PUT` guarde un `single` nunca se verificó con la Spotify real: si Spotify contestara 200 y no lo guardara, la app
// diría «guardado en tu biblioteca de álbumes» y sería falso. Es la familia del `catch` de `#versions` que daba por
// verificado lo que no se verificó.
//
// La regla: `guardarLanzamiento()` devuelve SOLO si `albumsInLibrary()` (`api.js`, la que ya existía) confirma que el
// lanzamiento está. Si dice que no, o si no se pudo preguntar, TIRA (y los tres llamadores, que no cambiaron, lo pintan
// en rojo). Sin reintentos y sin esperas: no hay número medido de cuánto tarda el `contains` en enterarse.
//
// 🔴 Todo INVENTADO (el repo es público). El `discover-common.js` y el `api.js` REALES en Node; el resto de `src/js/`
// lo dobla `dobles/loader-t110.mjs` (el de la tanda 110, sin tocar: arma cada doble leyendo los nombres que exporta el
// módulo real). `fetch` hace de Spotify. `RAIZ_T128` corre la suite contra otra raíz (p. ej. una copia de v=364).

import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const raiz = process.env.RAIZ_T128 ? resolve(process.env.RAIZ_T128) : join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(raiz, 'src', 'js');
const url = (rel) => pathToFileURL(join(SRC, rel)).href;

const decir = console.log.bind(console);
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────
const toasts = [];
globalThis.__T110 = {
  // `api.js` filtra `CENSO` al cargarse (línea ~1071): el doble tiene que ser un array, no una función.
  valores: { 'util/copia-completa.js:CENSO': [] },
  stubs: {
    'ui/toast.js:showToast': (message, type = 'info') => { toasts.push({ message, type }); },
    'ui/components.js:escapeHtml': (s) => String(s ?? ''),
  },
};
globalThis.document = { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: {} };
globalThis.window ??= globalThis;
globalThis.requestAnimationFrame = () => 0;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
// Los reintentos de `spotifyFetch` (500 y cortes) duermen con `setTimeout`: acá no esperan de verdad.
const setTimeoutReal = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...a) => setTimeoutReal(fn, 0, ...a);

const avisos = [];
console.warn = (...a) => { avisos.push(a.map((x) => (x instanceof Error ? `${x.message}` : String(x))).join(' ')); };
console.error = () => {};
console.info = () => {};

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
// `put`: cómo contesta el PUT ('200' | '403'). `contains`: '[true]' | '[false]' | '[]' | '[true,true]' | '500' | 'corte'.
const red = { put: '200', contains: '[true]', pedidas: [] };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (u, opciones = {}) => {
  const x = new URL(String(u));
  const metodo = String(opciones.method || 'GET').toUpperCase();
  const ruta = decodeURIComponent(x.pathname.replace(/^\/v1/, '') + x.search);
  red.pedidas.push(`${metodo} ${ruta}`);
  if (x.hostname !== 'api.spotify.com') throw new TypeError('doble t128: host no esperado ' + x.hostname);
  if (metodo === 'PUT' && x.pathname === '/v1/me/library') {
    if (red.put === '403') return json({ error: { status: 403, message: 'Forbidden (inventado t128)' } }, 403);
    return new Response('', { status: 200 });
  }
  if (metodo === 'GET' && x.pathname === '/v1/me/library/contains') {
    if (red.contains === '500') return new Response('error inventado t128', { status: 500 });
    if (red.contains === 'corte') throw new TypeError('Failed to fetch (corte inventado t128)');
    return json(JSON.parse(red.contains));
  }
  return json({ error: { status: 404, message: `doble t128: ruta sin simular (${metodo} ${ruta})` } }, 404);
};

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/features/discover-common.js', '/js/api.js'] },
});
const dc = await import(url('features/discover-common.js'));
decir(`src bajo prueba: ${SRC}`);

const ID = 'lanzT128Inventado00001';            // 22 caracteres, como los de verdad
const AL = { id: ID, name: 'Single Inventado T128', total: 1 };
const PUT = `PUT /me/library?uris=spotify:album:${ID}`;
const GET = `GET /me/library/contains?uris=spotify:album:${ID}`;
const TEXTO_NO_APARECE = (n) => `Spotify ha aceptado guardar «${n}», pero todavía no aparece en tu biblioteca de álbumes. Compruébalo en Spotify antes de volver a intentarlo.`;
const PREFIJO_SIN_COMPROBAR = (n) => `No se ha podido comprobar si «${n}» ha quedado guardado en tu biblioteca: `;

async function caso(nombre, { put = '200', contains = '[true]' }, fn) {
  decir(`\n${nombre}`);
  red.put = put; red.contains = contains; red.pedidas = [];
  toasts.length = 0; avisos.length = 0;
  let r, e;
  try { r = await fn(); } catch (err) { e = err; }
  decir(`    peticiones: ${red.pedidas.join(' , ') || '(ninguna)'}`);
  decir(`    ${e ? `tiró: ${e.message}` : `devolvió: ${JSON.stringify(r)}`}`);
  if (toasts.length) decir(`    toasts: ${toasts.map((t) => `[${t.type}] ${t.message}`).join(' || ')}`);
  return { r, e, pedidas: [...red.pedidas], toasts: [...toasts], avisos: [...avisos] };
}

// 1) Confirmado.
{
  const { r, e, pedidas } = await caso('1. PUT 200 y contains [true]', { contains: '[true]' }, () => dc.guardarLanzamiento(AL));
  ok(!e && r?.destino === 'biblioteca', 'con [true] devuelve { destino: "biblioteca" }, como hoy');
  ok(pedidas.length === 2 && pedidas[0] === PUT && pedidas[1] === GET, `las peticiones son exactamente PUT + GET contains (${pedidas.length})`);
}

// 2) Spotify dice que no está.
{
  const { e, pedidas, avisos: av } = await caso('2. PUT 200 y contains [false]', { contains: '[false]' }, () => dc.guardarLanzamiento(AL));
  ok(!!e, 'con [false] tira');
  ok(e?.message === TEXTO_NO_APARECE(AL.name), 'con el texto exacto («…pero todavía no aparece… Compruébalo en Spotify antes de volver a intentarlo.»)');
  ok(!/no se ha guardado|ha fallado|falló/i.test(e?.message || ''), 'el texto no afirma que falló (el contains puede ir retrasado)');
  ok(pedidas.length === 2 && pedidas[1] === GET, 'preguntó UNA vez, sin reintentos');
  ok(av.some((a) => a.startsWith('[guardar]')), 'y va a console.warn con [guardar]');
}
{
  const { e } = await caso('2b. [false] y el lanzamiento sin nombre', { contains: '[false]' }, () => dc.guardarLanzamiento({ id: ID }));
  ok(e?.message === TEXTO_NO_APARECE('el lanzamiento'), 'sin nombre dice «el lanzamiento»');
}

// 3) No se pudo preguntar: 500 y corte.
for (const [modo, crudo] of [['500', /Spotify 500/], ['corte', /No se pudo conectar con Spotify/]]) {
  const { e, avisos: av } = await caso(`3. PUT 200 y contains ${modo}`, { contains: modo }, () => dc.guardarLanzamiento(AL));
  ok(!!e, `contains ${modo}: tira`);
  ok(e?.message.startsWith(PREFIJO_SIN_COMPROBAR(AL.name)), `contains ${modo}: con «No se ha podido comprobar si «…» ha quedado guardado en tu biblioteca: »`);
  ok(crudo.test(e?.message || ''), `contains ${modo}: y el error crudo detrás`);
  ok(!/guardado en tu biblioteca de álbumes/.test(e?.message || ''), `contains ${modo}: nunca «guardado»`);
  ok(av.some((a) => a.startsWith('[guardar]') && crudo.test(a)), `contains ${modo}: el error crudo va a console.warn con [guardar]`);
}

// 4) Respuesta corta o larga.
for (const modo of ['[]', '[true,true]']) {
  const { e } = await caso(`4. PUT 200 y contains ${modo}`, { contains: modo }, () => dc.guardarLanzamiento(AL));
  ok(!!e && e.message.startsWith(PREFIJO_SIN_COMPROBAR(AL.name)), `contains ${modo}: tira con «No se ha podido comprobar…»`);
}

// 5) El PUT falla: tira como hoy y no se pregunta nada.
{
  const { e, pedidas } = await caso('5. PUT 403', { put: '403' }, () => dc.guardarLanzamiento(AL));
  ok(!!e && /Spotify 403/.test(e.message), 'PUT 403: tira con el error de Spotify, como hoy');
  ok(pedidas.length === 1 && pedidas[0] === PUT, `PUT 403: no se pregunta nada después (${pedidas.join(' , ')})`);
}

// 6) Con el aviso.
{
  const { e, toasts: ts } = await caso('6. guardarLanzamientoConAviso con [false]', { contains: '[false]' }, () => dc.guardarLanzamientoConAviso(AL));
  ok(!!e, 'con [false] tira también con el aviso');
  ok(!ts.some((t) => t.type === 'success'), 'NINGÚN toast verde');
  ok(!ts.some((t) => /guardado en tu biblioteca/.test(t.message)), 'ningún toast que diga «guardado»');
}
{
  const { e, toasts: ts } = await caso('6b. guardarLanzamientoConAviso con [true]', { contains: '[true]' }, () => dc.guardarLanzamientoConAviso(AL));
  ok(!e && ts.length === 1 && ts[0].type === 'success' && ts[0].message === `«${AL.name}» guardado en tu biblioteca de álbumes`, 'con [true], el mismo toast verde de siempre');
}

// 7) Lectura estática.
decir('\n7. lectura estática');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const comun = readFileSync(join(SRC, 'features', 'discover-common.js'), 'utf8');
const iGL = comun.indexOf('export async function guardarLanzamiento(');
const cuerpoGL = iGL >= 0 ? comun.slice(iGL, comun.indexOf('\n}\n', iGL)) : '';
ok(/albumsInLibrary\(\[al\.id\]\)/.test(cuerpoGL), 'guardarLanzamiento llama a albumsInLibrary([al.id])');
ok(/import \{[^}]*\balbumsInLibrary\b[^}]*\} from '\.\.\/api\.js'/.test(comun), 'y la importa de api.js (la que ya existía)');
const archivos = [];
(function recorrer(d) { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) recorrer(p); else if (n.endsWith('.js')) archivos.push(p); } })(SRC);
const conContains = archivos.filter((p) => /library\/contains/.test(sinComentarios(readFileSync(p, 'utf8'))));
ok(conContains.length === 1 && conContains[0].endsWith(join('js', 'api.js')), `solo api.js pregunta /me/library/contains (${conContains.map((p) => p.split('/js/').pop()).join(', ')})`);
const api = sinComentarios(readFileSync(join(SRC, 'api.js'), 'utf8'));
const deAlbum = [...api.matchAll(/^(?:async )?function (\w+)\([^)]*\) \{[\s\S]*?^\}/gm)]
  .filter((m) => /library\/contains/.test(m[0]) && /spotify:album:/.test(m[0])).map((m) => m[1]);
ok(deAlbum.length === 1 && deAlbum[0] === 'albumsInLibrary', `una sola función pregunta contains de álbumes, albumsInLibrary (${deAlbum.join(', ')})`);

decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
