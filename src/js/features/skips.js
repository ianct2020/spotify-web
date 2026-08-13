// Skips crónicos: likes que reproducís seguido pero casi siempre le das next.
// Cruce local: likes vs history-skip-stats.json (ok = trackdone, skip = fwdbtn con ms>=5s).
// Preview 30s instantáneo vía iTunes (arranca en el estribillo, no suma plays
// en tu historial de Spotify). Fallback: iframe embed oficial si iTunes no lo tiene.

import { getBestAvailableLikes, removeLikedTracks } from '../api.js';
import { loadSkipStats, trackIdOf, isOwner, ownerLockedMessage } from './history-data.js';
import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js';
import { showToast } from '../ui/toast.js';
import { getPreview } from '../api/preview-providers.js';
import { togglePreview, playingKey } from '../ui/preview-player.js';
import { openTrackCard } from './track-card.js';
import { activateMarquee, marqueeSpan } from '../ui/marquee.js';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js';
import { createHiddenStore } from '../util/hidden-sync.js';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js';
import { createLazyImages } from '../ui/lazy-img.js';

let cache = null;
// Filas visibles con los filtros actuales, en el mismo orden que las tarjetas
// del grid. Es la fuente de verdad de la vista: ordenar, filtrar y ocultar
// operan acá y pasan por list.setItems(), nunca sobre el DOM.
let currentRows = [];
let rowById = new Map();
// La selección vive en el módulo y no en los checkboxes del DOM: con append
// incremental las tarjetas del final no existen todavía, así que "Seleccionar
// todos" no podría marcarlas y el contador leería de menos.
let selectedIds = new Set();
let list = null;
// Las tapas se cargan con un IntersectionObserver propio contra el grid (ver
// ui/lazy-img.js). El `loading="lazy"` nativo resuelve contra el viewport y no
// contra el ancestro que scrollea, así que disparaba las tapas de todos los
// lotes appendeados.
let lazyCovers = null;
let minPlays = 5;    // solo tracks con ≥N plays totales (ok+skip)
let minRatio = 70;   // ratio de skip mínimo (%)

// Los ocultos viven en una playlist privada de Spotify, así que sobreviven a
// borrar el caché del navegador y aparecen igual desde la otra compu.
const hiddenTracks = createHiddenStore({
  lsKey: 'skips_hidden_tracks',
  playlistName: 'fonoteca · ocultos (skips)',
  label: 'skips',
  keyOfTrack: (t) => t?.id || null,
});
let showingHidden = false;

// Toggle Stats.fm: si un tema tuvo plays nuevas desde el export, las cuenta
// como "ok" (asumiendo que si no volviste a skipearlo lo estás dejando pasar) y
// recalcula el ratio. Los que caen por debajo del umbral desaparecen del listado.
const STATSFM_TOGGLE_KEY = 'skips_use_statsfm';
let useStatsfm = localStorage.getItem(STATSFM_TOGGLE_KEY) === '1';

const RATIO_STEPS = [70, 80, 90, 100];
const PLAYS_STEPS = [3, 5, 10, 15];

export async function render(container) {
  teardown();
  container.innerHTML = `
    ${pageHeader({ title: 'Skips crónicos' })}
    <div id="skips-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cruzando likes con historial…</div></div></div>
  `;
  await analyze();
  // El router llama a esto al salir de la ruta. Sin él, al navegar a mitad de
  // lista quedaría vivo el IntersectionObserver sobre un centinela ya
  // desconectado del documento.
  return teardown;
}

function teardown() {
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
  selectedIds.clear();
  currentRows = [];
  rowById = new Map();
}

