import { getAllPlaylistItems } from '../api.js';
import { escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';
import { getListenedPlaylist, groupItemsByAlbum, openListenedAlbumsPicker } from './listened-shared.js';

const SORT_KEY = 'listened_sort_mode';
const VALID_SORTS = new Set(['recent', 'year-desc', 'year-asc', 'artist-asc', 'tracks-desc', 'name-asc']);
function getSortMode() {
  const v = localStorage.getItem(SORT_KEY);
  return VALID_SORTS.has(v) ? v : 'recent';
}
function setSortMode(v) {
  if (VALID_SORTS.has(v)) localStorage.setItem(SORT_KEY, v);
}

let albums = [];
let filterText = '';
let playlistInfo = null;

export async function render(container) {
  albums = [];
  filterText = '';

  container.innerHTML = `
    <div class="page-header">
      <h1>Álbumes escuchados</h1>
      <p>Los álbumes de tu playlist de registro, agrupados y con buscador.</p>
    </div>
    <div id="listened-content">
      <div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Leyendo configuración...</div></div>
    </div>
  `;

  playlistInfo = getListenedPlaylist();
  if (!playlistInfo) {
    renderNotConfigured();
    return;
  }
  loadAlbums();
}

function renderNotConfigured() {
  const content = document.getElementById('listened-content');
  content.innerHTML = `
    <div class="card" style="max-width:560px">
      <h3 style="margin-bottom:8px">Todavía no configuraste tu playlist</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">
        Elegí la playlist que usás como registro de álbumes escuchados. La app la va a agrupar por álbum.
        También podés configurarla desde la stat card del Dashboard.
      </p>
      <button class="btn btn-primary" id="listened-config-btn">Elegir playlist</button>
    </div>
  `;
  document.getElementById('listened-config-btn').onclick = () => openListenedAlbumsPicker({
    onSelect: () => { playlistInfo = getListenedPlaylist(); loadAlbums(); },
    onClear: () => { playlistInfo = null; renderNotConfigured(); },
  });
}

async function loadAlbums() {
  const content = document.getElementById('listened-content');
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando "${escapeHtml(playlistInfo.name)}"...</div></div>`;

  try {
    const items = await getAllPlaylistItems(playlistInfo.id);
    albums = groupItemsByAlbum(items);
    if (albums.length === 0) {
      content.innerHTML = `
        <div class="card" style="max-width:560px">
          <p style="margin-bottom:12px">La playlist <strong>${escapeHtml(playlistInfo.name)}</strong> no tiene tracks con álbum reconocible (${items.length.toLocaleString()} items).</p>
          <button class="btn btn-secondary" id="listened-change-btn">Cambiar playlist</button>
        </div>
      `;
      document.getElementById('listened-change-btn').onclick = () => openListenedAlbumsPicker({
        onSelect: () => { playlistInfo = getListenedPlaylist(); loadAlbums(); },
        onClear: () => { playlistInfo = null; renderNotConfigured(); },
      });
      return;
    }
    buildUI(items.length);
  } catch (e) {
    content.innerHTML = `
      <div class="card" style="max-width:560px">
        <p style="color:var(--color-error);margin-bottom:6px">Error: ${escapeHtml(e.message)}</p>
        <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">
          Suele ser un bache de conexión o un límite temporal de Spotify. Probá de nuevo.
        </p>
        <button class="btn btn-primary" id="listened-retry-btn">Reintentar</button>
      </div>
    `;
    document.getElementById('listened-retry-btn').onclick = () => loadAlbums();
  }
}

function buildUI(totalTracks) {
  const content = document.getElementById('listened-content');
  const mode = getSortMode();

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:14px">
        <strong>${albums.length.toLocaleString()}</strong> álbumes · <strong>${totalTracks.toLocaleString()}</strong> tracks en <strong>${escapeHtml(playlistInfo.name)}</strong>
      </div>
      <button class="btn btn-secondary btn-sm" id="listened-change-btn">Cambiar playlist</button>
    </div>

    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px;position:relative">
        <input type="text" id="listened-search" placeholder="Buscar álbum o artista..."
               style="width:100%;padding:9px 34px 9px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px">
        <button id="listened-search-clear" title="Limpiar"
                style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--color-text-muted);font-size:18px;cursor:pointer;padding:4px 8px;display:none">×</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--color-text-muted);margin-right:4px">Ordenar por:</span>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'recent' ? 'sort-active' : ''}" data-sort="recent" title="Agregados más recientemente a la playlist">Recientes</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'year-desc' ? 'sort-active' : ''}" data-sort="year-desc" title="Año de salida, más nuevos arriba">Año ↓</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'year-asc' ? 'sort-active' : ''}" data-sort="year-asc" title="Año de salida, más viejos arriba">Año ↑</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'artist-asc' ? 'sort-active' : ''}" data-sort="artist-asc" title="Artista alfabético">Artista</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'tracks-desc' ? 'sort-active' : ''}" data-sort="tracks-desc" title="Ordena los álbumes por cuántos temas tuyos tenés de cada uno (no agrega nada)">Más temas tuyos</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'name-asc' ? 'sort-active' : ''}" data-sort="name-asc" title="Nombre del álbum alfabético">A-Z</button>
      </div>
    </div>

    <div id="listened-summary" style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px"></div>
    <div id="listened-grid-holder"></div>
  `;

  document.getElementById('listened-change-btn').onclick = () => openListenedAlbumsPicker({
    onSelect: () => { playlistInfo = getListenedPlaylist(); loadAlbums(); },
    onClear: () => { playlistInfo = null; renderNotConfigured(); },
  });

  const searchInput = document.getElementById('listened-search');
  const clearBtn = document.getElementById('listened-search-clear');
  searchInput.addEventListener('input', () => {
    filterText = searchInput.value.trim().toLowerCase();
    clearBtn.style.display = filterText ? 'block' : 'none';
    renderGrid();
  });
  clearBtn.onclick = () => {
    searchInput.value = '';
    filterText = '';
    clearBtn.style.display = 'none';
    renderGrid();
    searchInput.focus();
  };
  content.querySelectorAll('.sort-btn').forEach(btn => {
    btn.onclick = () => {
      setSortMode(btn.dataset.sort);
      content.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('sort-active', b === btn));
      renderGrid();
    };
  });

  renderGrid();
}

