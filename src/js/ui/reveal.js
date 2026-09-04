// Animaciones de entrada al scrollear (v=159) — Dashboard y Wrapped.
//
// ═══════════════════════════════════════════════════════════════════════════
// LA REGLA DURA: si algo falla, el contenido queda VISIBLE.
// ═══════════════════════════════════════════════════════════════════════════
//
// Y se garantiza POR ESTRUCTURA, no por cuidado al escribir cada llamada:
//
//   · El CSS **no oculta nada**. `.reveal-armed` es la clase que esconde, y la
//     pone el JS justo antes de observar el elemento. Lo que el CSS describe es
//     la transición, no el estado inicial.
//
//       mal:  .reveal { opacity: 0 }          ← sin JS, invisible para siempre
//       bien: .reveal-armed { opacity: 0 }    ← sin JS, la clase nunca aparece
//
//   · Si este módulo no se importa, si tira al importarse, si
//     `IntersectionObserver` no existe o si `observe()` falla, `.reveal-armed`
//     **no se agrega** y la vista se ve exactamente igual que antes de v=159.
//
//   · Al cambiar de ruta (`routeteardown`) se barre el documento y se desarma
//     todo lo que quedó armado sin revelarse. Ningún elemento puede quedar
//     invisible por un observer que se fue.
//
//   · Cuando la animación termina, las clases y el `transition-delay` inline se
//     QUITAN. El elemento vuelve a su estado limpio, así que `.reveal-in` no le
//     pisa las transiciones propias (`.year-tile` tiene la suya para el
//     `:active`, y una regla suelta con la misma especificidad le ganaría por
//     orden de hoja). **Menos en modo `repetir`**, donde tienen que quedarse
//     para poder volver a esconder el elemento: ese modo es para probar.
//
//   · Ni siquiera en modo `repetir` un elemento puede quedar invisible sin un
//     observer que lo mire: lo que hace ese modo es NO llamar a `unobserve`,
//     no soltar la vigilancia.
//
// El fallo por defecto es «sin animación», nunca «sin contenido».
//
// ───────────────────────────────────────────────────────────────────────────
// Qué se anima y qué no
//
// Solo opacidad y `translateY`. Nada de `display`, nada de alto: un contenedor
// en `opacity: 0` **sigue midiendo**, que es lo que hace que animar los charts
// sea seguro. Chart.js necesita ancho real al instanciarse (por eso el doble
// `requestAnimationFrame` + `chart.resize()` de `onReveal` en las fichas), y
// aquí se anima el CONTENEDOR con el chart ya construido dentro. Lo que no se
// puede es instanciar dentro del callback del observer ni con el contenedor en
// `display: none`: ahí mide 0 y queda roto para siempre.
//
// Los `prefers-reduced-motion` que ya existían en las hojas NO se tocan. El
// shimmer de los esqueletos se ajustó en la tanda 7 para ATENUARSE en vez de
// apagarse, y eso sigue igual.

import { prefKey } from '../storage.js';

const ARMED = 'reveal-armed';
const IN = 'reveal-in';

// ⚠️ Tiene que coincidir con la duración de `.reveal-armed` en `css/main.css`.
// Solo se usa como backstop para limpiar las clases si `transitionend` no
// llega (pestaña oculta, elemento sacado del DOM a mitad); si se quedara corto
// lo único que pasa es que el elemento salta a su estado final, que es el
// visible.
const DUR_MS = 520;

const KEY_BASE = 'fonoteca_anim_v1';

// Tres modos. `repetir` es el modo de PRUEBA: ver más abajo, en `alEntrar`.
export const MODOS = ['siempre', 'repetir', 'nunca'];

// ── la preferencia ──────────────────────────────────────────────────────────
//
// ⚠️ **Estas animaciones ya NO miran `prefers-reduced-motion`** (v=162, decisión
// de Ian). Van encendidas por defecto y solo las apaga el toggle.
//
// El motivo: Ian tiene `enable-animations = false` en GNOME, así que el modo
// «sigue al sistema» —que era el de fábrica— dejaba la entrada apagada en su
// propia máquina, que es donde se mira. La preferencia del sistema sigue
// mandando en todo lo demás: **los diez bloques `@media (prefers-reduced-motion)`
// de las hojas no se tocan** (el shimmer atenuado de los esqueletos de la tanda
// 7 y las barritas del reproductor de v=141 siguen exactamente como estaban).
//
// El modo viejo `'auto'` que haya guardado se lee como `'siempre'`: quien no
// eligió nada tenía el de fábrica, y el de fábrica ahora es encendido.
const MODO_POR_DEFECTO = 'siempre';