async function analyze() {
  const content = document.getElementById('skips-content');
  let likes, stats, top = null;
  try {
    [{ items: likes }, stats] = await Promise.all([
      getBestAvailableLikes(),
      loadSkipStats(),
      // Trae los ocultos de la playlist de Spotify. No bloquea: si falla o tarda,
      // la vista arranca con el caché local y se repinta cuando llega.
      hiddenTracks.ready().then(refreshAfterHiddenSync),
    ]);
    if (useStatsfm && hasUsername()) {
      top = await loadTopLifetime().catch(() => null);
    }
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
  let updatedCount = 0;
  for (const it of likes) {
    const t = it.track || it;
    const uri = t.uri || (t.id ? `spotify:track:${t.id}` : null);
    const id = trackIdOf(uri);
    if (!id) continue;
    const s = stats.tracks[id];
    if (!s) continue;
    let [ok, skip] = s;
    let total = ok + skip;
    let updated = false;
    if (top) {
      const hit = top.map.get(id);
      if (hit && hit.streams > total) {
        // Plays nuevas desde el export → asumo que fueron completas (si no volviste
        // a skipearlas). skip queda igual, ok sube, total y ratio se recalculan.
        ok += (hit.streams - total);
        total = ok + skip;
        updated = true;
        updatedCount++;
      }
    }
    if (total === 0 || skip === 0) continue;
    rows.push({ track: t, uri, id, ok, skip, total, ratio: Math.round((skip / total) * 100), updated });
  }
  rows.sort((a, b) => (b.ratio - a.ratio) || (b.total - a.total));
  cache = { rows, likesCount: likes.length, statsfmUsed: !!top, statsfmUpdated: updatedCount };
  renderResults();
}

// Los ocultos llegan de la playlist de Spotify unos segundos después de pintar.
// Si a esa altura ya hay lista, se repinta conservando el scroll: repintar
// entero devolvería al usuario al principio a los 7 segundos de entrar.
function refreshAfterHiddenSync() {
  if (!cache) return;
  if (!list) { renderResults(); return; }
  const hasBtn = !!document.querySelector('#sk-toggle-hidden');
  const needsBtn = hiddenTracks.size > 0 || showingHidden;
  if (hasBtn !== needsBtn) renderResults();
  else applyRows({ preserveRendered: true });
}

function filtered() {
  if (!cache) return [];
  return cache.rows.filter(r => {
    if (r.total < minPlays || r.ratio < minRatio) return false;
    const isHidden = hiddenTracks.has(r.id);
    return showingHidden ? isHidden : !isHidden;
  });
}

// Tarjetas por lote. 80 llena de sobra el primer viewport (entran ~20-24) y el
// resto queda de colchón para que el primer scroll no dispare nada.
const BATCH = 80;

// Recalcula las filas visibles a partir de los datos y las publica en la lista
// incremental. Nunca se toca el DOM de las tarjetas a mano.
function applyRows({ preserveRendered = false } = {}) {
  currentRows = filtered();
  rowById = new Map(currentRows.map(r => [r.id, r]));
  // La selección se queda solo con lo que sigue en la lista.
  for (const id of [...selectedIds]) if (!rowById.has(id)) selectedIds.delete(id);
  if (list) {
    // setItems repinta el grid entero: los <img> viejos dejan de existir y el
    // observer de tapas tiene que soltarlos antes de que lleguen los nuevos.
    lazyCovers?.reset();
    list.setItems(currentRows, { preserveRendered });
  }
  updateCounters();
}

function updateCounters() {
  const content = document.getElementById('skips-content');
  if (!content) return;
  const n = content.querySelector('#skips-count-visible');
  if (n) n.textContent = currentRows.length.toLocaleString('es-ES');
  const selAll = content.querySelector('#sk-select-all');
  if (selAll) selAll.disabled = currentRows.length === 0;
  const hideBtn = content.querySelector('#sk-toggle-hidden');
  if (hideBtn && !showingHidden) hideBtn.textContent = `Ocultos (${hiddenTracks.size})`;
  updateRemoveBtn();
}

function updateRemoveBtn() {
  const rmBtn = document.querySelector('#sk-remove');
  if (!rmBtn) return;
  rmBtn.textContent = `Sacar de likes (${selectedIds.size})`;
  rmBtn.disabled = selectedIds.size === 0;
}

function renderResults() {
  const t0 = performance.now();
  window.__skipsPerf = { batches: [] };
  const content = document.getElementById('skips-content');
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
  const rows = filtered();
  currentRows = rows;
  rowById = new Map(rows.map(r => [r.id, r]));
  for (const id of [...selectedIds]) if (!rowById.has(id)) selectedIds.delete(id);
  const withAnySkip = cache.rows.length;
  const hiddenCount = hiddenTracks.size;

  const sfLabel = cache.statsfmUsed
    ? `Cruzando con Stats.fm — ${cache.statsfmUpdated.toLocaleString('es-AR')} ajustados con plays post-export`
    : (hasUsername() ? 'Cruzar con Stats.fm' : '');

  // Topbar en UNA sola fila (v=121): stats mini + chips + toggle Stats.fm + acciones
  // agrupados con auto-margin. Todo compactado para que quepa cómodo en desktop.
  content.innerHTML = `
    <div class="skips-topbar skips-topbar-single">
      <div class="skips-topbar-row">
        <div class="skips-stat-mini">
          <span class="skips-stat-mini-v" id="skips-count-visible">${rows.length.toLocaleString('es-ES')}</span>
          <span class="skips-stat-mini-l">candidatos${showingHidden ? ' (ocultos)' : ''}</span>
        </div>
        <div class="skips-stat-mini">
          <span class="skips-stat-mini-v">${withAnySkip.toLocaleString('es-ES')}</span>
          <span class="skips-stat-mini-l">con ≥1 skip</span>
        </div>
        <div class="skips-stat-mini">
          <span class="skips-stat-mini-v">${cache.likesCount.toLocaleString('es-ES')}</span>
          <span class="skips-stat-mini-l">likes</span>
        </div>
        <div class="skips-chip-group" id="skips-plays-chips" title="Plays mínimas (ok+skip)">
          ${PLAYS_STEPS.map(v => `
            <button class="skips-chip ${v === minPlays ? 'active' : ''}" data-plays="${v}">≥${v}</button>
          `).join('')}
        </div>
        <div class="skips-chip-group" id="skips-ratio-chips" title="Ratio de skip mínimo">
          ${RATIO_STEPS.map(v => `
            <button class="skips-chip ${v === minRatio ? 'active' : ''}" data-ratio="${v}">${v === 100 ? '100%' : '≥' + v + '%'}</button>
          `).join('')}
        </div>
        ${sfLabel ? `
          <button type="button" class="skips-chip skips-chip-toggle ${useStatsfm ? 'active' : ''}" id="skips-statsfm-toggle" title="Al activarlo, temas que después del export escuchaste enteros N veces más ya no cuentan." aria-pressed="${useStatsfm}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="skips-chip-check" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <span>${escapeHtml(sfLabel)}</span>
          </button>
        ` : ''}
        <div class="skips-topbar-actions">
          ${hiddenCount > 0 || showingHidden ? `
            <button class="btn btn-secondary btn-sm ${showingHidden ? 'sort-active' : ''}" id="sk-toggle-hidden" title="${showingHidden ? 'Volver a la vista normal' : 'Ver solo los que ocultaste'}">${showingHidden ? '← Volver' : 'Ocultos (' + hiddenCount + ')'}</button>
          ` : ''}
          <button class="btn btn-secondary btn-sm" id="sk-select-all" ${rows.length === 0 ? 'disabled' : ''}>Seleccionar todos</button>
          <button class="btn btn-danger btn-sm" id="sk-remove" disabled>Sacar de likes (0)</button>
        </div>
      </div>
    </div>

    ${rows.length === 0 ? `
      <div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">${showingHidden ? 'No hay tracks ocultos que cumplan los umbrales actuales.' : 'Ningún like cumple los umbrales. Bajá los filtros para ver más candidatos.'}</p></div>
    ` : `
      <div class="skips-grid" id="skips-list"></div>
    `}
  `;

  wireFilters();
  wireRows();

  // El grid arranca vacío y se llena por lotes (ver ui/incremental-list.js).
  // Antes se inyectaban las 1.322 tarjetas de una sola vez y el hilo principal
  // se quedaba varios segundos construyendo DOM y calculando layout.
  const grid = content.querySelector('#skips-list');
  if (grid) {
    // El root es el mismo ancestro que scrollea que usa el centinela de la lista
    // (el grid en escritorio, el documento en móvil, donde la media query le
    // saca el overflow). rootMargin corto: las tapas van entrando justo antes de
    // verse, no lote por lote.
    lazyCovers = createLazyImages({ root: scrollRootOf(grid), rootMargin: '200px' });
    list = createIncrementalList({
      container: grid,
      items: currentRows,
      renderItem: renderRow,
      batchSize: BATCH,
      rootMargin: '600px',
      onBatch: ({ rendered, total, added, ms }) => {
        // Traza de coste de hilo principal (la lee el testeo con la extensión;
        // el reloj de pared no sirve en una pestaña en segundo plano).
        const perf = (window.__skipsPerf ||= { batches: [] });
        perf.batches.push({ added, rendered, total, ms: +ms.toFixed(1) });
        // Marquee solo sobre lo recién insertado: medir toda la lista en cada
        // lote sería cuadrático y son medidas de layout, de las caras.
        const nuevas = grid.querySelectorAll('.skips-card:not([data-mq])');
        nuevas.forEach(c => c.setAttribute('data-mq', '1'));
        lazyCovers?.observe(nuevas);
        activateMarquee(nuevas);
        if (window.__skipsDebug) {
          console.info(`[skips] lote +${added} → ${rendered}/${total} en ${ms.toFixed(1)} ms`);
        }
      },
    });
  }
  // La selección sobrevive a ocultar una pista, así que el botón puede tener que
  // arrancar con un número distinto de cero.
  updateRemoveBtn();

  const perf = window.__skipsPerf;
  perf.totalRows = currentRows.length;
  perf.firstPaintCards = list ? list.rendered : 0;
  perf.syncMs = +(performance.now() - t0).toFixed(1);
}

// Tarjeta por track (v=123): reemplaza a las dos listas de filas anchas, que
// en 2 columnas dejaban la derecha con solo la tapa y el porcentaje. En grid
// de tarjetas entran 20+ tracks en pantalla y todos se leen igual de bien.
// Se identifica por `data-id` y no por índice: con la lista incremental las
// tarjetas se appendean en tandas y los handlers están delegados en el grid, así
// que cada una tiene que poder resolver su fila sola (rowById).
function renderRow(r) {
  const imgs = r.track.album?.images || [];
  const cover = imgs[2]?.url || imgs[1]?.url || imgs[0]?.url || null;
  const artists = (r.track.artists || []).map(a => a.name || a).join(', ');
  const album = r.track.album?.name ? ` · ${escapeHtml(r.track.album.name)}` : '';
  const ratioClass = r.ratio >= 90 ? 'skips-badge-danger' : 'skips-badge-warn';
  const badgeTitle = r.updated
    ? `Ratio actualizado con Stats.fm (${r.skip} skips de ${r.total} plays totales hoy)`
    : `Skipeaste ${r.skip} de ${r.total} veces`;

  return `
    <div class="skips-card" data-id="${r.id}">
      <div class="skips-card-main">
        <div class="skips-card-cover">
          ${cover
            ? `<img data-src="${cover}" alt="" width="56" height="56" decoding="async" class="skips-cover">`
            : `<div class="skips-cover skips-cover-empty">♪</div>`}
          <label class="skips-card-sel" title="Seleccionar">
            <input type="checkbox" class="sk-cb skips-check"${selectedIds.has(r.id) ? ' checked' : ''}>
          </label>
        </div>
        <div class="skips-card-body">
          <div class="skips-info tc-clickable" title="Ver ficha del tema">
            <div class="skips-title">${marqueeSpan(escapeHtml(r.track.name || '(sin nombre)'))}</div>
            <div class="skips-meta">${escapeHtml(artists)}${album}</div>
          </div>
          <div class="skips-card-foot">
            <span class="skips-badge ${ratioClass}${r.updated ? ' skips-badge-updated' : ''}" title="${badgeTitle}">
              <span class="skips-badge-ratio">${r.ratio}%</span>
              <span class="skips-badge-count">${r.skip}/${r.total}</span>
            </span>
            <div class="skips-card-actions">
              <button class="skips-play-btn ${playingKey() === `sk:${r.id}` ? 'playing' : ''}" data-id="${r.id}" title="Preview 30s — no suma plays en tu historial" aria-label="Preview">
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>
              </button>
              <a href="https://open.spotify.com/track/${r.id}" target="_blank" rel="noopener" class="skips-open" title="Abrir en Spotify" aria-label="Abrir en Spotify">
                <span class="skips-open-arrow">↗</span>
              </a>
              <button class="wthree-hide-btn sk-hide-btn" data-id="${r.id}" title="${showingHidden ? 'Restaurar en la lista' : 'Ocultar de la lista'}" aria-label="${showingHidden ? 'Restaurar' : 'Ocultar'}">
                ${showingHidden
                  ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
                  : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`}
              </button>
            </div>
          </div>
        </div>
      </div>
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
  const sfToggle = content.querySelector('#skips-statsfm-toggle');
  if (sfToggle) sfToggle.onclick = async () => {
    useStatsfm = !useStatsfm;
    localStorage.setItem(STATSFM_TOGGLE_KEY, useStatsfm ? '1' : '0');
    content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">${useStatsfm ? 'Cruzando con Stats.fm…' : 'Recalculando…'}</div></div>`;
    await analyze();
  };
}

