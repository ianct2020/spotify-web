// #discover-artists · "Sin escuchar de tus artistas"
//
// Idea: para los artistas con más likes (5+), traer su discografía completa
// (álbumes + singles) desde Spotify y cruzarla con el índice unificado de
// álbumes escuchados (util/album-heard.js — historial completo + likes +
// listened + w-three). Aparece SOLO lo que nunca tocó de sus artistas.
//
// v=121: cruce corregido (antes usaba solo listened-albums.json que es un
// subset por umbral; ahora usa el historial completo v=3 de plays). Default
// 100 artistas en lugar de 20. Lógica de fetch/cache/playlist compartida en
// features/discover-common.js con #new-releases.

import { escapeHtml, confirmModal, pageHeader } from '../ui/components.js?v=269';
import { showToast } from '../ui/toast.js?v=269';
import { openArtistCard } from './artist-card.js?v=269';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js?v=269';
import { createLazyImages } from '../ui/lazy-img.js?v=269';
import { isJunkTrack } from '../util/junk.js?v=269';
import { buildAlbumHeardIndex } from '../util/album-heard.js?v=269';
import { loadFiltros, buildFilterContext, applyDiscoverFilters } from '../util/discover-filters.js?v=269';
import { releaseKind } from '../util/release-size.js?v=269';
import { masNuevoPrimero } from '../util/release-date.js?v=269';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=269';
import { leerElegidos, sumarElegidos, artistasBuscados, colaAutomatica } from '../util/cola-escaneo.js?v=269';
import { leerFallos, marcarFallo, limpiarFallo, sinFallosMarcados } from '../util/escaneo-fallos.js?v=269';
import { contarSinEscanear, sufijoSinEscanear, notaSinEscanear } from '../util/sin-escanear.js?v=269';
import { estadoFrescura } from '../util/frescura-escaneo.js?v=269';
import { prefKey, migratePrefKey } from '../storage.js?v=269';
import {
  getArtistIdCached,
  getArtistDiscoCached,
  dedupDisco,
  albumIsUnheard,
  migrarClavesDeArtista,
  yearOf,
  createDiscoverPlaylist,
  guardarLanzamiento,
  PLAYLIST_SINGLES,
  saveAlbumTracksToLibrary,
  albumTrackCount,
  markAlbumResolved,
  leerEscaneoGuardado,
  restaurarDesdeLaBase,
  fijarFrescuraVencida,
  avisoFrescuraHtml,
  conectarAvisoFrescura,
  repintarAvisoFrescura,
  saveScanCache,
  clearScanCache,
  agoLabel,
  renderAlbumCard,
  wireAlbumCards,
  renderFiltroChips,
  wireFiltroChips,
  addAlbumsToPlaylists,
  hiddenAlbums,
  heardAlbums,
  cardKey,
  toggleHeardAlbum,
  toggleHiddenAlbum,
  wireLoteOcultos,
  nuevaRondaDeRefresco,
  autorizarEscaneo,
  elegirArtistasAEscanear,
  acotarEscaneo,
  migrarDiscografiasViejas,
  avisarRonda,
  botonesBaseHtml,
  conectarBotonesBase,
} from './discover-common.js?v=269';

const SCAN_KEY = 'discover_artists';

const LS_FILTER_KIND = 'discoverart_filter_kind';    // 'all' | 'album' | 'ep' | 'single'
const LS_FILTER_YEARS = 'discoverart_filter_years';  // 0 = todo, o número de años
const LS_LOADED_MORE = 'discoverart_loaded_more';    // cuántos artistas cargar (default 100)
const LS_ELEGIDOS = 'discoverart_elegidos';          // elegidos a mano en el selector (v=259)
const LS_FALLOS = 'discoverart_fallos';              // escaneos que fallaron, con el día (v=261)
const MIN_LIKES = 5;
// 2 y no 3: la discografía sale de /search (el endpoint nativo está muerto) y
// con 3 en paralelo Spotify tira 429 en cadena.
const BATCH_PARALLEL = 2;
const RATE_RETRIES = 2;   // reintentos por artista caído por rate limit
const DEFAULT_INITIAL = 100;

// Las tres divisiones y no dos (v=165): el EP lo decide util/release-size.js
// por cantidad de pistas, porque Spotify no tiene tipo «EP» y los marca como
// 'single'. El valor viejo guardado en localStorage sigue siendo válido: los
// tres de antes están entre los cuatro de ahora.
const KINDS = ['all', 'album', 'ep', 'single'];
const KIND_LABEL = { all: 'Todo', album: 'Álbumes', ep: 'EPs', single: 'Singles' };

