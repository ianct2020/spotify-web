// Likes con 0 plays: tracks likeados que nunca escuchaste según el Extended Streaming History.
// Cruce local: likes vs history-track-plays.json (índice de plays por track id).
//
// v=143: la lista pasó de filas de texto a la tarjeta compartida
// `ui/track-card-row.js` — las mismas dos columnas, la misma tapa de 96 y el
// mismo ▶ de preview que #sin-clasificar y #skips —, con lista incremental y
// carga diferida de tapas porque acá hay miles de filas.
//
// v=149: la vista deja de tener una sola salida destructiva. Hasta ahora lo
// único que se podía hacer con una fila mal listada era «sacar de likes», que
// borra el like en Spotify y no se puede deshacer; ahora también se puede
// OCULTAR, que no toca nada de Spotify salvo la playlist interna donde se
// guardan los ocultos. Es el mismo mecanismo que en #skips y #sin-clasificar:
// `util/hidden-sync.js`, playlist como fuente de verdad y localStorage como
// caché local para pintar al instante.

import { getBestAvailableLikes, removeLikedTracks } from '../api.js?v=164';
import { loadTrackPlays, trackIdOf, isOwner, ownerLockedMessage } from './history-data.js?v=164';
import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js?v=164';
import { showToast } from '../ui/toast.js?v=164';
import { openTrackCard } from './track-card.js?v=164';
import { hasUsername, loadTopLifetime } from '../api/statsfm.js?v=164';
import { getPreview } from '../api/preview-providers.js?v=164';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=164';
import { renderTrackCardRow, wireTrackCardGrid, paintCardSelection, paintPlayingCard } from '../ui/track-card-row.js?v=164';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js?v=164';
import { createLazyImages } from '../ui/lazy-img.js?v=164';
import { activateMarquee } from '../ui/marquee.js?v=164';
import { coverAtSize } from '../util/cover-size.js?v=164';
import { firstArtistName } from '../util/artist-name.js?v=164';
import { createHiddenStore } from '../util/hidden-sync.js?v=164';
import { fmtDiaCorto } from '../util/fecha.js?v=164';

let cache = null;

// Los ocultos viven en una playlist de Spotify, así que sobreviven a borrar el
// caché del navegador y aparecen igual desde la otra compu. Es una playlist
// PROPIA de esta vista: ocultar algo acá no tiene por qué ocultarlo en #skips
// (allá el criterio es "lo skipeo", acá es "no lo escuché").
//
// ⚠️ Nace pública: `POST /me/playlists` ignora `public:false` post-migración.
// Hay que pasarla a privada a mano desde la app de Spotify, como las otras.
const hiddenTracks = createHiddenStore({
  lsKey: 'zeroplays_hidden_tracks',
  playlistName: 'fonoteca · ocultos (sin plays)',
  label: 'sin plays',
  keyOfTrack: (t) => t?.id || null,
});
let showingHidden = false;

const STATSFM_TOGGLE_KEY = 'zeroplays_use_statsfm';
let useStatsfm = localStorage.getItem(STATSFM_TOGGLE_KEY) === '1';

// Mismo tamaño de lote que #sin-clasificar y #skips: llena el primer viewport
// con colchón de sobra.
const BATCH = 80;

// Estado de la lista pintada. Vive en el módulo, no en el DOM: con append
// incremental, «Seleccionar todos» mirando checkboxes marcaría 80 de 3.000.
let selected = new Set();
let lastClickedId = null;
// Filas VISIBLES con el estado actual del toggle de ocultos, en el mismo orden
// que las tarjetas. Es la fuente de verdad de la lista: el rango de shift+click
// y «Seleccionar todos» operan acá, nunca sobre `cache.zeros` entero (si no,
// «Seleccionar todos» marcaría también lo que está oculto).
let currentRows = [];
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
  currentRows = [];
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

