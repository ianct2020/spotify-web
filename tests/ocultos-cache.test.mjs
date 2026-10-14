// tests/ocultos-cache.test.mjs — la playlist de ocultos se baja solo cuando
// cambió su snapshot (v=299, tanda 47)
//
// Hasta v=298 `sync()` de `util/hidden-sync.js` bajaba la playlist espejo ENTERA
// en cada carga de página (`useCache: false`): 9 páginas con los 900 ocultos de
// descubrir aunque no hubiera cambiado nada. Desde v=299 se guarda en
// `ocultos_items_v1_<playlistId>` y se reusa si el snapshot de la respuesta
// FRESCA del `GET /playlists/{id}` coincide y no pasaron 24 h. El riesgo de un
// caché acá no se ve en pantalla: se ve como pistas DUPLICADAS en la cuenta real
// (una clave local que falta en lo bajado se lee como «la playlist la perdió» y
// se vuelve a subir). Cada caso de abajo es una forma de que el caché mienta.
//
// Cada caso son DOS cargas de página: dos almacenes nuevos que comparten el
// localStorage de mentira y el doble de IndexedDB (`dobles/idb-ocultos-doble.mjs`,
// que guarda su estado dentro de `__DOBLE`). Se afirma mirando las peticiones del
// doble de la API (`llamadas`, `paginas`, `añadidas`, `quitadas`) y las escrituras
// del doble de IndexedDB, nunca un `console`.
//
// El doble de la API (`dobles/api-doble.mjs`) tiene que poder mentir como la
// Spotify de verdad: el snapshot es un CONTADOR de escrituras (no `'s' + largo`),
// puede ir RETRASADO, las páginas se cuentan, y la playlist se puede tocar sin
// pasar por la app (`escrituraAjena`, la otra compu).
//
// `OCULTOS_MODULO=<ruta>` corre la suite contra OTRO `hidden-sync.js` (la de
// v=298, para la tabla del C7) y `SOLO=C7` corre solo ese caso.
//
// Corre sin navegador, sin token y sin pegarle a Spotify.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

function fakeLocalStorage(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
  };
}

const UID = 'usuario-de-prueba-t47';
const P = b => `${b}__${UID}`;
globalThis.localStorage = fakeLocalStorage({ fonoteca_last_user_id: UID });

