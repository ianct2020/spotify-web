// tests/skips-coma-decimal.test.mjs — el porcentaje de skips va con COMA (v=288)
//
// POR QUÉ ESTA SUITE EXISTE: es la hermana de `dias-coma-decimal.test.mjs`
// (v=287) y el mismo defecto con otra magnitud. En la MISMA fila de tiles del
// Dashboard que v=287 unificó, el quinto tile seguía diciendo **«Skips 64.1%»**,
// con el punto del inglés, a cuatro tiles del «185,6 días» del primero. Era
// `${t.skip_pct || 0}%`: el número crudo del JSON, interpolado tal cual.
//
// Igual que los días, **no falla nunca**: el número que imprime es correcto y
// lo único que está mal es el separador, así que sólo se ve mirando la
// pantalla. De ahí la guarda que lo lee del fuente.
//
// 🟥 **DOS COSAS QUE EL ENCARGO DEL 09/10 DABA POR CIERTAS Y NO LO ERAN**, y
// quedan dichas acá porque cambian dónde hay que mirar:
//
// 1. **`fmtPct` no existe.** El encargo decía «`#wrapped` ya pinta sus
//    porcentajes con coma (`fmtPct` de `wrapped-apertura.js`)». No hay ningún
//    `fmtPct` en todo el repo. La función es **`pct()`**
//    (`wrapped-apertura.js:137`) y hace `v.toFixed(1).replace('.', ',')`, o sea
//    que **clava la coma a mano** en vez de pedírsela al locale — justo lo que
//    `CLAUDE.md` manda no hacer, y por eso este arreglo NO la copia.
// 2. **`#wrapped` NO pinta todos sus porcentajes con coma: se contradice solo.**
//    Su apertura usa `pct()` y dice «64,1 %», pero la vista principal
//    (`wrapped.js:371` y `:658`) interpola `${y.skip_pct}%` y `${t.skip_pct}%`
//    CRUDOS, con punto. O sea que el mismo número sale con coma en un paso de
//    la historia y con punto en un tile de la misma vista.
//    ⚠️ **Esos dos NO se arreglaron acá, por instrucción del encargo** («arreglá
//    los de la misma fila; los de otras vistas, anotalos»). Quedan en
//    `PENDIENTES.md`, y el de `:658` enseña EXACTAMENTE el mismo dato que el
//    tile del Dashboard (`totals.skip_pct`, 64,1).
//
// Corre sin navegador: lee el fuente y el JSON del repo.

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
const apertura = leer('src/js/features/wrapped-apertura.js');

// ── 1. El comportamiento, antes del fuente ─────────────────────────────────

console.log('\n1. es-ES con un decimal da coma');
{
  ok((64.1).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) === '64,1',
     'toLocaleString(«es-ES», 1 decimal) → «64,1»');
  ok(`${64.1}` === '64.1', 'interpolar el número crudo → «64.1», que es lo que NO va en pantalla');
  ok(Intl.NumberFormat('es-ES').resolvedOptions().locale.startsWith('es'),
     'y el locale es-ES está disponible de verdad (ICU completo)');
  // Un entero también tiene que salir con su decimal, para que el tile no
  // alterne entre «64,1%» y «21%» según el año.
  ok((21).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) === '21,0',
     'un entero sale «21,0», no «21»: el tile no cambia de forma');
}

// ── 2. El dato del JSON tiene decimales de verdad ──────────────────────────
//
// Si el JSON trajera enteros, el bug no se vería y esta suite no probaría nada.

console.log('\n2. El JSON real trae el decimal');
{
  const stats = JSON.parse(leer('src/data/history-stats.json'));
  const t = (stats.stats || stats).totals || {};
  const v = t.skip_pct;
  ok(typeof v === 'number', `totals.skip_pct es un número (${JSON.stringify(v)})`);
  ok(!Number.isInteger(v), `y NO es entero (${v}): el separador se ve de verdad`);
  ok(`${v}`.includes('.'), `interpolado crudo da «${v}», con punto`);
}

