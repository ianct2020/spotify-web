import { getAllLikedTracks, createPlaylist, addTracksToPlaylist, getAllUserPlaylists, invalidatePlaylistsCache } from '../api.js?v=159';
import { showProgress, hideProgress, progressController, isCancelled, promptPlaylistName, escapeHtml, pageHeader } from '../ui/components.js?v=159';
import { showToast } from '../ui/toast.js?v=159';
import { isZombieItem } from '../util/zombie.js?v=159';

// `likes` es SIEMPRE el pool ya limpio de zombis: todo lo que se agrupa por
// año, por década o se sortea sale de acá, así que ninguna de las tres pestañas
// puede escribir una pista que Spotify sacó del catálogo. `zombiesFuera` es
// solo para poder contárselo al usuario.
let likes = [];
let zombiesFuera = 0;
let currentTab = 'year';
let selectedYears = new Set();
let selectedDecades = new Set();

export function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Smart Playlists' })}

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
  const prog = progressController('Cargando Liked Songs...');
  try {
    const todos = await getAllLikedTracks(({ loaded, total }) => {
      prog.update(loaded, total);
    }, { signal: prog.signal });
    // Los zombis se sacan del pool ACÁ y no en promptCreate: si se filtraran
    // recién al escribir, los contadores de cada año/década y el máximo de la
    // pestaña Random prometerían pistas que después no entran en la playlist.
    likes = todos.filter(it => !isZombieItem(it));
    zombiesFuera = todos.length - likes.length;
    if (zombiesFuera) {
      console.info(`[smart] ${zombiesFuera} zombis fuera del pool (de ${todos.length} likes)`);
    }
    prog.done();
    renderTab();
  } catch (e) {
    hideProgress();
    const msg = isCancelled(e)
      ? 'Carga detenida. Lo que se bajó quedó guardado — entrá de nuevo para retomar.'
      : escapeHtml(e.message);
    document.getElementById('smart-content').innerHTML = `<div class="card"><p style="color:var(--color-${isCancelled(e) ? 'warning' : 'error'})">${msg}</p></div>`;
  }
}

// Coletilla para las tres pestañas: deja claro que el pool no es el total de
// likes cuando hay zombis, en vez de que los números bailen sin explicación.
function notaZombis() {
  if (!zombiesFuera) return '';
  return ` · <span style="color:var(--color-warning)">${zombiesFuera.toLocaleString()} zombi${zombiesFuera === 1 ? '' : 's'} fuera</span> (Spotify los sacó del catálogo)`;
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
  // Purgar selecciones que ya no existen en el dataset
  const validYears = new Set(groups.map(([y]) => y));
  for (const y of selectedYears) if (!validYears.has(y)) selectedYears.delete(y);

  content.innerHTML = `
    <div style="margin-bottom:12px;color:var(--color-text-secondary);font-size:14px">
      ${likes.length.toLocaleString()} likes analizados · ${groups.length} años distintos${notaZombis()}
    </div>
    <div class="smart-selectbar" id="smart-selectbar-year"></div>
    <div class="smart-grid">
      ${groups.map(([year, tracks]) => `
        <button class="smart-card${selectedYears.has(year) ? ' selected' : ''}" data-year="${year}">
          <div class="smart-card-title">${year}</div>
          <div class="smart-card-meta">${tracks.length.toLocaleString()} likes</div>
        </button>
      `).join('')}
    </div>
  `;
  content.querySelectorAll('.smart-card').forEach(el => {
    el.onclick = () => {
      const year = Number(el.dataset.year);
      if (selectedYears.has(year)) selectedYears.delete(year);
      else selectedYears.add(year);
      el.classList.toggle('selected');
      updateSelectBar('year', groups);
    };
  });
  updateSelectBar('year', groups);
}

