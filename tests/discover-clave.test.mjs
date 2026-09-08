// tests/discover-clave.test.mjs — las dos direcciones de la clave de descubrir (v=210)
//
// EL FALLO QUE PROTEGE ESTE ARCHIVO, en una línea: `#discover-artists` escribía
// la clave de un álbum con el artista QUE ESTÁS EXPLORANDO y la releía de la
// playlist con el `artists[0]` de la PISTA, así que en una colaboración, un
// soundtrack o un disco de remixes las dos claves no coincidían y ese
// ocultamiento no se podía reconciliar por ningún camino — se quedaba en el
// navegador para siempre. 7 de los 189 ocultos reales de Ian, medidos el
// 2026-09-05.
//
// El caso que lo define es el de ida y vuelta: se escribe la clave desde la
// tarjeta y se relee desde una pista de la playlist, y tiene que dar LA MISMA.
// Los siete casos de abajo son los siete reales, con su artista real.
//
// La segunda mitad es la migración: cambiar `cardKey` sin migrar sería una
// regresión, no un arreglo (los 7 volverían a la lista como si nunca se
// hubieran tocado). Y `renameKey` NO puede tocar la playlist: la pista que
// representa a la clave vieja es la misma que representa a la nueva, así que un
// borrado se llevaría por delante justo el oculto que se venía a salvar.

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
const { cardKey, cardKeyLegacy, keyOfPlaylistTrack, albumCreditName } =
  await import('../src/js/util/discover-key.js');
const { createHiddenStore, createLocalStore, uriDeTrackId } =
  await import('../src/js/util/hidden-sync.js');

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

// ── 1. Los siete reales: ida y vuelta ───────────────────────────────────────
//
// `explorado` es el artista por cuya página llegaste al disco; `firma` es quien
// figura como artista principal del álbum en Spotify. Los siete son los que
// quedaron huérfanos de verdad, con los nombres que dejó la medición del 05/09.
const LOS_SIETE = [
  { album: 'CARNIVAL Pack (feat. Rich The Kid, Playboi Carti)', explorado: 'Kanye West',  firma: '¥$' },
  { album: 'K-POP (Chopped and Screwed)',                       explorado: 'The Weeknd',  firma: 'Travis Scott' },
  { album: 'Moth To A Flame',                                   explorado: 'The Weeknd',  firma: 'Swedish House Mafia' },
  { album: 'I SEE REMIXES',                                     explorado: 'Tory Lanez',  firma: 'Richard Orlinski' },
  { album: '3VIL REFLECTION',                                   explorado: 'Osamason',    firma: 'Glokk40Spaz' },
  { album: 'The J-Strokes',                                     explorado: 'The Strokes', firma: 'The J-Strokes' },
  { album: 'USB002 Remixes',                                    explorado: 'Fred again..', firma: 'Fred again..' },
];

/** Cómo se releía la clave hasta v=209: por el `artists[0]` de la PISTA. */
function leerComoV209(t) {
  const albumName = t?.album?.name;
  if (!albumName) return null;
  return `${albumName.toLowerCase()}||${(t.artists?.[0]?.name || '').toLowerCase()}`;
}

console.log('\n1. Ida y vuelta de los siete huérfanos reales');
for (const c of LOS_SIETE) {
  const al = { name: c.album, artists: [{ name: c.firma }] };
  // La pista representativa: su `artists[0]` NO es la firma del álbum. Es el
  // caso de «USB002 Remixes», cuyas 50 pistas están acreditadas a otros.
  const pista = {
    uri: 'spotify:track:X',
    artists: [{ name: 'Otro Cualquiera' }],
    album: { name: c.album, artists: [{ name: c.firma }] },
  };
  eq(keyOfPlaylistTrack(pista), cardKey(al, c.explorado),
    `«${c.album}»: la clave escrita y la releída coinciden`);
  // Las siete estaban rotas, pero no todas por la misma mitad. Seis rompían al
  // ESCRIBIR (la firma del álbum no es el artista explorado); «USB002 Remixes»
  // está firmado por el artista que explorás y rompía al LEER, porque ninguna
  // de sus 50 pistas lo tiene como `artists[0]`. Distinguirlas importa: un
  // arreglo que solo tocara `cardKey` habría dejado esa séptima igual de rota.
  const rompiaAlEscribir = cardKeyLegacy(al, c.explorado) !== cardKey(al, c.explorado);
  const rompiaAlLeer = leerComoV209(pista) !== cardKey(al, c.explorado);
  ok(rompiaAlEscribir || rompiaAlLeer,
    `«${c.album}»: estaba rota ${rompiaAlEscribir ? 'al escribir' : 'al leer'} (por eso quedó huérfana)`);
}
eq(LOS_SIETE.filter(c => cardKeyLegacy({ name: c.album, artists: [{ name: c.firma }] }, c.explorado)
      !== cardKey({ name: c.album, artists: [{ name: c.firma }] }, c.explorado)).length, 6,
  'seis de las siete rompían al escribir, y la séptima al leer');

