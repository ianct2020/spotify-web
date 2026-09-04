// Sin clasificar: likes que NO están en ninguna playlist propia, salvo las que
// se marcan como ignoradas (por defecto el espejo "anothertwo" y el depósito
// "w three", que no clasifican nada).
//
// El cruce es caro (~9.500 likes contra decenas de playlists), así que:
//   - cada playlist se baja con getAllPlaylistItems, que valida por snapshot_id
//     y no re-descarga lo que no cambió;
//   - el resultado del cruce (ids + claves nombre|artista de TODO lo que está
//     en playlists) se guarda en IDB con TTL de 1 día;
//   - el estado vive en memoria mientras dure la sesión, así que volver a la
//     vista no dispara nada.
//
// El match es por track ID de Spotify. Solo si un track no trae id se cae a
// nombre+artista normalizado (normText de util/track-match.js).

import {
  getAllUserPlaylists, getAllPlaylistItems, getBestAvailableLikes,
  getCurrentUserId, removeLikedTracks, checkLibraryContains,
} from '../api.js?v=197';
import { borrarLikesVerificado } from '../util/borrado-verificado.js?v=197';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=197';
import { idbGetCached, idbSetCached, idbDel } from '../idb.js?v=197';
import { createHiddenStore } from '../util/hidden-sync.js?v=197';
import { prefKey, migratePrefKey } from '../storage.js?v=197';
import { addUrisToPlaylists, toastAddResult, getOwnPlaylists } from '../util/playlist-add.js?v=197';
import { escapeHtml, pageHeader, showProgress, hideProgress, isCancelled, confirmModal } from '../ui/components.js?v=197';
import { openModal, closeTop } from '../ui/modal-stack.js?v=197';
import { openPlaylistPicker } from '../ui/playlist-picker.js?v=197';
import { showToast } from '../ui/toast.js?v=197';
import { getPreview } from '../api/preview-providers.js?v=197';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=197';
import { openTrackCard } from './track-card.js?v=197';
import { normText } from '../util/track-match.js?v=197';
import { activateMarquee } from '../ui/marquee.js?v=197';
import { renderTrackCardRow, wireTrackCardGrid, paintCardSelection, paintPlayingCard } from '../ui/track-card-row.js?v=197';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js?v=197';
import { createLazyImages } from '../ui/lazy-img.js?v=197';
import { coverAtSize } from '../util/cover-size.js?v=197';
import { fmtDiaCorto } from '../util/fecha.js?v=197';

const HIDDEN_KEY = 'sin_clasificar_ocultas';
const EXCLUDED_KEY = 'sin_clasificar_excluidas';
const SORT_KEY = 'sin_clasificar_orden';
const CROSS_KEY = 'sin_clasificar_cross_v1';
const CROSS_TTL_MIN = 24 * 60;

// Playlists que no clasifican nada: el espejo de likes y el depósito de W-Three.
// Se usan solo la primera vez, para presembrar el selector; a partir de ahí la
// exclusión vive en localStorage POR ID, no por nombre (renombrar una playlist
// no la saca de la lista de ignoradas).
const DEFAULT_EXCLUDED_NAMES = ['anothertwo', 'w three'];

// Escaneo en paralelo. Antes era secuencial con 200 ms de pausa entre playlists:
// con 32 playlists eso son 6,4 s de esperas puras más el tiempo de red, todo en
// serie. Los endpoints de playlist aguantan bien 3 a la vez; el 429 se maneja
// dentro de spotifyFetch (espera 5 s) y, si aun así agota los reintentos, la
// playlist se reencola hasta SCAN_RATE_RETRIES veces en vez de perderse.
const SCAN_PARALLEL = 3;
const SCAN_PAUSE_MS = 0;
const SCAN_RATE_RETRIES = 2;

const SORTS = [
  { id: 'recent', label: 'Más recientes primero' },
  { id: 'old', label: 'Más antiguas primero' },
  { id: 'artist', label: 'Por artista' },
  { id: 'random', label: 'Aleatorio' },
];

let state = null;      // { rows, likesCount, ownPlaylists, scannedAt, scanMs }
let scanning = false;
let filterText = '';
let sortMode = 'recent';   // se resuelve de verdad en render(), ver prefKey()
let showingHidden = false;
// Filas visibles con el filtro y el orden actuales, en el mismo orden que las
// tarjetas del grid. Los handlers leen de acá y NO de filtered(): con el orden
// aleatorio, cada llamada a filtered() re-baraja y devolvería otra canción.
// Ojo: la lista se pinta por lotes, así que `visible` tiene TODAS las filas y
// el DOM solo las appendeadas hasta ahora.
let visible = [];
// Resolución de tarjeta → fila por data-id. Los handlers van delegados en el
// grid, así que cada tarjeta tiene que poder resolverse sola: con append
// incremental, un índice dentro de un `querySelectorAll` no vale.
let rowById = new Map();
// Ids de las filas seleccionadas. Vive en el módulo y NO en el DOM: con la
// lista incremental, "Seleccionar todas" solo marcaría lo pintado y la barra
// inferior contaría de menos. Sobrevive a los re-render (filtro, orden,
// ocultar) mientras la fila siga existiendo.
let selected = new Set();
// Ancla del shift+click: última tarjeta que se tocó a mano.
let lastClickedId = null;
let list = null;
// Tapas de 300×300 pintadas a 96px: sin carga diferida contra el scroller Y sin
// descarga al alejarse, recorrer la lista entera dejaría ~715 MB decodificados
// en memoria. Ver ui/lazy-img.js.
let lazyCovers = null;

// Tarjetas por lote. 80 llena de sobra el primer viewport y deja colchón para
// que el primer scroll no dispare nada. Mismo número que #skips.
const BATCH = 80;

function loadSet(key) {
  try {
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}
function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* lleno */ }
}

