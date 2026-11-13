// La cuenta de `#lluvia` (v=358, tanda 117). PURO: sin red, sin DOM y sin reloj.
//
// Cruza dos JSON horneados, los dos en días LOCALES de Mar del Plata:
//   · `history-days-local.json` (`gen-stats.py`): minutos por día, `{ from, min[] }`;
//   · `lluvia-mar-del-plata.json` (la tanda 116, Open-Meteo): `{ desde, mm[] }`.
// 🔴 Lo que se corrió de hora es el HISTORIAL, y ya viene corrido: acá no se suma ni se resta
// ninguna hora. Las demás vistas siguen en UTC.
//
// Lo decidido:
//   · 🔴 «Día con lluvia» = 1 mm o más. La comparación va en décimas, en enteros: 0,9 no y 1,0 sí.
//   · La ventana: los días con los dos datos, sin el primero ni el último del historial (pueden
//     estar a medias).
//   · Un día sin reproducciones son 0 minutos, no «sin dato»: la media los incluye.
//   · Todas las cuentas en enteros (décimas de minuto y de mm). Se redondea al final, al enseñar.
//
// Guarda: `tests/lluvia.test.mjs`.
import { fmtDia } from './fecha.js?v=365';

/** 1 mm, en décimas. */
export const UMBRAL_DECIMAS = 10;
export const CUANTOS_LLUVIOSOS = 10;

const DIA_MS = 86400000;
const diaNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DIA_MS;
const isoDe = (n) => new Date(n * DIA_MS).toISOString().slice(0, 10);
const num = (n) => Number(n).toLocaleString('es-ES');
const unDecimal = (n) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** De un valor con (como mucho) un decimal a décimas enteras. */
export const decimas = (x) => Math.round(x * 10);

/** ¿Este día (en mm) cuenta como día con lluvia? */
export const esDiaDeLluvia = (mm) => decimas(mm) >= UMBRAL_DECIMAS;

/** Tira si el JSON de la lluvia no tiene la forma que hace falta (un 200 con otra cosa). */
export function validarLluvia(d) {
  if (!d || typeof d.desde !== 'string' || !Array.isArray(d.mm) || typeof d.aviso !== 'string' || typeof d.atribucion !== 'string') {
    throw new Error('el JSON de la lluvia no tiene la forma esperada');
  }
  return d;
}

/** ¿El historial por día local tiene la forma que hace falta? */
export const diasLocalesValidos = (d) => !!d && typeof d.from === 'string' && Array.isArray(d.min);

/**
 * Los días que se cuentan: `{ dia, anio, minD, mmD, lluvia }`, en orden.
 * Un día de la ventana sin dato de lluvia (`mm` en `null`) no entra.
 */
export function filasDeLaVentana(diasLocal, lluvia) {
  const h0 = diaNum(diasLocal.from), l0 = diaNum(lluvia.desde);
  const desde = Math.max(h0 + 1, l0);
  const hasta = Math.min(h0 + diasLocal.min.length - 2, l0 + lluvia.mm.length - 1);
  const filas = [];
  for (let n = desde; n <= hasta; n++) {
    const mm = lluvia.mm[n - l0], minutos = diasLocal.min[n - h0];
    if (typeof mm !== 'number' || typeof minutos !== 'number') continue;
    const dia = isoDe(n);
    filas.push({ dia, anio: +dia.slice(0, 4), minD: decimas(minutos), mmD: decimas(mm), lluvia: esDiaDeLluvia(mm) });
  }
  return filas;
}

/** La media, en décimas de minuto: `round(Σ décimas / N)`. `null` si no hay días. */
export function media(valores) {
  if (!valores.length) return null;
  return Math.round(valores.reduce((a, b) => a + b, 0) / valores.length);
}

/** La mediana, en décimas de minuto; con N par, el promedio de los dos del medio. `null` si no hay días. */
export function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

function grupo(filas) {
  const valores = filas.map((f) => f.minD);
  const conMusica = valores.filter((v) => v > 0).length;
  return {
    dias: filas.length,
    conMusica,
    pctD: filas.length ? Math.round((conMusica * 1000) / filas.length) : null,   // décimas de %
    mediaD: media(valores),
    medianaD: mediana(valores),
  };
}

/** Los dos grupos: `{ con, sin }`. */
export function resumir(filas) {
  return { con: grupo(filas.filter((f) => f.lluvia)), sin: grupo(filas.filter((f) => !f.lluvia)) };
}

