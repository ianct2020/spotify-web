import { getAllLikedTracks, createPlaylist, addTracksToPlaylist, getAllUserPlaylists, invalidatePlaylistsCache } from '../api.js?v=61';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml } from '../ui/components.js?v=61';
import { showToast } from '../ui/toast.js?v=61';

let likes = [];
let currentTab = 'year';

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Smart Playlists</h1>
      <p>Generá playlists automáticas a partir de tus Liked Songs.</p>
    </div>

    <div class="tabs" style="display:flex;gap:8px;border-bottom:1px solid var(--color-border);margin-bottom:20px">
      <button class="tab-btn" data-tab="year">Por año</button>
      <button class="tab-btn" data-tab="decade">Por década</button>
      <button class="tab-btn" data-tab="random">Random N</button>
    </div>

    <div id="smart-content">
      <div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando Liked Songs...</div></div>
    </div>
  `;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      currentTab = btn.dataset.tab;
      updateTabStyles();
      renderTab();
    };
  });
  updateTabStyles();

  loadLikes();
}

function updateTabStyles() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tab === currentTab;
    btn.style.cssText = `
      background:${active ? 'var(--color-accent)' : 'transparent'};
      color:${active ? 'white' : 'var(--color-text)'};
      border:none;
      padding:10px 18px;
      border-radius:var(--radius-sm) var(--radius-sm) 0 0;
      cursor:pointer;
      font-weight:500;
    `;
  });
}

async function loadLikes() {
  try {
    likes = await getAllLikedTracks(({ loaded, total }) => {
      showProgress('Cargando Liked Songs...', loaded, total);
    });
    hideProgress();
    renderTab();
  } catch (e) {
    hideProgress();
    document.getElementById('smart-content').innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function renderTab() {
  if (currentTab === 'year') renderYearTab();
  else if (currentTab === 'decade') renderDecadeTab();
  else if (currentTab === 'random') renderRandomTab();
}

function getYear(track) {
  const rd = track?.album?.release_date;
  if (!rd) return null;
  const y = parseInt(rd.slice(0, 4));
  return isNaN(y) ? null : y;
}

function groupByYear() {
  const map = new Map();
  likes.forEach(item => {
    const year = getYear(item.track);
    if (year == null || !item.track?.uri) return;
    if (!map.has(year)) map.set(year, []);
    map.get(year).push(item.track);
  });
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

function groupByDecade() {
  const map = new Map();
  likes.forEach(item => {
    const year = getYear(item.track);
    if (year == null || !item.track?.uri) return;
    const decade = Math.floor(year / 10) * 10;
    if (!map.has(decade)) map.set(decade, []);
    map.get(decade).push(item.track);
  });
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

function renderYearTab() {
  const groups = groupByYear();
  const content = document.getElementById('smart-content');
  if (groups.length === 0) {
    content.innerHTML = `<div class="card"><p>No hay años disponibles.</p></div>`;
    return;
  }
  content.innerHTML = `
    <div style="margin-bottom:12px;color:var(--color-text-secondary);font-size:14px">
      ${likes.length.toLocaleString()} likes analizados · ${groups.length} años distintos
    </div>
    <div class="smart-grid">
      ${groups.map(([year, tracks]) => `
        <button class="smart-card" data-year="${year}">
          <div class="smart-card-title">${year}</div>
          <div class="smart-card-meta">${tracks.length.toLocaleString()} likes</div>
        </button>
      `).join('')}
    </div>
  `;
  content.querySelectorAll('.smart-card').forEach(el => {
    el.onclick = () => promptCreate(`Likes ${el.dataset.year}`, groupByYear().find(([y]) => y == el.dataset.year)[1]);
  });
}

function renderDecadeTab() {
  const groups = groupByDecade();
  const content = document.getElementById('smart-content');
  if (groups.length === 0) {
    content.innerHTML = `<div class="card"><p>No hay décadas disponibles.</p></div>`;
    return;
  }
  content.innerHTML = `
    <div style="margin-bottom:12px;color:var(--color-text-secondary);font-size:14px">
      ${likes.length.toLocaleString()} likes analizados · ${groups.length} décadas
    </div>
    <div class="smart-grid">
      ${groups.map(([decade, tracks]) => `
        <button class="smart-card" data-decade="${decade}">
          <div class="smart-card-title">${decade}s</div>
          <div class="smart-card-meta">${tracks.length.toLocaleString()} likes</div>
        </button>
      `).join('')}
    </div>
  `;
  content.querySelectorAll('.smart-card').forEach(el => {
    el.onclick = () => promptCreate(`Likes ${el.dataset.decade}s`, groupByDecade().find(([d]) => d == el.dataset.decade)[1]);
  });
}

function renderRandomTab() {
  const content = document.getElementById('smart-content');
  const validTracks = likes.filter(i => i.track?.uri).length;
  content.innerHTML = `
    <div style="margin-bottom:16px;color:var(--color-text-secondary);font-size:14px">
      ${validTracks.toLocaleString()} likes disponibles para mezcla random.
    </div>
    <div class="card" style="max-width:420px">
      <label style="display:block;margin-bottom:8px;font-weight:500">Cantidad de tracks</label>
      <input type="number" id="smart-random-n" value="100" min="1" max="${validTracks}"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:16px;margin-bottom:8px">
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        ${[50, 100, 250, 500, 1000].filter(n => n <= validTracks).map(n => `
          <button class="btn btn-secondary btn-sm smart-random-preset" data-n="${n}">${n}</button>
        `).join('')}
      </div>
      <button class="btn btn-primary" id="smart-random-btn" style="width:100%">Crear playlist random</button>
    </div>
  `;

  content.querySelectorAll('.smart-random-preset').forEach(b => {
    b.onclick = () => { document.getElementById('smart-random-n').value = b.dataset.n; };
  });

  document.getElementById('smart-random-btn').onclick = async () => {
    const n = parseInt(document.getElementById('smart-random-n').value);
    if (!n || n < 1) {
      showToast('Cantidad inválida', 'error');
      return;
    }
    if (n > validTracks) {
      showToast(`Máximo ${validTracks}`, 'error');
      return;
    }
    const pool = likes.filter(i => i.track?.uri).map(i => i.track);
    shuffle(pool);
    const picked = pool.slice(0, n);
    await promptCreate(`Random ${n} likes`, picked);
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function promptCreate(baseName, tracks) {
  if (!tracks || tracks.length === 0) {
    showToast('No hay tracks para agregar', 'error');
    return;
  }
  const uris = tracks.map(t => t.uri).filter(Boolean);
  const suggested = await pickUniqueName(baseName);
  const finalName = await promptPlaylistName(suggested, { trackCount: uris.length });
  if (!finalName) return;

  try {
    showProgress(`Creando "${finalName}"...`, 0, uris.length);
    const playlist = await createPlaylist(finalName, `Generado por spotify-tools`, false);
    showProgress(`Agregando tracks...`, 0, uris.length);
    await addTracksToPlaylist(playlist.id, uris);
    invalidatePlaylistsCache();
    hideProgress();
    showToast(`Playlist "${finalName}" creada con ${uris.length} tracks`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}

async function pickUniqueName(baseName) {
  try {
    const existing = await getAllUserPlaylists();
    const names = new Set(existing.map(p => p.name));
    if (!names.has(baseName)) return baseName;
    for (let i = 2; i < 100; i++) {
      const candidate = `${baseName} (${i})`;
      if (!names.has(candidate)) return candidate;
    }
    return `${baseName} (${Date.now()})`;
  } catch {
    return baseName;
  }
}
