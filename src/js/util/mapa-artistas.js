// El mapa de artistas (v=315, tanda 64): lo PURO. Sin red, sin DOM, sin canvas, sin reloj.
//
// El dato es `src/data/history-artist-similares.json`, horneado UNA vez en Node por
// `scripts/hornear-similares.mjs`: los nombres del universo (`universo()` de `mapa-paises.js`,
// en su orden), las posiciones ya acomodadas (`d3-force`, 300 ticks, en el horneado) y los pares
// de artistas de tu historial que Last.fm da por parecidos, con su `match` (0 a 1.000) y si lo
// dicen las dos direcciones. 🔴 No lleva minutos: salen de `history-artist-tracks.json`
// (`totals[nombre][1]`), que la vista ya carga. Y el navegador no corre ninguna simulación: la
// tanda 63 midió que acomodar 2.302 nodos son 5 s a velocidad normal y 30-41 s con la CPU seis
// veces más lenta, y que un frame con TODAS las líneas son 270 ms (3,2 s a ×6). Por eso:
//   · se lee la posición, no se calcula;
//   · 🔴 cada frame dibuja los puntos y, como mucho, las líneas del artista ELEGIDO (sus ~55
//     parecidos). Nunca todas, ni «las fuertes», ni una capa precalculada.
//
// Lo de acá lo prueba `tests/mapa-artistas.test.mjs` con un grafo inventado de pocos nodos:
// leer el JSON compacto, los vecinos ordenados por `match`, el toque (pantalla → plano → el
// círculo más cercano), el pan y el zoom con sus topes, qué nombres se dibujan y el buscador.

import { normalizarNombre } from './mb-pais.js';

// El radio de cada artista, en unidades del PLANO (el zoom lo agranda): el mismo del horneado,
// `2 + 18·√(minutos / máximo)`. Tiene que ser el mismo: `forceCollide` acomodó con ese radio.
export const RADIO_MIN = 2;
export const RADIO_EXTRA = 18;
export const ZOOM_MAX = 40;            // veces el zoom de «todo el mapa»
export const RADIO_NOMBRE_PX = 12;     // un nombre se dibuja si su círculo mide esto o más en pantalla
export const MAX_NOMBRES = 60;         // y como mucho tantos por frame
export const ALTO_NOMBRE_PX = 14;      // el alto de la caja de un nombre, para ver si se pisan
export const MARGEN_TOQUE_PX = 4;      // el toque vale hasta 4 px fuera del círculo
export const POR_PAGINA = 50;          // los parecidos del panel, de a tantos
export const MARGEN_VISTA_PX = 12;     // aire alrededor de «todo el mapa»

/**
 * Lee el JSON compacto y lo cruza con los minutos del historial. Devuelve `null` si no tiene la
 * forma esperada (la vista lo trata como «no hay mapa», nunca como un mapa vacío).
 *
 * @param {object} json    `{ nombres, pos: [x0, y0, …], aristas: [i, j, match, mutua, …] }`
 * @param {object} totals  `history-artist-tracks.json` → `totals`: `totals[nombre][1]` = minutos
 */
export function leerMapa(json, totals) {
  if (!json || !Array.isArray(json.nombres) || !Array.isArray(json.pos) || !Array.isArray(json.aristas)) return null;
  const N = json.nombres.length;
  if (json.pos.length !== 2 * N || json.aristas.length % 4 !== 0) return null;
  const x = new Float64Array(N), y = new Float64Array(N), minutos = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    x[i] = +json.pos[2 * i];
    y[i] = +json.pos[2 * i + 1];
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) return null;
    minutos[i] = Number(totals?.[json.nombres[i]]?.[1]) || 0;
  }
  let max = 0;
  for (let i = 0; i < N; i++) if (minutos[i] > max) max = minutos[i];
  const r = new Float64Array(N);
  for (let i = 0; i < N; i++) r[i] = RADIO_MIN + RADIO_EXTRA * Math.sqrt(max > 0 ? minutos[i] / max : 0);

  const vecinos = Array.from({ length: N }, () => []);
  const A = json.aristas;
  for (let k = 0; k < A.length; k += 4) {
    const i = A[k], j = A[k + 1], match = A[k + 2], mutua = A[k + 3] === 1;
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j >= N || i >= j) return null;
    vecinos[i].push({ j, match, mutua });
    vecinos[j].push({ j: i, match, mutua });
  }
  // De mayor a menor `match`; a igualdad, en el orden del universo (más minutos primero).
  for (const l of vecinos) l.sort((a, b) => b.match - a.match || a.j - b.j);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, x[i] - r[i]); maxX = Math.max(maxX, x[i] + r[i]);
    minY = Math.min(minY, y[i] - r[i]); maxY = Math.max(maxY, y[i] + r[i]);
  }
  if (!N) minX = maxX = minY = maxY = 0;
  let aislados = 0, decimasAislados = 0;
  for (let i = 0; i < N; i++) if (!vecinos[i].length) { aislados++; decimasAislados += Math.round(minutos[i] * 10); }
  const claves = json.nombres.map((n) => normalizarNombre(n));
  return {
    N, nombres: json.nombres, claves, x, y, r, minutos, vecinos,
    aristas: A.length / 4, aislados, minutosAislados: decimasAislados / 10,
    limites: { minX, maxX, minY, maxY },
  };
}

