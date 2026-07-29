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

// Callback de cancelación del overlay activo. Vive acá afuera porque showProgress se
// llama en loop desde los onProgress (sin opts), y esas llamadas no tienen que pisarlo.
let _progressCancel = null;

function renderProgressOverlay(text, loaded, total, cancellable) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  return `
    <div class="progress-overlay" id="progress-overlay">
      <div class="spinner spinner-lg"></div>
      <div class="progress-text" id="progress-label">${escapeHtml(text)}</div>
      <div style="width:220px">
        <div class="progress-bar">
          <div class="progress-bar-fill" id="progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="progress-text" id="progress-count">${loaded.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ''}</div>
      ${cancellable ? `
        <button class="btn btn-danger" id="progress-cancel-btn" style="min-width:180px;margin-top:6px">Detener carga</button>
        <div class="progress-note">Podés detener sin problema — la próxima vez retoma desde donde quedó.</div>
      ` : ''}
    </div>
  `;
}

// showProgress(text, loaded, total, { onCancel }) — pasá onCancel solo en la primera
// llamada; las de progreso (3 args) actualizan sin tocar el botón.
function showProgress(text, loaded = 0, total = 0, opts = {}) {
  if (opts.onCancel) _progressCancel = opts.onCancel;
  const cancellable = !!_progressCancel;
  const overlay = document.getElementById('progress-overlay');
  const hasBtn = !!document.getElementById('progress-cancel-btn');

  if (!overlay || hasBtn !== cancellable) {
    const html = renderProgressOverlay(text, loaded, total, cancellable);
    if (overlay) overlay.outerHTML = html;
    else document.body.insertAdjacentHTML('beforeend', html);
    const btn = document.getElementById('progress-cancel-btn');
    if (btn) btn.onclick = () => {
      btn.disabled = true;
      btn.textContent = 'Deteniendo...';
      _progressCancel?.();
    };
    return;
  }

  // Mismo overlay: actualizo textos y barra, así el botón conserva su handler.
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  overlay.querySelector('#progress-label').textContent = text;
  overlay.querySelector('#progress-fill').style.width = `${pct}%`;
  overlay.querySelector('#progress-count').textContent =
    `${loaded.toLocaleString()}${total ? ` / ${total.toLocaleString()}` : ''}`;
}

function hideProgress() {
  document.getElementById('progress-overlay')?.remove();
  _progressCancel = null;
}

// Azúcar para las features: arma el AbortController, muestra el overlay con botón
// Detener y devuelve el signal + un update() para el onProgress.
function progressController(text) {
  const ctrl = new AbortController();
  showProgress(text, 0, 0, { onCancel: () => ctrl.abort() });
  return {
    signal: ctrl.signal,
    update: (loaded, total, label = text) => showProgress(label, loaded, total),
    done: hideProgress,
  };
}

function isCancelled(err) {
  return /cancelada/i.test(err?.message || '');
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

function alertModal(title, messageHtml, opts = {}) {
  const {
    confirmText = 'Aceptar',
    cancelText = 'Cancelar',
    variant = 'info',
    icon = null,
  } = opts;

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const iconChar = icon || (variant === 'warning' ? '!' : variant === 'danger' ? '×' : 'i');
    overlay.innerHTML = `
      <div class="modal modal-alert modal-alert-${variant}" style="max-width:520px">
        <div class="modal-alert-head">
          <span class="modal-alert-icon">${iconChar}</span>
          <h2 style="margin:0">${escapeHtml(title)}</h2>
        </div>
        <div class="modal-alert-body">${messageHtml}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn btn-primary" id="modal-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cancelBtn = overlay.querySelector('#modal-cancel');
    const confirmBtn = overlay.querySelector('#modal-confirm');
    setTimeout(() => confirmBtn.focus(), 20);

    const close = val => { overlay.remove(); resolve(val); };
    cancelBtn.onclick = () => close(false);
    confirmBtn.onclick = () => close(true);
    overlay.onkeydown = e => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') close(false);
    });
  });
}

function infoModal(title, messageHtml, opts = {}) {
  return alertModal(title, messageHtml, { ...opts, cancelText: opts.cancelText || 'Cerrar', variant: opts.variant || 'info' });
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

export { renderTrackRow, showProgress, hideProgress, progressController, isCancelled, confirmModal, typeConfirmModal, promptPlaylistName, alertModal, infoModal, PLAYLIST_NAME_MAX, escapeHtml, renderPlaylistGrid, bindPlaylistGrid };
