// tests/me-gusta-de-otra-cuenta.test.mjs — los me gusta del usuario anterior (v=345, tanda 98)
//
// POR QUÉ ESTA SUITE EXISTE: la caché de me gusta (`all_liked_tracks`, su parcial y la heredada de `localStorage`) NO
// lleva el uid en la clave. Hasta v=344 lo único que separaba a dos cuentas del mismo navegador era el bloque «el
// usuario cambió» de `getCurrentUserId()`, que borraba sin esperar y sin mirar si salía. Si el borrado fallaba, la
// cuenta nueva veía los me gusta de la anterior como suyos, para siempre (en la carga siguiente ya no había «cambio»
// que lo reintentara). Desde v=345 hay una MARCA (`fonoteca_likes_de_otro_v1`, `util/likes-de-otro.js`) que se pone
// antes del primer borrado y se quita recién cuando salen; y los seis caminos que leen la caché la respetan.
//
// El escenario de casi todos: la caché tiene los me gusta INVENTADOS de la cuenta A, `fonoteca_last_user_id` = A, el
// `/me` contesta B y el doble de IndexedDB hace FALLAR el borrado de las dos claves de me gusta. Cada camino tiene su
// rojo contra v=344 (L1 a L6; L6 es ESTRUCTURAL: un id de pista es la misma canción en cualquier cuenta, así que no se
// ve nada; lo que se mira es que con la marca no lea la clave). Más la carrera, el reintento, la promesa en vuelo, la
// conservación y la guarda de lectura ESTÁTICA (un séptimo lector no puede nacer sin que esto se ponga rojo).
//
// 🔴 Todo INVENTADO (el repo es público). El `api.js` REAL en Node con `idb.js` y `toast.js` doblados
// (`dobles/loader-otra-cuenta.mjs`, `dobles/idb-otra-cuenta-doble.mjs`), un `localStorage` de mentira y un `fetch` que
// hace de Spotify. Cada caso importa `api.js?caso=N`: el memo de `getCurrentUserId()` arranca frío.

import { register } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

