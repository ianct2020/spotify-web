import { getAllPlaylistItems, getBestAvailableLikes, addTracksToPlaylist, removeTracksFromPlaylist } from '../api.js?v=59';
import { idbGetCached, idbSetCached, idbGetTimestamp, idbDel } from '../idb.js?v=59';
import { escapeHtml, confirmModal } from '../ui/components.js?v=59';
import { showToast } from '../ui/toast.js?v=59';
import { getListenedPlaylist, groupItemsByAlbum, openListenedAlbumsPicker, albumKey, baseName, norm } from './listened-shared.js?v=59';

const SORT_KEY = 'listened_sort_mode';
const VALID_SORTS = new Set(['recent', 'year-desc', 'year-asc', 'artist-asc', 'likes-desc', 'name-asc']);
const CACHE_TTL_MIN = 24 * 60; // refresca la playlist agrupada solo si pasó más de un día
const cacheKeyFor = id => `listened_grouped_${id}`;
let unregMin = 4; // mín. de canciones en likes para sugerir un álbum como "quizás escuchado sin registrar" (ajustable)
const DISMISS_KEY = 'listened_unreg_dismissed'; // álbumes que el usuario ocultó de "sin registrar"

let likesByKey = null; // Map albumKey -> { id, ids:Set, name, artist, year, image, tracks:[{name,artists,uri}] }

// Álbumes que Ian marcó "no me interesa" para que no vuelvan a aparecer en "sin registrar".
function getDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]')); } catch { return new Set(); }
}
function dismissUnreg(key) {
  const s = getDismissed();
  s.add(key);
  localStorage.setItem(DISMISS_KEY, JSON.stringify([...s]));
}
function clearDismissed() {
  localStorage.removeItem(DISMISS_KEY);
}
// Actualiza los números de los botones del header sin tener que recargar todo.
function refreshHeaderCounts() {
  const u = document.getElementById('listened-unreg-btn');
  if (u) u.textContent = `🎧 Sin registrar (${computeUnregistered().length})`;
  const d = document.getElementById('listened-dupes-btn');
  if (d) d.textContent = `💿 Duplicados (${computeEditionDupes().length})`;
}
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

// Después de modificar la playlist (agregar/sacar): esperar a que Spotify refleje el cambio,
// re-leer fresco, y limpiar el cache para que la próxima entrada re-analice.
async function refreshAfterWrite() {
  await new Promise(r => setTimeout(r, 900));
  await loadAlbums({ force: true });
  try { await idbDel(cacheKeyFor(playlistInfo.id)); } catch { /* ignora */ }
}

// Cruza cada álbum con tus Liked Songs. El conteo tiene que ser EXACTO:
//  1) agrupamos por album.id (un lanzamiento real) — NO por artista, porque dentro de un
//     mismo álbum el artista principal del track cambia con los feats (ej "$ome $exy $ong$ 4 U"),
//     y eso partía el conteo en pedazos.
//  2) después fusionamos deluxe + normal (misma obra) por albumKey, deduplicando por nombre
//     de canción para no contar dos veces el mismo tema.
async function attachLikes(albumList) {
  likesByKey = new Map();
  let items = [];
  try {
    ({ items } = await getBestAvailableLikes());
  } catch (e) {
    console.warn('No se pudieron cargar likes para el cruce:', e.message);
    for (const a of albumList) a.likes = [];
    return;
  }

  // 1) Una entrada por lanzamiento físico (album.id) con TODOS sus tracks likeados.
  const byId = new Map();
  for (const it of items) {
    const t = it.track;
    if (!t?.album?.id) continue;
    let e = byId.get(t.album.id);
    if (!e) {
      const imgs = t.album.images || [];
      e = {
        id: t.album.id,
        name: t.album.name || '',
        year: (t.album.release_date || '').slice(0, 4),
        image: imgs.length ? imgs[imgs.length - 1].url : null,
        tracks: [],
        artistCount: new Map(),
      };
      byId.set(e.id, e);
    }
    e.tracks.push({ name: t.name || '', artists: (t.artists || []).map(a => a.name).join(', '), uri: t.uri || (t.id ? `spotify:track:${t.id}` : null) });
    const pa = t.artists?.[0]?.name || '';
    e.artistCount.set(pa, (e.artistCount.get(pa) || 0) + 1);
  }
  // Artista representativo del álbum = el principal más frecuente entre sus tracks.
  for (const e of byId.values()) {
    let best = '', bestN = -1;
    for (const [name, n] of e.artistCount) if (n > bestN) { best = name; bestN = n; }
    e.artist = best;
    delete e.artistCount;
  }

  // 2) Fusionar lanzamientos que son la misma obra (deluxe + normal → uno), dedup por nombre.
  for (const e of byId.values()) {
    const k = albumKey(e.name, e.artist);
    let m = likesByKey.get(k);
    if (!m) {
      m = { id: e.id, ids: new Set([e.id]), name: e.name, artist: e.artist, year: e.year, image: e.image, tracks: [], _repCount: e.tracks.length, _seen: new Set() };
      likesByKey.set(k, m);
    } else {
      m.ids.add(e.id);
      // El lanzamiento con más tracks manda como representativo (suele ser el deluxe/completo).
      if (e.tracks.length > m._repCount) { m.name = e.name; m.artist = e.artist; m.image = e.image || m.image; m.year = e.year || m.year; m.id = e.id; m._repCount = e.tracks.length; }
    }
    for (const t of e.tracks) {
      const nk = norm(t.name);
      if (m._seen.has(nk)) continue;
      m._seen.add(nk);
      m.tracks.push(t);
    }
  }
  for (const m of likesByKey.values()) { delete m._repCount; delete m._seen; }

  for (const a of albumList) {
    a.likes = likesByKey.get(albumKey(a.name, a.artist))?.tracks || [];
  }
}

