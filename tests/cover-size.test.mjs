// tests/cover-size.test.mjs — elegir la variante de tapa por el tamaño real
//
// `coverAtSize()` existía desde v=150 sin test propio, y su regex ya se comió
// un fallo silencioso: hasta v=149 solo aceptaba `i.scdn.co`, así que para todo
// lo que sale del historial (Wrapped, #covers, W-Three) era un no-op y nadie se
// enteró. Los tres hosts van cubiertos acá abajo.
//
// `tapaParaCelda()` (v=193) es la que decide si el mosaico baja 64×64 o
// 300×300. Se equivoca hacia abajo → las tapas se ven blandas; hacia arriba →
// vuelve el pozo de memoria con celdas de 28 px. El umbral es en píxeles
// REALES, no en píxeles CSS.

import { coverAtSize, sizeFromUrl, coverUrl, tapaParaCelda } from '../src/js/util/cover-size.js';

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

const ID = 'cad190f1a73c024e5a40dddd';
const u = (host, pref) => `https://${host}/image/${pref}${ID}`;
const AK = 'image-cdn-ak.spotifycdn.com';   // el de history-listened-albums.json
const FA = 'image-cdn-fa.spotifycdn.com';
const SC = 'i.scdn.co';                      // el de la API
const P640 = 'ab67616d0000b273', P300 = 'ab67616d00001e02', P64 = 'ab67616d00004851';

// ── Los tres hosts, que es donde estuvo el no-op de v=149 ──────────────────
for (const host of [SC, AK, FA]) {
  eq(coverAtSize(u(host, P300), 64), u(host, P64), `${host}: 300 → 64`);
  eq(coverAtSize(u(host, P64), 300), u(host, P300), `${host}: 64 → 300`);
  eq(sizeFromUrl(u(host, P640)), 640, `${host}: el prefijo de 640 se reconoce`);
}

// ── Best-effort: lo que no se reconoce vuelve igual, nunca roto ────────────
eq(coverAtSize('https://otro.cdn/loquesea.jpg', 64), 'https://otro.cdn/loquesea.jpg',
  'host desconocido: la URL vuelve tal cual');
eq(coverAtSize(u(AK, P300), 128), u(AK, P300), 'tamaño que no existe: vuelve tal cual');
eq(coverAtSize(null, 64), null, 'sin URL no explota');
eq(sizeFromUrl('https://otro.cdn/x.jpg'), null, 'host desconocido no declara tamaño');

// ── tapaParaCelda: el umbral va en píxeles reales ──────────────────────────
const T = u(AK, P300);
eq(tapaParaCelda(T, 28, 1), u(AK, P64), 'Mini a 1×  (28px → 28 reales) pide la de 64');
eq(tapaParaCelda(T, 48, 1), u(AK, P64), 'Chico a 1× (48px → 48 reales) pide la de 64');
eq(tapaParaCelda(T, 64, 1), u(AK, P64), 'Medio a 1× (64px → 64 reales) pide la de 64, justo en el borde');
eq(tapaParaCelda(T, 96, 1), u(AK, P300), 'Grande a 1× (96px) pide la de 300');

eq(tapaParaCelda(T, 28, 2), u(AK, P64), 'Mini a 2×  (56 reales) todavía entra en la de 64');
eq(tapaParaCelda(T, 48, 2), u(AK, P300), 'Chico a 2× (96 reales) sube a la de 300, no se ve blanda');
eq(tapaParaCelda(T, 64, 2), u(AK, P300), 'Medio a 2× (128 reales) sube a la de 300');

eq(tapaParaCelda(T, 19, 1), u(AK, P64), '«Ajustar» con lados raros (19px) también resuelve');
eq(tapaParaCelda(T, 0, 1), u(AK, P64), 'lado 0 no rompe');
eq(tapaParaCelda('https://otro.cdn/x.jpg', 28, 1), 'https://otro.cdn/x.jpg',
  'una tapa rescatada por oEmbed vuelve intacta');

// ── coverUrl: el índice NO es el tamaño (la lección de v=150) ──────────────
eq(coverUrl([{ url: u(SC, P300), width: 300 }, { url: u(SC, P64), width: 64 }], 'chica'),
  u(SC, P64), 'con [300, 64] la chica es la de 64, no images[2]');
eq(coverUrl([{ url: u(SC, P300), width: 300 }, { url: u(SC, P64), width: 64 }], 'grande'),
  u(SC, P300), 'con [300, 64] la grande es la de 300');
eq(coverUrl([{ url: u(SC, P640), width: 640 }], 'grande'), u(SC, P300),
  'con solo la de 640 se reescribe a 300');
eq(coverUrl([], 'grande'), null, 'array vacío da null');
eq(coverUrl(null, 'grande'), null, 'sin array da null');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
