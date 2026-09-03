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

// ── Instrumentación de escrituras tardías (v=173) ────────────────────────────
//
// El crash a perseguir: «Cannot set properties of null (setting 'onclick')»
// zapeando de ruta con los cachés fríos. Un render asíncrono termina DESPUÉS
// del cambio de ruta y le escribe a un DOM que el router ya reemplazó. El
// `routeteardown` de v=141 existe justo para esto, pero la vista culpable no lo
// respeta: sigue adelante.
//
// El problema para arreglarlo era no saber CUÁL. El stack no sirve —los
// handlers son anónimos y el bundle no está mapeado— pero el router sí sabe qué
// render arrancó y no terminó. Así que se lleva registro de los renders EN
// VUELO: si al cambiar de ruta queda alguno abierto, esa vista es la candidata,
// y si además llega un error de escritura sobre null, se la nombra.
//
// El registro queda en localStorage para que Ian lo pueda pasar tal cual: un
// crash que solo se ve en su máquina, con sus cachés, no se reproduce acá.
const LOG_KEY = 'fonoteca_crash_log_v1';

const rendersEnVuelo = new Map();   // generación → { hash, desde }
let ultimoCambio = { de: null, a: null, cuando: 0 };

/** El router avisa que cambió de ruta, ANTES de arrancar el render nuevo. */
export function marcarCambioDeRuta(de, a) {
  ultimoCambio = { de, a, cuando: Date.now() };
  // Lo que quedó abierto al momento de salir es, por definición, un render que
  // va a terminar sobre un DOM que ya no existe.
  for (const [gen, r] of rendersEnVuelo) {
    const ms = Date.now() - r.desde;
    console.warn(
      `[crash-guard] «#${r.hash}» seguía renderizando (${ms} ms) cuando saliste a «#${a}». `
      + `Si algo escribe en el DOM después de esto, es esta vista.`
    );
    anotar({ tipo: 'render-huerfano', vista: r.hash, saliste_a: a, ms, generacion: gen });
  }
}

export function abrirRender(gen, hash) { rendersEnVuelo.set(gen, { hash, desde: Date.now() }); }
export function cerrarRender(gen) { rendersEnVuelo.delete(gen); }

/** Los renders que arrancaron y todavía no terminaron. */
function enVuelo() {
  return [...rendersEnVuelo.values()].map(r => r.hash);
}

// Cupos SEPARADOS por tipo, y no un tope global (arreglado el 2026-08-29, a la
// primera vez que sirvió de verdad): un zapeo rápido genera cientos de
// «render-huerfano» y con un solo cupo de 20 se comían la «escritura-tardia»,
// que es la única entrada que dice qué vista rompió. Se perdió justo la buena.
const CUPOS = { 'escritura-tardia': 30, 'render-huerfano': 15 };
const CUPO_POR_DEFECTO = 10;

function anotar(entrada) {
  try {
    let previo = [];
    try { previo = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { previo = []; }
    const lista = [{ cuando: new Date().toISOString(), ...entrada }, ...previo];
    const vistos = {};
    const podada = lista.filter(e => {
      const t = e.tipo || 'otro';
      vistos[t] = (vistos[t] || 0) + 1;
      return vistos[t] <= (CUPOS[t] ?? CUPO_POR_DEFECTO);
    });
    localStorage.setItem(LOG_KEY, JSON.stringify(podada));
  } catch { /* el registro es una red, no un requisito */ }
}

/** Para leer el registro desde la consola: `window.__crashLog()`. */
try {
  window.__crashLog = () => { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; } };
} catch { /* sin window */ }

// Los dos mensajes con los que el navegador reporta una escritura sobre un nodo
// que ya no está. Chrome dice «Cannot set properties of null (setting 'x')».
const ESCRITURA_SOBRE_NULL = /Cannot (?:set|read) propert(?:y|ies) of (?:null|undefined)/i;

/**
 * ¿Este error es una escritura tardía, y de qué vista?
 * Devuelve null si no encaja en el patrón.
 */
function culparEscrituraTardia(err) {
  if (!ESCRITURA_SOBRE_NULL.test(mensajeDe(err))) return null;
  const abiertos = enVuelo();
  const desdeElCambio = ultimoCambio.cuando ? Date.now() - ultimoCambio.cuando : null;
  // Sin render abierto y sin cambio de ruta reciente es otra cosa: un bug
  // normal de la vista actual. No lo disfrazamos.
  if (!abiertos.length && !(desdeElCambio !== null && desdeElCambio < 10000)) return null;
  const sospechosa = abiertos[0] || ultimoCambio.de;
  anotar({
    tipo: 'escritura-tardia',
    vista: sospechosa,
    en_vuelo: abiertos,
    saliste_de: ultimoCambio.de,
    estas_en: ultimoCambio.a,
    ms_desde_el_cambio: desdeElCambio,
    mensaje: mensajeDe(err),
  });
  return sospechosa;
}

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
        <p class="crash-hint">Recargar suele alcanzar. Si vuelve a pasar, cierra sesión y vuelve a entrar: puede ser el token de Spotify.</p>
        <div class="crash-actions">
          <button class="btn btn-primary" data-crash-reload>Recargar la página</button>
          <a class="btn btn-secondary" href="#home" data-crash-home>Ir al inicio</a>
        </div>
      </div>
    </div>
  `;
  el.querySelector('[data-crash-reload]')?.addEventListener('click', () => location.reload());
}

function banner(err, { crudo = false } = {}) {
  if (document.getElementById(BANNER_ID)) return;   // uno solo, no una pila
  const div = document.createElement('div');
  div.id = BANNER_ID;
  div.className = 'crash-banner';
  div.setAttribute('role', 'alert');
  div.innerHTML = `
    <span class="crash-banner-txt">${crudo ? esc(mensajeDe(err)) : `Algo falló por detrás: ${esc(mensajeDe(err))}`}</span>
    <button class="btn btn-secondary btn-sm" data-crash-reload>Recargar</button>
    <button class="crash-banner-x" aria-label="Cerrar aviso">✕</button>
  `;
  div.querySelector('[data-crash-reload]').onclick = () => location.reload();
  div.querySelector('.crash-banner-x').onclick = () => div.remove();
  document.body.appendChild(div);
}

function alFallar(err) {
  const culpable = culparEscrituraTardia(err);
  if (culpable) {
    // La ruta nueva SÍ está pintada: la app no está rota, solo quedó código de
    // la vista vieja escribiendo al vacío. El aviso nombra la vista en vez de
    // mostrar un mensaje del navegador que no dice nada.
    console.error(
      `[crash-guard] ESCRITURA TARDÍA de «#${culpable}»: terminó de renderizar después `
      + `del cambio de ruta y escribió sobre un DOM que ya no existe. `
      + `No respeta el «routeteardown». Registro en window.__crashLog().`
    );
    banner(`«${culpable}» siguió cargando después de que saliste de esa vista. Lo que estás viendo está bien.`, { crudo: true });
    return;
  }
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
