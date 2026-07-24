import { getAllLikedTracks, getAllUserPlaylists, getAllPlaylistItems, createPlaylist, addTracksToPlaylist } from '../api.js?v=59';
import { showProgress, hideProgress, confirmModal, renderTrackRow } from '../ui/components.js?v=59';
import { showToast } from '../ui/toast.js?v=59';

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Likes Huérfanas</h1>
      <p>Encontrá Liked Songs que no están en ninguna de tus playlists.</p>
    </div>
    <div class="feature-actions">
      <button class="btn btn-primary" id="orphans-analyze-btn">Analizar</button>
    </div>
    <div id="orphans-results"></div>
  `;

  document.getElementById('orphans-analyze-btn').onclick = analyze;
}

async function analyze() {
  const results = document.getElementById('orphans-results');
  const btn = document.getElementById('orphans-analyze-btn');
  btn.disabled = true;

  try {
    showProgress('Cargando Liked Songs...', 0, 0);
    const likes = await getAllLikedTracks(({ loaded, total }) => {
      showProgress('Cargando Liked Songs...', loaded, total);
    });

    showProgress('Cargando playlists...', 0, 0);
    const playlists = await getAllUserPlaylists();

    const allPlaylistTrackIds = new Set();
    const skipped = [];
    for (let i = 0; i < playlists.length; i++) {
      const pl = playlists[i];
      showProgress(`Escaneando playlists... (${i + 1}/${playlists.length})`, i + 1, playlists.length);
      try {
        const items = await getAllPlaylistItems(pl.id);
        items.forEach(item => {
          const track = item.track || item.item;
          if (track?.id) allPlaylistTrackIds.add(track.id);
        });
      } catch (e) {
        if (/40[34]/.test(e.message)) {
          console.warn(`Playlist "${pl.name}" (${pl.id}) skipped: ${e.message}`);
          skipped.push(pl.name);
        } else {
          throw e;
        }
      }
    }

    hideProgress();
    if (skipped.length > 0) {
      console.warn(`Skipped ${skipped.length} playlists:`, skipped);
      showToast(`Saltadas ${skipped.length} playlist(s) inaccesibles (Spotify-owned)`, 'info');
    }

    const orphans = likes.filter(item => {
      const id = item.track?.id;
      return id && !allPlaylistTrackIds.has(id);
    });

    if (orphans.length === 0) {
      results.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-success">Todo cubierto</span>
            <span>Todos tus likes están en al menos una playlist.</span>
          </div>
        </div>
      `;
      return;
    }

    results.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value">${likes.length.toLocaleString()}</div>
          <div class="stat-label">Liked Songs</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${playlists.length}</div>
          <div class="stat-label">Playlists</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-warning)">${orphans.length.toLocaleString()}</div>
          <div class="stat-label">Huérfanas</div>
        </div>
      </div>

      <div class="feature-actions">
        <button class="btn btn-primary" id="orphans-to-playlist-btn">Crear playlist con huérfanas</button>
        <button class="btn btn-secondary" id="orphans-csv-btn">Exportar CSV</button>
      </div>

      <div class="card">
        <h3 style="margin-bottom:12px">Likes sin playlist (${orphans.length})</h3>
        <div class="results-list" style="max-height:500px;overflow-y:auto">
          ${orphans.slice(0, 100).map(item => renderTrackRow(item.track)).join('')}
          ${orphans.length > 100 ? `<div style="padding:10px 14px;color:var(--color-text-secondary)">...y ${orphans.length - 100} más</div>` : ''}
        </div>
      </div>
    `;

    document.getElementById('orphans-to-playlist-btn').onclick = () => saveToPlaylist(orphans);
    document.getElementById('orphans-csv-btn').onclick = () => exportCsv(orphans);

  } catch (e) {
    hideProgress();
    showToast(e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

async function saveToPlaylist(orphans) {
  const ok = await confirmModal(
    'Crear playlist',
    `Se va a crear una playlist "Likes Huérfanas" con ${orphans.length} tracks.`
  );
  if (!ok) return;

  try {
    showProgress('Creando playlist...', 0, orphans.length);
    const pl = await createPlaylist('Likes Huérfanas', `${orphans.length} likes que no estaban en ninguna playlist. Generado ${new Date().toLocaleDateString('es-AR')}.`);
    const uris = orphans.map(item => item.track.uri);
    await addTracksToPlaylist(pl.id, uris);
    hideProgress();
    showToast(`Playlist "Likes Huérfanas" creada con ${orphans.length} tracks`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}

function exportCsv(orphans) {
  const header = 'Track,Artist,Album,URI,ISRC';
  const rows = orphans.map(item => {
    const t = item.track;
    const isrc = t.external_ids?.isrc || '';
    return [
      `"${(t.name || '').replace(/"/g, '""')}"`,
      `"${(t.artists?.map(a => a.name).join(', ') || '').replace(/"/g, '""')}"`,
      `"${(t.album?.name || '').replace(/"/g, '""')}"`,
      t.uri || '',
      isrc,
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orphan-likes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV descargado', 'success');
}
