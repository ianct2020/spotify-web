// tests/skip-por-anio.test.mjs — el porcentaje de saltos de cada año (v=291)
//
// POR QUÉ ESTA SUITE EXISTE. Hasta v=290 el pipeline tenía DOS cuentas que se
// llamaban igual, `skip_pct`, en los dos lenguajes:
//
//   · `totals.skip_pct`: un salto es `skipped || (fwdbtn && ms < 30 s)`, contado
//     sobre TODAS las reproducciones deduplicadas. Daba 64,1.
//   · `years[].skip_pct`: contaba `fwdbtn || skipped` DESPUÉS del corte de 30 s
//     (o sea, se perdía los saltos cortos, que son la mayoría) y dividía por
//     `plays + skipped`, con los saltos sumados dos veces. Daba 34,7 en 2023,
//     donde con la primera definición hay 74,9.
//
// Ninguna puerta miraba `years[].skip_pct`, así que el número se podía ver en
// pantalla nueve años seguidos sin que nada fallara, y el paso «dentro de todo»
// del Wrapped decía en los NUEVE años que «este año aguantas mucho más».
//
// v=295 (tanda 43): NUMERADOR Y DIVISOR FILTRAN LO MISMO. Hasta v=294 la basura funcional
// (sonidos que no son música) sumaba en el divisor —va dentro de `plays_raw`— y nunca en el
// numerador, porque los saltos se cuentan después de saltearla. Ahora el divisor es
// `plays_raw − plays_junk`, con `plays_junk` contado en el mismo sitio en que se saltea.
// `plays_raw` NO cambió: sigue siendo «las crudas».
//
// Ahora hay una sola definición. Esta suite afirma:
//   1. sobre el JSON REAL del repo: los años suman el total, y cada porcentaje
//      sale de sus dos contadores;
//   2. sobre un fixture de diez reproducciones contadas A MANO: lo que da
//      `processStreamingHistory()` (el espejo JS del Python);
//   3. que el Python y el JS dicen lo mismo en el fuente, y las versiones;
//   4. el copy del paso «dentro de todo», rama por rama.
//
// Corre sin navegador, sin token y sin el export.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { processStreamingHistory } from '../src/js/history-processor.js';
import { pasoDentroDeTodo } from '../src/js/features/wrapped-apertura.js';
import { anioSinCampoSkipped, lineaBaseSaltos } from '../src/js/util/corte-saltos.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = p => readFileSync(join(raiz, p), 'utf8');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const igual = (a, b, nombre) => ok(a === b, `${nombre} (esperaba ${JSON.stringify(b)}, vino ${JSON.stringify(a)})`);
const r1 = (x) => Math.round(x * 10) / 10;

// ── 1. El JSON real del repo ───────────────────────────────────────────────

console.log('\n1. `src/data/history-stats.json`: los años suman el total');
const stats = JSON.parse(leer('src/data/history-stats.json'));
{
  const t = stats.totals;
  const crudas = stats.years.reduce((n, y) => n + y.plays_raw, 0);
  const saltos = stats.years.reduce((n, y) => n + y.skips, 0);
  ok(stats.years.every(y => Number.isInteger(y.plays_raw) && Number.isInteger(y.skips)),
     'todos los años traen `plays_raw` y `skips`, enteros');
  igual(crudas, t.plays_raw, 'Σ years[].plays_raw = totals.plays_raw');
  const basura = stats.years.reduce((n, y) => n + y.plays_junk, 0);
  ok(stats.years.every(y => Number.isInteger(y.plays_junk) && y.plays_junk >= 0) && Number.isInteger(t.plays_junk),
     'todos los años y el total traen `plays_junk`, entero');
  igual(basura, t.plays_junk, 'Σ years[].plays_junk = totals.plays_junk');
  ok(t.plays_junk > 0, `el JSON real trae basura que restar (${t.plays_junk}): si fuera 0 la suite no miraría el divisor nuevo`);
  igual(r1(saltos / Math.max(1, crudas - basura) * 100), t.skip_pct, 'Σ skips / (Σ crudas − Σ basura), redondeado, = totals.skip_pct');
  ok(r1(saltos / Math.max(1, crudas) * 100) !== t.skip_pct, 'y con el divisor viejo (las crudas enteras) NO da el total: la puerta distingue las dos cuentas');
  for (const y of stats.years) {
    igual(y.skip_pct, r1(y.skips / Math.max(1, y.plays_raw - y.plays_junk) * 100), `${y.year}: skip_pct = round(skips / (plays_raw − plays_junk) × 100, 1)`);
    ok(y.plays_junk <= y.plays_raw - y.plays, `${y.year}: la basura no supera a las crudas que no son válidas`);
    ok(y.plays_raw > 0 && y.plays > 0 && y.min > 0, `${y.year}: ni \`plays_raw\` ni \`plays\` ni \`min\` están en cero`);
    ok(y.skips <= y.plays_raw && y.plays <= y.plays_raw, `${y.year}: los saltos y las válidas no superan a las crudas`);
    // Append: un lector viejo que mire los campos de siempre no se entera.
    igual(Object.keys(y).slice(-3).join(','), 'plays_raw,skips,plays_junk', `${y.year}: los tres campos nuevos van al FINAL, en ese orden`);
  }
  igual(Object.keys(t).slice(-2).join(','), 'skip_pct,plays_junk', 'totals: `plays_junk` va al FINAL, detrás de `skip_pct`');
  igual(stats.version, 5, 'el sello del JSON es la v5');
}

