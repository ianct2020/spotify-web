// Vista "Mis tapas" (#covers): mosaico denso de las tapas que Ian escuchó
// de verdad (history-listened-albums.json) más las que tiene en su playlist
// "w three". Nada inferido — solo estas dos fuentes.
//
// v=116: dedup canónica compartida (util/album-key.js) que ignora
// diacríticos y sufijos "(Remastered)" etc. — antes álbumes iguales aparecían
// duplicados. Rescate de tapas W-Three-only vía oEmbed cuando no hay img.
// Carga progresiva del primer viewport con fetchpriority=high + fade
// placeholder→img. Botón "Pantalla completa" (Fullscreen API) que oculta
// sidebar/header/toolbar y recalcula el lado.

import { loadListenedAlbums, isOwner, ownerLockedMessage } from './history-data.js?v=119';
import { getAllPlaylistItems } from '../api.js?v=119';
import { escapeHtml, pageHeader } from '../ui/components.js?v=119';
import { openAlbumCard } from './album-card.js?v=119';
import { albumKey } from '../util/album-key.js?v=119';

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
// escucha), min (suma de minutos), years (Set de años en que se escuchó) y
// sources (Set con 'listened' / 'wthree').
function buildList(data, wthreeItems) {
  const map = new Map();

  for (const y of (data?.years || [])) {
    const yn = Number(y.year) || null;
    for (const a of (y.albums || [])) {
      const k = albumKey(a.name, a.artist);
      const prev = map.get(k);
      if (prev) {
        prev.min += (a.min_that_day || 0);
        if ((a.date || '') && (!prev.date || a.date < prev.date)) prev.date = a.date;
        if (!prev.img && a.img) prev.img = a.img;
        if (yn) prev.years.add(yn);
      } else {
        map.set(k, {
          name: a.name || '',
          artist: a.artist || '',
          img: a.img || '',
          date: a.date || '',
          min: a.min_that_day || 0,
          years: new Set(yn ? [yn] : []),
          sources: new Set(['listened']),
          trackId: null,
        });
      }
    }
  }

  if (Array.isArray(wthreeItems)) {
    for (const it of wthreeItems) {
      const t = it?.item || it?.track;
      if (!t || !t.album) continue;
      const albumName = t.album.name || '';
      const artistName = t.artists?.[0]?.name || '';
      if (!albumName) continue;
      const k = albumKey(albumName, artistName);
      const wImg = t.album.images?.[1]?.url || t.album.images?.[0]?.url || '';
      const prev = map.get(k);
      if (prev) {
        prev.sources.add('wthree');
        if (!prev.img && wImg) prev.img = wImg;
        if (!prev.trackId) prev.trackId = t.id || null;
      } else {
        map.set(k, {
          name: albumName,
          artist: artistName,
          img: wImg,
          date: '',
          min: 0,
          years: new Set(),
          sources: new Set(['wthree']),
          trackId: t.id || null,
        });
      }
    }
  }

  return [...map.values()].map(a => ({
    ...a,
    years: [...a.years].sort((x, y) => x - y),
    sources: [...a.sources],
  }));
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
function firstViewportCount(cellSize, gridWidth, viewportHeight, gridTop) {
  const s = Math.max(1, cellSize);
  const cols = Math.max(1, Math.floor((gridWidth + GRID_GAP) / (s + GRID_GAP)));
  const availH = Math.max(200, viewportHeight - gridTop);
  const rows = Math.max(1, Math.ceil((availH + GRID_GAP) / (s + GRID_GAP)));
  return cols * rows;
}

function cellHtml(a, i, hi) {
  const initial = escapeHtml(((a.artist || a.name || '?')[0] || '?').toUpperCase());
  const eager = hi ? ' fetchpriority="high"' : '';
  const loading = hi ? '' : ' loading="lazy"';
  return `<button type="button" class="cover-cell" data-i="${i}">
    ${a.img
      ? `<img class="cover-img" src="${a.img}" alt="" decoding="async"${eager}${loading}>`
      : `<div class="cover-fallback">${initial}</div>`}
  </button>`;
}

// oEmbed de Spotify — nos permite recuperar la tapa de un track sin auth.
// Cache en memoria para no repetir la misma tapa entre re-renders.
const oembedCache = new Map();
async function tapaViaOembed(trackId) {
  if (!trackId) return null;
  if (oembedCache.has(trackId)) return oembedCache.get(trackId);
  try {
    const url = `https://open.spotify.com/oembed?url=spotify:track:${trackId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const t = j?.thumbnail_url || null;
    oembedCache.set(trackId, t);
    return t;
  } catch {
    oembedCache.set(trackId, null);
    return null;
  }
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

  const allAlbums = buildList(data, wthreeItems);
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
    return albumKey(t.album.name, t.artists?.[0]?.name || '');
  }).filter(Boolean)).size : 0;

  const missingImgs = allAlbums.filter(a => !a.img).length;
  const sourcesLine = wthreeItems
    ? `<span class="covers-summary-sub">${allAlbums.length.toLocaleString('es-ES')} tapas · ${wthreeCount} en W-Three${missingImgs ? ` · ${missingImgs} sin tapa` : ''}</span>`
    : `<span class="covers-summary-sub">${allAlbums.length.toLocaleString('es-ES')} tapas</span>`;

  content.innerHTML = `
    <div class="covers-narrow-hint">Vista pensada para pantalla grande — mejor en escritorio.</div>
    <div class="covers-toolbar">
      <div class="covers-summary">
        <span id="covers-count">${allAlbums.length.toLocaleString('es-ES')}</span> álbumes
        ${sourcesLine}
      </div>
      <div class="covers-controls">
        <button type="button" class="covers-btn covers-fit-btn" id="covers-fit">Ajustar a pantalla</button>
        <button type="button" class="covers-btn" id="covers-fullscreen" title="Ver el mosaico a pantalla completa">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>
          Pantalla completa
        </button>
        <div class="covers-control-group" role="radiogroup" aria-label="Tamaño de tapa">
          <button type="button" class="covers-btn ${size === '28' ? 'is-on' : ''}" data-size="28">Mini</button>
          <button type="button" class="covers-btn ${size === '48' ? 'is-on' : ''}" data-size="48">Chico</button>
          <button type="button" class="covers-btn ${size === '64' ? 'is-on' : ''}" data-size="64">Medio</button>
          <button type="button" class="covers-btn ${size === '96' ? 'is-on' : ''}" data-size="96">Grande</button>
        </div>
        <select class="covers-select" id="covers-sort" aria-label="Ordenar por">
          <option value="date-asc" ${sort === 'date-asc' ? 'selected' : ''}>Por fecha (más antigua primero)</option>
          <option value="min-desc" ${sort === 'min-desc' ? 'selected' : ''}>Por minutos escuchados</option>
          <option value="artist-asc" ${sort === 'artist-asc' ? 'selected' : ''}>Por artista (A–Z)</option>
        </select>
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

  // Render de golpe: TODAS las celdas en el DOM desde el primer frame. Las
  // primeras N (viewport visible) llevan fetchpriority=high; el resto va con
  // loading=lazy para que el browser descargue el fondo sin bloquear.
  function fullRender() {
    const t0 = performance.now();
    const cellSize = parseInt(size, 10) || 28;
    const rect = grid.getBoundingClientRect();
    const hiCount = firstViewportCount(cellSize, Math.floor(rect.width || window.innerWidth), window.innerHeight, rect.top || 100);

    grid.innerHTML = currentList.map((a, i) => cellHtml(a, i, i < hiCount)).join('');
    countEl.textContent = currentList.length.toLocaleString('es-ES');
    window.__coversLastRender = null;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      const tLayout = performance.now() - t0;
      console.log(`[covers] ${currentList.length} celdas en DOM en ${tLayout.toFixed(1)}ms (size=${size}px, hi=${hiCount})`);

      const imgs = grid.querySelectorAll('img.cover-img');
      const total = imgs.length;
      if (total === 0) {
        window.__coversLastRender = { layoutMs: tLayout, imgsMs: 0, cells: currentList.length, imgs: 0, viewportMs: 0, viewportImgs: 0 };
        return;
      }

      // Fade placeholder → img: apenas carga cada <img>, le agrego .is-loaded
      // para que el CSS haga el fade corto.
      let done = 0;
      let viewportDone = 0;
      const viewportTarget = Math.min(hiCount, total);
      let viewportMs = 0;
      const markLoaded = (img) => {
        if (!img.classList.contains('is-loaded')) img.classList.add('is-loaded');
      };
      const finish = (img, idx) => {
        markLoaded(img);
        done++;
        if (idx < viewportTarget) {
          viewportDone++;
          if (viewportDone === viewportTarget) {
            viewportMs = performance.now() - t0;
            console.log(`[covers] primer viewport: ${viewportTarget} imágenes en ${viewportMs.toFixed(0)}ms`);
          }
        }
        if (done === total) {
          const tImgs = performance.now() - t0;
          console.log(`[covers] ${total} imágenes cargadas en ${tImgs.toFixed(0)}ms`);
          window.__coversLastRender = { layoutMs: tLayout, imgsMs: tImgs, cells: currentList.length, imgs: total, viewportMs, viewportImgs: viewportTarget };
        }
      };
      imgs.forEach((img, idx) => {
        if (img.complete && img.naturalWidth) finish(img, idx);
        else {
          img.addEventListener('load', () => finish(img, idx), { once: true });
          img.addEventListener('error', () => finish(img, idx), { once: true });
        }
      });
    }));
  }

  fullRender();

  // Rescate de tapas vía oEmbed para álbumes que quedaron sin img (típicamente
  // W-Three-only sin album.images completo). Corre en background, best-effort:
  // resuelve una por una y patchea el DOM cuando llega. Limitado a los primeros
  // 60 para no saturar oEmbed en cada visita.
  (async () => {
    const missing = currentList
      .map((a, i) => ({ a, i }))
      .filter(x => !x.a.img && x.a.trackId)
      .slice(0, 60);
    if (!missing.length) return;
    console.log(`[covers] rescatando ${missing.length} tapas vía oEmbed`);
    let rescued = 0;
    for (const { a, i } of missing) {
      const url = await tapaViaOembed(a.trackId);
      if (!url) continue;
      a.img = url;
      const cell = grid.querySelector(`.cover-cell[data-i="${i}"]`);
      if (!cell) continue;
      cell.innerHTML = `<img class="cover-img" src="${url}" alt="" decoding="async" loading="lazy">`;
      const img = cell.querySelector('img');
      img?.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
      img?.addEventListener('error', () => img.classList.add('is-loaded'), { once: true });
      rescued++;
    }
    console.log(`[covers] oEmbed: ${rescued}/${missing.length} tapas recuperadas`);
  })();

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
    openAlbumCard({ name: a.name, artist: a.artist, img: a.img, plays: 0, min: a.min });
  });

  grid.addEventListener('error', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('cover-img')) {
      const cell = e.target.closest('.cover-cell');
      if (!cell) return;
      const idx = +cell.dataset.i;
      const a = currentList[idx];
      const initial = escapeHtml(((a?.artist || a?.name || '?')[0] || '?').toUpperCase());
      e.target.remove();
      const fb = document.createElement('div');
      fb.className = 'cover-fallback';
      fb.textContent = initial;
      cell.insertBefore(fb, cell.firstChild);
    }
  }, true);

  let currentIdx = -1;
  grid.addEventListener('pointermove', (e) => {
    const btn = e.target.closest('.cover-cell');
    if (!btn) {
      if (currentIdx !== -1) { tooltip.classList.remove('is-on'); currentIdx = -1; }
      return;
    }
    const idx = +btn.dataset.i;
    if (idx !== currentIdx) {
      currentIdx = idx;
      const a = currentList[idx];
      if (!a) return;
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
  });

  return () => {
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.body.classList.remove('covers-fs');
    clearTimeout(resizeTimer);
    tooltip.remove();
    if (document.fullscreenElement === gridWrap) document.exitFullscreen?.().catch(() => {});
  };
}
