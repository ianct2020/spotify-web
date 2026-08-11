// Wrapped propio: mini-resumen tuyo por año, hecho con el Extended Streaming History.
// A diferencia del Wrapped oficial (que corre oct-sept), este es del año calendario completo.

import { loadHistoryStats, isOwner, ownerLockedMessage } from './history-data.js?v=132';
import { escapeHtml, pageHeader } from '../ui/components.js?v=132';
import { getPreview, getArtistTopPreview } from '../api/preview-providers.js?v=132';
import { attachHover } from '../ui/preview-player.js?v=132';
import { openTrackCard } from './track-card.js?v=132';
import { openArtistCard } from './artist-card.js?v=132';
import { openAlbumCard } from './album-card.js?v=132';
import { getMyTop } from '../api.js?v=132';
import { activateMarquee, marqueeSpan } from '../ui/marquee.js?v=132';
import { openModal } from '../ui/modal-stack.js?v=132';

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

// Modal chico con el rango de datos del historial (antes era un panel inline
// que empujaba el layout — ahora abre y cierra sin mover nada).
function openWrappedInfoModal(dataFrom, dataTo, dataPlays) {
  openModal({
    id: 'wrapped-info',
    html: `
      <div class="modal" style="max-width:440px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
          <h3 style="margin:0;font-size:16px">Rango de datos</h3>
          <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar">✕</button>
        </div>
        <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.55;margin:0">
          Datos desde <strong style="color:var(--color-text)">${escapeHtml(dataFrom)}</strong>
          hasta el <strong style="color:var(--color-text)">${escapeHtml(dataTo)}</strong>
          · ${dataPlays} plays válidas (≥30s).
        </p>
        <p style="color:var(--color-text-muted);font-size:12.5px;line-height:1.5;margin:10px 0 0">
          El Extended Streaming History se pide a Spotify una vez cada tanto — lo que
          escuchaste después de esa fecha no aparece hasta que lo vuelvas a pedir.
        </p>
      </div>
    `,
  });
}

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Wrapped tuyo, por año' })}
    <div id="wrapped-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando historial…</div></div></div>
  `;

  stats = await loadHistoryStats();
  const content = document.getElementById('wrapped-content');
  if (!stats || !stats.years || !stats.years.length) {
    if (await isOwner()) {
      content.innerHTML = `<div class="card"><p>No pude cargar el historial de reproducción. Volvé a probar.</p></div>`;
    } else {
      await renderLite(content);
    }
    return;
  }

  // orden inverso (más nuevo arriba) y default = último año con datos
  const yearsDesc = [...stats.years].sort((a, b) => b.year - a.year);
  if (!selectedYear || !yearsDesc.find(y => y.year === selectedYear)) {
    selectedYear = yearsDesc[0].year;
  }

  const dataFrom = fmtDate(stats.totals?.first_play || stats.years[0].first_play);
  const dataTo = fmtDate(stats.totals?.last_play || yearsDesc[0].last_play);
  const dataPlays = stats.totals.plays_valid.toLocaleString('es-AR');

  content.innerHTML = `
    <div class="wrapped-year-bar">
      <div class="wrapped-year-bar-label">Elegí el año</div>
      <div class="wrapped-year-bar-tabs" id="wrapped-year-tabs">
        ${yearsDesc.map(y => `
          <button class="wrapped-year-tab${y.year === selectedYear ? ' active' : ''}" data-year="${y.year}">${y.year}</button>
        `).join('')}
      </div>
      <button class="wrapped-info-btn" id="wrapped-info-btn" aria-label="Ver rango de datos">ⓘ</button>
    </div>
    <div id="wrapped-year-card"></div>
    <div id="wrapped-alltime" style="margin-top:20px"></div>
  `;

  const infoBtn = document.getElementById('wrapped-info-btn');
  if (infoBtn) {
    infoBtn.onclick = () => openWrappedInfoModal(dataFrom, dataTo, dataPlays);
  }

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
      </div>

      <div class="wrapped-year-layout">
        ${topArtist ? `
          <div class="wrapped-tile compact" data-hover="y-tile-art:0" style="grid-area:art">
            <div class="wrapped-tile-label">Artista del año</div>
            <div class="wrapped-tile-value">${escapeHtml(topArtist.name)}</div>
            <div class="wrapped-tile-hint">${fmtMinutes(topArtist.min)} · ${topArtist.plays.toLocaleString('es-AR')} plays</div>
          </div>
        ` : `<div style="grid-area:art"></div>`}
        ${topTrack ? `
          <div class="wrapped-tile compact" data-hover="y-tile-trk:0" style="grid-area:trk">
            <div class="wrapped-tile-label">Track del año</div>
            <div class="wrapped-tile-value" style="font-size:16px">${escapeHtml(topTrack.name)}</div>
            <div class="wrapped-tile-hint">${escapeHtml(topTrack.artist)} · ${fmtMinutes(topTrack.min)}</div>
          </div>
        ` : `<div style="grid-area:trk"></div>`}

        ${topAlbum ? `
          <div class="wrapped-album-hero tc-clickable" data-album-hero title="Click para ver la ficha del álbum" style="grid-area:alb">
            <div class="wrapped-tile-label">Álbum del año</div>
            ${topAlbum.img
              ? `<img src="${topAlbum.img}" alt="" class="wrapped-album-hero-cover" loading="lazy" onerror="this.outerHTML='&lt;div class=&quot;wrapped-album-hero-cover&quot; style=&quot;background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:44px&quot;&gt;♪&lt;/div&gt;'">`
              : `<div class="wrapped-album-hero-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:44px">♪</div>`}
            <div class="wrapped-album-hero-name">${escapeHtml(topAlbum.name)}</div>
            <div class="wrapped-album-hero-artist">${escapeHtml(topAlbum.artist)}</div>
            <div class="wrapped-album-hero-meta">${fmtMinutes(topAlbum.min)} · ${topAlbum.plays.toLocaleString('es-AR')} plays</div>
          </div>
        ` : `<div style="grid-area:alb"></div>`}

        ${y.peak_day ? `
          <div class="wrapped-tile compact" style="grid-area:day">
            <div class="wrapped-tile-label">Día más largo</div>
            <div class="wrapped-tile-value" style="font-size:15px">${fmtDate(y.peak_day.date)}</div>
            <div class="wrapped-tile-hint">${fmtMinutes(y.peak_day.min)}</div>
          </div>
        ` : `<div style="grid-area:day"></div>`}
        <div class="wrapped-tile compact" style="grid-area:days">
          <div class="wrapped-tile-label">Días activos</div>
          <div class="wrapped-tile-value">${y.days_active}</div>
          <div class="wrapped-tile-hint">de ${daysInYear(y.year)} · racha ${y.longest_streak} d</div>
        </div>

        ${y.discovery ? `
          <div class="wrapped-tile compact" data-hover="y-tile-disc:0" style="grid-area:disc">
            <div class="wrapped-tile-label">Descubrimiento</div>
            <div class="wrapped-tile-value">${escapeHtml(y.discovery.artist)}</div>
            <div class="wrapped-tile-hint">Primera vez en ${y.year} · ${fmtMinutes(y.discovery.min)}</div>
          </div>
        ` : `<div style="grid-area:disc"></div>`}
        <div class="wrapped-tile compact" style="grid-area:mes">
          <div class="wrapped-tile-label">Mes pico</div>
          <div class="wrapped-tile-value">${monthName} ${y.year}</div>
          <div class="wrapped-tile-hint">${y.peak_month ? fmtMinutes(y.peak_month.min) : '—'}</div>
        </div>
        <div class="wrapped-tile compact" style="grid-area:skp">
          <div class="wrapped-tile-label">Skips</div>
          <div class="wrapped-tile-value">${y.skip_pct}%</div>
          <div class="wrapped-tile-hint">por skip o &lt;30s</div>
        </div>
        <div class="wrapped-tile compact" style="grid-area:fst">
          <div class="wrapped-tile-label">Primera play</div>
          <div class="wrapped-tile-value" style="font-size:14px">${fmtDate(y.first_play)}</div>
          <div class="wrapped-tile-hint">Última registrada: ${fmtDate(y.last_play)}${isLatest ? `
            <button type="button" class="wrapped-hint-info" id="wrapped-lastplay-info"
              title="Por qué esta fecha" aria-label="Por qué esta fecha">ⓘ</button>` : ''}</div>
        </div>
      </div>

    </div>

    <div class="wrapped-top-cards">
      ${renderTopCard('Top artistas', y.top_artists?.slice(0, 15) || [], 'name', 'min', 'plays', null, 'y-art')}
      ${renderTopCard('Top álbumes', y.top_albums?.slice(0, 15) || [], 'name', 'min', 'plays', 'artist', null, 'y-alb')}
      ${renderTopCard('Top tracks', y.top_tracks?.slice(0, 15) || [], 'name', 'min', 'plays', 'artist', 'y-trk')}
    </div>
  `;

  wireTopHover(holder, 'y-art', y.top_artists?.slice(0, 15) || [], 'artist');
  wireTopHover(holder, 'y-trk', y.top_tracks?.slice(0, 15) || [], 'track');
  wireTopHover(holder, 'y-tile-art', topArtist ? [topArtist] : [], 'artist');
  wireTopHover(holder, 'y-tile-trk', topTrack ? [topTrack] : [], 'track');
  wireTopHover(holder, 'y-tile-disc', y.discovery ? [{ name: y.discovery.artist }] : [], 'artist');
  wireTopClick(holder, 'y-alb', y.top_albums?.slice(0, 15) || [], 'album');
  wireAlbumHero(holder, topAlbum);

  // "Última: 22 jul 2026" no era un bug: es donde termina el ZIP del Extended
  // Streaming History. Verificado contra el export crudo — la play más reciente
  // de los 26 archivos es 2026-07-22T21:26:10Z. El dato estaba bien y el texto
  // engañaba, así que ahora dice "Última registrada" y el ⓘ lo explica.
  const lastPlayInfo = holder.querySelector('#wrapped-lastplay-info');
  if (lastPlayInfo) {
    lastPlayInfo.onclick = () => openLastPlayModal(fmtDate(y.last_play));
  }

  activateMarquee(holder);
}