// ── 2. Diez reproducciones contadas a mano ─────────────────────────────────
//
// El resultado está escrito ANTES de correr nada:
//
//   2024 (6 crudas)                                   ¿salto?  ¿válida (≥30 s)?
//    1. trackdone, 200 s                                 no        sí
//    2. fwdbtn, 10 s            ← salto corto            SÍ        no
//    3. fwdbtn, 120 s           ← next al final: NO      no        sí
//    4. skipped: true, 5 s                               SÍ        no
//    5. skipped: true, 90 s     ← salto LARGO            SÍ        sí
//    6. basura, skipped, 3 s    ← NO va al divisor (*)   no (*)    no
//   2025 (4 crudas)
//    7. trackdone, 180 s                                 no        sí
//    8. endplay, 12 s           ← corta, sin saltar      no        no
//    9. fwdbtn, 29,999 s        ← un ms antes del corte  SÍ        no
//   10. trackdone, 240 s                                 no        sí
//
//   (*) v=295: la basura sigue siendo una cruda (`plays_raw` la cuenta: 6 en 2024, 10 en
//       total) pero ya no entra NI en el numerador NI en el divisor: se cuenta aparte, en
//       `plays_junk` (1 en 2024, 0 en 2025, 1 en total), y el divisor es crudas − basura.
//
//   2024: 3 de (6 − 1) = 3 de 5 = 60,0 · 2025: 1 de (4 − 0) = 25,0 · total: 4 de (10 − 1) = 4 de 9 = 44,4
//   Hasta v=294, con la basura en el divisor: 2024 = 3 de 6 = 50,0 y total = 4 de 10 = 40,0.
//   La fórmula de hasta v=290 daba 2024 = 2 / (3 + 2) = 40,0 y 2025 = 0 / 2 = 0,0.

