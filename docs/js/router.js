const routes = {};
let currentCleanup = null;

function registerRoute(hash, handler) {
  routes[hash] = handler;
}

function navigate(hash) {
  window.location.hash = hash;
}

async function handleRoute() {
  if (currentCleanup) {
    currentCleanup();
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
    main.innerHTML = '';
    const cleanup = await handler(main);
    if (typeof cleanup === 'function') {
      currentCleanup = cleanup;
    }
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
