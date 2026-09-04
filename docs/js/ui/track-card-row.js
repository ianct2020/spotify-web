// Tarjeta horizontal de canción, compartida por `#sin-clasificar` y `#skips`.
//
// Nació en v=138 dentro de `sin-clasificar.js`; en v=140 se extrajo acá para
// que `#skips` use LA MISMA, no una copia. El CSS vive en `components.css`
// bajo el prefijo `.sc-`, que se quedó por historia: hoy es el de esta
// tarjeta, no el de una vista.
//
// Anatomía: tapa de 96px a la izquierda (desde la imagen de 300×300, con la de
// 64 en el `onerror`) y a la derecha título con marquee, artistas, una línea
// secundaria y la fila de controles.
//
// La tarjeta ENTERA es el control de selección — `role="option"` dentro de un
// `role="listbox" aria-multiselectable`, borde de acento + `--color-accent-tint`
// + un check sobre la esquina de la tapa cuando está marcada, `tabindex`,
// Enter/Espacio y focus visible. Por eso no hay checkbox suelto.
//
// Reglas que hay que respetar al usarla:
//   - Los handlers van DELEGADOS en el grid (`wireTrackCardGrid`). Con lista
//     incremental las tarjetas de los lotes siguientes no existen todavía;
//     cablear por tarjeta deja medio listado muerto y sin un solo error.
//   - Cada tarjeta se resuelve por `data-id` contra un Map, nunca por índice.
//   - La selección vive en un Set del feature, no en el DOM.

import { escapeHtml } from './components.js?v=197';
import { marqueeSpan } from './marquee.js?v=197';
import { isPlayingAudio } from './preview-player.js?v=197';

const OJO_ABIERTO = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const OJO_TACHADO = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
const PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>`;
const FICHA = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>`;
const CHECK = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
// Corazón tachado: sacar de tus me gusta. Es la ÚNICA acción de la tarjeta que
// escribe en Spotify y no se puede deshacer desde acá, así que va con su propia
// clase (`sc-danger`) y el que la cablea está obligado a confirmar antes.
const CORAZON_TACHADO = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7.5-4.6-9.5-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.5 12c-2 4.4-9.5 9-9.5 9z"/><line x1="3" y1="3" x2="21" y2="21"/></svg>`;

/**
 * Devuelve el HTML de una tarjeta. Todos los campos de texto se escapan acá.
 *
 * @param {object} r
 * @param {string} r.id        identidad de la fila (va en `data-id`)
 * @param {string} r.name      título
 * @param {string} r.artists   artistas ya unidos en un string
 * @param {string} [r.sub]     tercera línea (álbum, fecha…)
 * @param {string} [r.cover]   URL de la tapa grande (300×300). Va en `data-src`:
 *                             la carga la resuelve `ui/lazy-img.js`.
 * @param {string} [r.coverSmall] tapa de 64 para el `onerror`
 * @param {string} [r.trackId] id de Spotify, para el ↗
 * @param {object} [opts]
 * @param {boolean} [opts.selected]
 * @param {boolean} [opts.playing]
 * @param {boolean} [opts.hidden]  la tarjeta está en la vista de ocultos
 * @param {boolean} [opts.showAdd] muestra el botón «Añadir a…»
 * @param {boolean} [opts.showUnlike] muestra el ♥ tachado («Sacar de likes»)
 * @param {boolean} [opts.showHide] muestra el ojo de ocultar (true por defecto;
 *                                  #zeroplays no tiene lista de ocultos)
 * @param {boolean} [opts.showCard] muestra el ⓘ de la ficha del tema
 * @param {string} [opts.badge]   HTML que va antes de los botones (el % de skips)
 * @param {string} [opts.extra]   HTML al final de la tarjeta (el slot del embed)
 */
