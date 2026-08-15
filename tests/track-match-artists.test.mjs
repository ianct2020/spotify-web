// Test del match de previews contra VARIOS artistas (v=142).
// El caso real: VULTURES 1 está acreditado a «¥$» (alias de Kanye West + Ty
// Dolla $ign) y los proveedores lo listan como "Kanye West & Ty Dolla $ign".
// Contra «¥$» no matchea nunca, así que el álbum entero caía al embed de
// Spotify. Lo que NO puede pasar: que aflojar esto deje entrar temas
// equivocados del mismo artista.
// Correr con: node tests/track-match-artists.test.mjs

import { candidateScore, artistMatches, preferredQueryArtists, artistList } from '../src/js/util/track-match.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

const VULTURES = ['¥$', 'Kanye West', 'Ty Dolla $ign'];

console.log('\nel alias solo — como estaba hasta v=141');
{
  ok(!artistMatches('¥$', 'Kanye West & Ty Dolla $ign'), '«¥$» no matchea «Kanye West & Ty Dolla $ign»');
  ok(candidateScore({ name: 'CARNIVAL', artist: '¥$' }, { name: 'CARNIVAL', artist: 'Kanye West & Ty Dolla $ign' }) === 0,
    'con un solo artista el candidato correcto se rechaza');
}

console.log('\ncon la lista entera de artistas');
{
  ok(artistMatches(VULTURES, 'Kanye West & Ty Dolla $ign'), 'la lista matchea al candidato');
  ok(candidateScore({ name: 'CARNIVAL', artists: VULTURES }, { name: 'CARNIVAL', artist: 'Kanye West & Ty Dolla $ign' }) > 0,
    'CARNIVAL matchea');
  ok(candidateScore({ name: 'BURN', artists: VULTURES }, { name: 'BURN', artist: '¥$, Kanye West, Ty Dolla $ign' }) > 0,
    'BURN matchea aunque el candidato traiga el alias adelante');
  ok(candidateScore({ name: 'PAID', artists: VULTURES }, { name: 'PAID', artist: 'Kanye West, Ty Dolla $ign & Playboi Carti' }) > 0,
    'PAID matchea con un invitado de más en el candidato');
}

console.log('\nel candidato también puede venir con el alias (Deezer)');
{
  // Deezer lista las pistas de VULTURES 1 con el artista «¥$» a secas. Sin la
  // comparación por nombre crudo no hay match posible: normalizado queda vacío.
  ok(artistMatches(VULTURES, '¥$'), 'la lista matchea a un candidato que es solo «¥$»');
  ok(candidateScore({ name: 'BURN', artists: VULTURES }, { name: 'BURN', artist: '¥$' }) > 0, 'BURN de Deezer matchea');
  ok(candidateScore({ name: 'STARS', artists: VULTURES }, { name: 'STARS', artist: '¥$' }) > 0, 'STARS de Deezer matchea');
  ok(candidateScore({ name: 'BURN', artists: VULTURES }, { name: 'BURN', artist: '∆' }) === 0, 'otro alias raro NO matchea');
}

console.log('\nlo que NO se relajó');
{
  // El bug de v=125: pedir "Not PLaying" y que sonara "Timeless".
  ok(candidateScore({ name: 'Not PLaying', artists: ['Playboi Carti'] }, { name: 'Timeless', artist: 'The Weeknd & Playboi Carti' }) === 0,
    'otro tema del mismo artista sigue rechazado');
  // Títulos de una palabra o ≤4 caracteres: igualdad exacta.
  ok(candidateScore({ name: 'Go', artists: VULTURES }, { name: 'Go Crazy', artist: 'Kanye West' }) === 0,
    '«Go» no matchea «Go Crazy»');
  ok(candidateScore({ name: '24', artists: ['Bruno Mars'] }, { name: '24K Magic', artist: 'Bruno Mars' }) === 0,
    '«24» no matchea «24K Magic»');
  // Un artista de la lista que no tiene nada que ver no habilita nada por sí solo.
  ok(candidateScore({ name: 'CARNIVAL', artists: VULTURES }, { name: 'CARNIVAL', artist: 'The Cardigans' }) === 0,
    'un candidato de otro artista sigue rechazado con lista y todo');
}

console.log('\norden de búsqueda y armado de la lista');
{
  ok(preferredQueryArtists(VULTURES)[0] === 'Kanye West', 'busca primero por un nombre buscable, no por «¥$»');
  ok(preferredQueryArtists(VULTURES).includes('¥$'), 'el alias igual queda en la lista');
  ok(artistList({ artist: 'Kanye West', artists: ['Kanye West', 'Ty Dolla $ign'] }).length === 2, 'artist + artists sin duplicados');
  ok(artistList({ artists: [{ name: 'Drake' }, { name: 'PARTYNEXTDOOR' }] }).join('|') === 'Drake|PARTYNEXTDOOR', 'acepta objetos {name}');
  ok(artistList({ artist: '' }).length === 0, 'sin artistas la lista queda vacía');
}

console.log(`\n${passed} pasaron, ${failed} fallaron\n`);
process.exit(failed ? 1 : 0);
