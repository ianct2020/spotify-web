// Vista "Mis tapas" (#covers): grid denso de TODAS las tapas de los álbumes
// que escuchó Ian, desde `history-listened-albums.json` — no llama a Spotify,
// solo lee lo que ya está horneado.
//
// Objetivo: replicar el diseño que Ian arma a mano en Canva pegando tapa por
// tapa. Sin texto entre celdas — el mosaico es el punto.
//
// Rendimiento: son 700+ (potencialmente 2000+) tapas. Renderizo por lotes con
// IntersectionObserver: 200 iniciales + un sentinel al final que dispara el
// próximo lote cuando entra al viewport. `loading="lazy"` en <img> deja al
// browser diferir la descarga.

import { loadListenedAlbums, isOwner, ownerLockedMessage } from './history-data.js?v=114';
import { escapeHtml, pageHeader } from '../ui/components.js?v=114';
import { openAlbumCard } from './album-card.js?v=114';

const LS_KEY_SIZE = 'covers_cell_size';
const LS_KEY_SORT = 'covers_sort_mode';
const VALID_SIZES = new Set(['48', '64', '96']);
const VALID_SORTS = new Set(['date-asc', 'min-desc', 'artist-asc']);
const BATCH_SIZE = 200;

const key = (n, a) => `${(n || '').toLowerCase().trim()}||${(a || '').toLowerCase().trim()}`;

function getSize() {
  const v = localStorage.getItem(LS_KEY_SIZE);
  return VALID_SIZES.has(v) ? v : '64';
}
function setSize(v) { if (VALID_SIZES.has(v)) localStorage.setItem(LS_KEY_SIZE, v); }
function getSort() {
  const v = localStorage.getItem(LS_KEY_SORT);
  return VALID_SORTS.has(v) ? v : 'date-asc';
}
function setSort(v) { if (VALID_SORTS.has(v)) localStorage.setItem(LS_KEY_SORT, v); }

// Aplana todos los años, deduplica por (name||artist), suma minutos, y guarda
// la fecha MÁS ANTIGUA de escucha detectada. Los que no tienen img también se
// muestran — con placeholder con la inicial.
function buildList(data) {
  const map = new Map();
  for (const y of (data?.years || [])) {
    for (const a of (y.albums || [])) {
      const k = key(a.name, a.artist);
      const prev = map.get(k);
      if (prev) {
        prev.min += (a.min_that_day || 0);
        if ((a.date || '') < (prev.date || '9999')) prev.date = a.date;
        if (!prev.img && a.img) prev.img = a.img;
      } else {
        map.set(k, {
          name: a.name || '',
          artist: a.artist || '',
          img: a.img || '',
          date: a.date || '',
          min: a.min_that_day || 0,
        });
      }
    }
  }
  return [...map.values()];
}

function sortList(list, mode) {
  const copy = list.slice();
  if (mode === 'min-desc') copy.sort((x, y) => y.min - x.min);
  else if (mode === 'artist-asc') copy.sort((x, y) =>
    (x.artist || '').localeCompare(y.artist || '', 'es', { sensitivity: 'base' })
    || (x.name || '').localeCompare(y.name || '', 'es', { sensitivity: 'base' })
  );
  else copy.sort((x, y) => (x.date || '').localeCompare(y.date || ''));  // date-asc default
  return copy;
}

function fmtMin(min) {
  if (min >= 60) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
  return `${Math.round(min || 0)}m`;
}

function cellHtml(a, i) {
  const initial = escapeHtml(((a.artist || a.name || '?')[0] || '?').toUpperCase());
  const year = (a.date || '').slice(0, 4);
  const meta = a.min > 0 ? `${fmtMin(a.min)}${year ? ` · ${year}` : ''}` : (year || '');
  return `<button type="button" class="cover-cell" data-i="${i}" title="${escapeHtml(a.name)} — ${escapeHtml(a.artist)}">
    ${a.img
      ? `<img class="cover-img" src="${a.img}" alt="" loading="lazy" decoding="async">`
      : `<div class="cover-fallback">${initial}</div>`}
    <div class="cover-overlay">
      <div class="cover-overlay-name">${escapeHtml(a.name)}</div>
      <div class="cover-overlay-artist">${escapeHtml(a.artist)}</div>
      ${meta ? `<div class="cover-overlay-meta">${escapeHtml(meta)}</div>` : ''}
    </div>
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
  const allAlbums = buildList(data);
  if (!allAlbums.length) {
    content.innerHTML = `<div class="card"><p>Todavía no hay álbumes detectados en tu historial. Importá el ZIP de Extended Streaming History desde el sidebar.</p></div>`;
    return;
  }

  let size = getSize();
  let sort = getSort();
  let sorted = sortList(allAlbums, sort);

  content.innerHTML = `
    <div class="covers-narrow-hint">Vista pensada para pantalla grande — mejor en escritorio.</div>
    <div class="covers-toolbar">
      <div class="covers-summary">${sorted.length.toLocaleString('es-AR')} álbumes escuchados</div>
      <div class="covers-controls">
        <div class="covers-control-group" role="radiogroup" aria-label="Tamaño de tapa">
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
    <div class="covers-grid" id="covers-grid" data-size="${size}" style="--cover-min:${size}px"></div>
    <div id="covers-sentinel" style="height:1px"></div>
  `;

  const grid = document.getElementById('covers-grid');
  const sentinel = document.getElementById('covers-sentinel');
  let rendered = 0;
  let currentList = sorted;

  function renderBatch() {
    if (rendered >= currentList.length) return;
    const slice = currentList.slice(rendered, rendered + BATCH_SIZE);
    const frag = document.createDocumentFragment();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = slice.map((a, i) => cellHtml(a, rendered + i)).join('');
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
    grid.appendChild(frag);
    rendered += slice.length;
  }

  // IntersectionObserver: cuando el sentinel entra al viewport, meto otro lote.
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) renderBatch();
    }
  }, { rootMargin: '400px 0px' });
  io.observe(sentinel);

  // Primer lote sync (para que el primer viewport se llene sin esperar al IO)
  renderBatch();

  function resort() {
    currentList = sortList(allAlbums, sort);
    rendered = 0;
    grid.innerHTML = '';
    renderBatch();
  }

  content.querySelectorAll('[data-size]').forEach(btn => {
    btn.addEventListener('click', () => {
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
    resort();
  });

  // Click en una tapa → ficha de álbum apilada (modal-stack).
  // Fallback si la tapa da 404: pinto la inicial en lugar del ícono roto.
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

  return () => io.disconnect();
}
