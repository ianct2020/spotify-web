// Skips crónicos: likes que reproducís seguido pero casi siempre le das next.
// Cruce local: likes vs history-skip-stats.json (ok = trackdone, skip = fwdbtn con ms>=5s).

import { getBestAvailableLikes, removeLikedTracks } from '../api.js';
import { loadSkipStats, trackIdOf } from './history-data.js';
import { escapeHtml, confirmModal } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

let cache = null;
let minPlays = 5;    // barra: solo tracks con ≥N plays totales (ok+skip)
let minRatio = 70;   // barra: ratio de skip mínimo (%)

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Skips crónicos</h1>
      <p>Likes que <strong>reproducís seguido pero casi siempre skipeás</strong>. Basado en tu Extended Streaming History: cuenta como skip cuando le diste next después de escuchar ≥5s (así descartamos autoplay accidental).</p>
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
    content.innerHTML = `<div class="card"><p>No pude cargar el historial de skips. Reintentá.</p></div>`;
    return;
  }

  // Cruzo cada like con las stats. Guardo TODOS los que tienen al menos 1 skip,
  // los umbrales se aplican al render (para poder mover las barras sin re-cruzar).
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
  // Peores primero: mayor ratio y, con empate, más plays totales.
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

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div style="min-width:0">
        <div style="font-size:14px">
          <strong>${rows.length.toLocaleString('es-AR')}</strong> likes con ≥${minPlays} plays y ≥${minRatio}% skip
        </div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">
          Sobre ${cache.rows.length.toLocaleString('es-AR')} likes con al menos 1 skip · ${cache.likesCount.toLocaleString('es-AR')} likes totales.
        </div>
      </div>
      <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;flex-direction:column;font-size:12px;color:var(--color-text-muted);gap:2px">
          <span>Plays mínimas: <strong id="skips-plays-lbl">${minPlays}</strong></span>
          <input type="range" id="skips-plays" min="3" max="20" step="1" value="${minPlays}" style="width:120px">
        </label>
        <label style="display:flex;flex-direction:column;font-size:12px;color:var(--color-text-muted);gap:2px">
          <span>Ratio skip: <strong id="skips-ratio-lbl">${minRatio}%</strong></span>
          <input type="range" id="skips-ratio" min="50" max="100" step="5" value="${minRatio}" style="width:120px">
        </label>
        <div style="display:flex;gap:8px">
          <button class="btn btn-secondary btn-sm" id="sk-select-all" ${rows.length === 0 ? 'disabled' : ''}>Seleccionar todos</button>
          <button class="btn btn-danger btn-sm" id="sk-remove" disabled>Sacar de likes (0)</button>
        </div>
      </div>
    </div>

    ${rows.length === 0 ? `
      <div class="card"><p>Ningún like cumple los umbrales. Bajá "Plays mínimas" o "Ratio skip" a la izquierda para ver más candidatos.</p></div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden">
        <div class="pick-list-scroll" style="max-height:65vh;overflow:auto">
          ${rows.map((r, i) => {
            const imgs = r.track.album?.images || [];
            const cover = imgs[2]?.url || imgs[1]?.url || imgs[0]?.url || null;
            const artists = (r.track.artists || []).map(a => a.name || a).join(', ');
            return `
            <label class="pick-row" style="display:flex;align-items:center;gap:11px;padding:10px 14px;border-bottom:1px solid var(--color-border);cursor:pointer">
              <input type="checkbox" class="sk-cb" data-i="${i}">
              ${cover ? `<img src="${cover}" alt="" loading="lazy" class="pick-cover">` : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px">♪</div>`}
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.track.name || '(sin nombre)')}</div>
                <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(artists)} · ${escapeHtml(r.track.album?.name || '')}</div>
              </div>
              <span title="Skipeaste ${r.skip} de ${r.total} veces" style="font-size:11px;color:${r.ratio >= 90 ? '#ef4444' : '#f59e0b'};flex-shrink:0;background:${r.ratio >= 90 ? 'rgba(239,68,68,.1)' : 'rgba(245,158,11,.1)'};padding:3px 8px;border-radius:10px;white-space:nowrap;font-variant-numeric:tabular-nums">${r.ratio}% skip · ${r.skip}/${r.total}</span>
              ${r.uri ? `<a href="https://open.spotify.com/track/${r.id}" target="_blank" rel="noopener" title="Abrir en Spotify" style="color:var(--color-text-muted);font-size:15px;flex-shrink:0;text-decoration:none">↗</a>` : ''}
            </label>
          `;}).join('')}
        </div>
      </div>
    `}
  `;

  const rmBtn = content.querySelector('#sk-remove');
  const selAllBtn = content.querySelector('#sk-select-all');
  const playsIn = content.querySelector('#skips-plays');
  const ratioIn = content.querySelector('#skips-ratio');

  playsIn.addEventListener('input', () => {
    minPlays = parseInt(playsIn.value);
    renderResults();
  });
  ratioIn.addEventListener('input', () => {
    minRatio = parseInt(ratioIn.value);
    renderResults();
  });

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
  rmBtn.onclick = async () => {
    const currentRows = filtered();
    const ids = [...content.querySelectorAll('.sk-cb:checked')].map(cb => currentRows[+cb.dataset.i].id);
    if (!ids.length) return;
    const ok = await confirmModal(
      'Sacar de tus Liked Songs',
      `Vas a sacar <strong>${ids.length}</strong> tracks de tus Liked Songs. Son los que casi siempre skipeás — no te olvides que podés recuperarlos después si te arrepentís.`,
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
