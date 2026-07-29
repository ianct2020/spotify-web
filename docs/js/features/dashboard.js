import { getAllLikedTracks, invalidateLikesCache, exportAllData, importAllData, getCurrentUserId, getLikesTotal, syncLikesIncremental, getLikesCacheTimestamp, getBestAvailableLikes, getAllPlaylistItems } from '../api.js?v=91';
import { showProgress, hideProgress, alertModal, escapeHtml } from '../ui/components.js?v=91';
import { showToast } from '../ui/toast.js?v=91';
import { openListenedAlbumsPicker } from './listened-shared.js?v=91';
import { loadHistoryStats, loadListenedAlbums } from './history-data.js?v=91';
import { findArtistTopPreview } from '../api/itunes.js?v=91';
import { hoverIn, hoverOut } from '../ui/preview-player.js?v=91';

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
    intro = `<span style="color:var(--color-warning)">Carga parcial:</span> tenés <strong>${cachedCount.toLocaleString()}</strong> likes (se cortó a mitad la última vez${lastSyncLabel ? ', hace ' + lastSyncLabel : ''}). Podés retomar desde donde quedó, ver el dashboard ya mismo con lo que hay, o importar un JSON.`;
  } else {
    intro = `No hay likes cacheados. Podés cargar todo desde Spotify (~190 requests, tarda ~2-4 min) o importar un JSON previo (1 request, mucho más rápido).`;
  }

  const primaryLabel = hasFull ? 'Usar los cacheados' : (hasPartial ? 'Retomar carga' : 'Cargar desde Spotify');

  content.innerHTML = `
    <div class="card dash-state-card">
      <h3 style="margin-bottom:8px">¿Cómo querés arrancar?</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">${intro}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
        <button class="btn btn-primary" id="dash-start-btn">${primaryLabel}</button>
        ${hasPartial ? `<button class="btn btn-secondary" id="dash-usepartial-btn">Usar los ${cachedCount.toLocaleString()} que ya tengo</button>` : ''}
        <button class="btn btn-secondary" id="dash-preimport-btn">Importar JSON</button>
        <input type="file" id="dash-preimport-input" accept=".json,application/json" style="display:none">
      </div>
    </div>
  `;

  document.getElementById('dash-start-btn').onclick = () => loadData(false);
  const usePartialBtn = document.getElementById('dash-usepartial-btn');
  if (usePartialBtn) usePartialBtn.onclick = () => renderFromCachedItems(cachedItems);
  const preInput = document.getElementById('dash-preimport-input');
  document.getElementById('dash-preimport-btn').onclick = () => preInput.click();
  preInput.onchange = handleImportAll;
}

