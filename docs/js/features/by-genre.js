import { getAllLikedTracks, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache, exportAllData, importAllData, getCurrentUserId, getBestAvailableLikes } from '../api.js?v=52';
import { hasKey, setKey, getArtistTopTags, getCachedTags, setCachedTags, mergeCachedTags } from '../api/lastfm.js?v=52';
import * as statsfm from '../api/statsfm.js?v=52';
import { getGenresForArtist as mbGetGenres } from '../api/musicbrainz.js?v=52';
import { showProgress, hideProgress, promptPlaylistName, alertModal, escapeHtml } from '../ui/components.js?v=52';
import { showToast } from '../ui/toast.js?v=52';
import { tagToGroup } from './genre-groups.js?v=52';

const NOISE_TAGS = new Set([
  'seen live', 'favorites', 'favorite', 'favourite', 'favourites',
  'awesome', 'love', 'love it', 'best', 'good', 'amazing', 'good music',
  'usa', 'american', 'british', 'uk', 'canadian', 'australian',
  'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist',
  'my music', 'my favourite', 'mymusic', 'my favorites',
  'my favourite artists', 'spotify', 'my top songs', 'x factor',
  'racism', 'racist', 'woman beater', 'wife beater', 'misogyny',
  'misogynistic', 'sexist', 'sexism', 'homophobic', 'homophobia',
  'nazi', 'fascist', 'edgy', 'problematic',
  'overrated', 'underrated', 'guilty pleasure',
  'cool', 'chill', 'vibes', 'mood', 'nostalgia', 'nostalgic',
  'legend', 'legends', 'goat', 'king', 'queen',
  'catchy', 'smooth', 'dreamy', 'mellow', 'romantic', 'sexy', 'sweet',
  'ass', 'scat', 'swag', 'peak', 'hard', 'burger', 'sleazepop',
  'live', 'cover', 'covers', 'to tag', 'love at first listen',
  'under 500 listeners', 'disney', 'boyband', 'boybands', 'girl groups',
  'rutracker', 'us',
  'biracial', 'white rapper', 'white boi', 'bald', 'pelado', 'calvo',
  'boliche', 'previa', 'fiesta', 'joda', 'que paso tan asustado',
  'rich parents', 'chetocore', 'palermo', 'palermitano', 'rally house',
  'oway', 'peak', '4et', 'six20', 'stepteam', 'troop', 'bald', 'ovo',
  'ysl', 'ofwgkta', 'homixide gang', 'rip gang', 'steezemusik',
  'kanye west', 'travis scott', 'chris brown', 'ariana grande',
  'one direction', '5 seconds of summer', 'jason derulo', 'demi lovato',
  'kid rock', 'young thug', 'quavo', 'leo larregui', 'lil yachty',
  'mf doom', 'lucki', 'whitney houston', 'jay-z', 'rihanna',
  'justin bieber', 'the intruders', 'mint condition', 'slowsilver03',
  'glo', 'pimmie',
  'argentina', 'canada', 'spain', 'puerto rico', 'atlanta', 'new york',
  'texas', 'chile', 'brazil', 'colombia', 'venezuela', 'uruguay',
  'mexico', 'los angeles', 'compton', 'philadelphia', 'california',
  'houston', 'chicago', 'detroit', 'arizona', 'north carolina',
  'new zealand', 'ohio', 'indiana', 'florida', 'georgia', 'virginia',
  'west coast', 'east coast', 'pittsburgh', 'new jersey', 'sweden',
  'swedish', 'japan', 'japanese', 'korea', 'korean', 'france', 'french',
  'germany', 'german', 'italy', 'italian', 'russia', 'russian',
  'india', 'indian', 'irish', 'scottish', 'polish', 'norwegian',
  'danish', 'icelandic', 'dutch', 'nigeria', 'nigerian', 'kenyan',
  'congolese', 'zimbabwe', 'mexican', 'jamaican', 'jamaica', 'cuba',
  'cuban', 'puerto rican', 'united states', 'united kingdom', 'australia',
  'brazilian', 'latino', 'latin american', 'world', 'baltimore rap',
  'malianteo', 'los patos feos', 'neoperreo',
]);

