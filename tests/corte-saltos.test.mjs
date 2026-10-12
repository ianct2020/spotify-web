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
import { anioSinCampoSkipped, esElAnioDelCorte, PRIMER_SKIPPED_TRUE, AVISO_MEZCLA, lineaBaseSaltos } from '../src/js/util/corte-saltos.js';
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

console.log('\n2. 2023-2026: `pasoDentroDeTodo()` devuelve lo de v=291 con la tabla de reemplazos aplicada, y nada más');
const conCampo = stats.years.filter(y => !anioSinCampoSkipped(y.year));
const sinCampo = stats.years.filter(y => anioSinCampoSkipped(y.year));
{
  igual(conCampo.map(y => y.year).join(','), '2023,2024,2025,2026', 'los años con el campo');
  // v=296 (tanda 44): estos cuatro años se comparan contra la LÍNEA BASE de los años con el
  // campo (`lineaBaseSaltos()`: 68,5 % de 2023 a 2026) y no contra el total. La referencia (v=291)
  // trae la comparación contra el total viejo y NO SE REGENERA: lo que se afirma es que el objeto
  // de hoy es IDÉNTICO a la referencia después de aplicarle EXACTAMENTE esta tabla de reemplazos
  // (cada cláusula de comparación de v=291 → la de hoy; en 2026, además, la frase «de cada 10»,
  // que con la base sale: 7 contra 6), y nada más.
  //
  // Historia de este assert: hasta v=294 era `JSON.stringify(paso(y)) === referencia[y.year]` a
  // secas; en v=295 (tanda 43) pasó a una tabla viejo→nuevo de porcentajes (64,1 → 64,2 y tres
  // años) más la cláusula «, que mezcla dos formas de contar» pegada al total. En v=296 esa
  // cláusula se fue de estas ramas: la comparación ya no mezcla nada.
  const BASE = 'de 2023 a 2026, los años en que Spotify ya anotaba los saltos';
  //            la cláusula de v=291 (en la referencia)                                       → la de hoy (v=296)
  const REEMPLAZOS = {
    2023: [['74,9% contra el 64,1% histórico.',                                                '74,9% contra el 68,5% ' + BASE + '.']],
    2024: [['71,8% contra el 64,1% histórico.',                                                '71,9% contra el 68,5% ' + BASE + '.']],
    2025: [['cortas el 66,7% de lo que pones, contra el 64,1% histórico.',                     'cortas el 66,8% de lo que pones, contra el 68,5% ' + BASE + '.']],
    2026: [['dejas a medias el 58,4% de lo que pones, cuando en el total de tu historial la cifra es 64,1%.',
            'dejas a medias el 58,5% de lo que pones, contra el 68,5% ' + BASE + '. En esos años cortas 7 de cada 10 canciones; este año, 6.']],
  };
  const RAMA = (f) => /igual que siempre/.test(f) ? 'igual' : /aguantas más/.test(f) ? 'menos' : /más que de costumbre/.test(f) ? 'más' : '?';
  // La rama que tiene que salir, escrita a mano (la de la referencia, que no cambia).
  const RAMA_ESPERADA = { 2023: 'más', 2024: 'más', 2025: 'igual', 2026: 'menos' };
  igual(Object.keys(REEMPLAZOS).join(','), '2023,2024,2025,2026', 'la tabla de reemplazos cubre los cuatro años con el campo');
  for (const y of conCampo) {
    const hoy = JSON.stringify(paso(y));
    let esperado = referencia[y.year];
    for (const [de, a] of REEMPLAZOS[y.year]) {
      igual(esperado.split(de).length - 1, 1, `${y.year}: la referencia trae UNA vez la cláusula de v=291 «${de}»`);
      esperado = esperado.split(de).join(a);
    }
    ok(hoy === esperado, `${y.year}: JSON.stringify idéntico al de la referencia de v=291 después de aplicar SOLO la tabla de reemplazos`);
    igual(RAMA(paso(y).cuerpo), RAMA(JSON.parse(referencia[y.year]).cuerpo), `${y.year}: la rama de la comparación es la misma de la referencia`);
    igual(RAMA(paso(y).cuerpo), RAMA_ESPERADA[y.year], `${y.year}: y es «${RAMA_ESPERADA[y.year]}»`);
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

  // El paso «dentro de todo»: desde v=296 la trae SOLO el camino de reserva (cuando
  // `lineaBaseSaltos()` da `null`), pegada a la mención del total en las TRES ramas. Hasta v=295
  // estos asserts afirmaban lo mismo para el camino ÚNICO; las ramas de la línea base no la
  // llevan (sección 6).
  const ap = codigo['src/js/features/wrapped-apertura.js'];
  ok(/const delTotal = `, que \$\{AVISO_MEZCLA\}`;/.test(ap), 'wrapped-apertura.js: la cláusula del camino de reserva es `, que ${AVISO_MEZCLA}`');
  igual((ap.match(/\$\{pct\(t\.skip_pct\)\}( histórico)?\$\{delTotal\}\./g) || []).length, 3, 'y va detrás de `pct(t.skip_pct)` en las tres ramas de reserva que nombran el total');
  igual((ap.match(/pct\(t\.skip_pct\)/g) || []).length, 3, 'que son las únicas tres menciones del total en el archivo');
  // Con números sintéticos, una frase por rama. Estos años NO traen skips/plays_raw/plays_junk,
  // así que `lineaBaseSaltos()` da `null` y pasan por el camino de reserva: son su cobertura.
  const sintStats = { totals: { plays_valid: 1000, skip_pct: 64.2 }, years: [{ year: 2029 }, { year: 2030 }] };
  igual(lineaBaseSaltos(sintStats.years), null, 'los años sintéticos no traen los tres campos: `lineaBaseSaltos()` da null (camino de reserva)');
  const sint = (pctAnio) => pasoDentroDeTodo({
    y: { year: 2030, plays: 100, skip_pct: pctAnio }, fmtMinutes,
    stats: sintStats,
  }).cuerpo;
  ok(sint(66.0).includes(`contra el 64,2% histórico, que ${AVISO_MEZCLA}.`), 'reserva, rama «igual que siempre»: «…contra el 64,2% histórico, que mezcla dos formas de contar.»');
  ok(sint(75.0).includes(`contra el 64,2% histórico, que ${AVISO_MEZCLA}.`), 'reserva, rama «más que de costumbre»: ídem');
  ok(sint(40.0).includes(`la cifra es 64,2%, que ${AVISO_MEZCLA}. En todo tu historial cortas 6 de cada 10 canciones; este año, 4.`), 'reserva, rama «aguantas más»: «…la cifra es 64,2%, que mezcla dos formas de contar.», y la frase «de cada 10» sigue detrás, igual');
  ok(!/\d/.test(AVISO_MEZCLA) && !/%|habría|más|menos/.test(AVISO_MEZCLA), 'el aviso no trae ningún número, ni un «habría», ni una comparación');
}


// ── 6. La línea base: los años con el campo se comparan contra esos años (v=296) ──
//
// `totals.skip_pct` suma 2018-2022, en los que Spotify no anotaba los saltos, y eso lo baja: un año
// bien medido contra el total exageraba cuánto se corta de más. `lineaBaseSaltos()` es la misma
// cuenta que el total restringida a los años con el campo, calculada en el navegador.

console.log('\n6. La línea base de los años que anotan los saltos');
{
  // La cuenta a mano, sobre `src/data/history-stats.json` (tanda 44, 11/10/2026):
  //   año    skips    plays_raw  plays_junk  raw − junk
  //   2023   25.686   34.315      2          34.313
  //   2024   36.044   50.183     74          50.109
  //   2025   40.244   60.292     49          60.243
  //   2026   17.304   29.654     78          29.576
  //   Σ     119.278  174.444    203         174.241   →  119.278 / 174.241 = 68,456 %  →  68,5
  //   (sin sacar la basura daría 119.278 / 174.444 = 68,376 → 68,4: el divisor de hasta v=294)
  const B = lineaBaseSaltos(stats.years);
  igual(B && B.pct, 68.5, 'JSON real: `pct` = 68,5 (119.278 / 174.241)');
  igual(B && B.desde, 2023, 'JSON real: `desde` = 2023');
  igual(B && B.hasta, 2026, 'JSON real: `hasta` = 2026');
  igual(B && B.saltos, 119278, 'JSON real: `saltos` = 119.278');
  igual(B && B.crudas, 174241, 'JSON real: `crudas` = 174.241 (ya sin la basura)');
  igual(B && B.anios.join(','), '2023,2024,2025,2026', 'JSON real: entran los cuatro años con el campo');

  // Sintéticos.
  const Y = (year, skips, plays_raw, plays_junk = 0) => ({ year, skips, plays_raw, plays_junk });
  // 2031 tiene 90 saltos de 900 = 10 %; 2032, 80 de 100 = 80 %.
  // Cociente de las sumas: 170/1000 = 17,0. Promedio de los porcentajes: (10 + 80) / 2 = 45,0.
  igual(lineaBaseSaltos([Y(2031, 90, 900), Y(2032, 80, 100)])?.pct, 17, 'es el cociente de las SUMAS (17,0) y no el promedio de los porcentajes (45,0)');
  igual(lineaBaseSaltos([Y(2031, 90, 910, 10), Y(2032, 80, 100)])?.pct, 17, 'y el divisor resta la basura: 170 / (910 − 10 + 100) = 17,0');
  igual(lineaBaseSaltos([Y(2020, 999, 1000), Y(2022, 999, 1000), Y(2031, 90, 900), Y(2032, 80, 100)])?.pct, 17, 'excluye los años con `anioSinCampoSkipped` (2020 y 2022 no cuentan)');
  igual(lineaBaseSaltos([Y(2020, 999, 1000), Y(2022, 999, 1000), Y(2031, 90, 900), Y(2032, 80, 100)])?.desde, 2031, 'y `desde` es el primer año CON el campo');
  igual(lineaBaseSaltos([Y(2022, 999, 1000), Y(2031, 90, 900)]), null, 'null con un solo año con el campo (comparar un año contra sí mismo no dice nada)');
  igual(lineaBaseSaltos([Y(2031, 90, 900), { year: 2032, skips: 80, plays_raw: 100 }]), null, 'null si a un año con el campo le falta `plays_junk` (BYOH anterior a v=295)');
  igual(lineaBaseSaltos([Y(2031, 90, 900), { year: 2032, plays_raw: 100, plays_junk: 0 }]), null, 'null si le falta `skips` (BYOH anterior a v=291)');
  igual(lineaBaseSaltos([]), null, 'null sin años');

  // El paso de 2023-2026 con el JSON real: la base, sin el aviso y sin el total.
  const pctTotal = stats.totals.skip_pct.toFixed(1).replace('.', ',') + '%';
  for (const y of conCampo) {
    const c = paso(y).cuerpo;
    ok(c.includes(`contra el 68,5% de ${B.desde} a ${B.hasta}, los años en que Spotify ya anotaba los saltos.`), `${y.year}: compara contra la base («contra el 68,5% de 2023 a 2026, los años en que Spotify ya anotaba los saltos.»)`);
    ok(!c.includes(AVISO_MEZCLA), `${y.year}: NO trae \`AVISO_MEZCLA\` (la comparación ya no mezcla)`);
    ok(!c.includes(pctTotal), `${y.year}: NO trae el total (${pctTotal})`);
    ok(!/todo tu historial|histórico/.test(c), `${y.year}: no dice «histórico» ni «todo tu historial» de la base`);
  }
  ok(paso(conCampo.find(y => y.year === 2026)).cuerpo.includes(' En esos años cortas 7 de cada 10 canciones; este año, 6.'), '2026: con la base sale la frase «de cada 10» (7 contra 6; contra el total eran 6 y 6 y no salía)');

  // El paso con `lineaBaseSaltos() === null`: IDÉNTICO a v=295. Se le saca `plays_junk` a un año
  // (un BYOH de antes de v=295) y la salida tiene que ser la de hoy de la referencia de la tanda
  // 43, escrita a mano para 2023: contra el total, con el aviso.
  const statsSinJunk = { ...stats, years: stats.years.map(y => y.year === 2024 ? (({ plays_junk, ...r }) => r)(y) : y) };
  igual(lineaBaseSaltos(statsSinJunk.years), null, 'sin `plays_junk` en un año, la base es null');
  const y23 = statsSinJunk.years.find(y => y.year === 2023);
  const reserva = pasoDentroDeTodo({ stats: statsSinJunk, y: y23, MESES, MESES_LARGOS, fmtMinutes, fmtDia, ultimoDia: null }).cuerpo;
  igual(reserva, 'De las 104.147 reproducciones válidas que Spotify tiene tuyas en 9 años, 16,6% son de 2023. ' +
    `Aunque este año cortas más que de costumbre: 74,9% contra el 64,2% histórico, que ${AVISO_MEZCLA}. ` +
    'Ninguna tarjeta de las de abajo da este número: todas miran un año por vez.',
    'con la base en null, 2023 sale EXACTAMENTE como en v=295: contra el 64,2% histórico, con el aviso');
  const reserva26 = pasoDentroDeTodo({ stats: statsSinJunk, y: statsSinJunk.years.find(y => y.year === 2026), MESES, MESES_LARGOS, fmtMinutes, fmtDia, ultimoDia: null }).cuerpo;
  ok(reserva26.includes(`cuando en el total de tu historial la cifra es 64,2%, que ${AVISO_MEZCLA}.`) && !/de cada 10/.test(reserva26), 'y 2026 en reserva: contra el total, con el aviso, sin la frase «de cada 10» (6 y 6), como en v=295');

  // Lo estático: la rama de la base no escribe años, ni el aviso, ni el total.
  const sinCom = (x) => x.split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
  const ap = sinCom(leer('src/js/features/wrapped-apertura.js'));
  const ramaBase = (/lineaBaseSaltos\(stats\.years\)\) \{([\s\S]*?)\} else if/.exec(ap) || ['', ''])[1];
  ok(ramaBase.length > 200, 'wrapped-apertura.js: se encuentra la rama de la línea base');
  ok(!/AVISO_MEZCLA|delTotal/.test(ramaBase), 'la rama de la línea base no usa `AVISO_MEZCLA`');
  ok(!/t\.skip_pct/.test(ramaBase), 'ni `t.skip_pct`');
  igual((ramaBase.match(/\$\{pct\(B\.pct\)\} \$\{base\}\./g) || []).length, 3, 'y compara contra `${pct(B.pct)} ${base}.` en las tres ramas');
  ok(!/20(1\d|2\d)/.test(ramaBase), 'y no escribe ningún año a mano (`desde`/`hasta` salen del dato)');
}

console.log(`\n${fallaron === 0 ? '✓' : '✗'} corte-saltos: ${pasaron} asserts ok${fallaron ? `, ${fallaron} fallo(s)` : ''}`);
process.exit(fallaron ? 1 : 0);
