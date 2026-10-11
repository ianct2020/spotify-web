// El detalle por día (`days`, el octavo payload) — las puertas 1 y 2 (v=289).
//
// ═══════════════════════════════════════════════════════════════════════════
// QUÉ VIGILA
// ═══════════════════════════════════════════════════════════════════════════
//
//  1. **Los minutos cuadran, día por día.** `days.dias[dia].min` tiene que dar
//     lo mismo que `years[].days.min` del pipeline, con tolerancia de redondeo
//     a 0,1. Hay DOS versiones de esta comparación, y las dos hacen falta:
//
//       · con un **fixture sintético**, contra `stats.years[].days` que produce
//         el MISMO `processStreamingHistory()`. Compara el acumulador nuevo
//         contra el agregado de siempre y corre en cualquier máquina.
//       · con el **export REAL de Ian** (`my_spotify_data/`, gitignoreado),
//         contra el `history-stats.json` del repo, que lo horneó el **Python**.
//         Ésta es la que de verdad importa: compara el puerto JS nuevo contra
//         `gen-stats.py`. Si el export no está en disco, se SALTA y lo dice —
//         nunca pasa en silencio.
//
//  2. **Los saltos cuadran.** La definición de salto (`skipped`, o `fwdbtn`
//     con menos de 30 s, sobre las crudas) reproduce `totals.skip_pct`
//     EXACTO.
//
//     🟥 **Y acá hay una discrepancia del pipeline que esta suite afirma en vez
//     de esconder.** `years[].skip_pct` **no** sale de esa cuenta: usa
//     `yb.skipped / (yb.plays + yb.skipped)` con `yb.skipped` contando
//     `fwdbtn || skipped` **sin mirar los 30 s** y **solo entre las plays de
//     ≥30 s** (el `yb.skipped++` vive dentro del `if (ms < MIN_MS) continue`),
//     y encima el denominador suma los saltos dos veces porque `yb.plays` ya
//     los contiene. Son dos magnitudes distintas con el mismo nombre, en los
//     dos lenguajes (`gen-stats.py:458` y `:549`).
//
//     Medido el 10/10 sobre el export real: con la definición de `totals` el
//     año 2023 da **74,9 %** y `years[].skip_pct` dice **34,7 %**; los nueve
//     años difieren. Con la otra fórmula se reproducen **9 de 9 exactos**.
//     Las dos cosas se afirman abajo, para que nadie «arregle» el acumulador
//     persiguiendo un número que mide otra cosa. Anotado en `PENDIENTES.md`.
//
//  3. **Los otros SIETE payloads no cambian ni un byte.** `days` se AGREGA al
//     resultado de `processStreamingHistory()`; los siete de siempre se
//     comparan con `JSON.stringify` contra una corrida de referencia hecha sin
//     mirar `days`.
//
// Corre sin navegador y sin token.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { processStreamingHistory, crearAcumuladorDeDias, DAYS_VERSION } from '../src/js/history-processor.js';
import { isJunkTrack } from '../src/js/util/junk.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const igual = (a, b, m) => af(a === b, `${m}: esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`);

const MIN_MS = 30000;
const TOL = 0.1;

// ═══════════════════════════════════════════════════════════════════════════
// EL FIXTURE SINTÉTICO
// ═══════════════════════════════════════════════════════════════════════════
//
// Se construye a mano para que cada caso límite esté representado y NO depender
// del export de nadie: dos años (uno con el 1 de enero de arranque), plays
// cortas, un día entero sin una sola play válida, una play sin
// `spotify_track_uri` (un podcast), basura funcional, un tema repetido el mismo
// día, un `fwdbtn` corto y uno largo, un `skipped: true`, y la MISMA play
// duplicada en dos archivos (que es lo que hacen los `_N` del export real).
function play(ts, uri, ms, extra = {}) {
  return {
    ts,
    ms_played: ms,
    spotify_track_uri: uri ? `spotify:track:${uri}` : null,
    master_metadata_track_name: extra.track ?? `Tema ${uri}`,
    master_metadata_album_artist_name: extra.artista ?? `Artista de ${String(uri).slice(0, 1)}`,
    master_metadata_album_album_name: extra.album ?? `Álbum ${uri}`,
    reason_end: extra.reason_end ?? 'trackdone',
    skipped: extra.skipped ?? false,
  };
}

