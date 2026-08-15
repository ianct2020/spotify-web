// Vista "Mis tapas" (#covers): mosaico denso de las tapas que Ian escuchó
// de verdad (history-listened-albums.json) más las que tiene en su playlist
// "w three". Nada inferido — solo estas dos fuentes.
//
// v=116: dedup canónica compartida (util/album-key.js) que ignora
// diacríticos y sufijos "(Remastered)" etc. — antes álbumes iguales aparecían
// duplicados. Carga progresiva del primer viewport con fetchpriority=high + fade
// placeholder→img. Botón "Pantalla completa" (Fullscreen API) que oculta
// sidebar/header/toolbar y recalcula el lado.

import { loadListenedAlbums, isOwner, ownerLockedMessage } from './history-data.js?v=142';
import { isJunkTrack } from '../util/junk.js?v=142';
import { getAllPlaylistItems, getBestAvailableLikes } from '../api.js?v=142';
import { escapeHtml, pageHeader } from '../ui/components.js?v=142';
import { openAlbumCard } from './album-card.js?v=142';
import { albumKey, coverId } from '../util/album-key.js?v=142';
import { buildAlbumStatsIndex } from '../util/album-stats.js?v=142';
import { getPreview } from '../api/preview-providers.js?v=142';
import { hoverIn, hoverOut } from '../ui/preview-player.js?v=142';

const LS_KEY_SIZE = 'covers_cell_size';
const LS_KEY_SORT = 'covers_sort_mode';
const LS_KEY_YEARS = 'covers_years_selected_v2';
const LS_WTHREE_ID = 'wthree_playlist_id';

const VALID_SIZES = new Set(['28', '48', '64', '96']);
const VALID_SORTS = new Set(['date-asc', 'min-desc', 'artist-asc']);
const GRID_GAP = 2;

function getSize() {
  const v = localStorage.getItem(LS_KEY_SIZE);
  return VALID_SIZES.has(v) ? v : '28';
}
function setSize(v) { if (VALID_SIZES.has(v)) localStorage.setItem(LS_KEY_SIZE, v); }
function getSort() {
  const v = localStorage.getItem(LS_KEY_SORT);
  return VALID_SORTS.has(v) ? v : 'date-asc';
}
function setSort(v) { if (VALID_SORTS.has(v)) localStorage.setItem(LS_KEY_SORT, v); }
function getYearsSel() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY_YEARS));
    if (Array.isArray(raw)) return new Set(raw.map(Number).filter(Number.isFinite));
  } catch { /* empty = todos */ }
  return new Set();
}
function setYearsSel(sel) {
  try { localStorage.setItem(LS_KEY_YEARS, JSON.stringify([...sel])); } catch { /* full */ }
}

