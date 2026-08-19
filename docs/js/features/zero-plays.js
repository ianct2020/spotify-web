// Likes con 0 plays: tracks likeados que nunca escuchaste según el Extended Streaming History.
// Cruce local: likes vs history-track-plays.json (índice de plays por track id).
//
// v=143: la lista pasó de filas de texto a la tarjeta compartida
// `ui/track-card-row.js` — las mismas dos columnas, la misma tapa de 96 y el
// mismo ▶ de preview que #sin-clasificar y #skips —, con lista incremental y
// carga diferida de tapas porque acá hay miles de filas.

import { getBestAvailableLikes, removeLikedTracks } from '../api.js?v=148';
import { loadTrackPlays, trackIdOf, isOwner, ownerLockedMessage } from './history-data.js?v=148';
import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js?v=148';
import { showToast } from '../ui/toast.js?v=148';
import { openTrackCard } from './track-card.js?v=148';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js?v=148';
import { getPreview } from '../api/preview-providers.js?v=148';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=148';
import { renderTrackCardRow, wireTrackCardGrid, paintCardSelection } from '../ui/track-card-row.js?v=148';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js?v=148';
import { createLazyImages } from '../ui/lazy-img.js?v=148';
import { activateMarquee } from '../ui/marquee.js?v=148';
import { coverAtSize } from '../util/cover-size.js?v=148';
import { firstArtistName } from '../util/artist-name.js?v=148';

let cache = null;

const STATSFM_TOGGLE_KEY = 'zeroplays_use_statsfm';
let useStatsfm = localStorage.getItem(STATSFM_TOGGLE_KEY) === '1';

// Mismo tamaño de lote que #sin-clasificar y #skips: llena el primer viewport
// con colchón de sobra.
const BATCH = 80;

// Estado de la lista pintada. Vive en el módulo, no en el DOM: con append
// incremental, «Seleccionar todos» mirando checkboxes marcaría 80 de 3.000.
let selected = new Set();
let lastClickedId = null;
let rowById = new Map();
let list = null;
let lazyCovers = null;

export async function render(container) {
  teardown();
  container.innerHTML = `
    ${pageHeader({ title: 'Sin plays' })}
    <div id="zeroplays-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cruzando likes con historial…</div></div></div>
  `;
  await analyze();
  // El router lo llama al salir: sin esto quedarían vivos los dos
  // IntersectionObserver (centinela de la lista y tapas) sobre nodos ya
  // desconectados del documento.
  return teardown;
}

function teardown() {
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
  selected.clear();
  lastClickedId = null;
  rowById = new Map();
}

// La tapa se pinta a 96px, así que hace falta la de 300×300; el caché de likes
// guarda las chicas (slimTrack en api.js), y si la de 300 no está se deduce del
// prefijo del CDN con la chica de respaldo en el onerror. Igual que en
// #sin-clasificar.
function chicaCover(imgs) {
  return imgs.length ? (imgs[imgs.length - 1].url || null) : null;
}
function medianaCover(imgs) {
  const chica = chicaCover(imgs);
  const media = imgs.find(im => (im.width || 0) >= 240 && (im.width || 0) <= 400)
    || imgs.find(im => (im.width || 0) >= 240);
  return media?.url || (chica ? coverAtSize(chica, 300) : null);
}

function fechaLike(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
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
      zeros.push(fila(t, uri, id, it.added_at || null, null));
    } else if (p[2] === 'p') {
      if (top && top.map.has(id)) { statsfmRescued++; continue; }
      zeros.push(fila(t, uri, id, it.added_at || null, { p: p[0], s: p[1] }));
      partialsInZeros++;
    } else {
      some.push({ track: t, uri, id, plays: p[0], seconds: p[1] });
    }
  }
  // Los likes vienen de /me/tracks ordenados por fecha descendente, así que sin
  // tocar nada arriba quedaban las recién añadidas. Ian escucha offline: un like
  // de ayer figura "sin plays" solo porque todavía no sincronizó. Las viejas
  // primero, que son las que de verdad nunca sonaron.
  zeros.sort((a, b) => {
    const ta = a.addedAt ? Date.parse(a.addedAt) : NaN;
    const tb = b.addedAt ? Date.parse(b.addedAt) : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;   // sin fecha, al final
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });

  cache = { zeros, some, likesCount: likes.length, partialsInZeros, statsfmUsed: !!top, statsfmRescued };
  console.log(`[zeroplays] ${zeros.length} tarjetas (${partialsInZeros} con plays cortas) de ${likes.length} likes`);
  renderResults();
}

