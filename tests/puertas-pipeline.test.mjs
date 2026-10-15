// El tema de entrada de cada artista, en los DOS pipelines (v=308, tanda 56).
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ VIGILA
// ═══════════════════════════════════════════════════════════════════════════
//
// `history-artist-tracks` v3 le agrega a `totals[artista]` dos campos al final
// (append: los seis de antes no se mueven):
//
//   [6] = [nombre, trackId] del TEMA DE ENTRADA: el de la primera reproducción
//         válida del artista —la MISMA que fija `[5]`— (con uri, sin basura,
//         ≥ 30 s). Si dos válidas tienen el mismo `ts`, gana el menor `trackId`
//         (orden de cadena), escrito igual en los dos lenguajes.
//   [7] = "YYYY-MM-DD" (UTC) de la primera reproducción válida de un tema
//         DISTINTO —otro `songKey`, no otro id: un remaster de la entrada no es
//         un segundo tema—, o `null` si nunca sonó otro.
//
// El pipeline emite el dato crudo y el navegador decide (la regla de v=146):
// la vista `#puertas` hace las cuentas.
//
// Cada caso corre contra `processStreamingHistory()` (el import BYOH, JS) y
// contra `build_stats()` de `scripts/gen-stats.py` (el horneado del owner,
// Python) sobre las MISMAS reproducciones: los dos tienen que decir lo mismo.
// La sección de UTC corre además con `TZ=America/Argentina/Buenos_Aires` (en
// una máquina en UTC el bug de la hora local no se ve).
//
// Y una parte de CONSERVACIÓN, dicha como tal (pasaba antes del cambio): los
// seis primeros campos de `totals[a]` y todo `artists[a]` son idénticos a los
// que daba v2 sobre estas mismas reproducciones (la foto de abajo se sacó con
// el código de v=307, antes de tocarlo).
//
// Todo con artistas, temas, fechas e ids INVENTADOS. Corre sin navegador y sin
// token. Correr con: node tests/puertas-pipeline.test.mjs
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { processStreamingHistory } from '../src/js/history-processor.js';
import { ARTIST_TRACKS_VERSION as VERSION_CLAVES } from '../src/js/history-keys.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const igual = (a, b, m) => af(JSON.stringify(a) === JSON.stringify(b), `${m}: esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`);

