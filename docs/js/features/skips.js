// Skips crónicos: likes que reproducís seguido pero casi siempre le das next.
// Cruce local: likes vs history-skip-stats.json.
//
// v2 del cruce — el pipeline dejó de decidir qué es un skip. Ahora emite el dato
// crudo (los ms_played de cada `fwdbtn` y de cada cierre completo, más un `gid`
// que agrupa los ids del mismo tema) y el veredicto se arma ACÁ, porque este es
// el único lado que tiene el `duration_ms` de la pista — viene de los likes. Sin
// eso no se puede saber qué porcentaje de la canción escuchaste antes del next,
// y bajarse a los 6 segundos contaba igual que bajarse en el minuto 8.
//
// Los tres mecanismos van con toggle (encendidos por defecto) para poder ver el
// efecto de cada uno sin regenerar nada:
//   1. Agrupar los ids del mismo tema antes de calcular el ratio.
//   2. Un `fwdbtn` con >=80 % de la pista deja de contar como skip.
//   3. Un cierre (endplay/logout/…) con >=80 % de la pista cuenta como ok.
// Preview 30s instantáneo vía iTunes (arranca en el estribillo, no suma plays
// en tu historial de Spotify). Fallback: iframe embed oficial si iTunes no lo tiene.

import { getBestAvailableLikes, removeLikedTracks, checkLibraryContains } from '../api.js?v=198';
import { borrarLikesVerificado } from '../util/borrado-verificado.js?v=198';
import { loadSkipStats, trackIdOf, isOwner, ownerLockedMessage } from './history-data.js?v=198';
import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js?v=198';
import { showToast } from '../ui/toast.js?v=198';
import { getPreview } from '../api/preview-providers.js?v=198';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=198';
import { openTrackCard } from './track-card.js?v=198';
import { firstArtistName, artistNames } from '../util/artist-name.js?v=198';
import { activateMarquee } from '../ui/marquee.js?v=198';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js?v=198';
import { createHiddenStore } from '../util/hidden-sync.js?v=198';
import { prefKey, migratePrefKey } from '../storage.js?v=198';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=198';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js?v=198';
import { createLazyImages } from '../ui/lazy-img.js?v=198';
import { renderTrackCardRow, wireTrackCardGrid, paintCardSelection, paintPlayingCard, paintEmbedCard } from '../ui/track-card-row.js?v=198';
import { coverAtSize } from '../util/cover-size.js?v=198';
import { coverUrl } from '../util/cover-size.js?v=198';

let cache = null;
// Filas visibles con los filtros actuales, en el mismo orden que las tarjetas
// del grid. Es la fuente de verdad de la vista: ordenar, filtrar y ocultar
// operan acá y pasan por list.setItems(), nunca sobre el DOM.
let currentRows = [];
// `window.__filasSkips` espeja `currentRows` en cada recálculo — mismo arnés de
// medición que `#zero-plays`, ver el comentario de aquel archivo.

let rowById = new Map();
// La selección vive en el módulo y no en los checkboxes del DOM: con append
// incremental las tarjetas del final no existen todavía, así que "Seleccionar
// todos" no podría marcarlas y el contador leería de menos.
let selectedIds = new Set();
// Ancla de shift+click: la última tarjeta que se tocó A MANO. El rango se
// resuelve sobre `currentRows` (dos índices), nunca sobre el DOM: con lista
// incremental las tarjetas del final todavía no existen.
let lastClickedId = null;
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
let useStatsfm = false;

// Los tres mecanismos de corrección. Encendidos por defecto (`!== '0'`): son
// los que sacan los falsos positivos que hacían que aparecieran temas que Ian
// escucha enteros. Apagándolos de a uno se ve el efecto de cada uno.
const FIX_TOGGLES = [
  {
    key: 'group',
    lsKey: 'skips_group_ids',
    label: 'Juntar versiones',
    title: 'El single, el del álbum y el remix son la misma canción: suma sus plays antes de calcular el ratio.',
  },
  {
    key: 'nearFull',
    lsKey: 'skips_nearfull_fwd',
    label: 'Next al final no es skip',
    title: 'Si ya habías escuchado el 80 % de la pista, ese next no cuenta como skip.',
  },
  {
    key: 'closeOk',
    lsKey: 'skips_close_ok',
    label: 'Cerrar cuenta como escucha',
    title: 'Escuchar el 80 % y cerrar Spotify o cambiar de dispositivo cuenta como escucha completa.',
  },
];
const fixes = Object.fromEntries(FIX_TOGGLES.map(t => [t.key, true]));
function recargarFixes() {
  for (const t of FIX_TOGGLES) {
    migratePrefKey(t.lsKey);
    fixes[t.key] = localStorage.getItem(prefKey(t.lsKey)) !== '0';
  }
}