// La fila que consume la tarjeta compartida. `artists` va como string porque es
// lo que pide renderTrackCardRow; `artist` suelto queda para la ficha.
function fila(t, uri, id, addedAt, partial) {
  const imgs = t.album?.images || [];
  const nombres = (t.artists || []).map(firstArtistName).filter(Boolean);
  return {
    id,
    trackId: id,
    uri,
    name: t.name || '(sin nombre)',
    artists: nombres.join(', '),
    artist: nombres[0] || '',
    artistList: nombres,
    album: t.album?.name || '',
    cover: medianaCover(imgs),
    coverSmall: chicaCover(imgs),
    addedAt,
    partial,
  };
}

function renderResults() {
  const content = document.getElementById('zeroplays-content');
  if (!content || !cache) return;
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }

  const { zeros, some, likesCount, partialsInZeros, statsfmUsed, statsfmRescued } = cache;
  const nunca = zeros.length - (partialsInZeros || 0);
  rowById = new Map(zeros.map(r => [r.id, r]));
  // Una fila que ya no existe (porque la sacaste de likes) no puede seguir
  // contando como seleccionada.
  if (selected.size) {
    for (const id of [...selected]) if (!rowById.has(id)) selected.delete(id);
  }

  const sfLine = statsfmUsed
    ? `<div style="font-size:12px;color:var(--color-accent);margin-top:2px">Cruzando con Stats.fm — sacados ${statsfmRescued.toLocaleString('es-ES')} temas que sí escuchaste después del export.</div>`
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
          <strong>${zeros.length.toLocaleString('es-ES')}</strong> likes sin plays ≥30s de ${likesCount.toLocaleString('es-ES')} totales
        </div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">
          ${nunca.toLocaleString('es-ES')} nunca sonaron${partialsInZeros ? ` · ${partialsInZeros.toLocaleString('es-ES')} tuvieron plays cortas (badge naranja)` : ''} · ${some.length.toLocaleString('es-ES')} tienen alguna play ≥30s.
        </div>
        ${sfLine}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="zp-select-all" ${zeros.length === 0 ? 'disabled' : ''} title="Marca las ${zeros.length.toLocaleString('es-ES')} de la lista, no solo las pintadas">Seleccionar todos</button>
      </div>
    </div>
    ${sfToggleHtml}

    ${zeros.length === 0 ? `
      <div class="card"><p>No hay likes sin plays. Todos tus likes se escucharon al menos una vez ≥30s.</p></div>
    ` : `
      <div class="sc-grid" id="zp-list" role="listbox" aria-multiselectable="true" aria-label="Likes sin plays"></div>
    `}
    <div class="sc-actionbar" id="zp-actionbar" style="display:none">
      <span id="zp-sel-count">0 seleccionadas</span>
      <button class="btn btn-danger btn-sm" id="zp-remove">Sacar de likes</button>
      <button class="btn btn-secondary btn-sm" id="zp-sel-clear">Limpiar selección</button>
    </div>
  `;

  const sfToggle = content.querySelector('#zp-statsfm-toggle');
  if (sfToggle) sfToggle.onchange = async () => {
    useStatsfm = sfToggle.checked;
    localStorage.setItem(STATSFM_TOGGLE_KEY, useStatsfm ? '1' : '0');
    teardown();
    content.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">${useStatsfm ? 'Cruzando con Stats.fm…' : 'Recalculando…'}</div></div>`;
    await analyze();
  };

  const grid = content.querySelector('#zp-list');
  if (grid) {
    // El root del observer es el ancestro que scrollea DE VERDAD. Acá el grid no
    // tiene overflow propio (scrollea el documento), así que scrollRootOf
    // devuelve null y el root es el viewport — pero se calcula, no se asume.
    const scroller = scrollRootOf(grid);
    lazyCovers = createLazyImages({ root: scroller, rootMargin: '200px' });
    list = createIncrementalList({
      container: grid,
      items: zeros,
      renderItem: renderCard,
      batchSize: BATCH,
      rootMargin: '600px',
      onBatch: () => {
        const nuevas = grid.querySelectorAll('.sc-card:not([data-mq])');
        nuevas.forEach(c => c.setAttribute('data-mq', '1'));
        lazyCovers?.observe(nuevas);
        activateMarquee(nuevas);
      },
    });

    // Handlers DELEGADOS: las tarjetas de los lotes siguientes todavía no
    // existen cuando se cablea la vista.
    wireTrackCardGrid(grid, {
      rowById: (id) => rowById.get(id),
      onToggle: (id, o) => toggleSelection(id, o),
      onPlay: (r) => onPlayClick(r),
      onCard: (r) => openTrackCard({ id: r.trackId, name: r.name, artist: r.artist, album: r.album, img: r.coverSmall || r.cover }),
      onUnlike: (r) => sacarDeLikes([r]),
    });
  }

  const selAll = content.querySelector('#zp-select-all');
  if (selAll) selAll.onclick = () => {
    const todas = zeros.length > 0 && zeros.every(r => selected.has(r.id));
    selected = todas ? new Set() : new Set(zeros.map(r => r.id));
    repaintSelection();
    updateSelectionUi();
  };
  const selClear = content.querySelector('#zp-sel-clear');
  if (selClear) selClear.onclick = () => {
    selected.clear();
    lastClickedId = null;
    repaintSelection();
    updateSelectionUi();
  };
  const rm = content.querySelector('#zp-remove');
  if (rm) rm.onclick = () => {
    const filas = cache.zeros.filter(r => selected.has(r.id));
    if (filas.length) sacarDeLikes(filas);
  };

  updateSelectionUi();
}

