// Pila única de modales para toda la app. Un solo listener global de ESC,
// un solo scroll-lock del body, z-index incremental. El modal de abajo pasa
// a visibility:hidden (no display:none, para no perder el scroll interno).
//
// Uso mínimo:
//   const overlay = openModal({ id, html: '<div class="modal">…</div>', onClose, onReveal });
//   overlay.querySelector('#mi-boton-x').onclick = () => closeTop();
//   // O ponele [data-close-modal] al botón X y cierra solo.
//
// Backdrop click → closeAll. ESC → closeTop. Botón "←" auto-inyectado
// cuando la pila tiene más de 1 modal — se pone INLINE al lado del botón
// [data-close-modal] del modal (o flotante como fallback).
//
// Dedup: si `id` ya está en la pila, cerramos los modales que están encima
// hasta dejar ese como top (y lo revelamos) — no apilamos duplicado.
// Tope de profundidad: MAX_DEPTH; si se supera, cerramos el de más abajo.

const MAX_DEPTH = 5;

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
  document.body.style.top = `-${savedScrollY}px`;
  document.body.classList.add('modal-open');
}

function unlockBody() {
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, savedScrollY);
}

function createBackBtn() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ms-back';
  btn.title = 'Volver';
  btn.setAttribute('aria-label', 'Volver al anterior');
  btn.innerHTML = '←';
  btn.style.display = 'none';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const entry = stack[stack.length - 1];
    if (entry && entry.onBack) {
      try { entry.onBack(); } catch { /* noop */ }
    }
    closeTop();
  });
  return btn;
}

// Inserta el ← INLINE, agrupado con el [data-close-modal] en un wrapper para
// que queden siempre pegados (arriba a la derecha del modal), incluso cuando
// el padre del close usa justify-content:space-between (que si no, separa el
// ← al medio y deja el ✕ al final). Si el modal no tiene close button, cae
// al modo flotante (absolute).
function placeBackBtn(overlay, backBtn) {
  const closer = overlay.querySelector('[data-close-modal]');
  if (closer && closer.parentNode) {
    backBtn.classList.remove('ms-back-floating');
    const wrapper = document.createElement('span');
    wrapper.className = 'ms-back-group';
    closer.parentNode.insertBefore(wrapper, closer);
    wrapper.appendChild(backBtn);
    wrapper.appendChild(closer);
  } else {
    backBtn.classList.add('ms-back-floating');
    overlay.appendChild(backBtn);
  }
}

function updateBackArrows() {
  for (let i = 0; i < stack.length; i++) {
    const isTop = i === stack.length - 1;
    const showBack = isTop && stack.length > 1;
    stack[i].backBtn.style.display = showBack ? 'inline-flex' : 'none';
  }
}

function revealTop() {
  const entry = stack[stack.length - 1];
  if (!entry) return;
  entry.overlay.style.visibility = '';
  updateBackArrows();
  if (entry.onReveal) {
    try { entry.onReveal(); } catch { /* noop */ }
  }
}

function findIndexById(id) {
  if (!id) return -1;
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].id === id) return i;
  }
  return -1;
}

// Destruye el modal más viejo (índice 0) sin restaurar el body-lock. Solo
// se usa cuando la pila supera MAX_DEPTH — el usuario pierde el paso más
// antiguo pero puede seguir navegando sin toparse con un tope raro.
function dropBottom() {
  const entry = stack.shift();
  if (!entry) return;
  if (entry.onClose) {
    try { entry.onClose(); } catch { /* noop */ }
  }
  entry.overlay.remove();
}

function openModal({ id = null, html = '', onClose = null, onBack = null, onReveal = null, className = '' } = {}) {
  // Dedup: si el id ya está en la pila, cerramos lo que hay encima y revelamos
  // ese. NO creamos overlay nuevo — devolvemos el existente para que el caller
  // pueda seguir usándolo como si lo hubiera abierto ahora.
  if (id) {
    const idx = findIndexById(id);
    if (idx >= 0) {
      while (stack.length - 1 > idx) closeTop();
      // Puede que ya estaba en top (stack.length - 1 == idx): igual revelamos
      // por si quedó con visibility hidden por algún flujo raro.
      revealTop();
      return stack[stack.length - 1].overlay;
    }
  }

  // Cap de profundidad: si estamos por pasar MAX_DEPTH, tiramos el más viejo.
  while (stack.length >= MAX_DEPTH) dropBottom();

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

  const backBtn = createBackBtn();
  placeBackBtn(overlay, backBtn);

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

  stack.push({ id, overlay, backBtn, onClose, onBack, onReveal });
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
    revealTop();
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
  const idx = findIndexById(id);
  if (idx < 0) return false;
  while (stack.length > idx) closeTop();
  return true;
}

export { openModal, closeTop, closeAll, getStack, closeById };
