// tests/hidden-sync-uri.test.mjs — el hueco de `uriByKey` (v=205)
//
// EL FALLO QUE PROTEGE ESTE ARCHIVO, en una línea: hasta v=204 el mapa
// clave→uri de `util/hidden-sync.js` vivía SOLO en memoria, así que una clave
// que estaba en el caché local y no en la playlist no se podía volver a subir
// nunca —la sesión no sabía con qué uri representarla— y se quedaba en un
// `pendingNoUri` que no se guardaba, no se avisaba y no se miraba. El día que
// ese navegador perdiera sus datos, el oculto desaparecía entero.
//
// Los casos de abajo son el fallo en su forma reproducible. El que lo define es
// «sesión fría»: se construye el store DESDE CERO, con el mapa en memoria vacío
// —que es lo que pasa en cada carga de página— y se comprueba que igual puede
// reconstruir la playlist. Con el módulo de v=204 ese caso es imposible de
// pasar: no hay ningún sitio del que sacar la uri.
//
// La otra mitad es la regla dura: de la reconciliación NO sale ninguna clave
// descartada. Lo que no se puede subir se anota y se avisa, pero se queda.

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
const { createHiddenStore, uriDeTrackId, leerIncidencias } =
  await import('../src/js/util/hidden-sync.js');
const { recuperarUriDeAlbumKey, recuperarUriDeArtistaKey } =
  await import('../src/js/util/hidden-recover.js');

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
const LS = 'test_ocultas';
const NOMBRE = 'fonoteca · ocultos (test)';

// Ids de 22 caracteres, como los de verdad. El de «La La La» es el real.
const LALALA = '3wPPWcVuinAU7dXcJXtCID';
const OTRO = '1AbCdEfGhIjKlMnOpQrStU';

function pistaDeTrackId(id) {
  return { id, uri: `spotify:track:${id}`, name: id, artists: [{ name: 'X' }], album: { name: 'A' } };
}

/**
 * @param {object} o
 * @param {string[]} o.local        claves en el caché local del navegador
 * @param {object}   o.uris         mapa clave→uri ya persistido (lo que v=205 guarda)
 * @param {string[]} o.enPlaylist   claves que la playlist SÍ tiene
 */
function montar({ local = [], uris = {}, enPlaylist = [], sinPlaylist = false } = {}) {
  globalThis.localStorage = fakeLocalStorage({
    fonoteca_last_user_id: UID,
    [P(LS)]: JSON.stringify(local),
    [P(`${LS}_uris`)]: JSON.stringify(uris),
    ...(sinPlaylist ? {} : { [P(`fonoteca_hidden_pl_${LS}`)]: PL }),
  });
  globalThis.__DOBLE = {
    me: UID,
    playlists: sinPlaylist ? [] : [{ id: PL, name: NOMBRE, owner: UID, items: enPlaylist.map(pistaDeTrackId) }],
    añadidas: [], quitadas: [], creadas: [], llamadas: [], toasts: [],
    pistaDeUri: uri => pistaDeTrackId(uri.split(':').pop()),
  };
}

function store(extra = {}) {
  return createHiddenStore({
    lsKey: LS, playlistName: NOMBRE, label: 'test',
    keyOfTrack: t => t?.id || null,
    ...extra,
  });
}

const localGuardado = () => JSON.parse(globalThis.localStorage.getItem(P(LS)));
const urisGuardadas = () => JSON.parse(globalThis.localStorage.getItem(P(`${LS}_uris`)) || '{}');
const sinUriGuardado = () => JSON.parse(globalThis.localStorage.getItem(P('ocultos_sin_uri_v1')) || '{}');
const subidas = () => globalThis.__DOBLE.añadidas.flatMap(a => a.uris);

// ── 1. La uri se deduce de la clave cuando la clave ES el id ────────────────

