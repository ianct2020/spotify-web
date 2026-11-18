// tests/biblioteca-por-id.test.mjs — «Fuera los de tu biblioteca» cruza también por el id del álbum (v=370, tanda 133)
//
// POR QUÉ ESTA SUITE EXISTE: hasta v=369 `buildFilterContext()` (`util/discover-filters.js`) guardaba de cada álbum de la biblioteca
// solo `albumKey(nombre, artista principal)` y tiraba el `alb.id`; `motivosDeDescarte()` cruzaba el lanzamiento solo por esa clave.
// Un lanzamiento guardado con OTRO nombre («X - Single») o con OTRO artista principal no caía: la cuenta del chip daba 0 (la tanda
// 127 lo reprodujo contra la Spotify simulada). Desde v=370 el contexto lleva además `idsEnBiblioteca` (los `alb.id`, armados en el
// mismo bucle y con la misma regla de fallo), y C2 descarta por «biblioteca» si la clave está en `guardados` O si el `al.id` existe y
// está en ese conjunto. El cruce por nombre se quedó tal cual; ninguna otra regla cambió.
//
// Lo que mira, con álbumes y artistas INVENTADOS (el repo es público):
//   (a) el mismo id con otro nombre cae por «biblioteca»;      (b) el mismo id con otro artista principal, también;
//   (c) mismo nombre y artista con otro id (otra edición) cae como antes, por la clave;
//   (d) lo que no está ni por nombre ni por id no cae;         (e) un item de la biblioteca sin `album.id` cruza por nombre, sin tirar;
//   (f) un lanzamiento sin `id` cruza solo por nombre, sin tirar;
//   (g) la biblioteca que falla: `bibliotecaFallo: true`, el conjunto nuevo vacío y el contexto sin memoizar (lo de v=364);
//   (h) el movimiento de «edicion» a «biblioteca» de un lanzamiento guardado con su mismo id y un agregado en el nombre;
//   (i) 🔴 CONSERVACIÓN: sobre 36 lanzamientos inventados con biblioteca, escuchados, me gusta, «sin escuchar» y artistas mezclados,
//       `motivosDeDescarte` da los MISMOS motivos que el de fd3f085 (sacado con `git show` y cargado en este mismo proceso) para cada
//       lanzamiento que no está en la biblioteca por id.
//
// `api.js` y `discover-filters.js` REALES en Node, con `dobles/loader-t127.mjs` (el de la tanda 127, sin tocar). `RAIZ_T133=<carpeta>`
// corre la suite contra otra copia del repo (p. ej. fd3f085, para verla en rojo). El fuente viejo de la conservación sale siempre de
// `git show fd3f085:…` sobre el repo de este archivo.

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

register('./dobles/loader-t127.mjs', pathToFileURL(import.meta.filename));

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const raiz = process.env.RAIZ_T133 || repo;
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

// ── Los datos (INVENTADOS) ──────────────────────────────────────────────────────────────────────
const BANDA = { id: 'bandaInventadaT133xxxxx', name: 'Banda inventada T133' };
const OTRA = { id: 'otraBandaInventadaT133x', name: 'Otra banda inventada T133' };
const guardado = (album) => ({ added_at: '2026-01-01T00:00:00Z', album: { album_type: 'album', total_tracks: 10, images: [], ...album } });
const BIBLIOTECA = [
  guardado({ id: 'idSingleT133', name: 'Disco Uno - Single', artists: [BANDA] }),        // (a) guardado con otro nombre
  guardado({ id: 'idOtroArtT133', name: 'Disco Dos', artists: [OTRA] }),                 // (b) guardado con otro artista principal
  guardado({ id: 'idTresGuardadoT133', name: 'Disco Tres', artists: [BANDA] }),          // (c) y (f): la otra edición, por nombre
  guardado({ name: 'Disco Cinco', artists: [BANDA] }),                                   // (e) sin `album.id`
  guardado({ id: 'idDeluxeT133', name: 'Disco Seis Deluxe', artists: [BANDA] }),         // (h) el mismo id, con «Deluxe» pegado
];
const rel = (id, name, total = 10) => ({ ...(id ? { id } : {}), name, type: 'album', total, artists: [{ id: BANDA.id, name: BANDA.name }] });

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
const red = { modo: 'bien', biblioteca: BIBLIOTECA, pedidas: 0 };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  if (ruta === '/me') return json({ id: 't133-cuenta-inventada', display_name: 'Inventado' });
  if (ruta === '/me/tracks') return json({ items: [], total: 0, next: null });
  if (ruta === '/me/playlists') return json({ items: [], total: 0, next: null });
  if (ruta === '/me/albums') {
    red.pedidas++;
    if (red.modo === 'html') return new Response('<!doctype html><title>inventado</title>', { status: 200, headers: { 'content-type': 'text/html' } });
    return json({ items: red.biblioteca, limit: 50, offset: 0, total: red.biblioteca.length, next: null });
  }
  return new Response('{}', { status: 599 });
};

