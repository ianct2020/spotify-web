// La guarda de la cadena de artistas (v=150).
//
// El bug: la ficha de artista se abría con la CADENA UNIDA como si fuera el
// nombre de un artista solo. Abrir la ficha desde «I Smoked Away My Brain
// (feat. Imogen Heap & Clams Casino)» abría «A$AP Rocky, Imogen Heap, Clams
// Casino» y devolvía «No aparece en tu historial», gráfico vacío y «0 likes»
// — para el segundo artista más escuchado de Ian.
//
// Lo que este test afirma: **una cadena unida no puede terminar en una consulta
// al historial**. El historial se cruza por igualdad exacta de nombre, así que
// alcanza con demostrar que lo que sale de la guarda nunca es la cadena.
//
// Correr con: node tests/artist-name-guard.test.mjs

import {
  firstArtistName,
  artistNames,
  looksLikeArtistChain,
  splitArtistChain,
  resolveArtistName,
  resolveArtistList,
} from '../src/js/util/artist-name.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}

// Índice de artistas conocidos de mentira, con los nombres reales del historial
// de Ian que importan para estos casos.
const HISTORIAL = new Set([
  'a$ap rocky', 'imogen heap', 'clams casino', 'brent faiyaz',
  'tyler, the creator', 'jozzy', 'hanumankind', 'kalmi',
  'eric clapton', 'kanye west', 'ty dolla $ign', '¥$',
]);
const conocido = (n) => HISTORIAL.has(String(n).toLowerCase());

console.log('\nlo que ya existía sigue igual');
{
  ok(firstArtistName({ name: 'Drake' }) === 'Drake', 'firstArtistName con objeto');
  ok(firstArtistName('Drake') === 'Drake', 'firstArtistName con string');
  // El like real con `artists: [{id, name: ""}]` que tiró abajo el orden
  // «Por artista» en v=138.
  ok(firstArtistName({ id: 'x', name: '' }) === '', 'nombre vacío devuelve cadena vacía, no el objeto');
  ok(artistNames({ artists: [{ name: 'A' }, { name: '' }, { name: 'B' }] }).join('|') === 'A|B',
    'artistNames descarta los vacíos');
}

console.log('\ndetectar la forma de cadena');
{
  ok(looksLikeArtistChain('A$AP Rocky, Imogen Heap'), 'con coma + espacio es sospechosa');
  ok(!looksLikeArtistChain('Drake'), 'un nombre suelto no lo es');
  ok(!looksLikeArtistChain(''), 'la cadena vacía no lo es');
  ok(splitArtistChain('A, B, C').join('|') === 'A|B|C', 'parte en tres');
}

console.log('\nEL CASO DEL BUG: la cadena nunca sale entera');
{
  const cadena = 'A$AP Rocky, Imogen Heap, Clams Casino';
  const salida = resolveArtistName(cadena, conocido);
  ok(salida === 'A$AP Rocky', 'devuelve el primer artista, no la cadena');
  ok(salida !== cadena, 'NO devuelve la cadena entera');
  ok(conocido(salida), 'lo que devuelve SÍ existe en el historial');

  const otra = 'A$AP Rocky, Brent Faiyaz';
  ok(resolveArtistName(otra, conocido) === 'A$AP Rocky', 'la cadena de dos también');
}

console.log('\nlos artistas con coma en el nombre NO se rompen');
{
  // Es el caso que hace que partir por coma a ciegas esté mal. Está en los
  // likes de Ian: «FISH N STEAK (WHAT IT IS) (feat. Tyler, The Creator & Jozzy)».
  ok(resolveArtistName('Tyler, The Creator', conocido) === 'Tyler, The Creator',
    '«Tyler, The Creator» se respeta entero');
  ok(resolveArtistName('Tyler, The Creator, Jozzy', conocido) === 'Tyler, The Creator',
    'y también cuando viene con un invitado detrás');
  ok(resolveArtistName('A$AP Rocky, Tyler, The Creator, Jozzy', conocido) === 'A$AP Rocky',
    'con el primero conocido gana el primero');
}

console.log('\nsin índice, el fallback es seguro (nunca la cadena)');
{
  const sinIndice = resolveArtistName('A$AP Rocky, Imogen Heap', undefined);
  ok(sinIndice === 'A$AP Rocky', 'sin índice devuelve el primer segmento');
  ok(!looksLikeArtistChain(sinIndice), 'y lo que devuelve ya no es una cadena');

  const desconocido = resolveArtistName('Fulano, Mengano', conocido);
  ok(desconocido === 'Fulano', 'artistas que no están en el historial: primer segmento');
  ok(!looksLikeArtistChain(desconocido), 'tampoco sale una cadena de ahí');
}

console.log('\nla invariante, sobre todos los casos de una vez');
{
  const entradas = [
    'A$AP Rocky, Imogen Heap, Clams Casino',
    'A$AP Rocky, Brent Faiyaz',
    'Hanumankind, Kalmi, A$AP Rocky',
    '¥$, Kanye West, Ty Dolla $ign',
    'Tyler, The Creator, Jozzy',
    'Fulano, Mengano, Zutano',
    'Drake',
    '',
  ];
  const salidas = entradas.map(e => resolveArtistName(e, conocido));
  // La invariante que importa: nada de lo que sale puede seguir siendo una
  // cadena de varios artistas, porque eso es lo que se le consulta al historial.
  const culpables = entradas.filter((e, i) => looksLikeArtistChain(e) && looksLikeArtistChain(salidas[i]) && !conocido(salidas[i]));
  ok(culpables.length === 0,
    `ninguna cadena sobrevive a la guarda (${culpables.length} culpables)`);
  // Y lo que sale de una cadena tiene que ser uno de sus pedazos, no algo nuevo.
  const inventados = entradas.filter((e, i) => e && !e.includes(salidas[i]));
  ok(inventados.length === 0, 'la guarda no inventa nombres, recorta');
}

console.log('\nresolveArtistList: el array manda siempre');
{
  const conArray = resolveArtistList(
    { artists: [{ name: 'A$AP Rocky' }, { name: 'Imogen Heap' }], artist: 'la cadena que sea' },
    conocido,
  );
  ok(conArray.join('|') === 'A$AP Rocky|Imogen Heap', 'con array se ignora el `artist` suelto');

  const soloCadena = resolveArtistList({ artist: 'A$AP Rocky, Imogen Heap, Clams Casino' }, conocido);
  ok(soloCadena.join('|') === 'A$AP Rocky|Imogen Heap|Clams Casino',
    'sin array, la cadena se parte en la lista entera');
  ok(!soloCadena.some(looksLikeArtistChain), 'y ningún elemento de la lista es otra cadena');

  const conComa = resolveArtistList({ artist: 'Tyler, The Creator, Jozzy' }, conocido);
  ok(conComa[0] === 'Tyler, The Creator', 'el artista con coma queda entero como primero');
  ok(conComa.join('|') === 'Tyler, The Creator|Jozzy', 'y el invitado queda aparte');

  ok(resolveArtistList({}, conocido).length === 0, 'sin nada devuelve lista vacía');
  ok(resolveArtistList({ artist: 'Drake' }, conocido).join('|') === 'Drake', 'un artista solo pasa igual');
}

console.log(`\n${passed} pasaron, ${failed} fallaron\n`);
process.exit(failed ? 1 : 0);