// A partir de qué porcentaje de la pista una escucha se considera "casi entera".
const NEAR_FULL = 0.80;

const RATIO_STEPS = [70, 80, 90, 100];
const PLAYS_STEPS = [3, 5, 10, 15];

export async function render(container) {
  teardown();
  migratePrefKey(STATSFM_TOGGLE_KEY);
  useStatsfm = localStorage.getItem(prefKey(STATSFM_TOGGLE_KEY)) === '1';
  recargarFixes();
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
  lastClickedId = null;
  currentRows = [];
  rowById = new Map();
}

async function analyze() {
  // ── Vigencia de ruta (v=174) ────────────────────────────────────────────────
  //
  // Esta era la vista del crash «Cannot set properties of null (setting
  // 'onclick')» al zapear de ruta con los cachés fríos. Reproducido el 29/08 y
  // atribuido por la instrumentación de v=173: con el caché vacío,
  // `getBestAvailableLikes()` se baja ~9.500 me gusta (185 requests, minutos), y
  // al volver del await esto seguía adelante como si nada — repintaba, y
  // `renderResults()` re-consultaba `#skips-content`, que en la ruta nueva ya no
  // existe. Medido: el render de #skips seguía abierto **39 segundos** después
  // de haber salido de la vista.
  //
  // El detalle de por qué el `teardown` no alcanza está en
  // util/vigencia-ruta.js, junto al helper que usan las seis vistas.
  const ruta = vigilarRuta();
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
    if (!ruta.vigente()) return;   // te fuiste mientras bajaba los likes
    if (useStatsfm && hasUsername()) {
      top = await loadTopLifetime().catch(() => null);
      if (!ruta.vigente()) return;
    }
  } catch (e) {
    if (!ruta.vigente()) return;
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">Error: ${escapeHtml(e.message)}</p></div>`;
    return;
  }
  if (!stats || !stats.tracks) {
    const propio = await isOwner();
    if (!ruta.vigente()) return;
    content.innerHTML = propio
      ? `<div class="card"><p>No pude cargar el historial de skips. Vuelve a intentarlo.</p></div>`
      : ownerLockedMessage('Skips crónicos');
    return;
  }

  const rows = buildRows(likes, stats, top);
  rows.sort((a, b) => (b.ratio - a.ratio) || (b.total - a.total));
  cache = {
    rows,
    likesCount: likes.length,
    statsfmUsed: !!top,
    statsfmUpdated: rows.filter(r => r.updated).length,
  };
  renderResults();
}