console.log('\n2. Diez reproducciones, contadas a mano');
{
  let n = 0;
  const play = (ts, ms, extra = {}) => {
    const id = String(++n).padStart(22, 'x');
    return {
      ts, ms_played: ms, spotify_track_uri: `spotify:track:${id}`,
      master_metadata_track_name: extra.track ?? `Tema ${n}`,
      master_metadata_album_artist_name: extra.artista ?? 'Artista de prueba',
      master_metadata_album_album_name: 'Álbum de prueba',
      reason_end: extra.reason_end ?? 'trackdone', skipped: extra.skipped ?? false,
    };
  };
  const diez = [
    play('2024-05-01T10:00:00Z', 200000),
    play('2024-05-01T10:10:00Z', 10000, { reason_end: 'fwdbtn' }),
    play('2024-05-01T10:20:00Z', 120000, { reason_end: 'fwdbtn' }),
    play('2024-05-02T10:00:00Z', 5000, { skipped: true }),
    play('2024-05-02T10:10:00Z', 90000, { skipped: true }),
    play('2024-05-03T10:00:00Z', 3000, { skipped: true, track: 'Sonido Para Sacar Agua Del Movil', artista: 'nbeats' }),
    play('2025-02-01T10:00:00Z', 180000),
    play('2025-02-01T10:10:00Z', 12000, { reason_end: 'endplay' }),
    play('2025-02-01T10:20:00Z', 29999, { reason_end: 'fwdbtn' }),
    play('2025-02-02T10:00:00Z', 240000),
  ];
  igual(diez.length, 10, 'el fixture son diez reproducciones');
  const { stats: s } = processStreamingHistory([diez]);
  const a24 = s.years.find(y => y.year === 2024), a25 = s.years.find(y => y.year === 2025);
  igual(s.years.length, 2, 'salen dos años');
  igual(a24.plays_raw, 6, '2024: 6 crudas (la basura sigue siendo una cruda)');
  igual(a24.plays_junk, 1, '2024: 1 de basura, contada aparte');
  igual(a24.skips, 3, '2024: 3 saltos (el fwdbtn corto y los dos skipped; el fwdbtn largo y la basura, no)');
  igual(a24.skip_pct, 60, '2024: 3 de (6 − 1) = 60,0 (hasta v=294, con la basura en el divisor, daba 50,0)');
  igual(a24.plays, 3, '2024: 3 válidas, que no cambian');
  igual(a25.plays_raw, 4, '2025: 4 crudas');
  igual(a25.plays_junk, 0, '2025: 0 de basura');
  igual(a25.skips, 1, '2025: 1 salto (el fwdbtn de 29,999 s)');
  igual(a25.skip_pct, 25, '2025: 1 de 4 = 25,0 (la fórmula vieja daba 0,0)');
  igual(a25.plays, 2, '2025: 2 válidas');
  igual(s.totals.plays_raw, 10, 'total: 10 crudas');
  igual(s.totals.plays_junk, 1, 'total: 1 de basura');
  igual(s.totals.skip_pct, 44.4, 'total: 4 de (10 − 1) = 44,4 (hasta v=294 daba 40,0)');
  igual(a24.plays_raw + a25.plays_raw, s.totals.plays_raw, 'los años suman el total de crudas');
  igual(a24.plays_junk + a25.plays_junk, s.totals.plays_junk, 'y el total de basura');
  igual(r1((a24.skips + a25.skips) / (s.totals.plays_raw - s.totals.plays_junk) * 100), s.totals.skip_pct, 'y sus saltos, sobre crudas − basura, dan el porcentaje del total');
  igual(Object.keys(a24).slice(-3).join(','), 'plays_raw,skips,plays_junk', 'el BYOH también lleva los tres campos al FINAL');
  igual(Object.keys(s.totals).slice(-1)[0], 'plays_junk', 'y `plays_junk` al final de sus totales');
  igual(s.version, 5, 'el BYOH sella la misma versión que el JSON horneado');
}

// ── 3. El Python y el JS dicen lo mismo, y las versiones ───────────────────

