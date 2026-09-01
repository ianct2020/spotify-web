// Test de la comparación por VERSIÓN del tema (v=167).
//
// El caso real, medido en producción el 2026-08-29 sobre las 60 primeras
// tarjetas de `#zero-plays`: «A Different Way - DEVAULT Remix» (DJ Snake) caía
// al embed de Spotify teniendo el tema exacto en iTunes y en Deezer, porque el
// corte de `feat.` de `normText` se lleva todo hasta el final de la cadena y le
// borraba al candidato el «[DEVAULT Remix]» que va DETRÁS del «(feat. Lauv)».
//
// Lo que NO puede pasar: que arreglar eso deje sonar el remix cuando pediste
// el original a secas... salvo que sea justo el único candidato real, ver
// abajo (v=185): un pedido SIN versión ahora acepta cualquier versión del
// candidato, y «from the motion picture / soundtrack» pasa a tratarse como
// ruido de atribución, no como una versión distinta. Lo que SIGUE sin poder
// pasar es al revés: pedir un remix y que suene el original.
// Correr con: node tests/track-match-version.test.mjs

import { titleMatches, candidateScore, tokensDeVersion, tituloBase } from '../src/js/util/track-match.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

console.log('\nel caso que lo motivó');
{
  const pedido = 'A Different Way - DEVAULT Remix';
  ok(titleMatches(pedido, 'A Different Way (feat. Lauv) [DEVAULT Remix]'),
    'el remix pedido matchea el mismo remix escrito entre corchetes');
  ok(!titleMatches(pedido, 'A Different Way (feat. Lauv)'),
    'pero NO matchea el original: pediste el remix');
  ok(candidateScore({ name: pedido, artists: ['DJ Snake', 'Lauv', 'Devault'] },
    { name: 'A Different Way (feat. Lauv) [DEVAULT Remix]', artist: 'DJ Snake' }) > 0,
    'con artista y todo, el candidato correcto puntúa');
}

console.log('\ndos formas de escribir la misma versión');
{
  ok(titleMatches('Burning Piles - Slowed + Reverb', 'Burning Piles (Slowed + Reverb)'), 'guion contra paréntesis');
  ok(titleMatches('Burning Piles - Slowed', 'Burning Piles [Slowed + Reverb]'), 'una cola contenida en la otra');
  // La base también tiene que pasar la regla de los títulos cortos: «Tema» son
  // 4 caracteres y una sola palabra, así que ni siquiera llega a compararse.
  ok(!titleMatches('Tema - Slowed + Reverb', 'Tema (Slowed + Reverb)'), 'una base corta no entra por esta vía');
  ok(titleMatches('Tema Largo - Acoustic Version', 'Tema Largo (Acoustic Version)'), 'acústico');
}

console.log('\nlo que NO se puede aflojar');
{
  ok(!titleMatches('Tema Largo - DEVAULT Remix', 'Tema Largo - Otra Cosa Remix'),
    'dos remixes distintos del mismo tema no son el mismo tema');
  ok(!titleMatches('Not PLaying', 'Timeless'), 'el falso positivo de v=124 sigue rechazado');
  ok(!titleMatches('Go', 'Go Crazy'), 'los títulos cortos siguen exigiendo exacto');
  ok(!titleMatches('Go', 'Go - Remix'), 'un título corto no entra por la vía de la versión');
  ok(!titleMatches('Tema Largo Uno', 'Tema Largo Dos'), 'bases distintas no matchean');
  ok(!titleMatches('Tema Largo - DEVAULT Remix', 'Tema Largo'),
    'pedir un remix sigue sin aceptar el original — esto NO cambió');
}

console.log('\nun pedido SIN versión acepta cualquier versión del candidato (v=185)');
{
  // El caso que motivó el cambio, medido el 2026-09-01 sobre 200 tarjetas
  // reales de #skips y #sin-clasificar: pedir el tema a secas se quedaba en
  // embed cuando el único candidato real en iTunes/Deezer era una versión
  // (sped up, remix, live) y el título no traía ningún «feat.» que la
  // borrara por accidente.
  ok(titleMatches('Tema Largo', 'Tema Largo - Sped Up'),
    'pedir el original ahora SÍ acepta el sped up del candidato');
  ok(titleMatches('Tema Largo', 'Tema Largo (Live)'),
    'y también un vivo entre paréntesis');
  ok(titleMatches('A Different Way', 'A Different Way (feat. Lauv) [DEVAULT Remix]'),
    'sigue matcheando el remix cuando no se pide ninguna versión');
  // La dirección contraria NO se tocó: seguir exigiendo el remix pedido.
  ok(!titleMatches('Tema Largo - DEVAULT Remix', 'Tema Largo'),
    'pero pedir el remix sigue sin aceptar el original sin versión');
}

console.log('\n«from the motion picture / soundtrack» es ruido, no una versión (v=185)');
{
  // Medido el 2026-09-01: «Honest - From The Amazing Spider-Man 2 Soundtrack»
  // y «Time - From the Motion Picture "Amsterdam"» se quedaban en embed
  // porque «from…» no estaba en EDITION_TAIL ni en PALABRA_VERSION, así que
  // ni se borraba como ruido ni se reconocía como versión comparable.
  ok(titleMatches('Honest - From The Amazing Spider-Man 2 Soundtrack', 'Honest'),
    'la atribución a la película no impide matchear el tema limpio');
  ok(titleMatches('Time - From the Motion Picture "Amsterdam"', 'Time'),
    'lo mismo con comillas y "Motion Picture" en vez de "Soundtrack"');
  ok(tituloBase('Honest - From The Amazing Spider-Man 2 Soundtrack') === 'honest',
    'tituloBase también la descarta');
}

console.log('\n(feat. X) NO es una versión');
{
  ok(tokensDeVersion('Tema (feat. Lauv)').size === 0, '«(feat. Lauv)» no declara versión');
  ok(tokensDeVersion('Tema [DEVAULT Remix]').has('devault'), '«[DEVAULT Remix]» sí');
  ok(tokensDeVersion('Tema - DEVAULT Remix').has('remix'), 'y también detrás de un guion');
  ok(titleMatches('Cancion Larga (feat. A)', 'Cancion Larga (feat. B)'),
    'el mismo tema acreditado a invitados distintos sigue matcheando');
}

console.log('\ntituloBase');
{
  ok(tituloBase('A Different Way - DEVAULT Remix') === 'a different way', 'saca la cola detrás del guion');
  ok(tituloBase('Tema - Parte Dos') === 'tema parte dos', 'un guion que NO es versión se conserva');
}

console.log(`\n${passed} ok, ${failed} fallos`);
process.exit(failed ? 1 : 0);
