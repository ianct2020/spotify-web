import { spotifyFetch, getBestAvailableLikes, getAllPlaylistItems } from '../api.js';
import { hasKey, setKey, getSimilarArtists, getArtistTopTracks } from '../api/lastfm.js';
import { escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';
import { getListenedPlaylist } from './listened-shared.js';

const MAX_SIMILAR_SCAN = 12;   // artistas similares a escanear
const ALBUMS_PER_ARTIST = 20;  // resultados de búsqueda por artista
const ENOUGH_CANDIDATES = 16;  // corte temprano

let sourceAlbum = null;
let candidates = [];
let candidateIdx = 0;

// filtros (se cachean en la sesión para no re-fetchear en cada pick)
let likedAlbumIds = null;
let likedUris = null;
let listenedAlbumIds = null;
let likedAlbumKeys = null;      // clave nombre-sin-edición|artista (matchea deluxe vs normal)
let listenedAlbumKeys = null;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Saca marcas de edición para que "X" y "X (Deluxe Version)" cuenten como el mismo álbum.
function baseName(name) {
  let s = String(name || '').toLowerCase();
  s = s.replace(/[([][^)\]]*(deluxe|remaster|expanded|edition|version|anniversary|reissue|bonus|explicit|mono|stereo|special|platinum|collector)[^)\]]*[)\]]/g, ' ');
  s = s.replace(/\s*[-–—:]\s*(deluxe|remaster(?:ed)?|expanded|special|anniversary|reissue|bonus)\b.*$/g, ' ');
  s = s.replace(/\b(deluxe|remastered|remaster|expanded|edition|version|anniversary|reissue)\b/g, ' ');
  return s;
}
function albumKey(name, artist) {
  return `${norm(baseName(name))}|${norm(artist)}`;
}

export function render(container) {
  sourceAlbum = null;
  candidates = [];
  candidateIdx = 0;

  container.innerHTML = `
    <div class="page-header">
      <h1>Álbum similar</h1>
      <p>Elegí un álbum y te propongo uno parecido que <strong>no tengas en likes ni en tus álbumes escuchados</strong>.</p>
    </div>
    <div id="disc-content"></div>
  `;

  if (!hasKey()) {
    renderKeySetup();
    return;
  }
  renderSearch();
}

function renderKeySetup() {
  const content = document.getElementById('disc-content');
  content.innerHTML = `
    <div class="card" style="max-width:480px">
      <h3 style="margin-bottom:8px">Configurá tu Last.fm API key</h3>
      <p style="color:var(--color-text-secondary);font-size:14px;margin-bottom:16px">
        Se usa para traer artistas parecidos. Sacala gratis en
        <a href="https://www.last.fm/api/account/create" target="_blank" style="color:var(--color-accent)">last.fm/api/account/create</a>.
        Queda solo en tu navegador.
      </p>
      <input type="text" id="disc-key-input" placeholder="API key" autocomplete="off"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-family:monospace;font-size:14px;margin-bottom:12px">
      <button class="btn btn-primary" id="disc-key-save" style="width:100%">Guardar</button>
    </div>
  `;
  document.getElementById('disc-key-save').onclick = () => {
    const val = document.getElementById('disc-key-input').value.trim();
    if (val.length < 20) { showToast('Key inválida', 'error'); return; }
    setKey(val);
    showToast('Key guardada', 'success');
    renderSearch();
  };
}

function renderSearch() {
  const content = document.getElementById('disc-content');
  content.innerHTML = `
    <div class="card" style="max-width:560px;margin-bottom:20px">
      <label style="display:block;margin-bottom:4px;font-weight:500">Buscar álbum</label>
      <p style="color:var(--color-text-muted);font-size:12px;margin-bottom:8px">
        Tomo el artista del álbum que elijas, busco en Last.fm hasta 12 <strong>otros</strong> artistas que suenan parecido, y te propongo álbumes de ellos (no del mismo artista) que no tengas en likes ni escuchados.
      </p>
      <input type="text" id="disc-search-input" placeholder="Ej: In Rainbows"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px;margin-bottom:8px">
      <div id="disc-search-results"></div>
    </div>
    <div id="disc-panel"></div>
  `;
  const input = document.getElementById('disc-search-input');
  let debounce;
  input.oninput = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => searchAlbum(input.value.trim()), 320);
  };
  input.focus();
}

