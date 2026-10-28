// «Las que menos te saltas» (`#menos-salteas`, tanda 90): la regla, la agrupación,
// el orden, los dos pipelines y las versiones.
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ VIGILA
// ═══════════════════════════════════════════════════════════════════════════
//
// `history-skip-stats` v5 le agrega a `tracks[id]` dos enteros al final (append:
// los cinco de antes no se mueven):
//   [5] = completas desde el corte: `trackdone` que NO es salto;
//   [6] = saltos desde el corte: `skipped === true || (fwdbtn && ms < 30 s)`;
// el corte es el 15/10/2022 a las 00:00 UTC (`PRIMER_SKIPPED_TRUE`). Lo de antes no
// cuenta para nada, y lo que no es ni completa ni salto (un `endplay`, un `fwdbtn`
// de 40 s sin `skipped`) tampoco.
//
// La vista (`util/menos-salteas.js`) agrupa por `gid`, deja los grupos con
// completas ≥ 10 y saltos / (completas + saltos) ≤ la mitad de `lineaBaseSaltos()`,
// y los ordena por porcentaje (de menor a mayor) y, a igualdad, por completas (de
// mayor a menor).
//
//   1. la regla, con sus bordes: 9 contra 10 completas, el porcentaje JUSTO en la
//      mitad (en enteros: en coma flotante 14/125×100 = 11,200000000000001), y una
//      reproducción del 14/10/2022 a las 23:59:59, que no cuenta;
//   2. la agrupación por `gid` (un remaster suma con su tema);
//   3. los dos pipelines (`build_stats()` de gen-stats.py y
//      `processStreamingHistory()`) sobre las MISMAS reproducciones: los dos campos
//      iguales id por id y iguales a la cuenta a mano;
//   4. las versiones, los tres sitios a la vez, la guarda de `history-data.js` (que
//      se queda en 4, ver ahí) y `OWNER_PREV_KEYS.skip` vacía; y el corte de Python
//      igual al de JS;
//   5. el orden y los textos.
//
// Todo con temas, artistas e ids INVENTADOS. Corre sin navegador y sin token.
// Correr con: node tests/menos-salteas.test.mjs
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const igual = (a, b, m) => af(JSON.stringify(a) === JSON.stringify(b), `${m}: esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`);
const leer = (r) => readFileSync(join(raiz, r), 'utf8');

// El módulo puro, importado sin tumbar la suite si no existe (contra v=341 no existe:
// lo de los pipelines y las versiones se sigue comprobando y sale rojo por su lado).
let M = null;
try { M = await import('../src/js/util/menos-salteas.js'); } catch (e) { fallos.push(`no se pudo importar util/menos-salteas.js: ${e.message}`); }
const { processStreamingHistory } = await import('../src/js/history-processor.js');
const { PRIMER_SKIPPED_TRUE } = await import('../src/js/util/corte-saltos.js');

// Una reproducción inventada, con la forma del export.
const p = (ts, tema, id, { fin = 'trackdone', seg = 180, saltada = false, artista = 'Banda Inventada' } = {}) => ({
  ts, ms_played: seg * 1000,
  master_metadata_album_artist_name: artista,
  master_metadata_album_album_name: `Disco de ${artista}`,
  master_metadata_track_name: tema,
  spotify_track_uri: `spotify:track:${id}`,
  reason_end: fin, skipped: saltada,
});
const dia = (n) => `2023-01-${String(n).padStart(2, '0')}T12:00:00Z`;

