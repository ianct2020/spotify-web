// La postal del año (v=326): QUÉ dice y DÓNDE va cada cosa. PURO: sin DOM, sin red y sin lienzo, para
// probarlo en Node (`tests/postal-anio.test.mjs`). El dibujo y la descarga viven en
// `features/wrapped-postal.js`, que le pasa la función de medir con la letra ya puesta.
//
// ── Por qué una postal POR AÑO ──────────────────────────────────────────────
//
// Ian pidió «pngs para exportar, con metricas o cosas interesantes» (16/10) y no dijo de qué. Que sea
// una por año, en «Wrapped», es NUESTRA lectura del pedido: `years[]` de `history-stats.json` ya trae
// todo lo que hace falta para los nueve años, y los cinco primeros discos de cada año tienen tapa. El
// artista no tiene foto en ningún JSON y el disco solo trae el día en que cumplió el umbral: esas
// postales quedan para otra tanda, si él las quiere.
//
// ── Lo que lleva, y lo que NO ───────────────────────────────────────────────
//
// El año, el rango («del 15 ago 2018 al 31 dic 2018»), los minutos, las reproducciones, los días con
// música, la racha más larga, el día pico, los cinco artistas con sus minutos, los cinco discos con su
// tapa y, abajo, «Fonoteca». Nada más.
//
//   · 🔴 Las fechas, con el `fmtDia` que se le pasa (el de `util/fecha.js`): lee los diez primeros
//     caracteres y no construye un `Date`. La primera escucha de 2026 es `2026-01-01T00:00:28Z`, y con
//     `new Date()` en UTC−3 la postal de 2026 diría «del 31 dic 2025» (el bug de v=231).
//   · Los minutos, con el `fmtMinutes` de `wrapped.js`, también pasado por contexto (como la apertura):
//     si se copiara acá, la copia es la que terminaría mintiendo (la lección de v=231).
//   · 🔴 Los saltos NO van, ni el porcentaje ni la palabra. Antes del 15/10/2022 el export no anotaba los
//     saltos igual que después (ver «La definición de salto» en CLAUDE.md), y en la vista eso lo avisa una
//     pista; una imagen que circula sola no puede llevar el aviso.
//
// ── El recorte ──────────────────────────────────────────────────────────────
//
// Cada texto tiene un ancho máximo (el de su caja) y se recorta con «…» MIDIENDO con la letra de verdad,
// nunca contando caracteres: «WWWW» y «iiii» no miden lo mismo. La medida entra inyectada.

import { coverVariant } from './album-key.js';

export const ANCHO = 1080;
export const ALTO = 1350;
/** Cuántos artistas y cuántos discos. */
export const TOPE = 5;
/** La variante de tapa que se pide: la casilla mide 160 px, la de 64 se vería borrosa. */
export const VARIANTE_TAPA = 300;
export const LADO_TAPA = 160;
export const ELIPSIS = '…';

const MARGEN = 64;                   // del borde del lienzo a las cajas
const RELLENO = 32;                  // de la caja a su contenido
const X0 = MARGEN + RELLENO;         // 96: donde empieza el contenido de una caja
const X1 = ANCHO - MARGEN - RELLENO; // 984: donde termina
const ANCHO_CAJA = ANCHO - 2 * MARGEN;
const SEP_TAPAS = 22;                // con cinco tapas de 160, entran justas en los 888 de adentro

// Las letras: peso y tamaño. La familia la pone quien dibuja (la de la app, `--font-sans`).
const F = {
  anio: { peso: 700, tam: 128 },
  rango: { peso: 400, tam: 30 },
  cifra: { peso: 700, tam: 52 },
  etiqueta: { peso: 400, tam: 24 },
  pico: { peso: 600, tam: 26 },
  titulo: { peso: 600, tam: 24 },
  puesto: { peso: 600, tam: 26 },
  nombre: { peso: 600, tam: 28 },
  minutos: { peso: 400, tam: 24 },
  disco: { peso: 600, tam: 20 },
  discoArtista: { peso: 400, tam: 18 },
  nota: { peso: 400, tam: 64 },
  pie: { peso: 600, tam: 24 },
};
/** Los pesos que usa la postal, para esperar a que cargue la letra antes de medir. */
export const PESOS = [...new Set(Object.values(F).map((f) => f.peso))].sort();

