// W-Three helper: cruza tu historial con la playlist "w three" (mejores 3 tracks
// por álbum). Muestra qué álbumes ya tienen picks, cuántos, y cuáles te faltan.
// Ordenado por álbumes más escuchados primero para priorizar tu tiempo.

import { spotifyFetch, getAllPlaylistItems, getAllUserPlaylists, addTracksToPlaylist, removeTracksFromPlaylist, updatePlaylistItemsCache } from '../api.js';
import { loadHistoryStats, isOwner, ownerLockedMessage } from './history-data.js';
import { escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';
import { activateMarquee, marqueeSpan } from '../ui/marquee.js';

const LS_KEY_ID = 'wthree_playlist_id';
const LS_KEY_NAME = 'wthree_playlist_name';

// ── Estado ──
let playlistId = null;
let playlistName = null;
let picksByAlbum = null;   // Map<key, {name, artist, img, picks:[{name,id,uri}]}>
let albumsList = null;     // [{name, artist, img, min, plays, picks[]}] cross de historial vs playlist
let historyStats = null;
let albumTracksCache = new Map(); // key → tracks fetched from Spotify

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
    const [items, stats] = await Promise.all([
      getAllPlaylistItems(playlistId),
      loadHistoryStats(),
    ]);
    historyStats = stats;
    buildAlbumIndex(items);
    crossWithHistory(stats);
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
  for (const it of items) {
    const t = it.item || it.track;
    if (!t || !t.album) continue;
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
    picksByAlbum.get(key).picks.push({ name: t.name, id: t.id, uri: t.uri });
  }
}

function crossWithHistory(stats) {
  const albums = [];
  const seen = new Set();
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
    });
  }
  // Álbumes en la playlist que NO están en el top historial (pueden ser recientes o pocos escuchados)
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
    });
  }
  // Ordenar: primero por picks ascendente (menos = más prioridad), luego minutos desc
  albums.sort((a, b) => a.picks.length - b.picks.length || b.min - a.min);
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

  content.innerHTML = `
    <div class="wthree-header">
      <div class="wthree-header-name">
        <div style="font-size:11px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em">Playlist activa</div>
        <div style="font-size:15px;font-weight:600">${escapeHtml(playlistName || 'w three')}</div>
      </div>
      <button class="btn btn-secondary btn-sm" id="wthree-change">Cambiar</button>
    </div>

    <div class="wthree-summary">
      <div class="wthree-stat wthree-stat-danger"><div class="wthree-stat-v">${buckets['0'].length}</div><div class="wthree-stat-l">sin picks</div></div>
      <div class="wthree-stat"><div class="wthree-stat-v">${buckets['1'].length}</div><div class="wthree-stat-l">con 1</div></div>
      <div class="wthree-stat"><div class="wthree-stat-v">${buckets['2'].length}</div><div class="wthree-stat-l">con 2</div></div>
      <div class="wthree-stat wthree-stat-ok"><div class="wthree-stat-v">${buckets['3'].length}</div><div class="wthree-stat-l">completos ✓</div></div>
      <div class="wthree-stat wthree-stat-warn"><div class="wthree-stat-v">${buckets['4+'].length}</div><div class="wthree-stat-l">más de 3</div></div>
    </div>

    ${renderBucket('Sin picks — priorizados por tiempo escuchado', buckets['0'], 'danger', 20)}
    ${renderBucket('Con 1 pick — completar', buckets['1'], '', 15)}
    ${renderBucket('Con 2 picks — falta uno', buckets['2'], '', 15)}
    ${renderBucket('Ya con 3 ✓', buckets['3'], 'ok', 10)}
    ${buckets['4+'].length ? renderBucket('Más de 3 picks — sacar alguno?', buckets['4+'], 'warn', 10) : ''}
  `;

  document.getElementById('wthree-change').onclick = reset;
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

  body.innerHTML = `
    <div style="font-size:12px;color:var(--color-text-muted);margin:0 0 10px">
      ${tracks.length} tracks · ${a.picks.length} en w-three
      ${suggestions.length > 0 ? ` · <span style="color:var(--color-accent)">💡 ${suggestions.length} sugerido${suggestions.length === 1 ? '' : 's'}</span>` : ''}
    </div>
    <div class="wthree-tracklist">
      ${trackData.map((t, i) => `
        <label class="wthree-track ${t.picked ? 'wthree-track-picked' : ''} ${suggestedSet.has(t.id) ? 'wthree-track-suggested' : ''}">
          <input type="checkbox" class="wthree-track-check" data-id="${t.id}" data-uri="${t.uri}" ${t.picked ? 'checked' : ''}>
          <span class="wthree-track-num">${i + 1}</span>
          <span class="wthree-track-name">${escapeHtml(t.name)}</span>
          ${t.plays > 0 ? `<span class="wthree-track-plays">${t.plays} play${t.plays === 1 ? '' : 's'}</span>` : ''}
          ${suggestedSet.has(t.id) ? `<span class="wthree-track-tag">sugerido</span>` : ''}
          ${t.picked ? `<span class="wthree-track-tag wthree-track-tag-ok">en w-three</span>` : ''}
        </label>
      `).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
      ${suggestions.length > 0 ? `<button class="btn btn-primary btn-sm" id="wt-add-suggested" style="flex:1;min-width:180px">Agregar los ${suggestions.length} sugeridos</button>` : ''}
      <button class="btn btn-secondary btn-sm" id="wt-save" style="flex:1;min-width:100px">Guardar cambios</button>
    </div>
  `;

  const addBtn = document.getElementById('wt-add-suggested');
  if (addBtn) {
    addBtn.onclick = () => {
      suggestions.forEach(id => {
        const cb = body.querySelector(`.wthree-track-check[data-id="${id}"]`);
        if (cb) cb.checked = true;
      });
      showToast('Marcados. Apretá "Guardar cambios" para aplicar.', 'info');
    };
  }

  document.getElementById('wt-save').onclick = () => applyChanges(a, body, overlay);
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

