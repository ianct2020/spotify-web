// Skips crónicos: likes que reproducís seguido pero casi siempre le das next.
// Cruce local: likes vs history-skip-stats.json (ok = trackdone, skip = fwdbtn con ms>=5s).
// Preview 30s instantáneo vía iTunes (arranca en el estribillo, no suma plays
// en tu historial de Spotify). Fallback: iframe embed oficial si iTunes no lo tiene.

import { getBestAvailableLikes, removeLikedTracks } from '../api.js?v=144';
import { loadSkipStats, trackIdOf, isOwner, ownerLockedMessage } from './history-data.js?v=144';
import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js?v=144';
import { showToast } from '../ui/toast.js?v=144';
import { getPreview } from '../api/preview-providers.js?v=144';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=144';
import { openTrackCard } from './track-card.js?v=144';
import { activateMarquee } from '../ui/marquee.js?v=144';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js?v=144';
import { createHiddenStore } from '../util/hidden-sync.js?v=144';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js?v=144';
import { createLazyImages } from '../ui/lazy-img.js?v=144';
import { renderTrackCardRow, wireTrackCardGrid, paintCardSelection } from '../ui/track-card-row.js?v=144';
import { coverAtSize } from '../util/cover-size.js?v=144';

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
  syncHiddenToggle();
  applyRows({ preserveRendered: true });
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

// El toggle "Ocultos (N)" solo existe si hay algo oculto (o si estás mirando
// los ocultos). Vive en su propia función porque aparecer y desaparecer NO
// puede costar un repintado de la vista: era eso lo que devolvía el scroll al
// principio la primera vez que ocultabas una pista estando abajo.
function hiddenToggleHtml(n) {
  if (!(n > 0 || showingHidden)) return '';
  return `<button class="btn btn-secondary btn-sm ${showingHidden ? 'sort-active' : ''}" id="sk-toggle-hidden" title="${showingHidden ? 'Volver a la vista normal' : 'Ver solo los que ocultaste'}">${showingHidden ? '← Volver' : 'Ocultos (' + n + ')'}</button>`;
}

// Mete o saca el toggle en el sitio y lo deja cableado. Devuelve true si la
// presencia del botón cambió.
function syncHiddenToggle() {
  const actions = document.getElementById('sk-actions');
  if (!actions) return false;
  const actual = actions.querySelector('#sk-toggle-hidden');
  const html = hiddenToggleHtml(hiddenTracks.size);
  if (!html) {
    if (!actual) return false;
    actual.remove();
    return true;
  }
  if (actual) { actual.outerHTML = html; }
  else { actions.insertAdjacentHTML('afterbegin', html); }
  wireHiddenToggle();
  return !actual;
}

