// tests/start-likes-motivo.test.mjs — `startLikesLoad` da el motivo de verdad cuando la caché es de otra cuenta (v=347, tanda 104)
//
// POR QUÉ ESTA SUITE EXISTE: desde v=346, `saveLikes()` no escribe con la marca `fonoteca_likes_de_otro_v1` puesta y
// devuelve `{ ok: false, likesDeOtro: true }`. `startLikesLoad` no miraba ese campo: si la marca aparecía a mitad de la
// descarga (otra pestaña entró con otra cuenta), la carga tiraba «Se han descargado las N de T, pero el navegador no ha
// podido guardarlas… el progreso queda guardado para retomarlo». Las dos cosas eran falsas: no falla el navegador, y con
// la marca puesta `savePartial()` tampoco escribe, así que no hay progreso que retomar.
//
// El `api.js` REAL en Node con los dobles de la 98/103 (`dobles/loader-otra-cuenta.mjs`, `dobles/idb-otra-cuenta-doble.mjs`),
// un `localStorage` y un `fetch` de mentira. Todo INVENTADO (el repo es público). `startLikesLoad` no se exporta: se
// llega por `getAllLikedTracks({ force: true })`, que con la caché vacía y `force` va directo a `loadLikesShared()`.

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
const infos = [];
console.log = () => {};
console.info = (...a) => { infos.push(a.map(String).join(' ')); };
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

const MARCA = 'fonoteca_likes_de_otro_v1';
const ULTIMO = 'fonoteca_last_user_id';
const CUENTA_A = 't104-cuenta-a-inventada';   // la cuenta anterior (la de la marca)
const CUENTA_B = 't104-cuenta-b-inventada';   // la de ahora
const pista = (i) => ({ added_at: `2025-0${1 + (i % 9)}-1${i % 9}T10:00:00Z`, track: { id: `t104x${i}`, uri: `spotify:track:t104x${i}`, name: `Tema inventado ${i}`, duration_ms: 200000, artists: [{ id: `ar${i % 3}`, name: `Artista inventado ${i % 3}` }], album: { id: `al${i}`, name: `Disco inventado ${i}`, album_type: 'album', total_tracks: 10, images: [] } } });
const BIBLIOTECA = Array.from({ length: 32 }, (_, i) => pista(i));

// El texto de «Lo decidido» 4 y los dos motivos de siempre, escritos acá palabra por palabra.
const TEXTO_LIKES_DE_OTRO = 'No se han podido borrar los me gusta de la otra cuenta que usó este navegador, así que no se cargan los tuyos para no mezclarlos. Recarga la página para reintentarlo.';
const MOTIVO_CORTADA = 'La descarga se ha cortado antes de acabar (32 de 40). No se ha tocado la caché anterior, y el progreso queda guardado para retomarlo.';
const MOTIVO_NAVEGADOR = 'Se han descargado las 32 de 32, pero el navegador no ha podido guardarlas (doble: disco lleno). No se ha tocado la caché anterior, y el progreso queda guardado para retomarlo.';

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
// `totalDeclarado`: lo que Spotify dice que hay (si es mayor que lo que entrega, la descarga no cuadra).
// `alPedir(ruta)` corre ANTES de contestar: es la otra pestaña que cambia de cuenta en el medio.
const red = { totalDeclarado: null, pedidos: [], alPedir: null };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  const metodo = (opciones.method || 'GET').toUpperCase();
  red.pedidos.push(`${metodo} ${ruta}${u.search}`);
  if (red.alPedir) red.alPedir(ruta, metodo);
  if (ruta === '/me' && metodo === 'GET') return json({ id: CUENTA_B, display_name: 'Inventado' });
  if (ruta === '/me/tracks' && metodo === 'GET') {
    const limit = +(u.searchParams.get('limit') || 20), offset = +(u.searchParams.get('offset') || 0);
    const items = BIBLIOTECA.slice(offset, offset + limit).map((it) => ({ added_at: it.added_at, track: structuredClone(it.track) }));
    return json({ items, total: red.totalDeclarado ?? BIBLIOTECA.length, next: offset + limit < BIBLIOTECA.length ? 'https://api.spotify.com/v1/me/tracks?más' : null });
  }
  return new Response('{}', { status: 599 });
};

const idb = () => globalThis.__IDB_OTRA;
let nCaso = 0;
const cargar = () => import(pathToFileURL(join(raiz, 'src/js/api.js')).href + `?caso=${++nCaso}`);