/** 'siempre' (por defecto) · 'repetir' · 'nunca'. */
export function getAnimMode() {
  try {
    const v = localStorage.getItem(prefKey(KEY_BASE));
    if (v === 'nunca') return 'nunca';
    if (v === 'repetir') return 'repetir';
    return MODO_POR_DEFECTO;
  } catch {
    return MODO_POR_DEFECTO;
  }
}

export function setAnimMode(modo) {
  const m = MODOS.includes(modo) ? modo : MODO_POR_DEFECTO;
  try { localStorage.setItem(prefKey(KEY_BASE), m); } catch { /* lleno o sin localStorage */ }
  return m;
}

/**
 * Si el sistema operativo pide movimiento reducido.
 *
 * Se conserva porque sigue siendo el dato correcto para cualquier animación que
 * SÍ deba respetarlo. Las de entrada al scrollear ya no lo consultan.
 */
export function systemAsksReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

export function animationsEnabled() {
  return getAnimMode() !== 'nunca';
}

/**
 * Modo de prueba: la entrada se repite cada vez que el elemento vuelve a
 * asomar, en vez de dispararse una sola vez por elemento.
 *
 * Para qué existe: con el modo normal, un elemento que NO se anima es
 * indistinguible de uno que ya se animó — al volver a subir y bajar no pasa
 * nada en ninguno de los dos casos, así que barrer una vista buscando lo que
 * quedó sin animar obliga a recargarla entera por cada tramo. En `repetir` la
 * comparación es directa: lo que se anima parpadea en cada pasada, lo que no,
 * no lo hace nunca.
 */
export function repeatReveal() {
  return getAnimMode() === 'repetir';
}

// ── el observer ─────────────────────────────────────────────────────────────

let io = null;

function alEntrar(entries) {
  // Se lee UNA vez por tanda y no por elemento: dentro de la misma tanda todos
  // los elementos tienen que decidir igual, aunque el toggle cambie a mitad.
  const repetir = repeatReveal();
  for (const e of entries) {
    if (e.isIntersecting) {
      // Modo normal: una sola vez, al volver a scrollear no se re-anima. En
      // `repetir` el elemento SIGUE observado, que es todo el truco.
      if (!repetir) {
        try { io.unobserve(e.target); } catch { /* ya no está */ }
      }
      revelar(e.target, repetir);
    } else if (repetir) {
      rearmar(e.target);
    }
  }
}

function ensureIO() {
  if (io) return io;
  io = new IntersectionObserver(alEntrar, {
    // Un pelín adentro del viewport para que la entrada se lea como entrada y
    // no como un parpadeo en el borde. Lo que ya está en pantalla al pintar
    // dispara igual, en la primera pasada del observer.
    rootMargin: '0px 0px -6% 0px',
    threshold: 0.01,
  });
  return io;
}

function desarmar(el) {
  el.classList.remove(ARMED, IN);
  el.style.transitionDelay = '';
}

/**
 * Vuelve a dejar el elemento en su estado inicial (invisible) al salir de
 * pantalla, SOLO en modo repetir.
 *
 * El `transition: none` inline no es cosmético: sin él, el elemento se
 * desvanecería durante 520 ms mientras se va, y con un scroll de vuelta
 * inmediato lo que se ve es un elemento a medio camino en vez de la entrada
 * limpia. Va inline porque así le gana a cualquier regla de la hoja sin
 * necesidad de un `!important`. El `offsetHeight` fuerza el reflujo: sin él,
 * el navegador junta el quitar la clase y el devolver la transición en el
 * mismo estilo calculado y la transición se dispara igual.
 */
function rearmar(el) {
  if (!el.classList.contains(IN)) return;   // ya estaba rearmado
  el.style.transition = 'none';
  el.classList.remove(IN);
  el.classList.add(ARMED);
  void el.offsetHeight;
  el.style.transition = '';
}

/**
 * `mantenerArmado` (modo repetir) deja las clases puestas al terminar: el
 * elemento tiene que poder volver a `.reveal-armed` sin `.reveal-in` cuando
 * salga de pantalla, y para eso la clase que esconde no se puede haber ido.
 *
 * El precio es que en ese modo el elemento se queda con `will-change` y con la
 * transición de la entrada encima de las suyas — por eso `repetir` es un modo
 * para probar y no el de fábrica.
 */