// Ocultas sincronizadas vía playlist privada (ver util/hidden-sync.js). Las
// filas sin id de Spotify usan una clave de nombre+artista y quedan solo
// locales: no hay pista que subir a la playlist.
const hidden = createHiddenStore({
  lsKey: HIDDEN_KEY,
  playlistName: 'fonoteca · ocultos (sin clasificar)',
  label: 'sin-clasificar',
  keyOfTrack: (t) => t?.id || null,
});

// null = todavía no se configuró nunca (hay que presembrar con los defaults).
function loadExcluded() {
  const raw = localStorage.getItem(prefKey(EXCLUDED_KEY));
  if (raw == null) return null;
  try {
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return null; }
}
function saveExcluded(set) { saveSet(prefKey(EXCLUDED_KEY), set); }

// Las tres playlists que crea la app para los ocultos (skips / sin clasificar /
// álbumes). Se comparan por nombre porque los ids los crea Spotify y viven en
// cada máquina; el nombre lo pone hidden-sync.js.
const PREFIJO_OCULTOS = 'fonoteca · ocultos';
function esPlaylistDeOcultos(nombre) {
  return normName(nombre).startsWith(PREFIJO_OCULTOS);
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Clave de respaldo cuando un track no tiene id de Spotify.
function fallbackKey(name, artist) {
  const n = normText(name);
  const a = normText(artist);
  if (!n || !a) return null;
  return `${n}|${a}`;
}

// La más chica del array: es la que siempre está.
function chicaCover(imgs) {
  return imgs.length ? (imgs[imgs.length - 1].url || null) : null;
}
// La de ~300px para pintar a 96. Si el álbum no la trae, se deduce.
function medianaCover(imgs) {
  const chica = chicaCover(imgs);
  const media = imgs.find(im => (im.width || 0) >= 240 && (im.width || 0) <= 400)
    || imgs.find(im => (im.width || 0) >= 240);
  return media?.url || (chica ? coverAtSize(chica, 300) : null);
}

// Ojo con el `||`: hay un like con `artists: [{ id: …, name: "" }]` (nombre
// vacío, no ausente). Con `a.name || a` esa fila devolvía el OBJETO artista, y
// entonces ordenar «Por artista» tiraba `a.artist.localeCompare is not a
// function` y dejaba la vista intacta sin decir nada. Verificado sobre los
// 9.548 likes: 1 caso.
function firstArtist(t) {
  const a = (t?.artists || [])[0];
  const n = (a && typeof a === 'object') ? a.name : a;
  return typeof n === 'string' ? n : '';
}

export async function render(container) {
  teardown();
  migratePrefKey(SORT_KEY);
  migratePrefKey(EXCLUDED_KEY);
  sortMode = localStorage.getItem(prefKey(SORT_KEY)) || 'recent';
  container.innerHTML = `
    ${pageHeader({ title: 'Sin clasificar' })}
    <div id="sc-content"></div>
  `;
  if (state) {
    renderResults();
    // El router llama a esto al salir de la ruta. Sin él quedarían vivos los
    // IntersectionObserver (centinela de la lista y tapas) sobre nodos ya
    // desconectados del documento.
    return teardown;
  }
  document.getElementById('sc-content').innerHTML = `
    <div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cruzando tus likes con tus playlists…</div></div>
  `;
  await load({ force: false });
  return teardown;
}

// No toca `state`: el cruce cacheado en memoria es lo que hace que volver a la
// vista sea instantáneo. Solo suelta lo que cuelga del DOM que se va.
function teardown() {
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
  selected.clear();
  lastClickedId = null;
  visible = [];
  rowById = new Map();
}

// ── Carga y cruce ────────────────────────────────────────────────────────────

async function load({ force }) {
  if (scanning) return;
  scanning = true;
  const t0 = performance.now();
  // Ver util/vigencia-ruta.js. Esta vista baja la biblioteca Y cruza todas las
  // playlists propias: es de las más largas que hay.
  const ruta = vigilarRuta();
  try {
    // getBestAvailableLikes completa la descarga sola si el caché no está entero
    // (y se cuelga de la carga de otra vista si ya hay una en curso), así que
    // solo hay que darle dónde mostrar el progreso.
    let shownLikesProgress = false;
    const { items: likes } = await getBestAvailableLikes({
      onProgress: ({ loaded, total, cached }) => {
        if (cached) return;
        if (!shownLikesProgress) {
          showProgress('Cargando tus Liked Songs…', 0, 0, { minimized: true });
          shownLikesProgress = true;
        }
        showProgress('Cargando tus Liked Songs…', loaded, total);
      },
    });
    if (shownLikesProgress) hideProgress();
    if (!ruta.vigente()) return;

    // Ocultas desde la playlist de Spotify. En segundo plano: si tarda, la vista
    // arranca con el caché local y se repinta al llegar.
    hidden.ready().then(() => { if (state) renderResults(); });

    const me = await getCurrentUserId();
    if (!ruta.vigente()) return;
    const playlists = await getAllUserPlaylists();
    if (!ruta.vigente()) return;
    const own = playlists.filter(p => p.owner?.id === me);

    let excluded = loadExcluded();
    if (excluded == null) {
      // Presiembra tolerante al espaciado: "w three", "W Three" y "wthree" son
      // la misma playlist. A partir de acá la exclusión ya vive por id.
      const sinEspacios = new Set(DEFAULT_EXCLUDED_NAMES.map(n => n.replace(/\s+/g, '')));
      excluded = new Set(own.filter(p => sinEspacios.has(normName(p.name).replace(/\s+/g, ''))).map(p => p.id));
      saveExcluded(excluded);
      console.log('[sin-clasificar] exclusiones presembradas por id:',
        own.filter(p => excluded.has(p.id)).map(p => `${p.name} (${p.id})`));
    }
    // Las playlists de ocultos de la propia app NUNCA cuentan para el cruce.
    // Son el almacén de "esto no lo quiero ver" (util/hidden-sync.js), así que
    // si entraran, ocultar una canción la marcaría como clasificada y al
    // devolverla a la lista ya no volvería a aparecer: se perdería en silencio.
    const toScan = own.filter(p => !excluded.has(p.id) && !esPlaylistDeOcultos(p.name));
    const deOcultos = own.filter(p => esPlaylistDeOcultos(p.name)).map(p => p.name);
    console.log(`[sin-clasificar] ${toScan.length} playlists a cruzar de ${own.length} propias · ignoradas por id: ${own.filter(p => excluded.has(p.id)).map(p => `${p.name} (${p.id})`).join(', ') || '—'}${deOcultos.length ? ` · fuera por ser de ocultos: ${deOcultos.join(', ')}` : ''}`);

    let cross = force ? null : await idbGetCached(CROSS_KEY).catch(() => null);
    if (!ruta.vigente()) return;
    // Si cambió qué playlists entran al cruce, lo cacheado ya no sirve.
    if (cross && cross.scanned?.join(',') !== toScan.map(p => p.id).join(',')) cross = null;

    let scanMs = 0;
    if (!cross) {
      cross = await scanPlaylists(toScan);
      scanMs = Math.round(performance.now() - t0);
      cross.at = Date.now();
      cross.scanMs = scanMs;
      // El cruce se guarda IGUAL aunque el usuario se haya ido: costó minutos y
      // es válido. Lo que no se hace es pintarlo.
      await idbSetCached(CROSS_KEY, cross, CROSS_TTL_MIN).catch(() => {});
      if (!ruta.vigente()) return;
    }

    const ids = new Set(cross.ids);
    const keys = new Set(cross.keys);
    const rows = [];
    for (const it of likes) {
      const t = it.track || it;
      if (!t) continue;
      const id = t.id || null;
      const artist = firstArtist(t);
      const key = fallbackKey(t.name, artist);
      // Match por ID; solo si el like no tiene id se compara por nombre+artista.
      const clasificada = id ? ids.has(id) : (key ? keys.has(key) : false);
      if (clasificada) continue;
      const imgs = t.album?.images || [];
      // La lista entera de artistas, no solo el primero: es la que va al matcher
      // de previews (ver `onPlayClick`). `artists` es la misma lista unida, que
      // es lo que pide la tarjeta compartida.
      const nombres = (t.artists || []).map(a => (a && typeof a === 'object') ? (a.name || '') : (a || '')).filter(Boolean);
      rows.push({
        id: id || key,
        trackId: id,
        uri: t.uri || (id ? `spotify:track:${id}` : null),
        name: t.name || '(sin nombre)',
        artists: nombres.join(', '),
        artistList: nombres,
        artist,
        album: t.album?.name || '',
        // La tapa se pinta a 96px, así que hay que usar la de 300×300. El
        // caché de likes guarda las más chicas (ver slimTrack en api.js): si la
        // de 300 no está —cachés de antes de v=138 y el backup del repo, que
        // solo tienen la de 64— se deduce del prefijo del CDN, con la chica de
        // respaldo en el onerror del <img>.
        cover: medianaCover(imgs),
        coverSmall: chicaCover(imgs),
        addedAt: it.added_at || null,
        raw: t,
      });
    }

    state = {
      rows,
      likesCount: likes.length,
      ownPlaylists: own,
      excluded,
      scannedPlaylists: toScan.length,
      skipped: cross.skipped || [],
      at: cross.at,
      scanMs: scanMs || cross.scanMs || 0,
      fromCache: scanMs === 0,
      totalMs: Math.round(performance.now() - t0),
    };
    // `window.__filasSinClasificar` espeja `rows` para medir previews desde
    // afuera, mismo arnés que `window.__filasSkips` / `window.__filasZeroPlays`
    // (v=166): leer del DOM no sirve porque la tarjeta muestra los artistas ya
    // unidos en un string, y el matcher necesita la lista.
    window.__filasSinClasificar = rows;
    console.log(`[sin-clasificar] ${rows.length} sin clasificar de ${likes.length} likes · ${state.fromCache ? 'cache' : 'escaneo'} · total ${state.totalMs} ms`);
    renderResults();
  } catch (e) {
    hideProgress();
    if (isCancelled(e)) {
      showToast('Escaneo detenido — lo que se bajó quedó guardado', 'warning');
      const c = document.getElementById('sc-content');
      if (c && !state) c.innerHTML = `<div class="card"><p style="margin:0">Escaneo detenido. Pulsa «Actualizar» para retomarlo.</p></div>`;
      else if (state) renderResults();
    } else {
      console.error('[sin-clasificar]', e);
      const c = document.getElementById('sc-content');
      if (c) c.innerHTML = `<div class="card"><p style="color:var(--color-error)">Error: ${escapeHtml(e.message)}</p></div>`;
      showToast('No se pudo completar el cruce: ' + e.message, 'error');
    }
  } finally {
    scanning = false;
  }
}

// El escaneo se muestra SIEMPRE en el pill chico, para que la app siga usable.
// showProgress cierra el overlay solo si pasan 10 s sin novedades y al cerrarlo
// olvida que estaba minimizado: si no volviéramos a pedirlo, la siguiente
// actualización lo levantaría como overlay grande, tapando la app entera.
function progreso(texto, loaded, total, onCancel) {
  const vivo = document.getElementById('progress-overlay');
  showProgress(texto, loaded, total, vivo ? {} : { minimized: true, onCancel });
}

// Baja las pistas de cada playlist y devuelve los índices del cruce.
// El progreso sale en el pill minimizado para poder seguir usando la app.
// SCAN_PARALLEL playlists a la vez: el orden de la cola deja de importar, así
// que el progreso cuenta terminadas, no la posición en la lista.
async function scanPlaylists(playlists) {
  const ids = new Set();
  const keys = new Set();
  const skipped = [];
  const total = playlists.length;
  const cola = playlists.map(p => ({ pl: p, retries: 0 }));
  let hechas = 0;
  let aborted = false;
  let fatal = null;
  const cancelar = () => { aborted = true; };
  progreso(`Escaneando playlists… (0/${total})`, 0, total, cancelar);

  const worker = async () => {
    while (cola.length) {
      if (aborted) return;
      const tarea = cola.shift();
      if (!tarea) return;
      const pl = tarea.pl;
      try {
        // El progreso por página no es decorativo: showProgress cierra el pill si
        // pasan 10 s sin novedades, y bajar una playlist grande tarda bastante más.
        const items = await getAllPlaylistItems(pl.id, ({ loaded }) => {
          progreso(`Escaneando «${pl.name}»… ${loaded.toLocaleString('es-ES')} pista${loaded === 1 ? '' : 's'} (${hechas}/${total})`, hechas, total, cancelar);
        });
        for (const item of items) {
          const t = item.item || item.track;
          if (!t) continue;
          if (t.id) ids.add(t.id);
          const k = fallbackKey(t.name, firstArtist(t));
          if (k) keys.add(k);
        }
      } catch (e) {
        // 403/404: playlists de Spotify o borradas. No frenan el escaneo.
        if (/40[34]/.test(e.message)) {
          skipped.push(pl.name);
        } else if ((e.status === 429 || /rate limit/i.test(e.message)) && tarea.retries < SCAN_RATE_RETRIES) {
          tarea.retries++;
          cola.push(tarea);
          console.warn(`[sin-clasificar] «${pl.name}»: rate limit, reintento ${tarea.retries}/${SCAN_RATE_RETRIES}`);
          continue;
        } else {
          fatal = fatal || e;
          aborted = true;
          return;
        }
      }
      hechas++;
      progreso(`Escaneando playlists… (${hechas}/${total})`, hechas, total, cancelar);
      if (SCAN_PAUSE_MS) await new Promise(r => setTimeout(r, SCAN_PAUSE_MS));
    }
  };

  await Promise.all(Array.from({ length: Math.min(SCAN_PARALLEL, total || 1) }, worker));
  hideProgress();
  if (fatal) throw fatal;
  if (aborted) throw new Error('Carga cancelada');
  if (skipped.length > 0) console.warn('[sin-clasificar] playlists inaccesibles:', skipped);
  return { ids: [...ids], keys: [...keys], scanned: playlists.map(p => p.id), skipped };
}

// ── Render ───────────────────────────────────────────────────────────────────

function filtered() {
  if (!state) return [];
  const q = normText(filterText);
  let rows = state.rows.filter(r => {
    const isHidden = hidden.has(r.id);
    if (showingHidden ? !isHidden : isHidden) return false;
    if (!q) return true;
    return normText(`${r.name} ${r.artists} ${r.album}`).includes(q);
  });
  rows = rows.slice();
  if (sortMode === 'recent') rows.sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  else if (sortMode === 'old') rows.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
  else if (sortMode === 'artist') rows.sort((a, b) => a.artist.localeCompare(b.artist, 'es') || (b.addedAt || '').localeCompare(a.addedAt || ''));
  else if (sortMode === 'random') rows.sort(() => Math.random() - 0.5);
  return rows;
}

// Recalcula las filas visibles y las publica en la lista incremental. Ordenar,
// filtrar y ocultar pasan por acá: nunca se toca el DOM de las tarjetas a mano.
function applyRows({ preserveRendered = false } = {}) {
  visible = filtered();
  rowById = new Map(visible.map(r => [r.id, r]));
  // Una fila que ya no existe (porque se añadió a alguna playlist) no puede
  // seguir contando como seleccionada. Se compara contra TODAS las filas, no
  // contra `visible`: filtrar no deselecciona nada.
  if (selected.size) {
    const vivas = new Set(state.rows.map(r => r.id));
    for (const id of [...selected]) if (!vivas.has(id)) selected.delete(id);
  }
  if (list) {
    // setItems repinta el grid entero: los <img> viejos dejan de existir y el
    // observer de tapas tiene que soltarlos antes de que lleguen los nuevos.
    lazyCovers?.reset();
    list.setItems(visible, { preserveRendered });
  }
  updateSelectionUi();
}

function renderResults() {
  const content = document.getElementById('sc-content');
  if (!content || !state) return;
  const t0 = performance.now();
  window.__scPerf = { batches: [] };
  if (list) { list.destroy(); list = null; }
  if (lazyCovers) { lazyCovers.destroy(); lazyCovers = null; }
  const rows = visible = filtered();
  rowById = new Map(rows.map(r => [r.id, r]));
  const hiddenCount = hidden.size;
  // El número grande cuenta lo que queda por clasificar de verdad: el total del
  // cruce menos las que Ian ya ocultó. Antes decía 1.987 mientras el grid
  // pintaba 1.985.
  const sinClasificarCount = state.rows.reduce((n, r) => n + (hidden.has(r.id) ? 0 : 1), 0);
  // Una fila que ya no existe (porque se añadió a alguna playlist) no puede
  // seguir contando como seleccionada.
  if (selected.size) {
    const vivas = new Set(state.rows.map(r => r.id));
    for (const id of [...selected]) if (!vivas.has(id)) selected.delete(id);
  }
  const fecha = state.at ? new Date(state.at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  content.innerHTML = `
    <div class="sc-topbar">
      <div class="sc-summary">
        <span class="sc-summary-n">${sinClasificarCount.toLocaleString('es-ES')}</span>
        <span class="sc-summary-t">canciones sin clasificar de ${state.likesCount.toLocaleString('es-ES')} likes${hiddenCount > 0 ? ` · ${hiddenCount.toLocaleString('es-ES')} oculta${hiddenCount === 1 ? '' : 's'}` : ''}</span>
      </div>
      <div class="sc-topbar-tools">
        <input type="search" class="input sc-search" id="sc-search" placeholder="Filtrar por artista, título o álbum" value="${escapeHtml(filterText)}" autocomplete="off">
        <select class="sc-select" id="sc-sort" title="Orden de la lista">
          ${SORTS.map(s => `<option value="${s.id}"${s.id === sortMode ? ' selected' : ''}>${s.label}</option>`).join('')}
        </select>
        ${hiddenCount > 0 || showingHidden ? `
          <button class="btn btn-secondary btn-sm ${showingHidden ? 'sc-on' : ''}" id="sc-toggle-hidden">${showingHidden ? '← Volver' : 'Ocultas (' + hiddenCount + ')'}</button>
        ` : ''}
        <button class="btn btn-secondary btn-sm" id="sc-sel-all" ${rows.length === 0 ? 'disabled' : ''} title="Marca las ${rows.length.toLocaleString('es-ES')} de la lista, no solo las pintadas">Seleccionar todas</button>
        <button class="btn btn-secondary btn-sm" id="sc-excluded-btn" title="Elegir qué playlists no cuentan para el cruce">Playlists ignoradas (${state.excluded.size})</button>
        <button class="btn btn-secondary btn-sm" id="sc-refresh-btn" title="Rehacer el cruce ignorando la caché">Actualizar</button>
      </div>
      <div class="sc-note">
        ${state.scannedPlaylists} playlists cruzadas · ${state.fromCache ? `cruce guardado el ${escapeHtml(fecha)}` : `escaneo en ${(state.scanMs / 1000).toFixed(1)} s`}${state.skipped.length ? ` · ${state.skipped.length} inaccesibles` : ''}
      </div>
    </div>
    ${rows.length === 0 ? `
      <div class="card"><p style="text-align:center;color:var(--color-text-muted);margin:0">
        ${showingHidden ? 'No hay canciones ocultas con este filtro.' : (filterText ? 'Ninguna canción sin clasificar coincide con el filtro.' : 'Todos tus likes están en alguna playlist.')}
      </p></div>
    ` : `
      <div class="sc-grid" id="sc-list" role="listbox" aria-multiselectable="true" aria-label="Canciones sin clasificar"></div>
    `}
    <div class="sc-actionbar" id="sc-actionbar" style="display:none">
      <span id="sc-sel-count">0 seleccionadas</span>
      <button class="btn btn-primary btn-sm" id="sc-sel-add">Añadir a…</button>
      <button class="btn btn-secondary btn-sm" id="sc-sel-hide">${showingHidden ? 'Devolver a la lista' : 'Ocultar'}</button>
      <button class="btn btn-danger btn-sm" id="sc-sel-unlike">Sacar de likes</button>
      <button class="btn btn-secondary btn-sm" id="sc-sel-clear">Limpiar selección</button>
    </div>
  `;
  wire();

  // El grid arranca vacío y se llena por lotes (ver ui/incremental-list.js).
  // Antes se inyectaban las ~1.988 tarjetas de una sola vez.
  const grid = content.querySelector('#sc-list');
  if (grid) {
    // El root del observer es el ancestro que scrollea DE VERDAD. Acá, a
    // diferencia de #skips (donde el propio grid tiene `max-height: 74vh`), el
    // .sc-grid no tiene overflow propio: scrollea el documento, así que
    // scrollRootOf devuelve null y el root es el viewport. Se calcula, no se
    // asume: si algún día la vista gana un scroller propio, esto lo sigue.
    const scroller = scrollRootOf(grid);
    lazyCovers = createLazyImages({ root: scroller, rootMargin: '200px' });
    list = createIncrementalList({
      container: grid,
      items: visible,
      renderItem: renderCard,
      batchSize: BATCH,
      rootMargin: '600px',
      onBatch: ({ rendered, total, added, ms }) => {
        const perf = (window.__scPerf ||= { batches: [] });
        perf.batches.push({ added, rendered, total, ms: +ms.toFixed(1) });
        // Marquee y tapas solo sobre lo recién insertado: medir toda la lista
        // en cada lote sería cuadrático, y son medidas de layout, de las caras.
        const nuevas = grid.querySelectorAll('.sc-card:not([data-mq])');
        nuevas.forEach(c => c.setAttribute('data-mq', '1'));
        lazyCovers?.observe(nuevas);
        activateMarquee(nuevas);
        if (window.__scDebug) {
          console.info(`[sin-clasificar] lote +${added} → ${rendered}/${total} en ${ms.toFixed(1)} ms`);
        }
      },
    });
  }
  updateSelectionUi();

  const perf = window.__scPerf;
  Object.defineProperty(perf, 'lazy', { get: () => lazyCovers?.stats || null, configurable: true });
  perf.totalRows = rows.length;
  perf.firstPaintCards = list ? list.rendered : 0;
  perf.syncMs = +(performance.now() - t0).toFixed(1);
}

// La tarjeta la pinta el componente compartido `ui/track-card-row.js` (v=140);
// antes vivía acá y `#skips` tenía su propia versión con tapa de 56px.
function renderCard(r) {
  return renderTrackCardRow(
    { ...r, sub: `${r.album || ''}${r.addedAt ? ` · ${fmtDiaCorto(r.addedAt)}` : ''}` },
    {
      selected: selected.has(r.id),
      playing: playingKey() === `sc:${r.id}`,
      hidden: showingHidden,
      showAdd: true,
      showUnlike: true,
    },
  );
}

function wire() {
  const content = document.getElementById('sc-content');
  if (!content) return;

  const search = content.querySelector('#sc-search');
  if (search) {
    let timer = null;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        filterText = search.value;
        const pos = search.selectionStart;
        refreshList();
        // Si hubo que repintar la vista entera (resultado vacío), el input es
        // otro nodo y hay que devolverle el foco y el cursor.
        const nuevo = document.getElementById('sc-search');
        if (nuevo && nuevo !== search) { nuevo.focus(); nuevo.setSelectionRange(pos, pos); }
      }, 180);
    });
  }

  const sort = content.querySelector('#sc-sort');
  if (sort) sort.onchange = () => {
    sortMode = sort.value;
    localStorage.setItem(prefKey(SORT_KEY), sortMode);
    refreshList();
  };

  const toggleHidden = content.querySelector('#sc-toggle-hidden');
  if (toggleHidden) toggleHidden.onclick = () => { showingHidden = !showingHidden; renderResults(); };

  const refresh = content.querySelector('#sc-refresh-btn');
  if (refresh) refresh.onclick = async () => {
    if (scanning) return;
    refresh.disabled = true;
    await idbDel(CROSS_KEY).catch(() => {});
    await load({ force: true });
  };

  const excludedBtn = content.querySelector('#sc-excluded-btn');
  if (excludedBtn) excludedBtn.onclick = openExcludedModal;

  // Handlers de tarjeta DELEGADOS en el grid: con append incremental, las
  // tarjetas del lote 3 en adelante no existen cuando se cablea la vista, así
  // que un querySelectorAll().forEach dejaría medio listado muerto y sin error.
  wireTrackCardGrid(content.querySelector('#sc-list'), {
    rowById: (id) => rowById.get(id),
    onToggle: (id, o) => toggleSelection(id, o),
    onPlay: (r) => onPlayClick(r),
    onCard: (r) => onCardClick(r),
    onAdd: (r) => openAddModal([r]),
    onHide: (r) => onHideClick(r),
    onUnlike: (r) => sacarDeLikes([r]),
  });

  const selAll = content.querySelector('#sc-sel-all');
  if (selAll) selAll.onclick = () => {
    // Sobre el array, no sobre las tarjetas pintadas: si mirara el DOM marcaría
    // 80 de 1.988.
    const todas = visible.length > 0 && visible.every(r => selected.has(r.id));
    selected = todas ? new Set() : new Set(visible.map(r => r.id));
    repaintSelection();
    updateSelectionUi();
  };

  const selAdd = content.querySelector('#sc-sel-add');
  if (selAdd) selAdd.onclick = () => {
    const filas = selectedRows();
    if (filas.length) openAddModal(filas);
  };
  const selHide = content.querySelector('#sc-sel-hide');
  if (selHide) selHide.onclick = () => {
    for (const r of selectedRows()) {
      hidden.toggle(r.id, r.uri || null);
    }
    selected.clear();
    lastClickedId = null;
    if (showingHidden && hidden.size === 0) showingHidden = false;
    renderResults();
  };
  const selUnlike = content.querySelector('#sc-sel-unlike');
  if (selUnlike) selUnlike.onclick = () => {
    const filas = selectedRows();
    if (filas.length) sacarDeLikes(filas);
  };

  const selClear = content.querySelector('#sc-sel-clear');
  if (selClear) selClear.onclick = () => {
    selected.clear();
    lastClickedId = null;
    repaintSelection();
    updateSelectionUi();
  };

  updateSelectionUi();
}

