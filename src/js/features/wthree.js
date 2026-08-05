// W-Three helper: cruza tu historial con la playlist "w three" (mejores 3 tracks
// por álbum). Muestra qué álbumes ya tienen picks, cuántos, y cuáles te faltan.
// Ordenado por álbumes más escuchados primero para priorizar tu tiempo.

import { spotifyFetch, getAllPlaylistItems, getAllUserPlaylists, addTracksToPlaylist, removeTracksFromPlaylist, reorderPlaylistItems, getPlaylistSnapshotId, getCachedPlaylistSnapshot, updatePlaylistItemsCache } from '../api.js';
import { loadHistoryStats, loadListenedAlbums, isOwner, ownerLockedMessage } from './history-data.js';
import { escapeHtml, pageHeader } from '../ui/components.js';
import { showToast } from '../ui/toast.js';
import { activateMarquee, marqueeSpan } from '../ui/marquee.js';
import { openModal, closeTop, closeById } from '../ui/modal-stack.js';
import { getPreview } from '../api/preview-providers.js';
import { togglePreview, playingKey } from '../ui/preview-player.js';
import { openAlbumCard } from './album-card.js';
import { albumKey } from '../util/album-key.js';
import { computeUpdatedPickPositions } from '../util/reorder-shifts.js';

const LS_KEY_ID = 'wthree_playlist_id';
const LS_KEY_NAME = 'wthree_playlist_name';
const LS_KEY_HIDDEN = 'wthree_hidden_albums';

// ── Estado ──
let playlistId = null;
let playlistName = null;
let picksByAlbum = null;   // Map<key, {name, artist, img, picks:[{name,id,uri,pos}]}>
let albumsList = null;     // [{name, artist, img, min, plays, picks[]}] cross de historial vs playlist
let historyStats = null;
let listenedAlbums = null; // { years: [{ year, albums: [{name, artist, img, date}] }] }
let albumTracksCache = new Map(); // key → tracks fetched from Spotify
let selectedBucket = null; // null = all, o '0'/'1'/'2'/'3'/'4+'
let hiddenSet = null;      // Set<key> de álbumes marcados como "ya está, no me interesa"
let showingHidden = false; // vista invertida (mostrar SOLO los ocultos para restaurarlos)
// Snapshot de la última escritura exitosa desde este cliente. Sirve para que
// el segundo guardado sepa que las posiciones de picksByAlbum son confiables
// (nadie más editó entre medio), sin depender del cache de items que fue
// invalidado post-save. Sin esto, cada guardado forzaría un refetch de 18s.
let lastLocalSnapshot = null;

function loadHidden() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY_HIDDEN)) || [];
    hiddenSet = new Set(arr);
  } catch { hiddenSet = new Set(); }
}
function saveHidden() {
  try { localStorage.setItem(LS_KEY_HIDDEN, JSON.stringify([...hiddenSet])); } catch { /* full */ }
}
function toggleHidden(key) {
  if (!hiddenSet) loadHidden();
  if (hiddenSet.has(key)) hiddenSet.delete(key);
  else hiddenSet.add(key);
  saveHidden();
}

const PLAY_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const DOTS_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

// Cuando el preview global cambia, resetear los ▶/⏸ de la tracklist abierta.
// Los que corresponden al key sonando quedan como ⏸, el resto vuelve a ▶.
document.addEventListener('previewchange', (e) => {
  const key = e.detail?.key || '';
  document.querySelectorAll('.wt-play-btn').forEach(btn => {
    if (btn.disabled) return;
    btn.innerHTML = (key === `wt:${btn.dataset.playId}`) ? PAUSE_SVG : PLAY_SVG;
  });
});

export async function render(container) {
  playlistId = localStorage.getItem(LS_KEY_ID);
  playlistName = localStorage.getItem(LS_KEY_NAME);

  container.innerHTML = `
    ${pageHeader({ title: 'W-Three helper' })}
    <div id="wthree-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  const content = document.getElementById('wthree-content');
  if (!(await isOwner())) {
    content.innerHTML = ownerLockedMessage('W-Three helper');
    return;
  }

  if (!playlistId) {
    await showSetup(content);
  } else {
    await loadAndRender(content);
  }
}

async function showSetup(content) {
  content.innerHTML = `
    <div class="card"><div class="empty-state"><div class="spinner"></div><div style="margin-top:10px">Buscando tus playlists…</div></div></div>
  `;
  let playlists = [];
  try {
    playlists = await getAllUserPlaylists();
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">No pude cargar tus playlists: ${escapeHtml(e.message)}</p></div>`;
    return;
  }

  const guessRe = /(^|[^a-z])(w[\s\-_]*three|w3|wthree)([^a-z]|$)/i;
  const guessed = playlists.filter(p => guessRe.test(p.name)).sort((a, b) => (b.tracks?.total || 0) - (a.tracks?.total || 0));

  content.innerHTML = `
    <div class="card">
      <h3 style="margin:0 0 6px;font-size:16px">Elegí tu playlist "w three"</h3>
      <p style="color:var(--color-text-muted);font-size:13px;margin:0 0 14px">La que usás para juntar las mejores 3 canciones de cada álbum. Se guarda local — podés cambiarla después.</p>
      ${guessed.length ? `
        <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Sugerencias</div>
        <div class="wthree-choice-list">
          ${guessed.slice(0, 4).map(p => `
            <button class="wthree-choice" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
              <div class="wthree-choice-name">${escapeHtml(p.name)}</div>
              <div class="wthree-choice-meta">${p.owner?.display_name || 'vos'}${p.public === false ? ' · privada' : ''}${p.collaborative ? ' · colaborativa' : ''}</div>
            </button>
          `).join('')}
        </div>
        <div style="border-top:1px solid var(--color-border);margin:14px 0"></div>
      ` : ''}
      <details>
        <summary style="cursor:pointer;font-size:13px;color:var(--color-text-secondary);margin-bottom:10px">Ver todas mis playlists (${playlists.length})</summary>
        <div class="wthree-choice-list" style="max-height:300px;overflow-y:auto">
          ${playlists.map(p => `
            <button class="wthree-choice" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
              <div class="wthree-choice-name">${escapeHtml(p.name)}</div>
              <div class="wthree-choice-meta">${p.owner?.display_name || 'vos'}${p.public === false ? ' · privada' : ''}${p.collaborative ? ' · colaborativa' : ''}</div>
            </button>
          `).join('')}
        </div>
      </details>
    </div>
  `;

  content.querySelectorAll('.wthree-choice').forEach(btn => {
    btn.onclick = () => {
      playlistId = btn.dataset.id;
      playlistName = btn.dataset.name;
      localStorage.setItem(LS_KEY_ID, playlistId);
      localStorage.setItem(LS_KEY_NAME, playlistName);
      loadAndRender(content);
    };
  });
}

