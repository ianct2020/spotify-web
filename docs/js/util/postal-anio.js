// La postal del año «El año en días» (v=344, tanda 97; la de las tapas fue v=326-v=343): QUÉ dice y DÓNDE va
// cada cosa. PURO: sin DOM, sin red y sin lienzo, para probarlo en Node (`tests/postal-anio.test.mjs`). El
// dibujo y la descarga viven en `features/wrapped-postal.js`, que le pasa la función de medir con la letra ya
// puesta.
//
// ── Por qué una postal POR AÑO ──────────────────────────────────────────────
//
// Ian pidió «pngs para exportar, con metricas o cosas interesantes» (16/10) y no dijo de qué. Que sea
// una por año, en «Wrapped», es NUESTRA lectura del pedido. En la tanda 91 se probaron tres diseños como
// prototipos de banco e Ian eligió el B, «El año en días»: los doce meses hechos de días, coloreados por
// minutos. Es el que está acá.
//
// ── Lo que lleva, y lo que NO ───────────────────────────────────────────────
//
// Arriba, «EL AÑO EN DÍAS» (lo traía el prototipo y se dejó), el año y los minutos del año; en el medio, los
// doce meses («01 / ENERO»…), cada uno con sus días en columnas de lunes a domingo; abajo, la racha más larga
// y el día pico (la fecha y sus minutos) y «Fonoteca · <año>». Nada más: ni tapas, ni nombres.
//
//   · 🔴 El tono de cada día es el NIVEL del calendario: `tercilesDelTramo` de `ui/calendario-anual.js`,
//     IMPORTADA. La postal y el calendario pintan el mismo día con el mismo nivel; una copia de la regla
//     terminaría divergiendo (la lección de v=219 y v=231).
//   · Los días del año que el tramo `days` no cubre (antes del export, o después del último día) van con un
//     tono propio, «fuera»: no es lo mismo «no se registró» que «se registró y no sonó nada» (el nivel 0).
//     El día pico, si cae dentro del tramo, lleva un contorno de `--color-text`.
//   · 🔴 Las fechas, con el `fmtDia` que se le pasa (el de `util/fecha.js`): lee los diez primeros
//     caracteres y no construye un `Date`. Los días de la trama se cuentan en UTC (`aMs`,
//     `diaSemanaLunes`, también importadas): el 1/1 es el 1/1 en cualquier huso (el bug de v=231).
//   · Los minutos, con el `fmtMinutes` de `wrapped.js`, también pasado por contexto: si se copiara acá, la
//     copia es la que terminaría mintiendo. El prototipo traía una copia propia: no se llevó.
//   · 🔴 Los saltos NO van, ni el porcentaje ni la palabra (ver «La definición de salto» en CLAUDE.md): una
//     imagen que circula sola no puede llevar el aviso.
//
// ── Los colores y su contraste ──────────────────────────────────────────────
//
// `tonosPostal(colores)` arma los tonos con los colores del tema (ningún color a mano), con la MISMA mezcla
// que usaba el degradé de v=327 (`mezclar`, una sola en este archivo): el nivel 0 es la superficie hacia el
// fondo, del 1 al 3 el fondo hacia el acento (0,27 · 0,54 · 0,84), «fuera» el fondo hacia la superficie
// (0,48). Son los números del prototipo. `contrastePostal(plan, colores)` da, para cada texto, su contraste
// contra el punto PEOR de lo que tiene detrás: el fondo y cada día (con su contorno) que toque su caja. Con
// esta trama ningún texto pisa un día, así que el peor es el fondo; la cuenta es igual de general por si
// cambia. La fórmula es la de WCAG 2.x de `tests/tema-contraste.test.mjs`; el test la rehace por su lado.
//
// ── El recorte ──────────────────────────────────────────────────────────────
//
// Cada texto tiene un ancho máximo y se recorta con «…» MIDIENDO con la letra de verdad, nunca contando
// caracteres: «WWWW» y «iiii» no miden lo mismo. La medida entra inyectada.

import { aMs, diaSemanaLunes, tercilesDelTramo } from '../ui/calendario-anual.js?v=347';

