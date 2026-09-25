// #new-releases · "Novedades de tus artistas"
//
// Complemento de #discover-artists. Mientras "Sin escuchar" muestra la
// discografía histórica sin oír, esta vista muestra LANZAMIENTOS RECIENTES
// de los artistas donde el usuario tiene un umbral de likes. Ordena por
// fecha de release, lo más nuevo arriba. Cruza con el índice unificado
// de escuchados para no repetir nada.
//
// Chips:
//   - Umbral de likes: 5+ / 10+ / 20+
//   - Ventana temporal: 3 / 6 / 12 / 24 meses, 5 años y «todo» (default 12)

import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js';
import { showToast } from '../ui/toast.js';
import { buildAlbumHeardIndex } from '../util/album-heard.js';
import { releaseKind } from '../util/release-size.js';
import { loadFiltros, buildFilterContext, applyDiscoverFilters } from '../util/discover-filters.js';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js';
import { createLazyImages } from '../ui/lazy-img.js';
import { prefKey, migratePrefKey } from '../storage.js';
import {
  getArtistIdCached,
  getArtistDiscoCached,
  dedupDisco,
  albumIsUnheard,
  releaseTs,
  createDiscoverPlaylist,
  guardarLanzamiento,
  PLAYLIST_SINGLES,
  saveAlbumTracksToLibrary,
  albumTrackCount,
  markAlbumResolved,
  loadScanCache,
  saveScanCache,
  clearScanCache,
  agoLabel,
  renderAlbumCard,
  wireAlbumCards,
  renderFiltroChips,
  wireFiltroChips,
  addAlbumsToPlaylists,
  hiddenAlbums,
  cardKey,
  migrarClavesDeArtista,
  toggleHiddenAlbum,
  wireLoteOcultos,
  estadoDiscografia,
  nuevaRondaDeRefresco,
  autorizarEscaneo,
  migrarDiscografiasViejas,
  avisarRonda,
  botonesBaseHtml,
  conectarBotonesBase,
} from './discover-common.js';
import { estadoNativoDiscografia } from '../api.js';

const SCAN_KEY = 'new_releases';

const LS_MIN_LIKES = 'newrel_min_likes';   // 5 / 10 / 20
const LS_MONTHS = 'newrel_months';         // 3 / 6 / 12 / 24
const LS_LOADED_MORE = 'newrel_loaded_more';
// COMPARTIDA con #discover-artists a propósito (2026-08-29): la clave es la
// suya, no una nueva. Las dos vistas ya comparten `filtros` por el mismo
// motivo — si en una estás mirando sólo EPs y saltás a la otra y ves álbumes,
// el filtro parece que no se aplicó.
const LS_FILTER_KIND = 'discoverart_filter_kind';  // 'all' | 'album' | 'ep' | 'single'
// 2 y no 3: con 3 en paralelo /search tiraba 429 en cadena. El nativo tiene
// su propia cuota (100 requests y 429 durante minutos, medido en v=225): eso lo
// maneja la pausa de api.js getArtistAlbumsConFuente, no este número.
const BATCH_PARALLEL = 2;
const RATE_RETRIES = 2;
const DEFAULT_INITIAL = 100;

const VALID_LIKES = new Set([5, 10, 20]);

// Las ventanas del chip, y ÚNICA fuente de la verdad: de acá sale tanto el Set
// que valida lo que hay guardado como los botones de la topbar. Antes el
// literal `[3,6,12,24]` vivía suelto en el HTML de `renderShell`, o sea dos
// listas separadas que había que acordarse de tocar juntas.
//
// `n: 0` es «sin ventana». Existe porque la base de discografías tiene el
// **82 % de sus lanzamientos fuera de los 24 meses** (10.639 de 13.006, medido
// el 2026-09-24 sobre el export de la base): de los 2.609 que entraron esa
// noche, 2.315 —el 88,7 %— no se podían pintar por la ventana, no por falta de
// datos. Los 24 meses eran el techo, y el techo tapaba casi todo.
//
// El default sigue siendo 12 A PROPÓSITO: esta vista se llama «Novedades» y es
// lo que Ian ve al entrar todos los días. Las ventanas anchas son un destino al
// que se va tocando un chip, no el sitio donde te deja la app.
const MONTHS_CHIPS = [
  { n: 3, label: 'últimos 3m' },
  { n: 6, label: 'últimos 6m' },
  { n: 12, label: 'últimos 12m' },
  { n: 24, label: 'últimos 24m' },
  { n: 60, label: 'últimos 5 años' },
  { n: 0, label: 'todo' },
];
const VALID_MONTHS = new Set(MONTHS_CHIPS.map(c => c.n));

// A partir de los 24 meses lo que hay en pantalla ya no son «novedades» sino el
// catálogo sin escuchar, y el rótulo del conteo tiene que decirlo: con «todo»
// puesto son miles de fichas, y llamarlas novedades es mentir en la cabecera.
function ventanaEsAncha(m = state.months) { return m === 0 || m > 24; }
function ventanaTexto(m = state.months) {
  return m === 0 ? 'toda la discografía' : `los últimos ${m} meses`;
}

// Los mismos cuatro que #discover-artists, y por el mismo criterio: Spotify no
// tiene tipo «EP» (marca los de 5 temas como 'single'), así que quien decide es
// util/release-size.js por cantidad de pistas.
const KINDS = ['all', 'album', 'ep', 'single'];
const KIND_LABEL = { all: 'Todo', album: 'Álbumes', ep: 'EPs', single: 'Singles' };

