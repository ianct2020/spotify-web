// Toasts de la app.
//
// v=126: los avisos importantes dejaron de cerrarse solos, porque Ian se perdía
// errores y confirmaciones de guardado a los 4 segundos.
//
// v=130: pegajosos para siempre era demasiado — la pila crecía sin techo y
// tapaba la app. Ahora:
//   - error / success / warning (confirmaciones de escritura) → 30 s, con ✕.
//   - info (avisos menores) → 8 s.
//   - TODOS llevan ✕ visible.
//   - Como mucho 3 en pantalla: al llegar el cuarto se va el más viejo.
//
// v=246: el tope pasó a 4 por un encargo que partía de una premisa falsa
// («los toasts se apilan sin tope»: el de 3 existía desde v=130 y funcionaba).
// v=248 lo devuelve a 3. Lo que sí estaba roto, y v=246 arregló, es el retiro:
// quitar un toast descartado ya no cuelga de `animationend`. Hasta v=245
// `dismiss()` solo ponía `.toast-exit` y esperaba ese evento para quitar el
// nodo; si la animación no corre —pestaña oculta o en segundo plano, que es
// donde corre la extensión con la que se prueba— el evento no llega nunca y el
// toast se quedaba en pantalla con opacidad 1. Y como el tope solo cuenta los
// que NO están en `.toast-exit`, esos zombis no ocupaban cupo: cada toast que
// caducaba dejaba un cadáver y los nuevos se apilaban encima sin techo.
//
// Un caller puede forzar el comportamiento pasando `duration`: un número de ms
// para que se cierre solo, o 0 / Infinity para que se quede.
//
// ⚠️ La deduplicación de los avisos NO vive acá: la hace cada llamador
// (`avisar()` de `util/hidden-sync.js`, por tipo + mensaje). Este módulo solo
// pone el techo de lo que hay a la vez. Un aviso que el techo expulsa ya no
// vuelve a salir esa sesión si su llamador lo deduplica, y es a propósito:
// `avisar()` sigue mandando cada mensaje distinto una vez, que es lo que arregló
// v=229.

import { mountBottom } from './bottom-layer.js?v=266';

const WRITE_DURATION_MS = 30000;
const INFO_DURATION_MS = 8000;
const MAX_VISIBLE = 3;
// Lo que dura `toast-out` en main.css (0.2 s), más margen. Es la red de
// seguridad del retiro, no la animación.
const EXIT_SAFETY_MS = 450;
const WRITE_TYPES = new Set(['error', 'success', 'warning']);

function ensureContainer() {
  let c = document.querySelector('.toast-container');
  if (!c) {
    c = document.createElement('div');
    c.className = 'toast-container';
  }
  // Siempre en el slot 'toasts' de la capa de abajo: ya no se posiciona solo
  // (era `fixed` en la misma esquina que el player y el progreso, y con los
  // tres a la vez se tapaban). `mountBottom` es idempotente.
  return mountBottom('toasts', c);
}

function showToast(message, type = 'info', duration) {
  const container = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const text = document.createElement('span');
  text.textContent = message;
  text.style.flex = '1';
  toast.appendChild(text);

  let timer = null;
  let saliendo = false;
  const dismiss = () => {
    if (saliendo) return;
    saliendo = true;
    if (timer) clearTimeout(timer);
    toast.classList.add('toast-exit');
    const quitar = () => toast.remove();
    // Con la pestaña oculta nadie va a ver la salida y el navegador no la
    // corre: se quita ya, sin esperar un evento que no va a llegar.
    if (document.visibilityState === 'hidden') { quitar(); return; }
    toast.addEventListener('animationend', quitar, { once: true });
    // Y aunque esté visible, la salida no puede ser la única forma de irse.
    setTimeout(quitar, EXIT_SAFETY_MS);
  };

  // El texto de cualquier toast se puede seleccionar para copiarlo (antes solo
  // los de error).
  toast.style.userSelect = 'text';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Cerrar aviso';
  closeBtn.setAttribute('aria-label', 'Cerrar aviso');
  closeBtn.onclick = dismiss;
  toast.appendChild(closeBtn);

  const ms = duration === undefined
    ? (WRITE_TYPES.has(type) ? WRITE_DURATION_MS : INFO_DURATION_MS)
    : duration;
  if (ms && Number.isFinite(ms)) timer = setTimeout(dismiss, ms);
  toast._cancelTimer = () => { if (timer) clearTimeout(timer); };

  container.appendChild(toast);

  // Techo de MAX_VISIBLE. El contenedor es column-reverse (el más nuevo abajo), así que
  // los más viejos son los primeros hijos del DOM. Se sacan sin animación de
  // salida para que el hueco no quede colgando mientras entra el nuevo.
  const live = [...container.querySelectorAll('.toast:not(.toast-exit)')];
  for (const old of live.slice(0, Math.max(0, live.length - MAX_VISIBLE))) {
    old._cancelTimer?.();
    old.remove();
  }
}

export { showToast };
