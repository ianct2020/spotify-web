// Modal compartido "Añadir a playlists" con checkboxes (multi-selección).
//
// Lo usan #sin-clasificar (una canción o la selección múltiple), #new-releases
// y #discover-artists (un lanzamiento o la selección múltiple). Antes cada
// vista tenía su propia lista de un solo click; ahora se marcan todas las
// playlists que hagan falta y se confirma una vez.
//
// Pasa por modal-stack.js como todo modal de la app.
//
//   openPlaylistPicker({
//     subtitle: 'CANNIBALISM! — Slayyyter',
//     playlists: [{ id, name, image }],
//     onReload: async () => [{ id, name, image }],       // opcional: botón ↻
//     onConfirm: async (elegidas, { setStatus }) => { … },
//   });
//
// Si `onConfirm` lanza, el modal sigue abierto. `setStatus` cambia la etiqueta
// del botón mientras se trabaja (el chequeo de duplicados puede tardar si una
// playlist grande no está cacheada).

import { openModal, closeModal } from './modal-stack.js?v=142';
import { escapeHtml } from './components.js?v=142';
import { showToast } from './toast.js?v=142';
import { normText } from '../util/track-match.js?v=142';

function filasHtml(playlists, marcadas = new Set()) {
  return playlists.map(p => `
    <label class="sc-ex-item pp-item" data-name="${escapeHtml(p.name)}">
      <input type="checkbox" value="${escapeHtml(p.id)}"${marcadas.has(p.id) ? ' checked' : ''}>
      ${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : `<span class="sc-pl-ph">♪</span>`}
      <span class="sc-pl-name">${escapeHtml(p.name)}</span>
    </label>
  `).join('');
}

export function openPlaylistPicker({
  id = 'playlist-picker',
  title = 'Añadir a playlists',
  subtitle = '',
  confirmLabel = 'Añadir',
  playlists = [],
  preselected = [],
  onReload = null,
  onConfirm,
} = {}) {
  const marcadas = new Set(preselected);
  // `playlists` se reemplaza entero al recargar, así que el resto del modal lo
  // lee siempre desde acá y no desde el parámetro.
  let actuales = playlists;

  const overlay = openModal({
    id,
    html: `
      <div class="modal sc-modal">
        <div class="sc-modal-head">
          <h2 style="margin:0">${escapeHtml(title)}</h2>
          <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar" aria-label="Cerrar">✕</button>
        </div>
        ${subtitle ? `<p class="sc-modal-sub">${escapeHtml(subtitle)}</p>` : ''}
        <p class="sc-modal-sub">Marca todas las playlists a las que quieras añadirlo.</p>
        <div class="pp-searchrow">
          <input type="search" class="input" id="pp-search" placeholder="Buscar playlist" autocomplete="off">
          ${onReload ? `<button class="btn btn-secondary btn-sm" id="pp-reload" title="Volver a pedir tus playlists a Spotify">↻ Recargar</button>` : ''}
        </div>
        <div class="sc-pl-list" id="pp-list">${filasHtml(playlists, marcadas)}</div>
        <p class="sc-modal-sub" id="pp-empty"${playlists.length ? ' hidden' : ''}>No tienes ninguna playlist propia donde añadirlo.</p>
        <div class="modal-actions">
          <span class="pp-count" id="pp-count">Ninguna playlist marcada</span>
          <button class="btn btn-secondary" data-close-modal>Cancelar</button>
          <button class="btn btn-primary" id="pp-confirm" disabled>${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `,
  });

  const list = overlay.querySelector('#pp-list');
  const buscador = overlay.querySelector('#pp-search');
  const contador = overlay.querySelector('#pp-count');
  const confirmar = overlay.querySelector('#pp-confirm');

  const recargar = overlay.querySelector('#pp-reload');
  const vacio = overlay.querySelector('#pp-empty');

  const seleccionadas = () =>
    [...list.querySelectorAll('input[type=checkbox]')]
      .filter(cb => cb.checked)
      .map(cb => actuales.find(p => p.id === cb.value))
      .filter(Boolean);

  function refrescarContador() {
    const n = seleccionadas().length;
    confirmar.disabled = n === 0;
    contador.textContent = n === 0
      ? 'Ninguna playlist marcada'
      : `${n} playlist${n === 1 ? '' : 's'} marcada${n === 1 ? '' : 's'}`;
  }
  refrescarContador();

  setTimeout(() => buscador.focus(), 30);
  function aplicarFiltro() {
    const q = normText(buscador.value);
    list.querySelectorAll('.pp-item').forEach(el => {
      el.hidden = q ? !normText(el.dataset.name).includes(q) : false;
    });
  }
  buscador.addEventListener('input', aplicarFiltro);

  list.addEventListener('change', refrescarContador);

  // Recargar: para cuando creaste la playlist en Spotify con el modal ya
  // abierto. Se conservan las marcas y el texto del buscador.
  if (recargar) {
    recargar.onclick = async () => {
      const antes = new Set(actuales.map(p => p.id));
      const marcadasAhora = new Set(seleccionadas().map(p => p.id));
      recargar.disabled = true;
      recargar.textContent = 'Recargando…';
      try {
        const frescas = await onReload();
        actuales = Array.isArray(frescas) ? frescas : actuales;
        list.innerHTML = filasHtml(actuales, marcadasAhora);
        vacio.hidden = actuales.length > 0;
        aplicarFiltro();
        refrescarContador();
        const nuevas = actuales.filter(p => !antes.has(p.id));
        if (nuevas.length === 1) {
          showToast(`Playlist nueva: ${nuevas[0].name}`, 'success');
        } else if (nuevas.length > 1) {
          showToast(`${nuevas.length} playlists nuevas`, 'success');
        } else {
          showToast(`La lista ya estaba al día: ${actuales.length} playlists`, 'info');
        }
      } catch (e) {
        console.error('[playlist-picker] recargar', e);
        showToast(`No se pudieron recargar las playlists: ${e.message}`, 'error');
      } finally {
        recargar.disabled = false;
        recargar.textContent = '↻ Recargar';
      }
    };
  }

  confirmar.onclick = async () => {
    const elegidas = seleccionadas();
    if (!elegidas.length) return;
    const textoOriginal = confirmar.textContent;
    confirmar.disabled = true;
    confirmar.textContent = 'Añadiendo…';
    if (recargar) recargar.disabled = true;
    list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.disabled = true);
    // El chequeo de duplicados lee cada playlist elegida antes de escribir; si
    // alguna no está cacheada eso tarda, así que el botón va contando.
    const setStatus = (txt) => { confirmar.textContent = txt || 'Añadiendo…'; };
    try {
      if (onConfirm) await onConfirm(elegidas, { setStatus });
      // Por handle y no closeTop(): `onConfirm` lee las playlists elegidas
      // antes de escribir y eso tarda; si en el medio se apiló otro modal
      // encima, closeTop() cerraría ese en vez de este.
      closeModal(overlay);
    } catch (e) {
      console.error('[playlist-picker]', e);
      confirmar.textContent = textoOriginal;
      if (recargar) recargar.disabled = false;
      list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.disabled = false);
      refrescarContador();
    }
  };

  return overlay;
}