// Aplana history-listened-albums.json y mergea la playlist W-Three (si hay).
// Devuelve la lista de álbumes únicos con: name, artist, img, date (primera
// escucha), plays y min REALES (del historial completo, ver util/album-stats.js),
// years (Set de años en que se escuchó) y sources (Set 'listened' / 'wthree').
//
// `stats` es el índice albumKey → {plays, ms}. Puede venir vacío (BYOH con un
// JSON v3, o usuario sin historial): en ese caso plays y min quedan en 0 y la
// ficha muestra "sin datos de escucha", que es honesto. Los `min_that_day` de
// listened-albums NO se usan como número de minutos: son los del primer día que
// el álbum cumplió el umbral, no el total, y sumarlos entre entradas no
// significa nada (eso era el "20m" de VULTURES 1).
function buildList(data, wthreeItems, stats) {
  const map = new Map();

  for (const y of (data?.years || [])) {
    const yn = Number(y.year) || null;
    for (const a of (y.albums || [])) {
      const k = albumKey(a.name, a.artist);
      const prev = map.get(k);
      if (prev) {
        if ((a.date || '') && (!prev.date || a.date < prev.date)) prev.date = a.date;
        if (!prev.img && a.img) prev.img = a.img;
        if (yn) prev.years.add(yn);
      } else {
        const t = stats?.get(k);
        map.set(k, {
          name: a.name || '',
          artist: a.artist || '',
          img: a.img || '',
          date: a.date || '',
          // Del índice, no del min_that_day. Una sola vez por clave: el índice
          // ya trae el total del álbum, sumarlo por cada año lo multiplicaría.
          plays: t?.plays || 0,
          min: t ? t.ms / 60000 : 0,
          years: new Set(yn ? [yn] : []),
          sources: new Set(['listened']),
        });
      }
    }
  }

  if (Array.isArray(wthreeItems)) {
    for (const it of wthreeItems) {
      const t = it?.item || it?.track;
      if (!t || !t.album) continue;
      if (isJunkTrack(t.name, t.artists?.[0]?.name)) continue;  // v=126
      const albumName = t.album.name || '';
      const artistName = t.artists?.[0]?.name || '';
      if (!albumName) continue;
      const k = albumKey(albumName, artistName);
      const wImg = t.album.images?.[1]?.url || t.album.images?.[0]?.url || '';
      const prev = map.get(k);
      if (prev) {
        prev.sources.add('wthree');
        if (!prev.img && wImg) prev.img = wImg;
      } else {
        const t = stats?.get(k);
        map.set(k, {
          name: albumName,
          artist: artistName,
          img: wImg,
          date: '',
          plays: t?.plays || 0,
          min: t ? t.ms / 60000 : 0,
          years: new Set(),
          sources: new Set(['wthree']),
        });
      }
    }
  }

  // ── 2.º pase de dedup: por TAPA ──────────────────────────────────────────
  //
  // v=127. La clave canónica compara nombre+artista, y eso deja pasar el caso
  // más visible del mosaico: el mismo álbum acreditado a artistas distintos.
  // El export del historial guarda como "artist" el principal del track que
  // sonó, así que un disco colaborativo entra varias veces:
  //   "$ome $exy $ongs 4 U" / Drake   +   "$ome $exy $ongs 4 U" / PARTYNEXTDOOR
  //   "POMPEII // UTILITY" / Earl Sweatshirt  +  … / MIKE
  //   "East of Underground" aparecía CUATRO veces con 4 artistas distintos.
  // También junta singles que reusan el arte del álbum y recopilatorios con la
  // misma portada.
  //
  // Para una vista que es literalmente un collage de imágenes, "misma tapa" ES
  // "misma celda": si el hash de la imagen coincide, el píxel resultante es
  // idéntico y el usuario lo lee como repetido. Por eso acá deduplicamos por
  // coverId y no por nombre — es la señal que se corresponde con lo que se ve.
  const byCover = new Map();
  const out = [];
  for (const a of map.values()) {
    const cid = coverId(a.img);
    const prev = cid ? byCover.get(cid) : null;
    if (prev) {
      // Nos quedamos con la escucha más antigua y sumamos plays, minutos y años.
      // Acá es donde se junta el disco colaborativo partido en dos claves
      // (VULTURES 1 como «¥$» y como «Kanye West»): 109+39 plays y 271+102 min.
      prev.plays += a.plays;
      prev.min += a.min;
      if (a.date && (!prev.date || a.date < prev.date)) prev.date = a.date;
      for (const y of a.years) prev.years.add(y);
      for (const s of a.sources) prev.sources.add(s);
      continue;
    }
    if (cid) byCover.set(cid, a);
    out.push(a);
  }

  return out.map(a => ({
    ...a,
    years: [...a.years].sort((x, y) => x - y),
    sources: [...a.sources],
  }));
}

