// Likes con 0 plays: tracks likeados que nunca escuchaste según el Extended Streaming History.
// Cruce local: likes vs history-track-plays.json (índice de plays por track id).

import { getBestAvailableLikes, removeLikedTracks } from '../api.js?v=117';
import { loadTrackPlays, trackIdOf, isOwner, ownerLockedMessage } from './history-data.js?v=117';
import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js?v=117';
import { showToast } from '../ui/toast.js?v=117';
import { openTrackCard } from './track-card.js?v=117';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js?v=117';

let cache = null;

const STATSFM_TOGGLE_KEY = 'zeroplays_use_statsfm';
let useStatsfm = localStorage.getItem(STATSFM_TOGGLE_KEY) === '1';

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Sin plays' })}
    <div id="zeroplays-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cruzando likes con historial…</div></div></div>
  `;
  await analyze();
}

async function analyze() {
  const content = document.getElementById('zeroplays-content');
  let likes, plays, top = null;
  try {
    [{ items: likes }, plays] = await Promise.all([
      getBestAvailableLikes(),
      loadTrackPlays(),
    ]);
    if (useStatsfm && hasUsername()) {
      top = await loadTopLifetime().catch(() => null);
    }
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">Error: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  if (!plays || !plays.tracks) {
    content.innerHTML = (await isOwner())
      ? `<div class="card"><p>No pude cargar el historial. Volvé a probar.</p></div>`
      : ownerLockedMessage('Sin plays');
    return;
  }
  const zeros = [];
  const some = [];
  let partialsInZeros = 0;
  let statsfmRescued = 0;
  for (const it of likes) {
    const t = it.track || it;
    const uri = t.uri || (t.id ? `spotify:track:${t.id}` : null);
    const id = trackIdOf(uri);
    if (!id) continue;
    const p = plays.tracks[id];
    if (!p) {
      // Con Stats.fm: si el tema aparece en el top-1000 lifetime, ya no es "sin plays"
      if (top && top.map.has(id)) { statsfmRescued++; continue; }
      zeros.push({ track: t, uri, id });
    } else if (p[2] === 'p') {
      if (top && top.map.has(id)) { statsfmRescued++; continue; }
      zeros.push({ track: t, uri, id, partial: { p: p[0], s: p[1] } });
      partialsInZeros++;
    } else {
      some.push({ track: t, uri, id, plays: p[0], seconds: p[1] });
    }
  }
  cache = { zeros, some, likesCount: likes.length, partialsInZeros, statsfmUsed: !!top, statsfmRescued };
  renderResults();
}

function renderResults() {
  const content = document.getElementById('zeroplays-content');
  const { zeros, some, likesCount, partialsInZeros, statsfmUsed, statsfmRescued } = cache;
  const nunca = zeros.length - (partialsInZeros || 0);

  const sfLine = statsfmUsed
    ? `<div style="font-size:12px;color:var(--color-accent);margin-top:2px">Cruzando con Stats.fm — sacados ${statsfmRescued.toLocaleString('es-AR')} temas que sí escuchaste después del export.</div>`
    : '';
  const sfToggleHtml = hasUsername() ? `
    <label class="statsfm-toggle" title="Al activarlo, un tema que después del export escuchaste al menos una vez ya no aparece como 'sin plays'.">
      <input type="checkbox" id="zp-statsfm-toggle" ${useStatsfm ? 'checked' : ''}>
      <span>Cruzar con Stats.fm (plays post-export)</span>
    </label>` : '';

  content.innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:14px">
          <strong>${zeros.length.toLocaleString('es-AR')}</strong> likes sin plays ≥30s de ${likesCount.toLocaleString('es-AR')} totales
        </div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">
          ${nunca.toLocaleString('es-AR')} nunca sonaron${partialsInZeros ? ` · ${partialsInZeros.toLocaleString('es-AR')} tuvieron plays cortas (badge naranja)` : ''} · ${some.length.toLocaleString('es-AR')} tienen alguna play ≥30s.
        </div>
        ${sfLine}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="zp-select-all">Seleccionar todos</button>
        <button class="btn btn-danger btn-sm" id="zp-remove" disabled>Sacar de likes (0)</button>
      </div>
    </div>
    ${sfToggleHtml}

    ${zeros.length === 0 ? `
      <div class="card"><p>No hay likes sin plays. Todos tus likes se escucharon al menos una vez ≥30s.</p></div>
    ` : `
      <div class="card" style="padding:0;overflow:hidden">
        <div class="pick-list-scroll" style="max-height:65vh;overflow:auto">
          ${zeros.map((z, i) => {
            const imgs = z.track.album?.images || [];
            const cover = imgs[2]?.url || imgs[1]?.url || imgs[0]?.url || null;
            const partial = z.partial || null; // {p:plays, s:seg} si vino de una play cortita
            return `
            <label class="pick-row" style="display:flex;align-items:center;gap:11px;padding:10px 14px;border-bottom:1px solid var(--color-border);cursor:pointer">
              <input type="checkbox" class="zp-cb" data-i="${i}">
              ${cover ? `<img src="${cover}" alt="" loading="lazy" class="pick-cover">` : `<div class="pick-cover" style="background:var(--color-elevated);display:flex;align-items:center;justify-content:center;color:var(--color-text-muted);font-size:16px">♪</div>`}
              <div class="zp-info tc-clickable" data-i="${i}" title="Ver ficha del tema" style="flex:1;min-width:0">
                <div class="track-name" style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(z.track.name || '(sin nombre)')}</div>
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

  const sfToggle = content.querySelector('#zp-statsfm-toggle');
  if (sfToggle) sfToggle.onchange = async () => {
    useStatsfm = sfToggle.checked;
    localStorage.setItem(STATSFM_TOGGLE_KEY, useStatsfm ? '1' : '0');
    content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">${useStatsfm ? 'Cruzando con Stats.fm…' : 'Recalculando…'}</div></div>`;
    await analyze();
  };

  const rmBtn = content.querySelector('#zp-remove');
  const selAllBtn = content.querySelector('#zp-select-all');
  if (!rmBtn) return;

  const updateBtn = () => {
    const n = content.querySelectorAll('.zp-cb:checked').length;
    rmBtn.textContent = `Sacar de likes (${n})`;
    rmBtn.disabled = n === 0;
  };
  content.querySelectorAll('.zp-cb').forEach(cb => cb.addEventListener('change', updateBtn));
  // Click en título/artista → ficha (frena el toggle del checkbox del <label>)
  content.querySelectorAll('.zp-info').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const z = cache.zeros[+el.dataset.i];
      if (!z) return;
      const imgs = z.track.album?.images || [];
      openTrackCard({
        id: z.id,
        name: z.track.name,
        artist: (z.track.artists || []).map(a => a.name || a)[0] || '',
        album: z.track.album?.name,
        img: imgs[2]?.url || imgs[1]?.url || imgs[0]?.url,
      });
    };
  });
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
