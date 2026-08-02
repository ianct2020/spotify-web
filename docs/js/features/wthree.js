// W-Three helper: cruza tu historial con la playlist "w three" (mejores 3 tracks
// por álbum). Muestra qué álbumes ya tienen picks, cuántos, y cuáles te faltan.
// Ordenado por álbumes más escuchados primero para priorizar tu tiempo.

import { spotifyFetch, getAllPlaylistItems, getAllUserPlaylists, addTracksToPlaylist, removeTracksFromPlaylist, reorderPlaylistItems, getPlaylistSnapshotId, updatePlaylistItemsCache } from '../api.js?v=112';
import { loadHistoryStats, loadListenedAlbums, isOwner, ownerLockedMessage } from './history-data.js?v=112';
import { escapeHtml, pageHeader } from '../ui/components.js?v=112';
import { showToast } from '../ui/toast.js?v=112';
import { activateMarquee, marqueeSpan } from '../ui/marquee.js?v=112';
import { openModal, closeTop, closeById } from '../ui/modal-stack.js?v=112';
import { getPreview } from '../api/preview-providers.js?v=112';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=112';
import { openAlbumCard } from './album-card.js?v=112';

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

const albumKey = (name, artist) => `${(name || '').toLowerCase().trim()}||${(artist || '').toLowerCase().trim()}`;

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

