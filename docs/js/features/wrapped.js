// Wrapped propio: mini-resumen tuyo por año, hecho con el Extended Streaming History.
// A diferencia del Wrapped oficial (que corre oct-sept), este es del año calendario completo.

import { loadHistoryStats, isOwner, ownerLockedMessage } from './history-data.js?v=90';
import { escapeHtml } from '../ui/components.js?v=90';
import { findTrackPreview, findArtistTopPreview } from '../api/itunes.js?v=90';
import { attachHover } from '../ui/preview-player.js?v=90';
import { openTrackCard } from './track-card.js?v=90';

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
    content.innerHTML = (await isOwner())
      ? `<div class="card"><p>No pude cargar el historial de reproducción. Volvé a probar.</p></div>`
      : ownerLockedMessage('Wrapped');
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
        <div style="font-size:12px;color:var(--color-text-muted)">Datos desde ${fmtDate(stats.totals?.first_play || stats.years[0].first_play)} <strong style="color:var(--color-text)">hasta el ${fmtDate(stats.totals?.last_play || yearsDesc[0].last_play)}</strong> · ${stats.totals.plays_valid.toLocaleString('es-AR')} plays válidas (≥30s)</div>
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
  const isLatest = y.year === Math.max(...stats.years.map(yy => yy.year));

  holder.innerHTML = `
    <div class="card wrapped-card">
      <div class="wrapped-hero">
        <div class="wrapped-hero-year">${y.year}</div>
        <div class="wrapped-hero-min">${fmtMinutes(y.min)}</div>
        <div class="wrapped-hero-sub">${fmtDays(y.min)} · ${y.plays.toLocaleString('es-AR')} plays</div>
        ${isLatest ? `<div class="wrapped-hero-note">El export llega hasta el <strong>${fmtDate(y.last_play)}</strong> — lo que escuchaste después no está contado. Para actualizarlo hay que pedirle el historial a Spotify de nuevo.</div>` : ''}
      </div>

      <div class="wrapped-year-layout">
        <div class="wrapped-year-stats-left">
          ${topArtist ? `
            <div class="wrapped-tile compact" data-hover="y-tile-art:0">
              <div class="wrapped-tile-label">Artista del año</div>
              <div class="wrapped-tile-value">${escapeHtml(topArtist.name)}</div>
              <div class="wrapped-tile-hint">${fmtMinutes(topArtist.min)} · ${topArtist.plays.toLocaleString('es-AR')} plays</div>
            </div>
          ` : ''}
          ${topTrack ? `
            <div class="wrapped-tile compact" data-hover="y-tile-trk:0">
              <div class="wrapped-tile-label">Track del año</div>
              <div class="wrapped-tile-value" style="font-size:16px">${escapeHtml(topTrack.name)}</div>
              <div class="wrapped-tile-hint">${escapeHtml(topTrack.artist)} · ${fmtMinutes(topTrack.min)}</div>
            </div>
          ` : ''}
          ${y.discovery ? `
            <div class="wrapped-tile compact" data-hover="y-tile-disc:0">
              <div class="wrapped-tile-label">Descubrimiento</div>
              <div class="wrapped-tile-value">${escapeHtml(y.discovery.artist)}</div>
              <div class="wrapped-tile-hint">Primera vez en ${y.year} · ${fmtMinutes(y.discovery.min)}</div>
            </div>
          ` : ''}
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Mes pico</div>
            <div class="wrapped-tile-value">${monthName} ${y.year}</div>
            <div class="wrapped-tile-hint">${y.peak_month ? fmtMinutes(y.peak_month.min) : '—'}</div>
          </div>
        </div>

        ${topAlbum ? `
          <div class="wrapped-album-hero">
            <div class="wrapped-tile-label">Álbum del año</div>
            ${topAlbum.img ? `<img src="${topAlbum.img}" alt="" class="wrapped-album-hero-cover" loading="lazy">` : `<div class="wrapped-album-hero-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:44px">♪</div>`}
            <div class="wrapped-album-hero-name">${escapeHtml(topAlbum.name)}</div>
            <div class="wrapped-album-hero-artist">${escapeHtml(topAlbum.artist)}</div>
            <div class="wrapped-album-hero-meta">${fmtMinutes(topAlbum.min)} · ${topAlbum.plays.toLocaleString('es-AR')} plays</div>
          </div>
        ` : ''}

        <div class="wrapped-year-stats-right">
          ${y.peak_day ? `
            <div class="wrapped-tile compact">
              <div class="wrapped-tile-label">Día más largo</div>
              <div class="wrapped-tile-value" style="font-size:15px">${fmtDate(y.peak_day.date)}</div>
              <div class="wrapped-tile-hint">${fmtMinutes(y.peak_day.min)}</div>
            </div>
          ` : ''}
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Días activos</div>
            <div class="wrapped-tile-value">${y.days_active}</div>
            <div class="wrapped-tile-hint">de ${daysInYear(y.year)} · racha ${y.longest_streak} d</div>
          </div>
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Skips</div>
            <div class="wrapped-tile-value">${y.skip_pct}%</div>
            <div class="wrapped-tile-hint">por skip o &lt;30s</div>
          </div>
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Primera play</div>
            <div class="wrapped-tile-value" style="font-size:14px">${fmtDate(y.first_play)}</div>
            <div class="wrapped-tile-hint">Última: ${fmtDate(y.last_play)}</div>
          </div>
        </div>
      </div>

    </div>

    <div class="wrapped-top-cards">
      ${renderTopCard('Top artistas', y.top_artists?.slice(0, 15) || [], 'name', 'min', 'plays', null, 'y-art')}
      ${renderTopCard('Top álbumes', y.top_albums?.slice(0, 15) || [], 'name', 'min', 'plays', 'artist')}
      ${renderTopCard('Top tracks', y.top_tracks?.slice(0, 15) || [], 'name', 'min', 'plays', 'artist', 'y-trk')}
    </div>
  `;

  wireTopHover(holder, 'y-art', y.top_artists?.slice(0, 15) || [], 'artist');
  wireTopHover(holder, 'y-trk', y.top_tracks?.slice(0, 15) || [], 'track');
  wireTopHover(holder, 'y-tile-art', topArtist ? [topArtist] : [], 'artist');
  wireTopHover(holder, 'y-tile-trk', topTrack ? [topTrack] : [], 'track');
  wireTopHover(holder, 'y-tile-disc', y.discovery ? [{ name: y.discovery.artist }] : [], 'artist');
}