register('./dobles/loader-otra-cuenta.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const decir = console.log.bind(console);
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}
const fin = () => { decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`); process.exit(fallaron ? 1 : 0); };

// Lo que dice la app por consola no ensucia la salida, pero se mira: el borrado que falla tiene que avisar.
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
const A = 't98-cuenta-a-inventada';
const B = 't98-cuenta-b-inventada';
const TS_A = 1_700_000_000_000, TS_A_PARCIAL = 1_700_000_500_000, TS_B = 1_760_000_000_000;
const pista = (p, i) => ({ added_at: `2025-0${1 + (i % 9)}-1${i % 9}T10:00:00Z`, track: { id: `${p}${i}`, uri: `spotify:track:${p}${i}`, name: `Tema inventado ${p}${i}`, duration_ms: 200000, artists: [{ id: `ar${p}${i % 3}`, name: `Artista inventado ${p}${i % 3}` }], album: { id: `al${p}${i}`, name: `Disco inventado ${p}${i}`, album_type: 'album', total_tracks: 10, images: [] } } });
const LIKES_A = Array.from({ length: 30 }, (_, i) => pista('tA', i));
const PARCIAL_A = { items: LIKES_A.slice(0, 3), offset: 50, startOffset: 0 };
const LIKES_B = Array.from({ length: 32 }, (_, i) => pista('tB', i));
const PARCIAL_B = { items: LIKES_B.slice(0, 3), offset: 50, startOffset: 0 };
const deA = (lista) => (lista || []).some((it) => String(it?.track?.id || it?.id || '').startsWith('tA'));

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
const red = { me: 0, meFalla: 0, meId: B, likesB: LIKES_B, paginas: [], deletes: 0, lecturasAlBorrar: null };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  const metodo = (opciones.method || 'GET').toUpperCase();
  if (ruta === '/me' && metodo === 'GET') {
    red.me++;
    await new Promise((r) => setTimeout(r, 5));
    if (red.meFalla > 0) { red.meFalla--; return json({ error: { status: 403, message: 'doble: /me caído' } }, 403); }
    return json({ id: red.meId, display_name: 'Inventado' });
  }
  if (ruta === '/me/tracks' && metodo === 'GET') {
    const limit = +(u.searchParams.get('limit') || 20), offset = +(u.searchParams.get('offset') || 0);
    if (limit > 1 || offset > 0) red.paginas.push(offset);
    const lista = red.likesB;
    const items = lista.slice(offset, offset + limit).map((it) => ({ added_at: it.added_at, track: structuredClone(it.track) }));
    return json({ items, total: lista.length, next: offset + limit < lista.length ? 'https://api.spotify.com/v1/me/tracks?más' : null });
  }
  if (ruta === '/me/library' && metodo === 'DELETE') {
    red.deletes++;
    red.lecturasAlBorrar ??= [...idb().lecturas];
    return new Response('', { status: 200 });
  }
  return new Response('{}', { status: 599 });
};

const idb = () => globalThis.__IDB_OTRA;
const envolver = (value, storedAt) => ({ value, storedAt, expiry: null });
let nCaso = 0;
const cargar = () => import(pathToFileURL(join(raiz, 'src/js/api.js')).href + `?caso=${++nCaso}`);

/** El escenario. `cache`: 'a' | 'b' | null (la completa), `parcial`: 'a' | 'b' | null, `ultimo`: el uid guardado. */
function escenario({ cache = 'a', parcial = 'a', ultimo = A, falla = true, demora = 0, me = B } = {}) {
  globalThis.__IDB_OTRA = { kv: new Map(), lecturas: [], intentos: [], borrados: [], escrituras: [], fallanBorrar: new Set(falla ? ['all_liked_tracks', 'all_liked_tracks_partial'] : []), demoraBorrar: demora };
  lsMapa.clear();
  lsMapa.set('sp_access_token', 'tok-inventado-t98');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
  if (ultimo) lsMapa.set(ULTIMO, ultimo);
  if (cache === 'a') idb().kv.set('all_liked_tracks', envolver(LIKES_A, TS_A));
  if (cache === 'b') idb().kv.set('all_liked_tracks', envolver(LIKES_B, TS_B));
  if (parcial === 'a') idb().kv.set('all_liked_tracks_partial', envolver(PARCIAL_A, TS_A_PARCIAL));
  if (parcial === 'b') idb().kv.set('all_liked_tracks_partial', envolver(PARCIAL_B, TS_B));
  idb().kv.set('history_stats_v3', envolver({ inventado: true }, 1));
  idb().kv.set('playlist_items_inventada', envolver({ snapshot: 's', items: [] }, 1));
  Object.assign(red, { me: 0, meFalla: 0, meId: me, likesB: LIKES_B, paginas: [], deletes: 0, lecturasAlBorrar: null });
  avisos.length = 0;
}
const vaciarCola = async () => { await idb().cola; await new Promise((r) => setTimeout(r, 20)); await idb().cola; };
const hayMarca = () => lsMapa.has(MARCA);
const sinTirar = async (f) => { try { return { valor: await f() }; } catch (e) { return { error: e }; } };

decir('· el módulo de la marca');
const rutaMarca = join(raiz, 'src/js/util/likes-de-otro.js');
const existeMarca = existsSync(rutaMarca);
ok(existeMarca, 'src/js/util/likes-de-otro.js existe');
if (existeMarca) {
  const M = await import(pathToFileURL(rutaMarca).href);
  const txt = readFileSync(rutaMarca, 'utf8');
  ok(M.LIKES_DE_OTRO_KEY === MARCA, `la clave es «${MARCA}» (${M.LIKES_DE_OTRO_KEY})`);
  ok(!/^\s*import\b/m.test(txt), 'no importa nada (lo importan api.js y copia-completa.js, que es puro)');
  ok(M.hayLikesDeOtro({ [MARCA]: A }) === true && M.hayLikesDeOtro({}) === false, 'hayLikesDeOtro lee un volcado { clave: texto }');
  ok(M.hayLikesDeOtro({ getItem: (k) => (k === MARCA ? A : null) }) === true && M.hayLikesDeOtro({ getItem: () => null }) === false, '…y un Storage');
  ok(M.hayLikesDeOtro({ getItem: () => { throw new Error('x'); } }) === false, '…y no tira si el Storage tira');
}

// ── L1: getBestAvailableLikes y syncLikesIncremental ───────────────────────────────────────────
decir('· L1 — leerLikesCacheados() (getBestAvailableLikes, syncLikesIncremental…)');
{
  escenario();
  const api = await cargar();
  const id = await sinTirar(() => api.getCurrentUserId());
  ok(id.valor === B, `getCurrentUserId() devuelve B y no tira con el borrado que falla (${id.valor ?? id.error?.message})`);
  ok(hayMarca() && lsMapa.get(MARCA) === A, `la marca quedó puesta, con el uid anterior (${lsMapa.get(MARCA) ?? 'sin marca'})`);
  ok(lsMapa.get(ULTIMO) === B, 'fonoteca_last_user_id es B al final');
  ok(avisos.some((a) => a.includes('[likes] no se pudo borrar la caché de me gusta de la cuenta anterior:')), 'el borrado que falló avisa por console.warn, con el error crudo');
  const r = await api.getBestAvailableLikes();
  ok(!deA(r.items) && r.source === 'empty', `🔴 L1: getBestAvailableLikes() no devuelve los me gusta de A (${r.items.length} items, source ${r.source})`);
}
{
  escenario({ parcial: null });
  const api = await cargar();
  await api.getCurrentUserId();
  const escrAntes = idb().escrituras.length;
  const r = await sinTirar(() => api.syncLikesIncremental());
  const guardo = idb().escrituras.slice(escrAntes).includes('all_liked_tracks');
  const mezcla = idb().kv.get('all_liked_tracks')?.value || [];
  ok(!guardo && r.valor?.hadCache === false, `🔴 L1: syncLikesIncremental() no guarda A + B (guardó: ${guardo}, ${mezcla.filter((x) => x.track.id.startsWith('tA')).length} de A + ${mezcla.filter((x) => x.track.id.startsWith('tB')).length} de B; hadCache ${r.valor?.hadCache})`);
}

// ── L2: «Exportar todo» ──────────────────────────────────────────────────────────────────────────
decir('· L2 — likesDe() («Exportar todo»)');
{
  escenario();
  const api = await cargar();
  await api.getCurrentUserId();
  await vaciarCola();
  const intentosAntes = idb().intentos.length, escrAntes = idb().escrituras.length, lsAntes = JSON.stringify([...lsMapa]);
  const { copia } = await api.exportarCopiaCompleta({ ahora: new Date('2026-10-29T12:00:00Z') });
  ok(copia.spotifyUserId === B, `la copia va firmada con B (${copia.spotifyUserId})`);
  ok(copia.likes.items.length === 0 && copia._likesSource === 'empty', `🔴 L2: la copia de B no trae los me gusta de A (${copia.likes.items.length}, ${copia._likesSource})`);
  // (tanda 99) `copia-completa.test` ya no siembra la marca, así que este es el único sitio que mira que no salga.
  const lsCopia = copia.navegador?.localStorage || {};
  ok(lsMapa.has('fonoteca_likes_de_otro_v1') && !Object.prototype.hasOwnProperty.call(lsCopia, 'fonoteca_likes_de_otro_v1'),
    `con la marca puesta, la copia no la trae en navegador.localStorage (marca en el navegador: ${lsMapa.has('fonoteca_likes_de_otro_v1')}; en la copia: ${Object.prototype.hasOwnProperty.call(lsCopia, 'fonoteca_likes_de_otro_v1')}; ${Object.keys(lsCopia).length} claves)`);
  ok(idb().intentos.length === intentosAntes && idb().escrituras.length === escrAntes && JSON.stringify([...lsMapa]) === lsAntes, 'la copia sigue sin escribir ni borrar nada (tampoco reintenta)');
}

// ── L3: la reanudación del parcial ───────────────────────────────────────────────────────────────
decir('· L3 — la reanudación del parcial (getAllLikedTracks → loadLikesShared → paginateAll)');
{
  escenario({ cache: null, parcial: 'a' });
  red.likesB = LIKES_B.slice(0, 2);
  const api = await cargar();
  await api.getCurrentUserId();
  const r = await sinTirar(() => api.getAllLikedTracks());
  ok(!red.paginas.includes(50) && !deA(r.valor), `🔴 L3: «Cargar desde Spotify» no retoma la descarga de A (páginas pedidas: ${JSON.stringify(red.paginas)}; ${r.valor ? `${r.valor.length} items, ${r.valor.filter((x) => x.track.id.startsWith('tA')).length} de A` : 'tiró'})`);
  ok(r.error && /otra cuenta/.test(r.error.message) && /Recarga la página/.test(r.error.message), `con el borrado que sigue fallando, tira con un mensaje que dice qué pasa (${r.error?.message || 'no tiró'})`);
  ok(!idb().escrituras.includes('all_liked_tracks'), 'y no guarda nada como completo');
}
{
  escenario({ cache: null, parcial: 'a' });
  red.likesB = LIKES_B.slice(0, 2);
  const api = await cargar();
  await api.getCurrentUserId();
  await vaciarCola();             // los borrados de la revisión ya fallaron…
  idb().fallanBorrar.clear();     // …y la IndexedDB se sanó: el reintento sale
  const r = await sinTirar(() => api.getAllLikedTracks());
  ok(red.paginas[0] === 0 && r.valor && r.valor.length === 2 && !deA(r.valor), `🔴 L3: si el reintento sale, la descarga arranca de cero (páginas ${JSON.stringify(red.paginas)}; ${r.valor ? `${r.valor.length} items, ${r.valor.filter((x) => x.track.id.startsWith('tA')).length} de A` : r.error?.message})`);
  ok(!hayMarca(), 'y la marca se quitó');
}

// ── L4 y L5: lo que mira el Dashboard ────────────────────────────────────────────────────────────
decir('· L4 — getLikesPartialInfo()  ·  L5 — getLikesCacheTimestamp()');
{
  escenario();
  lsMapa.set('spc_all_liked_tracks', JSON.stringify({ value: LIKES_A.slice(0, 2), timestamp: TS_A, ttl: 0 }));
  const api = await cargar();
  await api.getCurrentUserId();
  const info = await api.getLikesPartialInfo();
  ok(info === null, `🔴 L4: el Dashboard no ofrece retomar la descarga de A (${JSON.stringify(info)})`);
  const ts = await api.getLikesCacheTimestamp();
  ok(ts === null || ts === undefined, `🔴 L5: «última sincronización» no es la fecha de A (${ts})`);
}

// ── L6: el registro de borrados ──────────────────────────────────────────────────────────────────
decir('· L6 — registrarBorradoDeLikes() (por removeLikedTracks)');
{
  escenario();
  const api = await cargar();
  await api.getCurrentUserId();
  await vaciarCola();
  idb().lecturas.length = 0;
  await api.removeLikedTracks(['tA1'], { origen: 'test-t98' });
  const leyo = (red.lecturasAlBorrar || []).includes('all_liked_tracks');
  ok(red.deletes === 1 && !leyo, `🔴 L6 (ESTRUCTURAL): con la marca, el registro no lee la clave de la caché (leyó: ${leyo}). Un id de pista es la misma canción en cualquier cuenta: no hay nada que se vea`);
  const k = [...lsMapa.keys()].find((x) => x.startsWith('likes_borrados_log_v1'));
  const reg = k ? JSON.parse(lsMapa.get(k))[0] : null;
  ok(reg && JSON.stringify(reg.ids) === '["tA1"]' && reg.borradas === null, `…y guarda los ids pelados (${reg ? JSON.stringify(reg.borradas) : 'sin registro'})`);
}
{
  escenario();
  const api = await cargar();
  await api.getCurrentUserId();
  const meta = [{ id: 'tA1', nombre: 'Tema inventado del llamador', artista: 'Artista inventado', album: 'Disco inventado' }];
  await api.removeLikedTracks(['tA1'], { origen: 'test-t98', meta });
  const k = [...lsMapa.keys()].find((x) => x.startsWith('likes_borrados_log_v1'));
  ok(k && JSON.stringify(JSON.parse(lsMapa.get(k))[0].borradas) === JSON.stringify(meta), 'con la `meta` del llamador, guarda la meta, como siempre');
}

// ── La carrera ───────────────────────────────────────────────────────────────────────────────────
decir('· la carrera: el borrado sale, pero tarda');
{
  escenario({ falla: false, demora: 300 });
  const api = await cargar();
  const id = await api.getCurrentUserId();
  const r = await api.getBestAvailableLikes();
  ok(id === B && !deA(r.items), `una lectura que empieza en cuanto getCurrentUserId() devuelve no ve los de A (${r.items.length} items). ⚠️ Contra v=344 da VERDE: el doble ordena las operaciones como IndexedDB`);
  await vaciarCola();
  ok(!hayMarca() && !idb().kv.has('all_liked_tracks') && !idb().kv.has('all_liked_tracks_partial'), 'y al final no queda ni la caché de A ni la marca');
}

// ── El reintento ─────────────────────────────────────────────────────────────────────────────────
decir('· el reintento: otra carga, con la IndexedDB ya sana');
{
  escenario();
  const api1 = await cargar();
  await api1.getCurrentUserId();
  await vaciarCola();
  idb().fallanBorrar.clear();
  red.me = 0;
  const api2 = await cargar();
  const r = await api2.getBestAvailableLikes();
  ok(!deA(r.items) && r.source === 'empty', `🔴 la carga siguiente devuelve «no hay caché» (${r.items.length} items, ${r.source})`);
  ok(!idb().kv.has('all_liked_tracks') && !idb().kv.has('all_liked_tracks_partial'), '🔴 …y borró las dos claves');
  ok(!hayMarca(), '…y quitó la marca');
}

// ── La promesa en vuelo ──────────────────────────────────────────────────────────────────────────
decir('· la promesa en vuelo');
{
  escenario({ ultimo: B, cache: 'b', parcial: null });
  const api = await cargar();
  const [x, y] = await Promise.all([api.getCurrentUserId(), api.getCurrentUserId()]);
  ok(x === B && y === B && red.me === 1, `🔴 dos getCurrentUserId() a la vez con el memo frío piden UN /me (${red.me})`);
  await api.getCurrentUserId();
  ok(red.me === 1, 'y con el memo caliente, ninguno más');
}
{
  escenario({ ultimo: B, cache: 'b', parcial: null });
  red.meFalla = 1;
  const api = await cargar();
  const primera = await sinTirar(() => api.getCurrentUserId());
  const segunda = await sinTirar(() => api.getCurrentUserId());
  ok(primera.error && segunda.valor === B && red.me === 2, `un /me que falla no se memoiza: la segunda vuelve a pedir y da el id (${primera.error ? 'tiró' : 'no tiró'}, ${segunda.valor}, ${red.me} /me)`);
}

// ── Conservación ─────────────────────────────────────────────────────────────────────────────────
decir('· conservación (verdes antes y después)');
{
  escenario({ ultimo: B, cache: 'b', parcial: 'b' });
  const api = await cargar();
  await api.getCurrentUserId();
  await vaciarCola();
  ok(idb().intentos.length === 0 && !hayMarca(), `el mismo usuario: ningún borrado y ninguna marca (${idb().intentos.length})`);
}
{
  escenario({ falla: false });
  lsMapa.set('spc_all_liked_tracks', JSON.stringify({ value: LIKES_A.slice(0, 2), timestamp: TS_A, ttl: 0 }));
  lsMapa.set('spc_all_user_playlists', JSON.stringify({ value: [], timestamp: TS_A, ttl: 0 }));
  const api = await cargar();
  const { OWNER_KEY_LIST } = await import(pathToFileURL(join(raiz, 'src/js/history-keys.js')).href);
  const { OCULTOS_ITEMS_PREFIX } = await import(pathToFileURL(join(raiz, 'src/js/util/ocultos-items-clave.js')).href);
  await api.getCurrentUserId();
  await vaciarCola();
  const int = new Set(idb().intentos);
  const deHoy = ['all_liked_tracks', 'all_liked_tracks_partial', ...OWNER_KEY_LIST, 'prefijo:history_', 'prefijo:playlist_items_', `prefijo:${OCULTOS_ITEMS_PREFIX}`, 'prefijo:statsfm_top_lifetime_v1'];
  const faltan = deHoy.filter((k) => !int.has(k));
  ok(faltan.length === 0, `cambio de usuario con la IndexedDB sana: los mismos borrados de hoy (faltan: ${faltan.join(', ') || '—'})`);
  ok(!lsMapa.has('spc_all_liked_tracks') && !lsMapa.has('spc_all_user_playlists'), '…también la heredada de localStorage y la lista de playlists');
  ok(!hayMarca() && lsMapa.get(ULTIMO) === B, '…sin marca al final, y fonoteca_last_user_id = B');
}
{
  // Sin marca, los seis caminos hacen lo de hoy (el usuario no cambió; la caché es de B).
  escenario({ ultimo: B, cache: 'b', parcial: 'b', falla: false });
  const api = await cargar();
  await api.getCurrentUserId();
  const r1 = await api.getBestAvailableLikes();
  ok(r1.source === 'full' && r1.items.length === LIKES_B.length, `sin marca, L1 devuelve la caché (${r1.items.length}, ${r1.source})`);
  const { copia } = await api.exportarCopiaCompleta();
  ok(copia.likes.items.length === LIKES_B.length && copia._likesSource === 'full', `sin marca, L2 exporta la caché (${copia.likes.items.length})`);
  ok(JSON.stringify(await api.getLikesPartialInfo()) === JSON.stringify({ items: 3, offset: 50 }), 'sin marca, L4 ofrece retomar');
  ok((await api.getLikesCacheTimestamp()) === TS_B, 'sin marca, L5 da la fecha de la caché');
  idb().lecturas.length = 0;
  await api.removeLikedTracks(['tB1'], { origen: 'test-t98' });
  const k = [...lsMapa.keys()].find((x) => x.startsWith('likes_borrados_log_v1'));
  const reg = JSON.parse(lsMapa.get(k))[0];
  ok((red.lecturasAlBorrar || []).includes('all_liked_tracks') && reg.borradas?.[0]?.nombre === 'Tema inventado tB1', 'sin marca, L6 le pone nombre a lo que se borra, desde la caché');
}
{
  escenario({ ultimo: B, cache: null, parcial: 'b', falla: false });
  red.likesB = LIKES_B.slice(0, 2);   // el parcial (3, hasta el offset 50) ya cubre el total: la descarga cuadra
  const api = await cargar();
  await api.getCurrentUserId();
  const r = await sinTirar(() => api.getAllLikedTracks());
  ok(red.paginas[0] === 50 && r.valor?.length === 3 && r.valor.every((x, i) => x.track.id === `tB${i}`), `sin marca, L3 retoma el parcial desde donde quedó (páginas ${JSON.stringify(red.paginas)}, ${r.valor?.length ?? r.error?.message})`);
}

// ── La guarda de lectura estática ────────────────────────────────────────────────────────────────
decir('· la guarda de lectura estática: nadie toca la caché de me gusta fuera de la lista');

// Pela el JS: `codigo` con los comentarios en blanco (los strings quedan, se buscan las claves entre comillas) y
// `esqueleto` con comentarios, strings, texto de plantillas y regex en blanco (para contar llaves). Los dos con el
// MISMO largo y los mismos saltos de línea, así una posición vale en los dos. Un lexer chico y no un `replace`: un
// `/*` dentro de un `//` se come cientos de líneas (la trampa de likes-cache-policy).
function pelar(src) {
  const n = src.length;
  let cod = '', esq = '';
  const pila = [{ t: 'code', llaves: 0 }];
  let prevSig = '', prevPal = '';
  const blanco = (s) => s.replace(/[^\n]/g, ' ');
  const emitir = (s, comoCodigo) => { cod += s; esq += comoCodigo ? s : blanco(s); };
  const puedeRegex = () => !prevSig || '(,=:[!&|?{};+-*%<>~^'.includes(prevSig) || /^(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(prevPal);
  let i = 0;
  while (i < n) {
    const top = pila[pila.length - 1];
    const c = src[i], d = src[i + 1];
    if (top.t === 'tpl') {
      if (c === '\\') { emitir(src.slice(i, i + 2), false); i += 2; continue; }
      if (c === '`') { pila.pop(); emitir(c, true); i++; prevSig = '`'; prevPal = ''; continue; }
      if (c === '$' && d === '{') { pila.push({ t: 'code', llaves: 0 }); emitir('${', true); i += 2; prevSig = '{'; prevPal = ''; continue; }
      emitir(c, false); i++; continue;
    }
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j++; cod += blanco(src.slice(i, j)); esq += blanco(src.slice(i, j)); i = j; continue; }
    if (c === '/' && d === '*') { const f = src.indexOf('*/', i + 2); const j = f < 0 ? n : f + 2; cod += blanco(src.slice(i, j)); esq += blanco(src.slice(i, j)); i = j; continue; }
    if (c === "'" || c === '"') { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } const s = src.slice(i, j + 1); cod += s; esq += c + blanco(s.slice(1, -1)) + (s.length > 1 ? s.at(-1) : ''); i = j + 1; prevSig = c; prevPal = ''; continue; }
    if (c === '`') { pila.push({ t: 'tpl' }); emitir(c, true); i++; continue; }
    if (c === '/' && puedeRegex()) {
      let j = i + 1, clase = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') clase = true; else if (src[j] === ']') clase = false; else if (src[j] === '/' && !clase) break; j++; }
      j++; while (j < n && /[a-z]/i.test(src[j])) j++;
      const s = src.slice(i, j); cod += s; esq += blanco(s); i = j; prevSig = '/'; prevPal = ''; continue;
    }
    if (c === '{') { top.llaves++; }
    if (c === '}') { if (top.llaves === 0 && pila.length > 1) { pila.pop(); emitir(c, true); i++; prevSig = '`'; continue; } top.llaves--; }
    emitir(c, true);
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) { let j = i + 1; while (j < n && /[\w$]/.test(src[j])) j++; prevPal = src.slice(i, j); cod += src.slice(i + 1, j); esq += src.slice(i + 1, j); prevSig = 'a'; i = j; continue; }
    prevSig = c; prevPal = ''; i++;
  }
  return { cod, esq };
}

