// Test de la aritmética del drag & drop del panel de orden de W-Three (v=170).
//
// El caso que lo motivó: Ian arrastra la ÚLTIMA fila al primer lugar, la suelta
// y vuelve sola. El drop nativo no se puede disparar con un ratón sintético, así
// que la cuenta se sacó a util/reorder-drop.js y se verifica acá.
// Correr con: node tests/wthree-drop-index.test.mjs

import { insercionPorPuntero, moverA, indicadorPara } from '../src/js/util/reorder-drop.js';

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}`); failed++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Tres filas de 30 px con 4 px de hueco, la lista arrancando en y=100.
const FILAS = [
  { top: 100, height: 30 },   // centro 115
  { top: 134, height: 30 },   // centro 149
  { top: 168, height: 30 },   // centro 183
];

console.log('\nel caso que lo motivó: la última al primer lugar');
{
  // El puntero en el tope del panel, POR ENCIMA de la primera fila.
  ok(insercionPorPuntero(FILAS, 96) === 0, 'por encima de la primera fila → inserta en 0');
  ok(insercionPorPuntero(FILAS, 101) === 0, 'en el borde de arriba de la primera fila → 0');
  ok(insercionPorPuntero(FILAS, 114) === 0, 'mitad de arriba de la primera fila → 0');
  ok(eq(moverA(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']), 'mover la última al hueco 0');
}

console.log('\nzonas muertas que antes no eran destino');
{
  ok(insercionPorPuntero(FILAS, 132) === 1, 'el hueco entre la fila 1 y la 2 → 1');
  ok(insercionPorPuntero(FILAS, 210) === 3, 'por debajo de la última → al final');
  ok(insercionPorPuntero(FILAS, -50) === 0, 'muy por encima del panel → 0');
}

console.log('\nlos centros mandan');
{
  ok(insercionPorPuntero(FILAS, 116) === 1, 'pasado el centro de la fila 1 → 1');
  ok(insercionPorPuntero(FILAS, 148) === 1, 'antes del centro de la fila 2 → 1');
  ok(insercionPorPuntero(FILAS, 150) === 2, 'pasado el centro de la fila 2 → 2');
  ok(insercionPorPuntero([], 120) === 0, 'lista vacía → 0');
}

console.log('\nmoverA: los movimientos que no cambian nada');
{
  ok(eq(moverA(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']), 'soltar sobre uno mismo');
  ok(eq(moverA(['a', 'b', 'c'], 1, 2), ['a', 'b', 'c']), 'soltar en el hueco de justo debajo');
  ok(eq(moverA(['a', 'b', 'c'], 5, 0), ['a', 'b', 'c']), 'origen fuera de rango');
}

console.log('\nmoverA: el resto de los movimientos');
{
  ok(eq(moverA(['a', 'b', 'c'], 0, 3), ['b', 'c', 'a']), 'la primera al final');
  ok(eq(moverA(['a', 'b', 'c'], 0, 2), ['b', 'a', 'c']), 'la primera al medio');
  ok(eq(moverA(['a', 'b', 'c'], 2, 1), ['a', 'c', 'b']), 'la última al medio');
  ok(eq(moverA(['a', 'b', 'c', 'd'], 3, 1), ['a', 'd', 'b', 'c']), '4 elementos, la última a la posición 2');
  // Cada elemento a cada hueco: la lista nunca pierde ni duplica nada.
  const base = ['a', 'b', 'c', 'd', 'e'];
  let sano = true;
  for (let d = 0; d < base.length; d++) {
    for (let ins = 0; ins <= base.length; ins++) {
      const r = moverA(base, d, ins);
      if (r.length !== base.length || new Set(r).size !== base.length) sano = false;
    }
  }
  ok(sano, 'fuerza bruta 5×6: nunca pierde ni duplica un elemento');
}

console.log('\nindicadorPara');
{
  ok(eq(indicadorPara(0, 3), { fila: 0, lado: 'above' }), 'arriba de todo marca la fila 0 por arriba');
  ok(eq(indicadorPara(3, 3), { fila: 2, lado: 'below' }), 'al final marca la última por abajo');
  ok(indicadorPara(0, 0) === null, 'sin filas no hay indicador');
}

console.log(`\n${passed} ok, ${failed} fallos`);
process.exit(failed ? 1 : 0);