// Álbumes de los que tenés muchas canciones en likes pero NO están en tu registro.
// Heurística de "probablemente lo escuchaste completo y no lo agregaste".
function computeUnregistered(min = unregMin) {
  if (!likesByKey) return [];
  // Excluimos un álbum de las sugerencias si YA está registrado, por lo que sea:
  //  - albumKey (nombre-sin-edición|artista) → matchea deluxe vs normal;
  //  - id de álbum exacto (cualquiera de sus ediciones);
  //  - o si CUALQUIER track suyo ya está en la playlist (a prueba de nombres raros
  //    tipo "$ome $exy $ong$ 4 U", donde el nombre/artista no matchean pero el track sí).
  //  - o si lo ocultaste a mano.
  const dismissed = getDismissed();
  const registeredKeys = new Set(albums.map(a => albumKey(a.name, a.artist)));
  const registeredIds = new Set(albums.map(a => a.id));
  const registeredUris = new Set();
  for (const a of albums) for (const t of a.tracks) if (t.uri) registeredUris.add(t.uri);
  const out = [];
  for (const [k, e] of likesByKey) {
    if (dismissed.has(k)) continue;
    if (registeredKeys.has(k)) continue;
    if ([...e.ids].some(id => registeredIds.has(id))) continue;
    if (e.tracks.some(t => t.uri && registeredUris.has(t.uri))) continue;
    if (e.tracks.length < min) continue;
    out.push({ ...e, key: k });
  }
  out.sort((a, b) => b.tracks.length - a.tracks.length);
  return out;
}

// Un álbum es "edición" (deluxe/remaster/etc) si sacarle las marcas cambia el nombre.
function isEdition(name) {
  return norm(name) !== norm(baseName(name));
}


// Álbumes registrados que aparecen en 2+ ediciones (ej: la normal Y la deluxe).
// Devuelve grupos [{ keeper, remove:[...] }] donde 'remove' son las ediciones sobrantes.
// Regla: si hay una versión normal, esa se queda; si son todas ediciones, se queda la de más tracks.
function computeEditionDupes() {
  const byKey = new Map();
  for (const a of albums) {
    const k = albumKey(a.name, a.artist);
    let arr = byKey.get(k);
    if (!arr) { arr = []; byKey.set(k, arr); }
    arr.push(a);
  }
  const groups = [];
  for (const arr of byKey.values()) {
    if (arr.length < 2) continue;
    const normals = arr.filter(a => !isEdition(a.name));
    let keeper;
    if (normals.length) keeper = normals.slice().sort((a, b) => b.tracks.length - a.tracks.length)[0];
    else keeper = arr.slice().sort((a, b) => b.tracks.length - a.tracks.length)[0];
    const remove = arr.filter(a => a !== keeper);
    groups.push({ keeper, remove });
  }
  groups.sort((g1, g2) => g1.keeper.artist.localeCompare(g2.keeper.artist));
  return groups;
}