function getMinLikes() {
  const n = parseInt(localStorage.getItem(prefKey(LS_MIN_LIKES)) || '10', 10);
  return VALID_LIKES.has(n) ? n : 10;
}
function getMonths() {
  const n = parseInt(localStorage.getItem(prefKey(LS_MONTHS)) || '12', 10);
  return VALID_MONTHS.has(n) ? n : 12;
}
function getFilterKind() {
  const v = localStorage.getItem(prefKey(LS_FILTER_KIND));
  return KINDS.includes(v) ? v : 'all';
}
function getLoadedMore() {
  // Piso duro en DEFAULT_INITIAL, igual que #discover-artists. Antes "Cargar
  // más" hacía Math.min(loadedMore + 50, eligibleArtists().length) y PERSISTÍA
  // ese número: si el umbral estaba en 20+ (o los likes todavía no habían
  // terminado de cargar) quedaba escrito un 6 en localStorage, y a partir de ahí
  // la vista escaneaba 6 artistas para siempre, con cualquier umbral.
  const n = parseInt(localStorage.getItem(prefKey(LS_LOADED_MORE)) || '0', 10);
  return Math.max(DEFAULT_INITIAL, Number.isFinite(n) ? n : 0);
}

const state = {
  artists: [],
  heard: null,
  selection: new Set(),
  minLikes: 10,
  months: 12,
  filterKind: 'all',
  loadedMore: DEFAULT_INITIAL,
  scannedAt: null,
  // 'normal' | 'hidden'. Acá no hay modo «escuchados»: marcar como escuchado es
  // una acción de #discover-artists (evaluar la discografía vieja). Los que Ian
  // marque allá igual desaparecen de acá, porque el filtro es compartido.
  mode: 'normal',
  // Mismos filtros que #discover-artists, mismo módulo y mismo estado
  // guardado: las dos vistas muestran el mismo objeto y tienen que coincidir.
  filtros: loadFiltros(),
  filterCtx: null,
  conteosFiltro: null,
};

// ── Lista incremental (v=144) ────────────────────────────────────────────────
// La grilla es plana (una sola .dcard-grid con todas las novedades ordenadas
// por fecha), así que acá el item del lote SÍ es la tarjeta suelta. La tapa la
// asigna lazy-img: renderAlbumCard pinta `data-src`, no `src`.
const BATCH = 30;

let list = null;
let lazyCovers = null;

function teardown() {
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
}

export async function render(container) {
  teardown();
  migratePrefKey(LS_MIN_LIKES);
  migratePrefKey(LS_MONTHS);
  // Compartida a propósito con #discover-artists: mismo string, así que
  // cualquiera de las dos vistas migra la MISMA clave prefijada.
  migratePrefKey(LS_FILTER_KIND);
  migratePrefKey(LS_LOADED_MORE);
  container.innerHTML = `
    ${pageHeader({ title: 'Novedades de tus artistas' })}
    <div id="newrel-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:14px">Cargando tus likes…</div></div></div>
  `;
  const content = document.getElementById('newrel-content');

  let idx;
  try {
    idx = await buildAlbumHeardIndex();
  } catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">No pude cargar tus datos: ${escapeHtml(e.message)}</p></div>`;
    return teardown;
  }
  state.heard = idx.heard;

  // No bloquea el pintado: hasta que llega, no se descarta nada.
  buildFilterContext()
    .then(ctx => { state.filterCtx = ctx; refreshList(content); })
    .catch(e => console.warn('[newrel] contexto de filtros:', e.message));

  state.minLikes = getMinLikes();
  state.months = getMonths();
  state.filterKind = getFilterKind();
  state.loadedMore = getLoadedMore();
  state.mode = 'normal';

  // Ocultos desde la playlist de Spotify, en segundo plano: la vista arranca
  // con el caché local y se repinta al llegar la reconciliación.
  hiddenAlbums.ready().then(() => {
    const c = document.getElementById('newrel-content');
    if (c && c.isConnected) refreshList(c);
  });

  const candidates = [...idx.likesByArtist.entries()]
    .map(([nameLower, ids]) => ({
      nameLower,
      name: idx.artistDisplay.get(nameLower) || nameLower,
      likes: ids.size,
      seedId: idx.artistIds.get(nameLower) || null,
      image: idx.artistImage.get(nameLower) || null,
    }))
    .sort((a, b) => b.likes - a.likes);

  state.artists = candidates.map(c => ({
    id: null,
    name: c.name,
    nameLower: c.nameLower,
    likes: c.likes,
    seedId: c.seedId,
    image: c.image,
    disco: [],
    scanned: false,
    error: null,
  }));

  state.scannedAt = null;
  // Una ronda por carga: mira lo reciente de las bases que tocan (30 días), con
  // presupuesto. «Actualizar» la cambia por una forzada.
  state.ronda = nuevaRondaDeRefresco();
  // Antes que nada, las discografías de antes de v=229 pasan a la base: 0 requests.
  await migrarDiscografiasViejas();
  const cached = await loadScanCache(SCAN_KEY);
  if (cached) {
    const byName = new Map(cached.artists.map(a => [a.nameLower, a]));
    let restored = 0;
    for (const a of state.artists) {
      const c = byName.get(a.nameLower);
      if (!c) continue;
      Object.assign(a, { id: c.id, disco: c.disco || [], scanned: true, error: null });
      migrarClavesDeArtista(a);   // el caché de 7 días no pasa por processArtist
      restored++;
    }
    if (restored) state.scannedAt = cached.ts || null;
    console.log(`[newrel] cache de escaneo: ${restored} artistas restaurados (${agoLabel(cached.ts)})`);
  }

  renderShell(content, candidates.length);
  refreshList(content);
  scanArtists(content).catch(err => console.warn('[newrel] scan:', err));
  return teardown;
}

