// tests/por-escuchar.test.mjs — «📚 Por escuchar» en #listened (v=366, tanda 129)
//
// POR QUÉ ESTA SUITE EXISTE: Ian quería ver los álbumes de su biblioteca de Spotify que todavía no marcó como escuchados, oírlos con
// los previews y marcarlos. Lo pendiente se CALCULA (biblioteca menos registro) y «escuchado» es la playlist de escuchados de siempre:
// ninguna playlist nueva y ningún estado nuevo. La regla de «ya está registrado» vivía dentro de `computeUnregistered()`; ahora vive en
// `util/registro-escuchados.js` y la usan las dos listas. Escrita dos veces, diverge (v=219).
//
// Qué mira:
//   · la función pura con álbumes INVENTADOS: registrado por id, por clave con otro artista de `artistAlts`, por otra edición del
//     nombre, no registrado; el orden por `added_at`; un id repetido;
//   · 🔴 CONSERVACIÓN: `computeUnregistered()` (sacada del fuente) da lo mismo que la de c537fa7 (sacada con `git show`) sobre los
//     mismos datos inventados, con varios mínimos y los tres tipos;
//   · las tres fuentes de la pista representativa (me gusta, lo guardado, el tracklist);
//   · «Ya lo escuché» con el `api.js` REAL y `fetch` doblado: exactamente 1 POST a la playlist de escuchados con esa uri; con el POST
//     en 403 tira (y quien llama no dice «añadido»); la fuente (c) cuesta 1 GET de tracklist;
//   · `getSavedAlbums()` REAL que tira → `{ fallo }` y el texto del fallo, nunca «0»; la biblioteca vacía de verdad → el texto de nada.
//   · Lectura estática de `listened.js`: el botón, que importa la regla y que no quedó la copia vieja del cruce.
//
// `listened.js` NO se carga en Node (importa media app y pinta un modal): lo que es de pantalla —la fila que se va, el toast, el número
// que baja, el modal que no desborda— lo mira el caso J del banco `listened-biblioteca`.
//
// `RAIZ_T129=<carpeta>` corre la suite contra otra copia del repo (p. ej. c537fa7, para verla en rojo). El fuente viejo de la
// conservación sale siempre de `git show c537fa7:…` sobre el repo de este archivo.
//
// 🔴 Todo INVENTADO (el repo es público).

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

register('./dobles/loader-t127.mjs', pathToFileURL(import.meta.filename));

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const raiz = process.env.RAIZ_T129 || repo;
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
lsMapa.set('sp_access_token', 'tok-inventado-t129');
lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
lsMapa.set('fonoteca_last_user_id', 't129-cuenta-inventada');

// ── Sacar funciones del fuente ──────────────────────────────────────────────────────────────────
function sacarFuncion(src, nombre) {
  const i = src.indexOf(`function ${nombre}(`);
  if (i < 0) throw new Error(`no está la función ${nombre}`);
  let j = src.indexOf(')', i);
  j = src.indexOf('{', j);
  let prof = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') prof++;
    else if (src[k] === '}') { prof--; if (prof === 0) return src.slice(i, k + 1); }
  }
  throw new Error(`la función ${nombre} no cierra`);
}
const compartido = readFileSync(join(repo, 'src/js/features/listened-shared.js'), 'utf8');
const albumKey = new Function(`${sacarFuncion(compartido, 'norm')} ${sacarFuncion(compartido, 'baseName')} ${sacarFuncion(compartido, 'albumKey')} return albumKey;`)();
const { esEPoAlbum } = await import(pathToFileURL(join(repo, 'src/js/util/release-size.js')).href);

