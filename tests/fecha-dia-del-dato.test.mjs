// El día que dice el dato — la guarda del bug de «31 dic 2025» (2026-09-20).
//
// POR QUÉ ESTA SUITE EXISTE: la baldosa «Primera play» del Wrapped 2026 decía
// **31 dic 2025**. El dato del JSON es `"2026-01-01T00:00:28Z"`: la primera
// play del año pasó a los 28 segundos de empezar 2026. `fmtDia()` lo mandaba
// por `new Date()`, que en UTC−3 lo mueve a las 21:00 del 31 de diciembre
// anterior. La baldosa de un año enseñaba una fecha de OTRO año, y no fallaba
// nada: se pintaba perfecta y mentía.
//
// Es el bug de v=154 por el segundo camino. Aquel arreglo cubrió la forma
// "2026-01-09" (día suelto) y dejó escrito que el timestamp completo «es un
// instante y convertirlo a local es lo correcto». Esa premisa es la falsa:
// TODO el pipeline agrupa por día UTC (`history-processor.js` usa
// `getUTCHours`/`getUTCDate`, y `peak_day`, `days.from`, el mapa de calor y
// las rachas son cadenas YYYY-MM-DD en UTC). Si `first_play` se traduce a hora
// local, esa única fecha habla un idioma que no habla ninguna otra de la app.
//
// Lo que este test afirma: `fmtDia()` enseña el día que el dato dice, para las
// dos formas, y no lo mueve de zona nunca. Y que no hay una segunda copia de
// la función viviendo en `wrapped.js` (lección 4: dos listas de lo mismo son
// un bug garantizado — esa copia fue justamente la que mintió).
//
// Corre contra el JSON REAL del repo, sin navegador y sin token.
// Correr con: node tests/fecha-dia-del-dato.test.mjs

// La zona se fija ANTES de tocar ningún Date: si no, en una máquina en UTC el
// test pasaría sin arreglar nada. El bug solo se ve con offset negativo, y la
// app corre en Argentina.
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fmtDia } from '../src/js/util/fecha.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const stats = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));

let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? ' — ' + detalle : ''}`);
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// Lo que hay que enseñar, leído del string y de nada más.
const esperado = iso => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${+d} ${MESES[+m - 1]} ${y}`;
};

comprobar('hay años en el JSON', stats.years?.length > 0);

// 1. El caso exacto de la baldosa, con el dato real y escrito a mano: si
//    mañana el JSON se regenera y 2026 ya no empieza a las 00:00:28Z, este
//    assert sigue defendiendo el caso que rompió.
comprobar('el caso de la baldosa: 2026-01-01T00:00:28Z → 1 ene 2026',
  fmtDia('2026-01-01T00:00:28Z') === '1 ene 2026', fmtDia('2026-01-01T00:00:28Z'));

// 2. Y el mismo caso, pero leído del JSON del repo, que es lo que ve Ian.
const y2026 = stats.years.find(y => y.year === 2026);
comprobar('hay año 2026 en el JSON', !!y2026);
if (y2026) {
  comprobar('«Primera play» de 2026 sale del JSON del repo',
    fmtDia(y2026.first_play) === esperado(y2026.first_play),
    `${y2026.first_play} → ${fmtDia(y2026.first_play)}, debería ${esperado(y2026.first_play)}`);
}

// 3. Ningún año puede enseñar una fecha de otro año. Es el síntoma que se ve
//    sin saber nada del dato: la baldosa de 2026 decía 2025.
for (const y of stats.years) {
  for (const campo of ['first_play', 'last_play']) {
    const v = y[campo];
    if (!v) continue;
    comprobar(`${y.year}: ${campo} no se mueve de día`,
      fmtDia(v) === esperado(v), `${v} → ${fmtDia(v)}, debería ${esperado(v)}`);
    comprobar(`${y.year}: ${campo} cae dentro de ${y.year}`,
      fmtDia(v).endsWith(` ${y.year}`), `${v} → ${fmtDia(v)}`);
  }
  // El día suelto —lo que arregló v=154— tiene que seguir bien.
  if (y.peak_day?.date) {
    comprobar(`${y.year}: peak_day sigue bien (el arreglo de v=154)`,
      fmtDia(y.peak_day.date) === esperado(y.peak_day.date),
      `${y.peak_day.date} → ${fmtDia(y.peak_day.date)}`);
  }
}

// 4. Las dos formas del MISMO día tienen que dar lo mismo. Es la propiedad que
//    faltaba: con el código viejo, "2026-01-01" y "2026-01-01T00:00:28Z" daban
//    dos días distintos en la misma pantalla.
for (const h of ['00:00:00Z', '00:00:28Z', '02:59:59Z', '12:00:00Z', '23:59:59Z']) {
  comprobar(`2026-01-01T${h} == 2026-01-01`,
    fmtDia(`2026-01-01T${h}`) === fmtDia('2026-01-01'), fmtDia(`2026-01-01T${h}`));
}

// 5. Lección 4: el segundo ejemplar. `wrapped.js` tenía su propia `fmtDate()`
//    —copia de esta, con el mismo regex— y fue la copia la que mintió durante
//    27 versiones. Si vuelve a aparecer, esto falla.
const wrapped = readFileSync(join(raiz, 'src/js/features/wrapped.js'), 'utf8');
comprobar('wrapped.js no redefine el formateo de fechas',
  !/function\s+fmtDate\s*\(/.test(wrapped) && !/const\s+SOLO_FECHA\s*=/.test(wrapped));
comprobar('wrapped.js importa fmtDia de util/fecha.js',
  /import\s*\{[^}]*\bfmtDia\b[^}]*\}\s*from\s*'\.\.\/util\/fecha\.js'/.test(wrapped));

console.log(`\n  ${ok} asserts OK, ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
