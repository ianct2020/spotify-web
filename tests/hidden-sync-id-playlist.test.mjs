// tests/hidden-sync-id-playlist.test.mjs — «no existe» contra «no pude
// preguntar» en `findPlaylist()` (v=287)
//
// EL FALLO QUE PROTEGE ESTE ARCHIVO, en una línea: hasta v=286 `findPlaylist()`
// de `util/hidden-sync.js` tenía UN SOLO `catch` para todos los fallos del
// `GET /playlists/{guardado}` y el `olvidarId(lsKey)` colgaba FUERA del `try`,
// así que **un corte de red borraba el id guardado de la playlist espejo** —
// medido sin querer el 08/10: con el driver cortando `api.spotify.com`, abrir
// `#skips` y `#zeroplays` se llevó los dos `fonoteca_hidden_pl_*` de una copia
// del perfil—. Y perder el id no es solo perder un atajo: sin él la playlist se
// rebusca POR NOMBRE, y si por nombre no aparece —lista del caché de 24 h, o
// playlist renombrada a mano en Spotify, donde el id era el único vínculo—
// `findPlaylist()` devolvía `null`, que es la señal que autoriza a crear. El
// final del camino es una playlist espejo DUPLICADA en la cuenta REAL de Ian,
// con los ocultos repartidos entre las dos y la mitad invisible desde la app.
//
// Los tres casos que pide el contrato son los tres de abajo: respuesta buena,
// 404 de verdad, y fallo sin respuesta (red cortada o 5xx agotado). La frontera
// es `err.status`, que `api.js` pone solo cuando hubo una RESPUESTA HTTP.
//
// ⚠️ Los dos casos de «la duplicada» están escritos para que FALLEN contra el
// módulo de v=286: comprobado corriendo esta suite con `git stash`.
//
// Corre sin navegador, sin token y sin pegarle a Spotify.

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
    _dump: () => Object.fromEntries(m),
  };
}

const UID = 'orhs6wu5ykk7ql80u92ujn74o';
const P = b => `${b}__${UID}`;

globalThis.localStorage = fakeLocalStorage({ fonoteca_last_user_id: UID });

register('./dobles/loader.mjs', pathToFileURL(import.meta.filename));
const { createHiddenStore } = await import('../src/js/util/hidden-sync.js');

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

const PL = 'pl-ocultos';
const OTRA = 'pl-ocultos-otra';
const LS = 'test_ocultas';
const NOMBRE = 'fonoteca · ocultos (test)';
const CLAVE = '3wPPWcVuinAU7dXcJXtCID';   // el id real de «La La La»

const CLAVE_ID = P(`fonoteca_hidden_pl_${LS}`);

function pistaDeTrackId(id) {
  return { id, uri: `spotify:track:${id}`, name: id, artists: [{ name: 'X' }], album: { name: 'A' } };
}

/**
 * @param {object} o
 * @param {string|null} o.idGuardado    qué hay en `fonoteca_hidden_pl_*`
 * @param {string[]}    o.local         claves en el caché local del navegador
 * @param {object[]}    o.playlists     las playlists que existen en la cuenta
 * @param {string}      o.fallarPlaylist  fallo SIN respuesta del `GET /playlists/{id}`
 * @param {string[]}    o.listadoOculta   ids que existen pero NO salen en `/me/playlists`
 */
function montar({ idGuardado = PL, local = [], playlists, fallarPlaylist = null,
                  fallarListado = null, listadoOculta = [] } = {}) {
  globalThis.localStorage = fakeLocalStorage({
    fonoteca_last_user_id: UID,
    [P(LS)]: JSON.stringify(local),
    [P(`${LS}_uris`)]: JSON.stringify(Object.fromEntries(local.map(k => [k, `spotify:track:${k}`]))),
    ...(idGuardado ? { [CLAVE_ID]: idGuardado } : {}),
  });
  globalThis.__DOBLE = {
    me: UID,
    playlists: playlists ?? [{ id: PL, name: NOMBRE, owner: UID, items: [] }],
    fallarPlaylist, fallarListado, listadoOculta,
    añadidas: [], quitadas: [], creadas: [], llamadas: [], toasts: [],
    pistaDeUri: uri => pistaDeTrackId(uri.split(':').pop()),
  };
}

function store() {
  return createHiddenStore({
    lsKey: LS, playlistName: NOMBRE, label: 'test',
    keyOfTrack: t => t?.id || null,
  });
}

