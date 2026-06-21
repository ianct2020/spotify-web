import { getAllUserPlaylists, getAllPlaylistItems, removeTracksFromPlaylist } from '../api.js';
import { showProgress, hideProgress, typeConfirmModal, renderTrackRow, escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Dedupe</h1>
      <p>Encontrá y eliminá duplicados dentro de cada playlist.</p>
    </div>
    <div class="feature-actions">
      <button class="btn btn-primary" id="dedupe-analyze-btn">Analizar playlists</button>
    </div>
    <div id="dedupe-results"></div>
  `;

  document.getElementById('dedupe-analyze-btn').onclick = analyze;
}

async function analyze() {
  const results = document.getElementById('dedupe-results');
  const btn = document.getElementById('dedupe-analyze-btn');
  btn.disabled = true;

  try {
    showProgress('Cargando playlists...', 0, 0);
    const playlists = await getAllUserPlaylists();
    const ownPlaylists = playlists.filter(p => p.owner?.id !== 'spotify');

    const duplicatesByPlaylist = [];

    for (let i = 0; i < ownPlaylists.length; i++) {
      const pl = ownPlaylists[i];
      showProgress(`Analizando "${pl.name}"...`, i + 1, ownPlaylists.length);

      const items = await getAllPlaylistItems(pl.id);
      const seen = new Map();
      const dupes = [];

      items.forEach((item, idx) => {
        const track = item.track || item.item;
        if (!track?.uri) return;

        if (seen.has(track.uri)) {
          dupes.push({ track, position: idx, firstPosition: seen.get(track.uri) });
        } else {
          seen.set(track.uri, idx);
        }
      });

      if (dupes.length > 0) {
        duplicatesByPlaylist.push({ playlist: pl, dupes });
      }
    }

    hideProgress();

    if (duplicatesByPlaylist.length === 0) {
      results.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-success">Limpio</span>
            <span>Ninguna playlist tiene duplicados.</span>
          </div>
          <div style="margin-top:8px;color:var(--color-text-secondary)">${ownPlaylists.length} playlists analizadas.</div>
        </div>
      `;
      return;
    }

    const totalDupes = duplicatesByPlaylist.reduce((sum, d) => sum + d.dupes.length, 0);

    results.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value">${ownPlaylists.length}</div>
          <div class="stat-label">Playlists analizadas</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-warning)">${duplicatesByPlaylist.length}</div>
          <div class="stat-label">Con duplicados</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-error)">${totalDupes}</div>
          <div class="stat-label">Duplicados totales</div>
        </div>
      </div>
      <div id="dedupe-playlist-list">
        ${duplicatesByPlaylist.map(({ playlist, dupes }) => `
          <div class="playlist-result" style="margin-bottom:8px">
            <div class="playlist-result-info">
              <div class="playlist-result-name">${escapeHtml(playlist.name)}</div>
              <div class="playlist-result-detail">${dupes.length} duplicado${dupes.length > 1 ? 's' : ''}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button class="btn btn-secondary btn-sm dedupe-show-btn" data-playlist-id="${playlist.id}">Ver</button>
              <button class="btn btn-danger btn-sm dedupe-clean-btn" data-playlist-id="${playlist.id}">Limpiar</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div id="dedupe-detail"></div>
    `;

    const dataMap = new Map(duplicatesByPlaylist.map(d => [d.playlist.id, d]));

    results.querySelectorAll('.dedupe-show-btn').forEach(btn => {
      btn.onclick = () => showDupeDetail(dataMap.get(btn.dataset.playlistId));
    });

    results.querySelectorAll('.dedupe-clean-btn').forEach(btn => {
      btn.onclick = () => cleanDupes(dataMap.get(btn.dataset.playlistId));
    });

  } catch (e) {
    hideProgress();
    showToast(e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

function showDupeDetail({ playlist, dupes }) {
  const detail = document.getElementById('dedupe-detail');
  detail.innerHTML = `
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:12px">Duplicados en "${escapeHtml(playlist.name)}"</h3>
      <div class="results-list" style="max-height:400px;overflow-y:auto">
        ${dupes.map(d => renderTrackRow(d.track, `<span class="badge badge-warning">pos ${d.position}</span>`)).join('')}
      </div>
    </div>
  `;
}

async function cleanDupes({ playlist, dupes }) {
  const confirmed = await typeConfirmModal(
    `Limpiar duplicados`,
    `Se van a quitar <strong>${dupes.length}</strong> tracks duplicados de "${escapeHtml(playlist.name)}". Se mantiene la primera aparición.`,
    'BORRAR'
  );

  if (!confirmed) return;

  try {
    showProgress('Quitando duplicados...', 0, dupes.length);
    const uris = dupes.map(d => d.track.uri);
    const uniqueUris = [...new Set(uris)];
    await removeTracksFromPlaylist(playlist.id, uniqueUris);
    hideProgress();
    showToast(`${dupes.length} duplicados eliminados de "${playlist.name}"`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