async function applyChanges(a, body, overlay) {
  const currentPickIds = new Set(a.picks.map(p => p.id));
  const newPickIds = new Set();
  body.querySelectorAll('.wthree-track-check').forEach(cb => {
    if (cb.checked) newPickIds.add(cb.dataset.id);
  });

  const toAdd = [];
  const toRemove = [];
  body.querySelectorAll('.wthree-track-check').forEach(cb => {
    const id = cb.dataset.id;
    const uri = cb.dataset.uri;
    if (cb.checked && !currentPickIds.has(id)) toAdd.push(uri);
    if (!cb.checked && currentPickIds.has(id)) toRemove.push(uri);
  });

  if (toAdd.length === 0 && toRemove.length === 0) {
    showToast('No hay cambios', 'info');
    return;
  }

  const saveBtn = document.getElementById('wt-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';
  try {
    if (toAdd.length) await addTracksToPlaylist(playlistId, toAdd);
    if (toRemove.length) await removeTracksFromPlaylist(playlistId, toRemove);

    // Refresh: los tracks del álbum ahora en la playlist actualizados en memoria
    const key = albumKey(a.name, a.artist);
    const info = picksByAlbum.get(key) || { name: a.name, artist: a.artist, picks: [] };
    // Re-armar picks desde los checkboxes marcados
    const allBoxes = body.querySelectorAll('.wthree-track-check');
    info.picks = [];
    allBoxes.forEach(cb => {
      if (cb.checked) {
        const label = cb.closest('label');
        const nameSpan = label.querySelector('.wthree-track-name');
        info.picks.push({ name: nameSpan?.textContent || '', id: cb.dataset.id, uri: cb.dataset.uri });
      }
    });
    picksByAlbum.set(key, info);
    a.picks = info.picks;

    showToast(`Playlist actualizada: +${toAdd.length} · -${toRemove.length}`, 'success');
    overlay.remove();
    // Re-render los buckets
    const content = document.getElementById('wthree-content');
    if (content) {
      crossWithHistory(historyStats);
      renderBuckets(content);
    }
  } catch (e) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar cambios';
    showToast('Error: ' + e.message, 'error');
  }
}
