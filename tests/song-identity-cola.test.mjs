// La cola de versión detrás del guion (2026-10-04, v=271).
//
// El paso 4 (v=270) arregló el corte de feat/ft/with con `\b` y, al dejar de
// cortar en «with» a lo bruto, destapó siete colas de versión que `REMIX_TAIL`
// no cubría: «In A Perfect World (with Julia Michaels) - Sped Up» dejó de ser
// el mismo tema que su base, porque antes el corte de «with» se llevaba la
// cola entera por delante. Esta tanda amplía `REMIX_TAIL` con esas colas.
//
// ⚠️ EL ASSERT QUE MANDA ES EL 3. El riesgo de esta regla es el OPUESTO al de
// la anterior: «Sped Up», «Piano», «reimagined», «Refix» y «Raw Rhymes» son
// palabras que también aparecen en títulos de verdad. Lo único que separa una
// cola de versión de un título que usa la misma palabra es el GUION, y por eso
// `REMIX_TAIL` lo exige. «The One With The Wurlitzer» y «The One with the
// Piano» (American Football) son temas DISTINTOS, no llevan guion, y hasta
// v=269 agrupaban juntos por el bug del corte de «with». El paso 4 los separó
// y eso fue una MEJORA: no se puede deshacer.
//
// ⚠️ `scripts/gen-stats.py` tiene el espejo de esto (`REMIX_TAIL_RE`). Si tocás
// uno, tocá el otro, o el `gid` horneado agrupa distinto que BYOH.
//
// Correr con: node tests/song-identity-cola.test.mjs

import { songKey } from '../src/js/util/song-identity.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
const mismo = (a, b, art) => songKey(a, art) === songKey(b, art);

console.log('\n1. Las siete colas que el paso 4 destapó vuelven a agrupar');
{
  const casos = [
    ['Dean Lewis',   'In A Perfect World (with Julia Michaels)',              'In A Perfect World (with Julia Michaels) - Sped Up'],
    ['Tainy',        'Agua (with J Balvin)',                                  'Agua (with J Balvin) - Music From "Sponge On The Run" Movie'],
    ['Dan + Shay',   '10,000 Hours (with Justin Bieber)',                     '10,000 Hours (with Justin Bieber) - Piano'],
    ['renforshort',  'fuck, i luv my friends',                                'fuck, i luv my friends (with Curtis Waters) - reimagined'],
    ['teo glacier',  'close with desires (right person wrong timing)',        'close with desires (right person wrong timing) - Sped Up'],
    ['MF DOOM',      'Go With the Flow',                                      'Go With the Flow - Raw Rhymes'],
    ['Jorja Smith',  'Greatest Gift (feat. Lila Iké)',                        'Greatest Gift - Groove Chronicles Broken Soul Refix'],
  ];
  for (const [art, base, variante] of casos) {
    ok(mismo(base, variante, art), `${art}: «${variante}» es el mismo tema que su base`);
  }
}

console.log('\n2. Las otras formas de escribir la misma cola');
{
  ok(mismo('Shake Up Christmas', 'Shake Up Christmas - Sped-Up', 'Train'), 'con guion interno: «Sped-Up»');
  ok(mismo('Heat Waves', 'Heat Waves - Slowed', 'Glass Animals'), '«- Slowed» a secas');
  ok(mismo('Gilded Lily', 'Gilded Lily - Slowed + Reverb', 'Cults'), '«- Slowed + Reverb»');
  ok(mismo('Pug', 'Pug - Matt Walker Reimagined/2014', 'The Smashing Pumpkins'), 'con el autor delante: «- Matt Walker Reimagined»');
  ok(mismo("Where's My Love", "Where's My Love - Piano Solo", 'SYML'), '«- Piano Solo»');
}

console.log('\n3. ⚠️ EL ASSERT QUE MANDA: sin guion, la palabra es parte del TÍTULO');
{
  const AF = 'American Football';
  ok(!mismo('The One With The Wurlitzer', 'The One with the Piano', AF),
     'American Football: «The One with the Piano» NO es «The One With The Wurlitzer»');
  ok(songKey('The One with the Piano', AF) === 'the one with the piano||american football',
     '«Piano» se queda en la clave: no hay guion que lo convierta en cola');
  ok(!mismo('Raw', 'Raw Rhymes', 'Artista'), 'sin guion, «Raw Rhymes» no se corta');
  ok(!mismo('Tema', 'Tema Sped Up', 'Artista'), 'sin guion, «Sped Up» no se corta');
  ok(!mismo('Music', 'Music From Home', 'Artista'), 'sin guion, «Music From» no se corta');
}

console.log('\n4. Las dos colas que van como FRASE y no como palabra suelta');
{
  // `rhymes` y `from` sueltos son más anchos de lo que se pidió: se midieron
  // las dos formas sobre los 52.704 ids del horneado y la frase alcanza.
  ok(!mismo('Nursery', 'Nursery - Children Rhymes', 'Artista'),
     '«- Children Rhymes» no se corta: la regla pide «raw rhymes» entero');
  ok(!mismo('This Is Me', 'This Is Me - A Letter From Home', 'Artista'),
     '«- A Letter From Home» no se corta: la regla pide «music from» entero');
}

console.log(`\n${passed} pasaron, ${failed} fallaron\n`);
process.exit(failed ? 1 : 0);