async function loadAndRender(content) {
  content.innerHTML = `<div class="card"><div class="empty-state"><div class="spinner"></div><div style="margin-top:10px">Cargando "${escapeHtml(playlistName || 'playlist')}" y tu historial…</div></div></div>`;

  try {
    const [items, stats, listened] = await Promise.all([
      getAllPlaylistItems(playlistId),
      loadHistoryStats(),
      loadListenedAlbums().catch(() => null),
    ]);
    historyStats = stats;
    listenedAlbums = listened;
    buildAlbumIndex(items);
    crossWithHistory(stats, listened);
    renderBuckets(content);
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">Error: ${escapeHtml(e.message)}</p><button class="btn btn-secondary btn-sm" id="wthree-reset" style="margin-top:8px">Elegir otra playlist</button></div>`;
    document.getElementById('wthree-reset')?.addEventListener('click', reset);
  }
}

function reset() {
  localStorage.removeItem(LS_KEY_ID);
  localStorage.removeItem(LS_KEY_NAME);
  playlistId = null;
  playlistName = null;
  const content = document.getElementById('wthree-content');
  if (content) showSetup(content);
}

function buildAlbumIndex(items) {
  picksByAlbum = new Map();
  items.forEach((it, i) => {
    const t = it.item || it.track;
    if (!t || !t.album) return;
    const artistName = t.artists?.[0]?.name || '';
    const key = albumKey(t.album.name, artistName);
    if (!picksByAlbum.has(key)) {
      picksByAlbum.set(key, {
        name: t.album.name,
        artist: artistName,
        img: t.album.images?.[1]?.url || t.album.images?.[0]?.url || '',
        albumId: t.album.id,
        picks: [],
      });
    }
    // pos = índice 0-based en la playlist. Sirve para insertar la nueva
    // canción del mismo álbum en (maxPos + 1), no al final.
    picksByAlbum.get(key).picks.push({ name: t.name, id: t.id, uri: t.uri, pos: i });
  });
}

function crossWithHistory(stats, listened) {
  const albums = [];
  const seen = new Set();

  // 1. Álbumes del top historial (con minutos + plays)
  for (const a of (stats?.top_albums_all_time || [])) {
    const key = albumKey(a.name, a.artist);
    seen.add(key);
    const info = picksByAlbum.get(key);
    albums.push({
      name: a.name,
      artist: a.artist,
      img: a.img,
      min: a.min || 0,
      plays: a.plays || 0,
      picks: info ? info.picks : [],
      albumId: info?.albumId,
      source: 'history',
    });
  }

  // 2. Álbumes escuchados detectados (listened_albums) que no estén en el top
  //    (te dan una lista más amplia — no solo los más escuchados)
  if (listened?.years) {
    for (const y of listened.years) {
      for (const a of (y.albums || [])) {
        const key = albumKey(a.name, a.artist);
        if (seen.has(key)) continue;
        seen.add(key);
        const info = picksByAlbum.get(key);
        albums.push({
          name: a.name,
          artist: a.artist,
          img: a.img || info?.img,
          min: 0,
          plays: 0,
          detectedIn: y.year,
          picks: info ? info.picks : [],
          albumId: info?.albumId,
          source: 'listened',
        });
      }
    }
  }

  // 3. Álbumes que solo están en la playlist (ni en top ni en listened)
  for (const [key, info] of picksByAlbum) {
    if (seen.has(key)) continue;
    albums.push({
      name: info.name,
      artist: info.artist,
      img: info.img,
      min: 0,
      plays: 0,
      picks: info.picks,
      albumId: info.albumId,
      source: 'playlist',
    });
  }

  // Ordenar: primero picks ASC (menos picks = más prioridad),
  // luego minutos DESC, luego año detectado DESC (más reciente primero)
  albums.sort((a, b) =>
    a.picks.length - b.picks.length
    || b.min - a.min
    || (b.detectedIn || 0) - (a.detectedIn || 0)
  );
  albumsList = albums;
}