// Hover-play: pasás el mouse por una fila/tile y suena un preview de 30s
// (iTunes: el top del artista, o el track puntual). Se corta al sacar el mouse.
function wireTopHover(holder, cardKey, items, kind) {
  holder.querySelectorAll(`[data-hover^="${cardKey}:"]`).forEach(el => {
    const i = +el.dataset.hover.split(':')[1];
    const it = items[i];
    if (!it) return;
    el.title = 'Mantené el mouse para escuchar un preview';
    // Los tracks del historial traen uri → click abre la ficha de canción
    if (kind === 'track' && it.uri) {
      el.classList.add('tc-clickable');
      el.title = 'Preview al apoyar el mouse · click para ver la ficha';
      el.onclick = () => openTrackCard({
        id: it.uri.split(':').pop(),
        name: it.name,
        artist: it.artist || '',
      });
    }
    const getter = kind === 'artist'
      ? async () => {
          const p = await findArtistTopPreview(it.name);
          return p && { url: p.url, label: `${p.track} — ${p.artist}` };
        }
      : async () => {
          const p = await findTrackPreview(it.artist || '', it.name);
          return p && { url: p.url, label: `${it.name} — ${it.artist || ''}` };
        };
    attachHover(el, `wr:${cardKey}:${i}`, getter);
  });
}

