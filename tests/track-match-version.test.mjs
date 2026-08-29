// Test de la comparación por VERSIÓN del tema (v=167).
//
// El caso real, medido en producción el 2026-08-29 sobre las 60 primeras
// tarjetas de `#zero-plays`: «A Different Way - DEVAULT Remix» (DJ Snake) caía
// al embed de Spotify teniendo el tema exacto en iTunes y en Deezer, porque el
// corte de `feat.` de `normText` se lleva todo hasta el final de la cadena y le
// borraba al candidato el «[DEVAULT Remix]» que va DETRÁS del «(feat. Lauv)».
//
// Lo que NO puede pasar: que arreglar eso deje sonar el original cuando pediste
// el remix, o el remix cuando pediste el original.
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