// ── La regla, del módulo bajo prueba ────────────────────────────────────────────────────────────
let M = null;
try {
  M = await import(pathToFileURL(join(raiz, 'src/js/util/registro-escuchados.js')).href);
} catch (e) {
  decir(`  (no se pudo importar util/registro-escuchados.js de la raíz bajo prueba: ${e.code || e.message})`);
}
const conM = (nombre, f) => {
  if (!M) { ok(false, `${nombre} (no está util/registro-escuchados.js)`); return; }
  try { f(); } catch (e) { ok(false, `${nombre} (tiró: ${e.message})`); }
};
const conMAsync = async (nombre, f) => {
  if (!M) { ok(false, `${nombre} (no está util/registro-escuchados.js)`); return; }
  try { await f(); } catch (e) { ok(false, `${nombre} (tiró: ${e.message})`); }
};

// ── Los datos INVENTADOS ────────────────────────────────────────────────────────────────────────
// El registro (la playlist de escuchados, agrupada): tres discos.
const REGISTRO = [
  { id: 'regIdDiscoUnoInventado', name: 'Disco Uno Inventado', artist: 'Banda Uno Inventada', artistAlts: ['Banda Uno Inventada'], tracks: [{ uri: 'spotify:track:regPistaUnoInventadaxxx' }] },
  { id: 'regIdDiscoDosInventado', name: 'Disco Dos Inventado', artist: 'Varios Inventados', artistAlts: ['Varios Inventados', 'Solista Dos Inventado'], tracks: [{ uri: 'spotify:track:regPistaDosInventadaxxx' }] },
  { id: 'regIdDiscoTresInventad', name: 'Disco Tres Inventado', artist: 'Banda Tres Inventada', artistAlts: [], tracks: [{ uri: 'spotify:track:regPistaTresInventadaxx' }] },
];
const guardado = (id, name, artistas, added_at, extra = {}) => ({ added_at, album: { id, name, artists: artistas.map((n) => ({ name: n })), images: [], ...extra } });
const BIBLIOTECA = [
  guardado('regIdDiscoUnoInventado', 'Disco Uno Inventado', ['Otra Banda Inventada'], '2026-03-01T00:00:00Z'),            // por id
  guardado('bibIdDiscoDosOtraEdici', 'Disco Dos Inventado', ['Solista Dos Inventado'], '2026-03-02T00:00:00Z'),            // por clave, con un artistAlts
  guardado('bibIdDiscoTresDeluxexx', 'Disco Tres Inventado (Deluxe Edition)', ['Banda Tres Inventada'], '2026-03-03T00:00:00Z'), // otra edición
  guardado('bibIdPendienteViejoxxx', 'Pendiente Viejo Inventado', ['Banda Cuatro Inventada'], '2025-01-01T00:00:00Z'),
  guardado('bibIdPendienteNuevoxxx', 'Pendiente Nuevo Inventado', ['Banda Cinco Inventada'], '2026-05-01T00:00:00Z'),
  guardado('bibIdPendienteMedioxxx', 'Pendiente Medio Inventado', ['Banda Seis Inventada', 'Invitada Inventada'], '2025-09-01T00:00:00Z'),
  guardado('bibIdPendienteNuevoxxx', 'Pendiente Nuevo Inventado', ['Banda Cinco Inventada'], '2026-05-01T00:00:00Z'),        // repetido
  { added_at: '2026-01-01T00:00:00Z', album: null },                                                                        // sin álbum
];

