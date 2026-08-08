import { getAllUserPlaylists, getAllPlaylistItems, removePlaylistItemsAtPositions, getCurrentUserId, getBestAvailableLikes } from '../api.js?v=127';
import { showProgress, hideProgress, progressController, isCancelled, typeConfirmModal, renderTrackRow, escapeHtml, renderPlaylistGrid, bindPlaylistGrid, pageHeader } from '../ui/components.js?v=127';
import { showToast } from '../ui/toast.js?v=127';

let ownPlaylists = [];
const LIKED_VIRTUAL_ID = '__liked_songs__';

export function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Dedupe' })}
    <div id="dedupe-content"></div>
  `;

  loadAndShowGrid();
}

async function loadAndShowGrid() {
  const content = document.getElementById('dedupe-content');
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando playlists...</div></div>`;

  try {
    const [playlists, userId] = await Promise.all([getAllUserPlaylists(), getCurrentUserId()]);
    ownPlaylists = playlists.filter(p => p.owner?.id === userId);
    if (ownPlaylists.length === 0) {
      content.innerHTML = `<div class="card"><p>No tenés playlists propias.</p></div>`;
      return;
    }
    // Tile virtual "Liked Songs" al principio del grid.
    const likedVirtual = {
      id: LIKED_VIRTUAL_ID,
      name: '❤ Liked Songs',
      image: null,
      tracks: { total: '?' },
    };
    content.innerHTML = `
      <div style="margin-bottom:8px;color:var(--color-text-secondary)">${ownPlaylists.length} playlists propias · también podés analizar tus Liked Songs</div>
      ${renderPlaylistGrid([likedVirtual, ...ownPlaylists])}
    `;
    bindPlaylistGrid(content, (id) => {
      if (id === LIKED_VIRTUAL_ID) analyzeLikedSongs();
      else analyzePlaylist(id);
    });
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

async function analyzePlaylist(playlistId) {
  const playlist = ownPlaylists.find(p => p.id === playlistId);
  if (!playlist) return;

  const content = document.getElementById('dedupe-content');
  content.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="btn btn-secondary btn-sm" id="dedupe-back-btn">← Volver</button>
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
    <div id="dedupe-analysis"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Analizando duplicados...</div></div></div>
  `;

  document.getElementById('dedupe-back-btn').onclick = loadAndShowGrid;

  try {
    const prog = progressController('Cargando tracks...');
    const items = await getAllPlaylistItems(playlistId, ({ loaded, total }) => {
      prog.update(loaded, total);
    }, { signal: prog.signal });
    prog.done();

    const groups = new Map();
    items.forEach((item, idx) => {
      const track = item.track || item.item;
      if (!track?.uri) return;
      if (!groups.has(track.uri)) {
        groups.set(track.uri, { track, positions: [] });
      }
      groups.get(track.uri).positions.push(idx);
    });

    const dupGroups = [...groups.values()].filter(g => g.positions.length > 1);
    const analysis = document.getElementById('dedupe-analysis');

    if (dupGroups.length === 0) {
      analysis.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="badge badge-success">Limpia</span>
            <span>No hay tracks repetidos en esta playlist.</span>
          </div>
        </div>
      `;
      return;
    }

    const totalExtra = dupGroups.reduce((s, g) => s + (g.positions.length - 1), 0);

    analysis.innerHTML = `
      <div class="results-summary">
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-warning)">${dupGroups.length}</div>
          <div class="stat-label">Tracks con repeticiones</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:var(--color-error)">${totalExtra}</div>
          <div class="stat-label">Copias extra a quitar</div>
        </div>
      </div>

      <div style="margin-bottom:12px;padding:12px 16px;background:var(--color-elevated);border-radius:var(--radius-md);color:var(--color-text-secondary);font-size:13px">
        Se va a mantener la <strong>primera aparición</strong> de cada track y quitar las copias siguientes.
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="results-list" style="max-height:500px;overflow-y:auto">
          ${dupGroups.map(g => `
            <div style="padding:10px 14px;border-bottom:1px solid var(--color-border)">
              ${renderTrackRow(g.track, `<span class="badge badge-warning">${g.positions.length}×</span>`)}
              <div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;padding-left:52px">
                Posiciones: ${g.positions.map(p => p + 1).join(', ')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <button class="btn btn-danger btn-lg" id="dedupe-clean-btn">Quitar ${totalExtra} copias extra</button>
    `;

    document.getElementById('dedupe-clean-btn').onclick = () => cleanDupes(playlist, dupGroups);
  } catch (e) {
    hideProgress();
    const msg = isCancelled(e)
      ? 'Carga detenida. Volvé a entrar para retomar.'
      : escapeHtml(e.message);
    document.getElementById('dedupe-analysis').innerHTML = `<div class="card"><p style="color:var(--color-${isCancelled(e) ? 'warning' : 'error'})">${msg}</p></div>`;
  }
}

async function analyzeLikedSongs() {
  const content = document.getElementById('dedupe-content');
  content.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="btn btn-secondary btn-sm" id="dedupe-back-btn">← Volver</button>
    </div>
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:16px">
      <div style="width:80px;height:80px;border-radius:var(--radius-sm);background:linear-gradient(135deg,#7C3AED 0%,#EC4899 100%);display:flex;align-items:center;justify-content:center;font-size:32px;color:#fff">❤</div>
      <div style="flex:1">
        <h2 style="margin-bottom:4px">Liked Songs</h2>
        <div style="color:var(--color-text-secondary)" id="liked-header-count">Cargando…</div>
      </div>
    </div>
    <div id="dedupe-analysis"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Analizando tus likes…</div></div></div>
  `;
  document.getElementById('dedupe-back-btn').onclick = loadAndShowGrid;

  try {
    const { items } = await getBestAvailableLikes();
    document.getElementById('liked-header-count').textContent = `${items.length.toLocaleString('es-AR')} tracks`;

    const groups = new Map();
    items.forEach(it => {
      const track = it.track || it;
      if (!track?.uri) return;
      if (!groups.has(track.uri)) groups.set(track.uri, { track, count: 0 });
      groups.get(track.uri).count += 1;
    });
    const dupGroups = [...groups.values()].filter(g => g.count > 1);

    const analysis = document.getElementById('dedupe-analysis');
    if (dupGroups.length === 0) {
      analysis.innerHTML = `
        <div class="card">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span class="badge badge-success">Limpia</span>
            <span>No hay URIs repetidos en tus Liked Songs.</span>
          </div>
          <div style="color:var(--color-text-muted);font-size:13px">
            Spotify no permite likear el mismo track dos veces, así que este análisis siempre debería salir limpio.
            Si querés detectar el mismo tema en distintos álbumes (deluxe, remaster, live), usá
            <a href="#versions" style="color:var(--color-accent)">Versiones</a>. Y para álbumes con varios tracks
            repetidos en tus likes, mirá <a href="#listened" style="color:var(--color-accent)">Álbumes escuchados</a>.
          </div>
        </div>
      `;
      return;
    }

    // Caso raro: hay URIs repetidos. Los mostramos con opción de "sacar y volver a agregar 1" (que es lo que hace DELETE + PUT).
    analysis.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span class="badge badge-warning">${dupGroups.length}</span>
          <span>Tracks con más de una copia en tus Liked Songs.</span>
        </div>
        <div style="color:var(--color-text-muted);font-size:13px">
          Esto es raro (Spotify no lo permite normalmente). Podés reportarlo o intentar limpiarlo desde acá.
        </div>
      </div>
      <div class="card">
        <div class="results-list" style="max-height:500px;overflow-y:auto">
          ${dupGroups.map(g => `
            <div style="padding:10px 14px;border-bottom:1px solid var(--color-border)">
              ${renderTrackRow(g.track, `<span class="badge badge-warning">${g.count}×</span>`)}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    document.getElementById('dedupe-analysis').innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

async function cleanDupes(playlist, dupGroups) {
  const totalExtra = dupGroups.reduce((s, g) => s + (g.positions.length - 1), 0);
  const confirmed = await typeConfirmModal(
    'Quitar duplicados',
    `Se van a quitar <strong>${totalExtra}</strong> copias extra de <strong>${dupGroups.length}</strong> tracks en "${escapeHtml(playlist.name)}". Se mantiene la primera aparición de cada uno.`,
    'BORRAR'
  );
  if (!confirmed) return;

  try {
    showProgress('Quitando duplicados...', 0, totalExtra);
    const items = dupGroups.map(g => ({
      uri: g.track.uri,
      positions: g.positions.slice(1),
    }));
    await removePlaylistItemsAtPositions(playlist.id, items);
    hideProgress();
    showToast(`${totalExtra} copias extra eliminadas`, 'success');
    analyzePlaylist(playlist.id);
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
