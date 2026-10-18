// tests/autocorrect-lastfm.test.mjs — la regla del autocorrect de Last.fm (v=316, tanda 65)
//
// `util/autocorrect-lastfm.js` decide si el nombre que Last.fm devolvió con `autocorrect=1` es el MISMO
// artista que el pedido. La usan `generosDeArtista()` (`#generos`) y el horneado del mapa de artistas
// (`scripts/hornear-similares.mjs`). Es una regla de ESCRITURA: `normalizarNombre`, `$` → `s`,
// `&` → ` and `, fuera la puntuación, fuera un `the ` del principio y los espacios colapsados.
//
// Lo que se vigila:
//   1. la clave de escritura, paso por paso;
//   2. sin cambio que juzgar (sin `devuelto`, o igual según `normalizarNombre`) es el mismo;
//   3. cada paso, con un nombre inventado: el `$`, el `&`, el `the`, la puntuación, el «+» roto;
//   4. un autocorrect que cambia el NOMBRE es otro, aunque se parezca (ni distancia de edición, ni prefijos);
//   5. lectura estática: sin tablas de nombres, sin red, `normalizarNombre` importada y usada por los dos.
//
// 🔴 Todo INVENTADO (el repo es público). Contra v=315 da rojo: el módulo no existía.
//
// Correr con: node tests/autocorrect-lastfm.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const cargar = async (p) => { try { return await import(pathToFileURL(join(raiz, p)).href); } catch (e) { console.log(`  (no se pudo importar ${p}: ${e.message})`); return {}; } };
const leer = (p) => { try { return readFileSync(join(raiz, p), 'utf8'); } catch { return ''; } };
const A = await cargar('src/js/util/autocorrect-lastfm.js');
const mismo = typeof A.mismoArtistaAutocorregido === 'function' ? A.mismoArtistaAutocorregido : null;
const clave = typeof A.claveEscritura === 'function' ? A.claveEscritura : null;

console.log('1. la clave de escritura');
if (clave) {
  ok(clave('  Ñandú   LÍRICO ') === 'nandu lirico', 'normalizarNombre primero: sin tildes, minúsculas, espacios colapsados');
  ok(clave('Gema$ Fríos') === 'gemas frios', '«$» → «s»');
  ok(clave('Uno & Dos') === 'uno and dos' && clave('Uno&Dos') === 'uno and dos', '«&» → « and », con o sin espacios alrededor');
  ok(clave('L.U.M.E.N.') === 'lumen' && clave('Hola! Chau!') === 'hola chau' && clave("Lil' Brasa") === 'lil brasa', 'fuera la puntuación (puntos, signos, apóstrofos)');
  ok(clave('The Linternas') === 'linternas' && clave('Linternas the Band') === 'linternas the band', 'fuera un «the » solo del principio');
  ok(clave('Faro + Brasa') === 'faro brasa' && clave('Faro   Brasa') === 'faro brasa', 'el «+» se va con la puntuación y los espacios se colapsan');
  ok(clave('Coral 99') === 'coral 99', 'los números se quedan');
  ok(clave('$$$') === 'sss' && clave('***') === '' && clave(null) === '', 'lo que queda sin letras ni números da vacío');
} else ok(false, 'claveEscritura existe');

console.log('2. sin cambio que juzgar');
if (mismo) {
  ok(mismo('Banda Inventada', null) && mismo('Banda Inventada', undefined), 'sin devuelto → true');
  ok(mismo('Banda Inventada', 'BANDA INVENTADA') && mismo('Ñandú Lírico', 'Nandu Lirico'), 'igual según normalizarNombre (mayúsculas, tildes) → true');
} else ok(false, 'mismoArtistaAutocorregido existe');

console.log('3. cada paso, con un nombre inventado');
if (mismo) {
  ok(mismo('Gemas Fríos', 'Gema$ Fríos'), 'el «$» (como un nombre escrito con «$» en vez de «s»)');
  ok(mismo('Ola & Marea', 'Ola and Marea') && mismo('Ola and Marea', 'Ola & Marea'), 'el «&» por «and», en las dos direcciones');
  ok(mismo('The Linternas', 'Linternas') && mismo('Linternas', 'The Linternas'), 'el «the» del principio, en las dos direcciones');
  ok(mismo('L.U.M.E.N', 'L*U*M*E*N') && mismo('Hola! Chau!', 'Hola Chau') && mismo("Lil Brasa", "Lil' Brasa"), 'la puntuación (puntos, asteriscos, signos, apóstrofos)');
  ok(mismo('Faro + Brasa', 'Faro   Brasa'), 'el «+» que Last.fm devuelve como espacios');
  ok(mismo('Coral', 'C.O.R.A.L.'), 'una sigla que se escribe igual (aunque pueda ser otro: la regla no lo sabe, y lo dice el reporte)');
} else ok(false, 'mismoArtistaAutocorregido existe');

console.log('4. un autocorrect que cambia el NOMBRE es otro');
if (mismo) {
  ok(!mismo('Los Faroles', 'Faroles'), '«Los X» → «X»: otro (el «los» no se saca)');
  ok(!mismo('Brasa', 'Brasas Eternas'), 'un nombre que es prefijo de otro: otro');
  ok(!mismo('Coral Uno', 'Corál Uno Dos'), 'una palabra de más: otro');
  ok(!mismo('Lumen', 'Lumens'), 'una letra de más: otro (sin distancia de edición)');
  ok(!mismo('Orquesta Marea', 'Marea'), '«Orquesta X» → «X»: otro');
  ok(!mismo('Gema/Coral', 'Gema'), 'dos artistas → uno: otro');
  ok(!mismo('***', '+++'), 'dos claves vacías no son el mismo');
} else ok(false, 'mismoArtistaAutocorregido existe');

console.log('5. lectura estática');
{
  const src = leer('src/js/util/autocorrect-lastfm.js');
  const codigo = src.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  ok(/import \{ normalizarNombre \} from '\.\/mb-pais\.js';/.test(src), 'importa normalizarNombre de mb-pais.js (ni normText ni una copia)');
  ok(!/normText|track-match/.test(codigo), 'no usa normText');
  ok(!/fetch\(|XMLHttpRequest|indexedDB|document\.|localStorage/.test(codigo), 'sin red, sin IndexedDB, sin DOM');
  ok(!/new (Set|Map)\(\[|levenshtein|distancia|score|mbid/i.test(codigo), 'sin tablas de nombres, sin distancia de edición, sin score ni mbid');
  const regla = leer('src/js/util/generos-regla.js');
  const horneado = leer('scripts/hornear-similares.mjs');
  ok(/import \{ mismoArtistaAutocorregido \} from '\.\/autocorrect-lastfm\.js';/.test(regla), 'generos-regla.js la importa');
  ok(/import \{ mismoArtistaAutocorregido \} from '\.\.\/src\/js\/util\/autocorrect-lastfm\.js';/.test(horneado), 'y el horneado del mapa también: una sola regla');
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} autocorrect-lastfm: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
