// Familias de color de una portada, para el filtro de «Mis tapas» (#covers,
// v=288). Módulo PURO: no toca red, DOM ni IndexedDB, así que se prueba en Node
// (`tests/familia-color.test.mjs`).
//
// ⚠️ **El color de entrada es la media 1×1 de la rejilla 3×3** que ya guarda
// `mosaico_colores_v1` (`mediaDeRejilla()` de `util/cover-color.js`). Decisión
// de Ian del 09/10: la 3×3 no se toca por ahora. O sea que este archivo NO
// calcula ningún color: recibe un sRGB de 8 bits y sólo decide en qué cajón cae.
//
// ── POR QUÉ LCh Y NO HSL ────────────────────────────────────────────────────
//
// El encargo suponía «por tono, saturación y luminosidad», o sea HSL. Se usa
// **CIELAB → LCh** (`srgb8ALab` + `labALch`, los dos ya en `cover-color.js` y
// con banco propio): L* luminosidad, C* croma, h tono en grados. Es
// perceptualmente uniforme, que es justo lo que un filtro «enseñame las rojas»
// necesita — en HSL dos colores con la misma S se ven con saturaciones muy
// distintas según el tono.
//
// 🔴 **Y LOS ÁNGULOS NO SON LOS DE HSL. Esta es la trampa de este archivo.**
// En LCh el **rojo puro `rgb(255,0,0)` cae en h = 40°**, no en 0°, y el **azul
// puro `rgb(0,0,255)` en h = 306°**, no en 240°. El primer intento de v=288
// escribió las fronteras con intuición de HSL y metía `rgb(194,1,1)` —rojo
// Spotify de una tapa real— en NARANJAS, y `rgb(31,50,184)` —azul— en
// VIOLETAS. Si algún día hay que mover una frontera, **medila primero** con
// `labALch(srgb8ALab(r,g,b))` sobre un color de referencia; no la deduzcas.
//
// Los anclajes medidos el 09/10 con los que se eligieron los cortes de abajo
// (h en grados, con `C*` y `L*` entre paréntesis):
//
//   rosa 7,8 · carmesí 25,3 · marrón 31,6 · ladrillo 34,0 · tomate 38,7 ·
//   rojo puro 40,0 · coral 46,3 · siena 50,6 · chocolate 56,9 ·
//   naranja oscuro 64,0 · naranja 73,1 · tostado 78,4 · oro 91,3 ·
//   amarillo 102,9 · oliva 102,9 · lima 136,0 · verde 136,0 ·
//   verde primavera 148,6 · verde mar 153,2 · aguamarina 167,9 ·
//   turquesa 185,2 · cian 196,4 · teal 196,4 · azul cielo 235,1 ·
//   azul acero 262,8 · azul 306,3 · violeta 313,1 · índigo 314,1 ·
//   púrpura 328,2 · magenta 328,2 · rosa fuerte 356,1
//
// Las fronteras son los puntos medios entre anclajes vecinos. Dos quedan
// difusas por naturaleza y se aceptan a propósito: **magenta cae en violetas**
// (púrpura y magenta tienen EL MISMO tono, 328,2 — sólo los separan L* y C*, así
// que ningún corte por tono los distingue) y **tostado cae en naranjas** (es un
// marrón claro, y le falla el techo de L* de los marrones).

import { srgb8ALab, labALch } from './cover-color.js?v=288';

/** Croma por debajo del cual no hay tono perceptible: la tapa es neutra. */
export const CROMA_NEUTRO = 6;
/** Una neutra por debajo de esta luminosidad es negra. */
export const L_NEGRO = 30;
/** Una neutra a partir de esta luminosidad es blanca. */
export const L_BLANCO = 78;
/** Techo de luminosidad y de croma de un marrón (un cálido apagado y oscuro). */
export const MARRON_L_MAX = 55;
export const MARRON_C_MAX = 60;

// El reparto medido sobre las 2.469 tapas reales de Ian el 09/10 (las
// miniaturas de 64 px bajadas del CDN de imágenes, 0 peticiones a la API, y
// pasadas por los módulos reales). Está acá para que un cambio de frontera se
// pueda comparar contra algo:
//
//   grises 572 (23,2 %) · marrones 525 (21,3 %) · azules 255 (10,3 %) ·
//   blancos 234 (9,5 %) · amarillos 188 (7,6 %) · naranjas 172 (7,0 %) ·
//   rosas 158 (6,4 %) · negros 138 (5,6 %) · rojos 89 (3,6 %) ·
//   violetas 60 (2,4 %) · verdes 52 (2,1 %) · aguas 26 (1,1 %)
//
// ⚠️ El dato que sorprende y que conviene no olvidar: **las tapas de disco son
// abrumadoramente desaturadas.** Con el corte neutro en C* < 12 el 61 % de las
// 2.469 no tendría tono; con C* < 6 —el neutro perceptual, croma Munsell /1— es
// el 38 %. Por eso el umbral es 6 y no 12: con 12, «grises» se llevaba el 38 %
// él solo. Y los OSCUROS no son el problema: negros son 138 de 2.469.