function renderBuckets(content) {
  if (!hiddenSet) loadHidden();

  // "Ocultos" NO cuentan en los buckets normales — desaparecen de la vista y
  // de los contadores. En la vista invertida (showingHidden) mostramos SOLO
  // esos, con el botón invertido para restaurarlos.
  const visible = showingHidden
    ? albumsList.filter(a => hiddenSet.has(albumKey(a.name, a.artist)))
    : albumsList.filter(a => !hiddenSet.has(albumKey(a.name, a.artist)));

  const buckets = { '0': [], '1': [], '2': [], '3': [], '4+': [] };
  for (const a of visible) {
    const n = a.picks.length;
    if (n === 0) buckets['0'].push(a);
    else if (n === 1) buckets['1'].push(a);
    else if (n === 2) buckets['2'].push(a);
    else if (n === 3) buckets['3'].push(a);
    else buckets['4+'].push(a);
  }

  // Meta info: fuentes de datos (sobre el conjunto visible)
  const historyCount = visible.filter(a => a.source === 'history').length;
  const listenedCount = visible.filter(a => a.source === 'listened').length;
  const hiddenCount = hiddenSet.size;

  const isSel = (k) => selectedBucket === k;
  const bucketDef = [
    { key: '0', label: '🔴 sin picks', cls: 'wthree-stat-danger', count: buckets['0'].length },
    { key: '1', label: '🟠 con 1', cls: '', count: buckets['1'].length },
    { key: '2', label: '🟡 con 2', cls: '', count: buckets['2'].length },
    { key: '3', label: '✅ completos', cls: 'wthree-stat-ok', count: buckets['3'].length },
    { key: '4+', label: '⚠️ más de 3', cls: 'wthree-stat-warn', count: buckets['4+'].length },
  ];

  const hiddenToggle = (hiddenCount > 0 && !showingHidden)
    ? `<button class="btn btn-secondary btn-sm" id="wthree-show-hidden" title="Ver los que ocultaste">👁️‍🗨️ Ocultos (${hiddenCount})</button>`
    : '';

  content.innerHTML = `
    <div class="wthree-header">
      <div class="wthree-header-name">
        <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em">Playlist activa</div>
        <div style="font-size:15px;font-weight:600">${escapeHtml(playlistName || 'w three')}</div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        ${hiddenToggle}
        <button class="btn btn-secondary btn-sm" id="wthree-change">Cambiar</button>
      </div>
    </div>

    ${showingHidden ? `
      <div class="wthree-filter-active">
        Mostrando <strong>solo los ocultos</strong> (${hiddenCount})
        <button class="wthree-clear-filter" id="wthree-back-to-all">✕ Volver a la lista</button>
      </div>
    ` : ''}

    <div class="wthree-summary">
      ${bucketDef.map(b => `
        <button class="wthree-stat ${b.cls} ${isSel(b.key) ? 'wthree-stat-active' : ''}" data-bucket="${b.key}">
          <div class="wthree-stat-v">${b.count}</div>
          <div class="wthree-stat-l">${b.label}</div>
        </button>
      `).join('')}
    </div>

    ${selectedBucket ? `
      <div class="wthree-filter-active">
        Mostrando solo: <strong>${bucketDef.find(b => b.key === selectedBucket)?.label}</strong>
        <button class="wthree-clear-filter" id="wthree-clear-filter">✕ Ver todos</button>
      </div>
    ` : ''}

    ${!selectedBucket || selectedBucket === '0' ? renderBucket('🔴 Sin picks — priorizados por tiempo escuchado', buckets['0'], 'danger', selectedBucket === '0' ? 999 : 20) : ''}
    ${!selectedBucket || selectedBucket === '1' ? renderBucket('🟠 Con 1 pick — completar', buckets['1'], '', selectedBucket === '1' ? 999 : 15) : ''}
    ${!selectedBucket || selectedBucket === '2' ? renderBucket('🟡 Con 2 picks — falta uno', buckets['2'], '', selectedBucket === '2' ? 999 : 15) : ''}
    ${!selectedBucket || selectedBucket === '3' ? renderBucket('✅ Ya con 3', buckets['3'], 'ok', selectedBucket === '3' ? 999 : 10) : ''}
    ${buckets['4+'].length && (!selectedBucket || selectedBucket === '4+') ? renderBucket('⚠️ Más de 3 picks — sacar alguno?', buckets['4+'], 'warn', selectedBucket === '4+' ? 999 : 10) : ''}

    <div style="font-size:11px;color:var(--color-text-muted);margin-top:14px;text-align:center">
      ${historyCount} álbumes del top historial${listenedCount ? ` · ${listenedCount} más detectados en tu historial de escucha` : ''} · ${picksByAlbum.size} álbumes en la playlist${hiddenCount && !showingHidden ? ` · ${hiddenCount} oculto${hiddenCount === 1 ? '' : 's'}` : ''}
    </div>
  `;

  document.getElementById('wthree-change').onclick = reset;
  document.getElementById('wthree-clear-filter')?.addEventListener('click', () => {
    selectedBucket = null;
    renderBuckets(content);
  });
  document.getElementById('wthree-show-hidden')?.addEventListener('click', () => {
    showingHidden = true;
    selectedBucket = null;
    renderBuckets(content);
  });
  document.getElementById('wthree-back-to-all')?.addEventListener('click', () => {
    showingHidden = false;
    selectedBucket = null;
    renderBuckets(content);
  });
  content.querySelectorAll('[data-bucket]').forEach(btn => {
    btn.onclick = () => {
      selectedBucket = selectedBucket === btn.dataset.bucket ? null : btn.dataset.bucket;
      renderBuckets(content);
      // Scroll al primer bucket después del cambio
      if (selectedBucket) content.querySelector('.wthree-bucket')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
  wireAlbumClicks(content);
  activateMarquee(content);
}

function renderBucket(title, albums, kind, limit) {
  if (!albums.length) return '';
  const items = albums.slice(0, limit);
  const rest = albums.length - items.length;
  return `
    <div class="card wthree-bucket wthree-bucket-${kind}">
      <div class="wthree-bucket-head">
        <h3>${title}</h3>
        <span class="wthree-bucket-count">${albums.length}</span>
      </div>
      <div class="wthree-album-list">
        ${items.map((a, i) => renderAlbumRow(a, kind)).join('')}
      </div>
      ${rest > 0 ? `<button class="btn btn-secondary btn-sm" style="margin-top:10px" data-more="${title}">Ver ${rest} más</button>` : ''}
    </div>
  `;
}

function renderAlbumRow(a, kind) {
  const key = albumKey(a.name, a.artist);
  const isHidden = hiddenSet && hiddenSet.has(key);
  const badge = a.picks.length === 0
    ? `<span class="wthree-pill wthree-pill-danger">0 / 3</span>`
    : a.picks.length === 3
      ? `<span class="wthree-pill wthree-pill-ok">✓ 3 / 3</span>`
      : a.picks.length > 3
        ? `<span class="wthree-pill wthree-pill-warn">${a.picks.length} / 3</span>`
        : `<span class="wthree-pill">${a.picks.length} / 3</span>`;

  // Ojo tachado = ocultar; ojo normal = mostrar de vuelta (en la vista invertida).
  const eyeOpen = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const eyeOff = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
  const hideBtn = `<button class="wthree-hide-btn" data-hide-key="${escapeHtml(key)}" title="${isHidden ? 'Restaurar en la lista' : 'Ocultar este álbum'}" aria-label="${isHidden ? 'Restaurar' : 'Ocultar'}">${isHidden ? eyeOpen : eyeOff}</button>`;

  return `
    <div class="wthree-album-row" data-album-key="${escapeHtml(key)}">
      ${a.img
        ? `<img src="${a.img}" alt="" class="wthree-album-cover" loading="lazy">`
        : `<div class="wthree-album-cover wthree-album-cover-empty">♪</div>`}
      <div class="wthree-album-info">
        <div class="wthree-album-name">${marqueeSpan(escapeHtml(a.name))}</div>
        <div class="wthree-album-artist">${marqueeSpan(escapeHtml(a.artist))}</div>
        ${a.min > 0 ? `<div class="wthree-album-meta">${fmtMinutesShort(a.min)} · ${a.plays} plays</div>` : `<div class="wthree-album-meta" style="opacity:0.6">${a.detectedIn ? `escuchado en ${a.detectedIn} · fuera del top 1000` : 'fuera del top / de la playlist'}</div>`}
      </div>
      ${badge}
      ${hideBtn}
    </div>
  `;
}

function fmtMinutesShort(min) {
  if (min >= 60) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  return `${Math.round(min)}m`;
}

function wireAlbumClicks(root) {
  root.querySelectorAll('.wthree-album-row').forEach(el => {
    el.onclick = () => {
      const key = el.dataset.albumKey;
      const a = albumsList.find(x => albumKey(x.name, x.artist) === key);
      if (a) openAlbumModal(a);
    };
  });
  // Botón "ocultar / restaurar" por fila — stopPropagation para no abrir el modal.
  root.querySelectorAll('.wthree-hide-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.hideKey;
      const wasHidden = hiddenSet.has(key);
      toggleHidden(key);
      // Si estábamos en la vista invertida y ya no quedan ocultos, volvemos a la
      // vista normal para no dejar al usuario mirando una lista vacía.
      if (showingHidden && hiddenSet.size === 0) showingHidden = false;
      showToast(wasHidden ? 'Álbum restaurado en la lista' : 'Álbum ocultado', 'info');
      renderBuckets(root);
    });
  });
  // "Ver N más" buttons — no implementado por ahora (MVP)
  root.querySelectorAll('[data-more]').forEach(btn => {
    btn.onclick = () => {
      showToast('Próximamente: ver todos los álbumes del bucket', 'info');
    };
  });
}

