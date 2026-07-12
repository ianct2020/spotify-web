import { getAllLikedTracks, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache } from '../api.js';
import { hasKey, setKey, getArtistTopTags, getCachedTags, setCachedTags, mergeCachedTags, exportTagsCache, importTagsCache } from '../api/lastfm.js';
import * as statsfm from '../api/statsfm.js';
import { showProgress, hideProgress, typeConfirmModal, escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

const NOISE_TAGS = new Set([
  'seen live', 'favorites', 'favorite', 'favourite', 'favourites',
  'awesome', 'love', 'love it', 'best', 'good', 'amazing',
  'usa', 'american', 'british', 'uk', 'canadian', 'australian',
  'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist',
  'my music', 'my favourite', 'mymusic', 'my favorites',
  'my favourite artists', 'spotify',
  'racism', 'racist', 'woman beater', 'wife beater', 'misogyny',
  'misogynistic', 'sexist', 'sexism', 'homophobic', 'homophobia',
  'nazi', 'fascist', 'edgy', 'problematic',
  'overrated', 'underrated', 'guilty pleasure',
  'cool', 'chill', 'vibes', 'mood', 'nostalgia', 'nostalgic',
  'legend', 'legends', 'goat', 'king', 'queen',
]);

const TOP_TAGS_PER_ARTIST = 5;
const MIN_TRACKS_PER_GENRE = 5;

let likes = [];
let artistToTags = new Map();
let genreMap = new Map();
let selectedTags = new Set();

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Clasificar por género</h1>
      <p>Agrupa tus likes por género usando los tags de Last.fm. Después podés crear una playlist para cada uno.</p>
    </div>
    <div id="genre-content"></div>
  `;

  if (!hasKey()) {
    renderKeySetup();
    return;
  }
  start();
}

function renderKeySetup() {
  const content = document.getElementById('genre-content');
  content.innerHTML = `
    <div class="card" style="max-width:480px">
      <h3 style="margin-bottom:8px">Configurá tu Last.fm API key</h3>
      <input type="text" id="lastfm-key-input" placeholder="API key"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-family:monospace;font-size:14px;margin-bottom:12px">
      <button class="btn btn-primary" id="lastfm-key-save" style="width:100%">Guardar</button>
    </div>
  `;
  document.getElementById('lastfm-key-save').onclick = () => {
    const val = document.getElementById('lastfm-key-input').value.trim();
    if (val.length < 20) { showToast('Key inválida', 'error'); return; }
    setKey(val);
    start();
  };
}

async function start() {
  const content = document.getElementById('genre-content');
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando Liked Songs...</div></div>`;

  try {
    likes = await getAllLikedTracks(({ loaded, total }) => showProgress('Cargando likes...', loaded, total));
    hideProgress();

    const artistNames = extractUniqueArtists(likes);
    const uncached = artistNames.filter(a => !getCachedTags(a));

    const cachedCount = artistNames.length - uncached.length;
    content.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:14px;margin-bottom:4px">${likes.length.toLocaleString()} likes · ${artistNames.length} artistas únicos</div>
            <div style="font-size:12px;color:var(--color-text-secondary)">${cachedCount.toLocaleString()} ya cacheados · ${uncached.length.toLocaleString()} por analizar</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${uncached.length > 0 ? `<button class="btn btn-primary" id="genre-fetch-btn">Analizar ${uncached.length}</button>` : ''}
            <button class="btn btn-secondary" id="genre-show-btn">Ver géneros</button>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--color-border);flex-wrap:wrap;align-items:center">
          <button class="btn btn-secondary btn-sm" id="genre-export-btn" ${cachedCount === 0 ? 'disabled' : ''}>Exportar cache</button>
          <button class="btn btn-secondary btn-sm" id="genre-import-btn">Importar cache</button>
          <input type="file" id="genre-import-input" accept=".json,application/json" style="display:none">
          <button class="btn btn-secondary btn-sm" id="genre-statsfm-btn">${statsfm.hasUsername() ? 'Sync desde Stats.fm' : 'Conectar Stats.fm'}</button>
          <span style="font-size:11px;color:var(--color-text-secondary);align-self:center;margin-left:4px">
            Exportá el cache cada tanto. Stats.fm agrega géneros de Spotify sin gastar Last.fm.
          </span>
        </div>
      </div>
      <div id="genre-progress"></div>
      <div id="genre-results"></div>
    `;

    document.getElementById('genre-show-btn').onclick = showGenres;
    if (uncached.length > 0) {
      document.getElementById('genre-fetch-btn').onclick = () => fetchAllTags(uncached);
    }
    document.getElementById('genre-export-btn').onclick = handleExport;
    const importInput = document.getElementById('genre-import-input');
    document.getElementById('genre-import-btn').onclick = () => importInput.click();
    importInput.onchange = handleImport;
    document.getElementById('genre-statsfm-btn').onclick = handleStatsfm;

    if (uncached.length === 0) showGenres();
  } catch (e) {
    hideProgress();
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function handleExport() {
  const data = exportTagsCache();
  const count = Object.keys(data.entries).length;
  if (count === 0) {
    showToast('El cache está vacío', 'error');
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spotify-tools-genres-${today}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`Exportados ${count} artistas`, 'success');
}

async function handleStatsfm() {
  let username = statsfm.getUsername();
  if (!username) {
    username = await promptStatsfmUsername();
    if (!username) return;
  }

  const progressEl = document.getElementById('genre-progress');
  progressEl.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div id="statsfm-progress-text" style="font-size:14px">Consultando Stats.fm (${escapeHtml(username)})...</div>
    </div>
  `;
  const textEl = document.getElementById('statsfm-progress-text');

  try {
    const artists = await statsfm.getTopArtists(username, { range: 'lifetime', limit: 1000 });
    if (artists.length === 0) {
      textEl.innerHTML = '<span style="color:var(--color-warning)">Stats.fm no devolvió artistas. ¿El perfil es público?</span>';
      return;
    }

    textEl.textContent = `Mergeando ${artists.length} artistas con el cache local...`;

    let merged = 0;
    let skipped = 0;
    for (const a of artists) {
      const tags = a.genres.map(g => ({ name: g, count: 100 }));
      if (tags.length === 0) { skipped++; continue; }
      mergeCachedTags(a.name, tags);
      merged++;
    }

    textEl.innerHTML = `<strong>Sync listo</strong> — ${merged} artistas mergeados desde Stats.fm (${skipped} sin géneros). Recargando vista...`;
    showToast(`Stats.fm: ${merged} artistas agregados/mergeados`, 'success');
    setTimeout(() => start(), 800);
  } catch (e) {
    textEl.innerHTML = `<span style="color:var(--color-error)">Error: ${escapeHtml(e.message)}</span>`;
    showToast('Stats.fm falló: ' + e.message, 'error');
  }
}