function renderCard(r) {
  // El badge de "plays cortas" es el mismo dato de antes, ahora en el slot que
  // la tarjeta reserva delante de los botones.
  const badge = r.partial
    ? `<span class="zp-partial" title="Escuchada al menos una vez menos de 30s (por eso no cuenta como play)">${r.partial.p} play${r.partial.p === 1 ? ' corta' : 's cortas'}</span>`
    : '';
  return renderTrackCardRow(
    { ...r, sub: `${r.album || ''}${r.addedAt ? ` · añadida el ${fechaLike(r.addedAt)}` : ''}` },
    {
      selected: selected.has(r.id),
      playing: playingKey() === `zp:${r.id}`,
      showUnlike: true,
      // Acá no hay lista de ocultos: la vista es "lo que no escuchaste" y la
      // salida es sacarlo de likes o dejarlo. Un ojo sin handler sería un botón
      // muerto.
      showHide: false,
      badge,
    },
  );
}

// ── Selección ────────────────────────────────────────────────────────────────

function toggleSelection(id, { range = false } = {}) {
  const r = rowById.get(id);
  if (!r) return;
  const filas = cache?.zeros || [];
  if (range && lastClickedId && lastClickedId !== id) {
    const desde = filas.findIndex(x => x.id === lastClickedId);
    const hasta = filas.findIndex(x => x.id === id);
    if (desde >= 0 && hasta >= 0) {
      const [a, b] = desde < hasta ? [desde, hasta] : [hasta, desde];
      for (let i = a; i <= b; i++) selected.add(filas[i].id);
      lastClickedId = id;
      repaintSelection();
      updateSelectionUi();
      return;
    }
  }
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  lastClickedId = id;
  paintCardSelection(document.querySelector(`#zp-list .sc-card[data-id="${CSS.escape(id)}"]`), selected.has(id));
  updateSelectionUi();
}

