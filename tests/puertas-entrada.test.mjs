// tests/puertas-entrada.test.mjs — la cuenta de `#puertas` (v=308, tanda 56)
//
// `util/puertas-entrada.js` es la parte PURA de la vista: recibe `totals` y
// `artists` de `loadArtistTracks()` (v3: `totals[a][6]` es el tema de entrada y
// `totals[a][7]` el día del segundo tema, o null) y arma una fila por artista.
//
// Lo que se vigila, y por qué:
//   · El universo es `universo()` de `util/mapa-paises.js`, IMPORTADO: el mismo
//     largo y el mismo orden que llamándola directo. Una regla escrita dos veces
//     diverge (v=219); el artista de 9,5 min está para que una copia con otro
//     umbral se note.
//   · «Sigue siendo el top» por `songKey`, no por id: un remaster de la entrada
//     ES la entrada.
//   · Los días entre [5] y [7] se cuentan sobre las cadenas `YYYY-MM-DD` (días de
//     calendario UTC), nunca con la hora local. Toda la suite corre con
//     `TZ=America/Argentina/Buenos_Aires`: en una máquina en UTC el bug no se ve.
//   · `null` en [7] es «solo un tema», no 0 («el mismo día»).
//   · Un `artistTracks` sin [6] (un historial importado antes de v=308) se DICE:
//     la función no devuelve una lista vacía ni una con huecos.
//
// 🔴 Todo es INVENTADO: artistas, temas, ids, fechas y minutos (el repo es público).
//
// Correr con: node tests/puertas-entrada.test.mjs

// La zona, ANTES de tocar ningún Date (ver tests/fecha-dia-del-dato.test.mjs).
process.env.TZ = 'America/Argentina/Buenos_Aires';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as P from '../src/js/util/puertas-entrada.js';
import { universo } from '../src/js/util/mapa-paises.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const vs = (a, b) => `esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`;

// ── Los datos de mentira ─────────────────────────────────────────────────────
// totals[a] = [plays, minutos, primer año, último año, curva, [5] día de entrada, [6] [tema, id], [7] día del 2.º o null]
// artists[a] = [[título, plays, minutos, id], …], el primero es el top (más plays; a igualdad, más minutos).
const T = (min, d5, entrada, d7) => [10, min, +d5.slice(0, 4), 2026, [], d5, entrada, d7];
const totals = {
  'Bruma': T(80, '2021-01-30', ['Hoja', 'hoja1'], '2021-02-02'),             // cruza un fin de mes: 3 días; el top es otro
  'Alba Norte': T(120, '2020-03-10', ['Faro', 'faro1'], '2020-03-10'),       // el segundo tema el mismo día
  'Cauce': T(60, '2019-12-31', ['Luz', 'luz1'], '2020-01-01'),               // cruza un año: 1 día; el top es un remaster de la entrada
  'Eco': T(30, '2022-05-01', ['Viento', 'viento1'], '2022-06-10'),           // 40 días; empata en minutos con Duna
  'Duna': T(30, '2023-07-04', ['Sola', 'sola1'], null),                      // un solo tema en todo el historial
  'Fresno': T(9.5, '2024-01-01', ['Rama', 'rama1'], '2024-01-05'),           // 9,5 min: fuera del universo (10 o más)
  'Gris': T(3, '2025-02-02', ['Nube', 'nube1'], null),                       // fuera
};
const artists = {
  'Bruma': [['Raíz', 9, 30, 'raiz1'], ['Hoja', 2, 7, 'hoja1']],
  'Alba Norte': [['Faro', 8, 40, 'faro1'], ['Muelle', 3, 12, 'muelle1']],
  'Cauce': [['Luz - Remastered 2019', 7, 25, 'luz2'], ['Luz', 2, 6, 'luz1'], ['Orilla', 1, 3, 'orilla1']],
  'Eco': [['Viento', 4, 15, 'viento1'], ['Sur', 3, 10, 'sur1']],
  'Duna': [['Sola', 9, 30, 'sola1']],
  'Fresno': [['Rama', 2, 5, 'rama1']],
  'Gris': [['Nube', 1, 3, 'nube1']],
};