export const ANCHO = 1080;
export const ALTO = 1350;
export const ELIPSIS = '…';

// La trama: tres meses por fila, cuatro filas. Cada mes, siete columnas (lunes a domingo) y hasta seis
// semanas. Las medidas son las del prototipo de la tanda 91B.
const X0 = 54;
const X1 = ANCHO - X0;             // 1026
const Y_TRAMA = 292;
const MES_W = 308, MES_H = 203, MES_SEP_X = 24, MES_SEP_Y = 19;
const DIA_W = 40, DIA_H = 23, PASO_X = 44, PASO_Y = 27;
const Y_DIAS = 34;                 // de la etiqueta del mes a la primera semana
const RADIO_DIA = 5;
const DIA_MS = 86400000;

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];

// Las letras: peso y tamaño. La familia la pone quien dibuja (la de la app, `--font-sans`).
const F = {
  marca: { peso: 600, tam: 19 },
  anio: { peso: 800, tam: 148 },
  min: { peso: 700, tam: 47 },
  minEt: { peso: 400, tam: 23 },
  mes: { peso: 700, tam: 19 },
  dato: { peso: 700, tam: 34 },
  datoEt: { peso: 400, tam: 20 },
  pie: { peso: 500, tam: 21 },
};
/** Los pesos que usa la postal, para esperar a que cargue la letra antes de medir. */
export const PESOS = [...new Set(Object.values(F).map((f) => f.peso))].sort((a, b) => a - b);

// El alto de la caja de un renglón: 1,25 veces el tamaño, con la línea de base arriba («top»), cabe la
// parte de abajo de la «g» y de la «p».
const altoDe = (f) => Math.ceil(f.tam * 1.25);
// El año y los minutos son dígitos, «h», «m» y «—»: sin nada que baje de la línea. Su caja es más justa.
const altoJusto = (f) => Math.ceil(f.tam * 0.95);
const numero = (v) => Number(v || 0);
const plural = (n, uno, varios) => (n === 1 ? uno : varios);
const dos = (n) => String(n).padStart(2, '0');

/**
 * El texto recortado para que `medir(texto) ≤ max`. Si entra, tal cual; si no, el prefijo más largo que
 * entra con «…» (sin dejar un espacio colgando antes); si ni el «…» entra, cadena vacía. Parte por
 * caracteres de verdad (`Array.from`), no por unidades de UTF-16: un emoji no queda partido al medio.
 */
export function recortar(texto, max, medir) {
  const s = texto == null ? '' : String(texto);
  if (!s) return '';
  if (medir(s) <= max) return s;
  if (!(medir(ELIPSIS) <= max)) return '';
  const cs = Array.from(s);
  const con = (k) => cs.slice(0, k).join('').trimEnd() + ELIPSIS;
  // El prefijo más largo que entra, por bisección (cuanto más largo, más mide).
  let lo = 0, hi = cs.length - 1;
  while (lo < hi) {
    const k = Math.ceil((lo + hi) / 2);
    if (medir(con(k)) <= max) lo = k; else hi = k - 1;
  }
  return con(lo);
}

/** Los textos de la postal de un año de `years[]`, sin posiciones. */
export function textosPostal(y, { fmtMinutes, fmtDia }) {
  const racha = numero(y.longest_streak);
  const pico = y.peak_day?.date;
  return {
    marca: 'EL AÑO EN DÍAS',
    anio: String(y.year),
    min: fmtMinutes(y.min),
    minEt: 'de música',
    meses: MESES.map((m, k) => `${dos(k + 1)} / ${m}`),
    racha: { valor: `${racha.toLocaleString('es-ES')} ${plural(racha, 'día', 'días')}`, etiqueta: 'racha más larga' },
    pico: { valor: pico ? fmtDia(pico) : '—', etiqueta: pico ? `día pico · ${fmtMinutes(y.peak_day.min)}` : 'día pico' },
    pie: `Fonoteca · ${y.year}`,
  };
}

