// Sin clasificar: likes que NO están en ninguna playlist propia, salvo las que
// se marcan como ignoradas (por defecto el espejo "anothertwo" y el depósito
// "w three", que no clasifican nada).
//
// El cruce es caro (~9.500 likes contra decenas de playlists), así que:
//   - cada playlist se baja con getAllPlaylistItems, que valida por snapshot_id
//     y no re-descarga lo que no cambió;
//   - el resultado del cruce (ids + claves nombre|artista de TODO lo que está
//     en playlists) se guarda en IDB con TTL de 1 día;
//   - el estado vive en memoria mientras dure la sesión, así que volver a la
//     vista no dispara nada.
//
// El match es por track ID de Spotify. Solo si un track no trae id se cae a
// nombre+artista normalizado (normText de util/track-match.js).

import {
  getAllUserPlaylists, getAllPlaylistItems, getBestAvailableLikes,
  getCurrentUserId, addTracksToPlaylist, updatePlaylistItemsCache,
} from '../api.js?v=130';
import { idbGetCached, idbSetCached, idbDel } from '../idb.js?v=130';
import { escapeHtml, pageHeader, showProgress, hideProgress, isCancelled } from '../ui/components.js?v=130';
import { openModal, closeTop } from '../ui/modal-stack.js?v=130';
import { showToast } from '../ui/toast.js?v=130';
import { getPreview } from '../api/preview-providers.js?v=130';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=130';
import { openTrackCard } from './track-card.js?v=130';
import { normText } from '../util/track-match.js?v=130';
import { activateMarquee, marqueeSpan } from '../ui/marquee.js?v=130';

const HIDDEN_KEY = 'sin_clasificar_ocultas';
const EXCLUDED_KEY = 'sin_clasificar_excluidas';
const SORT_KEY = 'sin_clasificar_orden';
const CROSS_KEY = 'sin_clasificar_cross_v1';
const CROSS_TTL_MIN = 24 * 60;

// Playlists que no clasifican nada: el espejo de likes y el depósito de W-Three.
// Se usan solo la primera vez, para presembrar el selector.
const DEFAULT_EXCLUDED_NAMES = ['anothertwo', 'w three'];

// Pausa entre playlists del escaneo. Aunque el cache por snapshot evite bajar
// los tracks, cada playlist cuesta 1 request de snapshot: sin freno, 60
// playlists seguidas se comen un 429.
const SCAN_PAUSE_MS = 200;

const SORTS = [
  { id: 'recent', label: 'Más recientes primero' },
  { id: 'old', label: 'Más antiguas primero' },
  { id: 'artist', label: 'Por artista' },
  { id: 'random', label: 'Aleatorio' },
];

let state = null;      // { rows, likesCount, ownPlaylists, scannedAt, scanMs }
let scanning = false;
let filterText = '';
let sortMode = localStorage.getItem(SORT_KEY) || 'recent';
let showingHidden = false;
// Filas efectivamente pintadas, en el orden en que se pintaron. Los handlers
// leen de acá y NO de filtered(): con el orden aleatorio, cada llamada a
// filtered() re-baraja y el índice de la tarjeta apuntaría a otra canción.
let visible = [];

function loadSet(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* lleno */ }
}

let hidden = loadSet(HIDDEN_KEY);

// null = todavía no se configuró nunca (hay que presembrar con los defaults).
function loadExcluded() {
  const raw = localStorage.getItem(EXCLUDED_KEY);
  if (raw == null) return null;
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return null; }
}
function saveExcluded(set) { saveSet(EXCLUDED_KEY, set); }

function normName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Clave de respaldo cuando un track no tiene id de Spotify.
function fallbackKey(name, artist) {
  const n = normText(name);
  const a = normText(artist);
  if (!n || !a) return null;
  return `${n}|${a}`;
}