// Una reproducción inventada, con la forma del export.
const p = (ts, artista, tema, id, seg = 180) => ({
  ts, ms_played: seg * 1000,
  master_metadata_album_artist_name: artista,
  master_metadata_album_album_name: `Disco de ${artista}`,
  master_metadata_track_name: tema,
  spotify_track_uri: `spotify:track:${id}`,
  reason_end: 'trackdone', skipped: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS REPRODUCCIONES (inventadas). El orden del array importa en el caso del
// empate: llega primero el id MAYOR, para que «el orden de llegada» dé el otro.
// ═══════════════════════════════════════════════════════════════════════════
const PLAYS = [
  // 1 · la de 20 s no es válida: la entrada es la de 3 min del día siguiente.
  p('2021-03-01T10:00:00Z', 'Banda Uno', 'Tema Corto', 'b1', 20),
  p('2021-03-02T10:00:00Z', 'Banda Uno', 'Tema Largo', 'a1'),
  p('2021-03-04T10:00:00Z', 'Banda Uno', 'Tema Corto', 'b1'),
  // 2 · la basura funcional (la atrapa `isJunkTrack` por el título) no cuenta.
  p('2021-04-01T10:00:00Z', 'Banda Dos', 'Sonido para sacar agua', 'j1'),
  p('2021-04-02T10:00:00Z', 'Banda Dos', 'Canción Buena', 'g1'),
  // 3 · el mismo tema en dos ids (single y remaster): el segundo tema es el del día 9.
  p('2021-05-01T10:00:00Z', 'Banda Tres', 'Luz', 'l1'),
  p('2021-05-03T10:00:00Z', 'Banda Tres', 'Luz - Remastered 2020', 'l2'),
  p('2021-05-09T10:00:00Z', 'Banda Tres', 'Otra Cosa', 'o1'),
  // 4 · un solo tema en todo el historial (aunque en dos ids): [7] = null.
  p('2021-06-01T10:00:00Z', 'Banda Cuatro', 'Única', 'u1'),
  p('2021-06-05T10:00:00Z', 'Banda Cuatro', 'Única', 'u1'),
  p('2021-06-07T10:00:00Z', 'Banda Cuatro', 'Única - Single Version', 'u2'),
  // 5 · empate de `ts`: gana el menor trackId («aa1» < «zz9»), aunque llegue segundo.
  p('2021-07-01T10:00:00Z', 'Banda Cinco', 'Zeta', 'zz9'),
  p('2021-07-01T10:00:00Z', 'Banda Cinco', 'Alfa', 'aa1'),
  // 6 · el segundo tema el mismo día que la entrada: [7] = [5].
  p('2021-08-01T10:00:00Z', 'Banda Seis', 'Primera', 's1'),
  p('2021-08-01T15:00:00Z', 'Banda Seis', 'Segunda', 's2'),
];
// 7 · UTC: la entrada a las 23:30 y el segundo tema a las 00:30 del día
// siguiente. En Buenos Aires (UTC−3) los dos caen el día 10 en hora local.
const PLAYS_UTC = [
  p('2021-09-10T23:30:00Z', 'Banda Siete', 'Noche', 'n1'),
  p('2021-09-11T00:30:00Z', 'Banda Siete', 'Madrugada', 'm1'),
];

const ESPERADO = {
  'Banda Uno': { e: ['Tema Largo', 'a1'], d5: '2021-03-02', d7: '2021-03-04' },
  'Banda Dos': { e: ['Canción Buena', 'g1'], d5: '2021-04-02', d7: null },
  'Banda Tres': { e: ['Luz', 'l1'], d5: '2021-05-01', d7: '2021-05-09' },
  'Banda Cuatro': { e: ['Única', 'u1'], d5: '2021-06-01', d7: null },
  'Banda Cinco': { e: ['Alfa', 'aa1'], d5: '2021-07-01', d7: '2021-07-01' },
  'Banda Seis': { e: ['Primera', 's1'], d5: '2021-08-01', d7: '2021-08-01' },
};
const ESPERADO_UTC = { 'Banda Siete': { e: ['Noche', 'n1'], d5: '2021-09-10', d7: '2021-09-11' } };

// La foto de CONSERVACIÓN: los seis primeros campos de `totals` y `artists`
// enteros, como los daba v2 (v=307) sobre `PLAYS`. Sacada con el código de
// antes del cambio; no se regenera.
const FOTO_V2 = JSON.parse(readFileSync(join(raiz, 'tests/fixtures/puertas-conservacion-v2.json'), 'utf8'));

// ── Los dos pipelines ────────────────────────────────────────────────────────
async function js(plays) {
  const out = await processStreamingHistory([plays]);
  return out.artistTracks;
}

// `build_stats()` de gen-stats.py, importado como módulo (no corre `main()`:
// ni lee el export ni escribe nada). Recibe las reproducciones por stdin.
const PY = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("gen_stats", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
at = m.build_stats(json.load(sys.stdin), {})[-1]
print(json.dumps({"version": at["version"], "totals": at["totals"], "artists": at["artists"]}, ensure_ascii=False))
`;
function py(plays, tz) {
  const r = spawnSync('python3', ['-c', PY, join(raiz, 'scripts/gen-stats.py')], {
    input: JSON.stringify(plays), encoding: 'utf8',
    env: { ...process.env, ...(tz ? { TZ: tz } : {}) },
  });
  if (r.status !== 0) { fallos.push(`gen-stats.py build_stats salió con ${r.status}: ${r.stderr.slice(-400)}`); return null; }
  return JSON.parse(r.stdout);
}

function comprobarCasos(at, esperado, quien) {
  if (!at) return;
  for (const [a, x] of Object.entries(esperado)) {
    const t = at.totals?.[a];
    af(Array.isArray(t), `${quien} · ${a}: no está en totals`);
    if (!Array.isArray(t)) continue;
    igual(t.length, 8, `${quien} · ${a}: totals lleva 8 campos`);
    igual(t[6], x.e, `${quien} · ${a}: [6] el tema de entrada`);
    igual(t[5], x.d5, `${quien} · ${a}: [5] el día de la entrada`);
    igual(t[7], x.d7, `${quien} · ${a}: [7] el día del segundo tema`);
    af(t[7] === null || t[7] >= t[5], `${quien} · ${a}: [7] (${t[7]}) no puede ser anterior a [5] (${t[5]})`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Los casos, en los dos pipelines
// ═══════════════════════════════════════════════════════════════════════════
const atJs = await js(PLAYS);
const atPy = py(PLAYS);
comprobarCasos(atJs, ESPERADO, 'JS');
comprobarCasos(atPy, ESPERADO, 'Python');
if (atJs && atPy) {
  igual(atJs.totals, atPy.totals, 'JS y Python: `totals` idéntico entero');
  igual(atJs.artists, atPy.artists, 'JS y Python: `artists` idéntico entero');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. UTC, en la zona de la máquina y en Buenos Aires
// ═══════════════════════════════════════════════════════════════════════════
const zonaOriginal = process.env.TZ;
for (const tz of [zonaOriginal || null, 'America/Argentina/Buenos_Aires']) {
  if (tz) process.env.TZ = tz; else delete process.env.TZ;
  const etiqueta = tz || '(la de la máquina)';
  comprobarCasos(await js(PLAYS_UTC), ESPERADO_UTC, `JS TZ=${etiqueta}`);
  comprobarCasos(py(PLAYS_UTC, tz), ESPERADO_UTC, `Python TZ=${etiqueta}`);
}
if (zonaOriginal) process.env.TZ = zonaOriginal; else delete process.env.TZ;
// Que la zona de Buenos Aires de verdad mueve el día (si no, la sección no vigila nada).
process.env.TZ = 'America/Argentina/Buenos_Aires';
igual(new Date('2021-09-11T00:30:00Z').getDate(), 10, 'con TZ de Buenos Aires, las 00:30 UTC del 11 caen el 10 en hora local');
if (zonaOriginal) process.env.TZ = zonaOriginal; else delete process.env.TZ;

// ═══════════════════════════════════════════════════════════════════════════
// 3. La versión, 3 en los tres sitios (gen-stats.py leído como texto)
// ═══════════════════════════════════════════════════════════════════════════
const vPy = readFileSync(join(raiz, 'scripts/gen-stats.py'), 'utf8').match(/^ARTIST_TRACKS_VERSION = (\d+)/m);
const vJs = readFileSync(join(raiz, 'src/js/history-processor.js'), 'utf8').match(/^const ARTIST_TRACKS_VERSION = (\d+);/m);
igual(vPy && +vPy[1], 3, 'ARTIST_TRACKS_VERSION de scripts/gen-stats.py');
igual(vJs && +vJs[1], 3, 'ARTIST_TRACKS_VERSION de src/js/history-processor.js');
igual(VERSION_CLAVES, 3, 'ARTIST_TRACKS_VERSION de src/js/history-keys.js');
igual(atJs?.version, 3, 'el `version` del artistTracks que arma processStreamingHistory()');
igual(atPy?.version, 3, 'el `version` del artistTracks que arma build_stats()');

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONSERVACIÓN (pasaba antes del cambio): lo de v2 no se movió
// ═══════════════════════════════════════════════════════════════════════════
for (const [quien, at] of [['JS', atJs], ['Python', atPy]]) {
  if (!at) continue;
  igual(Object.keys(at.totals).sort(), Object.keys(FOTO_V2.totals).sort(), `${quien} · conservación: los mismos artistas en totals`);
  for (const [a, seis] of Object.entries(FOTO_V2.totals)) {
    igual((at.totals[a] || []).slice(0, 6), seis, `${quien} · conservación: totals[${a}][0..5]`);
  }
  igual(at.artists, FOTO_V2.artists, `${quien} · conservación: artists entero`);
}

if (fallos.length) {
  console.error(`\n✗ puertas-pipeline: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts`);
