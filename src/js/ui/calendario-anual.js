// El calendario anual tipo GitHub, compartido por DOS vistas (v=289).
//
// ═══════════════════════════════════════════════════════════════════════════
// POR QUÉ ESTE ARCHIVO EXISTE
// ═══════════════════════════════════════════════════════════════════════════
//
// Hasta v=288 este calendario era `visualCalendario()`, privado de
// `features/wrapped-apertura.js` (el paso «Días con música» de la apertura del
// Wrapped). La vista `#calendario` necesita el MISMO dibujo, y la alternativa
// era copiarlo. No hay que buscar muy lejos para saber cómo termina eso: en
// este repo hay un resolutor de álbum que se escribió dos veces y divergió
// (v=219), un formateador de fechas que se copió y fue la copia la que mintió
// durante 27 versiones (v=231), y cuatro formateadores decimales privados
// anotados en `PENDIENTES.md`. Una sola definición.
//
// ───────────────────────────────────────────────────────────────────────────
// LA REGLA DURA: SIN OPCIONES, LA SALIDA ES IDÉNTICA BYTE A BYTE
// ───────────────────────────────────────────────────────────────────────────
//
// `calendarioAnual(D, iPico, ctx)` —sin el cuarto argumento— devuelve
// EXACTAMENTE la misma cadena que devolvía `visualCalendario()` en v=288,
// clases `.wr-ap-*` incluidas. Eso NO es pereza de nomenclatura: es lo que
// permite comprobar que la apertura del Wrapped no cambió, comparando contra
// una referencia generada con el código viejo
// (`tests/fixtures/calendario-apertura-{2025,2018}.html`, generados ANTES de
// la extracción). La referencia **no se regenera nunca** con el código nuevo:
// si el test se pone rojo se arregla el código.
//
// Por el mismo motivo las clases **no se renombran**. El look se comparte; la
// identidad no (la regla de `.wt-play-btn`, v=219): `#calendario` pide
// `claseContenedor: 'cal-anual'` y sus estilos cuelgan de ESA clase, sin
// redefinir ninguna regla de `.wr-ap-*` desde su hoja.
//
// ───────────────────────────────────────────────────────────────────────────
// LOS FORMATEADORES LLEGAN POR `ctx`, Y ES A PROPÓSITO
//
// `ctx.fmtDia` (de `util/fecha.js`) y `ctx.fmtMinutes` (de `features/wrapped.js`)
// no se importan acá por la misma razón que `wrapped-apertura.js` no los
// importa: escribir una copia del formateo de fechas es reintroducir el bug de
// v=154/v=231 por la puerta de atrás. `ctx.MESES_LARGOS || ctx.MESES` para los
// nombres de mes.

// Cuántas columnas tienen que separar el rótulo del primer mes (cuando el tramo no arranca un
// día 1) del siguiente. Medido a 1.366 px con la letra Inter ya cargada: ver tanda 39.
const MIN_COLS_PRIMER_MES = 2;

