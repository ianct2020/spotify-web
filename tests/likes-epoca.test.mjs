// tests/likes-epoca.test.mjs — un escritor de la caché de me gusta no guarda si la cuenta cambió mientras esperaba (v=348, tanda 105)
//
// POR QUÉ ESTA SUITE EXISTE: desde v=346, `saveLikes()` y `savePartial()` no escriben si la marca
// `fonoteca_likes_de_otro_v1` está puesta EN EL MOMENTO DE ESCRIBIR. Pero la marca vive solo mientras dura el borrado de
// la pestaña que cambió de cuenta: si la otra pestaña entra con otra cuenta, borra bien y quita la marca mientras un
// escritor de ESTA pestaña espera (una paginación de minutos, un `/me/tracks?limit=1`, una lectura de IndexedDB), el
// escritor ya no ve marca y guarda los me gusta de la cuenta vieja. Desde v=348 cada escritor toma su «época» al empezar
// (el `fonoteca_last_user_id` de ese momento) y `saveLikes` / `savePartial` no escriben si cambió.
//
// «La otra pestaña» (`otraPestana()`), en el medio de la espera de cada escritor, hace lo que hace
// `revisarCambioDeUsuario()` con un borrado que sale bien: `fonoteca_last_user_id` A → B, la marca, el borrado de las
// dos claves de IndexedDB y de las dos heredadas de `localStorage` (que es compartido entre pestañas), y quitar la marca.
//
// El `api.js` REAL en Node con los dobles de la 98/103 (`dobles/loader-otra-cuenta.mjs`, `dobles/idb-otra-cuenta-doble.mjs`),
// un `localStorage` y un `fetch` de mentira. Todo INVENTADO (el repo es público).

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

register('./dobles/loader-otra-cuenta.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const decir = console.log.bind(console);
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}

const avisos = [];
console.log = () => {};
console.info = () => {};
console.warn = (...a) => { avisos.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')); };
console.error = () => {};

// El `sleep(600)` entre páginas de `paginateAll` no aporta nada acá: se acorta a 0. Las demás esperas (el tope de 3 s
// del borrado, por ejemplo) quedan como están.
const setTimeoutReal = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => setTimeoutReal(f, ms === 600 ? 0 : ms, ...a);

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

const MARCA = 'fonoteca_likes_de_otro_v1';
const ULTIMO = 'fonoteca_last_user_id';
const CUENTA_A = 't105-cuenta-a-inventada';   // la de esta pestaña al empezar
const CUENTA_B = 't105-cuenta-b-inventada';   // la que entra en la otra pestaña
const COMPLETA = 'all_liked_tracks';
const PARCIAL = 'all_liked_tracks_partial';
const pista = (i) => ({ added_at: `2025-0${1 + (i % 9)}-1${i % 9}T10:00:00Z`, track: { id: `t105x${i}`, uri: `spotify:track:t105x${i}`, name: `Tema inventado ${i}`, duration_ms: 200000, artists: [{ id: `ar${i % 3}`, name: `Artista inventado ${i % 3}` }], album: { id: `al${i}`, name: `Disco inventado ${i}`, album_type: 'album', total_tracks: 10, images: [] } } });
// 600 me gusta: 12 páginas de 50, así `paginateAll` guarda el parcial a la décima.
const BIBLIOTECA = Array.from({ length: 600 }, (_, i) => pista(i));

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
// `alPedir(ruta, metodo, url)` corre ANTES de contestar: ahí entra la otra pestaña.
const red = { total: BIBLIOTECA.length, pedidos: [], alPedir: null };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  const metodo = (opciones.method || 'GET').toUpperCase();
  red.pedidos.push(`${metodo} ${ruta}${u.search}`);
  if (red.alPedir) red.alPedir(ruta, metodo, u);
  if (ruta === '/me' && metodo === 'GET') return json({ id: CUENTA_A, display_name: 'Inventado' });
  if (ruta === '/me/tracks' && metodo === 'GET') {
    const limit = +(u.searchParams.get('limit') || 20), offset = +(u.searchParams.get('offset') || 0);
    const items = BIBLIOTECA.slice(offset, offset + limit).map((it) => ({ added_at: it.added_at, track: structuredClone(it.track) }));
    return json({ items, total: red.total, next: offset + limit < BIBLIOTECA.length ? 'https://api.spotify.com/v1/me/tracks?más' : null });
  }
  if (ruta === '/me/library' && (metodo === 'DELETE' || metodo === 'PUT')) return new Response('', { status: 200 });
  if (ruta === '/me/playlists' && metodo === 'GET') {
    const offset = +(u.searchParams.get('offset') || 0);
    if (offset > 0) return new Response('{"error":{"message":"inventado"}}', { status: 404 });
    return json({ items: [{ id: 'pl1', name: 'Lista inventada', owner: { id: CUENTA_A } }], total: 2, next: 'https://api.spotify.com/v1/me/playlists?más' });
  }
  return new Response('{}', { status: 599 });
};