const idEnDisco = () => globalThis.localStorage.getItem(CLAVE_ID);
const creadas = () => globalThis.__DOBLE.creadas;
const llamadas = () => globalThis.__DOBLE.llamadas;

/**
 * La foto de `#debug` → «Salud de los ocultos», que es por donde se mira esto.
 * Va por el `auditar()` del store y NO por `auditarOcultos()`: el registro
 * global es acumulativo, así que ahí saldrían también los stores de los casos
 * anteriores, cada uno con su estado viejo.
 */
async function fila(s = store()) { return s.auditar(); }

// Los dos fallos SIN respuesta HTTP, con el texto que arma `api.js`.
const RED_CORTADA = 'No se pudo conectar con Spotify (Failed to fetch). Revisa tu conexión y vuelve a intentarlo.';
const CINCO_XX = 'Spotify 503: el servicio no responde después de 5 reintentos. Prueba de nuevo en un rato.';

// ── 1. Respuesta buena: el camino de todos los días ─────────────────────────

console.log('\n1. Respuesta buena — la playlist guardada contesta y es tuya');
{
  montar({ local: [CLAVE], playlists: [{ id: PL, name: NOMBRE, owner: UID, items: [pistaDeTrackId(CLAVE)] }] });
  const f = await fila();

  eq(f.playlistId, PL, 'la encuentra por el id guardado');
  eq(f.error, null, 'sin error');
  eq(idEnDisco(), PL, 'y el id sigue en disco');
  eq(creadas(), [], 'no crea ninguna playlist');
  ok(!llamadas().some(p => p.startsWith('/search')), 'y no sale a buscar nada por nombre');
}

// ── 2. 404 de verdad: eso SÍ es una confirmación ────────────────────────────

console.log('\n2. 404 de verdad — la playlist guardada ya no existe');
{
  // El id guardado apunta a algo que no está, y con ESE nombre existe otra
  // (Ian la volvió a crear a mano). Un 404 es una respuesta: el id se tira y se
  // adopta la que sí está.
  montar({ idGuardado: 'pl-que-ya-no-esta', local: [CLAVE],
           playlists: [{ id: OTRA, name: NOMBRE, owner: UID, items: [] }] });
  const f = await fila();

  eq(f.playlistId, OTRA, 'tras el 404 la rebusca por nombre y la encuentra');
  eq(idEnDisco(), OTRA, 'y el id guardado se ACTUALIZA al de la que existe');
  eq(creadas(), [], 'no crea ninguna: la confirmación no implica crear');
}

console.log('\n2b. 404 y por nombre tampoco está — acá sí se crea, y es correcto');
{
  // La única combinación que autoriza a crear: Spotify contestó que el id no
  // existe Y la lista de playlists —leída de verdad— no tiene ninguna con ese
  // nombre. Las dos mitades son confirmaciones.
  montar({ idGuardado: 'pl-que-ya-no-esta', local: [CLAVE], playlists: [] });
  const s = store();
  await s.ready();

  eq(creadas(), [NOMBRE], 'crea UNA, porque la ausencia está confirmada por los dos lados');
  eq(idEnDisco(), 'nueva-0', 'y guarda el id de la nueva');
  ok(s.has(CLAVE), 'el oculto no se pierde en el camino');
}

// ── 3. Fallo SIN respuesta: ni se borra el id, ni se crea nada ──────────────
//
// Es el caso medido el 08/10 y el que da el bug entero. Las dos mitades:
// el `GET /playlists/{id}` no contesta Y la playlist no sale en el listado
// (caché de 24 h que todavía no la vio, o renombrada a mano en Spotify).

console.log('\n3. Red cortada + la playlist fuera del listado — EL CAMINO A LA DUPLICADA');
{
  montar({ local: [CLAVE], fallarPlaylist: RED_CORTADA, listadoOculta: [PL] });
  const s = store();
  await s.ready();   // `ready()` nunca tira: la vista sigue con el caché local

  eq(creadas(), [], '🔴 NO crea una playlist espejo duplicada');
  eq(idEnDisco(), PL, '🔴 y NO borra el id guardado');
  ok(s.has(CLAVE), 'el oculto sigue en el caché local');
  eq(globalThis.__DOBLE.añadidas, [], 'y no escribe nada en Spotify');
}