decir('\n1. La función pura (util/registro-escuchados.js)');
conM('pendientes de la biblioteca', () => {
  const indice = M.indiceDelRegistro(REGISTRO, albumKey);
  const lista = M.pendientesDeBiblioteca(BIBLIOTECA, indice, albumKey);
  const ids = lista.map((x) => x.album.id);
  ok(!ids.includes('regIdDiscoUnoInventado'), 'registrado por id: fuera (aunque el artista no coincida)');
  ok(!ids.includes('bibIdDiscoDosOtraEdici'), 'registrado por clave con otro artista de artistAlts: fuera');
  ok(!ids.includes('bibIdDiscoTresDeluxexx'), 'registrado como otra edición del nombre (Deluxe): fuera');
  ok(JSON.stringify(ids) === JSON.stringify(['bibIdPendienteNuevoxxx', 'bibIdPendienteMedioxxx', 'bibIdPendienteViejoxxx']), `los no registrados, del guardado más nuevo al más viejo, sin repetir (${ids.join(', ')})`);
  ok(lista[0].addedAt === '2026-05-01T00:00:00Z' && lista[0].album.name === 'Pendiente Nuevo Inventado', 'cada fila trae su added_at y el álbum tal cual');
  ok(M.pendientesDeBiblioteca([], indice, albumKey).length === 0, 'biblioteca vacía: lista vacía');
  ok(M.pendientesDeBiblioteca(BIBLIOTECA, M.indiceDelRegistro([], albumKey), albumKey).length === 6, 'registro vacío: los 6 distintos con álbum');
  // El segundo artista del álbum también cuenta: se registra «Pendiente Medio» con la invitada.
  const conInvitada = M.indiceDelRegistro([...REGISTRO, { id: 'otroIdInventadoxxxxxxx', name: 'Pendiente Medio Inventado', artist: 'Invitada Inventada', tracks: [] }], albumKey);
  ok(!M.pendientesDeBiblioteca(BIBLIOTECA, conInvitada, albumKey).some((x) => x.album.id === 'bibIdPendienteMedioxxx'), 'la clave se prueba con CADA artista del álbum');
});
conM('estaRegistrado por pista', () => {
  const indice = M.indiceDelRegistro(REGISTRO, albumKey);
  ok(M.estaRegistrado(indice, { uris: ['spotify:track:regPistaTresInventadaxx'] }), 'una pista ya en la playlist alcanza');
  ok(!M.estaRegistrado(indice, { claves: ['nada|nadie'], ids: ['nada'], uris: [null, undefined] }), 'nada coincide: no registrado (y una uri vacía no cuenta)');
});

