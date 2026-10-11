// tests/corte-saltos.test.mjs — el Wrapped no compara saltos en los años sin el campo `skipped` (v=292)
//
// POR QUÉ ESTA SUITE EXISTE. El export de Spotify trae `skipped: false` en todo
// lo anterior al 15/10/2022 (ver `src/js/util/corte-saltos.js`), así que el
// porcentaje de saltos de 2018-2022 se mide con otra regla que el de 2023 en
// adelante. Hasta v=291 el paso «dentro de todo» de la apertura comparaba esos
// años contra el total («este año aguantas más…»), y el tile «Skips» decía
// «por skip o <30s» en años en los que el «skip» no existía en el dato.
//
// Afirma cuatro cosas:
//   1. la función del corte;
//   2. que para 2023-2026 `pasoDentroDeTodo()` devuelve EXACTAMENTE lo de v=291;
//   3. que para 2018-2022 la comparación se fue entera y lo demás quedó igual;
//   4. que la regla vive en un solo sitio (ningún `2022`/`2023` a mano en las dos vistas).
//
// ⚠️ **LA REFERENCIA NO SE REGENERA NUNCA CON EL CÓDIGO NUEVO.**
// `tests/fixtures/dentro-de-todo-v291.json` se generó con el código de v=291,
// antes de tocar `src/` (commit T41.1a, `tests/generar-dentro-de-todo-v291.mjs`,
// que se niega a pisarla). Si esta suite se pone roja, lo que está mal es el
// código. Es la regla de `tests/calendario-anual.test.mjs`.
//
// Corre sin navegador, sin token y sin el export, contra el JSON real del repo.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pasoDentroDeTodo } from '../src/js/features/wrapped-apertura.js';
import { anioSinCampoSkipped, esElAnioDelCorte, PRIMER_SKIPPED_TRUE } from '../src/js/util/corte-saltos.js';
import { fmtDia } from '../src/js/util/fecha.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = p => readFileSync(join(raiz, p), 'utf8');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const igual = (a, b, nombre) => ok(a === b, `${nombre} (esperaba ${JSON.stringify(b)}, vino ${JSON.stringify(a)})`);

