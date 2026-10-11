// La extracción del calendario no cambió la apertura del Wrapped (v=289).
//
// ═══════════════════════════════════════════════════════════════════════════
// LA PUERTA, Y POR QUÉ ES BYTE A BYTE
// ═══════════════════════════════════════════════════════════════════════════
//
// `visualCalendario()` era privada de `features/wrapped-apertura.js`. En v=289
// se mudó a `ui/calendario-anual.js` para que `#calendario` use la MISMA pieza
// en vez de una copia (la lección del resolutor de álbum de v=219 y del
// `fmtDate()` de v=231: la copia es la que miente).
//
// Las referencias de `tests/fixtures/calendario-apertura-{2025,2018}.html` se
// generaron **con el código de v=288, ANTES de tocar `wrapped-apertura.js`**,
// sobre el `history-stats.json` real del repo.
//
// ⚠️ **LA REFERENCIA NO SE REGENERA NUNCA CON EL CÓDIGO NUEVO.** Si esta suite
// se pone roja, lo que está mal es el código. Regenerar el fixture para que
// pase convierte la puerta en un sello de goma: diría «no cambió» comparando
// lo nuevo contra lo nuevo.
//
// Dos años y no uno, a propósito: **2025** es un año completo que arranca en
// miércoles (offset 2, 371 `<i>`) y **2018** es PARCIAL, desde el 15/08
// (offset 2, 139 días). Un bug en el `offset` o en la cuenta de semanas se ve
// en uno de los dos.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { calendarioAnual, aMs, isoDesde, diaSemanaLunes, ultimoDiaDelTramo, tercilesDelTramo }
  from '../src/js/ui/calendario-anual.js';
import { fmtDia } from '../src/js/util/fecha.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');

let ok = 0;
const fallos = [];
function af(cond, msg) {
  if (cond) ok++;
  else fallos.push(msg);
}
function igual(a, b, msg) {
  af(a === b, `${msg}: esperaba ${JSON.stringify(b)} y vino ${JSON.stringify(a)}`);
}

// ── el `ctx` real: los MISMOS formateadores que le pasa `wrapped.js` ────────
//
// `fmtMinutes` se copia acá a propósito y es la única copia que este archivo
// tiene derecho a tener: es el doble del productor, no un segundo productor.
// Si `wrapped.js` cambiara el suyo, la referencia dejaría de cuadrar y esta
// suite se pondría roja — que es justo lo que se quiere saber.
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
const ctx = { MESES, MESES_LARGOS, fmtMinutes, fmtDia };

const stats = JSON.parse(readFileSync(join(raiz, 'src/data/history-stats.json'), 'utf8'));
function tramo(anio) {
  const y = stats.years.find(yy => yy.year === anio);
  af(!!y, `el JSON real tiene el año ${anio}`);
  return y.days;
}
function picoDe(D) {
  return D.min.reduce((mejor, v, i) => (v > D.min[mejor] ? i : mejor), 0);
}

// ── 1 · byte a byte contra la referencia de v=288 ───────────────────────────
for (const anio of [2025, 2018]) {
  const D = tramo(anio);
  const esperado = readFileSync(join(raiz, `tests/fixtures/calendario-apertura-${anio}.html`), 'utf8');
  const salida = calendarioAnual(D, picoDe(D), ctx);
  if (salida === esperado) {
    ok++;
  } else {
    // Que el fallo diga DÓNDE, no solo que son distintos: con 18 KB de HTML,
    // «no son iguales» no sirve para arreglar nada.
    let i = 0;
    while (i < salida.length && i < esperado.length && salida[i] === esperado[i]) i++;
    fallos.push(`el calendario de ${anio} NO es byte a byte el de v=288. ` +
      `Primer byte distinto en ${i} (de ${esperado.length} esperados, ${salida.length} emitidos).\n` +
      `  esperaba: …${JSON.stringify(esperado.slice(Math.max(0, i - 40), i + 40))}\n` +
      `  vino:     …${JSON.stringify(salida.slice(Math.max(0, i - 40), i + 40))}`);
  }
}

// ── 2 · sin opciones NO aparece nada de la vista nueva ──────────────────────
//
// Es la otra mitad de lo de arriba: una opción con el defecto mal puesto
// pasaría el byte a byte de un año y ensuciaría el otro. Acá se afirma la
// ausencia por nombre.
{
  const D = tramo(2025);
  const salida = calendarioAnual(D, picoDe(D), ctx);
  for (const marca of ['cal-anual', 'data-dia', 'data-iso', 'tabindex', 'role="grid"',
                       'aria-label="Calendario', 'aria-selected', ' elegido']) {
    af(!salida.includes(marca), `sin opciones, la salida no puede traer «${marca}»`);
  }
  af(salida.startsWith('<div class="wr-ap-visual ancho" style="--semanas:'),
    'sin opciones, el contenedor es exactamente el de la apertura');
}