decir('\n2. Conservación de computeUnregistered() contra c537fa7');
{
  let viejo = null, nuevo = null;
  try { viejo = execFileSync('git', ['-C', repo, 'show', 'c537fa7:src/js/features/listened.js'], { encoding: 'utf8' }); } catch (e) { decir(`  (git show falló: ${e.message})`); }
  try { nuevo = readFileSync(join(raiz, 'src/js/features/listened.js'), 'utf8'); } catch (e) { decir(`  (no se leyó listened.js: ${e.message})`); }
  // Los me gusta agrupados (forma de `attachLikes()`): uno por cada señal y alguno por debajo del mínimo.
  const likes = (name, artist, ids, uris, extra = {}) => ({ id: ids[0], ids: new Set(ids), name, artist, year: '2020', image: null, albumType: 'album', totalTracks: 10, tracks: uris.map((u, i) => ({ name: `Tema ${i} inventado`, artists: artist, uri: u })), artistAlts: new Set([artist]), ...extra });
  const LIKES = new Map([
    [albumKey('Disco Uno Inventado', 'Banda Uno Inventada'), likes('Disco Uno Inventado', 'Banda Uno Inventada', ['likesIdUnoInventadoxxx'], ['spotify:track:a1', 'spotify:track:a2', 'spotify:track:a3', 'spotify:track:a4'])],
    [albumKey('Disco Dos Inventado', 'Solista Dos Inventado'), likes('Disco Dos Inventado', 'Solista Dos Inventado', ['likesIdDosInventadoxxx'], ['spotify:track:b1', 'spotify:track:b2', 'spotify:track:b3', 'spotify:track:b4', 'spotify:track:b5'])],
    [albumKey('Por Pista Inventado', 'Banda Siete Inventada'), likes('Por Pista Inventado', 'Banda Siete Inventada', ['likesIdSieteInventadox'], ['spotify:track:regPistaTresInventadaxx', 'spotify:track:c2', 'spotify:track:c3', 'spotify:track:c4'])],
    [albumKey('Por Id Inventado', 'Banda Ocho Inventada'), likes('Por Id Inventado', 'Banda Ocho Inventada', ['regIdDiscoTresInventad', 'likesIdOchoInventadoxx'], ['spotify:track:d1', 'spotify:track:d2', 'spotify:track:d3', 'spotify:track:d4'])],
    [albumKey('Por Alias Inventado', 'Alias Inventado'), likes('Por Alias Inventado', 'Alias Inventado', ['likesIdAliasInventadox'], ['spotify:track:e1', 'spotify:track:e2', 'spotify:track:e3', 'spotify:track:e4'], { artistAlts: new Set(['Alias Inventado', 'Banda Uno Inventada']) })],
    [albumKey('Libre Grande Inventado', 'Banda Nueve Inventada'), likes('Libre Grande Inventado', 'Banda Nueve Inventada', ['likesIdNueveInventadox'], ['spotify:track:f1', 'spotify:track:f2', 'spotify:track:f3', 'spotify:track:f4', 'spotify:track:f5', 'spotify:track:f6'])],
    [albumKey('Libre Chico Inventado', 'Banda Diez Inventada'), likes('Libre Chico Inventado', 'Banda Diez Inventada', ['likesIdDiezInventadoxx'], ['spotify:track:g1', 'spotify:track:g2'], { albumType: 'single', totalTracks: 2 })],
    [albumKey('Descartado Inventado', 'Banda Once Inventada'), likes('Descartado Inventado', 'Banda Once Inventada', ['likesIdOnceInventadoxx'], ['spotify:track:h1', 'spotify:track:h2', 'spotify:track:h3', 'spotify:track:h4'])],
    [albumKey('Sin Uri Inventado', 'Banda Doce Inventada'), likes('Sin Uri Inventado', 'Banda Doce Inventada', ['likesIdDoceInventadoxx'], [null, null, null, null])],
  ]);
  // «Por Alias»: registrada como «Por Alias Inventado — Banda Uno Inventada».
  const REG = [...REGISTRO, { id: 'regIdAliasInventadoxxx', name: 'Por Alias Inventado', artist: 'Banda Uno Inventada', artistAlts: [], tracks: [] }];
  const DESCARTADOS = new Set([albumKey('Descartado Inventado', 'Banda Once Inventada')]);
  const construir = (src) => {
    const cuerpo = `${sacarFuncion(src, 'clavesDe')}\n${sacarFuncion(src, 'releaseKind')}\n${sacarFuncion(src, 'computeUnregistered')}\nreturn computeUnregistered;`;
    return new Function('albums', 'likesByKey', 'getDismissed', 'albumKey', 'esEPoAlbum', 'unregMin', 'indiceDelRegistro', 'estaRegistrado', cuerpo)(
      REG, LIKES, () => new Set(DESCARTADOS), albumKey, esEPoAlbum, 4, M?.indiceDelRegistro, M?.estaRegistrado);
  };
  if (!viejo || !nuevo) {
    ok(false, 'conservación: faltan los fuentes');
  } else {
    let fv, fn;
    try { fv = construir(viejo); fn = construir(nuevo); } catch (e) { ok(false, `conservación: no se pudo armar (${e.message})`); }
    if (fv && fn) {
      const forma = (l) => JSON.stringify(l.map((e) => ({ ...e, ids: [...e.ids], artistAlts: [...e.artistAlts] })));
      let iguales = 0, total = 0, conAlgo = 0;
      for (const min of [1, 2, 4, 5, 7]) {
        for (const tipo of ['all', 'albums', 'singles']) {
          total++;
          let a, b;
          try { a = fv(min, tipo); b = fn(min, tipo); } catch (e) { decir(`  (tiró con min=${min} tipo=${tipo}: ${e.message})`); continue; }
          if (forma(a) === forma(b)) iguales++;
          else decir(`  (distinto con min=${min} tipo=${tipo}: viejo ${a.map((x) => x.name).join('/')} · nuevo ${b.map((x) => x.name).join('/')})`);
          if (a.length) conAlgo++;
        }
      }
      ok(iguales === total, `computeUnregistered(): el mismo resultado que c537fa7 en ${iguales} de ${total} combinaciones de mínimo y tipo`);
      ok(conAlgo > 0, 'la conservación no compara solo listas vacías');
      const todos = fv(1, 'all').map((x) => x.name).sort();
      // «Sin Uri» se ofrece: sus pistas no tienen uri, y una uri vacía no es una señal de registro.
      ok(JSON.stringify(todos) === JSON.stringify(['Libre Chico Inventado', 'Libre Grande Inventado', 'Sin Uri Inventado']), `los datos ejercitan las cuatro señales y el descarte (c537fa7 ofrece: ${todos.join(', ')})`);
    }
  }
}

