// Skips crónicos: likes que reproducís seguido pero casi siempre le das next.
// Cruce local: likes vs history-skip-stats.json (ok = trackdone, skip = fwdbtn con ms>=5s).
// Preview 30s instantáneo vía iTunes (arranca en el estribillo, no suma plays
// en tu historial de Spotify). Fallback: iframe embed oficial si iTunes no lo tiene.

import { getBestAvailableLikes, removeLikedTracks } from '../api.js?v=94';
import { loadSkipStats, trackIdOf, isOwner, ownerLockedMessage } from './history-data.js?v=94';
import { escapeHtml, confirmModal } from '../ui/components.js?v=94';
import { showToast } from '../ui/toast.js?v=94';
import { findTrackPreview } from '../api/itunes.js?v=94';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=94';
import { openTrackCard } from './track-card.js?v=94';

let cache = null;
let minPlays = 5;    // solo tracks con ≥N plays totales (ok+skip)
let minRatio = 70;   // ratio de skip mínimo (%)

const RATIO_STEPS = [70, 80, 90, 100];
const PLAYS_STEPS = [3, 5, 10, 15];

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Skips crónicos</h1>
      <p>Likes que <strong>reproducís seguido pero casi siempre skipeás</strong>. Basado en tu Extended Streaming History. Un skip cuenta si le diste next después de escuchar ≥5s (así descartamos autoplay accidental).</p>
    </div>
    <div id="skips-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cruzando likes con historial…</div></div></div>
  `;
  await analyze();
}

async function analyze() {
  const content = document.getElementById('skips-content');
  let likes, stats;
  try {
    [{ items: likes }, stats] = await Promise.all([
      getBestAvailableLikes(),
      loadSkipStats(),
    ]);
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">Error: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  if (!stats || !stats.tracks) {
    content.innerHTML = (await isOwner())
      ? `<div class="card"><p>No pude cargar el historial de skips. Reintentá.</p></div>`
      : ownerLockedMessage('Skips crónicos');
    return;
  }

  const rows = [];
  for (const it of likes) {
    const t = it.track || it;
    const uri = t.uri || (t.id ? `spotify:track:${t.id}` : null);
    const id = trackIdOf(uri);
    if (!id) continue;
    const s = stats.tracks[id];
    if (!s) continue;
    const [ok, skip] = s;
    const total = ok + skip;
    if (total === 0 || skip === 0) continue;
    rows.push({ track: t, uri, id, ok, skip, total, ratio: Math.round((skip / total) * 100) });
  }
  rows.sort((a, b) => (b.ratio - a.ratio) || (b.total - a.total));
  cache = { rows, likesCount: likes.length };
  renderResults();
}

function filtered() {
  if (!cache) return [];
  return cache.rows.filter(r => r.total >= minPlays && r.ratio >= minRatio);
}

function renderResults() {
  const content = document.getElementById('skips-content');
  const rows = filtered();
  const withAnySkip = cache.rows.length;

  // Stats hero cards + filtros en chips + tabla. Todo simétrico en grid.
  content.innerHTML = `
    <div class="skips-header">
      <div class="skips-stat">
        <div class="skips-stat-value">${rows.length.toLocaleString('es-AR')}</div>
        <div class="skips-stat-label">candidatos con los filtros actuales</div>
      </div>
      <div class="skips-stat skips-stat-secondary">
        <div class="skips-stat-value">${withAnySkip.toLocaleString('es-AR')}</div>
        <div class="skips-stat-label">likes con al menos 1 skip</div>
      </div>
      <div class="skips-stat skips-stat-secondary">
        <div class="skips-stat-value">${cache.likesCount.toLocaleString('es-AR')}</div>
        <div class="skips-stat-label">likes totales</div>
      </div>
    </div>

    <div class="skips-filters">
      <div class="skips-filter-group">
        <div class="skips-filter-label">Plays mínimas</div>
        <div class="skips-chips" id="skips-plays-chips">
          ${PLAYS_STEPS.map(v => `
            <button class="skips-chip ${v === minPlays ? 'active' : ''}" data-plays="${v}">≥${v}</button>
          `).join('')}
        </div>
      </div>
      <div class="skips-filter-group">
        <div class="skips-filter-label">Ratio de skip</div>
        <div class="skips-chips" id="skips-ratio-chips">
          ${RATIO_STEPS.map(v => `
            <button class="skips-chip ${v === minRatio ? 'active' : ''}" data-ratio="${v}">${v === 100 ? '100%' : '≥' + v + '%'}</button>
          `).join('')}
        </div>
      </div>
      <div class="skips-filter-group skips-filter-actions">
        <button class="btn btn-secondary btn-sm" id="sk-select-all" ${rows.length === 0 ? 'disabled' : ''}>Seleccionar todos</button>
        <button class="btn btn-danger btn-sm" id="sk-remove" disabled>Sacar de likes (0)</button>
      </div>
    </div>

    ${rows.length === 0 ? `
      <div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">Ningún like cumple los umbrales. Bajá los filtros para ver más candidatos.</p></div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden">
        <div class="skips-list" id="skips-list">
          ${rows.map((r, i) => renderRow(r, i)).join('')}
        </div>
      </div>
    `}
  `;

  wireFilters();
  wireRows();
}

function renderRow(r, i) {
  const imgs = r.track.album?.images || [];
  const cover = imgs[2]?.url || imgs[1]?.url || imgs[0]?.url || null;
  const artists = (r.track.artists || []).map(a => a.name || a).join(', ');
  const ratioClass = r.ratio >= 90 ? 'skips-badge-danger' : 'skips-badge-warn';

  return `
    <div class="skips-row" data-i="${i}" data-id="${r.id}">
      <label class="skips-row-main">
        <input type="checkbox" class="sk-cb skips-check" data-i="${i}">
        ${cover
          ? `<img src="${cover}" alt="" loading="lazy" class="skips-cover">`
          : `<div class="skips-cover skips-cover-empty">♪</div>`}
        <div class="skips-info">
          <div class="skips-title">${escapeHtml(r.track.name || '(sin nombre)')}</div>
          <div class="skips-meta">${escapeHtml(artists)}${r.track.album?.name ? ` · ${escapeHtml(r.track.album.name)}` : ''}</div>
        </div>
        <span class="skips-badge ${ratioClass}" title="Skipeaste ${r.skip} de ${r.total} veces">
          <span class="skips-badge-ratio">${r.ratio}%</span>
          <span class="skips-badge-count">${r.skip}/${r.total}</span>
        </span>
        <button class="skips-play-btn ${playingKey() === `sk:${r.id}` ? 'playing' : ''}" data-id="${r.id}" title="Preview 30s — no suma plays en tu historial">
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>
        </button>
        ${r.uri
          ? `<a href="https://open.spotify.com/track/${r.id}" target="_blank" rel="noopener" class="skips-open" title="Abrir en Spotify">↗</a>`
          : '<span class="skips-open" style="visibility:hidden">↗</span>'}
      </label>
      <div class="skips-preview-slot" data-id="${r.id}"></div>
    </div>
  `;
}

function wireFilters() {
  const content = document.getElementById('skips-content');
  content.querySelectorAll('#skips-plays-chips .skips-chip').forEach(btn => {
    btn.onclick = () => { minPlays = parseInt(btn.dataset.plays); renderResults(); };
  });
  content.querySelectorAll('#skips-ratio-chips .skips-chip').forEach(btn => {
    btn.onclick = () => { minRatio = parseInt(btn.dataset.ratio); renderResults(); };
  });
}

function wireRows() {
  const content = document.getElementById('skips-content');
  const rmBtn = content.querySelector('#sk-remove');
  const selAllBtn = content.querySelector('#sk-select-all');
  if (!rmBtn) return;

  const updateBtn = () => {
    const n = content.querySelectorAll('.sk-cb:checked').length;
    rmBtn.textContent = `Sacar de likes (${n})`;
    rmBtn.disabled = n === 0;
  };
  content.querySelectorAll('.sk-cb').forEach(cb => cb.addEventListener('change', updateBtn));
  if (selAllBtn) selAllBtn.onclick = () => {
    const cbs = content.querySelectorAll('.sk-cb');
    const allChecked = [...cbs].every(cb => cb.checked);
    cbs.forEach(cb => cb.checked = !allChecked);
    updateBtn();
  };

  // Click en el título/artista → ficha de canción (dentro de un <label>, hay
  // que frenar el toggle del checkbox).
  content.querySelectorAll('.skips-row .skips-info').forEach(el => {
    el.classList.add('tc-clickable');
    el.title = 'Ver ficha del tema';
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = filtered()[+el.closest('.skips-row').dataset.i];
      if (!r) return;
      const imgs = r.track.album?.images || [];
      openTrackCard({
        id: r.id,
        name: r.track.name,
        artist: (r.track.artists || []).map(a => a.name || a)[0] || '',
        album: r.track.album?.name,
        img: imgs[2]?.url || imgs[1]?.url || imgs[0]?.url,
      });
    };
  });

  // Preview: primero iTunes (instantáneo, sin plays en el historial); si no
  // está el tema ahí, cae al iframe embed de Spotify en el slot.
  content.querySelectorAll('.skips-play-btn').forEach(btn => {
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const row = btn.closest('.skips-row');
      const r = filtered()[+row.dataset.i];
      if (!r) return;
      // Si este tema ya tiene el embed fallback abierto, este click lo cierra.
      const slot = content.querySelector(`.skips-preview-slot[data-id="${r.id}"].open`);
      if (slot) {
        closeEmbeds(content);
        btn.classList.remove('playing');
        return;
      }
      closeEmbeds(content);
      const artist = (r.track.artists || []).map(a => a.name || a)[0] || '';
      const res = await togglePreview(`sk:${r.id}`, async () => {
        const p = await findTrackPreview(artist, r.track.name || '');
        return p && { url: p.url, label: `${r.track.name} — ${artist}` };
      });
      if (res === null) toggleEmbed(r.id, btn); // iTunes no lo tiene → embed Spotify
    };
  });

  rmBtn.onclick = async () => {
    const currentRows = filtered();
    const ids = [...content.querySelectorAll('.sk-cb:checked')].map(cb => currentRows[+cb.dataset.i].id);
    if (!ids.length) return;
    const ok = await confirmModal(
      'Sacar de tus Liked Songs',
      `Vas a sacar <strong>${ids.length}</strong> tracks de tus Liked Songs. Son los que casi siempre skipeás — podés recuperarlos después si te arrepentís.`,
      'Sacar'
    );
    if (!ok) return;
    rmBtn.disabled = true;
    rmBtn.textContent = 'Sacando…';
    try {
      await removeLikedTracks(ids);
      showToast(`Sacaste ${ids.length} tracks de tus likes`, 'success');
      await analyze();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
      updateBtn();
    }
  };
}

// Sincroniza el estado .playing de los botones con el player global.
// Listener único a nivel módulo: si la página no está montada, el query no matchea nada.
document.addEventListener('previewchange', (e) => {
  const content = document.getElementById('skips-content');
  if (!content) return;
  const key = e.detail.key || '';
  content.querySelectorAll('.skips-play-btn').forEach(b => {
    b.classList.toggle('playing', key === `sk:${b.dataset.id}`);
  });
});

function closeEmbeds(content) {
  content.querySelectorAll('.skips-preview-slot.open').forEach(s => {
    s.classList.remove('open');
    s.innerHTML = '';
  });
}

// Fallback: toggle del iframe embed oficial de Spotify (30s sin auth).
// Solo se usa cuando iTunes no tiene el tema. Ojo: este SÍ puede sumar al historial.
function toggleEmbed(id, btn) {
  const content = document.getElementById('skips-content');
  const slot = content.querySelector(`.skips-preview-slot[data-id="${id}"]`);
  if (!slot) return;

  const isOpen = slot.classList.contains('open');
  closeEmbeds(content);

  if (!isOpen) {
    slot.innerHTML = `
      <iframe
        src="https://open.spotify.com/embed/track/${id}?theme=0"
        width="100%" height="80"
        frameborder="0" allowtransparency="true"
        allow="encrypted-media"
        loading="lazy"
        style="border-radius:8px;display:block"></iframe>
    `;
    slot.classList.add('open');
    btn.classList.add('playing');
  }
}
