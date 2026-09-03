// tests/lazy-img-poda.test.mjs — el tope duro de `ui/lazy-img.js` no puede
// blanquear lo que se está viendo (v=193)
//
// Lo que se protege acá es la regresión de v=181, que estuvo en producción
// hasta v=192 y que NINGUNA métrica de entonces vio.
//
// El fallo: `podar()` soltaba la <img> más vieja de la LRU sin mirar dónde
// estaba, y `unload()` la volvía a observar en el observer de carga. Si esa
// <img> seguía dentro de la zona de carga —lo normal apenas entran más de
// `maxLoaded` tapas en una pantalla, que en `#covers` a 28px son cientos— el
// observer la reportaba intersectando en el frame siguiente, se recargaba, el
// tope se volvía a pasar y volvía a podar. Bucle cerrado, un ciclo entero por
// frame, para siempre.
//
// Por qué no lo vio nadie: la métrica de v=181 era `firstBatchMs`, que mide el
// primer lote sincrónico —3,7 ms— y termina antes de que el bucle arranque. Un
// número verde describiendo una vista rota. Por eso el test de acá abajo NO
// mide tiempo: cuenta ciclos de carga/descarga con la geometría quieta, que es
// donde vive el fallo.
//
// El doble de `IntersectionObserver` es sincrónico a propósito: `observe()`
// entrega el veredicto inicial en el acto y `frame()` reentrega el estado
// actual, que es lo que hace el navegador en cada paso de renderizado. Así el
// bucle, si existe, se manifiesta en el conteo en vez de colgar el test.

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
function eq(a, b, nombre) {
  const bien = JSON.stringify(a) === JSON.stringify(b);
  if (!bien) console.log(`      esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
  ok(bien, nombre);
}

// ── Doble de <img> ─────────────────────────────────────────────────────────
// Solo lo que toca el módulo: `dataset`, `src` e `isConnected`.
function img(url) {
  return { dataset: { src: url }, src: '', isConnected: true, nodeType: 1, matches: () => true };
}

// ── Doble de IntersectionObserver ──────────────────────────────────────────
// `dentro(target)` decide la geometría; el test la mueve cuando quiere simular
// un scroll. Cada instancia se registra para que `frame()` las recorra todas.
const observers = [];
function instalarIO(dentro) {
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.targets = new Set(); this.estado = new Map(); observers.push(this); }
    observe(t) {
      if (this.targets.has(t)) return;      // igual que el real: re-observar es no-op
      this.targets.add(t);
      const is = dentro(t, this);
      this.estado.set(t, is);
      this.cb([entry(t, is)], this);         // observación inicial
    }
    unobserve(t) { this.targets.delete(t); this.estado.delete(t); }
    disconnect() { this.targets.clear(); this.estado.clear(); }
    // Un paso de renderizado: reporta SOLO los cambios de estado, como el real.
    frame() {
      const cambios = [];
      for (const t of this.targets) {
        const is = dentro(t, this);
        if (this.estado.get(t) !== is) { this.estado.set(t, is); cambios.push(entry(t, is)); }
      }
      if (cambios.length) this.cb(cambios, this);
      return cambios.length;
    }
  };
}
function entry(target, isIntersecting) {
  return { target, isIntersecting, boundingClientRect: { top: 0 }, rootBounds: { top: 0, height: 800 } };
}
function frame() { return observers.reduce((n, o) => n + o.frame(), 0); }

globalThis.window = globalThis;
instalarIO(() => true);
const { createLazyImages } = await import('../src/js/ui/lazy-img.js');

// ───────────────────────────────────────────────────────────────────────────
// 1. EL CASO DE LA REGRESIÓN: más tapas a la vista que `maxLoaded`.
//    Es `#covers` en Mini con el filtro puesto: 429 celdas, las 429 dentro de
//    la zona de carga, tope de 250.
// ───────────────────────────────────────────────────────────────────────────
{
  observers.length = 0;
  instalarIO(() => true);                      // TODO a la vista, nada se mueve
  const lazy = createLazyImages({ maxLoaded: 250 });
  const imgs = Array.from({ length: 429 }, (_, i) => img(`https://cdn/t${i}`));
  lazy.observe(imgs);

  const tras = lazy.stats;
  ok(tras.descargas === 0, 'con todo a la vista no se descarga NADA (era 1.224 descargas)');
  eq(imgs.filter(i => i.src.startsWith('https://')).length, 429,
    'las 429 tapas quedan pintadas, no 250');

  // Y ahora lo que mataba a la vista: dejar correr frames sin tocar nada.
  const antes = lazy.stats.cargas;
  for (let f = 0; f < 5; f++) frame();
  eq(lazy.stats.cargas - antes, 0, 'cinco frames quietos = 0 cargas nuevas (eran 1.253 POR FRAME)');
  eq(lazy.stats.descargas, 0, 'y 0 descargas: el bucle de titileo no existe');
  ok(lazy.stats.sobreCupo > 0, 'el tope se anota como no honrado en vez de romper la vista');
  lazy.destroy();
}

// ───────────────────────────────────────────────────────────────────────────
// 2. El tope SÍ tiene que podar lo que está fuera de la zona de carga.
//    Si no, `maxLoaded` no serviría para nada y volvería el pozo de memoria.
// ───────────────────────────────────────────────────────────────────────────
{
  observers.length = 0;
  const visibles = new Set();
  // El observer de carga (el primero que se construye) mira `visibles`; el de
  // retención (el segundo) se queda con todo, que es su razón de ser.
  let n = 0;
  instalarIO((t, obs) => {
    if (obs.idx === undefined) obs.idx = n++;
    return obs.idx === 0 ? visibles.has(t) : true;
  });
  const lazy = createLazyImages({ maxLoaded: 10 });
  const imgs = Array.from({ length: 40 }, (_, i) => img(`https://cdn/u${i}`));
  imgs.forEach(i => visibles.add(i));
  lazy.observe(imgs);
  eq(lazy.stats.cargadas, 40, 'primero entran las 40, todas a la vista');

  // Scroll: 30 salen de la zona de carga (pero siguen en la de retención).
  imgs.slice(0, 30).forEach(i => visibles.delete(i));
  frame();
  eq(lazy.stats.cargadas, 10, 'al salir de vista, el tope las poda hasta 10');
  eq(imgs.slice(30).every(i => i.src.startsWith('https://')), true,
    'las 10 que quedaron a la vista siguen pintadas');
  eq(imgs.slice(0, 30).every(i => i.src.startsWith('data:image/gif')), true,
    'las 30 que salieron quedan en el GIF de 1×1, con su data-src de vuelta');
  ok(lazy.stats.descargas === 30, 'exactamente 30 descargas, ni una de más');

  // Y al volver, se recargan solas sin intervención del feature.
  imgs.slice(0, 30).forEach(i => visibles.add(i));
  frame();
  eq(imgs.every(i => i.src.startsWith('https://')), true, 'al volver a entrar se recargan las 30');
  lazy.destroy();
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Una <img> recién registrada no se poda antes de que el observer la mire.
//    Ese hueco es el que dejaba el atajo de `yaCargadas` (carga directa, sin
//    veredicto): sin la guarda, entraba blanqueada de fábrica.
// ───────────────────────────────────────────────────────────────────────────
{
  observers.length = 0;
  instalarIO(() => true);
  const lazy = createLazyImages({ maxLoaded: 2 });
  const a = [img('https://cdn/a'), img('https://cdn/b'), img('https://cdn/c')];
  lazy.observe(a);
  lazy.reset();
  // Segundo pintado: las tres URLs ya están en `yaCargadas`, así que entran por
  // el atajo, todas de una y antes de que corra ningún callback.
  const b = [img('https://cdn/a'), img('https://cdn/b'), img('https://cdn/c')];
  lazy.observe(b);
  eq(b.every(i => i.src.startsWith('https://')), true,
    'en el repintado las tres entran pintadas, sin parpadeo a gris');
  lazy.destroy();
}

// ───────────────────────────────────────────────────────────────────────────
// 4. La zona de retención sigue mandando: lo que se aleja de verdad se suelta
//    aunque el tope no se haya alcanzado (es el arreglo de memoria de v=138).
// ───────────────────────────────────────────────────────────────────────────
{
  observers.length = 0;
  let n = 0;
  const retenidas = new Set();
  instalarIO((t, obs) => {
    if (obs.idx === undefined) obs.idx = n++;
    return obs.idx === 0 ? false : retenidas.has(t);
  });
  const lazy = createLazyImages({ maxLoaded: 1000 });
  const imgs = Array.from({ length: 5 }, (_, i) => img(`https://cdn/v${i}`));
  imgs.forEach(i => retenidas.add(i));
  lazy.observe(imgs);
  // El observer de carga dice "fuera", así que nadie cargó por geometría.
  eq(lazy.stats.cargadas, 0, 'fuera de la zona de carga no se pide ningún src');

  // Ahora sí: entran, y después se van lejos del todo.
  observers.length = 0;
  n = 0;
  const dentro = new Set();
  instalarIO((t, obs) => {
    if (obs.idx === undefined) obs.idx = n++;
    return obs.idx === 0 ? dentro.has(t) : retenidas.has(t);
  });
  const lazy2 = createLazyImages({ maxLoaded: 1000 });
  const i2 = Array.from({ length: 5 }, (_, i) => img(`https://cdn/w${i}`));
  i2.forEach(x => { dentro.add(x); retenidas.add(x); });
  lazy2.observe(i2);
  eq(lazy2.stats.cargadas, 5, 'entran las 5');
  i2.forEach(x => { dentro.delete(x); retenidas.delete(x); });
  frame();
  eq(lazy2.stats.cargadas, 0, 'lejos de la zona de retención se sueltan las 5, con tope de sobra');
  lazy2.destroy();
  lazy.destroy();
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Una <img> sin `data-src` no se queda colgada del observer para siempre.
//    (La guarda que ya existía; se mantiene con la lógica nueva.)
// ───────────────────────────────────────────────────────────────────────────
{
  observers.length = 0;
  instalarIO(() => true);
  const lazy = createLazyImages({ maxLoaded: 10 });
  const vacia = { dataset: {}, src: '', isConnected: true, nodeType: 1, matches: () => false, querySelectorAll: () => [] };
  lazy.observe([vacia]);
  eq(lazy.stats.cargas, 0, 'una <img> sin data-src no cuenta como carga');
  eq(vacia.src, '', 'y no se le inventa ningún src');
  lazy.destroy();
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Una celda que se sacó del DOM (en `#covers`, una tapa que 404eó) se suelta
//    de los dos observers. Antes de v=193 `load()` desobservaba y el nodo se
//    iba solo; con la lógica nueva hay que soltarlo a mano.
// ───────────────────────────────────────────────────────────────────────────
{
  observers.length = 0;
  instalarIO(() => true);
  const lazy = createLazyImages({ maxLoaded: 100 });
  const imgs = Array.from({ length: 4 }, (_, i) => img(`https://cdn/z${i}`));
  lazy.observe(imgs);
  eq(lazy.stats.cargadas, 4, 'entran las 4');
  imgs[0].isConnected = false;          // la celda se sacó del DOM
  frame();                               // no hay cambio de estado…
  observers[0].cb([entry(imgs[0], true)], observers[0]);   // …pero sí una pasada del observer
  eq(lazy.stats.cargadas, 3, 'la celda desconectada sale de la LRU');
  eq(observers.some(o => o.targets.has(imgs[0])), false,
    'y ningún observer la sigue reteniendo');
  lazy.destroy();
}

// ───────────────────────────────────────────────────────────────────────────
// 7. `cambiarFuente`: la misma <img> con otra URL (cambio de tamaño de celda en
//    `#covers`). Lo que importa es que NO pase por `data-src`: si pasara, la
//    tapa se blanquearía hasta que baje la nueva, y con 429 celdas eso es la
//    grilla gris otra vez.
// ───────────────────────────────────────────────────────────────────────────
{
  observers.length = 0;
  instalarIO(() => true);
  const lazy = createLazyImages({ maxLoaded: 100 });
  const cargada = img('https://cdn/ab67616d00004851aaa');
  const pendiente = img('https://cdn/ab67616d00004851bbb');
  lazy.observe([cargada]);
  eq(cargada.src, 'https://cdn/ab67616d00004851aaa', 'la primera queda cargada');

  lazy.cambiarFuente(cargada, 'https://cdn/ab67616d00001e02aaa');
  eq(cargada.src, 'https://cdn/ab67616d00001e02aaa', 'la <img> cargada recibe la URL nueva DIRECTO');
  eq(cargada.dataset.src, undefined, 'y NO vuelve a data-src: no hay parpadeo a gris');

  // Una que todavía no cargó sí cambia por `data-src`, que es su pendiente.
  pendiente.dataset.src = 'https://cdn/ab67616d00004851bbb';
  lazy.cambiarFuente(pendiente, 'https://cdn/ab67616d00001e02bbb');
  eq(pendiente.dataset.src, 'https://cdn/ab67616d00001e02bbb', 'la que no cargó cambia su pendiente');
  eq(pendiente.src, '', 'y sigue sin src, como corresponde');

  const antes = lazy.stats.cargas;
  lazy.cambiarFuente(cargada, 'https://cdn/ab67616d00001e02aaa');
  eq(lazy.stats.cargas - antes, 0, 'repetir la misma URL no vuelve a cargar');
  lazy.destroy();
}

console.log(`\n${pasaron} pasaron, ${fallaron} fallaron\n`);
process.exit(fallaron ? 1 : 0);