function firstArtist(t) {
  const a = (t?.artists || [])[0];
  return (a && (a.name || a)) || '';
}

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Sin clasificar' })}
    <div id="sc-content"></div>
  `;
  if (state) {
    renderResults();
    return;
  }
  document.getElementById('sc-content').innerHTML = `
    <div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cruzando tus likes con tus playlists…</div></div>
  `;
  await load({ force: false });
}

// ── Carga y cruce ────────────────────────────────────────────────────────────

async function load({ force }) {
  if (scanning) return;
  scanning = true;
  const t0 = performance.now();
  try {
    // getBestAvailableLikes completa la descarga sola si el caché no está entero
    // (y se cuelga de la carga de otra vista si ya hay una en curso), así que
    // solo hay que darle dónde mostrar el progreso.
    let shownLikesProgress = false;
    const { items: likes } = await getBestAvailableLikes({
      onProgress: ({ loaded, total, cached }) => {
        if (cached) return;
        if (!shownLikesProgress) {
          showProgress('Cargando tus Liked Songs…', 0, 0, { minimized: true });
          shownLikesProgress = true;
        }
        showProgress('Cargando tus Liked Songs…', loaded, total);
      },
    });
    if (shownLikesProgress) hideProgress();

    const me = await getCurrentUserId();
    const playlists = await getAllUserPlaylists();
    const own = playlists.filter(p => p.owner?.id === me);

    let excluded = loadExcluded();
    if (excluded == null) {
      excluded = new Set(own.filter(p => DEFAULT_EXCLUDED_NAMES.includes(normName(p.name))).map(p => p.id));
      saveExcluded(excluded);
    }
    const toScan = own.filter(p => !excluded.has(p.id));

    let cross = force ? null : await idbGetCached(CROSS_KEY).catch(() => null);
    // Si cambió qué playlists entran al cruce, lo cacheado ya no sirve.
    if (cross && cross.scanned?.join(',') !== toScan.map(p => p.id).join(',')) cross = null;

    let scanMs = 0;
    if (!cross) {
      cross = await scanPlaylists(toScan);
      scanMs = Math.round(performance.now() - t0);
      cross.at = Date.now();
      cross.scanMs = scanMs;
      await idbSetCached(CROSS_KEY, cross, CROSS_TTL_MIN).catch(() => {});
    }

    const ids = new Set(cross.ids);
    const keys = new Set(cross.keys);
    const rows = [];
    for (const it of likes) {
      const t = it.track || it;
      if (!t) continue;
      const id = t.id || null;
      const artist = firstArtist(t);
      const key = fallbackKey(t.name, artist);
      // Match por ID; solo si el like no tiene id se compara por nombre+artista.
      const clasificada = id ? ids.has(id) : (key ? keys.has(key) : false);
      if (clasificada) continue;
      const imgs = t.album?.images || [];
      rows.push({
        id: id || key,
        trackId: id,
        uri: t.uri || (id ? `spotify:track:${id}` : null),
        name: t.name || '(sin nombre)',
        artists: (t.artists || []).map(a => a.name || a).join(', '),
        artist,
        album: t.album?.name || '',
        cover: imgs[2]?.url || imgs[1]?.url || imgs[0]?.url || null,
        addedAt: it.added_at || null,
        raw: t,
      });
    }

    state = {
      rows,
      likesCount: likes.length,
      ownPlaylists: own,
      excluded,
      scannedPlaylists: toScan.length,
      skipped: cross.skipped || [],
      at: cross.at,
      scanMs: scanMs || cross.scanMs || 0,
      fromCache: scanMs === 0,
      totalMs: Math.round(performance.now() - t0),
    };
    console.log(`[sin-clasificar] ${rows.length} sin clasificar de ${likes.length} likes · ${state.fromCache ? 'cache' : 'escaneo'} · total ${state.totalMs} ms`);
    renderResults();
  } catch (e) {
    hideProgress();
    if (isCancelled(e)) {
      showToast('Escaneo detenido — lo que se bajó quedó guardado', 'warning');
      const c = document.getElementById('sc-content');
      if (c && !state) c.innerHTML = `<div class="card"><p style="margin:0">Escaneo detenido. Pulsa «Actualizar» para retomarlo.</p></div>`;
      else if (state) renderResults();
    } else {
      console.error('[sin-clasificar]', e);
      const c = document.getElementById('sc-content');
      if (c) c.innerHTML = `<div class="card"><p style="color:var(--color-error)">Error: ${escapeHtml(e.message)}</p></div>`;
      showToast('No se pudo completar el cruce: ' + e.message, 'error');
    }
  } finally {
    scanning = false;
  }
}

// El escaneo se muestra SIEMPRE en el pill chico, para que la app siga usable.
// showProgress cierra el overlay solo si pasan 10 s sin novedades y al cerrarlo
// olvida que estaba minimizado: si no volviéramos a pedirlo, la siguiente
// actualización lo levantaría como overlay grande, tapando la app entera.
function progreso(texto, loaded, total, onCancel) {
  const vivo = document.getElementById('progress-overlay');
  showProgress(texto, loaded, total, vivo ? {} : { minimized: true, onCancel });
}

// Baja las pistas de cada playlist y devuelve los índices del cruce.
// El progreso sale en el pill minimizado para poder seguir usando la app.
async function scanPlaylists(playlists) {
  const ids = new Set();
  const keys = new Set();
  const skipped = [];
  let aborted = false;
  const cancelar = () => { aborted = true; };
  progreso(`Escaneando playlists… (0/${playlists.length})`, 0, playlists.length, cancelar);

  for (let i = 0; i < playlists.length; i++) {
    if (aborted) { hideProgress(); throw new Error('Carga cancelada'); }
    const pl = playlists[i];
    const etiqueta = `Escaneando «${pl.name}»… (${i + 1}/${playlists.length})`;
    progreso(etiqueta, i + 1, playlists.length, cancelar);
    try {
      // El progreso por página no es decorativo: showProgress cierra el pill si
      // pasan 10 s sin novedades, y bajar una playlist grande tarda bastante más.
      const items = await getAllPlaylistItems(pl.id, ({ loaded }) => {
        progreso(`${etiqueta} · ${loaded.toLocaleString('es-ES')} pistas`, i + 1, playlists.length, cancelar);
      });
      for (const item of items) {
        const t = item.item || item.track;
        if (!t) continue;
        if (t.id) ids.add(t.id);
        const k = fallbackKey(t.name, firstArtist(t));
        if (k) keys.add(k);
      }
    } catch (e) {
      // 403/404: playlists de Spotify o borradas. No frenan el escaneo.
      if (/40[34]/.test(e.message)) skipped.push(pl.name);
      else throw e;
    }
    if (i < playlists.length - 1) await new Promise(r => setTimeout(r, SCAN_PAUSE_MS));
  }
  hideProgress();
  if (skipped.length > 0) console.warn('[sin-clasificar] playlists inaccesibles:', skipped);
  return { ids: [...ids], keys: [...keys], scanned: playlists.map(p => p.id), skipped };
}

// ── Render ───────────────────────────────────────────────────────────────────

function filtered() {
  if (!state) return [];
  const q = normText(filterText);
  let rows = state.rows.filter(r => {
    const isHidden = hidden.has(r.id);
    if (showingHidden ? !isHidden : isHidden) return false;
    if (!q) return true;
    return normText(`${r.name} ${r.artists} ${r.album}`).includes(q);
  });
  rows = rows.slice();
  if (sortMode === 'recent') rows.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  else if (sortMode === 'old') rows.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
  else if (sortMode === 'artist') rows.sort((a, b) => a.artist.localeCompare(b.artist, 'es') || (b.addedAt || '').localeCompare(a.addedAt || ''));
  else if (sortMode === 'random') rows.sort(() => Math.random() - 0.5);
  return rows;
}

function renderResults() {
  const content = document.getElementById('sc-content');
  if (!content || !state) return;
  const rows = visible = filtered();
  const hiddenCount = hidden.size;
  // El número grande cuenta lo que queda por clasificar de verdad: el total del
  // cruce menos las que Ian ya ocultó. Antes decía 1.987 mientras el grid
  // pintaba 1.985.
  const sinClasificarCount = state.rows.reduce((n, r) => n + (hidden.has(r.id) ? 0 : 1), 0);
  const fecha = state.at ? new Date(state.at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  content.innerHTML = `
    <div class="sc-topbar">
      <div class="sc-summary">
        <span class="sc-summary-n">${sinClasificarCount.toLocaleString('es-ES')}</span>
        <span class="sc-summary-t">canciones sin clasificar de ${state.likesCount.toLocaleString('es-ES')} likes${hiddenCount > 0 ? ` · ${hiddenCount.toLocaleString('es-ES')} oculta${hiddenCount === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div class="sc-topbar-tools">
        <input type="search" class="input sc-search" id="sc-search" placeholder="Filtrar por artista, título o álbum" value="${escapeHtml(filterText)}" autocomplete="off">
        <select class="sc-select" id="sc-sort" title="Orden de la lista">
          ${SORTS.map(s => `<option value="${s.id}"${s.id === sortMode ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
        ${hiddenCount > 0 || showingHidden ? `
          <button class="btn btn-secondary btn-sm ${showingHidden ? 'sc-on' : ''}" id="sc-toggle-hidden">${showingHidden ? '← Volver' : 'Ocultas (' + hiddenCount + ')'}</button>
        ` : ''}
        <button class="btn btn-secondary btn-sm" id="sc-excluded-btn" title="Elegir qué playlists no cuentan para el cruce">Playlists ignoradas (${state.excluded.size})</button>
        <button class="btn btn-secondary btn-sm" id="sc-refresh-btn" title="Rehacer el cruce ignorando la caché">Actualizar</button>
      </div>
      <div class="sc-note">
        ${state.scannedPlaylists} playlists cruzadas · ${state.fromCache ? `cruce guardado el ${escapeHtml(fecha)}` : `escaneo en ${(state.scanMs / 1000).toFixed(1)} s`}${state.skipped.length ? ` · ${state.skipped.length} inaccesibles` : ''}
      </div>
    </div>
    ${rows.length === 0 ? `
      <div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">
        ${showingHidden ? 'No hay canciones ocultas con este filtro.' : (filterText ? 'Ninguna canción sin clasificar coincide con el filtro.' : 'Todos tus likes están en alguna playlist.')}
      </p></div>
    ` : `
      <div class="sc-grid" id="sc-list">${rows.map((r, i) => renderCard(r, i)).join('')}</div>
    `}
  `;
  wire();
  activateMarquee(content);
}

function fechaLike(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderCard(r, i) {
  return `
    <div class="sc-card" data-i="${i}" data-id="${escapeHtml(r.id)}">
      <div class="sc-card-main">
        ${r.cover
          ? `<img class="sc-cover" src="${r.cover}" alt="" loading="lazy">`
          : `<div class="sc-cover sc-cover-empty">♪</div>`}
        <div class="sc-card-body">
          <div class="sc-info">
            <div class="sc-title">${marqueeSpan(escapeHtml(r.name))}</div>
            <div class="sc-meta">${escapeHtml(r.artists)}</div>
            <div class="sc-meta sc-meta-sub">${escapeHtml(r.album)}${r.addedAt ? ` · ${fechaLike(r.addedAt)}` : ''}</div>
          </div>
          <div class="sc-actions">
            <button class="sc-btn sc-play ${playingKey() === `sc:${r.id}` ? 'playing' : ''}" data-i="${i}" title="Preview de 30 s — no suma reproducciones" aria-label="Preview">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <button class="sc-btn sc-add" data-i="${i}" title="Añadir a una playlist">Añadir a…</button>
            ${r.trackId ? `<a class="sc-btn sc-open" href="https://open.spotify.com/track/${r.trackId}" target="_blank" rel="noopener" title="Abrir en Spotify" aria-label="Abrir en Spotify">↗</a>` : ''}
            <button class="sc-btn sc-hide" data-i="${i}" title="${showingHidden ? 'Devolver a la lista' : 'Ocultar de la lista (no toca Spotify)'}" aria-label="${showingHidden ? 'Devolver' : 'Ocultar'}">
              ${showingHidden
                ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
                : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function wire() {
  const content = document.getElementById('sc-content');
  if (!content) return;

  const search = content.querySelector('#sc-search');
  if (search) {
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        filterText = search.value;
        const pos = search.selectionStart;
        renderResults();
        const nuevo = document.getElementById('sc-search');
        if (nuevo) { nuevo.focus(); nuevo.setSelectionRange(pos, pos); }
      }, 180);
    });
  }

  const sort = content.querySelector('#sc-sort');
  if (sort) sort.onchange = () => {
    sortMode = sort.value;
    localStorage.setItem(SORT_KEY, sortMode);
    renderResults();
  };

  const toggleHidden = content.querySelector('#sc-toggle-hidden');
  if (toggleHidden) toggleHidden.onclick = () => { showingHidden = !showingHidden; renderResults(); };

  const refresh = content.querySelector('#sc-refresh-btn');
  if (refresh) refresh.onclick = async () => {
    if (scanning) return;
    refresh.disabled = true;
    await idbDel(CROSS_KEY).catch(() => {});
    await load({ force: true });
  };

  const excludedBtn = content.querySelector('#sc-excluded-btn');
  if (excludedBtn) excludedBtn.onclick = openExcludedModal;

  content.querySelectorAll('.sc-info').forEach(el => {
    el.classList.add('tc-clickable');
    el.title = 'Ver ficha del tema';
    el.onclick = () => {
      const r = visible[+el.closest('.sc-card').dataset.i];
      if (!r || !r.trackId) return;
      openTrackCard({ id: r.trackId, name: r.name, artist: r.artist, album: r.album, img: r.cover });
    };
  });

  content.querySelectorAll('.sc-play').forEach(btn => {
    btn.onclick = async () => {
      const r = visible[+btn.dataset.i];
      if (!r) return;
      // getPreview tal cual: la verificación título+artista de v=125 vive ahí
      // dentro y es la que garantiza que suene ESTA canción.
      const res = await togglePreview(`sc:${r.id}`, () => getPreview({
        name: r.name,
        artist: r.artist,
        spotifyId: r.trackId || undefined,
      }));
      if (res === null) showToast(`Sin preview disponible de «${r.name}»`, 'info');
    };
  });

  content.querySelectorAll('.sc-hide').forEach(btn => {
    btn.onclick = () => {
      const r = visible[+btn.dataset.i];
      if (!r) return;
      if (hidden.has(r.id)) hidden.delete(r.id);
      else hidden.add(r.id);
      saveSet(HIDDEN_KEY, hidden);
      if (showingHidden && hidden.size === 0) showingHidden = false;
      renderResults();
    };
  });

  content.querySelectorAll('.sc-add').forEach(btn => {
    btn.onclick = () => {
      const r = visible[+btn.dataset.i];
      if (r) openAddModal(r);
    };
  });
}

