// tests/gen-stats-guarda.test.mjs — `gen-stats.py` no escribe nada si el export falta (tanda 41)
//
// POR QUÉ ESTA SUITE EXISTE. Hasta la tanda 41, correr `scripts/gen-stats.py`
// sin el export (la carpeta vacía, o apuntando a otro lado) no fallaba: el
// `glob` devolvía una lista vacía, y el script pisaba los siete JSON de
// `src/data/` con ceros, imprimía siete «OK →» y salía con código 0.
// `scripts/verificar-rehorneado.py` lo ve DESPUÉS y hay que acordarse de
// correrlo. Ahora la guarda vive adentro del script y corta antes de escribir.
//
// 🔴 ESTE TEST NO PUEDE ESCRIBIR NUNCA EN `src/data/`, ni aunque la guarda
// falle: `FONOTECA_OUT_DIR` apunta SIEMPRE a una carpeta temporal propia. Si el
// script volviera a escribir ceros, los escribe ahí, y eso es lo que se afirma.
//
// Dos casos, los que no necesitan el export real (que no está en el repo):
//   b. la carpeta del export está vacía         → la frena la guarda 1
//   d. 19 archivos de audio que contienen `[]`  → la frena la guarda 2
// Los otros tres (la carpeta no existe, faltan archivos, menos reproducciones
// que las horneadas) se probaron a mano contra `src/data/` con una copia al
// lado: están en `fonoteca-migracion/ULTIMO-CAMBIO.md`, tanda 41.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

const tmp = mkdtempSync(join(tmpdir(), 'gen-stats-guarda-'));
try {
  const casos = [
    {
      id: 'b', nombre: 'la carpeta del export está vacía',
      armar: (dir) => { /* nada: vacía */ },
    },
    {
      id: 'd', nombre: '19 archivos de audio sin reproducciones',
      armar: (dir) => { for (let n = 1; n <= 19; n++) writeFileSync(join(dir, `Streaming_History_Audio_vacio_${n}.json`), '[]\n'); },
    },
  ];
  for (const c of casos) {
    console.log(`\n${c.id}. ${c.nombre}`);
    const entrada = join(tmp, `${c.id}-entrada`), salida = join(tmp, `${c.id}-salida`);
    mkdirSync(entrada); mkdirSync(salida);
    c.armar(entrada);
    const r = spawnSync('python3', ['scripts/gen-stats.py'], {
      cwd: raiz, encoding: 'utf8', timeout: 120000,
      env: { ...process.env, FONOTECA_HISTORY_DIR: entrada, FONOTECA_OUT_DIR: salida, PYTHONDONTWRITEBYTECODE: '1' },
    });
    ok(!r.error && r.status !== null, `el script corrió (${r.error ? r.error.message : 'código ' + r.status})`);
    ok(r.status !== 0 && r.status !== null, `sale con código distinto de 0 (vino ${r.status})`);
    ok(r.status === 2, 'y es el 2 de la guarda, no una excepción de Python (que da 1)');
    ok(typeof r.stderr === 'string' && r.stderr.trim().length > 0, 'dice algo por stderr');
    ok(/✗ gen-stats\.py: /.test(r.stderr || '') && /NO se escribió ningún archivo/.test(r.stderr || ''),
       'el mensaje es el de la guarda y dice que no se escribió nada');
    ok(!/^OK →/m.test(r.stdout || ''), 'no imprime ningún «OK →»');
    const escritos = readdirSync(salida);
    ok(escritos.length === 0, `la carpeta de salida sigue vacía (${escritos.length ? escritos.join(', ') : 'nada'})`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${fallaron === 0 ? '✓' : '✗'} gen-stats-guarda: ${pasaron} asserts ok${fallaron ? `, ${fallaron} fallo(s)` : ''}`);
process.exit(fallaron ? 1 : 0);
