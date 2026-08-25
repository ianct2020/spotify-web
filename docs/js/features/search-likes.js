// Buscador local instantáneo dentro de tus Liked Songs (cache IDB).
// Sirve para cuando la búsqueda de Spotify tarda o no encuentra bien:
// tipeás, filtra en memoria por título/artista/álbum, sin pegarle a la API.

import { getBestAvailableLikes } from '../api.js?v=160';
import { renderTrackRow, escapeHtml, pageHeader } from '../ui/components.js?v=160';
import { firstArtistName, artistNames } from '../util/artist-name.js?v=160';
import { openTrackCard } from './track-card.js?v=160';
import { coverUrl } from '../util/cover-size.js?v=160';
import { fmtDiaCorto } from '../util/fecha.js?v=160';

const MAX_RESULTS = 300;
let cachedItems = [];

function normalize(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sacar acentos
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesQuery(item, tokens) {
  const t = item.track;
  if (!t) return false;
  const hay = normalize(
    `${t.name} ${(t.artists || []).map(firstArtistName).filter(Boolean).join(' ')} ${t.album?.name || ''}`
  );
  // AND entre tokens — tipear "drake views" filtra por ambos.
  return tokens.every(tok => hay.includes(tok));
}

export async function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Buscar en tus Liked Songs' })}
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:240px;position:relative">
          <input type="search" id="search-likes-input" placeholder="ej: drake views · frank ocean pyramids · daft punk"
                 style="width:100%;background:var(--color-elevated);border:1px solid var(--color-border);color:var(--color-text);
                        padding:12px 40px 12px 14px;border-radius:var(--radius-sm);font-size:15px;outline:none;font-family:inherit">
          <button id="search-likes-clear" aria-label="Limpiar"
                  style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:transparent;border:none;
                         color:var(--color-text-muted);cursor:pointer;font-size:18px;line-height:1;padding:4px;display:none">×</button>
        </div>
        <div id="search-likes-info" style="font-size:13px;color:var(--color-text-muted);white-space:nowrap"></div>
      </div>
    </div>
    <div id="search-likes-results"></div>
  `;

  const input = document.getElementById('search-likes-input');
  const clearBtn = document.getElementById('search-likes-clear');
  const info = document.getElementById('search-likes-info');
  const results = document.getElementById('search-likes-results');

  results.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Cargando cache de likes…</div></div>`;

  const { items } = await getBestAvailableLikes();
  cachedItems = items;

  if (!items.length) {
    results.innerHTML = `
      <div class="card">
        <p>No hay likes cacheados todavía.</p>
        <p style="color:var(--color-text-secondary);font-size:13px;margin-top:6px">Andá al <a href="#dashboard" style="color:var(--color-accent)">Dashboard</a> y hacé "Cargar desde Spotify" o "Actualizar datos" primero.</p>
      </div>
    `;
    info.textContent = '';
    return;
  }

  info.innerHTML = `${items.length.toLocaleString('es-AR')} likes en cache`;

  results.innerHTML = `<div class="card"><p style="color:var(--color-text-secondary)">Empezá a tipear arriba — los resultados aparecen al toque.</p></div>`;

  let lastQuery = '';
  let debounceTimer = null;
  const run = () => {
    const raw = input.value;
    const q = normalize(raw);
    if (q === lastQuery) return;
    lastQuery = q;
    clearBtn.style.display = raw ? 'block' : 'none';
    if (!q) {
      results.innerHTML = `<div class="card"><p style="color:var(--color-text-secondary)">Empezá a tipear arriba — los resultados aparecen al toque.</p></div>`;
      return;
    }
    const tokens = q.split(' ').filter(Boolean);
    const matches = [];
    for (const item of cachedItems) {
      if (matchesQuery(item, tokens)) {
        matches.push(item);
        if (matches.length >= MAX_RESULTS + 1) break;
      }
    }
    renderResults(results, matches, raw);
  };

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 60);
  });
  clearBtn.onclick = () => {
    input.value = '';
    input.focus();
    run();
  };
  input.focus();
}

function renderResults(holder, matches, query) {
  if (!matches.length) {
    holder.innerHTML = `
      <div class="card">
        <p><strong>No hay coincidencias</strong> para "${escapeHtml(query)}".</p>
        <p style="color:var(--color-text-secondary);font-size:13px;margin-top:6px">Si estás seguro que la tenés likeada, tal vez tu cache está desactualizado. Andá al Dashboard y hacé "Actualizar datos".</p>
      </div>
    `;
    return;
  }
  const truncated = matches.length > MAX_RESULTS;
  const shown = matches.slice(0, MAX_RESULTS);
  const countLabel = truncated ? `+${MAX_RESULTS}` : shown.length.toLocaleString('es-AR');

  holder.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:13px;color:var(--color-text-muted)">
        <strong style="color:var(--color-text)">${countLabel}</strong> resultado${shown.length === 1 && !truncated ? '' : 's'} para "${escapeHtml(query)}"
      </div>
      ${truncated ? `<div style="font-size:12px;color:var(--color-warning)">Mostrando los primeros ${MAX_RESULTS} — refiná la búsqueda para ver más</div>` : ''}
    </div>
    <div class="card" style="padding:4px 8px">
      ${shown.map(item => {
        const t = item.track;
        const added = item.added_at ? `<span style="font-size:11px;color:var(--color-text-muted);flex-shrink:0">${fmtDiaCorto(item.added_at)}</span>` : '';
        const openUrl = t.uri ? t.uri.replace('spotify:track:', 'https://open.spotify.com/track/') : (t.external_urls?.spotify || '#');
        const openBtn = `<a href="${openUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="flex-shrink:0" title="Abrir en Spotify">↗</a>`;
        const albumLine = t.album?.name ? `<div style="font-size:11px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.album.name)}</div>` : '';
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid var(--color-border)">
            <div class="sl-info tc-clickable" data-i="${shown.indexOf(item)}" title="Ver ficha del tema" style="flex:1;min-width:0">${renderTrackRow(t, albumLine)}</div>
            ${added}
            ${openBtn}
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Click en la fila → ficha de canción
  holder.querySelectorAll('.sl-info').forEach(el => {
    el.onclick = () => {
      const t = shown[+el.dataset.i]?.track;
      if (!t) return;
      const id = t.id || (t.uri || '').split(':').pop();
      if (!id) return;
      const imgs = t.album?.images || [];
      openTrackCard({
        id,
        name: t.name,
        // La lista entera: la ficha pinta un enlace por artista (v=150).
        artists: artistNames(t),
        album: t.album?.name,
        img: coverUrl(imgs, 'grande'),
      });
    };
  });
}
