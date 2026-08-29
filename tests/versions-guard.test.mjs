// La guarda del último ejemplar (2026-08-28).
//
// El bug que la motiva: de 539 me gusta perdidos, 123 no tenían NINGUNA otra
// copia viva. El chequeo que había razonaba por cluster («¿este grupo tiene
// alguna marcada con quedarme?»), y eso pasa aunque la pista que se borra sea
// la única de su canción — basta con que otra pista distinta haya caído en el
// mismo cluster por un fallo de normalización.
//
// Lo que este test afirma: **ninguna pista puede quedar en cero copias**, ni
// por un cluster mal armado, ni por metadatos vacíos, ni por un índice viejo.
//
// Correr con: node tests/versions-guard.test.mjs

import { guardaUltimoEjemplar, indexarBiblioteca, normalizeKey } from '../src/js/util/versions-guard.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

const t = (id, name, artist, album = 'Álbum') => ({
  track: { id, name, artists: [{ name: artist }], album: { name: album } },
});

console.log('\n1. El caso bueno: borrar duplicados dejando uno');
{
  const likes = [t('a1', 'Wonderwall', 'Oasis'), t('a2', 'Wonderwall', 'Oasis'), t('a3', 'Wonderwall', 'Oasis')];
  const idx = indexarBiblioteca(likes);
  const v = guardaUltimoEjemplar([likes[1], likes[2]], idx);
  ok(v.length === 0, 'borrar 2 de 3 copias no viola nada');
}

console.log('\n2. EL CASO DE LAS 123: borrar la única copia');
{
  const likes = [t('solo', 'Bad Decisions', 'Ariana Grande')];
  const idx = indexarBiblioteca(likes);
  const v = guardaUltimoEjemplar([likes[0]], idx);
  ok(v.length === 1, 'borrar la única copia se detecta');
  ok(/ninguna copia viva/.test(v[0]?.motivo || ''), 'el motivo dice que quedaría sin copias');
}

console.log('\n3. Borrar TODAS las copias de una canción');
{
  const likes = [t('b1', 'Die For You', 'The Weeknd'), t('b2', 'Die For You', 'The Weeknd')];
  const idx = indexarBiblioteca(likes);
  const v = guardaUltimoEjemplar([likes[0], likes[1]], idx);
  ok(v.length === 2, 'borrar las 2 de 2 viola para ambas, no solo la última');
}

console.log('\n4. El cluster mal armado (el agujero del chequeo viejo)');
{
  // Dos canciones DISTINTAS que un cluster juntó. El chequeo por cluster pasa
  // (hay una marcada), pero la segunda es la única de lo suyo.
  const likes = [
    t('c1', 'Song A', 'Artista A'),
    t('c2', 'Song A', 'Artista A'),
    t('c3', 'Song B', 'Artista B'),
  ];
  const idx = indexarBiblioteca(likes);
  ok(normalizeKey(likes[0].track) !== normalizeKey(likes[2].track), 'son claves distintas de verdad');
  const v = guardaUltimoEjemplar([likes[1], likes[2]], idx);
  ok(v.length === 1, 'protege la única copia de Song B aunque el lote traiga un duplicado legítimo');
  ok(v[0].track.id === 'c3', 'señala exactamente cuál');
}

console.log('\n5. Pistas fantasma: nunca se borran');
{
  const likes = [
    { track: { id: 'f1', name: '', artists: [{ name: '' }], album: { name: '' } } },
    { track: { id: 'f2', name: '', artists: [{ name: '' }], album: { name: '' } } },
  ];
  const idx = indexarBiblioteca(likes);
  ok(idx.size === 0, 'los fantasmas no entran al índice');
  const v = guardaUltimoEjemplar([likes[0]], idx);
  ok(v.length === 1, 'borrar un fantasma se bloquea');
  ok(/sin metadatos/.test(v[0].motivo), 'el motivo lo dice');
}

console.log('\n6. Índice viejo: la pista no figura en el análisis');
{
  const likes = [t('d1', 'Yours', 'Conan Gray')];
  const idx = indexarBiblioteca(likes);
  const forastera = t('zzz', 'Otra Canción', 'Otro');
  const v = guardaUltimoEjemplar([forastera], idx);
  ok(v.length === 1, 'una pista fuera del índice se bloquea en vez de pasar');
  ok(/análisis actual/.test(v[0].motivo), 'el motivo pide re-analizar');
}

console.log('\n7. Copias en clusters ocultos también cuentan como gemelo');
{
  // indexarBiblioteca mira TODOS los likes, no solo los clusters listados.
  const likes = [t('e1', 'Stitches', 'Shawn Mendes'), t('e2', 'Stitches', 'Shawn Mendes')];
  const idx = indexarBiblioteca(likes);
  ok(idx.get(normalizeKey(likes[0].track)).size === 2, 'el índice ve las 2 copias');
  ok(guardaUltimoEjemplar([likes[0]], idx).length === 0, 'borrar una deja la otra: permitido');
}

console.log('\n8. Versiones distintas NO son gemelas entre sí');
{
  // «Live» es marcador de versión: son canciones distintas para la clave. Si
  // tenés el estudio y el live, borrar el live lo deja en cero.
  const likes = [t('g1', 'Creep', 'Radiohead'), t('g2', 'Creep - Live', 'Radiohead')];
  const idx = indexarBiblioteca(likes);
  ok(normalizeKey(likes[0].track) !== normalizeKey(likes[1].track), 'estudio y live tienen claves distintas');
  const v = guardaUltimoEjemplar([likes[1]], idx);
  ok(v.length === 1, 'borrar el live, que es único, se bloquea');
}

console.log(`\n${passed} pasaron, ${failed} fallaron\n`);
process.exit(failed ? 1 : 0);
