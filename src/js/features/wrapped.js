// Wrapped propio: mini-resumen tuyo por año, hecho con el Extended Streaming History.
// A diferencia del Wrapped oficial (que corre oct-sept), este es del año calendario completo.

import { loadHistoryStats } from './history-data.js';
import { escapeHtml } from '../ui/components.js';

let stats = null;
let selectedYear = null;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h.toLocaleString('es-AR')}h ${m}m`;
  }
  return `${Math.round(min)}m`;
}

function fmtDays(minutes) {
  const days = minutes / (60 * 24);
  return `${days.toFixed(1)} días equivalentes`;
}

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Wrapped tuyo, por año</h1>
      <p>Todo tu Extended Streaming History resumido por año calendario. Sin cortes por Wrapped oficial.</p>
    </div>
    <div id="wrapped-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando historial…</div></div></div>
  `;

  stats = await loadHistoryStats();
  const content = document.getElementById('wrapped-content');
  if (!stats || !stats.years || !stats.years.length) {
    content.innerHTML = `<div class="card"><p>No pude cargar el historial de reproducción. Volvé a probar.</p></div>`;
    return;
  }

  // orden inverso (más nuevo arriba) y default = último año con datos
  const yearsDesc = [...stats.years].sort((a, b) => b.year - a.year);
  if (!selectedYear || !yearsDesc.find(y => y.year === selectedYear)) {
    selectedYear = yearsDesc[0].year;
  }

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div>
          <div style="font-size:12px;color:var(--color-text-muted);letter-spacing:0.06em;text-transform:uppercase">Elegí el año</div>
        </div>
        <div style="font-size:12px;color:var(--color-text-muted)">Datos desde ${fmtDate(stats.totals?.first_play || stats.years[0].first_play)} · ${stats.totals.plays_valid.toLocaleString('es-AR')} plays válidas (≥30s)</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap" id="wrapped-year-tabs">
        ${yearsDesc.map(y => `
          <button class="wrapped-year-tab ${y.year === selectedYear ? 'active' : ''}" data-year="${y.year}"
                  style="padding:8px 14px;border-radius:var(--radius-sm);border:1px solid var(--color-border);
                         background:${y.year === selectedYear ? 'var(--color-accent)' : 'var(--color-elevated)'};
                         color:${y.year === selectedYear ? '#fff' : 'var(--color-text)'};
                         font-weight:${y.year === selectedYear ? '600' : '500'};font-size:14px;cursor:pointer;
                         transition:transform .05s,border-color .15s">${y.year}</button>
        `).join('')}
      </div>
    </div>
    <div id="wrapped-year-card"></div>
    <div id="wrapped-alltime" style="margin-top:24px"></div>
  `;

  content.querySelectorAll('.wrapped-year-tab').forEach(btn => {
    btn.onclick = () => {
      selectedYear = Number(btn.dataset.year);
      render(container);
    };
  });

  renderYearCard();
  renderAllTime();
}

function renderYearCard() {
  const holder = document.getElementById('wrapped-year-card');
  const y = stats.years.find(yy => yy.year === selectedYear);
  if (!y) { holder.innerHTML = ''; return; }

  const topArtist = y.top_artists?.[0];
  const topAlbum = y.top_albums?.[0];
  const topTrack = y.top_tracks?.[0];
  // peak_month.month es un número 1-12 (así lo guarda gen-stats.py)
  const monthName = y.peak_month ? MESES[(Number(y.peak_month.month) || 1) - 1] : '';

  holder.innerHTML = `
    <div class="card wrapped-card">
      <div class="wrapped-hero">
        <div class="wrapped-hero-year">${y.year}</div>
        <div class="wrapped-hero-min">${fmtMinutes(y.min)}</div>
        <div class="wrapped-hero-sub">${fmtDays(y.min)} · ${y.plays.toLocaleString('es-AR')} plays</div>
      </div>

      <div class="wrapped-grid">
        ${topArtist ? `
          <div class="wrapped-tile">
            <div class="wrapped-tile-label">Artista del año</div>
            <div class="wrapped-tile-value">${escapeHtml(topArtist.name)}</div>
            <div class="wrapped-tile-hint">${fmtMinutes(topArtist.min)} · ${topArtist.plays.toLocaleString('es-AR')} plays</div>
          </div>
        ` : ''}
        ${topAlbum ? `
          <div class="wrapped-tile">
            <div class="wrapped-tile-label">Álbum del año</div>
            ${topAlbum.img ? `<img src="${topAlbum.img}" alt="" class="wrapped-tile-cover" loading="lazy">` : ''}
            <div class="wrapped-tile-value" style="font-size:18px">${escapeHtml(topAlbum.name)}</div>
            <div class="wrapped-tile-hint">${escapeHtml(topAlbum.artist)} · ${fmtMinutes(topAlbum.min)}</div>
          </div>
        ` : ''}
        ${topTrack ? `
          <div class="wrapped-tile">
            <div class="wrapped-tile-label">Track del año</div>
            <div class="wrapped-tile-value" style="font-size:18px">${escapeHtml(topTrack.name)}</div>
            <div class="wrapped-tile-hint">${escapeHtml(topTrack.artist)} · ${topTrack.plays.toLocaleString('es-AR')} plays · ${fmtMinutes(topTrack.min)}</div>
          </div>
        ` : ''}
        ${y.discovery ? `
          <div class="wrapped-tile">
            <div class="wrapped-tile-label">Descubrimiento del año</div>
            <div class="wrapped-tile-value">${escapeHtml(y.discovery.artist)}</div>
            <div class="wrapped-tile-hint">Primera vez en ${y.year} · ${fmtMinutes(y.discovery.min)}</div>
          </div>
        ` : ''}
        <div class="wrapped-tile">
          <div class="wrapped-tile-label">Mes pico</div>
          <div class="wrapped-tile-value">${monthName} ${y.year}</div>
          <div class="wrapped-tile-hint">${y.peak_month ? fmtMinutes(y.peak_month.min) : '—'}</div>
        </div>
        ${y.peak_day ? `
          <div class="wrapped-tile">
            <div class="wrapped-tile-label">Día más largo</div>
            <div class="wrapped-tile-value">${fmtDate(y.peak_day.date)}</div>
            <div class="wrapped-tile-hint">${fmtMinutes(y.peak_day.min)}</div>
          </div>
        ` : ''}
        <div class="wrapped-tile">
          <div class="wrapped-tile-label">Días activos</div>
          <div class="wrapped-tile-value">${y.days_active}</div>
          <div class="wrapped-tile-hint">de ${daysInYear(y.year)} · racha más larga ${y.longest_streak} días</div>
        </div>
        <div class="wrapped-tile">
          <div class="wrapped-tile-label">Skips</div>
          <div class="wrapped-tile-value">${y.skip_pct}%</div>
          <div class="wrapped-tile-hint">de las plays terminaron por skip o <30s</div>
        </div>
        <div class="wrapped-tile">
          <div class="wrapped-tile-label">Primera play</div>
          <div class="wrapped-tile-value" style="font-size:16px">${fmtDate(y.first_play)}</div>
          <div class="wrapped-tile-hint">Última: ${fmtDate(y.last_play)}</div>
        </div>
      </div>

      <div class="wrapped-lists">
        ${renderTopList('Top artistas', y.top_artists?.slice(0, 15) || [], 'name', 'min', 'plays')}
        ${renderTopList('Top álbumes', y.top_albums?.slice(0, 15) || [], 'name', 'min', 'plays', 'artist')}
        ${renderTopList('Top tracks', y.top_tracks?.slice(0, 15) || [], 'name', 'min', 'plays', 'artist')}
      </div>
    </div>
  `;
}

function daysInYear(y) {
  return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
}

function renderTopList(title, items, keyName, keyMin, keyPlays, keyArtist) {
  if (!items.length) return '';
  return `
    <div>
      <h3 style="margin:0 0 10px 0;font-size:15px">${title}</h3>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${items.map((it, i) => `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:var(--radius-sm);background:var(--color-elevated)">
            <span style="width:22px;text-align:right;color:var(--color-text-muted);font-weight:700;font-size:12px;flex-shrink:0">${i + 1}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(it[keyName])}</div>
              ${keyArtist && it[keyArtist] ? `<div style="font-size:11px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(it[keyArtist])}</div>` : ''}
            </div>
            <span style="font-size:11px;color:var(--color-text-muted);flex-shrink:0">${fmtMinutes(it[keyMin])}${it[keyPlays] ? ` · ${it[keyPlays]}` : ''}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderAllTime() {
  const holder = document.getElementById('wrapped-alltime');
  const t = stats.totals || {};
  holder.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 4px 0">De siempre</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">
        Todo tu historial junto — desde ${fmtDate(stats.years[0].first_play)} hasta ${fmtDate(stats.years[stats.years.length-1].last_play)}.
      </p>
      <div class="wrapped-grid" style="margin-bottom:20px">
        <div class="wrapped-tile">
          <div class="wrapped-tile-label">Total escuchado</div>
          <div class="wrapped-tile-value">${fmtMinutes(t.min)}</div>
          <div class="wrapped-tile-hint">${fmtDays(t.min || 0)}</div>
        </div>
        <div class="wrapped-tile">
          <div class="wrapped-tile-label">Plays válidas</div>
          <div class="wrapped-tile-value">${(t.plays_valid || 0).toLocaleString('es-AR')}</div>
          <div class="wrapped-tile-hint">de ${(t.plays_raw || 0).toLocaleString('es-AR')} crudas · ${t.skip_pct}% skips</div>
        </div>
        <div class="wrapped-tile">
          <div class="wrapped-tile-label">Días activos</div>
          <div class="wrapped-tile-value">${(t.days_active || 0).toLocaleString('es-AR')}</div>
          <div class="wrapped-tile-hint">racha más larga: ${t.longest_streak || 0} días</div>
        </div>
        <div class="wrapped-tile">
          <div class="wrapped-tile-label">Artistas · álbumes · tracks</div>
          <div class="wrapped-tile-value" style="font-size:20px">${(t.unique_artists || 0).toLocaleString('es-AR')} · ${(t.unique_albums || 0).toLocaleString('es-AR')} · ${(t.unique_tracks || 0).toLocaleString('es-AR')}</div>
          <div class="wrapped-tile-hint">únicos con al menos una play ≥30s</div>
        </div>
      </div>
      <div class="wrapped-lists">
        ${renderTopList('Top artistas de siempre', (stats.top_artists_all_time || []).slice(0, 20), 'name', 'min', 'plays')}
        ${renderTopList('Top álbumes de siempre', (stats.top_albums_all_time || []).slice(0, 20), 'name', 'min', 'plays', 'artist')}
        ${renderTopList('Top tracks de siempre', (stats.top_tracks_all_time || []).slice(0, 20), 'name', 'min', 'plays', 'artist')}
      </div>
    </div>
  `;
}
