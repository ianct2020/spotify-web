// Vista "Mis tapas" (#covers): mosaico denso de las tapas que Ian escuchó
// de verdad (history-listened-albums.json) más las que tiene en su playlist
// "w three". Nada inferido — solo estas dos fuentes.
//
// Objetivo v=115: que las ~2411 tapas entren enteras en una pantalla de
// escritorio, como el collage que Ian arma a mano en Canva. Tamaño "mini"
// 28px, botón "Ajustar a pantalla" que calcula el lado óptimo, filtro por
// año multi-selección, tooltip flotante y renderizado de golpe con los
// placeholders visibles desde el primer frame.

import { loadListenedAlbums, isOwner, ownerLockedMessage } from './history-data.js?v=115';
import { getAllPlaylistItems } from '../api.js?v=115';
import { escapeHtml, pageHeader } from '../ui/components.js?v=115';
import { openAlbumCard } from './album-card.js?v=115';

const LS_KEY_SIZE = 'covers_cell_size';
const LS_KEY_SORT = 'covers_sort_mode';
const LS_KEY_YEARS = 'covers_years_selected_v2';
const LS_WTHREE_ID = 'wthree_playlist_id';

const VALID_SIZES = new Set(['28', '48', '64', '96']);
const VALID_SORTS = new Set(['date-asc', 'min-desc', 'artist-asc']);
const GRID_GAP = 2; // px — muy chico para el modo mosaico

