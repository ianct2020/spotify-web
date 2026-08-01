// Pila única de modales para toda la app. Un solo listener global de ESC,
// un solo scroll-lock del body, z-index incremental. El modal de abajo pasa
// a visibility:hidden (no display:none, para no perder el scroll interno).
//
// Uso mínimo:
//   const overlay = openModal({ html: '<div class="modal">…</div>', onClose });
//   overlay.querySelector('#mi-boton-x').onclick = () => closeTop();
//   // O ponele [data-close-modal] al botón X y cierra solo.
//
// Backdrop click → closeAll. ESC → closeTop. Botón "←" auto-inyectado
// cuando la pila tiene más de 1 modal (vuelve al anterior).

const stack = [];
let savedScrollY = 0;
let escAttached = false;

function onKeydown(e) {
  if (e.key === 'Escape' && stack.length) {
    e.preventDefault();
    closeTop();
  }
}

function lockBody() {
  savedScrollY = window.scrollY || window.pageYOffset || 0;
  // position:fixed + top negativo evita saltos al restaurar (funciona bien
  // en iOS también). El overflow:hidden vive en la clase .modal-open.
  document.body.style.top = `-${savedScrollY}px`;
  document.body.classList.add('modal-open');
}

function unlockBody() {
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, savedScrollY);
}

function updateBackArrows() {
  for (let i = 0; i < stack.length; i++) {
    const isTop = i === stack.length - 1;
    const showBack = isTop && stack.length > 1;
    stack[i].backBtn.style.display = showBack ? 'flex' : 'none';
  }
}

function openModal({ id = null, html = '', onClose = null, onBack = null, className = '' } = {}) {
  if (stack.length === 0) {
    lockBody();
    if (!escAttached) {
      document.addEventListener('keydown', onKeydown);
      escAttached = true;
    }
  } else {
    // Ocultamos el modal anterior sin destruirlo (mantiene su scroll interno)
    stack[stack.length - 1].overlay.style.visibility = 'hidden';
  }

  const overlay = document.createElement('div');
  overlay.className = ('modal-overlay ms-overlay ' + (className || '')).trim();
  overlay.style.zIndex = String(500 + stack.length * 10);
  if (id) overlay.dataset.stackId = id;
  overlay.innerHTML = html;

  // Botón "Volver" flotante, arriba a la izquierda del viewport (fuera de
  // flow flex del overlay). Se muestra solo cuando la pila tiene >1 modal.
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'ms-back';
  backBtn.title = 'Volver';
  backBtn.setAttribute('aria-label', 'Volver al anterior');
  backBtn.innerHTML = '←';
  backBtn.style.display = 'none';
  backBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const entry = stack[stack.length - 1];
    if (entry && entry.onBack) {
      try { entry.onBack(); } catch { /* noop */ }
    }
    closeTop();
  });
  overlay.appendChild(backBtn);

  overlay.addEventListener('click', (e) => {
    // Backdrop → cerrar todo
    if (e.target === overlay) {
      closeAll();
      return;
    }
    // Botones marcados con [data-close-modal] → cerrar el top
    const closer = e.target.closest && e.target.closest('[data-close-modal]');
    if (closer && overlay.contains(closer)) {
      e.preventDefault();
      e.stopPropagation();
      closeTop();
    }
  });

  document.body.appendChild(overlay);

  stack.push({ id, overlay, backBtn, onClose, onBack });
  updateBackArrows();

  return overlay;
}

function closeTop() {
  if (!stack.length) return;
  const entry = stack.pop();
  if (entry.onClose) {
    try { entry.onClose(); } catch { /* noop */ }
  }
  entry.overlay.remove();
  if (stack.length) {
    stack[stack.length - 1].overlay.style.visibility = '';
    updateBackArrows();
  } else {
    unlockBody();
  }
}

function closeAll() {
  while (stack.length) {
    const entry = stack.pop();
    if (entry.onClose) {
      try { entry.onClose(); } catch { /* noop */ }
    }
    entry.overlay.remove();
  }
  unlockBody();
}

function getStack() {
  return stack.slice();
}

// Cierra un modal por id (y todos los que quedaron por encima). Útil cuando
// una feature quiere cerrar su propio modal sin importar si otro se apiló
// después (raro, pero pasa con confirmaciones anidadas).
function closeById(id) {
  const idx = stack.findIndex(e => e.id === id);
  if (idx < 0) return false;
  while (stack.length > idx) closeTop();
  return true;
}

export { openModal, closeTop, closeAll, getStack, closeById };