// Arma las filas cruzando likes contra el historial crudo y aplicando los
// toggles. Una fila = una CANCIÓN, no un id: con «Juntar versiones» encendido un
// tema con tres ids likeados daba antes tres tarjetas idénticas (102 duplicadas
// sobre los datos de Ian).
function buildRows(likes, stats, top) {
  const grouping = fixes.group;

  // Acumulador por clave: el gid del tema si agrupamos, el propio id si no.
  // Con agrupado se recorre TODO el JSON, no solo los likes: las plays que
  // corrigen el ratio suelen estar en un id que ni siquiera tenés likeado
  // (el del álbum, el del remaster).
  const acc = new Map();
  const keyOfId = new Map();
  for (const id in stats.tracks) {
    const [ok, skip, fwd, close, gid] = stats.tracks[id];
    const key = grouping && gid !== undefined ? `g${gid}` : id;
    keyOfId.set(id, key);
    let a = acc.get(key);
    if (!a) { a = { ok: 0, skip: 0, fwd: [], close: [] }; acc.set(key, a); }
    a.ok += ok;
    a.skip += skip;
    if (fwd?.length) a.fwd.push(...fwd);
    if (close?.length) a.close.push(...close);
  }

  // Duración de la pista por clave. Solo la saben los likes, y un grupo puede
  // tener varios ids likeados: nos quedamos con la primera que aparezca (las
  // versiones del mismo tema duran prácticamente lo mismo).
  const durOf = new Map();
  // Todos los ids likeados de cada clave: al sacar de likes hay que sacarlos
  // TODOS, o el tema vuelve a aparecer con los mismos números por la versión
  // que quedó likeada.
  const idsOf = new Map();
  const trackById = new Map();
  for (const it of likes) {
    const t = it.track || it;
    const id = trackIdOf(t.uri || (t.id ? `spotify:track:${t.id}` : null));
    if (!id) continue;
    trackById.set(id, t);
    const key = keyOfId.get(id);
    if (key === undefined) continue;
    if (!idsOf.has(key)) idsOf.set(key, []);
    idsOf.get(key).push(id);
    if (t.duration_ms && !durOf.has(key)) durOf.set(key, t.duration_ms);
  }

  const rows = [];
  const seen = new Set();
  for (const it of likes) {
    const t = it.track || it;
    const uri = t.uri || (t.id ? `spotify:track:${t.id}` : null);
    const id = trackIdOf(uri);
    if (!id) continue;
    const key = keyOfId.get(id);
    if (key === undefined || seen.has(key)) continue;
    const a = acc.get(key);
    if (!a) continue;

    // El id que representa al tema: el que más plays tiene, y a igualdad el
    // menor alfabéticamente. Tiene que ser estable — es la clave con la que se
    // guarda "ocultar", y no puede depender del orden en que vengan los likes.
    const ids = idsOf.get(key) || [id];
    const repId = ids.length === 1 ? ids[0] : [...ids].sort((x, y) => {
      const [ax, sx] = stats.tracks[x] || [0, 0];
      const [ay, sy] = stats.tracks[y] || [0, 0];
      return (ay + sy) - (ax + sx) || (x < y ? -1 : 1);
    })[0];
    const repTrack = trackById.get(repId) || t;

    const dur = durOf.get(key);
    // Mecanismo 2: el next después de escuchar casi toda la pista no es un skip.
    let skip = (fixes.nearFull && dur) ? a.fwd.filter(ms => ms / dur < NEAR_FULL).length : a.skip;
    // Mecanismo 3: cerrar Spotify con la pista casi terminada es una escucha.
    let ok = (fixes.closeOk && dur) ? a.ok + a.close.filter(ms => ms / dur >= NEAR_FULL).length : a.ok;

    let total = ok + skip;
    let updated = false;
    if (top) {
      const hit = top.map.get(repId);
      if (hit && hit.streams > total) {
        // Plays nuevas desde el export → asumo que fueron completas (si no volviste
        // a skipearlas). skip queda igual, ok sube, total y ratio se recalculan.
        ok += (hit.streams - total);
        total = ok + skip;
        updated = true;
      }
    }
    seen.add(key);
    if (total === 0 || skip === 0) continue;
    rows.push({
      track: repTrack, uri: `spotify:track:${repId}`, id: repId, ids,
      ok, skip, total, ratio: Math.round((skip / total) * 100), updated,
      versions: ids.length,
    });
  }
  return rows;
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
  window.__filasSkips = currentRows;
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
  const hideBtn = content.querySelector('#sk-toggle-hidden');
  if (hideBtn && !showingHidden) hideBtn.textContent = `Ocultos (${hiddenTracks.size})`;
  updateRemoveBtn();
}

// Selección de una tarjeta. Con shift marca el RANGO desde la última tocada a
// mano, igual que en `#sin-clasificar`.
function toggleSeleccion(id, range) {
  if (!rowById.has(id)) return;
  const grid = document.querySelector('#skips-list');
  if (range && lastClickedId && lastClickedId !== id) {
    const desde = currentRows.findIndex(r => r.id === lastClickedId);
    const hasta = currentRows.findIndex(r => r.id === id);
    if (desde >= 0 && hasta >= 0) {
      const [a, b] = desde < hasta ? [desde, hasta] : [hasta, desde];
      for (let i = a; i <= b; i++) selectedIds.add(currentRows[i].id);
      lastClickedId = id;
      // Solo repinta lo que existe: las tarjetas de los lotes que falten nacen
      // ya marcadas, porque renderRow lee del Set.
      grid?.querySelectorAll('.sc-card').forEach(card => {
        paintCardSelection(card, selectedIds.has(card.dataset.id));
      });
      updateRemoveBtn();
      return;
    }
  }
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  lastClickedId = id;
  paintCardSelection(grid?.querySelector(`.sc-card[data-id="${CSS.escape(id)}"]`), selectedIds.has(id));
  updateRemoveBtn();
}

