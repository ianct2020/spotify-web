import { getAllLikedTracks, invalidateLikesCache, exportAllData, importAllData, getCurrentUserId, getLikesTotal, syncLikesIncremental, getLikesCacheTimestamp, getBestAvailableLikes, getAllPlaylistItems } from '../api.js?v=52';
import { showProgress, hideProgress, alertModal, escapeHtml } from '../ui/components.js?v=52';
import { showToast } from '../ui/toast.js?v=52';
import { openListenedAlbumsPicker } from './listened-shared.js?v=52';

let charts = [];
let _loadController = null;

export function render(container) {
  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
      <div>
        <h1>Dashboard</h1>
        <p>Stats de tu biblioteca de Liked Songs.</p>
        <div id="dash-last-sync" style="font-size:12px;color:var(--color-text-muted);margin-top:4px"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
        <div style="position:relative">
          <button class="btn btn-secondary btn-sm" id="dash-export-all-btn" title="Elegí formato">Exportar ▾</button>
          <div id="dash-export-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:10;min-width:200px">
            <button class="dash-export-opt" data-fmt="json" style="display:block;width:100%;text-align:left;padding:10px 14px;background:transparent;border:none;color:var(--color-text);cursor:pointer;font-size:13px">JSON <span style="color:var(--color-text-muted)">— likes + tags</span></button>
            <button class="dash-export-opt" data-fmt="csv" style="display:block;width:100%;text-align:left;padding:10px 14px;background:transparent;border:none;color:var(--color-text);cursor:pointer;font-size:13px;border-top:1px solid var(--color-border)">CSV <span style="color:var(--color-text-muted)">— solo likes, plano</span></button>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" id="dash-import-all-btn">Importar</button>
        <input type="file" id="dash-import-all-input" accept=".json,application/json" style="display:none">
        <button class="btn btn-secondary btn-sm" id="dash-refresh-btn">Actualizar datos</button>
      </div>
    </div>
    <div id="dash-content"></div>
  `;

  refreshLastSyncLabel();

  document.getElementById('dash-refresh-btn').onclick = handleRefresh;
  const exportBtn = document.getElementById('dash-export-all-btn');
  const exportMenu = document.getElementById('dash-export-menu');
  exportBtn.onclick = (e) => {
    e.stopPropagation();
    exportMenu.style.display = exportMenu.style.display === 'block' ? 'none' : 'block';
  };
  document.addEventListener('click', () => { exportMenu.style.display = 'none'; });
  exportMenu.querySelectorAll('.dash-export-opt').forEach(b => {
    b.onmouseenter = () => { b.style.background = 'var(--color-elevated)'; };
    b.onmouseleave = () => { b.style.background = 'transparent'; };
    b.onclick = () => {
      exportMenu.style.display = 'none';
      if (b.dataset.fmt === 'json') handleExportAll();
      else if (b.dataset.fmt === 'csv') handleExportCsv();
    };
  });
  const importInput = document.getElementById('dash-import-all-input');
  document.getElementById('dash-import-all-btn').onclick = () => importInput.click();
  importInput.onchange = handleImportAll;

  renderStartScreen();

  return () => {
    charts.forEach(c => c.destroy());
    charts = [];
  };
}

async function renderStartScreen() {
  const content = document.getElementById('dash-content');
  if (!content) return;
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Leyendo cache local...</div></div>`;

  const { items: cachedItems, source: cacheSource } = await getBestAvailableLikes();
  const cachedCount = cachedItems.length;
  const hasFull = cachedCount > 0 && cacheSource === 'full';
  const hasPartial = cachedCount > 0 && cacheSource === 'partial';
  const timestamp = await getLikesCacheTimestamp();
  const lastSyncLabel = timestamp ? formatRelativeTime(timestamp) : null;

  let intro;
  if (hasFull) {
    intro = `Tenés <strong>${cachedCount.toLocaleString()}</strong> likes cacheados${lastSyncLabel ? ` · última sync <strong>${lastSyncLabel}</strong>` : ''}. Podés usarlos directo o importar un JSON previo.`;
  } else if (hasPartial) {
    intro = `<span style="color:var(--color-warning)">Carga parcial:</span> tenés <strong>${cachedCount.toLocaleString()}</strong> likes (se cortó a mitad la última vez${lastSyncLabel ? ', hace ' + lastSyncLabel : ''}). Podés retomar o importar un JSON.`;
  } else {
    intro = `No hay likes cacheados. Podés cargar todo desde Spotify (~190 requests, tarda ~2-4 min) o importar un JSON previo (1 request, mucho más rápido).`;
  }

  const primaryLabel = hasFull ? 'Usar los cacheados' : (hasPartial ? 'Retomar carga' : 'Cargar desde Spotify');

  content.innerHTML = `
    <div class="card" style="max-width:640px">
      <h3 style="margin-bottom:8px">¿Cómo querés arrancar?</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">${intro}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="dash-start-btn">${primaryLabel}</button>
        <button class="btn btn-secondary" id="dash-preimport-btn">Importar JSON</button>
        <input type="file" id="dash-preimport-input" accept=".json,application/json" style="display:none">
      </div>
    </div>
  `;

  document.getElementById('dash-start-btn').onclick = () => loadData(false);
  const preInput = document.getElementById('dash-preimport-input');
  document.getElementById('dash-preimport-btn').onclick = () => preInput.click();
  preInput.onchange = handleImportAll;
}

