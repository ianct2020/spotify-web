// Ocultar un ARTISTA, una sola vez para toda la app (v=276).
//
// POR QUÉ ESTE ARCHIVO EXISTE
//
// Ian pidió (04/10, puntos 10, 12 y 13) poder ocultar artistas en `#similar`,
// en `#discover-artists` y en `#follow-artists`. Las tres son el mismo gesto —
// «este artista no me interesa, dejá de ofrecérmelo» — y `#recs` ya lo tenía
// resuelto desde v=205. Lo que faltaba no era el mecanismo: era que el
// mecanismo estuviera en un sitio al que las otras tres pudieran llegar.
//
// Así que el almacén de `recommendations.js` se MUDÓ acá tal cual —mismo
// `lsKey`, mismo `playlistName`, misma clave— y las cuatro vistas lo comparten.
// Mudarlo no migra nada: los 12 artistas que Ian ya tenía ocultos el 06/10
// siguen en `recs_ocultos` y en «fonoteca · ocultos (recomendados)», con el
// mismo id de playlist guardado. Si este archivo le cambiara el `lsKey`, esos
// 12 quedarían huérfanos — es exactamente lo que no se hizo.
//
// ⚠️ NO HAY SÉPTIMO ALMACÉN, Y ES UNA DECISIÓN MEDIDA.
//
// Hay seis almacenes de ocultos y cada uno re-pagina su playlist entera en cada
// sesión de página (`hiddenStore.ready()` va con `useCache:false`; está en la
// tabla de costos de CLAUDE.md). Un séptimo sumaría otra re-paginación
// permanente y una playlist más en la cuenta, y no compraría nada: el nº 2 ya
// es un almacén de artistas. Peor todavía, con dos almacenes de artistas
// ocultar a alguien en `#similar` no lo saca de `#recs`, que es el mismo bug
// que `discover-common.js` evita compartiendo `hiddenAlbums` entre las dos
// vistas de descubrir.
//
// ⚠️ LA CLAVE ES EL NOMBRE EN MINÚSCULAS, Y NO SE NORMALIZA MÁS.
//
// `name.toLowerCase()` y nada más: sin colapsar espacios, sin sacar acentos.
// No porque sea la mejor clave —no lo es— sino porque es la que escribieron los
// 12 ocultos que ya existen. Agregarle normalización acá dejaría a esos 12
// inalcanzables desde la app: la vista preguntaría por la clave nueva y en el
// caché estaría la vieja. Si algún día hay que normalizarla, es una migración
// con su propio encargo, como la de `cardKey` en v=210.
//
// ⚠️ UNA PLAYLIST SOLO GUARDA PISTAS, Y UN ARTISTA NO ES UNA PISTA.
//
// De cada artista oculto se guarda UNA pista suya como representante, igual que
// W-Three guarda una pista por álbum. Si no hay con qué representarlo, el
// almacén lo deja oculto SOLO en este navegador y lo avisa — ese camino ya
// existía y acá no se empeora, se usa menos: dos de las tres vistas nuevas
// sacan la pista representativa GRATIS de los me gusta que ya tienen en
// memoria (ver `uriSugerida`), así que no pasan ni por `/search`.

import { createHiddenStore } from '../util/hidden-sync.js?v=288';
import { recuperarUriDeArtistaKey, REGLAS_VERSION } from '../util/hidden-recover.js?v=288';
import { iconoPuntosVertical } from '../ui/icons.js?v=288';
import { escapeHtml } from '../ui/components.js?v=288';

/**
 * El almacén. Mudado desde `recommendations.js` sin tocarle ni el `lsKey` ni el
 * `playlistName`: los ocultos que ya existían siguen siendo los mismos.
 */
export const artistasOcultos = createHiddenStore({
  lsKey: 'recs_ocultos',
  playlistName: 'fonoteca · ocultos (recomendados)',
  label: 'recomendados',
  keyOfTrack: (t) => {
    const n = t?.artists?.[0]?.name;
    return n ? n.toLowerCase() : null;
  },
  // La clave es el nombre del artista: la uri no se deduce, se busca una pista
  // suya y se confirma que su `artists[0]` sea ese artista (v=205).
  recoverUri: recuperarUriDeArtistaKey,
  reglasRecuperador: REGLAS_VERSION,
});

/** La clave de un artista. Una sola definición: ver el aviso de arriba. */
export function claveDeArtista(nombre) {
  return typeof nombre === 'string' && nombre ? nombre.toLowerCase() : null;
}

/** Lectura instantánea: sale del caché local, 0 peticiones. */
export function artistaEstaOculto(nombre) {
  const k = claveDeArtista(nombre);
  return !!k && artistasOcultos.has(k);
}