decir('\n3. La pista representativa: las tres fuentes');
const LIKES_PISTA = new Map([
  [albumKey('Con Me Gusta Inventado', 'Banda Me Gusta Inventada'), { ids: new Set(['otroIdDeEdicionInvent']), tracks: [{ uri: null }, { uri: 'spotify:track:pistaMeGustaInventadax' }] }],
  ['x|y', { ids: new Set(['bibIdPorIdInventadoxxx']), tracks: [{ uri: 'spotify:track:pistaPorIdInventadaxxx' }] }],
]);
await conMAsync('fuentes', async () => {
  let pedidas = 0;
  const pedirPistas = async () => { pedidas++; return [{ uri: 'spotify:track:pistaTracklistInventada' }]; };
  const dep = { likesByKey: LIKES_PISTA, claveDe: albumKey, pedirPistas };
  const a1 = await M.elegirPista({ id: 'bibIdMeGustaInventadox', name: 'Con Me Gusta Inventado (Deluxe)', artists: [{ name: 'Banda Me Gusta Inventada' }] }, dep);
  ok(a1.fuente === 'me-gusta' && a1.uri === 'spotify:track:pistaMeGustaInventadax' && pedidas === 0, `(a) me gusta por clave: ${a1.fuente} ${a1.uri}, 0 peticiones`);
  const a2 = await M.elegirPista({ id: 'bibIdPorIdInventadoxxx', name: 'Nombre que no coincide', artists: [{ name: 'Nadie' }], tracks: { items: [{ uri: 'spotify:track:noDeberiaUsarsexxxxxx' }] } }, dep);
  ok(a2.fuente === 'me-gusta' && a2.uri === 'spotify:track:pistaPorIdInventadaxxx' && pedidas === 0, `(a) me gusta por id gana a lo guardado: ${a2.fuente}`);
  const b = await M.elegirPista({ id: 'bibIdGuardadaInventada', name: 'Guardada Inventada', artists: [{ name: 'Nadie' }], tracks: { items: [{ uri: 'spotify:track:pistaGuardadaInventada' }] } }, dep);
  ok(b.fuente === 'guardada' && b.uri === 'spotify:track:pistaGuardadaInventada' && pedidas === 0, `(b) lo que trajo /me/albums: ${b.fuente}, 0 peticiones`);
  const c = await M.elegirPista({ id: 'bibIdTracklistInventad', name: 'Sin Nada Inventado', artists: [{ name: 'Nadie' }] }, dep);
  ok(c.fuente === 'tracklist' && c.uri === 'spotify:track:pistaTracklistInventada' && pedidas === 1, `(c) el tracklist: ${c.fuente}, 1 petición`);
  let tiro = null;
  try { await M.elegirPista({ id: 'bibIdVacioInventadoxxx', name: 'Vacío Inventado', artists: [] }, { ...dep, pedirPistas: async () => [] }); } catch (e) { tiro = e; }
  ok(!!tiro && /Vacío Inventado/.test(tiro.message), `sin ninguna pista, tira con el nombre («${tiro?.message}»)`);
});

