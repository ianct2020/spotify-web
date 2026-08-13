// Carga diferida de imágenes contra el ancestro que scrollea, no contra el
// viewport.
//
// Por qué no alcanza `loading="lazy"`: el lazy nativo de Chrome resuelve contra
// el viewport del documento. Cuando la lista vive dentro de su propio scroller
// (`#skips` es un grid con `max-height: 74vh; overflow-y: auto`), las tarjetas
// recién appendeadas caen dentro de los límites del viewport aunque el scroller
// las clippee, así que cada lote dispara TODAS sus tapas de golpe. Medido en la
// app el 2026-08-12: con `scrollTop: 0` y 479px visibles, las 80 tapas del
// primer lote ya estaban cargadas o en vuelo, la más baja a 1.622px de scroll;
// con la lista entera pintada, 1.403 peticiones para unas 20 tapas visibles.
//
// Uso:
//   const lazy = createLazyImages({ root: scrollRootOf(grid) });
//   lazy.observe(nodosDelLote);   // busca los <img data-src> que haya adentro
//   lazy.reset();                 // se repintó la lista entera
//   lazy.destroy();               // teardown de la ruta
//
// El markup pide `data-src` en vez de `src`, y conviene que el <img> lleve
// `width`/`height` (o `aspect-ratio`) para que el layout no dependa de que la
// imagen llegue.

const DEFAULT_ROOT_MARGIN = '200px';

export function createLazyImages({ root = null, rootMargin = DEFAULT_ROOT_MARGIN } = {}) {
  let observer = null;
  let destroyed = false;
  // URLs que ya se cargaron alguna vez en esta instancia. Cuando la lista se
  // repinta entera (ocultar una pista, cambiar el orden o el filtro) los <img>
  // viejos se destruyen y los nuevos tendrían que esperar una vuelta del
  // observer para recibir su `src`: la grilla entera parpadeaba a placeholder
  // gris en cada repintado. Estas ya están en la caché del navegador, así que
  // asignarlas de una no cuesta red y pinta en el mismo frame.
  const yaCargadas = new Set();

  function load(img, { observado = true } = {}) {
    const src = img.dataset.src;
    // Desobservar SIEMPRE, aunque no haya src: si no, un <img> sin data-src se
    // queda en el observer para siempre y lo mantiene vivo junto con su tarjeta.
    if (observado && observer) observer.unobserve(img);
    if (!src) return;
    delete img.dataset.src;
    yaCargadas.add(src);
    img.src = src;
  }

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      // Traza para el testeo con la extensión: el reloj de pared y los evals por
      // CDP no sirven (no llega ni un frame mientras se evalúa JS), así que el
      // módulo va anotando qué cargó y desde qué posición del scroller.
      if (window.__lazyImgDebug) {
        (window.__lazyImgLog ||= []).push({
          top: Math.round(e.boundingClientRect.top - e.rootBounds.top),
          rootH: Math.round(e.rootBounds.height),
        });
      }
      load(e.target);
    }
  }

  function build() {
    observer = new IntersectionObserver(onIntersect, { root, rootMargin });
  }

  build();

  return {
    /**
     * Registra las imágenes pendientes que haya dentro de `scope`, que puede ser
     * un elemento, una lista de nodos o un array de elementos.
     */
    observe(scope) {
      if (destroyed || !observer) return;
      const nodes = scope == null ? [] : (scope.nodeType ? [scope] : [...scope]);
      const registrar = (img) => {
        // Ya la vio el usuario antes del repintado: está en caché, va directo.
        if (yaCargadas.has(img.dataset.src)) load(img, { observado: false });
        else observer.observe(img);
      };
      for (const node of nodes) {
        if (!node || node.nodeType !== 1) continue;
        if (node.matches?.('img[data-src]')) registrar(node);
        node.querySelectorAll?.('img[data-src]').forEach(registrar);
      }
    },

    /** Se repintó la lista entera: los nodos viejos ya no existen. */
    reset() {
      if (destroyed) return;
      observer?.disconnect();
      build();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      observer = null;
    },
  };
}
