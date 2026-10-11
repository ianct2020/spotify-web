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
import { createHash } from 'node:crypto';
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
//
// Solo 2025. **2018 salió de acá en v=290** (tanda 39): el año que arranca el 15/08 ahora lleva
// el rótulo «agosto» que antes no tenía, así que ya NO es byte a byte la de v=288 — la sección 7
// comprueba que lo ÚNICO que cambió es esa etiqueta. La referencia de 2018 no se tocó.
for (const anio of [2025]) {
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

// ── 7 · 2018 (el año parcial): la ÚNICA diferencia con v=288 es la etiqueta nueva ─────────────
//
// En v=290 el mes con el que ARRANCA la grilla se rotula en la columna 0 si hay al menos 2
// columnas hasta la siguiente etiqueta (ver `calendarioAnual`). 2018 empieza el 15/08 y
// «septiembre» cae en la columna 2: hasta v=289 la grilla arrancaba SIN rótulo y agosto no
// aparecía en ningún sitio.
//
// La comprobación es la misma que la de la sección 1, con un solo retoque: a la salida NUEVA se
// le quita esa etiqueta (`<span>agosto</span>` vuelve a ser `<span></span>`, que es lo que
// había) y lo que queda tiene que ser la referencia de v=288 BYTE A BYTE. Así «es solo la
// etiqueta» no es una frase sino una igualdad. La referencia NO se regenera.
const meses = (html) => [...html.match(/<div class="wr-ap-cal-meses">(.*?)<\/div>/s)[1].matchAll(/<span>(.*?)<\/span>/g)].map(m => m[1]);
{
  const D = tramo(2018);
  const esperado = readFileSync(join(raiz, 'tests/fixtures/calendario-apertura-2018.html'), 'utf8');
  const salida = calendarioAnual(D, picoDe(D), ctx);
  const ROTULO = '<div class="wr-ap-cal-meses"><span>agosto</span>';
  af(salida.includes(ROTULO), '2018 arranca el 15/08: la columna 0 lleva «agosto»');
  igual(meses(salida)[0], 'agosto', 'el primer rótulo de 2018 es agosto');
  igual(meses(salida).filter(Boolean).join(','), 'agosto,septiembre,octubre,noviembre,diciembre',
    '2018 rotula los CINCO meses que toca (antes solo cuatro: faltaba agosto)');
  const sinLa = salida.replace(ROTULO, '<div class="wr-ap-cal-meses"><span></span>');
  if (sinLa === esperado) ok++;
  else {
    let i = 0;
    while (i < sinLa.length && i < esperado.length && sinLa[i] === esperado[i]) i++;
    fallos.push(`2018 sin la etiqueta nueva NO es la referencia de v=288. Primer byte distinto en ${i}.\n` +
      `  esperaba: …${JSON.stringify(esperado.slice(Math.max(0, i - 40), i + 40))}\n` +
      `  vino:     …${JSON.stringify(sinLa.slice(Math.max(0, i - 40), i + 40))}`);
  }
}

// ── 8 · los tres casos del primer mes (y los dos bordes) ───────────────────────────────────
//
// Con series sintéticas, para que el caso no dependa de qué año tenga Ian en su export.
// `min` va en cero salvo un día: el rótulo no mira los minutos.
{
  const serie = (from, dias) => ({ from, min: Array.from({ length: dias }, (_, i) => (i % 3 === 0 ? 20 : 0)) });
  const rot = (from, dias) => meses(calendarioAnual(serie(from, dias), 0, ctx));
  const lista = (r) => r.map((e, i) => (e ? `${i}:${e}` : null)).filter(Boolean).join(' ');

  // Arranca el 15 (miércoles, 2 huecos). El 1 de septiembre cae en la columna 2 → ⇒ 2 columnas
  // de separación, que es JUSTO el mínimo: se rotula.
  igual(lista(rot('2018-08-15', 139)), '0:agosto 2:septiembre 7:octubre 11:noviembre 15:diciembre',
    'arranca el 15: se rotula el mes parcial (septiembre a 2 columnas, el mínimo)');
  // Arranca el DÍA 1: el rótulo ya salía en la columna 0 y no puede duplicarse ni moverse.
  igual(lista(rot('2026-04-01', 90)), '0:abril 4:mayo 9:junio',
    'arranca el día 1: el rótulo de siempre, una sola vez');
  // Arranca el 30 (jueves): el 1 de mayo es el día siguiente y cae en la columna 0 ⇒ el mes
  // parcial (un día) NO se rotula, y su etiqueta no se pisa con la de mayo.
  igual(lista(rot('2026-04-30', 60)), '0:mayo 5:junio',
    'arranca el 30: el mes parcial no se rotula');
  // Arranca el 26 (domingo, 6 huecos): el 1 de mayo cae en la columna 1 → 1 columna de separación,
  // por debajo del mínimo ⇒ tampoco se rotula abril.
  igual(lista(rot('2026-04-26', 60)), '1:mayo 6:junio',
    'arranca un día que deja la siguiente etiqueta en la columna 1: no se rotula');
  // Un tramo que no llega ni al mes siguiente: no hay «siguiente etiqueta» con la que pisarse.
  igual(lista(rot('2026-03-15', 10)), '0:marzo', 'un tramo de 10 días dentro de un mes se rotula con ese mes');
}

// ── 9 · 2019–2026 siguen idénticos byte a byte a lo que emitía v=289 ───────────────────────
//
// Son los años que empiezan un día 1: el rótulo nuevo no puede tocarlos NI UN BYTE. Solo hay
// fixtures HTML de 2018 y 2025; para el resto, el hash de la salida de v=289 (generado antes de
// tocar el código; ver `tests/fixtures/calendario-apertura-hashes.json`). Si alguno cambia, es un
// defecto del código nuevo — no un efecto esperado.
{
  const refs = JSON.parse(readFileSync(join(raiz, 'tests/fixtures/calendario-apertura-hashes.json'), 'utf8')).anios;
  for (const [anio, ref] of Object.entries(refs)) {
    const D = tramo(+anio);
    igual(D.from, ref.from, `${anio}: el tramo empieza donde empezaba`);
    const salida = calendarioAnual(D, picoDe(D), ctx);
    igual(createHash('sha256').update(salida).digest('hex'), ref.sha256,
      `${anio} (arranca el ${D.from}): el calendario sigue siendo BYTE A BYTE el de v=289`);
  }
}

// ── salida ─────────────────────────────────────────────────────────────────
if (fallos.length) {
  console.error(`\n✗ calendario-anual: ${fallos.length} fallo(s), ${ok} asserts ok\n`);
  for (const f of fallos) console.error('  · ' + f);
  process.exit(1);
}
console.log(`${ok} asserts`);
