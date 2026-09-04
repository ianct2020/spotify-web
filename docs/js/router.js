import { guardRoute, marcarCambioDeRuta, abrirRender, cerrarRender } from './ui/crash-guard.js?v=202';
import { skelPage } from './ui/skeleton.js?v=202';

const routes = {};

// Lo que ocupa el hueco mientras la ruta se pinta. Es lo mismo que ponen casi
// todas las features en su primera línea, así que en la práctica no se ve.
//
// v=154: era un spinner suelto y ahora es el esqueleto de una página
// (ui/skeleton.js). REEMPLAZA al spinner, no lo acompaña: dos indicadores de
// carga encimados en el mismo hueco son ruido, y el esqueleto ya dice todo lo
// que decía la ruedita más la forma de lo que viene. Lo que NO cambia es el
// mecanismo de v=140 — se sigue insertando en el mismo paso sincrónico que el
// vaciado de `main`, así que la garantía de «main nunca vacío, ni por un frame»
// queda igual.
const LOADING_HTML = skelPage();
let currentCleanup = null;

// Generación de ruta (v=173). Sube en cada cambio y sirve para dos cosas:
// identificar el render en el registro de escrituras tardías, y darle a la
// vista una forma barata de preguntar «¿sigo siendo la ruta actual?» desde
// dentro de un `await` — que es justo lo que le falta a la que crashea.
let generacionRuta = 0;
let hashActual = null;

/** ¿La generación que me tocó sigue siendo la vigente? */
export function rutaVigente(gen) { return gen === generacionRuta; }

/** La generación en curso, para que una vista se la guarde antes de un await. */
export function generacionActual() { return generacionRuta; }

// Marca la vista activa (v=154). Cualquier elemento con `data-route` se pinta
// distinto cuando su ruta es la actual: los `.nav-link` del <aside> y las
// `.home-card` de HOME_SECTIONS. Se resuelve acá, escuchando el cambio de ruta,
// y no repintando el sidebar entero — el <aside> se arma una sola vez en
// app.js y no se vuelve a tocar en toda la sesión.
function markActiveRoute(hash) {
  let activo = null;
  document.querySelectorAll('[data-route]').forEach(el => {
    const encendido = el.dataset.route === hash;
    el.classList.toggle('active', encendido);
    if (encendido && el.classList.contains('nav-link')) activo = el;
  });
  mostrarActivoEnElMenu(activo);
}

/**
 * Deja el link marcado DENTRO de la parte visible del menú.
 *
 * ⚠️ Marcarlo no alcanza: `.sidebar-nav` tiene scroll propio y no cabe entero.
 * Medido en la app el 2026-08-29 con el menú abierto en `#skips` (viewport 879):
 * el `<nav>` mide 585 px de alto para 1076 px de contenido y arranca siempre en
 * `scrollTop: 0`, así que el link activo estaba en y=1075 — **490 px por debajo
 * del final del menú**. Estaba marcado y era imposible verlo, y las vistas de
 * abajo de la lista (`#skips`, `#sin-clasificar`, `#zeroplays`, `#versions`…)
 * son justo las que Ian usa. Por eso el marcado «no funcionaba».
 *
 * Se mueve el `scrollTop` del <nav> a mano y NO con `scrollIntoView()`: ese
 * scrollea todos los ancestros scrolleables, incluido el documento, así que en
 * una vista larga te mueve la lista de abajo del cursor por abrir el menú.
 */
function mostrarActivoEnElMenu(activo) {
  if (!activo) return;
  const nav = activo.closest('.sidebar-nav');
  if (!nav || nav.scrollHeight <= nav.clientHeight) return;
  const r = activo.getBoundingClientRect();
  const rn = nav.getBoundingClientRect();
  const MARGEN = 24;   // deja ver el link de al lado, para que se lea como lista
  if (r.top >= rn.top + MARGEN && r.bottom <= rn.bottom - MARGEN) return;
  const destino = nav.scrollTop + (r.top - rn.top) - (nav.clientHeight - r.height) / 2;
  nav.scrollTop = Math.max(0, Math.min(destino, nav.scrollHeight - nav.clientHeight));
}