console.log('\n2. El caso normal no cambia de clave');
{
  const al = { name: 'Blonde', artists: [{ name: 'Frank Ocean' }] };
  eq(cardKey(al, 'Frank Ocean'), cardKeyLegacy(al, 'Frank Ocean'),
    'un álbum firmado por el artista explorado da la MISMA clave que antes');
  const pista = { album: { name: 'Blonde', artists: [{ name: 'Frank Ocean' }] }, artists: [{ name: 'Frank Ocean' }] };
  eq(keyOfPlaylistTrack(pista), cardKey(al, 'Frank Ocean'), 'y también da la vuelta');
}

console.log('\n3. Reservas: álbumes y pistas sin el dato');
{
  // Una entrada vieja del caché de discografía (30 días) puede no traer
  // `artists`. Ahí manda el artista explorado, como antes: la clave no puede
  // cambiar por debajo.
  const viejo = { name: 'Un Disco' };
  eq(cardKey(viejo, 'Alguien'), cardKeyLegacy(viejo, 'Alguien'),
    'sin `artists` en el álbum, la clave es la de siempre');
  eq(albumCreditName(viejo), '', 'y la firma sale vacía, no explota');
  const sinAlbumArtists = { album: { name: 'Un Disco' }, artists: [{ name: 'Alguien' }] };
  eq(keyOfPlaylistTrack(sinAlbumArtists), cardKey(viejo, 'Alguien'),
    'una pista sin `album.artists` cae en el `artists[0]` de reserva');
  eq(keyOfPlaylistTrack({ artists: [{ name: 'X' }] }), null, 'sin álbum no hay clave');
}

// ── 4. renameKey ────────────────────────────────────────────────────────────

console.log('\n4. renameKey es LOCAL: no toca la playlist');
{
  const LS = 'test_discover_ocultos';
  const PL = 'pl-descubrir';
  const NOMBRE = 'fonoteca · ocultos (descubrir)';
  const vieja = 'usb002 remixes||fred again';
  const nueva = 'usb002 remixes||fred again..';

  globalThis.localStorage = fakeLocalStorage({
    fonoteca_last_user_id: UID,
    [P(LS)]: JSON.stringify([vieja]),
    [P(`${LS}_uris`)]: JSON.stringify({ [vieja]: 'spotify:track:REP' }),
    [P(`fonoteca_hidden_pl_${LS}`)]: PL,
  });
  globalThis.__DOBLE = {
    me: UID,
    playlists: [{ id: PL, name: NOMBRE, owner: UID, items: [] }],
    añadidas: [], quitadas: [], creadas: [], llamadas: [], toasts: [],
    pistaDeUri: uri => ({ uri }),
  };

  const store = createHiddenStore({
    lsKey: LS, playlistName: NOMBRE, label: 'test-descubrir',
    keyOfTrack: keyOfPlaylistTrack,
  });

  ok(store.renameKey(vieja, nueva), 'renombra y avisa que lo hizo');
  eq(store.has(vieja), false, 'la clave vieja ya no está');
  eq(store.has(nueva), true, 'la nueva sí');
  eq(JSON.parse(localStorage.getItem(P(LS))), [nueva], 'y quedó guardada en localStorage');
  eq(JSON.parse(localStorage.getItem(P(`${LS}_uris`))), { [nueva]: 'spotify:track:REP' },
    'la uri se HEREDA: la pista sigue representando al mismo disco');
  eq(globalThis.__DOBLE.quitadas, [], 'NO se borró nada de la playlist — es lo que hace que sea seguro');
  eq(globalThis.__DOBLE.añadidas, [], 'ni se añadió nada');
  eq(globalThis.__DOBLE.creadas, [], 'ni se creó ninguna playlist');

  eq(store.renameKey('no-existe', 'otra'), false, 'una clave que no está no se renombra');
  eq(store.renameKey(nueva, nueva), false, 'renombrar a sí misma no hace nada');
  eq(store.size, 1, 'y el tamaño no se movió');
}

console.log('\n5. renameKey cuando la clave nueva YA existía');
{
  const LS = 'test_dup';
  localStorage.setItem(P(LS), JSON.stringify(['a||uno', 'a||dos']));
  const store = createLocalStore({ lsKey: LS, label: 'test-dup' });
  ok(store.renameKey('a||uno', 'a||dos'), 'renombra igual');
  eq(store.values(), ['a||dos'], 'la vieja se descarta: era un duplicado del mismo disco');
  eq(store.size, 1, 'y no quedan dos entradas para un solo álbum');
}

console.log(`\n${pasaron} asserts OK, ${fallaron} fallidos`);
process.exit(fallaron ? 1 : 0);
