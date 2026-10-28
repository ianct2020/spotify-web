// tests/hornear-reindexar.test.mjs — el modo `reindexar` de `scripts/hornear-similares.mjs` (tanda 95)
//
// Con un export nuevo el universo gana artistas metidos por minutos, y el avance (que guarda cada
// respuesta por `indice`) queda corrido: `definitivas()` tira y `escanear` salta por índice, o sea que
// le pediría a los artistas equivocados. `reindexar` pasa cada línea al índice de su `pedido` en el
// universo de hoy, por igualdad EXACTA (la de `definitivas()`).
//
// Lo que se vigila, y por qué:
//   · remapea por nombre, y cada línea queda igual salvo `indice` (el avance es el dato crudo);
//   · lo que ya no está en el universo no se copia, y se cuenta (con su `n` y su índice viejo);
//   · nada de normalizar: «aurora lenta» no es «Aurora Lenta» (si no, `definitivas()` tiraría igual);
//   · se niega a pisar: ni un archivo que ya existe ni el mismo viejo, y el viejo queda byte a byte;
//   · después de reindexar `definitivas()` no tira, y lo que falta (`pendientes`, lo que pediría
//     `escanear`) es justo el artista nuevo del universo inventado;
//   · con el avance SIN reindexar, `pendientes` apunta a otro: es el bug que esto arregla.
//
// Contra `aa0fc915` da rojo: `reindexar`, `reindexarArchivos` y `pendientes` no existían.
//
// 🔴 Todo es INVENTADO: los artistas, los minutos y los similares (el repo es público).
//
// Correr con: node tests/hornear-reindexar.test.mjs

import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const H = await import('../scripts/hornear-similares.mjs').catch((e) => { console.log(`  (no se pudo importar el horneado: ${e.message})`); return {}; });

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = (ruta) => createHash('sha256').update(readFileSync(ruta)).digest('hex');

// ── El universo y el avance inventados ──────────────────────────────────────
// El de cuando se escaneó: cuatro artistas y uno que después sale. El de hoy: entra «Banda Nueva» en
// el índice 1 (corre a todos los de abajo), «Cometa Azul» y «Don Inventado» cambian de lugar entre sí y
// «Ya No Está» sale.
const U_VIEJO = ['Aurora Lenta', 'Cometa Azul', 'Don Inventado', 'Eco Falso', 'Ya No Está'].map((nombre, i) => ({ nombre, minutos: 500 - i * 50 }));
const U_HOY = ['Aurora Lenta', 'Banda Nueva', 'Don Inventado', 'Cometa Azul', 'Eco Falso'].map((nombre, i) => ({ nombre, minutos: 600 - i * 50 }));

const linea = (n, indice, clase, extra = {}) => ({
  n, metodo: 'artist.getsimilar', indice, pedido: U_VIEJO[indice].nombre, minutos: U_VIEJO[indice].minutos, limit: 250,
  reintento: 0, comienzo: '2026-01-01T00:00:00.000Z', status: 200, errorLastfm: null, latenciaMs: 100, acao: '*',
  devuelto: U_VIEJO[indice].nombre, similarartists: clase === 'definitiva', similares: [{ name: 'Banda Nueva', match: '0.5', mbid: '' }],
  red: null, clase, ...extra,
});
const AVANCE = [
  linea(1, 0, 'definitiva'),
  linea(2, 1, 'reintentar', { status: 503, similarartists: false, similares: [] }),
  linea(3, 1, 'definitiva'),
  linea(4, 2, 'definitiva'),
  linea(5, 3, 'definitiva', { errorLastfm: 6, similares: [] }),
  linea(6, 4, 'definitiva'),
];

// ── 1. La función pura ──────────────────────────────────────────────────────
try {
  ok(typeof H.reindexar === 'function' && typeof H.pendientes === 'function' && typeof H.reindexarArchivos === 'function',
    'el script exporta reindexar, reindexarArchivos y pendientes');
  const { lineas, descartadas } = H.reindexar(AVANCE, U_HOY);
  ok(igual(lineas.map((p) => [p.n, p.indice]), [[1, 0], [2, 3], [3, 3], [4, 2], [5, 4]]),
    'cada línea va al índice de su pedido en el universo de hoy (los reintentos también)', JSON.stringify(lineas.map((p) => [p.n, p.indice])));
  ok(lineas.every((p) => U_HOY[p.indice].nombre === p.pedido), 'el nombre del índice nuevo es el pedido, en todas');
  ok(lineas.every((p) => { const o = AVANCE.find((a) => a.n === p.n); return igual({ ...o, indice: p.indice }, p); }),
    'cada línea queda igual salvo `indice` (mismas claves, en el mismo orden)');
  ok(igual(descartadas, [{ n: 6, indice: 4 }]), 'la que ya no está en el universo no se copia, y se cuenta con su n y su índice viejo', JSON.stringify(descartadas));
  ok(AVANCE[3].indice === 2 && AVANCE[1].indice === 1, 'el avance de entrada no se modifica');

  // Igualdad exacta: un universo con el nombre en minúsculas no lo encuentra.
  const minus = H.reindexar([linea(1, 0, 'definitiva')], [{ nombre: 'aurora lenta', minutos: 1 }]);
  ok(minus.lineas.length === 0 && minus.descartadas.length === 1, 'sin normalizar: «aurora lenta» no es «Aurora Lenta»');
} catch (e) { ok(false, 'la sección 1 corre', e.stack); }

