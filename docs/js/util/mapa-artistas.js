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
// v=316 (tanda 65): con el plano entero a la vista el más grande medía ~1,5 px y no salía ningún
// nombre (hacían falta 12 px). Ahora el radio en pantalla tiene un PISO que mantiene el orden de
// tamaños de lejos (`radioEnPantalla`) y los nombres no dependen del radio (`nombresVisibles`).
//
// v=318 (tanda 66): elegir desde el buscador o el panel ENCUADRA (`encuadrarElegido`: el elegido en el
// centro y sus 30 primeros parecidos dentro), y el nombre del elegido sale primero (`nombresVisibles`).
//
// v=319 (tanda 67): el mapa en la pantalla de Ian (1366 × 591 de alto útil). El lienzo toma el alto que queda en la
// ventana (`altoDelLienzo`), una caja de nombre que se sale por un borde se corre adentro, dos cajas necesitan 3 px de
// aire, y los sueltos (fuera del componente más grande: `principal`) no se llevan nombres del cupo.
//
// v=321 (tanda 68): los sueltos vuelven a llevar nombre, pero solo con el cupo que SOBRA después de los del componente
// grande (nunca desplazan a uno de ellos); los botones de zoom ocupan lugar (`ocupadas`); y `nombresAjenos` cuenta los
// nombres que quedan más cerca de otro círculo que del suyo (la guarda contra un nombre que miente sobre su punto).
//
// Lo de acá lo prueba `tests/mapa-artistas.test.mjs` con un grafo inventado de pocos nodos:
// leer el JSON compacto, los vecinos ordenados por `match`, el toque (pantalla → plano → el
// círculo más cercano), el pan y el zoom con sus topes, qué nombres se dibujan y el buscador.

import { normalizarNombre } from './mb-pais.js?v=325';

// El radio de cada artista, en unidades del PLANO (el zoom lo agranda): el mismo del horneado,
// `2 + 18·√(minutos / máximo)`. Tiene que ser el mismo: `forceCollide` acomodó con ese radio.
export const RADIO_MIN = 2;
export const RADIO_EXTRA = 18;
export const ZOOM_MAX = 40;            // veces el zoom de «todo el mapa»
// El piso del radio en PANTALLA (v=316): `1 + 4·√(minutos / máximo)` px. De cerca manda el plano (el
// horneado acomodó con ese radio); de lejos, el piso, para que «cuanto más grande, más lo has
// escuchado» se siga viendo. Es una decisión de diseño, no una medida.
export const PISO_RADIO_MIN_PX = 1;
export const PISO_RADIO_EXTRA_PX = 4;
export const MAX_NOMBRES = 60;         // los nombres, como mucho tantos por frame
export const ALTO_NOMBRE_PX = 14;      // el alto de la caja de un nombre, para ver si se pisan
export const MARGEN_TOQUE_PX = 4;      // el toque vale hasta 4 px fuera del círculo
export const POR_PAGINA = 50;          // los parecidos del panel, de a tantos
export const MARGEN_VISTA_PX = 12;     // aire alrededor de «todo el mapa»
// v=319. Las tres son DECISIONES DE DISEÑO, no medidas: el aire entre dos cajas de nombre, lo que queda entre una caja
// corrida y el borde del lienzo, y el aire debajo del lienzo cuando toma el alto de la ventana.
export const AIRE_NOMBRE_PX = 3;
export const BORDE_NOMBRE_PX = 2;
export const AIRE_ABAJO_LIENZO_PX = 16;
// El alto del lienzo de hoy, el de `main.css` (`.artmapa-canvas`: `clamp(300px, 62vh, 720px)`), y el ancho desde el
// que manda `altoDelLienzo` (por debajo, el CSS de siempre: a 390 no cambia nada).
export const ALTO_LIENZO_MIN_PX = 300;
export const ALTO_LIENZO_MAX_PX = 720;
export const ALTO_LIENZO_VH = 0.62;
export const ANCHO_MIN_ALTO_LIENZO = 769;

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
  const r = new Float64Array(N), piso = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const p = Math.sqrt(max > 0 ? minutos[i] / max : 0);
    r[i] = RADIO_MIN + RADIO_EXTRA * p;
    piso[i] = PISO_RADIO_MIN_PX + PISO_RADIO_EXTRA_PX * p;
  }

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
  // v=319: el componente conexo más grande (por `vecinos`; a igualdad de tamaño, el que contiene al índice más chico,
  // que es el que se encuentra primero). `principal[i]` es 1 si el artista está ahí: los demás son los sueltos.
  const comp = new Int32Array(N).fill(-1), tam = [];
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0) continue;
    const pila = [s];
    comp[s] = tam.length;
    let n = 0;
    while (pila.length) {
      const u = pila.pop();
      n++;
      for (const { j } of vecinos[u]) if (comp[j] < 0) { comp[j] = tam.length; pila.push(j); }
    }
    tam.push(n);
  }
  let grande = 0;
  for (let k = 1; k < tam.length; k++) if (tam[k] > tam[grande]) grande = k;
  const principal = new Uint8Array(N);
  for (let i = 0; i < N; i++) principal[i] = comp[i] === grande ? 1 : 0;
  let aislados = 0, decimasAislados = 0;
  for (let i = 0; i < N; i++) if (!vecinos[i].length) { aislados++; decimasAislados += Math.round(minutos[i] * 10); }
  const claves = json.nombres.map((n) => normalizarNombre(n));
  return {
    N, nombres: json.nombres, claves, x, y, r, piso, minutos, vecinos, principal,
    aristas: A.length / 4, aislados, minutosAislados: decimasAislados / 10,
    limites: { minX, maxX, minY, maxY },
  };
}