/** Cuántos hay ocultos. 0 peticiones. */
export function cuantosArtistasOcultos() {
  return artistasOcultos.size;
}

/**
 * LA función. Las cuatro vistas llaman a ésta y a ninguna otra.
 *
 * `uriSugerida` es la pista representativa que la vista ya tiene a mano, si la
 * tiene. Pasarla es lo que hace que ocultar sea GRATIS:
 *
 *   · `#follow-artists` y `#discover-artists` arman su lista desde los me gusta,
 *     así que tienen ids de pistas de ese artista en memoria → 0 peticiones.
 *   · `#recs` y `#similar` ofrecen artistas que justamente NO están en los me
 *     gusta, así que no hay nada en memoria y hay que buscar: el `recoverUri`
 *     del almacén resuelve por `/search`, como desde v=205.
 *
 * ⚠️ Nunca lanza por no encontrar uri. El almacén ya sabe quedarse local y
 * avisarlo; que esta función explotara convertiría «se guardó solo acá» en «no
 * se guardó», que es peor.
 *
 * @param {{name: string}} artista
 * @param {{uriSugerida?: string|null}} [opciones]
 * @returns {Promise<boolean>} true si quedó oculto
 */
export async function alternarArtistaOculto(artista, { uriSugerida = null } = {}) {
  const key = claveDeArtista(artista?.name);
  if (!key) throw new Error('artista sin nombre');
  let uri = uriSugerida || null;
  if (!uri) {
    // Sin sugerencia: buscarla ahora, con el usuario mirando. Es lo que #recs ya
    // hacía desde v=205 (`buscarUriRepresentativa`), y es mejor que dejarlo para
    // el `sync()`: si la pista existe, el oculto nace en la playlist en vez de
    // nacer «solo en este navegador» y arreglarse más tarde en silencio.
    //
    // ⚠️ `recuperarUriDeArtistaKey` devuelve `{ uri, motivo, definitivo, reglas }`,
    // NO una cadena. Pasarle el objeto entero al `toggle` lo guardaría como uri
    // —un objeto donde va un `spotify:track:…`— y el oculto se subiría roto o no
    // se subiría, sin que nada se queje: `toggle` no valida la forma. El almacén
    // desenvuelve las dos formas, pero solo dentro de `sync()`; en este camino
    // hay que hacerlo acá.
    try {
      const res = await recuperarUriDeArtistaKey(key);
      uri = (res && typeof res === 'object') ? res.uri : res;
    } catch { uri = null; }
    if (typeof uri !== 'string' || !uri) uri = null;
  }
  return artistasOcultos.toggle(key, uri);
}

// ── El control: un botón de tres puntos VISIBLE ─────────────────────────────
//
// ⚠️ NO reemplaza al click derecho, lo acompaña. Ian propuso cambiar el menú
// contextual por éste (04/10) y no se hizo: el click derecho del navegador es
// el que trae copiar, abrir en pestaña nueva e inspeccionar, y sacárselo a una
// lista de artistas cuesta más de lo que da. Además un gesto oculto no se
// descubre solo — por eso el botón se ve siempre, no en hover.
//
// El click derecho SOBRE LA FILA abre el mismo menú como atajo de propina
// (`conectarMenuArtista` lo engancha), y ahí sí se previene el nativo; en el
// resto de la tarjeta el click derecho sigue siendo el de Chrome.

/** El botón ⋮ de una fila. `nombre` va crudo: se escapa acá. */
export function botonMenuArtistaHtml(nombre, { tamano = 14 } = {}) {
  const oculto = artistaEstaOculto(nombre);
  return `<button type="button" class="art-oc-menu-btn" data-art-oc="${escapeHtml(nombre)}"
    aria-haspopup="menu" aria-expanded="false"
    title="${oculto ? 'Opciones: devolverlo a la lista' : 'Opciones: ocultar este artista'}"
    aria-label="Opciones de ${escapeHtml(nombre)}">${iconoPuntosVertical(tamano)}</button>`;
}

// El menú es UNO para toda la app y vive en el <body>: dentro de la fila lo
// recortaría el `overflow` de las tarjetas, y uno por fila serían 183 menús
// escondidos en `#follow-artists`.
let menuEl = null;
let cerrarActual = null;

function menuDelDocumento() {
  if (menuEl && menuEl.isConnected) return menuEl;
  menuEl = document.createElement('div');
  menuEl.className = 'art-oc-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.hidden = true;
  document.body.appendChild(menuEl);
  return menuEl;
}

/** Cierra el menú si está abierto. Idempotente. */
export function cerrarMenuArtista() {
  if (cerrarActual) cerrarActual();
}

