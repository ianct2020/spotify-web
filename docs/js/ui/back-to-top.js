// Botón flotante "Volver arriba" (v=141), transversal a toda la app.
//
// El problema de hacerlo vista por vista es que cada una scrollea en un
// ancestro distinto: en #skips el que scrollea es el propio grid
// (`max-height: 74vh; overflow-y: auto`), en #sin-clasificar es el documento, y
// en #covers depende de si está el modo pantalla completa. Eso es justo lo que
// resuelve `scrollRootOf()` de ui/incremental-list.js, así que se reutiliza.
//
// Pero el root de verdad se descubre solo, sin pasar por una lista por vista:
// los eventos `scroll` NO burbujean, pero SÍ se capturan en `document`, así que
// un único listener en fase de captura ve el scroll de cualquier elemento de la
// página. El que dispara es, por definición, el que scrollea. `scrollRootOf()`
// se usa para sembrar el estado al entrar a una ruta (por si la vista ya viene
// con scroll, p. ej. tras un `preserveRendered`).
//
// El botón vive en la capa de abajo (ui/bottom-layer.js), en el slot
// 'backtotop', así que por construcción no puede taparse con el player: son dos
// items del mismo flex column.

import { mountBottom, publishHeight } from './bottom-layer.js?v=188';
import { scrollRootOf } from './incremental-list.js?v=188';
import { animationsEnabled } from './reveal.js?v=188';

// Aparece pasadas ~2 pantallas de scroll.
const SHOW_AFTER_SCREENS = 2;

let btn = null;
let scroller = null;      // el elemento que scrollea (null = el documento)
let installed = false;

function scrollTopOf(el) {
  return el ? el.scrollTop : (document.scrollingElement || document.documentElement).scrollTop;
}

function clientHeightOf(el) {
  return el ? el.clientHeight : window.innerHeight;
}

// ── Subir con animación (v=170) ──────────────────────────────────────────────
//
// ⚠️ **`behavior: 'smooth'` NO anima si el sistema pide movimiento reducido.**
// Chrome (y Firefox) tratan `prefers-reduced-motion: reduce` como una orden
// sobre el scroll suave nativo y saltan de golpe. Ian tiene
// `enable-animations=false` en GNOME, así que **el camino sin animación era
// siempre el suyo** y el botón le subía de un tirón desde v=141.
//
// Es la misma decisión que se tomó en v=162 con las animaciones de entrada:
// quién anima lo decide `animationsEnabled()` en JS —el toggle del panel de
// paleta, con sus tres estados— y no el media query, porque el toggle puede
// forzar por encima del sistema. Por eso el scroll se hace a mano con
// `requestAnimationFrame`: es la única forma de que el modo «siempre» pueda
// ganarle a la preferencia del sistema.
//
// Con el toggle en «nunca» salta de una, que es lo pedido.

const DURACION_MS = 420;

// easeOutCubic: arranca rápido y frena al llegar. Sin rebote: el destino es el
// tope de la lista y pasarse aunque sea un frame se lee como un tirón.
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

let animacionEnCurso = null;

function ponerScroll(target, top) {
  if (target === document.scrollingElement || target === document.documentElement) {
    // `scrollTo` sobre el elemento raíz también vale, pero `window.scrollTo`
    // es lo que respetan todos los navegadores por igual para el documento.
    window.scrollTo(0, top);
  } else {
    target.scrollTop = top;
  }
}

function subirSuave(target) {
  if (animacionEnCurso) cancelAnimationFrame(animacionEnCurso);
  animacionEnCurso = null;

  const desde = scrollTopOf(target === (document.scrollingElement || document.documentElement) ? null : target);
  if (desde <= 0) return;
  if (!animationsEnabled()) { ponerScroll(target, 0); return; }

  const t0 = performance.now();
  const paso = (ahora) => {
    const t = Math.min(1, (ahora - t0) / DURACION_MS);
    ponerScroll(target, Math.round(desde * (1 - easeOutCubic(t))));
    if (t < 1) {
      animacionEnCurso = requestAnimationFrame(paso);
    } else {
      animacionEnCurso = null;
      // El último frame puede quedarse en 1 px por el redondeo.
      ponerScroll(target, 0);
    }
  };
  animacionEnCurso = requestAnimationFrame(paso);
}

