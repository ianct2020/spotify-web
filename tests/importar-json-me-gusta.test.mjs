// tests/importar-json-me-gusta.test.mjs — «Importar JSON» no escribe me gusta ajenos (v=346, tanda 103)
//
// POR QUÉ ESTA SUITE EXISTE: la tanda 98 (v=345) puso la marca `fonoteca_likes_de_otro_v1` y la hizo respetar a los
// seis caminos que LEEN la caché de me gusta. Del lado de los que ESCRIBEN quedaron dos agujeros:
//   1. `importLikesData()` terminaba en `saveLikes()` sin mirar la marca: con la marca puesta, el lector siguiente
//      (`leerLikesCacheados()` → `borrarLikesDeOtro()`) BORRABA lo recién importado. El toast decía «Importado: N likes»
//      y los me gusta no estaban;
//   2. `importAllData()` comparaba el `spotifyUserId` del archivo solo para `_config`: los me gusta de un archivo de
//      OTRA cuenta entraban en tu caché, sin marca y sin aviso.
// Desde v=346: `saveLikes()` y `savePartial()` no escriben con la marca (la regla en UN sitio: un escritor nuevo queda
// cubierto sin acordarse); «Importar JSON» con la marca hace lo mismo que `startLikesLoad` (reintenta el borrado y, si
// no sale, tira ANTES de pedir nada); y los me gusta del archivo entran solo si el archivo es de la cuenta de ahora
// (`likesSkipped`: 'otra-cuenta', 'sin-dueno' o 'sin-identidad', y los dos toasts lo dicen). Más los escritores que leen,
// esperan y después escriben: si la marca aparece durante la espera (otra pestaña cambió de cuenta), 0 escrituras.
//
// 🔴 Todo INVENTADO (el repo es público): uids, temas, artistas, etiquetas. El `api.js` REAL en Node con `idb.js` y
// `toast.js` doblados (los de la tanda 98: `dobles/loader-otra-cuenta.mjs`, `dobles/idb-otra-cuenta-doble.mjs`), un
// `localStorage` de mentira y un `fetch` que hace de Spotify y cuenta. Los dos handlers (`handleImportAll` del Dashboard
// y `handleImport` de `#genre`) son los REALES, sacados del fuente y armados con dobles (el molde de importar-a-medias).
// Cada caso importa `api.js?caso=N`: el memo de `getCurrentUserId()` arranca frío.