function registerRoute(hash, handler) {
  routes[hash] = handler;
}

/**
 * Las rutas REGISTRADAS, tal cual las conoce el router.
 *
 * Existe para el barrido de vistas vivas (`#debug`). La gracia es que la lista
 * sale de acá y no de un array escrito a mano: la cuenta «las 23 rutas» de
 * v=171 se quedó vieja y dejó fuera `#new-releases` y `#sin-clasificar`, que es
 * como `#covers` pudo estar muerta nueve versiones sin que nadie la mirara. Una
 * ruta nueva entra al barrido por el solo hecho de registrarse.
 */
function rutasRegistradas() {
  return Object.keys(routes);
}

function navigate(hash) {
  window.location.hash = hash;
}

async function handleRoute() {
  // Teardown transversal: lo que tiene que morir al cambiar de ruta y no
  // pertenece a ninguna feature en particular. Hoy lo escuchan el reproductor
  // de previews (si no, el audio sigue sonando en la ruta nueva) y el botón
  // «Volver arriba» (que tiene que olvidarse del scroller de la vista vieja).
  // Se dispara SIEMPRE, incluso sin cleanup de ruta anterior: no depende de que
  // la vista que se va haya registrado uno.
  const hashNuevo = window.location.hash.slice(1) || 'home';
  generacionRuta += 1;
  // El aviso va ANTES del teardown: lo que quede renderizando en este punto es
  // exactamente lo que va a escribir sobre un DOM muerto, y queremos su nombre.
  marcarCambioDeRuta(hashActual, hashNuevo);
  // `detail` con las dos rutas: hasta ahora el evento no decía ni de dónde ni a
  // dónde, así que un listener no podía saber si le tocaba a él.
  document.dispatchEvent(new CustomEvent('routeteardown', {
    detail: { de: hashActual, a: hashNuevo, generacion: generacionRuta },
  }));

  if (currentCleanup) {
    // El teardown de la ruta anterior NO puede llevarse puesto el cambio de
    // ruta: si tira acá, nos quedamos sin pintar la nueva y con la vieja a
    // medio desmontar.
    try { currentCleanup(); } catch (e) { console.warn('[router] teardown:', e); }
    currentCleanup = null;
  }

  const hash = hashNuevo;
  hashActual = hash;
  const main = document.getElementById('main-content');
  if (!main) return;

  markActiveRoute(hash);

  const handler = routes[hash];
  if (handler) {
    // NUNCA se deja `main` vacío, ni por un frame. En cualquier ruta que no sea
    // Home el sidebar va fuera de pantalla y el header de página se pinta acá
    // dentro, así que un main vacío es la pantalla entera en blanco: solo el
    // fondo, sin barra lateral, sin título y sin forma de saber qué pasó. Es
    // exactamente lo que enganchó Ian en `#discover-artists`.
    //
    // El vaciado y el placeholder van en el MISMO paso sincrónico: entre los
    // dos no hay ningún punto en el que el compositor pueda quedarse con un
    // frame vacío. Con esto, lo peor que se puede ver es un spinner.
    main.innerHTML = LOADING_HTML;
    const gen = generacionRuta;
    abrirRender(gen, hash);
    try {
      currentCleanup = await guardRoute(main, handler);
    } finally {
      cerrarRender(gen);
    }
    // Segunda pasada: las `.home-card` de Home nacen DENTRO del handler, o sea
    // después del `markActiveRoute` de arriba. Sin esto, en Home no se marca
    // nada. Es idempotente y recorre unas decenas de nodos.
    markActiveRoute(hash);
  } else {
    main.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">?</div>
        <p>Página no encontrada</p>
      </div>
    `;
  }
}

function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

export { registerRoute, navigate, initRouter, handleRoute, rutasRegistradas };
