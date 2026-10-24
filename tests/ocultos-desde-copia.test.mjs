// tests/ocultos-desde-copia.test.mjs — los ocultos que llegan con «Importar todo» no son «la playlist los perdió»
// (tanda 80, v=335)
//
// Las claves que agrega el import traen su uri (`<lsKey>_uris`), así que el `sync()` siguiente las ve como
// «estuvieron en la playlist y ya no están» (`perdidas`): hasta v=334 decía «N ocultos habían desaparecido de la
// playlist. Los he vuelto a subir.» (toast amarillo) y anotaba `resubida`. Lo que SUBE estaba bien; lo que DECÍA, no:
// nunca habían estado. Desde v=335 `aplicarPlan` deja una marca, `ocultos_desde_copia_v1` (`{ <lsKey>: [claves] }`,
// con `prefKey`), y `sync()` las avisa aparte: «he subido a tu playlist de Spotify N ocultos que venían de tu copia»
// (`'info'`) y `tipo: 'desde-copia'`.
//
// 🔴 LO QUE NO PUEDE CAMBIAR: lo que se escribe en Spotify. Cada caso de abajo afirma la lista de escrituras (método,
// ruta y cuerpo) contra la que dio v=334 con el MISMO escenario, escrita acá como constante (`ESCRITURAS_V334`). Corrida
// contra v=334 (`OCULTOS_MODULO=<la hidden-sync.js de v=334>`), esas afirmaciones pasan y las de los avisos fallan: ese es
// el rojo. Los casos C1-C10 de `ocultos-cache.test.mjs` se compararon v=334 contra v=335 aparte (ver el reporte).
//
//   S1  3 claves importadas, con uri, que la playlist no tiene, y en la marca → «venían de tu copia» + `desde-copia`
//   S2  una pérdida de verdad (sin marca) → su toast amarillo y `resubida`, como siempre
//   S3  las dos cosas en el mismo `sync()` → dos avisos, cada uno con su número
//   S4  `pushMissing` que tira → la marca queda; el `sync()` siguiente que sube la saca
//   S5  marca corrupta (no JSON / un valor que no es lista) → lo mismo que v=334 y la marca no se toca
//   S6  la marca se poda: una clave que ya está en la playlist, o que ya no está oculta, sale de la marca
//   S7  una sola: el singular
//   P   las funciones puras de `util/ocultos-desde-copia.js` (la marca que deja el import)
//
// Corre sin navegador, sin token y sin pegarle a Spotify (el doble de `ocultos-cache.test.mjs`).

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

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

const UID = 'usuario-de-prueba-t80';
const P = b => `${b}__${UID}`;
globalThis.localStorage = fakeLocalStorage({ fonoteca_last_user_id: UID });

register('./dobles/loader.mjs', pathToFileURL(import.meta.filename));
const MODULO = process.env.OCULTOS_MODULO || '../src/js/util/hidden-sync.js';
const { createHiddenStore } = await import(MODULO);