function sortAlbums(list) {
  const mode = getSortMode();
  const copy = [...list];
  if (mode === 'year-desc') copy.sort((a, b) => (b.year || '0').localeCompare(a.year || '0'));
  else if (mode === 'year-asc') copy.sort((a, b) => (a.year || '9999').localeCompare(b.year || '9999'));
  else if (mode === 'artist-asc') copy.sort((a, b) => a.artist.localeCompare(b.artist));
  else if (mode === 'tracks-desc') copy.sort((a, b) => b.tracks.length - a.tracks.length);
  else if (mode === 'name-asc') copy.sort((a, b) => a.name.localeCompare(b.name));
  else copy.sort((a, b) => b.addedAt - a.addedAt); // recent
  return copy;
}

function renderGrid() {
  const holder = document.getElementById('listened-grid-holder');
  const summary = document.getElementById('listened-summary');
  if (!holder || !summary) return;

  const filtered = filterText
    ? albums.filter(a => a.name.toLowerCase().includes(filterText) || a.artist.toLowerCase().includes(filterText))
    : albums;
  const sorted = sortAlbums(filtered);

  if (filterText) {
    summary.textContent = `${sorted.length} de ${albums.length} álbumes coinciden con "${filterText}"`;
  } else {
    summary.textContent = `${albums.length} álbumes únicos. Click en uno para ver los tracks que tenés de él.`;
  }

  if (sorted.length === 0) {
    holder.innerHTML = `<div class="card"><p>Ningún álbum coincide con "${escapeHtml(filterText)}".</p></div>`;
    return;
  }

  holder.innerHTML = `
    <div class="playlist-grid">
      ${sorted.map(a => `
        <button class="playlist-card" data-id="${a.id}">
          <div class="playlist-card-cover">
            ${a.cover ? `<img src="${a.cover}" loading="lazy" alt="">` : `<div class="playlist-card-cover-placeholder">♪</div>`}
          </div>
          <div class="playlist-card-name">${escapeHtml(a.name)}</div>
          <div class="playlist-card-meta">${escapeHtml(a.artist)}${a.year ? ` · ${a.year}` : ''}</div>
          <div class="playlist-card-meta" style="color:var(--color-text-muted)">${a.tracks.length} track${a.tracks.length === 1 ? '' : 's'} en la playlist</div>
        </button>
      `).join('')}
    </div>
  `;

  holder.querySelectorAll('.playlist-card').forEach(el => {
    el.onclick = () => openAlbumDetail(el.dataset.id);
  });
}

function openAlbumDetail(albumId) {
  const album = albums.find(a => a.id === albumId);
  if (!album) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px">
      <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
        ${album.cover ? `<img src="${album.cover}" style="width:72px;height:72px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:72px;height:72px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
        <div style="min-width:0">
          <h2 style="margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(album.name)}</h2>
          <div style="color:var(--color-text-secondary);font-size:14px">${escapeHtml(album.artist)}${album.year ? ` · ${album.year}` : ''}</div>
          <div style="color:var(--color-text-muted);font-size:12px;margin-top:2px">${album.tracks.length} track${album.tracks.length === 1 ? '' : 's'} tuyos en la playlist</div>
        </div>
      </div>
      <div style="max-height:320px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
        ${album.tracks.map((t, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
            <span style="width:22px;text-align:center;color:var(--color-text-muted);font-size:12px;flex-shrink:0">${i + 1}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.artists)}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="modal-actions" style="margin-top:16px">
        ${album.url ? `<a class="btn btn-secondary" href="${album.url}" target="_blank" rel="noopener">Ver álbum en Spotify</a>` : ''}
        <button class="btn btn-primary" id="listened-detail-close">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#listened-detail-close').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
}
