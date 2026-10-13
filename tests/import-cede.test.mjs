// tests/import-cede.test.mjs — el import completo de historial cede el hilo (v=297).
//
// Hasta v=296 `processStreamingHistory()` corría sincrónica de punta a punta y
// el `onProgress` de `handleFiles()` tenía un `await` adentro que nadie
// esperaba: el cartel «Procesando tu historial…» se quedaba quieto los ~3,7 s
// que tardaba con el export de Ian. Ahora la función es `async` y cede ella
// misma con el `ceder` que le pasan, cada `presupuestoMs`.
//
// Lo que se afirma, sin navegador y sin el export real (un fixture sintético
// de tres archivos que se solapan, para que la deduplicación trabaje):
//
//   1. devuelve una Promise;
//   2. con `presupuestoMs: 0` cede al menos una vez por archivo en la
//      deduplicación, una vez por archivo en el acumulador de días y al menos
//      una vez dentro del bucle de agregados;
//   3. cada cesión SE ESPERA: el `ceder` del test se resuelve recién en una
//      vuelta posterior del bucle de eventos y marca «pendiente» mientras
//      tanto; un `onProgress` con una cesión pendiente es un fallo;
//   4. la salida con `ceder` y sin `ceder` es idéntica (sin `generated_at`);
//   5. lectura del fuente: el `onProgress` de `handleFiles()` no tiene `await`
//      ni `setTimeout`, `handleFiles()` pasa `ceder: cederElHilo` y espera a
//      `processStreamingHistory()`, y no apareció otro `MessageChannel`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { processStreamingHistory } from '../src/js/history-processor.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = p => readFileSync(join(raiz, p), 'utf8');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const igual = (a, b, nombre) => ok(a === b, `${nombre} (esperaba ${JSON.stringify(b)}, vino ${JSON.stringify(a)})`);

// ── El fixture: tres archivos, con plays repetidas entre archivos ──────────
function play(i, extra = {}) {
  const dia = 1 + (i % 27), hora = i % 24, mes = 1 + (i % 12);
  const ts = `${2021 + (i % 4)}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}T${String(hora).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z`;
  const tema = i % 23;
  return {
    ts,
    ms_played: i % 3 === 0 ? 12000 : 150000 + (i % 7) * 10000,
    spotify_track_uri: `spotify:track:tema${String(tema).padStart(3, '0')}xxxxxxxxxxxxx`,
    master_metadata_track_name: `Tema ${tema}`,
    master_metadata_album_artist_name: `Artista ${tema % 5}`,
    master_metadata_album_album_name: `Disco ${tema % 8}`,
    reason_end: i % 3 === 0 ? 'fwdbtn' : 'trackdone',
    skipped: i % 5 === 0,
    ...extra,
  };
}
const A = Array.from({ length: 70 }, (_, i) => play(i));
const B = [...A.slice(55), ...Array.from({ length: 60 }, (_, i) => play(70 + i))];      // 15 repetidas de A
const C = [...B.slice(50), ...Array.from({ length: 50 }, (_, i) => play(130 + i)), { ts: '2023-01-01T00:00:00Z', ms_played: 50000 }];  // 10 repetidas de B y un episodio sin uri
const archivos = [A, B, C];
const N = archivos.length;

const sinFecha = (o) => JSON.stringify(o, (k, v) => (k === 'generated_at' ? undefined : v));

// ═══════════════════════════════════════════════════════════════════════════
// 1 · devuelve una Promise
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n1 · devuelve una Promise');
const promesa = processStreamingHistory(archivos);
ok(promesa instanceof Promise, '`processStreamingHistory()` devuelve una Promise');
const sinCeder = await promesa;
ok(!!sinCeder && !!sinCeder.stats && !!sinCeder.days, 'y la Promise resuelve a los ocho payloads');
igual(Object.keys(sinCeder).join(','), 'stats,trackPlays,listened,skipStats,detail,records,artistTracks,days', 'las ocho claves, en su orden');