const TOP_TAGS_PER_ARTIST = 5;
const MIN_TRACKS_PER_GENRE = 5;

let likes = [];
let artistToTags = new Map();
let genreMap = new Map();
let selectedTags = new Set();
let genreFilter = '';
let groupsMode = localStorage.getItem('genre_groups_mode') === '1';
const SORT_KEY = 'genre_sort_mode';
const VALID_SORTS = new Set(['count-desc', 'count-asc', 'name-asc']);
function getSortMode() {
  const v = localStorage.getItem(SORT_KEY);
  return VALID_SORTS.has(v) ? v : 'count-desc';
}
function setSortMode(v) {
  if (VALID_SORTS.has(v)) localStorage.setItem(SORT_KEY, v);
}

export function render(container) {
  likes = [];
  artistToTags = new Map();
  genreMap = new Map();
  selectedTags = new Set();

  container.innerHTML = `
    <div class="page-header">
      <h1>Clasificar por género</h1>
      <p>Agrupa tus likes por género usando tags de Last.fm y géneros de Stats.fm.</p>
    </div>
    <div id="genre-content"></div>
  `;

  if (!hasKey()) {
    renderKeySetup();
    return;
  }
  renderStartScreen();
}

async function renderStartScreen() {
  const content = document.getElementById('genre-content');
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Leyendo cache local...</div></div>`;

  const cachedTagsCount = Object.keys(JSON.parse(localStorage.getItem('lastfm_artist_tags_cache') || '{}')).length;
  const { items: cachedLikes } = await getBestAvailableLikes();
  const hasLikes = cachedLikes.length > 0;

  const intro = hasLikes
    ? `Tenés <strong>${cachedLikes.length.toLocaleString()}</strong> likes y <strong>${cachedTagsCount.toLocaleString()}</strong> artistas con tags cacheados. Ya podés ver tus géneros.`
    : `Tenés <strong>${cachedTagsCount.toLocaleString()}</strong> artistas con tags pero <strong>0 likes</strong> cacheados. Cargá los likes desde Spotify o importá un JSON previo que los tenga.`;

  const primaryLabel = hasLikes ? 'Ver mis géneros' : 'Cargar mis likes desde Spotify';

  content.innerHTML = `
    <div class="card" style="max-width:640px">
      <h3 style="margin-bottom:8px">¿Cómo querés arrancar?</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">${intro}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="genre-begin-btn">${primaryLabel}</button>
        <button class="btn btn-secondary" id="genre-preimport-btn">${hasLikes ? 'Importar otro JSON' : 'Importar cache primero'}</button>
        <input type="file" id="genre-preimport-input" accept=".json,application/json" style="display:none">
      </div>
    </div>
  `;

  document.getElementById('genre-begin-btn').onclick = start;
  const preInput = document.getElementById('genre-preimport-input');
  document.getElementById('genre-preimport-btn').onclick = () => preInput.click();
  preInput.onchange = async (e) => {
    const result = await handleImport(e, { skipRefresh: true, returnResult: true });
    if (result && result.likesImported > 0) {
      start();
    } else {
      renderStartScreen();
    }
  };
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
    renderStartScreen();
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
          <button class="btn btn-secondary btn-sm" id="genre-mb-btn" title="Consulta MusicBrainz para artistas sin género. Rate limit 1 req/seg — tarda ~1 min cada 60 artistas.">Enriquecer sin clasificar (MusicBrainz)</button>
          <span style="font-size:11px;color:var(--color-text-secondary);align-self:center;margin-left:4px">
            Exportá el cache cada tanto. Stats.fm agrega géneros de Spotify sin gastar Last.fm. MusicBrainz completa los que ni Last.fm ni Stats.fm reconocen.
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
    document.getElementById('genre-mb-btn').onclick = handleMusicBrainz;

    if (uncached.length === 0) showGenres();
  } catch (e) {
    hideProgress();
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

async function handleExport() {
  let userId = null;
  try { userId = await getCurrentUserId(); } catch {}
  const data = await exportAllData(userId);
  const likesCount = data.likes.items.length;
  const tagsCount = Object.keys(data.tags.entries).length;
  const source = data._likesSource;
  if (likesCount === 0 && tagsCount === 0) {
    showToast('No hay datos para exportar', 'error');
    return;
  }
  if (source === 'partial') {
    const ok = await alertModal(
      'La carga se cortó a mitad',
      `<p>Solo tenés <strong>${likesCount.toLocaleString()} likes cacheados</strong> (parcial). El JSON va a incluir solo esos.</p>
       <p>¿Exportar igual?</p>`,
      { variant: 'warning', confirmText: 'Exportar parcial', cancelText: 'Cancelar' }
    );
    if (!ok) return;
  }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const filename = userId ? `user-${userId}.json` : `spotify-tools-data-${today}.json`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const tag = source === 'partial' ? ' (parcial)' : '';
  showToast(`Exportado${tag}: ${likesCount.toLocaleString()} likes + ${tagsCount.toLocaleString()} artistas`, 'success');
}

async function handleMusicBrainz() {
  cachedUnclassified = computeUnclassified();
  const artistsToProcess = new Set();
  cachedUnclassified.forEach(t => {
    const a = t.artists?.[0]?.name;
    if (a) artistsToProcess.add(a);
  });
  const artistList = [...artistsToProcess];

  if (artistList.length === 0) {
    showToast('No hay artistas sin clasificar para consultar en MusicBrainz', 'info');
    return;
  }

  const etaMin = Math.ceil(artistList.length * 1.1 / 60);
  const ok = await alertModal(
    'Enriquecer con MusicBrainz',
    `<p>Se van a consultar <strong>${artistList.length}</strong> artistas sin género en MusicBrainz.</p>
     <p>Rate limit: <strong>1 request/seg</strong>. Tiempo estimado: <strong>~${etaMin} min</strong>.</p>
     <p>Podés cerrar esta pestaña — el proceso se corta solo. Los resultados se van guardando cada 10 artistas.</p>`,
    { variant: 'info', confirmText: 'Empezar', cancelText: 'Cancelar' }
  );
  if (!ok) return;

  const progressEl = document.getElementById('genre-progress');
  progressEl.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div id="mb-progress-text" style="margin-bottom:8px;font-size:14px">Empezando...</div>
      <div style="height:8px;background:var(--color-elevated);border-radius:4px;overflow:hidden">
        <div id="mb-progress-bar" style="height:100%;background:var(--color-accent);width:0%;transition:width 0.2s"></div>
      </div>
    </div>
  `;
  const textEl = document.getElementById('mb-progress-text');
  const barEl = document.getElementById('mb-progress-bar');

  let done = 0;
  let hits = 0;
  let notFound = 0;
  let errors = 0;
  const start = Date.now();

  for (const name of artistList) {
    try {
      const r = await mbGetGenres(name);
      if (r.notFound || r.tags.length === 0) {
        notFound++;
        setCachedTags(name, []);
      } else {
        hits++;
        mergeCachedTags(name, r.tags);
      }
    } catch (e) {
      errors++;
      console.warn('MB error', name, e.message);
    }
    done++;
    const pct = ((done / artistList.length) * 100).toFixed(1);
    const elapsed = (Date.now() - start) / 1000;
    const rate = done / elapsed;
    const eta = rate > 0 ? Math.round((artistList.length - done) / rate) : 0;
    textEl.textContent = `${done}/${artistList.length} · ${hits} hits · ${notFound} no encontrados · ${errors} errores · ETA ${formatTime(eta)}`;
    barEl.style.width = `${pct}%`;
  }

  textEl.innerHTML = `<strong>Listo</strong> — ${hits} artistas enriquecidos, ${notFound} sin match en MusicBrainz.`;
  showToast(`MusicBrainz: ${hits} artistas enriquecidos`, 'success');
  refreshHeaderAndGenres();
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

    textEl.innerHTML = `<strong>Sync listo</strong> — ${merged} artistas mergeados desde Stats.fm (${skipped} sin géneros).`;
    showToast(`Stats.fm: ${merged} artistas mergeados`, 'success');
    refreshHeaderAndGenres();
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

function inspectImportPayload(parsed) {
  const likesItems = parsed?.likes?.items;
  const oldFormatItems = parsed?._format === 'spotify-tools-likes' && Array.isArray(parsed?.items) ? parsed.items : null;
  const items = Array.isArray(likesItems) ? likesItems : oldFormatItems;
  const tagsEntries = parsed?.tags?.entries || (parsed?._format === 'spotify-tools-genres' ? parsed.entries : null);
  return {
    hasLikes: Array.isArray(items) && items.length > 0,
    likesCount: Array.isArray(items) ? items.length : 0,
    hasTags: !!tagsEntries && Object.keys(tagsEntries).length > 0,
    tagsCount: tagsEntries ? Object.keys(tagsEntries).length : 0,
  };
}

async function handleImport(e, { skipRefresh = false, returnResult = false } = {}) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return null;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const inspection = inspectImportPayload(parsed);
    if (!inspection.hasLikes && !inspection.hasTags) {
      showToast('El archivo no tiene ni likes ni tags reconocibles', 'error');
      return null;
    }
    if (!inspection.hasLikes && inspection.hasTags) {
      const ok = await alertModal(
        'Este archivo no tiene likes',
        `<p>El JSON trae <strong>0 tracks</strong> pero sí <strong>${inspection.tagsCount.toLocaleString()} artistas con tags</strong>.</p>
         <p>Los tags sirven para clasificar en Por género. Los likes vas a tener que cargarlos aparte desde el Dashboard.</p>`,
        { variant: 'warning', confirmText: 'Importar solo tags', cancelText: 'Cancelar' }
      );
      if (!ok) return null;
    }

    const result = await importAllData(parsed);
    const parts = [];
    if (result.likesImported > 0) parts.push(`${result.likesImported.toLocaleString()} likes`);
    if (result.tagsImported > 0) parts.push(`${result.tagsImported} artistas nuevos`);
    if (result.tagsUpdated > 0) parts.push(`${result.tagsUpdated} actualizados`);
    showToast(parts.length > 0 ? `Importado: ${parts.join(' · ')}` : 'Sin cambios', 'success');
    if (!skipRefresh) refreshHeaderAndGenres();
    return returnResult ? result : null;
  } catch (err) {
    showToast('Error importando: ' + err.message, 'error');
    return null;
  }
}