const key = (n, a) => `${(n || '').toLowerCase().trim()}||${(a || '').toLowerCase().trim()}`;

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
      const k = key(a.name, a.artist);
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
      const k = key(albumName, artistName);
      const prev = map.get(k);
      if (prev) {
        prev.sources.add('wthree');
        if (!prev.img) prev.img = t.album.images?.[1]?.url || t.album.images?.[0]?.url || '';
      } else {
        map.set(k, {
          name: albumName,
          artist: artistName,
          img: t.album.images?.[1]?.url || t.album.images?.[0]?.url || '',
          date: '',
          min: 0,
          years: new Set(),
          sources: new Set(['wthree']),
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

// Fórmula: floor(W / lado) * floor(H / lado) >= N, con `lado + GAP` porque el
// grid tiene un gap. Busco el lado ENTERO más grande que satisface la
// desigualdad. Rango razonable: 8..200 px.
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

function cellHtml(a, i) {
  const initial = escapeHtml(((a.artist || a.name || '?')[0] || '?').toUpperCase());
  return `<button type="button" class="cover-cell" data-i="${i}">
    ${a.img
      ? `<img class="cover-img" src="${a.img}" alt="" loading="lazy" decoding="async">`
      : `<div class="cover-fallback">${initial}</div>`}
  </button>`;
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

  // W-Three merge — si el usuario tiene la playlist configurada, sumo sus
  // álbumes. Si falla el fetch (offline, 401, etc.) no bloqueo el mosaico.
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

  // Años disponibles (unión de años escuchados) para los chips del filtro.
  const yearsAvailable = [...new Set(allAlbums.flatMap(a => a.years))].sort((x, y) => x - y);

  let size = getSize();
  let sort = getSort();
  let yearsSel = getYearsSel();  // vacío = todos
  let fitEnabled = false;

  const wthreeCount = wthreeItems ? new Set(wthreeItems.map(it => {
    const t = it?.item || it?.track;
    if (!t || !t.album) return null;
    return key(t.album.name, t.artists?.[0]?.name || '');
  }).filter(Boolean)).size : 0;

  const sourcesLine = wthreeItems
    ? `<span class="covers-summary-sub">${allAlbums.length.toLocaleString('es-ES')} tapas · ${wthreeCount} en W-Three</span>`
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
    <div class="covers-grid" id="covers-grid" data-size="${size}" style="--cover-min:${size}px;--cover-gap:${GRID_GAP}px"></div>
    <div class="covers-tooltip" id="covers-tooltip" role="tooltip" aria-hidden="true">
      <div class="ct-name"></div>
      <div class="ct-artist"></div>
      <div class="ct-year"></div>
    </div>
  `;

  const grid = document.getElementById('covers-grid');
  const tooltip = document.getElementById('covers-tooltip');
  const countEl = document.getElementById('covers-count');
  const chipsEl = document.getElementById('covers-year-chips');
  const fitBtn = document.getElementById('covers-fit');

  let currentList = filterAndSort();

  function filterAndSort() {
    let list = allAlbums;
    if (yearsSel.size > 0) {
      list = list.filter(a => a.years.some(y => yearsSel.has(y)));
    }
    return sortList(list, sort);
  }

  // Render de golpe: TODAS las celdas en el DOM desde el primer frame. Con
  // 2411 botones + imgs con loading=lazy el browser hace su parte progresiva.
  // Medimos: (a) tiempo hasta que el layout está pintado, (b) tiempo hasta
  // que todas las imágenes cargaron.
  function fullRender() {
    const t0 = performance.now();
    grid.innerHTML = currentList.map((a, i) => cellHtml(a, i)).join('');
    countEl.textContent = currentList.length.toLocaleString('es-ES');
    window.__coversLastRender = null;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const tLayout = performance.now() - t0;
      console.log(`[covers] ${currentList.length} celdas en DOM en ${tLayout.toFixed(1)}ms (size=${size}px)`);
      // Track image loads
      const imgs = grid.querySelectorAll('img.cover-img');
      const total = imgs.length;
      if (total === 0) {
        window.__coversLastRender = { layoutMs: tLayout, imgsMs: 0, cells: currentList.length, imgs: 0 };
        return;
      }
      let done = 0;
      const finish = () => {
        done++;
        if (done === total) {
          const tImgs = performance.now() - t0;
          console.log(`[covers] ${total} imágenes cargadas en ${tImgs.toFixed(0)}ms`);
          window.__coversLastRender = { layoutMs: tLayout, imgsMs: tImgs, cells: currentList.length, imgs: total };
        }
      };
      imgs.forEach(img => {
        if (img.complete && img.naturalWidth) finish();
        else {
          img.addEventListener('load', finish, { once: true });
          img.addEventListener('error', finish, { once: true });
        }
      });
    }));
  }

  fullRender();

  function applyFit() {
    const rect = grid.getBoundingClientRect();
    const W = Math.floor(rect.width);
    // Alto disponible = desde el top del grid hasta el fondo del viewport,
    // menos un pequeño margen para respirar.
    const H = Math.max(200, Math.floor(window.innerHeight - rect.top - 12));
    const N = currentList.length;
    const s = fitCellSize(N, W, H, GRID_GAP);
    size = String(s);
    grid.dataset.size = size;
    grid.style.setProperty('--cover-min', `${s}px`);
    // Marcado visual de los botones de tamaño: apago si no coincide
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

  // Chips año — click en "Todos" limpia; click en un año togglea (multi-select).
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
    // Refresh chip visual
    chipsEl.querySelectorAll('.covers-chip').forEach(c => {
      const cy = c.dataset.year;
      const on = cy === 'all' ? yearsSel.size === 0 : yearsSel.has(Number(cy));
      c.classList.toggle('is-on', on);
    });
    currentList = filterAndSort();
    fullRender();
    if (fitEnabled) applyFit();
  });

  // Ventana resize → recalcular fit si está activo (debounce 120ms).
  let resizeTimer = null;
  const onResize = () => {
    if (!fitEnabled) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(applyFit, 120);
  };
  window.addEventListener('resize', onResize);

  // Click en una tapa → ficha de álbum apilada.
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.cover-cell');
    if (!btn) return;
    const idx = +btn.dataset.i;
    const a = currentList[idx];
    if (!a) return;
    openAlbumCard({ name: a.name, artist: a.artist, img: a.img, plays: 0, min: a.min });
  });

  // Fallback si una tapa da 404: pinto la inicial en vez del ícono roto.
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

  // Tooltip flotante — reemplaza al overlay hover porque no entra en celdas
  // chicas. Un solo elemento fijo, sigue al puntero.
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

  // Cleanup al salir de la ruta
  return () => {
    window.removeEventListener('resize', onResize);
    clearTimeout(resizeTimer);
    tooltip.remove();
  };
}
