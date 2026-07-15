function renderTrackRow(track, extra = '') {
  const art = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || '';
  const artists = track.artists?.map(a => a.name).join(', ') || 'Unknown';
  const imgTag = art
    ? `<img class="track-art" src="${art}" alt="" loading="lazy">`
    : `<div class="track-art" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--color-text-muted)">?</div>`;

  return `
    <div class="track-row">
      ${imgTag}
      <div class="track-info">
        <div class="track-name">${escapeHtml(track.name)}</div>
        <div class="track-artist">${escapeHtml(artists)}</div>
      </div>
      ${extra}
    </div>
  `;
}

function renderProgressOverlay(text, loaded, total) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  return `
    <div class="progress-overlay" id="progress-overlay">
      <div class="spinner spinner-lg"></div>
      <div class="progress-text">${escapeHtml(text)}</div>
      <div style="width:200px">
        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="progress-text">${loaded.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ''}</div>
    </div>
  `;
}

function showProgress(text, loaded = 0, total = 0) {
  let overlay = document.getElementById('progress-overlay');
  if (!overlay) {
    document.body.insertAdjacentHTML('beforeend', renderProgressOverlay(text, loaded, total));
  } else {
    overlay.outerHTML = renderProgressOverlay(text, loaded, total);
  }
}

function hideProgress() {
  document.getElementById('progress-overlay')?.remove();
}

function confirmModal(title, message, confirmText = 'Confirmar') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>${escapeHtml(title)}</h2>
        <p>${message}</p>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-danger" id="modal-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#modal-cancel').onclick = () => {
      overlay.remove();
      resolve(false);
    };
    overlay.querySelector('#modal-confirm').onclick = () => {
      overlay.remove();
      resolve(true);
    };
  });
}

function typeConfirmModal(title, message, requiredText = 'BORRAR') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>${escapeHtml(title)}</h2>
        <p>${message}</p>
        <div class="confirm-input">
          <label>Escribí <strong>${escapeHtml(requiredText)}</strong> para confirmar:</label>
          <input class="input" id="confirm-text-input" autocomplete="off">
        </div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-danger" id="modal-confirm" disabled>Confirmar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#confirm-text-input');
    const confirmBtn = overlay.querySelector('#modal-confirm');

    input.addEventListener('input', () => {
      confirmBtn.disabled = input.value !== requiredText;
    });

    overlay.querySelector('#modal-cancel').onclick = () => {
      overlay.remove();
      resolve(false);
    };
    confirmBtn.onclick = () => {
      overlay.remove();
      resolve(true);
    };
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const PLAYLIST_NAME_MAX = 100;

function promptPlaylistName(defaultName, opts = {}) {
  const { trackCount = null, subtitle = '' } = opts;
  const initial = (defaultName || '').slice(0, PLAYLIST_NAME_MAX);
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <h2 style="margin-bottom:8px">Nombre de la playlist</h2>
        ${subtitle ? `<p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:12px">${escapeHtml(subtitle)}</p>` : ''}
        ${trackCount != null ? `<p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:12px"><strong>${trackCount.toLocaleString()}</strong> tracks se van a agregar.</p>` : ''}
        <input type="text" id="playlist-name-input" maxlength="${PLAYLIST_NAME_MAX}"
               style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--color-text-muted);margin-bottom:14px">
          <span id="playlist-name-hint">Podés editarlo antes de crear.</span>
          <span id="playlist-name-counter">0/${PLAYLIST_NAME_MAX}</span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-primary" id="modal-confirm">Crear playlist</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#playlist-name-input');
    const counter = overlay.querySelector('#playlist-name-counter');
    const hint = overlay.querySelector('#playlist-name-hint');
    const confirmBtn = overlay.querySelector('#modal-confirm');

    input.value = initial;
    setTimeout(() => { input.focus(); input.select(); }, 20);

    const update = () => {
      const len = input.value.length;
      counter.textContent = `${len}/${PLAYLIST_NAME_MAX}`;
      counter.style.color = len >= PLAYLIST_NAME_MAX ? 'var(--color-warning)' : 'var(--color-text-muted)';
      const trimmed = input.value.trim();
      confirmBtn.disabled = trimmed.length === 0;
      if (defaultName && input.value !== initial && trimmed.length > 0) {
        hint.textContent = 'Editado';
      }
    };
    input.addEventListener('input', update);
    update();

    const close = val => {
      overlay.remove();
      resolve(val);
    };
    overlay.querySelector('#modal-cancel').onclick = () => close(null);
    confirmBtn.onclick = () => {
      const val = input.value.trim().slice(0, PLAYLIST_NAME_MAX);
      if (val.length === 0) return;
      close(val);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click();
      else if (e.key === 'Escape') close(null);
    });
  });
}

function renderPlaylistGrid(playlists) {
  return `
    <div class="playlist-grid">
      ${playlists.map(p => `
        <button class="playlist-card" data-playlist-id="${p.id}">
          <div class="playlist-card-cover">
            ${p.image
              ? `<img src="${p.image}" loading="lazy" alt="">`
              : `<div class="playlist-card-cover-placeholder">♪</div>`}
          </div>
          <div class="playlist-card-name">${escapeHtml(p.name)}</div>
          <div class="playlist-card-meta">${(p.tracks?.total ?? '?').toLocaleString()} tracks</div>
        </button>
      `).join('')}
    </div>
  `;
}

function bindPlaylistGrid(container, onSelect) {
  container.querySelectorAll('.playlist-card').forEach(card => {
    card.onclick = () => onSelect(card.dataset.playlistId);
  });
}

export { renderTrackRow, showProgress, hideProgress, confirmModal, typeConfirmModal, promptPlaylistName, PLAYLIST_NAME_MAX, escapeHtml, renderPlaylistGrid, bindPlaylistGrid };