// Dibuja el dashboard con lo que ya está en cache (típicamente una carga parcial que
// cortaste con "Detener carga"). Cero requests a Spotify — si querés los que faltan,
// está "Actualizar datos" arriba.
function renderFromCachedItems(items) {
  const content = document.getElementById('dash-content');
  if (!content || !items?.length) return;
  charts.forEach(c => c.destroy());
  charts = [];
  renderDashboard(content, computeStats(items));
  refreshLastSyncLabel();
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
    <div class="card dash-state-card dash-state-card-center">
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
    if (result.reconciled) {
      showToast(`Reconciliado: ${result.removed} like(s) que borraste en Spotify se sacaron del cache (total: ${result.cachedCount.toLocaleString()})`, 'success');
    } else if (result.added === 0) {
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
    <div class="card dash-state-card dash-state-card-center">
      <div class="spinner spinner-lg" style="margin:0 auto 16px"></div>
      <div id="dash-load-text" style="font-size:15px;margin-bottom:6px;font-weight:500">Cargando Liked Songs...</div>
      <div id="dash-load-eta" style="font-size:13px;color:var(--color-text-secondary);margin-bottom:18px">Calculando ETA...</div>
      <div style="height:10px;background:var(--color-elevated);border-radius:5px;overflow:hidden;margin-bottom:22px">
        <div id="dash-load-bar" style="height:100%;background:var(--color-accent);width:0%;transition:width 0.2s"></div>
      </div>
      <button class="btn btn-danger" id="dash-cancel-btn" style="min-width:180px">Detener carga</button>
      <div style="font-size:12px;color:var(--color-text-muted);margin-top:12px">Podés detener sin problema — la próxima vez retoma desde donde quedó.</div>
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
      <div class="card dash-state-card dash-state-card-center" style="padding:40px">
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

    <div class="card" id="listened-year-card" style="margin-top:22px;margin-bottom:22px;display:none">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <h3 style="margin:0">Álbumes escuchados por año</h3>
        <span style="font-size:12px;color:var(--color-text-muted)" id="listened-year-hint">Detectados desde tu historial · click para ver la lista</span>
      </div>
      <div id="listened-year-tiles" style="display:grid;gap:10px;min-height:70px;align-items:center;color:var(--color-text-muted);font-size:13px">Cargando…</div>
    </div>

    <div class="dash-grid">
      <div class="card dash-chart-card">
        <h3>Por década</h3>
        <div class="chart-box"><canvas id="chart-decades"></canvas></div>
      </div>
      <div class="card dash-chart-card">
        <h3>Top 15 artistas <span style="font-weight:400;color:var(--color-text-muted);font-size:13px">· nº = canciones tuyas en likes</span></h3>
        <div class="chart-box"><canvas id="chart-artists"></canvas></div>
      </div>
      <div class="card dash-chart-card">
        <h3>Día de la semana</h3>
        <div class="chart-box"><canvas id="chart-dow"></canvas></div>
      </div>
      <div class="card dash-chart-card">
        <h3>Hora del día</h3>
        <div class="chart-box"><canvas id="chart-hour"></canvas></div>
      </div>
      <div class="card dash-chart-card dash-chart-wide">
        <h3>Evolución de la biblioteca</h3>
        <div class="chart-box"><canvas id="chart-evolution"></canvas></div>
      </div>
    </div>

    <div id="history-section" style="margin-top:20px;display:none">
      <div style="display:flex;align-items:baseline;gap:10px;margin:20px 0 12px 0;flex-wrap:wrap">
        <h2 style="margin:0;font-size:20px">Del historial de reproducción</h2>
        <span style="font-size:12px;color:var(--color-text-muted)">Tu Extended Streaming History real, no lo que likeaste</span>
      </div>
      <div class="dash-stats-row" id="history-stat-tiles"></div>
      <div class="dash-grid" style="margin-top:16px">
        <div class="card dash-chart-card dash-chart-wide">
          <h3>Evolución mensual — minutos escuchados</h3>
          <div class="chart-box"><canvas id="chart-history-monthly"></canvas></div>
        </div>
        <div class="card dash-chart-card dash-chart-wide">
          <h3>Heatmap — cuándo escuchás <span style="font-weight:400;color:var(--color-text-muted);font-size:13px">· min / día × hora</span></h3>
          <div id="history-heatmap" style="display:flex;justify-content:center;align-items:center;padding:8px 0"></div>
        </div>
        <div class="card dash-chart-card dash-chart-wide">
          <h3>Top 20 artistas <span style="font-weight:400;color:var(--color-text-muted);font-size:13px">· por tiempo escuchado real</span></h3>
          <div class="chart-box chart-box-tall"><canvas id="chart-history-artists"></canvas></div>
        </div>
        <div class="card dash-chart-card dash-chart-wide">
          <h3>Top 20 álbumes <span style="font-weight:400;color:var(--color-text-muted);font-size:13px">· por tiempo escuchado real</span></h3>
          <div id="history-top-albums" style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:6px 20px"></div>
        </div>
      </div>
    </div>

  `;

  buildCharts(stats);
  hydrateListenedAlbumsCard();
  hydrateListenedYearTiles();
  hydrateHistorySection();
}

async function hydrateHistorySection() {
  const section = document.getElementById('history-section');
  if (!section) return;
  const h = await loadHistoryStats();
  if (!h || !h.years?.length) { section.style.display = 'none'; return; }
  section.style.display = '';

  // Stat tiles arriba (5)
  const t = h.totals || {};
  const totalHours = Math.round((t.min || 0) / 60);
  const totalDays = ((t.min || 0) / 60 / 24).toFixed(1);
  const tiles = document.getElementById('history-stat-tiles');
  if (tiles) tiles.innerHTML = `
    <div class="stat-card"><div class="stat-value">${totalHours.toLocaleString('es-AR')}h</div><div class="stat-label">${totalDays} días de música</div></div>
    <div class="stat-card"><div class="stat-value">${(t.plays_valid || 0).toLocaleString('es-AR')}</div><div class="stat-label">Plays (≥30s)</div></div>
    <div class="stat-card"><div class="stat-value">${(t.days_active || 0).toLocaleString('es-AR')}</div><div class="stat-label">Días activos</div></div>
    <div class="stat-card"><div class="stat-value">${t.longest_streak || 0}</div><div class="stat-label">Racha más larga (días)</div></div>
    <div class="stat-card"><div class="stat-value">${t.skip_pct || 0}%</div><div class="stat-label">Skips</div></div>
  `;

  // Evolución mensual (line)
  if (h.monthly?.length) {
    makeChart('chart-history-monthly', {
      type: 'line',
      data: {
        labels: h.monthly.map(m => m.m),
        datasets: [{
          data: h.monthly.map(m => m.min),
          borderColor: CHART_COLORS.accent,
          backgroundColor: CHART_COLORS.accentSoft,
          fill: true,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.25,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: {
            ...CHART_DEFAULTS.plugins.tooltip,
            callbacks: {
              title: items => items[0]?.label || '',
              label: ctx => `${Math.round(ctx.parsed.y).toLocaleString('es-AR')} min`,
            },
          },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          x: {
            ...CHART_DEFAULTS.scales.x,
            ticks: {
              ...CHART_DEFAULTS.scales.x.ticks,
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 12,
              callback: function (val) {
                const label = this.getLabelForValue(val);
                return label && label.endsWith('-01') ? label.slice(0, 4) : '';
              },
            },
          },
        },
      },
    });
  }

  // Heatmap 7×24
  renderHeatmap(h.heatmap);

  // Top 20 artistas por minutos (bar horizontal)
  const topArtists = (h.top_artists_all_time || []).slice(0, 20);
  if (topArtists.length) {
    makeChart('chart-history-artists', {
      type: 'bar',
      data: {
        labels: topArtists.map(a => a.name),
        datasets: [{
          data: topArtists.map(a => a.min),
          backgroundColor: CHART_COLORS.accent,
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        ...CHART_DEFAULTS,
        ...artistHoverHandlers(topArtists.map(a => a.name)),
        indexAxis: 'y',
        // mode 'y' + intersect:false: en barras horizontales proyecta el Y del mouse
        // a la fila de categoría — engancha la barra que el ojo espera, sin off-by-one
        // por el label pintado abajo del centro del bar.
        interaction: { mode: 'nearest', intersect: false, axis: 'y' },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          tooltip: {
            ...CHART_DEFAULTS.plugins.tooltip,
            callbacks: {
              title: items => items[0]?.label || '',
              label: ctx => `${Math.round(ctx.parsed.x).toLocaleString('es-AR')} min`,
            },
          },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          x: {
            ...CHART_DEFAULTS.scales.x,
            title: { display: true, text: 'Minutos totales escuchados', color: '#8888A0', font: { family: 'Inter', size: 11 } },
          },
          y: {
            ...CHART_DEFAULTS.scales.y,
            ticks: { ...CHART_DEFAULTS.scales.y.ticks, font: { family: 'Inter', size: 14, weight: '500' } },
          },
        },
      },
    });
    wireChartHoverExit('chart-history-artists');
  }

  // Top 20 álbumes por minutos (lista simple)
  const topAlbums = (h.top_albums_all_time || []).slice(0, 20);
  const listHolder = document.getElementById('history-top-albums');
  if (listHolder) listHolder.innerHTML = topAlbums.map((a, i) => `
    <div class="track-row">
      <span style="width:28px;text-align:center;color:var(--color-text-muted);font-weight:700;flex-shrink:0">${i + 1}</span>
      ${a.img ? `<img src="${a.img}" alt="" style="width:36px;height:36px;border-radius:4px;object-fit:cover;flex-shrink:0" loading="lazy">` : ''}
      <div class="track-info">
        <div class="track-name">${escapeHtml(a.name)}</div>
        <div class="track-artist">${escapeHtml(a.artist)}</div>
      </div>
      <span class="badge badge-accent">${Math.round(a.min).toLocaleString('es-AR')}m</span>
    </div>
  `).join('');
}

function renderHeatmap(matrix) {
  const holder = document.getElementById('history-heatmap');
  if (!holder || !matrix || !matrix.length) return;

  const dayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  let max = 0;
  for (const row of matrix) for (const v of row) if (v > max) max = v;
  if (max === 0) { holder.innerHTML = '<div style="color:var(--color-text-muted);font-size:13px;padding:12px">Sin datos</div>'; return; }

  const cellSize = 26;
  const cellGap = 4;
  const labelWidth = 44;
  const hourLabelHeight = 24;
  const width = labelWidth + 24 * (cellSize + cellGap);
  const height = hourLabelHeight + 7 * (cellSize + cellGap);

  let svg = `<svg viewBox="0 0 ${width} ${height}" style="width:100%;max-width:${width}px;height:auto;font-family:Inter,sans-serif;display:block">`;
  // etiquetas de hora (cada 3)
  for (let h = 0; h < 24; h++) {
    if (h % 3 !== 0) continue;
    const x = labelWidth + h * (cellSize + cellGap) + cellSize/2;
    svg += `<text x="${x}" y="${hourLabelHeight - 5}" fill="#8888A0" font-size="13" text-anchor="middle">${h}h</text>`;
  }
  // filas
  for (let d = 0; d < 7; d++) {
    const y = hourLabelHeight + d * (cellSize + cellGap);
    svg += `<text x="${labelWidth - 5}" y="${y + cellSize/2 + 3}" fill="#8888A0" font-size="13" text-anchor="end">${dayLabels[d]}</text>`;
    for (let h = 0; h < 24; h++) {
      const x = labelWidth + h * (cellSize + cellGap);
      const val = matrix[d][h] || 0;
      const alpha = val / max;
      const fill = alpha === 0 ? 'rgba(255,255,255,0.03)' : `rgba(124,58,237,${0.15 + alpha * 0.85})`;
      const pctOfMax = Math.round(alpha * 100);
      const delay = (d * 24 + h) * 4;
      svg += `<rect class="heatmap-cell" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${fill}" data-d="${d}" data-h="${h}" data-v="${Math.round(val)}" data-p="${pctOfMax}" style="animation-delay:${delay}ms"></rect>`;
    }
  }
  svg += '</svg>';
  holder.innerHTML = svg;

  // Tooltip flotante custom
  let tip = document.getElementById('heatmap-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'heatmap-tip';
    tip.style.cssText = 'position:fixed;background:#0f0f18;border:1px solid #2a2a3a;border-radius:6px;padding:6px 10px;font-size:12px;color:#f0f0f5;pointer-events:none;z-index:9999;display:none;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-family:Inter,sans-serif';
    document.body.appendChild(tip);
  }

  holder.querySelectorAll('.heatmap-cell').forEach(rect => {
    rect.addEventListener('mouseenter', ev => {
      const d = +rect.dataset.d, h = +rect.dataset.h, v = +rect.dataset.v, p = +rect.dataset.p;
      const hourStr = String(h).padStart(2, '0') + ':00';
      tip.innerHTML = `<strong>${dayLabels[d]} ${hourStr}</strong><br><span style="color:#a68cf0">${v.toLocaleString('es-AR')} min</span> · ${p}% del pico`;
      tip.style.display = 'block';
    });
    rect.addEventListener('mousemove', ev => {
      const pad = 14;
      let x = ev.clientX + pad;
      let y = ev.clientY + pad;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      if (x + tw > window.innerWidth) x = ev.clientX - tw - pad;
      if (y + th > window.innerHeight) y = ev.clientY - th - pad;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    });
    rect.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}

async function hydrateListenedYearTiles() {
  const card = document.getElementById('listened-year-card');
  const holder = document.getElementById('listened-year-tiles');
  const hint = document.getElementById('listened-year-hint');
  if (!card || !holder) return;

  card.style.display = '';
  try {
    const data = await loadListenedAlbums();
    if (!data || !data.years?.length) { card.style.display = 'none'; return; }

    const years = [...data.years].sort((a, b) => b.year - a.year);
    if (hint && data.criteria) {
      hint.textContent = `Detectados en tu historial · ≥${data.criteria.min_tracks_sameday} tracks distintos o ≥${data.criteria.min_min_sameday} min en un mismo día · click para ver la lista`;
    }

    holder.style.color = '';
    holder.style.fontSize = '';
    // Forzar 1 fila cuando la cantidad de años entra bien (típicamente 9-10).
    holder.style.gridTemplateColumns = years.length <= 12
      ? `repeat(${years.length}, minmax(0, 1fr))`
      : 'repeat(auto-fit, minmax(110px, 1fr))';
    holder.innerHTML = years.map(y => `
      <button class="year-tile" data-year="${y.year}" style="background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:10px 12px;text-align:left;cursor:pointer;transition:border-color .15s,transform .05s;min-width:0">
        <div style="font-size:19px;font-weight:700;color:var(--color-text);line-height:1.1">${y.count.toLocaleString('es-AR')}</div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-top:3px">${y.year}</div>
      </button>
    `).join('');
    holder.querySelectorAll('.year-tile').forEach(tile => {
      tile.onclick = () => openHistoryYearModal(+tile.dataset.year, years.find(y => y.year === +tile.dataset.year), data.criteria);
    });
  } catch (e) {
    holder.innerHTML = `<span style="color:var(--color-error)">Error cargando: ${escapeHtml(e.message)}</span>`;
  }
}

function openHistoryYearModal(year, bucket, criteria) {
  if (!bucket) return;
  const list = bucket.albums; // ya vienen ordenados desc por date
  const fmt = iso => {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-picker" style="max-width:560px">
      <h2 style="margin-bottom:4px">Álbumes escuchados en ${year}</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:10px">
        ${bucket.count.toLocaleString('es-AR')} álbum${bucket.count === 1 ? '' : 'es'} detectado${bucket.count === 1 ? '' : 's'} en ${year} (≥${criteria?.min_tracks_sameday || 4} tracks distintos o ≥${criteria?.min_min_sameday || 25} min en un mismo día).
      </p>
      <div class="picker-scroll">
        <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm)">
          ${list.map(a => `
            <div class="pick-row" style="display:flex;align-items:center;gap:11px;padding:9px 12px;border-bottom:1px solid var(--color-border)">
              ${a.img ? `<img src="${a.img}" loading="lazy" class="pick-cover">` : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px">♪</div>`}
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name || '(sin nombre)')}</div>
                <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.artist || '')}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:11px;color:var(--color-text-muted)">${escapeHtml(fmt(a.date))}</div>
                <div style="font-size:11px;color:var(--color-text-muted)">${a.tracks_that_day} tks · ${Math.round(a.min_that_day)} min</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="modal-actions" style="margin-top:12px">
        <button class="btn btn-secondary" id="year-close">Cerrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#year-close').onclick = close;
  overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
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

  const goToListened = () => { location.hash = '#listened'; };

  labelEl.textContent = 'Álbumes escuchados';
  card.onclick = goToListened;
  card.title = 'Ir a Álbumes escuchados';
  valueEl.style.fontSize = '';

  // Mostrar YA el conteo del historial (viene del IDB, instantáneo) para no dejar "..."
  try {
    const listened = await loadListenedAlbums();
    if (listened?.totals?.albums) {
      valueEl.textContent = listened.totals.albums.toLocaleString('es-AR');
    } else {
      valueEl.textContent = '—';
    }
  } catch {
    valueEl.textContent = '—';
  }

  // En segundo plano, actualizar con el conteo real de la playlist del registro.
  try {
    const items = await getAllPlaylistItems(playlistId);
    const albumIds = new Set();
    for (const it of items) {
      const albumId = it.item?.album?.id || it.track?.album?.id;
      if (albumId) albumIds.add(albumId);
    }
    valueEl.textContent = albumIds.size.toLocaleString('es-AR');
  } catch (e) {
    // dejamos el número del historial; no ensuciamos el UI con error acá
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
  // 'nearest' + axis:'x' es lo correcto para bar charts VERTICALES (Por década,
  // Día de la semana, Hora del día, Evolución): agarra la barra cuya X está más
  // cerca del cursor. 'index'/'xy' anteriores enganchaban la barra de al lado
  // cuando el cursor caía entre dos. Los charts con indexAxis:'y' (Top artistas,
  // Top álbumes del historial) sobrescriben con axis:'y' abajo.
  interaction: {
    mode: 'nearest',
    intersect: false,
    axis: 'x',
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      enabled: true,
      backgroundColor: 'rgba(15, 15, 24, 0.96)',
      titleColor: '#f0f0f5',
      titleFont: { family: 'Inter', size: 12, weight: '600' },
      bodyColor: '#a68cf0',
      bodyFont: { family: 'Inter', size: 13, weight: '500' },
      padding: 10,
      borderColor: '#2a2a3a',
      borderWidth: 1,
      cornerRadius: 8,
      displayColors: false,
      caretSize: 6,
      caretPadding: 8,
    },
  },
  scales: {
    x: {
      ticks: { color: CHART_COLORS.text, font: { family: 'Inter', size: 13 } },
      grid: { color: CHART_COLORS.grid },
      border: { color: CHART_COLORS.grid },
    },
    y: {
      ticks: { color: CHART_COLORS.text, font: { family: 'Inter', size: 13 } },
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

// Hover-play para charts de artistas: apoyás el mouse en una barra y suena el
// tema más escuchado del artista (preview iTunes, se corta al salir). El delay
// de 500ms evita ametrallar la API barriendo el chart de punta a punta.
function artistHoverHandlers(labels) {
  return {
    onHover(evt, elements) {
      if (elements?.length) {
        const name = labels[elements[0].index];
        hoverIn(`dash-art:${name}`, async () => {
          const p = await findArtistTopPreview(name);
          return p && { url: p.url, label: `${p.track} — ${p.artist}` };
        }, 500);
      } else {
        hoverOut();
      }
    },
  };
}

function wireChartHoverExit(id) {
  document.getElementById(id)?.addEventListener('mouseleave', hoverOut);
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
      ...artistHoverHandlers(stats.topArtists.map(a => a[0])),
      indexAxis: 'y',
      // Ver dashboard "chart-history-artists": mismo motivo.
      interaction: { mode: 'nearest', intersect: false, axis: 'y' },
      scales: {
        ...CHART_DEFAULTS.scales,
        x: {
          ...CHART_DEFAULTS.scales.x,
          title: { display: true, text: 'Canciones tuyas en Liked Songs', color: '#8888A0', font: { family: 'Inter', size: 11 } },
        },
        y: {
          ...CHART_DEFAULTS.scales.y,
          ticks: { ...CHART_DEFAULTS.scales.y.ticks, font: { family: 'Inter', size: 13 } },
        },
      },
    },
  });
  wireChartHoverExit('chart-artists');

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
        ...CHART_DEFAULTS.plugins,
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
