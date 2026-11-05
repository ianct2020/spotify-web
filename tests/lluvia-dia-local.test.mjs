// El historial por día en hora de Mar del Plata (v=358, tanda 117).
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ VIGILA
// ═══════════════════════════════════════════════════════════════════════════
//
// `years[].days` de `history-stats.json` son días UTC: un día UTC D en Mar del
// Plata va de las 21:00 de D−1 a las 21:00 de D. Cruzar eso contra la lluvia, que
// viene en días locales, mezcla tres horas del día anterior. Por eso `gen-stats.py`
// emite un archivo APARTE, `history-days-local.json`, solo para `#lluvia`:
//
//   { version: 1, zona_horaria, utc_offset_seconds: -10800, generated_at, from, min: [...] }
//
// `min` es contiguo, de la primera a la última reproducción válida, con la fecha
// de `ts − 3 h`, y se acumula en el MISMO sitio del bucle que `yb["days"]`: las
// mismas reproducciones, ni una más ni una menos. Las demás vistas siguen en UTC y
// nada de lo que ya emite `gen-stats.py` cambia.
//
// Corre `main()` de verdad sobre reproducciones INVENTADAS, con `FONOTECA_HISTORY_DIR`
// y `FONOTECA_OUT_DIR` a carpetas temporales. 🔴 Nunca escribe en `src/data/`. Las
// guardas de la tanda 41 (`MIN_ARCHIVOS_AUDIO` y las reproducciones ya horneadas) se
// apagan SOLO en el proceso de este test: con unas pocas reproducciones inventadas,
// `main()` no pasaría de ahí (las prueba `tests/gen-stats-guarda.test.mjs`).
//
// Correr con: node tests/lluvia-dia-local.test.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const igual = (a, b, m) => af(JSON.stringify(a) === JSON.stringify(b), `${m}: esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`);

