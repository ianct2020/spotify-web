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
//     onConfirm: async (elegidas) => { … },   // si lanza, el modal sigue abierto
//   });

import { openModal, closeTop } from './modal-stack.js';
import { escapeHtml } from './components.js';
import { normText } from '../util/track-match.js';

export function openPlaylistPicker({
  id = 'playlist-picker',
  title = 'Añadir a playlists',
  subtitle = '',
  confirmLabel = 'Añadir',
  playlists = [],
  preselected = [],
  onConfirm,
} = {}) {
  const marcadas = new Set(preselected);

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
        <input type="search" class="input" id="pp-search" placeholder="Buscar playlist" autocomplete="off">
        <div class="sc-pl-list" id="pp-list">
          ${playlists.map(p => `
            <label class="sc-ex-item pp-item" data-name="${escapeHtml(p.name)}">
              <input type="checkbox" value="${escapeHtml(p.id)}"${marcadas.has(p.id) ? ' checked' : ''}>
              ${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : `<span class="sc-pl-ph">♪</span>`}
              <span class="sc-pl-name">${escapeHtml(p.name)}</span>
            </label>
          `).join('')}
        </div>
        ${playlists.length === 0 ? `<p class="sc-modal-sub">No tienes ninguna playlist propia donde añadirlo.</p>` : ''}
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

  const seleccionadas = () =>
    [...list.querySelectorAll('input[type=checkbox]')]
      .filter(cb => cb.checked)
      .map(cb => playlists.find(p => p.id === cb.value))
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
  buscador.addEventListener('input', () => {
    const q = normText(buscador.value);
    list.querySelectorAll('.pp-item').forEach(el => {
      el.hidden = q ? !normText(el.dataset.name).includes(q) : false;
    });
  });

  list.addEventListener('change', refrescarContador);

  confirmar.onclick = async () => {
    const elegidas = seleccionadas();
    if (!elegidas.length) return;
    const textoOriginal = confirmar.textContent;
    confirmar.disabled = true;
    confirmar.textContent = 'Añadiendo…';
    list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.disabled = true);
    try {
      if (onConfirm) await onConfirm(elegidas);
      closeTop();
    } catch (e) {
      console.error('[playlist-picker]', e);
      confirmar.textContent = textoOriginal;
      list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.disabled = false);
      refrescarContador();
    }
  };

  return overlay;
}
