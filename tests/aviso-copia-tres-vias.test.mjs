// tests/aviso-copia-tres-vias.test.mjs — el aviso «venían de tu copia» mira las TRES vías de subida (tanda 82, v=338)
//
// `reconciliar()` (`util/hidden-sync.js`) sube a la playlist `[...perdidas, ...porSubir, ...recuperadas]`, pero hasta
// v=337 el aviso de la copia («he subido a tu playlist de Spotify N ocultos que venían de tu copia», la incidencia
// `desde-copia` y la salida de la marca `ocultos_desde_copia_v1`) miraba solo `perdidas`. Una clave de la copia puede
// entrar por las otras dos:
//   · `porSubir`: un almacén cuya clave ES el id de la pista (`#skips`, `#zeroplays`, `#sin-clasificar`) y una clave de
//     la copia que llega sin su par en `<lsKey>_uris`: la uri se deduce de la clave y, como no estaba en `uriByKey` al
//     empezar el `sync()`, no es una «perdida». También el caso E1b de la otra pestaña (tanda 82, la unión): lo que trae
//     la copia mientras un `sync()` baja la playlist entra por acá;
//   · `recuperadas`: un almacén de álbum o de artista y una clave de la copia sin uri, que `recoverUri` encuentra.
// Las dos subían a la cuenta en silencio (un `console.info` y nada más). Desde v=338 `deLaCopia` sale de las tres.
//
//   T1  id de pista, en la marca, sin par en `_uris`, que la playlist no tiene → POST, aviso, `desde-copia`, fuera de la marca
//   T2  álbum, en la marca, sin uri, recuperada por búsqueda → lo mismo
//   T3  de conservación: una de la marca que entra por `perdidas` (como en v=335) → lo mismo que siempre
//   T4  de conservación: una de `porSubir` FUERA de la marca (ocultada en esta sesión) → sube, sin aviso, como siempre
//   T5  las tres vías juntas en un `sync()`, más una de cada vía fuera de la marca → un aviso con el número de la marca
//
// 🔴 LO QUE NO PUEDE CAMBIAR: lo que se escribe en Spotify. Cada caso afirma sus escrituras (método, ruta y cuerpo, en
// orden) contra constantes MEDIDAS con esta suite contra v=337 (`b8e48f9b`, `OCULTOS_MODULO=<su hidden-sync.js>`):
// contra v=337 esos asserts pasan y fallan solo los del aviso, la incidencia y la marca (el rojo).
//
// Corre sin navegador, sin token y sin pegarle a Spotify: el doble de siempre (`dobles/loader.mjs`). Todo INVENTADO.

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

console.info = () => {};   // un `console.info` por sync: taparía los asserts

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

const UID = 'usuario-de-prueba-t82';
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

const MARCA = 'ocultos_desde_copia_v1';
const tid = (s) => (s + 'x'.repeat(22)).slice(0, 22);
const uri = (id) => `spotify:track:${id}`;
const pista = (id) => ({ id, uri: uri(id), name: id, artists: [{ name: 'X' }], album: { name: 'A' } });
const A = tid('t82A'), X = tid('t82X'), Y = tid('t82Y'), Z = tid('t82Z'), W = tid('t82W'), Q = tid('t82Q'), R = tid('t82R');

// Dos almacenes: uno de id de pista (como `#skips`) y uno de álbum (como `#discover`), cada uno con su playlist.
const PISTA = { ls: 'test_t82_pistas', pl: 'pl-t82-pistas', nombre: 'fonoteca · ocultos (t82 pistas)', label: 'pistas' };
const ALBUM = { ls: 'test_t82_albumes', pl: 'pl-t82-albumes', nombre: 'fonoteca · ocultos (t82 álbumes)', label: 'álbumes' };
// La clave de álbum es `alb|<id de una pista suya>`: así la uri recuperada reconstruye la MISMA clave (la regla de
// `hidden-recover.js`: un candidato vale solo si su clave recalculada coincide).
const alb = (id) => `alb|${id}`;

/**
 * `local`: las claves de este navegador. `uris`: las que tienen su par en `<lsKey>_uris`. `marca`: las de la marca de la
 * copia para ESTE almacén (undefined = no hay marca). `items`: lo que ya tiene la playlist (ids de pista).
 */