// Todos los handlers de las tarjetas van DELEGADOS en el grid. Con append
// incremental, las tarjetas del lote 3 en adelante no existen cuando se cablea
// la vista: un `querySelectorAll(...).forEach(addEventListener)` dejaría medio
// listado muerto (sin preview, sin ocultar, sin ficha) y sin ningún error.
function wireRows() {
  const content = document.getElementById('skips-content');
  const rmBtn = content.querySelector('#sk-remove');
  const selAllBtn = content.querySelector('#sk-select-all');
  const grid = content.querySelector('#skips-list');
  if (!rmBtn) return;

  if (selAllBtn) selAllBtn.onclick = () => {
    // Sobre el array, no sobre los checkboxes pintados: si solo mirara el DOM
    // marcaría 80 de 1.322.
    const allSelected = currentRows.length > 0 && currentRows.every(r => selectedIds.has(r.id));
    selectedIds = allSelected ? new Set() : new Set(currentRows.map(r => r.id));
    if (grid) grid.querySelectorAll('.sk-cb').forEach(cb => {
      cb.checked = selectedIds.has(cb.closest('.skips-card')?.dataset.id);
    });
    updateRemoveBtn();
  };

  if (grid) {
    grid.addEventListener('change', (e) => {
      const cb = e.target.closest('.sk-cb');
      if (!cb) return;
      const id = cb.closest('.skips-card')?.dataset.id;
      if (!id) return;
      if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
      updateRemoveBtn();
    });

    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.skips-card');
      if (!card) return;
      const r = rowById.get(card.dataset.id);
      if (!r) return;

      if (e.target.closest('.skips-open')) return;          // link a Spotify, que siga
      if (e.target.closest('.skips-card-sel')) return;      // checkbox, lo maneja 'change'

      const playBtn = e.target.closest('.skips-play-btn');
      if (playBtn) { e.preventDefault(); e.stopPropagation(); onPlayClick(r, playBtn); return; }

      const hideBtn = e.target.closest('.sk-hide-btn');
      if (hideBtn) { e.preventDefault(); e.stopPropagation(); onHideClick(r.id); return; }

      if (e.target.closest('.skips-info')) {
        e.preventDefault();
        e.stopPropagation();
        const imgs = r.track.album?.images || [];
        openTrackCard({
          id: r.id,
          name: r.track.name,
          artist: (r.track.artists || []).map(a => a.name || a)[0] || '',
          album: r.track.album?.name,
          img: imgs[2]?.url || imgs[1]?.url || imgs[0]?.url,
        });
      }
    });
  }

  const hideToggle = content.querySelector('#sk-toggle-hidden');
  if (hideToggle) hideToggle.onclick = () => {
    showingHidden = !showingHidden;
    renderResults();
  };

  rmBtn.onclick = async () => {
    const ids = currentRows.filter(r => selectedIds.has(r.id)).map(r => r.id);
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
      updateRemoveBtn();
    }
  };
}

