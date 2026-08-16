import { guardRoute } from './ui/crash-guard.js?v=147';

const routes = {};

// Lo que ocupa el hueco mientras la ruta se pinta. Es lo mismo que ponen casi
// todas las features en su primera línea, así que en la práctica no se ve.
const LOADING_HTML = '<div class="empty-state" data-route-placeholder><div class="spinner spinner-lg"></div></div>';
let currentCleanup = null;

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

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.route === hash);
  });

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