import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const fin = () => { decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`); process.exit(fallaron ? 1 : 0); };
const J = JSON.stringify;
const sha = (x) => createHash('sha256').update(J(x)).digest('hex').slice(0, 16);

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

const MARCA = 'fonoteca_likes_de_otro_v1';
const ULTIMO = 'fonoteca_last_user_id';
const A = 't103-cuenta-a-inventada';   // la cuenta anterior (la de la marca)
const B = 't103-cuenta-b-inventada';   // la de ahora
const C = 't103-cuenta-c-inventada';   // la de un archivo ajeno
const pista = (p, i) => ({ added_at: `2025-0${1 + (i % 9)}-1${i % 9}T10:00:00Z`, track: { id: `${p}${i}`, uri: `spotify:track:${p}${i}`, name: `Tema inventado ${p}${i}`, duration_ms: 200000, artists: [{ id: `ar${p}${i % 3}`, name: `Artista inventado ${p}${i % 3}` }], album: { id: `al${p}${i}`, name: `Disco inventado ${p}${i}`, album_type: 'album', total_tracks: 10, images: [] } } });
const LIKES_A = Array.from({ length: 30 }, (_, i) => pista('tA', i));
const LIKES_B = Array.from({ length: 32 }, (_, i) => pista('tB', i));
const NUEVOS_B = Array.from({ length: 2 }, (_, i) => pista('tN', i));   // lo que Spotify tiene de más
const LIKES_C = Array.from({ length: 12 }, (_, i) => pista('tC', i));
const deA = (lista) => (lista || []).some((it) => String(it?.track?.id || '').startsWith('tA'));
let nArtista = 0;
const etiquetas = () => ({ [`artista inventado t103 ${++nArtista}`]: { tags: [{ name: 'género inventado', count: 100 }], at: 1_700_000_000_000 } });
const archivo = ({ uid = B, likes = LIKES_B, tags = null, config = null } = {}) => ({
  _format: 'spotify-tools-data', _version: 2, _exportedAt: '2026-10-29T10:00:00.000Z', spotifyUserId: uid, _likesSource: 'full',
  likes: { totalAtExport: likes.length, items: likes }, tags: { entries: tags || {} }, ...(config ? { _config: config } : {}),
});

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
// `spotify` es la biblioteca que contesta `/me/tracks`; `pedidos`, cada petición (método y ruta, sin el host).
// `alPedir(ruta, metodo, n)` corre ANTES de contestar: es la otra pestaña que cambia de cuenta en el medio.
const red = { meId: B, meFalla: 0, spotify: LIKES_B, pedidos: [], alPedir: null, fallaPagina: null };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  const metodo = (opciones.method || 'GET').toUpperCase();
  red.pedidos.push(`${metodo} ${ruta}${u.search}`);
  if (red.alPedir) red.alPedir(ruta, metodo, red.pedidos.length);
  if (ruta === '/me' && metodo === 'GET') {
    if (red.meFalla > 0) { red.meFalla--; return json({ error: { status: 403, message: 'doble: /me caído' } }, 403); }
    return json({ id: red.meId, display_name: 'Inventado' });
  }
  if (ruta === '/me/tracks' && metodo === 'GET') {
    const limit = +(u.searchParams.get('limit') || 20), offset = +(u.searchParams.get('offset') || 0);
    if (red.fallaPagina != null && offset === red.fallaPagina) return json({ error: { status: 400, message: 'doble: página rota' } }, 400);
    const lista = red.spotify;
    const items = lista.slice(offset, offset + limit).map((it) => ({ added_at: it.added_at, track: structuredClone(it.track) }));
    return json({ items, total: lista.length, next: offset + limit < lista.length ? 'https://api.spotify.com/v1/me/tracks?más' : null });
  }
  if (ruta === '/me/library' && (metodo === 'DELETE' || metodo === 'PUT')) return new Response('', { status: 200 });
  return new Response('{}', { status: 599 });
};

const idb = () => globalThis.__IDB_OTRA;
const envolver = (value, storedAt) => ({ value, storedAt, expiry: null });
// La lectura de IndexedDB puede disparar algo (la marca que llega durante el `await` de la lectura): `ctl.alLeer`.
const ctl = { alLeer: null };
class KvConGancho extends Map {
  get(k) { if (ctl.alLeer) ctl.alLeer(k); return super.get(k); }
}
let nCaso = 0;
const cargar = () => import(pathToFileURL(join(raiz, 'src/js/api.js')).href + `?caso=${++nCaso}`);

/** El escenario. `cache`: 'a' | 'b' | null; `marca`: el uid de la marca o null; `falla`: los borrados de me gusta tiran. */
function escenario({ cache = 'b', marca = null, falla = false, ultimo = B, me = B, spotify = LIKES_B } = {}) {
  globalThis.__IDB_OTRA = { kv: new KvConGancho(), lecturas: [], intentos: [], borrados: [], escrituras: [], fallanBorrar: new Set(falla ? ['all_liked_tracks', 'all_liked_tracks_partial'] : []), demoraBorrar: 0 };
  lsMapa.clear();
  lsMapa.set('sp_access_token', 'tok-inventado-t103');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
  if (ultimo) lsMapa.set(ULTIMO, ultimo);
  if (marca) lsMapa.set(MARCA, marca);
  if (cache === 'a') idb().kv.set('all_liked_tracks', envolver(LIKES_A, 1_700_000_000_000));
  if (cache === 'b') idb().kv.set('all_liked_tracks', envolver(LIKES_B, 1_760_000_000_000));
  Object.assign(red, { meId: me, meFalla: 0, spotify, pedidos: [], alPedir: null, fallaPagina: null });
  ctl.alLeer = null;
  avisos.length = 0;
  globalThis.__DOBLE.toasts.length = 0;
}
const vaciarCola = async () => { await idb().cola; await new Promise((r) => setTimeout(r, 20)); await idb().cola; };
const escrituras = (k = 'all_liked_tracks') => idb().escrituras.filter((x) => x === k).length;
const enCache = () => idb().kv.get('all_liked_tracks')?.value ?? null;
const sinTirar = async (f) => { try { return { valor: await f() }; } catch (e) { return { error: e }; } };
/** Con el memo de `getCurrentUserId()` caliente y los contadores en cero: lo que se cuenta es solo el import. */
async function apiConMemo() {
  const api = await cargar();
  await api.getCurrentUserId();
  await vaciarCola();
  red.pedidos.length = 0;
  idb().escrituras.length = 0;
  return api;
}
const TEXTO_LIKES_DE_OTRO = 'No se han podido borrar los me gusta de la otra cuenta que usó este navegador, así que no se cargan los tuyos para no mezclarlos. Recarga la página para reintentarlo.';

// ── a) La marca puesta y un borrado que SALE ─────────────────────────────────────────────────────
decir('· a) «Importar JSON» con la marca puesta y un borrado que sale');
{
  escenario({ cache: 'a', marca: A });
  const api = await apiConMemo();
  const r = await sinTirar(() => api.importAllData(archivo(), null, { currentUserId: B }));
  ok(!r.error && r.valor?.likesImported === LIKES_B.length, `el import no tira y dice ${LIKES_B.length} me gusta (${r.valor?.likesImported ?? r.error?.message})`);
  ok(!lsMapa.has(MARCA), 'la marca se fue (el import reintentó el borrado y salió)');
  const despues = await api.getBestAvailableLikes();
  ok(despues.source === 'full' && despues.items.length === LIKES_B.length && !deA(despues.items),
    `🔴 a) DESPUÉS, getBestAvailableLikes() devuelve lo importado (${despues.items.length} items, source ${despues.source}; v=345: 0, el lector borraba lo recién importado)`);
}

// ── b) La marca puesta y un borrado que FALLA ────────────────────────────────────────────────────
decir('· b) con la marca puesta y un borrado que falla');
{
  escenario({ cache: 'a', marca: A, falla: true });
  const api = await apiConMemo();
  const r = await sinTirar(() => api.importAllData(archivo(), null, { currentUserId: B }));
  ok(r.error && r.error.message === TEXTO_LIKES_DE_OTRO, `🔴 b) tira con el texto de TEXTO_LIKES_DE_OTRO (${r.error?.message ?? `no tiró: ${J(r.valor)}`})`);
  ok(escrituras() === 0, `🔴 b) 0 escrituras a all_liked_tracks (${escrituras()})`);
  ok(red.pedidos.length === 0, `🔴 b) 0 peticiones a la Spotify doblada (${J(red.pedidos)})`);
  ok(lsMapa.get(MARCA) === A, 'la marca sigue puesta');
}

// ── c) Un archivo de OTRA cuenta ─────────────────────────────────────────────────────────────────
decir('· c) un archivo con otro spotifyUserId');
{
  escenario({ cache: 'b' });
  const api = await apiConMemo();
  const r = await sinTirar(() => api.importAllData(archivo({ uid: C, likes: LIKES_C, tags: etiquetas() }), null, { currentUserId: B }));
  ok(!r.error, `no tira (${r.error?.message ?? 'ok'})`);
  ok(escrituras() === 0 && J(enCache()) === J(LIKES_B), `🔴 c) 0 escrituras de me gusta y la caché sigue siendo la tuya (${escrituras()} escrituras, ${enCache()?.length} items)`);
  ok(r.valor?.likesSkipped === 'otra-cuenta' && r.valor?.likesImported === 0, `🔴 c) likesSkipped: 'otra-cuenta' (${J(r.valor?.likesSkipped)}, likesImported ${r.valor?.likesImported})`);
  ok(r.valor?.tagsImported + r.valor?.tagsUpdated === 1 && idb().escrituras.some((k) => k.startsWith(`generos_artista_v1_${B}_`)), `las etiquetas entran igual, a tu cuenta (${r.valor?.tagsImported}+${r.valor?.tagsUpdated})`);
  ok(!red.pedidos.some((p) => p.startsWith('GET /me/tracks')), `y no le pide nada a /me/tracks (${J(red.pedidos)})`);
}

// ── d) Un archivo SIN dueño ──────────────────────────────────────────────────────────────────────
decir('· d) un archivo que no dice de quién es');
{
  escenario({ cache: 'b' });
  const api = await apiConMemo();
  const viejo = { _format: 'spotify-tools-likes', items: LIKES_C, totalAtExport: LIKES_C.length };
  const r1 = await sinTirar(() => api.importAllData(viejo, null, { currentUserId: B }));
  ok(r1.valor?.likesSkipped === 'sin-dueno' && escrituras() === 0, `🔴 d) formato viejo (spotify-tools-likes): 'sin-dueno' y 0 escrituras (${J(r1.valor?.likesSkipped ?? r1.error?.message)}, ${escrituras()})`);
  const r2 = await sinTirar(() => api.importAllData(archivo({ uid: null, likes: LIKES_C }), null, { currentUserId: B }));
  ok(r2.valor?.likesSkipped === 'sin-dueno' && escrituras() === 0, `🔴 d) spotifyUserId: null → 'sin-dueno' y 0 escrituras (${J(r2.valor?.likesSkipped ?? r2.error?.message)}, ${escrituras()})`);
  ok(J(enCache()) === J(LIKES_B), 'la caché sigue siendo la tuya');
  const r3 = await sinTirar(() => api.importAllData(archivo({ uid: null, likes: [] }), null, { currentUserId: B }));
  ok(!r3.error && !r3.valor?.likesSkipped, `un archivo sin dueño y SIN me gusta no avisa de nada (${J(r3.valor?.likesSkipped ?? r3.error?.message)})`);
}

// ── e) No se sabe quién sos ──────────────────────────────────────────────────────────────────────
decir('· e) getCurrentUserId() tira');
{
  escenario({ cache: 'b' });
  const api = await cargar();          // memo frío: importAllData tiene que preguntar
  red.meFalla = 99;
  const r = await sinTirar(() => api.importAllData(archivo({ uid: B })));
  ok(r.valor?.likesSkipped === 'sin-identidad', `🔴 e) 'sin-identidad' (${J(r.valor?.likesSkipped ?? r.error?.message)})`);
  ok(escrituras() === 0 && J(enCache()) === J(LIKES_B), `🔴 e) 0 escrituras de me gusta (${escrituras()})`);
  ok(red.pedidos.filter((p) => p === 'GET /me').length === 1, `pide /me una vez (${red.pedidos.filter((p) => p === 'GET /me').length})`);
  // Las etiquetas siguen con su regla de hoy: sin identidad, el import tira (como en v=345).
  const r2 = await sinTirar(() => api.importAllData(archivo({ uid: B, tags: etiquetas() })));
  ok(r2.error && escrituras() === 0, `con etiquetas, tira como siempre y tampoco escribe me gusta (${r2.error?.message ?? 'no tiró'}, ${escrituras()})`);
}

// ── f) Conservación: el archivo de la cuenta de ahora, sin marca ─────────────────────────────────
// Lo medido corriendo ESTE test contra el `api.js` de 45dc7a7 (v=345). Lo que el import hace con un archivo tuyo no
// cambia: mismo resultado (sin el campo nuevo), mismas peticiones, la misma caché.
const MEDIDO_V345 = {
  igual: { res: '{"likesImported":32,"likesAdded":0,"tagsImported":1,"tagsUpdated":0,"configApplied":1,"configSkipped":false,"format":"spotify-tools-data"}', pedidos: '["GET /me/tracks?limit=1"]', cache: 'c2ee32326ab3f77a' },
  delta: { res: '{"likesImported":32,"likesAdded":2,"tagsImported":0,"tagsUpdated":0,"configApplied":0,"configSkipped":false,"format":"spotify-tools-data"}', pedidos: '["GET /me/tracks?limit=1","GET /me/tracks?limit=22&offset=0"]', cache: 'de7395517516251e' },
};
const proyectar = (r) => J({ likesImported: r.likesImported, likesAdded: r.likesAdded, tagsImported: r.tagsImported, tagsUpdated: r.tagsUpdated, configApplied: r.configApplied, configSkipped: r.configSkipped, format: r.format });
decir('· f) conservación: un archivo tuyo, sin marca, importa lo mismo que en v=345');
{
  escenario({ cache: null });
  const api = await apiConMemo();
  nArtista = 1000;
  const r = await sinTirar(() => api.importAllData(archivo({ tags: etiquetas(), config: { genre_sort_mode: 'inventado' } }), null, { currentUserId: B }));
  const medido = { res: r.valor ? proyectar(r.valor) : `tiró: ${r.error?.message}`, pedidos: J(red.pedidos), cache: sha(enCache()) };
  ok(medido.res === MEDIDO_V345.igual.res, `f) mismo resultado (${medido.res})`);
  ok(medido.pedidos === MEDIDO_V345.igual.pedidos, `f) mismas peticiones (${medido.pedidos})`);
  ok(medido.cache === MEDIDO_V345.igual.cache, `f) la misma caché (sha ${medido.cache})`);
  ok(!r.valor?.likesSkipped, `f) sin likesSkipped (${J(r.valor?.likesSkipped)})`);
}
{
  escenario({ cache: null, spotify: [...NUEVOS_B, ...LIKES_B] });
  const api = await apiConMemo();
  const r = await sinTirar(() => api.importAllData(archivo(), null, { currentUserId: B }));
  const medido = { res: r.valor ? proyectar(r.valor) : `tiró: ${r.error?.message}`, pedidos: J(red.pedidos), cache: sha(enCache()) };
  ok(medido.res === MEDIDO_V345.delta.res, `f) con 2 nuevos en Spotify, mismo resultado (${medido.res})`);
  ok(medido.pedidos === MEDIDO_V345.delta.pedidos, `f) con 2 nuevos, mismas peticiones (${medido.pedidos})`);
  ok(medido.cache === MEDIDO_V345.delta.cache, `f) con 2 nuevos, la misma caché (sha ${medido.cache}, ${enCache()?.length} items)`);
}

// ── g) `#genre` llama sin currentUserId ──────────────────────────────────────────────────────────
decir('· g) importAllData(parsed) sin currentUserId (by-genre.js) resuelve el uid solo');
{
  escenario({ cache: null });
  const api = await cargar();   // memo frío
  const r = await sinTirar(() => api.importAllData(archivo()));
  ok(r.valor?.likesImported === LIKES_B.length && J(enCache()) === J(LIKES_B), `g) el archivo tuyo entra (${r.valor?.likesImported ?? r.error?.message})`);
  ok(red.pedidos.filter((p) => p === 'GET /me').length === 1, `g) con UN /me (${J(red.pedidos)})`);
  escenario({ cache: 'b' });
  const api2 = await cargar();
  const r2 = await sinTirar(() => api2.importAllData(archivo({ uid: C, likes: LIKES_C })));
  ok(r2.valor?.likesSkipped === 'otra-cuenta' && escrituras() === 0, `🔴 g) y el de otra cuenta no (${J(r2.valor?.likesSkipped ?? r2.error?.message)}, ${escrituras()} escrituras)`);
}