// El alto de la caja de un renglón: 1,25 veces el tamaño, con la línea de base arriba («top»), cabe la
// parte de abajo de la «g» y de la «p».
const altoDe = (f) => Math.ceil(f.tam * 1.25);
const numero = (v) => Number(v || 0);
const plural = (n, uno, varios) => (n === 1 ? uno : varios);
// Un nombre vacío no deja un hueco: va «—».
const nombreDe = (s) => (String(s ?? '').trim() || '—');

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
  const plays = numero(y.plays), dias = numero(y.days_active), racha = numero(y.longest_streak);
  return {
    anio: String(y.year),
    rango: `del ${fmtDia(y.first_play)} al ${fmtDia(y.last_play)}`,
    cifras: [
      { id: 'minutos', valor: fmtMinutes(y.min), etiqueta: 'de música' },
      { id: 'reproducciones', valor: plays.toLocaleString('es-ES'), etiqueta: plural(plays, 'reproducción', 'reproducciones') },
      { id: 'dias', valor: dias.toLocaleString('es-ES'), etiqueta: plural(dias, 'día con música', 'días con música') },
      { id: 'racha', valor: racha.toLocaleString('es-ES'), etiqueta: plural(racha, 'día seguido: la racha más larga', 'días seguidos: la racha más larga') },
    ],
    pico: y.peak_day?.date ? `Día pico: ${fmtDia(y.peak_day.date)} · ${fmtMinutes(y.peak_day.min)}` : 'Día pico: —',
    tituloArtistas: 'Artistas más escuchados',
    artistas: (y.top_artists || []).slice(0, TOPE).map((a) => ({ nombre: nombreDe(a.name), minutos: fmtMinutes(a.min), min: numero(a.min) })),
    tituloDiscos: 'Discos más escuchados',
    // La tapa de 300 sale cambiando el prefijo de la URL, sin ida a la API (`coverVariant`). Sin `img`,
    // `null`: la casilla lleva el ♪, como una tapa que no bajó.
    discos: (y.top_albums || []).slice(0, TOPE).map((a) => ({ nombre: nombreDe(a.name), artista: nombreDe(a.artist), url: a.img ? coverVariant(a.img, VARIANTE_TAPA) : null })),
    pie: 'Fonoteca',
  };
}

/**
 * La postal entera: qué se dibuja y dónde. `medir(texto, fuente)` devuelve el ancho en px con esa
 * fuente (`{ peso, tam }`). Coordenadas del lienzo de 1080×1350; los textos con la línea de base arriba.
 *
 * Devuelve `{ ancho, alto, fondos, barras, textos, tapas }`:
 *   · `fondos`: las cajas, `{ id, x, y, w, h, color: 'surface' }`;
 *   · `barras`: lo que va con el acento (nunca texto), `{ id, x, y, w, h }`;
 *   · `textos`: `{ id, texto (ya recortado), x, y, max, alinear, fuente, alto, color: 'text'|'secondary',
 *     sobre: 'bg'|'surface', caja: { x, y, w, h } }` — `caja` es el lugar que tiene reservado;
 *   · `tapas`: `{ id, i, url|null, x, y, lado, nota }`, con `nota` = el ♪ por si la tapa no baja (sobre
 *     `--color-elevated`).
 */