export function renderTrackCardRow(r, opts = {}) {
  const {
    selected = false, playing = false, hidden = false,
    showAdd = false, showCard = true, showUnlike = false, showHide = true, badge = '', extra = '',
  } = opts;

  // El icono no sale de `playing` a secas: `playing` dice que ESTA tarjeta es
  // el preview actual (puede estar buscando, buffereando o ser un embed), y el
  // ⏸ solo puede aparecer si el <audio> está sonando de verdad. Se pregunta al
  // player en vez de recibirlo por parámetro para que una tarjeta repintada a
  // mitad de reproducción (setItems) nazca con el icono correcto.
  const sonando = playing && isPlayingAudio();

  const id = escapeHtml(r.id);
  const nombre = escapeHtml(r.name || '(sin nombre)');
  const artistas = escapeHtml(r.artists || '');
  const sub = r.sub ? escapeHtml(r.sub) : '';

  // La URL de 300 se deduce del prefijo del CDN (util/cover-size.js), que es
  // una convención NO documentada: si alguna vez no existe, la tapa cae a la de
  // 64 en vez de quedar rota. El onerror se desarma solo para no ciclar.
  const fallback = r.coverSmall && r.coverSmall !== r.cover
    ? ` onerror="this.onerror=null;this.src='${escapeHtml(r.coverSmall)}'"`
    : '';

  return `
    <div class="sc-card${selected ? ' is-sel' : ''}" data-id="${id}"
         role="option" aria-selected="${selected}" tabindex="0"
         aria-label="${nombre} — ${artistas}">
      <div class="sc-cover-wrap">
        ${r.cover
          ? `<img class="sc-cover" data-src="${escapeHtml(r.cover)}" alt="" width="96" height="96" decoding="async"${fallback}>`
          : `<div class="sc-cover sc-cover-empty">♪</div>`}
        <span class="sc-check-badge" aria-hidden="true">${CHECK}</span>
      </div>
      <div class="sc-card-body">
        <div class="sc-info">
          <div class="sc-title">${marqueeSpan(nombre)}</div>
          <div class="sc-meta">${artistas}</div>
          ${sub ? `<div class="sc-meta sc-meta-sub">${sub}</div>` : ''}
        </div>
        <div class="sc-actions">
          ${badge}
          <button type="button" class="sc-btn sc-play${playing ? ' playing' : ''}" title="${sonando ? TITULO_PAUSA : TITULO_PLAY}" aria-label="${sonando ? 'Parar preview' : 'Preview'}">${sonando ? PAUSE : PLAY}</button>
          ${showCard && r.trackId
            ? `<button type="button" class="sc-btn sc-card-btn" title="Ver la ficha del tema" aria-label="Ver ficha">${FICHA}</button>`
            : ''}
          ${showAdd ? `<button type="button" class="sc-btn sc-add" title="Añadir a una playlist">Añadir a…</button>` : ''}
          ${showUnlike && r.trackId
            ? `<button type="button" class="sc-btn sc-unlike sc-danger" title="Sacar de tus me gusta (borra el like en Spotify)" aria-label="Sacar de tus me gusta">${CORAZON_TACHADO}</button>`
            : ''}
          ${r.trackId
            ? `<a class="sc-btn sc-open" href="https://open.spotify.com/track/${escapeHtml(r.trackId)}" target="_blank" rel="noopener" title="Abrir en Spotify" aria-label="Abrir en Spotify">↗</a>`
            : ''}
          ${showHide ? `<button type="button" class="sc-btn sc-hide" title="${hidden ? 'Devolver a la lista' : 'Ocultar de la lista (no toca Spotify)'}" aria-label="${hidden ? 'Devolver' : 'Ocultar'}">
            ${hidden ? OJO_ABIERTO : OJO_TACHADO}
          </button>` : ''}
        </div>
      </div>
      ${extra}
    </div>
  `;
}

/**
 * Cablea el grid entero por delegación. Devuelve una función para desarmarlo.
 *
 * @param {HTMLElement} grid
 * @param {object} handlers
 * @param {(id: string) => any} handlers.rowById   resuelve la fila desde el data-id
 * @param {(id: string, o: {range: boolean}) => void} handlers.onToggle
 * @param {(r: any, card: HTMLElement) => void} [handlers.onPlay]
 * @param {(r: any) => void} [handlers.onCard]
 * @param {(r: any) => void} [handlers.onAdd]
 * @param {(r: any) => void} [handlers.onHide]
 * @param {(r: any) => void} [handlers.onUnlike]  DESTRUCTIVO: tiene que confirmar
 */
