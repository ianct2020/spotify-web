import { getAllLikedTracks, getAllUserPlaylists, getAllPlaylistItems, removeLikedTracks, removeTracksFromPlaylist } from '../api.js?v=61';
import { showProgress, hideProgress, typeConfirmModal, renderTrackRow, escapeHtml } from '../ui/components.js?v=61';
import { showToast } from '../ui/toast.js?v=61';

const FADE_DURATION_MS = 15000;
const STAGGER_PER_ROW_MS = 80;

const selectedLikeIds = new Set();
const selectedPlaylistUris = new Map();

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Zombis</h1>
      <p>Tracks eliminados del catálogo de Spotify. Marcá los que querés quitar y borrá en batch.</p>
    </div>
    <div class="feature-actions">
      <button class="btn btn-primary" id="zombies-analyze-btn">Analizar</button>
    </div>
    <div id="zombies-results"></div>
  `;

  document.getElementById('zombies-analyze-btn').onclick = analyze;
}

async function analyze() {
  const results = document.getElementById('zombies-results');
  const btn = document.getElementById('zombies-analyze-btn');
  btn.disabled = true;
  selectedLikeIds.clear();
  selectedPlaylistUris.clear();

  try {
    showProgress('Cargando Liked Songs...', 0, 0);
    const likes = await getAllLikedTracks(({ loaded, total }) => {
      showProgress('Cargando Liked Songs...', loaded, total);
    });

    const zombieLikes = likes.filter(item => {
      const t = item.track;
      return !t || !t.id || t.is_playable === false;
    });

    showProgress('Cargando playlists...', 0, 0);
    const playlists = await getAllUserPlaylists();

    const zombiesByPlaylist = [];
    const skipped = [];
    for (let i = 0; i < playlists.length; i++) {
      const pl = playlists[i];
      showProgress(`Escaneando playlists... (${i + 1}/${playlists.length})`, i + 1, playlists.length);
      let items;
      try {
        items = await getAllPlaylistItems(pl.id);
      } catch (e) {
        if (/40[34]/.test(e.message)) {
          console.warn(`Playlist "${pl.name}" skipped: ${e.message}`);
          skipped.push(pl.name);
          continue;
        }
        throw e;
      }
      const zombies = items.filter(item => {
        const t = item.track || item.item;
        return !t || !t.id || t.is_playable === false;
      });
      if (zombies.length > 0) {
        zombiesByPlaylist.push({ playlist: pl, zombies });
      }
    }

    hideProgress();
    if (skipped.length > 0) {
      showToast(`Saltadas ${skipped.length} playlist(s) inaccesibles`, 'info');
    }

    const totalPlaylistZombies = zombiesByPlaylist.reduce((s, z) => s + z.zombies.length, 0);

    if (zombieLikes.length === 0 && totalPlaylistZombies === 0) {
      results.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-success">Todo vivo</span>
            <span>No se encontraron tracks eliminados del catálogo.</span>
          </div>
        </div>
      `;
      return;
    }

    results.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-error)">${zombieLikes.length}</div>
          <div class="stat-label">Zombis en Likes</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-error)">${totalPlaylistZombies}</div>
          <div class="stat-label">Zombis en playlists</div>
        </div>
      </div>

      <div id="batch-actions" style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
        <div>
          <strong id="batch-count">0</strong> marcadas para quitar
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" id="batch-select-all-btn">Marcar todos</button>
          <button class="btn btn-secondary btn-sm" id="batch-clear-btn" disabled>Limpiar</button>
          <button class="btn btn-danger" id="batch-delete-btn" disabled>Quitar marcadas</button>
        </div>
      </div>

      ${zombieLikes.length > 0 ? `
        <div class="card" style="margin-bottom:16px">
          <h3 style="margin-bottom:12px">Zombis en Liked Songs (${zombieLikes.length})</h3>
          <div class="results-list" id="zombie-likes-list" style="max-height:400px;overflow-y:auto">
            ${zombieLikes.map(item => {
              const t = item.track || {};
              if (!t.id) return '';
              const checkbox = `
                <label class="keep-check-wrap" title="Marcar para quitar de Likes">
                  <input type="checkbox" class="zombie-like-check" data-track-id="${t.id}">
                  <span class="keep-check-label">quitar</span>
                </label>
              `;
              const row = renderTrackRow({
                name: t.name || '[Track eliminado]',
                artists: t.artists || [{ name: 'Desconocido' }],
                album: t.album,
              }, '<span class="badge badge-error">zombi</span>');
              return `<div class="zombie-row" data-track-id="${t.id}" style="display:flex;align-items:center;border-bottom:1px solid var(--color-border)">${checkbox}<div style="flex:1">${row}</div></div>`;
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${zombiesByPlaylist.map(({ playlist, zombies }) => `
        <div class="card" style="margin-bottom:16px" data-playlist-id="${playlist.id}">
          <h3 style="margin-bottom:12px">${escapeHtml(playlist.name)} (${zombies.length} zombi${zombies.length > 1 ? 's' : ''})</h3>
          <div class="results-list playlist-zombie-list" style="max-height:300px;overflow-y:auto" data-playlist-id="${playlist.id}">
            ${zombies.map(item => {
              const t = item.track || item.item || {};
              const uri = t.uri || '';
              if (!uri) return '';
              const checkbox = `
                <label class="keep-check-wrap" title="Marcar para quitar de esta playlist">
                  <input type="checkbox" class="zombie-pl-check" data-playlist-id="${playlist.id}" data-track-uri="${uri}">
                  <span class="keep-check-label">quitar</span>
                </label>
              `;
              const row = renderTrackRow({
                name: t.name || '[Track eliminado]',
                artists: t.artists || [{ name: 'Desconocido' }],
                album: t.album,
              }, '<span class="badge badge-error">zombi</span>');
              return `<div class="zombie-row" data-track-uri="${uri}" style="display:flex;align-items:center;border-bottom:1px solid var(--color-border)">${checkbox}<div style="flex:1">${row}</div></div>`;
            }).join('')}
          </div>
        </div>
      `).join('')}
    `;

    results.querySelectorAll('.zombie-like-check').forEach(box => {
      box.addEventListener('change', () => {
        if (box.checked) selectedLikeIds.add(box.dataset.trackId);
        else selectedLikeIds.delete(box.dataset.trackId);
        updateBatchBar();
      });
    });

    results.querySelectorAll('.zombie-pl-check').forEach(box => {
      box.addEventListener('change', () => {
        const plId = box.dataset.playlistId;
        const uri = box.dataset.trackUri;
        if (!selectedPlaylistUris.has(plId)) selectedPlaylistUris.set(plId, new Set());
        const set = selectedPlaylistUris.get(plId);
        if (box.checked) set.add(uri);
        else set.delete(uri);
        if (set.size === 0) selectedPlaylistUris.delete(plId);
        updateBatchBar();
      });
    });

    document.getElementById('batch-select-all-btn').onclick = () => {
      results.querySelectorAll('.zombie-like-check').forEach(b => {
        b.checked = true;
        selectedLikeIds.add(b.dataset.trackId);
      });
      results.querySelectorAll('.zombie-pl-check').forEach(b => {
        b.checked = true;
        const plId = b.dataset.playlistId;
        const uri = b.dataset.trackUri;
        if (!selectedPlaylistUris.has(plId)) selectedPlaylistUris.set(plId, new Set());
        selectedPlaylistUris.get(plId).add(uri);
      });
      updateBatchBar();
    };

    document.getElementById('batch-clear-btn').onclick = () => {
      selectedLikeIds.clear();
      selectedPlaylistUris.clear();
      results.querySelectorAll('.zombie-like-check, .zombie-pl-check').forEach(b => { b.checked = false; });
      updateBatchBar();
    };

    document.getElementById('batch-delete-btn').onclick = batchDelete;

  } catch (e) {
    hideProgress();
    showToast(e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

function totalSelected() {
  let n = selectedLikeIds.size;
  for (const set of selectedPlaylistUris.values()) n += set.size;
  return n;
}

function updateBatchBar() {
  const count = totalSelected();
  document.getElementById('batch-count').textContent = count;
  document.getElementById('batch-delete-btn').disabled = count === 0;
  document.getElementById('batch-clear-btn').disabled = count === 0;
}

async function batchDelete() {
  const likeIds = [...selectedLikeIds];
  const playlistOps = [...selectedPlaylistUris.entries()].map(([plId, set]) => ({ plId, uris: [...set] }));
  const total = likeIds.length + playlistOps.reduce((s, op) => s + op.uris.length, 0);
  if (total === 0) return;

  const ok = await typeConfirmModal(
    'Quitar zombis marcados',
    `Se van a quitar <strong>${total}</strong> tracks zombi: ${likeIds.length} de Likes + ${total - likeIds.length} de playlists.`,
    'BORRAR'
  );
  if (!ok) return;

  try {
    showProgress('Quitando zombis...', 0, total);
    if (likeIds.length > 0) {
      await removeLikedTracks(likeIds);
    }
    for (const op of playlistOps) {
      await removeTracksFromPlaylist(op.plId, op.uris);
    }
    hideProgress();
    showToast(`${total} zombi(s) eliminados`, 'success');

    fadeOutSelected(likeIds, playlistOps);

    selectedLikeIds.clear();
    selectedPlaylistUris.clear();
    updateBatchBar();
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}

function fadeOutSelected(likeIds, playlistOps) {
  const rowsToFade = [];

  const likeIdSet = new Set(likeIds);
  document.querySelectorAll('#zombie-likes-list .zombie-row').forEach(row => {
    if (likeIdSet.has(row.dataset.trackId)) rowsToFade.push(row);
  });

  for (const op of playlistOps) {
    const uriSet = new Set(op.uris);
    document.querySelectorAll(`.playlist-zombie-list[data-playlist-id="${op.plId}"] .zombie-row`).forEach(row => {
      if (uriSet.has(row.dataset.trackUri)) rowsToFade.push(row);
    });
  }

  rowsToFade.forEach((row, i) => {
    row.style.transition = `opacity ${FADE_DURATION_MS}ms ease-out, transform ${FADE_DURATION_MS}ms ease-out`;
    row.style.opacity = '0.4';
    row.querySelector('input[type="checkbox"]').disabled = true;
    const badge = row.querySelector('.badge');
    if (badge) {
      badge.className = 'badge badge-success';
      badge.textContent = 'borrado';
    }
    const delay = i * STAGGER_PER_ROW_MS;
    setTimeout(() => {
      row.style.opacity = '0';
      row.style.transform = 'translateX(-30px)';
    }, delay);
    setTimeout(() => {
      row.remove();
    }, delay + FADE_DURATION_MS);
  });
}
