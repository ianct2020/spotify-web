// tests/orden-tapas.test.mjs — «Más nuevas primero» en #covers (v=278)
//
// La decisión de Ian (07/10): los álbumes SIN FECHA van al final en los DOS órdenes.
// Hasta v=278 quedaban al final en ascendente por accidente (`x.date || '9999'`), y
// por eso invertir el comparador no alcanza: pondría lo desconocido arriba de todo, que
// es afirmar que es lo más nuevo.
//
// Se prueba: (1) los dos órdenes son listas invertidas una de otra ENTRE los que sí
// tienen fecha, empates incluidos; (2) los sin fecha están al final en los dos;
// (3) no se muta la lista; (4) con los datos reales del repo; (5) que la vista usa
// ESTE módulo y ofrece la opción.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { compararPorFecha, ordenarPorFecha, sortList, ORDENES_TAPAS } from '../src/js/util/orden-tapas.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, `${msg} — dio ${JSON.stringify(a)}`); };
const ok = (c, msg) => { n++; assert.ok(c, msg); };

const t = (name, date, extra = {}) => ({ name, artist: 'X', date, min: 0, ...extra });
const nombres = l => l.map(a => a.name);

// Con empates (B y C el mismo día) y dos sin fecha (S1, S2) mezclados entre medias.
const lista = [t('S1', ''), t('B', '2020-05-01'), t('A', '2019-01-01'), t('S2', ''), t('C', '2020-05-01'), t('D', '2023-09-30')];

const asc = sortList(lista, 'date-asc');
const desc = sortList(lista, 'date-desc');
eq(nombres(asc), ['A', 'B', 'C', 'D', 'S1', 'S2'], 'ascendente: de la más antigua a la más nueva, y los sin fecha al final');
eq(nombres(desc), ['D', 'C', 'B', 'A', 'S1', 'S2'], 'descendente: de la más nueva a la más antigua, y los sin fecha AL FINAL TAMBIÉN');

// Invertidos entre los que SÍ tienen fecha, empates incluidos.
const conFecha = l => l.filter(a => a.date);
eq(nombres(conFecha(desc)), nombres(conFecha(asc)).reverse(), 'los dos órdenes son listas invertidas una de otra entre los que tienen fecha');
// Y los sin fecha, idénticos y al final en los dos.
const sinFecha = l => l.filter(a => !a.date);
eq(nombres(sinFecha(desc)), nombres(sinFecha(asc)), 'los sin fecha quedan igual en los dos órdenes');
for (const [nom, l] of [['asc', asc], ['desc', desc]]) {
  const primerSin = l.findIndex(a => !a.date);
  ok(primerSin === l.length - 2 && l.slice(primerSin).every(a => !a.date), `${nom}: los dos sin fecha son los dos últimos`);
}

// El caso que el comparador invertido a secas rompería: TODO lo desconocido arriba.
ok(desc[0].date !== '', 'en «más nuevas» lo primero NUNCA es un álbum sin fecha');

// No muta la lista de entrada (la vista guarda `allAlbums` y vuelve a ordenar de ahí).
const antes = nombres(lista);
sortList(lista, 'date-desc'); sortList(lista, 'date-asc'); sortList(lista, 'min-desc'); sortList(lista, 'artist-asc');
eq(nombres(lista), antes, 'sortList no muta la lista que recibe');
ok(sortList(lista, 'date-desc') !== lista, 'devuelve una copia');

// Bordes.
eq(sortList([], 'date-desc'), [], 'lista vacía');
eq(nombres(sortList([t('S', '')], 'date-desc')), ['S'], 'un solo álbum sin fecha');
eq(nombres(sortList([t('A', ''), t('B', '')], 'date-desc')), ['A', 'B'], 'todos sin fecha: se conserva el orden de entrada');
eq(nombres(sortList(lista, 'cualquier-cosa')), nombres(asc), 'un modo desconocido cae en ascendente (como antes)');
ok(compararPorFecha(t('a', '2019-01-01'), t('b', '2020-01-01')) < 0, 'compararPorFecha: menor fecha primero');
eq(nombres(ordenarPorFecha(lista, { descendente: true })), nombres(desc), 'ordenarPorFecha descendente = sortList date-desc');

// Los otros dos órdenes siguen igual.
eq(nombres(sortList([t('a', '', { min: 5 }), t('b', '', { min: 50 }), t('c', '', { min: 9 })], 'min-desc')), ['b', 'c', 'a'], 'min-desc intacto');
eq(nombres(sortList([t('z', '', { artist: 'Zeta' }), t('a', '', { artist: 'Álamo' }), t('m', '', { artist: 'Mar' })], 'artist-asc')), ['a', 'm', 'z'], 'artist-asc intacto (con tildes)');
ok(ORDENES_TAPAS.join() === 'date-asc,date-desc,min-desc,artist-asc', 'los cuatro órdenes');

// ── Con los datos reales del repo (SOLO LECTURA) ────────────────────────────
const real = JSON.parse(readFileSync(new URL('../src/data/history-listened-albums.json', import.meta.url), 'utf8'));
const reales = (real.years || []).flatMap(y => (y.albums || []).map(a => ({ name: a.name, artist: a.artist, date: a.date || '', min: 0 })));
ok(reales.length > 100, `hay datos reales (${reales.length})`);
// Se les suman 40 sin fecha repartidos, como los de «w three» que nunca se escucharon.
const mezcla = reales.flatMap((a, i) => (i % 60 === 0 ? [a, t(`sin-${i}`, '')] : [a]));
const ra = sortList(mezcla, 'date-asc'), rd = sortList(mezcla, 'date-desc');
eq(rd.length, ra.length, 'misma cantidad en los dos órdenes');
eq(conFecha(rd).map(a => a.name + a.date), conFecha(ra).map(a => a.name + a.date).reverse(), 'datos reales: invertidos entre los que tienen fecha');
const cola = l => { const i = l.findIndex(a => !a.date); return i === l.length - sinFecha(l).length && l.slice(i).every(a => !a.date); };
ok(cola(ra) && cola(rd), 'datos reales: los sin fecha, al final en los dos');

// ── La vista usa ESTE módulo y ofrece la opción ─────────────────────────────
const covers = readFileSync(new URL('../src/js/features/covers.js', import.meta.url), 'utf8');
ok(/from '\.\.\/util\/orden-tapas\.js'/.test(covers), 'covers.js importa el orden de util/orden-tapas.js');
ok(!/function sortList/.test(covers), 'covers.js ya no tiene su propio sortList');
ok(!/'9999'/.test(covers) && !/'9999'/.test(readFileSync(new URL('../src/js/util/orden-tapas.js', import.meta.url), 'utf8').replace(/`x\.date \|\| '9999'`/g, '')),
  'no queda el «9999» que mandaba los sin fecha al final por accidente');
ok(/<option value="date-desc"[^>]*>Más nuevas primero<\/option>/.test(covers), 'el selector ofrece «Más nuevas primero»');
ok(/new Set\(ORDENES_TAPAS\)/.test(covers), 'los valores guardados válidos salen de ORDENES_TAPAS (date-desc se recuerda)');
const rel = readFileSync(new URL('../src/js/util/release-date.js', import.meta.url), 'utf8');
ok(!/orden-tapas|compararPorFecha/.test(rel), 'util/release-date.js no se tocó');

console.log(`  ${n} asserts OK`);