// Una reproducción inventada, con la forma del export.
const p = (ts, seg, extra = {}) => ({
  ts, ms_played: seg * 1000,
  master_metadata_album_artist_name: 'Banda Inventada',
  master_metadata_album_album_name: 'Disco Inventado',
  master_metadata_track_name: 'Tema Inventado',
  spotify_track_uri: `spotify:track:inv${ts.replace(/\D/g, '')}`,
  reason_end: 'trackdone', skipped: false,
  ...extra,
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS REPRODUCCIONES, con la cuenta a mano al lado
// ═══════════════════════════════════════════════════════════════════════════
const PLAYS = [
  p('2018-12-20T12:00:00Z', 29),                     // 29 s: no cuenta, y no fija `from`
  p('2019-01-01T02:00:00Z', 180),                    // local 31/12/2018 (el borde del año)
  p('2019-01-01T03:00:00Z', 60),                     // local 01/01
  p('2019-01-03T02:59:59Z', 120),                    // local 02/01 (un segundo antes del corte)
  p('2019-01-03T03:00:00Z', 240),                    // local 03/01 (justo en el corte)
  p('2019-01-04T12:00:00Z', 29),                     // 29 s: no cuenta
  p('2019-01-04T13:00:00Z', 600, { spotify_track_uri: null }),   // sin uri: no cuenta
  p('2019-01-04T14:00:00Z', 600, { master_metadata_track_name: 'Sonido para sacar agua' }), // basura: no cuenta
  p('2019-01-05T12:00:00Z', 30),                     // 30 s justos: sí cuenta (0,5 min)
  p('2019-01-07T00:30:00Z', 90),                     // local 06/01: la última válida
  p('2019-01-09T12:00:00Z', 10),                     // 10 s: no cuenta, y no fija el final
];

const ESPERADO_LOCAL = { from: '2018-12-31', min: [3, 1, 2, 4, 0, 0.5, 1.5] };
const ESPERADO_UTC = { from: '2019-01-01', min: [4, 0, 6, 0, 0.5, 0, 1.5] };
const MS_TOTAL = (180 + 60 + 120 + 240 + 30 + 90) * 1000;   // 720.000

const PY_MAIN = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("gen_stats", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.MIN_ARCHIVOS_AUDIO = 1
m.plays_ya_horneadas = lambda: None
m.main()
`;

const PY_BUILD = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("gen_stats", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
plays = [r for r in json.load(sys.stdin) if r.get("spotify_track_uri")]
sin_tercero = m.build_stats(plays, {})
acumulado = {}
con_tercero = m.build_stats(plays, {}, acumulado)
sin = dict(enumerate(sin_tercero)); con = dict(enumerate(con_tercero))
for t in (sin, con):
    t[0].pop("generated_at", None)
    for i in (3, 4, 5, 6, 7):
        if isinstance(t[i], dict): t[i].pop("generated_at", None)
print(json.dumps({"largo": len(sin_tercero), "iguales": sin == con,
                  "local": acumulado.get("local"), "utc": acumulado.get("utc")}))
`;

const tmp = mkdtempSync(join(tmpdir(), 'lluvia-dia-local-'));
try {
  const entrada = join(tmp, 'entrada');
  mkdirSync(entrada);
  writeFileSync(join(entrada, 'Streaming_History_Audio_inventado_0.json'), JSON.stringify(PLAYS));

  // ═════════════════════════════════════════════════════════════════════════
  // 1. `main()`, con la zona de la máquina y con otras dos: el dato no depende de ella
  // ═════════════════════════════════════════════════════════════════════════
  const generados = [];
  for (const tz of [null, 'America/Argentina/Buenos_Aires', 'Asia/Tokyo']) {
    const etiqueta = tz || '(la de la máquina)';
    const salida = join(tmp, `salida-${(tz || 'maquina').replace(/\W/g, '-')}`);
    mkdirSync(salida);
    const env = { ...process.env, FONOTECA_HISTORY_DIR: entrada, FONOTECA_OUT_DIR: salida, PYTHONDONTWRITEBYTECODE: '1' };
    if (tz) env.TZ = tz;
    const r = spawnSync('python3', ['-c', PY_MAIN, join(raiz, 'scripts/gen-stats.py')], { cwd: raiz, encoding: 'utf8', timeout: 120000, env });
    af(r.status === 0, `TZ=${etiqueta}: main() salió con ${r.status}: ${(r.stderr || '').slice(-400)}`);
    const ruta = join(salida, 'history-days-local.json');
    af(existsSync(ruta), `TZ=${etiqueta}: main() emite history-days-local.json (emitió: ${readdirSync(salida).join(', ')})`);
    if (!existsSync(ruta)) continue;
    const local = JSON.parse(readFileSync(ruta, 'utf8'));
    const stats = JSON.parse(readFileSync(join(salida, 'history-stats.json'), 'utf8'));
    generados.push(local);

    igual(Object.keys(local), ['version', 'zona_horaria', 'utc_offset_seconds', 'generated_at', 'from', 'min'], `TZ=${etiqueta}: la forma, y nada más`);
    igual(local.version, 1, `TZ=${etiqueta}: version 1`);
    igual(local.zona_horaria, 'America/Argentina/Buenos_Aires', `TZ=${etiqueta}: la zona`);
    igual(local.utc_offset_seconds, -10800, `TZ=${etiqueta}: el desplazamiento`);
    igual(local.generated_at, stats.generated_at, `TZ=${etiqueta}: el mismo generated_at que history-stats.json`);

    // Los bordes, contados a mano (ver PLAYS).
    igual(local.from, ESPERADO_LOCAL.from, `TZ=${etiqueta}: 2019-01-01T02:00:00Z cuenta en el 31/12/2018, y la de 29 s no fija from`);
    igual(local.min, ESPERADO_LOCAL.min, `TZ=${etiqueta}: la serie local entera`);
    igual(local.min[2], 2, `TZ=${etiqueta}: 02:59:59Z va al día anterior`);
    igual(local.min[3], 4, `TZ=${etiqueta}: 03:00:00Z va al mismo día`);
    igual(local.min[4], 0, `TZ=${etiqueta}: un día local sin nada en el medio es 0 (y ni los 29 s, ni la sin uri, ni la basura suman)`);
    igual(local.min.length, 7, `TZ=${etiqueta}: el último día es el de la última válida, no el de los 10 s`);

    // UTC no se movió: es lo que ya emitía.
    igual(stats.years.map((y) => y.days), [ESPERADO_UTC], `TZ=${etiqueta}: years[].days sigue en UTC`);
    igual(stats.totals.days_active, 4, `TZ=${etiqueta}: days_active sigue contando días UTC`);
    igual(local.min.filter((m) => m > 0).length, 6, `TZ=${etiqueta}: los días locales con minutos (6, contra 4 UTC: mismas reproducciones, otro corte)`);

    // La suma, en ms, la dice la propia corrida (es la única corrida con el export real).
    const m = (r.stdout || '').match(/Σ ms local (\d+) = Σ ms UTC (\d+)/);
    af(!!m, `TZ=${etiqueta}: main() imprime las dos sumas: ${(r.stdout || '').slice(-300)}`);
    if (m) {
      igual(+m[1], MS_TOTAL, `TZ=${etiqueta}: Σ ms local`);
      igual(+m[2], MS_TOTAL, `TZ=${etiqueta}: Σ ms UTC`);
    }
  }
  if (generados.length === 3) {
    igual(generados[1].min, generados[0].min, 'con TZ de Buenos Aires, la misma serie');
    igual(generados[2].min, generados[0].min, 'con TZ de Tokio, la misma serie');
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. `build_stats()`: lo que devuelve no cambió para sus llamadores
  // ═════════════════════════════════════════════════════════════════════════
  // `main()` desempaqueta ocho; `puertas-pipeline` lee `[-1]` y `menos-salteas` lee `[4]`.
  const b = spawnSync('python3', ['-c', PY_BUILD, join(raiz, 'scripts/gen-stats.py')], {
    cwd: raiz, encoding: 'utf8', timeout: 120000, input: JSON.stringify(PLAYS),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  af(b.status === 0, `build_stats salió con ${b.status}: ${(b.stderr || '').slice(-400)}`);
  if (b.status === 0) {
    const s = JSON.parse(b.stdout);
    igual(s.largo, 8, 'build_stats sigue devolviendo ocho cosas');
    af(s.iguales === true, 'con el acumulador o sin él, devuelve lo mismo');
    const suma = (o) => Object.values(o || {}).reduce((x, y) => x + y, 0);
    igual(suma(s.local), MS_TOTAL, 'la suma de ms locales, del acumulador');
    igual(suma(s.utc), MS_TOTAL, 'la suma de ms de yb["days"], del acumulador');
    igual(Object.keys(s.local || {}).sort(), ['2018-12-31', '2019-01-01', '2019-01-02', '2019-01-03', '2019-01-05', '2019-01-06'], 'los días locales con reproducciones');
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fallos.length) {
  console.error(`\n✗ lluvia-dia-local: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts`);