const fallos = [];
let pasaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallos.push(nombre); console.log(`  ✗ ${nombre}`); }
}
function eq(a, b, nombre) {
  const bien = JSON.stringify(a) === JSON.stringify(b);
  if (!bien) console.log(`      esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
  ok(bien, nombre);
}

// ── Andamiaje ───────────────────────────────────────────────────────────────

const PL = 'pl-ocultos-t80';
const LS = 'test_ocultos_copia';
const NOMBRE = 'fonoteca · ocultos (test)';
const MARCA = 'ocultos_desde_copia_v1';
const tid = (s) => (s + 'x'.repeat(22)).slice(0, 22);
const uri = (id) => `spotify:track:${id}`;
const pista = (id) => ({ id, uri: uri(id), name: id, artists: [{ name: 'X' }], album: { name: 'A' } });
const A = tid('A'), W = tid('W'), X = tid('X'), Y = tid('Y'), Z = tid('Z'), K = tid('K'), Q = tid('Q');

/**
 * `local`: las claves de este navegador. `uris`: las que tienen su uri guardada (las importadas la traen; una
 * pérdida de verdad, también). `marca`: el TEXTO de la marca (undefined = no hay).
 */
function montar({ items = [A], local = [A], uris = [], marca } = {}) {
  globalThis.localStorage = fakeLocalStorage({
    fonoteca_last_user_id: UID,
    [P(LS)]: JSON.stringify(local),
    ...(uris.length ? { [P(`${LS}_uris`)]: JSON.stringify(Object.fromEntries(uris.map(k => [k, uri(k)]))) } : {}),
    [P(`fonoteca_hidden_pl_${LS}`)]: PL,
    ...(marca !== undefined ? { [P(MARCA)]: marca } : {}),
  });
  globalThis.__DOBLE = {
    me: UID,
    playlists: [{ id: PL, name: NOMBRE, owner: UID, items: items.map(pista) }],
    añadidas: [], quitadas: [], creadas: [], llamadas: [], toasts: [], paginas: [],
    pistaDeUri: u => pista(u.split(':').pop()),
  };
}
const cargar = () => createHiddenStore({ lsKey: LS, playlistName: NOMBRE, label: 'test', keyOfTrack: t => t?.id || null, uriFromKey: (k) => (/^[A-Za-z0-9]{22}$/.test(k) ? uri(k) : null) });
const d = () => globalThis.__DOBLE;
// Las escrituras en Spotify, con método, ruta y cuerpo, en orden.
const escrituras = () => [
  ...d().creadas.map(n => ({ metodo: 'POST', ruta: '/me/playlists', cuerpo: { name: n } })),
  ...d().añadidas.map(a => ({ metodo: 'POST', ruta: `/playlists/${a.id}/items`, cuerpo: { uris: a.uris } })),
  ...d().quitadas.map(q => ({ metodo: 'DELETE', ruta: `/playlists/${q.id}/items`, cuerpo: { items: q.uris.map(u => ({ uri: u })) } })),
];
const incidencias = () => JSON.parse(globalThis.localStorage.getItem(P('ocultos_incidencias_v1')) || '[]');
const marca = () => globalThis.localStorage.getItem(P(MARCA));
const toasts = () => d().toasts.map(t => `${t.type}: ${t.message}`);
const POST = (...ks) => ({ metodo: 'POST', ruta: `/playlists/${PL}/items`, cuerpo: { uris: ks.map(uri) } });

// 🔴 Las escrituras de v=334 con estos mismos escenarios (medidas con este test contra `0feaec8b`; ver el reporte).
const ESCRITURAS_V334 = {
  S1: [POST(X, Y, Z)],
  S2: [POST(X)],
  S3: [POST(X, Y, Z, W)],
  S4a: [],
  S4b: [POST(X, Y, Z)],
  S5a: [POST(X, Y)],
  S5b: [POST(X, Y)],
  S6: [POST(X)],
  S7: [POST(X)],
};

const TEXTO_COPIA = (n) => n === 1
  ? 'info: «test»: he subido a tu playlist de Spotify un oculto que venía de tu copia.'
  : `info: «test»: he subido a tu playlist de Spotify ${n} ocultos que venían de tu copia.`;
const TEXTO_PERDIDA = (n) => n === 1
  ? 'warning: «test»: un oculto había desaparecido de la playlist. Lo he vuelto a subir.'
  : `warning: «test»: ${n} ocultos habían desaparecido de la playlist. Los he vuelto a subir.`;

// ── S1 · las importadas ────────────────────────────────────────────────────

console.log('\nS1 · 3 claves importadas (con su uri, en la marca) que la playlist no tiene');
montar({ local: [A, X, Y, Z], uris: [X, Y, Z], marca: JSON.stringify({ [LS]: [X, Y, Z] }) });
await cargar().ready();
eq(escrituras(), ESCRITURAS_V334.S1, '🔴 las escrituras, las mismas que v=334: un POST con X, Y, Z a la misma playlist');
eq(toasts(), [TEXTO_COPIA(3)], 'el aviso informativo: «he subido a tu playlist de Spotify 3 ocultos que venían de tu copia»');
eq(incidencias().map(i => [i.tipo, i.claves]), [['desde-copia', [X, Y, Z]]], 'la incidencia, `desde-copia`, con sus tres claves (y ninguna `resubida`)');
eq(marca(), null, 'subidas, salen de la marca (y la marca vacía no queda)');

// ── S2 · una pérdida de verdad ──────────────────────────────────────────────

console.log('\nS2 · X estuvo en la playlist y se fue (su uri guardada, sin marca)');
montar({ local: [A, X], uris: [X] });
await cargar().ready();
eq(escrituras(), ESCRITURAS_V334.S2, '🔴 las escrituras, las mismas que v=334');
eq(toasts(), [TEXTO_PERDIDA(1)], 'su toast amarillo de siempre');
eq(incidencias().map(i => [i.tipo, i.claves]), [['resubida', [X]]], 'y `resubida`');

// ── S3 · las dos en el mismo sync() ─────────────────────────────────────────

console.log('\nS3 · X e Y vienen de la copia; Z y W se perdieron de verdad');
montar({ local: [A, X, Y, Z, W], uris: [X, Y, Z, W], marca: JSON.stringify({ [LS]: [X, Y], otro_almacen: [K] }) });
await cargar().ready();
eq(escrituras(), ESCRITURAS_V334.S3, '🔴 las escrituras, las mismas que v=334: UN POST con las cuatro, en el mismo orden');
eq(toasts(), [TEXTO_PERDIDA(2), TEXTO_COPIA(2)], 'dos avisos, cada uno con su número');
eq(incidencias().map(i => [i.tipo, i.claves]), [['desde-copia', [X, Y]], ['resubida', [Z, W]]], 'dos incidencias, cada una con sus claves');
eq(JSON.parse(marca() || 'null'), { otro_almacen: [K] }, 'la marca de OTRO almacén no se toca');

// ── S4 · pushMissing que tira ───────────────────────────────────────────────

console.log('\nS4 · el POST tira: la marca queda; el sync siguiente que sube la saca');
montar({ local: [A, X, Y, Z], uris: [X, Y, Z], marca: JSON.stringify({ [LS]: [X, Y, Z] }) });
d().fallarAdd = 'Spotify 500: algo';
await cargar().ready();
eq(escrituras(), ESCRITURAS_V334.S4a, '🔴 las escrituras, las mismas que v=334 (ninguna llegó)');
eq(JSON.parse(marca() || 'null'), { [LS]: [X, Y, Z] }, 'la marca queda entera');
ok(!toasts().some(t => t.startsWith('info:')), 'no dice «he subido» (no subió)');
ok(!incidencias().some(i => i.tipo === 'desde-copia'), 'ni anota `desde-copia`');
d().fallarAdd = null; d().toasts = [];
await cargar().ready();   // otra carga de página
eq(escrituras(), ESCRITURAS_V334.S4b, '🔴 el sync siguiente: las escrituras, las mismas que v=334');
eq(toasts(), [TEXTO_COPIA(3)], 'ahora sí: «venían de tu copia»');
eq(marca(), null, 'y salen de la marca');

// ── S5 · la marca corrupta ──────────────────────────────────────────────────

for (const [caso, texto] of [['S5a', '{esto no es json'], ['S5b', JSON.stringify({ [LS]: 'no es una lista' })]]) {
  console.log(`\n${caso} · marca corrupta (${texto}): lo mismo que v=334`);
  montar({ local: [A, X, Y], uris: [X, Y], marca: texto });
  await cargar().ready();
  eq(escrituras(), ESCRITURAS_V334[caso], '🔴 las escrituras, las mismas que v=334');
  eq(toasts(), [TEXTO_PERDIDA(2)], 'el aviso de v=334');
  eq(incidencias().map(i => i.tipo), ['resubida'], 'la incidencia de v=334');
  eq(marca(), texto, 'y la marca no se toca');
}

// ── S6 · la poda ────────────────────────────────────────────────────────────

console.log('\nS6 · en la marca: K ya está en la playlist y Q ya no está oculto; X viene de la copia');
montar({ items: [A, K], local: [A, K, X], uris: [X, K], marca: JSON.stringify({ [LS]: [K, Q, X] }) });
await cargar().ready();
eq(escrituras(), ESCRITURAS_V334.S6, '🔴 las escrituras, las mismas que v=334');
eq(toasts(), [TEXTO_COPIA(1)], 'X se avisa como de la copia');
eq(marca(), null, 'K (ya en la playlist), Q (ya no oculto) y X (subido) salen de la marca');

// ── S7 · el singular ────────────────────────────────────────────────────────

console.log('\nS7 · una sola importada');
montar({ local: [A, X], uris: [X], marca: JSON.stringify({ [LS]: [X] }) });
await cargar().ready();
eq(escrituras(), ESCRITURAS_V334.S7, '🔴 las escrituras, las mismas que v=334');
eq(toasts(), [TEXTO_COPIA(1)], 'en singular');

// ── P · las funciones puras ─────────────────────────────────────────────────

console.log('\nP · util/ocultos-desde-copia.js');
let M = null;
try { M = await import('../src/js/util/ocultos-desde-copia.js'); } catch { /* contra v=334 no existe */ }
ok(M && M.MARCA_DESDE_COPIA === MARCA, 'el módulo existe y nombra la clave `ocultos_desde_copia_v1`');
if (M) {
  eq(M.leerMarca(null), {}, 'sin marca: vacía');
  eq(M.leerMarca('{x'), null, 'no JSON: corrupta (null)');
  eq(M.leerMarca('[]'), null, 'una lista: corrupta');
  eq(M.leerMarca(JSON.stringify({ a: 'x' })), null, 'un valor que no es lista: corrupta');
  eq(M.leerMarca(JSON.stringify({ a: ['x', 3, 'y'] })), { a: ['x', 'y'] }, 'lo que no es texto dentro de una lista se ignora');
  const almacenes = ['skips_hidden_tracks', 'discover_ocultos'];
  const U = 'uid-p';
  // antes: skips prefijada con [a]; discover con la PELADA [m] (sin migrar). después: skips [a,b,c], discover prefijada [m,n].
  const antes = { [`skips_hidden_tracks__${U}`]: '["a"]', discover_ocultos: '["m"]' };
  const despues = { ...antes, [`skips_hidden_tracks__${U}`]: '["a","b","c"]', [`discover_ocultos__${U}`]: '["m","n"]' };
  const r1 = M.marcaTrasImport({ marca: {}, antes, despues, uid: U, almacenes });
  eq(r1, { marca: { skips_hidden_tracks: ['b', 'c'], discover_ocultos: ['n'] }, cambio: true }, 'marcaTrasImport: lo que la app LEERÍA después menos lo que leía antes (prefijada, si no la pelada)');
  eq(M.marcaTrasImport({ marca: { skips_hidden_tracks: ['z', 'b'] }, antes, despues, uid: U, almacenes }).marca, { skips_hidden_tracks: ['z', 'b', 'c'], discover_ocultos: ['n'] }, 'se une con la marca que había (dos imports seguidos)');
  eq(M.marcaTrasImport({ marca: {}, antes, despues: antes, uid: U, almacenes }), { marca: {}, cambio: false }, 'sin claves nuevas: no cambia');
  eq(M.marcaTrasImport({ marca: null, antes, despues, uid: U, almacenes }).marca, { skips_hidden_tracks: ['b', 'c'], discover_ocultos: ['n'] }, 'una marca corrupta se reemplaza por la nueva');
  eq(M.marcaTrasImport({ marca: {}, antes: { [`skips_hidden_tracks__${U}`]: '{roto' }, despues: { [`skips_hidden_tracks__${U}`]: '{roto' }, uid: U, almacenes }).cambio, false, 'un conjunto ilegible no agrega nada');
  eq(M.dejarEnLaMarca({ a: ['x', 'y'], b: ['z'] }, 'a', new Set(['y'])), { marca: { a: ['y'], b: ['z'] }, cambio: true }, 'dejarEnLaMarca: poda solo su almacén');
  eq(M.dejarEnLaMarca({ b: ['z'] }, 'a', new Set()), { marca: { b: ['z'] }, cambio: false }, 'sin entradas de ese almacén: nada que podar');
  eq(M.sacarDeLaMarca({ a: ['x', 'y'] }, 'a', ['x', 'y']), { marca: {}, cambio: true }, 'sacarDeLaMarca: vacío, el almacén sale');
}

const total = pasaron + fallos.length;
if (fallos.length) { console.log(`\nocultos-desde-copia: ${fallos.length} de ${total} asserts FALLARON`); process.exit(1); }
console.log(`\nocultos-desde-copia: ${total} asserts OK`);
