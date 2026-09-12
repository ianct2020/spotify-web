// Marquesina en hover para listas densas (v=215).
//
// Para qué existe, y por qué NO es `ui/marquee.js`. La marquesina de siempre
// arranca sola, en loop, en todos los elementos que desborden. Con las cinco
// columnas y los cientos de filas de `#wthree` eso sería la pantalla entera
// moviéndose todo el tiempo: marea. Acá el texto está QUIETO salvo en la fila
// que el mouse está tocando.
//
// ⚠️ **Esta marquesina NO consulta `prefers-reduced-motion`** (decisión de Ian,
// v=215). Es exactamente el caso de v=162 con las animaciones de entrada: Ian
// tiene `enable-animations = false` en GNOME, así que Chrome le reporta
// `reduce` y la marquesina de `ui/marquee.js` ya viene apagada en su máquina —
// medido en su propio Chrome el 2026-09-11:
// `matchMedia('(prefers-reduced-motion: reduce)').matches === true`. Como el
// wrap clippea sin elipsis, el resultado hoy es el corte a secas a mitad de
// letra, que es el «queda feo» que había que arreglar. Respetar la preferencia
// del sistema acá no habría cambiado un píxel en la pantalla donde se mira.
//
// El único control es **el toggle de animaciones de la app**. Con las
// animaciones en «nunca» el texto no se mueve nunca y en su lugar se pone un
// `title`, que es la red nativa: el nombre entero sigue siendo alcanzable.
//
// En reposo hay **elipsis**, que `ui/marquee.js` no tiene: el `.mq-t` clippea y
// trunca él mismo, y solo al desbordar en hover pasa a `width: max-content`
// para poder trasladarse.

import { animationsEnabled } from './reveal.js?v=215';

// Velocidad del recorrido, en píxeles por segundo. El ciclo dura lo que tarde
// el texto en recorrer su propio sobrante a esta velocidad, más las pausas de
// los extremos: un nombre que sobra 20 px no puede tardar lo mismo que uno que
// sobra 200 o el primero parece congelado y el segundo, un cartel de autopista.
const PX_POR_SEGUNDO = 45;
// Pausas de los extremos (las de los keyframes, sumadas). Mantener a la par de
// `@keyframes wt-mq-slide` en `css/main.css`.
const PAUSAS_S = 2.4;
const DUR_MIN_S = 1.6;

/**
 * Mide los `.mq` que haya dentro de `fila` y prepara los que desborden.
 *
 * Se llama **en el `mouseover` de la fila**, no al renderizar: medir
 * `scrollWidth` fuerza layout, y hacerlo sobre cientos de filas × 2 líneas al
 * pintar la vista es justo el coste que esta vista no puede pagar. Sobre una
 * fila son dos lecturas y se acabó.
 *
 * Tampoco se cachea el veredicto: la única forma de que envejezca es que cambie
 * el ancho de la columna (resize), y cachearlo obligaría a invalidar por ahí.
 * Vuelve a medir en cada entrada del mouse, que sale más barato que la
 * invalidación.
 */
export function prepararMarquesinaFila(fila) {
  const animado = animationsEnabled();
  fila.querySelectorAll('.mq').forEach(wrap => {
    const texto = wrap.querySelector('.mq-t');
    if (!texto) return;
    // `.mq-t` está truncado con elipsis en reposo, así que su `scrollWidth` es
    // el ancho real del contenido y su `clientWidth`, el visible.
    const sobra = texto.scrollWidth - texto.clientWidth;
    if (sobra <= 1) {
      wrap.classList.remove('mq-on');
      wrap.removeAttribute('title');
      return;
    }
    if (!animado) {
      // Sin animaciones: el texto se queda con su elipsis y el nombre entero
      // queda a mano en el tooltip nativo.
      wrap.classList.remove('mq-on');
      wrap.title = texto.textContent;
      return;
    }
    wrap.removeAttribute('title');
    const dur = Math.max(DUR_MIN_S, sobra / PX_POR_SEGUNDO) + PAUSAS_S;
    wrap.style.setProperty('--mq-shift', `-${sobra}px`);
    wrap.style.setProperty('--mq-dur', `${dur.toFixed(2)}s`);
    wrap.classList.add('mq-on');
  });
}

/** Deja la fila quieta otra vez. */
export function pararMarquesinaFila(fila) {
  fila.querySelectorAll('.mq.mq-on').forEach(wrap => wrap.classList.remove('mq-on'));
}

/**
 * Cablea la marquesina en hover para todas las filas que casen con `selector`
 * dentro de `root`, por delegación.
 *
 * `mouseover`/`mouseout` y no `mouseenter`/`mouseleave`: estos últimos no
 * burbujean, así que no se pueden delegar en el contenedor — y delegar es lo
 * que hace que un repintado de la lista no obligue a recablear nada.
 *
 * Que el JS SAQUE `mq-on` al salir (en vez de dejar que la regla cuelgue de un
 * `:hover`) es lo que mantiene la hoja genérica: el CSS no tiene que conocer
 * cuántos niveles hay entre la fila y el `.mq`.
 */
// ⚠️ `wireHoverMarquee` se llama en cada repintado de la vista, y el contenedor
// SOBREVIVE al repintado (se le reemplaza el `innerHTML`, no el elemento). Sin
// esta guarda, cada filtro de `#wthree` dejaba un par de listeners más sobre el
// mismo nodo. `activateMarquee`, que es lo que había antes, no cableaba nada y
// por eso podía llamarse sin cuidado: el peligro entra con la delegación.
const YA_CABLEADOS = new WeakMap();

export function wireHoverMarquee(root, selector) {
  let selectores = YA_CABLEADOS.get(root);
  if (!selectores) YA_CABLEADOS.set(root, selectores = new Set());
  if (selectores.has(selector)) return;
  selectores.add(selector);

  root.addEventListener('mouseover', (e) => {
    const fila = e.target.closest?.(selector);
    if (!fila || !root.contains(fila)) return;
    // Moverse de un hijo a otro dentro de la MISMA fila vuelve a disparar
    // `mouseover`; con esto se mide una sola vez por entrada real.
    if (fila.contains(e.relatedTarget)) return;
    prepararMarquesinaFila(fila);
  });
  root.addEventListener('mouseout', (e) => {
    const fila = e.target.closest?.(selector);
    if (!fila || !root.contains(fila)) return;
    if (fila.contains(e.relatedTarget)) return;
    pararMarquesinaFila(fila);
  });
}

/** El HTML de un texto con marquesina en hover. */
export function hoverMarqueeSpan(html, extraClass = '') {
  return `<span class="mq ${extraClass}"><span class="mq-t">${html}</span></span>`;
}
