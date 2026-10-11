// tests/generar-dentro-de-todo-v291.mjs — la referencia de «dentro de todo» (tanda 41)
//
// Genera `tests/fixtures/dentro-de-todo-v291.json`: para cada año del
// `src/data/history-stats.json` real, el `JSON.stringify` de lo que devuelve
// `pasoDentroDeTodo()` con el `ctx` que le pasa `wrapped.js`.
//
// ⚠️ **SE CORRIÓ UNA SOLA VEZ, CON EL CÓDIGO DE v=291, ANTES de tocar una línea
// de `src/`** (commit T41.1a). La referencia NO se regenera nunca con el código
// nuevo: si `tests/corte-saltos.test.mjs` se pone rojo, se arregla el código.
// Regenerarla convierte la puerta en un sello de goma (la misma regla que
// `tests/fixtures/calendario-apertura-*.html`, tanda 38).
//
// Por eso este script SE NIEGA a pisar el fixture si ya existe. No corre en
// `npm test` (no es un `*.test.mjs`): queda en el repo para que se vea de dónde
// salió la referencia.
//
//   node tests/generar-dentro-de-todo-v291.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pasoDentroDeTodo } from '../src/js/features/wrapped-apertura.js';
import { fmtDia } from '../src/js/util/fecha.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const destino = join(raiz, 'tests/fixtures/dentro-de-todo-v291.json');

if (existsSync(destino)) {
  console.error(`✗ ${destino} ya existe y NO se regenera: es la referencia de v=291.`);
  process.exit(1);
}

// El doble del productor, igual que en `tests/calendario-anual.test.mjs`:
// `fmtMinutes` es privada de `wrapped.js`, que no se puede importar sin DOM.
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

const stats = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));
const salida = {};
for (const y of stats.years) {
  const paso = pasoDentroDeTodo({
    stats, y, MESES, MESES_LARGOS, fmtMinutes, fmtDia,
    ultimoDia: (stats.years[stats.years.length - 1]?.last_play || '').slice(0, 10) || null,
  });
  // Cada valor es el STRING de `JSON.stringify(paso)`: lo que se compara es eso,
  // byte a byte, y así el formato de este archivo no participa de la comparación.
  salida[String(y.year)] = JSON.stringify(paso);
}
writeFileSync(destino, JSON.stringify(salida, null, 2) + '\n');
console.log(`✓ ${Object.keys(salida).length} años → ${destino}`);
for (const [anio, s] of Object.entries(salida)) console.log(`  ${anio}: ${s.length} caracteres`);
