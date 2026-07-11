import { getAllUserPlaylists, getAllPlaylistItems, removePlaylistItemsAtPositions, getCurrentUserId } from '../api.js';
import { showProgress, hideProgress, typeConfirmModal, escapeHtml, renderPlaylistGrid, bindPlaylistGrid } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

let ownPlaylists = [];
const keepUris = new Set();

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Álbumes repetidos</h1>
      <p>Detectá álbumes con más de un track en la misma playlist (ej: "listened albums" donde querés 1 track por álbum).</p>
    </div>
    <div id="dupalbums-content"></div>
  `;
  loadAndShowGrid();
}

async function loadAndShowGrid() {
  const content = document.getElementById('dupalbums-content');
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando playlists...</div></div>`;

  try {
    const [playlists, userId] = await Promise.all([getAllUserPlaylists(), getCurrentUserId()]);
    ownPlaylists = playlists.filter(p => p.owner?.id === userId);
    if (ownPlaylists.length === 0) {
      content.innerHTML = `<div class="card"><p>No tenés playlists propias.</p></div>`;
      return;
    }
    content.innerHTML = `
      <div style="margin-bottom:8px;color:var(--color-text-secondary)">${ownPlaylists.length} playlists propias</div>
      ${renderPlaylistGrid(ownPlaylists)}
    `;
    bindPlaylistGrid(content, analyzePlaylist);
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

async function analyzePlaylist(playlistId) {
  const playlist = ownPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;
  keepUris.clear();

  const content = document.getElementById('dupalbums-content');
  content.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="btn btn-secondary btn-sm" id="dupalbums-back-btn">← Volver</button>
    </div>
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:16px">
      ${playlist.image
        ? `<img src="${playlist.image}" style="width:80px;height:80px;border-radius:var(--radius-sm);object-fit:cover">`
        : `<div style="width:80px;height:80px;border-radius:var(--radius-sm);background:var(--color-elevated);display:flex;align-items:center;justify-content:center;font-size:32px;color:var(--color-text-muted)">♪</div>`}
      <div style="flex:1">
        <h2 style="margin-bottom:4px">${escapeHtml(playlist.name)}</h2>
        <div style="color:var(--color-text-secondary)">${(playlist.tracks?.total ?? '?').toLocaleString()} tracks</div>
      </div>
    </div>
    <div id="dupalbums-analysis"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando álbumes repetidos...</div></div></div>
  `;

  document.getElementById('dupalbums-back-btn').onclick = loadAndShowGrid;

  try {
    const items = await getAllPlaylistItems(playlistId, ({ loaded, total }) => {
      showProgress(`Cargando tracks...`, loaded, total);
    });
    hideProgress();

    const byAlbum = new Map();
    items.forEach((item, idx) => {
      const track = item.track || item.item;
      if (!track?.uri) return;
      const albumId = track.album?.id;
      if (!albumId) return;
      if (!byAlbum.has(albumId)) {
        byAlbum.set(albumId, { album: track.album, tracks: [] });
      }
      byAlbum.get(albumId).tracks.push({ track, position: idx });
    });

    const dupAlbums = [...byAlbum.values()]
      .filter(g => {
        const uniqueUris = new Set(g.tracks.map(t => t.track.uri));
        return uniqueUris.size > 1;
      })
      .sort((a, b) => b.tracks.length - a.tracks.length);

    const analysis = document.getElementById('dupalbums-analysis');
    if (dupAlbums.length === 0) {
      analysis.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-success">Limpia</span>
            <span>Ningún álbum aparece con más de un track distinto.</span>
          </div>
        </div>
      `;
      return;
    }

    const totalExtra = dupAlbums.reduce((s, g) => {
      const uniqueUris = [...new Set(g.tracks.map(t => t.track.uri))];
      return s + (uniqueUris.length - 1);
    }, 0);

    analysis.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-warning)">${dupAlbums.length}</div>
          <div class="stat-label">Álbumes con 2+ tracks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-error)">${totalExtra}</div>
          <div class="stat-label">Tracks sobrantes máx</div>
        </div>
      </div>

      <div id="dupalbums-batch-bar" style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
        <div style="font-size:13px;color:var(--color-text-secondary)">
          Marcá el track que querés <strong>quedarte</strong> por cada álbum. Los álbumes sin marca no se tocan.
        </div>
        <button class="btn btn-danger" id="dupalbums-delete-btn" disabled>Quitar sobrantes</button>
      </div>

      <div id="dupalbums-list">
        ${dupAlbums.map(g => renderAlbumGroup(g)).join('')}
      </div>
    `;

    bindKeepChecks(playlist);
    document.getElementById('dupalbums-delete-btn').onclick = () => cleanSelected(playlist, dupAlbums);
  } catch (e) {
    hideProgress();
    document.getElementById('dupalbums-analysis').innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function renderAlbumGroup({ album, tracks }) {
  const cover = album.images?.[0]?.url || '';
  const artistNames = tracks[0]?.track.artists?.map(a => a.name).join(', ') || '';
  const uniqueTracks = [];
  const seen = new Set();
  tracks.forEach(t => {
    if (!seen.has(t.track.uri)) {
      seen.add(t.track.uri);
      uniqueTracks.push(t);
    }
  });

  return `
    <div class="card" style="margin-bottom:12px" data-album-id="${album.id}">
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:12px">
        ${cover
          ? `<img src="${cover}" style="width:64px;height:64px;border-radius:var(--radius-sm);object-fit:cover">`
          : `<div style="width:64px;height:64px;border-radius:var(--radius-sm);background:var(--color-elevated)"></div>`}
        <div style="flex:1;min-width:0">
          <div style="font-weight:600">${escapeHtml(album.name)}</div>
          <div style="font-size:13px;color:var(--color-text-secondary)">${escapeHtml(artistNames)}</div>
          <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">${uniqueTracks.length} tracks distintos en la playlist</div>
        </div>
      </div>
      <div>
        ${uniqueTracks.map(t => `
          <div style="display:flex;align-items:center;padding:8px 4px;border-top:1px solid var(--color-border)" data-track-uri="${t.track.uri}">
            <label class="keep-check-wrap" title="Marcar para quedarme con este">
              <input type="checkbox" class="keep-check dupalbums-keep" data-album-id="${album.id}" data-track-uri="${t.track.uri}">
              <span class="keep-check-label">quedar</span>
            </label>
            <div style="flex:1;padding-left:8px;overflow:hidden">
              <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.track.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted)">pos ${t.position + 1}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function bindKeepChecks(playlist) {
  const list = document.getElementById('dupalbums-list');
  list.querySelectorAll('.dupalbums-keep').forEach(box => {
    box.addEventListener('change', () => {
      const albumId = box.dataset.albumId;
      const uri = box.dataset.trackUri;
      if (box.checked) {
        const card = list.querySelector(`.card[data-album-id="${albumId}"]`);
        card.querySelectorAll('.dupalbums-keep').forEach(other => {
          if (other !== box && other.checked) {
            other.checked = false;
            keepUris.delete(other.dataset.trackUri);
          }
        });
        keepUris.add(uri);
      } else {
        keepUris.delete(uri);
      }
      updateDeleteBtn();
    });
  });
}

function updateDeleteBtn() {
  document.getElementById('dupalbums-delete-btn').disabled = keepUris.size === 0;
}

async function cleanSelected(playlist, dupAlbums) {
  const itemsToRemove = [];
  let selectedAlbums = 0;
  for (const g of dupAlbums) {
    const uris = [...new Set(g.tracks.map(t => t.track.uri))];
    const keptUri = uris.find(u => keepUris.has(u));
    if (!keptUri) continue;
    selectedAlbums++;
    const toRemoveUris = uris.filter(u => u !== keptUri);
    for (const uri of toRemoveUris) {
      const positions = g.tracks.filter(t => t.track.uri === uri).map(t => t.position);
      itemsToRemove.push({ uri, positions });
    }
  }

  if (itemsToRemove.length === 0) {
    showToast('No hay nada para quitar', 'info');
    return;
  }

  const totalToRemove = itemsToRemove.reduce((s, i) => s + i.positions.length, 0);
  const confirmed = await typeConfirmModal(
    'Quitar tracks sobrantes',
    `Se van a quitar <strong>${totalToRemove}</strong> tracks sobrantes de <strong>${selectedAlbums}</strong> álbum(es) en "${escapeHtml(playlist.name)}".`,
    'BORRAR'
  );
  if (!confirmed) return;

  try {
    showProgress('Quitando tracks sobrantes...', 0, totalToRemove);
    await removePlaylistItemsAtPositions(playlist.id, itemsToRemove);
    hideProgress();
    showToast(`${totalToRemove} tracks sobrantes eliminados`, 'success');
    analyzePlaylist(playlist.id);
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
