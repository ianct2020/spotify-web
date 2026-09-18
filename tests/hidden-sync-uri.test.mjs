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
    recoverUri: async () => ({ uri: 'spotify:track:RECUPERADAxxxxxxxxxxxx', motivo: null }),
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
  const s = store({
    keyOfTrack: t => t?.album?.name || null,
    recoverUri: async () => ({ uri: null, motivo: 'el álbum existe pero su artista principal es otro' }),
  });
  await s.ready();
  eq(subidas(), [], 'no sube nada');
  ok(localGuardado().includes(CLAVE), 'y tampoco descarta el oculto');
  ok(`${LS}::${CLAVE}` in sinUriGuardado(), 'lo deja anotado con su intento');
  ok(sinUriGuardado()[`${LS}::${CLAVE}`].intentos === 1, 'contando el intento gastado');
  eq(leerIncidencias()[0]?.motivos?.[CLAVE], 'el álbum existe pero su artista principal es otro',
    'y la incidencia guarda el POR QUÉ, no solo que no se pudo');
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
  const r = await recuperarUriDeAlbumKey('ausencia||osvaldo pugliese');
  eq(r.uri, 'spotify:track:BUENA', 'acepta el candidato cuya clave recalculada coincide');
  eq(r.motivo, null, 'y no da ningún motivo de fallo');
  ok(!globalThis.__DOBLE.llamadas.some(p => p.startsWith('/albums/a1/')), 'y ni le pide las pistas al que no coincide');
}

console.log('\nrecuperarUriDeAlbumKey() sin coincidencia exacta');
{
  montar();
  globalThis.__DOBLE.buscar = () => ({ albums: { items: [
    { id: 'a1', name: 'Ausencia (En Vivo)', artists: [{ name: 'Osvaldo Pugliese' }] },
  ] } });
  eq((await recuperarUriDeAlbumKey('ausencia||osvaldo pugliese')).uri, null, 'un «parecido» no vale: devuelve null');
  eq((await recuperarUriDeAlbumKey('sin separador')).uri, null, 'una clave que no es de álbum devuelve null sin buscar');
}

console.log('\nrecuperarUriDeArtistaKey()');
{
  montar();
  globalThis.__DOBLE.buscar = () => ({ tracks: { items: [
    // El artista principal es otro: reconstruiría OTRA clave al sincronizar.
    { uri: 'spotify:track:MALA', artists: [{ name: 'Drake' }, { name: 'Nick Drake' }] },
    { uri: 'spotify:track:BUENA', artists: [{ name: 'Nick Drake' }] },
  ] } });
  eq((await recuperarUriDeArtistaKey('nick drake')).uri, 'spotify:track:BUENA', 'solo vale si el artists[0] es ese artista');
  eq((await recuperarUriDeArtistaKey('')).uri, null, 'sin nombre no busca');
}

console.log('\nEl agujero HERMANO: la clave la escribió otro artista');
{
  // Medido en los ocultos reales de Ian el 2026-09-05. #discover-artists arma la
  // clave con el artista que estás explorando, no con el `artists[0]` del álbum
  // en Spotify. Para un soundtrack o una colaboración las dos no coinciden, y
  // entonces la clave NO se puede reconciliar por ningún camino: aunque se
  // subiera una pista, al releerla `keyOfTrack` daría otra clave.
  //
  // Lo que se prueba acá es que eso se DICE, no que se arregle: el arreglo es
  // otro y vive en la vista que escribe la clave.
  montar();
  globalThis.__DOBLE.buscar = () => ({ albums: { items: [
    { id: 'a1', name: 'K-Pop (Chopped and Screwed)', artists: [{ name: 'Travis Scott' }] },
  ] } });
  const r = await recuperarUriDeAlbumKey('k-pop (chopped and screwed)||the weeknd');
  eq(r.uri, null, 'no se sube una pista que se releería con otra clave');
  ok(/Travis Scott/.test(r.motivo || ''), 'y el motivo nombra al artista real');
  ok(/otra clave/.test(r.motivo || ''), 'diciendo por qué no se puede reconciliar');
}

