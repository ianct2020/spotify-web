// Suite «el fondo negro» (v=286): `overflow-x` NO puede ser `hidden` en los dos
// elementos que envuelven a toda la app.
//
// La regla de CSS que está detrás: si un eje del overflow no es `visible`, el
// otro deja de serlo y COMPUTA `auto`. O sea que un `overflow-x: hidden` sin
// `overflow-y` declarado convierte al elemento en contenedor de scroll aunque
// nadie lo haya pedido, y eso rompe DOS cosas que no se parecen entre sí:
//
//   1. `position: sticky` adentro se pega al scrollport de ESE elemento, que no
//      scrollea, así que se va con la página como si fuera `static`. Es lo que
//      documenta el comentario de `body` desde v=216, y lo que volvió a pasar
//      en `.main` bajo 600 px hasta v=286: el Wrapped quedaba NEGRO en móvil
//      (`.wr-ap-clavado` a y=1200 daba −1002 en vez de 0, medido a 390×844).
//   2. `scrollRootOf()` sube buscando el primer ancestro con `overflow-y` en
//      `auto`/`scroll`, y encontraba ese contenedor falso. Las vistas que
//      pintan por lotes le pasaban entonces un root que no scrollea: el
//      centinela queda a la vista para siempre y entran TODOS los ítems de una.
//      Medido a 390 con dos cargas distintas: `#skips` 1.024 tarjetas de una
//      contra 81, `#zeroplays` 490 contra 81, `#covers` 2.469 contra 601.
//
// `clip` recorta exactamente igual y no crea contenedor de scroll, así que es
// el valor correcto en los dos sitios. Detalle y mediciones en
// `fonoteca-migracion/RESUMEN-EL-FONDO-NEGRO-2026-10-08.md`.
//
// Esto lee la HOJA porque un layout no se monta en Node. Lo que sí se midió en
// el DOM real está en el resumen. La última parte del banco prueba el contrato
// de `scrollRootOf()` contra la función de verdad, que es la mitad que una
// guarda de CSS sola no cubre.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { scrollRootOf } from '../src/js/ui/incremental-list.js';

let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };
const eq = (a, b, msg) => { n++; assert.strictEqual(a, b, msg); };

const crudo = readFileSync(new URL('../src/css/main.css', import.meta.url), 'utf8');
const css = crudo.replace(/\/\*[\s\S]*?\*\//g, '');   // sin comentarios: el porqué vive ahí y menciona `hidden`

// El cuerpo de la regla cuyo selector es EXACTAMENTE `selector`, dentro de
// `dentroDe` si se pasa (un trozo de la hoja ya recortado).
function regla(selector, fuente = css) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}{\\s])${esc}\\s*\\{([^}]*)\\}`).exec(fuente);
  return m ? m[1] : null;
}
const prop = (cuerpo, nombre) => {
  const m = cuerpo && cuerpo.match(new RegExp(`(?:^|[;\\s])${nombre}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
};

// ── 1. `body` (v=216) ────────────────────────────────────────────────────────
const cuerpoBody = regla('body');
ok(cuerpoBody, 'guarda del guarda: la regla de `body` tiene que existir en main.css');
eq(prop(cuerpoBody, 'overflow-x'), 'clip',
   '`body` tiene que llevar `overflow-x: clip`; con `hidden` el sticky de toda la app deja de pegarse (v=216)');

// ── 2. `.main` dentro del media de 600 px (v=286) ───────────────────────────
//
// El media de móvil se recorta a mano: el cuerpo de un `@media` tiene llaves
// anidadas y un regex de `[^}]*` no sirve para encontrarlo.
// Hay varios `@media (max-width: 600px)`; el de `.main` es el bloque de layout.
const medias = [];
{
  let desde = 0, i;
  while ((i = css.indexOf('@media (max-width: 600px)', desde)) >= 0) {
    let j = css.indexOf('{', i), prof = 0;
    for (let k = j; k < css.length; k++) {
      if (css[k] === '{') prof++;
      else if (css[k] === '}') { prof--; if (prof === 0) { medias.push(css.slice(j + 1, k)); desde = k; break; } }
    }
    if (desde <= i) break;
  }
}
ok(medias.length > 0, 'guarda del guarda: tiene que haber al menos un `@media (max-width: 600px)`');
const conMain = medias.filter(b => regla('.main', b) !== null);
eq(conMain.length, 1, 'tiene que haber UNA sola regla `.main` bajo 600 px: dos se pisarían en silencio');
const cuerpoMain = regla('.main', conMain[0]);
eq(prop(cuerpoMain, 'overflow-x'), 'clip',
   '`.main` bajo 600 px tiene que llevar `overflow-x: clip`; con `hidden` el Wrapped queda negro en móvil y las listas por lotes pierden su root');
eq(prop(cuerpoMain, 'overflow-y'), null,
   '`.main` bajo 600 px no declara `overflow-y`, y por eso importa que la x sea `clip` y no `hidden`');

// Y el porqué tiene que seguir escrito donde se lee: una regla sin su motivo se
// deshace sola la próxima vez que alguien quiera «arreglar un desborde».
ok(/clip.*\bhidden\b|\bhidden\b.*clip/s.test(crudo.slice(Math.max(0, crudo.indexOf('Mobile responsive') - 2000), crudo.indexOf('Mobile responsive') + 2000)),
   'el comentario que explica por qué `clip` y no `hidden` tiene que seguir al lado de la regla de móvil');

// ── 3. el contrato de `scrollRootOf()`, contra la función de verdad ─────────
//
// Es la mitad que la guarda de CSS no cubre: lo que hace daño no es el valor en
// la hoja sino que un ancestro compute `overflow-y: auto`. Con un DOM de
// mentira se prueba que la función se queda con el PRIMERO que lo tenga.
function nodoFalso(overflowY, padre = null) {
  const el = { __oy: overflowY, parentElement: padre };
  return el;
}
const guardado = globalThis.getComputedStyle;
const guardadoDoc = globalThis.document;
globalThis.getComputedStyle = (el) => ({ overflowY: el.__oy });
globalThis.document = { body: { __oy: 'visible' }, documentElement: { __oy: 'visible' } };
try {
  const raiz = nodoFalso('visible', globalThis.document.body);
  const mainVisible = nodoFalso('visible', raiz);
  const grid = nodoFalso('visible', mainVisible);
  eq(scrollRootOf(grid), null,
     'sin ningún ancestro scrolleable, el root es el viewport (null) — que es lo que las vistas dan por sentado');

  const mainAuto = nodoFalso('auto', raiz);          // lo que producía `overflow-x: hidden`
  const grid2 = nodoFalso('visible', mainAuto);
  eq(scrollRootOf(grid2), mainAuto,
     'un ancestro con `overflow-y: auto` SE LLEVA el root aunque no scrollee: ese era el bug de `.main` con `hidden`');

  const propio = nodoFalso('auto', mainAuto);        // una lista con overflow propio
  const grid3 = nodoFalso('visible', propio);
  eq(scrollRootOf(grid3), propio,
     'gana el más cercano: una lista con overflow propio no la afecta el de `.main`');
} finally {
  globalThis.getComputedStyle = guardado;
  globalThis.document = guardadoDoc;
}

console.log(`overflow-clip-sticky: ${n} asserts OK`);