const idb = () => globalThis.__IDB_OTRA;
let nCaso = 0;
const cargarFiltros = () => import(pathToFileURL(join(raiz, 'src/js/util/discover-filters.js')).href + `?caso=${++nCaso}`);
function escenario({ modo = 'bien', biblioteca = BIBLIOTECA } = {}) {
  globalThis.__IDB_OTRA = { kv: new Map(), lecturas: [], intentos: [], borrados: [], escrituras: [], fallanBorrar: new Set(), demoraBorrar: 0 };
  lsMapa.clear();
  lsMapa.set('sp_access_token', 'tok-inventado-t133');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
  lsMapa.set('fonoteca_last_user_id', 't133-cuenta-inventada');
  Object.assign(red, { modo, biblioteca, pedidas: 0 });
  avisos.length = 0;
}
const sinTirar = (f) => { try { return { valor: f() }; } catch (e) { return { error: e }; } };
const motivos = (F, al, ctx) => sinTirar(() => F.motivosDeDescarte(al, BANDA.name, BANDA.id, ctx));
const txt = (r) => (r.error ? `tiró «${r.error.message}»` : JSON.stringify(r.valor));

// ── El módulo de fd3f085 (v=369), en este mismo proceso ─────────────────────────────────────────
// Sus imports relativos se reescriben a rutas absolutas del repo y se carga como `data:`: así no deja ningún archivo y pasa por el
// mismo loader (los mismos dobles y el MISMO `api.js` que el módulo de hoy).
let viejo = null;
try {
  const fuente = execFileSync('git', ['-C', repo, 'show', 'fd3f085:src/js/util/discover-filters.js'], { encoding: 'utf8' });
  const dir = join(repo, 'src/js/util');
  const absoluto = fuente.replace(/from '(\.{1,2}\/[^']+)'/g, (m, p) => `from '${pathToFileURL(resolve(dir, p)).href}'`);
  viejo = await import('data:text/javascript;base64,' + Buffer.from(absoluto).toString('base64'));
} catch (e) { decir(`  (no se pudo cargar el módulo de fd3f085: ${e.message})`); }
ok(!!viejo?.motivosDeDescarte, 'el módulo de fd3f085 se cargó (git show) para comparar');

// ── 1. El contexto con la biblioteca buena ──────────────────────────────────────────────────────
decir('· buildFilterContext() con la biblioteca inventada');
escenario();
const F = await cargarFiltros();
let ctx = null;
{
  let r;
  try { r = { valor: await F.buildFilterContext() }; } catch (e) { r = { error: e }; }
  ok(!r.error, `no tira (${r.error?.message})`);
  ctx = r.valor || {};
  ok(ctx.bibliotecaFallo === false, `bibliotecaFallo: false (${ctx.bibliotecaFallo})`);
  ok(ctx.idsEnBiblioteca instanceof Set, 'el contexto lleva idsEnBiblioteca, un Set');
  ok(ctx.idsEnBiblioteca?.size === 4 && ['idSingleT133', 'idOtroArtT133', 'idTresGuardadoT133', 'idDeluxeT133'].every((id) => ctx.idsEnBiblioteca.has(id)),
    `idsEnBiblioteca tiene los 4 ids de la biblioteca, y el item sin id no suma nada (${[...(ctx.idsEnBiblioteca || [])].join(', ')})`);
  ok(ctx.guardados?.size === 5, `el cruce por nombre se quedó: 5 claves en guardados, también la del item sin id (${ctx.guardados?.size})`);
  ok(red.pedidas === 1, `pidió /me/albums una vez, como antes (${red.pedidas})`);
  idb().kv.delete('saved_albums_v2');
  let r2;
  try { r2 = await F.buildFilterContext(); } catch { r2 = null; }
  ok(r2 === ctx && red.pedidas === 1, `y se memoiza como antes: la segunda llamada es el mismo contexto y no pide (${red.pedidas})`);
}