function eligibleArtists() {
  return state.artists.filter(a => a.likes >= state.minLikes);
}

function targetToScan() {
  return Math.min(state.loadedMore, eligibleArtists().length);
}

function renderShell(content, totalCandidates) {
  // El shell se repinta entero: el #newrel-list de antes queda desconectado y
  // con él la grilla que estaba observando la lista incremental.
  teardown();
  content.innerHTML = `
    <div class="disco-topbar">
      <div class="disco-summary">
        <span id="newrel-count">0</span>/<span id="newrel-total-scan">${targetToScan()}</span> artistas escaneados
        · <span id="newrel-unheard-count">0</span> <span id="newrel-unheard-label">${ventanaEsAncha() ? 'lanzamientos sin escuchar' : 'novedades sin escuchar'}</span>
        <span class="disco-summary-sub" id="newrel-summary-sub">${eligibleArtists().length.toLocaleString('es-ES')} artistas con ≥${state.minLikes} likes</span>
      </div>
      <div class="disco-controls">
        <div class="disco-chip-group" id="newrel-likes">
          ${[5,10,20].map(n => `<button class="disco-chip ${state.minLikes === n ? 'is-on' : ''}" data-min="${n}">${n}+ likes</button>`).join('')}
        </div>
        <div class="disco-chip-group" id="newrel-months">
          ${MONTHS_CHIPS.map(({ n, label }) => `<button class="disco-chip ${state.months === n ? 'is-on' : ''}" data-months="${n}">${label}</button>`).join('')}
        </div>
        <div class="disco-chip-group" id="newrel-kind">
          ${KINDS.map(k => `<button class="disco-chip ${state.filterKind === k ? 'is-on' : ''}" data-kind="${k}">${KIND_LABEL[k]}</button>`).join('')}
        </div>
        <button class="btn btn-secondary btn-sm ${state.mode === 'hidden' ? 'sc-on' : ''}" id="newrel-mode-hidden" title="Las novedades que ocultaste. Se sincronizan con la playlist «fonoteca · ocultos (descubrir)».">Ocultos <span id="newrel-hidden-n">${hiddenAlbums.size}</span></button>
        <button class="btn btn-secondary btn-sm" id="newrel-refresh" title="${state.scannedAt ? 'Último escaneo ' + agoLabel(state.scannedAt) + '. ' : ''}Busca lanzamientos nuevos de tus artistas. No borra las discografías que ya tienes.">Actualizar</button>
        ${botonesBaseHtml('newrel')}
      </div>
    </div>
    ${renderFiltroChips(state.filtros, state.conteosFiltro)}
    <div class="disco-aviso" id="newrel-aviso-cortadas" role="status" hidden></div>
    <div class="disco-progress" id="newrel-progress" style="display:none">
      <div class="disco-progress-bar"><div class="disco-progress-fill" id="newrel-progress-fill" style="width:0%"></div></div>
      <div class="disco-progress-label" id="newrel-progress-label"></div>
    </div>
    <div class="disco-list newrel-list" id="newrel-list"></div>
    <div class="disco-load-more" style="text-align:center;margin:20px 0">
      <button class="btn btn-secondary" id="newrel-load-more">Cargar más artistas +50</button>
    </div>
    <div class="disco-actionbar" id="newrel-actionbar" style="display:none">
      <span id="newrel-sel-count">0 seleccionados</span>
      <button class="btn btn-secondary btn-sm" id="newrel-sel-clear">Limpiar selección</button>
      <button class="btn btn-secondary btn-sm" id="newrel-sel-addpl">Añadir a playlist…</button>
      <button class="btn btn-primary btn-sm" id="newrel-sel-playlist">Crear playlist con lo seleccionado</button>
      <button class="btn btn-secondary btn-sm" id="newrel-sel-hide" title="${state.mode === 'hidden' ? 'Los saca de «fonoteca · ocultos (descubrir)» y vuelven a la lista.' : 'Los guarda en «fonoteca · ocultos (descubrir)»: dejan de aparecer aquí y en la otra vista de descubrir.'}">${state.mode === 'hidden' ? 'Devolver a la lista' : 'Ocultar'}</button>
      <div class="disco-lote-fallos" id="newrel-lote-fallos" role="status" hidden></div>
    </div>
  `;

  wireFiltroChips(content, state.filtros, () => refreshList(content));

  content.querySelector('#newrel-likes').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-min]');
    if (!btn) return;
    const n = parseInt(btn.dataset.min, 10);
    if (!VALID_LIKES.has(n)) return;
    state.minLikes = n;
    localStorage.setItem(prefKey(LS_MIN_LIKES), String(n));
    content.querySelectorAll('#newrel-likes [data-min]').forEach(b => b.classList.toggle('is-on', b === btn));
    // Al cambiar el umbral se puede haber vaciado la cola — reprobamos + actualizo sub.
    document.getElementById('newrel-total-scan').textContent = targetToScan();
    const sub = document.getElementById('newrel-summary-sub');
    if (sub) sub.textContent = `${eligibleArtists().length.toLocaleString('es-ES')} artistas con ≥${state.minLikes} likes`;
    scanArtists(content).catch(err => console.warn('[newrel] scan:', err));
    refreshList(content);
  });
  content.querySelector('#newrel-months').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-months]');
    if (!btn) return;
    const n = parseInt(btn.dataset.months, 10);
    if (!VALID_MONTHS.has(n)) return;
    state.months = n;
    localStorage.setItem(prefKey(LS_MONTHS), String(n));
    content.querySelectorAll('#newrel-months [data-months]').forEach(b => b.classList.toggle('is-on', b === btn));
    refreshList(content);
  });
  content.querySelector('#newrel-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn || !KINDS.includes(btn.dataset.kind)) return;
    state.filterKind = btn.dataset.kind;
    localStorage.setItem(prefKey(LS_FILTER_KIND), state.filterKind);
    content.querySelectorAll('#newrel-kind [data-kind]').forEach(b => b.classList.toggle('is-on', b === btn));
    // Sólo repinta: el tipo filtra lo YA escaneado, no cambia a qué artistas
    // hay que pedirle la discografía (a diferencia del umbral de likes).
    refreshList(content);
  });
  content.querySelector('#newrel-load-more').addEventListener('click', () => {
    const eligible = eligibleArtists().length;
    if (!eligible) {
      showToast(`No hay ningún artista con ${state.minLikes} o más likes. Prueba bajando el umbral.`, 'warning');
      return;
    }
    if (state.loadedMore >= eligible && state.artists.every(a => a.likes < state.minLikes || a.scanned)) {
      showToast(`Ya están escaneados los ${eligible.toLocaleString('es-ES')} artistas con ≥${state.minLikes} likes.`, 'info');
      return;
    }
    // Sin clampear contra eligibleArtists(): ese número cambia con el chip de
    // umbral y persistirlo dejaba la vista trabada en 6 artistas.
    const antes = state.loadedMore;
    state.loadedMore += 50;
    localStorage.setItem(prefKey(LS_LOADED_MORE), String(state.loadedMore));
    document.getElementById('newrel-total-scan').textContent = targetToScan();
    scanArtists(content, { motivo: 'pedido' }).then((r) => {
      // Si se cancela el aviso, el +50 se deshace: dejarlo subido (y
      // persistido) dejaría la vista pidiendo 50 artistas que nadie escaneó,
      // y el próximo render volvería a intentarlo solo.
      if (r !== 'cancelado') return;
      state.loadedMore = antes;
      localStorage.setItem(prefKey(LS_LOADED_MORE), String(antes));
      const t = document.getElementById('newrel-total-scan');
      if (t) t.textContent = targetToScan();
    }).catch(err => console.warn('[newrel] scan:', err));
  });
  content.querySelector('#newrel-refresh').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Actualizando…';
    // v=229: tira el caché del escaneo y NADA MÁS. Las discografías viven en la
    // base (sin caducidad) y la ronda forzada mira solo lo reciente de cada una.
    state.ronda = nuevaRondaDeRefresco({ forzar: true });
    const r = await reescanearDesdeLaBase(content, { motivo: 'pedido' });
    // Cancelado: la vista quedó intacta (ni caché borrada ni `scanned`
    // tocados) y la ronda forzada se descarta sin haber gastado nada.
    if (r !== 'cancelado') avisarRonda(state.ronda);
    state.ronda = nuevaRondaDeRefresco();
    btn.disabled = false;
    btn.textContent = 'Actualizar';
  };
  conectarBotonesBase(content, 'newrel', () => reescanearDesdeLaBase(content));
  content.querySelector('#newrel-mode-hidden').onclick = () => {
    state.mode = state.mode === 'hidden' ? 'normal' : 'hidden';
    renderShell(content, totalCandidates);
    setCount(eligibleArtists().filter(a => a.scanned).length);
    refreshList(content);
  };

  content.querySelector('#newrel-sel-clear').onclick = () => {
    state.selection.clear();
    updateSelectionUi(content);
    refreshList(content);
  };
  content.querySelector('#newrel-sel-playlist').onclick = () => onCreatePlaylist(content);
  wireLoteOcultos(content, {
    prefix: 'newrel',
    selection: state.selection,
    findEntrada,
    isHiddenMode: () => state.mode === 'hidden',
    onFin: () => { updateSelectionUi(content); refreshList(content); },
  });
  content.querySelector('#newrel-sel-addpl').onclick = async (e) => {
    const btn = e.currentTarget;
    const ids = [...state.selection];
    if (!ids.length) return;
    btn.disabled = true;
    try {
      await addAlbumsToPlaylists(ids, findAlbum, {
        onDone: () => { state.selection.clear(); updateSelectionUi(content); refreshList(content); },
      });
    } catch (err) {
      showToast('No se pudieron cargar tus playlists: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };
}

// El escaneo dura minutos y el usuario se puede ir a otra vista en el medio.
// Cuando eso pasa los nodos del progreso ya no existen: escribirles .textContent
// tiraba un TypeError DENTRO del finally, que se lleva puesto el worker entero
// y hace que nunca se llegue al saveScanCache del final — o sea, se perdían los
// artistas ya escaneados y había que volver a pedírselos a Spotify.
function setCount(n) {
  const el = document.getElementById('newrel-count');
  if (el) el.textContent = n;
}

// Vuelve a armar la lista desde la base (0 requests, salvo lo reciente que le
// toque a la ronda en curso). Lo usan «Actualizar» e «Importar base».
async function reescanearDesdeLaBase(content, { motivo = 'pedido' } = {}) {
  // La autorización va ANTES del `clearScanCache`: este camino tira la caché
  // del escaneo y pone los 300 en `scanned: false`, así que preguntar después
  // dejaría la vista vaciada si se cancela. Se estima sobre la cola que HABRÍA
  // —los elegibles hasta el target, que es justo lo que quedaría por escanear
  // tras el reset— y recién entonces se toca algo.
  const prospecto = eligibleArtists().slice(0, targetToScan());
  if (!await autorizarEscaneo(prospecto, { forzar: state.ronda?.forzar, motivo })) return 'cancelado';

  await clearScanCache(SCAN_KEY);
  for (const a of state.artists) {
    Object.assign(a, { disco: [], scanned: false, error: null });
  }
  state.scannedAt = null;
  setCount(0);
  refreshList(content);
  // Ya autorizado arriba: el escaneo de acá no vuelve a preguntar.
  try { await scanArtists(content, { motivo: 'autorizado' }); } catch (err) { console.warn('[newrel] scan:', err); }
}

async function scanArtists(content, { motivo = 'automatico' } = {}) {
  const progress = document.getElementById('newrel-progress');
  const progressLabel = document.getElementById('newrel-progress-label');
  const progressFill = document.getElementById('newrel-progress-fill');

  const eligible = eligibleArtists();
  const target = Math.min(state.loadedMore, eligible.length);
  let scanned = eligible.filter(a => a.scanned).length;
  setCount(scanned);
  // slice sobre lo que FALTA, no sobre el target entero: si 40 ya vinieron del
  // cache y el target son 100, hay que encolar 60, no 100.
  const queue = eligible.filter(a => !a.scanned).slice(0, Math.max(0, target - scanned));
  if (!queue.length) return;   // todo servido de la caché

  // Antes de gastar nada: si esto supera el umbral, no arranca hasta que se
  // confirme. La cuenta es local (0 requests) y se hace ANTES de crear un solo
  // worker — si se cancela, no se ha pedido nada y no queda nada a medias: ni
  // un `scanned` tocado, ni la barra de progreso, ni la caché del escaneo.
  if (motivo !== 'autorizado'
      && !await autorizarEscaneo(queue, { forzar: state.ronda?.forzar, motivo })) return 'cancelado';

  progress.style.display = '';

  const workers = Array.from({ length: BATCH_PARALLEL }, () => (async () => {
    while (queue.length) {
      // Si el usuario se fue de la vista, cortamos acá: lo escaneado hasta
      // ahora igual se guarda abajo, así la próxima visita no lo repite.
      if (!content.isConnected) break;
      const artist = queue.shift();
      if (!artist) break;
      let requeued = false;
      try {
        await processArtist(artist);
        artist.error = null;
      } catch (e) {
        const rateLimited = e.status === 429 || /rate limit/i.test(e.message);
        if (rateLimited && (artist.retries || 0) < RATE_RETRIES) {
          artist.retries = (artist.retries || 0) + 1;
          artist.scanned = false;
          queue.push(artist);
          requeued = true;
          console.warn(`[newrel] "${artist.name}": rate limit, reintento ${artist.retries}/${RATE_RETRIES}`);
        } else {
          artist.error = e.message;
          console.warn(`[newrel] "${artist.name}":`, e.message);
        }
      } finally {
        if (!requeued) {
          scanned++;
          if (progressLabel) progressLabel.textContent = `${artist.name} (${scanned}/${target})`;
          if (progressFill) progressFill.style.width = `${Math.min(100, (scanned / target) * 100)}%`;
          setCount(scanned);
        }
        if (content.isConnected) refreshList(content);
      }
    }
  })());
  await Promise.all(workers);
  if (progress) progress.style.display = 'none';

  const done = state.artists.filter(a => a.scanned && !a.error);
  if (done.length) {
    await saveScanCache(SCAN_KEY, done.map(a => ({ nameLower: a.nameLower, id: a.id, disco: a.disco })));
    state.scannedAt = Date.now();
  }
}

async function processArtist(artist) {
  if (artist.scanned) return;
  const id = await getArtistIdCached(artist.nameLower, artist.name, artist.seedId);
  if (!id) { artist.scanned = true; artist.error = 'no encontrado en Spotify'; return; }
  artist.id = id;
  const disco = await getArtistDiscoCached(id, artist.name, state.ronda);
  artist.disco = dedupDisco(disco);
  migrarClavesDeArtista(artist);   // claves viejas → firma del álbum (v=210)
  artist.scanned = true;
}

function releasesInWindow() {
  // `months === 0` es sin ventana. Ojo con el atajo: `0 * 30 * ...` da un
  // cutoff de AHORA MISMO, que no deja pasar nada en vez de dejar pasar todo.
  const cutoff = state.months === 0
    ? -Infinity
    : Date.now() - state.months * 30 * 24 * 60 * 60 * 1000;
  const modoOcultos = state.mode === 'hidden';
  const out = [];
  for (const a of state.artists) {
    if (!a.scanned || a.error) continue;
    if (a.likes < state.minLikes) continue;
    for (const al of a.disco) {
      const ts = releaseTs(al.release);
      if (!ts || ts < cutoff) continue;
      if (state.filterKind !== 'all' && releaseKind(al) !== state.filterKind) continue;
      const oculto = hiddenAlbums.has(cardKey(al, a.name));
      // En el modo ocultos la lista son EXACTAMENTE los ocultos de la ventana,
      // sin pasar por «sin escuchar»: si no, un disco que ocultaste y después
      // guardaste en la biblioteca desaparecería de los dos lados y no habría
      // forma de devolverlo.
      if (modoOcultos) {
        if (!oculto) continue;
      } else {
        if (oculto) continue;
        if (!albumIsUnheard(al, a.name, state.heard)) continue;
      }
      out.push({ al, artist: a });
    }
  }
  // Los filtros, solo en el modo normal (en «Ocultos» Ian está
  // revisando lo que descartó a mano y no hay que esconderle nada más).
  let lista = out;
  if (!modoOcultos && state.filterCtx) {
    const items = out.map(o => ({ al: o.al, artista: o.artist.name, artistaId: o.artist.id, _o: o }));
    const { visibles, conteos } = applyDiscoverFilters(items, state.filterCtx, state.filtros);
    state.conteosFiltro = conteos;
    pintarConteosFiltro(conteos);
    lista = visibles.map(v => v._o);
  }

  // Más nuevo primero. Empate → alfabético por artista.
  lista.sort((x, y) => {
    const dt = releaseTs(y.al.release) - releaseTs(x.al.release);
    if (dt !== 0) return dt;
    return x.artist.name.localeCompare(y.artist.name, 'es');
  });
  return lista;
}

// Solo los números de los chips, sin repintar la topbar (perdería el foco).
function pintarConteosFiltro(conteos) {
  document.querySelectorAll('#disco-filtros [data-filtro]').forEach(btn => {
    const n = btn.querySelector('.disco-filtro-n');
    if (n) n.textContent = (conteos?.[btn.dataset.filtro] ?? 0).toLocaleString('es-ES');
  });
}

// ── Aviso de discografías cortadas (v=226) ──────────────────────────────────
// La vista pintaba un catálogo truncado como si fuera completo: 93 de 300
// discografías habían entrado por /search con el tope de 40 (medido el
// 2026-09-16), y lo que queda fuera de esos 40 son justo los lanzamientos
// viejos. Va en pantalla porque un aviso por consola no lo ve nadie.
let _avisoEnCurso = false;
let _avisoPendiente = false;
async function pintarAvisoCortadas() {
  if (_avisoEnCurso) { _avisoPendiente = true; return; }
  _avisoEnCurso = true;
  try {
    do {
      _avisoPendiente = false;
      const artistas = eligibleArtists().filter(a => a.scanned && !a.error && a.id);
      let cortadas = 0;
      let porBusqueda = 0;
      let esPiso = false;
      for (const a of artistas) {
        const e = await estadoDiscografia(a.id);
        if (!e) continue;
        if (e.fuente === 'busqueda') porBusqueda++;
        if (e.cortada) cortadas++;
        // Discografía de antes de v=226 por /search con menos de 40: puede
        // estar cortada igual (el filtro de artista descarta ajenos), no se sabe.
        else if (e.estimada && e.fuente === 'busqueda') esPiso = true;
      }
      const el = document.getElementById('newrel-aviso-cortadas');
      if (!el) return;
      if (!cortadas) { el.hidden = true; el.textContent = ''; continue; }
      const nat = estadoNativoDiscografia();
      const n = cortadas.toLocaleString('es-ES');
      const total = artistas.length.toLocaleString('es-ES');
      el.textContent = `Discografía incompleta en ${esPiso ? 'al menos ' : ''}${n} de ${total} artistas: `
        + 'Spotify no dejó pedir el catálogo entero y pueden faltar lanzamientos antiguos.';
      const detalle = [
        `${porBusqueda.toLocaleString('es-ES')} de ${total} discografías salieron de la búsqueda de Spotify, que devuelve 40 lanzamientos como mucho y ordenados por relevancia.`,
      ];
      if (nat.denegado) detalle.push(`El catálogo de artista respondió ${nat.denegado.status} en esta sesión: ${nat.denegado.mensaje}`);
      else if (nat.pausaHasta) detalle.push(`Spotify ha frenado las consultas de catálogo; se vuelve a intentar a partir de las ${new Date(nat.pausaHasta).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`);
      el.title = detalle.join(' ');
      el.hidden = false;
    } while (_avisoPendiente);
  } finally {
    _avisoEnCurso = false;
  }
}

function refreshList(content) {
  const listEl = document.getElementById('newrel-list');
  if (!listEl) return;
  pintarAvisoCortadas().catch(err => console.info('[newrel] aviso de cortadas:', err.message));
  const rows = releasesInWindow();
  document.getElementById('newrel-unheard-count').textContent = rows.length.toLocaleString('es-ES');
  // El chip de ventana no repinta la topbar (perdería el foco), así que el
  // rótulo se actualiza acá o se queda diciendo «novedades» con «todo» puesto.
  const lbl = document.getElementById('newrel-unheard-label');
  if (lbl) lbl.textContent = ventanaEsAncha() ? 'lanzamientos sin escuchar' : 'novedades sin escuchar';
  const nHidden = document.getElementById('newrel-hidden-n');
  if (nHidden) nHidden.textContent = hiddenAlbums.size;

  if (!rows.length) {
    const eligible = eligibleArtists().length;
    const scanned = eligibleArtists().filter(a => a.scanned).length;
    let msg;
    if (!state.artists.length) {
      msg = 'Todavía no tengo tus likes cargados. Abre el Dashboard para descargarlos y vuelve.';
    } else if (!eligible) {
      // El caso que veía Ian con 10+ y 20+: cero elegibles, y encima con los
      // botones sin decir nada. Ahora se explica y se ofrece la salida.
      const max = Math.max(...state.artists.map(a => a.likes));
      msg = `Ningún artista llega a ${state.minLikes} likes (el que más tiene llega a ${max}). Descarga el umbral con los chips de arriba.`;
    } else if (!scanned) {
      msg = `${eligible.toLocaleString('es-ES')} artistas con ≥${state.minLikes} likes, ninguno escaneado todavía. Toca «Actualizar» para consultarle a Spotify.`;
    } else if (state.mode === 'hidden') {
      msg = state.months === 0
        ? 'No ocultaste ningún lanzamiento de tus artistas.'
        : `No ocultaste ninguna novedad de los últimos ${state.months} meses.`;
    } else {
      // El chip de tipo se nombra aparte: una lista vacía por «sólo EPs» se
      // parece demasiado a una lista vacía por no haber novedades, y el chip
      // está guardado entre sesiones (y compartido con #discover-artists), así
      // que podés llegar acá con un filtro puesto que no recordás haber tocado.
      const porTipo = state.filterKind !== 'all'
        ? ` filtrando por ${KIND_LABEL[state.filterKind].toLowerCase()} — prueba con «Todo»`
        : '';
      msg = `No hay ${ventanaEsAncha() ? 'lanzamientos' : 'novedades'} sin escuchar en ${ventanaTexto()} para tus artistas con ≥${state.minLikes} likes${porTipo}.`;
    }
    teardown();
    listEl.innerHTML = `<div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">${escapeHtml(msg)}</p></div>`;
    updateSelectionUi(content);
    return;
  }

  const t0 = performance.now();
  const perf = (window.__newrelPerf ||= { batches: [] });

  // Los handlers de la tarjeta NO están delegados (wireAlbumCards asigna
  // onclick uno por uno), así que hay que cablear cada lote nuevo o las
  // tarjetas tardías quedan muertas.
  const wireNuevas = () => {
    const nuevas = grid().querySelectorAll('.dcard:not([data-wired])');
    if (!nuevas.length) return 0;
    nuevas.forEach(c => c.setAttribute('data-wired', '1'));
    nuevas.forEach(card => wireAlbumCards(card, findAlbum, {
      checkClass: 'newrel-check',
      selection: state.selection,
      onSave: (albumId, artistName, btn) => saveAlbum(albumId, artistName, btn),
      onLikeTracks: (albumId, artistName, btn) => likearPistasDelAlbum(albumId, artistName, btn),
      onChange: () => updateSelectionUi(content),
      afterAdd: () => refreshList(content),
      onHide: async (albumId, artistName, btn) => {
        const al = findAlbum(albumId);
        if (!al) return;
        btn.disabled = true;
        try {
          const oculto = await toggleHiddenAlbum(al, artistName);
          showToast(oculto
            ? `«${al.name}» oculto — no vuelve a aparecer`
            : `«${al.name}» vuelve a la lista`, 'success');
        } catch (e) {
          showToast('No se pudo ocultar: ' + e.message, 'error');
        } finally {
          btn.disabled = false;
        }
        refreshList(content);
      },
    }));
    lazyCovers?.observe(nuevas);
    return nuevas.length;
  };

  function grid() {
    let g = listEl.querySelector('.dcard-grid');
    if (!g) {
      listEl.innerHTML = '<div class="dcard-grid"></div>';
      g = listEl.querySelector('.dcard-grid');
    }
    return g;
  }

  const onBatch = ({ rendered, total, added, ms }) => {
    wireNuevas();
    perf.batches.push({ added, rendered, total, ms: +ms.toFixed(1) });
    if (window.__newrelDebug) {
      console.info(`[newrel] lote +${added} → ${rendered}/${total} tarjetas · ${ms.toFixed(1)} ms`);
    }
  };

  if (list) {
    lazyCovers?.reset();
    list.setItems(rows, { preserveRendered: true });
  } else {
    const g = grid();
    const scroller = scrollRootOf(g);
    lazyCovers = createLazyImages({ root: scroller, rootMargin: '300px' });
    list = createIncrementalList({
      container: g,
      items: rows,
      renderItem: (r) => renderAlbumCard(r.al, r.artist.name, {
        checkClass: 'newrel-check',
        selected: state.selection.has(r.al.id),
        hiddenMode: state.mode === 'hidden',
      }),
      batchSize: BATCH,
      rootMargin: '600px',
      onBatch,
    });
  }

  perf.total = rows.length;
  perf.firstPaintCards = list.rendered;
  perf.syncMs = +(performance.now() - t0).toFixed(1);
  Object.defineProperty(perf, 'lazy', { get: () => lazyCovers?.stats || null, configurable: true });

  updateSelectionUi(content);
}

function findAlbum(albumId) {
  for (const a of state.artists) {
    const found = a.disco?.find(al => al.id === albumId);
    if (found) return found;
  }
  return null;
}

// Como `findAlbum`, pero con el artista: la clave de ocultos lo usa de reserva
// cuando el álbum no trae firma.
function findEntrada(albumId) {
  for (const a of state.artists) {
    const al = a.disco?.find(x => x.id === albumId);
    if (al) return { al, artistName: a.name };
  }
  return null;
}

function updateSelectionUi(content) {
  const bar = content.querySelector('#newrel-actionbar');
  const count = content.querySelector('#newrel-sel-count');
  if (state.selection.size > 0) {
    bar.style.display = '';
    count.textContent = `${state.selection.size} seleccionado${state.selection.size === 1 ? '' : 's'}`;
  } else {
    bar.style.display = 'none';
  }
}

// «Guardar álbum»: el disco entero como unidad, por `PUT /me/library` con la
// uri de álbum (verificado 2026-08-18; `PUT /me/albums` da 403). No toca los
// me gusta de las pistas.
async function saveAlbum(albumId, artistName, btn) {
  const al = findAlbum(albumId);
  if (!al) return;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    const r = await guardarLanzamiento(al);
    if (r.destino === 'biblioteca') {
      btn.textContent = '✓ Guardado';
      showToast(`«${al.name}» guardado en tu biblioteca de álbumes`, 'success');
    } else {
      btn.textContent = '✓ En la playlist';
      const partes = [];
      if (r.pistas) partes.push(`${r.pistas} ${r.pistas === 1 ? 'pista' : 'pistas'}`);
      if (r.yaEstaban) partes.push(`${r.yaEstaban} ya ${r.yaEstaban === 1 ? 'estaba' : 'estaban'}`);
      showToast(
        `«${al.name}» es un single: ${partes.join(' · ') || 'sin pistas nuevas'} en «${PLAYLIST_SINGLES}»`,
        'success',
      );
      // La playlist se crea PÚBLICA y no hay forma de evitarlo por API. Se
      // avisa una sola vez, cuando se acaba de crear.
      if (r.playlistCreada) {
        showToast(
          `Creé la playlist «${PLAYLIST_SINGLES}». Spotify la crea PÚBLICA y no se puede cambiar por API: pásala a privada a mano desde la app.`,
          'info',
        );
      }
    }
    markAlbumResolved(al, artistName);
    setTimeout(() => {
      const content = document.getElementById('newrel-content');
      if (content) refreshList(content);
    }, 800);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = origText;
    showToast('Error al añadir: ' + e.message, 'error');
  }
}

// «Añadir pistas a mis likes»: le da al corazón a CADA pista del disco, una por
// una. Es una escritura grande y difícil de deshacer (hay que sacar el like de
// cada pista a mano), así que dice cuántas son ANTES de hacerla — no después,
// que es como Ian se enteró de que un disco le había metido 12 canciones
// sueltas en los me gusta.
async function likearPistasDelAlbum(albumId, artistName, btn) {
  const al = findAlbum(albumId);
  if (!al) return;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Contando…';
  let n = 0;
  try {
    n = await albumTrackCount(al);
  } catch { /* si no se puede contar, se avisa sin número */ }
  btn.disabled = false;
  btn.textContent = origText;

  const cuantas = n
    ? `<strong>${n}</strong> ${n === 1 ? 'pista' : 'pistas'}`
    : '<strong>todas las pistas</strong>';
  const ok = await confirmModal(
    'Añadir pistas a tus me gusta',
    `Vas a añadir ${cuantas} de «${escapeHtml(al.name)}» a tus me gusta, una por una. ` +
    'Esto NO guarda el álbum: te deja las canciones sueltas entre tus likes, y para ' +
    'deshacerlo hay que sacarle el corazón a cada una a mano. ' +
    'Si lo que quieres es el disco entero, usa «Guardar álbum».',
    n === 1 ? 'Añadir la pista' : `Añadir ${n || 'las'} pistas`,
  );
  if (!ok) return;

  btn.disabled = true;
  btn.textContent = 'Añadiendo…';
  try {
    const ids = await saveAlbumTracksToLibrary(albumId);
    btn.textContent = `✓ ${ids.length} en likes`;
    showToast(
      `${ids.length} ${ids.length === 1 ? 'pista' : 'pistas'} de «${al.name}» ${ids.length === 1 ? 'añadida' : 'añadidas'} a tus me gusta`,
      'success',
    );
    markAlbumResolved(al, artistName);
    setTimeout(() => {
      const content = document.getElementById('newrel-content');
      if (content) refreshList(content);
    }, 800);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = origText;
    showToast('Error al añadir: ' + e.message, 'error');
  }
}

async function onCreatePlaylist(content) {
  const ids = [...state.selection];
  if (!ids.length) return;
  const btn = content.querySelector('#newrel-sel-playlist');
  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    const { name, tracks } = await createDiscoverPlaylist(ids, findAlbum, { label: 'Novedades' });
    showToast(`Playlist "${name}" creada con ${tracks} pista${tracks === 1 ? '' : 's'}`, 'success');
    state.selection.clear();
    updateSelectionUi(content);
    refreshList(content);
  } catch (e) {
    showToast('Error creando playlist: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear playlist con lo seleccionado';
  }
}
