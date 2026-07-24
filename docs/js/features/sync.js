import { getAllLikedTracks, getAllPlaylistItems, getAllUserPlaylists, addTracksToPlaylist, removeTracksFromPlaylist, createPlaylist, unfollowPlaylist } from '../api.js?v=60';
import { cacheGet, cacheSet } from '../storage.js?v=60';
import { showProgress, hideProgress, typeConfirmModal, renderTrackRow, escapeHtml } from '../ui/components.js?v=60';
import { showToast } from '../ui/toast.js?v=60';

const TARGET_PLAYLIST_NAME = 'anothertwo';
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
      renderMissingPlaylistUI(nameOrId, playlists);
      return;
    }

    if ((target.tracks?.total || 0) >= SPOTIFY_PLAYLIST_MAX) {
      hideProgress();
      renderFullPlaylistUI(target, playlists);
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

    const newSize = playlistItems.length - toRemove.length + toAdd.length;
    const exceedsLimit = newSize > SPOTIFY_PLAYLIST_MAX;

    results.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value">${likes.length.toLocaleString()}</div>
          <div class="stat-label">Liked Songs</div>
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

      ${exceedsLimit ? `
        <div class="card" style="margin-bottom:16px;border-color:var(--color-error);background:rgba(239,68,68,0.06)">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <span class="badge badge-error">LÍMITE 10K</span>
            <div>
              La playlist quedaría con <strong>${newSize.toLocaleString()}</strong> tracks, pero Spotify limita a <strong>${SPOTIFY_PLAYLIST_MAX.toLocaleString()}</strong> por playlist.
              Podés <strong>vaciar la playlist primero</strong> y llenarla desde cero con tus likes.
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
        <button class="btn btn-primary btn-lg" id="sync-execute-btn">Sincronizar</button>
        ${toAdd.length > 0 ? `<button class="btn btn-secondary btn-lg" id="sync-add-only-btn">Solo agregar (sin quitar)</button>` : ''}
        ${exceedsLimit ? `<button class="btn btn-danger btn-lg" id="sync-wipe-btn">Vaciar y llenar</button>` : ''}
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

function nextPlaylistName(baseName, playlists) {
  const base = baseName.toLowerCase().trim();
  const usedNumbers = new Set();
  for (const p of playlists) {
    const n = p.name.toLowerCase().trim();
    if (n === base) usedNumbers.add(1);
    const m = n.match(/^(.+?)\s+(\d+)$/);
    if (m && m[1].trim() === base) usedNumbers.add(parseInt(m[2], 10));
  }
  let next = 2;
  while (usedNumbers.has(next)) next++;
  return `${baseName} ${next}`;
}

function renderMissingPlaylistUI(nameOrId, playlists) {
  const results = document.getElementById('sync-results');
  results.innerHTML = `
    <div class="card" style="margin-bottom:16px;border-color:var(--color-warning)">
      <p style="color:var(--color-warning);margin-bottom:6px"><strong>No se encontró</strong> la playlist "${escapeHtml(nameOrId)}".</p>
      <p style="color:var(--color-text-secondary);margin-bottom:16px">Podés crearla vacía y llenarla desde cero con todos tus likes reales.</p>
      <button class="btn btn-primary" id="sync-create-fresh-btn">Crear "${escapeHtml(nameOrId)}" y poblar con Likes</button>
    </div>
  `;
  document.getElementById('sync-create-fresh-btn').onclick = () =>
    rebuildFreshPlaylist(nameOrId);
}

function renderFullPlaylistUI(target, playlists) {
  const results = document.getElementById('sync-results');
  const nextName = nextPlaylistName(target.name, playlists);
  results.innerHTML = `
    <div class="card" style="margin-bottom:16px;border-color:var(--color-error);background:rgba(239,68,68,0.06)">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <span class="badge badge-error">LLENA</span>
        <div style="flex:1">
          <strong>"${escapeHtml(target.name)}"</strong> tiene <strong>${target.tracks.total.toLocaleString()}</strong> tracks — Spotify no deja pasar de ${SPOTIFY_PLAYLIST_MAX.toLocaleString()}.<br>
          No se puede sincronizar directo. Elegí una opción:
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <h3 style="margin-bottom:8px">Opción A — Rehacer desde cero (recomendada)</h3>
      <p style="color:var(--color-text-secondary);margin-bottom:12px">
        Borra <strong>"${escapeHtml(target.name)}"</strong> (${target.tracks.total.toLocaleString()} tracks), crea una vacía con el mismo nombre, y la llena con <strong>todos tus likes</strong>.
      </p>
      <button class="btn btn-danger" id="sync-rebuild-inplace-btn">Borrar y rehacer "${escapeHtml(target.name)}"</button>
    </div>

    <div class="card">
      <h3 style="margin-bottom:8px">Opción B — Crear "${escapeHtml(nextName)}" (dejar la vieja)</h3>
      <p style="color:var(--color-text-secondary);margin-bottom:12px">
        No toca "${escapeHtml(target.name)}", crea <strong>"${escapeHtml(nextName)}"</strong> vacía y la llena con todos tus likes.
      </p>
      <button class="btn btn-primary" id="sync-create-next-btn">Crear "${escapeHtml(nextName)}"</button>
    </div>
  `;
  document.getElementById('sync-rebuild-inplace-btn').onclick = () =>
    rebuildInPlace(target);
  document.getElementById('sync-create-next-btn').onclick = () =>
    rebuildFreshPlaylist(nextName);
}

async function loadAllRealLikes() {
  showProgress('Cargando todos los likes...', 0, 0);
  const likes = await getAllLikedTracks(({ loaded, total }) => {
    showProgress(`Cargando likes... ${loaded}/${total || '?'}`, loaded, total);
  }, { force: true });
  return likes.map(item => item.track?.uri).filter(Boolean);
}

async function fillPlaylistWithUris(playlistId, uris, playlistName) {
  const totalChunks = Math.ceil(uris.length / 100);
  showProgress(`Agregando a "${playlistName}"...`, 0, uris.length);
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    await addTracksToPlaylist(playlistId, chunk);
    showProgress(`Agregando a "${playlistName}"... ${Math.min(i + 100, uris.length)}/${uris.length}`, Math.min(i + 100, uris.length), uris.length);
  }
}

async function rebuildInPlace(target) {
  const confirmed = await typeConfirmModal(
    'Rehacer playlist desde cero',
    `Se va a <strong>borrar</strong> "${escapeHtml(target.name)}" (${target.tracks.total.toLocaleString()} tracks) y crear una vacía con el mismo nombre poblada con todos tus likes.<br><br>Spotify guarda backup ~90 días en <em>spotify.com/account/recover-playlists</em>, pero desde la app la vieja se pierde.`,
    'REHACER'
  );
  if (!confirmed) return;

  try {
    const uris = await loadAllRealLikes();
    if (uris.length > SPOTIFY_PLAYLIST_MAX) {
      hideProgress();
      showToast(`Tenés ${uris.length} likes, no caben (máx ${SPOTIFY_PLAYLIST_MAX}). No se ejecutó nada.`, 'error');
      return;
    }

    showProgress(`Borrando "${target.name}"...`, 0, 0);
    await unfollowPlaylist(target.id);

    showProgress(`Creando "${target.name}" vacía...`, 0, 0);
    const fresh = await createPlaylist(target.name, 'Espejo de Liked Songs (rehecha)', false);

    await fillPlaylistWithUris(fresh.id, uris, fresh.name);

    hideProgress();
    showToast(`"${fresh.name}" rehecha con ${uris.length.toLocaleString()} tracks`, 'success');
    document.getElementById('sync-results').innerHTML = `
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="badge badge-success">Rehecha</span>
          <span>"${escapeHtml(fresh.name)}" quedó con ${uris.length.toLocaleString()} tracks.</span>
        </div>
      </div>
    `;
  } catch (e) {
    hideProgress();
    showToast('Error durante rebuild: ' + e.message, 'error');
    console.error(e);
  }
}

async function rebuildFreshPlaylist(name) {
  const confirmed = await typeConfirmModal(
    'Crear playlist nueva',
    `Se va a crear la playlist "<strong>${escapeHtml(name)}</strong>" vacía y llenarla con todos tus likes (tarda unos minutos).`,
    'CREAR'
  );
  if (!confirmed) return;

  try {
    const uris = await loadAllRealLikes();
    if (uris.length > SPOTIFY_PLAYLIST_MAX) {
      hideProgress();
      showToast(`Tenés ${uris.length} likes, no caben (máx ${SPOTIFY_PLAYLIST_MAX}). No se ejecutó nada.`, 'error');
      return;
    }

    showProgress(`Creando "${name}"...`, 0, 0);
    const fresh = await createPlaylist(name, 'Espejo de Liked Songs', false);

    await fillPlaylistWithUris(fresh.id, uris, fresh.name);

    hideProgress();
    showToast(`"${fresh.name}" creada con ${uris.length.toLocaleString()} tracks`, 'success');
    document.getElementById('sync-results').innerHTML = `
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="badge badge-success">Creada</span>
          <span>"${escapeHtml(fresh.name)}" quedó con ${uris.length.toLocaleString()} tracks. Cambiá el input al nombre nuevo si querés seguir sincronizando esta.</span>
        </div>
      </div>
    `;
    document.getElementById('sync-playlist-name').value = fresh.name;
  } catch (e) {
    hideProgress();
    showToast('Error durante creación: ' + e.message, 'error');
    console.error(e);
  }
}