console.log('\n3. Los dos lenguajes y los números de versión');
{
  const py = leer('scripts/gen-stats.py');
  const js = leer('src/js/history-processor.js');
  ok(/"skip_pct": round\(year_skips\[y\]\/max\(1, year_raw\[y\] - year_junk\[y\]\) \* 100, 1\)/.test(py),
     'gen-stats.py: el porcentaje del año es `year_skips / max(1, year_raw − year_junk)`');
  ok(/skip_pct: round1\(\(yearSkips\.get\(y\) \|\| 0\) \/ Math\.max\(1, \(yearRaw\.get\(y\) \|\| 0\) - \(yearJunk\.get\(y\) \|\| 0\)\) \* 100\)/.test(js),
     'history-processor.js: y su espejo, `yearSkips / max(1, yearRaw − yearJunk)`');
  ok(/"skip_pct": round\(total_skipped\/max\(1, total_plays - total_junk\)\*100, 1\)/.test(py),
     'gen-stats.py: el del total es `total_skipped / max(1, total_plays − total_junk)`');
  ok(/skip_pct: round1\(totalSkipped \/ Math\.max\(1, totalPlays - totalJunk\) \* 100\)/.test(js),
     'history-processor.js: y su espejo, `totalSkipped / max(1, totalPlays − totalJunk)`');
  // La basura se CUENTA en el mismo sitio en que se saltea, y en ningún otro.
  ok(/if is_junk_track\(track, artist\):\n\s+total_junk \+= 1\n\s+year_junk\[dt\.year\] \+= 1\n\s+continue/.test(py),
     'gen-stats.py: `total_junk` y `year_junk` suben dentro del `if is_junk_track(…)`, justo antes del `continue`');
  ok(/if \(isJunkTrack\(track, artist\)\) \{\n\s+totalJunk\+\+;\n\s+yearJunk\.set\(parsed\.year, [^\n]+\n\s+continue;/.test(js),
     'history-processor.js: `totalJunk` y `yearJunk`, dentro del `if (isJunkTrack(…))`, justo antes del `continue`');
  igual((py.match(/total_junk \+= 1/g) || []).length, 1, 'gen-stats.py: `total_junk` sube en un solo sitio');
  igual((js.match(/totalJunk\+\+/g) || []).length, 1, 'history-processor.js: `totalJunk` sube en un solo sitio');
  ok(/total_plays = len\(plays\)/.test(py) && /"plays_raw": total_plays,/.test(py) && /plays_raw: totalPlays,/.test(js),
     '`plays_raw` sigue siendo las crudas enteras en los dos (no se le resta nada)');
  ok(!/yb\["skipped"\]/.test(py) && !/yb\.skipped/.test(js),
     'ninguno de los dos conserva el contador viejo (`yb.skipped`), que vivía después del corte de 30 s');
  ok(!/max\(1,[^)\n]*\+[^)\n]*\)/.test(py) && !/Math\.max\(1,[^)\n]*\+[^)\n]*\)/.test(js),
     'y ninguno divide por una SUMA de contadores, que era la forma del defecto');
  // El contador del año se incrementa en el MISMO sitio que el del total.
  ok(/total_skipped \+= 1\n\s+year_skips\[dt\.year\] \+= 1/.test(py), 'gen-stats.py: `year_skips` sube junto a `total_skipped`');
  ok(/totalSkipped\+\+;\n\s+yearSkips\.set\(/.test(js), 'history-processor.js: `yearSkips` sube junto a `totalSkipped`');
  const vPy = +(py.match(/^STATS_VERSION = (\d+)/m) || [])[1];
  const vJs = +(js.match(/^const STATS_VERSION = (\d+);/m) || [])[1];
  igual(vPy, 5, 'gen-stats.py: STATS_VERSION = 5');
  igual(vJs, vPy, 'history-processor.js: el mismo número (el BYOH no queda atrás)');
  const claves = leer('src/js/history-keys.js');
  igual(+(claves.match(/^const STATS_VERSION = (\d+);/m) || [])[1], 6,
        'history-keys.js: STATS_VERSION = 6 (la clave de IndexedDB y el `?v=` del JSON)');
  // Sin esto el navegador migraría el JSON viejo a la clave nueva, sin fallar.
  ok(/\n  stats: \[\],\n/.test(leer('src/js/features/history-data.js')),
     'history-data.js: `OWNER_PREV_KEYS.stats` sigue VACÍA');
}

// ── 4. El copy del paso «dentro de todo» ───────────────────────────────────
//
// Nació del número malo: con la fórmula vieja los nueve años caían en la rama
// del medio. Con la buena se reparten entre las tres.