function montar(alm, { items = [A], local = [], uris = {}, marca } = {}) {
  globalThis.localStorage = fakeLocalStorage({
    fonoteca_last_user_id: UID,
    [P(alm.ls)]: JSON.stringify(local),
    ...(Object.keys(uris).length ? { [P(`${alm.ls}_uris`)]: JSON.stringify(uris) } : {}),
    [P(`fonoteca_hidden_pl_${alm.ls}`)]: alm.pl,
    ...(marca !== undefined ? { [P(MARCA)]: JSON.stringify({ [alm.ls]: marca }) } : {}),
  });
  globalThis.__DOBLE = {
    me: UID,
    playlists: [{ id: alm.pl, name: alm.nombre, owner: UID, items: items.map(pista) }],
    añadidas: [], quitadas: [], creadas: [], llamadas: [], toasts: [], paginas: [],
    pistaDeUri: u => pista(u.split(':').pop()),
  };
}
const busquedas = [];
const crear = (alm) => (alm === PISTA
  ? createHiddenStore({ lsKey: alm.ls, playlistName: alm.nombre, label: alm.label, keyOfTrack: t => t?.id || null, uriFromKey: (k) => (/^[A-Za-z0-9]{22}$/.test(k) ? uri(k) : null) })
  : createHiddenStore({
    lsKey: alm.ls, playlistName: alm.nombre, label: alm.label,
    keyOfTrack: t => (t?.id ? alb(t.id) : null),
    // Sin `uriFromKey`: la clave de álbum no es un id de pista. `recoverUri` es la búsqueda (doblada: encuentra siempre).
    recoverUri: async (k) => { busquedas.push(k); return { uri: uri(k.split('|')[1]) }; },
  }));
const d = () => globalThis.__DOBLE;
const escrituras = () => [
  ...d().creadas.map(n => ({ metodo: 'POST', ruta: '/me/playlists', cuerpo: { name: n } })),
  ...d().añadidas.map(a => ({ metodo: 'POST', ruta: `/playlists/${a.id}/items`, cuerpo: { uris: a.uris } })),
  ...d().quitadas.map(q => ({ metodo: 'DELETE', ruta: `/playlists/${q.id}/items`, cuerpo: { items: q.uris.map(u => ({ uri: u })) } })),
];
const incidencias = () => JSON.parse(globalThis.localStorage.getItem(P('ocultos_incidencias_v1')) || '[]');
const deTipo = (tipo) => incidencias().filter(i => i.tipo === tipo).map(i => i.claves);
const marca = () => JSON.parse(globalThis.localStorage.getItem(P(MARCA)) || 'null');
const toasts = () => d().toasts.map(t => `${t.type}: ${t.message}`);
const POST = (alm, ...ids) => ({ metodo: 'POST', ruta: `/playlists/${alm.pl}/items`, cuerpo: { uris: ids.map(uri) } });
const COPIA = (alm, n) => n === 1
  ? `info: «${alm.label}»: he subido a tu playlist de Spotify un oculto que venía de tu copia.`
  : `info: «${alm.label}»: he subido a tu playlist de Spotify ${n} ocultos que venían de tu copia.`;

// 🔴 Las escrituras de v=337 (`b8e48f9b`) con estos mismos escenarios, medidas con esta suite (ver el reporte de la 82).
const ESCRITURAS_V337 = {
  T1: [POST(PISTA, Y)],
  T2: [POST(ALBUM, Y)],
  T3: [POST(PISTA, X)],
  T4: [POST(PISTA, Z)],
  T5p: [POST(PISTA, X, W, Y, Z)],
  T5a: [POST(ALBUM, X, W, Y, Z, Q, R)],
};

// ── T1 · id de pista, sin par en `_uris`: entra por `porSubir` ──────────────

console.log('\nT1 · almacén de id de pista: Y está en la marca, sin su par en `_uris`, y la playlist no la tiene');
montar(PISTA, { local: [A, Y], marca: [Y] });
await crear(PISTA).ready();
eq(escrituras(), ESCRITURAS_V337.T1, '🔴 las escrituras, las de v=337: UN POST con la uri de Y');
eq(toasts(), [COPIA(PISTA, 1)], '🔴 UN aviso «…un oculto que venía de tu copia» (v=337: ninguno)');
eq(deTipo('desde-copia'), [[Y]], '🔴 UNA incidencia `desde-copia` con Y (v=337: ninguna)');
eq(marca(), null, '🔴 Y sale de la marca (v=337: se quedaba)');
eq(deTipo('resubida'), [], 'y ninguna `resubida`');

// ── T2 · álbum sin uri, recuperada por búsqueda: entra por `recuperadas` ────

console.log('\nT2 · almacén de álbum: alb|Y está en la marca, sin uri, y la búsqueda la recupera');
busquedas.length = 0;
montar(ALBUM, { local: [alb(A), alb(Y)], marca: [alb(Y)] });
await crear(ALBUM).ready();
eq(busquedas, [alb(Y)], 'la búsqueda corrió una vez, para alb|Y');
eq(escrituras(), ESCRITURAS_V337.T2, '🔴 las escrituras, las de v=337: UN POST con la uri recuperada');
eq(toasts(), [COPIA(ALBUM, 1)], '🔴 UN aviso «…un oculto que venía de tu copia» (v=337: ninguno)');
eq(deTipo('desde-copia'), [[alb(Y)]], '🔴 UNA incidencia `desde-copia` con alb|Y (v=337: ninguna)');
eq(marca(), null, '🔴 alb|Y sale de la marca (v=337: se quedaba)');
eq(deTipo('recuperada'), [[alb(Y)]], 'y la `recuperada` de siempre');

// ── T3 · conservación: una de la marca que entra por `perdidas` ─────────────