console.log('\nUn álbum que no existe se distingue de uno que existe con otro artista');
{
  montar();
  globalThis.__DOBLE.buscar = () => ({ albums: { items: [] } });
  const r = await recuperarUriDeAlbumKey('the j-strokes||the strokes');
  eq(r.uri, null, 'sin candidatos no hay uri');
  ok(/no devuelve ningún álbum/.test(r.motivo || ''), 'y el motivo lo dice con esas palabras');
}

console.log('\nLas pistas del álbum se miran TODAS, no las primeras');
{
  // Con `limit=5` «Michael: Songs From The Motion Picture» fallaba como si el
  // álbum no existiera: las primeras pistas están acreditadas a los invitados.
  montar();
  globalThis.__DOBLE.buscar = (path) => {
    if (path.startsWith('/search')) {
      return { albums: { items: [{ id: 'a1', name: 'Michael', artists: [{ name: 'Michael Jackson' }] }] } };
    }
    ok(/limit=50/.test(path), 'se piden las 50 pistas, no 5');
    return { items: [
      { uri: 'spotify:track:FEAT1', artists: [{ name: 'Akon' }] },
      { uri: 'spotify:track:FEAT2', artists: [{ name: '50 Cent' }] },
      { uri: 'spotify:track:FEAT3', artists: [{ name: 'Lenny Kravitz' }] },
      { uri: 'spotify:track:FEAT4', artists: [{ name: 'Dave Grohl' }] },
      { uri: 'spotify:track:FEAT5', artists: [{ name: 'Freddie Mercury' }] },
      { uri: 'spotify:track:BUENA', artists: [{ name: 'Michael Jackson' }] },
    ] };
  };
  const r = await recuperarUriDeAlbumKey('michael||michael jackson');
  eq(r.uri, 'spotify:track:BUENA', 'encuentra la pista buena aunque sea la sexta');
}


// ── 7. El lote de «Ocultar»/«Devolver» (v=228): acción dicha, no toggle ──────

const TERCERO = '9ZyXwVuTsRqPoNmLkJiHgF';

console.log('\nfijarVarios(ocultar): un lote mezclado no devuelve nada');
{
  // Con `toggle`, LALALA (ya oculto) volvería a la lista. Acá tiene que quedarse.
  montar({ local: [LALALA], uris: { [LALALA]: `spotify:track:${LALALA}` }, enPlaylist: [LALALA] });
  const s = store();
  const r = await s.fijarVarios([
    { key: LALALA, uri: `spotify:track:${LALALA}` },
    { key: OTRO, uri: `spotify:track:${OTRO}` },
    { key: TERCERO, uri: `spotify:track:${TERCERO}` },
  ], true);
  eq(r.hechas, [OTRO, TERCERO], 'oculta las dos que faltaban');
  eq(r.yaEstaban, [LALALA], 'y la que ya estaba sale como «ya estaba»');
  eq(r.fallidas, [], 'sin fallos');
  ok(s.has(LALALA) && s.has(OTRO) && s.has(TERCERO), 'las tres quedan ocultas');
  eq(globalThis.__DOBLE.quitadas, [], 'no se quita NADA de la playlist');
  eq(globalThis.__DOBLE.añadidas.length, 1, 'un solo POST para el lote, no uno por clave');
  eq(subidas(), [`spotify:track:${OTRO}`, `spotify:track:${TERCERO}`], 'con las dos uris nuevas');
  eq(urisGuardadas()[OTRO], `spotify:track:${OTRO}`, 'la uri se guarda con la clave');
  eq(s.fijarVarios.length, 2, 'la firma es (entradas, ocultar)');
}

