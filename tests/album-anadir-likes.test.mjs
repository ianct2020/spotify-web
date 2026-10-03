// tests/album-anadir-likes.test.mjs — añadir a me gusta desde la ficha de
// álbum: en lote, confirmado al final, y sin bajar la biblioteca (2026-10-03)
//
// Lo que se protege acá son cuatro cosas que ya costaron caro una vez cada una:
//
//   1. La RUTA y el TAMAÑO DEL LOTE. Post-migración se escribe por
//      `PUT /me/library?uris=` y el tope son 40 uris: con 41 Spotify devuelve
//      400 «Too many uris requested» (medido en vivo el 2026-08-28). Ya hubo
//      dos meses en que los dos `contains` iban de a 50 y por lo tanto fallaban
//      SIEMPRE, con el fallo tapado por un `console.warn`.
//   2. Que no sea un toggle instantáneo: se marca, y se confirma UNA vez.
//      Escribe en la cuenta de Spotify de Ian y deshacerlo es a mano.
//   3. Que NINGUNA vista baje los me gusta sola. Es lo que cerró v=255.
//   4. Que la caché de me gusta no se DESTRUYA al actualizarla, ni al añadir
//      ni si la actualización falla.

import { readFileSync } from 'node:fs';

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

// ⚠️ Los comentarios de este repo CITAN el código que se quitó y la ruta que NO
// se usa («`PUT /me/tracks` no es la de esta app»). Buscar sobre el fuente con
// comentarios da falsos positivos justo en las comprobaciones que más importan.
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

const api = sinComentarios(leer('../src/js/api.js'));
const ficha = sinComentarios(leer('../src/js/features/album-card.js'));
const listened = sinComentarios(leer('../src/js/features/listened.js'));
const hoja = leer('../src/css/main.css');

const trozo = (txt, desde, hasta) => {
  const i = txt.indexOf(desde);
  if (i < 0) return '';
  const j = hasta ? txt.indexOf(hasta, i + 1) : -1;
  return txt.slice(i, j > i ? j : txt.length);
};

// ── 1. La ruta y el lote viven en api.js y en ningún otro sitio ─────────────
console.log('\n1. La ruta de escritura y el tamaño del lote');

ok(/const LIBRARY_URIS_POR_REQUEST = 40;/.test(api),
  'el tope sigue siendo 40 uris por petición (41 da 400, medido en vivo)');

const saveSrc = trozo(api, 'async function saveToLibrary', 'async function addToLikesCache');
ok(/\/me\/library\?uris=/.test(saveSrc) && /method: 'PUT'/.test(saveSrc),
  'saveToLibrary escribe por PUT /me/library?uris=');
ok(/i \+= LIBRARY_URIS_POR_REQUEST/.test(saveSrc),
  'y trocea por la constante, no por un número escrito a mano');

