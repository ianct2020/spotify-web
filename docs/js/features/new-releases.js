// #new-releases · "Novedades de tus artistas"
//
// Complemento de #discover-artists. Mientras "Sin escuchar" muestra la
// discografía histórica sin oír, esta vista muestra LANZAMIENTOS RECIENTES
// de los artistas donde el usuario tiene un umbral de likes. Ordena por
// fecha de release, lo más nuevo arriba. Cruza con el índice unificado
// de escuchados para no repetir nada.
//
// Chips:
//   - Umbral de likes: 5+ / 10+ / 20+
//   - Ventana temporal: 3 / 6 / 12 / 24 meses (default 12)

import { escapeHtml, pageHeader } from '../ui/components.js?v=129';
import { showToast } from '../ui/toast.js?v=129';
import { openArtistCard } from './artist-card.js?v=129';
import { openAlbumCard } from './album-card.js?v=129';
import { buildAlbumHeardIndex, markAlbumHeard } from '../util/album-heard.js?v=129';
import {
  getArtistIdCached,
  getArtistDiscoCached,
  dedupDisco,
  albumIsUnheard,
  yearOf,
  releaseTs,
  createDiscoverPlaylist,
  saveAlbumTracksToLibrary,
  loadScanCache,
  saveScanCache,
  clearScanCache,
  agoLabel,
} from './discover-common.js?v=129';

const SCAN_KEY = 'new_releases';

const LS_MIN_LIKES = 'newrel_min_likes';   // 5 / 10 / 20
const LS_MONTHS = 'newrel_months';         // 3 / 6 / 12 / 24
const LS_LOADED_MORE = 'newrel_loaded_more';
// 2 y no 3: la discografía sale de /search y con 3 en paralelo Spotify tira
// 429 en cadena (ver api.js getArtistAlbums).
const BATCH_PARALLEL = 2;
const RATE_RETRIES = 2;
const DEFAULT_INITIAL = 100;

const VALID_LIKES = new Set([5, 10, 20]);
const VALID_MONTHS = new Set([3, 6, 12, 24]);

function getMinLikes() {
  const n = parseInt(localStorage.getItem(LS_MIN_LIKES) || '10', 10);
  return VALID_LIKES.has(n) ? n : 10;
}
function getMonths() {
  const n = parseInt(localStorage.getItem(LS_MONTHS) || '12', 10);
  return VALID_MONTHS.has(n) ? n : 12;
}
function getLoadedMore() {
  const n = parseInt(localStorage.getItem(LS_LOADED_MORE) || String(DEFAULT_INITIAL), 10);
  return Number.isFinite(n) && n >= 5 ? n : DEFAULT_INITIAL;
}