async function analyze() {
  const content = document.getElementById('zeroplays-content');
  let likes, plays, top = null;
  try {
    [{ items: likes }, plays] = await Promise.all([
      getBestAvailableLikes(),
      loadTrackPlays(),
      // Trae los ocultos de la playlist de Spotify. No bloquea: si falla o
      // tarda, la vista arranca con el caché local y se repinta al llegar.
      hiddenTracks.ready().then(refreshAfterHiddenSync),
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

// El desglose de debajo del número grande. Concuerda en número: con una sola
// fila decía «1 nunca sonaron».
function desgloseTexto(nunca, parciales, conPlays) {
  const partes = [`${nunca.toLocaleString('es-ES')} ${nunca === 1 ? 'nunca sonó' : 'nunca sonaron'}`];
  if (parciales) {
    partes.push(`${parciales.toLocaleString('es-ES')} ${parciales === 1 ? 'tuvo plays cortas' : 'tuvieron plays cortas'} (badge naranja)`);
  }
  partes.push(`${conPlays.toLocaleString('es-ES')} ${conPlays === 1 ? 'tiene' : 'tienen'} alguna play ≥30s.`);
  return partes.join(' · ');
}

// Las filas que se ven ahora: las normales, o solo las ocultas si el toggle
// está puesto.
function visibles() {
  if (!cache) return [];
  return cache.zeros.filter(r => (showingHidden ? hiddenTracks.has(r.id) : !hiddenTracks.has(r.id)));
}

// Recalcula las filas visibles y las publica en la lista incremental. Nunca se
// toca el DOM de las tarjetas a mano.
//
// `preserveRendered` es obligatorio en el camino de ocultar: sin él, ocultar la
// tarjeta 900 devuelve el scroll al principio de la lista. Es exactamente lo
// que se arregló en #skips en v=140.
function applyRows({ preserveRendered = false } = {}) {
  currentRows = visibles();
  rowById = new Map(currentRows.map(r => [r.id, r]));
  for (const id of [...selected]) if (!rowById.has(id)) selected.delete(id);
  if (list) {
    // setItems repinta el grid: los <img> viejos dejan de existir y el observer
    // de tapas tiene que soltarlos antes de que lleguen los nuevos.
    lazyCovers?.reset();
    list.setItems(currentRows, { preserveRendered });
  }
  actualizarResumen();
  updateSelectionUi();
}

// Los ocultos llegan de la playlist unos segundos después de pintar. Si a esa
// altura ya hay lista, se repinta conservando el scroll: repintar entero
// devolvería al usuario al principio a los pocos segundos de entrar.
function refreshAfterHiddenSync() {
  if (!cache) return;
  if (!list) { renderResults(); return; }
  syncHiddenToggle();
  applyRows({ preserveRendered: true });
}

// El toggle «Ocultos (N)» solo existe si hay algo oculto (o si los estás
// mirando). Vive aparte porque aparecer y desaparecer NO puede costar un
// repintado de la vista: era eso lo que devolvía el scroll al principio la
// primera vez que ocultabas algo estando abajo del todo.
function hiddenToggleHtml(n) {
  if (!(n > 0 || showingHidden)) return '';
  return `<button class="btn btn-secondary btn-sm ${showingHidden ? 'sort-active' : ''}" id="zp-toggle-hidden" title="${showingHidden ? 'Volver a la vista normal' : 'Ver solo los que ocultaste'}">${showingHidden ? '← Volver' : 'Ocultos (' + n + ')'}</button>`;
}

function syncHiddenToggle() {
  const actions = document.getElementById('zp-actions');
  if (!actions) return;
  const actual = actions.querySelector('#zp-toggle-hidden');
  const html = hiddenToggleHtml(hiddenTracks.size);
  if (!html) { actual?.remove(); return; }
  if (actual) actual.outerHTML = html;
  else actions.insertAdjacentHTML('afterbegin', html);
  wireHiddenToggle();
}

function wireHiddenToggle() {
  const btn = document.getElementById('zp-toggle-hidden');
  if (btn) btn.onclick = () => { showingHidden = !showingHidden; renderResults(); };
}

// Ocultar no toca los likes: solo mete la pista en la playlist interna de
// ocultos. Es la salida NO destructiva que le faltaba a la vista.
function onHideClick(r) {
  const wasShowingHidden = showingHidden;
  hiddenTracks.toggle(r.id, r.uri || null);
  selected.delete(r.id);
  if (showingHidden && hiddenTracks.size === 0) showingHidden = false;

  // Salirse sola de la vista de ocultos SÍ cambia la vista entera (cambia el
  // conjunto y el icono de todas las tarjetas), así que ahí se repinta. En el
  // caso normal la lista se recalcula conservando el scroll y lo ya pintado, y
  // el toggle aparece o se actualiza en el sitio.
  if (showingHidden !== wasShowingHidden) { renderResults(); return; }
  syncHiddenToggle();
  applyRows({ preserveRendered: true });
}

function renderResults() {
  const content = document.getElementById('zeroplays-content');
  if (!content || !cache) return;
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }

  const { zeros, some, likesCount, statsfmUsed, statsfmRescued } = cache;
  currentRows = visibles();
  rowById = new Map(currentRows.map(r => [r.id, r]));
  // Una fila que ya no existe (porque la sacaste de likes, o porque la
  // ocultaste) no puede seguir contando como seleccionada.
  if (selected.size) {
    for (const id of [...selected]) if (!rowById.has(id)) selected.delete(id);
  }
  // Los subtotales se cuentan sobre lo que se ve, no sobre `zeros` entero: si
  // no, ocultar bajaba el número grande y dejaba el desglose contando ocultos.
  const parciales = currentRows.filter(r => r.partial).length;
  const nunca = currentRows.length - parciales;
  const ocultosN = hiddenTracks.size;

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
          <strong id="zp-count-visible">${currentRows.length.toLocaleString('es-ES')}</strong> <span id="zp-count-label">${currentRows.length === 1 ? 'like sin plays' : 'likes sin plays'}</span> ≥30s${showingHidden ? (currentRows.length === 1 ? ' (oculto)' : ' (ocultos)') : ''} de ${likesCount.toLocaleString('es-ES')} totales
        </div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:2px" id="zp-breakdown">
          ${desgloseTexto(nunca, parciales, some.length)}
        </div>
        ${sfLine}
      </div>
      <div style="display:flex;gap:8px" id="zp-actions">
        ${hiddenToggleHtml(ocultosN)}
        <button class="btn btn-secondary btn-sm" id="zp-select-all" ${currentRows.length === 0 ? 'disabled' : ''} title="Marca las ${currentRows.length.toLocaleString('es-ES')} de la lista, no solo las pintadas">Seleccionar todos</button>
      </div>
    </div>
    ${sfToggleHtml}

    ${currentRows.length === 0 ? `
      <div class="card"><p>${showingHidden
        ? 'No hay nada oculto en esta vista.'
        : (zeros.length ? 'Ocultaste todos los likes sin plays. Mirá «Ocultos» para devolver alguno.' : 'No hay likes sin plays. Todos tus likes se escucharon al menos una vez ≥30s.')}</p></div>
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
      items: currentRows,
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
      onCard: (r) => openTrackCard({ id: r.trackId, name: r.name, artists: r.artistList || [r.artist], album: r.album, img: r.coverSmall || r.cover }),
      onHide: (r) => onHideClick(r),
      onUnlike: (r) => sacarDeLikes([r]),
    });
  }

  wireHiddenToggle();

  const selAll = content.querySelector('#zp-select-all');
  if (selAll) selAll.onclick = () => {
    // Sobre el array de filas visibles, no sobre las tarjetas pintadas: si solo
    // mirara el DOM marcaría 80 de 3.000.
    const todas = currentRows.length > 0 && currentRows.every(r => selected.has(r.id));
    selected = todas ? new Set() : new Set(currentRows.map(r => r.id));
    lastClickedId = null;
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
    const filas = currentRows.filter(r => selected.has(r.id));
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
    { ...r, sub: `${r.album || ''}${r.addedAt ? ` · añadida el ${fmtDiaCorto(r.addedAt)}` : ''}` },
    {
      selected: selected.has(r.id),
      playing: playingKey() === `zp:${r.id}`,
      showUnlike: true,
      // Desde v=149 sí hay lista de ocultos: para los que Ian sí escuchó pero
      // aparecen acá igual (el historial no los tiene), ocultar es la salida
      // que no borra el like.
      showHide: true,
      hidden: showingHidden,
      badge,
    },
  );
}

// ── Selección ────────────────────────────────────────────────────────────────

function toggleSelection(id, { range = false } = {}) {
  const r = rowById.get(id);
  if (!r) return;
  // El rango se mide sobre las filas VISIBLES: con ocultos de por medio,
  // `cache.zeros` tiene filas que no están pintadas y el rango se llevaría
  // por delante cosas que el usuario no vio.
  const filas = currentRows;
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
  if (selAll) {
    const total = currentRows.length;
    const todas = total > 0 && n >= total && currentRows.every(r => selected.has(r.id));
    selAll.textContent = todas ? 'Quitar selección' : 'Seleccionar todos';
    selAll.disabled = total === 0;
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

// Cuál es el preview actual y si está SONANDO (▶ ↔ ⏸). El evento sale de los
// eventos del <audio> en `ui/preview-player.js`.
document.addEventListener('previewchange', (e) => {
  paintPlayingCard(document.getElementById('zp-list'), 'zp', e.detail);
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
    await removeLikedTracks(ids, { origen: '#zero-plays' });
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
  // applyRows recalcula las visibles y llama a setItems con preserveRendered:
  // conserva el scroll y lo ya pintado, o sea que sacar la tarjeta 900 no
  // devuelve al usuario al principio de la lista.
  applyRows({ preserveRendered: true });
}

// El número grande y su desglose, sin repintar la vista entera. Cuentan lo que
// se VE: ocultar una fila tiene que bajar el número, igual que sacarla de likes.
function actualizarResumen() {
  const content = document.getElementById('zeroplays-content');
  if (!content || !cache) return;
  const strong = content.querySelector('#zp-count-visible');
  if (strong) strong.textContent = currentRows.length.toLocaleString('es-ES');
  const etiqueta = content.querySelector('#zp-count-label');
  if (etiqueta) etiqueta.textContent = currentRows.length === 1 ? 'like sin plays' : 'likes sin plays';
  const desglose = content.querySelector('#zp-breakdown');
  if (desglose) {
    const parciales = currentRows.filter(r => r.partial).length;
    const nunca = currentRows.length - parciales;
    desglose.textContent =
      desgloseTexto(nunca, parciales, cache.some.length);
  }
  const hideBtn = content.querySelector('#zp-toggle-hidden');
  if (hideBtn && !showingHidden) hideBtn.textContent = `Ocultos (${hiddenTracks.size})`;
}