export function planPostal(y, { fmtMinutes, fmtDia, medir }) {
  const tx = textosPostal(y, { fmtMinutes, fmtDia });
  const fondos = [], barras = [], textos = [], tapas = [];
  const poner = (id, texto, { x, y: yy, max, fuente, color, sobre, alinear = 'left' }) => {
    const alto = altoDe(fuente);
    const cx = alinear === 'left' ? x : alinear === 'right' ? x - max : x - max / 2;
    textos.push({ id, texto: recortar(texto, max, (t) => medir(t, fuente)), x, y: yy, max, alinear, fuente, alto, color, sobre, caja: { x: cx, y: yy, w: max, h: alto } });
  };

  barras.push({ id: 'barra-arriba', x: 0, y: 0, w: ANCHO, h: 10 });
  poner('anio', tx.anio, { x: MARGEN, y: 52, max: ANCHO_CAJA, fuente: F.anio, color: 'text', sobre: 'bg' });
  poner('rango', tx.rango, { x: MARGEN, y: 220, max: ANCHO_CAJA, fuente: F.rango, color: 'secondary', sobre: 'bg' });

  // Las cuatro cifras, en dos columnas, y el día pico debajo de una línea.
  const yC = 284;
  fondos.push({ id: 'caja-cifras', x: MARGEN, y: yC, w: ANCHO_CAJA, h: 340, color: 'surface' });
  const col = (X1 - X0 - 24) / 2;
  tx.cifras.forEach((c, k) => {
    const x = X0 + (k % 2) * (col + 24);
    const yy = yC + 28 + Math.floor(k / 2) * 120;
    poner(`cifra-${c.id}`, c.valor, { x, y: yy, max: col, fuente: F.cifra, color: 'text', sobre: 'surface' });
    poner(`etiqueta-${c.id}`, c.etiqueta, { x, y: yy + 68, max: col, fuente: F.etiqueta, color: 'secondary', sobre: 'surface' });
  });
  barras.push({ id: 'linea-cifras', x: X0, y: yC + 264, w: X1 - X0, h: 2 });
  poner('pico', tx.pico, { x: X0, y: yC + 284, max: X1 - X0, fuente: F.pico, color: 'text', sobre: 'surface' });

  // Los artistas: puesto, nombre (lo que sobra del renglón) y minutos a la derecha; debajo de cada uno,
  // una barra con sus minutos contra los del primero.
  if (tx.artistas.length) {
    const yA = 648;
    fondos.push({ id: 'caja-artistas', x: MARGEN, y: yA, w: ANCHO_CAJA, h: 316, color: 'surface' });
    poner('artistas-titulo', tx.tituloArtistas, { x: X0, y: yA + 24, max: X1 - X0, fuente: F.titulo, color: 'secondary', sobre: 'surface' });
    const anchoMin = Math.min(300, Math.ceil(Math.max(...tx.artistas.map((a) => medir(a.minutos, F.minutos)))));
    const xNombre = X0 + 44;
    const tope = Math.max(...tx.artistas.map((a) => a.min));
    tx.artistas.forEach((a, k) => {
      const yy = yA + 68 + k * 48;
      poner(`artista-puesto-${k}`, String(k + 1), { x: X0, y: yy + 2, max: 36, fuente: F.puesto, color: 'secondary', sobre: 'surface' });
      poner(`artista-nombre-${k}`, a.nombre, { x: xNombre, y: yy + 2, max: X1 - anchoMin - 20 - xNombre, fuente: F.nombre, color: 'text', sobre: 'surface' });
      poner(`artista-min-${k}`, a.minutos, { x: X1, y: yy + 6, max: anchoMin, fuente: F.minutos, color: 'secondary', sobre: 'surface', alinear: 'right' });
      barras.push({ id: `artista-barra-${k}`, x: xNombre, y: yy + 40, w: Math.max(2, Math.round((X1 - xNombre) * (tope > 0 ? a.min / tope : 0))), h: 4 });
    });
  }

  // Los discos: la tapa y, debajo, el nombre y el artista. Con menos de cinco, centradas.
  if (tx.discos.length) {
    const yD = 988;
    fondos.push({ id: 'caja-discos', x: MARGEN, y: yD, w: ANCHO_CAJA, h: 302, color: 'surface' });
    poner('discos-titulo', tx.tituloDiscos, { x: X0, y: yD + 24, max: X1 - X0, fuente: F.titulo, color: 'secondary', sobre: 'surface' });
    const n = tx.discos.length;
    const x0 = X0 + ((X1 - X0) - (n * LADO_TAPA + (n - 1) * SEP_TAPAS)) / 2;
    tx.discos.forEach((d, k) => {
      const x = x0 + k * (LADO_TAPA + SEP_TAPAS), yT = yD + 66;
      tapas.push({ id: `tapa-${k}`, i: k, url: d.url, x, y: yT, lado: LADO_TAPA, nota: { texto: '♪', fuente: F.nota, color: 'secondary', sobre: 'elevated' } });
      poner(`disco-nombre-${k}`, d.nombre, { x, y: yT + LADO_TAPA + 8, max: LADO_TAPA, fuente: F.disco, color: 'text', sobre: 'surface' });
      poner(`disco-artista-${k}`, d.artista, { x, y: yT + LADO_TAPA + 36, max: LADO_TAPA, fuente: F.discoArtista, color: 'secondary', sobre: 'surface' });
    });
  }

  poner('pie', tx.pie, { x: ANCHO / 2, y: 1306, max: ANCHO_CAJA, fuente: F.pie, color: 'secondary', sobre: 'bg', alinear: 'center' });
  return { ancho: ANCHO, alto: ALTO, fondos, barras, textos, tapas };
}

/** El aviso de cuando termina: lo que la postal trae, sin vender de más. */
export function avisoPostal({ faltan = 0, sinTapas = false, motivo = null } = {}) {
  if (sinTapas) return `La postal salió sin tapas: el navegador no dejó exportarla con ellas (${motivo || 'sin motivo'}). Los discos van con su nombre y un ♪.`;
  if (faltan > 0) return `Postal descargada. ${faltan === 1 ? '1 tapa no se pudo bajar y va' : `${faltan} tapas no se pudieron bajar y van`} con ♪.`;
  return 'Postal descargada.';
}