// Solo repinta lo que existe: las tarjetas de los lotes que falten nacen ya
// marcadas, porque renderCard lee del Set.
function repaintSelection() {
  document.querySelectorAll('#zp-list .sc-card').forEach(card => {
    paintCardSelection(card, selected.has(card.dataset.id));
  });
}

function updateSelectionUi() {
  const n = selected.size;
  const bar = document.getElementById('zp-actionbar');
  if (bar) bar.style.display = n > 0 ? '' : 'none';
  const count = document.getElementById('zp-sel-count');
  if (count) count.textContent = `${n} seleccionada${n === 1 ? '' : 's'}`;
  const rm = document.getElementById('zp-remove');
  if (rm) rm.textContent = `Sacar de likes (${n})`;
  const selAll = document.getElementById('zp-select-all');
  if (selAll && cache) {
    const todas = cache.zeros.length > 0 && n >= cache.zeros.length && cache.zeros.every(r => selected.has(r.id));
    selAll.textContent = todas ? 'Quitar selección' : 'Seleccionar todos';
  }
}

// ── Preview ──────────────────────────────────────────────────────────────────

async function onPlayClick(r) {
  const res = await togglePreview(`zp:${r.id}`, () => getPreview({
    name: r.name,
    artists: r.artistList,
    artist: r.artist,
    spotifyId: r.trackId || undefined,
  }));
  if (res === null) showToast(`Sin preview disponible de «${r.name}»`, 'info');
}

document.addEventListener('previewchange', (e) => {
  const content = document.getElementById('zeroplays-content');
  if (!content) return;
  const key = e.detail.key || '';
  content.querySelectorAll('.sc-card').forEach(card => {
    const btn = card.querySelector('.sc-play');
    if (btn) btn.classList.toggle('playing', key === `zp:${card.dataset.id}`);
  });
});

// ── Sacar de likes ───────────────────────────────────────────────────────────
//
// Mismo trato que en #sin-clasificar: confirmación siempre, y el caché de likes
// se actualiza en memoria (removeLikedTracks → removeFromLikesCache) en vez de
// forzar una re-descarga, que dejaría la app sin likes durante minutos por la
// regla de "o completo o no existe".
async function sacarDeLikes(rows) {
  const ids = rows.map(r => r.trackId).filter(Boolean);
  if (!ids.length) return;
  const n = ids.length;
  const detalle = n === 1
    ? `«${escapeHtml(rows[0].name)}» — ${escapeHtml(rows[0].artists)}`
    : `${n} canciones`;
  const ok = await confirmModal(
    'Sacar de tus me gusta',
    `Vas a sacar <strong>${detalle}</strong> de tus me gusta en Spotify. Esto BORRA el like: para recuperarlo hay que volver a darle al corazón a mano.`,
    n === 1 ? 'Sacar de likes' : `Sacar las ${n}`,
  );
  if (!ok) return;

  try {
    await removeLikedTracks(ids);
  } catch (e) {
    showToast('No se pudieron sacar de likes: ' + e.message, 'error');
    return;
  }
  showToast(n === 1
    ? `«${rows[0].name}» ya no está en tus me gusta`
    : `${n} canciones fuera de tus me gusta`, 'success');

  const fuera = new Set(ids);
  cache.zeros = cache.zeros.filter(r => !fuera.has(r.id));
  cache.likesCount = Math.max(0, cache.likesCount - n);
  for (const id of fuera) selected.delete(id);
  lastClickedId = null;
  rowById = new Map(cache.zeros.map(r => [r.id, r]));
  // setItems conserva el scroll y lo ya pintado: sacar la tarjeta 900 no puede
  // devolver al usuario al principio de la lista.
  lazyCovers?.reset();
  list?.setItems(cache.zeros, { preserveRendered: true });
  actualizarResumen();
  updateSelectionUi();
}

// El número grande, sin repintar la vista entera.
function actualizarResumen() {
  const content = document.getElementById('zeroplays-content');
  if (!content || !cache) return;
  const strong = content.querySelector('.card strong');
  if (strong) strong.textContent = cache.zeros.length.toLocaleString('es-ES');
}