// ── Hover-play sobre el mosaico (v=142) ─────────────────────────────────────
//
// Al parar el mouse sobre una tapa suena una pista al azar de ESE álbum que
// esté en los me gusta de Ian. El delay lo pone `hoverIn` (400 ms por defecto,
// ui/preview-player.js): sin eso, barrer el mosaico dispararía cien búsquedas.
// Salir de la celda cancela el timer y, si ya había arrancado, corta el audio.
//
// El índice de likes por álbum se arma una sola vez, en el primer hover, y no
// al entrar a la vista: el mosaico ya carga 2.400 tapas y no vale la pena
// competir con eso por nada.
//
// Convive con `lazy-img.js` sin tocarlo: `#covers` no lo usa (pinta las tapas
// con `loading="lazy"` nativo, ver `cellHtml`), y aunque lo usara, el hover
// solo lee `currentList` y reproduce audio — no toca `src` ni `data-src` de
// ninguna <img>, que es lo único que la evicción mira.
let likesPorAlbum = null;
let likesPorAlbumPromise = null;

function indexarLikes(items) {
  // Dos claves por track: el hash de la tapa (identidad real del disco, la
  // misma que dedupea el mosaico) y albumKey(nombre, artista) de respaldo para
  // los likes cuya tapa no coincide con la del historial.
  const idx = new Map();
  const push = (k, v) => {
    if (!k) return;
    const arr = idx.get(k);
    if (arr) { if (!arr.some(x => x.id === v.id)) arr.push(v); }
    else idx.set(k, [v]);
  };
  for (const it of (items || [])) {
    const t = it?.track || it;
    if (!t || !t.name || !t.album) continue;
    if (isJunkTrack(t.name, t.artists?.[0]?.name)) continue;
    const artistas = (t.artists || []).map(x => x.name).filter(Boolean);
    const entry = { id: t.id, name: t.name, artists: artistas };
    for (const im of (t.album.images || [])) push(coverId(im?.url), entry);
    push(`k:${albumKey(t.album.name || '', artistas[0] || '')}`, entry);
  }
  return idx;
}

function ensureLikesPorAlbum() {
  if (likesPorAlbum) return Promise.resolve(likesPorAlbum);
  if (likesPorAlbumPromise) return likesPorAlbumPromise;
  likesPorAlbumPromise = (async () => {
    let idx = new Map();
    try {
      const res = await getBestAvailableLikes();
      idx = indexarLikes(res?.items || []);
      console.info(`[covers] hover-play: ${idx.size} claves de álbum con likes`);
    } catch (e) {
      console.warn('[covers] hover-play: no pude cargar los likes:', e.message);
    }
    // Un índice vacío NO se memoiza: si la caché de likes todavía no estaba, el
    // hover quedaría mudo para toda la sesión aunque los likes lleguen un
    // segundo después (el mismo pozo que tapaba los corazones de W-Three).
    if (idx.size === 0) { likesPorAlbumPromise = null; return idx; }
    likesPorAlbum = idx;
    return idx;
  })();
  return likesPorAlbumPromise;
}

// Una pista al azar de ese álbum que esté en los likes, o null.
async function pistaAlAzarDelAlbum(a) {
  const idx = await ensureLikesPorAlbum();
  const cid = coverId(a.img);
  const cands = (cid && idx.get(cid)) || idx.get(`k:${albumKey(a.name, a.artist)}`) || null;
  if (!cands || !cands.length) return null;
  return cands[Math.floor(Math.random() * cands.length)];
}

function sortList(list, mode) {
  const copy = list.slice();
  if (mode === 'min-desc') copy.sort((x, y) => y.min - x.min);
  else if (mode === 'artist-asc') copy.sort((x, y) =>
    (x.artist || '').localeCompare(y.artist || '', 'es', { sensitivity: 'base' })
    || (x.name || '').localeCompare(y.name || '', 'es', { sensitivity: 'base' })
  );
  else copy.sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999'));
  return copy;
}

function fitCellSize(N, W, H, gap = GRID_GAP) {
  if (!N || W <= 0 || H <= 0) return 96;
  const wPlus = W + gap;
  const hPlus = H + gap;
  for (let s = 200; s >= 8; s--) {
    const cols = Math.floor(wPlus / (s + gap));
    const rows = Math.floor(hPlus / (s + gap));
    if (cols > 0 && rows > 0 && cols * rows >= N) return s;
  }
  return 8;
}

