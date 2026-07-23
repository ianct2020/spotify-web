import { getAllPlaylistItems, getBestAvailableLikes, addTracksToPlaylist, removeTracksFromPlaylist } from '../api.js?v=54';
import { idbGetCached, idbSetCached, idbGetTimestamp } from '../idb.js?v=54';
import { escapeHtml, confirmModal } from '../ui/components.js?v=54';
import { showToast } from '../ui/toast.js?v=54';
import { getListenedPlaylist, groupItemsByAlbum, openListenedAlbumsPicker, albumKey, baseName, norm } from './listened-shared.js?v=54';

const SORT_KEY = 'listened_sort_mode';
const VALID_SORTS = new Set(['recent', 'year-desc', 'year-asc', 'artist-asc', 'likes-desc', 'name-asc']);
const CACHE_TTL_MIN = 24 * 60; // refresca la playlist agrupada solo si pasó más de un día
const cacheKeyFor = id => `listened_grouped_${id}`;
let unregMin = 4; // mín. de canciones en likes para sugerir un álbum como "quizás escuchado sin registrar" (ajustable)

let likesByKey = null; // Map albumKey -> { id, name, artist, year, image, tracks:[{name,artists}] }
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

async function loadAlbums({ force = false } = {}) {
  const content = document.getElementById('listened-content');
  const key = cacheKeyFor(playlistInfo.id);
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">${force ? 'Actualizando' : 'Cargando'} "${escapeHtml(playlistInfo.name)}"...</div></div>`;

  try {
    let totalTracks;
    let cached = null;
    if (!force) {
      try { cached = await idbGetCached(key); } catch { /* ignora */ }
    }

    if (cached && Array.isArray(cached.albums)) {
      albums = cached.albums;
      totalTracks = cached.totalTracks ?? albums.reduce((n, a) => n + a.tracks.length, 0);
    } else {
      const items = await getAllPlaylistItems(playlistInfo.id);
      albums = groupItemsByAlbum(items);
      totalTracks = items.length;
      if (albums.length > 0) {
        try { await idbSetCached(key, { albums, totalTracks }, CACHE_TTL_MIN); } catch (e) { console.warn('cache listened:', e.message); }
      }
    }

    if (albums.length === 0) {
      content.innerHTML = `
        <div class="card" style="max-width:560px">
          <p style="margin-bottom:12px">La playlist <strong>${escapeHtml(playlistInfo.name)}</strong> no tiene tracks con álbum reconocible (${totalTracks.toLocaleString()} items).</p>
          <button class="btn btn-secondary" id="listened-change-btn">Cambiar playlist</button>
        </div>
      `;
      document.getElementById('listened-change-btn').onclick = () => openListenedAlbumsPicker({
        onSelect: () => { playlistInfo = getListenedPlaylist(); loadAlbums(); },
        onClear: () => { playlistInfo = null; renderNotConfigured(); },
      });
      return;
    }

    await attachLikes(albums);
    let ts = null;
    try { ts = await idbGetTimestamp(key); } catch { /* ignora */ }
    buildUI(totalTracks, ts);
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
    document.getElementById('listened-retry-btn').onclick = () => loadAlbums({ force: true });
  }
}

// Cruza cada álbum con tus Liked Songs (por nombre-sin-edición|artista, así matchea deluxe vs normal).
// Deja el mapa completo en likesByKey para reusarlo en "quizás sin registrar".
async function attachLikes(albumList) {
  likesByKey = new Map();
  try {
    const { items } = await getBestAvailableLikes();
    for (const it of items) {
      const t = it.track;
      if (!t?.album?.name) continue;
      const k = albumKey(t.album.name, t.artists?.[0]?.name || '');
      let e = likesByKey.get(k);
      if (!e) {
        const imgs = t.album.images || [];
        e = {
          id: t.album.id,
          name: t.album.name,
          artist: t.artists?.[0]?.name || '',
          year: (t.album.release_date || '').slice(0, 4),
          image: imgs.length ? imgs[imgs.length - 1].url : null,
          tracks: [],
        };
        likesByKey.set(k, e);
      }
      e.tracks.push({ name: t.name || '', artists: (t.artists || []).map(a => a.name).join(', '), uri: t.uri || (t.id ? `spotify:track:${t.id}` : null) });
    }
  } catch (e) {
    console.warn('No se pudieron cargar likes para el cruce:', e.message);
    likesByKey = new Map();
  }
  for (const a of albumList) {
    a.likes = likesByKey.get(albumKey(a.name, a.artist))?.tracks || [];
  }
}

