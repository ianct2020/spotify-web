// Suite de la tanda 5: los tres criterios nuevos de #discover-artists /
// #new-releases (v=165).
//
//   1. el agregado de edición (util/edition-suffix.js)
//   2. el tema BASE de un single (util/song-identity.js)
//   3. las tres divisiones álbum / EP / single (util/release-size.js)
//
// Lo que estas pruebas cuidan de verdad NO es que se descarte de más: es que
// NO se fusione lo que no hay que fusionar. American Football LP2/LP3, Crystal
// Castles I/II y el ÷ / = / + de Ed Sheeran son los tres casos que ya costaron
// caro, y están acá para que el próximo que afloje la lista los rompa a la
// vista y no en silencio.

import assert from 'node:assert';
import { baseDeEdicion, tieneAgregadoDeEdicion, esAgregadoDeEdicion } from '../src/js/util/edition-suffix.js';
import { songKey, songKeysCandidatas, songKeyBase } from '../src/js/util/song-identity.js';
import { releaseKind, esEPoAlbum, EP_MIN_TRACKS } from '../src/js/util/release-size.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.strictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };

// ── 1. El agregado de edición ────────────────────────────────────────────────

// Lo que SÍ se saca, en las tres formas de escribirlo.
eq(baseDeEdicion('Hurry Up Tomorrow (Deluxe)'), 'Hurry Up Tomorrow', 'paréntesis');
eq(baseDeEdicion('Nevermind (Super Deluxe Edition)'), 'Nevermind', 'super deluxe');
eq(baseDeEdicion('Thriller - 25th Anniversary Edition'), 'Thriller', 'guion + ordinal');
eq(baseDeEdicion('The Dark Side of the Moon [50th Anniversary]'), 'The Dark Side of the Moon', 'corchetes');
eq(baseDeEdicion('Views - Bonus Track Version'), 'Views', 'bonus track version');
eq(baseDeEdicion('Album (Deluxe Edition) [Remastered 2011]'), 'Album', 'dos trozos seguidos');
eq(baseDeEdicion('Igor Deluxe'), 'Igor', 'cola pelada de una palabra');
eq(baseDeEdicion('Sombras Complete Edition'), 'Sombras', 'cola pelada de dos palabras');
eq(baseDeEdicion('Stoney (Complete Edition)'), 'Stoney', 'complete edition, caso real');
eq(baseDeEdicion('I Love You. (10th Anniversary Edition)'), 'I Love You.', 'caso real de Ian');

// ⚠️ Lo que NO se toca. Estos son los que rompen si alguien «normaliza un poco más».
eq(baseDeEdicion('American Football (LP2)'), 'American Football (LP2)', 'LP2 no es una edición');
eq(baseDeEdicion('American Football (LP3)'), 'American Football (LP3)', 'LP3 no es una edición');
eq(baseDeEdicion('Crystal Castles II'), 'Crystal Castles II', 'el número romano es el disco');
eq(baseDeEdicion('÷'), '÷', 'el título entero es un símbolo');
eq(baseDeEdicion('Midnight Gold'), 'Midnight Gold', 'una palabra ambigua sin «edition» no cuenta');
eq(baseDeEdicion('Live at Wembley'), 'Live at Wembley', 'un vivo es otro disco, no una edición');
eq(baseDeEdicion('eternal sunshine (slightly deluxe and also live)'),
   'eternal sunshine (slightly deluxe and also live)', 'una palabra fuera de lista salva el trozo entero');
eq(baseDeEdicion('Deluxe'), 'Deluxe', 'si sacar el agregado deja vacío, no se saca');
eq(baseDeEdicion('OK Computer OKNOTOK 1997 2017'), 'OK Computer OKNOTOK 1997 2017', 'años sueltos sin núcleo');

eq(tieneAgregadoDeEdicion('Nevermind (Deluxe)'), true, 'detecta el agregado');
eq(tieneAgregadoDeEdicion('Nevermind'), false, 'no inventa agregados');
eq(esAgregadoDeEdicion('LP3'), false, 'trozo con palabra fuera de lista');
eq(esAgregadoDeEdicion('Deluxe Edition'), true, 'trozo entero de la lista');
eq(esAgregadoDeEdicion('Edition'), false, 'relleno solo no alcanza: hace falta un núcleo');

// La simetría: da igual de qué lado esté el agregado.
eq(baseDeEdicion('Igor Deluxe') === baseDeEdicion('Igor'), true, 'simétrico');

// ── 2. El tema BASE de un single ────────────────────────────────────────────

// La primera candidata es siempre songKey: un llamador viejo no cambia.
eq(songKeysCandidatas('Timeless', 'The Weeknd')[0], songKey('Timeless', 'The Weeknd'), 'la primera es songKey');

const da = (n_, a, esperado, msg) =>
  eq(songKeysCandidatas(n_, a).includes(`${esperado}||${songKey('x', a).split('||')[1]}`), true, msg);

da('Timeless (Remix)', 'The Weeknd', 'timeless', 'paréntesis — ya lo hacía songKey');
da('Timeless - DEVAULT Remix', 'The Weeknd', 'timeless', 'guion — ya lo hacía songKey');
da('Timeless Sped Up', 'The Weeknd', 'timeless', 'cola pegada, lo nuevo');
da('Die For You Acoustic', 'The Weeknd', 'die for you', 'acoustic pegado');
da('Not Like Us Slowed + Reverb', 'Kendrick Lamar', 'not like us', 'slowed + reverb');

// El recorte por autor se corta en 2 tokens: nunca deja una clave de 1 palabra.
eq(songKeysCandidatas('One More Time VIP', 'X').every(k => k.split('||')[0].split(' ').length >= 2), true,
   'ningún candidato baja de 2 palabras');
// Un título normal no genera candidatos de más.
eq(songKeysCandidatas('Blinding Lights', 'The Weeknd').length, 1, 'sin cola de versión, una sola clave');
// songKeyBase agrupa las cuatro formas en la misma clave.
const b = songKeyBase('Timeless', 'The Weeknd');
for (const t of ['Timeless (Remix)', 'Timeless - DEVAULT Remix', 'Timeless Sped Up']) {
  eq(songKeyBase(t, 'The Weeknd'), b, `«${t}» agrupa con «Timeless»`);
}
// Y NO agrupa dos temas distintos del mismo artista.
eq(songKeyBase('Blinding Lights', 'The Weeknd') === b, false, 'dos temas distintos, dos claves');

// ── 3. Las tres divisiones ──────────────────────────────────────────────────

eq(EP_MIN_TRACKS, 4, 'el umbral sigue siendo el de v=127');
eq(releaseKind({ type: 'album', total: 12 }), 'album', 'álbum');
eq(releaseKind({ type: 'compilation', total: 30 }), 'album', 'el recopilatorio cuenta como álbum');
eq(releaseKind({ type: 'single', total: 5 }), 'ep', 'un «single» de 5 pistas es un EP');
eq(releaseKind({ type: 'single', total: 4 }), 'ep', 'justo en el umbral');
eq(releaseKind({ type: 'single', total: 3 }), 'single', 'un pelo por debajo');
eq(releaseKind({ type: 'single', total: 1 }), 'single', 'single de una pista');
eq(releaseKind({ album_type: 'single', total_tracks: 6 }), 'ep', 'acepta también la forma cruda de la API');
eq(releaseKind({}), 'single', 'sin datos, lo más conservador');
eq(esEPoAlbum(4), true, 'esEPoAlbum sigue igual');

console.log(`OK — ${n} asserts`);
