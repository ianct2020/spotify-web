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
//     🟩 **Y desde v=291 `years[].skip_pct` es ESA MISMA cuenta, año por año.**
//     Hasta v=290 el pipeline tenía dos definiciones con el mismo nombre: la de
//     `totals` y otra para `years[]` (`fwdbtn || skipped` solo entre las plays
//     de ≥30 s, dividido por `plays + skipped`, con los saltos sumados dos
//     veces), y esta suite afirmaba LAS DOS para que nadie «arreglara» el
//     acumulador persiguiendo el número equivocado. Medido el 10/10 sobre el
//     export real: 2023 daba 34,7 % con aquélla y **74,9 %** con ésta.
//     La tanda 40 dejó una sola, y ahora la suite afirma que las dos cuentas
//     **coinciden**: la suma de `saltos` de los días de cada año sobre sus
//     `crudas` da EXACTO el `years[].skip_pct` de ese año, y además sus
//     `skips` y su `plays_raw`. No hay ningún número viejo que reproducir.
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

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let ok = 0;
const fallos = [];
const af = (c, m) => { if (c) ok++; else fallos.push(m); };
const igual = (a, b, m) => af(a === b, `${m}: esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`);

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
  // v=296 (tanda 44): un `fwdbtn` CORTO más, con uri y que no es basura, solo en su día (el
  // 07/03, para no mover los asserts de los otros días). Es lo que hace que la PUERTA 2 vuelva a
  // separar las tres fórmulas de salto (la cuenta, en la sección 4).
  play('2025-03-07T08:00:00Z', A, 5000, { reason_end: 'fwdbtn' }),
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
const resultado = await processStreamingHistory(fileArrays);
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
  const otra = await processStreamingHistory(fileArrays);
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
// 4 · PUERTA 2 · los saltos: UNA sola definición, en el total y en cada año
// ═══════════════════════════════════════════════════════════════════════════
{
  let saltos = 0, crudas = 0;
  for (const d of Object.values(resultado.days.dias)) { saltos += d.saltos; crudas += d.crudas; }
  // v=295: las crudas de los días SIGUEN contando la basura funcional (son el «N saltadas de
  // M» del panel del día, y `#calendario` no se tocó); lo que cambió es el divisor de
  // `skip_pct`, que ahora les resta `plays_junk`. Así que los días se comparan como
  // saltos / (crudas − plays_junk), con el `plays_junk` que trae `stats`.
  igual(crudas, resultado.stats.totals.plays_raw, 'PUERTA 2: las crudas de los días dan `totals.plays_raw` (con la basura dentro)');
  const pct = Math.round(saltos / Math.max(1, crudas - resultado.stats.totals.plays_junk) * 1000) / 10;
  igual(pct, resultado.stats.totals.skip_pct,
    'PUERTA 2: la suma de saltos sobre (crudas − `totals.plays_junk`) da `totals.skip_pct` EXACTO');

  // Desde v=291 hay UNA sola definición de salto: `years[].skip_pct` es la misma
  // cuenta que `totals.skip_pct`, partida por año. Se afirma año por año contra
  // el detalle por día, que es una implementación aparte (`crearAcumuladorDeDias`).
  const porAnio = new Map();
  for (const [dia, d] of Object.entries(resultado.days.dias)) {
    const y = +dia.slice(0, 4);
    let b = porAnio.get(y); if (!b) { b = { saltos: 0, crudas: 0 }; porAnio.set(y, b); }
    b.saltos += d.saltos; b.crudas += d.crudas;
  }
  af(resultado.stats.years.length >= 2, 'el fixture tiene al menos dos años');
  for (const y of resultado.stats.years) {
    const b = porAnio.get(y.year) || { saltos: 0, crudas: 0 };
    igual(b.crudas, y.plays_raw, `PUERTA 2: ${y.year} · las crudas de sus días dan \`years[].plays_raw\``);
    igual(b.saltos, y.skips, `PUERTA 2: ${y.year} · los saltos de sus días dan \`years[].skips\``);
    igual(Math.round(b.saltos / Math.max(1, b.crudas - y.plays_junk) * 1000) / 10, y.skip_pct,
      `PUERTA 2: ${y.year} · saltos/(crudas − plays_junk) de sus días da \`years[].skip_pct\` EXACTO (una sola definición)`);
  }
  // Y que el fixture distingue de verdad las TRES fórmulas de salto. 2025, contado a mano (v=296,
  // tanda 44, escrito ANTES de correrlo). Hasta v=295 el fixture no traía la play del 07/03 y su
  // 2025 daba 28,6, que coincidía por casualidad con la fórmula de hasta v=290: no la distinguía.
  //
  //   play                          ms       reason_end  skipped  cruda  basura  válida(≥30s)  salto v=291+  yb.skipped (≤v=290)
  //   04/03 10:00 B                 240.000  trackdone   no       sí     no      sí            no            no
  //   04/03 10:05 A                 180.000  trackdone   no       sí     no      sí            no            no
  //   04/03 18:00 B                 120.000  trackdone   no       sí     no      sí            no            no
  //   04/03 18:10 C                  12.000  trackdone   no       sí     no      no            no            —  (corta)
  //   05/03 09:00 A                   8.000  fwdbtn      no       sí     no      no            SÍ (fwd <30s) —  (corta)
  //   05/03 09:10 A                 200.000  fwdbtn      no       sí     no      sí            no (fwd ≥30s) SÍ
  //   05/03 09:20 B                  95.000  trackdone   SÍ       sí     no      sí            SÍ (skipped)  SÍ
  //   05/03 10:00 podcast (sin uri) 900.000  trackdone   no       NO     —       —             —             —
  //   06/03 11:00 C «sacar agua»    600.000  trackdone   no       sí     SÍ      no (basura)   no (basura)   —  (basura)
  //   07/03 08:00 A  ← NUEVA          5.000  fwdbtn      no       sí     no      no            SÍ (fwd <30s) —  (corta)
  //   (la duplicada del archivo 2 no cuenta)
  //   Σ                                                            9      1       5             3             2
  //
  //   v=295 en adelante: skips / (crudas − basura) = 3 / (9 − 1) = 3 / 8 = 37,5
  //   v=291 a v=294:     skips / crudas             = 3 / 9           = 33,3
  //   hasta v=290:       yb.skipped / (válidas + yb.skipped) = 2 / (5 + 2) = 28,6
  //                      (la play nueva es corta: no entra en `yb`, por eso esta fórmula no se mueve)
  const a2025 = resultado.stats.years.find(y => y.year === 2025);
  igual(a2025.plays_raw, 9, 'PUERTA 2: 2025 tiene 9 crudas (la basura sigue siendo una cruda; el podcast y la duplicada, no)');
  igual(a2025.plays_junk, 1, 'PUERTA 2: 2025 tiene 1 de basura, contada aparte');
  igual(a2025.skips, 3, 'PUERTA 2: 2025 tiene 3 saltos (los dos fwdbtn cortos y el skipped), no 4: el fwdbtn largo no es salto');
  igual(a2025.skip_pct, 37.5, 'PUERTA 2: 2025 · 3 de (9 − 1) = 37,5 — y no el 33,3 de v=291-294 (basura en el divisor) ni el 28,6 de hasta v=290 (2 / (5 + 2))');
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · PUERTA 1 (real) · contra el `history-stats.json` que horneó el PYTHON
// ═══════════════════════════════════════════════════════════════════════════
//
// Es la comparación que de verdad importa: el puerto JS nuevo contra
// `gen-stats.py`. Necesita el export de Ian en disco, que está gitignoreado,
// así que en otra máquina se SALTA — y lo dice, porque un paso que se saltea en
// silencio es peor que uno que falta.
//
// 🔴 Desde v=316 (tanda 65) corre SOLO A PEDIDO: con `FONOTECA_LEER_EXPORT=1` en el
// entorno. Sin la variable no mira el disco (ni un `existsSync` de esa ruta): un
// `npm test` cualquiera no puede abrir el export de Ian (la tanda 64 lo pisó una vez).
// Lo vigila `tests/export-a-pedido.test.mjs`.

// La puerta del total de la PUERTA 2 real: saltos / (crudas − basura), redondeado, = `totals.skip_pct`.
// Tanda 85: que distingue los dos divisores se afirma acá, con un caso INVENTADO que corre siempre
// (no depende de cómo redondee el export): 400 saltos sobre 1.000 crudas con 100 de basura dan
// 44,4 con el divisor nuevo y 40,0 con el viejo.
const puertaSkipTotal = (saltos, crudas, basura, skipPct) =>
  Math.round(saltos / Math.max(1, crudas - basura) * 1000) / 10 === skipPct;
igual(puertaSkipTotal(400, 1000, 100, 44.4), true, 'PUERTA 2 (INVENTADO): el total horneado con el divisor nuevo (400 / 900 = 44,4) pasa la puerta');
igual(puertaSkipTotal(400, 1000, 100, 40.0), false, 'PUERTA 2 (INVENTADO): y el horneado con el divisor viejo (400 / 1.000 = 40,0) NO la pasa: la puerta distingue los dos divisores');

if (process.env.FONOTECA_LEER_EXPORT !== '1') {
  console.log('  · PUERTA 1 (real): SALTADA — sin FONOTECA_LEER_EXPORT=1');
} else {
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
    // v=295: las crudas de los días siguen dando `plays_raw` (arriba, sin tocar); el
    // porcentaje se compara sobre crudas − `plays_junk`, con el `plays_junk` del JSON.
    igual(puertaSkipTotal(saltos, crudas, stats.totals.plays_junk, stats.totals.skip_pct), true,
      'PUERTA 2 (real): los saltos, sobre crudas − `totals.plays_junk`, dan `totals.skip_pct`');
    // Tanda 85: hasta acá se afirmaba que sobre las crudas enteras, REDONDEADO, NO daba el total;
    // con el export nuevo los dos divisores redondean a lo mismo. Se comparan sin redondear, y que
    // la puerta distingue los dos divisores lo afirma el caso INVENTADO de arriba de este bloque.
    const nuevo = saltos / Math.max(1, crudas - stats.totals.plays_junk), viejo = saltos / Math.max(1, crudas);
    af(stats.totals.plays_junk > 0 && nuevo > viejo,
      `PUERTA 2 (real): sin redondear, el divisor nuevo y el viejo dan cocientes distintos (vino ${(nuevo * 100).toFixed(3)} contra ${(viejo * 100).toFixed(3)})`);
    // Y año por año, contra el JSON que horneó el Python (v=291: una sola definición).
    const realPorAnio = new Map();
    for (const [dia, d] of Object.entries(days.dias)) {
      const y = +dia.slice(0, 4);
      let b = realPorAnio.get(y); if (!b) { b = { saltos: 0, crudas: 0 }; realPorAnio.set(y, b); }
      b.saltos += d.saltos; b.crudas += d.crudas;
    }
    for (const y of stats.years) {
      const b = realPorAnio.get(y.year) || { saltos: 0, crudas: 0 };
      af(b.crudas === y.plays_raw && b.saltos === y.skips &&
         Math.round(b.saltos / Math.max(1, b.crudas - y.plays_junk) * 1000) / 10 === y.skip_pct,
        `PUERTA 2 (real): ${y.year} · los días dan ${b.saltos}/(${b.crudas} − ${y.plays_junk}) y el JSON del Python dice ` +
        `${y.skips}/(${y.plays_raw} − ${y.plays_junk}) = ${y.skip_pct}`);
    }
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