// ── Selección ────────────────────────────────────────────────────────────────

// shift+click marca el rango desde la última tarjeta que se tocó a mano. Con el
// Set y el array ordenado sale de dos índices, sin tocar el DOM de por medio.
function toggleSelection(id, { range = false } = {}) {
  const r = rowById.get(id);
  if (!r) return;
  if (range && lastClickedId && lastClickedId !== id) {
    const desde = visible.findIndex(x => x.id === lastClickedId);
    const hasta = visible.findIndex(x => x.id === id);
    if (desde >= 0 && hasta >= 0) {
      const [a, b] = desde < hasta ? [desde, hasta] : [hasta, desde];
      for (let i = a; i <= b; i++) selected.add(visible[i].id);
      lastClickedId = id;
      repaintSelection();
      updateSelectionUi();
      return;
    }
  }
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  lastClickedId = id;
  markCard(id);
  updateSelectionUi();
}

function markCard(id) {
  paintCardSelection(
    document.querySelector(`#sc-list .sc-card[data-id="${CSS.escape(id)}"]`),
    selected.has(id),
  );
}

// Solo repinta el estado de las tarjetas que existen: las de los lotes que
// falten nacen ya marcadas, porque renderCard lee del Set.
function repaintSelection() {
  document.querySelectorAll('#sc-list .sc-card').forEach(card => {
    paintCardSelection(card, selected.has(card.dataset.id));
  });
}

