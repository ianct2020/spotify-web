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

export { renderTrackRow, showProgress, hideProgress, confirmModal, typeConfirmModal, escapeHtml, renderPlaylistGrid, bindPlaylistGrid };
