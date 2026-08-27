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

import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js?v=163';
import { showToast } from '../ui/toast.js?v=163';
import { openArtistCard } from './artist-card.js?v=163';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js?v=163';
import { createLazyImages } from '../ui/lazy-img.js?v=163';
import { isJunkTrack } from '../util/junk.js?v=163';
import { buildAlbumHeardIndex } from '../util/album-heard.js?v=163';
import { loadFiltros, buildFilterContext, applyDiscoverFilters } from '../util/discover-filters.js?v=163';
import {
  getArtistIdCached,
  getArtistDiscoCached,
  dedupDisco,
  albumIsUnheard,
  yearOf,
  createDiscoverPlaylist,
  guardarLanzamiento,
  PLAYLIST_SINGLES,
  saveAlbumTracksToLibrary,
  albumTrackCount,
  markAlbumResolved,
  loadScanCache,
  saveScanCache,
  clearScanCache,
  agoLabel,
  renderAlbumCard,
  wireAlbumCards,
  renderFiltroChips,
  wireFiltroChips,
  addAlbumsToPlaylists,
  hiddenAlbums,
  heardAlbums,
  cardKey,
  toggleHeardAlbum,
  toggleHiddenAlbum,
} from './discover-common.js?v=163';

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
  // 'normal' = lo que queda por descubrir · 'hidden' = los que ocultaste ·
  // 'heard' = los que marcaste como escuchados. Los dos últimos son la única
  // forma de deshacer, así que no son opcionales.
  mode: 'normal',
  // Los cinco filtros de util/discover-filters.js. `filterCtx` llega
  // asincrónico (biblioteca + historial + likes); hasta que llegue no se
  // descarta NADA, nunca al revés.
  filtros: loadFiltros(),
  filterCtx: null,
  conteosFiltro: null,
};

const YEAR_NOW = new Date().getFullYear();

// ── Lista incremental (v=144) ────────────────────────────────────────────────
//
// Era la vista que más DOM metía de toda la app: 271 tarjetas de una sola vez
// con los filtros por defecto, 1.536 con el filtro en «Todo». Ahora se pinta por
// lotes, como #skips y #sin-clasificar.
//
// El item del lote es el BLOQUE DE ARTISTA entero, no la tarjeta suelta: cada
// artista es una card con su marco, su cabecera y su propia grilla de 3, así
// que partirlo por tarjeta obligaría a aplanar todo en una grilla única y a
// perder ese marco. Como los artistas traen entre 1 y 100 lanzamientos, el
// tamaño del lote se calcula del promedio real para que el primer pintado
// ronde las TARGET_CARDS tarjetas sea cual sea el corte.
const TARGET_CARDS = 45;
const MIN_BATCH_ARTISTS = 2;
const MAX_BATCH_ARTISTS = 20;

let list = null;         // handle de createIncrementalList
let lazyCovers = null;   // handle de createLazyImages

function batchSizeFor(artists) {
  const cards = artists.reduce((s, a) => s + a.filtered.length, 0);
  if (!artists.length || !cards) return MIN_BATCH_ARTISTS;
  const media = cards / artists.length;
  const n = Math.round(TARGET_CARDS / media);
  return Math.max(MIN_BATCH_ARTISTS, Math.min(MAX_BATCH_ARTISTS, n || MIN_BATCH_ARTISTS));
}

// Solo suelta lo que cuelga del DOM que se va. No toca `state`: el escaneo en
// memoria es lo que hace que volver a la vista sea instantáneo.
function teardown() {
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
}