function selectedRows() {
  if (!state) return [];
  return state.rows.filter(r => selected.has(r.id));
}

function updateSelectionUi() {
  const bar = document.getElementById('sc-actionbar');
  const n = selected.size;
  if (bar) {
    bar.style.display = n > 0 ? '' : 'none';
    const count = document.getElementById('sc-sel-count');
    // Cuenta del Set, no de los checkboxes pintados.
    if (count) count.textContent = `${n} seleccionada${n === 1 ? '' : 's'}`;
  }
  const selAll = document.getElementById('sc-sel-all');
  if (selAll) {
    selAll.disabled = visible.length === 0;
    const todas = visible.length > 0 && n >= visible.length && visible.every(r => selected.has(r.id));
    selAll.textContent = todas ? 'Quitar selección' : 'Seleccionar todas';
  }
}

// ── Handlers de tarjeta ──────────────────────────────────────────────────────

async function onPlayClick(r) {
  // getPreview tal cual: la verificación título+artista de v=125 vive ahí
  // dentro y es la que garantiza que suene ESTA canción.
  //
  // Van TODOS los artistas del track, no solo el primero. Es el mismo arreglo
  // de v=142 que ya tenían `#skips` y `#zeroplays`, y que acá se había quedado
  // sin aplicar: con el match contra un solo nombre, un tema acreditado al
  // intérprete equivocado —Schubert antes que Evgeny Kissin— no matcheaba en
  // ningún proveedor y se iba al embed de Spotify, que no puede autoarrancar.
  const res = await togglePreview(`sc:${r.id}`, () => getPreview({
    name: r.name,
    artists: r.artistList,
    artist: r.artist,
    spotifyId: r.trackId || undefined,
  }));
  if (res === null) showToast(`Sin preview disponible de «${r.name}»`, 'info');
}

