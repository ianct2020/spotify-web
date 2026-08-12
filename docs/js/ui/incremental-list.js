// Lista incremental: pinta el primer lote de una y va appendeando el resto a
// medida que el usuario baja, con un IntersectionObserver sobre un centinela al
// final del container.
//
// Por qué así y no de otra forma:
//
// - NO es windowing: los nodos que entran no se reciclan ni se sacan nunca, y
//   no hay `position:absolute` ni alturas calculadas. El scroll se comporta
//   igual que con la lista entera pintada, sin saltos ni barras que cambian de
//   tamaño raro.
// - NO se trocea con requestAnimationFrame ni con setTimeout encadenado: la
//   pestaña de testeo corre con `visibilityState: "hidden"` y Chrome throttlea
//   las dos cosas, así que una lista partida en frames tarda minutos ahí y es
//   imposible de medir. El observer no depende del reloj.
//
// Uso:
//   const list = createIncrementalList({
//     container: document.getElementById('mi-grid'),
//     items: rows,
//     renderItem: (row, i) => `<div class="card">…</div>`,   // string o Node
//   });
//   list.setItems(otrasRows);   // cambió el orden / el filtro
//   list.destroy();             // en el teardown de la ruta
//
// Los listeners de las tarjetas TIENEN que estar delegados en el container: las
// del lote 7 no existen cuando se cablea la vista.

const DEFAULT_BATCH = 80;
const DEFAULT_ROOT_MARGIN = '600px';

// El root del observer tiene que ser el elemento que scrollea de verdad. En
// #skips el que scrollea es el propio grid (`max-height: 74vh; overflow-y:
// auto`) en desktop, y el documento en móvil, donde la media query le saca el
// overflow. Con el root equivocado el centinela se ve siempre y entrarían los
// 1.403 de una, que es justo lo que estamos evitando.
function scrollRootOf(container) {
  let el = container;
  while (el && el !== document.body && el !== document.documentElement) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === 'auto' || oy === 'scroll') return el;
    el = el.parentElement;
  }
  return null;   // viewport
}

function buildFragment(items, renderItem, from, to) {
  const frag = document.createDocumentFragment();
  let html = '';
  const flush = () => {
    if (!html) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    frag.appendChild(tpl.content);
    html = '';
  };
  for (let i = from; i < to; i++) {
    const out = renderItem(items[i], i);
    if (out == null) continue;
    if (typeof out === 'string') html += out;   // se parsea todo junto, una vez
    else { flush(); frag.appendChild(out); }
  }
  flush();
  return frag;
}

export function createIncrementalList({
  container,
  items = [],
  renderItem,
  batchSize = DEFAULT_BATCH,
  rootMargin = DEFAULT_ROOT_MARGIN,
  onBatch = null,
}) {
  if (!container) throw new Error('createIncrementalList: falta container');
  if (typeof renderItem !== 'function') throw new Error('createIncrementalList: renderItem tiene que ser función');

  let list = items || [];
  let rendered = 0;
  let observer = null;
  let destroyed = false;
  let appending = false;

  const sentinel = document.createElement('div');
  sentinel.className = 'inc-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  // Ocupa una fila entera si el container es un grid, para que no se cuele como
  // una celda vacía al final.
  sentinel.style.cssText = 'grid-column: 1 / -1; width: 100%; height: 1px; margin: 0; padding: 0;';

  function appendBatch(n) {
    const to = Math.min(rendered + n, list.length);
    if (to <= rendered) return 0;
    const t0 = performance.now();
    const frag = buildFragment(list, renderItem, rendered, to);
    container.insertBefore(frag, sentinel);
    const added = to - rendered;
    rendered = to;
    if (onBatch) onBatch({ rendered, total: list.length, added, ms: performance.now() - t0 });
    return added;
  }

  function stopObserving() {
    if (observer) { observer.disconnect(); observer = null; }
  }

  function finishIfDone() {
    if (rendered >= list.length) {
      stopObserving();
      if (sentinel.parentNode) sentinel.remove();
      return true;
    }
    return false;
  }

  function onIntersect(entries) {
    if (destroyed || appending) return;
    if (!entries.some(e => e.isIntersecting)) return;
    appending = true;
    try {
      appendBatch(batchSize);
    } finally {
      appending = false;
    }
    if (finishIfDone()) return;
    // IntersectionObserver solo avisa cuando cambia el estado de intersección.
    // Si después de appendear el centinela SIGUE dentro del rootMargin (viewport
    // más alto que el lote, o el usuario tirado al final), no hay cambio de
    // estado y no volvería a disparar nunca. Re-observar fuerza una observación
    // inicial nueva, que llega igual de asincrónica y encadena el lote
    // siguiente hasta que el centinela quede fuera de vista.
    observer.unobserve(sentinel);
    observer.observe(sentinel);
  }

  function startObserving() {
    stopObserving();
    if (rendered >= list.length) return;
    container.appendChild(sentinel);   // siempre el último hijo
    observer = new IntersectionObserver(onIntersect, {
      root: scrollRootOf(container),
      rootMargin,
    });
    observer.observe(sentinel);
  }

  function start(firstBatch) {
    container.appendChild(sentinel);
    appendBatch(firstBatch);          // primer lote SINCRÓNICO: nunca un frame vacío
    if (finishIfDone()) return;
    startObserving();
  }

  start(batchSize);

  return {
    /**
     * Cambió el dataset (orden, filtro, se ocultó un elemento). Resetea el
     * container y vuelve a pintar desde cero — el feature no tiene que tocar el
     * DOM a mano.
     *
     * @param {Array} nextItems
     * @param {object} [opts]
     * @param {boolean} [opts.preserveRendered]  repinta tantos como había
     *   pintados y restaura el scroll, para que ocultar un elemento estando
     *   abajo del todo no te devuelva al principio de la lista. Con `false`
     *   (por defecto) vuelve al primer lote y al principio, que es lo que se
     *   quiere al cambiar de filtro o de orden.
     */
    setItems(nextItems, { preserveRendered = false } = {}) {
      if (destroyed) return;
      const scroller = scrollRootOf(container);
      const prevScroll = scroller ? scroller.scrollTop : window.scrollY;
      const prevRendered = rendered;

      stopObserving();
      list = nextItems || [];
      rendered = 0;
      container.replaceChildren(sentinel);

      const first = preserveRendered
        ? Math.max(batchSize, Math.min(prevRendered, list.length))
        : batchSize;
      appendBatch(first);
      if (!finishIfDone()) startObserving();

      if (preserveRendered) {
        if (scroller) scroller.scrollTop = prevScroll;
        else window.scrollTo(0, prevScroll);
      }
    },

    /** Desconecta el observer y saca el centinela. Llamar en el teardown. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopObserving();
      if (sentinel.parentNode) sentinel.remove();
    },

    get rendered() { return rendered; },
    get total() { return list.length; },
  };
}