console.log('\n3b. 5xx agotado — mismo veredicto: un 5xx tampoco dice que no exista');
{
  montar({ local: [CLAVE], fallarPlaylist: CINCO_XX, listadoOculta: [PL] });
  const s = store();
  await s.ready();

  eq(creadas(), [], 'no crea nada');
  eq(idEnDisco(), PL, 'el id guardado sobrevive al 5xx');
}

console.log('\n3c. La foto de #debug dice que no se pudo preguntar, en vez de inventar');
{
  montar({ local: [CLAVE], fallarPlaylist: RED_CORTADA, listadoOculta: [PL] });
  const f = await fila();

  ok(f.error != null, 'la fila trae error: el panel no muestra un 0 que parezca un dato');
  ok(/no puedo confirmar/.test(f.error || ''), `y dice qué pasó — «${f.error}»`);
  eq(f.playlistId, PL, 'y sigue enseñando el id guardado, que no se tocó');
  eq(idEnDisco(), PL, 'auditar() no tiene efectos: el id queda igual');
}

console.log('\n3d. Red cortada pero la playlist SÍ sale en el listado — se usa y ya');
{
  // Acá no hace falta ninguna heroicidad: el listado es una respuesta, y dice
  // que la playlist existe y es tuya.
  montar({ local: [CLAVE], fallarPlaylist: RED_CORTADA });
  const f = await fila();

  eq(f.playlistId, PL, 'la encuentra por nombre');
  eq(f.error, null, 'sin error: hubo confirmación por el otro lado');
  eq(creadas(), [], 'y no crea nada');
}

console.log('\n3e. Sin comprobar el guardado, un id DISTINTO no lo pisa');
{
  // El listado trae una con el mismo nombre pero otro id, y el guardado quedó
  // sin comprobar. Se usa la encontrada para esta sesión, pero el puntero en
  // disco no se reescribe apoyado en un «no contestó»: si el guardado era el
  // bueno y hay dos homónimas, pisarlo muda el almacén de playlist.
  montar({ local: [CLAVE], fallarPlaylist: RED_CORTADA,
           playlists: [{ id: OTRA, name: NOMBRE, owner: UID, items: [] }] });
  const f = await fila();

  eq(f.playlistId, OTRA, 'usa la que encontró');
  eq(idEnDisco(), PL, 'pero el id guardado NO se pisa');
}

// ── 4. El 403 no es una confirmación ───────────────────────────────────────

console.log('\n4. 403 — post-migración significa «endpoint retirado», no «no existe»');
{
  // La mitad de las rutas viejas de la API contestan 403 desde febrero de 2026
  // (ver las «Decisiones de API» de CLAUDE.md). Leerlo como «la playlist no
  // existe» es exactamente el error que esto viene a evitar.
  montar({ local: [CLAVE], listadoOculta: [PL],
           fallarPlaylist: { msg: 'Spotify 403: Forbidden', status: 403 } });
  const s = store();
  await s.ready();

  eq(creadas(), [], 'un 403 no autoriza a crear nada');
  eq(idEnDisco(), PL, 'ni a borrar el id guardado');
}

// ── 5. Ocultar con la red cortada: se reporta, no se inventa ───────────────

console.log('\n5. Ocultar algo con la red cortada — falla DICHO, sin crear nada');
{
  montar({ local: [], fallarPlaylist: RED_CORTADA, listadoOculta: [PL] });
  const s = store();
  const r = await s.fijarVarios([{ key: CLAVE, uri: `spotify:track:${CLAVE}` }], true);

  eq(creadas(), [], 'no crea una playlist para poder escribir');
  eq(idEnDisco(), PL, 'el id guardado sigue donde estaba');
  eq(r.hechas, [], 'nada se da por hecho');
  eq(r.fallidas.length, 1, 'y la clave sale en `fallidas`');
  ok(/no puedo confirmar|no he podido abrir/.test(r.fallidas[0]?.motivo || ''),
     `con el motivo a la vista — «${r.fallidas[0]?.motivo}»`);
}

// ── 6. Sin id guardado: el camino de la primera vez, intacto ───────────────

console.log('\n6. Sin id guardado — la busca por nombre y la adopta');
{
  montar({ idGuardado: null, local: [CLAVE] });
  const f = await fila();

  eq(f.playlistId, PL, 'la encuentra por nombre');
  eq(idEnDisco(), PL, 'y la guarda, que es lo que abarata la sesión siguiente');
  eq(creadas(), [], 'sin crear nada');
}

console.log(`\n${pasaron} asserts OK, ${fallaron} fallos`);
process.exit(fallaron > 0 ? 1 : 0);