function openLastPlayModal(lastDate) {
  openModal({
    id: 'wrapped-last-play',
    html: `
      <div class="modal" style="max-width:440px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px">
          <h3 style="margin:0;font-size:16px">Última play registrada</h3>
          <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar">✕</button>
        </div>
        <p style="color:var(--color-text-secondary);font-size:14px;line-height:1.55;margin:0">
          El <strong style="color:var(--color-text)">${escapeHtml(lastDate)}</strong> no es
          la última vez que escuchaste música: es la última play que aparece en tu
          Extended Streaming History.
        </p>
        <p style="color:var(--color-text-muted);font-size:12.5px;line-height:1.5;margin:10px 0 0">
          El historial es una descarga puntual, no una conexión en vivo. Todo lo que
          escuchaste después de esa fecha existe en Spotify, pero no en este archivo.
          Para ponerlo al día hay que volver a pedir el export en la página de
          privacidad de Spotify y subir el ZIP nuevo.
        </p>
      </div>
    `,
  });
}

// Click en fila (sin hover-play) → abre la ficha correspondiente.
function wireTopClick(holder, cardKey, items, kind) {
  holder.querySelectorAll(`[data-click="${cardKey}"]`).forEach(el => {
    const i = +el.dataset.i;
    const it = items[i];
    if (!it) return;
    el.classList.add('tc-clickable');
    if (kind === 'album') {
      el.title = 'Click para ver la ficha del álbum';
      el.onclick = () => openAlbumCard({ name: it.name, artist: it.artist, plays: it.plays, min: it.min, img: it.img });
    }
  });
}