/**
 * Las familias, en el orden en que se pintan las pastillas.
 *
 * ⚠️ **`color` y `texto` son colores a mano, y es la única excepción a la regla
 * de «sólo variables de tema» de todo el repo.** Es por definición: una
 * pastilla que filtra «rojos» tiene que ser roja, y el rojo no puede depender
 * del preset o la pastilla dejaría de decir cuál es su familia.
 *
 * 🟩 **Y por eso mismo su contraste NO depende del preset**: fondo y texto son
 * los dos fijos, así que el ratio es idéntico en los cuatro. Medido el 09/10
 * (WCAG 2.1, luminancia relativa con la tabla sRGB→lineal de `cover-color.js`):
 * rojos 7,35 · naranjas 5,57 · amarillos 11,83 · verdes 5,47 · aguas 6,42 ·
 * azules 6,29 · violetas 8,08 · rosas 5,49 · marrones 7,14 · grises 6,05 ·
 * blancos 18,90 · negros 18,37. **Los doce pasan AA (4,5:1); el peor es verdes
 * con 5,47.** Lo afirma `tests/familia-color.test.mjs`, que recalcula los doce.
 */
export const FAMILIAS = [
  { id: 'rojos',     nombre: 'Rojos',     color: '#A81D1D', texto: '#FFFFFF' },
  { id: 'naranjas',  nombre: 'Naranjas',  color: '#B34508', texto: '#FFFFFF' },
  { id: 'amarillos', nombre: 'Amarillos', color: '#FFC400', texto: '#10101A' },
  { id: 'verdes',    nombre: 'Verdes',    color: '#2E9E3E', texto: '#10101A' },
  { id: 'aguas',     nombre: 'Aguas',     color: '#10A8A1', texto: '#10101A' },
  { id: 'azules',    nombre: 'Azules',    color: '#1A5FB4', texto: '#FFFFFF' },
  { id: 'violetas',  nombre: 'Violetas',  color: '#5E2FBB', texto: '#FFFFFF' },
  { id: 'rosas',     nombre: 'Rosas',     color: '#C02A74', texto: '#FFFFFF' },
  { id: 'marrones',  nombre: 'Marrones',  color: '#7A4E24', texto: '#FFFFFF' },
  { id: 'grises',    nombre: 'Grises',    color: '#91919B', texto: '#10101A' },
  { id: 'blancos',   nombre: 'Blancos',   color: '#FFFFFF', texto: '#10101A' },
  { id: 'negros',    nombre: 'Negros',    color: '#141418', texto: '#FFFFFF' },
];

/**
 * El cajón de las tapas cuyo color no se conoce: las que sólo vienen de «w
 * three» y no están en `mosaico_colores_v1`, y las que fallan al calcularse al
 * vuelo.
 *
 * ⚠️ **NO es una familia de color y por eso no lleva color propio** (se pinta
 * con variables de tema, punteada). Y lo que importa de verdad:
 * **entra en «Todos»**, nunca se esconde. Regla de Ian del 09/10: «una tapa que
 * se esfuma al filtrar es peor que una mal clasificada».
 */
export const SIN_COLOR = 'sincolor';
export const SIN_COLOR_NOMBRE = 'Sin color';

/** Los ids válidos, incluido el cajón de las desconocidas. */
export const IDS_FAMILIA = [...FAMILIAS.map(f => f.id), SIN_COLOR];

/**
 * La familia de un color en LCh. `h` en grados [0,360), `C` y `L` como los
 * devuelve `labALch()`.
 *
 * El orden de las preguntas importa: primero el neutro (sin tono no hay
 * familia de tono que valga), después los marrones (que son un recorte DENTRO
 * del tramo cálido, no un tramo propio), y al final el tono a secas.
 */
export function familiaDeLch(L, C, h) {
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(h)) return SIN_COLOR;
  if (C < CROMA_NEUTRO) {
    if (L < L_NEGRO) return 'negros';
    if (L >= L_BLANCO) return 'blancos';
    return 'grises';
  }
  const t = ((h % 360) + 360) % 360;
  // Los marrones viven dentro del cálido (20°-95°) y se separan por ser
  // oscuros Y apagados. Sin este recorte, «marrones» no existiría y sus 525
  // tapas se repartirían entre rojos, naranjas y amarillos.
  if (t >= 20 && t < 95 && L < MARRON_L_MAX && C < MARRON_C_MAX) return 'marrones';
  if (t >= 330 || t < 20) return 'rosas';
  if (t < 48) return 'rojos';
  if (t < 82) return 'naranjas';
  if (t < 120) return 'amarillos';
  if (t < 160) return 'verdes';
  if (t < 215) return 'aguas';
  if (t < 308) return 'azules';
  return 'violetas';
}

/**
 * Lo mismo, desde un sRGB de 8 bits — que es lo que sale de `mediaDeRejilla()`.
 * Es el único punto por donde entra el color en la vista.
 *
 * Importa de `cover-color.js` a propósito: la conversión a LCh ya vive ahí, con
 * su banco, y escribirla otra vez acá sería la cuarta copia de una función de
 * formato que este repo ya aprendió a no tener. Los dos módulos son puros, así
 * que esto sigue corriendo en Node sin navegador.
 */
export function familiaDeRgb(r, g, b) {
  const [L, C, h] = labALch(srgb8ALab(r, g, b));
  return familiaDeLch(L, C, h);
}