// ── El alto del lienzo (v=319) ──────────────────────────────────────────────────────────────

/**
 * El alto del lienzo en px, para una ventana de `anchoVentana` × `altoVentana` con el lienzo empezando en `topLienzo`
 * (su posición en la PÁGINA, con el scroll en 0). Por debajo de `ANCHO_MIN_ALTO_LIENZO` de ancho, `null`: manda el
 * CSS de siempre. Si no, lo que queda debajo del lienzo menos `AIRE_ABAJO_LIENZO_PX`, pero **nunca menos que el de
 * hoy** (`clamp(300px, 62vh, 720px)`) **ni más de 720**, redondeado a entero.
 */
export function altoDelLienzo(altoVentana, topLienzo, anchoVentana) {
  if (!(anchoVentana >= ANCHO_MIN_ALTO_LIENZO)) return null;
  const hoy = Math.min(ALTO_LIENZO_MAX_PX, Math.max(ALTO_LIENZO_MIN_PX, ALTO_LIENZO_VH * altoVentana));
  return Math.round(Math.max(hoy, Math.min(ALTO_LIENZO_MAX_PX, altoVentana - topLienzo - AIRE_ABAJO_LIENZO_PX)));
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

/** El radio del artista `i` en pantalla: `max(r · escala, piso)`. El mismo para dibujar y para tocar. */
export const radioEnPantalla = (mapa, i, escala) => Math.max(mapa.r[i] * escala, mapa.piso[i]);
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

// El encuadre del elegido (v=318, tanda 66): cuántos parecidos se encuadran y con cuánto aire.
// `ENCUADRE_PARECIDOS` es una DECISIÓN DE DISEÑO, no una medida: con todos, un artista de grado 175 se
// encuadra casi como «Ver todo» y no cambiaría nada.
export const ENCUADRE_PARECIDOS = 30;
export const MARGEN_ENCUADRE_PX = 24;

/**
 * Al elegir desde el buscador o el panel (v=318): el artista `i` en el centro del lienzo y la escala
 * MÁS GRANDE que deja a sus primeros `ENCUADRE_PARECIDOS` parecidos (en el orden del panel: `match` de
 * mayor a menor y, a igualdad, el de más minutos) con el PUNTO ENTERO dentro del lienzo, a
 * `MARGEN_ENCUADRE_PX` de cada borde. El radio es el que se dibuja (`radioEnPantalla`, con su piso).
 * Pasa por `limitarEscala`: nunca menos que «Ver todo» ni más que `ZOOM_MAX` veces eso. Si ni a la
 * escala de «Ver todo» entran (centrado en el elegido no hay escala que alcance), queda esa, centrada.
 * `entraron` dice cuántos de esos parecidos quedaron dentro, con el margen. Sin parecidos, lo mismo que
 * `centrarEn` (centra y conserva la escala). Tocar el lienzo NO pasa por acá: elige sin moverse.
 */
export function encuadrarElegido(v, mapa, i, ancho, alto) {
  const vec = mapa.vecinos[i].slice(0, ENCUADRE_PARECIDOS);
  if (!vec.length) return centrarEn(v, mapa, i, ancho, alto);
  const mx = ancho / 2 - MARGEN_ENCUADRE_PX, my = alto / 2 - MARGEN_ENCUADRE_PX;
  // Para un parecido a distancia d del elegido (en un eje), con radio r en el plano y piso p en pantalla,
  // el punto entero entra si d·s + max(r·s, p) ≤ m: o sea s ≤ m / (d + r) y, si d > 0, s ≤ (m − p) / d.
  let s = Infinity;
  for (const { j } of vec) {
    for (const [d, m] of [[Math.abs(mapa.x[j] - mapa.x[i]), mx], [Math.abs(mapa.y[j] - mapa.y[i]), my]]) {
      s = Math.min(s, m / (d + mapa.r[j]));
      if (d > 0) s = Math.min(s, (m - mapa.piso[j]) / d);
    }
  }
  const escala = limitarEscala(Number.isFinite(s) ? s : v.base, v.base);
  const vista = centrarEn({ ...v, escala }, mapa, i, ancho, alto);
  const dentro = (j) => {
    const [sx, sy] = planoAPantalla(vista, mapa.x[j], mapa.y[j]);
    const rp = radioEnPantalla(mapa, j, escala), e = 1e-6;
    return sx - rp >= MARGEN_ENCUADRE_PX - e && sx + rp <= ancho - MARGEN_ENCUADRE_PX + e
      && sy - rp >= MARGEN_ENCUADRE_PX - e && sy + rp <= alto - MARGEN_ENCUADRE_PX + e;
  };
  return { ...vista, entraron: vec.filter(({ j }) => dentro(j)).length };
}

/**
 * El artista tocado en (px, py) de la pantalla, o -1. Gana el círculo más cercano al punto (la
 * distancia al BORDE: dentro de un círculo es negativa), y vale solo si el punto cae dentro de
 * su radio en pantalla (`radioEnPantalla`, con su piso) más `MARGEN_TOQUE_PX`. A igualdad, el de
 * más minutos (el índice menor).
 */
export function tocar(mapa, v, px, py) {
  let mejor = -1, mejorD = Infinity;
  for (let i = 0; i < mapa.N; i++) {
    const [sx, sy] = planoAPantalla(v, mapa.x[i], mapa.y[i]);
    const d = Math.hypot(px - sx, py - sy) - radioEnPantalla(mapa, i, v.escala);
    if (d <= MARGEN_TOQUE_PX && d < mejorD) { mejor = i; mejorD = d; }
  }
  return mejor;
}

/**
 * Qué nombres se dibujan (v=316): de más minutos a menos (el orden del universo), como mucho
 * `MAX_NOMBRES`, solo de círculos con el centro dentro del lienzo, y sin que dos cajas se pisen (si
 * se pisan, gana el de más minutos, que llegó antes). **No depende del radio**: hasta v=315 hacía
 * falta un círculo de 12 px o más, y con el plano entero a la vista no salía ninguno. Así el más
 * escuchado que se vea siempre tiene nombre. La caja va centrada en el círculo; `medir(nombre)` da
 * su ancho en píxeles (la vista pasa `measureText`).
 *
 * El elegido (v=318), si lo hay y su círculo entero está dentro del lienzo, va PRIMERO: su nombre sale
 * siempre y les gana el lugar a los demás (cuenta en el tope de `MAX_NOMBRES`).
 *
 * v=319: (1) si la caja no entra entera, se CORRE hacia adentro hasta quedar a `BORDE_NOMBRE_PX` del borde (en x y
 * en y); si es más ancha que el lienzo (con ese borde a los dos lados), se queda centrada. La colisión se calcula con
 * la caja ya corrida, y lo que se devuelve es el centro de la caja corrida: la vista pinta ahí. (2) Dos cajas se
 * pisan si quedan a menos de `AIRE_NOMBRE_PX`. (3) Un suelto (`principal[i]` en 0) no lleva nombre, salvo el elegido.
 *
 * v=321: (1) los sueltos, con el cupo que SOBRA: primero se colocan los del componente grande (y el elegido), en el orden
 * de siempre; recién después, si queda cupo, los sueltos, en el orden del universo y con la misma colisión, aire y borde.
 * Un suelto nunca desplaza a uno del componente grande: esa lista sale idéntica con sueltos y sin ellos. (2) `ocupadas`:
 * cajas `{ x0, x1, y0, y1 }` en coordenadas del lienzo (la vista pasa la de los botones de zoom); un nombre cuya caja,
 * con el aire, toque una de ellas no sale.
 *
 * @returns {Array<{ i: number, x: number, y: number }>} el centro de cada caja de nombre, en pantalla
 */
export function nombresVisibles(mapa, v, ancho, alto, medir, elegido = -1, ocupadas = []) {
  const fuera = [];
  const cajas = [];
  // Corre el centro `c` de una caja de largo `l` para que no se salga de [0, lado]: a `BORDE_NOMBRE_PX` del borde por
  // el que se salía. Si no entra ni con el borde a los dos lados, no se mueve.
  const correr = (c, l, lado) => {
    if (l + 2 * BORDE_NOMBRE_PX > lado) return c;
    if (c - l / 2 < 0) return BORDE_NOMBRE_PX + l / 2;
    if (c + l / 2 > lado) return lado - BORDE_NOMBRE_PX - l / 2;
    return c;
  };
  const a = AIRE_NOMBRE_PX;
  const toca = (c, o) => c.x0 < o.x1 + a && o.x0 < c.x1 + a && c.y0 < o.y1 + a && o.y0 < c.y1 + a;
  const poner = (i) => {
    const [sx, sy] = planoAPantalla(v, mapa.x[i], mapa.y[i]);
    if (sx < 0 || sx > ancho || sy < 0 || sy > alto) return;
    const w = medir(mapa.nombres[i]);
    const cx = correr(sx, w, ancho), cy = correr(sy, ALTO_NOMBRE_PX, alto);
    const c = { x0: cx - w / 2, x1: cx + w / 2, y0: cy - ALTO_NOMBRE_PX / 2, y1: cy + ALTO_NOMBRE_PX / 2 };
    if (cajas.some((o) => toca(c, o)) || ocupadas.some((o) => toca(c, o))) return;
    cajas.push(c);
    fuera.push({ i, x: cx, y: cy });
  };
  let primero = -1;
  if (elegido >= 0 && elegido < mapa.N) {
    const [sx, sy] = planoAPantalla(v, mapa.x[elegido], mapa.y[elegido]), rp = radioEnPantalla(mapa, elegido, v.escala);
    if (sx - rp >= 0 && sx + rp <= ancho && sy - rp >= 0 && sy + rp <= alto) { poner(elegido); primero = elegido; }
  }
  // Si no se adelantó (el círculo no está entero dentro), va en su turno, como cualquiera.
  // Los del componente grande (y el elegido, si no se adelantó), y después los sueltos con el cupo que sobra.
  for (let i = 0; i < mapa.N && fuera.length < MAX_NOMBRES; i++) if (i !== primero && (mapa.principal[i] || i === elegido)) poner(i);
  for (let i = 0; i < mapa.N && fuera.length < MAX_NOMBRES; i++) if (i !== primero && !mapa.principal[i] && i !== elegido) poner(i);
  return fuera;
}

/**
 * Cuántos nombres son AJENOS (v=321): los que quedan más cerca del círculo de OTRO artista que del suyo. Para cada
 * etiqueta (el centro de su caja, ya corrida, que es donde se pinta) se toma `d(j) = hypot(cx − sxⱼ, cy − syⱼ) −
 * radioEnPantalla(mapa, j, escala)`; es ajena si algún `j ≠ i` tiene `d(j) < d(i)`. Cuesta `N` por nombre: la usan el
 * test, el banco y el conductor, **la vista no**.
 *
 * @param {Array<{ i: number, x: number, y: number }>} etiquetas  lo que devuelve `nombresVisibles`
 */
export function nombresAjenos(mapa, v, etiquetas) {
  const dist = (e, j) => {
    const [sx, sy] = planoAPantalla(v, mapa.x[j], mapa.y[j]);
    return Math.hypot(e.x - sx, e.y - sy) - radioEnPantalla(mapa, j, v.escala);
  };
  let n = 0;
  for (const e of etiquetas) {
    const propia = dist(e, e.i);
    for (let j = 0; j < mapa.N; j++) if (j !== e.i && dist(e, j) < propia) { n++; break; }
  }
  return n;
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