function abrirMenu(nombre, ancla, { onCambio }) {
  const menu = menuDelDocumento();
  cerrarMenuArtista();
  const oculto = artistaEstaOculto(nombre);
  menu.innerHTML = `
    <div class="art-oc-menu-titulo">${escapeHtml(nombre)}</div>
    <button type="button" class="art-oc-menu-item" data-accion="alternar">
      ${oculto ? 'Devolver a la lista' : 'Ocultar este artista'}
    </button>`;
  menu.hidden = false;
  ancla?.setAttribute?.('aria-expanded', 'true');

  // Posición: debajo del botón, y si no entra, encima. Se mide después de
  // mostrarlo porque un elemento con `hidden` no tiene alto.
  const r = ancla.getBoundingClientRect();
  const alto = menu.offsetHeight;
  const ancho = menu.offsetWidth;
  const abajo = r.bottom + 4;
  const cabeAbajo = abajo + alto <= window.innerHeight - 4;
  menu.style.top = `${(cabeAbajo ? abajo : Math.max(4, r.top - alto - 4)) + window.scrollY}px`;
  menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - ancho - 4)) + window.scrollX}px`;

  const primero = menu.querySelector('.art-oc-menu-item');
  primero?.focus();

  const cerrar = () => {
    menu.hidden = true;
    menu.innerHTML = '';
    ancla?.setAttribute?.('aria-expanded', 'false');
    document.removeEventListener('pointerdown', fuera, true);
    document.removeEventListener('keydown', tecla, true);
    window.removeEventListener('resize', cerrar);
    window.removeEventListener('scroll', cerrar, true);
    cerrarActual = null;
  };
  const fuera = (e) => { if (!menu.contains(e.target) && e.target !== ancla) cerrar(); };
  const tecla = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cerrar(); ancla?.focus?.(); }
  };
  document.addEventListener('pointerdown', fuera, true);
  document.addEventListener('keydown', tecla, true);
  window.addEventListener('resize', cerrar);
  window.addEventListener('scroll', cerrar, true);
  cerrarActual = cerrar;

  primero.onclick = async () => {
    primero.disabled = true;
    cerrar();
    await onCambio(nombre);
  };
}

/**
 * Engancha el menú en una vista. UNA llamada por vista, delegada: las filas se
 * repintan todo el tiempo y un listener por botón se perdería en cada repintado.
 *
 * @param {HTMLElement} raiz  el contenedor que sobrevive a los repintados
 * @param {object} opciones
 * @param {(nombre: string) => (Promise<void>|void)} opciones.onCambio
 *        qué hacer cuando se pidió ocultar/mostrar. La vista decide: resolver
 *        la uri gratis que tenga, llamar a `alternarArtistaOculto` y repintar.
 * @param {string} [opciones.selectorFila]  si se pasa, el click derecho sobre
 *        esa fila abre el menú también (atajo de propina, nunca el único acceso)
 * @returns {() => void} para desenganchar
 */
export function conectarMenuArtista(raiz, { onCambio, selectorFila = null } = {}) {
  const porBoton = (e) => {
    const btn = e.target.closest('.art-oc-menu-btn');
    if (!btn || !raiz.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    abrirMenu(btn.dataset.artOc, btn, { onCambio });
  };
  raiz.addEventListener('click', porBoton);

  let porDerecho = null;
  if (selectorFila) {
    porDerecho = (e) => {
      const fila = e.target.closest(selectorFila);
      if (!fila || !raiz.contains(fila)) return;
      const btn = fila.querySelector('.art-oc-menu-btn');
      if (!btn) return;
      e.preventDefault();
      abrirMenu(btn.dataset.artOc, btn, { onCambio });
    };
    raiz.addEventListener('contextmenu', porDerecho);
  }

  return () => {
    raiz.removeEventListener('click', porBoton);
    if (porDerecho) raiz.removeEventListener('contextmenu', porDerecho);
    cerrarMenuArtista();
  };
}

/**
 * El botón «Artistas ocultos N» de la barra. Devuelve '' si no hay ninguno y no
 * se está mirando la lista: una barra no se gasta en un contador de cero.
 *
 * ⚠️ Sale vacío a propósito cuando no hace falta — `#discover-artists` tiene la
 * barra llena (el 05/10 `#new-releases` quedó con 69 px libres) y un botón más
 * que no hace nada la parte en dos filas.
 */
export function botonArtistasOcultosHtml(id, { mirando = false } = {}) {
  const n = cuantosArtistasOcultos();
  if (!n && !mirando) return '';
  return `<button class="btn btn-secondary btn-sm ${mirando ? 'sc-on' : ''}" id="${id}"
    title="Los artistas que ocultaste. Se sincronizan con la playlist «fonoteca · ocultos (recomendados)» y valen para esta vista, Novedades, Recomendaciones y Similares.">Artistas ocultos <span class="art-oc-n">${n}</span></button>`;
}
