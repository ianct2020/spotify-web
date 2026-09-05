import { spotifyFetch, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache } from '../api.js?v=207';
import { hasKey, setKey, getSimilarArtists, getArtistTopTracks } from '../api/lastfm.js?v=207';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml, pageHeader } from '../ui/components.js?v=207';
import { showToast } from '../ui/toast.js?v=207';
import { getPreview } from '../api/preview-providers.js?v=207';
import { togglePreview, playingKey, isPlayingAudio } from '../ui/preview-player.js?v=207';
import { paintPlayingCard } from '../ui/track-card-row.js?v=207';
import { openTrackCard } from './track-card.js?v=207';
import { openAlbumCard } from './album-card.js?v=207';
import { limpiaParaQuery, titleMatches, artistMatches } from '../util/track-match.js?v=207';

// Mismo componente que #recs (recommendations.js): preview, ficha y ficha de
// álbum sobre la fila resuelta. Los iconos son idénticos a los de esa vista.
const ICONO_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M8 5v14l11-7z"/></svg>`;
const ICONO_PAUSA = `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>`;
const ICONO_FICHA = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12" y2="8"/></svg>`;
const ICONO_DISCO = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/></svg>`;

let sourceArtist = null;
let similarList = [];
let currentSimilarPick = null;
let resolvedTracks = [];
const pickedUris = new Set();

export function render(container) {
  container.innerHTML = `
    ${pageHeader({ title: 'Artistas similares' })}
    <div id="similar-content"></div>
  `;

  if (!hasKey()) {
    renderKeySetup();
    return;
  }
  renderSearch();
}

function renderKeySetup() {
  const content = document.getElementById('similar-content');
  content.innerHTML = `
    <div class="card" style="max-width:480px">
      <h3 style="margin-bottom:8px">Configura tu Last.fm API key</h3>
      <p style="color:var(--color-text-secondary);font-size:14px;margin-bottom:16px">
        Sácala gratis en <a href="https://www.last.fm/api/account/create" target="_blank" style="color:var(--color-accent)">last.fm/api/account/create</a>. Se guarda solo en tu navegador (localStorage), nunca sale de tu equipo.
      </p>
      <input type="text" id="lastfm-key-input" placeholder="API key" autocomplete="off"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-family:monospace;font-size:14px;margin-bottom:12px">
      <button class="btn btn-primary" id="lastfm-key-save" style="width:100%">Guardar</button>
    </div>
  `;
  document.getElementById('lastfm-key-save').onclick = () => {
    const val = document.getElementById('lastfm-key-input').value.trim();
    if (val.length < 20) {
      showToast('Key inválida', 'error');
      return;
    }
    setKey(val);
    showToast('Key guardada', 'success');
    renderSearch();
  };
}

function renderSearch() {
  sourceArtist = null;
  similarList = [];
  const content = document.getElementById('similar-content');
  content.innerHTML = `
    <div class="card" style="max-width:520px;margin-bottom:20px">
      <label style="display:block;margin-bottom:8px;font-weight:500">Buscar artista</label>
      <input type="text" id="similar-search-input" placeholder="Ej: Radiohead"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px;margin-bottom:8px">
      <div id="similar-search-results"></div>
    </div>
    <div id="similar-panel"></div>
  `;

  const input = document.getElementById('similar-search-input');
  let debounce;
  input.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => searchSpotifyArtist(input.value.trim()), 300);
  };
  input.focus();
}

async function searchSpotifyArtist(query) {
  const results = document.getElementById('similar-search-results');
  if (!query) {
    results.innerHTML = '';
    return;
  }
  try {
    const data = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=artist&limit=8`);
    const artists = data.artists?.items || [];
    if (artists.length === 0) {
      results.innerHTML = `<div style="color:var(--color-text-muted);padding:8px 0">Sin resultados</div>`;
      return;
    }
    results.innerHTML = `
      <div style="border-top:1px solid var(--color-border);margin-top:8px;padding-top:8px">
        ${artists.map(a => {
          const genres = (a.genres || []).slice(0, 3).join(' · ');
          return `
            <div class="similar-search-item" data-name="${escapeHtml(a.name)}" data-id="${a.id}"
                 style="padding:10px 12px;border-radius:var(--radius-sm);cursor:pointer">
              <div style="font-weight:500">${escapeHtml(a.name)}</div>
              ${genres ? `<div style="font-size:12px;color:var(--color-text-muted);margin-top:2px">${escapeHtml(genres)}</div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
    results.querySelectorAll('.similar-search-item').forEach(el => {
      el.onmouseenter = () => { el.style.background = 'var(--color-elevated)'; };
      el.onmouseleave = () => { el.style.background = 'transparent'; };
      el.onclick = () => pickSourceArtist(el.dataset.name);
    });
  } catch (e) {
    results.innerHTML = `<div style="color:var(--color-error);padding:8px 0">${escapeHtml(e.message)}</div>`;
  }
}

async function pickSourceArtist(name) {
  sourceArtist = name;
  document.getElementById('similar-search-input').value = name;
  document.getElementById('similar-search-results').innerHTML = '';

  const panel = document.getElementById('similar-panel');
  panel.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando similares vía Last.fm...</div></div>`;

  try {
    similarList = await getSimilarArtists(name, 50);
    if (similarList.length === 0) {
      panel.innerHTML = `<div class="card"><p>Last.fm no tiene similares para "${escapeHtml(name)}". Prueba con otra grafía.</p></div>`;
      return;
    }
    renderSimilarGrid();
  } catch (e) {
    panel.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function renderSimilarGrid() {
  const panel = document.getElementById('similar-panel');
  panel.innerHTML = `
    <div style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px">
      ${similarList.length} artistas similares a <strong>${escapeHtml(sourceArtist)}</strong>. Elige uno para ver sus top tracks.
    </div>
    <div class="smart-grid smart-grid-compact">
      ${similarList.map((a, i) => `
        <button class="smart-card similar-artist-card" data-idx="${i}">
          <div class="smart-card-title" style="font-size:15px">${escapeHtml(a.name)}</div>
          <div class="smart-card-meta">match ${(a.match * 100).toFixed(0)}%</div>
        </button>
      `).join('')}
    </div>
  `;
  panel.querySelectorAll('.similar-artist-card').forEach(el => {
    el.onclick = () => pickSimilarArtist(similarList[parseInt(el.dataset.idx)]);
  });
}

async function pickSimilarArtist(artist) {
  currentSimilarPick = artist;
  resolvedTracks = [];
  pickedUris.clear();

  const panel = document.getElementById('similar-panel');
  panel.innerHTML = `
    <div style="margin-bottom:12px">
      <button class="btn btn-secondary btn-sm" id="similar-back-btn">← Volver a similares</button>
    </div>
    <div class="card" style="margin-bottom:16px;display:flex;align-items:center;gap:14px">
      ${artist.image
        ? `<img src="${artist.image}" style="width:64px;height:64px;border-radius:50%;object-fit:cover">`
        : `<div style="width:64px;height:64px;border-radius:50%;background:var(--color-elevated)"></div>`}
      <div>
        <h2 style="margin-bottom:2px">${escapeHtml(artist.name)}</h2>
        <div style="color:var(--color-text-secondary);font-size:14px">match ${(artist.match * 100).toFixed(0)}% con ${escapeHtml(sourceArtist)}</div>
      </div>
    </div>
    <div id="similar-tracks"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando top tracks...</div></div></div>
  `;
  document.getElementById('similar-back-btn').onclick = renderSimilarGrid;

  try {
    const topTracks = await getArtistTopTracks(artist.name, 20);
    if (topTracks.length === 0) {
      document.getElementById('similar-tracks').innerHTML = `<div class="card"><p>No hay top tracks en Last.fm para este artista.</p></div>`;
      return;
    }
    await resolveTracksOnSpotify(topTracks);
  } catch (e) {
    document.getElementById('similar-tracks').innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

async function resolveTracksOnSpotify(topTracks) {
  const tracksEl = document.getElementById('similar-tracks');
  tracksEl.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando en Spotify (0/${topTracks.length})...</div></div>`;

  resolvedTracks = [];
  for (let i = 0; i < topTracks.length; i++) {
    const t = topTracks[i];
    try {
      // Mismo apóstrofo que rompía #recs: `track:"Can't Feel My Face"` devuelve
      // 0 resultados y el tema caía en «sin match». Se limpia la query y se
      // verifica el candidato contra el nombre real, que es lo que la query
      // laxa deja de garantizar (ver `limpiaParaQuery` en util/track-match.js).
      const q = `track:"${limpiaParaQuery(t.name)}" artist:"${limpiaParaQuery(t.artist)}"`;
      const data = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=5`);
      const hit = (data.tracks?.items || []).find(c =>
        titleMatches(t.name, c.name) && artistMatches(t.artist, (c.artists || []).map(a => a.name).join(', ')));
      if (hit) {
        const artistas = (hit.artists || []).map(a => a.name).filter(Boolean);
        resolvedTracks.push({
          uri: hit.uri,
          trackId: hit.id,
          name: hit.name,
          artist: artistas.join(', '),
          // La lista entera, no el string unido — la cadena de proveedores de
          // preview acepta el match si coincide CUALQUIER artista (v=142).
          artistList: artistas,
          album: hit.album?.name,
          albumId: hit.album?.id,
          image: hit.album?.images?.[hit.album.images.length - 1]?.url,
          imageBig: hit.album?.images?.[0]?.url,
          playcount: t.playcount,
          matched: true,
        });
      } else {
        resolvedTracks.push({ uri: null, name: t.name, artist: t.artist, matched: false });
      }
    } catch {
      resolvedTracks.push({ uri: null, name: t.name, artist: t.artist, matched: false });
    }
    tracksEl.querySelector('.empty-state div:last-child').textContent = `Buscando en Spotify (${i + 1}/${topTracks.length})...`;
  }

  renderResolvedTracks();
}

function filaPorId(id) {
  return resolvedTracks.find(t => t.matched && t.trackId === id) || null;
}

// ── Preview ──────────────────────────────────────────────────────────────────
// La misma cadena de proveedores que #recs (iTunes → Deezer → embed de
// Spotify), con el mismo componente global de audio.
async function onPlayClick(r) {
  const res = await togglePreview(`similar:${r.trackId}`, () => getPreview({
    name: r.name,
    artists: r.artistList,
    spotifyId: r.trackId || undefined,
  }));
  if (res === null) showToast(`Sin preview disponible de «${r.name}»`, 'info');
}

document.addEventListener('previewchange', (e) => {
  paintPlayingCard(document.getElementById('similar-tracks'), 'similar', e.detail);
});

// Una fila es un `<label>` que ENVUELVE el checkbox, así que un click en
// cualquier descendiente lo tilda aunque el descendiente tenga su propio
// handler. Para las acciones que NO son marcar hace falta `preventDefault()`
// ADEMÁS de `stopPropagation()` (v=164, mismo gotcha que #recs).
function accionesDeFila(tracksEl) {
  tracksEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn || !tracksEl.contains(btn)) return;
    e.preventDefault();
    e.stopPropagation();
    const fila = e.target.closest('[data-id]');
    const r = fila && filaPorId(fila.dataset.id);
    if (!r) return;
    if (btn.dataset.accion === 'play') { onPlayClick(r); return; }
    if (btn.dataset.accion === 'ficha') {
      openTrackCard({ id: r.trackId, name: r.name, artists: r.artistList, album: r.album, img: r.imageBig || r.image });
      return;
    }
    if (btn.dataset.accion === 'album') {
      openAlbumCard({ name: r.album, artist: r.artistList?.[0] || r.artist, albumId: r.albumId, img: r.imageBig || r.image });
    }
  });
}