// Sincroniza el estado de los botones ▶ con el player global.
document.addEventListener('previewchange', (e) => {
  const content = document.getElementById('sc-content');
  if (!content) return;
  const key = e.detail.key || '';
  content.querySelectorAll('.sc-card').forEach(card => {
    const btn = card.querySelector('.sc-play');
    if (btn) btn.classList.toggle('playing', key === `sc:${card.dataset.id}`);
  });
});

// ── Modal "Añadir a…" ────────────────────────────────────────────────────────

function openAddModal(row) {
  const opciones = state.ownPlaylists.filter(p => !state.excluded.has(p.id));
  const overlay = openModal({
    id: 'sc-add',
    html: `
      <div class="modal sc-modal">
        <div class="sc-modal-head">
          <h2 style="margin:0">Añadir a una playlist</h2>
          <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar" aria-label="Cerrar">✕</button>
        </div>
        <p class="sc-modal-sub">${escapeHtml(row.name)} — ${escapeHtml(row.artists)}</p>
        <input type="search" class="input" id="sc-pl-search" placeholder="Buscar playlist" autocomplete="off">
        <div class="sc-pl-list" id="sc-pl-list">
          ${opciones.map(p => `
            <button class="sc-pl-item" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
              ${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : `<span class="sc-pl-ph">♪</span>`}
              <span class="sc-pl-name">${escapeHtml(p.name)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `,
  });

  const list = overlay.querySelector('#sc-pl-list');
  const buscador = overlay.querySelector('#sc-pl-search');
  setTimeout(() => buscador.focus(), 30);
  buscador.addEventListener('input', () => {
    const q = normText(buscador.value);
    list.querySelectorAll('.sc-pl-item').forEach(el => {
      el.hidden = q ? !normText(el.dataset.name).includes(q) : false;
    });
  });

  list.querySelectorAll('.sc-pl-item').forEach(el => {
    el.onclick = async () => {
      if (el.disabled) return;
      list.querySelectorAll('.sc-pl-item').forEach(b => b.disabled = true);
      el.classList.add('loading');
      try {
        await addToPlaylist(row, { id: el.dataset.id, name: el.dataset.name });
        closeTop();
      } catch (e) {
        console.error('[sin-clasificar] añadir falló:', e);
        showToast(`No se pudo añadir «${row.name}»: ${e.message}`, 'error');
        list.querySelectorAll('.sc-pl-item').forEach(b => b.disabled = false);
        el.classList.remove('loading');
      }
    };
  });
}

async function addToPlaylist(row, pl) {
  if (!row.uri) throw new Error('la canción no tiene URI de Spotify');
  const snapshot = await addTracksToPlaylist(pl.id, [row.uri]);

  // Mantenemos vivo el cache de items de esa playlist (si no, el próximo
  // escaneo la re-baja entera).
  try {
    const cached = await idbGetCached(`playlist_items_${pl.id}`);
    if (snapshot && cached && Array.isArray(cached.items)) {
      cached.items.push({ item: { id: row.trackId, uri: row.uri, name: row.name, artists: row.raw?.artists || [] } });
      await updatePlaylistItemsCache(pl.id, cached.items, snapshot);
    } else {
      await updatePlaylistItemsCache(pl.id, null, null);
    }
  } catch {
    await updatePlaylistItemsCache(pl.id, null, null);
  }

  // Ya está clasificada: fuera de la lista y del cruce cacheado.
  state.rows = state.rows.filter(r => r.id !== row.id);
  try {
    const cross = await idbGetCached(CROSS_KEY);
    if (cross) {
      if (row.trackId && !cross.ids.includes(row.trackId)) cross.ids.push(row.trackId);
      const k = fallbackKey(row.name, row.artist);
      if (k && !cross.keys.includes(k)) cross.keys.push(k);
      await idbSetCached(CROSS_KEY, cross, CROSS_TTL_MIN);
    }
  } catch { /* el cruce se rehará al vencer el TTL */ }

  showToast(`«${row.name}» añadida a ${pl.name}`, 'success');
  renderResults();
}

// ── Modal de playlists ignoradas ─────────────────────────────────────────────

function openExcludedModal() {
  const overlay = openModal({
    id: 'sc-excluded',
    html: `
      <div class="modal sc-modal">
        <div class="sc-modal-head">
          <h2 style="margin:0">Playlists ignoradas</h2>
          <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar" aria-label="Cerrar">✕</button>
        </div>
        <p class="sc-modal-sub">Las marcadas no cuentan para el cruce: una canción que esté solo en ellas sigue apareciendo como sin clasificar.</p>
        <div class="sc-pl-list" id="sc-ex-list">
          ${state.ownPlaylists.map(p => `
            <label class="sc-ex-item">
              <input type="checkbox" data-id="${p.id}"${state.excluded.has(p.id) ? ' checked' : ''}>
              ${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : `<span class="sc-pl-ph">♪</span>`}
              <span class="sc-pl-name">${escapeHtml(p.name)}</span>
            </label>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-close-modal>Cancelar</button>
          <button class="btn btn-primary" id="sc-ex-save">Guardar y recalcular</button>
        </div>
      </div>
    `,
  });

  overlay.querySelector('#sc-ex-save').onclick = async () => {
    const nueva = new Set();
    overlay.querySelectorAll('#sc-ex-list input[type=checkbox]').forEach(cb => {
      if (cb.checked) nueva.add(cb.dataset.id);
    });
    const igual = nueva.size === state.excluded.size && [...nueva].every(id => state.excluded.has(id));
    state.excluded = nueva;
    saveExcluded(nueva);
    closeTop();
    if (igual) return;
    document.getElementById('sc-content').innerHTML = `
      <div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Recalculando el cruce…</div></div>
    `;
    await load({ force: true });
  };
}