function promptStatsfmUsername() {
  return new Promise(resolve => {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:480px">
        <h3 style="margin-bottom:8px">Conectar Stats.fm</h3>
        <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:12px">
          Ingresá tu username de Stats.fm (el slug de tu URL de perfil, ej: <code>i.an.iam</code> si tu perfil es <code>stats.fm/i.an.iam</code>). No hace falta API key.
        </p>
        <input type="text" id="statsfm-user-input" placeholder="username"
               style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-family:monospace;font-size:14px;margin-bottom:12px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-secondary" id="statsfm-cancel">Cancelar</button>
          <button class="btn btn-primary" id="statsfm-save">Guardar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const input = modal.querySelector('#statsfm-user-input');
    input.focus();

    const close = val => {
      document.body.removeChild(modal);
      resolve(val);
    };
    modal.querySelector('#statsfm-cancel').onclick = () => close(null);
    modal.querySelector('#statsfm-save').onclick = () => {
      const v = input.value.trim();
      if (v.length < 2) { showToast('Username inválido', 'error'); return; }
      statsfm.setUsername(v);
      close(v);
    };
    input.onkeydown = e => { if (e.key === 'Enter') modal.querySelector('#statsfm-save').click(); };
  });
}

async function handleImport(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const result = importTagsCache(parsed, { mode: 'merge' });
    showToast(`Importado: ${result.added} nuevos, ${result.updated} actualizados`, 'success');
    setTimeout(() => start(), 400);
  } catch (err) {
    showToast('Error importando: ' + err.message, 'error');
  }
}

function extractUniqueArtists(items) {
  const set = new Set();
  items.forEach(i => {
    const name = i.track?.artists?.[0]?.name;
    if (name) set.add(name);
  });
  return [...set];
}