async function searchAlbum(query) {
  const results = document.getElementById('disc-search-results');
  if (!query) { results.innerHTML = ''; return; }
  try {
    const data = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=album&limit=8`);
    const list = data.albums?.items || [];
    if (list.length === 0) {
      results.innerHTML = `<div style="color:var(--color-text-muted);padding:8px 0">Sin resultados</div>`;
      return;
    }
    results.innerHTML = `
      <div style="border-top:1px solid var(--color-border);margin-top:8px;padding-top:8px;display:flex;flex-direction:column;gap:4px">
        ${list.map((a, i) => {
          const img = a.images?.[a.images.length - 1]?.url;
          const artist = (a.artists || []).map(x => x.name).join(', ');
          const year = (a.release_date || '').slice(0, 4);
          return `
            <div class="disc-search-item" data-idx="${i}"
                 style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius-sm);cursor:pointer">
              ${img ? `<img src="${img}" style="width:44px;height:44px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:44px;height:44px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
              <div style="min-width:0">
                <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(a.name)}</div>
                <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(artist)}${year ? ` · ${year}` : ''}</div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    results.querySelectorAll('.disc-search-item').forEach(el => {
      el.onmouseenter = () => { el.style.background = 'var(--color-elevated)'; };
      el.onmouseleave = () => { el.style.background = 'transparent'; };
      el.onclick = () => pickSourceAlbum(list[parseInt(el.dataset.idx)]);
    });
  } catch (e) {
    results.innerHTML = `<div style="color:var(--color-error);padding:8px 0">${escapeHtml(e.message)}</div>`;
  }
}

async function ensureFilters() {
  if (likedAlbumIds && likedUris && listenedAlbumIds && likedAlbumKeys && listenedAlbumKeys) return;

  const { items: likes } = await getBestAvailableLikes();
  likedAlbumIds = new Set();
  likedUris = new Set();
  likedAlbumKeys = new Set();
  for (const it of likes) {
    const t = it.track;
    if (t?.album?.id) likedAlbumIds.add(t.album.id);
    if (t?.uri) likedUris.add(t.uri);
    if (t?.album?.name) likedAlbumKeys.add(albumKey(t.album.name, t.artists?.[0]?.name || ''));
  }

  listenedAlbumIds = new Set();
  listenedAlbumKeys = new Set();
  const pl = getListenedPlaylist();
  if (pl) {
    try {
      const items = await getAllPlaylistItems(pl.id);
      for (const it of items) {
        const alb = it.item?.album || it.track?.album;
        if (alb?.id) listenedAlbumIds.add(alb.id);
        if (alb?.name) {
          const an = alb.artists?.[0]?.name || it.item?.artists?.[0]?.name || it.track?.artists?.[0]?.name || '';
          listenedAlbumKeys.add(albumKey(alb.name, an));
        }
      }
    } catch (e) {
      console.warn('No se pudieron cargar los álbumes escuchados:', e.message);
    }
  }
}

async function pickSourceAlbum(album) {
  sourceAlbum = album;
  candidates = [];
  candidateIdx = 0;
  document.getElementById('disc-search-input').value = `${album.name} — ${(album.artists || []).map(a => a.name).join(', ')}`;
  document.getElementById('disc-search-results').innerHTML = '';

  const panel = document.getElementById('disc-panel');
  const sourceArtist = album.artists?.[0]?.name;
  if (!sourceArtist) {
    panel.innerHTML = `<div class="card"><p>Ese álbum no tiene artista reconocible.</p></div>`;
    return;
  }

  panel.innerHTML = `
    <div class="card">
      <div id="disc-progress-text" style="font-size:14px;margin-bottom:10px">Preparando filtros...</div>
      <div style="height:8px;background:var(--color-elevated);border-radius:4px;overflow:hidden">
        <div id="disc-progress-bar" style="height:100%;background:var(--color-accent);width:0%;transition:width 0.2s"></div>
      </div>
    </div>
  `;
  const textEl = document.getElementById('disc-progress-text');
  const barEl = document.getElementById('disc-progress-bar');

  try {
    await ensureFilters();

    if (likedAlbumIds.size === 0) {
      textEl.innerHTML = `<span style="color:var(--color-warning)">Ojo:</span> no tenés likes cacheados, así que no puedo filtrar por "ya en tus likes". Cargalos desde el Dashboard para mejores resultados.`;
    }

    textEl.textContent = `Buscando artistas parecidos a ${sourceArtist}...`;
    const similar = await getSimilarArtists(sourceArtist, 50);
    if (similar.length === 0) {
      panel.innerHTML = `<div class="card"><p>Last.fm no tiene artistas parecidos a "${escapeHtml(sourceArtist)}".</p></div>`;
      return;
    }

    const sourceArtistNorm = norm(sourceArtist);
    const scan = similar
      .filter(s => norm(s.name) !== sourceArtistNorm)
      .slice(0, MAX_SIMILAR_SCAN);

    const seenAlbumIds = new Set();
    const seenNameArtist = new Set();

    for (let i = 0; i < scan.length; i++) {
      const s = scan[i];
      textEl.textContent = `Buscando álbumes de artistas parecidos (${i + 1}/${scan.length}: ${s.name})...`;
      barEl.style.width = `${((i + 1) / scan.length * 100).toFixed(0)}%`;

      let found;
      try {
        const q = encodeURIComponent(`artist:"${s.name}"`);
        const data = await spotifyFetch(`/search?q=${q}&type=album&limit=${ALBUMS_PER_ARTIST}`);
        found = data.albums?.items || [];
      } catch (e) {
        console.warn('search album falló para', s.name, e.message);
        found = [];
      }

      const sNorm = norm(s.name);
      for (const al of found) {
        if (al.album_type !== 'album') continue;                    // sin singles ni compilados
        const primary = al.artists?.[0]?.name || '';
        const pNorm = norm(primary);
        if (!(pNorm === sNorm || pNorm.includes(sNorm) || sNorm.includes(pNorm))) continue; // evita features
        if (al.id === sourceAlbum.id) continue;
        if (likedAlbumIds.has(al.id)) continue;                     // ya tenés un track de él en likes
        if (listenedAlbumIds.has(al.id)) continue;                  // ya lo escuchaste
        const editionKey = albumKey(al.name, primary);
        if (likedAlbumKeys.has(editionKey)) continue;               // misma obra en likes (deluxe/no deluxe)
        if (listenedAlbumKeys.has(editionKey)) continue;            // misma obra ya escuchada (otra edición)
        if (seenAlbumIds.has(al.id)) continue;
        const naKey = `${norm(al.name)}|${pNorm}`;
        if (seenNameArtist.has(naKey)) continue;                    // deluxe/remaster duplicado
        seenAlbumIds.add(al.id);
        seenNameArtist.add(naKey);
        candidates.push({ album: al, fromArtist: s.name, match: s.match });
      }

      if (candidates.length >= ENOUGH_CANDIDATES) break;
      await sleep(120);
    }

    if (candidates.length === 0) {
      renderNoAlbums(scan);
      return;
    }

    // orden: mejor match primero, luego más nuevo
    candidates.sort((a, b) => (b.match - a.match) || ((b.album.release_date || '').localeCompare(a.album.release_date || '')));
    candidateIdx = 0;
    renderCandidate();
  } catch (e) {
    panel.innerHTML = `<div class="card"><p style="color:var(--color-error)">${escapeHtml(e.message)}</p></div>`;
  }
}

function renderCandidate() {
  const panel = document.getElementById('disc-panel');
  const c = candidates[candidateIdx];
  const al = c.album;
  const cover = al.images?.[0]?.url;
  const artist = (al.artists || []).map(a => a.name).join(', ');
  const year = (al.release_date || '').slice(0, 4);

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <div style="font-size:13px;color:var(--color-text-secondary)">
        Propuesta <strong>${candidateIdx + 1}</strong> de ${candidates.length} · parte de <strong>${escapeHtml(c.fromArtist)}</strong> (match ${(c.match * 100).toFixed(0)}% con ${escapeHtml(sourceAlbum.artists?.[0]?.name || '')})
      </div>
      <button class="btn btn-secondary btn-sm" id="disc-restart">← Otro álbum de origen</button>
    </div>

    <div class="card" style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      ${cover ? `<img src="${cover}" style="width:180px;height:180px;border-radius:var(--radius-md);object-fit:cover;flex-shrink:0">` : `<div style="width:180px;height:180px;background:var(--color-elevated);border-radius:var(--radius-md)"></div>`}
      <div style="flex:1;min-width:220px">
        <h2 style="margin-bottom:4px">${escapeHtml(al.name)}</h2>
        <div style="color:var(--color-text-secondary);font-size:15px;margin-bottom:2px">${escapeHtml(artist)}</div>
        <div style="color:var(--color-text-muted);font-size:13px;margin-bottom:16px">${year ? year + ' · ' : ''}${al.total_tracks || '?'} tracks</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${al.external_urls?.spotify ? `<a class="btn btn-primary" href="${al.external_urls.spotify}" target="_blank" rel="noopener">Abrir en Spotify</a>` : ''}
          <button class="btn btn-secondary" id="disc-next" ${candidateIdx >= candidates.length - 1 ? 'disabled' : ''}>Mostrar otro parecido</button>
        </div>
        <div style="font-size:12px;color:var(--color-text-muted);margin-top:10px">
          Ninguno de sus tracks está en tus likes y el álbum no está en tu registro de escuchados.
        </div>
        <div id="disc-tracklist" style="margin-top:14px"></div>
      </div>
    </div>
  `;

  document.getElementById('disc-restart').onclick = renderSearch;
  const nextBtn = document.getElementById('disc-next');
  if (nextBtn) nextBtn.onclick = () => {
    if (candidateIdx < candidates.length - 1) { candidateIdx++; renderCandidate(); }
  };

  loadTracklistPreview(al.id);
}

// Best-effort: si el endpoint de tracks del álbum vive, mostramos la lista. Si no, se omite.
async function loadTracklistPreview(albumId) {
  const el = document.getElementById('disc-tracklist');
  if (!el) return;
  try {
    const data = await spotifyFetch(`/albums/${albumId}/tracks?limit=50`);
    const tracks = data?.items || [];
    if (tracks.length === 0) return;
    el.innerHTML = `
      <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px">Tracklist</div>
      <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm);max-height:220px;overflow-y:auto">
        ${tracks.map((t, i) => `
          <div style="display:flex;gap:10px;padding:7px 12px;border-bottom:1px solid var(--color-border);font-size:13px">
            <span style="width:20px;text-align:center;color:var(--color-text-muted);flex-shrink:0">${i + 1}</span>
            <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    // el endpoint puede estar deprecado post-migración; degradamos sin ruido
    console.warn('tracklist no disponible:', e.message);
  }
}

async function renderNoAlbums(scanArtists) {
  const panel = document.getElementById('disc-panel');
  panel.innerHTML = `
    <div class="card">
      <p style="margin-bottom:8px">No encontré ningún <strong>álbum</strong> parecido que no tengas ya en likes o escuchados.</p>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">
        Puede ser que ya tengas cubierto todo lo cercano. Probá con canciones sueltas de artistas parecidos, filtradas para que no estén en tus likes.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="disc-loose">Buscar canciones sueltas</button>
        <button class="btn btn-secondary" id="disc-restart2">← Otro álbum de origen</button>
      </div>
      <div id="disc-loose-holder" style="margin-top:16px"></div>
    </div>
  `;
  document.getElementById('disc-restart2').onclick = renderSearch;
  document.getElementById('disc-loose').onclick = () => findLooseTracks(scanArtists.slice(0, 6));
}

async function findLooseTracks(scanArtists) {
  const holder = document.getElementById('disc-loose-holder');
  holder.innerHTML = `<div class="empty-state"><div class="spinner"></div><div style="margin-top:12px;font-size:13px">Buscando canciones...</div></div>`;

  const picks = [];
  const seen = new Set();
  for (const s of scanArtists) {
    let top = [];
    try {
      top = await getArtistTopTracks(s.name, 8);
    } catch { /* ignora */ }
    for (const t of top.slice(0, 5)) {
      try {
        const q = `track:"${t.name}" artist:"${t.artist}"`;
        const data = await spotifyFetch(`/search?q=${encodeURIComponent(q)}&type=track&limit=1`);
        const hit = data.tracks?.items?.[0];
        if (!hit) continue;
        if (likedUris.has(hit.uri)) continue;
        if (seen.has(hit.uri)) continue;
        seen.add(hit.uri);
        picks.push({
          name: hit.name,
          artist: (hit.artists || []).map(a => a.name).join(', '),
          album: hit.album?.name,
          image: hit.album?.images?.[hit.album.images.length - 1]?.url,
          url: hit.external_urls?.spotify,
        });
      } catch { /* ignora */ }
      await sleep(120);
    }
    if (picks.length >= 15) break;
  }

  if (picks.length === 0) {
    holder.innerHTML = `<p style="color:var(--color-text-muted);font-size:13px">Tampoco encontré canciones sueltas que no tengas ya. Probá con otro álbum de origen.</p>`;
    return;
  }

  holder.innerHTML = `
    <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:8px">${picks.length} canciones parecidas que no tenés en likes</div>
    <div style="border:1px solid var(--color-border);border-radius:var(--radius-sm)">
      ${picks.map(t => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--color-border)">
          ${t.image ? `<img src="${t.image}" style="width:38px;height:38px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:38px;height:38px;background:var(--color-elevated);border-radius:var(--radius-sm)"></div>`}
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.name)}</div>
            <div style="font-size:12px;color:var(--color-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.artist)}${t.album ? ` · ${escapeHtml(t.album)}` : ''}</div>
          </div>
          ${t.url ? `<a href="${t.url}" target="_blank" rel="noopener" style="color:var(--color-accent);font-size:12px;flex-shrink:0">abrir</a>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
