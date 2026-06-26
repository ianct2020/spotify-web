import { getAllLikedTracks, getAllUserPlaylists, getAllPlaylistItems, removeLikedTracks, removeTracksFromPlaylist } from '../api.js';
import { showProgress, hideProgress, typeConfirmModal, renderTrackRow, escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Zombis</h1>
      <p>Detectá tracks eliminados del catálogo de Spotify (ID null o no reproducibles).</p>
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

      ${zombieLikes.length > 0 ? `
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3>Zombis en Liked Songs</h3>
            <button class="btn btn-danger btn-sm" id="zombies-clean-likes-btn">Quitar de likes</button>
          </div>
          <div class="results-list" style="max-height:300px;overflow-y:auto">
            ${zombieLikes.map(item => {
              const t = item.track || {};
              return renderTrackRow({
                name: t.name || '[Track eliminado]',
                artists: t.artists || [{ name: 'Desconocido' }],
                album: t.album,
              }, '<span class="badge badge-error">zombi</span>');
            }).join('')}
          </div>
        </div>
      ` : ''}

      ${zombiesByPlaylist.map(({ playlist, zombies }) => `
        <div class="card" style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3>${escapeHtml(playlist.name)} (${zombies.length} zombi${zombies.length > 1 ? 's' : ''})</h3>
            <button class="btn btn-danger btn-sm zombies-clean-playlist-btn" data-playlist-id="${playlist.id}" data-count="${zombies.length}">Limpiar</button>
          </div>
          <div class="results-list" style="max-height:200px;overflow-y:auto">
            ${zombies.map(item => {
              const t = item.track || item.item || {};
              return renderTrackRow({
                name: t.name || '[Track eliminado]',
                artists: t.artists || [{ name: 'Desconocido' }],
                album: t.album,
              }, '<span class="badge badge-error">zombi</span>');
            }).join('')}
          </div>
        </div>
      `).join('')}
    `;

    if (zombieLikes.length > 0) {
      document.getElementById('zombies-clean-likes-btn').onclick = () => cleanLikeZombies(zombieLikes);
    }

    results.querySelectorAll('.zombies-clean-playlist-btn').forEach(btn => {
      const plData = zombiesByPlaylist.find(z => z.playlist.id === btn.dataset.playlistId);
      if (plData) btn.onclick = () => cleanPlaylistZombies(plData);
    });

  } catch (e) {
    hideProgress();
    showToast(e.message, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
  }
}

async function cleanLikeZombies(zombieLikes) {
  const ids = zombieLikes.map(item => item.track?.id).filter(Boolean);
  if (ids.length === 0) {
    showToast('Estos tracks no tienen ID — no se pueden quitar vía API', 'warning');
    return;
  }

  const ok = await typeConfirmModal(
    'Quitar zombis de Likes',
    `Se van a quitar <strong>${ids.length}</strong> tracks eliminados de tus Liked Songs.`,
    'BORRAR'
  );
  if (!ok) return;

  try {
    showProgress('Quitando zombis...', 0, ids.length);
    await removeLikedTracks(ids);
    hideProgress();
    showToast(`${ids.length} zombis eliminados de Likes`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}

async function cleanPlaylistZombies({ playlist, zombies }) {
  const uris = zombies.map(item => (item.track || item.item)?.uri).filter(Boolean);
  if (uris.length === 0) {
    showToast('Estos tracks no tienen URI — no se pueden quitar vía API', 'warning');
    return;
  }

  const ok = await typeConfirmModal(
    `Limpiar "${playlist.name}"`,
    `Se van a quitar <strong>${uris.length}</strong> tracks zombi de esta playlist.`,
    'BORRAR'
  );
  if (!ok) return;

  try {
    showProgress('Limpiando...', 0, uris.length);
    await removeTracksFromPlaylist(playlist.id, uris);
    hideProgress();
    showToast(`${uris.length} zombis eliminados de "${playlist.name}"`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
