// Likes con 0 plays: tracks likeados que nunca escuchaste según el Extended Streaming History.
// Cruce local: likes vs history-track-plays.json (índice de plays por track id).

import { getBestAvailableLikes, removeLikedTracks } from '../api.js';
import { loadTrackPlays, trackIdOf } from './history-data.js';
import { escapeHtml, confirmModal } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

let cache = null;

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Sin plays</h1>
      <p>Likes que <strong>nunca reprodujiste</strong> con al menos 30s en tu Extended Streaming History. Candidatos a limpiar.</p>
    </div>
    <div id="zeroplays-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cruzando likes con historial…</div></div></div>
  `;
  await analyze();
}

async function analyze() {
  const content = document.getElementById('zeroplays-content');
  let likes, plays;
  try {
    [{ items: likes }, plays] = await Promise.all([
      getBestAvailableLikes(),
      loadTrackPlays(),
    ]);
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">Error: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  if (!plays || !plays.tracks) {
    content.innerHTML = `<div class="card"><p>No pude cargar el historial. Volvé a probar.</p></div>`;
    return;
  }
  const zeros = [];
  const some = [];
  let partialsInZeros = 0;
  for (const it of likes) {
    const t = it.track || it;
    const uri = t.uri || (t.id ? `spotify:track:${t.id}` : null);
    const id = trackIdOf(uri);
    if (!id) continue;
    const p = plays.tracks[id];
    if (!p) {
      zeros.push({ track: t, uri, id });
    } else if (p[2] === 'p') {
      // solo tuvo plays <30s (partial): igual va a zeros, con badge
      zeros.push({ track: t, uri, id, partial: { p: p[0], s: p[1] } });
      partialsInZeros++;
    } else {
      some.push({ track: t, uri, id, plays: p[0], seconds: p[1] });
    }
  }
  cache = { zeros, some, likesCount: likes.length, partialsInZeros };
  renderResults();
}

function renderResults() {
  const content = document.getElementById('zeroplays-content');
  const { zeros, some, likesCount, partialsInZeros } = cache;
  const nunca = zeros.length - (partialsInZeros || 0);

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:14px">
          <strong>${zeros.length.toLocaleString('es-AR')}</strong> likes sin plays ≥30s de ${likesCount.toLocaleString('es-AR')} totales
        </div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">
          ${nunca.toLocaleString('es-AR')} nunca sonaron${partialsInZeros ? ` · ${partialsInZeros.toLocaleString('es-AR')} tuvieron plays cortas (badge naranja)` : ''} · ${some.length.toLocaleString('es-AR')} tienen alguna play ≥30s.
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="zp-select-all">Seleccionar todos</button>
        <button class="btn btn-danger btn-sm" id="zp-remove" disabled>Sacar de likes (0)</button>
      </div>
    </div>

    ${zeros.length === 0 ? `
      <div class="card"><p>No hay likes sin plays. Todos tus likes se escucharon al menos una vez ≥30s.</p></div>
    ` : `
      <div class="card" style="padding:0">
        <div style="max-height:65vh;overflow:auto">
          ${zeros.map((z, i) => {
            const imgs = z.track.album?.images || [];
            const cover = imgs[2]?.url || imgs[1]?.url || imgs[0]?.url || null;
            const partial = z.partial || null; // {p:plays, s:seg} si vino de una play cortita
            return `
            <label class="pick-row" style="display:flex;align-items:center;gap:11px;padding:10px 14px;border-bottom:1px solid var(--color-border);cursor:pointer">
              <input type="checkbox" class="zp-cb" data-i="${i}">
              ${cover ? `<img src="${cover}" alt="" loading="lazy" class="pick-cover">` : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px">♪</div>`}
              <div style="flex:1;min-width:0">
                <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(z.track.name || '(sin nombre)')}</div>
                <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml((z.track.artists || []).map(a => a.name || a).join(', '))} · ${escapeHtml(z.track.album?.name || '')}</div>
              </div>
              ${partial ? `<span title="Escuchada al menos una vez menos de 30s (por eso no cuenta como play)" style="font-size:11px;color:#f59e0b;flex-shrink:0;background:rgba(245,158,11,.1);padding:3px 8px;border-radius:10px;white-space:nowrap">${partial.p} play${partial.p === 1 ? ' corta' : 's cortas'}</span>` : ''}
              ${z.uri ? `<a href="https://open.spotify.com/track/${z.id}" target="_blank" rel="noopener" title="Abrir en Spotify" style="color:var(--color-text-muted);font-size:15px;flex-shrink:0;text-decoration:none">↗</a>` : ''}
            </label>
          `;}).join('')}
        </div>
      </div>
    `}
  `;

  const rmBtn = content.querySelector('#zp-remove');
  const selAllBtn = content.querySelector('#zp-select-all');
  if (!rmBtn) return;

  const updateBtn = () => {
    const n = content.querySelectorAll('.zp-cb:checked').length;
    rmBtn.textContent = `Sacar de likes (${n})`;
    rmBtn.disabled = n === 0;
  };
  content.querySelectorAll('.zp-cb').forEach(cb => cb.addEventListener('change', updateBtn));
  selAllBtn.onclick = () => {
    const cbs = content.querySelectorAll('.zp-cb');
    const allChecked = [...cbs].every(cb => cb.checked);
    cbs.forEach(cb => cb.checked = !allChecked);
    updateBtn();
  };
  rmBtn.onclick = async () => {
    const ids = [...content.querySelectorAll('.zp-cb:checked')].map(cb => cache.zeros[+cb.dataset.i].id);
    if (!ids.length) return;
    const ok = await confirmModal('Sacar de tus Liked Songs', `Vas a sacar <strong>${ids.length}</strong> tracks de tus Liked Songs. Podés recuperarlos manualmente después.`, 'Sacar');
    if (!ok) return;
    rmBtn.disabled = true;
    rmBtn.textContent = 'Sacando…';
    try {
      await removeLikedTracks(ids);
      showToast(`Sacaste ${ids.length} tracks de tus likes`, 'success');
      // reanalizar
      await analyze();
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
      updateBtn();
    }
  };
}