export async function render(container) {
  teardown();
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
    return teardown;
  }
  state.heard = idx.heard;
  state.likesByArtist = idx.likesByArtist;

  // El contexto de los filtros (biblioteca guardada + historial + likes) no
  // bloquea el pintado: hasta que llega, `state.filterCtx` es null y no se
  // descarta nada. Cuando llega, se repinta. Nunca al revés — esconder
  // lanzamientos por un contexto a medio cargar sería un fallo mudo.
  buildFilterContext()
    .then(ctx => { state.filterCtx = ctx; refreshList(content); })
    .catch(e => console.warn('[discover] contexto de filtros:', e.message));

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
    return teardown;
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
  state.mode = 'normal';

  // Ocultos desde la playlist de Spotify. En segundo plano: la vista arranca
  // con el caché local y se repinta cuando llega la reconciliación (unión), que
  // es lo que trae lo que ocultaste en la otra máquina.
  hiddenAlbums.ready().then(() => {
    const c = document.getElementById('disco-content');
    if (c && c.isConnected) refreshList(c);
  });

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
  return teardown;
}

function renderShell(content, totalCandidates) {
  // El shell se repinta entero (también al cambiar de modo), así que el
  // #disco-list de antes queda desconectado. Sin esto, el handle de la lista y
  // el de las tapas seguirían observando nodos muertos.
  teardown();
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
        <button class="btn btn-secondary btn-sm ${state.mode === 'heard' ? 'sc-on' : ''}" id="disco-mode-heard" title="Los que marcaste como escuchados. Desde ahí podés devolverlos a la lista.">Escuchados <span id="disco-heard-n">${heardAlbums.size}</span></button>
        <button class="btn btn-secondary btn-sm ${state.mode === 'hidden' ? 'sc-on' : ''}" id="disco-mode-hidden" title="Los que ocultaste. Se sincronizan con la playlist «fonoteca · ocultos (descubrir)».">Ocultos <span id="disco-hidden-n">${hiddenAlbums.size}</span></button>
        <button class="btn btn-secondary btn-sm" id="disco-refresh" title="${state.scannedAt ? 'Último escaneo ' + agoLabel(state.scannedAt) + '. Volver a consultar Spotify.' : 'Volver a consultar Spotify'}">Actualizar</button>
      </div>
    </div>
    ${renderFiltroChips(state.filtros, state.conteosFiltro)}
    <div class="disco-progress" id="disco-progress" style="display:none">
      <div class="disco-progress-bar"><div class="disco-progress-fill" id="disco-progress-fill" style="width:0%"></div></div>
      <div class="disco-progress-label" id="disco-progress-label"></div>
    </div>
    <div class="disco-list" id="disco-list"></div>
    <div class="disco-load-more" style="text-align:center;margin:20px 0">
      <button class="btn btn-secondary" id="disco-load-more">Cargar más artistas +50</button>
    </div>
    <div class="disco-actionbar" id="disco-actionbar" style="display:none">
      <span id="disco-sel-count">0 seleccionados</span>
      <button class="btn btn-secondary btn-sm" id="disco-sel-clear">Limpiar selección</button>
      <button class="btn btn-secondary btn-sm" id="disco-sel-addpl">Añadir a playlist…</button>
      <button class="btn btn-primary btn-sm" id="disco-sel-playlist">Crear playlist con lo seleccionado</button>
    </div>
  `;

  wireFiltroChips(content, state.filtros, () => refreshList(content));

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
  // Los dos modos son excluyentes y se apagan tocándolos de nuevo.
  const setMode = (m) => {
    state.mode = state.mode === m ? 'normal' : m;
    renderShell(content, totalCandidates);
    // renderShell repinta la cabecera entera, incluido el contador de escaneo,
    // que arranca en 0: hay que devolverle lo que ya estaba escaneado.
    const escaneados = state.artists.filter(a => a.scanned).length;
    document.getElementById('disco-count').textContent = escaneados;
    refreshList(content);
  };
  content.querySelector('#disco-mode-heard').onclick = () => setMode('heard');
  content.querySelector('#disco-mode-hidden').onclick = () => setMode('hidden');

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

// Actualiza solo los números de los chips, sin repintar la topbar: repintarla
// perdería el foco del chip que Ian acaba de tocar.
function pintarConteosFiltro(conteos) {
  document.querySelectorAll('#disco-filtros [data-filtro]').forEach(btn => {
    const n = btn.querySelector('.disco-filtro-n');
    if (n) n.textContent = (conteos?.[btn.dataset.filtro] ?? 0).toLocaleString('es-ES');
  });
}

function refreshList(content) {
  const listEl = document.getElementById('disco-list');
  if (!listEl) return;
  // El pool depende del modo. En el normal se sacan los ocultos y los marcados
  // como escuchados: `unheardAlbums`/`unheardSingles` pueden venir del caché de
  // escaneo (7 días), calculados ANTES de que Ian marcara nada, así que el
  // filtro tiene que aplicarse acá y no solo en el escaneo.
  const poolDe = (a) => {
    if (state.mode === 'heard') return (a.disco || []).filter(al => heardAlbums.has(cardKey(al, a.name)));
    if (state.mode === 'hidden') return (a.disco || []).filter(al => hiddenAlbums.has(cardKey(al, a.name)));
    return [...a.unheardAlbums, ...a.unheardSingles]
      .filter(al => !hiddenAlbums.has(cardKey(al, a.name)) && !heardAlbums.has(cardKey(al, a.name)));
  };

  // Los cinco filtros solo mandan en el modo normal: en «Ocultos» y
  // «Escuchados» Ian está revisando lo que descartó a mano, y esconderle ahí la
  // mitad por un criterio automático sería justo lo contrario de lo que busca.
  let artists = state.artists
    .filter(a => a.scanned && !a.error)
    .map(a => ({ ...a, filtered: poolDe(a).filter(passesFilter) }));

  if (state.mode === 'normal' && state.filterCtx) {
    const items = [];
    for (const a of artists) {
      for (const al of a.filtered) items.push({ al, artista: a.name, artistaId: a.id });
    }
    const { visibles, conteos } = applyDiscoverFilters(items, state.filterCtx, state.filtros);
    state.conteosFiltro = conteos;
    const vivos = new Set(visibles.map(v => v.al));
    artists = artists.map(a => ({ ...a, filtered: a.filtered.filter(al => vivos.has(al)) }));
    pintarConteosFiltro(conteos);
  }
  artists = artists.filter(a => a.filtered.length > 0);

  const totalUnheard = artists.reduce((s, a) => s + a.filtered.length, 0);
  document.getElementById('disco-unheard-count').textContent = totalUnheard.toLocaleString('es-ES');
  const nHeard = document.getElementById('disco-heard-n');
  if (nHeard) nHeard.textContent = heardAlbums.size;
  const nHidden = document.getElementById('disco-hidden-n');
  if (nHidden) nHidden.textContent = hiddenAlbums.size;

  if (!artists.length) {
    teardown();
    const msg = state.mode === 'heard'
      ? 'No marcaste ningún lanzamiento como escuchado.'
      : state.mode === 'hidden'
        ? 'No ocultaste ningún lanzamiento.'
        : 'Nada por descubrir con los filtros actuales.';
    listEl.innerHTML = `<div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">${msg}</p></div>`;
    updateSelectionUi(content);
    return;
  }

  const t0 = performance.now();
  const perf = (window.__discoPerf ||= { batches: [] });

  // Cablear SOLO los bloques recién insertados. `wireAlbumCards` hace
  // querySelectorAll sobre la raíz que se le pase, así que pasarle el container
  // entero en cada lote sería cuadrático (y volvería a cablear lo ya cableado).
  const wireNuevos = () => {
    const nuevos = listEl.querySelectorAll('.disco-artist:not([data-wired])');
    if (!nuevos.length) return 0;
    nuevos.forEach(bloque => {
      bloque.setAttribute('data-wired', '1');
      const nombre = bloque.querySelector('.disco-artist-name');
      if (nombre) nombre.onclick = () => openArtistCard({ name: nombre.dataset.artist });
      // OJO: los handlers de la tarjeta NO están delegados — wireAlbumCards
      // asigna onclick uno por uno. Por eso hay que llamarlo por lote: si no,
      // el hover-play y los botones «Escuchado» / «Ocultar» de las tarjetas de
      // los lotes tardíos quedarían muertos.
      wireAlbumCards(bloque, findAlbum, {
        checkClass: 'disco-check',
        selection: state.selection,
        onSave: (albumId, artistName, btn) => saveAlbumToLibrary(albumId, artistName, btn),
        onLikeTracks: (albumId, artistName, btn) => likearPistasDelAlbum(albumId, artistName, btn),
        onChange: () => updateSelectionUi(content),
        afterAdd: () => refreshList(content),
        onHeard: (albumId, artistName) => {
          const al = findAlbum(albumId);
          if (!al) return;
          const marcado = toggleHeardAlbum(al, artistName);
          showToast(marcado
            ? `«${al.name}» marcado como escuchado`
            : `«${al.name}» vuelve a la lista`, 'success');
          refreshList(content);
        },
        onHide: async (albumId, artistName, btn) => {
          const al = findAlbum(albumId);
          if (!al) return;
          // Resolver la pista representativa es una llamada de red: sin
          // deshabilitar el botón, dos clicks seguidos ocultan y desocultan a
          // ciegas.
          btn.disabled = true;
          try {
            const oculto = await toggleHiddenAlbum(al, artistName);
            showToast(oculto
              ? `«${al.name}» oculto — no vuelve a aparecer`
              : `«${al.name}» vuelve a la lista`, 'success');
          } catch (e) {
            showToast('No se pudo ocultar: ' + e.message, 'error');
          } finally {
            btn.disabled = false;
          }
          refreshList(content);
        },
      });
      lazyCovers?.observe(bloque);
    });
    return nuevos.length;
  };

  const onBatch = ({ rendered, total, added, ms }) => {
    const cablados = wireNuevos();
    const tarjetas = listEl.querySelectorAll('.dcard').length;
    perf.batches.push({ added, rendered, total, tarjetas, ms: +ms.toFixed(1) });
    if (window.__discoDebug) {
      console.info(`[discover] lote +${added} artistas (${cablados} cableados) → ${rendered}/${total} · ${tarjetas} tarjetas · ${ms.toFixed(1)} ms`);
    }
  };

  // Reutilizar el handle mientras la vista sigue viva: refreshList se llama en
  // cada artista escaneado (una vez por request), y recrear la lista y el
  // observer de tapas 100 veces seguidas sería peor que el problema original.
  if (list) {
    // La lista se repinta entera: los <img> viejos dejan de existir, así que el
    // observer de tapas arranca de cero (el Set de "esta URL ya viajó por la
    // red" sobrevive al reset, o sea que las que ya se vieron se reasignan sin
    // parpadeo ni pedido nuevo).
    lazyCovers?.reset();
    // setItems repinta y dispara el onBatch original, que es el que cablea:
    // no hace falta (ni conviene) llamarlo a mano acá.
    list.setItems(artists, { preserveRendered: true });
  } else {
    // El root del observer se CALCULA: acá el .disco-list no tiene overflow
    // propio (scrollea el documento), así que scrollRootOf devuelve null y el
    // root es el viewport. Si algún día la vista gana un scroller propio, esto
    // lo sigue solo.
    const scroller = scrollRootOf(listEl);
    lazyCovers = createLazyImages({ root: scroller, rootMargin: '300px' });
    list = createIncrementalList({
      container: listEl,
      items: artists,
      renderItem: renderArtistBlock,
      batchSize: batchSizeFor(artists),
      rootMargin: '600px',
      onBatch,
    });
  }

  perf.totalArtistas = artists.length;
  perf.totalTarjetas = totalUnheard;
  perf.firstPaintArtistas = list.rendered;
  perf.syncMs = +(performance.now() - t0).toFixed(1);
  Object.defineProperty(perf, 'lazy', { get: () => lazyCovers?.stats || null, configurable: true });

  updateSelectionUi(content);
}