// La ficha del tema salía de hacer click en el bloque de texto de la tarjeta.
// Ahora ese click selecciona, así que la ficha vive SOLO en su botón.
function onCardClick(r) {
  if (!r.trackId) return;
  openTrackCard({ id: r.trackId, name: r.name, artists: r.artistList || [r.artist], album: r.album, img: r.coverSmall || r.cover });
}

function onHideClick(r) {
  const hadHidden = hidden.size > 0;
  const wasShowingHidden = showingHidden;
  hidden.toggle(r.id, r.uri || null);
  selected.delete(r.id);
  if (showingHidden && hidden.size === 0) showingHidden = false;
  // Si aparece o desaparece el botón "Ocultas (N)", o si se sale sola de la
  // vista de ocultas, hay que repintar la cabecera entera (los contadores
  // cambian). Si no, alcanza con sacar la fila del array y repintar la lista
  // conservando el scroll y lo que ya estaba pintado.
  const structural = ((hidden.size > 0) !== hadHidden) || (showingHidden !== wasShowingHidden);
  if (structural) { renderResults(); return; }
  updateSummary();
  applyRows({ preserveRendered: true });
}

// ── Sacar de tus me gusta ────────────────────────────────────────────────────
//
// Es la única acción de esta vista que BORRA algo en Spotify, así que:
//   - confirmModal SIEMPRE, diciendo cuántas canciones. Sin «no volver a
//     preguntar»: el día que el checkbox esté marcado y el click sea el
//     equivocado, no hay deshacer.
//   - el DELETE va por `removeLikedTracks` (api.js), que es quien sabe que
//     `DELETE /me/library` lleva las uris por QUERY y admite 40 por llamada, y
//     chunkea solo.
//
// Sobre el caché de likes: se ACTUALIZA EN MEMORIA (removeLikedTracks llama a
// removeFromLikesCache, que filtra los ids del array cacheado y lo reescribe),
// no se fuerza una re-descarga. Dos motivos:
//   1. La regla de v=130 es que `all_liked_tracks` es o completo o no existe.
//      Invalidarlo dejaría a la app SIN likes hasta que alguien vuelva a bajar
//      las ~9.500 canciones (~190 requests, 2-4 min), y mientras tanto todas
//      las vistas que lo leen se ven vacías. Filtrar el array cacheado mantiene
//      el invariante: sigue siendo la biblioteca entera, con N menos.
//   2. Spotify tiene consistencia eventual en `/me/tracks`: re-bajar justo
//      después de un DELETE devuelve, a veces, las canciones que acabás de
//      sacar — y ahí sí quedaría un caché completo pero MAL.
async function sacarDeLikes(rows) {
  const conId = rows.filter(r => r.trackId);
  if (!conId.length) {
    showToast('Ninguna de las canciones seleccionadas tiene id de Spotify', 'error');
    return;
  }
  const n = conId.length;
  const sinId = rows.length - n;
  const detalle = n === 1
    ? `«${escapeHtml(conId[0].name)}» — ${escapeHtml(conId[0].artists)}`
    : `${n} canciones`;
  const ok = await confirmModal(
    'Sacar de tus me gusta',
    `Vas a sacar <strong>${detalle}</strong> de tus me gusta en Spotify.` +
    `${sinId ? ` (${sinId} sin id de Spotify quedan fuera.)` : ''}` +
    ` Esto BORRA el like: para recuperarlo hay que volver a darle al corazón a mano.`,
    n === 1 ? 'Sacar de likes' : `Sacar las ${n}`,
  );
  if (!ok) return;

  const ids = conId.map(r => r.trackId);
  try {
    // Borra Y verifica; si no se puede verificar, tira y cae en el catch.
    await borrarLikesVerificado(ids, {
      origen: '#sin-clasificar',
      removeLikedTracks,
      checkLibraryContains,
      // Sacar de likes una canción que no está en ninguna playlist no es
      // deduplicar: no hay «otra versión» que deba sobrevivir, y el usuario
      // pide justamente que no quede ninguna.
      guarda: 'ninguna',
      motivoSinGuarda: 'no es un dedup: se saca de likes una canción sin playlist, y quedarse en cero copias es el resultado buscado',
    });
  } catch (e) {
    showToast('No se pudieron sacar de likes: ' + e.message, 'error');
    return;
  }
  showToast(n === 1
    ? `«${conId[0].name}» ya no está en tus me gusta`
    : `${n} canciones fuera de tus me gusta`, 'success');

  // Las filas salen de la lista sin repintar la vista: `applyRows` pasa por
  // setItems() y conserva el scroll y lo ya pintado, que es lo que hace que
  // sacar la tarjeta 900 no te devuelva al principio.
  const fuera = new Set(conId.map(r => r.id));
  state.rows = state.rows.filter(r => !fuera.has(r.id));
  state.likesCount = Math.max(0, state.likesCount - n);
  for (const id of fuera) selected.delete(id);
  lastClickedId = null;
  updateSummary();
  applyRows({ preserveRendered: true });
}

