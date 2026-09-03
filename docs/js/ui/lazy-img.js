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
//
// ⚠️ El tope SOLO puede soltar lo que está fuera de la zona de carga. Lo que se
// ve NO se blanquea nunca, aunque haya más en pantalla que `maxLoaded` — ver
// `podar()`. Que el tope se quede corto es un problema de memoria; blanquear lo
// que el usuario está mirando es un problema de que la vista no funciona, y
// entre los dos gana el primero.
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
  // Las que el observer de carga reporta DENTRO de su zona ahora mismo. Es lo
  // que hace que `podar()` no pueda blanquear una tapa que se está viendo.
  const enVista = new Set();
  // Las que el observer ya evaluó al menos una vez. Una <img> recién
  // registrada todavía no tiene veredicto: `enVista` no la tiene porque el
  // callback no corrió, no porque esté fuera de pantalla. Podarla ahí sería
  // exactamente el parpadeo que estamos sacando.
  const evaluados = new Set();
  let cargas = 0;
  let descargas = 0;
  let sobreCupo = 0;   // veces que el tope no se pudo honrar (todo estaba a la vista)

  function traza() {
    if (!window.__lazyImgDebug) return;
    window.__lazyImgStats = { cargadas: cargadas.size, cargas, descargas, memo: yaCargadas.size, maxLoaded, enVista: enVista.size, sobreCupo };
  }

  // La <img> se queda observada por `loadObs` DESPUÉS de cargar, a propósito:
  // ese observer es la única fuente de `enVista`, y sin él `podar()` no sabe
  // qué se está viendo. Antes se desobservaba acá y se volvía a observar en
  // `unload()`; esa vuelta es la que cerraba el bucle de titileo (ver `podar`).
  function load(img) {
    const src = img.dataset.src;
    if (!src) return;
    delete img.dataset.src;
    yaCargadas.add(src);
    img.src = src;
    cargas++;
    // Refresca la posición en la LRU aunque ya estuviera.
    cargadas.delete(img);
    cargadas.set(img, src);
    keepObs?.observe(img);
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
    // No hace falta re-observar: `loadObs` nunca la soltó. Cuando vuelva a
    // entrar en la zona de carga el callback la reasigna sola.
    traza();
  }

  // Tope duro: si la geometría no descargó lo suficiente, se sueltan las más
  // viejas de la BANDA DE RETENCIÓN — lo que ya salió de la zona de carga pero
  // todavía no salió de la zona de retención (`unloadRootMargin`, mucho más
  // ancha). El orden de carga sigue al del scroll (y volver hacia arriba
  // recarga, o sea que refresca su posición), así que la más vieja es casi
  // siempre la más lejana de la pantalla.
  //
  // ── Por qué `enVista` no es un adorno (regresión de v=181, arreglada acá) ──
  //
  // Hasta v=192 `podar()` soltaba la más vieja SIN mirar dónde estaba, y
  // `unload()` la volvía a observar en el observer de carga. Si esa <img>
  // seguía dentro de la zona de carga —que es lo normal cuando entran más de
  // `maxLoaded` tapas en una pantalla— el observer la reportaba intersectando
  // en el frame siguiente, se recargaba, el tope se pasaba otra vez y volvía a
  // podar: bucle cerrado, un ciclo completo por frame y para siempre.
  //
  // Medido en producción (v=192, `#covers`, filtro 2020-2023, 429 tapas):
  //
  //   Mini  (28px) — 429 celdas, las 429 dentro de la zona de carga:
  //                  1.253 cargas y 1.253 descargas POR FRAME, sin tocar nada.
  //                  250 tapas pintadas de 429; cuáles cambiaba cada frame.
  //   Mini, sin filtro (2.451 tapas): 5.639 ciclos por frame, 168 tapas
  //                  pintadas de 656 en pantalla.
  //   Chico (48px):    900 ciclos por frame.
  //   Medio (64px):  0 quieto, pero después de un scroll rápido la grilla
  //                  quedaba vacía y seguía a 64 ciclos por frame.
  //
  // Eso es el titileo, la grilla vacía y la lentitud: cada ciclo reasigna un
  // `src` y vuelve a decodificar. El `firstBatchMs` seguía marcando 3,8 ms
  // porque mide el primer lote sincrónico y nada de lo que pasa después.
  //
  // La regla que cierra el bucle: **lo que está a la vista no se poda**. Si con
  // eso no se llega al tope, el tope no se honra y se anota en `sobreCupo`.
  // Quedarse por encima del cupo cuesta memoria; blanquear lo que el usuario
  // está mirando cuesta la vista entera.
  function podar() {
    if (cargadas.size <= maxLoaded) return;
    // Copia: `unload()` muta `cargadas` mientras recorremos.
    for (const img of [...cargadas.keys()]) {
      if (cargadas.size <= maxLoaded) break;
      // Todavía sin veredicto del observer, o dentro de la zona de carga.
      if (!evaluados.has(img) || enVista.has(img)) continue;
      unload(img);
    }
    if (cargadas.size > maxLoaded) sobreCupo++;
    traza();
  }

  // Una <img> que ya no está en el documento: la soltamos de los dos observers
  // y de los índices. Pasa cuando `#covers` saca la celda entera porque la tapa
  // 404eó — antes de v=193 `load()` desobservaba y el nodo suelto se iba solo,
  // ahora hay que soltarlo a mano o queda retenido hasta el próximo `reset()`.
  function olvidar(img) {
    loadObs?.unobserve(img);
    keepObs?.unobserve(img);
    cargadas.delete(img);
    enVista.delete(img);
    evaluados.delete(img);
  }

  function onLoadZone(entries) {
    for (const e of entries) {
      if (!e.target.isConnected) { olvidar(e.target); continue; }
      evaluados.add(e.target);
      if (!e.isIntersecting) { enVista.delete(e.target); continue; }
      enVista.add(e.target);
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
    // Al final del lote, no dentro de `load()`: acá `enVista` ya está al día
    // con lo que el observer acaba de reportar.
    podar();
  }

  function onKeepZone(entries) {
    for (const e of entries) {
      if (!e.target.isConnected) { olvidar(e.target); continue; }
      if (e.isIntersecting) continue;
      unload(e.target);
    }
    podar();
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
        // Observar SIEMPRE, aun cuando la carguemos de una: `loadObs` es la
        // fuente de `enVista`, y una <img> que nunca se observa no tendría
        // veredicto y `podar()` no la podría soltar jamás.
        loadObs.observe(img);
        // Ya la vio el usuario antes del repintado: está en caché, va directo.
        // Sin esto la grilla entera parpadea a placeholder gris en cada
        // repintado, esperando una vuelta del observer.
        if (yaCargadas.has(img.dataset.src)) load(img);
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
      enVista.clear();
      evaluados.clear();
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
      enVista.clear();
      evaluados.clear();
    },

    /** Para el testeo y las mediciones: cuántas tapas hay cargadas ahora. */
    get stats() {
      return { cargadas: cargadas.size, cargas, descargas, memo: yaCargadas.size, maxLoaded, enVista: enVista.size, sobreCupo };
    },
  };
}