/** Caché vacía, la cuenta de ahora es B, sin marca. */
function escenario() {
  globalThis.__IDB_OTRA = { kv: new Map(), lecturas: [], intentos: [], borrados: [], escrituras: [], fallanBorrar: new Set(), demoraBorrar: 0 };
  lsMapa.clear();
  lsMapa.set('sp_access_token', 'tok-inventado-t104');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
  lsMapa.set(ULTIMO, CUENTA_B);
  Object.assign(red, { totalDeclarado: null, pedidos: [], alPedir: null });
  avisos.length = 0;
  infos.length = 0;
  globalThis.__DOBLE.toasts.length = 0;
}
const sinTirar = async (f) => { try { return { valor: await f() }; } catch (e) { return { error: e }; } };
const enCache = () => idb().kv.get('all_liked_tracks')?.value ?? null;
const sinSufijo = (m) => !/no ha podido guardarlas|retomarlo/.test(m || '');

// ── a) La marca aparece durante la paginación y la descarga cuadra ─────────────────────────────
decir('· a) la marca aparece a mitad de la descarga y la descarga cuadra');
{
  escenario();
  const api = await cargar();
  await api.getCurrentUserId();
  red.pedidos.length = 0;
  idb().escrituras.length = 0;
  red.alPedir = (ruta) => { if (ruta === '/me/tracks') lsMapa.set(MARCA, CUENTA_A); };
  const r = await sinTirar(() => api.getAllLikedTracks(null, { force: true }));
  ok(!!r.error, `a) la carga tira (${r.error?.message ?? 'no tiró'})`);
  ok(r.error?.message === TEXTO_LIKES_DE_OTRO, `🔴 a) el motivo es EXACTAMENTE TEXTO_LIKES_DE_OTRO (${r.error?.message})`);
  ok(!/no ha podido guardarlas/.test(r.error?.message || ''), '🔴 a) no dice «no ha podido guardarlas»');
  ok(!/retomarlo/.test(r.error?.message || ''), '🔴 a) no dice «retomarlo»');
  ok(enCache() === null, 'a) la caché no se escribió');
  ok(avisos.some((m) => m.startsWith('[likes]') && /otra cuenta/.test(m)), `a) hay un console.warn('[likes] …') que dice lo de la otra cuenta (${avisos.filter((m) => m.startsWith('[likes]')).length} avisos [likes])`);
  ok(!infos.some((m) => m.includes('carga no consolidada')), 'a) el console.info de «carga no consolidada» NO se usa para este caso');
}

// ── b) Conservación: la descarga se corta ──────────────────────────────────────────────────────
decir('· b) conservación: la descarga se corta antes de acabar');
{
  escenario();
  const api = await cargar();
  await api.getCurrentUserId();
  red.totalDeclarado = 40;   // Spotify dice 40 y entrega 32
  const r = await sinTirar(() => api.getAllLikedTracks(null, { force: true }));
  ok(r.error?.message === MOTIVO_CORTADA, `b) el motivo de siempre (${r.error?.message ?? 'no tiró'})`);
  ok(enCache() === null, 'b) la caché no se escribió');
  ok(infos.some((m) => m.includes('carga no consolidada')), 'b) el console.info de «carga no consolidada» sigue');
}

// ── c) Conservación: el navegador no guarda (sin marca) ────────────────────────────────────────
decir('· c) conservación: saveLikes falla por el navegador, sin marca');
{
  escenario();
  const api = await cargar();
  await api.getCurrentUserId();
  const kv = idb().kv;
  const set = kv.set.bind(kv);
  kv.set = (k, v) => { if (k === 'all_liked_tracks') throw new Error('doble: disco lleno'); return set(k, v); };
  const r = await sinTirar(() => api.getAllLikedTracks(null, { force: true }));
  ok(r.error?.message === MOTIVO_NAVEGADOR, `c) el motivo de siempre (${r.error?.message ?? 'no tiró'})`);
  ok(!lsMapa.has(MARCA), 'c) no hay marca');
  ok(infos.some((m) => m.includes('carga no consolidada')), 'c) el console.info de «carga no consolidada» sigue');
}

// ── d) Conservación: sin marca y todo bien ─────────────────────────────────────────────────────
decir('· d) conservación: sin marca y todo bien');
{
  escenario();
  const api = await cargar();
  await api.getCurrentUserId();
  const r = await sinTirar(() => api.getAllLikedTracks(null, { force: true }));
  ok(!r.error && Array.isArray(r.valor) && r.valor.length === BIBLIOTECA.length, `d) devuelve los items (${r.valor?.length ?? r.error?.message})`);
  ok(enCache()?.length === BIBLIOTECA.length, `d) la caché queda escrita (${enCache()?.length ?? 'vacía'} items)`);
  ok(sinSufijo(avisos.join(' ')), 'd) ningún aviso de motivo');
}

decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
