import { spotifyFetch, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache } from '../api.js?v=52';
import { hasKey, setKey, getSimilarArtists, getArtistTopTracks } from '../api/lastfm.js?v=52';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml } from '../ui/components.js?v=52';
import { showToast } from '../ui/toast.js?v=52';

let sourceArtist = null;
let similarList = [];
let currentSimilarPick = null;
let resolvedTracks = [];
const pickedUris = new Set();

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Artistas similares</h1>
      <p>Descubrí artistas parecidos a los que ya te gustan, vía Last.fm.</p>
    </div>
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
      <h3 style="margin-bottom:8px">Configurá tu Last.fm API key</h3>
      <p style="color:var(--color-text-secondary);font-size:14px;margin-bottom:16px">
        Sacala gratis en <a href="https://www.last.fm/api/account/create" target="_blank" style="color:var(--color-accent)">last.fm/api/account/create</a>. Se guarda solo en tu navegador (localStorage), nunca sale de tu equipo.
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
      panel.innerHTML = `<div class="card"><p>Last.fm no tiene similares para "${escapeHtml(name)}". Probá con otra grafía.</p></div>`;
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
      ${similarList.length} artistas similares a <strong>${escapeHtml(sourceArtist)}</strong>. Elegí uno para ver sus top tracks.
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
      const q = `track:"${t.name}" artist:"${t.artist}"`;
      const data = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=1`);
      const hit = data.tracks?.items?.[0];
      if (hit) {
        resolvedTracks.push({
          uri: hit.uri,
          name: hit.name,
          artist: (hit.artists || []).map(a => a.name).join(', '),
          album: hit.album?.name,
          image: hit.album?.images?.[hit.album.images.length - 1]?.url,
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
      ${resolvedTracks.map((t, i) => t.matched ? `
        <label class="pretty-check-row">
          <input type="checkbox" class="pretty-check similar-track-check" data-uri="${t.uri}" checked>
          <span class="pretty-check-box"></span>
          ${t.image ? `<img src="${t.image}" style="width:40px;height:40px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:40px;height:40px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</div>
            <div style="font-size:12px;color:var(--color-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.artist)}${t.album ? ` · ${escapeHtml(t.album)}` : ''}</div>
          </div>
        </label>
      ` : `
        <div class="pretty-check-row" style="opacity:0.5">
          <div style="width:40px;height:40px;background:var(--color-elevated);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--color-text-muted)">?</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px">${escapeHtml(t.name)}</div>
            <div style="font-size:12px;color:var(--color-text-muted)">${escapeHtml(t.artist)} — sin match en Spotify</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

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