// ── 2. Los casos (a) a (f) y (h) ────────────────────────────────────────────────────────────────
decir('· los casos');
const caso = (letra, al, debe, noDebe = []) => {
  const r = motivos(F, al, ctx);
  ok(!r.error && debe.every((m) => r.valor.includes(m)) && noDebe.every((m) => !r.valor.includes(m)),
    `(${letra}) «${al.name}»${al.id ? '' : ' sin id'}: ${txt(r)}${debe.length ? ` (tiene que traer ${debe.join(', ')})` : ''}${noDebe.length ? ` (no puede traer ${noDebe.join(', ')})` : ''}`);
  return r;
};
caso('a', rel('idSingleT133', 'Disco Uno'), ['biblioteca']);
caso('b', rel('idOtroArtT133', 'Disco Dos'), ['biblioteca']);
caso('c', rel('idOtraEdicionT133', 'Disco Tres'), ['biblioteca']);
{
  const r = caso('d', rel('idNuevoT133', 'Disco Cuatro'), [], ['biblioteca']);
  ok(!r.error && r.valor.length === 0, `(d) y no cae por nada (${txt(r)})`);
}
caso('e', rel('idCincoLanzT133', 'Disco Cinco'), ['biblioteca']);
caso('f', rel(null, 'Disco Tres'), ['biblioteca']);
{
  const r = caso('f', rel(null, 'Disco Ocho'), [], ['biblioteca']);
  ok(!r.error && r.valor.length === 0, `(f) un lanzamiento sin id que no está por nombre no cae por nada (${txt(r)})`);
}
{
  const r = motivos(F, rel('idCincoLanzT133', 'Disco Cinco'), { ...ctx, idsEnBiblioteca: undefined });
  ok(!r.error && r.valor.includes('biblioteca'), `un contexto sin el conjunto (armado a mano) no tira y cruza por nombre (${txt(r)})`);
}
{
  const al = rel('idDeluxeT133', 'Disco Seis');
  const hoy = caso('h', al, ['biblioteca'], ['edicion']);
  const antes = viejo ? motivos(viejo, al, ctx) : { error: new Error('sin módulo viejo') };
  ok(!antes.error && antes.valor.includes('edicion') && !antes.valor.includes('biblioteca'),
    `(h) con fd3f085 el mismo lanzamiento caía por «edicion», no por «biblioteca» (${txt(antes)}): se mueve de un contador al otro (hoy ${txt(hoy)})`);
  const otro = caso('h', rel('idSieteT133', 'Disco Seis'), ['edicion'], ['biblioteca']);
  ok(!otro.error, '(h) con OTRO id, el mismo nombre sigue cayendo por «edicion», como antes');
}

// ── 3. (g) La biblioteca que falla ──────────────────────────────────────────────────────────────
decir('· (g) la biblioteca que falla');
escenario({ modo: 'html' });
{
  const G = await cargarFiltros();
  let r1, r2;
  try { r1 = await G.buildFilterContext(); } catch (e) { r1 = { tiro: e.message }; }
  ok(r1?.bibliotecaFallo === true, `bibliotecaFallo: true (${r1?.bibliotecaFallo ?? r1?.tiro})`);
  ok(r1?.idsEnBiblioteca instanceof Set && r1.idsEnBiblioteca.size === 0, `idsEnBiblioteca vacío (${r1?.idsEnBiblioteca?.size})`);
  ok(r1?.guardados?.size === 0, 'guardados vacío, como antes');
  ok(avisos.some((a) => a.startsWith('[discover-filtros] no pude leer tu biblioteca')), 'el console.warn de siempre');
  try { r2 = await G.buildFilterContext(); } catch { r2 = null; }
  ok(red.pedidas === 2 && r2 !== r1 && r2?.bibliotecaFallo === true, `no se memoiza: la segunda llamada vuelve a pedir (${red.pedidas})`);
  const r = motivos(G, rel('idSingleT133', 'Disco Uno'), r1);
  ok(!r.error && !r.valor.includes('biblioteca'), `con la lectura caída no descarta nada por «biblioteca» (${txt(r)})`);
}