// El número grande y su leyenda, sin repintar la vista entera (que devolvería
// al usuario al primer lote).
function updateSummary() {
  if (!state) return;
  const c = document.getElementById('sc-content');
  const n = c?.querySelector('.sc-summary-n');
  if (n) n.textContent = state.rows.reduce((acc, x) => acc + (hidden.has(x.id) ? 0 : 1), 0).toLocaleString('es-ES');
  const t = c?.querySelector('.sc-summary-t');
  if (t) {
    const oc = hidden.size;
    t.textContent = `canciones sin clasificar de ${state.likesCount.toLocaleString('es-ES')} likes${oc > 0 ? ` · ${oc.toLocaleString('es-ES')} oculta${oc === 1 ? '' : 's'}` : ''}`;
  }
}

// Cambió el filtro o el orden: la lista se recalcula y pasa por setItems(), sin
// tocar el DOM a mano. Si el resultado queda vacío hay que repintar la vista
// entera, porque el mensaje de "nada coincide" ocupa el lugar del grid.
function refreshList() {
  if (filtered().length === 0 || !document.getElementById('sc-list')) { renderResults(); return; }
  applyRows();
}

// Sincroniza los botones con el player global: cuál es el preview actual y si
// está SONANDO (▶ ↔ ⏸). Lo dispara `ui/preview-player.js` desde los eventos del
// <audio>, así que no hay flag ni timer que se pueda desfasar del sonido.
document.addEventListener('previewchange', (e) => {
  paintPlayingCard(document.getElementById('sc-list'), 'sc', e.detail);
});