console.log('\n4. El paso «dentro de todo» de la apertura del Wrapped');
{
  const fmtMinutes = (m) => `${Math.round(m)}m`;
  const frase = (y, st = stats) => {
    const p = pasoDentroDeTodo({ y, stats: st, fmtMinutes });
    return p ? p.cuerpo : null;
  };
  // Sintético: un total de 64,1 y un año con el porcentaje que se le pida.
  const falso = (pct) => ({
    y: { year: 2030, plays: 100, skip_pct: pct },
    st: { totals: { plays_valid: 1000, skip_pct: 64.1 }, years: [{ year: 2029 }, { year: 2030 }] },
  });
  const con = (pct) => { const f = falso(pct); return frase(f.y, f.st); };

  // v=295 (T43.4): estas tres frases afirmaban el punto justo detrás del total («…histórico.» /
  // «…la cifra es 64,1%.»). Ahora la mención del total lleva pegado «, que mezcla dos formas
  // de contar» (el detalle lo vigila `tests/corte-saltos.test.mjs`, sección 5).
  ok(/escuchas igual que siempre: cortas el 66,7% de lo que pones, contra el 64,1% histórico, que mezcla dos formas de contar\./.test(con(66.7)),
     'a menos de 3 puntos: «escuchas igual que siempre»');
  ok(/escuchas igual que siempre/.test(con(61.2)) && /escuchas igual que siempre/.test(con(67.0)),
     'el umbral sigue en 3 puntos, a los dos lados (61,2 y 67,0 entran)');
  ok(/Aunque este año cortas más que de costumbre: 74,9% contra el 64,1% histórico, que mezcla dos formas de contar\./.test(con(74.9)),
     'por encima: «cortas más que de costumbre»');
  const baja = con(7.2);
  ok(/Y este año aguantas más: dejas a medias el 7,2% de lo que pones, cuando en el total de tu historial la cifra es 64,1%, que mezcla dos formas de contar\./.test(baja),
     'por debajo: «aguantas más»');
  ok(/En todo tu historial cortas 6 de cada 10 canciones; este año, 1\./.test(baja),
     'y la comparación «de cada 10» no dice «antes»: el total INCLUYE el año que se mira');
  const casi = con(60.0);
  ok(/aguantas más/.test(casi) && !/de cada 10/.test(casi),
     'con 60,0 contra 64,1 los dos redondeos dan 6: la frase «de cada 10» NO sale («6; este año, 6» no dice nada)');
  for (const p of [7.2, 35.8, 60.0, 58.4, 66.7, 74.9]) {
    const f = con(p);
    ok(!/Antes cortabas/.test(f) && !/ahora, \d/.test(f), `${p}: ya no dice «Antes cortabas…; ahora…»`);
    ok(!/mucho más/.test(f), `${p}: ya no dice «mucho más» (la rama entra con 3 puntos)`);
  }
  // Y con el JSON real: los nueve años producen una frase, y ya no caen todos en la misma rama.
  //
  // v=292 (tanda 41): los años SIN el campo `skipped` (2018-2022, ver `util/corte-saltos.js`)
  // ya no entran en ninguna de las tres ramas: ahí la comparación se fue entera. Lo que se
  // afirma de ellos cambió (está marcado abajo); lo de 2023-2026 es lo de v=291, sin tocar.
  // El detalle de la línea nueva lo vigila `tests/corte-saltos.test.mjs`.
  const ramas = new Set();
  for (const y of stats.years) {
    const f = frase(y);
    ok(typeof f === 'string' && f.length > 40, `${y.year}: el paso se arma con el JSON real`);
    if (anioSinCampoSkipped(y.year)) {
      // (antes: el año caía en una de las tres ramas y sumaba a `ramas`)
      ok(/no se puede comparar/.test(f) && !/igual que siempre|aguantas más|más que de costumbre/.test(f),
         `${y.year}: sin el campo \`skipped\` no cae en ninguna rama: dice que no se puede comparar`);
      // (antes: «si sale "de cada 10", los dos números son distintos»)
      ok(!/de cada 10/.test(f), `${y.year}: y la frase «de cada 10» no sale nunca`);
      continue;
    }
    ramas.add(/igual que siempre/.test(f) ? 'igual' : /aguantas más/.test(f) ? 'menos' : /más que de costumbre/.test(f) ? 'más' : '?');
    // v=296 (tanda 44): estos años se comparan contra la LÍNEA BASE de los años con el campo
    // (`lineaBaseSaltos()`, 68,5), no contra el total. Hasta v=295 este assert comparaba contra
    // `stats.totals.skip_pct`; con la base 2026 lo ponía rojo: la frase sale con 7 contra 6, y
    // contra el total daría 6 contra 6. Ahora compara contra la base.
    const B = lineaBaseSaltos(stats.years);
    const d = Math.round(B.pct / 10), a = Math.round(y.skip_pct / 10);
    ok(!/de cada 10/.test(f) || d !== a, `${y.year}: si sale «de cada 10», los dos números (base ${d}, año ${a}) son distintos`);
  }
  // (antes: «todas las frases reales…», sobre los nueve años)
  ok(!ramas.has('?'), 'todas las frases reales de los años con el campo caen en una de las tres ramas');
  ok(ramas.size >= 2, `los años reales ya no caen todos en la misma rama (${[...ramas].join(', ')})`);
}

console.log(`\n${fallaron === 0 ? '✓' : '✗'} skip-por-anio: ${pasaron} asserts ok${fallaron ? `, ${fallaron} fallo(s)` : ''}`);
process.exit(fallaron ? 1 : 0);
