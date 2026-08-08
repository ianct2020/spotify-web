// Toasts de la app.
//
// v=126: los avisos importantes ya no se cierran solos. Ian se perdía errores y
// confirmaciones de guardado porque el toast se iba a los 4 segundos.
//   - error / success / warning → PEGAJOSOS. Solo se van con la ✕.
//     (todos los 'success' de la app confirman una operación de escritura:
//      playlists creadas, likes añadidos o sacados, sync, import.)
//   - info → sigue con auto-cierre, pero de 4s pasó a 10s.
//   - TODOS llevan ✕ visible.
// Un caller puede forzar el comportamiento pasando `duration`: un número de ms
// para que se cierre solo, o 0 / Infinity para que se quede.

const INFO_DURATION_MS = 10000;
const STICKY_TYPES = new Set(['error', 'success', 'warning']);

function ensureContainer() {
  let c = document.querySelector('.toast-container');
  if (!c) {
    c = document.createElement('div');
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
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
    ? (STICKY_TYPES.has(type) ? 0 : INFO_DURATION_MS)
    : duration;
  if (ms && Number.isFinite(ms)) timer = setTimeout(dismiss, ms);

  container.appendChild(toast);
}

export { showToast };