// ── Modal "Añadir a…" ────────────────────────────────────────────────────────

// `rows` puede ser una sola canción (botón de la tarjeta) o la selección
// múltiple. En los dos casos es el mismo modal de checkboxes y un POST por
// playlist marcada.
// Botón ↻ del modal: vuelve a pedir las playlists propias saltándose los cachés
// y actualiza el estado de la vista. No re-dispara el cruce — una playlist recién
// creada entra en el escaneo la próxima vez que se escanee.
async function recargarPlaylists() {
  const own = await getOwnPlaylists({ force: true });
  if (!state) return own;
  state.ownPlaylists = own;
  return own.filter(p => !state.excluded.has(p.id));
}

function openAddModal(rows) {
  const opciones = state.ownPlaylists.filter(p => !state.excluded.has(p.id));
  const conUri = rows.filter(r => r.uri);
  const sinUri = rows.length - conUri.length;

  if (!conUri.length) {
    showToast('Ninguna de las canciones seleccionadas tiene URI de Spotify', 'error');
    return;
  }

  const subtitulo = rows.length === 1
    ? `${rows[0].name} — ${rows[0].artists}`
    : `${conUri.length} canciones${sinUri ? ` (${sinUri} sin URI de Spotify quedan fuera)` : ''}`;

  openPlaylistPicker({
    id: 'sc-add',
    title: rows.length === 1 ? 'Añadir a playlists' : 'Añadir la selección a playlists',
    subtitle: subtitulo,
    playlists: opciones,
    onReload: recargarPlaylists,
    onConfirm: async (elegidas, { setStatus } = {}) => {
      const res = await addUrisToPlaylists(conUri.map(r => r.uri), elegidas, {
        appendItems: conUri.map(r => ({
          id: r.trackId, uri: r.uri, name: r.name, artists: r.raw?.artists || [],
        })),
        namesByUri: new Map(conUri.map(r => [r.uri, r.name])),
        onStatus: setStatus,
      });

      toastAddResult(res, {
        what: rows.length === 1 ? `«${rows[0].name}»` : `${conUri.length} canciones`,
        plural: rows.length !== 1,
      });

      // Salen de la lista si se añadieron a AL MENOS una playlist — o si ya
      // estaban en alguna de las elegidas, que para esta vista (likes que no
      // están en ninguna playlist) significa exactamente lo mismo. Si no entró
      // en ninguna, el toast de arriba ya lo contó y no hay nada que sacar.
      if (!res.ok.length && !res.skipped.length) return;
      // El modal se cierra al confirmar y esto sigue corriendo: para cuando
      // termina, el usuario puede haberse ido de la vista y `state` ya no
      // existe. El toast del resultado real salió igual, que es lo que importa.
      if (!state) return;

      const fuera = new Set(conUri.map(r => r.id));
      state.rows = state.rows.filter(r => !fuera.has(r.id));
      for (const id of fuera) selected.delete(id);
      await patchCross(conUri);
      // Conservando el scroll y lo pintado: añadir desde la tarjeta 900 no
      // puede devolver al usuario al principio de la lista.
      updateSummary();
      applyRows({ preserveRendered: true });
    },
  });
}

