// W-Three helper: cruza tu historial con la playlist "w three" (mejores 3 tracks
// por álbum). Muestra qué álbumes ya tienen picks, cuántos, y cuáles te faltan.
// Ordenado por álbumes más escuchados primero para priorizar tu tiempo.

import { spotifyFetch, getAllPlaylistItems, getAllUserPlaylists, addTracksToPlaylist, removeTracksFromPlaylist, updatePlaylistItemsCache } from '../api.js?v=105';
import { loadHistoryStats, loadListenedAlbums, isOwner, ownerLockedMessage } from './history-data.js?v=105';
import { escapeHtml } from '../ui/components.js?v=105';
import { showToast } from '../ui/toast.js?v=105';
import { activateMarquee, marqueeSpan } from '../ui/marquee.js?v=105';

const LS_KEY_ID = 'wthree_playlist_id';
const LS_KEY_NAME = 'wthree_playlist_name';

// ── Estado ──
let playlistId = null;
let playlistName = null;
let picksByAlbum = null;   // Map<key, {name, artist, img, picks:[{name,id,uri,pos}]}>
let albumsList = null;     // [{name, artist, img, min, plays, picks[]}] cross de historial vs playlist
let historyStats = null;
let listenedAlbums = null; // { years: [{ year, albums: [{name, artist, img, date}] }] }
let albumTracksCache = new Map(); // key → tracks fetched from Spotify
let selectedBucket = null; // null = all, o '0'/'1'/'2'/'3'/'4+'

const albumKey = (name, artist) => `${(name || '').toLowerCase().trim()}||${(artist || '').toLowerCase().trim()}`;

export async function render(container) {
  playlistId = localStorage.getItem(LS_KEY_ID);
  playlistName = localStorage.getItem(LS_KEY_NAME);

  container.innerHTML = `
    <div class="page-header">
      <h1>W-Three helper</h1>
      <p>Ordenás las mejores 3 canciones de cada álbum. Acá ves cuáles ya cubriste y cuáles te faltan.</p>
    </div>
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
  const buckets = { '0': [], '1': [], '2': [], '3': [], '4+': [] };
  for (const a of albumsList) {
    const n = a.picks.length;
    if (n === 0) buckets['0'].push(a);
    else if (n === 1) buckets['1'].push(a);
    else if (n === 2) buckets['2'].push(a);
    else if (n === 3) buckets['3'].push(a);
    else buckets['4+'].push(a);
  }

  // Meta info: fuentes de datos
  const historyCount = albumsList.filter(a => a.source === 'history').length;
  const listenedCount = albumsList.filter(a => a.source === 'listened').length;

  const isSel = (k) => selectedBucket === k;
  const bucketDef = [
    { key: '0', label: 'sin picks', cls: 'wthree-stat-danger', count: buckets['0'].length },
    { key: '1', label: 'con 1', cls: '', count: buckets['1'].length },
    { key: '2', label: 'con 2', cls: '', count: buckets['2'].length },
    { key: '3', label: 'completos ✓', cls: 'wthree-stat-ok', count: buckets['3'].length },
    { key: '4+', label: 'más de 3', cls: 'wthree-stat-warn', count: buckets['4+'].length },
  ];

  content.innerHTML = `
    <div class="wthree-header">
      <div class="wthree-header-name">
        <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em">Playlist activa</div>
        <div style="font-size:15px;font-weight:600">${escapeHtml(playlistName || 'w three')}</div>
      </div>
      <button class="btn btn-secondary btn-sm" id="wthree-change">Cambiar</button>
    </div>

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

    ${!selectedBucket || selectedBucket === '0' ? renderBucket('Sin picks — priorizados por tiempo escuchado', buckets['0'], 'danger', selectedBucket === '0' ? 999 : 20) : ''}
    ${!selectedBucket || selectedBucket === '1' ? renderBucket('Con 1 pick — completar', buckets['1'], '', selectedBucket === '1' ? 999 : 15) : ''}
    ${!selectedBucket || selectedBucket === '2' ? renderBucket('Con 2 picks — falta uno', buckets['2'], '', selectedBucket === '2' ? 999 : 15) : ''}
    ${!selectedBucket || selectedBucket === '3' ? renderBucket('Ya con 3 ✓', buckets['3'], 'ok', selectedBucket === '3' ? 999 : 10) : ''}
    ${buckets['4+'].length && (!selectedBucket || selectedBucket === '4+') ? renderBucket('Más de 3 picks — sacar alguno?', buckets['4+'], 'warn', selectedBucket === '4+' ? 999 : 10) : ''}

    <div style="font-size:11px;color:var(--color-text-muted);margin-top:14px;text-align:center">
      ${historyCount} álbumes del top historial${listenedCount ? ` · ${listenedCount} más detectados en tu historial de escucha` : ''} · ${picksByAlbum.size} álbumes en la playlist
    </div>
  `;

  document.getElementById('wthree-change').onclick = reset;
  document.getElementById('wthree-clear-filter')?.addEventListener('click', () => {
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
  const badge = a.picks.length === 0
    ? `<span class="wthree-pill wthree-pill-danger">0 / 3</span>`
    : a.picks.length === 3
      ? `<span class="wthree-pill wthree-pill-ok">✓ 3 / 3</span>`
      : a.picks.length > 3
        ? `<span class="wthree-pill wthree-pill-warn">${a.picks.length} / 3</span>`
        : `<span class="wthree-pill">${a.picks.length} / 3</span>`;

  return `
    <div class="wthree-album-row" data-album-key="${escapeHtml(key)}">
      ${a.img
        ? `<img src="${a.img}" alt="" class="wthree-album-cover" loading="lazy">`
        : `<div class="wthree-album-cover wthree-album-cover-empty">♪</div>`}
      <div class="wthree-album-info">
        <div class="wthree-album-name">${marqueeSpan(escapeHtml(a.name))}</div>
        <div class="wthree-album-artist">${marqueeSpan(escapeHtml(a.artist))}</div>
        ${a.min > 0 ? `<div class="wthree-album-meta">${fmtMinutesShort(a.min)} · ${a.plays} plays</div>` : `<div class="wthree-album-meta" style="opacity:0.6">no está en tu top</div>`}
      </div>
      ${badge}
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
  // "Ver N más" buttons — no implementado por ahora (MVP)
  root.querySelectorAll('[data-more]').forEach(btn => {
    btn.onclick = () => {
      showToast('Próximamente: ver todos los álbumes del bucket', 'info');
    };
  });
}