function refreshHeaderAndGenres() {
  if (likes.length === 0) return;
  const artistNames = extractUniqueArtists(likes);
  const uncached = artistNames.filter(a => !getCachedTags(a));
  const cachedCount = artistNames.length - uncached.length;

  const header = document.querySelector('#genre-content .card');
  if (header) {
    const statusLine = header.querySelector('div > div > div:nth-child(2)');
    if (statusLine) {
      statusLine.innerHTML = `${cachedCount.toLocaleString()} ya cacheados · ${uncached.length.toLocaleString()} por analizar`;
    }
    const fetchBtn = document.getElementById('genre-fetch-btn');
    if (fetchBtn) {
      if (uncached.length > 0) fetchBtn.textContent = `Analizar ${uncached.length}`;
      else fetchBtn.remove();
    }
    const exportBtn = document.getElementById('genre-export-btn');
    if (exportBtn) exportBtn.disabled = cachedCount === 0;
  }
  showGenres();
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
        .filter(t => !NOISE_TAGS.has(String(t.name).toLowerCase()))
        .slice(0, TOP_TAGS_PER_ARTIST)
        .map(t => t.name);
      artistToTags.set(artistName, tags);
    }

    const buckets = new Set();
    tags.forEach(tag => {
      let bucket = tag;
      if (groupsMode) {
        const grp = tagToGroup(tag);
        if (grp) bucket = grp;
      }
      if (buckets.has(bucket)) return;
      buckets.add(bucket);
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket).push(track);
    });
  });

  return map;
}