decir('\n4. «Ya lo escuché» con el api.js REAL y fetch doblado');
const red = { llamadas: [], postStatus: 201, albumes: 'bien' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opc = {}) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  const metodo = String(opc.method || 'GET').toUpperCase();
  red.llamadas.push({ metodo, ruta, cuerpo: opc.body ? JSON.parse(opc.body) : null });
  if (ruta === '/me') return json({ id: 't129-cuenta-inventada', display_name: 'Inventado' });
  if (/^\/playlists\/[^/]+\/items$/.test(ruta) && metodo === 'POST') {
    return red.postStatus === 201 ? json({ snapshot_id: 'snapshot-inventado' }, 201) : json({ error: { status: 403, message: 'Forbidden inventado' } }, 403);
  }
  if (/^\/albums\/[^/]+\/tracks$/.test(ruta)) return json({ items: [{ uri: 'spotify:track:pistaDeLaRedInventadaxx' }], next: null });
  if (ruta === '/me/albums') {
    // Un 200 que no es JSON (un 500 reintenta con esperas de verdad): `getSavedAlbums()` tira igual.
    if (red.albumes === 'html') return new Response('<!doctype html><p>esto no es JSON</p>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (red.albumes === 'vacia') return json({ items: [], next: null, total: 0 });
    return json({ items: BIBLIOTECA.filter((x) => x.album), next: null, total: 7 });
  }
  return new Response('{}', { status: 599 });
};
let nCaso = 0;
const cargarApi = () => import(pathToFileURL(join(raiz, 'src/js/api.js')).href + `?caso=${++nCaso}`);
const api = await cargarApi();
const PLAYLIST = 'playlistEscuchadosInventada';
await conMAsync('un POST', async () => {
  red.llamadas.length = 0; red.postStatus = 201;
  let exito = 0;
  const pista = await M.marcarEscuchado({ id: 'bibIdGuardadaInventada', name: 'Guardada Inventada', artists: [], tracks: { items: [{ uri: 'spotify:track:pistaGuardadaInventada' }] } },
    { playlistId: PLAYLIST, anadir: api.addTracksToPlaylist, likesByKey: new Map(), claveDe: albumKey, pedirPistas: api.getAlbumTracks });
  exito++;
  const posts = red.llamadas.filter((l) => l.metodo === 'POST');
  ok(posts.length === 1, `exactamente 1 POST (${posts.length})`);
  ok(posts[0]?.ruta === `/playlists/${PLAYLIST}/items`, `a la playlist de escuchados (${posts[0]?.ruta})`);
  ok(JSON.stringify(posts[0]?.cuerpo) === JSON.stringify({ uris: ['spotify:track:pistaGuardadaInventada'] }), `con esa uri y nada más (${JSON.stringify(posts[0]?.cuerpo)})`);
  ok(red.llamadas.length === 1 && pista.fuente === 'guardada' && exito === 1, `con la pista guardada, 1 petición en total (${red.llamadas.map((l) => `${l.metodo} ${l.ruta}`).join(' , ')})`);
});
await conMAsync('fuente (c) con la red', async () => {
  red.llamadas.length = 0; red.postStatus = 201;
  const pista = await M.marcarEscuchado({ id: 'bibIdTracklistInventad', name: 'Sin Nada Inventado', artists: [] },
    { playlistId: PLAYLIST, anadir: api.addTracksToPlaylist, likesByKey: new Map(), claveDe: albumKey, pedirPistas: api.getAlbumTracks });
  const rutas = red.llamadas.map((l) => `${l.metodo} ${l.ruta}`);
  ok(pista.fuente === 'tracklist' && JSON.stringify(rutas) === JSON.stringify(['GET /albums/bibIdTracklistInventad/tracks', `POST /playlists/${PLAYLIST}/items`]), `sin me gusta ni guardada: 1 GET + 1 POST (${rutas.join(' , ')})`);
});
await conMAsync('POST en 403', async () => {
  red.llamadas.length = 0; red.postStatus = 403;
  let exito = false, error = null;
  try {
    await M.marcarEscuchado({ id: 'bibIdGuardadaInventada', name: 'Guardada Inventada', artists: [], tracks: { items: [{ uri: 'spotify:track:pistaGuardadaInventada' }] } },
      { playlistId: PLAYLIST, anadir: api.addTracksToPlaylist, likesByKey: new Map(), claveDe: albumKey, pedirPistas: api.getAlbumTracks });
    exito = true;
  } catch (e) { error = e; }
  ok(!exito && !!error, `con el POST en 403 tira y no llega al éxito («${error?.message}»)`);
  ok(red.llamadas.filter((l) => l.metodo === 'POST').length >= 1, 'el POST se intentó');
  red.postStatus = 201;
});

