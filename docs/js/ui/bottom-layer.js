// Capa única de la franja de abajo de la pantalla (v=141).
//
// Antes cada cosa que vive abajo era `position: fixed` por su cuenta con su
// propio `bottom` y su propio z-index: el pill del preview (bottom 20 / z 900),
// el pill de progreso (bottom 20 / z 600) y los toasts (bottom 24 / z 1000).
// Los tres en la misma esquina, y el único apaño era un par de reglas
// `body:has(.preview-pill.show) … { bottom: 76px }` que solo contemplaban dos
// de los tres. Con los tres a la vez se tapaban sí o sí.
//
// Acá se gestionan todos juntos, con UN z-index de referencia (--z-blayer en
// el CSS) y zonas declaradas. La regla dura —ningún elemento puede quedar
// debajo de otro— NO se resuelve con z-index ni con `bottom` calculados a
// mano: se resuelve con FLUJO. La zona derecha es un flex column y cada widget
// es un item suyo, así que el navegador garantiza que no se solapen. Los slots
// van con `display: contents`, o sea que un slot vacío no ocupa ni deja gap:
// de ahí sale solo el "cuando el player no está, las demás bajan a su lugar".
//
// Orden de la columna derecha, de ABAJO hacia arriba:
//
//   player  →  volver arriba  →  progreso  →  toasts
//
// El player es el ancla (lo único fijo abajo a la derecha) porque es lo que más
// dura; "volver arriba" va justo encima porque también es persistente y
// conviene que quede a mano; progreso y toasts, que son pasajeros, empujan
// desde arriba.
//
// La zona izquierda es para lo que se alinea a la columna de contenido (hoy, el
// pill de guardado de W-Three). La geometría la pone el CSS: left 312px con
// sidebar, 72px sin.
//
// Además la capa publica su propia altura en `--blayer-h` (en :root). Eso es
// para lo que NO vive acá dentro pero tampoco puede quedar tapado: en móvil la
// `.sc-actionbar` ocupa el ancho entero y tiene que subirse por encima de la
// pila. Es el único punto de coordinación con el resto de la app, en vez de las
// reglas `:has()` sueltas que había repartidas.

const SLOTS = ['toasts', 'progress', 'backtotop', 'player'];

let layer = null;
let leftZone = null;
let rightZone = null;

// Geometría publicada en :root para lo que NO vive dentro de la capa pero
// tampoco puede quedar tapado por ella — hoy, las barras de acciones
// (`.sc-actionbar` / `.disco-actionbar`), que se pintan dentro de su vista y no
// se pueden mover de sitio sin romper los `content.querySelector('#…-actionbar')`
// de tres features.
//
//   --blayer-h        cuánto sube la capa entera desde el borde inferior
//   --blayer-left-h   ídem, solo la zona izquierda (para lo anclado a la izquierda)
//   --blayer-right-w  ancho de la columna derecha (para no crecer por debajo de ella)
//
// Las tres valen 0px cuando no hay nada. Es un único punto de coordinación, en
// vez de las reglas `:has()` sueltas que había repartidas por dos hojas.
//
// OJO con lo que se mide: es la distancia del borde inferior del viewport al
// TOP de la zona, no el alto de su contenido. La diferencia es el padding de la
// capa, y sin él la cuenta se queda 20 px corta — medido en v=141: la barra de
// acciones seguía montada 4 px sobre el pill de W-Three.
function publishHeight() {
  if (!rightZone) return;
  const alzada = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.height) return 0;                       // zona vacía: no estorba a nadie
    return Math.max(0, window.innerHeight - r.top);
  };
  const set = (k, v) => document.documentElement.style.setProperty(k, `${Math.round(v)}px`);
  const izq = alzada(leftZone);
  const der = alzada(rightZone);
  set('--blayer-left-h', izq);
  set('--blayer-h', Math.max(izq, der));
  set('--blayer-right-w', der ? rightZone.getBoundingClientRect().width : 0);
}

function ensureLayer() {
  if (layer && layer.isConnected) return layer;

  layer = document.createElement('div');
  layer.className = 'blayer';
  layer.id = 'bottom-layer';

  leftZone = document.createElement('div');
  leftZone.className = 'blayer-left';
  leftZone.dataset.slot = 'left';

  rightZone = document.createElement('div');
  rightZone.className = 'blayer-right';
  for (const name of SLOTS) {
    const slot = document.createElement('div');
    slot.className = 'blayer-slot';
    slot.dataset.slot = name;
    rightZone.appendChild(slot);
  }

  layer.appendChild(leftZone);
  layer.appendChild(rightZone);
  document.body.appendChild(layer);

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(publishHeight);
    ro.observe(rightZone);
    ro.observe(leftZone);
  }
  // La medida depende de innerHeight, así que hay que rehacerla al redimensionar
  // (el ResizeObserver no dispara si el contenido no cambió de tamaño).
  window.addEventListener('resize', publishHeight);
  publishHeight();

  return layer;
}

// Devuelve el nodo donde hay que colgar un widget de la capa.
// `name`: 'player' | 'backtotop' | 'progress' | 'toasts' | 'left'.
function bottomSlot(name) {
  ensureLayer();
  if (name === 'left') return leftZone;
  return rightZone.querySelector(`.blayer-slot[data-slot="${name}"]`) || rightZone;
}

// Cuelga `el` en la zona `name` (idempotente: si ya está ahí no lo mueve, para
// no reiniciar animaciones ni perder el foco).
function mountBottom(name, el) {
  const slot = bottomSlot(name);
  if (el.parentElement !== slot) slot.appendChild(el);
  return el;
}

// Para los widgets que se pintan con innerHTML/insertAdjacentHTML en vez de
// crear el nodo a mano (el pill de progreso, por ejemplo).
function mountBottomHtml(name, html) {
  const slot = bottomSlot(name);
  slot.insertAdjacentHTML('beforeend', html);
  return slot.lastElementChild;
}

export { bottomSlot, mountBottom, mountBottomHtml, publishHeight };