function sortGenres(entries) {
  const mode = getSortMode();
  const copy = [...entries];
  if (mode === 'count-asc') copy.sort((a, b) => a[1].length - b[1].length);
  else if (mode === 'name-asc') copy.sort((a, b) => a[0].localeCompare(b[0]));
  else copy.sort((a, b) => b[1].length - a[1].length);
  return copy;
}

let cachedUnclassified = [];

function showGenres() {
  genreMap = buildGenreMap();
  selectedTags = new Set();
  genreFilter = '';
  cachedUnclassified = computeUnclassified();
  const results = document.getElementById('genre-results');

  const allGenres = [...genreMap.entries()].filter(([, tracks]) => tracks.length >= MIN_TRACKS_PER_GENRE);

  if (allGenres.length === 0 && cachedUnclassified.length === 0) {
    results.innerHTML = `<div class="card"><p>No hay géneros con suficientes tracks (mín ${MIN_TRACKS_PER_GENRE}). Puede que necesites correr "Analizar" primero.</p></div>`;
    return;
  }

  const mode = getSortMode();
  results.innerHTML = `
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px;position:relative">
        <input type="text" id="genre-search-input" placeholder="Buscar género... (ej: rock, hip)"
               style="width:100%;padding:9px 34px 9px 12px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px">
        <button id="genre-search-clear" title="Limpiar"
                style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--color-text-muted);font-size:18px;cursor:pointer;padding:4px 8px;display:none">×</button>
      </div>
      <label class="pill-toggle ${groupsMode ? 'active' : ''}" title="Colapsa géneros parecidos (indie rock + rock argentino + classic rock → 'Rock')">
        <input type="checkbox" id="genre-groups-toggle" ${groupsMode ? 'checked' : ''}>
        <span class="pill-toggle-icon">${groupsMode ? '⚫' : '⚪'}</span>
        <span>Agrupar parecidos</span>
      </label>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <span style="font-size:12px;color:var(--color-text-muted);margin-right:4px">Ordenar por:</span>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'count-desc' ? 'sort-active' : ''}" data-sort="count-desc" title="Géneros con más canciones arriba">Más canciones</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'count-asc' ? 'sort-active' : ''}" data-sort="count-asc" title="Géneros con menos canciones arriba">Menos canciones</button>
        <button class="btn btn-secondary btn-sm sort-btn ${mode === 'name-asc' ? 'sort-active' : ''}" data-sort="name-asc" title="Alfabético">A-Z</button>
      </div>
    </div>
    <div id="genre-summary" style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px"></div>
    <div id="genre-grid-holder"></div>
    <div id="genre-action-bar"></div>
  `;

  const searchInput = document.getElementById('genre-search-input');
  const clearBtn = document.getElementById('genre-search-clear');
  searchInput.addEventListener('input', () => {
    genreFilter = searchInput.value.trim().toLowerCase();
    clearBtn.style.display = genreFilter ? 'block' : 'none';
    renderGrid();
  });
  clearBtn.onclick = () => {
    searchInput.value = '';
    genreFilter = '';
    clearBtn.style.display = 'none';
    renderGrid();
    searchInput.focus();
  };
  results.querySelectorAll('.sort-btn').forEach(btn => {
    btn.onclick = () => {
      setSortMode(btn.dataset.sort);
      results.querySelectorAll('.sort-btn').forEach(b => b.classList.toggle('sort-active', b === btn));
      renderGrid();
    };
  });

  const groupsToggle = document.getElementById('genre-groups-toggle');
  groupsToggle.onchange = (e) => {
    groupsMode = e.target.checked;
    localStorage.setItem('genre_groups_mode', groupsMode ? '1' : '0');
    selectedTags = new Set();
    showGenres();
  };

  renderGrid();
}