console.log('\nuriDeTrackId()');
{
  eq(uriDeTrackId(LALALA), `spotify:track:${LALALA}`, 'un id de 22 caracteres da su uri');
  eq(uriDeTrackId('ausencia||osvaldo pugliese'), null, 'una clave de álbum NO da uri inventada');
  eq(uriDeTrackId('corta'), null, 'algo que no tiene forma de id da null');
  eq(uriDeTrackId(''), null, 'la cadena vacía da null');
  eq(uriDeTrackId(null), null, 'null da null');
}

// ── 2. EL CASO: sesión fría, la playlist perdió el oculto ───────────────────

console.log('\nSesión fría: la playlist perdió un oculto y este navegador lo tiene');
{
  // Exactamente lo de «La La La»: la clave sigue en el caché local, la playlist
  // está en 0, y NADIE toca esa pista en esta sesión (no se llama a remember).
  // El store se construye de cero, o sea con el mapa en memoria vacío.
  montar({ local: [LALALA], uris: { [LALALA]: `spotify:track:${LALALA}` }, enPlaylist: [] });
  const s = store();
  await s.ready();

  eq(subidas(), [`spotify:track:${LALALA}`], 'se vuelve a subir a la playlist sin que nadie la toque');
  ok(localGuardado().includes(LALALA), 'y sigue en el caché local');
  const inc = leerIncidencias();
  eq(inc[0]?.tipo, 'resubida', 'queda anotada como «resubida», que es el rastro que no existía');
  eq(inc[0]?.claves, [LALALA], 'con la clave, no con un número');
  ok(globalThis.__DOBLE.toasts.some(t => t.type === 'warning'), 'y avisa por pantalla, no solo por consola');
}

console.log('\nSesión fría sin nada persistido, pero la clave ES el id');
{
  // Para #skips / #zero-plays / #sin-clasificar ni siquiera hace falta el mapa:
  // la uri sale de la clave. Antes de v=205 esto tampoco se intentaba.
  montar({ local: [LALALA], uris: {}, enPlaylist: [] });
  const s = store({ uriFromKey: uriDeTrackId });
  await s.ready();
  eq(subidas(), [`spotify:track:${LALALA}`], 'se sube deduciendo la uri de la propia clave');
  eq(sinUriGuardado(), {}, 'y no queda ninguna pendiente');
}

// ── 3. La regla dura: lo que no se puede subir NO se descarta ───────────────

console.log('\nLo que no se puede representar se avisa y se queda');
{
  const CLAVE = 'ausencia||osvaldo pugliese';
  montar({ local: [CLAVE], uris: {}, enPlaylist: [] });
  const s = store({ keyOfTrack: t => t?.album?.name || null });
  await s.ready();

  eq(subidas(), [], 'no se sube nada, porque no hay con qué');
  ok(localGuardado().includes(CLAVE), 'NO se descarta del caché local');
  ok(`${LS}::${CLAVE}` in sinUriGuardado(), 'queda anotada en ocultos_sin_uri_v1, entre sesiones');
  const inc = leerIncidencias();
  eq(inc[0]?.tipo, 'sin-uri', 'y como incidencia «sin-uri»');
  ok(globalThis.__DOBLE.toasts.some(t => t.type === 'warning'), 'con aviso en pantalla');
}

console.log('\nUna que sube y otra que no: la que no sube SIGUE contada');
{
  // El fallo viejo: `for (const k of list) pendingNoUri.delete(k)` recorría la
  // lista entera en cuanto había una sola uri, así que la única cuenta de lo
  // atascado se limpiaba sola y nunca se volvía a mirar.
  const MALA = 'ausencia||osvaldo pugliese';
  montar({ local: [LALALA, MALA], uris: { [LALALA]: `spotify:track:${LALALA}` }, enPlaylist: [] });
  const s = store();
  await s.ready();

  eq(subidas(), [`spotify:track:${LALALA}`], 'sube la que se puede');
  ok(`${LS}::${MALA}` in sinUriGuardado(), 'y la que no se puede sigue anotada');
  ok(localGuardado().includes(MALA), 'y sigue en el caché local');
}

// ── 4. Recuperación: solo si se puede CONFIRMAR ─────────────────────────────