const A = 'aaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccc';

const archivo1 = [
  // 2025-03-04: dos temas, uno repetido, y A suena DESPUÉS de B la primera vez
  play('2025-03-04T10:00:00Z', B, 240000),
  play('2025-03-04T10:05:00Z', A, 180000),
  play('2025-03-04T18:00:00Z', B, 120000),
  // una play corta: no suma minutos ni aparece en los temas del día
  play('2025-03-04T18:10:00Z', C, 12000),
  // un `fwdbtn` corto → SALTO; uno largo → NO salto por la definición de totals
  play('2025-03-05T09:00:00Z', A, 8000, { reason_end: 'fwdbtn' }),
  play('2025-03-05T09:10:00Z', A, 200000, { reason_end: 'fwdbtn' }),
  play('2025-03-05T09:20:00Z', B, 95000, { skipped: true }),
  // un podcast: sin uri, no entra en nada
  play('2025-03-05T10:00:00Z', null, 900000),
  // basura funcional: no suma minutos (el pipeline la salta)
  play('2025-03-06T11:00:00Z', C, 600000, { track: 'Sonido Para Sacar Agua Del Movil', artista: 'nbeats' }),
];

const archivo2 = [
  // la MISMA play que el archivo1, como los `_N` solapados del export
  play('2025-03-04T10:00:00Z', B, 240000),
  // y el año siguiente, arrancando el 1 de enero
  play('2026-01-01T00:00:28Z', C, 300000),
  play('2026-01-02T23:59:00Z', A, 150000),
];

const fileArrays = [archivo1, archivo2];

