// tests/biblioteca-lectura.test.mjs — la biblioteca vacía no es un error, y un error no es una biblioteca vacía (v=364, tanda 127)
//
// POR QUÉ ESTA SUITE EXISTE: hasta v=363 `getSavedAlbums()` no distinguía «no tienes álbumes guardados» de «Spotify contestó algo que
// no se puede leer». `spotifyFetch` devuelve `null` con un 200 que no es JSON, con un 204 y con un cuerpo vacío (es su contrato con el
// resto de la app, y no se toca); la lectura hacía `r?.items || []`, cortaba el bucle sin error y GUARDABA 60 minutos lo que hubiera
// juntado: `[]` si la rota era la primera página, una mitad si era otra. Arriba, el chip «Solo los de tu biblioteca» de `#listened`
// trataba todo `[]` como un fallo (un error que no pasó, para quien de verdad no tiene nada guardado) y el filtro «Fuera los de tu
// biblioteca» de Descubrir y Novedades dejaba de descartar sin decirlo, con el contexto fallido memoizado hasta recargar.
//
// La regla: `getSavedAlbums()` devuelve la biblioteca ENTERA o TIRA. Nunca un vacío ni una mitad que no son la verdad, y nada de eso
// llega a la caché. La clave pasó a `saved_albums_v2`: una `v1` escrita por la versión anterior puede ser un `[]` falso.
//
// 🔴 Todo INVENTADO (el repo es público). El `api.js` y el `util/discover-filters.js` REALES en Node (`dobles/loader-t127.mjs`), un
// `localStorage` de mentira y un `fetch` que hace de Spotify. Cada caso de la lectura importa `api.js?caso=N` (módulo frío).

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

register('./dobles/loader-t127.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const decir = console.log.bind(console);
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}
const fin = () => { decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`); process.exit(fallaron ? 1 : 0); };

const avisos = [];
console.log = () => {};
console.info = () => {};
console.warn = (...a) => { avisos.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')); };
console.error = (...a) => { avisos.push(a.map(String).join(' ')); };

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────
const lsMapa = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { lsMapa.set(k, String(v)); },
  removeItem: (k) => { lsMapa.delete(k); },
  key: (i) => [...lsMapa.keys()][i] ?? null,
  get length() { return lsMapa.size; },
  clear: () => lsMapa.clear(),
};
globalThis.window ??= globalThis;
globalThis.__DOBLE = { toasts: [] };

const V1 = 'saved_albums_v1', V2 = 'saved_albums_v2';
const ULTIMO = 'fonoteca_last_user_id';
const A = 't127-cuenta-a-inventada', B = 't127-cuenta-b-inventada';
const guardado = (i) => ({ added_at: '2026-01-01T00:00:00Z', album: { id: `discoInventadoT127n${i}`, name: `Disco inventado ${i}`, album_type: 'album', total_tracks: 10, images: [], artists: [{ id: 'bandaInventadaT127', name: 'Banda inventada' }] } });

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
// `modo`: cómo contesta `GET /me/albums`. `total`: cuántos guardados tiene la biblioteca cuando contesta bien.
const red = { modo: 'bien', total: 120, pedidas: 0, meId: A };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = () => new Response('<!doctype html><title>inventado</title><p>esto no es JSON</p>', { status: 200, headers: { 'content-type': 'text/html' } });
function pagina(offset, limit) {
  const hasta = Math.min(red.total, offset + limit);
  return {
    items: Array.from({ length: Math.max(0, hasta - offset) }, (_, i) => guardado(offset + i)),
    limit, offset, total: red.total,
    next: hasta < red.total ? `https://api.spotify.com/v1/me/albums?offset=${hasta}&limit=${limit}` : null,
  };
}
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  if (ruta === '/me') return json({ id: red.meId, display_name: 'Inventado' });
  if (ruta === '/me/tracks') return json({ items: [], total: 0, next: null });
  if (ruta === '/me/playlists') return json({ items: [], total: 0, next: null });
  if (ruta === '/me/albums') {
    red.pedidas++;
    const offset = +(u.searchParams.get('offset') || 0), limit = +(u.searchParams.get('limit') || 20);
    const rota = red.modo.endsWith('-p2') ? offset > 0 : true;   // `html-p2`: la página 1 sale bien y la rota es la segunda
    const que = red.modo.replace(/-p2$/, '');
    if (que === 'bien' || !rota) return json(pagina(offset, limit));
    if (que === 'html') return html();
    if (que === '204') return new Response(null, { status: 204 });
    if (que === 'cuerpo-vacio') return new Response('', { status: 200, headers: { 'content-type': 'application/json' } });
    if (que === 'sin-items') return json({ href: 'inventado', total: 3 });
    if (que === 'items-no-array') return json({ items: 'esto no es una lista', next: null });
    if (que === 'sin-fin') return json({ ...pagina(offset, limit), next: `https://api.spotify.com/v1/me/albums?offset=${offset + limit}&limit=${limit}` });
  }
  return new Response('{}', { status: 599 });
};

