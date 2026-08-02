// Récords: los extremos de tu Extended Streaming History — días épicos,
// maratones de un artista, temas en loop, rachas e hitos. Todo sale de
// history-records.json (gen-stats.py) ya calculado, acá es solo UI.

import { loadRecords, isOwner, ownerLockedMessage } from './history-data.js?v=112';
import { escapeHtml, pageHeader } from '../ui/components.js?v=112';
import { getPreview, getArtistTopPreview } from '../api/preview-providers.js?v=112';
import { attachHover } from '../ui/preview-player.js?v=112';
import { openArtistCard } from './artist-card.js?v=112';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  return `${DIAS[(d.getDay() + 6) % 7]} ${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtDayShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${+d} ${MESES[+m - 1]} ${y}`;
}

function fmtHours(min) {
  if (min >= 60) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  return `${Math.round(min)}m`;
}

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Récords' })}
    <div id="records-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  const r = await loadRecords();
  const content = document.getElementById('records-content');
  if (!r || !r.top_days?.length) {
    content.innerHTML = (await isOwner())
      ? `<div class="card"><p>No pude cargar los récords. Reintentá.</p></div>`
      : ownerLockedMessage('Récords');
    return;
  }

  const peak = r.top_days[0];

  content.innerHTML = `
    <div class="card wrapped-card" style="margin-bottom:20px">
      <div class="wrapped-hero">
        <div class="wrapped-hero-year">TU DÍA MÁS MUSICAL</div>
        <div class="wrapped-hero-min">${fmtHours(peak.min)}</div>
        <div class="wrapped-hero-sub">${fmtDay(peak.date)} · ${peak.plays} plays · dominó ${escapeHtml(peak.top_artist?.name || '')} (${fmtHours(peak.top_artist?.min || 0)})</div>
      </div>
    </div>

    <div class="records-grid">
      ${card('Días épicos', 'Los 10 días con más música', r.top_days.slice(0, 10).map((d, i) => row(i,
        `${fmtDayShort(d.date)}`,
        `${escapeHtml(d.top_artist?.name || '')}${d.top_track ? ` · ${escapeHtml(d.top_track.name)}` : ''}`,
        `${fmtHours(d.min)} · ${d.plays} plays`,
        { kind: 'artist', name: d.top_artist?.name }
      )))}

      ${card('Maratones de un artista', 'Más minutos de un solo artista en un día', r.top_artist_days.slice(0, 10).map((d, i) => row(i,
        escapeHtml(d.artist),
        fmtDayShort(d.date),
        fmtHours(d.min),
        { kind: 'artist', name: d.artist }
      )))}

      ${card('En loop', 'El mismo tema más veces en un solo día', r.top_track_days.slice(0, 10).map((d, i) => row(i,
        escapeHtml(d.name),
        `${escapeHtml(d.artist)} · ${fmtDayShort(d.date)}`,
        `${d.plays} veces`,
        { kind: 'track', name: d.name, artist: d.artist }
      )))}

      ${card('Semanas obsesivas', 'El mismo tema más veces en una semana', r.top_track_weeks.slice(0, 10).map((d, i) => row(i,
        escapeHtml(d.name),
        `${escapeHtml(d.artist)} · semana del ${fmtDayShort(d.week_start)}`,
        `${d.plays} veces`,
        { kind: 'track', name: d.name, artist: d.artist }
      )))}

      ${card('Rachas', 'Días seguidos escuchando música, sin fallar uno', r.top_streaks.slice(0, 10).map((d, i) => row(i,
        `${d.days} días seguidos`,
        `${fmtDayShort(d.start)} → ${fmtDayShort(d.end)}`,
        ''
      )))}

      ${card('Los de todos los días', 'Temas que sonaron en más días distintos', r.track_most_days.slice(0, 10).map((d, i) => row(i,
        escapeHtml(d.name),
        escapeHtml(d.artist),
        `${d.days} días`,
        { kind: 'track', name: d.name, artist: d.artist }
      )))}
    </div>

    <div class="card" style="margin-top:20px">
      <h3 style="margin:0 0 4px;font-size:16px">Hitos</h3>
      <p style="color:var(--color-text-muted);font-size:12px;margin:0 0 14px">Tu play válida número…</p>
      <div class="records-milestones">
        ${r.milestones.map(m => `
          <div class="records-milestone">
            <div class="records-milestone-n">#${m.n.toLocaleString('es-AR')}</div>
            <div class="records-milestone-info">
              <div class="records-milestone-track">${escapeHtml(m.name)}</div>
              <div class="records-milestone-meta">${escapeHtml(m.artist)} · ${fmtDayShort(m.date)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  wireHovers(content);
}

let hoverTargets = [];

function card(title, subtitle, rowsHtml) {
  return `
    <div class="card wrapped-top-card">
      <h3 style="margin:0 0 2px;font-size:16px">${title}</h3>
      <p style="color:var(--color-text-muted);font-size:12px;margin:0 0 12px">${subtitle}</p>
      <div>${rowsHtml.join('')}</div>
    </div>
  `;
}

// row() acumula los targets de hover en hoverTargets; wireHovers los conecta
// después de insertar el HTML (los nombres nunca van en atributos por las comillas).
function row(i, main, sub, meta, hover) {
  let attr = '';
  if (hover && hover.name) {
    attr = ` data-rec-hover="${hoverTargets.length}"`;
    hoverTargets.push(hover);
  }
  return `
    <div class="wrapped-top-row"${attr}>
      <span class="wrapped-top-rank">${i + 1}</span>
      <div class="wrapped-top-info">
        <div class="wrapped-top-name">${main}</div>
        ${sub ? `<div class="wrapped-top-artist">${sub}</div>` : ''}
      </div>
      ${meta ? `<span class="wrapped-top-meta">${meta}</span>` : ''}
    </div>
  `;
}

function wireHovers(content) {
  content.querySelectorAll('[data-rec-hover]').forEach(el => {
    const h = hoverTargets[+el.dataset.recHover];
    if (!h) return;
    el.classList.add('tc-clickable');
    el.title = 'Mantené el mouse para escuchar un preview · click para ficha';
    const getter = h.kind === 'artist'
      ? async () => await getArtistTopPreview(h.name)
      : async () => await getPreview({ name: h.name, artist: h.artist || '', spotifyId: h.id });
    attachHover(el, `rec:${el.dataset.recHover}`, getter);
    // Click → ficha (artista o canción). Los tracks acá no traen uri —
    // la ficha va a mostrar meta+preview, sin la curva mensual.
    el.onclick = () => {
      if (h.kind === 'artist') openArtistCard({ name: h.name });
      else if (h.kind === 'track') openArtistCard({ name: h.artist });  // sin uri, mejor abrir el artista
    };
  });
  hoverTargets = [];
}