function wireAlbumHero(holder, topAlbum) {
  const el = holder.querySelector('[data-album-hero]');
  if (!el || !topAlbum) return;
  el.onclick = () => openAlbumCard({
    name: topAlbum.name,
    artist: topAlbum.artist,
    plays: topAlbum.plays,
    min: topAlbum.min,
    img: topAlbum.img,
  });
}

// Hover-play: pasás el mouse por una fila/tile y suena un preview de 30s
// (iTunes: el top del artista, o el track puntual). Se corta al sacar el mouse.
function wireTopHover(holder, cardKey, items, kind) {
  holder.querySelectorAll(`[data-hover^="${cardKey}:"]`).forEach(el => {
    const i = +el.dataset.hover.split(':')[1];
    const it = items[i];
    if (!it) return;
    el.title = 'Mantené el mouse para escuchar un preview';
    // Los tracks del historial traen uri → click abre la ficha de canción.
    // Los artistas → ficha de artista.
    if (kind === 'track' && it.uri) {
      el.classList.add('tc-clickable');
      el.title = 'Preview al apoyar el mouse · click para ver la ficha';
      el.onclick = () => openTrackCard({
        id: it.uri.split(':').pop(),
        name: it.name,
        artist: it.artist || '',
      });
    } else if (kind === 'artist' && it.name) {
      el.classList.add('tc-clickable');
      el.title = 'Preview al apoyar el mouse · click para ver la ficha del artista';
      el.onclick = () => openArtistCard({ name: it.name });
    }
    const trackId = it.uri ? it.uri.split(':').pop() : undefined;
    const getter = kind === 'artist'
      ? async () => await getArtistTopPreview(it.name)
      : async () => await getPreview({ name: it.name, artist: it.artist || '', spotifyId: trackId });
    attachHover(el, `wr:${cardKey}:${i}`, getter);
  });
}

