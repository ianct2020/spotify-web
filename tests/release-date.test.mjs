// tests/release-date.test.mjs — el orden «más nuevo primero» de #discover-artists (v=246)
//
// Hasta v=245 los lanzamientos de cada artista salían en el orden en que la base
// los había recibido: medido sobre la base real de Ian (300 artistas, 13.006
// lanzamientos), 296 discografías mezcladas, 2 ascendentes y 1 descendente.
//
// Las secuencias de abajo NO son inventadas: son las que se leyeron del DOM de la
// vista en producción (v=245) el 26/09/2026, con el orden en que salían.
//
// Dos cosas se cuidan además del orden, y las dos son de estructura:
//   1. El criterio de fecha es UNO. `releaseTs` vive en `util/release-date.js`
//      y `discover-common.js` lo re-exporta; si alguien vuelve a escribirlo
//      allí, el criterio de `#new-releases` y el de esta vista pueden divergir
//      en silencio (lección 4 del proyecto).
//   2. Se ordena una COPIA. `a.disco` y `a.unheard` se guardan en la base y en el
//      caché de escaneo, y `tieneOrdenNativo()` deduce de su orden si una
//      discografía salió del endpoint nativo o de `/search`. Ordenarlas en sitio
//      cambiaría esa deducción sin fallar y sin avisar.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { releaseTs, masNuevoPrimero } from '../src/js/util/release-date.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };
const ok = (c, msg) => { n++; assert.ok(c, msg); };

const lanz = fechas => fechas.map((release, i) => ({ id: `id${i}`, name: `Disco ${i}`, release }));
const fechasOrdenadas = ls => [...ls].sort(masNuevoPrimero).map(l => l.release);

// ── 1. releaseTs ─────────────────────────────────────────────────────────────
console.log('releaseTs');
eq(releaseTs('2019-03-07'), Date.UTC(2019, 2, 7), 'día completo');
eq(releaseTs('2019-03'), Date.UTC(2019, 2, 15), 'sin día: el 15');
eq(releaseTs('2019'), Date.UTC(2019, 5, 15), 'solo el año: 15 de junio');
eq(releaseTs(''), 0, 'vacío');
eq(releaseTs(undefined), 0, 'sin dato');
eq(releaseTs('sin fecha'), 0, 'texto que no es una fecha');

// ── 2. Las secuencias reales de producción ───────────────────────────────────
console.log('\nLas secuencias reales de v=245');
// Un artista con 3 lanzamientos: en pantalla salían 2020-07-03, 2020-10-02, 2018-06-08.
eq(fechasOrdenadas(lanz(['2020-07-03', '2020-10-02', '2018-06-08'])),
  ['2020-10-02', '2020-07-03', '2018-06-08'], 'tres lanzamientos');

// Un artista con 17 lanzamientos, con un «1994» a secas entre fechas completas.
const calamaro = ['2010-05-18', '1988-01-01', '2006-11-14', '2009-04-07', '2002-01-01', '1994', '1997-01-01',
  '1996-07-22', '1985-01-01', '2006-05-23', '1998-07-22', '2000-07-22', '2016-02-26', '2014-12-02',
  '2009-04-07', '2011-04-26', '2016-12-02'];
eq(fechasOrdenadas(lanz(calamaro)),
  ['2016-12-02', '2016-02-26', '2014-12-02', '2011-04-26', '2010-05-18', '2009-04-07', '2009-04-07',
    '2006-11-14', '2006-05-23', '2002-01-01', '2000-07-22', '1998-07-22', '1997-01-01', '1996-07-22',
    '1994', '1988-01-01', '1985-01-01'], 'diecisiete lanzamientos');

// La propiedad, para cualquier secuencia: nunca sube al ir hacia abajo.
const ts = fechasOrdenadas(lanz(calamaro)).map(releaseTs);
ok(ts.every((t, i) => i === 0 || t <= ts[i - 1]), 'de arriba abajo la fecha no crece nunca');

// ── 3. Lo que decide el orden cuando la fecha no alcanza ─────────────────────
console.log('\nEmpates y datos que faltan');
const mismoDia = [
  { id: 'c', name: 'Charlie', release: '2020-05-01' },
  { id: 'a', name: 'alfa', release: '2020-05-01' },
  { id: 'b', name: 'Bravo', release: '2020-05-01' },
];
eq([...mismoDia].sort(masNuevoPrimero).map(l => l.id), ['a', 'b', 'c'], 'a igual fecha, alfabético (sin distinguir mayúsculas)');
// El orden no depende de en qué orden llegó cada uno a la base: todas las rotaciones dan lo mismo.
const rot = (a, k) => [...a.slice(k), ...a.slice(0, k)];
const salidas = [0, 1, 2].map(k => rot(mismoDia, k).sort(masNuevoPrimero).map(l => l.id).join(''));
eq(new Set(salidas).size, 1, 'da igual el orden de entrada: sale siempre el mismo');
eq(fechasOrdenadas(lanz(['', '2001-01-01', 'sin fecha', '1999'])),
  ['2001-01-01', '1999', '', 'sin fecha'], 'lo que no tiene fecha cae al final, no rompe el sort');
eq([...[]].sort(masNuevoPrimero), [], 'lista vacía');
eq(lanz(['2001']).sort(masNuevoPrimero).length, 1, 'un solo lanzamiento');

// ── 4. Es el MISMO criterio que ya usa #new-releases ─────────────────────────
console.log('\nEl mismo criterio que #new-releases');
// `new-releases.js`: `releaseTs(y.al.release) - releaseTs(x.al.release)`.
const pares = [['2020-01-01', '2019-12-31'], ['2019', '2019-03'], ['2019-03', '2019'], ['2000', '2000'], ['', '1990']];
for (const [a, b] of pares) {
  const nr = releaseTs(b) - releaseTs(a);
  const yo = masNuevoPrimero({ release: a, name: 'x' }, { release: b, name: 'x' });
  eq(Math.sign(yo), Math.sign(nr), `«${a}» contra «${b}»: mismo sentido que #new-releases`);
}

// ── 5. La estructura: un solo criterio y se ordena una copia ─────────────────
console.log('\nLa estructura');
const leer = ruta => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const common = leer('../src/js/features/discover-common.js');
ok(/export\s*\{\s*releaseTs\s*\}\s*from\s*'\.\.\/util\/release-date\.js'/.test(common),
  'discover-common.js re-exporta releaseTs desde util/release-date.js');
ok(!/function\s+releaseTs\s*\(/.test(common), 'y NO tiene su propia releaseTs: no hay un segundo criterio de fecha');
const nuevas = leer('../src/js/features/new-releases.js');
ok(/releaseTs,/.test(nuevas.split("} from './discover-common.js'")[0]), '#new-releases sigue importando releaseTs de discover-common.js');

const vista = leer('../src/js/features/discover-artists.js');
ok(/\.sort\(masNuevoPrimero\)/.test(vista), '#discover-artists ordena con masNuevoPrimero');
ok(!/\b(disco|unheard|unheardAlbums|unheardSingles)\s*\.sort\s*\(/.test(vista),
  'y nadie ordena EN SITIO lo que se guarda (disco / unheard): se ordena la copia que se pinta');

console.log(`\nOK release-date: ${n} asserts`);