// Si el usuario scrollea durante la animación, manda él: cancelamos. Sin esto,
// la animación le pelea la rueda del ratón hasta que termina.
function cancelarSubida() {
  if (!animacionEnCurso) return;
  cancelAnimationFrame(animacionEnCurso);
  animacionEnCurso = null;
}

function ensureBtn() {
  if (btn && btn.isConnected) return btn;
  btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top';
  btn.title = 'Volver arriba';
  btn.setAttribute('aria-label', 'Volver arriba');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
  btn.addEventListener('click', () => {
    const target = scroller || document.scrollingElement || document.documentElement;
    subirSuave(target);
    hide();
  });
  mountBottom('backtotop', btn);
  return btn;
}

function show() {
  const b = ensureBtn();
  if (b.classList.contains('show')) return;
  b.classList.add('show');
  publishHeight();
}

function hide() {
  if (!btn || !btn.classList.contains('show')) return;
  btn.classList.remove('show');
  publishHeight();
}

// Decide visibilidad para un candidato a scroller. Devuelve true si ese
// elemento es el que manda ahora mismo.
function evaluate(el) {
  // Durante la subida el botón ya se escondió: los `scroll` que dispara la
  // propia animación no pueden volver a encenderlo. Sin esto el botón
  // reaparece durante los 420 ms y se apaga al final — un parpadeo que con el
  // salto de golpe no existía porque no había frames intermedios.
  if (animacionEnCurso) return false;
  const top = scrollTopOf(el);
  const umbral = clientHeightOf(el) * SHOW_AFTER_SCREENS;
  if (top > umbral) {
    scroller = el;
    show();
    return true;
  }
  // Solo esconde si el que dejó de estar abajo es el que teníamos fichado:
  // el scroll de un panel lateral cualquiera no puede apagar el botón de la
  // lista larga que el usuario está recorriendo.
  if (el === scroller || (!scroller && el === null)) hide();
  return false;
}

function onScrollCapture(e) {
  const t = e.target;
  // El scroll del documento llega con target = document (o el <html>).
  const el = (t === document || t === document.documentElement || t === document.body) ? null : t;
  if (el && !(el instanceof Element)) return;
  evaluate(el);
}

// Al cambiar de ruta el scroller viejo ya no existe: se resetea y se vuelve a
// sembrar contra lo que haya pintado la vista nueva.
function resetForRoute() {
  cancelarSubida();
  scroller = null;
  hide();
  // Dos rAF: la vista se pinta de forma asíncrona y el primer frame suele
  // llegar con el placeholder del router todavía puesto.
  requestAnimationFrame(() => requestAnimationFrame(seed));
}

function seed() {
  const main = document.getElementById('main-content');
  if (!main) return;
  // Candidatos: cualquier descendiente que scrollee de verdad, más el
  // documento. scrollRootOf sube desde el nodo, así que se lo damos ya
  // resuelto por cada contenedor grande.
  const cands = new Set();
  for (const el of main.querySelectorAll('.sc-grid, .skips-grid, [data-scroll-root]')) {
    const root = scrollRootOf(el);
    if (root) cands.add(root);
  }
  cands.add(null); // el documento
  for (const c of cands) {
    if (evaluate(c)) return;
  }
}

function installBackToTop() {
  if (installed) return;
  installed = true;
  // Captura: `scroll` no burbujea, pero sí se captura. Un solo listener para
  // toda la app, sea cual sea el ancestro que scrollee. Pasivo: no lo
  // cancelamos nunca y así no penaliza el scroll.
  document.addEventListener('scroll', onScrollCapture, { capture: true, passive: true });
  // La rueda / el touch / el teclado le ganan a la animación en curso.
  for (const ev of ['wheel', 'touchstart', 'keydown']) {
    document.addEventListener(ev, cancelarSubida, { capture: true, passive: true });
  }
  // El router lo dispara en cada cambio de ruta, antes de pintar la nueva.
  document.addEventListener('routeteardown', resetForRoute);
  requestAnimationFrame(() => requestAnimationFrame(seed));
}

export { installBackToTop };