// Una línea base INVENTADA de 60,0 % (dos años con el campo: 2023 y 2024). La mitad: 30 %.
const YEARS = [
  { year: 2021, skips: 10, plays_raw: 1000, plays_junk: 0 },      // sin el campo: no entra en la base
  { year: 2023, skips: 600, plays_raw: 1000, plays_junk: 0 },
  { year: 2024, skips: 300, plays_raw: 500, plays_junk: 0 },
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. La regla y sus bordes (sobre `tracks` armados a mano)
// ═══════════════════════════════════════════════════════════════════════════
if (M) {
  igual(M.MIN_COMPLETAS, 10, 'el piso es 10 completas');
  af(!M.pasaLaVara(9, 0, 60), '9 completas y 0 saltos NO entra (el piso es 10)');
  af(M.pasaLaVara(10, 0, 60), '10 completas y 0 saltos entra');
  af(M.pasaLaVara(14, 6, 60), 'el 30 % JUSTO con una base de 60 entra (≤, y en enteros)');
  // Con una base de 22,4 la mitad es 11,2, y 14 saltos de 125 son el 11,2 % justo… que en coma flotante
  // da 11,200000000000001: comparado así, se quedaría fuera. En enteros entra.
  af(14 / 125 * 100 > 22.4 / 2, 'control: en coma flotante 14/125×100 se pasa de 22,4/2 (por eso la cuenta va en enteros)');
  af(M.pasaLaVara(111, 14, 22.4), 'el 11,2 % justo con una base de 22,4 entra');
  af(!M.pasaLaVara(14, 7, 60), '33,3 % con una base de 60 NO entra');
  af(!M.pasaLaVara(0, 0, 60), 'sin reproducciones no entra');
  // La base redondeada de verdad (67,9): la mitad es 33,95 → 1/3 entra, 34/100 no.
  af(M.pasaLaVara(20, 10, 67.9), '33,3 % con la base de 67,9 entra');
  af(!M.pasaLaVara(66, 34, 67.9), '34,0 % con la base de 67,9 NO entra');

  const r = M.armarMenosSalteas({ version: 5, tracks: {
    t9: [9, 0, [], [], 0, 9, 0],          // 9 completas: fuera
    t10: [10, 0, [], [], 1, 10, 0],       // 10 completas, 0 %: entra
    tmit: [14, 0, [], [], 2, 14, 6],      // 30 % justo: entra
    tfue: [14, 0, [], [], 3, 14, 7],      // 33,3 %: fuera
  } }, YEARS);
  igual(r.estado, 'ok', 'con los dos campos y dos años con el campo, la lista se arma');
  igual(r.base?.pct, 60, 'la línea base es la de `lineaBaseSaltos()` (60,0 con los años inventados)');
  igual(r.filas?.map((f) => f.id), ['t10', 'tmit'], 'entran 10 completas con 0 % y el 30 % justo; no 9 completas ni 33,3 %');

  igual(M.armarMenosSalteas({ tracks: { a: [10, 0, [], [], 0] } }, YEARS).estado, 'sin-campos', 'un `tracks[id]` de cinco campos (un historial importado antes) es «sin-campos»');
  af(M.faltanCampos({ a: [1, 0, [], [], 0, 1, 0], b: [1, 0, [], [], 1] }), 'basta UN id sin los dos campos');
  igual(M.armarMenosSalteas({ tracks: {} }, [{ year: 2023, skips: 1, plays_raw: 2, plays_junk: 0 }]).estado, 'sin-base', 'con un solo año con el campo no hay base');
  igual(M.armarMenosSalteas({ tracks: { a: [1, 0, [], [], 0, 1, 0] } }, YEARS).filas, [], 'nada cumple: lista vacía');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 y 3. Los dos pipelines sobre las mismas reproducciones inventadas
// ═══════════════════════════════════════════════════════════════════════════
const PLAYS = [
  // «Tema Firme» (id f1): 9 completas en enero de 2023…
  ...Array.from({ length: 9 }, (_, i) => p(dia(i + 1), 'Tema Firme', 'f1')),
  // …una completa a las 00:00:00 del corte (cuenta) y otra un segundo antes (NO cuenta)…
  p('2022-10-15T00:00:00Z', 'Tema Firme', 'f1'),
  p('2022-10-14T23:59:59Z', 'Tema Firme', 'f1'),
  // …y de antes del corte, aunque sean saltos, nada.
  p('2021-05-01T10:00:00Z', 'Tema Firme', 'f1', { fin: 'fwdbtn', seg: 3 }),
  // un `trackdone` con `skipped: true` es SALTO, no completa
  p(dia(20), 'Tema Firme', 'f1', { saltada: true }),
  // un `fwdbtn` de 10 s es salto; uno de 40 s sin `skipped` no es ni completa ni salto
  p(dia(21), 'Tema Firme', 'f1', { fin: 'fwdbtn', seg: 10 }),
  p(dia(22), 'Tema Firme', 'f1', { fin: 'fwdbtn', seg: 40 }),
  // un `endplay` tampoco suma a nada
  p(dia(23), 'Tema Firme', 'f1', { fin: 'endplay', seg: 100 }),
  // «Tema Firme - Remastered 2020» (id f2): el mismo tema (mismo `gid`), 3 completas
  ...Array.from({ length: 3 }, (_, i) => p(dia(i + 24), 'Tema Firme - Remastered 2020', 'f2')),
  // «Otro Tema» (id o1), otro grupo: 10 completas y 10 saltos (50 %)
  ...Array.from({ length: 10 }, (_, i) => p(`2024-02-${String(i + 1).padStart(2, '0')}T08:00:00Z`, 'Otro Tema', 'o1', { artista: 'Grupo Ficticio' })),
  ...Array.from({ length: 10 }, (_, i) => p(`2024-03-${String(i + 1).padStart(2, '0')}T08:00:00Z`, 'Otro Tema', 'o1', { artista: 'Grupo Ficticio', fin: 'fwdbtn', seg: 5 })),
];
// Lo esperado, A MANO: f1 = 9 + 1 (la de las 00:00:00) completas; 1 (trackdone saltada) + 1 (fwdbtn 10 s) saltos.
const A_MANO = { f1: [10, 2], f2: [3, 0], o1: [10, 10] };

const PY = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("gen_stats", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
s = m.build_stats(json.load(sys.stdin), {})[4]
print(json.dumps({"version": s["version"], "tracks": s["tracks"], "corte": getattr(m, "CORTE_SKIPPED", None)}, ensure_ascii=False))
`;
function py(plays) {
  const r = spawnSync('python3', ['-c', PY, join(raiz, 'scripts/gen-stats.py')], { input: JSON.stringify(plays), encoding: 'utf8' });
  if (r.status !== 0) { fallos.push(`gen-stats.py build_stats salió con ${r.status}: ${r.stderr.slice(-400)}`); return null; }
  return JSON.parse(r.stdout);
}
const sJs = (await processStreamingHistory([PLAYS])).skipStats;
const sPy = py(PLAYS);
for (const [quien, s] of [['JS', sJs], ['Python', sPy]]) {
  if (!s) continue;
  for (const [id, [c, x]] of Object.entries(A_MANO)) {
    const t = s.tracks?.[id];
    af(Array.isArray(t) && t.length === 7, `${quien} · ${id}: tracks[id] lleva 7 campos (vino ${t?.length})`);
    igual(t?.slice(5), [c, x], `${quien} · ${id}: [5] completas y [6] saltos desde el corte`);
  }
  igual(s.tracks?.f1?.[4], s.tracks?.f2?.[4], `${quien}: el tema y su remaster comparten gid`);
  af(s.tracks?.f1?.[4] !== s.tracks?.o1?.[4], `${quien}: otro tema, otro gid`);
}
if (sJs && sPy) {
  igual(sJs.tracks, sPy.tracks, 'JS y Python: `tracks` idéntico entero (los siete campos de cada id)');
}
// La vista, sobre lo que armó el pipeline: el grupo f1+f2 suma 13 completas y 2 saltos (13,3 %).
if (M && sJs) {
  const g = M.agruparPorGid(sJs.tracks).find((x) => x.ids.includes('f1'));
  igual(g && [g.ids, g.completas, g.saltos], [['f1', 'f2'], 13, 2], 'agrupado por gid: f1 + f2, y el que representa es el de más reproducciones (f1)');
  const r = M.armarMenosSalteas(sJs, YEARS);
  igual(r.filas?.map((f) => [f.id, f.completas, f.saltos]), [['f1', 13, 2]], 'entra el grupo f1+f2 (13,3 %); «Otro Tema» (50 %) no');
  // Sin agrupar no entraría ninguno de los dos por separado: f2 tiene 3 completas y f1, 10 con 2 saltos (16,7 %) sí;
  // lo que vigila esto es que la suma sea la del GRUPO.
  igual(r.filas?.[0]?.ids, ['f1', 'f2'], 'la fila lleva los dos ids del grupo');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Las versiones, los tres sitios a la vez
// ═══════════════════════════════════════════════════════════════════════════
const vPy = leer('scripts/gen-stats.py').match(/^SKIP_STATS_VERSION = (\d+)/m);
const vJs = leer('src/js/history-processor.js').match(/^const SKIP_STATS_VERSION = (\d+);/m);
const vClave = leer('src/js/history-keys.js').match(/^const SKIP_VERSION = (\d+);/m);
igual(vPy && +vPy[1], 5, 'SKIP_STATS_VERSION de scripts/gen-stats.py');
igual(vJs && +vJs[1], 5, 'SKIP_STATS_VERSION de src/js/history-processor.js');
igual(vClave && +vClave[1], 6, 'SKIP_VERSION de src/js/history-keys.js');
igual(sJs?.version, 5, 'el `version` del skipStats que arma processStreamingHistory()');
igual(sPy?.version, 5, 'el `version` del skipStats que arma build_stats()');
const hd = leer('src/js/features/history-data.js');
// La guarda de `loadSkipStats()` se queda en `>= 4` A PROPÓSITO: los dos campos van al final y un v4 le sirve
// entero a `#skips`; subirla a 5 dejaba sin `#skips` a un amigo con un historial importado antes (el caso H2 del
// banco `copia-importar` se colgaba). La vista detecta el v4 por los campos (`faltanCampos`, sección 1).
af(/loadOne\('skip', 'skip', d => !!d\.tracks && \(d\.version \|\| 1\) >= 4,/.test(hd), 'la guarda de loadSkipStats() sigue en `version >= 4`');
af(/\n  skip: \[\],\n/.test(hd), 'OWNER_PREV_KEYS.skip sigue vacía');
igual(sPy?.corte, `${PRIMER_SKIPPED_TRUE}T00:00:00Z`, 'CORTE_SKIPPED de gen-stats.py = PRIMER_SKIPPED_TRUE de corte-saltos.js a las 00:00 UTC');
const baked = JSON.parse(leer('src/data/history-skip-stats.json'));
igual(baked.version, 5, 'el history-skip-stats.json horneado es v5');
af(Object.values(baked.tracks).every((t) => t.length === 7 && Number.isInteger(t[5]) && Number.isInteger(t[6])), 'el horneado trae los dos enteros en todos los ids');

// ═══════════════════════════════════════════════════════════════════════════
// 5. El orden y los textos
// ═══════════════════════════════════════════════════════════════════════════
if (M) {
  const filas = M.ordenar([
    { id: 'c', completas: 10, saltos: 2 },   // 16,7 %
    { id: 'a', completas: 20, saltos: 0 },   // 0 %
    { id: 'b', completas: 10, saltos: 0 },   // 0 %, menos completas que «a»
    { id: 'e', completas: 24, saltos: 6 },   // 20 %
    { id: 'd', completas: 12, saltos: 3 },   // 20 %, menos completas que «e»
  ]);
  igual(filas.map((f) => f.id), ['a', 'b', 'c', 'e', 'd'], 'por porcentaje de menor a mayor y, a igualdad, por completas de mayor a menor');
  igual(M.textoPct(100 / 3), '33,3 %', 'el porcentaje con un decimal y coma de es-ES');
  igual(M.textoPct(0), '0,0 %', 'el cero con su decimal');
  igual(M.textoCuentas(12, 3), '12 enteras, 3 saltadas', '«N enteras, M saltadas»');
  igual(M.textoCuentas(1, 1), '1 entera, 1 saltada', 'en singular');
  igual(M.textoCuentas(1234, 0), '1234 enteras, 0 saltadas', 'las de cuatro cifras, como las escribe es-ES');
  igual(M.corteTexto(), '15/10/2022', 'el corte, sacado de PRIMER_SKIPPED_TRUE');
  igual(M.textoIntro({ pct: 67.9 }), 'Temas que escuchaste enteros al menos 10 veces desde el 15/10/2022 y que saltas como mucho la mitad que tu promedio (67,9 %).', 'el renglón de arriba');

  // Los nombres: primero los me gusta, después artist-tracks, en el orden de los ids del grupo.
  const likes = M.indiceDeLikes([{ track: { id: 'f2', name: 'Tema Firme - Remastered 2020', artists: [{ name: 'Banda Inventada' }] } }]);
  const at = M.indiceDeArtistTracks({ 'Banda Inventada': [['Tema Firme', 9, 30, 'f1']] });
  igual(M.nombreDeFila({ id: 'f1', ids: ['f1', 'f2'] }, likes, at).nombre, 'Tema Firme - Remastered 2020', 'el me gusta gana aunque sea otro id del grupo');
  igual(M.nombreDeFila({ id: 'f1', ids: ['f1', 'f2'] }, new Map(), at), { nombre: 'Tema Firme', artista: 'Banda Inventada', track: null, idNombre: 'f1' }, 'sin me gusta, artist-tracks');
  igual(M.nombreDeFila({ id: 'zz', ids: ['zz'] }, likes, at).nombre, '', 'sin ninguno de los dos, sin nombre (la fila se enseña igual)');
}

if (fallos.length) {
  console.error(`\n✗ menos-salteas: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts`);
