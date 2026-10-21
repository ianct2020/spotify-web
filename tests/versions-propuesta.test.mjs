// #versions: la propuesta de edición NO tilda nada sola ni en lote (tanda 70).
//
// Lectura estática de `src/js/features/versions.js`, sin navegador. Lo que
// vigila es la decisión de Ian: «yo solo confirme», grupo por grupo.
//
//   1. `keepIds` se llena en UN solo sitio: el `change` del checkbox «quedarme».
//      «Aceptar propuesta» no lo toca: tilda la casilla y dispara ese mismo
//      `change`, o sea el camino del clic a mano.
//   2. «Aceptar propuesta» solo mira las casillas de SU tarjeta
//      (`btn.closest('.cluster-group')`), nunca el documento ni `allClusters`
//      entero.
//   3. No hay ningún «Aceptar todas» ni otro botón que acepte varias.
//   4. `render()` (abrir la vista) no calcula ninguna propuesta: eso pasa
//      después de «Analizar», y abrir sigue costando 0.
//   5. El borrado no cambió: `borrarLikesVerificado` con `'ultimo-ejemplar'`.
//
// Correr con: node tests/versions-propuesta.test.mjs

import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const fuente = readFileSync(new URL('../src/js/features/versions.js', import.meta.url), 'utf8');
let n = 0;
const ok = (c, msg) => { n++; assert.ok(c, msg); };

// El cuerpo de una función de nivel superior, hasta la siguiente que empiece en la columna 0.
function cuerpo(nombre) {
  const i = fuente.search(new RegExp(`^(export )?(async )?function ${nombre}\\(`, 'm'));
  assert.ok(i >= 0, `no encontré la función ${nombre}`);
  const resto = fuente.slice(i + 1);
  const j = resto.search(/^(async )?function |^const |^let |^export /m);
  return fuente.slice(i, j < 0 ? undefined : i + 1 + j);
}

// 1. keepIds.add, una sola vez y dentro del listener del checkbox.
const adds = fuente.match(/keepIds\.add\(/g) || [];
ok(adds.length === 1, `keepIds.add aparece ${adds.length} veces (tiene que ser 1)`);
ok(/querySelectorAll\('\.keep-check'\)\.forEach\(box => \{\s*box\.addEventListener\('change', \(\) => \{\s*if \(box\.checked\) keepIds\.add\(box\.dataset\.trackId\);/.test(fuente),
  'el único keepIds.add es el del change de .keep-check');

const aceptar = cuerpo('aceptarPropuesta');
ok(!/keepIds/.test(aceptar), 'aceptarPropuesta no toca keepIds directamente');
ok(/dispatchEvent\(new Event\('change'\)\)/.test(aceptar), 'aceptarPropuesta dispara el change del checkbox');
ok(!/\.checked = false/.test(aceptar), 'aceptarPropuesta no destilda nada');

// 2. Solo su tarjeta.
ok(/btn\.closest\('\.cluster-group'\)/.test(aceptar), 'aceptarPropuesta parte de la tarjeta del botón');
ok(!/document\./.test(aceptar), 'aceptarPropuesta no busca en el documento');
ok(!/allClusters\.(forEach|map|filter|flatMap|reduce)/.test(aceptar), 'aceptarPropuesta no recorre todos los grupos');
ok(!/borrar|batchDelete|removeLikedTracks/.test(aceptar), 'aceptarPropuesta no borra nada');

// 3. Ningún «aceptar todas».
// Sobre el código sin los comentarios de línea (el comentario de versions.js dice, justamente, que no existe).
const codigo = fuente.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
ok(!/Aceptar todas|Aceptar las|aceptarTodas|aceptar-todas/i.test(codigo), 'no existe «Aceptar todas»');
const enlaces = fuente.match(/aceptarPropuesta\(/g) || [];
ok(enlaces.length === 2, `aceptarPropuesta: su definición y UNA llamada (hay ${enlaces.length})`);
ok(/querySelectorAll\('\.ver-propuesta-aceptar'\)\.forEach\(btn => \{\s*btn\.onclick = \(\) => aceptarPropuesta\(btn\);/.test(fuente),
  'cada botón acepta SU grupo (onclick por botón)');

// 4. Abrir no calcula nada.
const render = cuerpo('render');
ok(!/propuesta/i.test(render), 'render() no calcula propuestas');
ok(/onclick = \(\) => analyze\(false\)/.test(render), 'la propuesta cuelga de «Analizar»');
const analyze = cuerpo('analyze');
ok(analyze.indexOf('keepIds.clear()') >= 0 && analyze.indexOf('keepIds.clear()') < analyze.indexOf('renderClusterList()'),
  'analyze() vacía keepIds antes de pintar: nada sale tildado');

// 5. El borrado es el de siempre.
const borrar = cuerpo('batchDelete');
ok(/borrarLikesVerificado\(/.test(borrar) && /guarda: 'ultimo-ejemplar'/.test(borrar), 'batchDelete sigue con borrarLikesVerificado y la guarda');
ok(!/propuesta/i.test(borrar), 'batchDelete no sabe nada de la propuesta');

console.log(`versions-propuesta: ${n} asserts OK`);
