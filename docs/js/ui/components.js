import { openModal, closeTop } from './modal-stack.js?v=282';
import { mountBottomHtml } from './bottom-layer.js?v=282';
import { coverUrl } from '../util/cover-size.js?v=282';

function renderTrackRow(track, extra = '') {
  const art = coverUrl(track.album?.images, 'grande') || '';
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
// Minimizado: la carga sigue pero en un pill abajo a la izquierda, con la app usable.
let _progressMin = false;
// Último estado conocido, para re-renderizar con datos frescos al minimizar/expandir.
let _progressState = { text: '', loaded: 0, total: 0 };
// Auto-cierre si no llegan más updates en N segundos (protección contra overlays huérfanos)
let _progressIdleTimer = null;
const PROGRESS_IDLE_TIMEOUT_MS = 10000;

function renderProgressOverlay(text, loaded, total, cancellable, minimized) {
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  const count = `${loaded.toLocaleString('es-ES')}${total ? ` / ${total.toLocaleString('es-ES')}` : ''}`;
  if (minimized) {
    return `
      <div class="progress-mini" id="progress-overlay" data-mode="mini" data-cancellable="${cancellable ? 1 : 0}" title="Click para ver el progreso completo">
        <div class="spinner"></div>
        <div class="progress-mini-body">
          <div class="progress-mini-label" id="progress-label">${escapeHtml(text)}</div>
          <div class="progress-bar">
            <div class="progress-bar-fill" id="progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="progress-mini-count" id="progress-count">${count}</div>
        </div>
      </div>
    `;
  }
  return `
    <div class="progress-overlay" id="progress-overlay" data-mode="full" data-cancellable="${cancellable ? 1 : 0}">
      <button class="progress-close-x" id="progress-close-x" aria-label="Cerrar" title="Cerrar el overlay (la operación sigue en background)">✕</button>
      <div class="spinner spinner-lg"></div>
      <div class="progress-text" id="progress-label">${escapeHtml(text)}</div>
      <div style="width:220px">
        <div class="progress-bar">
          <div class="progress-bar-fill" id="progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
      <div class="progress-text" id="progress-count">${count}</div>
      ${cancellable ? `
        <button class="btn btn-danger" id="progress-cancel-btn" style="min-width:180px;margin-top:6px">Detener carga</button>
        <button class="btn btn-secondary" id="progress-min-btn" style="min-width:180px">Minimizar — seguir usando la app</button>
        <div class="progress-note">Puedes detener sin problema — la próxima vez retoma desde donde quedó.</div>
      ` : ''}
    </div>
  `;
}

function wireProgressButtons() {
  const overlay = document.getElementById('progress-overlay');
  if (!overlay) return;
  const btn = document.getElementById('progress-cancel-btn');
  if (btn) btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Deteniendo...';
    _progressCancel?.();
  };
  const minBtn = document.getElementById('progress-min-btn');
  if (minBtn) minBtn.onclick = () => {
    _progressMin = true;
    showProgress(_progressState.text, _progressState.loaded, _progressState.total);
  };
  const closeX = document.getElementById('progress-close-x');
  if (closeX) closeX.onclick = (e) => { e.stopPropagation(); hideProgress(); };
  if (overlay.dataset.mode === 'mini') overlay.onclick = () => {
    _progressMin = false;
    showProgress(_progressState.text, _progressState.loaded, _progressState.total);
  };
}

// showProgress(text, loaded, total, { onCancel, minimized }) — pasá onCancel solo en la
// primera llamada; las de progreso (3 args) actualizan sin tocar los botones.
// `minimized: true` arranca directo en el pill chico, para procesos largos que no
// tienen que bloquear la app (ej: el escaneo de #sin-clasificar).
function showProgress(text, loaded = 0, total = 0, opts = {}) {
  if (opts.onCancel) { _progressCancel = opts.onCancel; _progressMin = false; }
  if (opts.minimized !== undefined) _progressMin = !!opts.minimized;
  _progressState = { text, loaded, total };
  const cancellable = !!_progressCancel;
  const mode = _progressMin ? 'mini' : 'full';
  const overlay = document.getElementById('progress-overlay');
  resetProgressIdleTimer();

  if (!overlay || overlay.dataset.mode !== mode || (overlay.dataset.cancellable === '1') !== cancellable) {
    const html = renderProgressOverlay(text, loaded, total, cancellable, _progressMin);
    // El minimizado (el pill de "Cargando tracks de X… 900/9.214") va en la
    // capa de abajo, apilado con el player y los toasts. El modo completo NO:
    // es un overlay `inset: 0` que tapa la pantalla entera y no tiene nada que
    // hacer dentro de una columna. Por eso se re-monta en vez de usar
    // `outerHTML`, que dejaría el nodo nuevo en el padre del viejo al cambiar
    // de modo.
    if (overlay) overlay.remove();
    if (_progressMin) mountBottomHtml('progress', html);
    else document.body.insertAdjacentHTML('beforeend', html);
    wireProgressButtons();
    return;
  }

  // Mismo overlay: actualizo textos y barra, así los botones conservan su handler.
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  overlay.querySelector('#progress-label').textContent = text;
  overlay.querySelector('#progress-fill').style.width = `${pct}%`;
  overlay.querySelector('#progress-count').textContent =
    `${loaded.toLocaleString('es-ES')}${total ? ` / ${total.toLocaleString('es-ES')}` : ''}`;
}