// ═══════════════════════════════════════════════════════════════════════════
console.log('1. El universo es universo(), importado');
const r = P.armarPuertas(totals, artists);
const u = universo(totals, artists);
ok(r && r.sinEntrada === false, 'con v3 no dice que falte nada', vs(r?.sinEntrada, false));
ok(Array.isArray(r?.filas), 'devuelve las filas');
ok(r.filas.length === u.length, `mismo largo que universo() (${u.length})`, vs(r.filas.length, u.length));
ok(igual(r.filas.map(f => f.nombre), u.map(x => x.nombre)), 'mismo orden que universo()', vs(r.filas.map(f => f.nombre), u.map(x => x.nombre)));
ok(igual(r.filas.map(f => f.nombre), ['Alba Norte', 'Bruma', 'Cauce', 'Duna', 'Eco']), 'la cuenta a mano: por minutos y, a igualdad, por nombre; sin los de menos de 10 min',
  vs(r.filas.map(f => f.nombre), ['Alba Norte', 'Bruma', 'Cauce', 'Duna', 'Eco']));
ok(!r.filas.some(f => f.nombre === 'Fresno'), 'el de 9,5 min no entra');
const src = readFileSync(join(raiz, 'src/js/util/puertas-entrada.js'), 'utf8');
ok(/import\s*\{[^}]*\buniverso\b[^}]*\}\s*from\s*'\.\/mapa-paises\.js'/.test(src), 'importa universo() de ./mapa-paises.js');
ok(!/>=?\s*(?:10|9|MIN_MINUTOS)\b/.test(src.replace(/\/\/.*$/gm, '')), 'y no escribe su propio filtro de minutos');
ok(/from\s*'\.\/fecha\.js'/.test(src) && /\bfmtDia\b/.test(src), 'el día se formatea con fmtDia() de ./fecha.js');
ok(/from\s*'\.\/song-identity\.js'/.test(src) && /\bsongKey\b/.test(src), 'compara con songKey() de ./song-identity.js');
ok(!/document|window|fetch\(|indexedDB/.test(src.replace(/\/\/.*$/gm, '')), 'es PURO: sin DOM, sin red, sin IndexedDB');

// ═══════════════════════════════════════════════════════════════════════════
console.log('2. Cada fila');
const fila = (n) => r.filas.find(f => f.nombre === n);
const a = fila('Alba Norte'), b = fila('Bruma'), c = fila('Cauce'), d = fila('Duna'), e = fila('Eco');
ok(a.tema === 'Faro' && a.temaId === 'faro1' && a.dia === '2020-03-10', 'el tema de entrada y su día salen de [6] y [5]', vs([a.tema, a.temaId, a.dia], ['Faro', 'faro1', '2020-03-10']));
ok(a.diaTexto === '10 mar 2020', 'el día con fmtDia(), sin moverlo de zona (TZ de Buenos Aires)', vs(a.diaTexto, '10 mar 2020'));
ok(c.diaTexto === '31 dic 2019', 'el 31 de diciembre sigue en 2019 en Buenos Aires', vs(c.diaTexto, '31 dic 2019'));
ok(a.sigue === true && a.top === 'Faro', 'Alba Norte: la entrada sigue siendo el top', vs([a.sigue, a.top], [true, 'Faro']));
ok(b.sigue === false && b.top === 'Raíz', 'Bruma: ya no; el top de hoy es otro y se nombra', vs([b.sigue, b.top], [false, 'Raíz']));
ok(c.sigue === true, 'Cauce: el top es un REMASTER de la entrada → «sí» (por songKey, no por id)', vs(c.sigue, true));
ok(d.sigue === true && e.sigue === true, 'Duna y Eco: sí');
ok(a.dias === 0 && a.hasta === 'el mismo día', 'el segundo tema el mismo día → 0 y «el mismo día»', vs([a.dias, a.hasta], [0, 'el mismo día']));
ok(b.dias === 3 && b.hasta === '3 días', 'cruza un fin de mes (30 ene → 2 feb) → 3 días', vs([b.dias, b.hasta], [3, '3 días']));
ok(c.dias === 1 && c.hasta === '1 día', 'cruza un año (31 dic → 1 ene) → 1 día, en singular', vs([c.dias, c.hasta], [1, '1 día']));
ok(d.dias === null && d.hasta === 'solo un tema', '[7] null → «solo un tema» (no 0, no «el mismo día»)', vs([d.dias, d.hasta], [null, 'solo un tema']));
ok(e.dias === 40 && e.hasta === '40 días', '1 may → 10 jun → 40 días', vs([e.dias, e.hasta], [40, '40 días']));

// ═══════════════════════════════════════════════════════════════════════════
console.log('3. Los días y su texto');
ok(P.diasEntre('2024-02-28', '2024-03-01') === 2, 'año bisiesto: 28 feb → 1 mar = 2', vs(P.diasEntre('2024-02-28', '2024-03-01'), 2));
ok(P.diasEntre('2023-02-28', '2023-03-01') === 1, 'año no bisiesto: 28 feb → 1 mar = 1');
ok(P.diasEntre('2019-12-31', '2020-01-01') === 1, 'cruza un año = 1');
ok(P.diasEntre('2021-01-30', '2021-02-02') === 3, 'cruza un fin de mes = 3');
ok(P.diasEntre('2017-03-15', '2025-02-20') === 2899, 'un tramo largo: 15 mar 2017 → 20 feb 2025 = 2899', vs(P.diasEntre('2017-03-15', '2025-02-20'), 2899));
ok(P.diasEntre('2020-03-10', null) === null, 'sin segundo día → null');
ok(P.textoHasta(null) === 'solo un tema' && P.textoHasta(0) === 'el mismo día' && P.textoHasta(1) === '1 día' && P.textoHasta(2) === '2 días',
  'textoHasta: null · 0 · 1 · 2', vs([P.textoHasta(null), P.textoHasta(0), P.textoHasta(1), P.textoHasta(2)], ['solo un tema', 'el mismo día', '1 día', '2 días']));
ok(P.textoHasta(2048) === '2048 días' && P.textoHasta(12345) === '12.345 días', 'números en es-ES: «2048» sin separador, «12.345» con punto',
  vs([P.textoHasta(2048), P.textoHasta(12345)], ['2048 días', '12.345 días']));

// ═══════════════════════════════════════════════════════════════════════════
console.log('4. Un artistTracks sin el tema de entrada (importado antes de v=308)');
const totalsV2 = Object.fromEntries(Object.entries(totals).map(([k, t]) => [k, t.slice(0, 6)]));
const r2 = P.armarPuertas(totalsV2, artists);
ok(r2 && r2.sinEntrada === true, 'lo dice: sinEntrada', vs(r2?.sinEntrada, true));
ok(r2 && r2.filas === null, 'y NO devuelve filas (ni vacías ni con huecos)', vs(r2?.filas, null));
const mezcla = { ...totals, 'Bruma': totals['Bruma'].slice(0, 6) };
ok(P.armarPuertas(mezcla, artists).sinEntrada === true, 'con un solo artista sin [6] también lo dice (no pinta una lista con huecos)');
ok(P.armarPuertas({}, {}).sinEntrada === false && igual(P.armarPuertas({}, {}).filas, []), 'sin artistas: lista vacía, sin decir que falte nada');
ok(P.armarPuertas(null, null).sinEntrada === false, 'sin datos no revienta');

// ═══════════════════════════════════════════════════════════════════════════
console.log('5. La paginación');
ok(P.POR_PAGINA === 100, 'de a 100', vs(P.POR_PAGINA, 100));
const sinTop = P.armarPuertas({ 'Hilo': T(20, '2020-01-01', ['Aguja', 'aguja1'], null) }, {});
ok(sinTop.filas[0].sigue === null && sinTop.filas[0].top === null, 'sin la lista de temas, «sigue» queda en null (no inventa un «no»)');

// Y que la zona de Buenos Aires de verdad mueve el día (si no, la suite no vigila nada).
ok(new Date('2020-03-10').getDate() === 9, 'con TZ de Buenos Aires, new Date("2020-03-10").getDate() da 9');

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron`);
if (fallaron) process.exit(1);
