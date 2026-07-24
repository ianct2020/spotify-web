import { getAllUserPlaylists } from '../api.js';
import { escapeHtml } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

const PID_KEY = 'listened_albums_playlist_id';
const PNAME_KEY = 'listened_albums_playlist_name';

// Normaliza texto para comparar (minúsculas, sin acentos ni símbolos).
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Saca marcas de edición para que "X" y "X (Deluxe Version)" cuenten como el mismo álbum.
function baseName(name) {
  let s = String(name || '').toLowerCase();
  // Saca marcas de edición entre paréntesis/corchetes: "X" y "X (Deluxe/Intimate/Acoustic…)"
  // cuentan como el mismo álbum. OJO: NO tocamos números ni volúmenes (LP3, II, Vol. 2, Part 1),
  // porque esos son álbumes DISTINTOS, no ediciones del mismo.
  s = s.replace(/[([][^)\]]*(deluxe|remaster|expanded|edition|version|anniversary|reissue|bonus|explicit|mono|stereo|special|platinum|collector|intimate|acoustic|instrumental|unplugged)[^)\]]*[)\]]/g, ' ');
  s = s.replace(/\s*[-–—:]\s*(deluxe|remaster(?:ed)?|expanded|special|anniversary|reissue|bonus)\b.*$/g, ' ');
  s = s.replace(/\b(deluxe|remastered|remaster|expanded|edition|version|anniversary|reissue|collector(?:'?s)?|platinum)\b/g, ' ');
  return s;
}

// Clave que matchea la misma obra entre ediciones: nombre-sin-edición | artista.
function albumKey(name, artist) {
  return `${norm(baseName(name))}|${norm(artist)}`;
}

function getListenedPlaylist() {
  const id = localStorage.getItem(PID_KEY);
  if (!id) return null;
  return { id, name: localStorage.getItem(PNAME_KEY) || 'Álbumes escuchados' };
}

function setListenedPlaylist(id, name) {
  localStorage.setItem(PID_KEY, id);
  localStorage.setItem(PNAME_KEY, name);
}

function clearListenedPlaylist() {
  localStorage.removeItem(PID_KEY);
  localStorage.removeItem(PNAME_KEY);
}

// Agrupa items de una playlist (respuesta de /playlists/{id}/items) por álbum.
// Devuelve array de { id, name, artist, year, image, url, tracks:[{name, artists, url}], addedAt }.
function groupItemsByAlbum(items) {
  const map = new Map();
  for (const it of items) {
    const t = it.item || it.track;
    const album = t?.album;
    if (!album?.id) continue;
    let entry = map.get(album.id);
    if (!entry) {
      const imgs = album.images || [];
      entry = {
        id: album.id,
        name: album.name || '(sin nombre)',
        artist: album.artists?.[0]?.name || t.artists?.[0]?.name || '',
        year: (album.release_date || '').slice(0, 4),
        image: imgs.length ? (imgs[imgs.length - 1].url) : null,
        cover: imgs.length ? (imgs[0].url) : null,
        url: album.external_urls?.spotify || null,
        tracks: [],
        addedAt: 0,
      };
      map.set(album.id, entry);
    }
    entry.tracks.push({
      name: t.name || '',
      artists: (t.artists || []).map(a => a.name).join(', '),
      uri: t.uri || (t.id ? `spotify:track:${t.id}` : null),
      url: t.external_urls?.spotify || null,
    });
    const added = it.added_at ? Date.parse(it.added_at) : 0;
    if (added > entry.addedAt) entry.addedAt = added;
  }
  return [...map.values()];
}

// Modal buscador de playlist. Llama onSelect(id, name) / onClear() cuando el user actúa.
async function openListenedAlbumsPicker({ onSelect, onClear } = {}) {
  let playlists;
  try {
    playlists = await getAllUserPlaylists();
  } catch (e) {
    showToast('Error cargando playlists: ' + e.message, 'error');
    return;
  }

  const current = localStorage.getItem(PID_KEY);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:560px">
      <h2 style="margin-bottom:8px">Elegí tu playlist de álbumes escuchados</h2>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:12px">
        La app va a agrupar por álbum los tracks de la playlist que elijas. Se guarda en tu cache local (y en tu backup JSON si exportás).
      </p>
      <input type="text" id="lap-search" placeholder="Buscar playlist..." autocomplete="off"
             style="width:100%;padding:10px;background:var(--color-elevated);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-size:14px;margin-bottom:12px">
      <div id="lap-list" style="max-height:360px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-elevated)"></div>
      <div class="modal-actions" style="margin-top:14px">
        ${current ? '<button class="btn btn-secondary" id="lap-clear">Desconectar</button>' : ''}
        <button class="btn btn-secondary" id="lap-cancel">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const listEl = overlay.querySelector('#lap-list');
  const searchEl = overlay.querySelector('#lap-search');
  const renderList = (filter) => {
    const f = (filter || '').toLowerCase();
    const filtered = playlists.filter(p => !f || p.name.toLowerCase().includes(f));
    listEl.innerHTML = filtered.slice(0, 200).map(p => `
      <div class="lap-item" data-id="${p.id}" data-name="${escapeHtml(p.name)}"
           style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--color-border)">
        ${p.image ? `<img src="${p.image}" style="width:36px;height:36px;border-radius:var(--radius-sm);object-fit:cover">` : `<div style="width:36px;height:36px;background:var(--color-surface);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center">♪</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.name)}</div>
          <div style="font-size:12px;color:var(--color-text-muted)">${(p.tracks?.total ?? '?').toLocaleString()} tracks</div>
        </div>
        ${current === p.id ? '<span style="color:var(--color-accent);font-size:12px">actual</span>' : ''}
      </div>
    `).join('') || `<div style="padding:20px;text-align:center;color:var(--color-text-muted);font-size:13px">Sin resultados</div>`;

    listEl.querySelectorAll('.lap-item').forEach(el => {
      el.onmouseenter = () => { el.style.background = 'var(--color-surface)'; };
      el.onmouseleave = () => { el.style.background = 'transparent'; };
      el.onclick = () => {
        setListenedPlaylist(el.dataset.id, el.dataset.name);
        overlay.remove();
        showToast(`"${el.dataset.name}" configurada como álbumes escuchados`, 'success');
        onSelect?.(el.dataset.id, el.dataset.name);
      };
    });
  };
  renderList('');
  searchEl.oninput = () => renderList(searchEl.value.trim());
  setTimeout(() => searchEl.focus(), 30);

  overlay.querySelector('#lap-cancel').onclick = () => overlay.remove();
  const clearBtn = overlay.querySelector('#lap-clear');
  if (clearBtn) {
    clearBtn.onclick = () => {
      clearListenedPlaylist();
      overlay.remove();
      showToast('Álbumes escuchados desconectado', 'info');
      onClear?.();
    };
  }
}

export {
  getListenedPlaylist,
  setListenedPlaylist,
  clearListenedPlaylist,
  groupItemsByAlbum,
  openListenedAlbumsPicker,
  norm,
  baseName,
  albumKey,
  PID_KEY,
  PNAME_KEY,
};