console.log('\nRecuperar la uri por búsqueda');
{
  const CLAVE = 'ausencia||osvaldo pugliese';
  montar({ local: [CLAVE], uris: {}, enPlaylist: [] });
  const s = store({
    keyOfTrack: t => t?.album?.name || null,
    recoverUri: async () => 'spotify:track:RECUPERADAxxxxxxxxxxxx',
  });
  await s.ready();
  eq(subidas(), ['spotify:track:RECUPERADAxxxxxxxxxxxx'], 'la uri recuperada se sube');
  eq(urisGuardadas()[CLAVE], 'spotify:track:RECUPERADAxxxxxxxxxxxx', 'y se persiste para la próxima');
  eq(sinUriGuardado(), {}, 'y deja de estar pendiente');
}

console.log('\nUna recuperación que NO confirma no inventa nada');
{
  const CLAVE = 'ausencia||osvaldo pugliese';
  montar({ local: [CLAVE], uris: {}, enPlaylist: [] });
  const s = store({ keyOfTrack: t => t?.album?.name || null, recoverUri: async () => null });
  await s.ready();
  eq(subidas(), [], 'no sube nada');
  ok(localGuardado().includes(CLAVE), 'y tampoco descarta el oculto');
  ok(`${LS}::${CLAVE}` in sinUriGuardado(), 'lo deja anotado con su intento');
  ok(sinUriGuardado()[`${LS}::${CLAVE}`].intentos === 1, 'contando el intento gastado');
}

console.log('\nUna búsqueda que revienta no rompe el sync');
{
  const CLAVE = 'ausencia||osvaldo pugliese';
  montar({ local: [CLAVE], uris: {}, enPlaylist: [] });
  const s = store({
    keyOfTrack: t => t?.album?.name || null,
    recoverUri: async () => { throw new Error('429'); },
  });
  await s.ready();
  ok(s.synced, 'el sync termina igual');
  ok(localGuardado().includes(CLAVE), 'y el oculto sigue entero');
}

// ── 5. Lo que ya funcionaba tiene que seguir funcionando ────────────────────

console.log('\nLa unión sigue ganando');
{
  montar({ local: [LALALA], uris: {}, enPlaylist: [OTRO] });
  const s = store({ uriFromKey: uriDeTrackId });
  await s.ready();
  eq(localGuardado().sort(), [LALALA, OTRO].sort(), 'lo de la playlist entra al local');
  ok(s.has(OTRO), 'y el store lo ve');
  eq(subidas(), [`spotify:track:${LALALA}`], 'y lo que solo estaba local sube');
  eq(urisGuardadas()[OTRO], `spotify:track:${OTRO}`, 'la uri de lo remoto queda persistida');
}

console.log('\nCon todo sincronizado no se escribe nada');
{
  montar({ local: [LALALA], uris: { [LALALA]: `spotify:track:${LALALA}` }, enPlaylist: [LALALA] });
  const s = store();
  await s.ready();
  eq(subidas(), [], 'no sube nada');
  eq(globalThis.__DOBLE.quitadas, [], 'no quita nada');
  eq(globalThis.__DOBLE.toasts, [], 'y no molesta con avisos');
}

console.log('\ntoggle()');
{
  montar({ local: [], uris: {}, enPlaylist: [] });
  const s = store();
  ok(s.toggle(LALALA, `spotify:track:${LALALA}`), 'ocultar devuelve true');
  eq(urisGuardadas()[LALALA], `spotify:track:${LALALA}`, 'y persiste la uri al instante, no al sincronizar');
  await new Promise(r => setTimeout(r, 0));
  eq(subidas(), [`spotify:track:${LALALA}`], 'y la sube');

  ok(!s.toggle(LALALA), 'desocultar devuelve false');
  eq(urisGuardadas()[LALALA], undefined, 'y olvida la uri, que el mapa no crezca sin techo');
  await new Promise(r => setTimeout(r, 0));
  eq(globalThis.__DOBLE.quitadas.flatMap(q => q.uris), [`spotify:track:${LALALA}`], 'y la quita de la playlist');
}