// ── Modal por álbum: lista tracks del álbum con picks marcados y sugerencias ──

async function openAlbumModal(a) {
  document.getElementById('wthree-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'wthree-modal';
  overlay.innerHTML = `
    <div class="modal card-modal album-modal" style="max-width:520px;width:min(520px,94vw)">
      <div class="card-modal-head-simple">
        <div class="card-modal-eyebrow">W-Three · álbum</div>
        <button class="btn btn-secondary btn-sm card-modal-close" id="wt-close">✕</button>
      </div>
      <div class="album-modal-body" style="gap:6px">
        ${a.img
          ? `<img src="${a.img}" alt="" class="album-modal-cover" style="width:140px;height:140px;max-width:45vw;max-height:45vw">`
          : `<div class="album-modal-cover album-modal-cover-empty" style="width:140px;height:140px;max-width:45vw;max-height:45vw">♪</div>`}
        <div class="album-modal-name">${escapeHtml(a.name)}</div>
        <div style="color:var(--color-text-muted);font-size:13px">${escapeHtml(a.artist)}</div>
      </div>
      <div id="wt-modal-body"><div style="text-align:center;padding:16px"><div class="spinner"></div></div></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('wt-close').onclick = () => overlay.remove();

  const body = document.getElementById('wt-modal-body');
  const tracks = await fetchAlbumTracks(a);
  if (!tracks.length) {
    body.innerHTML = `<p style="color:var(--color-text-muted);text-align:center;padding:12px">No pude cargar los tracks del álbum desde Spotify. Ya está: ${a.picks.length} pick${a.picks.length === 1 ? '' : 's'}.</p>`;
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
  // También revisar años (por si un track fuerte de un año particular no está en top all-time)
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

  // Sugerencias: top 3 por plays entre los NO pickeados (si el álbum tiene <3 picks)
  const missingSlots = Math.max(0, 3 - a.picks.length);
  const suggestions = trackData
    .filter(t => !t.picked && t.plays > 0)
    .sort((x, y) => y.plays - x.plays)
    .slice(0, missingSlots)
    .map(t => t.id);
  const suggestedSet = new Set(suggestions);

  // Orden inicial: picks ordenados por su posición en la playlist (ascendente)
  const origOrder = [...a.picks].sort((x, y) => (x.pos ?? 0) - (y.pos ?? 0));
  let orderedPicks = origOrder.map(p => ({ id: p.id, uri: p.uri, name: p.name }));

  const trackByUri = new Map(trackData.map(t => [t.uri, t]));

  body.innerHTML = `
    <div style="font-size:12px;color:var(--color-text-muted);margin:0 0 10px">
      ${tracks.length} tracks · <span id="wt-picked-count">${a.picks.length}</span> en w-three
      ${suggestions.length > 0 ? ` · <span style="color:var(--color-accent)">💡 ${suggestions.length} sugerido${suggestions.length === 1 ? '' : 's'}</span>` : ''}
    </div>
    <div class="wthree-tracklist">
      ${trackData.map((t, i) => `
        <label class="wthree-track ${t.picked ? 'wthree-track-picked' : ''} ${suggestedSet.has(t.id) ? 'wthree-track-suggested' : ''}">
          <input type="checkbox" class="wthree-track-check" data-id="${t.id}" data-uri="${t.uri}" data-name="${escapeHtml(t.name)}" ${t.picked ? 'checked' : ''}>
          <span class="wthree-track-num">${i + 1}</span>
          <span class="wthree-track-name">${escapeHtml(t.name)}</span>
          ${t.plays > 0 ? `<span class="wthree-track-plays">${t.plays} play${t.plays === 1 ? '' : 's'}</span>` : ''}
          ${suggestedSet.has(t.id) ? `<span class="wthree-track-tag">sugerido</span>` : ''}
        </label>
      `).join('')}
    </div>

    <div class="wthree-order-panel" id="wt-order-panel"></div>

    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      ${suggestions.length > 0 ? `<button class="btn btn-primary btn-sm" id="wt-add-suggested" style="flex:1;min-width:180px">Agregar los ${suggestions.length} sugeridos</button>` : ''}
      <button class="btn btn-secondary btn-sm" id="wt-save" style="flex:1;min-width:100px">Guardar cambios</button>
    </div>
  `;

  const orderPanel = document.getElementById('wt-order-panel');

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
      <div class="wthree-order-list">
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

  // Cuando toggle un checkbox, actualizar orderedPicks
  body.querySelectorAll('.wthree-track-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      const uri = cb.dataset.uri;
      const name = cb.dataset.name;
      if (cb.checked) {
        if (!orderedPicks.some(p => p.id === id)) {
          orderedPicks.push({ id, uri, name });
        }
      } else {
        orderedPicks = orderedPicks.filter(p => p.id !== id);
      }
      document.getElementById('wt-picked-count').textContent = orderedPicks.length;
      renderOrderPanel();
    });
  });

  const addBtn = document.getElementById('wt-add-suggested');
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

  document.getElementById('wt-save').onclick = () => applyChanges(a, body, overlay, orderedPicks, origOrder);
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

async function applyChanges(a, body, overlay, orderedPicks, origOrder) {
  // Diferencia entre el orden nuevo y el original
  const origIds = origOrder.map(p => p.id);
  const newIds = orderedPicks.map(p => p.id);

  const toRemoveUris = origOrder.filter(p => !newIds.includes(p.id)).map(p => p.uri);
  const toAddUris = orderedPicks.filter(p => !origIds.includes(p.id)).map(p => p.uri);

  // Detectar si el ORDEN cambió entre las que quedan (intersección)
  const keptOrig = origIds.filter(id => newIds.includes(id));
  const keptNew = newIds.filter(id => origIds.includes(id));
  const orderChanged = keptOrig.length > 0
    && keptOrig.some((id, i) => id !== keptNew[i]);

  const noChanges = toAddUris.length === 0 && toRemoveUris.length === 0 && !orderChanged;
  if (noChanges) {
    showToast('No hay cambios', 'info');
    return;
  }

  const saveBtn = document.getElementById('wt-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';
  try {
    if (orderChanged) {
      // Estrategia: sacar TODOS los picks originales del álbum, re-insertar
      // en el orden nuevo (incluyendo los que se agregan) en la posición
      // del primero de los originales. Así queda perfectamente contiguo y ordenado.
      const insertPos = origOrder.length
        ? Math.min(...origOrder.map(p => p.pos ?? Infinity))
        : null;
      const allOrigUris = origOrder.map(p => p.uri);
      if (allOrigUris.length) await removeTracksFromPlaylist(playlistId, allOrigUris);
      const finalUris = orderedPicks.map(p => p.uri);
      if (finalUris.length) {
        await addTracksToPlaylist(playlistId, finalUris,
          insertPos != null ? { position: insertPos } : {});
      }
    } else {
      // Sin cambio de orden: solo add + remove como antes
      if (toAddUris.length) {
        const existingPicks = a.picks || [];
        const maxPos = existingPicks.length
          ? Math.max(...existingPicks.map(p => p.pos ?? -1))
          : -1;
        const insertPos = maxPos >= 0 ? maxPos + 1 : null;
        await addTracksToPlaylist(playlistId, toAddUris, insertPos != null ? { position: insertPos } : {});
      }
      if (toRemoveUris.length) await removeTracksFromPlaylist(playlistId, toRemoveUris);
    }

    // Re-fetch los items para tener posiciones frescas (insertar en X corre
    // todos los items >= X, así que cache queda inválido).
    const msg = orderChanged
      ? `Orden actualizado: ${orderedPicks.length} en el álbum`
      : `Playlist actualizada: +${toAddUris.length} · -${toRemoveUris.length}`;
    showToast(msg, 'success');
    overlay.remove();
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
    showToast('Error: ' + e.message, 'error');
  }
}
