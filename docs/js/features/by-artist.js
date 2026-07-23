import { getAllLikedTracks, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache, getBestAvailableLikes } from '../api.js?v=53';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml } from '../ui/components.js?v=53';
import { showToast } from '../ui/toast.js?v=53';

const SORT_KEY = 'artist_sort_mode';
const VALID_SORTS = new Set(['count-desc', 'count-asc', 'name-asc']);
function getSortMode() {
  const v = localStorage.getItem(SORT_KEY);
  return VALID_SORTS.has(v) ? v : 'count-desc';
}
function setSortMode(v) {
  if (VALID_SORTS.has(v)) localStorage.setItem(SORT_KEY, v);
}

let likes = [];
let artistMap = new Map();
let selectedArtists = new Set();
let filterText = '';

export async function render(container) {
  likes = [];
  artistMap = new Map();
  selectedArtists = new Set();
  filterText = '';

  container.innerHTML = `
    <div class="page-header">
      <h1>Por artista</h1>
      <p>Elegí uno o varios artistas y armá una playlist con todos tus likes de ellos.</p>
    </div>
    <div id="by-artist-content">
      <div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Leyendo cache local...</div></div>
    </div>
  `;

  const { items } = await getBestAvailableLikes();
  if (items.length === 0) {
    renderStart();
  } else {
    likes = items;
    build();
  }
}

function renderStart() {
  const content = document.getElementById('by-artist-content');
  content.innerHTML = `
    <div class="card" style="max-width:520px">
      <h3 style="margin-bottom:8px">Necesitamos tus likes cacheados</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">
        No hay likes en el cache local. Podés cargarlos ahora (usa el cache si existe, si no baja todo desde Spotify).
      </p>
      <button class="btn btn-primary" id="artist-load-btn">Cargar likes</button>
    </div>
  `;
  document.getElementById('artist-load-btn').onclick = loadLikes;
}

