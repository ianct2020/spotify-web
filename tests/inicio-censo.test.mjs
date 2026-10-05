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

// ── 5. el inicio muestra TODAS las funciones del menú ───────────────────────
//
// El 04/10 Ian no podía abrir «W-Three» ni «Mis tapas» desde el inicio: el
// menú tenía 24 y el inicio 22. No era que la vista estuviera rota —las dos
// andaban— sino que nadie las había listado ahí, y como son dos listas
// escritas a mano no hay nada que avise.
//
// Esto es el hermano del «barrido de vistas vivas» de app.js: aquél comprueba
// que cada ruta PINTA algo; éste, que a cada ruta se puede LLEGAR desde el
// inicio. Una vista viva a la que no se llega está igual de muerta para Ian.
const rutasMenu = [...src.matchAll(/data-route="([^"]+)" href="#/g)]
  .map(m => m[1]).filter(r => r !== 'home');
const rutasInicio = tarjetas.map(t => t.hash);

const faltanEnInicio = rutasMenu.filter(r => !rutasInicio.includes(r));
const sobranEnInicio = rutasInicio.filter(r => !rutasMenu.includes(r));

comprobar('el inicio no se saltea ninguna función del menú', faltanEnInicio.length === 0,
  `en el menú y NO en el inicio: ${faltanEnInicio.join(', ')}`);
comprobar('el inicio no inventa funciones que el menú no tiene', sobranEnInicio.length === 0,
  `en el inicio y NO en el menú: ${sobranEnInicio.join(', ')}`);
comprobar('menú e inicio tienen la misma cuenta', rutasMenu.length === rutasInicio.length,
  `menú ${rutasMenu.length} · inicio ${rutasInicio.length}`);

// Y cada función se dibuja igual en los dos sitios. Como el menú ya lee de
// ICONS (bloque 3), basta con que la ruta exista en los dos: si el inicio
// apuntara a otra clave, el mismo botón tendría dos caras otra vez.
const iconoDeInicio = Object.fromEntries(tarjetas.map(t => [t.hash, t.icono]));
for (const [ruta, icono] of [...src.matchAll(/data-route="([^"]+)" href="#[^"]*">\s*<span class="nav-link-icon">\$\{ICONS\.([a-zA-Z0-9]+)\}/g)].map(m => [m[1], m[2]])) {
  if (ruta === 'home') continue;
  comprobar(`${ruta}: el menú y el inicio pintan el mismo icono`,
    iconoDeInicio[ruta] === icono, `menú ICONS.${icono} · inicio ICONS.${iconoDeInicio[ruta]}`);
}

// ── 6. las descripciones entran en la tarjeta ──────────────────────────────
//
// v=274 dejó la descripción en UNA línea y el resultado fue que se cortaban
// LAS 24, no unas pocas: a 1366 px la caja de texto mide 205 px y en una línea
// entran unos 30 caracteres, cuando la más corta de las descripciones tiene 35.
// Una descripción cortada no informa, así que ese recorte no servía a nadie.
//
// Ahora son dos líneas y se acortaron las seis que ni así entraban. Lo que se
// vigila acá es que no vuelvan a crecer.
//
// ⚠️ EL LÍMITE ES UN PROXY, y a propósito. Lo que decide de verdad es el ANCHO
// en píxeles, que depende de la tipografía y no se puede medir sin navegador.
// El número sale de medirlo: a dos líneas entraron 60 caracteres y no entraron
// 66, así que 62 deja margen sin dejar pasar ninguna de las que fallaban. Si
// una descripción futura se queda justo, el banco del inicio lo dice con
// píxeles — esto es sólo la red barata que corre en cada `npm test`.
const LIMITE = 62;
const descripciones = [...bloqueHome.matchAll(/name: '([^']+)', desc: '([^']*)' \}/g)]
  .map(m => ({ nombre: m[1], desc: m[2] }));

comprobar('se leyeron las descripciones de las 24 tarjetas',
  descripciones.length === tarjetas.length,
  `leídas ${descripciones.length} de ${tarjetas.length}`);

for (const { nombre, desc } of descripciones) {
  comprobar(`«${nombre}»: la descripción entra en dos líneas`, desc.length <= LIMITE,
    `${desc.length} caracteres (tope ${LIMITE}): ${desc}`);
  comprobar(`«${nombre}»: tiene descripción`, desc.trim().length > 0);
}

console.log(`\n  ${ok} asserts OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
