import { getAllLikedTracks, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache } from '../api.js';
import { hasKey, setKey, getArtistTopTags, getCachedTags, setCachedTags } from '../api/lastfm.js';
import { showProgress, hideProgress, typeConfirmModal, escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

const NOISE_TAGS = new Set([
  'seen live', 'favorites', 'favorite', 'favourite', 'favourites',
  'awesome', 'love', 'love it', 'best', 'good', 'amazing',
  'usa', 'american', 'british', 'uk', 'canadian', 'australian',
  'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist',
  'my music', 'my favourite', 'mymusic', 'my favorites',
  'my favourite artists', 'spotify',
]);

const TOP_TAGS_PER_ARTIST = 5;
const MIN_TRACKS_PER_GENRE = 5;

let likes = [];
let artistToTags = new Map();
let genreMap = new Map();

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

    content.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <div style="font-size:14px;margin-bottom:4px">${likes.length.toLocaleString()} likes · ${artistNames.length} artistas únicos</div>
            <div style="font-size:12px;color:var(--color-text-secondary)">${(artistNames.length - uncached.length).toLocaleString()} ya cacheados · ${uncached.length.toLocaleString()} por analizar</div>
          </div>
          <div style="display:flex;gap:8px">
            ${uncached.length > 0 ? `<button class="btn btn-primary" id="genre-fetch-btn">Analizar ${uncached.length}</button>` : ''}
            <button class="btn btn-secondary" id="genre-show-btn">Ver géneros</button>
          </div>
        </div>
      </div>
      <div id="genre-progress"></div>
      <div id="genre-results"></div>
    `;

    document.getElementById('genre-show-btn').onclick = showGenres;
    if (uncached.length > 0) {
      document.getElementById('genre-fetch-btn').onclick = () => fetchAllTags(uncached);
    }

    if (uncached.length === 0) showGenres();
  } catch (e) {
    hideProgress();
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
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
      ${genres.length} géneros con ${MIN_TRACKS_PER_GENRE}+ tracks. Click en uno para crear playlist.
    </div>
    <div class="smart-grid">
      ${genres.map(([tag, tracks]) => `
        <button class="smart-card genre-card" data-tag="${escapeHtml(tag)}">
          <div class="smart-card-title" style="font-size:15px;text-transform:capitalize">${escapeHtml(tag)}</div>
          <div class="smart-card-meta">${tracks.length.toLocaleString()} tracks</div>
        </button>
      `).join('')}
    </div>
  `;

  results.querySelectorAll('.genre-card').forEach(el => {
    el.onclick = () => createPlaylistForGenre(el.dataset.tag);
  });
}

async function createPlaylistForGenre(tag) {
  const tracks = genreMap.get(tag) || [];
  const uris = [...new Set(tracks.map(t => t.uri))];
  if (uris.length === 0) return;

  const capitalized = tag.replace(/\b\w/g, c => c.toUpperCase());
  const name = `Género: ${capitalized}`;

  const confirmed = await typeConfirmModal(
    'Crear playlist',
    `Se va a crear <strong>"${escapeHtml(name)}"</strong> con <strong>${uris.length}</strong> tracks (likes cuyos artistas tienen "${escapeHtml(tag)}" entre sus top tags).`,
    'CREAR'
  );
  if (!confirmed) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, `Clasificado por Last.fm tags`, false);
    showProgress('Agregando tracks...', 0, uris.length);
    await addTracksToPlaylist(playlist.id, uris);
    invalidatePlaylistsCache();
    hideProgress();
    showToast(`"${name}" creada con ${uris.length} tracks`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
