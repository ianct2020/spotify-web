import { getAllLikedTracks, getAllPlaylistItems, getAllUserPlaylists, addTracksToPlaylist, removeTracksFromPlaylist, isTestMode } from '../api.js';
import { cacheGet, cacheSet } from '../storage.js';
import { showProgress, hideProgress, typeConfirmModal, renderTrackRow, escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

const TARGET_PLAYLIST_NAME = 'another one';
const SPOTIFY_PLAYLIST_MAX = 10000;

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Sync Mirror</h1>
      <p>Sincroniza una playlist como espejo exacto de tus Liked Songs.</p>
    </div>

    <div class="card" style="margin-bottom:20px">
      <label style="display:block;font-size:13px;color:var(--color-text-secondary);margin-bottom:6px">Playlist objetivo</label>
      <div style="display:flex;gap:8px">
        <input class="input" id="sync-playlist-name" value="${TARGET_PLAYLIST_NAME}" placeholder="Nombre o ID de playlist">
        <button class="btn btn-primary" id="sync-analyze-btn">Analizar</button>
      </div>
    </div>

    <div id="sync-results"></div>
  `;

  document.getElementById('sync-analyze-btn').onclick = analyze;
}

async function analyze() {
  const nameOrId = document.getElementById('sync-playlist-name').value.trim();
  if (!nameOrId) return showToast('Ingresá el nombre o ID de la playlist', 'warning');

  const results = document.getElementById('sync-results');
  const btn = document.getElementById('sync-analyze-btn');
  btn.disabled = true;

  try {
    showProgress('Cargando Liked Songs (las más recientes)...', 0, 0);
    const likes = await getAllLikedTracks(({ loaded, total }) => {
      showProgress('Cargando Liked Songs (las más recientes)...', loaded, total);
    }, { randomize: false });

    showProgress('Cargando playlists...', 0, 0);
    const playlists = await getAllUserPlaylists();

    let target = playlists.find(p =>
      p.id === nameOrId || p.name.toLowerCase() === nameOrId.toLowerCase()
    );

    if (!target) {
      hideProgress();
      results.innerHTML = `
        <div class="card">
          <p style="color:var(--color-warning)">No se encontró la playlist "${escapeHtml(nameOrId)}".</p>
          <p style="color:var(--color-text-secondary);margin-top:8px">Verificá el nombre o usá el ID de la playlist.</p>
        </div>
      `;
      return;
    }

    showProgress(`Cargando tracks de "${target.name}"...`, 0, 0);
    const playlistItems = await getAllPlaylistItems(target.id, ({ loaded, total }) => {
      showProgress(`Cargando tracks de "${target.name}"...`, loaded, total);
    });
    hideProgress();

    const likeUris = new Set(likes.map(item => item.track?.uri).filter(Boolean));
    const playlistUris = new Set(playlistItems.map(item => (item.track || item.item)?.uri).filter(Boolean));

    const toAdd = [...likeUris].filter(uri => !playlistUris.has(uri));
    const toRemove = [...playlistUris].filter(uri => !likeUris.has(uri));

    if (toAdd.length === 0 && toRemove.length === 0) {
      results.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-success">En sync</span>
            <span>La playlist "${escapeHtml(target.name)}" ya es espejo exacto de tus Likes.</span>
          </div>
          <div style="margin-top:12px;color:var(--color-text-secondary)">
            ${likes.length.toLocaleString()} tracks en ambas.
          </div>
        </div>
      `;
      return;
    }

    const likeMap = new Map();
    likes.forEach(item => {
      if (item.track) likeMap.set(item.track.uri, item.track);
    });
    const playlistMap = new Map();
    playlistItems.forEach(item => {
      const t = item.track || item.item;
      if (t) playlistMap.set(t.uri, t);
    });

    const testMode = isTestMode();
    const newSize = playlistItems.length - toRemove.length + toAdd.length;
    const exceedsLimit = newSize > SPOTIFY_PLAYLIST_MAX;
    const testWarnRemove = testMode && toRemove.length > 100;

    results.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value">${likes.length.toLocaleString()}</div>
          <div class="stat-label">Liked Songs${testMode ? ' (muestra)' : ''}</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${playlistItems.length.toLocaleString()}</div>
          <div class="stat-label">En playlist</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-success)">+${toAdd.length.toLocaleString()}</div>
          <div class="stat-label">Para agregar</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-error)">-${toRemove.length.toLocaleString()}</div>
          <div class="stat-label">Para quitar</div>
        </div>
      </div>

      ${testWarnRemove ? `
        <div class="card" style="margin-bottom:16px;border-color:var(--color-warning);background:rgba(245,158,11,0.06)">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <span class="badge badge-warning">MODO PRUEBA</span>
            <div>
              <strong>Ojo con "Quitar":</strong> en modo prueba solo se cargaron ${likes.length.toLocaleString()} likes (muestra), no los ~9.500 reales.
              Los ${toRemove.length.toLocaleString()} tracks marcados para quitar probablemente son <em>válidos</em> (están en tus likes reales pero no en la muestra).
              <br><br>
              Usá <strong>"Solo agregar"</strong> para probar sin borrar nada.
            </div>
          </div>
        </div>
      ` : ''}

      ${exceedsLimit ? `
        <div class="card" style="margin-bottom:16px;border-color:var(--color-error);background:rgba(239,68,68,0.06)">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <span class="badge badge-error">LÍMITE 10K</span>
            <div>
              La playlist quedaría con <strong>${newSize.toLocaleString()}</strong> tracks, pero Spotify limita a <strong>${SPOTIFY_PLAYLIST_MAX.toLocaleString()}</strong> por playlist.
              ${testMode
                ? 'En modo prueba no se puede resolver esto con seguridad. Desactivá TEST_MODE y volvé a probar.'
                : 'Podés <strong>vaciar la playlist primero</strong> y llenarla desde cero con tus likes.'}
            </div>
          </div>
        </div>
      ` : ''}

      ${toAdd.length > 0 ? `
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin-bottom:12px">Tracks para agregar (${toAdd.length})</h3>
          <div class="results-list" style="max-height:300px;overflow-y:auto">
            ${toAdd.slice(0, 50).map(uri => renderTrackRow(likeMap.get(uri) || { name: uri, artists: [] })).join('')}
            ${toAdd.length > 50 ? `<div style="padding:10px 14px;color:var(--color-text-secondary)">...y ${toAdd.length - 50} más</div>` : ''}
          </div>
        </div>
      ` : ''}

      ${toRemove.length > 0 ? `
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin-bottom:12px">Tracks para quitar (${toRemove.length})</h3>
          <div class="results-list" style="max-height:300px;overflow-y:auto">
            ${toRemove.slice(0, 50).map(uri => renderTrackRow(playlistMap.get(uri) || { name: uri, artists: [] })).join('')}
            ${toRemove.length > 50 ? `<div style="padding:10px 14px;color:var(--color-text-secondary)">...y ${toRemove.length - 50} más</div>` : ''}
          </div>
        </div>
      ` : ''}

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary btn-lg" id="sync-execute-btn" ${exceedsLimit && testMode ? 'disabled' : ''}>Sincronizar</button>
        ${toAdd.length > 0 ? `<button class="btn btn-secondary btn-lg" id="sync-add-only-btn">Solo agregar (sin quitar)</button>` : ''}
        ${exceedsLimit && !testMode ? `<button class="btn btn-danger btn-lg" id="sync-wipe-btn">Vaciar y llenar</button>` : ''}
      </div>
    `;

    document.getElementById('sync-execute-btn').onclick = () => executeSync(target, toAdd, toRemove);
    const addOnlyBtn = document.getElementById('sync-add-only-btn');
    if (addOnlyBtn) addOnlyBtn.onclick = () => executeSync(target, toAdd, [], { mode: 'add-only' });
    const wipeBtn = document.getElementById('sync-wipe-btn');
    if (wipeBtn) wipeBtn.onclick = () => executeWipeAndFill(target, playlistItems, likes);

  } catch (e) {
    hideProgress();
    showToast(e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

async function executeSync(playlist, toAdd, toRemove, { mode = 'full' } = {}) {
  const label = mode === 'add-only' ? 'Solo agregar' : 'Sincronizar playlist';
  const confirmed = await typeConfirmModal(
    label,
    mode === 'add-only'
      ? `Se van a agregar <strong>${toAdd.length}</strong> tracks a "${escapeHtml(playlist.name)}". No se va a quitar nada.`
      : `Se van a agregar <strong>${toAdd.length}</strong> y quitar <strong>${toRemove.length}</strong> tracks de "${escapeHtml(playlist.name)}".`,
    'SYNC'
  );

  if (!confirmed) return;

  try {
    let done = 0;
    const total = toRemove.length + toAdd.length;

    if (toRemove.length > 0) {
      showProgress('Quitando tracks...', done, total);
      await removeTracksFromPlaylist(playlist.id, toRemove);
      done += toRemove.length;
    }

    if (toAdd.length > 0) {
      showProgress('Agregando tracks...', done, total);
      await addTracksToPlaylist(playlist.id, toAdd);
      done += toAdd.length;
    }

    hideProgress();
    showToast(`Sync completo: +${toAdd.length} / -${toRemove.length}`, 'success');

    document.getElementById('sync-results').innerHTML = `
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="badge badge-success">Sincronizado</span>
          <span>Playlist "${escapeHtml(playlist.name)}" actualizada.</span>
        </div>
      </div>
    `;
  } catch (e) {
    hideProgress();
    const msg = /playlist size limit/i.test(e.message)
      ? `Playlist llena (${SPOTIFY_PLAYLIST_MAX} máx). Usá "Vaciar y llenar" o quitá tracks primero.`
      : 'Error durante sync: ' + e.message;
    showToast(msg, 'error');
    console.error(e);
  }
}

async function executeWipeAndFill(playlist, playlistItems, likes) {
  const currentUris = playlistItems.map(item => (item.track || item.item)?.uri).filter(Boolean);
  const likeUris = likes.map(item => item.track?.uri).filter(Boolean);

  if (likeUris.length > SPOTIFY_PLAYLIST_MAX) {
    showToast(`Tenés ${likeUris.length} likes, no caben en una playlist (máx ${SPOTIFY_PLAYLIST_MAX})`, 'error');
    return;
  }

  const confirmed = await typeConfirmModal(
    'Vaciar y llenar playlist',
    `Se van a <strong>quitar los ${currentUris.length.toLocaleString()}</strong> tracks actuales de "${escapeHtml(playlist.name)}" y agregar los <strong>${likeUris.length.toLocaleString()}</strong> likes desde cero.<br><br>Esta acción es destructiva.`,
    'VACIAR'
  );
  if (!confirmed) return;

  try {
    showProgress('Vaciando playlist...', 0, currentUris.length + likeUris.length);
    if (currentUris.length > 0) {
      await removeTracksFromPlaylist(playlist.id, currentUris);
    }
    showProgress('Agregando likes...', currentUris.length, currentUris.length + likeUris.length);
    if (likeUris.length > 0) {
      await addTracksToPlaylist(playlist.id, likeUris);
    }
    hideProgress();
    showToast(`Playlist rehecha con ${likeUris.length.toLocaleString()} tracks`, 'success');
    document.getElementById('sync-results').innerHTML = `
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="badge badge-success">Sincronizado</span>
          <span>Playlist "${escapeHtml(playlist.name)}" reconstruida desde cero.</span>
        </div>
      </div>
    `;
  } catch (e) {
    hideProgress();
    showToast('Error durante wipe: ' + e.message, 'error');
    console.error(e);
  }
}