function getFilterKind() {
  const v = localStorage.getItem(prefKey(LS_FILTER_KIND));
  return KINDS.includes(v) ? v : 'all';
}
function getFilterYears() {
  const n = parseInt(localStorage.getItem(prefKey(LS_FILTER_YEARS)) || '0', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function getLoadedMore() {
  // Piso duro en DEFAULT_INITIAL — si el localStorage viejo tenía 20/40, hoy arrancamos 100 igual.
  const n = parseInt(localStorage.getItem(prefKey(LS_LOADED_MORE)) || '0', 10);
  return Math.max(DEFAULT_INITIAL, Number.isFinite(n) ? n : 0);
}

const state = {
  artists: [],
  heard: null,           // Set<albumKey>
  likesByArtist: null,   // Map<nameLower, Set<trackId>>
  selection: new Set(),
  filterKind: 'all',
  filterYears: 0,
  loadedMore: DEFAULT_INITIAL,
  elegidos: new Set(),   // util/cola-escaneo.js
  fallos: new Map(),     // nameLower → { t, motivo } de los escaneos que fallaron (v=261)
  scannedAt: null,       // ts del escaneo cacheado que estamos mostrando
  // 'normal' = lo que queda por descubrir · 'hidden' = los que ocultaste ·
  // 'heard' = los que marcaste como escuchados. Los dos últimos son la única
  // forma de deshacer, así que no son opcionales.
  mode: 'normal',
  // Los filtros de util/discover-filters.js. `filterCtx` llega
  // asincrónico (biblioteca + historial + likes); hasta que llegue no se
  // descarta NADA, nunca al revés.
  filtros: loadFiltros(),
  filterCtx: null,
  conteosFiltro: null,
};

const YEAR_NOW = new Date().getFullYear();

// ── Lista incremental (v=144) ────────────────────────────────────────────────
//
// Era la vista que más DOM metía de toda la app: 271 tarjetas de una sola vez
// con los filtros por defecto, 1.536 con el filtro en «Todo». Ahora se pinta por
// lotes, como #skips y #sin-clasificar.
//
// El item del lote es el BLOQUE DE ARTISTA entero, no la tarjeta suelta: cada
// artista es una card con su marco, su cabecera y su propia grilla de 3, así
// que partirlo por tarjeta obligaría a aplanar todo en una grilla única y a
// perder ese marco. Como los artistas traen entre 1 y 100 lanzamientos, el
// tamaño del lote se calcula del promedio real para que el primer pintado
// ronde las TARGET_CARDS tarjetas sea cual sea el corte.
const TARGET_CARDS = 45;
const MIN_BATCH_ARTISTS = 2;
const MAX_BATCH_ARTISTS = 20;

let list = null;         // handle de createIncrementalList
let lazyCovers = null;   // handle de createLazyImages

function batchSizeFor(artists) {
  const cards = artists.reduce((s, a) => s + a.filtered.length, 0);
  if (!artists.length || !cards) return MIN_BATCH_ARTISTS;
  const media = cards / artists.length;
  const n = Math.round(TARGET_CARDS / media);
  return Math.max(MIN_BATCH_ARTISTS, Math.min(MAX_BATCH_ARTISTS, n || MIN_BATCH_ARTISTS));
}

// Solo suelta lo que cuelga del DOM que se va. No toca `state`: el escaneo en
// memoria es lo que hace que volver a la vista sea instantáneo.
function teardown() {
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
}

export async function render(container) {
  teardown();
  migratePrefKey(LS_FILTER_KIND);
  migratePrefKey(LS_FILTER_YEARS);
  migratePrefKey(LS_LOADED_MORE);
  migratePrefKey(LS_ELEGIDOS);
  migratePrefKey(LS_FALLOS);
  container.innerHTML = `
    ${pageHeader({ title: 'Sin escuchar de tus artistas' })}
    <div id="disco-content"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:14px">Cargando tus likes…</div></div></div>
  `;
  const content = document.getElementById('disco-content');
  // Ver util/vigencia-ruta.js: era la vista con más renders huérfanos (90).
  const ruta = vigilarRuta();

  let idx;
  try {
    idx = await buildAlbumHeardIndex();
  } catch (e) {
    if (!ruta.vigente()) return teardown;
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">No pude cargar tus datos: ${escapeHtml(e.message)}</p></div>`;
    return teardown;
  }
  if (!ruta.vigente()) return teardown;
  state.heard = idx.heard;
  state.likesByArtist = idx.likesByArtist;

  // El contexto de los filtros (biblioteca guardada + historial + likes) no
  // bloquea el pintado: hasta que llega, `state.filterCtx` es null y no se
  // descarta nada. Cuando llega, se repinta. Nunca al revés — esconder
  // lanzamientos por un contexto a medio cargar sería un fallo mudo.
  buildFilterContext()
    .then(ctx => { state.filterCtx = ctx; refreshList(content); })
    .catch(e => console.warn('[discover] contexto de filtros:', e.message));

  const candidates = [...idx.likesByArtist.entries()]
    .map(([nameLower, ids]) => ({
      nameLower,
      name: idx.artistDisplay.get(nameLower) || nameLower,
      likes: ids.size,
      seedId: idx.artistIds.get(nameLower) || null,
      image: idx.artistImage.get(nameLower) || null,
    }))
    .filter(a => a.likes >= MIN_LIKES)
    // v=126: fábricas de sonidos funcionales fuera de los candidatos.
    .filter(a => !isJunkTrack('', a.name))
    .sort((a, b) => b.likes - a.likes);

  if (!candidates.length) {
    content.innerHTML = `<div class="card"><p>Necesito al menos un artista con ${MIN_LIKES} canciones en likes para armar esta vista. Guarda más canciones y vuelve.</p></div>`;
    return teardown;
  }

  state.fallos = leerFallos(LS_FALLOS);   // antes de armar los artistas: cada uno lleva su `falloT`
  state.artists = candidates.map(c => ({
    id: null,
    name: c.name,
    nameLower: c.nameLower,
    likes: c.likes,
    seedId: c.seedId,
    image: c.image,
    disco: [],
    unheardAlbums: [],
    unheardSingles: [],
    scanned: false,
    error: null,
    falloT: state.fallos.get(c.nameLower)?.t || null,   // el selector lo enseña (v=261)
  }));
  state.filterKind = getFilterKind();
  state.filterYears = getFilterYears();
  state.loadedMore = Math.min(getLoadedMore(), state.artists.length);
  state.elegidos = leerElegidos(LS_ELEGIDOS);
  state.scannedAt = null;
  state.mode = 'normal';
  // Una ronda por carga (lo reciente de las bases que tocan, con presupuesto);
  // «Actualizar» la cambia por una forzada. Y antes que nada, la migración de
  // las discografías de antes de v=229 a la base: 0 requests.
  state.ronda = nuevaRondaDeRefresco();
  await migrarDiscografiasViejas();
  if (!ruta.vigente()) return teardown;

  // Ocultos desde la playlist de Spotify. En segundo plano: la vista arranca
  // con el caché local y se repinta cuando llega la reconciliación (unión), que
  // es lo que trae lo que ocultaste en la otra máquina.
  hiddenAlbums.ready().then(() => {
    const c = document.getElementById('disco-content');
    if (c && c.isConnected) refreshList(c);
  });

  // Escaneo cacheado (7 días): entrar a la vista no puede costar 150 llamadas
  // cada vez. Lo que ya está escaneado se pinta al instante.
  //
  // La frescura NO son los datos (v=262). El caché del escaneo es la marca de
  // «cuándo miré si salió algo nuevo»; las discografías viven en la base, sin
  // caducidad. Se lee CRUDO (sin borrar lo vencido) y:
  //   - vigente → se restaura de él, como siempre;
  //   - vencido o perdido → no se restaura de él, pero la vista se pinta igual
  //     desde la base (`restaurarDesdeLaBase`, 0 peticiones) y dice que puede
  //     estar desactualizada. Con el caché vencido abría VACÍA con las 351 bases
  //     intactas (v=261 sacó el escaneo automático que la repoblaba).
  const guardado = await leerEscaneoGuardado(SCAN_KEY);
  if (!ruta.vigente()) return teardown;
  const cached = guardado && !guardado.vencido ? guardado : null;
  if (cached) {
    const byName = new Map(cached.artists.map(a => [a.nameLower, a]));
    let restored = 0;
    for (const a of state.artists) {
      const c = byName.get(a.nameLower);
      if (!c) continue;
      Object.assign(a, {
        id: c.id, disco: c.disco || [],
        unheard: c.unheard || null,
        unheardAlbums: c.unheardAlbums || [], unheardSingles: c.unheardSingles || [],
        scanned: true, error: null,
      });
      restored++;
    }
    if (restored) state.scannedAt = cached.ts || null;
    // Lo restaurado del caché de 7 días no pasa por `processArtist`, así que la
    // migración de claves (v=210) tiene que correr también acá.
    for (const a of state.artists) if (a.scanned) migrarClavesDeArtista(a);
    console.log(`[discover] cache de escaneo: ${restored} artistas restaurados (${agoLabel(cached.ts)})`);
  }
  // Lo que viene de la base no trae `unheard` calculado (no pasó por
  // `processArtist`): se parte acá con la misma cuenta, contra los escuchados de AHORA.
  const deLaBase = await restaurarDesdeLaBase(state.artists, {
    alRestaurar: (a) => {
      const unheard = a.disco.filter(al => albumIsUnheard(al, a.name, state.heard));
      a.unheard = unheard;
      a.unheardAlbums = unheard.filter(al => al.type === 'album');
      a.unheardSingles = unheard.filter(al => al.type === 'single');
    },
  });
  if (!ruta.vigente()) return teardown;
  const frescura = estadoFrescura({ guardado, nConBase: deLaBase.n, recienteMax: deLaBase.recienteMax });
  fijarFrescuraVencida(SCAN_KEY, frescura.estado === 'vencida' ? frescura.ts : null);
  if (frescura.estado === 'vencida') state.scannedAt = frescura.ts;
  console.log(`[discover] desde la base, sin red: ${deLaBase.n} artistas · frescura: ${frescura.estado}`);

  renderShell(content, candidates.length);
  pintarCuenta();
  refreshList(content);
  // ⚠️ Abrir la vista NO escanea (v=261). Se pinta con lo que ya hay —el caché
  // del escaneo— y lo que falta se pide con «Elegir más artistas para
  // escanear…». Hasta v=260 esto terminaba en `scanArtists(content, ruta)` y
  // escaneaba solo si la cola quedaba por debajo del aviso de 40 peticiones: el
  // 30/09 eso gastó cuota de Ian sin preguntar. Ningún camino automático pide
  // discografías; los actos explícitos son el selector, «Actualizar» y «Base…»,
  // y cada uno trae su cartel. `tests/sin-escaneo-automatico.test.mjs` cuida que
  // no vuelva.
  return teardown;
}

function renderShell(content, totalCandidates) {
  // El shell se repinta entero (también al cambiar de modo), así que el
  // #disco-list de antes queda desconectado. Sin esto, el handle de la lista y
  // el de las tapas seguirían observando nodos muertos.
  teardown();
  content.innerHTML = `
    <div class="disco-topbar">
      <div class="disco-summary">
        <span id="disco-count">0</span>/<span id="disco-total-scan">${buscados().length}</span> artistas escaneados
        · <span id="disco-unheard-count">0</span> sin escuchar
        <span class="disco-summary-sub" id="disco-summary-sub">${textoSub()}</span>
      </div>
      <div class="disco-controls">
        <div class="disco-chip-group" id="disco-kind">
          ${KINDS.map(k => `<button class="disco-chip ${state.filterKind === k ? 'is-on' : ''}" data-kind="${k}">${KIND_LABEL[k]}</button>`).join('')}
        </div>
        <select class="disco-select" id="disco-years">
          <option value="0" ${state.filterYears === 0 ? 'selected' : ''}>Cualquier año</option>
          <option value="1" ${state.filterYears === 1 ? 'selected' : ''}>Último año</option>
          <option value="2" ${state.filterYears === 2 ? 'selected' : ''}>Últimos 2 años</option>
          <option value="5" ${state.filterYears === 5 ? 'selected' : ''}>Últimos 5 años</option>
          <option value="10" ${state.filterYears === 10 ? 'selected' : ''}>Últimos 10 años</option>
        </select>
        <button class="btn btn-secondary btn-sm ${state.mode === 'heard' ? 'sc-on' : ''}" id="disco-mode-heard" title="Los que marcaste como escuchados. Desde ahí puedes devolverlos a la lista.">Escuchados <span id="disco-heard-n">${heardAlbums.size}</span></button>
        <button class="btn btn-secondary btn-sm ${state.mode === 'hidden' ? 'sc-on' : ''}" id="disco-mode-hidden" title="Los que ocultaste. Se sincronizan con la playlist «fonoteca · ocultos (descubrir)».">Ocultos <span id="disco-hidden-n">${hiddenAlbums.size}</span></button>
        <button class="btn btn-secondary btn-sm" id="disco-refresh" title="${state.scannedAt ? 'Último escaneo ' + agoLabel(state.scannedAt) + '. ' : ''}Busca lanzamientos nuevos de tus artistas. No borra las discografías que ya tienes.">Actualizar</button>
        ${botonesBaseHtml('disco')}
        <button class="btn btn-secondary btn-sm" id="disco-load-more" title="Abre la lista de artistas sin escanear para elegir cuáles. Abrirla no pide nada a Spotify.">Elegir más artistas para escanear…</button>
      </div>
    </div>
    ${avisoFrescuraHtml('disco', SCAN_KEY)}
    ${renderFiltroChips(state.filtros, state.conteosFiltro)}
    <div class="disco-progress" id="disco-progress" style="display:none">
      <div class="disco-progress-bar"><div class="disco-progress-fill" id="disco-progress-fill" style="width:0%"></div></div>
      <div class="disco-progress-label" id="disco-progress-label"></div>
    </div>
    <div class="disco-list" id="disco-list"></div>
    <div class="disco-actionbar" id="disco-actionbar" style="display:none">
      <span id="disco-sel-count">0 seleccionados</span>
      <button class="btn btn-secondary btn-sm" id="disco-sel-clear">Limpiar selección</button>
      <button class="btn btn-secondary btn-sm" id="disco-sel-addpl">Añadir a playlist…</button>
      <button class="btn btn-primary btn-sm" id="disco-sel-playlist">Crear playlist con lo seleccionado</button>
      <button class="btn btn-secondary btn-sm" id="disco-sel-hide" title="${state.mode === 'hidden' ? 'Los saca de «fonoteca · ocultos (descubrir)» y vuelven a la lista.' : 'Los guarda en «fonoteca · ocultos (descubrir)»: dejan de aparecer aquí y en la otra vista de descubrir.'}">${state.mode === 'hidden' ? 'Devolver a la lista' : 'Ocultar'}</button>
      <div class="disco-lote-fallos" id="disco-lote-fallos" role="status" hidden></div>
    </div>
  `;

  wireFiltroChips(content, state.filtros, () => refreshList(content));
  conectarAvisoFrescura(content, 'disco', 'disco-refresh');

  content.querySelector('#disco-kind').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    state.filterKind = btn.dataset.kind;
    localStorage.setItem(prefKey(LS_FILTER_KIND), state.filterKind);
    content.querySelectorAll('#disco-kind [data-kind]').forEach(b => b.classList.toggle('is-on', b === btn));
    refreshList(content);
  });
  content.querySelector('#disco-years').addEventListener('change', (e) => {
    state.filterYears = parseInt(e.target.value, 10) || 0;
    localStorage.setItem(prefKey(LS_FILTER_YEARS), String(state.filterYears));
    refreshList(content);
  });
  content.querySelector('#disco-load-more').addEventListener('click', async (e) => {
    const pendientes = state.artists.filter(a => !a.scanned);
    if (!pendientes.length) {
      showToast(`Ya están escaneados los ${state.artists.length.toLocaleString('es-ES')} artistas con ≥${MIN_LIKES} likes.`, 'info');
      return;
    }
    // v=259: ya no suma 50 a ciegas. Se abre el selector con TODOS los que
    // faltan (por likes) y se escanean solo los marcados. Cerrarlo por
    // cualquier salida devuelve null y no toca nada.
    const ruta = vigilarRuta();
    const btn = e.currentTarget;
    btn.disabled = true;
    let elegidos;
    try {
      elegidos = await elegirArtistasAEscanear(pendientes, { forzar: state.ronda?.forzar, motivo: 'pedido' });
    } finally {
      btn.disabled = false;
    }
    if (!elegidos || !ruta.vigente()) return;
    state.elegidos = sumarElegidos(LS_ELEGIDOS, elegidos);
    const t = document.getElementById('disco-total-scan');
    if (t) t.textContent = buscados().length;
    scanArtists(content, ruta, { motivo: 'autorizado', artistas: elegidos })
      .catch(err => console.warn('[discover] scan:', err));
  });
  content.querySelector('#disco-refresh').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Actualizando…';
    // v=229: tira el caché del escaneo y NADA MÁS. Las discografías viven en la
    // base (sin caducidad) y la ronda forzada mira solo lo reciente de cada una.
    state.ronda = nuevaRondaDeRefresco({ forzar: true });
    const r = await reescanearDesdeLaBase(content, { motivo: 'pedido' });
    // Cancelado: la vista quedó intacta y la ronda forzada se descarta sin
    // haber gastado nada.
    if (r !== 'cancelado') avisarRonda(state.ronda);
    state.ronda = nuevaRondaDeRefresco();
    btn.disabled = false;
    btn.textContent = 'Actualizar';
  };
  conectarBotonesBase(content, 'disco', () => reescanearDesdeLaBase(content));
  // Los dos modos son excluyentes y se apagan tocándolos de nuevo.
  const setMode = (m) => {
    state.mode = state.mode === m ? 'normal' : m;
    renderShell(content, totalCandidates);
    // renderShell repinta la cabecera entera, incluido el contador de escaneo,
    // que arranca en 0: hay que devolverle lo que ya estaba escaneado.
    const escaneados = state.artists.filter(a => a.scanned).length;
    document.getElementById('disco-count').textContent = escaneados;
    refreshList(content);
  };
  content.querySelector('#disco-mode-heard').onclick = () => setMode('heard');
  content.querySelector('#disco-mode-hidden').onclick = () => setMode('hidden');

  content.querySelector('#disco-sel-clear').onclick = () => {
    state.selection.clear();
    updateSelectionUi(content);
    refreshList(content);
  };
  content.querySelector('#disco-sel-playlist').onclick = () => onCreatePlaylist(content);
  wireLoteOcultos(content, {
    prefix: 'disco',
    selection: state.selection,
    findEntrada,
    isHiddenMode: () => state.mode === 'hidden',
    onFin: () => { updateSelectionUi(content); refreshList(content); },
  });
  content.querySelector('#disco-sel-addpl').onclick = async (e) => {
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

// Vuelve a armar la lista desde la base (0 requests, salvo lo reciente que le
// toque a la ronda en curso). Lo usan «Actualizar» e «Importar base».
async function reescanearDesdeLaBase(content, { motivo = 'pedido' } = {}) {
  // La autorización va ANTES del `clearScanCache`: este camino tira la caché y
  // pone todo en `scanned: false`, así que preguntar después dejaría la vista
  // vaciada si se cancela.
  const prospecto = buscados();
  if (!await autorizarEscaneo(prospecto, { forzar: state.ronda?.forzar, motivo })) return 'cancelado';

  await clearScanCache(SCAN_KEY);
  for (const a of state.artists) {
    Object.assign(a, { disco: [], unheard: null, unheardAlbums: [], unheardSingles: [], scanned: false, error: null });
  }
  state.scannedAt = null;
  const n = document.getElementById('disco-count');
  if (n) n.textContent = '0';
  refreshList(content);
  // Ya autorizado arriba: el escaneo de acá no vuelve a preguntar.
  try { await scanArtists(content, vigilarRuta(), { motivo: 'autorizado' }); } catch (err) { console.warn('[discover] scan:', err); }
}

// Los que la vista quiere tener escaneados: los primeros `loadedMore` más los
// elegidos a mano (v=259). Un conjunto, no un número: ver util/cola-escaneo.js.
function buscados() {
  return artistasBuscados(state.artists, state.loadedMore, state.elegidos);
}

// El renglón de debajo del conteo. Desde v=261 nada escanea solo, así que dice
// cuántos artistas siguen SIN escanear.
function textoSub() {
  return `${state.artists.length.toLocaleString('es-ES')} artistas con ≥${MIN_LIKES} likes${sufijoSinEscanear(contarSinEscanear(state.artists))}`;
}
function pintarSub() {
  const sub = document.getElementById('disco-summary-sub');
  if (sub) sub.textContent = textoSub();
}
// El numerador del conteo. Hasta v=260 lo escribía `scanArtists()` al arrancar, y
// como ahora abrir la vista no lo llama, quedaba en el «0» del marcado con los
// artistas restaurados del caché: un número falso con cara de bueno.
function pintarCuenta() {
  const n = document.getElementById('disco-count');
  if (n) n.textContent = state.artists.filter(a => a.scanned).length;
}

// `artistas`: la cola explícita que sale del selector (v=259). Sin ella, la cola
// son los buscados que faltan escanear.
async function scanArtists(content, ruta = vigilarRuta(), { motivo = 'automatico', artistas = null } = {}) {
  // El bucle de abajo hace hasta 150 llamadas y puede correr minutos. Sin la
  // vigencia, cada vuelta escribía en `#disco-count` — que en la ruta nueva no
  // existe— y repintaba una lista desconectada del documento.
  const progress = document.getElementById('disco-progress');
  const progressLabel = document.getElementById('disco-progress-label');
  const progressFill = document.getElementById('disco-progress-fill');

  let scanned = state.artists.filter(a => a.scanned).length;
  document.getElementById('disco-count').textContent = scanned;

  // Explícita (selector): lo marcado. Automática: la cuenta de v=258, ver
  // `colaAutomatica` — no vuelve a pagar por los huecos de los primeros.
  //
  // Los que fallaron antes (v=261) no se reintentan SOLOS: la cola automática los
  // saltea. Lo explícito —el selector y «Actualizar», que llegan con
  // `motivo: 'autorizado'`— los reintenta igual, y el que salga bien pierde la marca.
  let queue = artistas
    ? artistas.filter(a => !a.scanned)
    : (motivo === 'autorizado'
        ? colaAutomatica(buscados(), scanned)
        : sinFallosMarcados(colaAutomatica(buscados(), scanned), state.fallos));
  if (!queue.length) return;   // todo servido de la caché: ni barra ni requests

  // Antes de gastar nada: si esto supera el umbral, no arranca hasta que se
  // elija qué escanear. La cuenta es local (0 requests) y se hace ANTES de
  // crear un solo worker — si se cierra, no se ha pedido nada y no queda nada
  // a medias.
  if (motivo !== 'autorizado') {
    const elegidos = await acotarEscaneo(queue, { forzar: state.ronda?.forzar, motivo });
    if (!elegidos) return 'cancelado';
    if (!ruta.vigente()) return;
    queue = [...elegidos];
  }
  const target = scanned + queue.length;

  progress.style.display = '';

  const workers = Array.from({ length: BATCH_PARALLEL }, () => (async () => {
    while (queue.length) {
      // Si te fuiste de la vista, se corta acá: ni una request más ni una
      // escritura más. Lo ya escaneado queda en `state` y se guarda abajo.
      if (!ruta.vigente()) return;
      const artist = queue.shift();
      if (!artist) break;
      let requeued = false;
      try {
        await processArtist(artist);
        artist.error = null;
      } catch (e) {
        // Un 429 no es "este artista no existe": lo volvemos a encolar al
        // final en vez de perderlo de la lista, que era justo el síntoma.
        const rateLimited = e.status === 429 || /rate limit/i.test(e.message);
        if (rateLimited && (artist.retries || 0) < RATE_RETRIES) {
          artist.retries = (artist.retries || 0) + 1;
          artist.scanned = false;
          queue.push(artist);
          requeued = true;
          console.warn(`[discover] "${artist.name}": rate limit, reintento ${artist.retries}/${RATE_RETRIES}`);
        } else {
          artist.error = e.message;
          console.warn(`[discover] "${artist.name}":`, e.message);
        }
      } finally {
        if (!requeued) {
          // Falló de verdad (no un reintento por 429 que sigue en cola): se anota
          // el día. Salió bien: se borra la marca si la había.
          if (artist.error) {
            state.fallos = marcarFallo(LS_FALLOS, artist.nameLower, artist.error);
            artist.falloT = state.fallos.get(artist.nameLower)?.t || null;
          } else if (state.fallos.has(artist.nameLower)) {
            state.fallos = limpiarFallo(LS_FALLOS, artist.nameLower);
            artist.falloT = null;
          }
          scanned++;
        }
        // Los contadores y la lista SOLO si seguimos en la vista. `processArtist`
        // puede tardar y la ruta pudo cambiar dentro del try.
        if (ruta.vigente()) {
          if (!requeued) {
            progressLabel.textContent = `${artist.name} (${scanned}/${target})`;
            progressFill.style.width = `${Math.min(100, (scanned / target) * 100)}%`;
            const cuenta = document.getElementById('disco-count');
            if (cuenta) cuenta.textContent = scanned;
          }
          refreshList(content);
        }
      }
    }
  })());
  await Promise.all(workers);
  if (ruta.vigente()) progress.style.display = 'none';

  // El cache SÍ se guarda aunque te hayas ido: son llamadas que ya se pagaron.
  const done = state.artists.filter(a => a.scanned && !a.error);
  if (done.length) {
    await saveScanCache(SCAN_KEY, done.map(a => ({
      nameLower: a.nameLower,
      id: a.id,
      disco: a.disco,
      unheard: a.unheard,
      unheardAlbums: a.unheardAlbums,
      unheardSingles: a.unheardSingles,
    })));
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
  // Antes de leer ningún estado: las claves viejas de este artista pasan a la
  // firma del álbum (v=210). Es local y no cuesta nada cuando no hay nada que
  // migrar, que es lo normal.
  migrarClavesDeArtista(artist);
  const unheard = artist.disco.filter(al => albumIsUnheard(al, artist.name, state.heard));
  // `unheard` entero, y no solo la partición en dos (v=165): el reparto por
  // `al.type` tiraba los RECOPILATORIOS al piso — no eran ni 'album' ni
  // 'single', así que no entraban en ninguna de las dos listas y la vista no
  // los mostraba nunca, con ningún chip. Los dos campos viejos se siguen
  // guardando porque el caché de escaneo de 7 días los tiene y no vale la pena
  // obligar a un rescán de 150 artistas por esto.
  artist.unheard = unheard;
  artist.unheardAlbums = unheard.filter(al => al.type === 'album');
  artist.unheardSingles = unheard.filter(al => al.type === 'single');
  artist.scanned = true;
}

function passesFilter(al) {
  if (state.filterKind !== 'all' && releaseKind(al) !== state.filterKind) return false;
  if (state.filterYears > 0) {
    const y = yearOf(al.release);
    if (!y || (YEAR_NOW - y) > state.filterYears) return false;
  }
  return true;
}

// Actualiza solo los números de los chips, sin repintar la topbar: repintarla
// perdería el foco del chip que Ian acaba de tocar.
function pintarConteosFiltro(conteos) {
  document.querySelectorAll('#disco-filtros [data-filtro]').forEach(btn => {
    const n = btn.querySelector('.disco-filtro-n');
    if (n) n.textContent = (conteos?.[btn.dataset.filtro] ?? 0).toLocaleString('es-ES');
  });
}

function refreshList(content) {
  const listEl = document.getElementById('disco-list');
  if (!listEl) return;
  // El pool depende del modo. En el normal se sacan los ocultos y los marcados
  // como escuchados: `unheardAlbums`/`unheardSingles` pueden venir del caché de
  // escaneo (7 días), calculados ANTES de que Ian marcara nada, así que el
  // filtro tiene que aplicarse acá y no solo en el escaneo.
  const poolDe = (a) => {
    if (state.mode === 'heard') return (a.disco || []).filter(al => heardAlbums.has(cardKey(al, a.name)));
    if (state.mode === 'hidden') return (a.disco || []).filter(al => hiddenAlbums.has(cardKey(al, a.name)));
    // `unheard` es lo nuevo; los dos arrays sueltos son lo que trae un caché
    // de escaneo viejo (ahí faltan los recopilatorios, pero no se pierde nada
    // de lo que ya se mostraba).
    const pool = a.unheard?.length ? a.unheard : [...a.unheardAlbums, ...a.unheardSingles];
    return pool
      .filter(al => !hiddenAlbums.has(cardKey(al, a.name)) && !heardAlbums.has(cardKey(al, a.name)));
  };

  // Los filtros solo mandan en el modo normal: en «Ocultos» y
  // «Escuchados» Ian está revisando lo que descartó a mano, y esconderle ahí la
  // mitad por un criterio automático sería justo lo contrario de lo que busca.
  //
  // Dentro de cada artista, el lanzamiento más nuevo primero (v=246). Hasta
  // v=245 no había ningún orden: cada bloque salía en el orden en que la base
  // recibió los lanzamientos (lo del endpoint nativo o de `/search`, y lo
  // reciente AÑADIDO AL FINAL) — medido sobre la base de Ian, 296 de 300
  // discografías salían mezcladas. Los bloques siguen en el orden de los likes
  // del artista: el orden cronológico ENTRE artistas es lo que aporta
  // `#new-releases`.
  //
  // `poolDe(a).filter(...)` ya es una copia, así que el sort no toca `a.disco`
  // ni `a.unheard`, que son lo que se guarda (y de cuyo orden `tieneOrdenNativo`
  // deduce la fuente de una discografía).
  let artists = state.artists
    .filter(a => a.scanned && !a.error)
    .map(a => ({ ...a, filtered: poolDe(a).filter(passesFilter).sort(masNuevoPrimero) }));

  if (state.mode === 'normal' && state.filterCtx) {
    const items = [];
    for (const a of artists) {
      for (const al of a.filtered) items.push({ al, artista: a.name, artistaId: a.id });
    }
    const { visibles, conteos } = applyDiscoverFilters(items, state.filterCtx, state.filtros);
    state.conteosFiltro = conteos;
    const vivos = new Set(visibles.map(v => v.al));
    artists = artists.map(a => ({ ...a, filtered: a.filtered.filter(al => vivos.has(al)) }));
    pintarConteosFiltro(conteos);
  }
  artists = artists.filter(a => a.filtered.length > 0);

  const totalUnheard = artists.reduce((s, a) => s + a.filtered.length, 0);
  document.getElementById('disco-unheard-count').textContent = totalUnheard.toLocaleString('es-ES');
  const nHeard = document.getElementById('disco-heard-n');
  if (nHeard) nHeard.textContent = heardAlbums.size;
  const nHidden = document.getElementById('disco-hidden-n');
  if (nHidden) nHidden.textContent = hiddenAlbums.size;
  pintarSub();
  repintarAvisoFrescura(content, 'disco', SCAN_KEY);   // tras «Actualizar» la línea se va sola

  if (!artists.length) {
    teardown();
    // Con artistas sin escanear, «nada por descubrir» sería falso (v=261, cuando
    // dejó de escanearse solo): hay que decir que faltan.
    const sinEscanear = contarSinEscanear(state.artists);
    const nota = notaSinEscanear(sinEscanear);
    const msg = state.mode === 'heard'
      ? `No marcaste ningún lanzamiento como escuchado.${nota}`
      : state.mode === 'hidden'
        ? `No ocultaste ningún lanzamiento.${nota}`
        : sinEscanear === state.artists.length
          ? `Todavía no hay ningún artista escaneado. Elige cuáles con «Elegir más artistas para escanear…»: abrir esa lista no cuesta nada y cada artista dice lo que vale.`
          : `Nada por descubrir con los filtros actuales${sinEscanear ? ' entre los artistas escaneados' : ''}.${nota}`;
    listEl.innerHTML = `<div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">${msg}</p></div>`;
    updateSelectionUi(content);
    return;
  }

  const t0 = performance.now();
  const perf = (window.__discoPerf ||= { batches: [] });

  // Cablear SOLO los bloques recién insertados. `wireAlbumCards` hace
  // querySelectorAll sobre la raíz que se le pase, así que pasarle el container
  // entero en cada lote sería cuadrático (y volvería a cablear lo ya cableado).
  const wireNuevos = () => {
    const nuevos = listEl.querySelectorAll('.disco-artist:not([data-wired])');
    if (!nuevos.length) return 0;
    nuevos.forEach(bloque => {
      bloque.setAttribute('data-wired', '1');
      const nombre = bloque.querySelector('.disco-artist-name');
      if (nombre) nombre.onclick = () => openArtistCard({ name: nombre.dataset.artist });
      // OJO: los handlers de la tarjeta NO están delegados — wireAlbumCards
      // asigna onclick uno por uno. Por eso hay que llamarlo por lote: si no,
      // el hover-play y los botones «Escuchado» / «Ocultar» de las tarjetas de
      // los lotes tardíos quedarían muertos.
      wireAlbumCards(bloque, findAlbum, {
        checkClass: 'disco-check',
        selection: state.selection,
        onSave: (albumId, artistName, btn) => saveAlbumToLibrary(albumId, artistName, btn),
        onLikeTracks: (albumId, artistName, btn) => likearPistasDelAlbum(albumId, artistName, btn),
        onChange: () => updateSelectionUi(content),
        afterAdd: () => refreshList(content),
        onHeard: (albumId, artistName) => {
          const al = findAlbum(albumId);
          if (!al) return;
          const marcado = toggleHeardAlbum(al, artistName);
          showToast(marcado
            ? `«${al.name}» marcado como escuchado`
            : `«${al.name}» vuelve a la lista`, 'success');
          refreshList(content);
        },
        onHide: async (albumId, artistName, btn) => {
          const al = findAlbum(albumId);
          if (!al) return;
          // Resolver la pista representativa es una llamada de red: sin
          // deshabilitar el botón, dos clicks seguidos ocultan y desocultan a
          // ciegas.
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
      });
      lazyCovers?.observe(bloque);
    });
    return nuevos.length;
  };

  const onBatch = ({ rendered, total, added, ms }) => {
    const cablados = wireNuevos();
    const tarjetas = listEl.querySelectorAll('.dcard').length;
    perf.batches.push({ added, rendered, total, tarjetas, ms: +ms.toFixed(1) });
    if (window.__discoDebug) {
      console.info(`[discover] lote +${added} artistas (${cablados} cableados) → ${rendered}/${total} · ${tarjetas} tarjetas · ${ms.toFixed(1)} ms`);
    }
  };

  // Reutilizar el handle mientras la vista sigue viva: refreshList se llama en
  // cada artista escaneado (una vez por request), y recrear la lista y el
  // observer de tapas 100 veces seguidas sería peor que el problema original.
  if (list) {
    // La lista se repinta entera: los <img> viejos dejan de existir, así que el
    // observer de tapas arranca de cero (el Set de "esta URL ya viajó por la
    // red" sobrevive al reset, o sea que las que ya se vieron se reasignan sin
    // parpadeo ni pedido nuevo).
    lazyCovers?.reset();
    // setItems repinta y dispara el onBatch original, que es el que cablea:
    // no hace falta (ni conviene) llamarlo a mano acá.
    list.setItems(artists, { preserveRendered: true });
  } else {
    // El root del observer se CALCULA: acá el .disco-list no tiene overflow
    // propio (scrollea el documento), así que scrollRootOf devuelve null y el
    // root es el viewport. Si algún día la vista gana un scroller propio, esto
    // lo sigue solo.
    const scroller = scrollRootOf(listEl);
    lazyCovers = createLazyImages({ root: scroller, rootMargin: '300px' });
    list = createIncrementalList({
      container: listEl,
      items: artists,
      renderItem: renderArtistBlock,
      batchSize: batchSizeFor(artists),
      rootMargin: '600px',
      onBatch,
    });
  }

  perf.totalArtistas = artists.length;
  perf.totalTarjetas = totalUnheard;
  perf.firstPaintArtistas = list.rendered;
  perf.syncMs = +(performance.now() - t0).toFixed(1);
  Object.defineProperty(perf, 'lazy', { get: () => lazyCovers?.stats || null, configurable: true });

  updateSelectionUi(content);
}

function renderArtistBlock(a) {
  return `
    <div class="disco-artist">
      <div class="disco-artist-head">
        <button class="disco-artist-name" data-artist="${escapeHtml(a.name)}">${escapeHtml(a.name)}</button>
        <span class="disco-artist-meta">${a.likes} likes · ${a.filtered.length} sin escuchar</span>
      </div>
      <div class="dcard-grid">
        ${a.filtered.map(al => renderAlbumCard(al, a.name, {
          checkClass: 'disco-check',
          selected: state.selection.has(al.id),
          showHeard: true,
          hiddenMode: state.mode === 'hidden',
        })).join('')}
      </div>
    </div>
  `;
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
  const bar = content.querySelector('#disco-actionbar');
  const count = content.querySelector('#disco-sel-count');
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
async function saveAlbumToLibrary(albumId, artistName, btn) {
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
      const content = document.getElementById('disco-content');
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
      const content = document.getElementById('disco-content');
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
  const btn = content.querySelector('#disco-sel-playlist');
  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    const { name, tracks } = await createDiscoverPlaylist(ids, findAlbum, { label: 'Descubrir' });
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