function filaHtml(t) {
  if (!t.matched) {
    return `
      <div class="pretty-check-row" style="opacity:0.5">
        <div style="width:40px;height:40px;background:var(--color-elevated);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--color-text-muted)">?</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px">${escapeHtml(t.name)}</div>
          <div style="font-size:12px;color:var(--color-text-muted)">${escapeHtml(t.artist)} — sin match en Spotify</div>
        </div>
      </div>`;
  }
  const sonando = playingKey() === `similar:${t.trackId}`;
  const pausa = sonando && isPlayingAudio();
  return `
    <label class="pretty-check-row" data-id="${escapeHtml(t.trackId)}">
      <input type="checkbox" class="pretty-check similar-track-check" data-uri="${t.uri}" checked>
      <span class="pretty-check-box"></span>
      ${t.image
        ? `<img src="${t.image}" style="width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover">`
        : `<div style="width:40px;height:40px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</div>
        <div style="font-size:12px;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.artist)}${t.album ? ` · ${escapeHtml(t.album)}` : ''}</div>
      </div>
      <div class="recs-row-actions">
        <button type="button" class="sc-btn sc-play${sonando ? ' playing' : ''}" data-accion="play"
                title="${pausa ? 'Parar el preview' : 'Preview de 30 s — no suma reproducciones'}"
                aria-label="${pausa ? 'Parar preview' : 'Preview'}">${pausa ? ICONO_PAUSA : ICONO_PLAY}</button>
        <button type="button" class="sc-btn" data-accion="ficha" title="Ver la ficha del tema" aria-label="Ficha del tema">${ICONO_FICHA}</button>
        ${t.album ? `<button type="button" class="sc-btn" data-accion="album" title="Ver la ficha del álbum" aria-label="Ficha del álbum">${ICONO_DISCO}</button>` : ''}
      </div>
    </label>`;
}

function renderResolvedTracks() {
  const tracksEl = document.getElementById('similar-tracks');
  const matched = resolvedTracks.filter(t => t.matched);
  matched.forEach(t => pickedUris.add(t.uri));

  tracksEl.innerHTML = `
    <div class="results-summary">
      <div class="stat-card">
        <div class="stat-value">${matched.length}</div>
        <div class="stat-label">Tracks en Spotify</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--color-text-muted)">${resolvedTracks.length - matched.length}</div>
        <div class="stat-label">Sin match</div>
      </div>
    </div>

    <div style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
      <div style="font-size:13px;color:var(--color-text-secondary)">
        <strong id="similar-picked-count">${pickedUris.size}</strong> tracks seleccionados
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="similar-clear-btn">Deseleccionar todo</button>
        <button class="btn btn-primary" id="similar-create-btn">Crear playlist</button>
      </div>
    </div>

    ${resolvedTracks.some(t => !t.matched) ? `
      <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px">
        "Sin match" = el nombre del track en Last.fm no coincide con ningún track de Spotify (título distinto, no disponible en tu región, o error tipográfico).
      </div>
    ` : ''}

    <div class="card">
      <div class="tracks-grid">
        ${resolvedTracks.map(filaHtml).join('')}
      </div>
    </div>
  `;

  accionesDeFila(tracksEl);

  tracksEl.querySelectorAll('.similar-track-check').forEach(box => {
    box.onchange = () => {
      if (box.checked) pickedUris.add(box.dataset.uri);
      else pickedUris.delete(box.dataset.uri);
      document.getElementById('similar-picked-count').textContent = pickedUris.size;
    };
  });
  document.getElementById('similar-clear-btn').onclick = () => {
    pickedUris.clear();
    tracksEl.querySelectorAll('.similar-track-check').forEach(b => { b.checked = false; });
    document.getElementById('similar-picked-count').textContent = 0;
  };
  document.getElementById('similar-create-btn').onclick = createPlaylistFromPicks;
}

async function createPlaylistFromPicks() {
  if (pickedUris.size === 0) {
    showToast('No seleccionaste ningún track', 'error');
    return;
  }
  const uris = [...pickedUris];
  const suggested = `Similar a ${sourceArtist}: ${currentSimilarPick.name}`;
  const name = await promptPlaylistName(suggested, { trackCount: uris.length });
  if (!name) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, `Descubrimiento vía Last.fm`, false);
    showProgress('Agregando tracks...', 0, uris.length);
    await addTracksToPlaylist(playlist.id, uris);
    invalidatePlaylistsCache();
    hideProgress();
    showToast(`Playlist "${name}" creada`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