console.log('\nT3 · X en la marca, con su uri en `_uris` (como la deja el import): entra por `perdidas`, como en v=335');
montar(PISTA, { local: [A, X], uris: { [X]: uri(X) }, marca: [X] });
await crear(PISTA).ready();
eq(escrituras(), ESCRITURAS_V337.T3, '🔴 las escrituras, las de v=337');
eq(toasts(), [COPIA(PISTA, 1)], 'el aviso de la copia, como siempre');
eq(deTipo('desde-copia'), [[X]], '`desde-copia` con X, como siempre');
eq(deTipo('resubida'), [], 'ninguna `resubida`');
eq(marca(), null, 'X sale de la marca, como siempre');

// ── T4 · conservación: `porSubir` fuera de la marca ─────────────────────────

console.log('\nT4 · Z, ocultada en esta sesión (sin su par en `_uris`), sin marca: sube sin aviso, como siempre');
montar(PISTA, { local: [A, Z] });
await crear(PISTA).ready();
eq(escrituras(), ESCRITURAS_V337.T4, '🔴 las escrituras, las de v=337');
eq(toasts(), [], 'ningún aviso');
eq(incidencias(), [], 'ninguna incidencia');
eq(marca(), null, 'ni marca');

// ── T5 · las tres vías en el mismo sync(), con y sin marca ──────────────────

console.log('\nT5 · las tres vías juntas: en la marca X (perdida), Y (porSubir) y alb|Y (recuperada); fuera, W, Z, alb|Q');
// Pistas: X perdida (con uri) y en la marca; W perdida de verdad (con uri, fuera de la marca); Y porSubir en la marca; Z
// porSubir fuera de la marca.
montar(PISTA, { local: [A, X, W, Y, Z], uris: { [X]: uri(X), [W]: uri(W) }, marca: [X, Y] });
await crear(PISTA).ready();
eq(escrituras(), ESCRITURAS_V337.T5p, '🔴 pistas: las escrituras, las de v=337 (UN POST, mismo orden: perdidas, porSubir)');
eq(toasts(), [
  'warning: «pistas»: un oculto había desaparecido de la playlist. Lo he vuelto a subir.',
  COPIA(PISTA, 2),
], 'pistas: «había desaparecido» para W (antes, como siempre) y «2 … venían de tu copia» para X e Y (v=337: 1)');
eq(deTipo('desde-copia'), [[X, Y]], 'pistas: `desde-copia` con X e Y, en el orden de `subir`');
eq(deTipo('resubida'), [[W]], 'pistas: `resubida` con W, como siempre');
eq(marca(), null, 'pistas: X e Y salen de la marca');

// Álbumes: alb|X perdida en la marca; alb|W perdida fuera; alb|Y porSubir no puede (sin `uriFromKey`), así que las de
// álbum sin uri van a `recuperadas`: alb|Y y alb|Q en la marca, alb|Z y alb|R fuera.
busquedas.length = 0;
montar(ALBUM, {
  local: [alb(A), alb(X), alb(W), alb(Y), alb(Z), alb(Q), alb(R)],
  uris: { [alb(X)]: uri(X), [alb(W)]: uri(W) },
  marca: [alb(X), alb(Y), alb(Q)],
});
await crear(ALBUM).ready();
eq(escrituras(), ESCRITURAS_V337.T5a, '🔴 álbumes: las escrituras, las de v=337 (UN POST, mismo orden: perdidas, recuperadas)');
eq(toasts(), [
  'warning: «álbumes»: un oculto había desaparecido de la playlist. Lo he vuelto a subir.',
  COPIA(ALBUM, 3),
], 'álbumes: «había desaparecido» para alb|W y «3 … venían de tu copia» (v=337: 1)');
eq(deTipo('desde-copia'), [[alb(X), alb(Y), alb(Q)]], 'álbumes: `desde-copia` con las tres de la marca, en el orden de `subir`');
eq(marca(), null, 'álbumes: las tres salen de la marca');

// ── La lectura estática: `subir` no cambió ──────────────────────────────────

console.log('\n· la línea de `subir`, intacta');
{
  const { readFileSync } = await import('node:fs');
  const fuente = readFileSync(new URL(MODULO, import.meta.url), 'utf8');
  const veces = (re) => (fuente.match(re) || []).length;
  ok(veces(/const subir = \[\.\.\.perdidas, \.\.\.porSubir, \.\.\.recuperadas\];/g) === 1
    && veces(/if \(subir\.length\) await pushMissing\(subir\);/g) === 1
    && veces(/\bsubir = /g) === 1,
    '`const subir = [...perdidas, ...porSubir, ...recuperadas];` una vez, con su `pushMissing`, y nadie más la reasigna');
}

const total = pasaron + fallos.length;
if (fallos.length) { console.log(`\naviso-copia-tres-vias: ${fallos.length} de ${total} asserts FALLARON`); process.exit(1); }
console.log(`\naviso-copia-tres-vias: ${total} asserts OK`);
