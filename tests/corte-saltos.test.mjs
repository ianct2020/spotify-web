// tests/corte-saltos.test.mjs — el Wrapped no compara saltos en los años sin el campo `skipped` (v=292)
//
// POR QUÉ ESTA SUITE EXISTE. El export de Spotify trae `skipped: false` en todo
// lo anterior al 15/10/2022 (ver `src/js/util/corte-saltos.js`), así que el
// porcentaje de saltos de 2018-2022 se mide con otra regla que el de 2023 en
// adelante. Hasta v=291 el paso «dentro de todo» de la apertura comparaba esos
// años contra el total («este año aguantas más…»), y el tile «Skips» decía
// «por skip o <30s» en años en los que el «skip» no existía en el dato.
//
// Afirma cinco cosas (la quinta, desde v=295: el aviso de que el TOTAL mezcla dos formas de
// contar sale de una sola constante y está en cada sitio donde entra):
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

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pasoDentroDeTodo } from '../src/js/features/wrapped-apertura.js';
import { anioSinCampoSkipped, esElAnioDelCorte, PRIMER_SKIPPED_TRUE, AVISO_MEZCLA } from '../src/js/util/corte-saltos.js';
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
    // v=295 (T43.4): además de los porcentajes, la comparación permite EXACTAMENTE la cláusula
    // nueva, pegada a la mención del total, y nada más. Se afirma aparte (que está, una sola
    // vez, y dónde) y después se le quita al objeto de hoy para compararlo con la referencia.
    // Hasta T43.3 este assert comparaba `JSON.stringify(paso(y)) === esperado` sin quitar nada.
    const CLAUSULA = `, que ${AVISO_MEZCLA}`;
    const hoy = JSON.stringify(paso(y));
    igual(hoy.split(CLAUSULA).length - 1, 1, `${y.year}: la cláusula «${CLAUSULA}» aparece UNA sola vez en el objeto`);
    igual(paso(y).cuerpo.split(AVISO_MEZCLA).length - 1, 1, `${y.year}: y está en el cuerpo`);
    const totalHoy = MOVIDOS.total[1].replace('%', '\\s?%');
    ok(new RegExp(`(contra el ${totalHoy} histórico|en el total de tu historial la cifra es ${totalHoy}), que ${AVISO_MEZCLA}\\.`).test(paso(y).cuerpo),
       `${y.year}: va PEGADA a la mención del total («…${MOVIDOS.total[1]}${/histórico/.test(paso(y).cuerpo) ? ' histórico' : ''}, que ${AVISO_MEZCLA}.»), en la misma frase`);
    ok(hoy.split(CLAUSULA).join('') === esperado, `${y.year}: sin esa cláusula, JSON.stringify idéntico al de la referencia con sus porcentajes movidos (y nada más)`);
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
    // v=295: el aviso del total va solo donde se nombra el total, y acá no se nombra.
    ok(!JSON.stringify(p).includes(AVISO_MEZCLA), `${y.year}: el paso NO trae «${AVISO_MEZCLA}» (no compara con el total, así que no lo nombra)`);
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
  // v=295: la sentencia lee además `AVISO_MEZCLA`, así que se le pasa la constante real.
  const pistaDe = new Function('anioSinCampoSkipped', 'esElAnioDelCorte', 'AVISO_MEZCLA', 'y', `return (${m ? m[1] : "''"});`);
  const pista = (anio) => pistaDe(anioSinCampoSkipped, esElAnioDelCorte, AVISO_MEZCLA, { year: anio });
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
  igual(p22, AVISO_MEZCLA, '2022: y es la constante `AVISO_MEZCLA`, tal cual (el DOM del tile no cambia por leerla de ahí)');
  ok(!/cuentas/.test(p22), '2022: y no dice «cuentas», que se leía como dos cuentas de Spotify');
  ok(/\besElAnioDelCorte\(y\.year\)/.test(m ? m[1] : ''), 'wrapped.js: el año del corte sale de `esElAnioDelCorte(y.year)`, no de un año escrito a mano');
  ok(/<div class="wrapped-tile-label">Skips<\/div>\s*<div class="wrapped-tile-value">\$\{skipPctAnio\}%<\/div>\s*<div class="wrapped-tile-hint">\$\{pistaSkips\}<\/div>/.test(wrapped),
     'wrapped.js: el tile «Skips» pinta el mismo número de siempre y esa pista');
}