register('./dobles/loader.mjs', pathToFileURL(import.meta.filename));
const MODULO = process.env.OCULTOS_MODULO || '../src/js/util/hidden-sync.js';
const { createHiddenStore } = await import(MODULO);
const { escrituraAjena } = await import('./dobles/api-doble.mjs');
const SOLO = process.env.SOLO || null;
const toca = (c) => !SOLO || SOLO === c;

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
function eq(a, b, nombre) {
  const bien = JSON.stringify(a) === JSON.stringify(b);
  if (!bien) console.log(`      esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
  ok(bien, nombre);
}

// ── Andamiaje ───────────────────────────────────────────────────────────────

const PL = 'pl-ocultos-t47';
const LS = 'test_ocultos_cache';
const NOMBRE = 'fonoteca · ocultos (test)';
const CLAVE_CACHE = `ocultos_items_v1_${PL}`;
const CLAVE_ID = P(`fonoteca_hidden_pl_${LS}`);

// Ids de pista de 22 caracteres, como los de Spotify: la clave ES el id y la uri
// se deduce (`uriDeTrackId`), igual que en #skips / #zeroplays / #sin-clasificar.
const tid = (s) => (s + 'x'.repeat(22)).slice(0, 22);
const pista = (id) => ({ id, uri: `spotify:track:${id}`, name: id, artists: [{ name: 'X' }], album: { name: 'A' } });
const A = tid('A'), W = tid('W'), X = tid('X'), Y = tid('Y'), Z = tid('Z'), K = tid('K');

function montar({ items = [A], local = null, idGuardado = PL } = {}) {
  globalThis.localStorage = fakeLocalStorage({
    fonoteca_last_user_id: UID,
    ...(local ? { [P(LS)]: JSON.stringify(local) } : {}),
    ...(idGuardado ? { [CLAVE_ID]: idGuardado } : {}),
  });
  globalThis.__DOBLE = {
    me: UID,
    playlists: [{ id: PL, name: NOMBRE, owner: UID, items: items.map(pista) }],
    añadidas: [], quitadas: [], creadas: [], llamadas: [], toasts: [], paginas: [],
    pistaDeUri: uri => pista(uri.split(':').pop()),
  };
}

// Una carga de página nueva: un almacén nuevo. Lo que comparte con la anterior
// es lo que comparte de verdad, el localStorage y la IndexedDB.
function cargar() {
  const { uriDeTrackId } = { uriDeTrackId: (k) => (/^[A-Za-z0-9]{22}$/.test(k) ? `spotify:track:${k}` : null) };
  return createHiddenStore({ lsKey: LS, playlistName: NOMBRE, label: 'test', keyOfTrack: t => t?.id || null, uriFromKey: uriDeTrackId });
}

/** Pone a cero los contadores del doble: lo que se cuente después es de ESTA carga. */
function contadores() {
  const d = globalThis.__DOBLE;
  d.llamadas = []; d.paginas = []; d.añadidas = []; d.quitadas = []; d.idbEscrituras = []; d.idbBorrados = [];
}
const d = () => globalThis.__DOBLE;
const locales = () => JSON.parse(globalThis.localStorage.getItem(P(LS)) || '[]');
const incidencias = () => JSON.parse(globalThis.localStorage.getItem(P('ocultos_incidencias_v1')) || '[]');
const getsDePlaylist = () => d().llamadas.filter(p => p.startsWith(`/playlists/${PL}?`));
const posts = () => d().añadidas.length;
const enCache = () => d().idb?.has(CLAVE_CACHE) ?? false;
const esperarQue = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 1)); };

// ── C1 · caliente ───────────────────────────────────────────────────────────

if (toca('C1')) {
  console.log('\nC1 · caliente: la segunda carga sin cambios no baja nada');
  const novecientos = Array.from({ length: 900 }, (_, i) => tid('o' + i));
  montar({ items: novecientos });
  await cargar().ready();
  eq(d().paginas.length, 9, 'la primera carga baja 9 páginas (900 ocultos)');
  ok(enCache(), 'y deja guardada la lista, con el snapshot de la respuesta fresca');
  eq(locales().length, 900, 'los 900 quedan en las claves locales');
  contadores();
  await cargar().ready();
  eq(d().paginas.length, 0, 'la segunda carga: 0 páginas de /items');
  eq(getsDePlaylist().length, 1, '1 GET /playlists/{id} (el de findPlaylist)');
  eq(d().llamadas.length, 1, 'y ninguna otra petición');
  eq(posts() + d().quitadas.length, 0, '0 escrituras');
}

// ── C2 · otro dispositivo oculta ────────────────────────────────────────────

if (toca('C2')) {
  console.log('\nC2 · otro dispositivo oculta Y: el snapshot cambia y se baja');
  montar({ items: [A] });
  await cargar().ready();
  escrituraAjena(PL, pl => pl.items.push(pista(Y)));
  contadores();
  await cargar().ready();
  ok(locales().includes(Y), 'Y está en las claves locales al terminar la segunda carga');
  eq(d().paginas.length, 1, 'porque bajó la lista (1 página)');
  eq(posts(), 0, 'y no subió nada');
}

// ── C2b · otro dispositivo oculta y devuelve a la vez (mismo tamaño) ────────

if (toca('C2b')) {
  console.log('\nC2b · otro dispositivo cambia W por Y: misma cantidad de pistas, otro contenido');
  montar({ items: [A, W] });
  await cargar().ready();
  escrituraAjena(PL, pl => { pl.items = pl.items.filter(t => t.id !== W); pl.items.push(pista(Y)); });
  contadores();
  await cargar().ready();
  ok(locales().includes(Y), 'Y está en las claves locales (con un snapshot por largo, este caso daría rojo)');
}

// ── C3 · nuestra escritura con el snapshot retrasado ────────────────────────

if (toca('C3')) {
  console.log('\nC3 · ocultamos Z y en la carga siguiente Spotify todavía da el snapshot de antes');
  montar({ items: [A] });
  const s1 = cargar();
  await s1.ready();
  d().retraso = 3;   // las 3 lecturas siguientes a la escritura dan el snapshot ANTERIOR
  s1.toggle(Z, `spotify:track:${Z}`);
  await esperarQue(() => posts() === 1);
  eq(posts(), 1, 'el ocultamiento hizo su POST');
  contadores();
  const incAntes = incidencias().filter(i => i.tipo === 'resubida').length;
  await cargar().ready();
  eq(posts(), 0, '0 POST en la carga siguiente (no re-sube Z)');
  eq(incidencias().filter(i => i.tipo === 'resubida').length - incAntes, 0, '0 incidencias «resubida»');
  ok(locales().includes(Z), 'Z sigue oculta');
}

// ── C4 · la base vieja ──────────────────────────────────────────────────────

if (toca('C4')) {
  console.log('\nC4 · caché {A}, la otra compu agrega Y, nosotros ocultamos Z: Y no se pierde');
  montar({ items: [A] });
  const s1 = cargar();
  await s1.ready();
  escrituraAjena(PL, pl => pl.items.push(pista(Y)));
  s1.toggle(Z, `spotify:track:${Z}`);
  await esperarQue(() => posts() === 1);
  contadores();
  await cargar().ready();
  ok(locales().includes(Y), 'Y está en las claves locales (parchear el caché con el snapshot del POST la perdería)');
  ok(locales().includes(Z), 'y Z también');
}

// ── C5 · el vencimiento ─────────────────────────────────────────────────────

if (toca('C5')) {
  console.log('\nC5 · mismo snapshot, pero el caché se guardó hace 25 h');
  montar({ items: [A] });
  await cargar().ready();
  ok(enCache(), 'hay caché');
  d().idb.get(CLAVE_CACHE).guardadoEn = Date.now() - 25 * 60 * 60 * 1000;
  contadores();
  await cargar().ready();
  eq(d().paginas.length, 1, 'baja la lista entera aunque el snapshot coincida');
}

// ── C6 · encontrada por nombre ──────────────────────────────────────────────

if (toca('C6')) {
  console.log('\nC6 · sin id guardado: se encuentra por nombre, y el snapshot de la lista de playlists no vale');
  montar({ items: [A] });
  await cargar().ready();
  const snapViejo = d().idb.get(CLAVE_CACHE)?.snapshot;
  ok(!!snapViejo, `hay caché con snapshot (${snapViejo})`);
  globalThis.localStorage.removeItem(CLAVE_ID);
  escrituraAjena(PL, pl => pl.items.push(pista(Y)));
  // La lista de `/me/playlists` (hasta 24 h en localStorage) trae el snapshot de AYER.
  d().listadoSnapshot = { [PL]: snapViejo };
  contadores();
  await cargar().ready();
  eq(d().paginas.length, 1, 'baja la lista entera');
  ok(locales().includes(Y), 've el cambio (Y está en las claves locales)');
  eq(d().idbEscrituras.filter(k => k === CLAVE_CACHE).length, 0, 'y NO escribe el caché');
}

// ── C7 · devolver en otro dispositivo: igual que v=298 ──────────────────────
//
// La otra compu saca X. Este navegador la tiene en local con su uri y la vuelve
// a subir (`perdidas`): es consecuencia de la unión, pasa desde siempre y NO se
// arregla en esta tanda. Lo que se afirma es que con el caché pasa EXACTAMENTE lo
// mismo que en v=298: mismas peticiones, en el mismo orden (los `fields` del GET
// se comparan sin el query, que en v=299 suma `snapshot_id`).
//
// La lista de v=298 se midió corriendo este mismo caso contra el `hidden-sync.js`
// de HEAD (`OCULTOS_MODULO=… SOLO=C7`) el 13/10, antes del cambio.
const C7_V298 = [
  'GET /playlists/pl-ocultos-t47',
  'GET /playlists/pl-ocultos-t47/items (1 página)',
  'POST /playlists/pl-ocultos-t47/items [spotify:track:Xxxxxxxxxxxxxxxxxxxxxx]',
];

if (toca('C7')) {
  console.log('\nC7 · la otra compu devuelve X: se re-sube, igual que en v=298');
  montar({ items: [A, X] });
  await cargar().ready();
  escrituraAjena(PL, pl => { pl.items = pl.items.filter(t => t.id !== X); });
  contadores();
  // El orden real: el GET y las páginas salen antes del POST.
  const orden = [];
  const llam = d().llamadas, pag = d().paginas, añ = d().añadidas;
  d().llamadas = new Proxy(llam, { get(o, k) { if (k === 'push') return (p) => { orden.push(`GET ${p.split('?')[0]}`); return o.push(p); }; return o[k]; } });
  d().paginas = new Proxy(pag, { get(o, k) { if (k === 'push') return (p) => { if (p.offset === 0) orden.push(`GET /playlists/${p.id}/items (página)`); return o.push(p); }; return o[k]; } });
  d().añadidas = new Proxy(añ, { get(o, k) { if (k === 'push') return (p) => { orden.push(`POST /playlists/${p.id}/items [${p.uris.join(',')}]`); return o.push(p); }; return o[k]; } });
  await cargar().ready();
  const lista = orden.map(s => s.replace('(página)', `(${pag.length} página${pag.length === 1 ? '' : 's'})`));
  console.log('      peticiones de la segunda carga:\n        ' + lista.join('\n        '));
  if (!process.env.OCULTOS_MODULO) eq(lista, C7_V298, 'las mismas peticiones que v=298');
  ok(locales().includes(X), 'X sigue oculta en este navegador (y se re-subió: no se arregla acá)');
}

// ── C8 · las cuatro escrituras borran el caché, también cuando tiran ────────

async function conCache(items = [A]) {
  montar({ items });
  const s = cargar();
  await s.ready();
  if (!enCache()) throw new Error('el andamiaje no dejó caché');
  return s;
}

if (toca('C8')) {
  console.log('\nC8 · cada escritura borra ocultos_items_v1_<id>, también cuando la escritura tira');
  for (const falla of [false, true]) {
    const sufijo = falla ? ' (la escritura TIRA)' : '';

    // pushMissing: una clave local que nunca subió, con uri deducible.
    await conCache();
    globalThis.localStorage.setItem(P(LS), JSON.stringify([...locales(), K]));
    if (falla) d().fallarAdd = 'Spotify 500: algo';
    await cargar().ready();
    ok(!enCache(), `pushMissing${sufijo}: la clave no existe`);

    // fijarVarios
    let s = await conCache();
    if (falla) d().fallarAdd = 'Spotify 500: algo';
    const r = await s.fijarVarios([{ key: Z, uri: `spotify:track:${Z}` }], true);
    ok(falla ? r.fallidas.length === 1 : r.hechas.length === 1, `fijarVarios${sufijo}: la escritura ${falla ? 'falló' : 'se hizo'}`);
    ok(!enCache(), `fijarVarios${sufijo}: la clave no existe`);

    // toggle
    s = await conCache();
    if (falla) d().fallarAdd = 'Spotify 500: algo';
    s.toggle(Z, `spotify:track:${Z}`);
    await esperarQue(() => (falla ? d().toasts.length > 0 : posts() === 1));
    ok(falla ? d().toasts.length > 0 : posts() === 1, `toggle${sufijo}: la escritura ${falla ? 'falló' : 'se hizo'}`);
    ok(!enCache(), `toggle${sufijo}: la clave no existe`);

    // clear
    s = await conCache([A, W]);
    if (falla) d().fallarRemove = 'Spotify 500: algo';
    await s.clear();
    ok(falla ? d().quitadas.length === 0 : d().quitadas.length === 1, `clear${sufijo}: la escritura ${falla ? 'falló' : 'se hizo'}`);
    ok(!enCache(), `clear${sufijo}: la clave no existe`);
  }
}

// ── C9 · una escritura que ya estaba EN VUELO cuando empezó el sync() ───────
//
// (v=300, tanda 48) El contador de la 47 veía las escrituras que EMPIEZAN
// mientras `sync()` baja. Esta empezó ANTES (su `antesDeEscribir()` ya borró el
// caché) y su POST llega a Spotify MIENTRAS otra instancia baja la lista. Esa
// otra instancia leyó su lista local antes del ocultamiento (otra pestaña, o un
// almacén que ya la tenía en memoria): para ella Z no existe.
// La carga siguiente, con el snapshot todavía retrasado, no puede creerle a un
// caché `{ snapshot viejo, items sin Z }`.

if (toca('C9')) {
  console.log('\nC9 · toggle(Z) con el POST colgado; otro sync() baja mientras el POST llega');
  montar({ items: [A] });
  await cargar().ready();
  ok(enCache(), 'hay caché de la carga anterior');
  const sA = cargar();              // la instancia que oculta
  const sB = cargar();              // otra instancia, que sincroniza
  eq(sB.size, 1, 'la otra instancia ya leyó su lista local (sin Z)');
  let soltar;
  d().retenerAdd = new Promise(r => { soltar = r; });
  d().retraso = 3;                  // las lecturas siguientes al POST dan el snapshot de ANTES
  sA.toggle(Z, `spotify:track:${Z}`);
  await esperarQue(() => d().addEnVuelo === 1);
  ok(d().addEnVuelo === 1 && !enCache(), 'el POST de Z está colgado y su antesDeEscribir() ya borró el caché');
  const snapAntes = d().llamadas.length;
  d().durantePaginas = async () => {
    ok(d().llamadas.length > snapAntes, 'el sync() ya leyó el snapshot cuando se suelta el POST');
    soltar();
    await esperarQue(() => posts() === 1);
  };
  await sB.ready();
  d().durantePaginas = null; d().retenerAdd = null;
  eq(posts(), 1, 'el POST de Z llegó a Spotify durante la bajada');
  contadores();
  const incAntes = incidencias().filter(i => i.tipo === 'resubida').length;
  await cargar().ready();
  eq(posts(), 0, '0 POST en la carga siguiente');
  eq(incidencias().filter(i => i.tipo === 'resubida').length - incAntes, 0, '0 incidencias «resubida»');
  ok(locales().includes(Z), 'Z sigue oculta');
}

// ── C10 · el propio sync() re-sube algo ─────────────────────────────────────
//
// Durante el `sync()`, `reconciliar()` sube una clave que estaba solo en local
// (`pushMissing`). Esa escritura es suya y movió el snapshot: lo que bajó antes
// de subir no puede quedar como caché.

if (toca('C10')) {
  console.log('\nC10 · el sync() sube K (pushMissing): ese sync() no deja caché');
  montar({ items: [A], local: [A, K] });
  d().retraso = 3;
  await cargar().ready();
  eq(posts(), 1, 'el sync() subió K');
  ok(!enCache(), 'y no quedó caché de la lista de antes de subir');
  contadores();
  const incAntes = incidencias().filter(i => i.tipo === 'resubida').length;
  await cargar().ready();
  eq(posts(), 0, '0 POST en la carga siguiente (con el snapshot retrasado)');
  eq(incidencias().filter(i => i.tipo === 'resubida').length - incAntes, 0, '0 incidencias «resubida»');
  ok(locales().includes(K), 'K sigue oculta');
}

// ── Lectura estática ────────────────────────────────────────────────────────

if (!SOLO && !process.env.OCULTOS_MODULO) {
  console.log('\nLectura estática de hidden-sync.js');
  const fuente = readFileSync(new URL('../src/js/util/hidden-sync.js', import.meta.url), 'utf8');
  const codigo = fuente.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const auditar = codigo.slice(codigo.indexOf('async function auditar()'), codigo.indexOf('REGISTRO.push('));
  ok(auditar.length > 100, 'encuentra el cuerpo de auditar()');
  ok(/getAllPlaylistItems\(p\.id, null, \{ useCache: false \}\)/.test(auditar), 'auditar() sigue llamando a getAllPlaylistItems(…, { useCache: false })');
  ok(!/ocultos_items|ITEMS_CACHE|leerItemsGuardados|guardarItems|borrarItemsGuardados/.test(auditar), 'auditar() no nombra el caché nuevo');
  // El único `snapshot_id` que se lee es el de la respuesta del GET por id.
  const lecturas = [...codigo.matchAll(/\.snapshot_id\b/g)];
  eq(lecturas.length, 1, 'se lee `.snapshot_id` en un solo sitio');
  const enRamaDelId = codigo.slice(codigo.indexOf('if (guardado) {'), codigo.indexOf('await getAllUserPlaylists('));
  ok(/p\.snapshot_id/.test(enRamaDelId), 'y es la respuesta del GET /playlists/{id guardado}, antes de getAllUserPlaylists');
  ok(!/snapshotFresco\s*:/.test(codigo.slice(codigo.indexOf('await getAllUserPlaylists('), codigo.indexOf('async function ensurePlaylist'))),
    'el camino por nombre no pone ningún snapshot');
  ok(!/updatePlaylistItemsCache/.test(fuente), 'updatePlaylistItemsCache no aparece en hidden-sync.js');
  ok(!/playlist_items_/.test(fuente), '`playlist_items_` no aparece en hidden-sync.js');
  // «Limpiar caché» tiene que borrar el prefijo nuevo.
  const limpiar = readFileSync(new URL('../src/js/util/limpiar-cache.js', import.meta.url), 'utf8');
  ok(!/ocultos_items/.test(limpiar), 'limpiar-cache.js no conserva ocultos_items_* (perderlo cuesta una bajada)');
}

console.log(`\n${pasaron} asserts OK, ${fallaron} fallos`);
if (fallaron) process.exit(1);