// ── utilidades de fecha, todas en UTC ───────────────────────────────────────
//
// Un "YYYY-MM-DD" es un DÍA del calendario, no un instante: pasarlo por
// `new Date()` lo pone a medianoche UTC y leerlo en local lo corre un día para
// atrás en cualquier huso negativo. Es el bug de v=154. Acá nunca se sale de
// UTC: se entra con `Date.UTC` y se lee con `getUTC*`.
export function aMs(iso) {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
}
export function isoDesde(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
/** 0 = lunes, igual que `weekday()` de Python y que el heatmap del pipeline. */
export function diaSemanaLunes(iso) {
  return (new Date(aMs(iso)).getUTCDay() + 6) % 7;
}

/** Un día de `days.min` como ISO, sin construir fechas locales. */
export function isoDelDia(D, i) {
  return isoDesde(aMs(D.from) + i * 86400000);
}

/** El último día que cubre un tramo `days` (`from + min.length − 1`). */
export function ultimoDiaDelTramo(D) {
  return isoDelDia(D, D.min.length - 1);
}

function mes(ctx, i) {
  // Los meses van ENTEROS: «enero», no «ene». El ancho está medido — ver la
  // clase `.ancho` en `css/main.css`. El `||` es por si llega un `ctx` de una
  // versión vieja de `wrapped.js`: antes que tirar, abrevia.
  return (ctx.MESES_LARGOS || ctx.MESES)[i];
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/**
 * Los TERCILES se calculan sobre los días ACTIVOS de ESTE año, no con
 * umbrales fijos: con umbrales fijos, 2018 (68 días, mucho menos volumen) se
 * vería entero del tono más flojo y 2025 entero del más fuerte, y el gradiente
 * dejaría de decir nada dentro de cada año.
 */
export function tercilesDelTramo(D) {
  const activos = D.min.filter(v => v > 0).sort((a, b) => a - b);
  const t1 = activos[Math.floor(activos.length / 3)] || 0;
  const t2 = activos[Math.floor(activos.length * 2 / 3)] || 0;
  return { t1, t2, nivel: v => (v === 0 ? 0 : v < t1 ? 1 : v < t2 ? 2 : 3) };
}

/**
 * El calendario anual, como cadena de HTML.
 *
 * @param {{from: string, min: number[]}} D   el tramo de `years[].days`
 * @param {number} iPico                      índice del día pico (borde marcado)
 * @param {object} ctx                        `{ fmtDia, fmtMinutes, MESES_LARGOS|MESES }`
 * @param {object} [op]                       opciones; SIN ellas la salida es la de v=288
 * @param {string} [op.claseContenedor]       clase extra en el `.wr-ap-visual`
 * @param {boolean} [op.tocables]             celdas enfocables y abribles (tarea 2)
 * @param {number} [op.diaMarcado]            índice del día elegido, con marca propia
 */
export function calendarioAnual(D, iPico, ctx, op = {}) {
  const { t1, t2, nivel } = tercilesDelTramo(D);

  const offset = diaSemanaLunes(D.from);
  const semanas = Math.ceil((offset + D.min.length) / 7);

  let celdas = '';
  for (let h = 0; h < offset; h++) celdas += '<i class="hueco" aria-hidden="true"></i>';
  for (let i = 0; i < D.min.length; i++) {
    const n = nivel(D.min[i]);
    const iso = isoDesde(aMs(D.from) + i * 86400000);
    const texto = `${ctx.fmtDia(iso)} · ${D.min[i] > 0 ? ctx.fmtMinutes(D.min[i]) : 'nada'}`;
    let clases = `${n ? 'n' + n : ''}${i === iPico ? ' pico' : ''}`;
    if (op.tocables) {
      // Un solo `tabindex="0"` en toda la grilla: Tab entra UNA vez y de ahí
      // en adelante manda el teclado de la vista (←→↑↓). Con un tabindex por
      // celda, salir del calendario con Tab costaría 365 pulsaciones.
      const marcado = op.diaMarcado === i;
      if (marcado) clases += ' elegido';
      celdas += `<i class="${clases}" title="${esc(texto)}" role="gridcell" ` +
                `data-dia="${i}" data-iso="${iso}" tabindex="${marcado ? 0 : -1}" ` +
                `aria-label="${esc(texto)}"${marcado ? ' aria-selected="true"' : ''}></i>`;
    } else {
      celdas += `<i class="${clases}" ` +
                `title="${ctx.fmtDia(iso)} · ${D.min[i] > 0 ? ctx.fmtMinutes(D.min[i]) : 'nada'}"></i>`;
    }
  }

  // Una etiqueta por mes, en la columna donde cae su día 1. Van sobre las
  // MISMAS columnas que la rejilla.
  //
  // ⚠️ Eso es lo que el CSS TIENE que garantizar, y hasta v=243 no lo hacía: el
  // `1fr` de la fila de meses trae un `min-width: auto`, así que cada etiqueta
  // ensanchaba su propia columna y corría a las de su derecha. MEDIDO en
  // producción v=243, 2025 a 1366px: la etiqueta peor puesta caía **13,8 px**
  // fuera de su semana, más de una columna entera (12,52 px) — y eso YA
  // pasaba con «ene», antes de alargar ningún nombre. El arreglo es
  // `minmax(0, 1fr)` en `css/main.css`; con él el desfase máximo baja a 0,3 px.
  const etiquetas = new Array(semanas).fill('');
  for (let i = 0; i < D.min.length; i++) {
    const ms = aMs(D.from) + i * 86400000;
    const f = new Date(ms);
    if (f.getUTCDate() === 1) etiquetas[Math.floor((offset + i) / 7)] = mes(ctx, f.getUTCMonth());
  }

  // ── El mes con el que ARRANCA la grilla (v=290) ───────────────────────────────────────────
  //
  // «Una etiqueta solo se pone donde cae el día 1 de un mes» dejaba sin rótulo a un tramo que
  // NO empieza un día 1: 2018 arranca el 15/08 y la primera columna —agosto— quedaba muda, con
  // septiembre, octubre, noviembre y diciembre rotulados a su derecha. Vale para cualquier año
  // parcial, no solo 2018, y por eso se arregla acá y no en cada vista.
  //
  // El criterio (decidido, no calibrado a ojo): el mes de `D.from` se rotula en la columna 0 si
  // hay AL MENOS `MIN_COLS_PRIMER_MES` columnas hasta la siguiente etiqueta. Por debajo, el mes
  // visible es de menos de dos semanas y su rótulo se pisaría con el siguiente: no se rotula.
  // Si no hay siguiente etiqueta (un tramo que no llega al mes que viene) no hay con qué
  // pisarse y se rotula. Un tramo que ya empieza el día 1 trae su etiqueta en la columna 0 y
  // no entra por acá, así que los años completos salen idénticos byte a byte a v=289.
  if (!etiquetas[0]) {
    const siguiente = etiquetas.findIndex((e, c) => c > 0 && e);
    if (siguiente === -1 || siguiente >= MIN_COLS_PRIMER_MES) {
      etiquetas[0] = mes(ctx, new Date(aMs(D.from)).getUTCMonth());
    }
  }

  const muestra = (n) => `<i class="wr-ap-leg-c ${n}"></i>`;
  const clase = `wr-ap-visual ancho${op.claseContenedor ? ' ' + op.claseContenedor : ''}`;
  const rejilla = op.tocables
    ? `<div class="wr-ap-cal" role="grid" aria-label="Calendario de escucha">${celdas}</div>`
    : `<div class="wr-ap-cal">${celdas}</div>`;
  return `<div class="${clase}" style="--semanas:${semanas}">
    <div class="wr-ap-cal-meses">${etiquetas.map(e => `<span>${e}</span>`).join('')}</div>
    ${rejilla}
    <div class="wr-ap-leyenda">
      <span class="wr-ap-leg">${muestra('n0')}Nada</span>
      <span class="wr-ap-leg">${muestra('n1')}Hasta ${ctx.fmtMinutes(t1)}</span>
      <span class="wr-ap-leg">${muestra('n2')}Hasta ${ctx.fmtMinutes(t2)}</span>
      <span class="wr-ap-leg">${muestra('n3')}Más de ${ctx.fmtMinutes(t2)}</span>
    </div>
  </div>`;
}