// Álbumes de los que tenés muchas canciones en likes pero NO están en tu registro.
// Heurística de "probablemente lo escuchaste completo y no lo agregaste".
function computeUnregistered(min = unregMin) {
  if (!likesByKey) return [];
  // registered usa albumKey (nombre-sin-edición|artista): si tenés la Deluxe registrada,
  // la normal cae bajo la misma clave y queda excluida → no cuenta dos veces.
  const registered = new Set(albums.map(a => albumKey(a.name, a.artist)));
  const out = [];
  for (const [k, e] of likesByKey) {
    if (registered.has(k)) continue;
    if (e.tracks.length < min) continue;
    out.push(e);
  }
  out.sort((a, b) => b.tracks.length - a.tracks.length);
  return out;
}

// Un álbum es "edición" (deluxe/remaster/etc) si sacarle las marcas cambia el nombre.
function isEdition(name) {
  return norm(name) !== norm(baseName(name));
}
function computeEditions() {
  return albums.filter(a => isEdition(a.name)).sort((a, b) => a.artist.localeCompare(b.artist));
}

function buildUI(totalTracks, ts) {
  const content = document.getElementById('listened-content');
  const mode = getSortMode();
  const totalLikes = albums.reduce((n, a) => n + (a.likes?.length || 0), 0);
  const unregistered = computeUnregistered();
  const editions = computeEditions();

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:14px">
        <strong>${albums.length.toLocaleString()}</strong> álbumes · <strong>${totalTracks.toLocaleString()}</strong> tracks${totalLikes ? ` · <span style="color:var(--color-accent)">♥ ${totalLikes.toLocaleString()} en tus likes</span>` : ''} en <strong>${escapeHtml(playlistInfo.name)}</strong>
        ${ts ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">Actualizado ${timeAgo(ts)}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${unregistered.length ? `<button class="btn btn-secondary btn-sm" id="listened-unreg-btn" title="Álbumes con ${unregMin}+ canciones tuyas en likes que no están en tu registro">🎧 Quizás sin registrar (${unregistered.length})</button>` : ''}
        ${editions.length ? `<button class="btn btn-secondary btn-sm" id="listened-editions-btn" title="Álbumes registrados que son ediciones deluxe/remaster (para reemplazar por la normal a mano)">💿 Ediciones deluxe (${editions.length})</button>` : ''}
        <button class="btn btn-secondary btn-sm" id="listened-refresh-btn" title="Vuelve a leer la playlist desde Spotify (si no, se refresca solo una vez por día)">Actualizar</button>
        <button class="btn btn-secondary btn-sm" id="listened-change-btn">Cambiar playlist</button>
      </div>
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
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'likes-desc' ? 'sort-active' : ''}" data-sort="likes-desc" title="Ordena por cuántas canciones de cada álbum tenés en tus Liked Songs">Más likeados ♥</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'name-asc' ? 'sort-active' : ''}" data-sort="name-asc" title="Nombre del álbum alfabético">A-Z</button>
      </div>
    </div>

    <div id="listened-summary" style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px"></div>
    <div id="listened-grid-holder"></div>
  `;

  document.getElementById('listened-refresh-btn').onclick = () => loadAlbums({ force: true });

  const unregBtn = document.getElementById('listened-unreg-btn');
  if (unregBtn) unregBtn.onclick = () => openUnregistered();

  const editionsBtn = document.getElementById('listened-editions-btn');
  if (editionsBtn) editionsBtn.onclick = () => openEditions(editions);

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
      // Reapretar el orden activo lo deselecciona y vuelve al default (Recientes).
      const newMode = btn.classList.contains('sort-active') ? 'recent' : btn.dataset.sort;
      setSortMode(newMode);
      content.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('sort-active', b.dataset.sort === newMode));
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
  else if (mode === 'likes-desc') copy.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0) || b.tracks.length - a.tracks.length);
  else if (mode === 'name-asc') copy.sort((a, b) => a.name.localeCompare(b.name));
  else copy.sort((a, b) => b.addedAt - a.addedAt); // recent
  return copy;
}

function timeAgo(ts) {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.round(hrs / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
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
          <div class="playlist-card-meta" style="color:var(--color-text-muted)">${a.tracks.length} en la playlist${a.likes?.length ? ` · <span style="color:var(--color-accent)">♥ ${a.likes.length}</span>` : ''}</div>
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
      <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px">En la playlist (${album.tracks.length})</div>
      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
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

      <div style="font-size:12px;color:var(--color-accent);margin:16px 0 6px">♥ De este álbum en tus Liked Songs (${album.likes?.length || 0})</div>
      ${album.likes?.length ? `
      <div style="max-height:220px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
        ${album.likes.map((t, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
            <span style="width:22px;text-align:center;color:var(--color-accent);font-size:12px;flex-shrink:0">♥</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.artists)}</div>
            </div>
          </div>
        `).join('')}
      </div>` : `<div style="color:var(--color-text-muted);font-size:13px">No tenés canciones de este álbum en tus likes.</div>`}
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

// Modal con álbumes que tenés muy likeados pero no figuran en tu playlist de registro.
// Umbral ajustable en vivo (3/4/5/6/8 canciones en likes).
function openUnregistered() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px">
      <h2 style="margin-bottom:4px">🎧 Quizás escuchaste y no registraste</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px">
        Álbumes que no están en <strong>${escapeHtml(playlistInfo.name)}</strong> pero de los que tenés varias canciones en Liked Songs.
        Muchos likes de un mismo álbum suele indicar que lo escuchaste bastante. (Deluxe y normal cuentan como uno solo.)
      </p>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--color-text-muted)">Mínimo de canciones en likes:</span>
        ${[3, 4, 5, 6, 8].map(n => `<button class="btn btn-secondary btn-sm unreg-th ${n === unregMin ? 'sort-active' : ''}" data-th="${n}">${n}+</button>`).join('')}
      </div>
      <div id="unreg-list"></div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn btn-primary" id="unreg-add" disabled>Agregar a escuchados (0)</button>
        <button class="btn btn-secondary" id="listened-unreg-close">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const addBtn = overlay.querySelector('#unreg-add');
  const updateAddBtn = () => {
    const n = overlay.querySelectorAll('.unreg-cb:checked').length;
    addBtn.textContent = `Agregar a escuchados (${n})`;
    addBtn.disabled = n === 0;
  };

  const renderList = () => {
    const list = computeUnregistered(unregMin);
    const holder = overlay.querySelector('#unreg-list');
    if (list.length === 0) {
      holder.innerHTML = `<div style="color:var(--color-text-muted);font-size:13px;padding:8px 0">No hay álbumes con ${unregMin}+ canciones en likes fuera de tu registro.</div>`;
      updateAddBtn();
      return;
    }
    holder.innerHTML = `
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-muted);margin-bottom:6px;cursor:pointer">
        <input type="checkbox" id="unreg-all"> Seleccionar todos (${list.length} álbumes)
      </label>
      <div style="max-height:52vh;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
        ${list.map(e => {
          const url = e.id ? `https://open.spotify.com/album/${e.id}` : null;
          const uri = e.tracks.find(t => t.uri)?.uri || '';
          return `
          <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border);cursor:${uri ? 'pointer' : 'default'}">
            <input type="checkbox" class="unreg-cb" data-uri="${uri}" ${uri ? '' : 'disabled'}>
            ${e.image ? `<img src="${e.image}" loading="lazy" style="width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:40px;height:40px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.artist)}${e.year ? ` · ${e.year}` : ''}</div>
            </div>
            <span style="color:var(--color-accent);font-size:13px;flex-shrink:0">♥ ${e.tracks.length}</span>
            ${url ? `<a href="${url}" target="_blank" rel="noopener" style="color:var(--color-accent);font-size:12px;flex-shrink:0">abrir</a>` : ''}
          </label>`;
        }).join('')}
      </div>
    `;
    holder.querySelectorAll('.unreg-cb').forEach(cb => cb.addEventListener('change', updateAddBtn));
    const allCb = holder.querySelector('#unreg-all');
    if (allCb) allCb.addEventListener('change', () => {
      holder.querySelectorAll('.unreg-cb:not(:disabled)').forEach(cb => { cb.checked = allCb.checked; });
      updateAddBtn();
    });
    updateAddBtn();
  };
  renderList();

  overlay.querySelectorAll('.unreg-th').forEach(btn => {
    btn.onclick = () => {
      unregMin = parseInt(btn.dataset.th);
      overlay.querySelectorAll('.unreg-th').forEach(b => b.classList.toggle('sort-active', b === btn));
      renderList();
    };
  });

  const close = () => overlay.remove();
  overlay.querySelector('#listened-unreg-close').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  addBtn.onclick = async () => {
    const uris = [...overlay.querySelectorAll('.unreg-cb:checked')].map(cb => cb.dataset.uri).filter(Boolean);
    if (uris.length === 0) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Agregando...';
    try {
      await addTracksToPlaylist(playlistInfo.id, uris);      // sin confirmación (pedido de Ian)
      showToast(`${uris.length} álbum${uris.length === 1 ? '' : 'es'} agregado${uris.length === 1 ? '' : 's'} a escuchados`, 'success');
      close();
      await loadAlbums({ force: true });
    } catch (err) {
      showToast('Error al agregar: ' + err.message, 'error');
      addBtn.disabled = false;
      updateAddBtn();
    }
  };
}