// La barra cuenta SIEMPRE del Set, no de las tarjetas pintadas. Y dice «N de M»
// cuando la selección es parcial: sin eso, cambiar de filtro con cosas marcadas
// dejaba «1.155 candidatos» arriba y «(102)» abajo, y parecía que «Seleccionar
// todos» había marcado 102 de 1.155. Reproducido el 2026-08-18: marcar todo con
// el chip «100 %» (102 filas) y volver a «≥70 %» (1.155 filas) da exactamente
// esa pantalla. El botón no marcaba de menos; lo que faltaba era decir el
// estado.
function updateRemoveBtn() {
  const rmBtn = document.querySelector('#sk-remove');
  const n = selectedIds.size;
  const total = currentRows.length;
  const selAll = document.querySelector('#sk-select-all');
  if (selAll) {
    const todas = total > 0 && n >= total;
    selAll.textContent = todas
      ? 'Deseleccionar todas'
      : (n > 0 ? `Seleccionar las ${total.toLocaleString('es-ES')}` : 'Seleccionar todas');
    selAll.disabled = total === 0;
  }
  if (!rmBtn) return;
  const parcial = n > 0 && n < total;
  rmBtn.textContent = parcial
    ? `Sacar de likes (${n.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')})`
    : `Sacar de likes (${n.toLocaleString('es-ES')})`;
  rmBtn.disabled = n === 0;
}