function revelar(el, mantenerArmado = false) {
  el.classList.add(IN);
  if (mantenerArmado) return;

  let backstop = 0;
  const limpiar = (ev) => {
    // `transitionend` llega una vez por propiedad (opacity y transform). Las
    // dos duran lo mismo, así que se espera a la de opacidad y se ignora la
    // otra: limpiar con la primera cortaría la animación por la mitad.
    if (ev && ev.propertyName !== 'opacity') return;
    el.removeEventListener('transitionend', limpiar);
    clearTimeout(backstop);
    desarmar(el);
  };

  const espera = DUR_MS + (parseFloat(el.style.transitionDelay) || 0) + 120;
  backstop = setTimeout(limpiar, espera);
  el.addEventListener('transitionend', limpiar);
}

// ── la API ──────────────────────────────────────────────────────────────────

/**
 * Arma UN elemento: le pone el estado inicial y lo registra en el observer, en
 * el mismo paso. Devuelve `true` si quedó armado.
 *
 * Los dos van juntos a propósito: no hay ningún camino en el que el elemento
 * quede oculto sin un observer que lo revele.
 */
export function armReveal(el, { delay = 0 } = {}) {
  if (!el || !el.classList) return false;
  if (!animationsEnabled()) return false;
  if (typeof IntersectionObserver !== 'function') return false;

  try {
    const obs = ensureIO();
    if (delay) el.style.transitionDelay = `${delay}ms`;
    el.classList.add(ARMED);
    obs.observe(el);
    return true;
  } catch (e) {
    // Cualquier fallo deja el elemento como estaba: visible.
    try { desarmar(el); } catch { /* nada que deshacer */ }
    console.warn('[reveal] no pude armar, el elemento queda visible:', e);
    return false;
  }
}

/**
 * Arma todo lo que matchee `selector` dentro de `root`, en cascada.
 *
 * El escalonado se corta en `maxStagger` elementos: con 20 filas y 45 ms cada
 * una la última entraría casi un segundo tarde, y eso ya no se lee como
 * cascada sino como que la página va lenta.
 *
 * ⚠️ **El escalonado se bajó a la mitad en v=162.** Con scroll rápido, un
 * `stagger` de 45 ms cortado en 6 dejaba 270 ms de retardo en el último
 * elemento, más los 520 ms de su transición: llegabas a la sección y todavía
 * había zona vacía abajo. Lo que se baja es el RETARDO ENTRE ELEMENTOS, no la
 * duración de cada uno — la entrada de cada tarjeta sigue durando 520 ms, que
 * es lo que la hace legible. La cascada se aprieta, no se acelera.
 */
export function armRevealAll(selector, root = document, { stagger = 22, maxStagger = 6 } = {}) {
  if (!animationsEnabled()) return 0;
  let n = 0;
  let els;
  try { els = root.querySelectorAll(selector); } catch { return 0; }
  els.forEach((el, i) => {
    if (armReveal(el, { delay: Math.min(i, maxStagger) * stagger })) n++;
  });
  return n;
}

/**
 * Suelta lo que quedó armado dentro de `root`, antes de repintarlo.
 *
 * Un `IntersectionObserver` mantiene una referencia FUERTE a lo que observa, así
 * que los nodos que se van con un `innerHTML = …` no se liberan solos. En el
 * Wrapped, cambiar de año repinta la tarjeta entera y sin esto cada click
 * dejaría atrás un juego de ~25 nodos observados.
 *
 * También los desarma, para que si alguno sobrevive al repintado quede visible.
 */
export function releaseReveal(root) {
  if (!root || !root.querySelectorAll) return;
  try {
    root.querySelectorAll('.' + ARMED).forEach(el => {
      try { io?.unobserve(el); } catch { /* ya no estaba observado */ }
      desarmar(el);
    });
  } catch { /* root inservible: nada que soltar */ }
}

// ── red de seguridad ────────────────────────────────────────────────────────
//
// Al cambiar de ruta, cualquier elemento que quedó armado y no llegó a
// revelarse se desarma. Normalmente esos nodos se van con el vaciado de
// `#main-content`, pero si alguno sobreviviera (un modal, un nodo movido) se
// queda VISIBLE en vez de invisible para siempre.
//
// Se registra una sola vez, al importar el módulo, y con la guarda de que
// `document` exista.
try {
  document.addEventListener('routeteardown', () => {
    try { io?.disconnect(); } catch { /* nunca se creó */ }
    io = null;
    document.querySelectorAll('.' + ARMED).forEach(desarmar);
  });
} catch { /* sin document: nada que limpiar */ }