// Modal con los álbumes registrados que son ediciones deluxe/remaster.
// Se pueden seleccionar y borrar de la playlist (con confirmación).
function openEditions(list) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px">
      <h2 style="margin-bottom:4px">💿 Ediciones deluxe en tu registro</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px">
        Estos álbumes de <strong>${escapeHtml(playlistInfo.name)}</strong> están registrados como edición (deluxe, remaster, etc.).
        Seleccioná los que quieras <strong>sacar</strong> de la playlist (después agregás la edición normal a mano desde Spotify).
      </p>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--color-text-muted);margin-bottom:6px;cursor:pointer">
        <input type="checkbox" id="ed-all"> Seleccionar todos (${list.length})
      </label>
      <div style="max-height:52vh;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
        ${list.map(a => {
          const uris = (a.tracks || []).map(t => t.uri).filter(Boolean).join(',');
          return `
          <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid var(--color-border);cursor:${uris ? 'pointer' : 'default'}">
            <input type="checkbox" class="ed-cb" data-uris="${uris}" ${uris ? '' : 'disabled'}>
            ${a.cover ? `<img src="${a.cover}" loading="lazy" style="width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:40px;height:40px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
              <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.artist)}${a.year ? ` · ${a.year}` : ''}</div>
            </div>
            ${a.url ? `<a href="${a.url}" target="_blank" rel="noopener" style="color:var(--color-accent);font-size:12px;flex-shrink:0">abrir</a>` : ''}
          </label>`;
        }).join('')}
      </div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn btn-danger" id="ed-del" disabled>Borrar de escuchados (0)</button>
        <button class="btn btn-secondary" id="listened-editions-close">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const delBtn = overlay.querySelector('#ed-del');
  const updateDelBtn = () => {
    const n = overlay.querySelectorAll('.ed-cb:checked').length;
    delBtn.textContent = `Borrar de escuchados (${n})`;
    delBtn.disabled = n === 0;
  };
  overlay.querySelectorAll('.ed-cb').forEach(cb => cb.addEventListener('change', updateDelBtn));
  const allCb = overlay.querySelector('#ed-all');
  if (allCb) allCb.addEventListener('change', () => {
    overlay.querySelectorAll('.ed-cb:not(:disabled)').forEach(cb => { cb.checked = allCb.checked; });
    updateDelBtn();
  });

  const close = () => overlay.remove();
  overlay.querySelector('#listened-editions-close').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  delBtn.onclick = async () => {
    const selected = [...overlay.querySelectorAll('.ed-cb:checked')];
    const uris = selected.flatMap(cb => (cb.dataset.uris || '').split(',').filter(Boolean));
    if (uris.length === 0) return;
    const ok = await confirmModal(
      'Borrar de escuchados',
      `Se van a <strong>sacar ${selected.length} álbum${selected.length === 1 ? '' : 'es'}</strong> de tu playlist "${escapeHtml(playlistInfo.name)}". Esto modifica tu playlist en Spotify. ¿Seguro?`,
      'Borrar'
    );
    if (!ok) return;
    delBtn.disabled = true;
    delBtn.textContent = 'Borrando...';
    try {
      await removeTracksFromPlaylist(playlistInfo.id, uris);
      showToast(`${selected.length} álbum${selected.length === 1 ? '' : 'es'} sacado${selected.length === 1 ? '' : 's'} de escuchados`, 'success');
      close();
      await loadAlbums({ force: true });
    } catch (err) {
      showToast('Error al borrar: ' + err.message, 'error');
      delBtn.disabled = false;
      updateDelBtn();
    }
  };
}
