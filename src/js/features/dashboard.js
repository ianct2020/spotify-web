import { getAllLikedTracks, invalidateLikesCache, exportAllData, importAllData, getCurrentUserId, getLikesTotal, syncLikesIncremental } from '../api.js';
import { showProgress, hideProgress } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

let charts = [];
let _loadController = null;

export function render(container) {
  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
      <div>
        <h1>Dashboard</h1>
        <p>Stats de tu biblioteca de Liked Songs.</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="dash-export-all-btn">Exportar todo</button>
        <button class="btn btn-secondary btn-sm" id="dash-import-all-btn">Importar todo</button>
        <input type="file" id="dash-import-all-input" accept=".json,application/json" style="display:none">
        <button class="btn btn-secondary btn-sm" id="dash-refresh-btn">Actualizar datos</button>
      </div>
    </div>
    <div id="dash-content"></div>
  `;

  document.getElementById('dash-refresh-btn').onclick = handleRefresh;
  document.getElementById('dash-export-all-btn').onclick = handleExportAll;
  const importInput = document.getElementById('dash-import-all-input');
  document.getElementById('dash-import-all-btn').onclick = () => importInput.click();
  importInput.onchange = handleImportAll;

  renderStartScreen();

  return () => {
    charts.forEach(c => c.destroy());
    charts = [];
  };
}

function renderStartScreen() {
  const content = document.getElementById('dash-content');
  if (!content) return;

  const cached = JSON.parse(localStorage.getItem('cache_all_liked_tracks') || 'null');
  const cachedCount = cached?.data?.length || 0;
  const hasCache = cachedCount > 0;

  content.innerHTML = `
    <div class="card" style="max-width:640px">
      <h3 style="margin-bottom:8px">¿Cómo querés arrancar?</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">
        ${hasCache
          ? `Tenés <strong>${cachedCount.toLocaleString()}</strong> likes cacheados en este browser (menos de 60 min de antigüedad). Podés usarlos directo o importar un JSON previo.`
          : `No hay likes cacheados. Podés cargar todo desde Spotify (~190 requests, tarda ~2 min) o importar un JSON previo (1 request, mucho más rápido).`}
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="dash-start-btn">${hasCache ? 'Usar los cacheados' : 'Cargar desde Spotify'}</button>
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

async function handleExportAll() {
  let userId = null;
  try { userId = await getCurrentUserId(); } catch {}
  const data = exportAllData(userId);
  const likesCount = data.likes.items.length;
  const tagsCount = Object.keys(data.tags.entries).length;
  if (likesCount === 0 && tagsCount === 0) {
    showToast('No hay datos para exportar (cargá likes o corrí "Por género" primero)', 'error');
    return;
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
  showToast(`Exportado: ${likesCount.toLocaleString()} likes + ${tagsCount.toLocaleString()} artistas`, 'success');
}

async function handleImportAll(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    showProgress('Importando...', 0, 0);
    const result = await importAllData(parsed, ({ message }) => {
      showProgress(message, 0, 0);
    });
    hideProgress();
    const parts = [];
    if (result.likesImported > 0) parts.push(`${result.likesImported.toLocaleString()} likes`);
    if (result.likesAdded > 0) parts.push(`+${result.likesAdded} nuevos traídos`);
    if (result.tagsImported > 0) parts.push(`${result.tagsImported} artistas nuevos`);
    if (result.tagsUpdated > 0) parts.push(`${result.tagsUpdated} actualizados`);
    const msg = parts.length > 0 ? `Importado: ${parts.join(' · ')}` : 'Archivo importado (sin cambios)';
    showToast(msg, 'success');
    loadData(false);
  } catch (err) {
    hideProgress();
    showToast('Error importando: ' + err.message, 'error');
  }
}

async function loadData(forceRefresh) {
  const content = document.getElementById('dash-content');
  if (!content) return;

  if (forceRefresh) invalidateLikesCache();

  _loadController = new AbortController();

  content.innerHTML = `
    <div class="card" style="max-width:640px;text-align:center">
      <div class="spinner spinner-lg" style="margin:0 auto 16px"></div>
      <div id="dash-load-text" style="font-size:14px;margin-bottom:8px">Cargando Liked Songs...</div>
      <div style="height:8px;background:var(--color-elevated);border-radius:4px;overflow:hidden;margin-bottom:16px">
        <div id="dash-load-bar" style="height:100%;background:var(--color-accent);width:0%;transition:width 0.2s"></div>
      </div>
      <button class="btn btn-secondary btn-sm" id="dash-cancel-btn">Cancelar carga</button>
    </div>
  `;

  const textEl = document.getElementById('dash-load-text');
  const barEl = document.getElementById('dash-load-bar');
  document.getElementById('dash-cancel-btn').onclick = () => {
    _loadController?.abort();
  };

  try {
    const likes = await getAllLikedTracks(({ loaded, total, cached }) => {
      if (cached) {
        textEl.textContent = `Usando cache local (${loaded.toLocaleString()} likes)`;
        barEl.style.width = '100%';
      } else {
        const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
        textEl.textContent = `Cargando ${loaded.toLocaleString()} / ${(total || '?').toLocaleString()}`;
        barEl.style.width = `${pct}%`;
      }
    }, { signal: _loadController.signal });

    charts.forEach(c => c.destroy());
    charts = [];

    const stats = computeStats(likes);
    renderDashboard(content, stats);
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
  const popularityBuckets = { '0-19': 0, '20-39': 0, '40-59': 0, '60-79': 0, '80-100': 0 };
  let totalDuration = 0;
  let totalPopularity = 0;
  let popularityCount = 0;
  let nullPopularityCount = 0;
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

    if (t.popularity != null) {
      totalPopularity += t.popularity;
      popularityCount++;
      if (t.popularity < 20) popularityBuckets['0-19']++;
      else if (t.popularity < 40) popularityBuckets['20-39']++;
      else if (t.popularity < 60) popularityBuckets['40-59']++;
      else if (t.popularity < 80) popularityBuckets['60-79']++;
      else popularityBuckets['80-100']++;
    } else {
      nullPopularityCount++;
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
    popularityBuckets,
    avgPopularity: popularityCount > 0 ? Math.round(totalPopularity / popularityCount) : 0,
    popularityCount,
    nullPopularityCount,
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
        <div class="stat-value">${stats.avgPopularity}</div>
        <div class="stat-label">Popularidad promedio</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.explicitPct}%</div>
        <div class="stat-label">Explícitas</div>
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
        <h3>Popularidad</h3>
        <canvas id="chart-popularity"></canvas>
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
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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

  const popLabels = Object.keys(stats.popularityBuckets);
  const popData = Object.values(stats.popularityBuckets);
  const popTotal = popData.reduce((a, b) => a + b, 0);
  if (popTotal === 0) {
    const canvas = document.getElementById('chart-popularity');
    if (canvas) {
      const card = canvas.closest('.dash-chart-card');
      if (card) {
        const nullPct = stats.nullPopularityCount > 0
          ? Math.round((stats.nullPopularityCount / (stats.nullPopularityCount + stats.popularityCount)) * 100)
          : 0;
        card.innerHTML = `
          <h3>Popularidad</h3>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:180px;color:var(--color-text-secondary);text-align:center;padding:16px;font-size:13px;gap:8px">
            <div><strong style="color:var(--color-warning)">${nullPct}%</strong> de tus tracks (${stats.nullPopularityCount.toLocaleString()}) no tienen popularity.</div>
            ${nullPct === 100
              ? `<div>Spotify probablemente sacó el campo <code>popularity</code> del endpoint <code>/me/tracks</code> en la migración feb 2026.</div>`
              : `<div>Los que sí tienen popularity: ${stats.popularityCount.toLocaleString()}. Probá "Actualizar datos" para volver a bajar.</div>`}
          </div>
        `;
      }
    }
  } else {
    makeChart('chart-popularity', {
      type: 'doughnut',
      data: {
        labels: popLabels,
        datasets: [{
          data: popData,
          backgroundColor: [
            'rgba(124, 58, 237, 0.3)',
            'rgba(124, 58, 237, 0.5)',
            'rgba(124, 58, 237, 0.65)',
            'rgba(124, 58, 237, 0.8)',
            'rgba(124, 58, 237, 1)',
          ],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: CHART_COLORS.text, font: { family: 'Inter', size: 11 }, padding: 12 },
          },
        },
      },
    });
  }

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
