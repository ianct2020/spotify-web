import { getAllLikedTracks, removeLikedTracks } from '../api.js?v=53';
import { showProgress, hideProgress, typeConfirmModal, renderTrackRow, escapeHtml } from '../ui/components.js?v=53';
import { showToast } from '../ui/toast.js?v=53';

const keepIds = new Set();
let allClusters = [];

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Versiones Duplicadas</h1>
      <p>Encontrá likes con el mismo nombre y artista en distintos álbumes (original, remaster, live, etc.). Marcá la versión que querés <strong>quedarte</strong> — el resto del grupo se borra.</p>
    </div>
    <div class="feature-actions">
      <button class="btn btn-primary" id="versions-analyze-btn">Analizar</button>
    </div>
    <div id="versions-results"></div>
  `;

  document.getElementById('versions-analyze-btn').onclick = analyze;
}

function normalizeKey(track) {
  const name = (track.name || '')
    .toLowerCase()
    .replace(/\s*[-–—]\s*(remaster(ed)?|deluxe|bonus|live|acoustic|remix|radio edit|single version|album version|mono|stereo|\d{4}).*/i, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();

  const artist = (track.artists?.[0]?.name || '').toLowerCase().trim();
  return `${artist}|||${name}`;
}

async function analyze() {
  const results = document.getElementById('versions-results');
  const btn = document.getElementById('versions-analyze-btn');
  btn.disabled = true;
  keepIds.clear();

  try {
    showProgress('Cargando Liked Songs...', 0, 0);
    const likes = await getAllLikedTracks(({ loaded, total }) => {
      showProgress('Cargando Liked Songs...', loaded, total);
    });
    hideProgress();

    const groups = new Map();
    likes.forEach(item => {
      if (!item.track?.id) return;
      const key = normalizeKey(item.track);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    const clusters = [...groups.values()]
      .filter(g => g.length > 1)
      .sort((a, b) => b.length - a.length);

    allClusters = clusters;

    if (clusters.length === 0) {
      results.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-success">Sin duplicados</span>
            <span>No se encontraron versiones duplicadas en tus likes.</span>
          </div>
        </div>
      `;
      return;
    }

    const totalDupes = clusters.reduce((s, c) => s + c.length - 1, 0);

    results.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value">${clusters.length}</div>
          <div class="stat-label">Grupos con versiones</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-warning)">${totalDupes}</div>
          <div class="stat-label">Posibles sobrantes</div>
        </div>
      </div>

      <div id="batch-actions" style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
        <div style="line-height:1.4">
          <div><strong id="batch-keep-count">0</strong> versión(es) marcada(s) para quedarse</div>
          <div style="font-size:12px;color:var(--color-text-secondary)"><strong id="batch-delete-count">0</strong> sobrante(s) van a borrarse</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" id="batch-clear-btn" disabled>Limpiar</button>
          <button class="btn btn-danger" id="batch-delete-btn" disabled>Borrar sobrantes</button>
        </div>
      </div>

      <div id="versions-clusters">
        ${clusters.slice(0, 50).map((cluster, idx) => renderCluster(cluster, idx)).join('')}
        ${clusters.length > 50 ? `<div style="padding:16px;color:var(--color-text-secondary)">...y ${clusters.length - 50} grupos más</div>` : ''}
      </div>
    `;

    results.querySelectorAll('.keep-check').forEach(box => {
      box.addEventListener('change', () => {
        if (box.checked) keepIds.add(box.dataset.trackId);
        else keepIds.delete(box.dataset.trackId);
        updateBatchBar();
      });
    });

    document.getElementById('batch-clear-btn').onclick = () => {
      keepIds.clear();
      results.querySelectorAll('.keep-check').forEach(b => { b.checked = false; });
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

function computeRemovals() {
  const toRemove = [];
  document.querySelectorAll('.cluster-group').forEach(clusterEl => {
    const idx = parseInt(clusterEl.dataset.clusterIdx);
    const cluster = allClusters[idx];
    if (!cluster) return;
    const hasKeep = cluster.some(item => keepIds.has(item.track.id));
    if (!hasKeep) return;
    cluster.forEach(item => {
      if (!keepIds.has(item.track.id)) toRemove.push(item.track.id);
    });
  });
  return toRemove;
}

function updateBatchBar() {
  document.getElementById('batch-keep-count').textContent = keepIds.size;
  const toRemoveCount = computeRemovals().length;
  document.getElementById('batch-delete-count').textContent = toRemoveCount;
  document.getElementById('batch-delete-btn').disabled = toRemoveCount === 0;
  document.getElementById('batch-clear-btn').disabled = keepIds.size === 0;
}

async function batchDelete() {
  const toRemoveIds = computeRemovals();
  if (toRemoveIds.length === 0) return;

  const ok = await typeConfirmModal(
    'Borrar versiones sobrantes',
    `Vas a <strong>mantener</strong> las ${keepIds.size} versión(es) marcadas en verde y <strong>borrar</strong> las otras ${toRemoveIds.length} de tus Liked Songs.`,
    'BORRAR'
  );
  if (!ok) return;

  try {
    showProgress('Borrando sobrantes...', 0, toRemoveIds.length);
    await removeLikedTracks(toRemoveIds);
    hideProgress();
    showToast(`${toRemoveIds.length} versión(es) eliminada(s)`, 'success');

    const toRemoveSet = new Set(toRemoveIds);
    document.querySelectorAll('.cluster-group').forEach(clusterEl => {
      const idx = parseInt(clusterEl.dataset.clusterIdx);
      const cluster = allClusters[idx];
      if (!cluster) return;
      const hadKeep = cluster.some(item => keepIds.has(item.track.id));
      if (!hadKeep) return;

      clusterEl.querySelectorAll('.version-row').forEach(rowEl => {
        if (toRemoveSet.has(rowEl.dataset.trackId)) rowEl.remove();
      });

      const remaining = clusterEl.querySelectorAll('.version-row').length;
      if (remaining <= 1) {
        const headerSpan = clusterEl.querySelector('.cluster-header span:first-child');
        const badge = clusterEl.querySelector('.cluster-header .badge');
        if (badge) {
          badge.className = 'badge badge-success';
          badge.textContent = 'resuelto';
        }
        if (headerSpan) {
          headerSpan.innerHTML = '✓ ' + headerSpan.innerHTML;
        }
      }
    });

    keepIds.clear();
    updateBatchBar();
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}

function renderCluster(cluster, idx) {
  const firstTrack = cluster[0].track;
  const artistName = firstTrack.artists?.map(a => a.name).join(', ') || 'Unknown';

  return `
    <div class="cluster-group" data-cluster-idx="${idx}">
      <div class="cluster-header">
        <span>${escapeHtml(firstTrack.name)} — ${escapeHtml(artistName)}</span>
        <span class="badge badge-warning">${cluster.length} versiones</span>
      </div>
      <div style="padding:8px">
        ${cluster.map(item => {
          const t = item.track;
          const albumInfo = t.album ? `${t.album.name} (${t.album.release_date?.slice(0, 4) || '?'})` : '';
          const popBadge = `<span class="badge badge-accent" style="margin-left:auto;flex-shrink:0">pop ${t.popularity || 0}</span>`;
          const checkbox = `
            <label class="keep-check-wrap" title="Marcar esta versión para quedártela">
              <input type="checkbox" class="keep-check" data-track-id="${t.id}">
              <span class="keep-check-label">quedarme</span>
            </label>
          `;
          const row = renderTrackRow(t, `
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <span style="font-size:12px;color:var(--color-text-secondary)">${escapeHtml(albumInfo)}</span>
              ${popBadge}
            </div>
          `);
          return `<div class="version-row" data-track-id="${t.id}" style="display:flex;align-items:center;border-bottom:1px solid var(--color-border)">${checkbox}<div style="flex:1">${row}</div></div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// keepVersion kept for future use - not currently wired to any button
async function keepVersion(clusterIdx, clusters, keepId) {
  const cluster = clusters[clusterIdx];
  if (!cluster) return;

  const toRemove = cluster.filter(item => item.track.id !== keepId);
  const keepTrack = cluster.find(item => item.track.id === keepId)?.track;

  if (toRemove.length === 0) return;

  const ok = await typeConfirmModal(
    'Quedarse con una versión',
    `Se va a mantener <strong>"${escapeHtml(keepTrack?.name || '')}"</strong> del álbum <strong>"${escapeHtml(keepTrack?.album?.name || '')}"</strong> y quitar las otras ${toRemove.length} versión(es) de tus Liked Songs.`,
    'BORRAR'
  );

  if (!ok) return;

  try {
    const ids = toRemove.map(item => item.track.id);
    await removeLikedTracks(ids);
    showToast(`${toRemove.length} versión(es) eliminada(s)`, 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}