// ── 4. (i) Conservación contra fd3f085 ──────────────────────────────────────────────────────────
decir('· (i) conservación contra fd3f085');
{
  const { albumKey } = await import(pathToFileURL(join(repo, 'src/js/util/album-key.js')).href);
  const { songKey } = await import(pathToFileURL(join(repo, 'src/js/util/song-identity.js')).href);
  const cola = ['', ' Deluxe', ' (Live)', ' - Single', ' (Remix)', ' 10th Anniversary Edition'];
  const lanz = [];
  for (let n = 1; n <= 36; n++) {
    const base = `Lanzamiento inventado ${n}`;
    lanz.push({
      ...(n % 9 === 0 ? {} : { id: `relT133n${n}` }),
      name: base + cola[n % 6],
      type: n % 4 === 0 ? 'single' : 'album',
      total: n % 4 === 0 ? 1 : n % 4 === 1 ? 3 : 10,
      artists: [n % 7 === 0 ? { id: 'otroIdInventadoT133xxx', name: BANDA.name } : { id: BANDA.id, name: BANDA.name }],
    });
  }
  const base = (n) => `Lanzamiento inventado ${n}`;
  const mano = {
    guardados: new Set(), escuchados: new Set(), basesTuyas: new Set(), temaEnAlbum: new Map(), enSinEscuchar: new Set(),
    bibliotecaFallo: false, idsEnBiblioteca: new Set(['idQueNoEsDeNingunoT133']),
  };
  for (let n = 1; n <= 36; n++) {
    if (n % 5 === 0) mano.guardados.add(albumKey(lanz[n - 1].name, BANDA.name));
    if (n % 3 === 0) mano.escuchados.add(albumKey(lanz[n - 1].name, BANDA.name));
    if (n % 6 === 1) mano.basesTuyas.add(F.claveBaseDeEdicion(base(n), BANDA.name));                          // los «… Deluxe»: edicion
    if (n % 2 === 1 || n % 6 === 4) mano.temaEnAlbum.set(songKey(base(n), BANDA.name), 'Álbum inventado');  // los «(Remix)» cortos: single
    if (n % 11 === 0) mano.enSinEscuchar.add(albumKey(lanz[n - 1].name, BANDA.name));
    if (n % 8 === 0) mano.idsEnBiblioteca.add(`relT133n${n}`);
  }
  let iguales = 0, comparados = 0, porId = 0, porIdConBiblioteca = 0;
  const distintos = [];
  const tipos = new Set();
  for (const al of lanz) {
    const hoy = motivos(F, al, mano), antes = viejo ? motivos(viejo, al, mano) : { error: new Error('sin módulo viejo') };
    if (!antes.error) antes.valor.forEach((m) => tipos.add(m));
    if (al.id && mano.idsEnBiblioteca.has(al.id)) {
      porId++;
      if (!hoy.error && hoy.valor.includes('biblioteca')) porIdConBiblioteca++;
      continue;
    }
    comparados++;
    if (!hoy.error && !antes.error && JSON.stringify(hoy.valor) === JSON.stringify(antes.valor)) iguales++;
    else distintos.push(`${al.name}: hoy ${txt(hoy)} · fd3f085 ${txt(antes)}`);
  }
  ok(comparados >= 30, `se comparan ${comparados} lanzamientos que no están en la biblioteca por id (al menos 30)`);
  ok(iguales === comparados, `los mismos motivos que fd3f085 en ${iguales} de ${comparados}${distintos.length ? ` — distintos: ${distintos.join(' | ')}` : ''}`);
  ok(['artista', 'biblioteca', 'listened', 'edicion', 'vivo', 'single', 'sinescuchar'].every((m) => tipos.has(m)),
    `los datos ejercitan todos los criterios de motivosDeDescarte (${[...tipos].join(', ')})`);
  ok(porId === 4 && porIdConBiblioteca === 4, `y los ${porId} que sí están por id caen por «biblioteca» (${porIdConBiblioteca})`);
}

fin();