export function wireTrackCardGrid(grid, { rowById, onToggle, onPlay, onCard, onAdd, onHide, onUnlike } = {}) {
  if (!grid) return () => {};

  const onClick = (e) => {
    const card = e.target.closest('.sc-card');
    if (!card || !grid.contains(card)) return;
    const r = rowById(card.dataset.id);
    if (!r) return;

    // Los controles cortan acá: tocarlos no selecciona la tarjeta. El ↗ de
    // Spotify es un <a>, así que no alcanza con mirar los <button>.
    const control = e.target.closest('button, a');
    if (control) {
      if (control.classList.contains('sc-open')) return;   // link externo, que siga
      e.preventDefault();
      e.stopPropagation();
      if (control.classList.contains('sc-play')) onPlay?.(r, card);
      else if (control.classList.contains('sc-card-btn')) onCard?.(r);
      else if (control.classList.contains('sc-add')) onAdd?.(r);
      else if (control.classList.contains('sc-hide')) onHide?.(r);
      else if (control.classList.contains('sc-unlike')) onUnlike?.(r);
      return;
    }

    onToggle?.(card.dataset.id, { range: e.shiftKey });
  };

  // Enter y Espacio togglean la tarjeta enfocada. El Espacio además scrollea la
  // página por defecto, así que hay que cortarlo.
  const onKeydown = (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const card = e.target.closest?.('.sc-card');
    if (!card || e.target.closest('button, a')) return;
    e.preventDefault();
    onToggle?.(card.dataset.id, { range: e.shiftKey });
  };

  grid.addEventListener('click', onClick);
  grid.addEventListener('keydown', onKeydown);
  return () => {
    grid.removeEventListener('click', onClick);
    grid.removeEventListener('keydown', onKeydown);
  };
}

// ── Estado de reproducción ───────────────────────────────────────────────────

const TITULO_PLAY = 'Preview de 30 s — no suma reproducciones';
const TITULO_PAUSA = 'Parar el preview';

function pintarBoton(btn, actual, sonando) {
  btn.classList.toggle('playing', !!actual);
  const pausa = !!actual && !!sonando;
  btn.innerHTML = pausa ? PAUSE : PLAY;
  btn.title = pausa ? TITULO_PAUSA : TITULO_PLAY;
  btn.setAttribute('aria-label', pausa ? 'Parar preview' : 'Preview');
}

/**
 * Refleja en un grid de tarjetas qué preview está sonando: el botón de la fila
 * actual pasa a ⏸ mientras el <audio> suena de verdad, y vuelve a ▶ cuando se
 * pausa, se acaba o arranca otra tarjeta.
 *
 * Se llama desde el listener de `previewchange` de cada vista, con el `detail`
 * tal cual. `prefix` es el que usa la vista para sus keys (`sk`, `sc`, `zp`),
 * o sea que la key del player es `${prefix}:${data-id}`.
 *
 * Barre el grid buscando `.sc-play.playing` en vez de acordarse de qué botón
 * marcó: `setItems` puede haber repintado las tarjetas entre dos eventos, y
 * entonces el nodo que teníamos guardado ya no está en el documento — el que
 * quedaría en ⏸ para siempre es el nuevo.
 *
 * @param {HTMLElement} grid
 * @param {string} prefix
 * @param {{key: string|null, playing: boolean}} detail
 */
export function paintPlayingCard(grid, prefix, { key = null, playing = false } = {}) {
  if (!grid) return;
  const p = `${prefix}:`;
  const id = key && key.startsWith(p) ? key.slice(p.length) : null;
  // El selector NO pide `.sc-card`: `#recs` no usa la tarjeta compartida (sus
  // filas son `<label>` con checkbox) pero sí el mismo botón `.sc-play`, y con
  // esto puede reusar este repintado tal cual. Para las vistas que sí usan la
  // tarjeta no cambia nada: su `.sc-card` es la que lleva el `data-id`.
  const actual = id
    ? grid.querySelector(`[data-id="${CSS.escape(id)}"] .sc-play`)
    : null;
  grid.querySelectorAll('.sc-play.playing').forEach(btn => {
    if (btn !== actual) pintarBoton(btn, false, false);
  });
  // El lote de esa fila puede no estar pintado todavía: nace con el icono
  // correcto igual, porque `renderTrackCardRow` le pregunta al player.
  if (actual) pintarBoton(actual, true, playing);
}

/**
 * Marca un botón como activo sin audio nuestro sonando. Lo usa el embed inline
 * de `#skips`: el iframe reproduce por su cuenta y no nos avisa de nada, así
 * que queda tintado con el ▶ y se apaga al cerrar el embed.
 */
export function paintEmbedCard(btn, activo) {
  pintarBoton(btn, !!activo, false);
}

/** Refleja el estado de selección en una tarjeta ya pintada. */
export function paintCardSelection(card, selected) {
  if (!card) return;
  card.classList.toggle('is-sel', selected);
  card.setAttribute('aria-selected', selected ? 'true' : 'false');
}
