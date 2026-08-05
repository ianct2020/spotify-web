// Test del cálculo de posiciones locales post add/remove que reemplaza el
// refetch entero de la playlist en el guardar de W-Three.
// Correr con: node tests/wthree-shifts.test.mjs

import { computeUpdatedPickPositions } from '../src/js/util/reorder-shifts.js';

let passed = 0, failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n    esperado: ${e}\n    obtenido: ${a}`); failed++; }
}

// Helper: crea un pick {id, uri, name, pos}
const p = (id, pos) => ({ id, uri: `spotify:track:${id}`, name: id, pos });

// ── Caso 1: solo reorder (sin add/remove) ──────────────────────────────
console.log('\nsolo reorder — swap adyacente');
{
  const orig = [p('A', 100), p('B', 200), p('C', 300)];
  const target = [p('B', null), p('A', null), p('C', null)]; // orderedPicks
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: [], toRemoveUris: [], addInsertPos: null,
  });
  eq(out.map(x => `${x.id}@${x.pos}`), ['A@100', 'B@200', 'C@300'],
     'posiciones intactas (el reorder real lo hace el PUT después)');
}

// ── Caso 2: add sin reorder ────────────────────────────────────────────
console.log('\nadd sin reorder — 1 nuevo al final de los picks del álbum');
{
  const orig = [p('A', 100), p('B', 101)];
  const target = [
    { id: 'A', uri: 'spotify:track:A', name: 'A' },
    { id: 'B', uri: 'spotify:track:B', name: 'B' },
    { id: 'N', uri: 'spotify:track:N', name: 'N' }, // nuevo
  ];
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: ['spotify:track:N'], toRemoveUris: [], addInsertPos: 102,
  });
  eq(out.map(x => `${x.id}@${x.pos}`), ['A@100', 'B@101', 'N@102'],
     'nuevo pick va en insertPos, originales no shiftean');
}

// ── Caso 3: add + reorder ──────────────────────────────────────────────
console.log('\nadd + reorder — el nuevo va primero');
{
  const orig = [p('A', 100)];
  const target = [
    { id: 'N', uri: 'spotify:track:N', name: 'N' },
    { id: 'A', uri: 'spotify:track:A', name: 'A' },
  ];
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: ['spotify:track:N'], toRemoveUris: [], addInsertPos: 101,
  });
  eq(out.map(x => `${x.id}@${x.pos}`), ['A@100', 'N@101'],
     'post add: A queda en 100, N en 101 — el reorder los va a intercambiar');
}

// ── Caso 4: remove sin reorder ─────────────────────────────────────────
console.log('\nremove — el del medio');
{
  const orig = [p('A', 100), p('B', 101), p('C', 102)];
  const target = [
    { id: 'A', uri: 'spotify:track:A', name: 'A' },
    { id: 'C', uri: 'spotify:track:C', name: 'C' },
  ];
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: [], toRemoveUris: ['spotify:track:B'], addInsertPos: null,
  });
  eq(out.map(x => `${x.id}@${x.pos}`), ['A@100', 'C@101'],
     'C shiftea -1 porque B (pos<C.pos) se removió');
}

// ── Caso 5: remove del principio ───────────────────────────────────────
console.log('\nremove del principio — todos shiftean -1');
{
  const orig = [p('A', 100), p('B', 101), p('C', 102)];
  const target = [
    { id: 'B', uri: 'spotify:track:B', name: 'B' },
    { id: 'C', uri: 'spotify:track:C', name: 'C' },
  ];
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: [], toRemoveUris: ['spotify:track:A'], addInsertPos: null,
  });
  eq(out.map(x => `${x.id}@${x.pos}`), ['B@100', 'C@101'],
     'B y C shiftean -1');
}

// ── Caso 6: add + remove — el nuevo también se ve afectado por el remove ──
console.log('\nadd + remove — combo: el nuevo agregado también shiftea');
{
  const orig = [p('A', 100), p('B', 101)]; // B lo removemos
  const target = [
    { id: 'A', uri: 'spotify:track:A', name: 'A' },
    { id: 'N', uri: 'spotify:track:N', name: 'N' }, // nuevo
  ];
  // add primero (en maxPos+1 = 102), luego remove B (pos=101)
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: ['spotify:track:N'], toRemoveUris: ['spotify:track:B'], addInsertPos: 102,
  });
  // Después del add: A@100, B@101, N@102
  // Después del remove de B: A@100 (0 removes < 100), N@101 (1 remove < 102)
  eq(out.map(x => `${x.id}@${x.pos}`), ['A@100', 'N@101'],
     'N shiftea -1 porque B (pos<N.pos) se removió después del add');
}

// ── Caso 7: remove múltiple ────────────────────────────────────────────
console.log('\nremove múltiple');
{
  const orig = [p('A', 100), p('B', 101), p('C', 102), p('D', 103)];
  const target = [
    { id: 'A', uri: 'spotify:track:A', name: 'A' },
    { id: 'D', uri: 'spotify:track:D', name: 'D' },
  ];
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: [], toRemoveUris: ['spotify:track:B', 'spotify:track:C'], addInsertPos: null,
  });
  eq(out.map(x => `${x.id}@${x.pos}`), ['A@100', 'D@101'],
     'D shiftea -2 (B y C tenían pos<D.pos)');
}

// ── Caso 8: agregar 3 nuevos de una ────────────────────────────────────
console.log('\nagregar 3 nuevos de una');
{
  const orig = [p('A', 100)];
  const target = [
    { id: 'A', uri: 'spotify:track:A', name: 'A' },
    { id: 'N1', uri: 'spotify:track:N1', name: 'N1' },
    { id: 'N2', uri: 'spotify:track:N2', name: 'N2' },
    { id: 'N3', uri: 'spotify:track:N3', name: 'N3' },
  ];
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: ['spotify:track:N1', 'spotify:track:N2', 'spotify:track:N3'],
    toRemoveUris: [], addInsertPos: 101,
  });
  eq(out.map(x => `${x.id}@${x.pos}`), ['A@100', 'N1@101', 'N2@102', 'N3@103'],
     'los 3 nuevos ocupan posiciones consecutivas desde insertPos');
}

// ── Caso 9: caso real Ian — Donda, sólo reorder de 3 picks ─────────────
console.log('\ncaso Ian — reorder de 3 picks (Donda en wthree)');
{
  // Simulación: picks en posiciones típicas dentro de una playlist de 2000 tracks
  const orig = [p('D1', 1547), p('D2', 1548), p('D3', 1549)];
  const target = [
    { id: 'D3', uri: 'spotify:track:D3', name: 'D3' },
    { id: 'D1', uri: 'spotify:track:D1', name: 'D1' },
    { id: 'D2', uri: 'spotify:track:D2', name: 'D2' },
  ];
  const out = computeUpdatedPickPositions(orig, target, {
    toAddUris: [], toRemoveUris: [], addInsertPos: null,
  });
  eq(out.map(x => `${x.id}@${x.pos}`), ['D1@1547', 'D2@1548', 'D3@1549'],
     'posiciones intactas post-shift — el reorder es responsable del cambio real');
}

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