const idb = () => globalThis.__IDB_OTRA;
const envolver = (value, minutos = 60) => ({ value, storedAt: Date.now(), expiry: Date.now() + minutos * 60000 });
let nCaso = 0;
const cargarApi = () => import(pathToFileURL(join(raiz, 'src/js/api.js')).href + `?caso=${++nCaso}`);
const cargarFiltros = () => import(pathToFileURL(join(raiz, 'src/js/util/discover-filters.js')).href + `?caso=${++nCaso}`);

function escenario({ modo = 'bien', total = 120, ultimo = A, me = A } = {}) {
  globalThis.__IDB_OTRA = { kv: new Map(), lecturas: [], intentos: [], borrados: [], escrituras: [], fallanBorrar: new Set(), demoraBorrar: 0 };
  lsMapa.clear();
  lsMapa.set('sp_access_token', 'tok-inventado-t127');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
  if (ultimo) lsMapa.set(ULTIMO, ultimo);
  Object.assign(red, { modo, total, pedidas: 0, meId: me });
  avisos.length = 0;
}
const vaciarCola = async () => { await idb().cola; await new Promise((r) => setTimeout(r, 20)); await idb().cola; };
const sinTirar = async (f) => { try { return { valor: await f() }; } catch (e) { return { error: e }; } };
const escritas = () => [...idb().kv.keys()].filter((k) => String(k).startsWith('saved_albums'));
const describir = (r) => (r.error ? `tiró «${r.error.message}»` : `devolvió ${Array.isArray(r.valor) ? `un array de ${r.valor.length}` : JSON.stringify(r.valor)}`);
const mensaje = (n) => `La biblioteca de Spotify devolvió una respuesta que no se puede leer (página ${n}).`;

// ── 1. Una respuesta que no se puede leer: TIRA y no guarda nada ────────────────────────────────
decir('· una respuesta que no se puede leer tira y no guarda nada');
for (const [nombre, modo, pag, pedidas] of [
  ['un 200 que no es JSON en la página 1', 'html', 1, 1],
  ['un 200 que no es JSON en la página 2', 'html-p2', 2, 2],
  ['un 204 en la página 1', '204', 1, 1],
  ['un 204 en la página 2', '204-p2', 2, 2],
  ['un cuerpo vacío', 'cuerpo-vacio', 1, 1],
  ['un objeto sin `items`', 'sin-items', 1, 1],
  ['un objeto con `items` que no es un array', 'items-no-array', 1, 1],
]) {
  escenario({ modo });
  const api = await cargarApi();
  const r = await sinTirar(() => api.getSavedAlbums());
  await vaciarCola();
  ok(!!r.error, `${nombre}: tira (${describir(r)})`);
  ok(r.error?.message === mensaje(pag), `${nombre}: el mensaje nombra la página ${pag} («${r.error?.message}»)`);
  ok(escritas().length === 0, `${nombre}: no se escribió ninguna caché (${escritas().join(', ') || 'ninguna'})`);
  ok(red.pedidas === pedidas, `${nombre}: ${pedidas} GET /me/albums (${red.pedidas})`);
}

