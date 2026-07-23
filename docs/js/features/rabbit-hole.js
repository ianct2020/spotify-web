import { spotifyFetch, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache } from '../api.js?v=54';
import { hasKey, setKey, getTopArtistsByTag, getArtistTopTracks, getArtistTopTags } from '../api/lastfm.js?v=54';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml } from '../ui/components.js?v=54';
import { showToast } from '../ui/toast.js?v=54';

const SUGGESTED_TAGS = [
  'rock', 'indie', 'hip-hop', 'electronic', 'pop', 'metal',
  'jazz', 'ambient', 'shoegaze', 'punk', 'house', 'techno',
  'reggaeton', 'trap', 'r&b', 'soul', 'folk', 'post-punk',
];

let currentTag = null;
let artistList = [];
let currentArtistPick = null;
let resolvedTracks = [];
const pickedUris = new Set();

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Rabbit hole por género</h1>
      <p>Elegí un género y explorá los top artistas de Last.fm para ese tag.</p>
    </div>
    <div id="rabbit-content"></div>
  `;

  if (!hasKey()) {
    renderKeySetup();
    return;
  }
  renderTagInput();
}

function renderKeySetup() {
  const content = document.getElementById('rabbit-content');
  content.innerHTML = `
    <div class="card" style="max-width:480px">
      <h3 style="margin-bottom:8px">Configurá tu Last.fm API key</h3>
      <p style="color:var(--color-text-secondary);font-size:14px;margin-bottom:16px">
        Sacala en <a href="https://www.last.fm/api/account/create" target="_blank" style="color:var(--color-accent)">last.fm/api/account/create</a>.
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
    renderTagInput();
  };
}

function renderTagInput() {
  currentTag = null;
  artistList = [];
  const content = document.getElementById('rabbit-content');
  content.innerHTML = `
    <div class="card" style="max-width:640px;margin-bottom:20px">
      <label style="display:block;margin-bottom:8px;font-weight:500">Género / tag</label>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input type="text" id="rabbit-tag-input" placeholder="Ej: shoegaze, indie rock, trap"
               style="flex:1;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px">
        <button class="btn btn-primary" id="rabbit-go-btn">Explorar</button>
      </div>
      <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:6px">Sugeridos:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${SUGGESTED_TAGS.map(t => `
          <button class="btn btn-secondary btn-sm rabbit-tag-chip" data-tag="${escapeHtml(t)}" style="font-size:12px;padding:4px 10px">${escapeHtml(t)}</button>
        `).join('')}
      </div>
    </div>
    <div id="rabbit-panel"></div>
  `;

  const input = document.getElementById('rabbit-tag-input');
  const go = () => {
    const t = input.value.trim();
    if (!t) {
      showToast('Escribí un género', 'error');
      return;
    }
    loadTag(t);
  };
  document.getElementById('rabbit-go-btn').onclick = go;
  input.onkeydown = e => { if (e.key === 'Enter') go(); };
  document.querySelectorAll('.rabbit-tag-chip').forEach(el => {
    el.onclick = () => { input.value = el.dataset.tag; loadTag(el.dataset.tag); };
  });
  input.focus();
}

let relatedTags = [];

const RABBIT_NOISE_TAGS = new Set([
  'seen live', 'favorites', 'favorite', 'favourite', 'favourites',
  'awesome', 'love', 'love it', 'best', 'good', 'amazing',
  'usa', 'american', 'british', 'uk', 'canadian', 'australian',
  'male vocalists', 'female vocalists', 'male vocalist', 'female vocalist',
  'my music', 'my favourite', 'mymusic', 'my favorites', 'spotify',
]);

function tagSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function computeRelatedTags(currentTagName, artists) {
  const currentLower = currentTagName.toLowerCase();
  const tagCounts = new Map();
  const sample = artists.slice(0, 8);
  for (const a of sample) {
    try {
      const tags = await getArtistTopTags(a.name);
      tags.slice(0, 5).forEach(t => {
        const key = t.name.toLowerCase();
        if (key === currentLower) return;
        if (RABBIT_NOISE_TAGS.has(key)) return;
        tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
      });
    } catch {}
    await tagSleep(200);
  }
  return [...tagCounts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => ({ name }));
}

