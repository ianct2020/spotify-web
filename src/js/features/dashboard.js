import { getAllLikedTracks, getUserProfile } from '../api.js';
import { cacheGet, cacheSet } from '../storage.js';
import { showProgress, hideProgress } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

const CACHE_KEY = 'dashboard_likes';
let charts = [];

export function render(container) {
  container.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
      <div>
        <h1>Dashboard</h1>
        <p>Stats de tu biblioteca de Liked Songs.</p>
      </div>
      <button class="btn btn-secondary btn-sm" id="dash-refresh-btn">Actualizar datos</button>
    </div>
    <div id="dash-content">
      <div class="empty-state">
        <div class="spinner spinner-lg"></div>
        <p style="margin-top:16px">Cargando estadísticas...</p>
      </div>
    </div>
  `;

  document.getElementById('dash-refresh-btn').onclick = () => loadData(true);
  loadData(false);

  return () => {
    charts.forEach(c => c.destroy());
    charts = [];
  };
}

async function loadData(forceRefresh) {
  const content = document.getElementById('dash-content');
  if (!content) return;

  try {
    let likes = forceRefresh ? null : cacheGet(CACHE_KEY);

    if (!likes) {
      showProgress('Cargando Liked Songs...', 0, 0);
      likes = await getAllLikedTracks(({ loaded, total }) => {
        showProgress('Cargando Liked Songs...', loaded, total);
      });
      cacheSet(CACHE_KEY, likes, 60 * 24);
      hideProgress();
    }

    charts.forEach(c => c.destroy());
    charts = [];

    const stats = computeStats(likes);
    renderDashboard(content, stats);
  } catch (e) {
    hideProgress();
    content.innerHTML = `
      <div class="card" style="text-align:center;padding:40px">
        <p style="color:var(--color-error);margin-bottom:12px">${e.message}</p>
        <button class="btn btn-primary" onclick="location.reload()">Reintentar</button>
      </div>
    `;
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
      if (t.popularity < 20) popularityBuckets['0-19']++;
      else if (t.popularity < 40) popularityBuckets['20-39']++;
      else if (t.popularity < 60) popularityBuckets['40-59']++;
      else if (t.popularity < 80) popularityBuckets['60-79']++;
      else popularityBuckets['80-100']++;
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
    avgPopularity: likes.length > 0 ? Math.round(totalPopularity / likes.length) : 0,
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
