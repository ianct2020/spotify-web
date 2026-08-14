// Carga diferida de imágenes contra el ancestro que scrollea, no contra el
// viewport — y descarga de lo que se aleja.
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
// Por qué además hay que DESCARGAR (v=138): hasta ahora el observer asignaba el
// `src` y desobservaba, así que nada se soltaba nunca. Recorrer la lista entera
// dejaba todas las tapas decodificadas en memoria a la vez: con 64×64 son 21,9
// MB en `#skips`, pero con tapas de 300×300 (`#sin-clasificar` las pinta a 96px
// desde `images[1]`) serían ~475 MB y ~715 MB respectivamente. Por eso hay un
// segundo umbral, más lejano: al salir de él la imagen vuelve a `data-src`, el
// `src` pasa a un GIF transparente de 1×1 y el elemento se re-observa para la
// carga. Nunca `src=""`: dispara un `error` de red y deja la tapa rota.
//
// Uso:
//   const lazy = createLazyImages({ root: scrollRootOf(grid) });
//   lazy.observe(nodosDelLote);   // busca los <img data-src> que haya adentro
//   lazy.reset();                 // se repintó la lista entera
//   lazy.destroy();               // teardown de la ruta
//
// El markup pide `data-src` en vez de `src`, y el <img> TIENE que llevar
// `width`/`height` (o `aspect-ratio`): sin eso, al descargar una tapa el hueco
// se cerraría y el scroll pegaría un salto.

const DEFAULT_ROOT_MARGIN = '200px';
// Zona de retención: bastante más ancha que la de carga, para que un scroll de
// ida y vuelta corto no dispare descargar-y-volver-a-cargar.
const DEFAULT_UNLOAD_ROOT_MARGIN = '2000px';
// Backstop por si la geometría falla (un scroller mal detectado, un root que
// deja de tener tamaño): tope duro de imágenes con `src` puesto, con descarte
// LRU de las menos recientes.
const DEFAULT_MAX_LOADED = 250;

// GIF transparente de 1×1. Ocupa nada y, a diferencia de `src=""`, no dispara
// una petición ni el handler de error.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export function createLazyImages({
  root = null,
  rootMargin = DEFAULT_ROOT_MARGIN,
  unloadRootMargin = DEFAULT_UNLOAD_ROOT_MARGIN,
  maxLoaded = DEFAULT_MAX_LOADED,
} = {}) {
  let loadObs = null;      // umbral corto: entra en zona → asignar src
  let keepObs = null;      // umbral largo: sale de zona → soltar src
  let destroyed = false;
  // URLs que ya se cargaron alguna vez en esta instancia. Cuando la lista se
  // repinta entera (ocultar una pista, cambiar el orden o el filtro) los <img>
  // viejos se destruyen y los nuevos tendrían que esperar una vuelta del
  // observer para recibir su `src`: la grilla entera parpadeaba a placeholder
  // gris en cada repintado. Estas ya están en la caché del navegador, así que
  // asignarlas de una no cuesta red y pinta en el mismo frame.
  //
  // La descarga NO toca este Set, a propósito: es memoria de "esta URL ya viajó
  // por la red", no de "esta imagen está cargada ahora". Al volver a entrar en
  // vista, la tapa se reasigna y la sirve el caché HTTP, sin parpadeo.
  const yaCargadas = new Set();
  // <img> con `src` puesto ahora mismo, en orden de carga (Map = insertion
  // order): es la lista LRU que usa el tope duro.
  const cargadas = new Map();
  let cargas = 0;
  let descargas = 0;

  function traza() {
    if (!window.__lazyImgDebug) return;
    window.__lazyImgStats = { cargadas: cargadas.size, cargas, descargas, memo: yaCargadas.size, maxLoaded };
  }

  function load(img, { observado = true } = {}) {
    const src = img.dataset.src;
    // Desobservar SIEMPRE, aunque no haya src: si no, un <img> sin data-src se
    // queda en el observer para siempre y lo mantiene vivo junto con su tarjeta.
    if (observado && loadObs) loadObs.unobserve(img);
    if (!src) return;
    delete img.dataset.src;
    yaCargadas.add(src);
    img.src = src;
    cargas++;
    // Refresca la posición en la LRU aunque ya estuviera.
    cargadas.delete(img);
    cargadas.set(img, src);
    keepObs?.observe(img);
    podar();
    traza();
  }

  function unload(img) {
    const src = cargadas.get(img);
    keepObs?.unobserve(img);
    cargadas.delete(img);
    if (!src || !img.isConnected) return;
    img.dataset.src = src;
    img.src = BLANK;
    descargas++;
    if (!destroyed) loadObs?.observe(img);
    traza();
  }

  // Tope duro: si la geometría no descargó lo suficiente, se sueltan las más
  // viejas. El orden de carga sigue al del scroll (y volver hacia arriba
  // recarga, o sea que refresca su posición), así que la más vieja es casi
  // siempre la más lejana de la pantalla.
  function podar() {
    if (cargadas.size <= maxLoaded) return;
    for (const img of cargadas.keys()) {
      if (cargadas.size <= maxLoaded) break;
      unload(img);
    }
  }

  function onLoadZone(entries) {
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

  function onKeepZone(entries) {
    for (const e of entries) {
      if (e.isIntersecting) continue;
      unload(e.target);
    }
  }

  function build() {
    loadObs = new IntersectionObserver(onLoadZone, { root, rootMargin });
    keepObs = new IntersectionObserver(onKeepZone, { root, rootMargin: unloadRootMargin });
  }

  build();

  return {
    /**
     * Registra las imágenes pendientes que haya dentro de `scope`, que puede ser
     * un elemento, una lista de nodos o un array de elementos.
     */
    observe(scope) {
      if (destroyed || !loadObs) return;
      const nodes = scope == null ? [] : (scope.nodeType ? [scope] : [...scope]);
      const registrar = (img) => {
        // Ya la vio el usuario antes del repintado: está en caché, va directo.
        if (yaCargadas.has(img.dataset.src)) load(img, { observado: false });
        else loadObs.observe(img);
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
      loadObs?.disconnect();
      keepObs?.disconnect();
      cargadas.clear();
      build();
      traza();
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      loadObs?.disconnect();
      keepObs?.disconnect();
      loadObs = keepObs = null;
      cargadas.clear();
    },

    /** Para el testeo y las mediciones: cuántas tapas hay cargadas ahora. */
    get stats() {
      return { cargadas: cargadas.size, cargas, descargas, memo: yaCargadas.size, maxLoaded };
    },
  };
}