/** Por año local, solo los que tienen días en la ventana, y sin esconder los que tienen pocos. */
export function porAnio(filas) {
  const anios = [...new Set(filas.map((f) => f.anio))].sort((a, b) => a - b);
  return anios.map((anio) => {
    const delAnio = filas.filter((f) => f.anio === anio);
    const { con, sin } = resumir(delAnio);
    return { anio, diasConLluvia: con.dias, mediaConD: con.mediaD, mediaSinD: sin.mediaD };
  });
}

/** Los más lluviosos: más mm primero; a igualdad, el más viejo. */
export function masLluviosos(filas, cuantos = CUANTOS_LLUVIOSOS) {
  return [...filas].sort((a, b) => b.mmD - a.mmD || a.dia.localeCompare(b.dia)).slice(0, cuantos);
}

// ── Los textos ───────────────────────────────────────────────────────────────

/** Minutos sin decimales, de décimas. «—» si no hay dato. */
export const textoMinutos = (d) => (d === null ? '—' : num(Math.round(d / 10)));
/** mm con un decimal, de décimas. */
export const textoMm = (d) => unDecimal(d / 10);
/** % con un decimal, de décimas de %. «—» si no hay dato. */
export const textoPct = (d) => (d === null ? '—' : `${unDecimal(d / 10)} %`);

/** La línea de arriba. */
export function lineaVentana(filas) {
  return `Del ${fmtDia(filas[0].dia)} al ${fmtDia(filas[filas.length - 1].dia)}: ${num(filas.length)} días. Un día con lluvia es uno con 1 mm o más.`;
}

/**
 * Debajo de la línea de arriba: de dónde sale ese número de días. El cuerpo es una oración fija; las cuatro
 * fechas van en el `title`, leídas de los dos JSON.
 */
export function lineaRecorte(diasLocal, lluvia) {
  const finHistorial = isoDe(diaNum(diasLocal.from) + diasLocal.min.length - 1);
  return {
    texto: 'Son los días en que hay historial y lluvia a la vez; el primer y el último día de tu historial no entran porque pueden estar a medias.',
    title: `Tu historial: del ${fmtDia(diasLocal.from)} al ${fmtDia(finHistorial)}. La lluvia: del ${fmtDia(lluvia.desde)} al ${fmtDia(lluvia.hasta)}.`,
  };
}

/**
 * Cuenta los años, sin sacar conclusión (v=359). Compara en décimas enteras, no los minutos redondeados
 * de la tabla. Un año sin días con lluvia o sin días sin lluvia no cuenta. Con un solo año, `null`.
 */
export function lineaAnios(anios) {
  if (anios.length < 2) return null;
  let altos = 0, bajos = 0, iguales = 0, sinLosDos = 0;
  for (const { mediaConD, mediaSinD } of anios) {
    if (mediaConD === null || mediaSinD === null) sinLosDos++;
    else if (mediaConD > mediaSinD) altos++;
    else if (mediaConD < mediaSinD) bajos++;
    else iguales++;
  }
  const cuenta = iguales
    ? `más alta en ${altos}, más baja en ${bajos} e igual en ${iguales}.`
    : `más alta en ${altos} y más baja en ${bajos}.`;
  return `Año por año, la media de los días con lluvia sale ${cuenta}${sinLosDos ? ` (${sinLosDos} sin días de los dos tipos.)` : ''}`;
}

export const FRASE_NO_CAUSA = 'Esto compara días: no dice que la lluvia sea la causa.';

// Los dos enlaces del crédito. El texto sale de `atribucion` del JSON: la licencia pide el crédito y
// no se escribe una segunda copia que pueda quedar distinta.
const ENLACES = ['Open-Meteo.com', 'CC BY 4.0'];

/**
 * La atribución, en trozos: `[{ texto, href? }]`. Cada «Nombre (url)» del JSON sale como un enlace
 * con el texto «Nombre» y sin los paréntesis.
 */
export function trozosAtribucion(atribucion) {
  const trozos = [];
  let resto = atribucion;
  for (const nombre of ENLACES) {
    const m = resto.match(new RegExp(`^(.*?)${nombre.replace(/\./g, '\\.')} \\((https?://[^)]+)\\)(.*)$`, 's'));
    if (!m) continue;
    if (m[1]) trozos.push({ texto: m[1] });
    trozos.push({ texto: nombre, href: m[2] });
    resto = m[3];
  }
  if (resto) trozos.push({ texto: resto });
  return trozos;
}