/**
 * La postal entera: qué se dibuja y dónde. `medir(texto, fuente)` devuelve el ancho en px con esa
 * fuente (`{ peso, tam }`). Coordenadas del lienzo de 1080×1350; los textos con la línea de base arriba.
 *
 * Devuelve `{ ancho, alto, meses, celdas, textos }`:
 *   · `meses`: el recuadro de cada mes, `{ mes, x, y, w, h }` (la etiqueta y sus días van adentro);
 *   · `celdas`: un día del año cada una, `{ iso, i, mes, col, fila, x, y, w, h, radio, fuera, nivel, pico }`:
 *     `i` es su índice en `days.min` (−1 si el tramo no lo cubre), `fuera` si el tramo no lo cubre, `nivel`
 *     el de `tercilesDelTramo` (0 a 3; `null` si va fuera) y `pico` si lleva el contorno;
 *   · `textos`: `{ id, texto (ya recortado), x, y, max, alinear, fuente, alto, color: 'text'|'secondary',
 *     caja: { x, y, w, h } }` — `caja` es el lugar que tiene reservado.
 */
export function planPostal(y, { fmtMinutes, fmtDia, medir }) {
  const tx = textosPostal(y, { fmtMinutes, fmtDia });
  const textos = [], meses = [], celdas = [];
  const poner = (id, texto, { x, y: yy, max, fuente, color, alinear = 'left', justo = false }) => {
    const alto = justo ? altoJusto(fuente) : altoDe(fuente);
    const cx = alinear === 'left' ? x : alinear === 'right' ? x - max : x - max / 2;
    textos.push({ id, texto: recortar(texto, max, (s) => medir(s, fuente)), x, y: yy, max, alinear, fuente, alto, color, caja: { x: cx, y: yy, w: max, h: alto } });
  };

  // ── Arriba: la marca, el año y los minutos.
  poner('marca', tx.marca, { x: X0, y: 42, max: 500, fuente: F.marca, color: 'secondary' });
  poner('anio', tx.anio, { x: X0, y: 74, max: 520, fuente: F.anio, color: 'text', justo: true });
  poner('min', tx.min, { x: X1, y: 133, max: 430, fuente: F.min, color: 'text', alinear: 'right', justo: true });
  poner('min-et', tx.minEt, { x: X1, y: 194, max: 430, fuente: F.minEt, color: 'secondary', alinear: 'right' });

  // ── La trama. Sin `days` (o vacío), todos los días van «fuera»: la postal sale igual.
  const D = y.days && y.days.from && Array.isArray(y.days.min) && y.days.min.length ? y.days : null;
  const nivel = D ? tercilesDelTramo(D).nivel : null;
  const desde = D ? aMs(D.from) : 0;
  const pico = D && y.peak_day?.date ? String(y.peak_day.date).slice(0, 10) : null;
  const anio = Number(y.year);
  for (let mes = 0; mes < 12; mes++) {
    const x = X0 + (mes % 3) * (MES_W + MES_SEP_X);
    const yy = Y_TRAMA + Math.floor(mes / 3) * (MES_H + MES_SEP_Y);
    meses.push({ mes, x, y: yy, w: MES_W, h: MES_H });
    poner(`mes-${mes + 1}`, tx.meses[mes], { x, y: yy, max: MES_W, fuente: F.mes, color: 'secondary' });
    const offset = diaSemanaLunes(`${anio}-${dos(mes + 1)}-01`);
    const largo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
    for (let dia = 1; dia <= largo; dia++) {
      const iso = `${anio}-${dos(mes + 1)}-${dos(dia)}`;
      const k = offset + dia - 1, col = k % 7, fila = Math.floor(k / 7);
      const i = D ? Math.round((aMs(iso) - desde) / DIA_MS) : -1;
      const dentro = !!D && i >= 0 && i < D.min.length;
      celdas.push({
        iso, i: dentro ? i : -1, mes, col, fila,
        x: x + col * PASO_X, y: yy + Y_DIAS + fila * PASO_Y, w: DIA_W, h: DIA_H, radio: RADIO_DIA,
        fuera: !dentro, nivel: dentro ? nivel(D.min[i]) : null, pico: dentro && iso === pico,
      });
    }
  }

  // ── Abajo: la racha, el día pico y el pie.
  poner('racha', tx.racha.valor, { x: X0, y: 1200, max: 440, fuente: F.dato, color: 'text' });
  poner('racha-et', tx.racha.etiqueta, { x: X0, y: 1245, max: 440, fuente: F.datoEt, color: 'secondary' });
  poner('pico', tx.pico.valor, { x: 560, y: 1200, max: X1 - 560, fuente: F.dato, color: 'text' });
  poner('pico-et', tx.pico.etiqueta, { x: 560, y: 1245, max: X1 - 560, fuente: F.datoEt, color: 'secondary' });
  poner('pie', tx.pie, { x: ANCHO / 2, y: 1302, max: X1 - X0, fuente: F.pie, color: 'secondary', alinear: 'center' });
  return { ancho: ANCHO, alto: ALTO, meses, celdas, textos };
}