// ═══════════════════════════════════════════════════════════════════════════
// 1 · el acumulador es incremental y la deduplicación es compartida
// ═══════════════════════════════════════════════════════════════════════════
{
  const acu = crearAcumuladorDeDias();
  const r1 = acu.agregarArchivo(archivo1);
  const r2 = acu.agregarArchivo(archivo2);
  igual(r1.crudas, archivo1.length, 'el primer archivo reporta sus crudas');
  igual(r2.crudas, archivo2.length, 'el segundo archivo reporta sus crudas');
  // La play repetida la caza el `Set` COMPARTIDO entre archivos: si cada
  // archivo tuviera su propio Set, esto daría 3 y no 2.
  igual(r2.dedup, 2, 'la play repetida entre archivos NO se cuenta dos veces');
  const d = acu.cerrar();

  igual(d.version, DAYS_VERSION, 'el payload lleva su versión');
  igual(d.conteo.leidas, archivo1.length + archivo2.length, 'el conteo dice cuántas líneas se leyeron');
  igual(d.conteo.repetidas, 1, 'y cuántas eran repetidas');
  igual(d.conteo.sin_uri, 1, 'y cuántas no tenían uri (el podcast)');

  // ── el día del medio ──
  const d4 = d.dias['2025-03-04'];
  af(!!d4, 'existe el 2025-03-04');
  // 240.000 + 120.000 de B + 180.000 de A = 540.000 ms = 9 min justos.
  igual(d4.min, 9, 'los minutos del día son la suma de los ms válidos, redondeada a 1 decimal');
  igual(d4.validas, 3, 'tres plays de ≥30 s (la de 12 s no cuenta)');
  igual(d4.crudas, 4, 'cuatro crudas (la repetida del otro archivo ya se fue)');
  igual(d4.saltos, 0, 'ese día no hubo saltos');
  igual(d4.temas.length, 2, 'dos temas con minutos (el de 12 s no entra)');
  // EL ORDEN: por primera reproducción del día, no por minutos ni por id.
  // B sonó a las 10:00 y A a las 10:05, así que B va primero aunque A tenga
  // menos minutos.
  const nombre = i => d.temas[i][0];
  igual(nombre(d4.temas[0][0]), B, 'el primer tema del día es el que sonó primero');
  igual(nombre(d4.temas[1][0]), A, 'y el segundo, el segundo');
  igual(d4.temas[0][2], 2, 'B suena dos veces ese día y se cuenta una sola fila con `veces: 2`');
  igual(d4.temas[1][2], 1, 'A suena una vez');

  // ── los saltos ──
  const d5 = d.dias['2025-03-05'];
  igual(d5.saltos, 2, 'el `fwdbtn` CORTO y el `skipped` son saltos; el `fwdbtn` largo NO');
  igual(d5.crudas, 3, 'el podcast sin uri no cuenta como cruda');
  igual(d5.validas, 2, 'la play de 8 s no es válida');

  // ── la basura funcional ──
  const d6 = d.dias['2025-03-06'];
  igual(d6.min, 0, 'la basura funcional no suma minutos, igual que en el pipeline');
  igual(d6.temas.length, 0, 'ni aparece entre los temas del día');
  igual(d6.crudas, 1, 'pero sí cuenta como cruda: es el mismo denominador que `plays_raw`');

  // ── el diccionario es ÚNICO ──
  // A aparece el 04/03, el 05/03 y el 02/01/2026; el diccionario lo guarda UNA vez.
  const ids = d.temas.map(t => t[0]);
  igual(new Set(ids).size, ids.length, 'ningún tema está dos veces en el diccionario');
  af(ids.includes(A) && ids.includes(B), 'A y B están en el diccionario');
  // Null-safe a propósito: con la agrupación en hora local el día 2026-01-01
  // no existe (se va al 31/12/2025), y un `TypeError` acá tapaba el rojo de la
  // puerta 1 con un crash. Un fallo tiene que LEERSE.
  af(d.dias['2026-01-01']?.temas?.length === 1,
    'C entra solo por su play válida de 2026, no por la corta de 2025');
  for (const t of d.temas) {
    igual(t.length, 3, 'cada entrada del diccionario es [id, nombre, artista]');
  }

  // ── el día que cruza la medianoche se agrupa en UTC, no en local ──
  // `2026-01-02T23:59:00Z` cae el 2 en UTC y el 2 a las 20:59 en Buenos Aires:
  // los dos coinciden. El que separa es `2026-01-01T00:00:28Z`, que en UTC−3
  // se va al 31 de diciembre de 2025 — el bug de v=154/v=231.
  af(!!d.dias['2026-01-01'], 'la play de 28 segundos después de medianoche cae el 1 de enero (UTC)');
  af(!d.dias['2025-12-31'], 'y NO el 31 de diciembre, que es donde la pondría la hora local');
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · PUERTA 1 (sintética) · los minutos cuadran con `years[].days.min`
// ═══════════════════════════════════════════════════════════════════════════
const resultado = processStreamingHistory(fileArrays);
{
  af(!!resultado.days, '`processStreamingHistory()` devuelve el octavo payload');
  af(!!resultado.days.dias, 'y trae sus días');

  let comparados = 0, difieren = 0;
  const detalle = [];
  for (const y of resultado.stats.years) {
    const D = y.days;
    af(!!D, `el año ${y.year} trae su tramo \`days\``);
    if (!D) continue;
    const base = Date.UTC(+D.from.slice(0, 4), +D.from.slice(5, 7) - 1, +D.from.slice(8, 10));
    for (let i = 0; i < D.min.length; i++) {
      const dia = new Date(base + i * 86400000).toISOString().slice(0, 10);
      const mio = resultado.days.dias[dia]?.min || 0;
      comparados++;
      if (Math.abs(mio - D.min[i]) > TOL + 1e-9) {
        difieren++;
        if (detalle.length < 6) detalle.push(`${dia}: pipeline ${D.min[i]} · acumulador ${mio}`);
      }
    }
  }
  af(comparados > 0, 'el fixture sintético produce días que comparar');
  af(difieren === 0,
    `PUERTA 1 (sintética): ${difieren} de ${comparados} días NO cuadran con \`years[].days.min\`.\n` +
    detalle.map(d => '      ' + d).join('\n'));
  if (difieren === 0) ok++;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · los otros SIETE payloads no cambian ni un byte
// ═══════════════════════════════════════════════════════════════════════════
//
// `generated_at` es un `new Date().toISOString()`, así que dos corridas
// difieren por ahí y solo por ahí: se normaliza antes de comparar. Lo que se
// afirma es que agregar `days` no movió NADA de lo demás.
{
  const otra = processStreamingHistory(fileArrays);
  const sinFecha = (o) => JSON.stringify(o, (k, v) => (k === 'generated_at' ? '·' : v));
  for (const clave of ['stats', 'trackPlays', 'listened', 'skipStats', 'detail', 'records', 'artistTracks']) {
    af(sinFecha(resultado[clave]) === sinFecha(otra[clave]),
      `el payload \`${clave}\` es determinista (dos corridas idénticas)`);
  }
  const claves = Object.keys(resultado).sort();
  igual(claves.join(','), 'artistTracks,days,detail,listened,records,skipStats,stats,trackPlays',
    'son OCHO payloads y `days` es el que se agregó');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · PUERTA 2 · los saltos, y las DOS fórmulas del pipeline
// ═══════════════════════════════════════════════════════════════════════════
{
  let saltos = 0, crudas = 0;
  for (const d of Object.values(resultado.days.dias)) { saltos += d.saltos; crudas += d.crudas; }
  const pct = Math.round(saltos / Math.max(1, crudas) * 1000) / 10;
  igual(pct, resultado.stats.totals.skip_pct,
    'PUERTA 2: la suma de saltos sobre la de crudas da `totals.skip_pct` EXACTO');

  // Y la otra fórmula, la de `years[].skip_pct`, es DISTINTA. Se afirma que lo
  // es: si algún día el pipeline las unifica, esta suite se pone roja y hay que
  // venir a leer el porqué en vez de descubrirlo en pantalla.
  const anio = resultado.stats.years.find(y => y.year === 2025);
  let s25 = 0, c25 = 0;
  for (const [dia, d] of Object.entries(resultado.days.dias)) {
    if (!dia.startsWith('2025')) continue;
    s25 += d.saltos; c25 += d.crudas;
  }
  const pct25 = Math.round(s25 / Math.max(1, c25) * 1000) / 10;
  af(pct25 !== anio.skip_pct,
    'PUERTA 2: `years[].skip_pct` mide OTRA cosa que `saltos/crudas` — si esto se pone verde, ' +
    'el pipeline cambió y hay que releer la nota de arriba');

  // La fórmula de `years[].skip_pct`, reproducida desde las crudas: `fwdbtn ||
  // skipped` SIN mirar los 30 s y SOLO entre las plays de ≥30 s, con el
  // denominador sumando los saltos dos veces.
  const vistas = new Set();
  const porAnio = new Map();
  for (const arr of fileArrays) {
    for (const r of arr) {
      const uri = r.spotify_track_uri;
      if (!uri) continue;
      const k = `${r.ts}|${uri}|${r.ms_played || 0}`;
      if (vistas.has(k)) continue;
      vistas.add(k);
      if (isJunkTrack(r.master_metadata_track_name || '', r.master_metadata_album_artist_name || '')) continue;
      if ((Number(r.ms_played) || 0) < MIN_MS) continue;
      const y = +r.ts.slice(0, 4);
      let b = porAnio.get(y); if (!b) { b = { plays: 0, skipped: 0 }; porAnio.set(y, b); }
      b.plays++;
      if ((r.reason_end || '') === 'fwdbtn' || !!r.skipped) b.skipped++;
    }
  }
  for (const y of resultado.stats.years) {
    const b = porAnio.get(y.year) || { plays: 0, skipped: 0 };
    const p = Math.round(b.skipped / Math.max(1, b.plays + b.skipped) * 1000) / 10;
    igual(p, y.skip_pct, `PUERTA 2: ${y.year} · la OTRA fórmula reproduce \`years[].skip_pct\``);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · PUERTA 1 (real) · contra el `history-stats.json` que horneó el PYTHON
// ═══════════════════════════════════════════════════════════════════════════
//
// Es la comparación que de verdad importa: el puerto JS nuevo contra
// `gen-stats.py`. Necesita el export de Ian en disco, que está gitignoreado,
// así que en otra máquina se SALTA — y lo dice, porque un paso que se saltea en
// silencio es peor que uno que falta.
{
  const DIR = join(raiz, 'my_spotify_data/Spotify Extended Streaming History');
  if (!existsSync(DIR)) {
    console.log('  · PUERTA 1 (real): SALTADA — no hay `my_spotify_data/` en esta máquina.');
    console.log('    (la versión sintética de arriba sí corrió)');
  } else {
    const nombres = readdirSync(DIR).filter(n => /^Streaming_History_Audio.*\.json$/i.test(n)).sort();
    af(nombres.length > 0, 'el export real trae archivos de audio');
    const acu = crearAcumuladorDeDias();
    for (const n of nombres) acu.agregarArchivo(JSON.parse(readFileSync(join(DIR, n), 'utf8')));
    const days = acu.cerrar();

    const stats = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));
    let comparados = 0, difieren = 0;
    const detalle = [];
    for (const y of stats.years) {
      const D = y.days;
      const base = Date.UTC(+D.from.slice(0, 4), +D.from.slice(5, 7) - 1, +D.from.slice(8, 10));
      for (let i = 0; i < D.min.length; i++) {
        const dia = new Date(base + i * 86400000).toISOString().slice(0, 10);
        const mio = days.dias[dia]?.min || 0;
        comparados++;
        if (Math.abs(mio - D.min[i]) > TOL + 1e-9) {
          difieren++;
          if (detalle.length < 8) detalle.push(`${dia}: Python ${D.min[i]} · acumulador JS ${mio}`);
        }
      }
    }
    console.log(`  · PUERTA 1 (real): ${comparados} días comparados contra gen-stats.py, ${difieren} difieren`);
    af(difieren === 0,
      `PUERTA 1 (real): ${difieren} de ${comparados} días NO cuadran con el JSON del Python.\n` +
      detalle.map(d => '      ' + d).join('\n'));

    // Y los totales, que son la otra cara de lo mismo.
    let crudas = 0, validas = 0, saltos = 0;
    for (const d of Object.values(days.dias)) { crudas += d.crudas; validas += d.validas; saltos += d.saltos; }
    igual(crudas, stats.totals.plays_raw, 'PUERTA 2 (real): las crudas dan `totals.plays_raw`');
    igual(validas, stats.totals.plays_valid, 'PUERTA 2 (real): las válidas dan `totals.plays_valid` (104.147)');
    igual(Math.round(saltos / Math.max(1, crudas) * 1000) / 10, stats.totals.skip_pct,
      'PUERTA 2 (real): los saltos dan `totals.skip_pct` (64,1)');
    igual(Object.values(days.dias).filter(d => d.min > 0).length, stats.totals.days_active,
      'PUERTA 1 (real): los días con minutos dan `totals.days_active` (1.856)');

    // El tope de la condición de parada del encargo, afirmado y no supuesto.
    const mb = JSON.stringify(days).length / 1048576;
    console.log(`  · el payload real pesa ${mb.toFixed(2)} MB serializado`);
    af(mb < 50, `el payload serializado tiene que quedar por debajo de 50 MB (vino ${mb.toFixed(2)})`);
  }
}

if (fallos.length) {
  console.error(`\n✗ calendario-dias: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts`);