const state = {
  artists: [],
  heard: null,
  selection: new Set(),
  minLikes: 10,
  months: 12,
  loadedMore: DEFAULT_INITIAL,
  scannedAt: null,
};

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Novedades de tus artistas' })}
    <div id="newrel-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:14px">Cargando tus likes…</div></div></div>
  `;
  const content = document.getElementById('newrel-content');

  let idx;
  try {
    idx = await buildAlbumHeardIndex();
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">No pude cargar tus datos: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  state.heard = idx.heard;

  state.minLikes = getMinLikes();
  state.months = getMonths();
  state.loadedMore = getLoadedMore();

  const candidates = [...idx.likesByArtist.entries()]
    .map(([nameLower, ids]) => ({
      nameLower,
      name: idx.artistDisplay.get(nameLower) || nameLower,
      likes: ids.size,
      seedId: idx.artistIds.get(nameLower) || null,
      image: idx.artistImage.get(nameLower) || null,
    }))
    .sort((a, b) => b.likes - a.likes);

  state.artists = candidates.map(c => ({
    id: null,
    name: c.name,
    nameLower: c.nameLower,
    likes: c.likes,
    seedId: c.seedId,
    image: c.image,
    disco: [],
    scanned: false,
    error: null,
  }));

  state.scannedAt = null;
  const cached = await loadScanCache(SCAN_KEY);
  if (cached) {
    const byName = new Map(cached.artists.map(a => [a.nameLower, a]));
    let restored = 0;
    for (const a of state.artists) {
      const c = byName.get(a.nameLower);
      if (!c) continue;
      Object.assign(a, { id: c.id, disco: c.disco || [], scanned: true, error: null });
      restored++;
    }
    if (restored) state.scannedAt = cached.ts || null;
    console.log(`[newrel] cache de escaneo: ${restored} artistas restaurados (${agoLabel(cached.ts)})`);
  }

  renderShell(content, candidates.length);
  refreshList(content);
  scanArtists(content).catch(err => console.warn('[newrel] scan:', err));
}

function eligibleArtists() {
  return state.artists.filter(a => a.likes >= state.minLikes);
}

function targetToScan() {
  return Math.min(state.loadedMore, eligibleArtists().length);
}

function renderShell(content, totalCandidates) {
  content.innerHTML = `
    <div class="disco-topbar">
      <div class="disco-summary">
        <span id="newrel-count">0</span>/<span id="newrel-total-scan">${targetToScan()}</span> artistas escaneados
        · <span id="newrel-unheard-count">0</span> novedades sin escuchar
        <span class="disco-summary-sub" id="newrel-summary-sub">${eligibleArtists().length.toLocaleString('es-ES')} artistas con ≥${state.minLikes} likes</span>
      </div>
      <div class="disco-controls">
        <div class="disco-chip-group" id="newrel-likes">
          ${[5,10,20].map(n => `<button class="disco-chip ${state.minLikes === n ? 'is-on' : ''}" data-min="${n}">${n}+ likes</button>`).join('')}
        </div>
        <div class="disco-chip-group" id="newrel-months">
          ${[3,6,12,24].map(n => `<button class="disco-chip ${state.months === n ? 'is-on' : ''}" data-months="${n}">últimos ${n}m</button>`).join('')}
        </div>
        <button class="btn btn-secondary btn-sm" id="newrel-refresh" title="${state.scannedAt ? 'Último escaneo ' + agoLabel(state.scannedAt) + '. Volver a consultar Spotify.' : 'Volver a consultar Spotify'}">Actualizar</button>
      </div>
    </div>
    <div class="disco-progress" id="newrel-progress" style="display:none">
      <div class="disco-progress-bar"><div class="disco-progress-fill" id="newrel-progress-fill" style="width:0%"></div></div>
      <div class="disco-progress-label" id="newrel-progress-label"></div>
    </div>
    <div class="disco-list newrel-list" id="newrel-list"></div>
    <div class="disco-load-more" style="text-align:center;margin:20px 0">
      <button class="btn btn-secondary" id="newrel-load-more">Cargar más artistas (+50)</button>
    </div>
    <div class="disco-actionbar" id="newrel-actionbar" style="display:none">
      <span id="newrel-sel-count">0 seleccionados</span>
      <button class="btn btn-secondary btn-sm" id="newrel-sel-clear">Vaciar</button>
      <button class="btn btn-primary" id="newrel-sel-playlist">Crear playlist con lo seleccionado</button>
    </div>
  `;

  content.querySelector('#newrel-likes').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-min]');
    if (!btn) return;
    const n = parseInt(btn.dataset.min, 10);
    if (!VALID_LIKES.has(n)) return;
    state.minLikes = n;
    localStorage.setItem(LS_MIN_LIKES, String(n));
    content.querySelectorAll('#newrel-likes [data-min]').forEach(b => b.classList.toggle('is-on', b === btn));
    // Al cambiar el umbral se puede haber vaciado la cola — reprobamos + actualizo sub.
    document.getElementById('newrel-total-scan').textContent = targetToScan();
    const sub = document.getElementById('newrel-summary-sub');
    if (sub) sub.textContent = `${eligibleArtists().length.toLocaleString('es-ES')} artistas con ≥${state.minLikes} likes`;
    scanArtists(content).catch(err => console.warn('[newrel] scan:', err));
    refreshList(content);
  });
  content.querySelector('#newrel-months').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-months]');
    if (!btn) return;
    const n = parseInt(btn.dataset.months, 10);
    if (!VALID_MONTHS.has(n)) return;
    state.months = n;
    localStorage.setItem(LS_MONTHS, String(n));
    content.querySelectorAll('#newrel-months [data-months]').forEach(b => b.classList.toggle('is-on', b === btn));
    refreshList(content);
  });
  content.querySelector('#newrel-load-more').addEventListener('click', () => {
    state.loadedMore = Math.min(state.loadedMore + 50, eligibleArtists().length);
    localStorage.setItem(LS_LOADED_MORE, String(state.loadedMore));
    document.getElementById('newrel-total-scan').textContent = targetToScan();
    scanArtists(content).catch(err => console.warn('[newrel] scan:', err));
  });
  content.querySelector('#newrel-refresh').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Actualizando…';
    await clearScanCache(SCAN_KEY, state.artists.map(a => a.id).filter(Boolean));
    for (const a of state.artists) {
      Object.assign(a, { disco: [], scanned: false, error: null });
    }
    state.scannedAt = null;
    document.getElementById('newrel-count').textContent = '0';
    refreshList(content);
    try { await scanArtists(content); } catch (err) { console.warn('[newrel] scan:', err); }
    btn.disabled = false;
    btn.textContent = 'Actualizar';
  };
  content.querySelector('#newrel-sel-clear').onclick = () => {
    state.selection.clear();
    updateSelectionUi(content);
    refreshList(content);
  };
  content.querySelector('#newrel-sel-playlist').onclick = () => onCreatePlaylist(content);
}

async function scanArtists(content) {
  const progress = document.getElementById('newrel-progress');
  const progressLabel = document.getElementById('newrel-progress-label');
  const progressFill = document.getElementById('newrel-progress-fill');

  const eligible = eligibleArtists();
  const target = Math.min(state.loadedMore, eligible.length);
  const queue = eligible.filter(a => !a.scanned).slice(0, target);
  let scanned = eligible.filter(a => a.scanned).length;
  document.getElementById('newrel-count').textContent = scanned;
  if (!queue.length) return;   // todo servido del cache
  progress.style.display = '';

  const workers = Array.from({ length: BATCH_PARALLEL }, () => (async () => {
    while (queue.length) {
      const artist = queue.shift();
      if (!artist) break;
      let requeued = false;
      try {
        await processArtist(artist);
        artist.error = null;
      } catch (e) {
        const rateLimited = e.status === 429 || /rate limit/i.test(e.message);
        if (rateLimited && (artist.retries || 0) < RATE_RETRIES) {
          artist.retries = (artist.retries || 0) + 1;
          artist.scanned = false;
          queue.push(artist);
          requeued = true;
          console.warn(`[newrel] "${artist.name}": rate limit, reintento ${artist.retries}/${RATE_RETRIES}`);
        } else {
          artist.error = e.message;
          console.warn(`[newrel] "${artist.name}":`, e.message);
        }
      } finally {
        if (!requeued) {
          scanned++;
          progressLabel.textContent = `${artist.name} (${scanned}/${target})`;
          progressFill.style.width = `${Math.min(100, (scanned / target) * 100)}%`;
          document.getElementById('newrel-count').textContent = scanned;
        }
        refreshList(content);
      }
    }
  })());
  await Promise.all(workers);
  progress.style.display = 'none';

  const done = state.artists.filter(a => a.scanned && !a.error);
  if (done.length) {
    await saveScanCache(SCAN_KEY, done.map(a => ({ nameLower: a.nameLower, id: a.id, disco: a.disco })));
    state.scannedAt = Date.now();
  }
}

async function processArtist(artist) {
  if (artist.scanned) return;
  const id = await getArtistIdCached(artist.nameLower, artist.name, artist.seedId);
  if (!id) { artist.scanned = true; artist.error = 'no encontrado en Spotify'; return; }
  artist.id = id;
  const disco = await getArtistDiscoCached(id, artist.name);
  artist.disco = dedupDisco(disco);
  artist.scanned = true;
}

function releasesInWindow() {
  const cutoff = Date.now() - state.months * 30 * 24 * 60 * 60 * 1000;
  const out = [];
  for (const a of state.artists) {
    if (!a.scanned || a.error) continue;
    if (a.likes < state.minLikes) continue;
    for (const al of a.disco) {
      const ts = releaseTs(al.release);
      if (!ts || ts < cutoff) continue;
      if (!albumIsUnheard(al, a.name, state.heard)) continue;
      out.push({ al, artist: a });
    }
  }
  // Más nuevo primero. Empate → alfabético por artista.
  out.sort((x, y) => {
    const dt = releaseTs(y.al.release) - releaseTs(x.al.release);
    if (dt !== 0) return dt;
    return x.artist.name.localeCompare(y.artist.name, 'es');
  });
  return out;
}

function refreshList(content) {
  const list = document.getElementById('newrel-list');
  if (!list) return;
  const rows = releasesInWindow();
  document.getElementById('newrel-unheard-count').textContent = rows.length.toLocaleString('es-ES');

  if (!rows.length) {
    list.innerHTML = `<div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">No hay novedades sin escuchar en los últimos ${state.months} meses para tus artistas con ≥${state.minLikes} likes.</p></div>`;
    return;
  }

  list.innerHTML = `<div class="newrel-grid">${rows.map(r => renderRelease(r.al, r.artist.name)).join('')}</div>`;

  list.querySelectorAll('[data-open-artist]').forEach(btn => {
    btn.onclick = () => openArtistCard({ name: btn.dataset.openArtist });
  });
  list.querySelectorAll('[data-open-album]').forEach(btn => {
    btn.onclick = () => {
      const al = findAlbum(btn.dataset.openAlbum);
      if (!al) return;
      openAlbumCard({ name: al.name, artist: btn.dataset.openArtist2, img: al.img, plays: 0, min: 0, albumId: al.id, totalTracks: al.total });
    };
  });
  list.querySelectorAll('[data-save-album]').forEach(btn => {
    btn.onclick = () => saveAlbum(btn.dataset.saveAlbum, btn.dataset.saveArtist, btn);
  });
  list.querySelectorAll('.newrel-check').forEach(cb => {
    cb.checked = state.selection.has(cb.dataset.id);
    cb.onchange = () => {
      if (cb.checked) state.selection.add(cb.dataset.id);
      else state.selection.delete(cb.dataset.id);
      updateSelectionUi(content);
    };
  });

  updateSelectionUi(content);
}