// El MISMO `ctx` con el que se generó la referencia (el doble de `fmtMinutes`
// es el de `tests/calendario-anual.test.mjs`: `wrapped.js` no se importa sin DOM).
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h.toLocaleString('es-ES')}h ${m}m`;
  }
  return `${Math.round(min)}m`;
}
const stats = JSON.parse(leer('src/data/history-stats.json'));
const referencia = JSON.parse(leer('tests/fixtures/dentro-de-todo-v291.json'));
const paso = (y) => pasoDentroDeTodo({
  stats, y, MESES, MESES_LARGOS, fmtMinutes, fmtDia,
  ultimoDia: (stats.years[stats.years.length - 1]?.last_play || '').slice(0, 10) || null,
});

// ── 1. La función del corte ────────────────────────────────────────────────

console.log('\n1. `util/corte-saltos.js`: qué años van sin el campo');
{
  igual(PRIMER_SKIPPED_TRUE, '2022-10-15', 'la fecha del primer `skipped: true`');
  ok(anioSinCampoSkipped(2018) === true, '2018 es anterior al corte');
  ok(anioSinCampoSkipped(2022) === true, '2022 se trata como anterior (nueve meses y medio sin el campo)');
  ok(anioSinCampoSkipped(2023) === false, '2023 no');
  ok(anioSinCampoSkipped(2026) === false, '2026 no');
  ok(anioSinCampoSkipped('2022') === true && anioSinCampoSkipped('2023') === false, 'y da lo mismo con el año como cadena');
  ok(esElAnioDelCorte(2022) && !esElAnioDelCorte(2021) && !esElAnioDelCorte(2023), 'el año del corte es uno solo');
  igual(stats.years.map(y => y.year).join(','), '2018,2019,2020,2021,2022,2023,2024,2025,2026', 'el JSON real trae los nueve años');
  igual(Object.keys(referencia).join(','), stats.years.map(y => y.year).join(','), 'y la referencia, los mismos nueve');
}

// ── 2. Con el campo: idéntico a v=291 ──────────────────────────────────────

console.log('\n2. 2023-2026: `pasoDentroDeTodo()` devuelve lo mismo que en v=291, byte a byte');
const conCampo = stats.years.filter(y => !anioSinCampoSkipped(y.year));
const sinCampo = stats.years.filter(y => anioSinCampoSkipped(y.year));
{
  igual(conCampo.map(y => y.year).join(','), '2023,2024,2025,2026', 'los años con el campo');
  // v=295 (tanda 43): el rehorneado sacó la basura funcional del divisor de `skip_pct` y movió
  // el porcentaje del total y el de tres de estos cuatro años. La referencia (v=291) trae los
  // de antes y NO SE REGENERA: lo que se afirma es que el objeto de hoy es IDÉNTICO a la
  // referencia después de reemplazar en ella EXACTAMENTE estos porcentajes, y nada más.
  // Hasta v=294 este assert era `JSON.stringify(paso(y)) === referencia[y.year]` a secas.
  //
  //            viejo (v=291-v=294)   nuevo (v=295)
  const MOVIDOS = {
    total: ['64,1%', '64,2%'],
    2023: null,                       // 74,9: la basura de 2023 son 2 de 34.315, no lo mueve
    2024: ['71,8%', '71,9%'],
    2025: ['66,7%', '66,8%'],
    2026: ['58,4%', '58,5%'],
  };
  const reemplazarTodo = (s, [de, a]) => s.split(de).join(a);
  const RAMA = (f) => /igual que siempre/.test(f) ? 'igual' : /aguantas más/.test(f) ? 'menos' : /más que de costumbre/.test(f) ? 'más' : '?';
  igual(Object.keys(MOVIDOS).join(','), '2023,2024,2025,2026,total', 'la tabla viejo→nuevo cubre el total y los cuatro años con el campo');
  igual(stats.totals.skip_pct.toFixed(1).replace('.', ',') + '%', MOVIDOS.total[1], 'el «nuevo» del total es el del JSON de hoy');
  for (const y of conCampo) {
    const m = MOVIDOS[y.year];
    igual(y.skip_pct.toFixed(1).replace('.', ',') + '%', m ? m[1] : '74,9%', `${y.year}: el «nuevo» de la tabla es el porcentaje del JSON de hoy`);
    let esperado = referencia[y.year];
    ok(esperado.includes(MOVIDOS.total[0]), `${y.year}: la referencia trae el ${MOVIDOS.total[0]} del total`);
    esperado = reemplazarTodo(esperado, MOVIDOS.total);
    if (m) {
      ok(esperado.includes(m[0]), `${y.year}: la referencia trae su ${m[0]}`);
      esperado = reemplazarTodo(esperado, m);
    }
    ok(JSON.stringify(paso(y)) === esperado, `${y.year}: JSON.stringify idéntico al de la referencia con sus porcentajes movidos (y nada más)`);
    igual(RAMA(paso(y).cuerpo), RAMA(JSON.parse(referencia[y.year]).cuerpo), `${y.year}: la rama de la comparación es la misma de la referencia`);
  }
  // Que la comparación de arriba mire algo: las tres ramas viejas siguen vivas ahí.
  const ramas = new Set(conCampo.map(y => {
    const f = paso(y).cuerpo;
    return /igual que siempre/.test(f) ? 'igual' : /aguantas más/.test(f) ? 'menos' : /más que de costumbre/.test(f) ? 'más' : '?';
  }));
  igual([...ramas].sort().join(','), 'igual,menos,más', 'entre los cuatro cubren las tres ramas de la comparación');
}

// ── 3. Sin el campo: la comparación se fue, lo demás quedó ─────────────────

console.log('\n3. 2018-2022: sin comparación de saltos');
{
  igual(sinCampo.map(y => y.year).join(','), '2018,2019,2020,2021,2022', 'los años sin el campo');
  const pctTotal = stats.totals.skip_pct.toFixed(1).replace('.', ',');
  igual(pctTotal, '64,2', 'el porcentaje del total, formateado como lo pinta la apertura');
  // El mes que nombra el copy de 2022 sale de la constante, no de la memoria.
  igual(MESES_LARGOS[Number(PRIMER_SKIPPED_TRUE.slice(5, 7)) - 1], 'octubre', 'el mes del corte');
  ok(Number(PRIMER_SKIPPED_TRUE.slice(8, 10)) >= 11 && Number(PRIMER_SKIPPED_TRUE.slice(8, 10)) <= 20, 'y el día cae «a mediados»');

  const VIEJAS = ['histórico', 'aguantas', 'cortas', 'de costumbre', 'igual que siempre'];
  const FINAL = ' Ninguna tarjeta de las de abajo da este número: todas miran un año por vez.';
  for (const y of sinCampo) {
    const p = paso(y), ref = JSON.parse(referencia[y.year]);
    ok(p && typeof p.cuerpo === 'string', `${y.year}: el paso sigue apareciendo`);
    const c = p.cuerpo;
    ok(!c.includes(pctTotal), `${y.year}: el cuerpo no trae el ${pctTotal} del total`);
    for (const v of VIEJAS) ok(!c.includes(v), `${y.year}: no dice «${v}»`);
    // La primera frase es la de v=291, tal cual.
    const primera = (ref.cuerpo.match(/^De las .*? son de \d{4}\./) || [])[0];
    ok(!!primera && c.startsWith(primera), `${y.year}: empieza con la primera frase de la referencia («${(primera || '').slice(0, 28)}…»)`);
    ok(c.endsWith(FINAL) && ref.cuerpo.endsWith(FINAL), `${y.year}: y termina con «Ninguna tarjeta de las de abajo…», igual que antes`);
    // Lo que va en el medio es la línea nueva, y es lo ÚNICO que cambió del objeto.
    const linea = c.slice((primera || '').length, c.length - FINAL.length);
    ok(/no se puede comparar con el total ni con los años siguientes\.$/.test(linea), `${y.year}: dice que el porcentaje no se puede comparar`);
    ok(/«siguiente»/.test(linea), `${y.year}: nombra «siguiente», que es lo único que el export anotaba`);
    ok(esElAnioDelCorte(y.year)
      ? /empezó a anotar cuándo saltabas una canción a mediados de octubre de 2022/.test(linea)
      : new RegExp(`^ En ${y.year} Spotify no anotaba cuándo saltabas una canción, solo si le dabas a «siguiente»\\.`).test(linea),
      `${y.year}: ${esElAnioDelCorte(y.year) ? 'dice desde cuándo se anota' : 'dice que ese año no se anotaba'}`);
    ok(!/\b(más|menos|igual|antes|ahora|mayor|menor)\b/i.test(linea), `${y.year}: la línea no compara («más», «menos», «igual», «antes», «ahora»)`);
    ok(!/%/.test(linea) && !/\d,\d/.test(linea) && !/de cada 10/.test(linea), `${y.year}: ni trae un porcentaje o una estimación`);
    ok(!/\bsolo\b.*\bsólo\b|sólo/.test(linea), `${y.year}: «solo» va sin tilde`);
    const sinCuerpo = (o) => JSON.stringify({ ...o, cuerpo: null });
    ok(sinCuerpo(p) === sinCuerpo(ref), `${y.year}: el resto del objeto (etiqueta, número, bajada, dibujo) es el de v=291`);
    ok(c !== ref.cuerpo, `${y.year}: y el cuerpo SÍ cambió respecto de v=291`);
  }
}

// ── 4. La regla vive en un solo sitio ──────────────────────────────────────
//
// ⚠️ Las líneas se pelan ANTES que los bloques: al revés, un `/*` suelto dentro
// de un `//` se come cientos de líneas (trampa ya pisada en likes-cache-policy).

console.log('\n4. Ninguna de las dos vistas escribe el año a mano');
{
  const sinComentarios = (s) => s
    .split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const f of ['src/js/features/wrapped-apertura.js', 'src/js/features/wrapped.js']) {
    const crudo = leer(f), codigo = sinComentarios(crudo);
    // Que el pelado no se haya llevado el archivo: sigue estando el código que importa.
    ok(codigo.length > crudo.length * 0.25 && /anioSinCampoSkipped\(y\.year\)/.test(codigo), `${f}: usa \`anioSinCampoSkipped(y.year)\``);
    ok(/from '\.\.\/util\/corte-saltos\.js'/.test(codigo), `${f}: importa \`util/corte-saltos.js\``);
    ok(!/\b2022\b/.test(codigo), `${f}: fuera de los comentarios no aparece 2022`);
    ok(!/\b2023\b/.test(codigo), `${f}: fuera de los comentarios no aparece 2023`);
  }
  // El tile «Skips»: el número no cambia, la pista depende del corte.
  const wrapped = leer('src/js/features/wrapped.js');
  // v=293 (tanda 42): la pista ya no se afirma con una regex sobre el fuente sino EVALUANDO la
  // sentencia real de `wrapped.js` para cada año del JSON (el módulo entero no se importa sin
  // DOM). Hasta v=292 este assert afirmaba que los cinco años sin el campo —2022 incluido—
  // decían «solo «siguiente» antes de 30 s»; en 2022 eso era falso (desde el 15/10 Spotify ya
  // anotaba los saltos) y ese año lleva ahora su propia pista.
  const m = /\n  const pistaSkips = ([\s\S]*?);\n/.exec(wrapped);
  ok(!!m, 'wrapped.js: se encuentra la sentencia `const pistaSkips = …;`');
  const pistaDe = new Function('anioSinCampoSkipped', 'esElAnioDelCorte', 'y', `return (${m ? m[1] : "''"});`);
  const pista = (anio) => pistaDe(anioSinCampoSkipped, esElAnioDelCorte, { year: anio });
  const PISTA_SIN_CAMPO = 'solo «siguiente» antes de 30 s';   // la de la tanda 41, tal cual
  const PISTA_CON_CAMPO = 'por skip o &lt;30s';               // la de siempre
  for (const y of stats.years) {
    if (y.year >= 2023) igual(pista(y.year), PISTA_CON_CAMPO, `${y.year}: la pista del tile sigue siendo «por skip o <30s»`);
    else if (y.year <= 2021) igual(pista(y.year), PISTA_SIN_CAMPO, `${y.year}: la pista del tile sigue siendo EXACTAMENTE la de la tanda 41`);
  }
  const p22 = pista(2022);
  ok(typeof p22 === 'string' && p22.trim().length > 0, '2022: tiene pista');
  ok(p22 !== PISTA_SIN_CAMPO, '2022: la pista es DISTINTA de la de 2018-2021 (ese año no cuenta «solo «siguiente»»)');
  ok(p22 !== PISTA_CON_CAMPO, '2022: y tampoco es la de 2023-2026');
  ok(!p22.includes('43'), '2022: la pista no trae el 43 (ni ninguna estimación de «cuánto habría sido»)');
  ok(!p22.includes('%'), '2022: la pista no trae ningún porcentaje');
  ok(!/\d/.test(p22), '2022: la pista no trae ningún número');
  // v=294 (tanda 43): este assert afirmaba que la pista «nombra a Spotify y a octubre». La pista
  // era «dos cuentas: Spotify anota desde oct.», y «dos cuentas» se leía como dos usuarios.
  ok(p22.includes('mezcla dos formas de contar'), '2022: dice que el año mezcla dos formas de contar');
  ok(!/cuentas/.test(p22), '2022: y no dice «cuentas», que se leía como dos cuentas de Spotify');
  ok(/\besElAnioDelCorte\(y\.year\)/.test(m ? m[1] : ''), 'wrapped.js: el año del corte sale de `esElAnioDelCorte(y.year)`, no de un año escrito a mano');
  ok(/<div class="wrapped-tile-label">Skips<\/div>\s*<div class="wrapped-tile-value">\$\{skipPctAnio\}%<\/div>\s*<div class="wrapped-tile-hint">\$\{pistaSkips\}<\/div>/.test(wrapped),
     'wrapped.js: el tile «Skips» pinta el mismo número de siempre y esa pista');
}

console.log(`\n${fallaron === 0 ? '✓' : '✗'} corte-saltos: ${pasaron} asserts ok${fallaron ? `, ${fallaron} fallo(s)` : ''}`);
process.exit(fallaron ? 1 : 0);