const idb = () => globalThis.__IDB_OTRA;
let nCaso = 0;
const cargar = () => import(pathToFileURL(join(raiz, 'src/js/api.js')).href + `?caso=${++nCaso}`);
const sinTirar = async (f) => { try { return { valor: await f() }; } catch (e) { return { error: e }; } };

/** La pestaña es de la cuenta A, sin marca. `cache`: cuántos me gusta de A hay en la caché (0 = vacía). */
function escenario({ cache = 0 } = {}) {
  globalThis.__IDB_OTRA = { kv: new Map(), lecturas: [], intentos: [], borrados: [], escrituras: [], fallanBorrar: new Set(), demoraBorrar: 0 };
  lsMapa.clear();
  lsMapa.set('sp_access_token', 'tok-inventado-t105');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
  lsMapa.set(ULTIMO, CUENTA_A);
  if (cache) idb().kv.set(COMPLETA, { value: BIBLIOTECA.slice(0, cache), storedAt: Date.now(), expiry: null });
  Object.assign(red, { total: BIBLIOTECA.length, pedidos: [], alPedir: null });
  avisos.length = 0;
  globalThis.__DOBLE.toasts.length = 0;
  estado.cambio = null;
}
const estado = { cambio: null };
/** La otra pestaña entra con la cuenta B y borra bien: A → B, la marca, el borrado, la marca fuera. */
function otraPestana() {
  lsMapa.set(ULTIMO, CUENTA_B);
  lsMapa.set(MARCA, CUENTA_A);
  idb().kv.delete(COMPLETA);
  idb().kv.delete(PARCIAL);
  lsMapa.delete('spc_' + COMPLETA);
  lsMapa.delete('spc_' + COMPLETA + '_partial');
  lsMapa.delete(MARCA);
  estado.cambio = idb().escrituras.length;
}
/** Las escrituras de la caché de me gusta (la completa o el parcial) desde que cambió la cuenta. */
const escriturasDespues = () => (estado.cambio == null ? [] : idb().escrituras.slice(estado.cambio).filter((k) => k === COMPLETA || k === PARCIAL));
const escriturasTodas = () => idb().escrituras.filter((k) => k === COMPLETA || k === PARCIAL);
/** La otra pestaña entra en la PRIMERA lectura de la completa (la espera de `removeFromLikesCache` / `addToLikesCache`). */
function alLeerLaCompleta(f) {
  const kv = idb().kv;
  const get = kv.get.bind(kv);
  let armado = true;
  kv.get = (k) => { const v = get(k); if (armado && k === COMPLETA) { armado = false; f(); } return v; };
}
/** La otra pestaña entra justo DESPUÉS de la primera escritura de la completa (la espera de la mudanza de la heredada). */
function trasEscribirLaCompleta(f) {
  const kv = idb().kv;
  const set = kv.set.bind(kv);
  let armado = true;
  kv.set = (k, v) => { const r = set(k, v); if (armado && k === COMPLETA) { armado = false; f(); } return r; };
}
const heredada = (valor) => JSON.stringify({ value: valor, storedAt: Date.now(), expiry: Date.now() + 86_400_000 });

const tabla = [];
async function caso(escritor, preparar, correr) {
  for (const conOtra of [true, false]) {
    escenario(preparar.escenario);
    const api = await cargar();
    preparar.antes?.(api, conOtra);
    const r = await sinTirar(() => correr(api));
    if (conOtra) {
      const desp = escriturasDespues();
      ok(estado.cambio != null, `${escritor}: la otra pestaña entró en el medio de la espera`);
      ok(desp.length === 0, `🔴 ${escritor}, con la otra pestaña: 0 escrituras de la caché de me gusta después de que cambió la cuenta (${desp.length}: ${desp.join(', ') || '—'})`);
      ok(lsMapa.get(ULTIMO) === CUENTA_B && !lsMapa.has(MARCA), `${escritor}, con la otra pestaña: la cuenta quedó en B y sin marca (la otra pestaña borró bien)`);
      tabla.push({ escritor, despues: desp.length, error: r.error?.message ?? null });
    } else {
      const todas = escriturasTodas();
      ok(preparar.esperadas(todas), `${escritor}, sin la otra pestaña (conservación): escribe como siempre (${todas.join(', ') || 'ninguna'})${r.error ? ` · tiró: ${r.error.message}` : ''}`);
    }
  }
}