function findAlbum(albumId) {
  for (const a of state.artists) {
    const found = a.disco?.find(al => al.id === albumId);
    if (found) return found;
  }
  return null;
}

function fmtRelease(release) {
  const s = release || '';
  if (s.length >= 10) return s.slice(0, 10);
  if (s.length >= 7) return s + '-01';
  const y = yearOf(s);
  return y ? String(y) : '—';
}

function renderRelease(al, artistName) {
  const typeLabel = al.type === 'single' ? 'single' : 'álbum';
  return `
    <div class="disco-album newrel-album" data-id="${al.id}">
      <label class="disco-album-check-wrap">
        <input type="checkbox" class="newrel-check" data-id="${escapeHtml(al.id)}">
      </label>
      <button type="button" class="disco-album-body" data-open-album="${escapeHtml(al.id)}" data-open-artist2="${escapeHtml(artistName)}">
        ${al.img
          ? `<img src="${al.img}" alt="" loading="lazy" class="disco-album-img">`
          : `<div class="disco-album-img disco-album-img-empty">♪</div>`}
        <div class="disco-album-info">
          <div class="disco-album-name">${escapeHtml(al.name)}</div>
          <div class="newrel-artist-line"><button class="newrel-artist-btn" data-open-artist="${escapeHtml(artistName)}">${escapeHtml(artistName)}</button></div>
          <div class="disco-album-meta">${fmtRelease(al.release)} · ${typeLabel}${al.total ? ` · ${al.total} pistas` : ''}</div>
        </div>
      </button>
      <button class="btn btn-secondary btn-sm disco-save-btn" data-save-album="${escapeHtml(al.id)}" data-save-artist="${escapeHtml(artistName)}" title="Guardar todas las pistas en tu biblioteca">+ Biblioteca</button>
    </div>
  `;
}