// ── 2. Lo que arregla: definitivas() y lo que pediría escanear ──────────────
try {
  let tiro = null;
  try { H.definitivas(AVANCE, U_HOY); } catch (e) { tiro = e.message; }
  ok(tiro && /el universo cambió/.test(tiro), 'con el avance viejo y el universo de hoy, definitivas() tira', String(tiro));
  ok(igual(H.pendientes(AVANCE, U_HOY.length), []), 'y escanear con el avance viejo no pediría a nadie: los índices 0-4 «ya están» y «Banda Nueva» se queda sin pedir',
    JSON.stringify(H.pendientes(AVANCE, U_HOY.length)));

  const { lineas } = H.reindexar(AVANCE, U_HOY);
  let m = null, error = null;
  try { m = H.definitivas(lineas, U_HOY); } catch (e) { error = e.message; }
  ok(!error && m && igual([...m.keys()].sort(), [0, 2, 3, 4]), 'después de reindexar definitivas() no tira y trae 4 de 5', error || JSON.stringify(m && [...m.keys()]));
  ok(m && m.get(3).n === 3, 'la definitiva de «Cometa Azul» es la que llegó después del reintento');
  const pend = H.pendientes(lineas, U_HOY.length);
  ok(igual(pend, [1]) && U_HOY[pend[0]].nombre === 'Banda Nueva', 'lo que falta es justo el nuevo: escanear pediría solo a «Banda Nueva»', JSON.stringify(pend));
  ok(igual([...H.hechos(lineas)].sort(), [0, 2, 3, 4]), 'hechos() cuenta solo las definitivas, por índice');
} catch (e) { ok(false, 'la sección 2 corre', e.stack); }

// ── 3. De archivo a archivo: se niega a pisar ───────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'hornear-reindexar-'));
try {
  const viejo = join(dir, 'viejo.jsonl'), nuevo = join(dir, 'nuevo.jsonl'), otro = join(dir, 'otro.jsonl');
  writeFileSync(viejo, AVANCE.map((p) => JSON.stringify(p) + '\n').join(''));
  const antes = sha(viejo);
  const informe = H.reindexarArchivos(viejo, nuevo, { u: U_HOY, huella: 'inventada' });
  ok(informe.leidas === 6 && informe.copiadas === 5 && informe.descartadas === 1 && informe.definitivas === 4 && informe.universo === 5 && informe.huella === 'inventada',
    'el informe: 6 leídas, 5 copiadas, 1 descartada, 4 definitivas', JSON.stringify(informe));
  const escritas = readFileSync(nuevo, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  ok(igual(escritas, H.reindexar(AVANCE, U_HOY).lineas), 'el archivo nuevo es lo que devuelve reindexar, una línea por respuesta');
  ok(igual(H.leerAvance(nuevo).map((p) => p.indice), [0, 3, 3, 2, 4]), 'leerAvance lo lee');

  const pisar = (a, b) => { try { H.reindexarArchivos(a, b, { u: U_HOY, huella: 'x' }); return null; } catch (e) { return e.message; } };
  writeFileSync(otro, 'algo que ya estaba\n');
  ok(/ya existe/.test(pisar(viejo, otro) || '') && readFileSync(otro, 'utf8') === 'algo que ya estaba\n', 'se niega si el nuevo ya existe, y no lo toca');
  ok(/mismo archivo/.test(pisar(viejo, viejo) || ''), 'se niega si el nuevo es el mismo viejo');
  ok(/mismo archivo/.test(pisar(viejo, join(dir, '.', 'viejo.jsonl')) || ''), 'también con otra forma de escribir la misma ruta');
  ok(/No existe/.test(pisar(join(dir, 'no-hay.jsonl'), join(dir, 'x.jsonl')) || '') && !existsSync(join(dir, 'x.jsonl')), 'sin avance viejo no escribe nada');
  ok(sha(viejo) === antes, 'el viejo queda byte a byte');
} catch (e) { ok(false, 'la sección 3 corre', e.stack); }
finally { rmSync(dir, { recursive: true, force: true }); }

console.log(`\nOK hornear-reindexar: ${pasaron} de ${pasaron + fallaron}`);
process.exit(fallaron ? 1 : 0);