console.log('\nfijarVarios(ocultar): si la playlist falla, NO queda oculto a medias');
{
  montar({ local: [], enPlaylist: [] });
  const s = store();
  await s.ready();
  globalThis.__DOBLE.fallarAdd = 'Spotify 502';
  const r = await s.fijarVarios([
    { key: OTRO, uri: `spotify:track:${OTRO}` },
    { key: TERCERO, uri: null },
  ], true);
  eq(r.hechas, [], 'nada hecho');
  eq(r.fallidas.map(f => f.key).sort(), [OTRO, TERCERO].sort(), 'las dos vuelven como fallidas');
  ok(r.fallidas.find(f => f.key === OTRO)?.motivo === 'Spotify 502', 'con el error crudo de Spotify');
  ok(/ninguna pista/.test(r.fallidas.find(f => f.key === TERCERO)?.motivo || ''), 'y la sin uri, con el suyo');
  ok(!s.has(OTRO) && !s.has(TERCERO), 'ninguna queda oculta solo en este navegador');
  eq(sinUriGuardado(), {}, 'ni anotada como «sin uri»: no es un oculto, es un intento fallido');
  eq(localGuardado(), [], 'el caché local no cambió');
}

console.log('\nfijarVarios(devolver): quita de la playlist y del local, y solo lo pedido');
{
  montar({
    local: [LALALA, OTRO, TERCERO],
    uris: { [LALALA]: `spotify:track:${LALALA}`, [OTRO]: `spotify:track:${OTRO}` },
    enPlaylist: [LALALA, OTRO],
  });
  const s = store();
  const NO_OCULTA = 'zzzzzzzzzzzzzzzzzzzzzz';
  const r = await s.fijarVarios([{ key: OTRO }, { key: TERCERO }, { key: NO_OCULTA }], false);
  eq(r.hechas.sort(), [OTRO, TERCERO].sort(), 'devuelve las dos ocultas');
  eq(r.yaEstaban, [NO_OCULTA], 'la que no estaba oculta no se oculta (no es toggle)');
  eq(globalThis.__DOBLE.quitadas.flatMap(q => q.uris), [`spotify:track:${OTRO}`], 'quita de la playlist solo la que estaba allí');
  eq(localGuardado(), [LALALA], 'en local queda solo la que no se tocó');
  ok(!(OTRO in urisGuardadas()), 'y la uri de la devuelta se olvida');
}

console.log('\nfijarVarios(devolver): si la playlist falla, sigue oculto');
{
  montar({ local: [OTRO], uris: { [OTRO]: `spotify:track:${OTRO}` }, enPlaylist: [OTRO] });
  const s = store();
  await s.ready();
  globalThis.__DOBLE.fallarRemove = 'Spotify 500';
  const r = await s.fijarVarios([{ key: OTRO }], false);
  eq(r.fallidas, [{ key: OTRO, motivo: 'Spotify 500' }], 'vuelve como fallida con el motivo');
  ok(s.has(OTRO), 'y sigue oculta: si se sacara del local, el sync la traería de vuelta sin decir nada');
}

console.log('\navisar(): dos avisos distintos no comparten cupo (v=229)');
{
  // Hasta v=228 el dedupe era por TIPO: el primer 'warning' de la sesión se
  // comía el cupo y el segundo quedaba solo en consola. Acá, en el mismo sync,
  // una resubida (La La La) y un irrecuperable (clave de álbum sin forma de
  // reconstruir su uri — el caso de `3vil reflection||osamason`).
  montar({ local: [LALALA, 'ausencia||osvaldo pugliese'], uris: { [LALALA]: `spotify:track:${LALALA}` }, enPlaylist: [] });
  const s = store();
  await s.ready();
  const avisos = globalThis.__DOBLE.toasts.filter(t => t.type === 'warning').map(t => t.msg || t.message || t.text || JSON.stringify(t));
  eq(avisos.length, 2, 'salen los DOS avisos amarillos, no solo el primero');
  ok(avisos.some(m => /vuelto a subir/.test(m)) && avisos.some(m => /solo en este navegador/.test(m)), 'uno por la resubida y otro por la que vive solo aquí');
}

console.log(`\n${pasaron} asserts OK, ${fallaron} fallos`);
process.exit(fallaron ? 1 : 0);