function renderTopCard(title, items, keyName, keyMin, keyPlays, keyArtist, hoverKey, clickKey) {
  if (!items.length) return '';
  return `
    <div class="card wrapped-top-card">
      <h3 style="margin:0 0 12px 0;font-size:16px">${title}</h3>
      <div class="wrapped-top-scroll">
        ${items.map((it, i) => {
          const attrs = [];
          if (hoverKey) attrs.push(`data-hover="${hoverKey}:${i}"`);
          if (clickKey) attrs.push(`data-click="${clickKey}"`, `data-i="${i}"`);
          return `
          <div class="wrapped-top-row"${attrs.length ? ' ' + attrs.join(' ') : ''}>
            <span class="wrapped-top-rank">${i + 1}</span>
            <div class="wrapped-top-info">
              <div class="wrapped-top-name">${marqueeSpan(escapeHtml(it[keyName]))}</div>
              ${keyArtist && it[keyArtist] ? `<div class="wrapped-top-artist">${marqueeSpan(escapeHtml(it[keyArtist]))}</div>` : ''}
            </div>
            <span class="wrapped-top-meta">${fmtMinutes(it[keyMin])}${it[keyPlays] ? ` · ${it[keyPlays]}` : ''}</span>
          </div>
        `;}).join('')}
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
        ${topArtist ? `
          <div class="wrapped-tile compact" data-hover="at-tile-art:0" style="grid-area:art">
            <div class="wrapped-tile-label">Artista de siempre</div>
            <div class="wrapped-tile-value">${escapeHtml(topArtist.name)}</div>
            <div class="wrapped-tile-hint">${fmtMinutes(topArtist.min)} · ${(topArtist.plays || 0).toLocaleString('es-AR')} plays</div>
          </div>
        ` : `<div style="grid-area:art"></div>`}
        ${topTrack ? `
          <div class="wrapped-tile compact" data-hover="at-tile-trk:0" style="grid-area:trk">
            <div class="wrapped-tile-label">Track de siempre</div>
            <div class="wrapped-tile-value" style="font-size:16px">${escapeHtml(topTrack.name)}</div>
            <div class="wrapped-tile-hint">${escapeHtml(topTrack.artist)} · ${fmtMinutes(topTrack.min)}</div>
          </div>
        ` : `<div style="grid-area:trk"></div>`}

        ${topAlbum ? `
          <div class="wrapped-album-hero tc-clickable" data-album-hero title="Click para ver la ficha del álbum" style="grid-area:alb">
            <div class="wrapped-tile-label">Álbum de siempre</div>
            ${topAlbum.img
              ? `<img src="${topAlbum.img}" alt="" class="wrapped-album-hero-cover" loading="lazy" onerror="this.outerHTML='&lt;div class=&quot;wrapped-album-hero-cover&quot; style=&quot;background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:44px&quot;&gt;♪&lt;/div&gt;'">`
              : `<div class="wrapped-album-hero-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:44px">♪</div>`}
            <div class="wrapped-album-hero-name">${escapeHtml(topAlbum.name)}</div>
            <div class="wrapped-album-hero-artist">${escapeHtml(topAlbum.artist)}</div>
            <div class="wrapped-album-hero-meta">${fmtMinutes(topAlbum.min)} · ${(topAlbum.plays || 0).toLocaleString('es-AR')} plays</div>
          </div>
        ` : `<div style="grid-area:alb"></div>`}

        <div class="wrapped-tile compact" style="grid-area:day">
          <div class="wrapped-tile-label">Artistas únicos</div>
          <div class="wrapped-tile-value">${(t.unique_artists || 0).toLocaleString('es-AR')}</div>
          <div class="wrapped-tile-hint">con al menos una play ≥30s</div>
        </div>
        <div class="wrapped-tile compact" style="grid-area:days">
          <div class="wrapped-tile-label">Álbumes únicos</div>
          <div class="wrapped-tile-value">${(t.unique_albums || 0).toLocaleString('es-AR')}</div>
          <div class="wrapped-tile-hint">con al menos una play ≥30s</div>
        </div>

        <div class="wrapped-tile compact" style="grid-area:disc">
          <div class="wrapped-tile-label">Plays válidas</div>
          <div class="wrapped-tile-value">${(t.plays_valid || 0).toLocaleString('es-AR')}</div>
          <div class="wrapped-tile-hint">de ${(t.plays_raw || 0).toLocaleString('es-AR')} crudas · ${t.skip_pct}% skips</div>
        </div>
        <div class="wrapped-tile compact" style="grid-area:mes">
          <div class="wrapped-tile-label">Días activos</div>
          <div class="wrapped-tile-value">${daysActive.toLocaleString('es-AR')}</div>
          <div class="wrapped-tile-hint">${totalPossibleDays ? `de ${totalPossibleDays.toLocaleString('es-AR')} totales · ` : ''}racha ${t.longest_streak || 0} d</div>
        </div>
        <div class="wrapped-tile compact" style="grid-area:skp">
          <div class="wrapped-tile-label">Tracks únicos</div>
          <div class="wrapped-tile-value">${(t.unique_tracks || 0).toLocaleString('es-AR')}</div>
          <div class="wrapped-tile-hint">con al menos una play ≥30s</div>
        </div>
        <div class="wrapped-tile compact" style="grid-area:fst">
          <div class="wrapped-tile-label">Años con datos</div>
          <div class="wrapped-tile-value">${stats.years.length}</div>
          <div class="wrapped-tile-hint">${stats.years[stats.years.length-1].year} → ${stats.years[0].year}</div>
        </div>
      </div>
    </div>

    <div class="wrapped-top-cards" style="margin-top:20px">
      ${renderTopCard('Top artistas de siempre', (stats.top_artists_all_time || []).slice(0, 20), 'name', 'min', 'plays', null, 'at-art')}
      ${renderTopCard('Top álbumes de siempre', (stats.top_albums_all_time || []).slice(0, 20), 'name', 'min', 'plays', 'artist', null, 'at-alb')}
      ${renderTopCard('Top tracks de siempre', (stats.top_tracks_all_time || []).slice(0, 20), 'name', 'min', 'plays', 'artist', 'at-trk')}
    </div>
  `;

  wireTopHover(holder, 'at-art', (stats.top_artists_all_time || []).slice(0, 20), 'artist');
  wireTopHover(holder, 'at-trk', (stats.top_tracks_all_time || []).slice(0, 20), 'track');
  wireTopHover(holder, 'at-tile-art', topArtist ? [topArtist] : [], 'artist');
  wireTopHover(holder, 'at-tile-trk', topTrack ? [topTrack] : [], 'track');
  wireTopClick(holder, 'at-alb', (stats.top_albums_all_time || []).slice(0, 20), 'album');
  wireAlbumHero(holder, topAlbum);
  activateMarquee(holder);
}

