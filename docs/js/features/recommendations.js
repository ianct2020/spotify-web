import { spotifyFetch, createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache, getAllLikedTracks } from '../api.js?v=57';
import { hasKey, setKey, hasUsername, getUsername, setUsername, getUserTopArtists, getSimilarArtists, getArtistTopTracks } from '../api/lastfm.js?v=57';
import { showProgress, hideProgress, promptPlaylistName, escapeHtml } from '../ui/components.js?v=57';
import { showToast } from '../ui/toast.js?v=57';

let recommendations = [];
let currentPick = null;
let resolvedTracks = [];
let alreadyLikedInResolution = 0;
const pickedUris = new Set();
const likedUris = new Set();

export function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Recomendaciones (scrobbles)</h1>
      <p>Basado en lo que escuchás según Last.fm. Cruza tus top artistas con sus similares y filtra los que ya tenés.</p>
    </div>
    <div id="recs-content"></div>
  `;

  if (!hasKey()) {
    renderKeySetup();
    return;
  }
  if (!hasUsername()) {
    renderUserSetup();
    return;
  }
  renderControls();
}

function renderKeySetup() {
  document.getElementById('recs-content').innerHTML = `
    <div class="card" style="max-width:480px">
      <h3 style="margin-bottom:8px">Configurá tu Last.fm API key</h3>
      <input type="text" id="lastfm-key-input" placeholder="API key"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-family:monospace;font-size:14px;margin-bottom:12px">
      <button class="btn btn-primary" id="lastfm-key-save" style="width:100%">Guardar</button>
    </div>
  `;
  document.getElementById('lastfm-key-save').onclick = () => {
    const val = document.getElementById('lastfm-key-input').value.trim();
    if (val.length < 20) { showToast('Key inválida', 'error'); return; }
    setKey(val);
    renderUserSetup();
  };
}

function renderUserSetup() {
  document.getElementById('recs-content').innerHTML = `
    <div class="card" style="max-width:480px">
      <h3 style="margin-bottom:8px">Tu usuario de Last.fm</h3>
      <p style="color:var(--color-text-secondary);font-size:14px;margin-bottom:16px">
        El username que usás para scrobblear. Se guarda en tu navegador.
      </p>
      <input type="text" id="lastfm-user-input" placeholder="username" autocomplete="off"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px;margin-bottom:12px">
      <button class="btn btn-primary" id="lastfm-user-save" style="width:100%">Guardar</button>
    </div>
  `;
  document.getElementById('lastfm-user-save').onclick = () => {
    const val = document.getElementById('lastfm-user-input').value.trim();
    if (val.length < 1) { showToast('Username vacío', 'error'); return; }
    setUsername(val);
    renderControls();
  };
}

function renderControls() {
  document.getElementById('recs-content').innerHTML = `
    <div class="card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
      <div>
        <div style="font-size:14px">Usuario: <strong>${escapeHtml(getUsername())}</strong></div>
        <div style="font-size:12px;color:var(--color-text-secondary)">Periodo: últimos 6 meses</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="recs-change-user">Cambiar usuario</button>
        <button class="btn btn-primary" id="recs-run-btn">Generar recomendaciones</button>
      </div>
    </div>
    <div id="recs-panel"></div>
  `;
  document.getElementById('recs-change-user').onclick = renderUserSetup;
  document.getElementById('recs-run-btn').onclick = run;
}

async function run() {
  const panel = document.getElementById('recs-panel');
  const username = getUsername();
  panel.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Bajando tus top artistas de Last.fm...</div></div>`;

  try {
    const top = await getUserTopArtists(username, '6month', 30);
    if (top.length === 0) {
      panel.innerHTML = `<div class="card"><p>No hay scrobbles para ${escapeHtml(username)} en los últimos 6 meses. ¿Es correcto el usuario?</p></div>`;
      return;
    }

    const [likes] = await Promise.all([getAllLikedTracks(() => {}).catch(() => [])]);
    const knownArtists = new Set();
    likedUris.clear();
    likes.forEach(i => {
      const n = i.track?.artists?.[0]?.name;
      if (n) knownArtists.add(n.toLowerCase());
      if (i.track?.uri) likedUris.add(i.track.uri);
    });

    panel.innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div style="font-size:14px;margin-bottom:6px">Fetching similares para ${top.length} top artistas...</div>
        <div style="height:8px;background:var(--color-elevated);border-radius:4px;overflow:hidden">
          <div id="recs-bar" style="height:100%;background:var(--color-accent);width:0%;transition:width 0.2s"></div>
        </div>
        <div id="recs-progress-text" style="margin-top:6px;font-size:12px;color:var(--color-text-secondary)">0/${top.length}</div>
      </div>
    `;

    const scoreMap = new Map();
    let processed = 0;
    for (const src of top) {
      try {
        const similars = await getSimilarArtists(src.name, 15);
        for (const s of similars) {
          const key = s.name.toLowerCase();
          if (knownArtists.has(key)) continue;
          if (top.some(t => t.name.toLowerCase() === key)) continue;
          const score = (src.playcount || 1) * (s.match || 0);
          const prev = scoreMap.get(s.name) || { name: s.name, image: s.image, score: 0, sources: [] };
          prev.score += score;
          prev.sources.push(src.name);
          scoreMap.set(s.name, prev);
        }
      } catch {}
      processed++;
      const pct = (processed / top.length) * 100;
      document.getElementById('recs-bar').style.width = `${pct}%`;
      document.getElementById('recs-progress-text').textContent = `${processed}/${top.length}`;
      await sleep(150);
    }

    recommendations = [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 50);

    renderRecommendations();
  } catch (e) {
    panel.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function renderRecommendations() {
  const panel = document.getElementById('recs-panel');
  if (recommendations.length === 0) {
    panel.innerHTML = `<div class="card"><p>No hay recomendaciones nuevas — parece que ya tenés a todos los similares de tus top artists.</p></div>`;
    return;
  }
  panel.innerHTML = `
    <div style="margin-bottom:8px;color:var(--color-text-secondary);font-size:14px">
      ${recommendations.length} artistas recomendados (filtrados los que ya tenés en likes). Click para ver top tracks.
    </div>
    <div class="smart-grid smart-grid-compact">
      ${recommendations.map((a, i) => `
        <button class="smart-card recs-artist-card" data-idx="${i}">
          <div class="smart-card-title" style="font-size:15px">${escapeHtml(a.name)}</div>
          <div class="smart-card-meta">${a.sources.length} match${a.sources.length > 1 ? 'es' : ''}</div>
        </button>
      `).join('')}
    </div>
  `;
  panel.querySelectorAll('.recs-artist-card').forEach(el => {
    el.onclick = () => pickArtist(recommendations[parseInt(el.dataset.idx)]);
  });
}

async function pickArtist(artist) {
  currentPick = artist;
  resolvedTracks = [];
  pickedUris.clear();

  const panel = document.getElementById('recs-panel');
  panel.innerHTML = `
    <div style="margin-bottom:12px">
      <button class="btn btn-secondary btn-sm" id="recs-back-btn">← Volver</button>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h2 style="margin-bottom:2px">${escapeHtml(artist.name)}</h2>
      <div style="color:var(--color-text-secondary);font-size:13px">
        Similar a: ${artist.sources.slice(0, 4).map(s => escapeHtml(s)).join(', ')}${artist.sources.length > 4 ? ` +${artist.sources.length - 4}` : ''}
      </div>
    </div>
    <div id="recs-tracks"><div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando top tracks...</div></div></div>
  `;
  document.getElementById('recs-back-btn').onclick = renderRecommendations;

  try {
    const topTracks = await getArtistTopTracks(artist.name, 20);
    if (topTracks.length === 0) {
      document.getElementById('recs-tracks').innerHTML = `<div class="card"><p>Sin top tracks en Last.fm.</p></div>`;
      return;
    }
    await resolveTracksOnSpotify(topTracks);
  } catch (e) {
    document.getElementById('recs-tracks').innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

async function resolveTracksOnSpotify(topTracks) {
  const tracksEl = document.getElementById('recs-tracks');
  tracksEl.innerHTML = `<div class="empty-state"><div class="spinner spinner-lg"></div><div style="margin-top:16px">Buscando en Spotify (0/${topTracks.length})...</div></div>`;

  const raw = [];
  for (let i = 0; i < topTracks.length; i++) {
    const t = topTracks[i];
    try {
      const q = `track:"${t.name}" artist:"${t.artist}"`;
      const data = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=1`);
      const hit = data.tracks?.items?.[0];
      if (hit) {
        raw.push({
          uri: hit.uri, name: hit.name,
          artist: (hit.artists || []).map(a => a.name).join(', '),
          album: hit.album?.name,
          image: hit.album?.images?.[hit.album.images.length - 1]?.url,
          matched: true,
        });
      } else {
        raw.push({ uri: null, name: t.name, artist: t.artist, matched: false });
      }
    } catch {
      raw.push({ uri: null, name: t.name, artist: t.artist, matched: false });
    }
    tracksEl.querySelector('.empty-state div:last-child').textContent = `Buscando en Spotify (${i + 1}/${topTracks.length})...`;
  }

  alreadyLikedInResolution = raw.filter(t => t.matched && likedUris.has(t.uri)).length;
  resolvedTracks = raw.filter(t => !(t.matched && likedUris.has(t.uri)));

  renderResolvedTracks();
}