// ── 1) startLikesLoad: la paginación entera (y el parcial a la décima página) ───────────────────
decir('· 1) startLikesLoad (getAllLikedTracks con force): la otra pestaña entra en la primera página');
await caso('startLikesLoad', {
  antes: (api, conOtra) => { if (conOtra) red.alPedir = (ruta) => { if (ruta === '/me/tracks' && estado.cambio == null) otraPestana(); }; },
  esperadas: (todas) => todas.includes(PARCIAL) && todas.includes(COMPLETA),
}, (api) => api.getAllLikedTracks(null, { force: true }));

// ── 2) syncLikesIncremental: la espera de getLikesTotal y getRecentLikes ─────────────────────────
decir('· 2) syncLikesIncremental: la otra pestaña entra mientras se pregunta el total');
await caso('syncLikesIncremental', {
  escenario: { cache: 590 },
  antes: (api, conOtra) => { if (conOtra) red.alPedir = (ruta, metodo, u) => { if (ruta === '/me/tracks' && u.searchParams.get('limit') === '1' && estado.cambio == null) otraPestana(); }; },
  esperadas: (todas) => todas.length === 1 && todas[0] === COMPLETA,
}, (api) => api.syncLikesIncremental());

// ── 3) importLikesData: la espera de getLikesTotal ──────────────────────────────────────────────
decir('· 3) importLikesData: la otra pestaña entra mientras se pregunta el total');
await caso('importLikesData', {
  antes: (api, conOtra) => { if (conOtra) red.alPedir = (ruta, metodo, u) => { if (ruta === '/me/tracks' && u.searchParams.get('limit') === '1' && estado.cambio == null) otraPestana(); }; },
  esperadas: (todas) => todas.length === 1 && todas[0] === COMPLETA,
}, (api) => api.importLikesData({ items: BIBLIOTECA.slice(0, 600), totalAtExport: 600, spotifyUserId: CUENTA_A }));

// ── 4) removeFromLikesCache (por removeLikedTracks): la lectura de IndexedDB ─────────────────────
decir('· 4) removeFromLikesCache (removeLikedTracks): la otra pestaña entra durante la lectura de la caché');
await caso('removeFromLikesCache', {
  escenario: { cache: 50 },
  antes: (api, conOtra) => { if (conOtra) alLeerLaCompleta(otraPestana); },
  esperadas: (todas) => todas.length === 1 && todas[0] === COMPLETA,
  // Con `meta`, `registrarBorradoDeLikes` no lee la caché: así la primera lectura de la completa es la de
  // `removeFromLikesCache`, que es la espera que se prueba.
}, (api) => api.removeLikedTracks(['t105x3', 't105x4'], { origen: 't105-inventado', meta: [{ id: 't105x3' }, { id: 't105x4' }] }));

// ── 5) addToLikesCache (por anadirLikes): la lectura de IndexedDB ───────────────────────────────
decir('· 5) addToLikesCache (anadirLikes): la otra pestaña entra durante la lectura de la caché');
await caso('addToLikesCache', {
  escenario: { cache: 50 },
  antes: (api, conOtra) => { if (conOtra) alLeerLaCompleta(otraPestana); },
  esperadas: (todas) => todas.length === 1 && todas[0] === COMPLETA,
}, (api) => api.anadirLikes([pista(700), pista(701)], { origen: 't105-inventado' }));

// ── 6) migrateLikesFromLocalStorage: entre la mudanza de la completa y la del parcial ──────────
// Se llega por `syncLikesIncremental`, que muda primero; con la otra pestaña, después no hay caché y no escribe más.
decir('· 6) migrateLikesFromLocalStorage: la otra pestaña entra entre la mudanza de la completa y la del parcial');
await caso('migrateLikesFromLocalStorage', {
  antes: (api, conOtra) => {
    lsMapa.set('spc_' + COMPLETA, heredada(BIBLIOTECA.slice(0, 600)));
    lsMapa.set('spc_' + COMPLETA + '_partial', heredada({ items: BIBLIOTECA.slice(0, 100), offset: 100, startOffset: 0 }));
    if (conOtra) trasEscribirLaCompleta(otraPestana);
  },
  esperadas: (todas) => todas[0] === COMPLETA && todas[1] === PARCIAL,
}, (api) => api.syncLikesIncremental());