async function fetchAllTags(artistNames) {
  const progressEl = document.getElementById('genre-progress');
  const btn = document.getElementById('genre-fetch-btn');
  if (btn) btn.disabled = true;

  progressEl.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div id="genre-progress-text" style="margin-bottom:8px;font-size:14px">Empezando...</div>
      <div style="height:8px;background:var(--color-elevated);border-radius:4px;overflow:hidden">
        <div id="genre-progress-bar" style="height:100%;background:var(--color-accent);width:0%;transition:width 0.2s"></div>
      </div>
    </div>
  `;
  const textEl = document.getElementById('genre-progress-text');
  const barEl = document.getElementById('genre-progress-bar');

  let done = 0;
  let errors = 0;
  const start = Date.now();

  for (const name of artistNames) {
    try {
      const tags = await getArtistTopTags(name);
      setCachedTags(name, tags);
    } catch (e) {
      errors++;
      setCachedTags(name, []);
    }
    done++;
    const pct = ((done / artistNames.length) * 100).toFixed(1);
    const elapsed = (Date.now() - start) / 1000;
    const rate = done / elapsed;
    const eta = rate > 0 ? Math.round((artistNames.length - done) / rate) : 0;
    textEl.textContent = `${done}/${artistNames.length} artistas · ${errors} errores · ETA ${formatTime(eta)}`;
    barEl.style.width = `${pct}%`;
    await sleep(200);
  }

  textEl.innerHTML = `<strong>Listo</strong> — ${done} artistas procesados, ${errors} errores.`;
  showGenres();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function buildGenreMap() {
  const map = new Map();
  artistToTags = new Map();

  likes.forEach(item => {
    const track = item.track;
    if (!track?.uri) return;
    const artistName = track.artists?.[0]?.name;
    if (!artistName) return;

    let tags = artistToTags.get(artistName);
    if (tags === undefined) {
      const cached = getCachedTags(artistName) || [];
      tags = cached
        .filter(t => !NOISE_TAGS.has(t.name))
        .slice(0, TOP_TAGS_PER_ARTIST)
        .map(t => t.name);
      artistToTags.set(artistName, tags);
    }

    tags.forEach(tag => {
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag).push(track);
    });
  });

  return map;
}

function showGenres() {
  genreMap = buildGenreMap();
  selectedTags = new Set();
  const results = document.getElementById('genre-results');

  const genres = [...genreMap.entries()]
    .filter(([, tracks]) => tracks.length >= MIN_TRACKS_PER_GENRE)
    .sort((a, b) => b[1].length - a[1].length);

  if (genres.length === 0) {
    results.innerHTML = `<div class="card"><p>No hay géneros con suficientes tracks (mín ${MIN_TRACKS_PER_GENRE}). Puede que necesites correr "Analizar" primero.</p></div>`;
    return;
  }

  results.innerHTML = `
    <div style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px">
      ${genres.length} géneros con ${MIN_TRACKS_PER_GENRE}+ tracks. Click para seleccionar uno o varios, después "Crear playlist".
    </div>
    <div class="smart-grid" style="padding-bottom:80px">
      ${genres.map(([tag, tracks]) => `
        <button class="smart-card genre-card" data-tag="${escapeHtml(tag)}">
          <div class="smart-card-title" style="font-size:15px;text-transform:capitalize">${escapeHtml(tag)}</div>
          <div class="smart-card-meta">${tracks.length.toLocaleString()} tracks</div>
        </button>
      `).join('')}
    </div>
    <div id="genre-action-bar"></div>
  `;

  results.querySelectorAll('.genre-card').forEach(el => {
    el.onclick = () => toggleTag(el);
  });
}

function toggleTag(el) {
  const tag = el.dataset.tag;
  if (selectedTags.has(tag)) {
    selectedTags.delete(tag);
    el.classList.remove('selected');
  } else {
    selectedTags.add(tag);
    el.classList.add('selected');
  }
  updateActionBar();
}

function updateActionBar() {
  const bar = document.getElementById('genre-action-bar');
  if (!bar) return;

  if (selectedTags.size === 0) {
    bar.innerHTML = '';
    return;
  }

  const uniqueUris = new Set();
  selectedTags.forEach(tag => {
    (genreMap.get(tag) || []).forEach(t => uniqueUris.add(t.uri));
  });

  const label = selectedTags.size === 1
    ? [...selectedTags][0]
    : `${selectedTags.size} géneros`;

  bar.innerHTML = `
    <div class="action-bar">
      <div class="action-bar-info">
        <strong>${escapeHtml(label)}</strong> — ${uniqueUris.size.toLocaleString()} tracks únicos
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" id="genre-clear-btn">Limpiar</button>
        <button class="btn btn-primary" id="genre-create-btn">Crear playlist</button>
      </div>
    </div>
  `;

  document.getElementById('genre-clear-btn').onclick = clearSelection;
  document.getElementById('genre-create-btn').onclick = createPlaylistForSelected;
}

function clearSelection() {
  selectedTags.clear();
  document.querySelectorAll('.genre-card.selected').forEach(el => el.classList.remove('selected'));
  updateActionBar();
}

async function createPlaylistForSelected() {
  const tags = [...selectedTags];
  if (tags.length === 0) return;

  const uniqueUris = new Set();
  tags.forEach(tag => {
    (genreMap.get(tag) || []).forEach(t => uniqueUris.add(t.uri));
  });
  const uris = [...uniqueUris];
  if (uris.length === 0) return;

  const capitalize = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const nameSuffix = tags.map(capitalize).join(' + ');
  const name = `Género: ${nameSuffix}`;

  const bodyMsg = tags.length === 1
    ? `Se va a crear <strong>"${escapeHtml(name)}"</strong> con <strong>${uris.length}</strong> tracks (likes cuyos artistas tienen "${escapeHtml(tags[0])}" entre sus top tags).`
    : `Se va a crear <strong>"${escapeHtml(name)}"</strong> con <strong>${uris.length}</strong> tracks (unión de likes cuyos artistas tienen alguno de: ${tags.map(t => `"${escapeHtml(t)}"`).join(', ')}).`;

  const confirmed = await typeConfirmModal('Crear playlist', bodyMsg, 'CREAR');
  if (!confirmed) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, 'Clasificado por Last.fm tags', false);
    showProgress('Agregando tracks...', 0, uris.length);
    await addTracksToPlaylist(playlist.id, uris);
    invalidatePlaylistsCache();
    hideProgress();
    showToast(`"${name}" creada con ${uris.length} tracks`, 'success');
    clearSelection();
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