// Las funciones con nombre (`function x(`, `async function x(`) y su cuerpo, sobre el esqueleto.
function funciones(esq) {
  const out = [];
  const re = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(esq))) {
    let i = m.index + m[0].length, prof = 1;
    while (i < esq.length && prof) { if (esq[i] === '(') prof++; else if (esq[i] === ')') prof--; i++; }
    while (i < esq.length && esq[i] !== '{') i++;
    const ini = i; prof = 0;
    for (; i < esq.length; i++) { if (esq[i] === '{') prof++; else if (esq[i] === '}' && --prof === 0) break; }
    out.push({ nombre: m[1], ini, fin: i });
  }
  return out;
}
// Quién es dueño de una posición: la función con nombre más adentro, o la declaración de nivel superior.
function duenio(pos, fns, esq) {
  const dentro = fns.filter((f) => f.ini <= pos && pos <= f.fin).sort((a, b) => (a.fin - a.ini) - (b.fin - b.ini));
  if (dentro.length) return dentro[0].nombre;
  const finLinea = esq.indexOf('\n', pos);
  const antes = esq.slice(0, finLinea < 0 ? esq.length : finLinea).split('\n');
  for (let k = antes.length - 1; k >= 0; k--) {
    const m = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([\w$]+)/.exec(antes[k]);
    if (m) return m[1];
  }
  return '(nivel superior)';
}