function renderResolvedTracks() {
  const tracksEl = document.getElementById('recs-tracks');
  const matched = resolvedTracks.filter(t => t.matched);
  matched.forEach(t => pickedUris.add(t.uri));

  tracksEl.innerHTML = `
    <div class="results-summary">
      <div class="stat-card">
        <div class="stat-value">${matched.length}</div>
        <div class="stat-label">Nuevos en Spotify</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--color-text-muted)">${alreadyLikedInResolution}</div>
        <div class="stat-label">Ya en tus likes (ocultos)</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color:var(--color-text-muted)">${resolvedTracks.length - matched.length}</div>
        <div class="stat-label">Sin match</div>
      </div>
    </div>
    ${matched.length === 0 ? `
      <div class="card" style="margin-bottom:16px"><p>Todos los top tracks de este artista ya están en tus likes. Volvé y probá con otro.</p></div>
    ` : ''}

    <div style="position:sticky;top:0;z-index:50;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-md);padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.2)">
      <div style="font-size:13px;color:var(--color-text-secondary)">
        <strong id="recs-picked-count">${pickedUris.size}</strong> tracks seleccionados
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary btn-sm" id="recs-clear-btn">Deseleccionar todo</button>
        <button class="btn btn-primary" id="recs-create-btn">Crear playlist</button>
      </div>
    </div>

    <div class="card">
      ${resolvedTracks.map(t => t.matched ? `
        <label class="pretty-check-row">
          <input type="checkbox" class="pretty-check recs-track-check" data-uri="${t.uri}" checked>
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
            <div style="font-size:12px;color:var(--color-text-muted)">${escapeHtml(t.artist)} — sin match</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  tracksEl.querySelectorAll('.recs-track-check').forEach(box => {
    box.onchange = () => {
      if (box.checked) pickedUris.add(box.dataset.uri);
      else pickedUris.delete(box.dataset.uri);
      document.getElementById('recs-picked-count').textContent = pickedUris.size;
    };
  });
  document.getElementById('recs-clear-btn').onclick = () => {
    pickedUris.clear();
    tracksEl.querySelectorAll('.recs-track-check').forEach(b => { b.checked = false; });
    document.getElementById('recs-picked-count').textContent = 0;
  };
  document.getElementById('recs-create-btn').onclick = createPlaylistFromPicks;
}

async function createPlaylistFromPicks() {
  if (pickedUris.size === 0) {
    showToast('No seleccionaste nada', 'error');
    return;
  }
  const uris = [...pickedUris];
  const suggested = `Discover: ${currentPick.name}`;
  const name = await promptPlaylistName(suggested, { trackCount: uris.length });
  if (!name) return;

  try {
    showProgress(`Creando "${name}"...`, 0, uris.length);
    const playlist = await createPlaylist(name, `Recomendado desde tus scrobbles`, false);
    showProgress('Agregando tracks...', 0, uris.length);
    await addTracksToPlaylist(playlist.id, uris);
    invalidatePlaylistsCache();
    hideProgress();
    showToast(`"${name}" creada`, 'success');
  } catch (e) {
    hideProgress();
    showToast('Error: ' + e.message, 'error');
  }
}