// ── Los colores ─────────────────────────────────────────────────────────────

/** El contraste que tiene que dar cada texto contra el punto peor detrás de su caja. AA pide 4,5: un poco
 *  de margen por el redondeo y el difuminado del lienzo. */
export const PISO_CONTRASTE = 4.6;
// Las mezclas del diseño B (tanda 91B): [de, hacia, cuánto].
const MEZCLA_NIVEL = [['surface', 'bg', 0.3], ['bg', 'accent', 0.27], ['bg', 'accent', 0.54], ['bg', 'accent', 0.84]];
const MEZCLA_FUERA = ['bg', 'surface', 0.48];

const rgbDe = (h) => [1, 3, 5].map((i) => parseInt(String(h).slice(i, i + 2), 16));
const hexDe = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
// WCAG 2.x, la de `tests/tema-contraste.test.mjs`.
const lumDe = (h) => {
  const [r, g, b] = rgbDe(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrasteDe = (a, b) => { const x = lumDe(a), y = lumDe(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** `a` mezclado hacia `b` en `m` (0 = `a`, 1 = `b`), en sRGB y redondeado a 8 bits como lo pinta el lienzo. */
const mezclar = (a, b, m) => { const x = rgbDe(a), y = rgbDe(b); return hexDe(x.map((v, i) => v + (y[i] - v) * m)); };

/**
 * Los tonos de la trama para el tema `colores` (`{ bg, surface, accent, text }`, en `#rrggbb`):
 * `{ niveles: [n0, n1, n2, n3], fuera, borde }` (`borde` es el contorno del día pico).
 */
export function tonosPostal(colores) {
  return {
    niveles: MEZCLA_NIVEL.map(([a, b, m]) => mezclar(colores[a], colores[b], m)),
    fuera: mezclar(colores[MEZCLA_FUERA[0]], colores[MEZCLA_FUERA[1]], MEZCLA_FUERA[2]),
    borde: colores.text,
  };
}

/** El color de un día con esos tonos. */
export const tonoDe = (celda, tonos) => (celda.fuera ? tonos.fuera : tonos.niveles[celda.nivel]);

/**
 * Para cada texto del plan, su contraste contra el punto PEOR de lo que tiene detrás: `--color-bg` y el tono
 * (y el contorno, si es el pico) de cada día que toque su caja; el contorno sale 1 px por fuera de la casilla.
 * Devuelve `[{ id, ratio, color }]`, con `color` el de ese punto peor.
 */
export function contrastePostal(plan, colores) {
  const tonos = tonosPostal(colores);
  const toca = (a, c) => a.x < c.x + c.w + 1 && c.x - 1 < a.x + a.w && a.y < c.y + c.h + 1 && c.y - 1 < a.y + a.h;
  return plan.textos.map((t) => {
    const detras = [colores.bg];
    for (const c of plan.celdas || []) if (toca(t.caja, c)) detras.push(tonoDe(c, tonos), ...(c.pico ? [tonos.borde] : []));
    let ratio = Infinity, color = null;
    for (const d of detras) { const r = contrasteDe(colores[t.color], d); if (r < ratio) { ratio = r; color = d; } }
    return { id: t.id, ratio, color };
  });
}