// ═══════════════════════════════════════════════════════════════════════════
// 2 y 3 · dónde cede, y que cada cesión se espera
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n2 · cede por archivo en la deduplicación, por archivo en los días y dentro del bucle');
const eventos = [];           // la secuencia: { t: 'p', phase, loaded, total } | { t: 'c', fase }
let pendiente = false, progresosConCesionPendiente = 0, ultimo = null;
const onProgress = (e) => {
  if (pendiente) progresosConCesionPendiente++;
  eventos.push({ t: 'p', ...e });
  ultimo = e;
};
const ceder = () => {
  eventos.push({ t: 'c', fase: ultimo ? ultimo.phase : null });
  pendiente = true;
  // Se resuelve en una vuelta POSTERIOR del bucle de eventos, no en un microtask.
  return new Promise((r) => setTimeout(() => { pendiente = false; r(); }, 0));
};
const conCeder = await processStreamingHistory(archivos, { onProgress, ceder, presupuestoMs: 0 });

const iDedupFin = eventos.findIndex(e => e.t === 'p' && e.phase === 'dedup' && e.loaded === e.total && e.total > 0);
const iAggIni = eventos.findIndex(e => e.t === 'p' && e.phase === 'aggregate');
const iAggFin = eventos.findIndex(e => e.t === 'p' && e.phase === 'aggregate' && e.loaded === e.total);
ok(iDedupFin >= 0 && iAggIni > iDedupFin && iAggFin > iAggIni, 'el progreso pasa por la deduplicación y después por los agregados');

// Deduplicación: cada `onProgress` de archivo (loaded > 0) va seguido de una cesión.
const progresosDeArchivo = eventos.map((e, i) => [e, i]).filter(([e, i]) => e.t === 'p' && e.phase === 'dedup' && e.loaded > 0 && i <= iDedupFin);
igual(progresosDeArchivo.length, N, 'la deduplicación avisa una vez por archivo');
ok(progresosDeArchivo.every(([, i]) => eventos[i + 1]?.t === 'c'), 'y después de cada archivo de la deduplicación cede');

// El acumulador de días: las cesiones entre la de la última dedup y el primer progreso de agregados.
const entre = eventos.slice(iDedupFin + 2, iAggIni).filter(e => e.t === 'c');
igual(entre.length, N, 'el acumulador de días cede una vez por archivo');
ok(eventos.slice(iDedupFin + 2, iAggIni).every(e => e.t === 'c'), 'y en ese tramo no hay ningún progreso, solo las cesiones');

// El bucle de agregados.
const enElBucle = eventos.slice(iAggIni, iAggFin).filter(e => e.t === 'c');
ok(enElBucle.length >= 1, `el bucle de agregados cede al menos una vez (cedió ${enElBucle.length})`);
ok(enElBucle.every(c => c.fase === 'aggregate'), 'y antes de cada cesión del bucle el último progreso fue de agregados');
// Y el armado de después también cede (no hay progreso ahí: el último fue el 100 % de agregados).
const despues = eventos.slice(iAggFin + 1).filter(e => e.t === 'c');
ok(despues.length >= 1, `el armado posterior al bucle cede al menos una vez (cedió ${despues.length})`);

const porFase = eventos.filter(e => e.t === 'c').reduce((m, c) => (m[c.fase] = (m[c.fase] || 0) + 1, m), {});
console.log(`    fase del último onProgress antes de cada cesión: ${JSON.stringify(porFase)}`);
igual(porFase.dedup, 2 * N, 'con el último progreso en «dedup» cede 2N veces (N de la deduplicación + N de los días)');

console.log('\n3 · cada cesión se espera');
igual(progresosConCesionPendiente, 0, 'ningún `onProgress` corre con una cesión pendiente');
ok(!pendiente, 'al terminar no queda ninguna cesión pendiente');

