// #discover-artists · "Sin escuchar de tus artistas"
//
// Idea: para los artistas con más likes (5+), traer su discografía completa
// (álbumes + singles) desde Spotify y cruzarla con tus likes y con el
// historial de escucha para marcar qué álbumes/singles NO escuchaste.
//
// Endpoints usados:
//   - GET /artists/{id}/albums (probamos primero, fallback a /search)
//   - GET /albums/{id}/tracks (para agregar todas las pistas al crear playlist)
//   - PUT /me/library (guardar en biblioteca)
//   - POST /me/playlists + POST /playlists/{id}/items (crear playlist)
//
// Cache: la discografía de cada artista queda 30 días en IDB
// (`discover_artist_disco_{artistId}`). Los artistas son muchos → nunca le
// pegamos al endpoint más de una vez cada 30 días por artista.
//
// Carga progresiva: mostramos artistas a medida que llegan (batch 3 en
// paralelo, respetando 429 → 5s de espera). Pill de progreso arriba.

import { spotifyFetch, getBestAvailableLikes, searchArtistByName, getArtistAlbums, getAlbumTracks, saveToLibrary, createPlaylist, addTracksToPlaylist } from '../api.js?v=119';
import { idbGetCached, idbSetCached } from '../idb.js?v=119';
import { escapeHtml, pageHeader } from '../ui/components.js?v=119';
import { showToast } from '../ui/toast.js?v=119';
import { openArtistCard } from './artist-card.js?v=119';
import { openAlbumCard } from './album-card.js?v=119';
import { loadListenedAlbums, isOwner } from './history-data.js?v=119';
import { albumKey } from '../util/album-key.js?v=119';

const LS_FILTER_KIND = 'discoverart_filter_kind';   // 'all' | 'album' | 'single'
const LS_FILTER_YEARS = 'discoverart_filter_years'; // 0 = todo, o número de años
const LS_LOADED_MORE = 'discoverart_loaded_more';   // cuántos artistas cargar (default 20)
const MIN_LIKES = 5;
const BATCH_PARALLEL = 3;
const DISCO_TTL_MIN = 30 * 24 * 60;
const ARTIST_ID_TTL_MIN = 60 * 24 * 60; // 60 días — los ids no cambian