decir('\n5. La lectura de la biblioteca con getSavedAlbums() REAL');
const idb = () => globalThis.__IDB_OTRA;
await conMAsync('lectura', async () => {
  const indice = M.indiceDelRegistro(REGISTRO, albumKey);
  red.albumes = 'html';
  const api500 = await cargarApi();
  const r1 = await M.leerPorEscuchar({ leer: () => api500.getSavedAlbums({ force: true }), indice, claveDe: albumKey });
  ok(!!r1.fallo && !r1.lista, `/me/albums que no se puede leer: { fallo } y ninguna lista (${r1.fallo?.message})`);
  ok(M.TEXTO_FALLO_POR_ESCUCHAR === 'No se ha podido leer tu biblioteca de Spotify.', 'el texto del fallo');
  ok(!/\b0\b/.test(M.TEXTO_FALLO_POR_ESCUCHAR), 'el texto del fallo no dice «0»');
  red.albumes = 'vacia';
  const r2 = await M.leerPorEscuchar({ leer: () => api500.getSavedAlbums({ force: true }), indice, claveDe: albumKey });
  ok(Array.isArray(r2.lista) && r2.lista.length === 0 && !r2.fallo, 'biblioteca vacía de verdad: { lista: [] }, no un fallo');
  ok(M.cabeceraPorEscuchar(0) === 'No te queda ningún álbum de tu biblioteca por marcar.', 'con 0, el texto de nada');
  red.albumes = 'bien';
  const r3 = await M.leerPorEscuchar({ leer: () => api500.getSavedAlbums({ force: true }), indice, claveDe: albumKey });
  ok(r3.lista?.length === 3, `biblioteca sana: los 3 pendientes (${r3.lista?.length})`);
  ok(M.cabeceraPorEscuchar(3) === '3 álbumes de tu biblioteca que todavía no has marcado como escuchados.', `con 3 («${M.cabeceraPorEscuchar(3)}»)`);
  ok(M.cabeceraPorEscuchar(1) === '1 álbum de tu biblioteca que todavía no has marcado como escuchado.', 'con 1, en singular');
  const r4 = await M.leerPorEscuchar({ leer: async () => [{ added_at: 'x', album: null }], indice, claveDe: albumKey });
  ok(!!r4.fallo, 'elementos sin ningún album.id: es un fallo, no una lista vacía');
  const r5 = await M.leerPorEscuchar({ leer: async () => null, indice, claveDe: albumKey });
  ok(!!r5.fallo, 'algo que no es una lista: un fallo');
});

decir('\n6. listened.js (lectura estática)');
{
  let src = '';
  try { src = readFileSync(join(raiz, 'src/js/features/listened.js'), 'utf8'); } catch { /* queda vacío */ }
  ok(/from '\.\.\/util\/registro-escuchados\.js'/.test(src), 'listened.js importa la regla de util/registro-escuchados.js');
  ok(!/registeredKeys|registeredIds|registeredUris/.test(sacarFuncionSegura(src, 'computeUnregistered')), 'computeUnregistered() ya no arma su propio índice (la copia vieja del cruce no quedó)');
  ok(src.includes('📚 Por escuchar'), 'el botón «📚 Por escuchar» está en la vista');
  ok(!/Por escuchar \(\$\{/.test(src), 'el botón no lleva número (no pide la biblioteca al abrir la vista)');
  ok(!/createPlaylist|POST \/me\/playlists/.test(src), 'ninguna playlist nueva');
}
function sacarFuncionSegura(src, n) { try { return sacarFuncion(src, n); } catch { return 'registeredKeys'; } }

fin();