function resetProgressIdleTimer() {
  if (_progressIdleTimer) clearTimeout(_progressIdleTimer);
  _progressIdleTimer = setTimeout(() => {
    // Si el overlay sigue montado y nadie llamó a showProgress en 10s, lo cerramos:
    // asumimos que la operación terminó pero alguien olvidó hideProgress.
    if (document.getElementById('progress-overlay')) hideProgress();
  }, PROGRESS_IDLE_TIMEOUT_MS);
}

function hideProgress() {
  document.getElementById('progress-overlay')?.remove();
  _progressCancel = null;
  _progressMin = false;
  if (_progressIdleTimer) { clearTimeout(_progressIdleTimer); _progressIdleTimer = null; }
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

// Los tres constructores de abajo (`confirmModal`, `typeConfirmModal`,
// `alertModal`) llevan `modal-picker` + `picker-scroll`: la MISMA regla que ya
// usan los once modales con lista larga de `listened`, `artist-card`,
// `dashboard` y `versions` (components.css). Cabecera y pie quedan fijos y solo
// el cuerpo scrollea, con el modal limitado a la altura de la ventana.
//
// ⚠️ Hasta v=245 el mensaje iba suelto dentro de `.modal`, que scrollea ENTERO
// (`max-height: 80vh; overflow-y: auto`): con una lista larga —el «Borrar
// versiones sobrantes» de `#versions`— el campo de confirmación y los botones
// se iban fuera de la pantalla dentro del propio modal. Como estos tres son la
// puerta de TODO el que confirma algo, el arreglo va acá y no en un modal.
// No hay una segunda regla: si escribes otra, vuelve a divergir.
//
// El mensaje entra dentro de un <p> aunque traiga <ul>/<div>: el parser cierra
// el <p> solo, pero todo lo que sale queda DENTRO del contenedor con scroll.
//
// Y el margen de abajo de ese <p> (20 px) queda dentro del scroll también: con
// la lista desbordando ya no separa el texto de los botones, y la última fila
// cortada se pegaba a ellos (visto en el banco). Por eso `confirmModal` lleva su
// propio `margin-top` en el pie, como el de `typeConfirmModal` (16 px) y el
// `margin-bottom` del cuerpo de `alertModal`.
function confirmModal(title, message, confirmText = 'Confirmar') {
  return new Promise(resolve => {
    let resolved = false;
    const done = val => { if (resolved) return; resolved = true; resolve(val); closeTop(); };
    const overlay = openModal({
      onClose: () => { if (!resolved) { resolved = true; resolve(false); } },
      html: `
      <div class="modal modal-picker">
        <h2>${escapeHtml(title)}</h2>
        <div class="picker-scroll"><p>${message}</p></div>
        <div class="modal-actions" style="margin-top:12px">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-danger" id="modal-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `,
    });
    overlay.querySelector('#modal-cancel').onclick = () => done(false);
    overlay.querySelector('#modal-confirm').onclick = () => done(true);
  });
}

function typeConfirmModal(title, message, requiredText = 'BORRAR') {
  return new Promise(resolve => {
    let resolved = false;
    const done = val => { if (resolved) return; resolved = true; resolve(val); closeTop(); };
    const overlay = openModal({
      onClose: () => { if (!resolved) { resolved = true; resolve(false); } },
      html: `
      <div class="modal modal-picker">
        <h2>${escapeHtml(title)}</h2>
        <div class="picker-scroll"><p>${message}</p></div>
        <div class="confirm-input">
          <label>Escribe <strong>${escapeHtml(requiredText)}</strong> para confirmar:</label>
          <input class="input" id="confirm-text-input" autocomplete="off">
        </div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-danger" id="modal-confirm" disabled>Confirmar</button>
        </div>
      </div>
    `,
    });

    const input = overlay.querySelector('#confirm-text-input');
    const confirmBtn = overlay.querySelector('#modal-confirm');

    input.addEventListener('input', () => {
      confirmBtn.disabled = input.value !== requiredText;
    });

    overlay.querySelector('#modal-cancel').onclick = () => done(false);
    confirmBtn.onclick = () => done(true);
  });
}

// Escapa también comillas: casi todos los usos meten el resultado DENTRO de un
// atributo (`data-name="${escapeHtml(p.name)}"`), y el truco de textContent →
// innerHTML deja las comillas tal cual, así que un álbum como
// «Songs of a Lost World "Deluxe"» rompía el markup de la tarjeta. Como texto,
// &quot; y &#39; se renderizan igual que " y '.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function alertModal(title, messageHtml, opts = {}) {
  const {
    confirmText = 'Aceptar',
    cancelText = 'Cancelar',
    variant = 'info',
    icon = null,
  } = opts;

  return new Promise(resolve => {
    let resolved = false;
    const done = val => { if (resolved) return; resolved = true; resolve(val); closeTop(); };
    const iconChar = icon || (variant === 'warning' ? '!' : variant === 'danger' ? '×' : 'i');
    const overlay = openModal({
      onClose: () => { if (!resolved) { resolved = true; resolve(false); } },
      html: `
      <div class="modal modal-picker modal-alert modal-alert-${variant}" style="max-width:520px">
        <div class="modal-alert-head">
          <span class="modal-alert-icon">${iconChar}</span>
          <h2 style="margin:0">${escapeHtml(title)}</h2>
        </div>
        <div class="modal-alert-body picker-scroll">${messageHtml}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">${escapeHtml(cancelText)}</button>
          <button class="btn btn-primary" id="modal-confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `,
    });
    const cancelBtn = overlay.querySelector('#modal-cancel');
    const confirmBtn = overlay.querySelector('#modal-confirm');
    setTimeout(() => confirmBtn.focus(), 20);

    cancelBtn.onclick = () => done(false);
    confirmBtn.onclick = () => done(true);
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
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
    let resolved = false;
    const done = val => { if (resolved) return; resolved = true; resolve(val); closeTop(); };
    const overlay = openModal({
      onClose: () => { if (!resolved) { resolved = true; resolve(null); } },
      html: `
      <div class="modal" style="max-width:520px">
        <h2 style="margin-bottom:8px">Nombre de la playlist</h2>
        ${subtitle ? `<p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:12px">${escapeHtml(subtitle)}</p>` : ''}
        ${trackCount != null ? `<p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:12px"><strong>${trackCount.toLocaleString('es-ES')}</strong> tracks se van a añadir.</p>` : ''}
        <input type="text" id="playlist-name-input" maxlength="${PLAYLIST_NAME_MAX}"
               style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--color-text-muted);margin-bottom:14px">
          <span id="playlist-name-hint">Puedes editarlo antes de crear.</span>
          <span id="playlist-name-counter">0/${PLAYLIST_NAME_MAX}</span>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-primary" id="modal-confirm">Crear playlist</button>
        </div>
      </div>
    `,
    });

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

    overlay.querySelector('#modal-cancel').onclick = () => done(null);
    confirmBtn.onclick = () => {
      const val = input.value.trim().slice(0, PLAYLIST_NAME_MAX);
      if (val.length === 0) return;
      done(val);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !confirmBtn.disabled) { e.preventDefault(); confirmBtn.click(); }
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
          <div class="playlist-card-meta">${(p.tracks?.total ?? '?').toLocaleString('es-ES')} tracks</div>
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

// Header de página unificado: [☰] "Título" [ slot derecha opcional ]
// Todos alineados verticalmente en la misma fila flex. Cada feature debe usar
// esto en vez de armar su propio .page-header/H1 a mano, así el ☰ queda siempre
// en el mismo eje vertical que el H1 y hay un solo lugar donde tocar el padding.
// El botón ☰ (data-hamburger) se togglea vía delegación en app.js.
function pageHeader({ title, right = '' } = {}) {
  const rightHtml = right
    ? `<div class="page-header-right">${right}</div>`
    : '';
  return `
    <div class="page-header">
      <button class="hamburger" data-hamburger aria-label="Abrir menú">&#9776;</button>
      <h1 class="page-header-title">${escapeHtml(title || '')}</h1>
      ${rightHtml}
    </div>
  `;
}

// La tarjeta que ve una vista cuando no hay me gusta en la caché local.
//
// ⚠️ Existe por lo que cambió v=255. Antes, con la caché fría,
// `getBestAvailableLikes()` descargaba la biblioteca entera sola (~190
// peticiones a `/me/tracks`), así que estas vistas nunca llegaban a tener cero
// likes: esperaban minutos y después pintaban. Ahora la función solo lee, y sin
// esta tarjeta el cruce daría una lista VACÍA con cara de respuesta buena
// —«0 canciones sin reproducir» con 9.500 likes en Spotify—, que es peor que
// tardar. La descarga sigue existiendo; se pide en el Dashboard.
function tarjetaSinLikes(queCruza) {
  return `
    <div class="card" style="max-width:560px">
      <p style="margin-bottom:12px">No hay me gusta en la caché local${queCruza ? `, y esta vista los cruza con ${escapeHtml(queCruza)}` : ''}.</p>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">Cárgalos desde el Dashboard (o importa un JSON anterior) y vuelve aquí.</p>
      <a class="btn btn-primary" href="#dashboard">Ir al Dashboard</a>
    </div>
  `;
}

export { renderTrackRow, showProgress, hideProgress, progressController, isCancelled, confirmModal, typeConfirmModal, promptPlaylistName, alertModal, infoModal, PLAYLIST_NAME_MAX, escapeHtml, renderPlaylistGrid, bindPlaylistGrid, pageHeader, tarjetaSinLikes };
