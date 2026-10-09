// tests/dias-coma-decimal.test.mjs — «días de música» va con COMA (v=287)
//
// POR QUÉ ESTA SUITE EXISTE: el mismo dato, con el mismo copy, estaba
// formateado de dos maneras **en la misma pantalla**. El Dashboard enseñaba
// «398.4 días de música» en el tile de los me gusta (`dashboard.js`,
// `renderDashboard`) y «185,6 días de música» en el del historial
// (`hydrateHistorySection`), tres tiles más allá. v=282 arregló el segundo y
// dejó el primero, y en `#wrapped` había una TERCERA copia (`fmtDays`) con el
// punto, viva en sus dos héroes.
//
// No es un bug que salte: `toFixed(1)` no falla nunca, y el número que imprime
// es correcto. Lo único que está mal es el separador, y eso solo se ve mirando
// la pantalla. Por eso hace falta una guarda que lo lea del fuente.
//
// El copy visible de la app es **castellano de España** (ver `CLAUDE.md`), y
// ahí el separador decimal es la coma. Y va con el locale EXPLÍCITO: sin él se
// usa el del navegador, que en las máquinas de Ian es `es-AR` — o sea que en su
// Chrome el bug se ve y en una máquina en inglés no.
//
// Corre sin navegador: lee el fuente y comprueba el comportamiento de `Intl`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = p => readFileSync(join(raiz, p), 'utf8');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

const dashboard = leer('src/js/features/dashboard.js');
const wrapped = leer('src/js/features/wrapped.js');

// ── 1. El comportamiento, antes del fuente ─────────────────────────────────
//
// Si esto falla, el node que corre los tests no tiene ICU completo y el resto
// de la suite no significa nada. Mejor que se diga acá.

console.log('\n1. es-ES con un decimal da coma, y el punto es del otro');
{
  const n = 9562 / 24;
  ok(n.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) === '398,4',
     'toLocaleString(«es-ES», 1 decimal) → «398,4»');
  ok(n.toFixed(1) === '398.4', 'toFixed(1) → «398.4», que es lo que NO va en pantalla');
  ok(Intl.NumberFormat('es-ES').resolvedOptions().locale.startsWith('es'),
     'y el locale es-ES está disponible de verdad (ICU completo)');
}

// ── 2. Los TRES sitios que imprimen días ───────────────────────────────────

console.log('\n2. Los tres sitios formatean igual');
{
  // El tile de los me gusta del Dashboard: el gemelo que v=282 dejó atrás.
  ok(/\(hours \/ 24\)\.toLocaleString\('es-ES', \{ minimumFractionDigits: 1, maximumFractionDigits: 1 \}\)/.test(dashboard),
     'dashboard.js · tile de me gusta: toLocaleString(«es-ES») con un decimal');
  ok(!/\(hours \/ 24\)\.toFixed\(/.test(dashboard),
     'dashboard.js · tile de me gusta: ya NO usa toFixed()');

  // El tile del historial: el que v=282 arregló. Se afirma para que nadie lo
  // «unifique» hacia atrás, al punto.
  ok(/\/ 60 \/ 24\)\.toLocaleString\('es-ES', \{ minimumFractionDigits: 1, maximumFractionDigits: 1 \}\)/.test(dashboard),
     'dashboard.js · tile del historial: sigue con toLocaleString(«es-ES»)');

  // `#wrapped`, la tercera copia.
  ok(/toLocaleString\('es-ES', \{ minimumFractionDigits: 1, maximumFractionDigits: 1 \}\)[\s\S]{0,80}días equivalentes/.test(wrapped),
     'wrapped.js · fmtDays(): toLocaleString(«es-ES») con un decimal');
  ok(!/toFixed\(1\)\} días/.test(wrapped),
     'wrapped.js · fmtDays(): ya NO usa toFixed()');
}

// ── 3. Nadie imprime «días» con un punto decimal ───────────────────────────
//
// La guarda ancha, la que caza una copia NUEVA: cualquier plantilla que meta un
// `toFixed()` justo delante de la palabra «días». Es la forma que tenían las
// tres, así que es la forma que va a tener la cuarta.

console.log('\n3. Ninguna plantilla pega un toFixed() a la palabra «días»');
{
  const sospechosas = [];
  for (const [nombre, fuente] of [['dashboard.js', dashboard], ['wrapped.js', wrapped]]) {
    fuente.split('\n').forEach((linea, i) => {
      if (/toFixed\([0-9]*\)[^`]{0,40}d[ií]as/.test(linea)) sospechosas.push(`${nombre}:${i + 1} ${linea.trim()}`);
    });
  }
  ok(sospechosas.length === 0, `0 plantillas sospechosas${sospechosas.length ? ' — ' + sospechosas.join(' · ') : ''}`);
}

// ── 4. Lo que queda ABIERTO, dicho acá para que no se pierda ───────────────
//
// 🟥 Hay CUATRO formateadores decimales privados más, cada uno en su módulo, y
// ninguno compartido: `records.js fmtNum()`, `mosaico.js fmt1()`,
// `app.js fmtMB()` y el `toFixed(dec).replace('.', ',')` de
// `wrapped-apertura.js`. Este último además clava la coma a mano en vez de
// pedirle el separador al locale. Lo mismo que pasó con `fmtDate()` en v=231
// (la copia fue la que mintió) puede volver a pasar con cualquiera de los
// cuatro. Centralizarlos toca cuatro features y es su propio encargo: queda
// anotado en `PENDIENTES.md`, NO hecho acá.

console.log(`\n${pasaron} asserts OK, ${fallaron} fallos`);
process.exit(fallaron > 0 ? 1 : 0);
