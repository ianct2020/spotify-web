import { getAllLikedTracks, removeLikedTracks } from '../api.js';
import { showProgress, hideProgress, typeConfirmModal, renderTrackRow, escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Versiones Duplicadas</h1>
      <p>Encontrá likes con el mismo nombre y artista en distintos álbumes (original, remaster, live, etc.).</p>
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

      <div id="versions-clusters">
        ${clusters.slice(0, 50).map((cluster, idx) => renderCluster(cluster, idx)).join('')}
        ${clusters.length > 50 ? `<div style="padding:16px;color:var(--color-text-secondary)">...y ${clusters.length - 50} grupos más</div>` : ''}
      </div>
    `;

    results.querySelectorAll('.version-keep-btn').forEach(btn => {
      btn.onclick = () => keepVersion(btn.dataset.clusterIdx, clusters, btn.dataset.keepId);
    });

  } catch (e) {
    hideProgress();
    showToast(e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

function renderCluster(cluster, idx) {
  const firstTrack = cluster[0].track;
  const artistName = firstTrack.artists?.map(a => a.name).join(', ') || 'Unknown';

  return `
    <div class="cluster-group">
      <div class="cluster-header">
        <span>${escapeHtml(firstTrack.name)} — ${escapeHtml(artistName)}</span>
        <span class="badge badge-warning">${cluster.length} versiones</span>
      </div>
      <div style="padding:8px">
        ${cluster.map(item => {
          const t = item.track;
          const albumInfo = t.album ? `${t.album.name} (${t.album.release_date?.slice(0, 4) || '?'})` : '';
          const popBadge = `<span class="badge badge-accent" style="margin-left:auto;flex-shrink:0">pop ${t.popularity || 0}</span>`;
          const keepBtn = `<button class="btn btn-sm btn-secondary version-keep-btn" data-cluster-idx="${idx}" data-keep-id="${t.id}" style="flex-shrink:0;margin-left:8px">Quedarse esta</button>`;
          return renderTrackRow(t, `
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
              <span style="font-size:12px;color:var(--color-text-secondary)">${escapeHtml(albumInfo)}</span>
              ${popBadge}
              ${keepBtn}
            </div>
          `);
        }).join('')}
      </div>
    </div>
  `;
}

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

    const clusterEl = document.querySelectorAll('.cluster-group')[clusterIdx];
    if (clusterEl) {
      clusterEl.innerHTML = `
        <div class="cluster-header" style="background:var(--color-success);color:white">
          <span>Resuelto — se mantuvo la versión de "${escapeHtml(keepTrack?.album?.name || '')}"</span>
        </div>
      `;
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}