// ── 5. El total de saltos dice que mezcla dos formas de contar (v=295) ─────
//
// `totals.skip_pct` suma años en los que Spotify no anotaba los saltos con años en los que
// sí. El número no se recalcula: se dice, en cada sitio donde se muestra el total. La frase
// sale de UNA constante y ningún sitio la escribe a mano.

console.log('\n5. El aviso del total: una sola constante, en cada sitio donde entra');
{
  const sinComentarios = (s) => s
    .split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  igual(AVISO_MEZCLA, 'mezcla dos formas de contar', 'la constante `AVISO_MEZCLA` existe y vale «mezcla dos formas de contar»');
  const def = sinComentarios(leer('src/js/util/corte-saltos.js'));
  igual((def.match(/mezcla dos formas de contar/g) || []).length, 1, 'util/corte-saltos.js: la frase está escrita UNA vez, en la constante');
  ok(/export const AVISO_MEZCLA = 'mezcla dos formas de contar';/.test(def), 'y es un `export const`');

  const SITIOS = ['src/js/features/wrapped.js', 'src/js/features/dashboard.js', 'src/js/features/wrapped-apertura.js'];
  const codigo = Object.fromEntries(SITIOS.map(f => [f, sinComentarios(leer(f))]));
  for (const f of SITIOS) {
    ok(new RegExp("import \\{[^}]*\\bAVISO_MEZCLA\\b[^}]*\\} from '\\.\\./util/corte-saltos\\.js'").test(codigo[f]), `${f}: IMPORTA \`AVISO_MEZCLA\` de util/corte-saltos.js`);
    ok(!/mezcla dos formas/i.test(codigo[f]) && !/formas de contar/i.test(codigo[f]), `${f}: fuera de los comentarios NO escribe la frase a mano`);
    ok((codigo[f].match(/\bAVISO_MEZCLA\b/g) || []).length >= 2, `${f}: y la usa (aparece además del import)`);
  }
  // Y nadie más en `src/js` la escribe (ni la copia con otro nombre).
  // (`readdirSync` recursivo: Node 20.)
  const todos = readdirSync(join(raiz, 'src/js'), { recursive: true }).filter(n => String(n).endsWith('.js')).map(n => 'src/js/' + String(n).split('\\').join('/'));
  const conLaFrase = todos.filter(f => /mezcla dos formas de contar/.test(sinComentarios(leer(f))));
  igual(conLaFrase.join(','), 'src/js/util/corte-saltos.js', `de los ${todos.length} archivos de src/js, el único que escribe la frase es el de la constante`);

  // El tile «Skips» del Dashboard: la muestra. «skips» va en el valor porque la etiqueta
  // (un renglón, `nowrap` + elipsis, 170 px a 1.366 y 155 a 390) no admite las dos cosas.
  ok(/<div class="stat-card"><div class="stat-value">\$\{skipPct\}% skips<\/div><div class="stat-label">\$\{AVISO_MEZCLA\}<\/div><\/div>/.test(codigo['src/js/features/dashboard.js']),
     'Dashboard: el tile del total de saltos MUESTRA el aviso (valor «N% skips», etiqueta `AVISO_MEZCLA`)');
  igual((codigo['src/js/features/dashboard.js'].match(/\$\{AVISO_MEZCLA\}/g) || []).length, 1, 'Dashboard: y lo pinta una sola vez');

  // El tile «Plays válidas» del Wrapped «de siempre»: desde v=296 (tanda 44) SÍ la muestra.
  // Hasta v=295 este assert afirmaba lo contrario («QUEDÓ SIN EL AVISO POR EL ANCHO»): la pista
  // admite 220 px en un renglón a 1.366 px y con las tres cosas pasa a dos. El planificador levantó
  // la regla del alto para este tile: crece de 160,1 a 168,2 px (a 390 px, de 85,8 a 102).
  const w = codigo['src/js/features/wrapped.js'];
  const tileSiempre = (/<div class="wrapped-tile compact" style="grid-area:disc">\s*<div class="wrapped-tile-label">Plays válidas<\/div>[\s\S]*?<\/div>\s*<\/div>/.exec(w) || [''])[0];
  ok(/crudas · \$\{skipPctTotal\}% skips/.test(tileSiempre), 'Wrapped «de siempre»: se encuentra el tile «Plays válidas» con su pista «de N crudas · X% skips»');
  ok(/<div class="wrapped-tile-hint">de \$\{\(t\.plays_raw \|\| 0\)\.toLocaleString\('es-ES'\)\} crudas · \$\{skipPctTotal\}% skips · \$\{AVISO_MEZCLA\}<\/div>/.test(tileSiempre),
     'Wrapped «de siempre»: la pista del tile «Plays válidas» LLEVA EL AVISO, importado de `AVISO_MEZCLA`, detrás de «% skips» ' +
     '(«de 212.491 crudas · 64,2% skips · mezcla dos formas de contar»; el tile crece a 168,2 px a 1.366 y a 102 a 390, permitido en la tanda 44)');
  ok(/<div class="wrapped-tile-label">Plays válidas<\/div>\s*<div class="wrapped-tile-value">\$\{\(t\.plays_valid \|\| 0\)\.toLocaleString\('es-ES'\)\}<\/div>/.test(tileSiempre),
     'Wrapped «de siempre»: la etiqueta («Plays válidas») y el valor (las válidas) no se tocaron');
  igual((w.match(/\bAVISO_MEZCLA\b/g) || []).length, 3, 'wrapped.js: `AVISO_MEZCLA` aparece tres veces: el import, la pista del año del corte y la del tile «Plays válidas» de «de siempre»');

  // El paso «dentro de todo»: la trae pegada a la mención del total en las TRES ramas.
  const ap = codigo['src/js/features/wrapped-apertura.js'];
  ok(/const delTotal = `, que \$\{AVISO_MEZCLA\}`;/.test(ap), 'wrapped-apertura.js: la cláusula es `, que ${AVISO_MEZCLA}`');
  igual((ap.match(/\$\{pct\(t\.skip_pct\)\}( histórico)?\$\{delTotal\}\./g) || []).length, 3, 'y va detrás de `pct(t.skip_pct)` en las tres ramas que nombran el total');
  igual((ap.match(/pct\(t\.skip_pct\)/g) || []).length, 3, 'que son las únicas tres menciones del total en el archivo');
  // Con números sintéticos, una frase por rama (el JSON real no garantiza las tres para siempre).
  const sint = (pctAnio) => pasoDentroDeTodo({
    y: { year: 2030, plays: 100, skip_pct: pctAnio }, fmtMinutes,
    stats: { totals: { plays_valid: 1000, skip_pct: 64.2 }, years: [{ year: 2029 }, { year: 2030 }] },
  }).cuerpo;
  ok(sint(66.0).includes(`contra el 64,2% histórico, que ${AVISO_MEZCLA}.`), 'rama «igual que siempre»: «…contra el 64,2% histórico, que mezcla dos formas de contar.»');
  ok(sint(75.0).includes(`contra el 64,2% histórico, que ${AVISO_MEZCLA}.`), 'rama «más que de costumbre»: ídem');
  ok(sint(40.0).includes(`la cifra es 64,2%, que ${AVISO_MEZCLA}. En todo tu historial cortas 6 de cada 10 canciones; este año, 4.`), 'rama «aguantas más»: «…la cifra es 64,2%, que mezcla dos formas de contar.», y la frase «de cada 10» sigue detrás, igual');
  ok(!/\d/.test(AVISO_MEZCLA) && !/%|habría|más|menos/.test(AVISO_MEZCLA), 'el aviso no trae ningún número, ni un «habría», ni una comparación');
}

console.log(`\n${fallaron === 0 ? '✓' : '✗'} corte-saltos: ${pasaron} asserts ok${fallaron ? `, ${fallaron} fallo(s)` : ''}`);
process.exit(fallaron ? 1 : 0);