// Un presupuesto grande no cede nunca con un fixture chico: el reloj manda.
let cesionesConPresupuesto = 0;
await processStreamingHistory(archivos, { ceder: () => { cesionesConPresupuesto++; return Promise.resolve(); }, presupuestoMs: 1e9 });
igual(cesionesConPresupuesto, 0, 'con un presupuesto que no se agota, no cede ninguna vez');

// ═══════════════════════════════════════════════════════════════════════════
// 4 · la salida no cambia por ceder
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n4 · la salida con `ceder` y sin `ceder` es idéntica');
for (const k of Object.keys(sinCeder)) {
  ok(sinFecha(sinCeder[k]) === sinFecha(conCeder[k]), `\`${k}\`: idéntico con y sin ceder`);
}
ok(sinCeder.stats.totals.plays_raw === 70 + 60 + 50, `la deduplicación trabajó: ${sinCeder.stats.totals.plays_raw} crudas de ${A.length + B.length + C.length} líneas`);

// ═══════════════════════════════════════════════════════════════════════════
// 5 · lectura del fuente
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n5 · el fuente de `handleFiles()` y el `MessageChannel`');
const ih = leer('src/js/features/import-history.js');
const iHF = ih.indexOf('async function handleFiles(');
const iFin = ih.indexOf('\nfunction readFileText(');
ok(iHF >= 0 && iFin > iHF, 'encuentro el cuerpo de `handleFiles()`');
const hf = ih.slice(iHF, iFin);
const mOnP = hf.match(/(async\s+)?onProgress\s*:\s*(async\s*)?\(([^)]*)\)\s*=>\s*\{([\s\S]*?)\n\s{6}\},/);
ok(!!mOnP, 'encuentro el `onProgress` que `handleFiles()` le pasa al procesador');
if (mOnP) {
  ok(!mOnP[1] && !mOnP[2], 'ese `onProgress` no es `async`');
  ok(!/\bawait\b/.test(mOnP[4]), 'ese `onProgress` no tiene `await`');
  ok(!/setTimeout/.test(mOnP[4]), 'ese `onProgress` no tiene `setTimeout`');
}
ok(/ceder\s*:\s*cederElHilo\b/.test(hf), '`handleFiles()` le pasa `ceder: cederElHilo`');
ok(/await\s+processStreamingHistory\(/.test(hf), '`handleFiles()` espera a `processStreamingHistory()`');
ok(/function cederElHilo\(\)[\s\S]{0,200}new MessageChannel\(\)/.test(ih), '`cederElHilo()` sigue siendo la del `MessageChannel`');

// Los `new MessageChannel` de `src/`. Hay DOS desde antes de esta tanda: el de
// `cederElHilo()` (import-history.js) y el de `cederAlNavegador()`
// (util/mosaico.js, el emparejado del mosaico). Lo que se vigila es que el
// procesador no traiga el suyo y que no aparezca un tercero.
function archivos_(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== 'data') out.push(...archivos_(p)); }
    else if (/\.(js|mjs|html)$/.test(n)) out.push(p);
  }
  return out;
}
const conMC = [];
for (const f of archivos_(join(raiz, 'src'))) {
  const n = (readFileSync(f, 'utf8').match(/new MessageChannel\b/g) || []).length;
  for (let i = 0; i < n; i++) conMC.push(relative(join(raiz, 'src'), f));
}
igual(conMC.filter(f => f === 'js/features/import-history.js').length, 1, 'un solo `new MessageChannel` en import-history.js');
igual(conMC.filter(f => f === 'js/history-processor.js').length, 0, 'el procesador no crea ningún `MessageChannel`');
igual(conMC.sort().join(' · '), 'js/features/import-history.js · js/util/mosaico.js', 'en todo `src/` siguen siendo los dos de antes, y ninguno más');

console.log(`\n${fallaron === 0 ? '✓' : '✗'} import-cede: ${pasaron} asserts ok${fallaron ? `, ${fallaron} fallo(s)` : ''}`);
process.exit(fallaron ? 1 : 0);