function renderTopCard(title, items, keyName, keyMin, keyPlays, keyArtist, hoverKey) {
  if (!items.length) return '';
  return `
    <div class="card wrapped-top-card">
      <h3 style="margin:0 0 12px 0;font-size:16px">${title}</h3>
      <div class="wrapped-top-scroll">
        ${items.map((it, i) => `
          <div class="wrapped-top-row"${hoverKey ? ` data-hover="${hoverKey}:${i}"` : ''}>
            <span class="wrapped-top-rank">${i + 1}</span>
            <div class="wrapped-top-info">
              <div class="wrapped-top-name">${escapeHtml(it[keyName])}</div>
              ${keyArtist && it[keyArtist] ? `<div class="wrapped-top-artist">${escapeHtml(it[keyArtist])}</div>` : ''}
            </div>
            <span class="wrapped-top-meta">${fmtMinutes(it[keyMin])}${it[keyPlays] ? ` · ${it[keyPlays]}` : ''}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function daysInYear(y) {
  return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365;
}

function renderAllTime() {
  const holder = document.getElementById('wrapped-alltime');
  const t = stats.totals || {};

  const topArtist = (stats.top_artists_all_time || [])[0];
  const topAlbum = (stats.top_albums_all_time || [])[0];
  const topTrack = (stats.top_tracks_all_time || [])[0];
  const daysActive = t.days_active || 0;
  const totalPossibleDays = (() => {
    const first = stats.years[0]?.first_play;
    const last = stats.years[stats.years.length - 1]?.last_play;
    if (!first || !last) return null;
    const d = Math.round((new Date(last) - new Date(first)) / 86400000) + 1;
    return d > 0 ? d : null;
  })();

  holder.innerHTML = `
    <div class="card wrapped-card">
      <div class="wrapped-hero">
        <div class="wrapped-hero-year">DE SIEMPRE</div>
        <div class="wrapped-hero-min">${fmtMinutes(t.min)}</div>
        <div class="wrapped-hero-sub">${fmtDays(t.min || 0)} · desde ${fmtDate(stats.years[0].first_play)} hasta ${fmtDate(stats.years[stats.years.length-1].last_play)}</div>
      </div>

      <div class="wrapped-year-layout">
        <div class="wrapped-year-stats-left">
          ${topArtist ? `
            <div class="wrapped-tile compact" data-hover="at-tile-art:0">
              <div class="wrapped-tile-label">Artista de siempre</div>
              <div class="wrapped-tile-value">${escapeHtml(topArtist.name)}</div>
              <div class="wrapped-tile-hint">${fmtMinutes(topArtist.min)} · ${(topArtist.plays || 0).toLocaleString('es-AR')} plays</div>
            </div>
          ` : ''}
          ${topTrack ? `
            <div class="wrapped-tile compact" data-hover="at-tile-trk:0">
              <div class="wrapped-tile-label">Track de siempre</div>
              <div class="wrapped-tile-value" style="font-size:16px">${escapeHtml(topTrack.name)}</div>
              <div class="wrapped-tile-hint">${escapeHtml(topTrack.artist)} · ${fmtMinutes(topTrack.min)}</div>
            </div>
          ` : ''}
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Plays válidas</div>
            <div class="wrapped-tile-value">${(t.plays_valid || 0).toLocaleString('es-AR')}</div>
            <div class="wrapped-tile-hint">de ${(t.plays_raw || 0).toLocaleString('es-AR')} crudas · ${t.skip_pct}% skips</div>
          </div>
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Días activos</div>
            <div class="wrapped-tile-value">${daysActive.toLocaleString('es-AR')}</div>
            <div class="wrapped-tile-hint">${totalPossibleDays ? `de ${totalPossibleDays.toLocaleString('es-AR')} totales · ` : ''}racha ${t.longest_streak || 0} d</div>
          </div>
        </div>

        ${topAlbum ? `
          <div class="wrapped-album-hero">
            <div class="wrapped-tile-label">Álbum de siempre</div>
            ${topAlbum.img ? `<img src="${topAlbum.img}" alt="" class="wrapped-album-hero-cover" loading="lazy">` : `<div class="wrapped-album-hero-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:44px">♪</div>`}
            <div class="wrapped-album-hero-name">${escapeHtml(topAlbum.name)}</div>
            <div class="wrapped-album-hero-artist">${escapeHtml(topAlbum.artist)}</div>
            <div class="wrapped-album-hero-meta">${fmtMinutes(topAlbum.min)} · ${(topAlbum.plays || 0).toLocaleString('es-AR')} plays</div>
          </div>
        ` : ''}

        <div class="wrapped-year-stats-right">
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Artistas únicos</div>
            <div class="wrapped-tile-value">${(t.unique_artists || 0).toLocaleString('es-AR')}</div>
            <div class="wrapped-tile-hint">con al menos una play ≥30s</div>
          </div>
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Álbumes únicos</div>
            <div class="wrapped-tile-value">${(t.unique_albums || 0).toLocaleString('es-AR')}</div>
            <div class="wrapped-tile-hint">con al menos una play ≥30s</div>
          </div>
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Tracks únicos</div>
            <div class="wrapped-tile-value">${(t.unique_tracks || 0).toLocaleString('es-AR')}</div>
            <div class="wrapped-tile-hint">con al menos una play ≥30s</div>
          </div>
          <div class="wrapped-tile compact">
            <div class="wrapped-tile-label">Años con datos</div>
            <div class="wrapped-tile-value">${stats.years.length}</div>
            <div class="wrapped-tile-hint">${stats.years[stats.years.length-1].year} → ${stats.years[0].year}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="wrapped-top-cards" style="margin-top:20px">
      ${renderTopCard('Top artistas de siempre', (stats.top_artists_all_time || []).slice(0, 20), 'name', 'min', 'plays', null, 'at-art')}
      ${renderTopCard('Top álbumes de siempre', (stats.top_albums_all_time || []).slice(0, 20), 'name', 'min', 'plays', 'artist')}
      ${renderTopCard('Top tracks de siempre', (stats.top_tracks_all_time || []).slice(0, 20), 'name', 'min', 'plays', 'artist', 'at-trk')}
    </div>
  `;

  wireTopHover(holder, 'at-art', (stats.top_artists_all_time || []).slice(0, 20), 'artist');
  wireTopHover(holder, 'at-trk', (stats.top_tracks_all_time || []).slice(0, 20), 'track');
  wireTopHover(holder, 'at-tile-art', topArtist ? [topArtist] : [], 'artist');
  wireTopHover(holder, 'at-tile-trk', topTrack ? [topTrack] : [], 'track');
}