function renderGrid() {
  const holder = document.getElementById('genre-grid-holder');
  const summary = document.getElementById('genre-summary');
  if (!holder || !summary) return;

  const allGenres = [...genreMap.entries()].filter(([, tracks]) => tracks.length >= MIN_TRACKS_PER_GENRE);
  const filtered = genreFilter
    ? allGenres.filter(([tag]) => tag.toLowerCase().includes(genreFilter))
    : allGenres;
  const sorted = sortGenres(filtered);
  const showUnclassified = !genreFilter && cachedUnclassified.length > 0;

  const noun = groupsMode ? 'grupos' : 'géneros';
  if (genreFilter) {
    summary.textContent = `${sorted.length} de ${allGenres.length} ${noun} coinciden con "${genreFilter}"`;
  } else {
    summary.textContent = groupsMode
      ? `${allGenres.length} grupos + subgéneros sin agrupar (mín ${MIN_TRACKS_PER_GENRE} tracks). Un track cuenta 1 vez por grupo.`
      : `${allGenres.length} géneros con ${MIN_TRACKS_PER_GENRE}+ tracks. Click para seleccionar uno o varios, después "Crear playlist".`;
  }

  if (sorted.length === 0 && !showUnclassified) {
    holder.innerHTML = `<div class="card"><p>Ningún género coincide con "${escapeHtml(genreFilter)}".</p></div>`;
    return;
  }

  holder.innerHTML = `
    <div class="smart-grid" style="padding-bottom:80px">
      ${sorted.map(([tag, tracks]) => `
        <button class="smart-card genre-card ${selectedTags.has(tag) ? 'selected' : ''}" data-tag="${escapeHtml(tag)}">
          <div class="smart-card-title" style="font-size:15px;text-transform:capitalize">${escapeHtml(tag)}</div>
          <div class="smart-card-meta">${tracks.length.toLocaleString()} tracks</div>
        </button>
      `).join('')}
      ${showUnclassified ? `
        <button class="smart-card genre-card" id="unclassified-card" style="border-color:var(--color-warning);border-style:dashed">
          <div class="smart-card-title" style="font-size:15px;color:var(--color-warning)">Sin clasificar</div>
          <div class="smart-card-meta">${cachedUnclassified.length.toLocaleString()} tracks</div>
        </button>
      ` : ''}
    </div>
  `;

  holder.querySelectorAll('.genre-card:not(#unclassified-card)').forEach(el => {
    el.onclick = () => toggleTag(el);
  });
  const uncEl = document.getElementById('unclassified-card');
  if (uncEl) uncEl.onclick = () => createPlaylistForUnclassified(cachedUnclassified);
}