// `PUT /me/tracks` da 403 post-migración. Que no aparezca por ningún lado.
ok(!/\/me\/tracks[^']*`,\s*\{\s*method: 'PUT'/.test(api) && !/'\/me\/tracks'[^)]*method: 'PUT'/.test(api),
  'NADIE escribe por PUT /me/tracks (403 post-migración)');

const anadirSrc = trozo(api, 'async function anadirLikes', 'async function saveAlbumsToLibrary');
ok(/await saveToLibrary\(ids\)/.test(anadirSrc),
  'anadirLikes delega la ruta y el troceado en saveToLibrary');
ok(/await addToLikesCache\(limpios\)/.test(anadirSrc),
  'y actualiza la caché de me gusta después de escribir');
ok(api.includes('\n  anadirLikes,\n'), 'anadirLikes está exportada');

// ── 2. La caché se actualiza, nunca se destruye ─────────────────────────────
console.log('\n2. La caché de me gusta no se destruye al añadir');

const cacheSrc = trozo(api, 'async function addToLikesCache', 'async function anadirLikes');
ok(!/invalidateLikesCache|idbDel|cacheClear/.test(cacheSrc),
  'addToLikesCache no borra la caché por ningún camino');
ok(/if \(!Array\.isArray\(cached\)\) return;/.test(cacheSrc),
  'con la caché fría no inventa una caché nueva (sería un parcial disfrazado de completo)');
ok(/complete: true/.test(cacheSrc),
  'escribe marcando la carga como completa, que es lo único que saveLikes acepta');
ok(/catch \(e\)[\s\S]{0,400}showToast/.test(cacheSrc),
  'si no puede actualizar, lo DICE en pantalla en vez de callarse');

// ── 3. Comportamiento real: un lote, y el corte en 40 ───────────────────────
console.log('\n3. Comportamiento real de anadirLikes (fuente extraída)');

async function montar(cacheInicial) {
  const peticiones = [];
  const guardados = [];
  const cuerpo = `
    const LIBRARY_URIS_POR_REQUEST = 40;
    ${trozo(api, 'async function saveToLibrary', 'async function addToLikesCache')}
    ${trozo(api, 'async function addToLikesCache', 'async function anadirLikes')}
    ${trozo(api, 'async function anadirLikes', 'async function saveAlbumsToLibrary')}
    return { anadirLikes, saveToLibrary };
  `;
  const fab = new Function('spotifyFetch', 'leerLikesCacheados', 'saveLikes', 'showToast', 'console', cuerpo);
  const api2 = fab(
    async (url, opt) => { peticiones.push({ url, metodo: opt?.method || 'GET' }); return {}; },
    async () => cacheInicial,
    async (items, meta) => { guardados.push({ items, meta }); return { ok: true }; },
    () => {},
    { info: () => {}, warn: () => {} },
  );
  return { api2, peticiones, guardados };
}

const entrada = (id) => ({ added_at: '2026-10-03T00:00:00Z', track: { id, uri: `spotify:track:${id}`, name: `t${id}`, album: { id: 'alb', name: 'Disco' } } });

{
  // Un disco normal: 12 pistas → UNA petición.
  const { api2, peticiones, guardados } = await montar([entrada('viejo')]);
  const r = await api2.anadirLikes(Array.from({ length: 12 }, (_, i) => entrada(`x${i}`)));
  ok(peticiones.length === 1, `12 pistas = 1 petición (fueron ${peticiones.length})`);
  ok(peticiones[0].metodo === 'PUT' && peticiones[0].url.startsWith('/me/library?uris='),
    'y es un PUT a /me/library?uris=');
  ok(r.anadidos === 12, 'informa 12 añadidas');
  ok(guardados.length === 1 && guardados[0].items.length === 13,
    'la caché pasa de 1 a 13 entradas (12 nuevas al frente)');
  ok(guardados[0].items[0].track.id === 'x0',
    'lo nuevo va al frente, como syncLikesIncremental (la caché va por added_at desc)');
}

{
  // El corte del lote. 41 no puede viajar en una sola petición: da 400.
  const { api2, peticiones } = await montar([]);
  await api2.anadirLikes(Array.from({ length: 41 }, (_, i) => entrada(`y${i}`)));
  ok(peticiones.length === 2, `41 pistas se parten en 2 peticiones (fueron ${peticiones.length})`);
  const uris = peticiones[0].url.split('uris=')[1].split(',');
  ok(uris.length === 40, 'la primera lleva exactamente 40 uris');
}

{
  // Idempotencia: lo que ya estaba en la caché no se duplica.
  const { api2, peticiones, guardados } = await montar([entrada('a'), entrada('b')]);
  await api2.anadirLikes([entrada('a'), entrada('c')]);
  ok(peticiones.length === 1, 'igual se le manda a Spotify (es idempotente del lado de la API)');
  ok(guardados.length === 1 && guardados[0].items.length === 3,
    'pero la caché queda con 3, no con 4: «a» no se duplica');
}

{
  // Nada marcado: ni una petición.
  const { api2, peticiones, guardados } = await montar([]);
  const r = await api2.anadirLikes([]);
  ok(peticiones.length === 0 && guardados.length === 0 && r.anadidos === 0,
    'sin pistas no hay ninguna petición ni escritura');
}

{
  // Con la caché fría NO se escribe una caché nueva: sería un parcial de 3
  // canciones leído después como la biblioteca entera.
  const { api2, peticiones, guardados } = await montar(null);
  await api2.anadirLikes([entrada('a'), entrada('b'), entrada('c')]);
  ok(peticiones.length === 1, 'la escritura en Spotify se hace igual');
  ok(guardados.length === 0, 'y la caché fría se queda fría, sin inventar un completo de 3');
}

// ── 4. La ficha: marcar y confirmar, sin bajar la biblioteca ────────────────
console.log('\n4. La ficha de álbum');

ok(/function likesConocidos\(\)/.test(ficha),
  'la ficha distingue «no tiene ninguna» de «no sé qué tiene» (likesConocidos)');
ok(/_likesMemo !== null/.test(ficha),
  'y lo decide por el source memoizado, no por el tamaño del array (v=256)');

const hidrata = trozo(ficha, 'async function hydrateLikes', 'function wireAnadirLikes');
ok(/const conocidos = likesConocidos\(\);/.test(hidrata),
  'hydrateLikes lo consulta antes de pintar');
ok(/No sé cuáles de las/.test(hidrata) && /No sé qué pistas/.test(hidrata),
  'con la caché fría el contador lo DICE en vez de poner «ninguna»');
ok(/album-modal-aviso[\s\S]{0,300}no sé cuáles de estas pistas ya tienes/.test(hidrata),
  'y hay un aviso en pantalla que lo explica');

// ⚠️ v=255: ninguna vista baja la biblioteca sola. `getBestAvailableLikes()`
// no va a la red por defecto, y acá se la tiene que llamar SIN allowFetch.
ok(/getBestAvailableLikes\(\)/.test(ficha) && !/allowFetch/.test(ficha),
  'la ficha llama a getBestAvailableLikes() sin allowFetch: no baja los me gusta (v=255)');
ok(!/getAllLikedTracks/.test(ficha),
  'y no importa getAllLikedTracks por ningún lado');

const wire = trozo(ficha, 'function wireAnadirLikes', 'export function _clearAlbumCardLikesCache');
ok(/await confirmModal\(/.test(wire), 'la escritura pasa por una confirmación');
const iConfirm = wire.indexOf('await confirmModal(');
const iEscribe = wire.indexOf('await anadirLikes(');
ok(iConfirm > -1 && iEscribe > iConfirm, 'y la confirmación va ANTES de escribir');
ok(/if \(!ok\) return;/.test(wire), 'cancelar no escribe nada');

// Una sola llamada, no una por pista: el lote es el punto.
ok((wire.match(/anadirLikes\(/g) || []).length === 1,
  'anadirLikes se llama UNA vez, con todas las marcadas (no una por pista)');
const antesDeEscribir = wire.slice(0, iEscribe);
ok(!/for \(|forEach\(/.test(antesDeEscribir.slice(antesDeEscribir.lastIndexOf('btnOk.onclick'))),
  'y no hay ningún bucle alrededor de la escritura');

ok(/Añadir 1 a me gusta/.test(wire) && /Añadir \$\{n\.toLocaleString\('es-ES'\)\} a me gusta/.test(wire),
  'el número de marcadas está en el cartel del botón');
// El corazón LLENO significa «ya está en tus me gusta» y nada más. Una marcada
// se enciende en el acento pero sigue HUECA: todavía no es tuya.
ok(!/btn\.innerHTML = on \? HEART_SVG/.test(wire),
  'marcar NO llena el corazón: lleno = ya es tuya, y no puede decir dos cosas');
ok(/classList\.toggle\('is-marcada', on\)/.test(wire),
  'la marca se pinta por clase (acento + marca lateral)');

ok(/t\.liked = true;/.test(wire) && /replaceWith\(span\)/.test(wire),
  'después de guardar la fila lo refleja sin recargar');
ok(/_likesMemo = null;/.test(wire) && /_idsMemo = null;/.test(wire),
  'y el memo del módulo se tira para que la próxima ficha relea la caché');

// Quitar likes NO es trabajo de esta ficha: eso tiene su propia verificación.
ok(!/removeLikedTracks|borrarLikesVerificado/.test(ficha),
  'la ficha no quita me gusta: añadir y quitar no comparten botón');

// ── 5. #listened abre LA ficha, y gratis ───────────────────────────────────
console.log('\n5. #listened');

const abrir = trozo(listened, 'function abrirFichaDeAlbum', '\nfunction openAlbumDetail');
ok(/el\.onclick = \(\) => abrirFichaDeAlbum\(el\.dataset\.id\)/.test(listened),
  'el click en una tarjeta de la grilla abre la ficha');
ok(/openAlbumCard\(\{/.test(abrir), 'y la ficha es la compartida (openAlbumCard)');
ok(/albumId: album\.id/.test(abrir),
  'le pasa el albumId que ya tiene: 0 peticiones de /search (v=218)');
ok(/acciones: \[\{/.test(abrir) && /openAlbumDetail\(album\.id\)/.test(abrir),
  'el modal viejo sigue alcanzable como acción: no se pierde «mis pistas en la playlist»');
ok(/function openAlbumDetail/.test(listened),
  'y openAlbumDetail sigue existiendo');
ok(!/\/search/.test(abrir), 'el camino nuevo no toca /search');

// ── 6. La hoja: variables de tema, ningún color a mano ─────────────────────
console.log('\n6. La hoja de estilos');

const bloque = trozo(hoja, 'Marcar pistas para añadir a me gusta', '\n/* El tamaño de `.album-modal-like-play`');
for (const clase of ['.album-modal-like-add', '.album-modal-like-row-marcada', '.album-modal-anadir']) {
  ok(hoja.includes(clase), `la hoja define ${clase}`);
}
ok(bloque.length > 0 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(bloque),
  'y lo nuevo no tiene ni un color escrito a mano: todo por variables de tema');
ok(!/prefers-reduced-motion/.test(bloque),
  'sin prefers-reduced-motion: Ian tiene enable-animations=false y ese es SU camino (v=170)');

// ⚠️ La barra de confirmación no puede entrar y salir del layout: el modal está
// centrado en vertical, así que crecer le mueve TODAS las filas hacia arriba y
// el clic siguiente cae en otra pista. En una función que escribe en la cuenta
// de Spotify, marcar la canción equivocada es el fallo que importa.
ok(/\.album-modal-anadir\.is-vacia \{ visibility: hidden; \}/.test(hoja),
  'la barra vacía se vuelve invisible (reserva su sitio), no display:none');
ok(!/\.album-modal-anadir\[hidden\]/.test(hoja),
  'y no queda la regla del atributo hidden, que además perdía por especificidad');
ok(/barra\.classList\.toggle\('is-vacia'/.test(wire) && !/barra\.hidden/.test(wire),
  'el JS la apaga por clase, no por el atributo hidden');
ok(/!matched\.some\(t => t\.id && !t\.liked\) \? '' :/.test(hidrata),
  'y si el disco no tiene ninguna pista marcable, la barra no se pinta');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