// ── h) Los handlers REALES: el toast ─────────────────────────────────────────────────────────────
decir('· h) los toasts de los dos llamadores (handlers reales, sacados del fuente)');
const fuente = (p) => readFileSync(join(raiz, p), 'utf8');
const sacar = (src, re) => (src.match(re) || [''])[0];
const dash = fuente('src/js/features/dashboard.js');
const genre = fuente('src/js/features/by-genre.js');
const tDash = sacar(dash, /async function handleImportAll\(e\) \{[\s\S]*?\n}\n/);
const tDashInsp = sacar(dash, /function inspectImportPayload\(parsed\) \{[\s\S]*?\n}\n/);
const tGenre = sacar(genre, /async function handleImport\(e, \{[^\n]*\n[\s\S]*?\n}\n/);
const tGenreInsp = sacar(genre, /function inspectImportPayload\(parsed\) \{[\s\S]*?\n}\n/);
ok(tDash.length > 500 && tDashInsp && tGenre.length > 500 && tGenreInsp, 'los dos handlers y sus inspectImportPayload se encuentran en el fuente');
const DEPS = ['importAllData', 'getCurrentUserId', 'showToast', 'showProgress', 'hideProgress', 'alertModal', 'loadData', 'refreshHeaderAndGenres', 'TEXTOS_LIKES_SIN_IMPORTAR'];
async function correr(texto, textoInsp, nombre, api, parsed) {
  const vista = { toasts: [], recargas: 0 };
  const deps = {
    importAllData: (...a) => api.importAllData(...a), getCurrentUserId: () => api.getCurrentUserId(),
    showToast: (m, t) => vista.toasts.push({ m, t }), showProgress() {}, hideProgress() {}, alertModal: async () => true,
    loadData: () => { vista.recargas++; }, refreshHeaderAndGenres: () => {},
    TEXTOS_LIKES_SIN_IMPORTAR: api.TEXTOS_LIKES_SIN_IMPORTAR || {},
  };
  const armar = new Function('deps', `const { ${DEPS.join(', ')} } = deps;\n${textoInsp}\n${texto}\nreturn ${nombre};`);
  await armar(deps)({ target: { files: [{ text: async () => J(parsed) }], value: 'x' } });
  return vista;
}
for (const [nombre, texto, insp] of [['handleImportAll', tDash, tDashInsp], ['handleImport', tGenre, tGenreInsp]]) {
  const quien = nombre === 'handleImportAll' ? 'Dashboard' : '#genre';
  {
    escenario({ cache: 'b' });
    const api = await apiConMemo();
    const v = await correr(texto, insp, nombre, api, archivo({ uid: C, likes: LIKES_C, tags: etiquetas() }));
    const t = v.toasts.at(-1);
    ok(v.toasts.length === 1 && /Los me gusta del archivo no se han importado: el archivo es de otra cuenta\./.test(t?.m || '') && t?.t !== 'success' && t?.t !== 'error',
      `🔴 h) ${quien}, otra cuenta con etiquetas: el toast lo dice y no es verde ni rojo (${J(v.toasts)})`);
  }
  {
    escenario({ cache: 'b' });
    const api = await apiConMemo();
    const v = await correr(texto, insp, nombre, api, archivo({ uid: C, likes: LIKES_C }));
    const t = v.toasts.at(-1);
    ok(v.toasts.length === 1 && t?.t === 'error' && /el archivo es de otra cuenta/.test(t.m) && !/Importado/.test(t.m), `🔴 h) ${quien}, otra cuenta y nada más: toast rojo, sin «Importado» (${J(v.toasts)})`);
  }
  {
    escenario({ cache: 'b' });
    const api = await apiConMemo();
    const v = await correr(texto, insp, nombre, api, archivo({ uid: null, likes: LIKES_C }));
    ok(/Los me gusta del archivo no se han importado: el archivo no dice de qué cuenta es\./.test(v.toasts.at(-1)?.m || '') && v.toasts.at(-1)?.t === 'error', `🔴 h) ${quien}, sin dueño: lo dice, en rojo (${J(v.toasts)})`);
  }
  {
    escenario({ cache: 'b' });
    const api = await cargar();
    red.meFalla = 99;
    const v = await correr(texto, insp, nombre, api, archivo({ uid: B }));
    ok(/Los me gusta del archivo no se han importado: no se ha podido comprobar con qué cuenta has entrado\./.test(v.toasts.at(-1)?.m || '') && v.toasts.at(-1)?.t === 'error', `🔴 h) ${quien}, sin identidad: lo dice, en rojo (${J(v.toasts)})`);
  }
  {
    escenario({ cache: 'a', marca: A, falla: true });
    const api = await apiConMemo();
    const v = await correr(texto, insp, nombre, api, archivo());
    ok(v.toasts.length === 1 && v.toasts[0].t === 'error' && v.toasts[0].m.includes(TEXTO_LIKES_DE_OTRO) && !/Importado/.test(v.toasts[0].m),
      `🔴 h) ${quien}, el import que tira: toast rojo y nada de «Importado» (${J(v.toasts)})`);
  }
  {
    escenario({ cache: null });
    const api = await apiConMemo();
    const v = await correr(texto, insp, nombre, api, archivo());
    ok(v.toasts.length === 1 && v.toasts[0].t === 'success' && v.toasts[0].m.startsWith(`Importado: ${LIKES_B.length} likes`), `h) ${quien}, el archivo tuyo: el toast verde de siempre (${J(v.toasts)})`);
  }
}

// ── T103.2: los escritores con un `await` en el medio ───────────────────────────────────────────
decir('· T103.2 — la marca aparece durante el await (otra pestaña cambia de cuenta)');
const ponerMarca = () => lsMapa.set(MARCA, B);
{
  // syncLikesIncremental: lee la caché, espera a `getLikesTotal()` y a `getRecentLikes()`, y escribe.
  escenario({ cache: 'b', spotify: [...NUEVOS_B, ...LIKES_B] });
  const api = await apiConMemo();
  red.alPedir = (ruta) => { if (ruta === '/me/tracks') ponerMarca(); };
  const r = await sinTirar(() => api.syncLikesIncremental());
  ok(escrituras() === 0, `🔴 syncLikesIncremental: 0 escrituras (${escrituras()})`);
  ok(r.error && r.error.message === TEXTO_LIKES_DE_OTRO, `🔴 …y no devuelve «+2 nuevos» como si se hubieran guardado: tira con el texto de la otra cuenta (${r.error?.message ?? J(r.valor)})`);
}
{
  // removeFromLikesCache (por removeLikedTracks): lee la caché (la marca llega durante la lectura) y escribe.
  escenario({ cache: 'b' });
  const api = await apiConMemo();
  let armado = false;
  red.alPedir = (ruta, metodo) => { if (ruta === '/me/library' && metodo === 'DELETE') armado = true; };
  ctl.alLeer = (k) => { if (armado && k === 'all_liked_tracks') { armado = false; ponerMarca(); } };
  await sinTirar(() => api.removeLikedTracks(['tB1'], { origen: 'test-t103' }));
  ok(escrituras() === 0, `🔴 removeFromLikesCache: 0 escrituras (${escrituras()})`);
}
{
  // addToLikesCache (por anadirLikes): ídem.
  escenario({ cache: 'b' });
  const api = await apiConMemo();
  let armado = false;
  red.alPedir = (ruta, metodo) => { if (ruta === '/me/library' && metodo === 'PUT') armado = true; };
  ctl.alLeer = (k) => { if (armado && k === 'all_liked_tracks') { armado = false; ponerMarca(); } };
  const r = await sinTirar(() => api.anadirLikes([NUEVOS_B[0]], { origen: 'test-t103' }));
  ok(escrituras() === 0, `🔴 addToLikesCache: 0 escrituras (${escrituras()})`);
  ok(!r.error && !globalThis.__DOBLE.toasts.length, `…y no dice nada: la caché se rehace sola (${r.error?.message ?? 'ok'}, ${J(globalThis.__DOBLE.toasts)})`);
}
{
  // startLikesLoad: pregunta al arrancar y escribe después de toda la paginación.
  escenario({ cache: null, spotify: Array.from({ length: 60 }, (_, i) => pista('tB', i)) });
  const api = await apiConMemo();
  red.alPedir = (ruta) => { if (ruta === '/me/tracks') ponerMarca(); };
  const r = await sinTirar(() => api.getAllLikedTracks(null, { force: true }));
  ok(r.error && escrituras() === 0, `🔴 startLikesLoad: tira y 0 escrituras de la completa (${r.error ? 'tiró' : 'no tiró'}, ${escrituras()})`);
}
{
  // savePartial: la descarga se corta después de que llegó la marca.
  escenario({ cache: null, spotify: Array.from({ length: 60 }, (_, i) => pista('tB', i)) });
  const api = await apiConMemo();
  red.fallaPagina = 50;
  red.alPedir = (ruta) => { if (ruta === '/me/tracks') ponerMarca(); };
  const r = await sinTirar(() => api.getAllLikedTracks(null, { force: true }));
  ok(r.error && escrituras('all_liked_tracks_partial') === 0, `🔴 savePartial: 0 escrituras del parcial (${r.error ? 'tiró' : 'no tiró'}, ${escrituras('all_liked_tracks_partial')})`);
}
{
  // importLikesData: la marca llega durante su `getLikesTotal()`.
  escenario({ cache: null });
  const api = await apiConMemo();
  red.alPedir = (ruta) => { if (ruta === '/me/tracks') ponerMarca(); };
  const r = await sinTirar(() => api.importAllData(archivo(), null, { currentUserId: B }));
  ok(r.error && escrituras() === 0, `🔴 importLikesData: tira y 0 escrituras (${r.error?.message ?? J(r.valor)}, ${escrituras()})`);
}
{
  // Conservación: sin marca, los cuatro escriben como siempre.
  escenario({ cache: 'b', spotify: [...NUEVOS_B, ...LIKES_B] });
  const api = await apiConMemo();
  const r = await api.syncLikesIncremental();
  ok(r.added === 2 && enCache()?.length === LIKES_B.length + 2, `sin marca, syncLikesIncremental guarda los 2 nuevos (${r.added}, ${enCache()?.length})`);
  await api.removeLikedTracks(['tN0'], { origen: 'test-t103' });
  ok(enCache()?.length === LIKES_B.length + 1, `sin marca, removeFromLikesCache saca el borrado (${enCache()?.length})`);
  await api.anadirLikes([NUEVOS_B[0]], { origen: 'test-t103' });
  ok(enCache()?.length === LIKES_B.length + 2, `sin marca, addToLikesCache mete el añadido (${enCache()?.length})`);
}

fin();