async function refreshLastSyncLabel() {
  const el = document.getElementById('dash-last-sync');
  if (!el) return;
  const ts = await getLikesCacheTimestamp();
  const { source, items } = await getBestAvailableLikes();
  if (!ts || items.length === 0) {
    el.textContent = '';
    return;
  }
  const rel = formatRelativeTime(ts);
  const tag = source === 'partial' ? ' (carga parcial)' : '';
  el.textContent = `Última sync: ${rel} — ${items.length.toLocaleString()} likes cacheados${tag}`;
  el.style.color = source === 'partial' ? 'var(--color-warning)' : 'var(--color-text-muted)';
}

function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `hace ${hr}h`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

async function handleRefresh() {
  const content = document.getElementById('dash-content');
  if (!content) return;

  content.innerHTML = `
    <div class="card" style="max-width:640px;text-align:center">
      <div class="spinner spinner-lg" style="margin:0 auto 16px"></div>
      <div id="refresh-text" style="font-size:14px">Chequeando delta con Spotify...</div>
    </div>
  `;
  const textEl = document.getElementById('refresh-text');

  try {
    const result = await syncLikesIncremental(({ message }) => {
      if (textEl) textEl.textContent = message;
    });

    if (!result.hadCache) {
      showToast('No hay cache. Cargando completo desde Spotify...', 'info');
      loadData(true);
      return;
    }
    if (result.added === 0) {
      showToast(`Sin cambios (${result.cachedCount.toLocaleString()} likes, coincide con Spotify)`, 'success');
    } else {
      showToast(`+${result.added} likes nuevos traídos (total: ${result.totalNow.toLocaleString()})`, 'success');
    }
    loadData(false);
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    renderStartScreen();
  }
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function handleExportCsv() {
  const { items, source } = await getBestAvailableLikes();
  if (items.length === 0) {
    showToast('No hay likes cacheados para exportar. Cargalos primero.', 'error');
    return;
  }
  if (source === 'partial') {
    const ok = await alertModal(
      'La carga se cortó a mitad',
      `<p>Solo tenés <strong>${items.length.toLocaleString()} likes cacheados</strong> (parcial). El CSV va a incluir solo esos.</p>
       <p>¿Exportar igual, o cancelar y usar "Actualizar datos" primero?</p>`,
      { variant: 'warning', confirmText: 'Exportar CSV parcial', cancelText: 'Cancelar' }
    );
    if (!ok) return;
  }
  const header = ['added_at', 'artist', 'title', 'album', 'release_date', 'year', 'popularity', 'duration_ms', 'explicit', 'isrc', 'uri'];
  const rows = [header.map(csvEscape).join(',')];
  items.forEach(item => {
    const t = item.track;
    if (!t) return;
    const artist = (t.artists || []).map(a => a.name).join('; ');
    const releaseDate = t.album?.release_date || '';
    const year = releaseDate.slice(0, 4);
    rows.push([
      item.added_at || '',
      artist,
      t.name || '',
      t.album?.name || '',
      releaseDate,
      year,
      t.popularity ?? '',
      t.duration_ms ?? '',
      t.explicit ? 'true' : 'false',
      t.external_ids?.isrc || '',
      t.uri || '',
    ].map(csvEscape).join(','));
  });
  const csv = '﻿' + rows.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const today = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spotify-likes-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const tag = source === 'partial' ? ' (parcial)' : '';
  showToast(`CSV exportado${tag}: ${items.length.toLocaleString()} likes`, 'success');
}

async function handleExportAll() {
  let userId = null;
  try { userId = await getCurrentUserId(); } catch {}
  const data = await exportAllData(userId);
  const likesCount = data.likes.items.length;
  const tagsCount = Object.keys(data.tags.entries).length;
  const source = data._likesSource;

  if (likesCount === 0 && tagsCount === 0) {
    showToast('No hay datos para exportar. Cargá likes desde el Dashboard o corré "Por género" primero.', 'error');
    return;
  }

  if (source === 'partial') {
    const ok = await alertModal(
      'La carga se cortó a mitad',
      `<p>Solo tenés <strong>${likesCount.toLocaleString()} likes cacheados</strong> (parcial). La última vez que cargaste desde Spotify se interrumpió antes de terminar.</p>
       <p>Podés exportar igual, o cancelar y usar <strong>"Actualizar datos"</strong> para completar los que faltan primero.</p>`,
      { variant: 'warning', confirmText: 'Exportar parcial igual', cancelText: 'Cancelar' }
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
  showToast(`Exportado${tag}: ${likesCount.toLocaleString()} likes + ${tagsCount.toLocaleString()} artistas con tags`, 'success');
}

async function handleImportAll(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    const inspection = inspectImportPayload(parsed);
    if (!inspection.hasLikes && !inspection.hasTags) {
      showToast('El archivo no tiene ni likes ni tags reconocibles — ¿estás seguro que es un export de spotify-tools?', 'error');
      return;
    }
    if (!inspection.hasLikes) {
      const ok = await alertModal(
        'Este archivo no tiene likes',
        `<p>El JSON trae <strong>0 tracks</strong> en likes pero sí <strong>${inspection.tagsCount.toLocaleString()} artistas con tags</strong>.</p>
         <p>Si buscabas cargar tu biblioteca de Liked Songs, este archivo <strong>no sirve</strong> — cargala desde el botón "Cargar desde Spotify" y después exportá con la versión actual (v=39+).</p>
         <p>Si solo querías los tags para clasificar en Por género, seguí.</p>`,
        { variant: 'warning', confirmText: 'Importar solo los tags', cancelText: 'Cancelar' }
      );
      if (!ok) return;
    }

    showProgress('Importando...', 0, 0);
    let currentUserId = null;
    try { currentUserId = await getCurrentUserId(); } catch {}
    const result = await importAllData(parsed, ({ message }) => {
      showProgress(message, 0, 0);
    }, { currentUserId });
    hideProgress();
    const parts = [];
    if (result.likesImported > 0) parts.push(`${result.likesImported.toLocaleString()} likes`);
    if (result.likesAdded > 0) parts.push(`+${result.likesAdded} nuevos traídos`);
    if (result.tagsImported > 0) parts.push(`${result.tagsImported} artistas nuevos`);
    if (result.tagsUpdated > 0) parts.push(`${result.tagsUpdated} actualizados`);
    if (result.configApplied > 0) parts.push(`${result.configApplied} preferencias tuyas restauradas`);
    if (result.configSkipped) parts.push(`config del backup ignorada (no es tu cuenta)`);
    const msg = parts.length > 0 ? `Importado: ${parts.join(' · ')}` : 'Archivo importado (sin cambios)';
    const type = result.likesImported === 0 && inspection.hasLikes === false ? 'error' : 'success';
    showToast(msg, type);
    loadData(false);
  } catch (err) {
    hideProgress();
    showToast('Error importando: ' + err.message, 'error');
  }
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

async function loadData(forceRefresh) {
  const content = document.getElementById('dash-content');
  if (!content) return;

  if (forceRefresh) invalidateLikesCache();

  _loadController = new AbortController();
  const startTime = Date.now();

  content.innerHTML = `
    <div class="card" style="max-width:640px;text-align:center;padding:28px">
      <div class="spinner spinner-lg" style="margin:0 auto 16px"></div>
      <div id="dash-load-text" style="font-size:15px;margin-bottom:6px;font-weight:500">Cargando Liked Songs...</div>
      <div id="dash-load-eta" style="font-size:13px;color:var(--color-text-secondary);margin-bottom:14px">Calculando ETA...</div>
      <div style="height:10px;background:var(--color-elevated);border-radius:5px;overflow:hidden;margin-bottom:20px">
        <div id="dash-load-bar" style="height:100%;background:var(--color-accent);width:0%;transition:width 0.2s"></div>
      </div>
      <button class="btn btn-danger" id="dash-cancel-btn" style="min-width:180px">Detener carga</button>
      <div style="font-size:12px;color:var(--color-text-muted);margin-top:10px">Podés detener sin problema — la próxima vez retoma desde donde quedó.</div>
    </div>
  `;

  const textEl = document.getElementById('dash-load-text');
  const etaEl = document.getElementById('dash-load-eta');
  const barEl = document.getElementById('dash-load-bar');
  document.getElementById('dash-cancel-btn').onclick = () => {
    _loadController?.abort();
  };

  const formatEta = (secs) => {
    if (!isFinite(secs) || secs <= 0) return '';
    if (secs < 60) return `~${Math.round(secs)}s restantes`;
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return `~${m}m ${s}s restantes`;
  };

  try {
    const likes = await getAllLikedTracks(({ loaded, total, cached }) => {
      if (cached) {
        textEl.textContent = `Usando cache local (${loaded.toLocaleString()} likes)`;
        etaEl.textContent = 'Listo desde cache.';
        barEl.style.width = '100%';
      } else {
        const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
        textEl.textContent = `${loaded.toLocaleString()} / ${(total || '?').toLocaleString()} likes`;
        barEl.style.width = `${pct}%`;
        const elapsed = (Date.now() - startTime) / 1000;
        if (loaded > 0 && total > 0 && elapsed > 2) {
          const rate = loaded / elapsed;
          const remaining = (total - loaded) / rate;
          etaEl.textContent = formatEta(remaining);
        }
      }
    }, { signal: _loadController.signal });

    charts.forEach(c => c.destroy());
    charts = [];

    const stats = computeStats(likes);
    renderDashboard(content, stats);
    refreshLastSyncLabel();
  } catch (e) {
    const cancelled = e.message.includes('cancelada');
    content.innerHTML = `
      <div class="card" style="text-align:center;padding:40px;max-width:640px">
        <p style="color:${cancelled ? 'var(--color-warning)' : 'var(--color-error)'};margin-bottom:12px">
          ${cancelled ? 'Carga cancelada.' : e.message}
        </p>
        <button class="btn btn-primary" id="dash-back-btn">Volver</button>
      </div>
    `;
    document.getElementById('dash-back-btn').onclick = renderStartScreen;
  } finally {
    _loadController = null;
  }
}

function computeStats(likes) {
  const decades = {};
  const artists = {};
  const albums = {};
  const addedByMonth = {};
  const addedByDow = [0, 0, 0, 0, 0, 0, 0];
  const addedByHour = new Array(24).fill(0);
  let totalDuration = 0;
  let explicitCount = 0;

  likes.forEach(item => {
    const t = item.track;
    if (!t) return;

    const year = parseInt(t.album?.release_date?.slice(0, 4));
    if (year) {
      const decade = `${Math.floor(year / 10) * 10}s`;
      decades[decade] = (decades[decade] || 0) + 1;
    }

    (t.artists || []).forEach(a => {
      if (a.name) artists[a.name] = (artists[a.name] || 0) + 1;
    });

    if (t.album?.name) {
      const key = `${t.album.name}|||${t.artists?.[0]?.name || ''}`;
      albums[key] = (albums[key] || 0) + 1;
    }

    if (item.added_at) {
      const date = new Date(item.added_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      addedByMonth[monthKey] = (addedByMonth[monthKey] || 0) + 1;
      addedByDow[date.getDay()]++;
      addedByHour[date.getHours()]++;
    }

    totalDuration += t.duration_ms || 0;
    if (t.explicit) explicitCount++;
  });

  const sortedArtists = Object.entries(artists).sort((a, b) => b[1] - a[1]);
  const sortedAlbums = Object.entries(albums)
    .map(([key, count]) => {
      const [album, artist] = key.split('|||');
      return { album, artist, count };
    })
    .sort((a, b) => b.count - a.count);

  const sortedMonths = Object.keys(addedByMonth).sort();
  const cumulativeByMonth = [];
  let cumulative = 0;
  sortedMonths.forEach(m => {
    cumulative += addedByMonth[m];
    cumulativeByMonth.push({ month: m, total: cumulative, added: addedByMonth[m] });
  });

  const uniqueArtists = Object.keys(artists).length;
  const uniqueAlbums = Object.keys(albums).length;

  return {
    total: likes.length,
    decades,
    topArtists: sortedArtists.slice(0, 15),
    topAlbums: sortedAlbums.slice(0, 10),
    uniqueArtists,
    uniqueAlbums,
    addedByMonth: cumulativeByMonth,
    addedByDow,
    addedByHour,
    totalDuration,
    explicitCount,
    explicitPct: likes.length > 0 ? Math.round((explicitCount / likes.length) * 100) : 0,
  };
}

function renderDashboard(container, stats) {
  const hours = Math.floor(stats.totalDuration / 3600000);
  const days = (hours / 24).toFixed(1);

  container.innerHTML = `
    <div class="dash-stats-row">
      <div class="stat-card">
        <div class="stat-value">${stats.total.toLocaleString()}</div>
        <div class="stat-label">Liked Songs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.uniqueArtists.toLocaleString()}</div>
        <div class="stat-label">Artistas</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.uniqueAlbums.toLocaleString()}</div>
        <div class="stat-label">Álbumes</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${hours.toLocaleString()}h</div>
        <div class="stat-label">${days} días de música</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.explicitPct}%</div>
        <div class="stat-label">Explícitas</div>
      </div>
      <div class="stat-card stat-card-clickable" id="listened-albums-card">
        <div class="stat-value" id="listened-albums-value">—</div>
        <div class="stat-label" id="listened-albums-label">Álbumes escuchados</div>
      </div>
    </div>

    <div class="dash-grid">
      <div class="card dash-chart-card">
        <h3>Por década</h3>
        <canvas id="chart-decades"></canvas>
      </div>
      <div class="card dash-chart-card">
        <h3>Top 15 artistas</h3>
        <canvas id="chart-artists"></canvas>
      </div>
      <div class="card dash-chart-card">
        <h3>Día de la semana</h3>
        <canvas id="chart-dow"></canvas>
      </div>
      <div class="card dash-chart-card">
        <h3>Hora del día</h3>
        <canvas id="chart-hour"></canvas>
      </div>
      <div class="card dash-chart-card dash-chart-wide">
        <h3>Evolución de la biblioteca</h3>
        <canvas id="chart-evolution"></canvas>
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <h3 style="margin-bottom:16px">Top 10 álbumes</h3>
      <div class="results-list">
        ${stats.topAlbums.map((a, i) => `
          <div class="track-row">
            <span style="width:28px;text-align:center;color:var(--color-text-muted);font-weight:700;flex-shrink:0">${i + 1}</span>
            <div class="track-info">
              <div class="track-name">${escapeHtml(a.album)}</div>
              <div class="track-artist">${escapeHtml(a.artist)}</div>
            </div>
            <span class="badge badge-accent">${a.count} tracks</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  buildCharts(stats);
  hydrateListenedAlbumsCard();
}

async function hydrateListenedAlbumsCard() {
  const card = document.getElementById('listened-albums-card');
  const valueEl = document.getElementById('listened-albums-value');
  const labelEl = document.getElementById('listened-albums-label');
  if (!card) return;

  const playlistId = localStorage.getItem('listened_albums_playlist_id');
  const playlistName = localStorage.getItem('listened_albums_playlist_name');

  const openPicker = () => openListenedAlbumsPicker({
    onSelect: hydrateListenedAlbumsCard,
    onClear: hydrateListenedAlbumsCard,
  });

  if (!playlistId) {
    valueEl.textContent = '+';
    valueEl.style.fontSize = '32px';
    labelEl.textContent = 'Configurar álbumes escuchados';
    card.onclick = openPicker;
    return;
  }

  valueEl.textContent = '…';
  labelEl.textContent = escapeHtml(playlistName || 'Álbumes escuchados');
  try {
    const items = await getAllPlaylistItems(playlistId);
    const albumIds = new Set();
    for (const it of items) {
      const albumId = it.item?.album?.id || it.track?.album?.id;
      if (albumId) albumIds.add(albumId);
    }
    valueEl.textContent = albumIds.size.toLocaleString();
    valueEl.style.fontSize = '';
    labelEl.innerHTML = `${escapeHtml(playlistName || 'Álbumes escuchados')} <span style="opacity:0.6">· ${items.length.toLocaleString()} tracks</span>`;
    card.onclick = openPicker;
    card.title = 'Click para cambiar la playlist';
  } catch (e) {
    valueEl.textContent = '!';
    labelEl.textContent = `Error: ${e.message.slice(0, 40)}`;
    card.onclick = openPicker;
  }
}

const CHART_COLORS = {
  accent: '#7C3AED',
  accentLight: 'rgba(124, 58, 237, 0.3)',
  accentSoft: 'rgba(124, 58, 237, 0.1)',
  text: '#8888A0',
  grid: 'rgba(42, 42, 58, 0.5)',
  surface: '#16161F',
};

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
  },
  scales: {
    x: {
      ticks: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 } },
      grid: { color: CHART_COLORS.grid },
      border: { color: CHART_COLORS.grid },
    },
    y: {
      ticks: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 } },
      grid: { color: CHART_COLORS.grid },
      border: { color: CHART_COLORS.grid },
    },
  },
};