async function loadTag(tag) {
  currentTag = tag;
  relatedTags = [];
  const panel = document.getElementById('rabbit-panel');
  panel.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando top artistas de "${escapeHtml(tag)}"...</div></div>`;

  try {
    artistList = await getTopArtistsByTag(tag, 50);
    if (artistList.length === 0) {
      panel.innerHTML = `<div class="card"><p>Last.fm no tiene artistas para el tag "${escapeHtml(tag)}". Probá con otro nombre.</p></div>`;
      return;
    }
    renderArtistGrid();
    computeRelatedTags(tag, artistList).then(rt => {
      relatedTags = rt;
      const holder = document.getElementById('rabbit-related-holder');
      if (holder && rt.length > 0) {
        holder.innerHTML = `
          <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:6px">Géneros parecidos:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${rt.map(t => `
              <button class="btn btn-secondary btn-sm rabbit-related-chip" data-tag="${escapeHtml(t.name)}" style="font-size:12px;padding:4px 10px">${escapeHtml(t.name)}</button>
            `).join('')}
          </div>
        `;
        holder.querySelectorAll('.rabbit-related-chip').forEach(el => {
          el.onclick = () => {
            const input = document.getElementById('rabbit-tag-input');
            if (input) input.value = el.dataset.tag;
            loadTag(el.dataset.tag);
          };
        });
      }
    });
  } catch (e) {
    panel.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function renderArtistGrid() {
  const panel = document.getElementById('rabbit-panel');
  panel.innerHTML = `
    <div style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px">
      Top ${artistList.length} artistas del género <strong>${escapeHtml(currentTag)}</strong>. Elegí uno para ver sus top tracks.
    </div>
    <div id="rabbit-related-holder" style="margin-bottom:16px">
      ${relatedTags.length > 0 ? `
        <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:6px">Géneros parecidos:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${relatedTags.map(t => `
            <button class="btn btn-secondary btn-sm rabbit-related-chip" data-tag="${escapeHtml(t.name)}" style="font-size:12px;padding:4px 10px">${escapeHtml(t.name)}</button>
          `).join('')}
        </div>
      ` : ''}
    </div>
    <div class="smart-grid smart-grid-compact">
      ${artistList.map((a, i) => `
        <button class="smart-card rabbit-artist-card" data-idx="${i}">
          <div class="smart-card-title" style="font-size:15px">${escapeHtml(a.name)}</div>
          <div class="smart-card-meta">#${i + 1}</div>
        </button>
      `).join('')}
    </div>
  `;
  panel.querySelectorAll('.rabbit-artist-card').forEach(el => {
    el.onclick = () => pickArtist(artistList[parseInt(el.dataset.idx)]);
  });
  panel.querySelectorAll('.rabbit-related-chip').forEach(el => {
    el.onclick = () => {
      const input = document.getElementById('rabbit-tag-input');
      if (input) input.value = el.dataset.tag;
      loadTag(el.dataset.tag);
    };
  });
}

async function pickArtist(artist) {
  currentArtistPick = artist;
  resolvedTracks = [];
  pickedUris.clear();

  const panel = document.getElementById('rabbit-panel');
  panel.innerHTML = `
    <div style="margin-bottom:12px">
      <button class="btn btn-secondary btn-sm" id="rabbit-back-btn">← Volver a artistas</button>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h2 style="margin-bottom:2px">${escapeHtml(artist.name)}</h2>
      <div style="color:var(--color-text-secondary);font-size:14px">Top del género <strong>${escapeHtml(currentTag)}</strong></div>
    </div>
    <div id="rabbit-tracks"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando top tracks...</div></div></div>
  `;
  document.getElementById('rabbit-back-btn').onclick = renderArtistGrid;

  try {
    const topTracks = await getArtistTopTracks(artist.name, 20);
    if (topTracks.length === 0) {
      document.getElementById('rabbit-tracks').innerHTML = `<div class="card"><p>Sin top tracks para este artista.</p></div>`;
      return;
    }
    await resolveTracksOnSpotify(topTracks);
  } catch (e) {
    document.getElementById('rabbit-tracks').innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

async function resolveTracksOnSpotify(topTracks) {
  const tracksEl = document.getElementById('rabbit-tracks');
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
  const tracksEl = document.getElementById('rabbit-tracks');
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
        <strong id="rabbit-picked-count">${pickedUris.size}</strong> tracks seleccionados
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="rabbit-clear-btn">Deseleccionar todo</button>
        <button class="btn btn-primary" id="rabbit-create-btn">Crear playlist</button>
      </div>
    </div>

    ${resolvedTracks.some(t => !t.matched) ? `
      <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px">
        "Sin match" = el nombre del track en Last.fm no coincide con ningún track de Spotify.
      </div>
    ` : ''}

    <div class="card">
      ${resolvedTracks.map(t => t.matched ? `
        <label class="pretty-check-row">
          <input type="checkbox" class="pretty-check rabbit-track-check" data-uri="${t.uri}" checked>
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

  tracksEl.querySelectorAll('.rabbit-track-check').forEach(box => {
    box.onchange = () => {
      if (box.checked) pickedUris.add(box.dataset.uri);
      else pickedUris.delete(box.dataset.uri);
      document.getElementById('rabbit-picked-count').textContent = pickedUris.size;
    };
  });
  document.getElementById('rabbit-clear-btn').onclick = () => {
    pickedUris.clear();
    tracksEl.querySelectorAll('.rabbit-track-check').forEach(b => { b.checked = false; });
    document.getElementById('rabbit-picked-count').textContent = 0;
  };
  document.getElementById('rabbit-create-btn').onclick = createPlaylistFromPicks;
}

async function createPlaylistFromPicks() {
  if (pickedUris.size === 0) {
    showToast('No seleccionaste ningún track', 'error');
    return;
  }
  const uris = [...pickedUris];
  const suggested = `${currentTag}: ${currentArtistPick.name}`;
  const name = await promptPlaylistName(suggested, { trackCount: uris.length });
  if (!name) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, `Rabbit hole vía Last.fm`, false);
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