// Preview: primero iTunes (instantáneo, sin plays en el historial); si no está
// el tema ahí, cae al iframe embed de Spotify en el slot de la tarjeta.
async function onPlayClick(r, btn) {
  const content = document.getElementById('skips-content');
  // Si este tema ya tiene el embed fallback abierto, este click lo cierra.
  const slot = content.querySelector(`.skips-preview-slot[data-id="${r.id}"].open`);
  if (slot) {
    closeEmbeds(content);
    btn.classList.remove('playing');
    return;
  }
  closeEmbeds(content);
  const artist = (r.track.artists || []).map(a => a.name || a)[0] || '';
  // No pasamos spotifyId a getPreview a propósito: en Skips el iframe embed va
  // INLINE en la tarjeta (toggleEmbed) — no queremos que la cadena lo abra en el
  // pill flotante y encima una segunda fuente en la tarjeta.
  const res = await togglePreview(`sk:${r.id}`, async () => {
    return await getPreview({ name: r.track.name || '', artist });
  });
  if (res === null) toggleEmbed(r.id, btn);   // ni iTunes ni Deezer → embed Spotify inline
}

function onHideClick(id) {
  const hadHidden = hiddenTracks.size > 0;
  const wasShowingHidden = showingHidden;
  hiddenTracks.toggle(id, `spotify:track:${id}`);
  if (showingHidden && hiddenTracks.size === 0) showingHidden = false;
  // Si aparece o desaparece el botón "Ocultos (N)", o si se sale sola de la
  // vista de ocultos, hay que repintar la topbar entera. Si no, alcanza con
  // sacar la fila del array y repintar la lista conservando el scroll y lo que
  // ya estaba pintado.
  const structural = ((hiddenTracks.size > 0) !== hadHidden) || (showingHidden !== wasShowingHidden);
  if (structural) renderResults();
  else applyRows({ preserveRendered: true });
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