// Cuando el preview global cambia, resetear los ▶/⏸ de la tracklist abierta.
// Los que corresponden al key sonando quedan como ⏸, el resto vuelve a ▶.
document.addEventListener('previewchange', (e) => {
  const key = e.detail?.key || '';
  document.querySelectorAll('.wt-play-btn').forEach(btn => {
    if (btn.disabled) return;
    btn.textContent = (key === `wt:${btn.dataset.playId}`) ? '⏸' : '▶';
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
  const hideBtn = `<button class="wthree-hide-btn" data-hide-key="${escapeHtml(key)}" title="${isHidden ? 'Restaurar en la lista' : 'Ocultar este álbum'}" aria-label="${isHidden ? 'Restaurar' : 'Ocultar'}">${isHidden ? '👁️' : '🙈'}</button>`;

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

  // Estructura nueva (v=109): modal compacto ≤85vh con 3 zonas verticales:
  // 1. Header fijo (chip w-three · álbum + tapa chica + nombre/artista + meta).
  // 2. Zona scrolleable (tracklist + panel de orden — cada uno con scroll
  //    interno propio). Es la que crece o achica.
  // 3. Footer fijo abajo con "Guardar cambios" full-width.
  // El .modal en sí NUNCA se scrollea — todo el scroll vive DENTRO.
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
          <button class="btn btn-secondary btn-sm card-modal-close" data-close-modal>✕</button>
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
      <div class="wt-scroll" id="wt-scroll">
        <div style="text-align:center;padding:16px"><div class="spinner"></div></div>
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

  const scroll = overlay.querySelector('#wt-scroll');
  const saveBtn = overlay.querySelector('#wt-save');
  const metaEl = overlay.querySelector('#wt-meta');

  const tracks = await fetchAlbumTracks(a);
  if (!tracks.length) {
    metaEl.textContent = `${a.picks.length} en w-three`;
    scroll.innerHTML = `<p style="color:var(--color-text-muted);text-align:center;padding:16px">No pude cargar los tracks del álbum desde Spotify. Ya está: ${a.picks.length} pick${a.picks.length === 1 ? '' : 's'}.</p>`;
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

  scroll.innerHTML = `
    <div class="wt-tracklist-wrap">
      <div class="wt-section-title">Pistas del álbum</div>
      <div class="wthree-tracklist wt-tracklist">
        ${trackData.map((t, i) => `
          <label class="wthree-track ${t.picked ? 'wthree-track-picked' : ''} ${suggestedSet.has(t.id) ? 'wthree-track-suggested' : ''}">
            <input type="checkbox" class="wthree-track-check" data-id="${t.id}" data-uri="${t.uri}" data-name="${escapeHtml(t.name)}" ${t.picked ? 'checked' : ''}>
            <span class="wthree-track-num">${i + 1}</span>
            <span class="wthree-track-name">${escapeHtml(t.name)}</span>
            <span class="wthree-track-plays">${t.plays > 0 ? t.plays : ''}</span>
            <button type="button" class="wt-play-btn" data-play-id="${t.id}" data-play-name="${escapeHtml(t.name)}" title="Preview 30s" aria-label="Preview de ${escapeHtml(t.name)}">▶</button>
          </label>
        `).join('')}
      </div>
      ${suggestions.length > 0 ? `<button class="btn btn-secondary btn-sm wt-suggest-btn" id="wt-add-suggested">💡 Agregar los ${suggestions.length} sugeridos</button>` : ''}
    </div>
    <div class="wthree-order-panel" id="wt-order-panel"></div>
  `;

  saveBtn.textContent = 'Guardar cambios';
  saveBtn.disabled = false;

  const orderPanel = overlay.querySelector('#wt-order-panel');

  function renderOrderPanel() {
    if (orderedPicks.length === 0) {
      orderPanel.innerHTML = '';
      return;
    }
    orderPanel.innerHTML = `
      <div class="wthree-order-title">
        Orden dentro del álbum en la playlist
        <span class="wthree-order-hint">(1ra = la que más te gusta)</span>
      </div>
      <div class="wthree-order-list wt-order-scroll">
        ${orderedPicks.map((p, i) => `
          <div class="wthree-order-item" data-id="${p.id}">
            <span class="wthree-order-rank">${i + 1}</span>
            <span class="wthree-order-name">${escapeHtml(p.name || '')}</span>
            <button class="wthree-order-btn" data-move="up" data-i="${i}" title="Subir" ${i === 0 ? 'disabled' : ''}>▲</button>
            <button class="wthree-order-btn" data-move="down" data-i="${i}" title="Bajar" ${i === orderedPicks.length - 1 ? 'disabled' : ''}>▼</button>
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
  }
  renderOrderPanel();

  // Toggle checkbox → actualizar orderedPicks + meta.
  const updateMeta = () => {
    metaEl.textContent = `${tracks.length} pistas · ${orderedPicks.length} en w-three${suggestions.length ? ` · 💡 ${suggestions.length} sugerido${suggestions.length === 1 ? '' : 's'}` : ''}`;
  };
  scroll.querySelectorAll('.wthree-track-check').forEach(cb => {
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
  scroll.querySelectorAll('.wt-play-btn').forEach(btn => {
    const id = btn.dataset.playId;
    const name = btn.dataset.playName;
    const setLabel = () => {
      btn.textContent = playingKey() === `wt:${id}` ? '⏸' : '▶';
    };
    setLabel();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.textContent = '…';
      const res = await togglePreview(`wt:${id}`, async () => {
        return await getPreview({ name, artist: a.artist, spotifyId: id });
      });
      if (res === true) btn.textContent = '⏸';
      else if (res === null) { btn.textContent = '—'; btn.title = 'Sin preview'; btn.disabled = true; }
      else btn.textContent = '▶';
    });
  });

  const addBtn = overlay.querySelector('#wt-add-suggested');
  if (addBtn) {
    addBtn.onclick = () => {
      suggestions.forEach(id => {
        const cb = scroll.querySelector(`.wthree-track-check[data-id="${id}"]`);
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
async function reorderPicksMinimal(picks, targetOrder, initialSnapshot) {
  const working = picks.map(p => ({ ...p }));
  let snapshot = initialSnapshot;
  let moveCount = 0;

  for (let target = 0; target < targetOrder.length; target++) {
    const wantedId = targetOrder[target];
    const currentIdx = working.findIndex((p, i) => i >= target && p.id === wantedId);
    if (currentIdx === -1 || currentIdx === target) continue;

    const fromPos = working[currentIdx].pos;
    const toPos = working[target].pos;
    // insert_before es exclusivo: para bajar (fromPos<toPos) hay que apuntar
    // a toPos+1; para subir, a toPos directo.
    const insert_before = fromPos < toPos ? toPos + 1 : toPos;

    snapshot = await reorderPlaylistItems(playlistId, {
      range_start: fromPos,
      insert_before,
      range_length: 1,
      snapshot_id: snapshot,
    });
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
  }

  return { snapshot, moveCount };
}

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
  let apiCalls = 0;
  let moveCount = 0;
  try {
    // Fase 1: agregar los nuevos (lógica de v=104). Si el álbum ya tenía
    // picks, insertar en maxPos+1 para que queden contiguos con los actuales.
    if (toAddUris.length) {
      const existingPicks = a.picks || [];
      const maxPos = existingPicks.length ? Math.max(...existingPicks.map(p => p.pos ?? -1)) : -1;
      const insertPos = maxPos >= 0 ? maxPos + 1 : null;
      await addTracksToPlaylist(playlistId, toAddUris, insertPos != null ? { position: insertPos } : {});
      apiCalls++;
    }

    // Fase 2: sacar los quitados.
    if (toRemoveUris.length) {
      await removeTracksFromPlaylist(playlistId, toRemoveUris);
      apiCalls++;
    }

    // Fase 3: reordenar si hace falta. Refetcheamos para tener posiciones
    // absolutas reales — necesarias tanto si cambió el orden de los que
    // quedan como si agregamos nuevos que en el "insert al final" no
    // terminan en su lugar target (ej: picks=[A], target=[B,A] con B nuevo).
    const needsReorderCheck = orderChanged || toAddUris.length > 0;
    if (needsReorderCheck) {
      const freshItems = await getAllPlaylistItems(playlistId, null, { useCache: false });
      apiCalls++;
      const picksNow = locatePicksInPlaylist(freshItems, orderedPicks.map(p => p.uri));
      const currentOrder = picksNow.map(p => p.id);
      const targetOrder = orderedPicks.map(p => p.id);
      const orderDiffers = currentOrder.length === targetOrder.length
        && currentOrder.some((id, i) => id !== targetOrder[i]);
      if (orderDiffers) {
        const snap = await getPlaylistSnapshotId(playlistId);
        apiCalls++;
        const { moveCount: mc } = await reorderPicksMinimal(picksNow, targetOrder, snap);
        moveCount = mc;
        apiCalls += mc;
      }
    }

    const msg = moveCount > 0
      ? `Orden actualizado: ${orderedPicks.length} en el álbum (${moveCount} movimiento${moveCount === 1 ? '' : 's'})`
      : `Playlist actualizada: +${toAddUris.length} · -${toRemoveUris.length}`;
    showToast(msg, 'success');
    closeById('wthree-album-modal');
    const content = document.getElementById('wthree-content');
    if (content) {
      content.querySelector('.wthree-bucket')?.style?.setProperty('opacity', '0.5');
      const freshItems = await getAllPlaylistItems(playlistId, null, { useCache: false });
      buildAlbumIndex(freshItems);
      crossWithHistory(historyStats, listenedAlbums);
      renderBuckets(content);
    }
  } catch (e) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar cambios';
    // Si falló en el medio, la playlist puede haber quedado a medio reordenar.
    // Refresh de la vista con useCache:false para reflejar el estado real.
    showToast('Error guardando: ' + e.message + '. Refrescando…', 'error');
    try {
      const freshItems = await getAllPlaylistItems(playlistId, null, { useCache: false });
      buildAlbumIndex(freshItems);
      crossWithHistory(historyStats, listenedAlbums);
      const content = document.getElementById('wthree-content');
      if (content) renderBuckets(content);
    } catch { /* noop — ya avisamos con el toast anterior */ }
  }
}