function computeUnclassified() {
  const uris = new Set();
  const classifiedUris = new Set();
  genreMap.forEach(tracks => tracks.forEach(t => classifiedUris.add(t.uri)));
  const result = [];
  likes.forEach(item => {
    const track = item.track;
    if (!track?.uri) return;
    if (classifiedUris.has(track.uri)) return;
    if (uris.has(track.uri)) return;
    uris.add(track.uri);
    result.push(track);
  });
  return result;
}

async function createPlaylistForUnclassified(tracks) {
  const uris = [...new Set(tracks.map(t => t.uri))];
  const suggested = `Sin clasificar (${uris.length})`;
  const name = await promptPlaylistName(suggested, {
    trackCount: uris.length,
    subtitle: 'Tracks cuyos artistas no aparecen en el cache de tags. Podés clasificarlos manual desde acá.',
  });
  if (!name) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, 'Tracks sin género detectado', false);
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
  const suggested = `Género: ${nameSuffix}`;

  const subtitle = tags.length === 1
    ? `Likes con "${tags[0]}" entre los top tags del artista.`
    : `Unión de likes cuyos artistas tienen alguno de: ${tags.join(', ')}.`;

  const name = await promptPlaylistName(suggested, {
    trackCount: uris.length,
    subtitle,
  });
  if (!name) return;

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