// ── Modal por álbum: lista tracks del álbum con picks marcados y sugerencias ──

async function openAlbumModal(a) {
  const modalId = 'wthree-album-modal';
  closeById(modalId);

  // Estructura v=114: modal ancho (760px) ≤85vh con 3 zonas verticales:
  // 1. Header full-width (chip w-three · álbum + tapa chica + nombre/artista + meta).
  // 2. Body en 2 columnas grid:
  //    · IZQUIERDA: tracklist con scroll interno + botón "agregar sugeridos".
  //    · DERECHA: panel de orden con scroll interno.
  //    Debajo de 900px se apilan.
  // 3. Footer full-width con "Guardar cambios" — cruza las 2 columnas.
  // El .wt-modal en sí NUNCA se scrollea — todo el scroll vive DENTRO de cada
  // columna. El panel de orden queda visible SIN scrollear el modal.
  const coverImg = a.img
    ? `<img src="${a.img}" alt="" class="wt-cover">`
    : `<div class="wt-cover wt-cover-empty">♪</div>`;

  const overlay = openModal({
    id: modalId,
    html: `
    <div class="modal wt-modal">
      <div class="wt-head">
        <div class="wt-head-top">
          <div class="card-modal-eyebrow">W-Three · álbum</div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn btn-secondary btn-sm" id="wt-hide-album" title="Ocultar este álbum de la lista" aria-label="Ocultar álbum">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
            </button>
            <button class="btn btn-secondary btn-sm card-modal-close" data-close-modal>✕</button>
          </div>
        </div>
        <div class="wt-head-body">
          <button class="wt-cover-btn" id="wt-open-album" type="button" title="Ver ficha del álbum">${coverImg}</button>
          <div class="wt-head-info">
            <button class="wt-title-btn" id="wt-open-album-name" type="button">${escapeHtml(a.name)}</button>
            <div class="wt-artist">${escapeHtml(a.artist)}</div>
            <div class="wt-meta" id="wt-meta">Cargando…</div>
          </div>
        </div>
      </div>
      <div class="wt-body" id="wt-body">
        <div style="text-align:center;padding:24px;grid-column:1/-1"><div class="spinner"></div></div>
      </div>
      <div class="wt-footer">
        <button class="btn btn-primary" id="wt-save" disabled>Cargando…</button>
      </div>
    </div>
  `,
  });

  // C1: clic en tapa o nombre del álbum → ficha de álbum APILADA encima.
  const openAlbumFicha = () => openAlbumCard({
    name: a.name, artist: a.artist, img: a.img,
    plays: a.plays || 0, min: a.min || 0,
  });
  overlay.querySelector('#wt-open-album').onclick = openAlbumFicha;
  overlay.querySelector('#wt-open-album-name').onclick = openAlbumFicha;

  overlay.querySelector('#wt-hide-album').onclick = () => {
    const key = albumKey(a.name, a.artist);
    const wasHidden = hiddenSet.has(key);
    toggleHidden(key);
    if (showingHidden && hiddenSet.size === 0) showingHidden = false;
    showToast(wasHidden ? 'Álbum restaurado en la lista' : 'Álbum ocultado', 'info');
    closeById(modalId);
    const content = document.getElementById('wthree-content');
    if (content) renderBuckets(content);
  };

  const body = overlay.querySelector('#wt-body');
  const saveBtn = overlay.querySelector('#wt-save');
  const metaEl = overlay.querySelector('#wt-meta');

  const tracks = await fetchAlbumTracks(a);
  if (!tracks.length) {
    metaEl.textContent = `${a.picks.length} en w-three`;
    body.innerHTML = `<p style="color:var(--color-text-muted);text-align:center;padding:16px;grid-column:1/-1">No pude cargar las pistas del álbum desde Spotify. Ya está: ${a.picks.length} pick${a.picks.length === 1 ? '' : 's'}.</p>`;
    saveBtn.textContent = 'Cerrar';
    saveBtn.disabled = false;
    saveBtn.onclick = () => closeById(modalId);
    return;
  }

  // Cruzar con historial: cuántas plays de cada track (aproximado — de top_tracks_all_time)
  const playsByTrackName = new Map();
  for (const t of (historyStats?.top_tracks_all_time || [])) {
    if ((t.artist || '').toLowerCase() === (a.artist || '').toLowerCase()) {
      const norm = (t.name || '').toLowerCase().replace(/\s*\(.*?\)|\s*\[.*?\]/g, '').trim();
      playsByTrackName.set(norm, (playsByTrackName.get(norm) || 0) + (t.plays || 0));
    }
  }
  for (const y of (historyStats?.years || [])) {
    for (const t of (y.top_tracks || [])) {
      if ((t.artist || '').toLowerCase() !== (a.artist || '').toLowerCase()) continue;
      const norm = (t.name || '').toLowerCase().replace(/\s*\(.*?\)|\s*\[.*?\]/g, '').trim();
      if (!playsByTrackName.has(norm)) playsByTrackName.set(norm, t.plays || 0);
    }
  }

  const pickIds = new Set(a.picks.map(p => p.id));
  const trackData = tracks.map(t => {
    const norm = (t.name || '').toLowerCase().replace(/\s*\(.*?\)|\s*\[.*?\]/g, '').trim();
    return {
      id: t.id,
      uri: t.uri,
      name: t.name,
      plays: playsByTrackName.get(norm) || 0,
      picked: pickIds.has(t.id),
    };
  });

  const missingSlots = Math.max(0, 3 - a.picks.length);
  const suggestions = trackData
    .filter(t => !t.picked && t.plays > 0)
    .sort((x, y) => y.plays - x.plays)
    .slice(0, missingSlots)
    .map(t => t.id);
  const suggestedSet = new Set(suggestions);

  const origOrder = [...a.picks].sort((x, y) => (x.pos ?? 0) - (y.pos ?? 0));
  let orderedPicks = origOrder.map(p => ({ id: p.id, uri: p.uri, name: p.name }));

  metaEl.textContent = `${tracks.length} pistas · ${a.picks.length} en w-three${suggestions.length ? ` · 💡 ${suggestions.length} sugerido${suggestions.length === 1 ? '' : 's'}` : ''}`;

  // Tracklist en 2 columnas cuando hay ≥6 pistas (con <6 no vale la pena).
  // grid-auto-flow: column necesita saber cuántas filas por columna → ceil(N/2).
  const useCols = trackData.length >= 6;
  const rowsPerCol = Math.ceil(trackData.length / 2);
  body.innerHTML = `
    <div class="wt-col wt-col-left">
      <div class="wt-section-title">Pistas del álbum</div>
      <div class="wthree-tracklist wt-tracklist ${useCols ? 'wt-tracklist-cols' : ''}" style="--wt-track-rows:${rowsPerCol}">
        ${trackData.map((t, i) => `
          <label class="wthree-track ${t.picked ? 'wthree-track-picked' : ''} ${suggestedSet.has(t.id) ? 'wthree-track-suggested' : ''}">
            <input type="checkbox" class="wthree-track-check" data-id="${t.id}" data-uri="${t.uri}" data-name="${escapeHtml(t.name)}" ${t.picked ? 'checked' : ''}>
            <span class="wthree-track-num">${i + 1}</span>
            <span class="wthree-track-name">${escapeHtml(t.name)}</span>
            <span class="wthree-track-plays">${t.plays > 0 ? t.plays : ''}</span>
            <button type="button" class="wt-play-btn" data-play-id="${t.id}" data-play-name="${escapeHtml(t.name)}" title="Preview 30s" aria-label="Preview de ${escapeHtml(t.name)}">${PLAY_SVG}</button>
          </label>
        `).join('')}
      </div>
      ${suggestions.length > 0 ? `<button class="btn btn-secondary btn-sm wt-suggest-btn" id="wt-add-suggested">Añadir los ${suggestions.length} sugeridos</button>` : ''}
    </div>
    <div class="wt-col wt-col-right">
      <div class="wt-section-title">Orden dentro del álbum</div>
      <div class="wthree-order-panel" id="wt-order-panel"></div>
    </div>
  `;

  saveBtn.textContent = 'Guardar cambios';
  saveBtn.disabled = false;

  const orderPanel = overlay.querySelector('#wt-order-panel');

  function renderOrderPanel() {
    if (orderedPicks.length === 0) {
      orderPanel.innerHTML = `<div class="wt-order-empty">Marca pistas a la izquierda para elegir el orden.</div>`;
      return;
    }
    // ⬆⬇ solo en mobile (touch, drag HTML5 no anda). En desktop se arrastra.
    orderPanel.innerHTML = `
      <div class="wthree-order-hint">1.ª = la que más te gusta · <span class="wt-order-hint-desktop">arrastra para reordenar</span><span class="wt-order-hint-mobile">usa ▲▼</span></div>
      <div class="wthree-order-list wt-order-scroll" id="wt-order-list">
        ${orderedPicks.map((p, i) => `
          <div class="wthree-order-item" data-id="${p.id}" data-i="${i}" draggable="true">
            <span class="wthree-order-drag" aria-hidden="true" title="Arrastra para reordenar">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
            </span>
            <span class="wthree-order-rank">${i + 1}</span>
            <span class="wthree-order-name">${escapeHtml(p.name || '')}</span>
            <button class="wthree-order-btn wthree-order-mobile-only" data-move="up" data-i="${i}" title="Subir" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="wthree-order-btn wthree-order-mobile-only" data-move="down" data-i="${i}" title="Bajar" ${i === orderedPicks.length - 1 ? 'disabled' : ''}>▼</button>
          </div>
        `).join('')}
      </div>
    `;
    orderPanel.querySelectorAll('[data-move]').forEach(btn => {
      btn.onclick = () => {
        const i = +btn.dataset.i;
        const dir = btn.dataset.move === 'up' ? -1 : 1;
        const j = i + dir;
        if (j < 0 || j >= orderedPicks.length) return;
        [orderedPicks[i], orderedPicks[j]] = [orderedPicks[j], orderedPicks[i]];
        renderOrderPanel();
      };
    });
    wireOrderDragDrop();
  }

  // HTML5 drag & drop nativo. La fila se hace draggable, y sobre las demás
  // filas manejamos dragover para pintar un indicador (línea horizontal arriba
  // o abajo). Al dropear, movemos el pick a la nueva posición.
  function wireOrderDragDrop() {
    const list = orderPanel.querySelector('#wt-order-list');
    if (!list) return;
    let draggingFrom = -1;

    const clearIndicators = () => {
      list.querySelectorAll('.wthree-order-item.drop-above, .wthree-order-item.drop-below')
        .forEach(el => el.classList.remove('drop-above', 'drop-below'));
    };

    list.querySelectorAll('.wthree-order-item').forEach(item => {
      item.addEventListener('dragstart', (e) => {
        draggingFrom = +item.dataset.i;
        item.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(draggingFrom)); } catch { /* Safari */ }
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('is-dragging');
        clearIndicators();
        draggingFrom = -1;
      });
      item.addEventListener('dragover', (e) => {
        if (draggingFrom < 0) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = item.getBoundingClientRect();
        const isTop = (e.clientY - rect.top) < rect.height / 2;
        clearIndicators();
        item.classList.add(isTop ? 'drop-above' : 'drop-below');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drop-above', 'drop-below');
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        if (draggingFrom < 0) return;
        const overIdx = +item.dataset.i;
        const rect = item.getBoundingClientRect();
        const isTop = (e.clientY - rect.top) < rect.height / 2;
        let insertAt = isTop ? overIdx : overIdx + 1;
        // Si soltás sobre vos mismo (o adyacente en la misma dirección), no hay cambio.
        if (insertAt === draggingFrom || insertAt === draggingFrom + 1) {
          clearIndicators();
          return;
        }
        const moving = orderedPicks[draggingFrom];
        orderedPicks.splice(draggingFrom, 1);
        // El splice previo shiftea si se saca antes del target.
        if (draggingFrom < insertAt) insertAt--;
        orderedPicks.splice(insertAt, 0, moving);
        renderOrderPanel();
      });
    });
  }

  renderOrderPanel();

  // Toggle checkbox → actualizar orderedPicks + meta.
  const updateMeta = () => {
    metaEl.textContent = `${tracks.length} pistas · ${orderedPicks.length} en w-three${suggestions.length ? ` · 💡 ${suggestions.length} sugerido${suggestions.length === 1 ? '' : 's'}` : ''}`;
  };
  body.querySelectorAll('.wthree-track-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      const uri = cb.dataset.uri;
      const name = cb.dataset.name;
      if (cb.checked) {
        if (!orderedPicks.some(p => p.id === id)) orderedPicks.push({ id, uri, name });
      } else {
        orderedPicks = orderedPicks.filter(p => p.id !== id);
      }
      updateMeta();
      renderOrderPanel();
    });
  });

  // C2: ▶ preview por track (cadena de proveedores). stopPropagation para
  // que el click en el botón NO togglee el checkbox del <label> padre.
  body.querySelectorAll('.wt-play-btn').forEach(btn => {
    const id = btn.dataset.playId;
    const name = btn.dataset.playName;
    const setLabel = () => {
      btn.innerHTML = playingKey() === `wt:${id}` ? PAUSE_SVG : PLAY_SVG;
    };
    setLabel();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.innerHTML = DOTS_SVG;
      const res = await togglePreview(`wt:${id}`, async () => {
        return await getPreview({ name, artist: a.artist, spotifyId: id });
      });
      if (res === true) btn.innerHTML = PAUSE_SVG;
      else if (res === null) { btn.textContent = '—'; btn.title = 'Sin preview'; btn.disabled = true; }
      else btn.innerHTML = PLAY_SVG;
    });
  });

  const addBtn = overlay.querySelector('#wt-add-suggested');
  if (addBtn) {
    addBtn.onclick = () => {
      suggestions.forEach(id => {
        const cb = body.querySelector(`.wthree-track-check[data-id="${id}"]`);
        if (cb && !cb.checked) {
          cb.checked = true;
          cb.dispatchEvent(new Event('change'));
        }
      });
      showToast('Marcados. Ajustá el orden si querés y apretá "Guardar cambios".', 'info');
    };
  }

  saveBtn.onclick = () => applyChanges(a, saveBtn, orderedPicks, origOrder);
}