// Y después de un fallo, la llamada siguiente vuelve a pedir desde el principio (no quedó nada a medias).
escenario({ modo: 'html-p2' });
{
  const api = await cargarApi();
  await sinTirar(() => api.getSavedAlbums());
  await vaciarCola();
  red.modo = 'bien'; red.pedidas = 0;
  const r = await sinTirar(() => api.getSavedAlbums());
  await vaciarCola();
  ok(r.valor?.length === 120 && red.pedidas === 3, `tras una mitad rota, la lectura siguiente pide las 3 páginas y trae las 120 (${describir(r)}, ${red.pedidas} GET)`);
}

// ── 2. Una biblioteca vacía de verdad es un resultado ───────────────────────────────────────────
decir('· una biblioteca vacía de verdad');
escenario({ total: 0 });
{
  const api = await cargarApi();
  const r = await sinTirar(() => api.getSavedAlbums());
  await vaciarCola();
  ok(Array.isArray(r.valor) && r.valor.length === 0, `devuelve [] (${describir(r)})`);
  const w = idb().kv.get(V2);
  ok(Array.isArray(w?.value) && w.value.length === 0, `y queda escrita en ${V2} (${escritas().join(', ') || 'ninguna'})`);
  const min = w ? (w.expiry - Date.now()) / 60000 : NaN;
  ok(min > 59 && min <= 60, `con 60 min de vida (${min.toFixed(1)})`);
  ok(!idb().kv.has(V1), `nada en ${V1}`);
  red.pedidas = 0;
  const r2 = await sinTirar(() => api.getSavedAlbums());
  ok(Array.isArray(r2.valor) && r2.valor.length === 0 && red.pedidas === 0, `la segunda lectura sale de la caché: 0 GET (${red.pedidas})`);
}

// ── 3. Tres páginas buenas ──────────────────────────────────────────────────────────────────────
decir('· tres páginas buenas');
escenario({ total: 120 });
{
  const api = await cargarApi();
  const r = await sinTirar(() => api.getSavedAlbums());
  await vaciarCola();
  ok(r.valor?.length === 120 && red.pedidas === 3, `las 120, en 3 GET (${describir(r)}, ${red.pedidas})`);
  ok(JSON.stringify(r.valor?.map((it) => it.album.id)) === JSON.stringify(Array.from({ length: 120 }, (_, i) => guardado(i).album.id)), 'en el orden en que llegaron');
  ok(r.valor?.[0]?.added_at === '2026-01-01T00:00:00Z' && !!r.valor?.[0]?.album?.name, 'los items crudos { added_at, album }');
  ok(idb().kv.get(V2)?.value?.length === 120, `escrita entera en ${V2} (${idb().kv.get(V2)?.value?.length})`);
  red.pedidas = 0;
  await api.getSavedAlbums();
  ok(red.pedidas === 0, `la segunda lectura, 0 GET (${red.pedidas})`);
  await sinTirar(() => api.getSavedAlbums({ force: true }));
  ok(red.pedidas === 3, `con force, vuelve a pedir las 3 (${red.pedidas})`);
}

// ── 4. Una `v1` vieja con `[]` no se lee ────────────────────────────────────────────────────────
decir('· una v1 vieja no se lee');
escenario({ total: 120 });
{
  idb().kv.set(V1, envolver([], 45));   // el `[]` falso que pudo dejar la versión anterior, todavía vigente
  const api = await cargarApi();
  const r = await sinTirar(() => api.getSavedAlbums());
  await vaciarCola();
  ok(r.valor?.length === 120 && red.pedidas === 3, `con un [] vigente en ${V1}, lee de Spotify: 120 en 3 GET (${describir(r)}, ${red.pedidas})`);
  ok(!idb().lecturas.includes(V1), `no leyó ${V1} (leyó: ${[...new Set(idb().lecturas)].filter((k) => String(k).startsWith('saved')).join(', ') || 'ninguna saved_*'})`);
}