function makeChart(id, config) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  const chart = new Chart(ctx, config);
  charts.push(chart);
  return chart;
}

function buildCharts(stats) {
  const sortedDecades = Object.entries(stats.decades).sort((a, b) => a[0].localeCompare(b[0]));

  makeChart('chart-decades', {
    type: 'bar',
    data: {
      labels: sortedDecades.map(d => d[0]),
      datasets: [{
        data: sortedDecades.map(d => d[1]),
        backgroundColor: CHART_COLORS.accent,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: { ...CHART_DEFAULTS },
  });

  makeChart('chart-artists', {
    type: 'bar',
    data: {
      labels: stats.topArtists.map(a => a[0]),
      datasets: [{
        data: stats.topArtists.map(a => a[1]),
        backgroundColor: CHART_COLORS.accent,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      indexAxis: 'y',
      scales: {
        ...CHART_DEFAULTS.scales,
        y: {
          ...CHART_DEFAULTS.scales.y,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, font: { family: 'Inter', size: 10 } },
        },
      },
    },
  });

  const dowLabels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  makeChart('chart-dow', {
    type: 'bar',
    data: {
      labels: dowLabels,
      datasets: [{
        data: stats.addedByDow,
        backgroundColor: CHART_COLORS.accent,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: { ...CHART_DEFAULTS },
  });

  const hourLabels = Array.from({ length: 24 }, (_, i) => `${i}h`);
  makeChart('chart-hour', {
    type: 'bar',
    data: {
      labels: hourLabels,
      datasets: [{
        data: stats.addedByHour,
        backgroundColor: CHART_COLORS.accentLight,
        borderColor: CHART_COLORS.accent,
        borderWidth: 1,
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x.ticks, maxRotation: 0, font: { family: 'Inter', size: 9 } } },
      },
    },
  });

  makeChart('chart-evolution', {
    type: 'line',
    data: {
      labels: stats.addedByMonth.map(m => m.month),
      datasets: [
        {
          label: 'Total acumulado',
          data: stats.addedByMonth.map(m => m.total),
          borderColor: CHART_COLORS.accent,
          backgroundColor: CHART_COLORS.accentSoft,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          borderWidth: 2,
        },
        {
          label: 'Agregadas por mes',
          data: stats.addedByMonth.map(m => m.added),
          borderColor: 'rgba(124, 58, 237, 0.4)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          tension: 0.3,
          pointRadius: 0,
          pointHitRadius: 10,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 }, padding: 16 },
        },
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        x: {
          ...CHART_DEFAULTS.scales.x,
          ticks: { ...CHART_DEFAULTS.scales.x.ticks, maxTicksLimit: 12, maxRotation: 45, font: { family: 'Inter', size: 10 } },
        },
        y: { ...CHART_DEFAULTS.scales.y, position: 'left' },
        y1: {
          ...CHART_DEFAULTS.scales.y,
          position: 'right',
          grid: { display: false },
        },
      },
    },
  });
}