console.log('\ntoggle() sin uri avisa en el momento');
{
  montar({ local: [], uris: {}, enPlaylist: [] });
  const s = store({ keyOfTrack: t => t?.album?.name || null });
  s.toggle('ausencia||osvaldo pugliese', null);
  await new Promise(r => setTimeout(r, 0));
  ok(globalThis.__DOBLE.toasts.some(t => t.type === 'warning'), 'el usuario se entera de que quedó solo aquí');
  ok(`${LS}::ausencia||osvaldo pugliese` in sinUriGuardado(), 'y queda anotado');
}

console.log('\nclear() dice lo que no pudo quitar');
{
  const MALA = 'ausencia||osvaldo pugliese';
  montar({ local: [LALALA, MALA], uris: { [LALALA]: `spotify:track:${LALALA}` }, enPlaylist: [LALALA] });
  const s = store();
  await s.clear();
  eq(globalThis.__DOBLE.quitadas.flatMap(q => q.uris), [`spotify:track:${LALALA}`], 'quita de la playlist lo que sabe identificar');
  eq(localGuardado(), [], 'vacía el local');
  ok(globalThis.__DOBLE.toasts.some(t => t.type === 'warning'), 'y avisa de la que no pudo quitar');
}

// ── 6. `hidden-recover`: o coincide exacto, o null ──────────────────────────

console.log('\nrecuperarUriDeAlbumKey()');
{
  montar();
  globalThis.__DOBLE.buscar = (path) => {
    if (path.startsWith('/search')) {
      return { albums: { items: [
        // Un candidato parecido pero de otro artista: NO tiene que valer.
        { id: 'a1', name: 'Ausencia', artists: [{ name: 'Aníbal Troilo' }] },
        { id: 'a2', name: 'Ausencia', artists: [{ name: 'Osvaldo Pugliese' }] },
      ] } };
    }
    if (path.startsWith('/albums/a2/tracks')) {
      return { items: [{ uri: 'spotify:track:BUENA', artists: [{ name: 'Osvaldo Pugliese' }] }] };
    }
    return { items: [] };
  };
  const uri = await recuperarUriDeAlbumKey('ausencia||osvaldo pugliese');
  eq(uri, 'spotify:track:BUENA', 'acepta el candidato cuya clave recalculada coincide');
  ok(!globalThis.__DOBLE.llamadas.some(p => p.startsWith('/albums/a1/')), 'y ni le pide las pistas al que no coincide');
}

console.log('\nrecuperarUriDeAlbumKey() sin coincidencia exacta');
{
  montar();
  globalThis.__DOBLE.buscar = () => ({ albums: { items: [
    { id: 'a1', name: 'Ausencia (En Vivo)', artists: [{ name: 'Osvaldo Pugliese' }] },
  ] } });
  eq(await recuperarUriDeAlbumKey('ausencia||osvaldo pugliese'), null, 'un «parecido» no vale: devuelve null');
  eq(await recuperarUriDeAlbumKey('sin separador'), null, 'una clave que no es de álbum devuelve null sin buscar');
}

console.log('\nrecuperarUriDeArtistaKey()');
{
  montar();
  globalThis.__DOBLE.buscar = () => ({ tracks: { items: [
    // El artista principal es otro: reconstruiría OTRA clave al sincronizar.
    { uri: 'spotify:track:MALA', artists: [{ name: 'Drake' }, { name: 'Nick Drake' }] },
    { uri: 'spotify:track:BUENA', artists: [{ name: 'Nick Drake' }] },
  ] } });
  eq(await recuperarUriDeArtistaKey('nick drake'), 'spotify:track:BUENA', 'solo vale si el artists[0] es ese artista');
  eq(await recuperarUriDeArtistaKey(''), null, 'sin nombre no busca');
}

console.log(`\n${pasaron} asserts OK, ${fallaron} fallos`);
process.exit(fallaron ? 1 : 0);