// ── 3 · las opciones son ADITIVAS y no se pisan entre sí ────────────────────
{
  const D = tramo(2025);
  const iPico = picoDe(D);
  const conClase = calendarioAnual(D, iPico, ctx, { claseContenedor: 'cal-anual' });
  af(conClase.startsWith('<div class="wr-ap-visual ancho cal-anual" '),
    'la clase propia se SUMA a las de la apertura, no las reemplaza');
  igual((conClase.match(/<i /g) || []).length, (calendarioAnual(D, iPico, ctx).match(/<i /g) || []).length,
    'la clase propia no cambia el número de celdas');

  const tocable = calendarioAnual(D, iPico, ctx, { claseContenedor: 'cal-anual', tocables: true, diaMarcado: 10 });
  af(tocable.includes('role="grid"'), 'con `tocables` la rejilla es un grid accesible');
  igual((tocable.match(/data-dia="/g) || []).length, D.min.length,
    'hay una celda con `data-dia` por cada día del tramo (los huecos no cuentan)');
  // UN SOLO tabindex=0 en toda la grilla: con uno por celda, salir del
  // calendario con Tab costaría 365 pulsaciones.
  igual((tocable.match(/tabindex="0"/g) || []).length, 1,
    'solo el día elegido es alcanzable con Tab');
  igual((tocable.match(/tabindex="-1"/g) || []).length, D.min.length - 1,
    'el resto de los días se alcanza con las flechas, no con Tab');
  af(tocable.includes('data-iso="2025-01-11"'),
    'el día marcado 10 de 2025 es el 11 de enero (0-indexado desde days.from)');
  af(tocable.includes(' elegido" title="11 ene 2025'), 'el día elegido lleva su marca propia');
  af(tocable.includes('aria-selected="true"'), 'y queda anunciado como seleccionado');
  igual((tocable.match(/aria-selected/g) || []).length, 1, 'un solo día seleccionado');
  // Cada celda tiene que poder decir qué día es y cuántos minutos: sin eso el
  // calendario es inusable sin ratón.
  // Ojo al contar: el `aria-label` de la REJILLA también matchea, así que se
  // cuentan solo los que van detrás del `tabindex` de una celda.
  igual((tocable.match(/tabindex="-?[01]" aria-label="/g) || []).length, D.min.length,
    'cada día lleva su `aria-label` con fecha y minutos');
}

// ── 4 · los huecos del arranque son el día de la semana de verdad ───────────
{
  // 2025-01-01 fue MIÉRCOLES → 2 huecos (lunes y martes).
  igual(diaSemanaLunes('2025-01-01'), 2, '2025 arranca en miércoles (0 = lunes)');
  igual(diaSemanaLunes('2018-08-15'), 2, '2018-08-15 también fue miércoles');
  const D = tramo(2025);
  const salida = calendarioAnual(D, picoDe(D), ctx);
  igual((salida.match(/class="hueco"/g) || []).length, 2, '2025 lleva exactamente 2 huecos');
  // 365 días + 2 huecos = 367 celdas → 53 columnas (367/7 = 52,43)
  af(salida.includes('--semanas:53'), '2025 ocupa 53 columnas');
  const D18 = tramo(2018);
  af(calendarioAnual(D18, picoDe(D18), ctx).includes('--semanas:21'),
    '2018 parcial (139 días desde el 15/08) ocupa 21 columnas');
}

// ── 5 · las utilidades de fecha NO salen de UTC ─────────────────────────────
//
// El bug de v=154 solo se ve con `TZ` en un huso negativo: en una máquina en
// UTC estas cuatro afirmaciones pasan incluso con el código roto. El
// `correr-tests.mjs` no fija `TZ`, así que la suite lo comprueba y lo dice.
{
  igual(isoDesde(aMs('2026-01-09')), '2026-01-09', 'ida y vuelta por UTC no mueve el día');
  igual(isoDesde(aMs('2018-08-15') + 138 * 86400000), '2018-12-31', '139 días desde el 15/08/2018 llegan al 31/12');
  igual(ultimoDiaDelTramo({ from: '2026-01-01', min: new Array(239).fill(0) }), '2026-08-27',
    'el último día de 2026 es el 27 de agosto, donde termina el export');
  // El día pico de 2025 tal cual lo dice el JSON, resuelto por índice.
  const D = tramo(2025);
  const y = stats.years.find(yy => yy.year === 2025);
  igual(isoDesde(aMs(D.from) + picoDe(D) * 86400000), y.peak_day.date,
    'el pico que sale del índice de `days.min` es el `peak_day` del pipeline');
}

// ── 6 · los terciles son del año, no fijos ─────────────────────────────────
{
  const a = tercilesDelTramo(tramo(2025));
  const b = tercilesDelTramo(tramo(2018));
  af(a.t1 > 0 && a.t2 > a.t1, 'los dos cortes de 2025 están ordenados y no son cero');
  af(b.t1 !== a.t1 || b.t2 !== a.t2,
    'dos años distintos NO comparten umbrales: si los compartieran, el gradiente dejaría de decir nada dentro de cada año');
  igual(a.nivel(0), 0, 'un día sin música es nivel 0');
  igual(a.nivel(a.t2 + 1), 3, 'por encima del segundo tercil es nivel 3');
  igual(a.nivel(a.t1), 2, 'el corte es exclusivo por abajo (`v < t1` es nivel 1)');
}

// ── salida ─────────────────────────────────────────────────────────────────
if (fallos.length) {
  console.error(`\n✗ calendario-anual: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts`);