async function fetchAlbumTracks(a) {
  const key = albumKey(a.name, a.artist);
  if (albumTracksCache.has(key)) return albumTracksCache.get(key);

  let albumId = a.albumId;
  // Si no tenemos albumId (álbum sólo estaba en historial, no en playlist), buscar en Spotify
  if (!albumId) {
    try {
      const q = `album:"${a.name.replace(/"/g, '')}" artist:"${a.artist.replace(/"/g, '')}"`;
      const res = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=album&limit=1`);
      albumId = res?.albums?.items?.[0]?.id;
    } catch { /* noop */ }
  }
  if (!albumId) { albumTracksCache.set(key, []); return []; }

  try {
    const res = await spotifyFetch(`/albums/${albumId}/tracks?limit=50`);
    const items = res?.items || [];
    albumTracksCache.set(key, items);
    return items;
  } catch {
    albumTracksCache.set(key, []);
    return [];
  }
}

// Reorder mínimo (v=112): en vez de borrar todos los picks y re-insertar el
// orden nuevo, calculamos la mínima secuencia de PUT /playlists/{id}/items
// para mover pick-por-pick al lugar correcto. Cada PUT trae snapshot_id que
// encadenamos. Las posiciones son ABSOLUTAS en la playlist entera —
// recalculamos entre movimientos porque los items intermedios shiftean.
//
// Algoritmo (greedy, óptimo para permutaciones): para cada índice target
// en orden ascendente, si el track deseado no está ya en su lugar, lo
// movemos desde su posición actual a la target. Simulamos el nuevo estado
// para saber las posiciones absolutas del siguiente pick a mover.
//
// Devuelve `working` con posiciones absolutas post-reorder — el caller lo
// necesita para verify y para no ensuciar picksByAlbum con posiciones stale.
async function reorderPicksMinimal(picks, targetOrder, initialSnapshot) {
  const working = picks.map(p => ({ ...p }));
  let snapshot = initialSnapshot;
  let moveCount = 0;

  console.info('[wthree] reorder start · picks:', working.map(p => `${shortId(p.id)}@${p.pos}`).join(' | '),
    '· target:', targetOrder.map(id => shortId(id)).join(' | '),
    '· snapshot:', shortSnap(snapshot));

  for (let target = 0; target < targetOrder.length; target++) {
    const wantedId = targetOrder[target];
    const currentIdx = working.findIndex((p, i) => i >= target && p.id === wantedId);
    if (currentIdx === -1 || currentIdx === target) continue;

    const fromPos = working[currentIdx].pos;
    const toPos = working[target].pos;
    // insert_before es exclusivo: para bajar (fromPos<toPos) hay que apuntar
    // a toPos+1; para subir, a toPos directo.
    const insert_before = fromPos < toPos ? toPos + 1 : toPos;

    const body = { range_start: fromPos, insert_before, range_length: 1, snapshot_id: snapshot };
    console.info(`[wthree] PUT #${moveCount + 1} · move "${working[currentIdx].name}" (${shortId(wantedId)}) from ${fromPos} → before ${insert_before} · snapshot in: ${shortSnap(snapshot)}`);

    const newSnap = await reorderPlaylistItems(playlistId, body);
    console.info(`[wthree] PUT #${moveCount + 1} done · snapshot out: ${shortSnap(newSnap)}`);
    snapshot = newSnap;
    moveCount++;

    // Simular el nuevo estado. Los picks entre fromPos y toPos shiftean.
    const [moved] = working.splice(currentIdx, 1);
    working.splice(target, 0, moved);
    if (fromPos < toPos) {
      working.forEach(p => { if (p !== moved && p.pos > fromPos && p.pos <= toPos) p.pos -= 1; });
    } else {
      working.forEach(p => { if (p !== moved && p.pos >= toPos && p.pos < fromPos) p.pos += 1; });
    }
    moved.pos = toPos;

    console.info(`[wthree] simulated state: ${working.map(p => `${shortId(p.id)}@${p.pos}`).join(' | ')}`);
  }

  return { snapshot, moveCount, workingPicks: working };
}

function shortId(id) { return id ? String(id).slice(0, 6) : '??'; }
function shortSnap(s) { return s ? String(s).slice(0, 8) + '…' : 'null'; }
function shortUri(u) { return u ? String(u).split(':').pop().slice(0, 6) : '??'; }

// Dada la playlist entera (freshItems) y las URIs de los picks de este álbum,
// devuelve los picks con sus posiciones absolutas ordenados por posición.
function locatePicksInPlaylist(freshItems, pickUris) {
  const set = new Set(pickUris);
  const found = [];
  freshItems.forEach((it, i) => {
    const t = it.item || it.track;
    if (t && set.has(t.uri)) found.push({ id: t.id, uri: t.uri, name: t.name, pos: i });
  });
  found.sort((x, y) => x.pos - y.pos);
  return found;
}

// Verificación honesta post-guardado: un GET dirigido al rango donde deberían
// estar los picks. Barato (1 request, hasta 50 items) vs refetchear los ~2000
// tracks de la playlist. Confirma que Spotify quedó como esperamos antes de
// decirle al user "guardado".
async function verifyAlbumOrderAtRange(playlistId, expectedUris, offset, limit) {
  const data = await spotifyFetch(`/playlists/${playlistId}/items?offset=${offset}&limit=${limit}`);
  const items = (data?.items || []);
  const expected = new Set(expectedUris);
  const gotInOrder = items
    .map(it => (it.item || it.track)?.uri)
    .filter(u => u && expected.has(u));
  if (gotInOrder.length !== expectedUris.length) return { ok: false, got: gotInOrder };
  for (let i = 0; i < expectedUris.length; i++) {
    if (gotInOrder[i] !== expectedUris[i]) return { ok: false, got: gotInOrder };
  }
  return { ok: true, got: gotInOrder };
}

async function applyChanges(a, saveBtn, orderedPicks, origOrder) {
  const origIds = origOrder.map(p => p.id);
  const newIds = orderedPicks.map(p => p.id);

  const toRemoveUris = origOrder.filter(p => !newIds.includes(p.id)).map(p => p.uri);
  const toAddUris = orderedPicks.filter(p => !origIds.includes(p.id)).map(p => p.uri);

  const keptOrig = origIds.filter(id => newIds.includes(id));
  const keptNew = newIds.filter(id => origIds.includes(id));
  const orderChanged = keptOrig.length > 0 && keptOrig.some((id, i) => id !== keptNew[i]);

  const noChanges = toAddUris.length === 0 && toRemoveUris.length === 0 && !orderChanged;
  if (noChanges) {
    showToast('No hay cambios', 'info');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';
  const t0 = performance.now();
  let apiCalls = 0;
  let moveCount = 0;

  console.info(`[wthree] applyChanges · álbum "${a.name}" · origOrder:`,
    origOrder.map(p => `${shortId(p.id)}@${p.pos} (${p.name})`).join(' | '));
  console.info('[wthree] target orderedPicks:',
    orderedPicks.map(p => `${shortId(p.id)} (${p.name})`).join(' | '));
  console.info(`[wthree] diff · +${toAddUris.length} · -${toRemoveUris.length} · orderChanged=${orderChanged}`);

  try {
    // 0. Snapshot check: si el server cambió desde que cargamos el modal
    //    (o no tenemos cache), refetch para tener posiciones reales. Sin
    //    cache no podemos asumir que las posiciones de origOrder siguen válidas.
    let workingPicks = origOrder.map(p => ({ id: p.id, uri: p.uri, name: p.name, pos: p.pos }));
    const serverSnapshot = await getPlaylistSnapshotId(playlistId);
    apiCalls++;
    const cachedSnapshot = await getCachedPlaylistSnapshot(playlistId);
    let snapshot = serverSnapshot;
    console.info(`[wthree] snapshot server=${shortSnap(serverSnapshot)} · cached=${shortSnap(cachedSnapshot)} · lastLocal=${shortSnap(lastLocalSnapshot)}`);
    // Confiamos en las posiciones de origOrder (via picksByAlbum) si:
    // - el snapshot del server coincide con el cache de items (nadie escribió), O
    // - coincide con el snapshot que dejamos nosotros en la última escritura
    //   exitosa (invalidamos el cache pero picksByAlbum quedó al día).
    // Si no coincide con ninguno → refetch entero.
    const trustLocal = (cachedSnapshot && serverSnapshot === cachedSnapshot)
      || (lastLocalSnapshot && serverSnapshot === lastLocalSnapshot);
    if (!trustLocal) {
      console.info('[wthree] snapshot no coincide — refetch para posiciones reales');
      const fresh = await getAllPlaylistItems(playlistId, null, { useCache: false });
      apiCalls += Math.ceil(fresh.length / 100);
      workingPicks = locatePicksInPlaylist(fresh, origOrder.map(p => p.uri));
      console.info('[wthree] refetch · picks localizados:',
        workingPicks.map(p => `${shortId(p.id)}@${p.pos}`).join(' | '));
    } else {
      console.info('[wthree] posiciones locales confiables — sin refetch');
    }

    // 1. Add — siempre en maxPos+1 (contiguo con los picks originales).
    let addInsertPos = null;
    if (toAddUris.length) {
      const maxPos = workingPicks.length ? Math.max(...workingPicks.map(p => p.pos)) : -1;
      addInsertPos = maxPos >= 0 ? maxPos + 1 : null;
      const sn = await addTracksToPlaylist(playlistId, toAddUris, addInsertPos != null ? { position: addInsertPos } : {});
      apiCalls++;
      if (sn) snapshot = sn;
      console.info(`[wthree] add · ${toAddUris.length} tracks en pos ${addInsertPos} · snapshot: ${shortSnap(snapshot)}`);
    }

    // 2. Remove por URI. Los que quedan se shiftean local.
    if (toRemoveUris.length) {
      const sn = await removeTracksFromPlaylist(playlistId, toRemoveUris);
      apiCalls++;
      if (sn) snapshot = sn;
      console.info(`[wthree] remove · ${toRemoveUris.length} tracks · snapshot: ${shortSnap(snapshot)}`);
    }

    // Reconstruir workingPicks con posiciones absolutas actualizadas (puro,
    // determinístico — testeado en util/reorder-shifts.test.js).
    workingPicks = computeUpdatedPickPositions(
      workingPicks, orderedPicks,
      { toAddUris, toRemoveUris, addInsertPos },
    );

    // Si algún pick quedó con pos=null (add al inicio, sin picks previos),
    // fallback a refetch para tener posiciones reales.
    if (workingPicks.some(p => p.pos == null)) {
      console.info('[wthree] posiciones locales incompletas — refetch para reorder');
      const fresh = await getAllPlaylistItems(playlistId, null, { useCache: false });
      apiCalls += Math.ceil(fresh.length / 100);
      workingPicks = locatePicksInPlaylist(fresh, orderedPicks.map(p => p.uri));
    }

    // 3. Reorder si difiere del target.
    const targetOrder = orderedPicks.map(p => p.id);
    const currentOrder = workingPicks.map(p => p.id);
    const orderDiffers = currentOrder.length === targetOrder.length
      && currentOrder.some((id, i) => id !== targetOrder[i]);
    if (orderDiffers) {
      const res = await reorderPicksMinimal(workingPicks, targetOrder, snapshot);
      snapshot = res.snapshot || snapshot;
      moveCount = res.moveCount;
      apiCalls += moveCount;
      // CRÍTICO: usar el working post-reorder con posiciones actualizadas
      // — sino picksByAlbum queda con posiciones stale y el siguiente guardado
      // arranca con estado equivocado. (bug v=119)
      workingPicks = res.workingPicks;
    }

    // 4. Verificación: un GET dirigido al rango donde deberían estar los picks.
    //    Confirma que Spotify quedó como esperamos antes de decir "guardado".
    //    Si algún request falló silencioso o Spotify aplicó algo raro, acá se cae.
    if (workingPicks.length > 0) {
      // Rango centrado en las nuevas posiciones absolutas de los picks. Usar
      // el min/max reales del post-reorder — con margen para tolerar picks no
      // contiguos (ej. el álbum ocupa 5 slots pero solo 3 son picks).
      const minPos = Math.min(...workingPicks.map(p => p.pos));
      const maxPos = Math.max(...workingPicks.map(p => p.pos));
      const rangeLen = Math.min(50, (maxPos - minPos) + 5);
      const targetUris = orderedPicks.map(p => p.uri);
      console.info(`[wthree] verify range · offset=${minPos} · len=${rangeLen} · expected order:`,
        targetUris.map(u => shortUri(u)).join(' | '));
      const verify = await verifyAlbumOrderAtRange(playlistId, targetUris, Math.max(0, minPos), rangeLen);
      apiCalls++;
      if (!verify.ok) {
        console.warn('[wthree] verificación falló · esperado:',
          targetUris.map(u => shortUri(u)).join(' | '),
          '· encontrado:', verify.got.map(u => shortUri(u)).join(' | '));
        throw new Error('Spotify no aplicó el orden como esperábamos');
      }
      console.info('[wthree] verify OK · got:', verify.got.map(u => shortUri(u)).join(' | '));
    }

    // 5. Invalidar el cache de items (otros features que llaman
    //    getAllPlaylistItems se recargarán). Guardamos el snapshot final en
    //    lastLocalSnapshot: la próxima operación de W-Three sabe que si el
    //    server sigue en ese snapshot, las posiciones de picksByAlbum son OK
    //    y no hace falta refetch.
    await updatePlaylistItemsCache(playlistId, null, null);
    lastLocalSnapshot = snapshot;

    const elapsed = Math.round(performance.now() - t0);
    console.info(`[wthree] guardado OK en ${elapsed}ms · ${apiCalls} API calls · +${toAddUris.length} · -${toRemoveUris.length} · ${moveCount} reorders`);

    const msg = moveCount > 0
      ? `Orden actualizado (${moveCount} movimiento${moveCount === 1 ? '' : 's'}, ${(elapsed / 1000).toFixed(1)}s)`
      : `Playlist actualizada: +${toAddUris.length} · -${toRemoveUris.length} (${(elapsed / 1000).toFixed(1)}s)`;
    showToast(msg, 'success');
    closeById('wthree-album-modal');

    // Rerender local optimista: actualizamos picksByAlbum y albumsList del
    // álbum tocado, sin refetch bloqueante. Refleja el nuevo estado al toque.
    const key = albumKey(a.name, a.artist);
    const newPicks = workingPicks.map((p, i) => ({
      id: p.id, uri: p.uri, name: p.name, pos: p.pos ?? i,
    }));
    if (newPicks.length === 0) {
      picksByAlbum.delete(key);
    } else if (picksByAlbum.has(key)) {
      picksByAlbum.get(key).picks = newPicks;
    } else {
      picksByAlbum.set(key, {
        name: a.name, artist: a.artist, img: a.img, albumId: a.albumId,
        picks: newPicks,
      });
    }
    const albumEntry = albumsList?.find(x => albumKey(x.name, x.artist) === key);
    if (albumEntry) albumEntry.picks = newPicks;
    const content = document.getElementById('wthree-content');
    if (content) renderBuckets(content);

  } catch (e) {
    const elapsed = Math.round(performance.now() - t0);
    console.error(`[wthree] guardado FALLÓ en ${elapsed}ms · ${apiCalls} API calls:`, e);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar cambios';
    showToast('No se pudo guardar: ' + (e.message || 'error desconocido'), 'error');
    // No refetch bloqueante: si algo raro pasó, al próximo abrir el modal
    // (o al reabrir la vista) se refresca. Preferible que el usuario lo
    // decida a que la app se cuelgue otros 30s.
  }
}
