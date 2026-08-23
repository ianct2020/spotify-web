import { guardRoute } from './ui/crash-guard.js?v=154';
import { skelPage } from './ui/skeleton.js?v=154';

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

// Marca la vista activa (v=154). Cualquier elemento con `data-route` se pinta
// distinto cuando su ruta es la actual: los `.nav-link` del <aside> y las
// `.home-card` de HOME_SECTIONS. Se resuelve acá, escuchando el cambio de ruta,
// y no repintando el sidebar entero — el <aside> se arma una sola vez en
// app.js y no se vuelve a tocar en toda la sesión.
function markActiveRoute(hash) {
  document.querySelectorAll('[data-route]').forEach(el => {
    el.classList.toggle('active', el.dataset.route === hash);
  });
}

function registerRoute(hash, handler) {
  routes[hash] = handler;
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
  document.dispatchEvent(new CustomEvent('routeteardown'));

  if (currentCleanup) {
    // El teardown de la ruta anterior NO puede llevarse puesto el cambio de
    // ruta: si tira acá, nos quedamos sin pintar la nueva y con la vieja a
    // medio desmontar.
    try { currentCleanup(); } catch (e) { console.warn('[router] teardown:', e); }
    currentCleanup = null;
  }

  const hash = window.location.hash.slice(1) || 'home';
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
    currentCleanup = await guardRoute(main, handler);
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

export { registerRoute, navigate, initRouter, handleRoute };