// ── 5. El cambio de usuario borra las dos claves ────────────────────────────────────────────────
decir('· el cambio de usuario borra las dos claves');
escenario({ ultimo: A, me: B });
{
  idb().kv.set(V1, envolver([guardado(1)]));
  idb().kv.set(V2, envolver([guardado(2)]));
  const api = await cargarApi();
  const r = await sinTirar(() => api.getCurrentUserId());
  await vaciarCola();
  ok(r.valor === B, `el usuario es el nuevo (${describir(r)})`);
  ok(!idb().kv.has(V1), `${V1} borrada`);
  ok(!idb().kv.has(V2), `${V2} borrada`);
}
escenario({ ultimo: A, me: A });
{
  idb().kv.set(V2, envolver([guardado(2)]));
  const api = await cargarApi();
  await sinTirar(() => api.getCurrentUserId());
  await vaciarCola();
  ok(idb().kv.has(V2), `con el mismo usuario, ${V2} se queda`);
}

// ── 6. El tope de 40 páginas: se guarda como siempre, pero avisa ────────────────────────────────
decir('· el tope de 40 páginas');
escenario({ modo: 'sin-fin', total: 5000 });
{
  const api = await cargarApi();
  const r = await sinTirar(() => api.getSavedAlbums());
  await vaciarCola();
  ok(r.valor?.length === 2000 && red.pedidas === 40, `corta en 40 páginas: 2.000 (${describir(r)}, ${red.pedidas} GET)`);
  ok(idb().kv.get(V2)?.value?.length === 2000, 'y lo guarda, como hasta ahora');
  ok(avisos.some((a) => a.startsWith('[biblioteca]') && a.includes('2.000')), `con un console.warn('[biblioteca] …') que dice 2.000 (${avisos.filter((a) => a.startsWith('[biblioteca]')).join(' | ') || 'ninguno'})`);
}
escenario({ total: 120 });
{
  const api = await cargarApi();
  await api.getSavedAlbums();
  ok(!avisos.some((a) => a.startsWith('[biblioteca]')), 'una lectura que termina sola no avisa');
}

// ── 7. `buildFilterContext()`: el fallo se dice y no se memoiza ─────────────────────────────────
decir('· buildFilterContext() con la lectura que tira');
escenario({ modo: 'html' });
{
  const F = await cargarFiltros();
  const r1 = await sinTirar(() => F.buildFilterContext());
  ok(!r1.error, `no tira (${r1.error?.message})`);
  ok(r1.valor?.bibliotecaFallo === true, `bibliotecaFallo: true (${r1.valor?.bibliotecaFallo})`);
  ok(r1.valor?.guardados instanceof Set && r1.valor.guardados.size === 0, 'guardados vacío');
  ok(['escuchados', 'basesTuyas', 'temaEnAlbum', 'enSinEscuchar'].every((k) => r1.valor?.[k] != null), 'el resto del contexto se arma igual');
  ok(avisos.some((a) => a.startsWith('[discover-filtros] no pude leer tu biblioteca')), `el error crudo sigue en console.warn('[discover-filtros] …')`);
  ok(red.pedidas === 1, `pidió /me/albums una vez (${red.pedidas})`);
  const r2 = await sinTirar(() => F.buildFilterContext());
  ok(red.pedidas === 2, `la segunda llamada vuelve a pedir: no quedó memoizado (${red.pedidas})`);
  ok(r2.valor?.bibliotecaFallo === true && r2.valor !== r1.valor, 'y da otro contexto, también con bibliotecaFallo');
  // Spotify se recupera: la tercera sale bien y ESA sí se memoiza.
  red.modo = 'bien';
  const r3 = await sinTirar(() => F.buildFilterContext());
  ok(r3.valor?.bibliotecaFallo === false && r3.valor.guardados.size === 120, `recuperada: bibliotecaFallo false y 120 guardados (${r3.valor?.bibliotecaFallo}, ${r3.valor?.guardados?.size})`);
  const antes = red.pedidas;
  const r4 = await sinTirar(() => F.buildFilterContext());
  ok(r4.valor === r3.valor && red.pedidas === antes, `y la cuarta es la misma, sin pedir (${red.pedidas - antes})`);
}