// Estimación: cuántas celdas caben en el primer viewport visible del grid.
// Sirve para saber a cuántas <img> les ponemos fetchpriority=high.
//
// El tope de EAGER_MAX importa. En "Mini" (28px) entran ~714 tapas en el primer
// viewport, y marcarlas todas como high + sin lazy dispara 714 descargas y 714
// decodificaciones a la vez: la red se satura, el hilo principal se va en
// decodificar y los requestAnimationFrame del render por lotes se espacian
// muchísimo (medido: 2,5s hasta el primer frame). Con un tope chico el resto
// entra como loading=lazy y es el navegador el que decide qué bajar según lo
// que de verdad se ve.
const EAGER_MAX = 120;

function firstViewportCount(cellSize, gridWidth, viewportHeight, gridTop) {
  const s = Math.max(1, cellSize);
  const cols = Math.max(1, Math.floor((gridWidth + GRID_GAP) / (s + GRID_GAP)));
  const availH = Math.max(200, viewportHeight - gridTop);
  const rows = Math.max(1, Math.ceil((availH + GRID_GAP) / (s + GRID_GAP)));
  return Math.min(cols * rows, EAGER_MAX);
}

// Toda celda que llega acá tiene tapa: las que no la tienen se filtran antes de
// renderizar (v=127), así que no hay más cuadro-con-inicial en el collage.
function cellHtml(a, i, hi) {
  const eager = hi ? ' fetchpriority="high"' : '';
  const loading = hi ? '' : ' loading="lazy"';
  return `<button type="button" class="cover-cell" data-i="${i}"><img class="cover-img" src="${a.img}" alt="" decoding="async"${eager}${loading}></button>`;
}

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Mis tapas' })}
    <div id="covers-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;
  const content = document.getElementById('covers-content');

  if (!(await isOwner())) {
    content.innerHTML = ownerLockedMessage('Mis tapas');
    return;
  }

  let data;
  try { data = await loadListenedAlbums(); }
  catch (e) {
    content.innerHTML = `<div class="card"><p style="color:var(--color-error)">No pude cargar tus álbumes escuchados: ${escapeHtml(e.message)}</p></div>`;
    return;
  }

  let wthreeItems = null;
  const wthreeId = localStorage.getItem(LS_WTHREE_ID);
  if (wthreeId) {
    try { wthreeItems = await getAllPlaylistItems(wthreeId); }
    catch (e) { console.warn('[covers] no pude cargar W-Three:', e.message); }
  }

  // v=127: las celdas sin tapa mostraban un cuadro gris con la inicial y
  // ensuciaban el collage. Fuera del mosaico y fuera del contador — el número
  // que se muestra es el de tapas que se ven de verdad.
  const built = buildList(data, wthreeItems, await buildAlbumStatsIndex());
  const noCover = built.filter(a => !a.img);
  const allAlbums = built.filter(a => a.img);
  if (noCover.length) {
    console.log(`[covers] ${noCover.length} álbumes sin tapa excluidos del mosaico:`,
      noCover.map(a => `${a.name} — ${a.artist}`).join(' | '));
  }
  if (!allAlbums.length) {
    content.innerHTML = `<div class="card"><p>Todavía no hay álbumes en tu historial. Importa el ZIP de Extended Streaming History desde la barra lateral.</p></div>`;
    return;
  }

  const yearsAvailable = [...new Set(allAlbums.flatMap(a => a.years))].sort((x, y) => x - y);

  let size = getSize();
  let sort = getSort();
  let yearsSel = getYearsSel();
  let fitEnabled = false;
  let isFullscreen = false;

  const wthreeCount = wthreeItems ? new Set(wthreeItems.map(it => {
    const t = it?.item || it?.track;
    if (!t || !t.album) return null;
    if (isJunkTrack(t.name, t.artists?.[0]?.name)) return null;  // v=126
    return albumKey(t.album.name, t.artists?.[0]?.name || '');
  }).filter(Boolean)).size : 0;

  const sinTapa = noCover.length ? ` · ${noCover.length} sin tapa, fuera del mosaico` : '';
  const sourcesLine = wthreeItems
    ? `<span class="covers-summary-sub">Historial de escuchas + playlist w three · ${wthreeCount} en W-Three${sinTapa}</span>`
    : `<span class="covers-summary-sub">Historial de escuchas${sinTapa}</span>`;

  content.innerHTML = `
    <div class="covers-narrow-hint">Vista pensada para pantalla grande — mejor en escritorio.</div>
    <div class="covers-toolbar">
      <div class="covers-summary">
        <span id="covers-count">${allAlbums.length.toLocaleString('es-ES')}</span> álbumes
        ${sourcesLine}
      </div>
      <div class="covers-controls">
        <div class="covers-control-group" aria-label="Vista">
          <button type="button" class="covers-btn covers-fit-btn" id="covers-fit" title="Calcular el lado para que entren todas las tapas sin scroll">Ajustar</button>
          <button type="button" class="covers-btn" id="covers-fullscreen" title="Ver el mosaico a pantalla completa" aria-label="Pantalla completa">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          </button>
        </div>
        <div class="covers-control-group" role="radiogroup" aria-label="Tamaño de tapa">
          <button type="button" class="covers-btn ${size === '28' ? 'is-on' : ''}" data-size="28">Mini</button>
          <button type="button" class="covers-btn ${size === '48' ? 'is-on' : ''}" data-size="48">Chico</button>
          <button type="button" class="covers-btn ${size === '64' ? 'is-on' : ''}" data-size="64">Medio</button>
          <button type="button" class="covers-btn ${size === '96' ? 'is-on' : ''}" data-size="96">Grande</button>
        </div>
        <div class="covers-control-group covers-select-wrap">
          <select class="covers-select" id="covers-sort" aria-label="Ordenar por">
            <option value="date-asc" ${sort === 'date-asc' ? 'selected' : ''}>Más antiguas primero</option>
            <option value="min-desc" ${sort === 'min-desc' ? 'selected' : ''}>Más minutos primero</option>
            <option value="artist-asc" ${sort === 'artist-asc' ? 'selected' : ''}>Artista (A–Z)</option>
          </select>
        </div>
      </div>
    </div>
    <div class="covers-year-chips" id="covers-year-chips" role="group" aria-label="Filtrar por año">
      <button type="button" class="covers-chip ${yearsSel.size === 0 ? 'is-on' : ''}" data-year="all">Todos</button>
      ${yearsAvailable.map(y => `<button type="button" class="covers-chip ${yearsSel.has(y) ? 'is-on' : ''}" data-year="${y}">${y}</button>`).join('')}
    </div>
    <div class="covers-grid-wrap" id="covers-grid-wrap">
      <div class="covers-grid" id="covers-grid" data-size="${size}" style="--cover-min:${size}px;--cover-gap:${GRID_GAP}px"></div>
    </div>
    <div class="covers-tooltip" id="covers-tooltip" role="tooltip" aria-hidden="true">
      <div class="ct-name"></div>
      <div class="ct-artist"></div>
      <div class="ct-year"></div>
    </div>
  `;

  const gridWrap = document.getElementById('covers-grid-wrap');
  const grid = document.getElementById('covers-grid');
  const tooltip = document.getElementById('covers-tooltip');
  const countEl = document.getElementById('covers-count');
  const chipsEl = document.getElementById('covers-year-chips');
  const fitBtn = document.getElementById('covers-fit');
  const fsBtn = document.getElementById('covers-fullscreen');

  let currentList = filterAndSort();

  function filterAndSort() {
    let list = allAlbums;
    if (yearsSel.size > 0) {
      list = list.filter(a => a.years.some(y => yearsSel.has(y)));
    }
    return sortList(list, sort);
  }

  // Render por lotes — "persiana".
  //
  // v=115 había sacado el IntersectionObserver y pasado a inyectar las ~2.400
  // celdas de una sola vez. Eso construye 2.400 <button> + 2.400 <img> en un
  // único task de JS y fuerza un layout gigante: el hilo principal se bloquea
  // varios segundos y la vista se siente colgada al entrar.
  //
  // v=127 vuelve a inyectar en lotes, pero sin observer: un lote de 100 celdas
  // por frame con requestAnimationFrame. Como el grid llena en orden de
  // documento, el resultado visual es exactamente el que pidió Ian — se llena
  // de izquierda a derecha y de arriba a abajo, como una persiana. Entre lote y
  // lote el navegador puede pintar y atender clics, así que la página responde
  // desde el primer frame.
  //
  // El primer lote va sincrónico para que nunca haya un frame vacío.
  const BATCH = 100;
  let renderToken = 0;
  let imgSettledHandler = null;   // el del render vigente, para poder sacarlo

  function fullRender() {
    const token = ++renderToken;   // invalida los lotes de un render anterior
    // fullRender corre de nuevo con cada cambio de orden o de año. Sin esto los
    // listeners delegados se irían apilando en el mismo #covers-grid y cada uno
    // retendría la lista del render anterior.
    if (imgSettledHandler) {
      grid.removeEventListener('load', imgSettledHandler, true);
      grid.removeEventListener('error', imgSettledHandler, true);
      imgSettledHandler = null;
    }
    const t0 = performance.now();
    const cellSize = parseInt(size, 10) || 28;
    const rect = grid.getBoundingClientRect();
    const hiCount = firstViewportCount(cellSize, Math.floor(rect.width || window.innerWidth), window.innerHeight, rect.top || 100);
    const list = currentList;
    const total = list.length;

    grid.innerHTML = '';
    countEl.textContent = total.toLocaleString('es-ES');
    window.__coversLastRender = null;

    // Fade placeholder → img: apenas carga cada <img> le pongo .is-loaded.
    // Delegado en el grid para no colgar 2 listeners por imagen (con 2.400
    // celdas eso son ~4.800 listeners y se nota).
    let viewportDone = 0;
    const viewportTarget = Math.min(hiCount, total);
    let firstBatchMs = 0;
    let cellsMs = 0;
    let viewportMs = 0;

    const onImgSettled = (e) => {
      const img = e.target;
      if (!img.classList || !img.classList.contains('cover-img')) return;
      if (!img.classList.contains('is-loaded')) img.classList.add('is-loaded');
      const idx = +(img.closest('.cover-cell')?.dataset.i ?? -1);
      if (idx >= 0 && idx < viewportTarget) {
        viewportDone++;
        if (viewportDone === viewportTarget) {
          viewportMs = performance.now() - t0;
          console.log(`[covers] primer viewport (${viewportTarget} tapas) completo en ${viewportMs.toFixed(0)}ms`);
          report();
        }
      }
    };
    imgSettledHandler = onImgSettled;
    grid.addEventListener('load', onImgSettled, true);
    grid.addEventListener('error', onImgSettled, true);

    const report = () => {
      window.__coversLastRender = {
        firstBatchMs, cellsMs, viewportMs,
        cells: total, batch: BATCH, viewportImgs: viewportTarget,
      };
    };

    const inject = (from) => {
      const to = Math.min(from + BATCH, total);
      let html = '';
      for (let i = from; i < to; i++) html += cellHtml(list[i], i, i < hiCount);
      grid.insertAdjacentHTML('beforeend', html);
      return to;
    };

    // Lote 0 sincrónico: contenido en pantalla en el primer frame.
    let next = inject(0);
    requestAnimationFrame(() => {
      firstBatchMs = performance.now() - t0;
      console.log(`[covers] primer frame interactivo en ${firstBatchMs.toFixed(1)}ms (${Math.min(BATCH, total)} de ${total} celdas, size=${size}px)`);
      report();
    });

    // Un lote por frame sería lo más parejo, pero con 24 lotes eso son 24
    // frames como mínimo — y si el navegador está decodificando tapas cada
    // frame se alarga. En vez de eso, cada frame inyecta lotes hasta gastar
    // FRAME_BUDGET_MS y devuelve el hilo. Así el mosaico se completa rápido en
    // una máquina desahogada sin dejar de ceder el control entre medio.
    const FRAME_BUDGET_MS = 8;
    const step = () => {
      if (token !== renderToken) return;          // render cancelado
      const frameStart = performance.now();
      while (next < total && performance.now() - frameStart < FRAME_BUDGET_MS) {
        next = inject(next);
      }
      if (next >= total) {
        cellsMs = performance.now() - t0;
        console.log(`[covers] mosaico completo: ${total} celdas en ${cellsMs.toFixed(1)}ms`);
        report();
        return;
      }
      requestAnimationFrame(step);
    };
    if (next < total) requestAnimationFrame(step);
    else requestAnimationFrame(() => { cellsMs = performance.now() - t0; report(); });
  }

  fullRender();

  function applyFit() {
    const rect = grid.getBoundingClientRect();
    const W = Math.floor(rect.width);
    const H = Math.max(200, Math.floor(window.innerHeight - rect.top - 12));
    const N = currentList.length;
    const s = fitCellSize(N, W, H, GRID_GAP);
    size = String(s);
    grid.dataset.size = size;
    grid.style.setProperty('--cover-min', `${s}px`);
    content.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('is-on', b.dataset.size === size));
    fitBtn.classList.add('is-on');
    console.log(`[covers] ajustar: N=${N} W=${W} H=${H} → lado=${s}px (cols=${Math.floor((W+GRID_GAP)/(s+GRID_GAP))} rows=${Math.ceil(N/Math.floor((W+GRID_GAP)/(s+GRID_GAP)))})`);
  }

  fitBtn.addEventListener('click', () => {
    fitEnabled = true;
    applyFit();
  });

  content.querySelectorAll('[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
      fitEnabled = false;
      fitBtn.classList.remove('is-on');
      size = btn.dataset.size;
      setSize(size);
      grid.dataset.size = size;
      grid.style.setProperty('--cover-min', `${size}px`);
      content.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('is-on', b === btn));
    });
  });

  document.getElementById('covers-sort').addEventListener('change', (e) => {
    sort = e.target.value;
    setSort(sort);
    currentList = filterAndSort();
    fullRender();
    if (fitEnabled) applyFit();
  });

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.covers-chip');
    if (!chip) return;
    const y = chip.dataset.year;
    if (y === 'all') {
      yearsSel = new Set();
    } else {
      const n = Number(y);
      if (yearsSel.has(n)) yearsSel.delete(n);
      else yearsSel.add(n);
    }
    setYearsSel(yearsSel);
    chipsEl.querySelectorAll('.covers-chip').forEach(c => {
      const cy = c.dataset.year;
      const on = cy === 'all' ? yearsSel.size === 0 : yearsSel.has(Number(cy));
      c.classList.toggle('is-on', on);
    });
    currentList = filterAndSort();
    fullRender();
    if (fitEnabled) applyFit();
  });

  let resizeTimer = null;
  const onResize = () => {
    if (!fitEnabled) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyFit, 120);
  };
  window.addEventListener('resize', onResize);

  // ── Fullscreen API ──
  // Entra a fullscreen sobre el grid-wrap. body.covers-fs oculta sidebar,
  // header y toolbar por CSS. Al entrar/salir recalculamos el tamaño para
  // aprovechar el viewport nuevo.
  function enterFullscreen() {
    if (!document.fullscreenEnabled) {
      console.warn('[covers] fullscreen no disponible');
      return;
    }
    gridWrap.requestFullscreen?.().catch(err => console.warn('[covers] fs error:', err.message));
  }
  function exitFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
  }
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) exitFullscreen();
    else enterFullscreen();
  });
  const onFullscreenChange = () => {
    isFullscreen = document.fullscreenElement === gridWrap;
    document.body.classList.toggle('covers-fs', isFullscreen);
    fsBtn.classList.toggle('is-on', isFullscreen);
    // Recalculo el tamaño para el nuevo viewport. Si el user tenía fit activo,
    // lo mantiene; si no, ajusto al fullscreen y al salir vuelvo al size guardado.
    if (fitEnabled) {
      setTimeout(applyFit, 60);
    } else if (isFullscreen) {
      const savedSize = size;
      setTimeout(() => {
        applyFit();
        fitEnabled = false;
        fitBtn.classList.remove('is-on');
        // Marco el size en el que quedó (no lo persisto, solo visual).
        content.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('is-on', b.dataset.size === size));
      }, 60);
      // Guardo el original en el botón para restaurar
      fsBtn.dataset.origSize = savedSize;
    } else {
      // Salimos: vuelvo al size que tenía antes
      const orig = fsBtn.dataset.origSize;
      if (orig && VALID_SIZES.has(orig)) {
        size = orig;
        grid.dataset.size = size;
        grid.style.setProperty('--cover-min', `${size}px`);
        content.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('is-on', b.dataset.size === size));
        delete fsBtn.dataset.origSize;
      }
    }
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);

  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.cover-cell');
    if (!btn) return;
    const idx = +btn.dataset.i;
    const a = currentList[idx];
    if (!a) return;
    openAlbumCard({ name: a.name, artist: a.artist, img: a.img, plays: a.plays, min: a.min });
  });

  // Si una tapa 404ea, sacamos la celda entera en vez de poner el cuadro con la
  // inicial: Ian quiere el collage sin huecos con letras (v=127).
  grid.addEventListener('error', (e) => {
    if (e.target?.classList?.contains('cover-img')) {
      e.target.closest('.cover-cell')?.remove();
    }
  }, true);

  let currentIdx = -1;
  grid.addEventListener('pointermove', (e) => {
    const btn = e.target.closest('.cover-cell');
    if (!btn) {
      if (currentIdx !== -1) { tooltip.classList.remove('is-on'); currentIdx = -1; hoverOut(); }
      return;
    }
    const idx = +btn.dataset.i;
    if (idx !== currentIdx) {
      currentIdx = idx;
      const a = currentList[idx];
      if (!a) return;
      // Hover-play: `hoverIn` ya trae el debounce y cancela el anterior cuando
      // cambia la key, así que pasar de una tapa a otra no encola dos previews.
      // El getter corre recién después del delay: mover el mouse por encima no
      // dispara ninguna búsqueda.
      hoverIn(`cov:${coverId(a.img) || albumKey(a.name, a.artist)}`, async () => {
        const pista = await pistaAlAzarDelAlbum(a);
        if (!pista) return null;
        // Sin spotifyId a propósito: el embed no puede autoarrancar en un
        // iframe cross-origin, así que como hover no sirve para nada. Si no
        // hay audio de iTunes ni de Deezer, el hover se queda callado.
        return await getPreview({ name: pista.name, artists: pista.artists });
      });
      tooltip.querySelector('.ct-name').textContent = a.name || '—';
      tooltip.querySelector('.ct-artist').textContent = a.artist || '';
      const year = (a.date || '').slice(0, 4);
      const yEl = tooltip.querySelector('.ct-year');
      yEl.textContent = year || '';
      yEl.style.display = year ? '' : 'none';
      tooltip.classList.add('is-on');
    }
    const off = 14;
    let x = e.clientX + off;
    let y = e.clientY + off;
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (x + tw + 8 > window.innerWidth) x = e.clientX - tw - off;
    if (y + th + 8 > window.innerHeight) y = e.clientY - th - off;
    tooltip.style.left = Math.max(4, x) + 'px';
    tooltip.style.top = Math.max(4, y) + 'px';
  });
  grid.addEventListener('pointerleave', () => {
    tooltip.classList.remove('is-on');
    currentIdx = -1;
    hoverOut();
  });

  return () => {
    renderToken++;                 // corta los lotes que quedaran en vuelo
    hoverOut();                    // timer de hover-play pendiente, si lo había
    if (imgSettledHandler) {
      grid.removeEventListener('load', imgSettledHandler, true);
      grid.removeEventListener('error', imgSettledHandler, true);
    }
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.body.classList.remove('covers-fs');
    clearTimeout(resizeTimer);
    tooltip.remove();
    if (document.fullscreenElement === gridWrap) document.exitFullscreen?.().catch(() => {});
  };
}
