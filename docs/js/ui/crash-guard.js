// Red de seguridad contra la pantalla en blanco.
//
// El fallo que motiva esto (v=140): el router hace `main.innerHTML = ''` y
// después `await handler(main)`. Si el handler revienta —o se queda colgado—
// antes de escribir nada, `#main-content` queda vacío. Y como en cualquier ruta
// que no sea Home el sidebar va con `body.sidebar-hidden` (fuera de pantalla) y
// el header de página se pinta DENTRO de main, el resultado es literalmente el
// fondo y nada más: ni barra lateral, ni título, ni error, ni forma de saber
// qué pasó. Ian lo enganchó en `#discover-artists` después de dejar la pestaña
// un rato quieta.
//
// Un fallo silencioso en blanco es peor que cualquier error visible, así que
// acá hay dos capas:
//
//   1. `guardRoute()` — envuelve el render de cada ruta. Si tira, o si termina
//      con el container vacío, pinta el cartel. Es la que ataca la causa.
//   2. `installCrashGuard()` — `error` y `unhandledrejection` globales. Si en
//      ese momento la app está en blanco, pinta el cartel; si hay algo pintado,
//      no le pisa el trabajo al usuario: avisa con un banner chico y arriba.
//
// Nada de esto reemplaza al manejo de errores de cada feature: es el último
// recurso para que SIEMPRE haya algo en pantalla y un botón de recargar.

const BANNER_ID = 'crash-banner';
let installed = false;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mensajeDe(err) {
  if (!err) return 'Error desconocido';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

// "Está en blanco" = el hueco del contenido no tiene nada que el usuario pueda
// leer. Se mira el texto y los elementos, no la longitud del HTML: un container
// con un comentario o un div vacío también se ve en blanco. El placeholder que
// deja el router mientras la ruta carga cuenta como vacío: si la ruta terminó y
// lo único que quedó es el spinner, es que no pintó nada.
function estaEnBlanco(el) {
  if (!el) return false;
  if (el.childElementCount === 1 && el.firstElementChild.hasAttribute('data-route-placeholder')) return true;
  return el.childElementCount === 0 && !el.textContent.trim();
}

function contenedorPrincipal() {
  return document.getElementById('main-content') || document.getElementById('app');
}

export function pantallaDeError(container, err, { titulo = 'Se rompió algo al cargar esta página' } = {}) {
  const el = container || contenedorPrincipal();
  if (!el) return;
  el.innerHTML = `
    <div class="crash-screen">
      <div class="crash-card">
        <h2>${esc(titulo)}</h2>
        <p class="crash-msg">${esc(mensajeDe(err))}</p>
        <p class="crash-hint">Recargar suele alcanzar. Si vuelve a pasar, cerrá sesión y volvé a entrar: puede ser el token de Spotify.</p>
        <div class="crash-actions">
          <button class="btn btn-primary" data-crash-reload>Recargar la página</button>
          <a class="btn btn-secondary" href="#home" data-crash-home>Ir al inicio</a>
        </div>
      </div>
    </div>
  `;
  el.querySelector('[data-crash-reload]')?.addEventListener('click', () => location.reload());
}

function banner(err) {
  if (document.getElementById(BANNER_ID)) return;   // uno solo, no una pila
  const div = document.createElement('div');
  div.id = BANNER_ID;
  div.className = 'crash-banner';
  div.setAttribute('role', 'alert');
  div.innerHTML = `
    <span class="crash-banner-txt">Algo falló por detrás: ${esc(mensajeDe(err))}</span>
    <button class="btn btn-secondary btn-sm" data-crash-reload>Recargar</button>
    <button class="crash-banner-x" aria-label="Cerrar aviso">✕</button>
  `;
  div.querySelector('[data-crash-reload]').onclick = () => location.reload();
  div.querySelector('.crash-banner-x').onclick = () => div.remove();
  document.body.appendChild(div);
}

function alFallar(err) {
  const el = contenedorPrincipal();
  if (estaEnBlanco(el)) pantallaDeError(el, err);
  else banner(err);
}

export function installCrashGuard() {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (e) => {
    // Los errores de recurso (una tapa que 404ea, y de esas hay muchas) también
    // llegan acá cuando el listener va en captura, pero no traen `error` y su
    // target es el elemento. No son un fallo de la app.
    if (e.target && e.target !== window) return;
    console.error('[crash-guard] error:', e.error || e.message);
    alFallar(e.error || e.message);
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('[crash-guard] promesa sin catch:', e.reason);
    alFallar(e.reason);
  });
}

/**
 * Envuelve el render de una ruta. Devuelve el cleanup que haya devuelto el
 * handler, o null.
 *
 * @param {HTMLElement} container
 * @param {Function} handler
 */
export async function guardRoute(container, handler) {
  try {
    const cleanup = await handler(container);
    // El caso de Ian: el handler no tiró, pero tampoco escribió (se fue por una
    // rama que hace `return` sin pintar, o la escritura se perdió). Un container
    // vacío no es un estado válido de ninguna ruta.
    if (estaEnBlanco(container)) {
      console.error('[crash-guard] la ruta terminó sin pintar nada');
      pantallaDeError(container, 'La página terminó de cargar sin contenido.', {
        titulo: 'Esta página quedó vacía',
      });
      return null;
    }
    return typeof cleanup === 'function' ? cleanup : null;
  } catch (err) {
    console.error('[crash-guard] la ruta rompió:', err);
    pantallaDeError(container, err);
    return null;
  }
}