decir('· buildFilterContext() con la lectura buena');
escenario({ total: 120 });
{
  const F = await cargarFiltros();
  const r1 = await sinTirar(() => F.buildFilterContext());
  ok(r1.valor?.bibliotecaFallo === false, `bibliotecaFallo: false (${r1.valor?.bibliotecaFallo})`);
  ok(r1.valor?.guardados?.size === 120, `120 guardados (${r1.valor?.guardados?.size})`);
  ok(red.pedidas === 3, `3 GET (${red.pedidas})`);
  idb().kv.delete(V2);   // sin la caché de la lectura: si volviera a leer, pediría
  const r2 = await sinTirar(() => F.buildFilterContext());
  ok(r2.valor === r1.valor && red.pedidas === 3, `la segunda llamada es el mismo contexto y no pide (${red.pedidas})`);
}
escenario({ total: 0 });
{
  const F = await cargarFiltros();
  const r1 = await sinTirar(() => F.buildFilterContext());
  ok(r1.valor?.bibliotecaFallo === false && r1.valor?.guardados?.size === 0, `una biblioteca vacía no es un fallo: bibliotecaFallo false (${r1.valor?.bibliotecaFallo})`);
  idb().kv.delete(V2);
  await sinTirar(() => F.buildFilterContext());
  ok(red.pedidas === 1, `y se memoiza (${red.pedidas} GET)`);
}

// ── 8. Lectura estática: las dos vistas pintan la línea con la MISMA función, y la clave vieja solo se borra ─────────
decir('· lectura estática');
{
  const { readFileSync } = await import('node:fs');
  const leer = (r) => readFileSync(join(raiz, r), 'utf8');
  const comun = leer('src/js/features/discover-common.js');
  ok(/export function pintarAvisoBibliotecaFiltros\(/.test(comun), 'discover-common.js exporta pintarAvisoBibliotecaFiltros()');
  ok(comun.includes('No se ha podido leer tu biblioteca de Spotify: «Fuera los de tu biblioteca» no está descartando nada.'), 'con el texto de la línea');
  for (const vista of ['discover-artists.js', 'new-releases.js']) {
    const n = (leer(`src/js/features/${vista}`).match(/pintarAvisoBibliotecaFiltros\(state\.filterCtx, state\.filtros\)/g) || []).length;
    ok(n === 1, `${vista} la llama una vez, con su contexto y sus filtros (${n})`);
  }
  const api = leer('src/js/api.js');
  ok((api.match(/'saved_albums_v1'/g) || []).length === 1 && /const SAVED_ALBUMS_KEY_VIEJA = 'saved_albums_v1';/.test(api), 'api.js nombra saved_albums_v1 una sola vez, como la clave vieja');
  ok((api.match(/\bSAVED_ALBUMS_KEY_VIEJA\b/g) || []).length === 2, 'y la clave vieja solo se usa para borrarla');
  ok(!/r\?\.items \|\| \[\]/.test(api.slice(api.indexOf('async function getSavedAlbums'), api.indexOf('async function getSavedAlbums') + 1500)), 'getSavedAlbums() ya no hace `r?.items || []`');
}

fin();