function buildUI(totalTracks, ts) {
  const content = document.getElementById('listened-content');
  const mode = getSortMode();
  const totalLikes = albums.reduce((n, a) => n + (a.likes?.length || 0), 0);
  const unregistered = computeUnregistered();
  const dupes = computeEditionDupes();

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-size:14px">
        <strong>${albums.length.toLocaleString()}</strong> álbumes · <strong>${totalTracks.toLocaleString()}</strong> tracks${totalLikes ? ` · <span style="color:var(--color-accent)">♥ ${totalLikes.toLocaleString()} en tus likes</span>` : ''} en <strong>${escapeHtml(playlistInfo.name)}</strong>
        ${ts ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">Actualizado ${timeAgo(ts)}</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="listened-unreg-btn" title="Álbumes con varias canciones tuyas en likes que no están en tu registro (ajustás el mínimo adentro)">🎧 Sin registrar (${unregistered.length})</button>
        <button class="btn btn-secondary btn-sm" id="listened-dupes-btn" title="Álbumes registrados dos veces (deluxe Y normal): sacás la sobrante y queda una sola versión">💿 Duplicados (${dupes.length})</button>
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

  const dupesBtn = document.getElementById('listened-dupes-btn');
  if (dupesBtn) dupesBtn.onclick = () => openDupes(dupes);

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
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">🎧 Quizás escuchaste y no registraste</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px">
        Álbumes que no están en <strong>${escapeHtml(playlistInfo.name)}</strong> pero de los que tenés varias canciones en Liked Songs.
        Muchos likes de un mismo álbum suele indicar que lo escuchaste bastante. (Deluxe y normal cuentan como uno solo.)
      </p>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap;flex-shrink:0">
        <span style="font-size:12px;color:var(--color-text-muted)">Mínimo de canciones en likes:</span>
        ${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<button class="btn ${n === unregMin ? 'btn-primary' : 'btn-secondary'} btn-sm unreg-th" data-th="${n}">${n}+</button>`).join('')}
      </div>
      <div id="unreg-list" class="picker-scroll"></div>
      <div id="unreg-hidden-note" style="font-size:12px;color:var(--color-text-muted);margin-top:8px;flex-shrink:0"></div>
      <div class="modal-actions" style="margin-top:12px">
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
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm)">
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
            <button class="unreg-hide" data-key="${e.key}" title="No me interesa, ocultar" style="background:transparent;border:none;color:var(--color-text-muted);font-size:16px;cursor:pointer;padding:2px 6px;flex-shrink:0;line-height:1;border-radius:var(--radius-sm)">✕</button>
          </label>`;
        }).join('')}
      </div>
    `;
    holder.querySelectorAll('.unreg-cb').forEach(cb => cb.addEventListener('change', updateAddBtn));
    holder.querySelectorAll('.unreg-hide').forEach(btn => {
      btn.addEventListener('mouseenter', () => { btn.style.color = 'var(--color-error)'; btn.style.background = 'var(--color-elevated)'; });
      btn.addEventListener('mouseleave', () => { btn.style.color = 'var(--color-text-muted)'; btn.style.background = 'transparent'; });
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        dismissUnreg(btn.dataset.key);
        refreshHeaderCounts();
        renderList();
      });
    });
    const allCb = holder.querySelector('#unreg-all');
    if (allCb) allCb.addEventListener('change', () => {
      holder.querySelectorAll('.unreg-cb:not(:disabled)').forEach(cb => { cb.checked = allCb.checked; });
      updateAddBtn();
    });
    updateHiddenNote();
    updateAddBtn();
  };

  const updateHiddenNote = () => {
    const note = overlay.querySelector('#unreg-hidden-note');
    if (!note) return;
    const n = getDismissed().size;
    note.innerHTML = n
      ? `${n} oculto${n === 1 ? '' : 's'} · <a href="#" id="unreg-show-hidden" style="color:var(--color-accent)">volver a mostrar</a>`
      : '';
    const showLink = note.querySelector('#unreg-show-hidden');
    if (showLink) showLink.onclick = ev => {
      ev.preventDefault();
      clearDismissed();
      refreshHeaderCounts();
      renderList();
    };
  };
  renderList();

  overlay.querySelectorAll('.unreg-th').forEach(btn => {
    btn.onclick = () => {
      unregMin = parseInt(btn.dataset.th);
      overlay.querySelectorAll('.unreg-th').forEach(b => {
        const active = b === btn;
        b.classList.toggle('btn-primary', active);
        b.classList.toggle('btn-secondary', !active);
      });
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
      await refreshAfterWrite();
    } catch (err) {
      showToast('Error al agregar: ' + err.message, 'error');
      addBtn.disabled = false;
      updateAddBtn();
    }
  };
}

// Modal de álbumes registrados por duplicado (2+ ediciones). Se marca para sacar la
// sobrante y dejar una sola (por defecto se queda la normal / la de más tracks).
function openDupes(groups) {
  const cover = (a, size = 34) => a.cover
    ? `<img src="${a.cover}" loading="lazy" style="width:${size}px;height:${size}px;border-radius:var(--radius-sm);object-fit:cover;flex-shrink:0">`
    : `<div style="width:${size}px;height:${size}px;background:var(--color-elevated);border-radius:var(--radius-sm);flex-shrink:0"></div>`;

  const groupsHtml = groups.map(g => {
    const base = baseName(g.keeper.name).trim() || g.keeper.name;
    const keepRow = `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;opacity:0.7">
        <span style="width:19px;text-align:center;color:var(--color-accent);flex-shrink:0">✓</span>
        ${cover(g.keeper)}
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(g.keeper.name)}</div>
          <div style="font-size:12px;color:var(--color-accent)">se queda</div>
        </div>
      </div>`;
    const removeRows = g.remove.map(a => {
      const uris = (a.tracks || []).map(t => t.uri).filter(Boolean).join(',');
      return `
      <label style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:${uris ? 'pointer' : 'default'}">
        <input type="checkbox" class="dup-cb" data-uris="${uris}" ${uris ? 'checked' : 'disabled'}>
        ${cover(a)}
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
          <div style="font-size:12px;color:var(--color-error)">sacar${a.url ? ` · <a href="${a.url}" target="_blank" rel="noopener" style="color:var(--color-accent)">abrir</a>` : ''}</div>
        </div>
      </label>`;
    }).join('');
    return `
      <div style="border-bottom:1px solid var(--color-border)">
        <div style="font-size:11px;color:var(--color-text-muted);padding:9px 12px 2px;text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(g.keeper.artist)} — ${escapeHtml(base)}</div>
        ${keepRow}
        ${removeRows}
      </div>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">💿 Duplicados por edición</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px;flex-shrink:0">
        Álbumes que tenés registrados <strong>dos veces</strong> en <strong>${escapeHtml(playlistInfo.name)}</strong> (deluxe Y normal, etc.).
        Ya marqué la sobrante para sacar (queda la normal / la de más tracks). Revisá y confirmá.
      </p>
      <div class="picker-scroll" style="border:1px solid var(--color-border);border-radius:var(--radius-sm)">
        ${groupsHtml}
      </div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn btn-danger" id="dup-del">Sacar seleccionados (0)</button>
        <button class="btn btn-secondary" id="dup-close">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const delBtn = overlay.querySelector('#dup-del');
  const updateDelBtn = () => {
    const n = overlay.querySelectorAll('.dup-cb:checked').length;
    delBtn.textContent = `Sacar seleccionados (${n})`;
    delBtn.disabled = n === 0;
  };
  overlay.querySelectorAll('.dup-cb').forEach(cb => cb.addEventListener('change', updateDelBtn));
  updateDelBtn();

  const close = () => overlay.remove();
  overlay.querySelector('#dup-close').onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };

  delBtn.onclick = async () => {
    const selected = [...overlay.querySelectorAll('.dup-cb:checked')];
    const uris = selected.flatMap(cb => (cb.dataset.uris || '').split(',').filter(Boolean));
    if (uris.length === 0) return;
    const ok = await confirmModal(
      'Sacar ediciones duplicadas',
      `Se van a <strong>sacar ${selected.length} edición${selected.length === 1 ? '' : 'es'}</strong> de tu playlist "${escapeHtml(playlistInfo.name)}", dejando una versión de cada álbum. Esto modifica tu playlist en Spotify. ¿Seguro?`,
      'Sacar'
    );
    if (!ok) return;
    delBtn.disabled = true;
    delBtn.textContent = 'Sacando...';
    try {
      await removeTracksFromPlaylist(playlistInfo.id, uris);
      showToast(`${selected.length} edición${selected.length === 1 ? '' : 'es'} sacada${selected.length === 1 ? '' : 's'}`, 'success');
      close();
      await refreshAfterWrite();
    } catch (err) {
      showToast('Error al sacar: ' + err.message, 'error');
      delBtn.disabled = false;
      updateDelBtn();
    }
  };
}
