// #discover-artists · "Sin escuchar de tus artistas"
//
// Idea: para los artistas con más likes (5+), traer su discografía completa
// (álbumes + singles) desde Spotify y cruzarla con el índice unificado de
// álbumes escuchados (util/album-heard.js — historial completo + likes +
// listened + w-three). Aparece SOLO lo que nunca tocó de sus artistas.
//
// v=121: cruce corregido (antes usaba solo listened-albums.json que es un
// subset por umbral; ahora usa el historial completo v=3 de plays). Default
// 100 artistas en lugar de 20. Lógica de fetch/cache/playlist compartida en
// features/discover-common.js con #new-releases.

import { escapeHtml, pageHeader } from '../ui/components.js?v=139';
import { showToast } from '../ui/toast.js?v=139';
import { openArtistCard } from './artist-card.js?v=139';
import { isJunkTrack } from '../util/junk.js?v=139';
import { buildAlbumHeardIndex, markAlbumHeard } from '../util/album-heard.js?v=139';
import {
  getArtistIdCached,
  getArtistDiscoCached,
  dedupDisco,
  albumIsUnheard,
  yearOf,
  createDiscoverPlaylist,
  saveAlbumTracksToLibrary,
  loadScanCache,
  saveScanCache,
  clearScanCache,
  agoLabel,
  renderAlbumCard,
  wireAlbumCards,
  addAlbumsToPlaylists,
} from './discover-common.js?v=139';

const SCAN_KEY = 'discover_artists';

const LS_FILTER_KIND = 'discoverart_filter_kind';    // 'all' | 'album' | 'single'
const LS_FILTER_YEARS = 'discoverart_filter_years';  // 0 = todo, o número de años
const LS_LOADED_MORE = 'discoverart_loaded_more';    // cuántos artistas cargar (default 100)
const MIN_LIKES = 5;
// 2 y no 3: la discografía sale de /search (el endpoint nativo está muerto) y
// con 3 en paralelo Spotify tira 429 en cadena.
const BATCH_PARALLEL = 2;
const RATE_RETRIES = 2;   // reintentos por artista caído por rate limit
const DEFAULT_INITIAL = 100;