function renderArtistBlock(a) {
  return `
    <div class="disco-artist">
      <div class="disco-artist-head">
        <button class="disco-artist-name" data-artist="${escapeHtml(a.name)}">${escapeHtml(a.name)}</button>
        <span class="disco-artist-meta">${a.likes} likes · ${a.filtered.length} sin escuchar</span>
      </div>
      <div class="dcard-grid">
        ${a.filtered.map(al => renderAlbumCard(al, a.name, {
          checkClass: 'disco-check',
          selected: state.selection.has(al.id),
          showHeard: true,
          hiddenMode: state.mode === 'hidden',
        })).join('')}
      </div>
    </div>
  `;
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

// «Guardar álbum»: el disco entero como unidad, por `PUT /me/library` con la
// uri de álbum (verificado 2026-08-18; `PUT /me/albums` da 403). No toca los
// me gusta de las pistas.
async function saveAlbumToLibrary(albumId, artistName, btn) {
  const al = findAlbum(albumId);
  if (!al) return;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const r = await guardarLanzamiento(al);
    if (r.destino === 'biblioteca') {
      btn.textContent = '✓ Guardado';
      showToast(`«${al.name}» guardado en tu biblioteca de álbumes`, 'success');
    } else {
      btn.textContent = '✓ En la playlist';
      const partes = [];
      if (r.pistas) partes.push(`${r.pistas} ${r.pistas === 1 ? 'pista' : 'pistas'}`);
      if (r.yaEstaban) partes.push(`${r.yaEstaban} ya ${r.yaEstaban === 1 ? 'estaba' : 'estaban'}`);
      showToast(
        `«${al.name}» es un single: ${partes.join(' · ') || 'sin pistas nuevas'} en «${PLAYLIST_SINGLES}»`,
        'success',
      );
      // La playlist se crea PÚBLICA y no hay forma de evitarlo por API. Se
      // avisa una sola vez, cuando se acaba de crear.
      if (r.playlistCreada) {
        showToast(
          `Creé la playlist «${PLAYLIST_SINGLES}». Spotify la crea PÚBLICA y no se puede cambiar por API: pasala a privada a mano desde la app.`,
          'info',
        );
      }
    }
    markAlbumResolved(al, artistName);
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

// «Añadir pistas a mis likes»: le da al corazón a CADA pista del disco, una por
// una. Es una escritura grande y difícil de deshacer (hay que sacar el like de
// cada pista a mano), así que dice cuántas son ANTES de hacerla — no después,
// que es como Ian se enteró de que un disco le había metido 12 canciones
// sueltas en los me gusta.
async function likearPistasDelAlbum(albumId, artistName, btn) {
  const al = findAlbum(albumId);
  if (!al) return;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Contando…';
  let n = 0;
  try {
    n = await albumTrackCount(al);
  } catch { /* si no se puede contar, se avisa sin número */ }
  btn.disabled = false;
  btn.textContent = origText;

  const cuantas = n
    ? `<strong>${n}</strong> ${n === 1 ? 'pista' : 'pistas'}`
    : '<strong>todas las pistas</strong>';
  const ok = await confirmModal(
    'Añadir pistas a tus me gusta',
    `Vas a añadir ${cuantas} de «${escapeHtml(al.name)}» a tus me gusta, una por una. ` +
    'Esto NO guarda el álbum: te deja las canciones sueltas entre tus likes, y para ' +
    'deshacerlo hay que sacarle el corazón a cada una a mano. ' +
    'Si lo que querés es el disco entero, usá «Guardar álbum».',
    n === 1 ? 'Añadir la pista' : `Añadir ${n || 'las'} pistas`,
  );
  if (!ok) return;

  btn.disabled = true;
  btn.textContent = 'Añadiendo…';
  try {
    const ids = await saveAlbumTracksToLibrary(albumId);
    btn.textContent = `✓ ${ids.length} en likes`;
    showToast(
      `${ids.length} ${ids.length === 1 ? 'pista' : 'pistas'} de «${al.name}» ${ids.length === 1 ? 'añadida' : 'añadidas'} a tus me gusta`,
      'success',
    );
    markAlbumResolved(al, artistName);
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
    showToast(`Playlist "${name}" creada con ${tracks} pista${tracks === 1 ? '' : 's'}`, 'success');
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
