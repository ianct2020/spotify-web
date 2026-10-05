// El inicio: que cada función tenga icono PROPIO y que el menú no se separe.
//
// POR QUÉ ESTA SUITE EXISTE
//
// Hasta v=273 el inicio y el menú lateral eran **dos listas separadas** del
// mismo juego de funciones, cada una con su copia del icono. Divergieron en
// silencio, que es como fallan estas cosas: la vista se pinta igual, nada
// lanza, ningún test salta, y sólo se nota mirando las dos a la vez.
//
// Lo que había el 2026-10-05, medido sobre `src/js/app.js`:
//   · `ICONS.search` (la lupa) en TRES tarjetas — «Buscar likes», «Sin
//     escuchar de tus artistas» y «Seguir artistas». Ian reportó dos; eran tres.
//   · `ICONS.records` (el trofeo) en DOS — «Récords» y «Novedades».
//   · El menú tenía 24 funciones y el inicio 22: faltaban «Mis tapas» y
//     «W-Three», y no se podían abrir desde el inicio.
//
// Las 19 geometrías de `ICONS` eran todas distintas entre sí: el defecto no
// estaba en los dibujos sino en la ASIGNACIÓN. Por eso lo que se afirma acá
// no es cómo es cada icono, sino que **no haya dos tarjetas con el mismo**.
//
// Corre sin navegador y sin token.
// Correr con: node tests/inicio-censo.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(raiz, 'src/js/app.js'), 'utf8');

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? '\n         ' + detalle : ''}`);
}

// ── lo que hay en el archivo ────────────────────────────────────────────────
const ICONS = {};
for (const m of src.match(/^const ICONS = \{(.*?)^\};/ms)[1].matchAll(/^  ([a-zA-Z0-9]+): '(.*)',$/gm)) {
  ICONS[m[1]] = m[2];
}

const bloqueHome = src.match(/^const HOME_SECTIONS = \[(.*?)^\];/ms)[1];
const tarjetas = [...bloqueHome.matchAll(/\{ hash: '([^']+)', icon: ICONS\.([a-zA-Z0-9]+), name: '([^']+)'/g)]
  .map(m => ({ hash: m[1], icono: m[2], nombre: m[3] }));

// ── 1. ninguna tarjeta del inicio repite icono ──────────────────────────────
// Es el fallo que Ian vio con las capturas delante: dos lupas iguales.
const porIcono = {};
for (const t of tarjetas) (porIcono[t.icono] = porIcono[t.icono] || []).push(t.nombre);
for (const [icono, quienes] of Object.entries(porIcono)) {
  comprobar(`ICONS.${icono} lo usa una sola tarjeta`, quienes.length === 1,
    `lo comparten: ${quienes.join(' · ')}`);
}

// ── 2. y los dibujos tampoco se repiten entre sí ────────────────────────────
// Que cada tarjeta apunte a una clave distinta no alcanza: dos claves podrían
// tener la MISMA geometría y en pantalla volverían a ser dos lupas. Se compara
// el SVG, que es lo que el ojo ve, no el nombre.
const porGeometria = {};
for (const t of tarjetas) {
  const g = ICONS[t.icono];
  comprobar(`ICONS.${t.icono} existe`, typeof g === 'string' && g.length > 0);
  (porGeometria[g] = porGeometria[g] || []).push(`${t.nombre} (ICONS.${t.icono})`);
}
for (const quienes of Object.values(porGeometria)) {
  comprobar('dos tarjetas no pintan el mismo dibujo', quienes.length === 1,
    `mismo SVG: ${quienes.join(' · ')}`);
}

// ── 3. el menú no tiene su propia copia del icono ───────────────────────────
// La raíz del defecto: el <aside> traía los SVG escritos a mano, así que el
// mismo botón podía dibujarse distinto en el menú y en el inicio — y así fue
// en tres rutas. Desde v=274 el menú lee de ICONS y no puede volver a irse.
const sueltos = [...src.matchAll(/<span class="nav-link-icon">(?!\$\{ICONS\.)(.*?)<\/span>/gs)]
  .map(m => m[1].slice(0, 40));
comprobar('el menú no escribe iconos a mano, los lee de ICONS', sueltos.length === 0,
  `sueltos: ${sueltos.join(' | ')}`);

// ── 4. la firma de la casa, en todos ────────────────────────────────────────
// Sin librería de iconos: son SVG en línea con un trazo único. Si alguien pega
// uno de otra fuente, se nota acá y no en producción. Y `currentColor` es lo
// que hace que sigan la paleta de Ian sin que nadie la toque.
for (const [k, g] of Object.entries(ICONS)) {
  comprobar(`ICONS.${k}: viewBox de la casa`, g.includes('viewBox="0 0 24 24"'));
  comprobar(`ICONS.${k}: hereda el color`, g.includes('currentColor'), g.slice(0, 60));
  comprobar(`ICONS.${k}: sin color escrito a mano`, !/#[0-9a-fA-F]{3,6}/.test(g), g.slice(0, 60));
}

console.log(`\n  ${ok} asserts OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