// ── 3. El tile del Dashboard ───────────────────────────────────────────────

console.log('\n3. El tile «Skips» del Dashboard');
{
  ok(/skip_pct[^\n]*toLocaleString\('es-ES', \{ minimumFractionDigits: 1, maximumFractionDigits: 1 \}\)/.test(dashboard),
     'dashboard.js: skip_pct pasa por toLocaleString(«es-ES») con un decimal');
  ok(!/\$\{t\.skip_pct \|\| 0\}%/.test(dashboard),
     'dashboard.js: ya NO interpola `${t.skip_pct || 0}%` crudo');
  // El locale EXPLÍCITO es el punto: sin él se usa el del navegador (es-AR en
  // las máquinas de Ian), o sea que el bug se ve en su Chrome y no en una
  // máquina en inglés.
  ok(!/skip_pct[^\n]*toLocaleString\(\s*\)/.test(dashboard),
     'dashboard.js: y con el locale explícito, no un toLocaleString() pelado');
  // Y NO con el atajo de `pct()`: el separador se le pide al locale.
  const lineaSkip = dashboard.split('\n').find(l => /const skipPct/.test(l)) || '';
  ok(!/replace\(\s*'\.'/.test(lineaSkip),
     'dashboard.js: no clava la coma con .replace(«.», «,») como hace pct()');
}

// ── 4. El tile de los días, de la MISMA fila, sigue bien ───────────────────
//
// Los dos viven en la misma plantilla: un «arreglo» que toque uno puede
// llevarse al otro por delante.

console.log('\n4. Los dos tiles de la misma fila, juntos');
{
  const fila = dashboard.slice(dashboard.indexOf('history-stat-tiles'));
  ok(/días de música/.test(fila), 'la fila sigue teniendo el tile de «días de música»');
  ok(/stat-label">Skips</.test(fila), 'y el tile de «Skips»');
  ok(!/toFixed\(/.test(fila.slice(0, 1200)), 'y ninguno de los dos usa toFixed()');
}

// ── 5. Lo que el encargo afirmaba y es FALSO ───────────────────────────────
//
// Se afirma por escrito para que la próxima tanda no vuelva a buscar `fmtPct`.

console.log('\n5. `fmtPct` no existe; la función es `pct()` y clava la coma a mano');
{
  ok(!/fmtPct/.test(apertura), 'wrapped-apertura.js no tiene ningún `fmtPct`');
  ok(/function pct\(v\)/.test(apertura), 'la función se llama `pct(v)`');
  ok(/pct[\s\S]{0,60}toFixed\(1\)\.replace\('\.', ','\)/.test(apertura),
     'y hace toFixed(1).replace(«.», «,»): clava la coma, no se la pide al locale');
}

// ── 6. Guarda ancha: ninguna plantilla NUEVA pega un crudo a un `%` ────────
//
// La forma que tenía el bug, para cazar la próxima copia. Se listan los sitios
// que interpolan algo seguido de `%` sin pasar por un formateador ni por un
// redondeo a entero. `#wrapped` queda EXCLUIDA a propósito: sus dos sitios
// están abiertos y anotados, y si entraran acá la suite nacería roja.

console.log('\n6. Ninguna plantilla pega un `*_pct` del JSON a un `%`');
{
  // ⚠️ **La primera versión de esta guarda era INGENUA y daba tres falsos
  // positivos**, porque miraba sólo la línea: marcaba `${stats.explicitPct}%`,
  // `${skipPct}%` y `${p}% del pico` sin seguir de dónde salía la variable. Los
  // tres son correctos —`Math.round()` los tres, en otra línea—. Una guarda que
  // grita por lo que está bien se desactiva en dos tandas, así que es peor que
  // no tenerla.
  //
  // La forma REAL del bug es estrecha y se puede nombrar: un campo `*_pct` del
  // JSON interpolado **directo**, sin formateador en medio. Eso es lo que eran
  // los tres sitios (`t.skip_pct`, `y.skip_pct`) y es lo que va a ser el cuarto.
  const sospechosas = [];
  dashboard.split('\n').forEach((linea, i) => {
    for (const m of linea.matchAll(/\$\{([^}]*)\}\s*%/g)) {
      const dentro = m[1];
      if (!/[A-Za-z0-9_$.]*_pct\b/.test(dentro)) continue;          // no es un `*_pct`
      if (/toLocaleString|Math\.round|toFixed\(0\)/.test(dentro)) continue;  // ya formateado
      sospechosas.push(`dashboard.js:${i + 1} ${linea.trim()}`);
    }
  });
  ok(sospechosas.length === 0, `0 campos `+'`*_pct`'+` crudos pegados a un % en dashboard.js${sospechosas.length ? ' — ' + sospechosas.join(' · ') : ''}`);
}

// ── 6b. El censo de los `${…}%` del Dashboard, resuelto A MANO ─────────────
//
// La guarda de arriba es estrecha a propósito. Ésta es la ancha que la
// complementa sin gritar: afirma que los sitios del Dashboard que interpolan
// algo junto a un `%` son EXACTAMENTE los tres conocidos, cada uno revisado el
// 09/10 siguiendo la variable hasta su definición. Uno nuevo —de cualquier
// forma— rompe la cuenta y hay que venir a resolverlo igual que estos.

console.log('\n6b. El censo de `${…}%` del Dashboard sigue siendo el revisado');
{
  const sitios = [];
  dashboard.split('\n').forEach((linea, i) => {
    for (const m of linea.matchAll(/\$\{([^}]*)\}\s*%/g)) {
      if (/width|height|left|top|translate|scale|--p\b/.test(linea)) continue;   // CSS, no texto
      sitios.push(m[1].trim());
    }
  });
  const esperados = [
    // `explicitPct: … Math.round((explicitCount / likes.length) * 100)` (:720) → entero.
    'stats.explicitPct',
    // El tile de esta tanda: ya formateado con toLocaleString('es-ES').
    'skipPct',
    // `p = +rect.dataset.p`, y `data-p="${pctOfMax}"` con
    // `pctOfMax = Math.round(intensidad * 100)` (:1102 y :1132) → entero.
    'p',
  ];
  ok(JSON.stringify(sitios.sort()) === JSON.stringify([...esperados].sort()),
     `los ${esperados.length} sitios conocidos y ninguno más (dio: ${JSON.stringify(sitios.sort())})`);
}

// ── 7. El censo de porcentajes de TODA la app ──────────────────────────────
//
// Barrido del 09/10, para que el próximo encargo no tenga que repetirlo. De los
// candidatos, los únicos que pueden enseñar un punto decimal son los que
// interpolan el dato crudo del JSON; el resto redondea a entero y no tiene el
// defecto. Se afirma que los enteros SIGUEN siendo enteros: si alguien los pasa
// a un decimal, entran al problema y hay que formatearlos.

console.log('\n7. Los porcentajes que NO tienen el defecto siguen redondeando a entero');
{
  const casos = [
    ['dashboard.js', 'explicitPct', /explicitPct: likes\.length > 0 \? Math\.round\(/, dashboard],
    ['skips.js', 'ratio de la tarjeta', /ratio: Math\.round\(\(skip \/ total\) \* 100\)/, leer('src/js/features/skips.js')],
    ['similar-artists.js', 'match del artista', /\(a\.match \* 100\)\.toFixed\(0\)/, leer('src/js/features/similar-artists.js')],
  ];
  for (const [archivo, que, re, fuente] of casos) {
    ok(re.test(fuente), `${archivo} · ${que}: sigue redondeado a entero, sin decimal que separar`);
  }
}

console.log(`\n${pasaron} asserts OK, ${fallaron} fallos`);
process.exit(fallaron > 0 ? 1 : 0);
