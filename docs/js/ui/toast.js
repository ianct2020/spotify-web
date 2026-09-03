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
// Un caller puede forzar el comportamiento pasando `duration`: un número de ms
// para que se cierre solo, o 0 / Infinity para que se quede.

import { mountBottom } from './bottom-layer.js?v=193';

const WRITE_DURATION_MS = 30000;
const INFO_DURATION_MS = 8000;
const MAX_VISIBLE = 3;
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
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
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

  // Techo de 3. El contenedor es column-reverse (el más nuevo abajo), así que
  // los más viejos son los primeros hijos del DOM. Se sacan sin animación de
  // salida para que el hueco no quede colgando mientras entra el nuevo.
  const live = [...container.querySelectorAll('.toast:not(.toast-exit)')];
  for (const old of live.slice(0, Math.max(0, live.length - MAX_VISIBLE))) {
    old._cancelTimer?.();
    old.remove();
  }
}

export { showToast };