// ── La vista: pantalla = plano · escala + desplazamiento ────────────────────────────────────

/** La vista que enseña todo el mapa centrado, y su escala, que es el piso del zoom. */
export function vistaTodo(mapa, ancho, alto) {
  const { minX, maxX, minY, maxY } = mapa.limites;
  const w = Math.max(maxX - minX, 1e-9), h = Math.max(maxY - minY, 1e-9);
  const escala = Math.max(1e-9, Math.min((ancho - 2 * MARGEN_VISTA_PX) / w, (alto - 2 * MARGEN_VISTA_PX) / h));
  return {
    escala, base: escala,
    tx: ancho / 2 - ((minX + maxX) / 2) * escala,
    ty: alto / 2 - ((minY + maxY) / 2) * escala,
  };
}

export const pantallaAPlano = (v, px, py) => [(px - v.tx) / v.escala, (py - v.ty) / v.escala];
export const planoAPantalla = (v, x, y) => [x * v.escala + v.tx, y * v.escala + v.ty];

/** La escala, entre «todo el mapa» y `ZOOM_MAX` veces eso. */
export const limitarEscala = (escala, base) => Math.min(base * ZOOM_MAX, Math.max(base, escala));

/** Zoom por `factor`, dejando quieto el punto del plano que está bajo (px, py). */
export function zoomEn(v, factor, px, py) {
  const escala = limitarEscala(v.escala * factor, v.base);
  const [x, y] = pantallaAPlano(v, px, py);
  return { ...v, escala, tx: px - x * escala, ty: py - y * escala };
}

/** Arrastrar: la vista se mueve lo mismo que el dedo. */
export const mover = (v, dx, dy) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy });

/** Deja el artista `i` en el centro, con el zoom que haya. */
export function centrarEn(v, mapa, i, ancho, alto) {
  return { ...v, tx: ancho / 2 - mapa.x[i] * v.escala, ty: alto / 2 - mapa.y[i] * v.escala };
}

/**
 * El artista tocado en (px, py) de la pantalla, o -1. Gana el círculo más cercano al punto (la
 * distancia al BORDE: dentro de un círculo es negativa), y vale solo si el punto cae dentro de
 * su radio en pantalla más `MARGEN_TOQUE_PX`. A igualdad, el de más minutos (el índice menor).
 */
export function tocar(mapa, v, px, py) {
  let mejor = -1, mejorD = Infinity;
  for (let i = 0; i < mapa.N; i++) {
    const [sx, sy] = planoAPantalla(v, mapa.x[i], mapa.y[i]);
    const d = Math.hypot(px - sx, py - sy) - mapa.r[i] * v.escala;
    if (d <= MARGEN_TOQUE_PX && d < mejorD) { mejor = i; mejorD = d; }
  }
  return mejor;
}

/**
 * Qué nombres se dibujan: los de los círculos que miden `RADIO_NOMBRE_PX` o más en pantalla y
 * se ven, de más minutos a menos (el orden del universo), como mucho `MAX_NOMBRES`, y sin que dos
 * cajas se pisen (si se pisan, gana el de más minutos, que llegó antes). La caja va centrada en
 * el círculo; `medir(nombre)` da su ancho en píxeles (la vista pasa `measureText`).
 *
 * @returns {Array<{ i: number, x: number, y: number }>} el centro de cada nombre, en pantalla
 */
export function nombresVisibles(mapa, v, ancho, alto, medir) {
  const fuera = [];
  const cajas = [];
  for (let i = 0; i < mapa.N && fuera.length < MAX_NOMBRES; i++) {
    const rp = mapa.r[i] * v.escala;
    if (rp < RADIO_NOMBRE_PX) continue;
    const [sx, sy] = planoAPantalla(v, mapa.x[i], mapa.y[i]);
    if (sx + rp < 0 || sx - rp > ancho || sy + rp < 0 || sy - rp > alto) continue;
    const w = medir(mapa.nombres[i]);
    const c = { x0: sx - w / 2, x1: sx + w / 2, y0: sy - ALTO_NOMBRE_PX / 2, y1: sy + ALTO_NOMBRE_PX / 2 };
    if (cajas.some((o) => c.x0 < o.x1 && o.x0 < c.x1 && c.y0 < o.y1 && o.y0 < c.y1)) continue;
    cajas.push(c);
    fuera.push({ i, x: sx, y: sy });
  }
  return fuera;
}

/**
 * El buscador: igualdad de `normalizarNombre` (la de `util/mb-pais.js`, no `normText`, que deja
 * vacíos nombres como «¥$»); si no hay ninguno, el primero, en el orden del universo, cuyo nombre
 * normalizado empiece igual. -1 si nada.
 */
export function buscar(mapa, texto) {
  const q = normalizarNombre(texto);
  if (!q) return -1;
  const igual = mapa.claves.indexOf(q);
  if (igual >= 0) return igual;
  return mapa.claves.findIndex((k) => k.startsWith(q));
}

/** Mezcla dos colores `[r, g, b]` (0-255): `p` de `a` y el resto de `b`. */
export function mezclar(a, b, p) {
  return a.map((c, k) => Math.round(c * p + b[k] * (1 - p)));
}

/** Lee un `rgb(…)`/`rgba(…)` de `getComputedStyle` a `[r, g, b]`, o `null`. */
export function leerRgb(s) {
  const m = String(s || '').match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}