// Cada mención de la caché de me gusta, fuera de comentarios.
const MENCION = /\b(LIKES_CACHE_KEY|LIKES_PARTIAL_KEY|LIKES_CLAVE|LIKES_LEGADO_LS)\b|(['"`])(?:spc_)?all_liked_tracks(?:_partial)?\2/g;
// 🔴 LA LISTA. Una mención nueva tiene que entrar acá (archivo y función) Y, si LEE, preguntar por la marca
// (`hayLikesDeOtro(`). Ver «👤 Los me gusta del usuario anterior (v=345)» en CLAUDE.md.
const PERMITIDOS = [
  // los seis caminos que leen
  { archivo: 'src/js/api.js', nombre: 'leerLikesCacheados', lee: true, que: 'L1' },
  { archivo: 'src/js/util/copia-completa.js', nombre: 'likesDe', lee: true, que: 'L2' },
  { archivo: 'src/js/api.js', nombre: 'startLikesLoad', lee: true, que: 'L3 (la descarga; retoma por paginateAll → loadPartial)' },
  { archivo: 'src/js/api.js', nombre: 'loadPartial', lee: true, que: 'L3 (lee el parcial)' },
  { archivo: 'src/js/api.js', nombre: 'getLikesPartialInfo', lee: true, que: 'L4' },
  { archivo: 'src/js/api.js', nombre: 'getLikesCacheTimestamp', lee: true, que: 'L5' },
  { archivo: 'src/js/api.js', nombre: 'registrarBorradoDeLikes', lee: true, que: 'L6' },
  // la heredada que entra a IndexedDB
  { archivo: 'src/js/api.js', nombre: 'migrateLikesFromLocalStorage', lee: true, que: 'muda la heredada' },
  // la de T98.1 y los escritores
  { archivo: 'src/js/api.js', nombre: 'borrarLikesDeOtro', lee: false, que: 'T98.1: borra y quita la marca' },
  { archivo: 'src/js/api.js', nombre: 'saveLikes', lee: false, que: 'escribe la completa' },
  { archivo: 'src/js/api.js', nombre: 'savePartial', lee: false, que: 'escribe el parcial' },
  { archivo: 'src/js/api.js', nombre: 'clearPartial', lee: false, que: 'borra el parcial' },
  { archivo: 'src/js/api.js', nombre: 'removeFromLikesCache', lee: false, que: 'borra la heredada de localStorage (lee por L1)' },
  // las constantes y las listas
  { archivo: 'src/js/api.js', nombre: 'LIKES_CACHE_KEY', lee: false, que: 'la constante' },
  { archivo: 'src/js/api.js', nombre: 'LIKES_PARTIAL_KEY', lee: false, que: 'la constante' },
  { archivo: 'src/js/util/copia-completa.js', nombre: 'LIKES_CLAVE', lee: false, que: 'la constante' },
  { archivo: 'src/js/util/copia-completa.js', nombre: 'LIKES_LEGADO_LS', lee: false, que: 'la constante' },
  { archivo: 'src/js/util/copia-completa.js', nombre: 'CENSO', lee: false, que: 'las dos filas del censo' },
  { archivo: 'src/js/util/limpiar-cache.js', nombre: 'CONSERVAR_CLAVES', lee: false, que: '«Limpiar caché» las conserva' },
];

function jsDe(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsDe(p)); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
/** Revisa un conjunto de fuentes `{ archivo: texto }`. Devuelve las menciones fuera de la lista y los lectores que no preguntan. */
function revisar(fuentes) {
  const fuera = [], sinMarca = [], vistos = new Set();
  for (const [archivo, src] of Object.entries(fuentes)) {
    const { cod, esq } = pelar(src);
    const fns = funciones(esq);
    for (const m of cod.matchAll(MENCION)) {
      const nombre = duenio(m.index, fns, esq);
      const linea = cod.slice(0, m.index).split('\n').length;
      const p = PERMITIDOS.find((x) => x.archivo === archivo && x.nombre === nombre);
      if (!p) { fuera.push(`${archivo}:${linea} (${nombre}: ${m[0]})`); continue; }
      vistos.add(`${archivo}#${nombre}`);
    }
    for (const p of PERMITIDOS.filter((x) => x.archivo === archivo && x.lee)) {
      const f = fns.find((x) => x.nombre === p.nombre);
      if (!f || !/\bhayLikesDeOtro\(/.test(cod.slice(f.ini, f.fin))) sinMarca.push(`${archivo} ${p.nombre} (${p.que})${f ? '' : ': no existe'}`);
    }
  }
  return { fuera, sinMarca, vistos };
}
const fuentes = Object.fromEntries(jsDe(join(raiz, 'src/js')).map((p) => [relative(raiz, p), readFileSync(p, 'utf8')]));
const rev = revisar(fuentes);
ok(rev.fuera.length === 0, `🔴 ninguna mención de la caché de me gusta fuera de la lista (${rev.fuera.join(' · ') || '—'})`);
ok(rev.sinMarca.length === 0, `🔴 cada camino de la lista que LEE pregunta por la marca (no preguntan: ${rev.sinMarca.join(' · ') || '—'})`);
const sinUso = PERMITIDOS.filter((p) => !rev.vistos.has(`${p.archivo}#${p.nombre}`)).map((p) => `${p.archivo} ${p.nombre}`);
ok(sinUso.length === 0, `la lista no tiene entradas viejas: cada una menciona la caché (sin mención: ${sinUso.join(' · ') || '—'})`);
// La guarda, probada contra mutantes: si no se pusiera roja con un séptimo lector, no protege nada.
{
  const api = fuentes['src/js/api.js'];
  const septimo = revisar({ ...fuentes, 'src/js/api.js': api + '\nasync function lectorNuevo() { return idbGetCachedRaw(LIKES_CACHE_KEY); }\n' });
  ok(septimo.fuera.some((x) => x.includes('lectorNuevo')), `un séptimo lector en api.js se pone rojo, con archivo y línea (${septimo.fuera.find((x) => x.includes('lectorNuevo'))})`);
  const otroArchivo = revisar({ ...fuentes, 'src/js/features/vista-inventada.js': "export async function leer() { return idbGetCachedRaw('all_liked_tracks_partial'); }\n" });
  ok(otroArchivo.fuera.some((x) => x.startsWith('src/js/features/vista-inventada.js:1')), 'una vista nueva que lea la clave por su nombre se pone roja');
  const comentario = revisar({ ...fuentes, 'src/js/features/vista-inventada.js': "// lee 'all_liked_tracks' /* y\n/* LIKES_CACHE_KEY */ export const x = 'https://a//b';\n" });
  ok(comentario.fuera.length === rev.fuera.length, 'una mención dentro de un comentario no cuenta (y un `/*` dentro de un `//` no se come el archivo)');
  const cuerpo = (n) => { const i = api.indexOf(`async function ${n}(`); return i; };
  const i4 = cuerpo('getLikesPartialInfo');
  if (i4 >= 0 && /hayLikesDeOtro\(/.test(api.slice(i4, i4 + 600))) {
    const sinPregunta = api.slice(0, i4) + api.slice(i4).replace(/hayLikesDeOtro\(\)/, 'false');
    ok(revisar({ ...fuentes, 'src/js/api.js': sinPregunta }).sinMarca.some((x) => x.includes('getLikesPartialInfo')), 'un lector de la lista que deja de preguntar por la marca se pone rojo');
  } else ok(false, 'un lector de la lista que deja de preguntar por la marca se pone rojo (getLikesPartialInfo todavía no pregunta)');
}

// ── La guarda de ESCRITURA estática (v=346, tanda 103) ───────────────────────────────────────────
decir('· la guarda de escritura estática: solo tres funciones escriben la caché de me gusta en IndexedDB, y las tres preguntan');
// 🔴 LA LISTA de los que escriben. La regla vive en `saveLikes` / `savePartial` (no escriben con la marca) y la mudanza
// de la heredada ya preguntaba. Un `idbSet…(LIKES_CACHE_KEY | LIKES_PARTIAL_KEY | 'all_liked_tracks…', …)` en cualquier
// otra función de `src/js/` se pone rojo con archivo y línea, AUNQUE esa función esté en `PERMITIDOS` (ahí está la
// diferencia con la guarda de lectura). Ver «Los que escriben (v=346)» en CLAUDE.md.
const ESCRITORES_IDB = [
  { archivo: 'src/js/api.js', nombre: 'saveLikes' },
  { archivo: 'src/js/api.js', nombre: 'savePartial' },
  { archivo: 'src/js/api.js', nombre: 'migrateLikesFromLocalStorage' },
];
/** Cada mención de la caché que es el primer argumento de un `idbSet…(` (también dentro de `idbSetVarios([[…`). */
function escriturasIdb(fuentes) {
  const fuera = [], sinMarca = [];
  for (const [archivo, src] of Object.entries(fuentes)) {
    const { cod, esq } = pelar(src);
    const fns = funciones(esq);
    for (const m of cod.matchAll(MENCION)) {
      if (!/\bidbSet\w*\s*\(\s*(?:\[\s*)*$/.test(cod.slice(Math.max(0, m.index - 80), m.index))) continue;
      const nombre = duenio(m.index, fns, esq);
      const linea = cod.slice(0, m.index).split('\n').length;
      if (!ESCRITORES_IDB.some((x) => x.archivo === archivo && x.nombre === nombre)) fuera.push(`${archivo}:${linea} (${nombre}: ${m[0]})`);
    }
    for (const p of ESCRITORES_IDB.filter((x) => x.archivo === archivo)) {
      const f = fns.find((x) => x.nombre === p.nombre);
      if (!f || !/\bhayLikesDeOtro\(/.test(cod.slice(f.ini, f.fin))) {
        const linea = f ? cod.slice(0, f.ini).split('\n').length : '?';
        sinMarca.push(`${archivo}:${linea} ${p.nombre}${f ? '' : ': no existe'}`);
      }
    }
  }
  return { fuera, sinMarca };
}
const esc = escriturasIdb(fuentes);
ok(esc.fuera.length === 0, `🔴 la caché de me gusta solo se escribe en IndexedDB dentro de saveLikes, savePartial y migrateLikesFromLocalStorage (fuera: ${esc.fuera.join(' · ') || '—'})`);
ok(esc.sinMarca.length === 0, `🔴 las tres preguntan por la marca, hayLikesDeOtro( (no preguntan: ${esc.sinMarca.join(' · ') || '—'})`);
{
  const api = fuentes['src/js/api.js'];
  // Un escritor nuevo DENTRO de una función que ya está en PERMITIDOS (clearPartial): la guarda de lectura no lo ve.
  const iCp = api.indexOf('async function clearPartial(key) {');
  const conEscritor = api.slice(0, iCp) + api.slice(iCp).replace('async function clearPartial(key) {', 'async function clearPartial(key) {\n  await idbSetCached(LIKES_CACHE_KEY, [], null);');
  const r1 = escriturasIdb({ ...fuentes, 'src/js/api.js': conEscritor });
  ok(iCp >= 0 && r1.fuera.some((x) => /^src\/js\/api\.js:\d+ \(clearPartial: LIKES_CACHE_KEY\)$/.test(x)), `un idbSetCached(LIKES_CACHE_KEY, …) en otra función se pone rojo, con archivo y línea (${r1.fuera.join(' · ') || 'no lo vio'})`);
  const otraVista = escriturasIdb({ ...fuentes, 'src/js/features/vista-inventada.js': "export async function x(v) { await idbSetVarios([['all_liked_tracks', v]]); }\n" });
  ok(otraVista.fuera.some((x) => x.startsWith('src/js/features/vista-inventada.js:1')), 'una vista nueva que escriba la clave por su nombre (idbSetVarios) se pone roja');
  // `saveLikes` sin la pregunta.
  const iSl = api.indexOf('async function saveLikes(');
  const sinPregunta = api.slice(0, iSl) + api.slice(iSl).replace(/if \(hayLikesDeOtro\(\)\) \{/, 'if (false) {');
  const r2 = escriturasIdb({ ...fuentes, 'src/js/api.js': sinPregunta });
  ok(iSl >= 0 && r2.sinMarca.some((x) => /^src\/js\/api\.js:\d+ saveLikes$/.test(x)), `saveLikes sin la pregunta se pone rojo, con archivo y línea (${r2.sinMarca.join(' · ') || 'no lo vio'})`);
}

// ── La guarda de la ÉPOCA estática (v=348, tanda 105) ────────────────────────────────────────────
decir('· la guarda de la época: cada saveLikes( pasa epoca, y los tres que escriben comparan contra la época');
// La marca solo vive mientras dura el borrado de la otra pestaña. Lo que cierra la carrera es la época: el
// `fonoteca_last_user_id` que había cuando el escritor empezó (`epocaDeLikes()`). Ver «La época y Reset + Login (v=348)»
// en CLAUDE.md. Un `saveLikes(` sin `epoca` tira en tiempo de ejecución; esto lo pone rojo antes, con archivo y línea.
/** Cada llamada a `saveLikes(` (no la definición) sin `epoca` entre sus argumentos, y los escritores que no comparan. */
function epocas(fuentes) {
  const sinEpoca = [], sinComparar = [];
  for (const [archivo, src] of Object.entries(fuentes)) {
    const { cod, esq } = pelar(src);
    for (const m of esq.matchAll(/\bsaveLikes\s*\(/g)) {
      if (/\bfunction\s*$/.test(esq.slice(Math.max(0, m.index - 20), m.index))) continue;
      let i = m.index + m[0].length, prof = 1;
      while (i < esq.length && prof) { if (esq[i] === '(') prof++; else if (esq[i] === ')') prof--; i++; }
      if (!/\bepoca\b/.test(cod.slice(m.index + m[0].length, i - 1))) sinEpoca.push(`${archivo}:${cod.slice(0, m.index).split('\n').length}`);
    }
    if (archivo !== 'src/js/api.js') continue;
    const fns = funciones(esq);
    for (const nombre of ['saveLikes', 'savePartial', 'migrateLikesFromLocalStorage']) {
      const f = fns.find((x) => x.nombre === nombre);
      if (!f || !/\bepocaDeLikes\(/.test(cod.slice(f.ini, f.fin))) sinComparar.push(`${archivo}:${f ? cod.slice(0, f.ini).split('\n').length : '?'} ${nombre}${f ? '' : ': no existe'}`);
    }
  }
  return { sinEpoca, sinComparar };
}
const ep = epocas(fuentes);
ok(ep.sinEpoca.length === 0, `🔴 cada saveLikes( de src/js pasa epoca (sin epoca: ${ep.sinEpoca.join(' · ') || '—'})`);
ok(ep.sinComparar.length === 0, `🔴 saveLikes, savePartial y migrateLikesFromLocalStorage llaman a epocaDeLikes( (no: ${ep.sinComparar.join(' · ') || '—'})`);
{
  const api = fuentes['src/js/api.js'];
  // Un escritor nuevo que llama a `saveLikes(` sin `epoca`.
  const conMutante = api + '\nasync function escritorNuevo(items) { return saveLikes(items, { complete: true }); }\n';
  const r1 = epocas({ ...fuentes, 'src/js/api.js': conMutante });
  const lineaMut = conMutante.split('\n').length - 1;
  ok(r1.sinEpoca.includes(`src/js/api.js:${lineaMut}`), `un saveLikes( sin epoca se pone rojo, con archivo y línea (${r1.sinEpoca.join(' · ') || 'no lo vio'})`);
  const otraVista = epocas({ ...fuentes, 'src/js/features/vista-inventada.js': 'export async function x(v) {\n  await saveLikes(v);\n}\n' });
  ok(otraVista.sinEpoca.includes('src/js/features/vista-inventada.js:2'), 'un saveLikes(v) a secas en otra vista se pone rojo');
  // `savePartial` sin la comparación.
  const iSp = api.indexOf('async function savePartial(');
  const sinComparar = api.slice(0, iSp) + api.slice(iSp).replace(/epocaDeLikes\(\)/, 'epoca');
  const r2 = epocas({ ...fuentes, 'src/js/api.js': sinComparar });
  ok(iSp >= 0 && r2.sinComparar.some((x) => /^src\/js\/api\.js:\d+ savePartial$/.test(x)), `savePartial sin la comparación se pone rojo, con archivo y línea (${r2.sinComparar.join(' · ') || 'no lo vio'})`);
}

fin();
