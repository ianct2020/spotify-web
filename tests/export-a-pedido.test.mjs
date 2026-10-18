// tests/export-a-pedido.test.mjs — `npm test` no abre el export de Ian si nadie lo pide (tanda 65)
//
// POR QUÉ ESTA SUITE EXISTE. La «PUERTA 1 (real)» de `tests/calendario-dias.test.mjs` compara el
// acumulador de días contra `gen-stats.py` leyendo `my_spotify_data/` (el export de Ian, que está
// gitignoreado). Hasta v=315 lo leía con solo que la carpeta existiera, así que un `npm test`
// cualquiera en la máquina de Ian lo abría: la tanda 64 lo pisó una vez. Desde v=316 corre solo con
// `FONOTECA_LEER_EXPORT=1` en el entorno.
//
// Cómo se prueba sin tocar el export de nadie: en una carpeta temporal se arma un repo mínimo (el
// test de `calendario-dias`, `src/js/` y `src/data/history-stats.json`) con un
// `my_spotify_data/…/Streaming_History_Audio_falso.json` de datos INVENTADOS, y se corre ahí el test
// copiado, que resuelve sus rutas desde su propia ubicación:
//   a. sin la variable          → «SALTADA — sin FONOTECA_LEER_EXPORT=1», y no compara nada;
//   b. con la variable          → lo lee (compara días: con datos inventados falla, y está bien);
//   c. con la variable sin carpeta → la línea de siempre («no hay `my_spotify_data/`»).
// Y una lectura estática: la variable se mira ANTES del `existsSync` de la ruta del export.
//
// Contra v=315 (a) da rojo: la copia lee el archivo inventado y compara 2.935 días.
//
// Correr con: node tests/export-a-pedido.test.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}

// Una reproducción INVENTADA, con la forma del export.
const FALSO = [{
  ts: '2024-03-01T12:00:00Z', ms_played: 200000,
  master_metadata_track_name: 'Tema Inventado', master_metadata_album_artist_name: 'Banda Inventada',
  master_metadata_album_album_name: 'Disco Inventado', spotify_track_uri: 'spotify:track:0000000000000000000inv',
  reason_start: 'trackdone', reason_end: 'trackdone', skipped: false,
}];

function armar(conExport) {
  const dir = mkdtempSync(join(tmpdir(), 'export-a-pedido-'));
  mkdirSync(join(dir, 'tests'), { recursive: true });
  mkdirSync(join(dir, 'src/data'), { recursive: true });
  cpSync(join(raiz, 'tests/calendario-dias.test.mjs'), join(dir, 'tests/calendario-dias.test.mjs'));
  cpSync(join(raiz, 'src/js'), join(dir, 'src/js'), { recursive: true });
  cpSync(join(raiz, 'src/data/history-stats.json'), join(dir, 'src/data/history-stats.json'));
  if (conExport) {
    const ex = join(dir, 'my_spotify_data/Spotify Extended Streaming History');
    mkdirSync(ex, { recursive: true });
    writeFileSync(join(ex, 'Streaming_History_Audio_falso.json'), JSON.stringify(FALSO));
  }
  return dir;
}

function correr(dir, variable) {
  const env = { ...process.env };
  delete env.FONOTECA_LEER_EXPORT;
  if (variable) env.FONOTECA_LEER_EXPORT = '1';
  const r = spawnSync(process.execPath, [join(dir, 'tests/calendario-dias.test.mjs')], { cwd: dir, env, encoding: 'utf8', timeout: 60000 });
  return (r.stdout || '') + (r.stderr || '');
}

const dirs = [];
try {
  console.log('a. con el export (inventado) en disco y SIN la variable: no lo lee');
  const conEx = armar(true); dirs.push(conEx);
  const a = correr(conEx, false);
  ok(a.includes('PUERTA 1 (real): SALTADA — sin FONOTECA_LEER_EXPORT=1'), 'dice «SALTADA — sin FONOTECA_LEER_EXPORT=1»', a.split('\n').filter((l) => l.includes('PUERTA 1 (real)')).join(' | '));
  ok(!/días comparados contra gen-stats\.py/.test(a) && !/PUERTA 2 \(real\)/.test(a), 'y no compara nada del export');

  console.log('b. con la variable: lo lee (a pedido)');
  const b = correr(conEx, true);
  ok(/PUERTA 1 \(real\): \d+ días comparados contra gen-stats\.py/.test(b), 'con FONOTECA_LEER_EXPORT=1 compara los días del export', b.split('\n').filter((l) => l.includes('PUERTA 1 (real)')).slice(0, 1).join(''));

  console.log('c. con la variable y sin carpeta: la línea de siempre');
  const sinEx = armar(false); dirs.push(sinEx);
  const c = correr(sinEx, true);
  ok(c.includes('PUERTA 1 (real): SALTADA — no hay `my_spotify_data/` en esta máquina.'), 'dice «no hay `my_spotify_data/`»');

  console.log('d. lectura estática: la variable se mira antes que el disco');
  const src = readFileSync(join(raiz, 'tests/calendario-dias.test.mjs'), 'utf8');
  const iVar = src.indexOf("process.env.FONOTECA_LEER_EXPORT !== '1'");
  const iExiste = src.indexOf('existsSync(DIR)');
  ok(iVar > 0 && iExiste > iVar, 'el `if` de la variable va antes del `existsSync` de la ruta del export');
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} export-a-pedido: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