decir('\n  la tabla de los seis escritores (con la otra pestaña):');
for (const f of tabla) decir(`    ${f.escritor.padEnd(30)} escrituras después del cambio: ${f.despues}${f.error ? ` · tiró: ${f.error}` : ''}`);

// ── 7) saveLikes: la época es obligatoria, `null` = solo la marca ───────────────────────────────
decir('· 7) saveLikes: sin epoca tira; con epoca null vale solo la marca; con otra época no escribe');
{
  escenario();
  const api = await cargar();
  ok(typeof api.saveLikes === 'function', 'saveLikes se exporta (para esta suite)');
  if (typeof api.saveLikes === 'function') {
    const items = BIBLIOTECA.slice(0, 5);
    const sinEpoca = await sinTirar(() => api.saveLikes(items, { complete: true, total: 5 }));
    ok(sinEpoca.error?.message === 'saveLikes sin epoca', `🔴 saveLikes sin epoca tira «saveLikes sin epoca» (${sinEpoca.error?.message ?? 'no tiró'})`);
    const sinNada = await sinTirar(() => api.saveLikes(items));
    ok(sinNada.error?.message === 'saveLikes sin epoca', 'saveLikes(items) a secas también tira');
    ok(escriturasTodas().length === 0, 'sin epoca no escribe nada');

    escenario();
    lsMapa.delete(ULTIMO);
    let r = await api.saveLikes(items, { epoca: null });
    ok(r.ok === true && escriturasTodas().length === 1, `epoca null y sin marca: escribe (${JSON.stringify(r)})`);
    escenario();
    lsMapa.delete(ULTIMO);
    lsMapa.set(MARCA, CUENTA_A);
    r = await api.saveLikes(items, { epoca: null });
    ok(r.ok === false && r.likesDeOtro === true && escriturasTodas().length === 0, `epoca null y con marca: no escribe (${JSON.stringify(r)})`);
    escenario();
    r = await api.saveLikes(items, { epoca: null });
    ok(r.ok === true, 'epoca null con una cuenta guardada: vale solo la marca, escribe');

    escenario();
    lsMapa.set(ULTIMO, CUENTA_B);
    r = await api.saveLikes(items, { epoca: CUENTA_A });
    ok(r.ok === false && r.likesDeOtro === true && escriturasTodas().length === 0, `con otra época: { ok: false, likesDeOtro: true } y no escribe (${JSON.stringify(r)})`);
    ok(avisos.some((m) => m.startsWith('[likes]')), `con otra época: un console.warn('[likes] …') (${avisos.filter((m) => m.startsWith('[likes]')).length})`);
    escenario();
    r = await api.saveLikes(items, { epoca: CUENTA_A });
    ok(r.ok === true && escriturasTodas().length === 1, 'con la misma época: escribe');
  }
}

// ── 8) El parcial de otra clave (playlists) no mira la época ───────────────────────────────────
decir('· 8) el parcial de otra clave (playlists) se guarda con cualquier época');
for (const epoca of [CUENTA_B, null, undefined]) {
  escenario();
  const api = await cargar();
  const r = await sinTirar(() => api.paginateAll('/me/playlists', { limit: 1, partialCacheKey: 'user_playlists_t105', epoca }));
  ok(!!r.error, `playlists con epoca ${String(epoca)}: la segunda página falla (el doble contesta 404) y paginateAll tira`);
  ok(lsMapa.has('spc_user_playlists_t105_partial'), `🔴 playlists con epoca ${String(epoca)}: el parcial se guardó igual (la época es solo de los me gusta)`);
}

// ── 9) paginateAll con la clave de me gusta y sin epoca: savePartial tira sin escribir ─────────
decir('· 9) paginateAll con la clave de me gusta y sin epoca');
{
  escenario();
  const api = await cargar();
  const r = await sinTirar(() => api.paginateAll('/me/tracks', { limit: 50, partialCacheKey: 'all_liked_tracks' }));
  ok(r.error?.message === 'savePartial sin epoca', `paginateAll(…, { partialCacheKey: me gusta }) sin epoca tira «savePartial sin epoca» al guardar el parcial (${r.error?.message ?? 'no tiró'})`);
  ok(escriturasTodas().length === 0, `y no escribió el parcial (${escriturasTodas().join(', ') || 'ninguna'})`);
}

decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