// ============ Wrapped lite: para users sin Extended Streaming History ============
// Usa /me/top de la API (scope user-top-read): top 50 artistas y tracks en 3
// ventanas. Sin minutos ni histórico por año, pero es TU wrapped igual.

const LITE_RANGES = [
  ['short_term', 'Último mes'],
  ['medium_term', 'Últimos 6 meses'],
  ['long_term', 'Último año y pico'],
];
let liteRange = 'medium_term';

async function renderLite(content) {
  content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando tus tops desde Spotify…</div></div>`;

  let artists, tracks;
  try {
    [artists, tracks] = await Promise.all([
      getMyTop('artists', liteRange),
      getMyTop('tracks', liteRange),
    ]);
  } catch (e) {
    // /me/top caído o sin permiso: mostramos la explicación estándar
    console.warn('Wrapped lite: /me/top falló:', e.message);
    content.innerHTML = ownerLockedMessage('El Wrapped completo');
    return;
  }

  if (!artists.length && !tracks.length) {
    content.innerHTML = `<div class="card"><p>Spotify todavía no tiene tops tuyos para este período — escuchá un poco más y volvé.</p></div>` + ownerLockedMessage('El Wrapped completo');
    return;
  }

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="font-size:12px;color:var(--color-text-muted);letter-spacing:0.06em;text-transform:uppercase;margin-bottom:10px">Tu top según Spotify</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap" id="wl-range-tabs">
        ${LITE_RANGES.map(([v, label]) => `
          <button class="wrapped-year-tab" data-range="${v}"
                  style="padding:8px 14px;border-radius:var(--radius-sm);border:1px solid var(--color-border);
                         background:${v === liteRange ? 'var(--color-accent)' : 'var(--color-elevated)'};
                         color:${v === liteRange ? '#fff' : 'var(--color-text)'};
                         font-weight:${v === liteRange ? '600' : '500'};font-size:14px;cursor:pointer">${label}</button>
        `).join('')}
      </div>
    </div>

    <div class="wrapped-top-cards" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      <div class="card wrapped-top-card">
        <h3 style="margin:0 0 12px;font-size:16px">Top artistas</h3>
        <div class="wrapped-top-scroll">
          ${artists.map((a, i) => {
            const img = a.images?.[2]?.url || a.images?.[1]?.url || a.images?.[0]?.url;
            return `
            <div class="wrapped-top-row" data-hover="wl-a:${i}">
              <span class="wrapped-top-rank">${i + 1}</span>
              ${img ? `<img src="${img}" alt="" loading="lazy" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0">` : ''}
              <div class="wrapped-top-info">
                <div class="wrapped-top-name">${escapeHtml(a.name)}</div>
                ${a.genres?.length ? `<div class="wrapped-top-artist">${escapeHtml(a.genres.slice(0, 2).join(', '))}</div>` : ''}
              </div>
            </div>
          `;}).join('')}
        </div>
      </div>
      <div class="card wrapped-top-card">
        <h3 style="margin:0 0 12px;font-size:16px">Top tracks</h3>
        <div class="wrapped-top-scroll">
          ${tracks.map((t, i) => {
            const imgs = t.album?.images || [];
            const img = imgs[2]?.url || imgs[1]?.url || imgs[0]?.url;
            return `
            <div class="wrapped-top-row" data-hover="wl-t:${i}">
              <span class="wrapped-top-rank">${i + 1}</span>
              ${img ? `<img src="${img}" alt="" loading="lazy" style="width:36px;height:36px;border-radius:4px;object-fit:cover;flex-shrink:0">` : ''}
              <div class="wrapped-top-info">
                <div class="wrapped-top-name">${escapeHtml(t.name)}</div>
                <div class="wrapped-top-artist">${escapeHtml((t.artists || []).map(a => a.name).join(', '))}</div>
              </div>
            </div>
          `;}).join('')}
        </div>
      </div>
    </div>

    <div style="margin-top:20px">${ownerLockedMessage('La versión completa (minutos, histórico por año, récords)')}</div>
  `;

  content.querySelectorAll('#wl-range-tabs .wrapped-year-tab').forEach(btn => {
    btn.onclick = () => { liteRange = btn.dataset.range; renderLite(content); };
  });

  wireTopHover(content, 'wl-a', artists.map(a => ({ name: a.name })), 'artist');
  wireTopHover(content, 'wl-t', tracks.map(t => ({ name: t.name, artist: t.artists?.[0]?.name || '' })), 'track');
}