function updateSelectionUi(content) {
  const bar = content.querySelector('#newrel-actionbar');
  const count = content.querySelector('#newrel-sel-count');
  if (state.selection.size > 0) {
    bar.style.display = '';
    count.textContent = `${state.selection.size} seleccionado${state.selection.size === 1 ? '' : 's'}`;
  } else {
    bar.style.display = 'none';
  }
}

async function saveAlbum(albumId, artistName, btn) {
  const al = findAlbum(albumId);
  if (!al) return;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const ids = await saveAlbumTracksToLibrary(albumId);
    btn.textContent = `✓ ${ids.length} en likes`;
    showToast(`${ids.length} pistas de "${al.name}" añadidas a tus me gusta`, 'success');
    markAlbumHeard(al.name, artistName);
    setTimeout(() => {
      const content = document.getElementById('newrel-content');
      if (content) refreshList(content);
    }, 800);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = origText;
    showToast('Error al añadir: ' + e.message, 'error');
  }
}

async function onCreatePlaylist(content) {
  const ids = [...state.selection];
  if (!ids.length) return;
  const btn = content.querySelector('#newrel-sel-playlist');
  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    const { name, tracks } = await createDiscoverPlaylist(ids, findAlbum, { label: 'Novedades' });
    showToast(`Playlist "${name}" creada con ${tracks} pistas`, 'success');
    state.selection.clear();
    updateSelectionUi(content);
    refreshList(content);
  } catch (e) {
    showToast('Error creando playlist: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear playlist con lo seleccionado';
  }
}