function getFilterKind() {
  const v = localStorage.getItem(LS_FILTER_KIND);
  return ['all','album','single'].includes(v) ? v : 'all';
}
function getFilterYears() {
  const n = parseInt(localStorage.getItem(LS_FILTER_YEARS) || '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function getLoadedMore() {
  const n = parseInt(localStorage.getItem(LS_LOADED_MORE) || '20', 10);
  return Number.isFinite(n) && n >= 5 ? n : 20;
}

// Estado del feature (por sesión de página).
const state = {
  artists: [],           // [{ id, name, likes, image, disco: [], scanned: bool, error: null }]
  listenedKeys: null,    // Set<albumKey> de los álbumes escuchados
  likedIds: null,        // Set<track.id> de los que ya están en likes
  likedAlbumKeys: null,  // Set<albumKey> (para singles/álbumes con 100% de likes)
  selection: new Set(),  // Set<albumId> del check "para crear playlist"
  filterKind: 'all',
  filterYears: 0,
  loadedMore: 20,
  concurrent: 0,
};

const YEAR_NOW = new Date().getFullYear();

function albumsFromLikes(likes) {
  // Devuelve: (a) Map<artistNameLower, count> de likes por artista
  //           (b) Set<track.id> de todos los likes
  //           (c) Set<albumKey> de álbumes que ya están en tus likes
  const byArtist = new Map();
  const likedIds = new Set();
  const likedAlbums = new Set();
  const artistDisplay = new Map(); // artistNameLower -> display name preservado
  const artistImage = new Map();
  const artistIds = new Map();     // spotify artist id → nameLower (para preferir el id real)
  for (const it of likes) {
    const t = it?.track || it;
    if (!t || !t.artists?.length) continue;
    // Solo contamos el primer artista para no inflar cross-features.
    const a0 = t.artists[0];
    const nameLower = (a0.name || '').toLowerCase().trim();
    if (!nameLower) continue;
    byArtist.set(nameLower, (byArtist.get(nameLower) || 0) + 1);
    artistDisplay.set(nameLower, a0.name);
    if (a0.id && !artistIds.has(nameLower)) artistIds.set(nameLower, a0.id);
    if (t.id) likedIds.add(t.id);
    const alb = t.album || {};
    const albName = alb.name || '';
    if (albName) likedAlbums.add(albumKey(albName, a0.name));
    if (!artistImage.get(nameLower)) {
      // El objeto track no trae imágenes de artista. Nos apoyaremos en el
      // álbum como aproximación visual.
      artistImage.set(nameLower, alb.images?.[2]?.url || alb.images?.[1]?.url || alb.images?.[0]?.url || null);
    }
  }
  return { byArtist, likedIds, likedAlbums, artistDisplay, artistImage, artistIds };
}

async function getArtistIdCached(nameLower, displayName, seedId) {
  // Cache de artist id por nombre (60 días).
  const key = `discover_artist_id_${nameLower}`;
  if (seedId) {
    try { await idbSetCached(key, seedId, ARTIST_ID_TTL_MIN); } catch {}
    return seedId;
  }
  try {
    const cached = await idbGetCached(key);
    if (cached) return cached;
  } catch {}
  const found = await searchArtistByName(displayName);
  if (!found?.id) return null;
  try { await idbSetCached(key, found.id, ARTIST_ID_TTL_MIN); } catch {}
  return found.id;
}

async function getArtistDiscoCached(artistId, artistName) {
  const key = `discover_artist_disco_${artistId}`;
  try {
    const cached = await idbGetCached(key);
    if (Array.isArray(cached)) return cached;
  } catch {}
  const items = await getArtistAlbums(artistId, artistName, { includeSingles: true, limit: 50 });
  // Slim para no gastar cuota IDB.
  const slim = items.map(al => ({
    id: al.id,
    name: al.name,
    type: al.album_type,          // 'album' | 'single' | 'compilation'
    img: al.images?.[1]?.url || al.images?.[0]?.url || null,
    release: al.release_date || '',
    total: al.total_tracks || 0,
    artists: (al.artists || []).map(a => ({ id: a.id, name: a.name })),
  }));
  try { await idbSetCached(key, slim, DISCO_TTL_MIN); } catch {}
  return slim;
}

function yearOf(release) {
  const y = parseInt((release || '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

function dedupDisco(disco) {
  // La discografía de Spotify suele tener múltiples ediciones del mismo álbum
  // (deluxe, remaster, etc). Los normalizamos con albumKey y nos quedamos con
  // la primera edición (release date más antiguo).
  const map = new Map();
  for (const al of disco) {
    const artistName = al.artists?.[0]?.name || '';
    const k = albumKey(al.name, artistName);
    const prev = map.get(k);
    if (!prev) { map.set(k, al); continue; }
    // Preferimos el más antiguo (primera edición) — y si empatan, el que
    // tenga img.
    const prevY = yearOf(prev.release);
    const curY = yearOf(al.release);
    if (curY && (!prevY || curY < prevY)) map.set(k, al);
    else if (curY === prevY && !prev.img && al.img) map.set(k, al);
  }
  return [...map.values()];
}

function albumIsUnheard(al, artistName, listenedKeys, likedAlbums) {
  const k = albumKey(al.name, artistName);
  if (listenedKeys.has(k)) return false;
  if (likedAlbums.has(k)) return false;
  return true;
}

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Sin escuchar de tus artistas' })}
    <div id="disco-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:14px">Cargando tus likes…</div></div></div>
  `;
  const content = document.getElementById('disco-content');

  // Necesitamos likes. También intentamos historial (owner) para cruzar por
  // álbumes escuchados; si no somos owner o no está, seguimos con solo likes.
  let likes = [];
  try {
    const res = await getBestAvailableLikes();
    likes = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">No pude cargar tus likes: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  if (!likes.length) {
    content.innerHTML = `<div class="card"><p>Todavía no tienes likes. Guarda algunas canciones en Spotify y volvé.</p></div>`;
    return;
  }

  const { byArtist, likedIds, likedAlbums, artistDisplay, artistImage, artistIds } = albumsFromLikes(likes);
  state.likedIds = likedIds;
  state.likedAlbumKeys = likedAlbums;

  // Historial: solo si el user es owner (o subió su ZIP).
  const listenedKeys = new Set();
  try {
    if (await isOwner()) {
      const data = await loadListenedAlbums();
      for (const y of (data?.years || [])) {
        for (const al of (y.albums || [])) {
          listenedKeys.add(albumKey(al.name, al.artist));
        }
      }
    }
  } catch { /* ignora */ }
  state.listenedKeys = listenedKeys;

  // Artistas candidatos: los con MIN_LIKES+ likes, ordenados desc.
  const candidates = [...byArtist.entries()]
    .filter(([, count]) => count >= MIN_LIKES)
    .sort((a, b) => b[1] - a[1])
    .map(([nameLower, count]) => ({
      nameLower,
      name: artistDisplay.get(nameLower) || nameLower,
      likes: count,
      seedId: artistIds.get(nameLower) || null,
      image: artistImage.get(nameLower) || null,
    }));

  if (!candidates.length) {
    content.innerHTML = `<div class="card"><p>Necesito al menos un artista con ${MIN_LIKES} canciones en likes para armar esta vista. Guarda más canciones y volvé.</p></div>`;
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

  renderShell(content, candidates.length);
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
      </div>
    </div>
    <div class="disco-progress" id="disco-progress" style="display:none">
      <div class="disco-progress-bar"><div class="disco-progress-fill" id="disco-progress-fill" style="width:0%"></div></div>
      <div class="disco-progress-label" id="disco-progress-label"></div>
    </div>
    <div class="disco-list" id="disco-list"></div>
    <div class="disco-load-more" style="text-align:center;margin:20px 0">
      <button class="btn btn-secondary" id="disco-load-more">Cargar más artistas (+20)</button>
    </div>
    <div class="disco-actionbar" id="disco-actionbar" style="display:none">
      <span id="disco-sel-count">0 seleccionados</span>
      <button class="btn btn-secondary btn-sm" id="disco-sel-clear">Vaciar</button>
      <button class="btn btn-primary" id="disco-sel-playlist">Crear playlist con lo seleccionado</button>
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
  content.querySelector('#disco-load-more').addEventListener('click', async () => {
    state.loadedMore = Math.min(state.loadedMore + 20, state.artists.length);
    localStorage.setItem(LS_LOADED_MORE, String(state.loadedMore));
    document.getElementById('disco-total-scan').textContent = state.loadedMore;
    scanArtists(content).catch(err => console.warn('[discover] scan:', err));
  });
  content.querySelector('#disco-sel-clear').onclick = () => {
    state.selection.clear();
    updateSelectionUi(content);
    refreshList(content);
  };
  content.querySelector('#disco-sel-playlist').onclick = () => createPlaylistFromSelection(content);
}

async function scanArtists(content) {
  const progress = document.getElementById('disco-progress');
  const progressLabel = document.getElementById('disco-progress-label');
  const progressFill = document.getElementById('disco-progress-fill');
  progress.style.display = '';

  const target = Math.min(state.loadedMore, state.artists.length);
  let scanned = state.artists.filter(a => a.scanned).length;

  // Batches paralelos, respetando la cuota. Si un fetch falla con 429 el
  // spotifyFetch ya espera 5s adentro; solo capturamos el error final.
  const queue = state.artists.filter(a => !a.scanned).slice(0, target - scanned);
  const workers = Array.from({ length: BATCH_PARALLEL }, () => (async () => {
    while (queue.length) {
      const artist = queue.shift();
      if (!artist) break;
      state.concurrent++;
      try {
        await processArtist(artist);
      } catch (e) {
        artist.error = e.message;
        console.warn(`[discover] "${artist.name}":`, e.message);
      } finally {
        state.concurrent--;
        scanned++;
        progressLabel.textContent = `${artist.name} (${scanned}/${target})`;
        progressFill.style.width = `${Math.min(100, (scanned / target) * 100)}%`;
        document.getElementById('disco-count').textContent = scanned;
        refreshList(content);
      }
    }
  })());
  await Promise.all(workers);
  progress.style.display = 'none';
}

async function processArtist(artist) {
  if (artist.scanned) return;
  const id = await getArtistIdCached(artist.nameLower, artist.name, artist.seedId);
  if (!id) { artist.scanned = true; artist.error = 'no encontrado en Spotify'; return; }
  artist.id = id;
  const disco = await getArtistDiscoCached(id, artist.name);
  artist.disco = dedupDisco(disco);
  const unheard = artist.disco.filter(al => albumIsUnheard(al, artist.name, state.listenedKeys, state.likedAlbumKeys));
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
      <div class="disco-album-grid">
        ${a.filtered.map(al => renderAlbum(al, a.name)).join('')}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.disco-artist-name').forEach(btn => {
    btn.onclick = () => openArtistCard({ name: btn.dataset.artist });
  });
  list.querySelectorAll('[data-open-album]').forEach(btn => {
    btn.onclick = () => {
      const albumId = btn.dataset.openAlbum;
      const artistName = btn.dataset.openArtist;
      const al = findAlbum(albumId);
      if (!al) return;
      openAlbumCard({ name: al.name, artist: artistName, img: al.img, plays: 0, min: 0, albumId: al.id, totalTracks: al.total });
    };
  });
  list.querySelectorAll('[data-save-album]').forEach(btn => {
    btn.onclick = () => saveAlbumToLibrary(btn.dataset.saveAlbum, btn.dataset.saveArtist, btn);
  });
  list.querySelectorAll('.disco-check').forEach(cb => {
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

function renderAlbum(al, artistName) {
  const y = yearOf(al.release);
  const typeLabel = al.type === 'single' ? 'single' : 'álbum';
  return `
    <div class="disco-album" data-id="${al.id}">
      <label class="disco-album-check-wrap">
        <input type="checkbox" class="disco-check" data-id="${escapeHtml(al.id)}">
      </label>
      <button type="button" class="disco-album-body" data-open-album="${escapeHtml(al.id)}" data-open-artist="${escapeHtml(artistName)}">
        ${al.img
          ? `<img src="${al.img}" alt="" loading="lazy" class="disco-album-img">`
          : `<div class="disco-album-img disco-album-img-empty">♪</div>`}
        <div class="disco-album-info">
          <div class="disco-album-name">${escapeHtml(al.name)}</div>
          <div class="disco-album-meta">${y || '—'} · ${typeLabel}${al.total ? ` · ${al.total} pistas` : ''}</div>
        </div>
      </button>
      <button class="btn btn-secondary btn-sm disco-save-btn" data-save-album="${escapeHtml(al.id)}" data-save-artist="${escapeHtml(artistName)}" title="Guardar todas las pistas en tu biblioteca">+ Biblioteca</button>
    </div>
  `;
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
    const tracks = await getAlbumTracks(albumId);
    const ids = tracks.map(t => t.id).filter(Boolean);
    if (!ids.length) throw new Error('el álbum no tiene pistas');
    await saveToLibrary(ids);
    btn.textContent = `✓ ${ids.length} en likes`;
    showToast(`${ids.length} pistas de "${al.name}" añadidas a tus me gusta`, 'success');
    // Marco el álbum como ya en likes para que no salga más como "sin escuchar".
    state.likedAlbumKeys.add(albumKey(al.name, artistName));
    ids.forEach(id => state.likedIds.add(id));
    setTimeout(() => {
      // Refresh la lista para sacarlo.
      const content = document.getElementById('disco-content');
      if (content) refreshList(content);
    }, 800);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = origText;
    showToast('Error al añadir: ' + e.message, 'error');
  }
}

async function createPlaylistFromSelection(content) {
  const ids = [...state.selection];
  if (!ids.length) return;
  const btn = content.querySelector('#disco-sel-playlist');
  btn.disabled = true;
  btn.textContent = 'Creando…';

  try {
    // Traer todas las pistas de todos los álbumes seleccionados.
    const allTrackUris = [];
    for (const albumId of ids) {
      const tracks = await getAlbumTracks(albumId);
      tracks.forEach(t => { if (t.uri) allTrackUris.push(t.uri); });
    }
    if (!allTrackUris.length) throw new Error('los álbumes seleccionados no tienen pistas');

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const name = `Descubrir · ${dateStr}`;
    const desc = `${ids.length} álbumes/singles de tus artistas favoritos que aún no escuchaste. Generado por Fonoteca.`;
    const created = await createPlaylist(name, desc, false);

    // Chunks de 100 (spotify limit por request de add).
    for (let i = 0; i < allTrackUris.length; i += 100) {
      const chunk = allTrackUris.slice(i, i + 100);
      await addTracksToPlaylist(created.id, chunk);
    }

    showToast(`Playlist "${name}" creada con ${allTrackUris.length} pistas`, 'success');
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
