// tests/likes-sin-cargar.test.mjs — el aviso «no tengo tus me gusta cargados» (v=377, tanda 140)
//
// POR QUÉ ESTA SUITE EXISTE: `getBestAvailableLikes()` (`api.js`) no baja nada nunca: con la caché de me gusta de este navegador vacía (o
// de otra cuenta) devuelve `{ items: [], source: 'empty' }`. Hasta v=376:
//   · `#listened` (`attachLikes()`) seguía con `items: []` y pintaba ♥ 0 en cada tarjeta sin decir por qué;
//   · `buildAlbumHeardIndex()` (`util/album-heard.js`) y `buildFilterContext()` (`util/discover-filters.js`) MEMOIZABAN lo armado con el
//     vacío: cargar los me gusta en el Dashboard y volver a `#new-releases` o `#discover-artists` sin recargar seguía sin artistas;
//   · `#discover-artists` sin me gusta decía «Guarda más canciones y vuelve», que con la caché vacía es falso.
//
// Desde v=377:
//   · `avisoSinLikesHtml(queSaleSin)` (`ui/components.js`), una línea `<p class="aviso-sin-likes" role="status">` en el secundario;
//   · `#listened` la pinta en `#listened-likes-aviso` SOLO si `attachLikes()` leyó `source: 'empty'` (nunca por `items.length === 0`:
//     varios dobles de otros tests devuelven `{ items: [] }` sin `source` y fijan el HTML de su vista);
//   · los dos índices llevan `likesVacios` (con la misma regla) y, con `true`, NO se memoizan;
//   · `#discover-artists` corta con `tarjetaSinLikes()` cuando el índice dice `likesVacios` (en Node solo se lee: la vista no carga).
//
// Decidido con Ian el 27/11 (premisa falsa del encargo): en las dos vistas de descubrir los artistas SALEN de los me gusta, así que sin
// ellos no hay nada que «salga como no escuchado»; no hay línea bajo `#disco-filtros` (ni `pintarAvisoSinLikes`).
//
// 🔴 Todo INVENTADO (el repo es público). Los módulos REALES: `ui/components.js`, `util/album-heard.js`, `util/discover-filters.js`,
// `features/listened.js` y lo puro que importan; el resto de `src/js/` lo dobla `dobles/loader-t110.mjs` (sin tocar). `RAIZ_T140=<carpeta>`
// (la raíz de otra copia del repo) corre la suite contra ella (p. ej. 1389edd, para verla en rojo). Los módulos de referencia salen siempre
// de `git show 1389edd:…` sobre el repo de este archivo, cargados como `data:` en el mismo proceso (como la 133). Pantalla: el banco.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = resolve(import.meta.dirname, '..');
const RAIZ = process.env.RAIZ_T140 ? resolve(process.env.RAIZ_T140) : REPO;
const SRC = join(RAIZ, 'src', 'js');
const url = (rel) => pathToFileURL(join(SRC, rel)).href;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BASE = '1389edd';
const SHA_MAIN_CSS = '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07';
const SHA_COMPONENTS_CSS = '43018fe3dbdca7739c1d3a6295018d8b31edde51fa90c1fa3251be8f2430b645';

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const decir = console.log.bind(console);

// ── Los dobles ───────────────────────────────────────────────────────────────
const ARTISTA = 'Banda Inventada T140';
const pista = (i, album, total) => ({ added_at: `2026-01-0${i}T00:00:00Z`, track: {
  id: `pistaInventadaT140n${i}`, uri: `spotify:track:pistaInventadaT140n${i}`, name: `Tema Inventado ${i}`, duration_ms: 200000,
  artists: [{ id: 'bandaInventadaT140', name: ARTISTA }],
  album: { id: `discoT140${album}`, name: `Disco Inventado ${album}`, album_type: total > 3 ? 'album' : 'single', total_tracks: total, release_date: '2025-01-01',
    images: [{ url: `https://ejemplo.invalid/tapa-${album}.jpg` }] } } });
const LIKES = [pista(1, 'Uno', 10), pista(2, 'Uno', 10), pista(3, 'Dos', 2), pista(4, 'Tres', 12)];