// El cruce cacheado tiene que reflejar que estas canciones ya están en alguna
// playlist; si no, el próximo escaneo las volvería a listar hasta vencer el TTL.
async function patchCross(rows) {
  try {
    const cross = await idbGetCached(CROSS_KEY);
    if (!cross) return;
    const ids = new Set(cross.ids);
    const keys = new Set(cross.keys);
    for (const r of rows) {
      if (r.trackId) ids.add(r.trackId);
      const k = fallbackKey(r.name, r.artist);
      if (k) keys.add(k);
    }
    cross.ids = [...ids];
    cross.keys = [...keys];
    await idbSetCached(CROSS_KEY, cross, CROSS_TTL_MIN);
  } catch { /* el cruce se rehará al vencer el TTL */ }
}

// ── Modal de playlists ignoradas ─────────────────────────────────────────────

function openExcludedModal() {
  const overlay = openModal({
    id: 'sc-excluded',
    html: `
      <div class="modal sc-modal">
        <div class="sc-modal-head">
          <h2 style="margin:0">Playlists ignoradas</h2>
          <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar" aria-label="Cerrar">✕</button>
        </div>
        <p class="sc-modal-sub">Las marcadas no cuentan para el cruce: una canción que esté solo en ellas sigue apareciendo como sin clasificar.</p>
        <div class="sc-pl-list" id="sc-ex-list">
          ${state.ownPlaylists.map(p => `
            <label class="sc-ex-item">
              <input type="checkbox" data-id="${p.id}"${state.excluded.has(p.id) ? ' checked' : ''}>
              ${p.image ? `<img src="${p.image}" alt="" loading="lazy">` : `<span class="sc-pl-ph">♪</span>`}
              <span class="sc-pl-name">${escapeHtml(p.name)}</span>
            </label>
          `).join('')}
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" data-close-modal>Cancelar</button>
          <button class="btn btn-primary" id="sc-ex-save">Guardar y recalcular</button>
        </div>
      </div>
    `,
  });

  overlay.querySelector('#sc-ex-save').onclick = async () => {
    const nueva = new Set();
    overlay.querySelectorAll('#sc-ex-list input[type=checkbox]').forEach(cb => {
      if (cb.checked) nueva.add(cb.dataset.id);
    });
    const igual = nueva.size === state.excluded.size && [...nueva].every(id => state.excluded.has(id));
    state.excluded = nueva;
    saveExcluded(nueva);
    closeTop();
    if (igual) return;
    document.getElementById('sc-content').innerHTML = `
      <div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Recalculando el cruce…</div></div>
    `;
    await load({ force: true });
  };
}