async function loadLikes() {
  const content = document.getElementById('by-artist-content');
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando Liked Songs...</div></div>`;

  try {
    likes = await getAllLikedTracks(({ loaded, total }) => showProgress('Cargando likes...', loaded, total));
    hideProgress();
    build();
  } catch (e) {
    hideProgress();
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function build() {
  artistMap = new Map();
  likes.forEach(item => {
    const t = item.track;
    if (!t?.uri) return;
    const name = t.artists?.[0]?.name;
    if (!name) return;
    if (!artistMap.has(name)) artistMap.set(name, []);
    artistMap.get(name).push(t);
  });

  const content = document.getElementById('by-artist-content');
  const mode = getSortMode();

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:14px">
        <strong>${likes.length.toLocaleString()}</strong> likes · <strong>${artistMap.size.toLocaleString()}</strong> artistas únicos
      </div>
    </div>

    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px;position:relative">
        <input type="text" id="artist-search-input" placeholder="Buscar artista..."
               style="width:100%;padding:9px 34px 9px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px">
        <button id="artist-search-clear" title="Limpiar"
                style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--color-text-muted);font-size:18px;cursor:pointer;padding:4px 8px;display:none">×</button>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--color-text-muted);margin-right:4px">Ordenar por:</span>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'count-desc' ? 'sort-active' : ''}" data-sort="count-desc" title="Artistas con más likes tuyos arriba">Más canciones</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'count-asc' ? 'sort-active' : ''}" data-sort="count-asc" title="Artistas con menos likes tuyos arriba">Menos canciones</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'name-asc' ? 'sort-active' : ''}" data-sort="name-asc" title="Alfabético">A-Z</button>
      </div>
    </div>

    <div id="artist-summary" style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px"></div>
    <div id="artist-grid-holder"></div>
    <div id="artist-action-bar"></div>
  `;

  const searchInput = document.getElementById('artist-search-input');
  const clearBtn = document.getElementById('artist-search-clear');
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

function sortArtists(entries) {
  const mode = getSortMode();
  const copy = [...entries];
  if (mode === 'count-asc') copy.sort((a, b) => a[1].length - b[1].length);
  else if (mode === 'name-asc') copy.sort((a, b) => a[0].localeCompare(b[0]));
  else copy.sort((a, b) => b[1].length - a[1].length);
  return copy;
}

function renderGrid() {
  const holder = document.getElementById('artist-grid-holder');
  const summary = document.getElementById('artist-summary');
  if (!holder || !summary) return;

  const all = [...artistMap.entries()];
  const filtered = filterText
    ? all.filter(([name]) => name.toLowerCase().includes(filterText))
    : all;
  const sorted = sortArtists(filtered);
  const capped = sorted.slice(0, 400);

  if (filterText) {
    summary.textContent = `${sorted.length} de ${all.length} artistas coinciden con "${filterText}"${sorted.length > 400 ? ' — mostrando primeros 400' : ''}`;
  } else {
    summary.textContent = `${all.length} artistas${all.length > 400 ? ' — mostrando primeros 400, usá el buscador para acotar' : ''}. Click para seleccionar uno o varios.`;
  }

  if (sorted.length === 0) {
    holder.innerHTML = `<div class="card"><p>Ningún artista coincide con "${escapeHtml(filterText)}".</p></div>`;
    updateActionBar();
    return;
  }

  holder.innerHTML = `
    <div class="smart-grid" style="padding-bottom:80px">
      ${capped.map(([name, tracks]) => `
        <button class="smart-card artist-card ${selectedArtists.has(name) ? 'selected' : ''}" data-artist="${escapeHtml(name)}">
          <div class="smart-card-title" style="font-size:15px">${escapeHtml(name)}</div>
          <div class="smart-card-meta">${tracks.length.toLocaleString()} tracks</div>
        </button>
      `).join('')}
    </div>
  `;

  holder.querySelectorAll('.artist-card').forEach(el => {
    el.onclick = () => toggleArtist(el);
  });
  updateActionBar();
}

function toggleArtist(el) {
  const name = el.dataset.artist;
  if (selectedArtists.has(name)) {
    selectedArtists.delete(name);
    el.classList.remove('selected');
  } else {
    selectedArtists.add(name);
    el.classList.add('selected');
  }
  updateActionBar();
}

function updateActionBar() {
  const bar = document.getElementById('artist-action-bar');
  if (!bar) return;
  if (selectedArtists.size === 0) {
    bar.innerHTML = '';
    return;
  }

  const uniqueUris = new Set();
  selectedArtists.forEach(name => {
    (artistMap.get(name) || []).forEach(t => uniqueUris.add(t.uri));
  });

  const label = selectedArtists.size === 1
    ? [...selectedArtists][0]
    : `${selectedArtists.size} artistas`;

  bar.innerHTML = `
    <div class="action-bar">
      <div class="action-bar-info">
        <strong>${escapeHtml(label)}</strong> — ${uniqueUris.size.toLocaleString()} tracks únicos
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" id="artist-clear-btn">Limpiar</button>
        <button class="btn btn-primary" id="artist-create-btn">Crear playlist</button>
      </div>
    </div>
  `;

  document.getElementById('artist-clear-btn').onclick = () => {
    selectedArtists.clear();
    document.querySelectorAll('.artist-card.selected').forEach(el => el.classList.remove('selected'));
    updateActionBar();
  };
  document.getElementById('artist-create-btn').onclick = createPlaylistFromSelection;
}

async function createPlaylistFromSelection() {
  const names = [...selectedArtists];
  if (names.length === 0) return;
  const uniqueUris = new Set();
  names.forEach(name => {
    (artistMap.get(name) || []).forEach(t => uniqueUris.add(t.uri));
  });
  const uris = [...uniqueUris];
  if (uris.length === 0) return;

  const suggested = names.length === 1
    ? `Mis likes de ${names[0]}`
    : `Mis likes: ${names.join(' + ')}`;
  const subtitle = names.length === 1
    ? `Todos tus likes con ${names[0]} como artista principal.`
    : `Todos tus likes cuyo artista principal es alguno de: ${names.join(', ')}.`;

  const name = await promptPlaylistName(suggested, {
    trackCount: uris.length,
    subtitle,
  });
  if (!name) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, 'Generado desde Por artista', false);
    showProgress('Agregando tracks...', 0, uris.length);
    await addTracksToPlaylist(playlist.id, uris);
    invalidatePlaylistsCache();
    hideProgress();
    showToast(`"${name}" creada con ${uris.length} tracks`, 'success');
    selectedArtists.clear();
    renderGrid();
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