// `respuesta`: lo que contesta `getBestAvailableLikes()`. `full` y `empty` como la API real; `sin-source` como los dobles de otros tests
// (`{ items: [] }`); `tira` para el `catch` de `attachLikes()`.
const estado = { respuesta: 'full', lecturasLikes: 0, lecturasBiblioteca: 0, bibliotecaTira: false };
async function likesDoble() {
  estado.lecturasLikes++;
  if (estado.respuesta === 'tira') throw new Error('doble t140: la lectura tira');
  if (estado.respuesta === 'empty') return { items: [], source: 'empty' };
  if (estado.respuesta === 'sin-source') return { items: [] };
  return { items: LIKES, source: 'full' };
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
globalThis.__T110 = {
  valores: {},
  stubs: {
    'api.js:getBestAvailableLikes': likesDoble,
    'api.js:getAllPlaylistItems': async () => [{ item: { name: 'Tema W', artists: [{ name: ARTISTA }], album: { name: 'Disco De La W' } } }],
    'api.js:getSavedAlbums': async () => {
      estado.lecturasBiblioteca++;
      if (estado.bibliotecaTira) throw new Error('doble t140: la biblioteca tira');
      return [{ added_at: '2026-01-01T00:00:00Z', album: { id: 'guardadoT140', name: 'Disco Guardado Inventado', artists: [{ name: ARTISTA }] } }];
    },
    'features/history-data.js:isOwner': async () => true,
    'features/history-data.js:loadTrackPlays': async () => ({ albums: [['Disco Del Historial', ARTISTA]] }),
    'features/history-data.js:loadListenedAlbums': async () => ({ years: [{ albums: [{ name: 'Disco Escuchado Inventado', artist: ARTISTA }] }] }),
    'util/playlist-add.js:getOwnPlaylists': async () => [],
    'util/cover-size.js:coverUrl': (imgs) => imgs?.[0]?.url || null,
    'storage.js:prefKey': (k) => `t140:${k}`,
    'storage.js:migratePrefKey': () => {},
  },
};
const ls = new Map([['t140:wthree_playlist_id', 'playlistWthreeInventadaT140']]);
globalThis.window = globalThis.window || {};
// `escapeHtml()` (el real) escapa con un `<div>`: `textContent` → `innerHTML`. El doble hace lo mismo que el navegador con `&`, `<` y `>`.
const divDoble = () => { let t = ''; return { set textContent(v) { t = String(v); }, get innerHTML() { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; };
globalThis.document = { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, documentElement: {}, createElement: divDoble };
globalThis.requestAnimationFrame = () => 0;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem() {}, removeItem() {} };
console.warn = () => {};
console.info = () => {};

const REALES = ['/js/ui/components.js', '/js/util/album-heard.js', '/js/util/discover-filters.js', '/js/features/listened.js',
  '/js/features/listened-shared.js', '/js/util/likes-de-la-obra.js', '/js/util/album-key.js', '/js/util/edition-suffix.js',
  '/js/util/track-match.js', '/js/util/song-identity.js', '/js/util/versions-guard.js', '/js/util/release-size.js', '/js/util/cache-solo-exitos.js'];
register('./dobles/loader-t110.mjs', { parentURL: pathToFileURL(import.meta.filename), data: { reales: REALES } });
decir(`raíz bajo prueba: ${RAIZ}`);

// El módulo de 1389edd, en este mismo proceso: los imports relativos van a las rutas del repo (pasan por el mismo loader).
async function moduloBase(rel) {
  try {
    const fuente = execFileSync('git', ['-C', REPO, 'show', `${BASE}:src/js/${rel}`], { encoding: 'utf8' });
    const dir = dirname(join(REPO, 'src', 'js', rel));
    const abs = fuente.replace(/from '(\.{1,2}\/[^']+)'/g, (m, p) => `from '${pathToFileURL(resolve(dir, p)).href}'`);
    return await import('data:text/javascript;base64,' + Buffer.from(abs).toString('base64'));
  } catch (e) { decir(`  (no se pudo cargar ${rel} de ${BASE}: ${e.message})`); return null; }
}
const intentar = async (rel) => { try { return await import(url(rel)); } catch (e) { decir(`  (no cargó ${rel}: ${e.message})`); return {}; } };

const comp = await intentar('ui/components.js');
const heard = await intentar('util/album-heard.js');
const filtros = await intentar('util/discover-filters.js');
const lis = await intentar('features/listened.js');
const heardBase = await moduloBase('util/album-heard.js');
const filtrosBase = await moduloBase('util/discover-filters.js');
const lisBase = await moduloBase('features/listened.js');
ok(!!heardBase?.buildAlbumHeardIndex && !!filtrosBase?.buildFilterContext && !!lisBase?._attachLikes, `los módulos de ${BASE} se cargaron (git show) para comparar`);

// Para comparar índices y contextos: Set y Map a arrays ordenados.
const plano = (o, fuera = []) => JSON.stringify(Object.keys(o || {}).filter((k) => !fuera.includes(k)).sort().map((k) => {
  const v = o[k];
  if (v instanceof Set) return [k, [...v].map(String).sort()];
  if (v instanceof Map) return [k, [...v.entries()].map(([a, b]) => [String(a), b instanceof Set ? [...b].sort() : b]).sort()];
  return [k, v];
}));

// ── 1. avisoSinLikesHtml ─────────────────────────────────────────────────────
decir('· avisoSinLikesHtml()');
{
  const f = comp.avisoSinLikesHtml;
  ok(typeof f === 'function', 'ui/components.js exporta avisoSinLikesHtml');
  const h = typeof f === 'function' ? f('los ♥ de estas tarjetas no cuentan tus me gusta') : '';
  ok(h.includes('No hay me gusta en la caché de este navegador, así que los ♥ de estas tarjetas no cuentan tus me gusta. ')
    && h.includes('>Cárgalos desde el Dashboard</a>.'), 'el texto exacto');
  ok(/^<p class="aviso-sin-likes" role="status"/.test(h), 'un <p class="aviso-sin-likes" role="status">');
  ok(/<a href="#dashboard"[^>]*text-decoration:underline/.test(h), 'el enlace a #dashboard, subrayado');
  ok(h.includes('color:var(--color-text-secondary)') && !h.includes('muted'), 'en --color-text-secondary, nunca el muted');
  ok(!h.includes('--color-accent'), 'el enlace no va en el acento');
  const x = typeof f === 'function' ? f('<b>inventado</b>') : '<b>';
  ok(!x.includes('<b>') && x.includes('&lt;b&gt;inventado&lt;/b&gt;'), 'escapa queSaleSin: un <b> sale como texto');
}

// ── 2. buildAlbumHeardIndex ──────────────────────────────────────────────────
decir('· buildAlbumHeardIndex()');
async function indice(mod, respuesta) {
  estado.respuesta = respuesta;
  mod.invalidateAlbumHeardIndex?.();
  const antes = estado.lecturasLikes;
  const r1 = await mod.buildAlbumHeardIndex();
  const r2 = await mod.buildAlbumHeardIndex();
  return { r1, r2, lecturas: estado.lecturasLikes - antes };
}
if (heard.buildAlbumHeardIndex) {
  const v = await indice(heard, 'empty');
  ok(v.r1.likesVacios === true, `con source 'empty' → likesVacios: true (${v.r1.likesVacios})`);
  ok(v.lecturas === 2 && v.r2 !== v.r1, `y no se memoiza: la segunda llamada vuelve a leer los me gusta (${v.lecturas} lecturas)`);
  const l = await indice(heard, 'full');
  ok(l.r1.likesVacios === false, `con source 'full' → likesVacios: false (${l.r1.likesVacios})`);
  ok(l.lecturas === 1 && l.r2 === l.r1, `y se memoiza como siempre: la segunda no vuelve a leer (${l.lecturas} lectura)`);
  const s = await indice(heard, 'sin-source');
  ok(s.r1.likesVacios === false, `con { items: [] } sin source → likesVacios: false (${s.r1.likesVacios})`);
  ok(s.lecturas === 1, `y se memoiza (${s.lecturas} lectura): sin source no es «no hay me gusta cargados»`);
  for (const resp of ['full', 'empty', 'sin-source']) {
    const n = (await indice(heard, resp)).r1;
    const b = heardBase ? (await indice(heardBase, resp)).r1 : null;
    ok(b && plano(n, ['likesVacios']) === plano(b), `con '${resp}', el resto del índice es el de ${BASE} con los mismos datos`);
  }
  heard.invalidateAlbumHeardIndex?.();
} else {
  for (let i = 0; i < 9; i++) ok(false, 'buildAlbumHeardIndex no cargó');
}

// ── 3. buildFilterContext ────────────────────────────────────────────────────
decir('· buildFilterContext()');
async function contexto(mod, respuesta, bibliotecaTira = false) {
  estado.respuesta = respuesta;
  estado.bibliotecaTira = bibliotecaTira;
  mod.invalidateFilterContext?.();
  heard.invalidateAlbumHeardIndex?.();
  const antes = estado.lecturasBiblioteca;
  const r1 = await mod.buildFilterContext();
  const r2 = await mod.buildFilterContext();
  estado.bibliotecaTira = false;
  return { r1, r2, lecturas: estado.lecturasBiblioteca - antes };
}
if (filtros.buildFilterContext) {
  const v = await contexto(filtros, 'empty');
  ok(v.r1.likesVacios === true, `con source 'empty' → likesVacios: true (${v.r1.likesVacios})`);
  ok(v.lecturas === 2 && v.r2 !== v.r1, `y no se memoiza: la segunda llamada vuelve a leer (${v.lecturas} lecturas de la biblioteca)`);
  const l = await contexto(filtros, 'full');
  ok(l.r1.likesVacios === false, `con source 'full' → likesVacios: false (${l.r1.likesVacios})`);
  ok(l.lecturas === 1 && l.r2 === l.r1, `y se memoiza como siempre (${l.lecturas} lectura)`);
  const s = await contexto(filtros, 'sin-source');
  ok(s.r1.likesVacios === false && s.lecturas === 1, `con { items: [] } sin source → likesVacios: false y se memoiza (${s.r1.likesVacios}, ${s.lecturas})`);
  const d = await contexto(filtros, 'empty', true);
  ok(d.r1.likesVacios === true && d.r1.bibliotecaFallo === true && d.lecturas === 2, `con bibliotecaFallo y los me gusta vacíos, tampoco memoiza (${d.lecturas} lecturas)`);
  for (const resp of ['full', 'empty']) {
    const n = (await contexto(filtros, resp)).r1;
    const b = filtrosBase ? (await contexto(filtrosBase, resp)).r1 : null;
    ok(b && plano(n, ['likesVacios']) === plano(b), `con '${resp}', el resto del contexto es el de ${BASE} con los mismos datos`);
  }
} else {
  for (let i = 0; i < 8; i++) ok(false, 'buildFilterContext no cargó');
}

// ── 4. #listened: lo que deja attachLikes ────────────────────────────────────
decir('· #listened (attachLikes)');
const discos = () => ['Uno', 'Dos', 'Tres', 'Cuatro'].map((n) => ({ id: `discoT140${n}`, name: `Disco Inventado ${n}`, artist: ARTISTA,
  artistAlts: [ARTISTA], year: '2025', tracks: [{ name: 'Tema Inventado 1', artists: ARTISTA, uri: 'spotify:track:pistaInventadaT140n1' }] }));
async function tarjetas(mod, respuesta) {
  estado.respuesta = respuesta;
  const lista = discos();
  await mod._attachLikes(lista);
  return { lista, vacios: typeof mod._likesVaciosListened === 'function' ? mod._likesVaciosListened() : undefined };
}
if (lis._attachLikes) {
  ok((await tarjetas(lis, 'empty')).vacios === true, `con source 'empty' → el aviso se pinta (_likesVaciosListened: true)`);
  ok((await tarjetas(lis, 'full')).vacios === false, `con source 'full' → no (false)`);
  ok((await tarjetas(lis, 'sin-source')).vacios === false, `con { items: [] } sin source → no (false)`);
  ok((await tarjetas(lis, 'tira')).vacios === false, `si getBestAvailableLikes tira → no: eso es otro fallo (false)`);
  for (const resp of ['full', 'empty', 'tira']) {
    const n = await tarjetas(lis, resp);
    const b = lisBase ? await tarjetas(lisBase, resp) : null;
    ok(b && JSON.stringify(n.lista) === JSON.stringify(b.lista), `con '${resp}', lo que calcula _attachLikes es lo de ${BASE}`);
  }
} else {
  for (let i = 0; i < 7; i++) ok(false, 'listened.js no cargó');
}

// ── 5. Lecturas estáticas ────────────────────────────────────────────────────
decir('· lecturas estáticas');
{
  const leer = (rel) => { try { return readFileSync(join(SRC, rel), 'utf8'); } catch { return ''; } };
  const lisSrc = leer('features/listened.js');
  ok(/likesVaciosListened \? `<div id="listened-likes-aviso">\$\{avisoSinLikesHtml\(/.test(lisSrc),
    '#listened: #listened-likes-aviso nace en buildUI solo con likesVaciosListened, pegado a la línea de antes (con me gusta, el HTML de siempre)');
  ok(/likesVaciosListened = source === 'empty'/.test(lisSrc), "#listened: la señal es source === 'empty'");
  const da = leer('features/discover-artists.js');
  ok(/idx\.likesVacios\s*\?\s*tarjetaSinLikes\(\)/.test(da), '#discover-artists: con likesVacios corta con tarjetaSinLikes()');
  for (const [rel, re] of [['util/album-heard.js', /if \(!likesVacios\) cache = idx;/], ['util/discover-filters.js', /if \(!bibliotecaFallo && !likesVacios\) ctxCache = ctx;/]]) {
    ok(re.test(leer(rel)), `${rel}: el vacío no se memoiza`);
  }
  ok(sha(readFileSync(join(RAIZ, 'src/css/main.css'))) === SHA_MAIN_CSS, `main.css byte a byte el de ${BASE}`);
  ok(sha(readFileSync(join(RAIZ, 'src/css/components.css'))) === SHA_COMPONENTS_CSS, `components.css byte a byte el de ${BASE}`);
  // `allowFetch` en src/js: las mismas apariciones que en 1389edd.
  const contar = (txt) => (txt.match(/allowFetch/g) || []).length;
  const todos = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? todos(p) : (p.endsWith('.js') ? [p] : []); });
  const ahora = todos(SRC).reduce((n, p) => n + contar(readFileSync(p, 'utf8')), 0);
  const antes = execFileSync('git', ['-C', REPO, 'grep', '-c', 'allowFetch', BASE, '--', 'src/js'], { encoding: 'utf8' })
    .trim().split('\n').reduce((n, l) => n + Number(l.split(':').pop() || 0), 0);
  ok(ahora === antes, `ningún allowFetch nuevo en src/js (${ahora} apariciones, ${antes} en ${BASE})`);
  const funcion = (txt, nombre) => { const l = txt.split('\n'); const a = l.findIndex((x) => x.startsWith(`async function ${nombre}(`)); const b = l.findIndex((x, k) => k > a && x === '}'); return a >= 0 ? l.slice(a, b + 1).join('\n') : ''; };
  const apiHoy = leer('api.js'), apiBase = execFileSync('git', ['-C', REPO, 'show', `${BASE}:src/js/api.js`], { encoding: 'utf8' });
  for (const nombre of ['getBestAvailableLikes', 'leerLikesCacheados']) {
    const t = funcion(apiHoy, nombre);
    ok(t && sha(t) === sha(funcion(apiBase, nombre)), `${nombre}: el mismo sha256 de texto que en ${BASE} (${t ? sha(t).slice(0, 12) : 'no está'}…)`);
  }
}

decir(`\n${bien} asserts OK · ${mal} fallaron`);
process.exit(mal ? 1 : 0);