function renderResults() {
  const t0 = performance.now();
  window.__skipsPerf = { batches: [] };
  const content = document.getElementById('skips-content');
  // Cinturón y tirantes: `analyze()` ya comprueba la vigencia de la ruta, pero
  // a `renderResults()` la llaman ocho sitios (chips, toggles, ocultar, sacar
  // de likes) y basta con que uno llegue tarde para volver al mismo crash.
  // Sin contenedor no hay nada que pintar, y seguir es escribir sobre null.
  if (!content) return;
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
  const rows = filtered();
  currentRows = rows;
  rowById = new Map(rows.map(r => [r.id, r]));
  window.__filasSkips = currentRows;
  for (const id of [...selectedIds]) if (!rowById.has(id)) selectedIds.delete(id);
  const withAnySkip = cache.rows.length;
  const hiddenCount = hiddenTracks.size;

  const sfLabel = cache.statsfmUsed
    ? `Cruzando con Stats.fm — ${cache.statsfmUpdated.toLocaleString('es-ES')} ajustados con plays post-export`
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
        <div class="skips-chip-group" id="skips-fix-chips" title="Correcciones sobre qué cuenta como skip">
          ${FIX_TOGGLES.map(t => `
            <button type="button" class="skips-chip skips-chip-toggle ${fixes[t.key] ? 'active' : ''}" data-fix="${t.key}" title="${escapeHtml(t.title)}" aria-pressed="${fixes[t.key]}">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="skips-chip-check" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
              <span>${escapeHtml(t.label)}</span>
            </button>
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
          <button class="btn btn-secondary btn-sm" id="sk-select-all" ${rows.length === 0 ? 'disabled' : ''}>Seleccionar todas</button>
          <button class="btn btn-danger btn-sm" id="sk-remove" disabled>Sacar de likes (0)</button>
        </div>
      </div>
    </div>

    ${rows.length === 0 ? `
      <div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">${showingHidden ? 'No hay tracks ocultos que cumplan los umbrales actuales.' : 'Ningún like cumple los umbrales. Descarga los filtros para ver más candidatos.'}</p></div>
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
  const versiones = r.versions > 1 ? ` · juntando ${r.versions} versiones likeadas` : '';
  const badgeTitle = r.updated
    ? `Ratio actualizado con Stats.fm (${r.skip} skips de ${r.total} plays totales hoy)${versiones}`
    : `Skipeaste ${r.skip} de ${r.total} veces${versiones}`;
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

function wireFilters() {
  const content = document.getElementById('skips-content');
  content.querySelectorAll('#skips-plays-chips .skips-chip').forEach(btn => {
    btn.onclick = () => { minPlays = parseInt(btn.dataset.plays); renderResults(); };
  });
  content.querySelectorAll('#skips-ratio-chips .skips-chip').forEach(btn => {
    btn.onclick = () => { minRatio = parseInt(btn.dataset.ratio); renderResults(); };
  });
  // Los tres mecanismos: cambian el DATO, no el filtro, así que hay que
  // recalcular las filas (analyze) y no solo repintar. Los likes y el JSON ya
  // están memorizados, así que no cuesta red.
  content.querySelectorAll('#skips-fix-chips .skips-chip').forEach(btn => {
    btn.onclick = async () => {
      const k = btn.dataset.fix;
      fixes[k] = !fixes[k];
      localStorage.setItem(prefKey(FIX_TOGGLES.find(t => t.key === k).lsKey), fixes[k] ? '1' : '0');
      content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Recalculando…</div></div>`;
      await analyze();
    };
  });

  const sfToggle = content.querySelector('#skips-statsfm-toggle');
  if (sfToggle) sfToggle.onclick = async () => {
    useStatsfm = !useStatsfm;
    localStorage.setItem(prefKey(STATSFM_TOGGLE_KEY), useStatsfm ? '1' : '0');
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
    // El ancla de shift+click no sobrevive a un select-all: el próximo rango se
    // mide desde la siguiente tarjeta que se toque a mano.
    lastClickedId = null;
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
    // La tarjeta compartida manda `{ range: e.shiftKey }` desde v=140; esta
    // vista lo estaba IGNORANDO, así que shift+click marcaba de a una. El
    // `user-select: none` de `.sc-card` ya estaba puesto, que era la otra mitad
    // del asunto (sin él, shift+click arrastra la selección de texto).
    onToggle: (id, { range = false } = {}) => toggleSeleccion(id, range),
    onPlay: (r, card) => onPlayClick(r, card.querySelector('.sc-play')),
    onCard: (r) => {
      const imgs = r.track.album?.images || [];
      openTrackCard({
        id: r.id,
        name: r.track.name,
        artists: artistNames(r.track),
        album: r.track.album?.name,
        img: coverUrl(imgs, 'grande'),
      });
    },
    onHide: (r) => onHideClick(r.id),
  });

  wireHiddenToggle();

  rmBtn.onclick = async () => {
    const sel = currentRows.filter(r => selectedIds.has(r.id));
    // Todas las versiones likeadas del tema, no solo la que se ve: si dejamos
    // likeado el id del álbum, el tema vuelve a la lista con los mismos números.
    const ids = [...new Set(sel.flatMap(r => r.ids || [r.id]))];
    if (!ids.length) return;
    const extra = ids.length > sel.length
      ? ` (son <strong>${ids.length}</strong> versiones entre single, álbum y remixes)`
      : '';
    const ok = await confirmModal(
      'Sacar de tus Liked Songs',
      `Vas a sacar <strong>${sel.length}</strong> ${sel.length === 1 ? 'canción' : 'canciones'} de tus Liked Songs${extra}. Son las que casi siempre saltas — puedes recuperarlas después si te arrepientes.`,
      'Sacar'
    );
    if (!ok) return;
    rmBtn.disabled = true;
    rmBtn.textContent = 'Sacando…';
    try {
      // Borra Y verifica. Si tira, no sale el toast verde ni se re-analiza:
      // cae en el catch de abajo con el mensaje concreto.
      await borrarLikesVerificado(ids, {
        origen: '#skips',
        removeLikedTracks,
        checkLibraryContains,
        // Acá la guarda del último ejemplar no sólo no aplica: sería
        // exactamente lo contrario de lo que hace la vista. `ids` se expande a
        // TODAS las versiones likeadas del tema (single, álbum, remixes) justo
        // para que no quede ninguna — si dejamos una viva, el tema reaparece en
        // la lista con los mismos números. Quedarse en cero copias ES la
        // función. La guarda abortaría el 100% de los borrados legítimos.
        guarda: 'ninguna',
        motivoSinGuarda: 'la vista expande a propósito a todas las versiones del tema para que no quede ninguna viva; la guarda del último ejemplar abortaría siempre',
      });
      showToast(`Sacaste ${sel.length} ${sel.length === 1 ? 'canción' : 'canciones'} de tus likes`, 'success');
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

// Sincroniza los botones con el player global: cuál es el preview actual y si
// está SONANDO (▶ ↔ ⏸). El evento lo dispara `ui/preview-player.js` desde los
// eventos del <audio>, así que acá no hay ni flag ni timer que puedan quedarse
// desfasados del sonido.
// Listener único a nivel módulo: si la página no está montada, el query no matchea nada.
document.addEventListener('previewchange', (e) => {
  paintPlayingCard(document.getElementById('skips-list'), 'sk', e.detail);
});

// Cierra los embeds abiertos Y apaga el botón de su tarjeta. Antes el botón se
// apagaba solo en el camino de "volver a tocar el mismo": abrir el embed de
// otra fila dejaba la anterior tintada.
function closeEmbeds(content) {
  content.querySelectorAll('.skips-preview-slot.open').forEach(s => {
    s.classList.remove('open');
    s.innerHTML = '';
    paintEmbedCard(s.closest('.sc-card')?.querySelector('.sc-play'), false);
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
    // Tintado pero con el ▶: el iframe de Spotify no nos dice si está sonando,
    // así que un ⏸ acá sería una promesa que no podemos cumplir.
    paintEmbedCard(btn, true);
  }
}