function getFilterKind() {
  const v = localStorage.getItem(LS_FILTER_KIND);
  return ['all','album','single'].includes(v) ? v : 'all';
}
function getFilterYears() {
  const n = parseInt(localStorage.getItem(LS_FILTER_YEARS) || '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function getLoadedMore() {
  // Piso duro en DEFAULT_INITIAL — si el localStorage viejo tenía 20/40, hoy arrancamos 100 igual.
  const n = parseInt(localStorage.getItem(LS_LOADED_MORE) || '0', 10);
  return Math.max(DEFAULT_INITIAL, Number.isFinite(n) ? n : 0);
}

const state = {
  artists: [],
  heard: null,           // Set<albumKey>
  likesByArtist: null,   // Map<nameLower, Set<trackId>>
  selection: new Set(),
  filterKind: 'all',
  filterYears: 0,
  loadedMore: DEFAULT_INITIAL,
  scannedAt: null,       // ts del escaneo cacheado que estamos mostrando
};

const YEAR_NOW = new Date().getFullYear();

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Sin escuchar de tus artistas' })}
    <div id="disco-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:14px">Cargando tus likes…</div></div></div>
  `;
  const content = document.getElementById('disco-content');

  let idx;
  try {
    idx = await buildAlbumHeardIndex();
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">No pude cargar tus datos: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  state.heard = idx.heard;
  state.likesByArtist = idx.likesByArtist;

  const candidates = [...idx.likesByArtist.entries()]
    .map(([nameLower, ids]) => ({
      nameLower,
      name: idx.artistDisplay.get(nameLower) || nameLower,
      likes: ids.size,
      seedId: idx.artistIds.get(nameLower) || null,
      image: idx.artistImage.get(nameLower) || null,
    }))
    .filter(a => a.likes >= MIN_LIKES)
    // v=126: fábricas de sonidos funcionales fuera de los candidatos.
    .filter(a => !isJunkTrack('', a.name))
    .sort((a, b) => b.likes - a.likes);

  if (!candidates.length) {
    content.innerHTML = `<div class="card"><p>Necesito al menos un artista con ${MIN_LIKES} canciones en likes para armar esta vista. Guarda más canciones y vuelve.</p></div>`;
    return;
  }

  state.artists = candidates.map(c => ({
    id: null,
    name: c.name,
    nameLower: c.nameLower,
    likes: c.likes,
    seedId: c.seedId,
    image: c.image,
    disco: [],
    unheardAlbums: [],
    unheardSingles: [],
    scanned: false,
    error: null,
  }));
  state.filterKind = getFilterKind();
  state.filterYears = getFilterYears();
  state.loadedMore = Math.min(getLoadedMore(), state.artists.length);
  state.scannedAt = null;

  // Escaneo cacheado (7 días): entrar a la vista no puede costar 150 llamadas
  // cada vez. Lo que ya está escaneado se pinta al instante; si el cache cubre
  // menos artistas de los pedidos, el scan solo completa los que faltan.
  const cached = await loadScanCache(SCAN_KEY);
  if (cached) {
    const byName = new Map(cached.artists.map(a => [a.nameLower, a]));
    let restored = 0;
    for (const a of state.artists) {
      const c = byName.get(a.nameLower);
      if (!c) continue;
      Object.assign(a, {
        id: c.id, disco: c.disco || [],
        unheardAlbums: c.unheardAlbums || [], unheardSingles: c.unheardSingles || [],
        scanned: true, error: null,
      });
      restored++;
    }
    if (restored) state.scannedAt = cached.ts || null;
    console.log(`[discover] cache de escaneo: ${restored} artistas restaurados (${agoLabel(cached.ts)})`);
  }

  renderShell(content, candidates.length);
  refreshList(content);
  scanArtists(content).catch(err => console.warn('[discover] scan:', err));
}

function renderShell(content, totalCandidates) {
  content.innerHTML = `
    <div class="disco-topbar">
      <div class="disco-summary">
        <span id="disco-count">0</span>/<span id="disco-total-scan">${state.loadedMore}</span> artistas escaneados
        · <span id="disco-unheard-count">0</span> sin escuchar
        <span class="disco-summary-sub">${totalCandidates.toLocaleString('es-ES')} artistas con ≥${MIN_LIKES} likes</span>
      </div>
      <div class="disco-controls">
        <div class="disco-chip-group" id="disco-kind">
          <button class="disco-chip ${state.filterKind === 'all' ? 'is-on' : ''}" data-kind="all">Todo</button>
          <button class="disco-chip ${state.filterKind === 'album' ? 'is-on' : ''}" data-kind="album">Solo álbumes</button>
          <button class="disco-chip ${state.filterKind === 'single' ? 'is-on' : ''}" data-kind="single">Solo singles</button>
        </div>
        <select class="disco-select" id="disco-years">
          <option value="0" ${state.filterYears === 0 ? 'selected' : ''}>Cualquier año</option>
          <option value="1" ${state.filterYears === 1 ? 'selected' : ''}>Último año</option>
          <option value="2" ${state.filterYears === 2 ? 'selected' : ''}>Últimos 2 años</option>
          <option value="5" ${state.filterYears === 5 ? 'selected' : ''}>Últimos 5 años</option>
          <option value="10" ${state.filterYears === 10 ? 'selected' : ''}>Últimos 10 años</option>
        </select>
        <button class="btn btn-secondary btn-sm" id="disco-refresh" title="${state.scannedAt ? 'Último escaneo ' + agoLabel(state.scannedAt) + '. Volver a consultar Spotify.' : 'Volver a consultar Spotify'}">Actualizar</button>
      </div>
    </div>
    <div class="disco-progress" id="disco-progress" style="display:none">
      <div class="disco-progress-bar"><div class="disco-progress-fill" id="disco-progress-fill" style="width:0%"></div></div>
      <div class="disco-progress-label" id="disco-progress-label"></div>
    </div>
    <div class="disco-list" id="disco-list"></div>
    <div class="disco-load-more" style="text-align:center;margin:20px 0">
      <button class="btn btn-secondary" id="disco-load-more">Cargar más artistas (+50)</button>
    </div>
    <div class="disco-actionbar" id="disco-actionbar" style="display:none">
      <span id="disco-sel-count">0 seleccionados</span>
      <button class="btn btn-secondary btn-sm" id="disco-sel-clear">Limpiar selección</button>
      <button class="btn btn-secondary btn-sm" id="disco-sel-addpl">Añadir a playlist…</button>
      <button class="btn btn-primary btn-sm" id="disco-sel-playlist">Crear playlist con lo seleccionado</button>
    </div>
  `;

  content.querySelector('#disco-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    state.filterKind = btn.dataset.kind;
    localStorage.setItem(LS_FILTER_KIND, state.filterKind);
    content.querySelectorAll('#disco-kind [data-kind]').forEach(b => b.classList.toggle('is-on', b === btn));
    refreshList(content);
  });
  content.querySelector('#disco-years').addEventListener('change', (e) => {
    state.filterYears = parseInt(e.target.value, 10) || 0;
    localStorage.setItem(LS_FILTER_YEARS, String(state.filterYears));
    refreshList(content);
  });
  content.querySelector('#disco-load-more').addEventListener('click', () => {
    state.loadedMore = Math.min(state.loadedMore + 50, state.artists.length);
    localStorage.setItem(LS_LOADED_MORE, String(state.loadedMore));
    document.getElementById('disco-total-scan').textContent = state.loadedMore;
    scanArtists(content).catch(err => console.warn('[discover] scan:', err));
  });
  content.querySelector('#disco-refresh').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Actualizando…';
    await clearScanCache(SCAN_KEY, state.artists.map(a => a.id).filter(Boolean));
    for (const a of state.artists) {
      Object.assign(a, { disco: [], unheardAlbums: [], unheardSingles: [], scanned: false, error: null });
    }
    state.scannedAt = null;
    document.getElementById('disco-count').textContent = '0';
    refreshList(content);
    try { await scanArtists(content); } catch (err) { console.warn('[discover] scan:', err); }
    btn.disabled = false;
    btn.textContent = 'Actualizar';
  };
  content.querySelector('#disco-sel-clear').onclick = () => {
    state.selection.clear();
    updateSelectionUi(content);
    refreshList(content);
  };
  content.querySelector('#disco-sel-playlist').onclick = () => onCreatePlaylist(content);
  content.querySelector('#disco-sel-addpl').onclick = async (e) => {
    const btn = e.currentTarget;
    const ids = [...state.selection];
    if (!ids.length) return;
    btn.disabled = true;
    try {
      await addAlbumsToPlaylists(ids, findAlbum, {
        onDone: () => { state.selection.clear(); updateSelectionUi(content); refreshList(content); },
      });
    } catch (err) {
      showToast('No se pudieron cargar tus playlists: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

async function scanArtists(content) {
  const progress = document.getElementById('disco-progress');
  const progressLabel = document.getElementById('disco-progress-label');
  const progressFill = document.getElementById('disco-progress-fill');

  const target = Math.min(state.loadedMore, state.artists.length);
  let scanned = state.artists.filter(a => a.scanned).length;
  document.getElementById('disco-count').textContent = scanned;

  const queue = state.artists.filter(a => !a.scanned).slice(0, target - scanned);
  if (!queue.length) return;   // todo servido del cache: ni barra ni requests
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
        // Un 429 no es "este artista no existe": lo volvemos a encolar al
        // final en vez de perderlo de la lista, que era justo el síntoma.
        const rateLimited = e.status === 429 || /rate limit/i.test(e.message);
        if (rateLimited && (artist.retries || 0) < RATE_RETRIES) {
          artist.retries = (artist.retries || 0) + 1;
          artist.scanned = false;
          queue.push(artist);
          requeued = true;
          console.warn(`[discover] "${artist.name}": rate limit, reintento ${artist.retries}/${RATE_RETRIES}`);
        } else {
          artist.error = e.message;
          console.warn(`[discover] "${artist.name}":`, e.message);
        }
      } finally {
        if (!requeued) {
          scanned++;
          progressLabel.textContent = `${artist.name} (${scanned}/${target})`;
          progressFill.style.width = `${Math.min(100, (scanned / target) * 100)}%`;
          document.getElementById('disco-count').textContent = scanned;
        }
        refreshList(content);
      }
    }
  })());
  await Promise.all(workers);
  progress.style.display = 'none';

  const done = state.artists.filter(a => a.scanned && !a.error);
  if (done.length) {
    await saveScanCache(SCAN_KEY, done.map(a => ({
      nameLower: a.nameLower,
      id: a.id,
      disco: a.disco,
      unheardAlbums: a.unheardAlbums,
      unheardSingles: a.unheardSingles,
    })));
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
  const unheard = artist.disco.filter(al => albumIsUnheard(al, artist.name, state.heard));
  artist.unheardAlbums = unheard.filter(al => al.type === 'album');
  artist.unheardSingles = unheard.filter(al => al.type === 'single');
  artist.scanned = true;
}

function passesFilter(al) {
  if (state.filterKind === 'album' && al.type !== 'album') return false;
  if (state.filterKind === 'single' && al.type !== 'single') return false;
  if (state.filterYears > 0) {
    const y = yearOf(al.release);
    if (!y || (YEAR_NOW - y) > state.filterYears) return false;
  }
  return true;
}

function refreshList(content) {
  const list = document.getElementById('disco-list');
  if (!list) return;
  const artists = state.artists
    .filter(a => a.scanned && !a.error)
    .filter(a => a.unheardAlbums.length + a.unheardSingles.length > 0)
    .map(a => {
      const filtered = [...a.unheardAlbums, ...a.unheardSingles].filter(passesFilter);
      return { ...a, filtered };
    })
    .filter(a => a.filtered.length > 0);

  const totalUnheard = artists.reduce((s, a) => s + a.filtered.length, 0);
  document.getElementById('disco-unheard-count').textContent = totalUnheard.toLocaleString('es-ES');

  if (!artists.length) {
    list.innerHTML = `<div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">Nada por descubrir con los filtros actuales.</p></div>`;
    return;
  }

  list.innerHTML = artists.map(a => `
    <div class="disco-artist">
      <div class="disco-artist-head">
        <button class="disco-artist-name" data-artist="${escapeHtml(a.name)}">${escapeHtml(a.name)}</button>
        <span class="disco-artist-meta">${a.likes} likes · ${a.filtered.length} sin escuchar</span>
      </div>
      <div class="dcard-grid">
        ${a.filtered.map(al => renderAlbumCard(al, a.name, {
          checkClass: 'disco-check',
          selected: state.selection.has(al.id),
        })).join('')}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.disco-artist-name').forEach(btn => {
    btn.onclick = () => openArtistCard({ name: btn.dataset.artist });
  });
  wireAlbumCards(list, findAlbum, {
    checkClass: 'disco-check',
    selection: state.selection,
    onSave: (albumId, artistName, btn) => saveAlbumToLibrary(albumId, artistName, btn),
    onChange: () => updateSelectionUi(content),
    afterAdd: () => refreshList(content),
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

function updateSelectionUi(content) {
  const bar = content.querySelector('#disco-actionbar');
  const count = content.querySelector('#disco-sel-count');
  if (state.selection.size > 0) {
    bar.style.display = '';
    count.textContent = `${state.selection.size} seleccionado${state.selection.size === 1 ? '' : 's'}`;
  } else {
    bar.style.display = 'none';
  }
}

async function saveAlbumToLibrary(albumId, artistName, btn) {
  const al = findAlbum(albumId);
  if (!al) return;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const ids = await saveAlbumTracksToLibrary(albumId);
    btn.textContent = `✓ ${ids.length} en likes`;
    showToast(`${ids.length} pistas de "${al.name}" añadidas a tus me gusta`, 'success');
    // Marco el álbum como escuchado para que no salga más en la lista.
    markAlbumHeard(al.name, artistName);
    setTimeout(() => {
      const content = document.getElementById('disco-content');
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
  const btn = content.querySelector('#disco-sel-playlist');
  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    const { name, tracks } = await createDiscoverPlaylist(ids, findAlbum, { label: 'Descubrir' });
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