function renderDecadeTab() {
  const groups = groupByDecade();
  const content = document.getElementById('smart-content');
  if (groups.length === 0) {
    content.innerHTML = `<div class="card"><p>No hay décadas disponibles.</p></div>`;
    return;
  }
  const validDecades = new Set(groups.map(([d]) => d));
  for (const d of selectedDecades) if (!validDecades.has(d)) selectedDecades.delete(d);

  content.innerHTML = `
    <div style="margin-bottom:12px;color:var(--color-text-secondary);font-size:14px">
      ${likes.length.toLocaleString()} likes analizados · ${groups.length} décadas${notaZombis()}
    </div>
    <div class="smart-selectbar" id="smart-selectbar-decade"></div>
    <div class="smart-grid">
      ${groups.map(([decade, tracks]) => `
        <button class="smart-card${selectedDecades.has(decade) ? ' selected' : ''}" data-decade="${decade}">
          <div class="smart-card-title">${decade}s</div>
          <div class="smart-card-meta">${tracks.length.toLocaleString()} likes</div>
        </button>
      `).join('')}
    </div>
  `;
  content.querySelectorAll('.smart-card').forEach(el => {
    el.onclick = () => {
      const decade = Number(el.dataset.decade);
      if (selectedDecades.has(decade)) selectedDecades.delete(decade);
      else selectedDecades.add(decade);
      el.classList.toggle('selected');
      updateSelectBar('decade', groups);
    };
  });
  updateSelectBar('decade', groups);
}

// Barra sticky arriba: cuenta lo seleccionado + botón crear + limpiar.
function updateSelectBar(kind, groups) {
  const bar = document.getElementById(`smart-selectbar-${kind}`);
  if (!bar) return;
  const selected = kind === 'year' ? selectedYears : selectedDecades;
  const label = kind === 'year' ? 'año' : 'década';
  const suffix = kind === 'year' ? '' : 's';

  let tracks = 0;
  const picked = [];
  for (const [key, arr] of groups) {
    if (!selected.has(key)) continue;
    tracks += arr.length;
    picked.push(key);
  }
  picked.sort((a, b) => a - b);

  if (selected.size === 0) {
    bar.innerHTML = `<div class="smart-selectbar-empty">Tocá uno o más ${label}${suffix} para armar una playlist.</div>`;
    return;
  }
  const listLabel = picked.map(p => `${p}${kind === 'decade' ? 's' : ''}`).join(' + ');
  bar.innerHTML = `
    <div class="smart-selectbar-info">
      <strong>${tracks.toLocaleString()}</strong> tracks · ${selected.size} ${label}${selected.size === 1 ? '' : (kind === 'year' ? 's' : '')} · <span style="color:var(--color-text-muted)">${escapeHtml(listLabel)}</span>
    </div>
    <div class="smart-selectbar-actions">
      <button class="btn btn-secondary btn-sm" id="smart-clear-sel">Limpiar</button>
      <button class="btn btn-primary btn-sm" id="smart-create-sel">Crear playlist</button>
    </div>
  `;
  bar.querySelector('#smart-clear-sel').onclick = () => {
    selected.clear();
    document.querySelectorAll('.smart-card.selected').forEach(el => el.classList.remove('selected'));
    updateSelectBar(kind, groups);
  };
  bar.querySelector('#smart-create-sel').onclick = () => {
    const tracksAll = [];
    for (const [key, arr] of groups) {
      if (!selected.has(key)) continue;
      for (const t of arr) tracksAll.push(t);
    }
    const name = `Random ${listLabel}`;
    promptCreate(name, tracksAll);
  };
}

function renderRandomTab() {
  const content = document.getElementById('smart-content');
  const validTracks = likes.filter(i => i.track?.uri).length;
  content.innerHTML = `
    <div style="margin-bottom:16px;color:var(--color-text-secondary);font-size:14px">
      ${validTracks.toLocaleString()} likes disponibles para mezcla random${notaZombis()}.
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
    showToast('No hay tracks para añadir', 'error');
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