function wireHiddenToggle() {
  const btn = document.getElementById('sk-toggle-hidden');
  if (btn) btn.onclick = () => { showingHidden = !showingHidden; renderResults(); };
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
        <div class="skips-topbar-actions" id="sk-actions">
          ${hiddenToggleHtml(hiddenCount)}
          <button class="btn btn-secondary btn-sm" id="sk-select-all" ${rows.length === 0 ? 'disabled' : ''}>Seleccionar todos</button>
          <button class="btn btn-danger btn-sm" id="sk-remove" disabled>Sacar de likes (0)</button>
        </div>
      </div>
    </div>

    ${rows.length === 0 ? `
      <div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">${showingHidden ? 'No hay tracks ocultos que cumplan los umbrales actuales.' : 'Ningún like cumple los umbrales. Bajá los filtros para ver más candidatos.'}</p></div>
    ` : `
      <div class="skips-grid sc-grid" id="skips-list" role="listbox" aria-multiselectable="true" aria-label="Skips crónicos"></div>
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
        const nuevas = grid.querySelectorAll('.sc-card:not([data-mq])');
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
  // Tapas cargadas / descargadas ahora mismo (ui/lazy-img.js). Se lee en las
  // mediciones: tiene que quedar acotado, no crecer con la lista recorrida.
  Object.defineProperty(perf, 'lazy', { get: () => lazyCovers?.stats || null, configurable: true });
  perf.totalRows = currentRows.length;
  perf.firstPaintCards = list ? list.rendered : 0;
  perf.syncMs = +(performance.now() - t0).toFixed(1);
}

// La tarjeta es la MISMA que la de `#sin-clasificar` desde v=140:
// `ui/track-card-row.js`, tapa de 96px y selección de la tarjeta entera. Lo
// único propio de esta vista es el badge del ratio, que va antes de los botones,
// y el slot del embed de Spotify, que se cuelga al final de la tarjeta.
//
// Se identifica por `data-id` y no por índice: con la lista incremental las
// tarjetas se appendean en tandas y los handlers están delegados en el grid, así
// que cada una tiene que poder resolver su fila sola (rowById).
function renderRow(r) {
  const imgs = r.track.album?.images || [];
  // La de ~300 para pintar a 96. Las cachés viejas de likes y el backup del
  // repo solo tienen la de 64: ahí se deduce del prefijo del CDN y la de 64
  // queda de `onerror` (ver util/cover-size.js).
  const chica = imgs.length ? (imgs[imgs.length - 1].url || null) : null;
  const media = imgs.find(im => (im.width || 0) >= 240 && (im.width || 0) <= 400)
    || imgs.find(im => (im.width || 0) >= 240);
  const cover = media?.url || (chica ? coverAtSize(chica, 300) : null);

  const ratioClass = r.ratio >= 90 ? 'skips-badge-danger' : 'skips-badge-warn';
  const badgeTitle = r.updated
    ? `Ratio actualizado con Stats.fm (${r.skip} skips de ${r.total} plays totales hoy)`
    : `Skipeaste ${r.skip} de ${r.total} veces`;
  const badge = `
    <span class="skips-badge ${ratioClass}${r.updated ? ' skips-badge-updated' : ''}" title="${escapeHtml(badgeTitle)}">
      <span class="skips-badge-ratio">${r.ratio}%</span>
      <span class="skips-badge-count">${r.skip}/${r.total}</span>
    </span>`;

  return renderTrackCardRow(
    {
      id: r.id,
      trackId: r.id,
      name: r.track.name,
      artists: (r.track.artists || []).map(firstArtistName).filter(Boolean).join(', '),
      sub: r.track.album?.name || '',
      cover,
      coverSmall: chica,
    },
    {
      selected: selectedIds.has(r.id),
      playing: playingKey() === `sk:${r.id}`,
      hidden: showingHidden,
      badge,
      extra: `<div class="skips-preview-slot" data-id="${r.id}"></div>`,
    },
  );
}

// Ojo con el `a.name || a`: hay un like con `artists: [{ id: …, name: "" }]`
// (nombre vacío, no ausente) y ese patrón devuelve el OBJETO artista. Acá solo
// pintaría `[object Object]`, pero en `#sin-clasificar` el mismo bug tiraba
// abajo el orden «Por artista» (v=138). Unificado.
function firstArtistName(a) {
  const n = (a && typeof a === 'object') ? a.name : a;
  return typeof n === 'string' ? n : '';
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
    // Solo repinta lo que existe: las tarjetas de los lotes que falten nacen ya
    // marcadas, porque renderRow lee del Set.
    if (grid) grid.querySelectorAll('.sc-card').forEach(card => {
      paintCardSelection(card, selectedIds.has(card.dataset.id));
    });
    updateRemoveBtn();
  };

  // La tarjeta entera es el control de selección (no hay checkbox): el click
  // sobre un botón corta antes de llegar al toggle, y Enter/Espacio togglean la
  // tarjeta enfocada. Todo delegado en el grid, ver ui/track-card-row.js.
  wireTrackCardGrid(grid, {
    rowById: (id) => rowById.get(id),
    onToggle: (id) => {
      if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
      paintCardSelection(grid.querySelector(`.sc-card[data-id="${CSS.escape(id)}"]`), selectedIds.has(id));
      updateRemoveBtn();
    },
    onPlay: (r, card) => onPlayClick(r, card.querySelector('.sc-play')),
    onCard: (r) => {
      const imgs = r.track.album?.images || [];
      openTrackCard({
        id: r.id,
        name: r.track.name,
        artist: (r.track.artists || []).map(firstArtistName).filter(Boolean)[0] || '',
        album: r.track.album?.name,
        img: imgs[imgs.length - 1]?.url || imgs[0]?.url,
      });
    },
    onHide: (r) => onHideClick(r.id),
  });

  wireHiddenToggle();

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
  // TODOS los artistas del track, no solo el primero: la cadena de proveedores
  // acepta el match si coincide cualquiera (util/track-match.js), y con los
  // álbumes acreditados a un alias («¥$») el primero es justo el que no matchea.
  const artists = (r.track.artists || []).map(a => a.name || a).filter(Boolean);
  // No pasamos spotifyId a getPreview a propósito: en Skips el iframe embed va
  // INLINE en la tarjeta (toggleEmbed) — no queremos que la cadena lo abra en el
  // pill flotante y encima una segunda fuente en la tarjeta.
  const res = await togglePreview(`sk:${r.id}`, async () => {
    return await getPreview({ name: r.track.name || '', artists });
  });
  if (res === null) toggleEmbed(r.id, btn);   // ni iTunes ni Deezer → embed Spotify inline
}

function onHideClick(id) {
  const wasShowingHidden = showingHidden;
  hiddenTracks.toggle(id, `spotify:track:${id}`);
  if (showingHidden && hiddenTracks.size === 0) showingHidden = false;

  // Salirse sola de la vista de ocultos SÍ cambia la vista entera (cambia el
  // conjunto que se muestra y el icono de todas las tarjetas), así que ahí se
  // repinta. En el caso normal —ocultar una pista— la lista se recalcula
  // conservando el scroll y lo que ya estaba pintado, y el toggle "Ocultos (N)"
  // aparece o se actualiza en el sitio. Antes, la PRIMERA vez que ocultabas
  // algo el botón nacía y eso disparaba un repintado completo: estando abajo
  // del todo, la lista te devolvía al principio.
  if (showingHidden !== wasShowingHidden) { renderResults(); return; }
  syncHiddenToggle();
  applyRows({ preserveRendered: true });
}

// Sincroniza el estado .playing de los botones con el player global.
// Listener único a nivel módulo: si la página no está montada, el query no matchea nada.
document.addEventListener('previewchange', (e) => {
  const content = document.getElementById('skips-content');
  if (!content) return;
  const key = e.detail.key || '';
  content.querySelectorAll('#skips-list .sc-card').forEach(card => {
    const btn = card.querySelector('.sc-play');
    if (btn) btn.classList.toggle('playing', key === `sk:${card.dataset.id}`);
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
        style="border-radius:8px;display:block"></iframe>
    `;
    slot.classList.add('open');
    btn.classList.add('playing');
  }
}
