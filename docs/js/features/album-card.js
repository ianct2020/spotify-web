// Ficha de álbum: modal chico con tapa, nombre, artista, plays/min totales,
// y botones para saltar a la ficha del artista o abrir el álbum en Spotify.
// Se dispara desde openAlbumCard({ name, artist, plays, min, img }).
//
// v=117: nueva sección "N de M pistas en tus me gusta" con la lista de likes
// que caen dentro de ese álbum (matcheados por album id si viene, si no por
// nombre + artista normalizados con util/album-key.js). Cada fila abre la
// ficha de canción y tiene botón ▶ de preview.

import { escapeHtml } from '../ui/components.js?v=126';
import { openArtistCard } from './artist-card.js?v=126';
import { openModal, closeTop } from '../ui/modal-stack.js?v=126';
import { getBestAvailableLikes } from '../api.js?v=126';
import { albumKey } from '../util/album-key.js?v=126';
import { getPreview } from '../api/preview-providers.js?v=126';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=126';
import { openTrackCard } from './track-card.js?v=126';

const PLAY_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const DOTS_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

// Cache del último set de likes en memoria (evita re-fetch del cache al
// abrir varias fichas seguidas dentro de la misma sesión).
let _likesMemo = null;
async function loadLikesMemo() {
  if (_likesMemo) return _likesMemo;
  try {
    const res = await getBestAvailableLikes();
    _likesMemo = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
  } catch { _likesMemo = []; }
  return _likesMemo;
}

function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) return `${Math.floor(min / 60).toLocaleString('es-ES')}h ${Math.round(min % 60)}m`;
  return `${Math.round(min)}m`;
}

// Del cache de likes, devuelve las canciones que pertenecen a este álbum.
// Estrategia: primero matcheamos por album.id si tenemos uno; si no, o si no
// matchea nada, caemos a matchear por albumKey(name, artist).
function likesInAlbum(likes, a) {
  if (!Array.isArray(likes) || likes.length === 0) return [];
  const targetKey = albumKey(a.name, a.artist);
  const targetAlbumId = a.albumId || a.id || null;
  const out = [];
  const seen = new Set();
  for (const it of likes) {
    const t = it?.track || it;
    if (!t || !t.name) continue;
    const alb = t.album || {};
    const artistName = t.artists?.[0]?.name || alb.artists?.[0]?.name || '';
    const matchById = targetAlbumId && alb.id && alb.id === targetAlbumId;
    const matchByKey = !matchById && albumKey(alb.name || '', artistName) === targetKey;
    if (!matchById && !matchByKey) continue;
    if (t.id && seen.has(t.id)) continue;
    if (t.id) seen.add(t.id);
    out.push({
      id: t.id || null,
      name: t.name,
      artist: artistName,
      album: alb.name || a.name,
      img: alb.images?.[2]?.url || alb.images?.[1]?.url || alb.images?.[0]?.url || null,
      trackNumber: t.track_number || 0,
    });
  }
  out.sort((x, y) => (x.trackNumber || 999) - (y.trackNumber || 999) || x.name.localeCompare(y.name, 'es'));
  return out;
}

export function openAlbumCard(a) {
  if (!a || !a.name) return;

  const spotifyQuery = encodeURIComponent(`${a.name} ${a.artist || ''}`.trim());
  const spotifyUrl = `https://open.spotify.com/search/${spotifyQuery}`;

  const overlay = openModal({
    id: `album-card:${a.name}||${a.artist || ''}`,
    html: `
    <div class="modal card-modal album-modal" style="max-width:460px;width:min(460px,94vw)">
      <div class="card-modal-head-simple">
        <div class="card-modal-eyebrow">Ficha de álbum</div>
        <button class="btn btn-secondary btn-sm card-modal-close" data-close-modal>✕</button>
      </div>
      <div class="album-modal-body">
        ${a.img
          ? `<img src="${a.img}" alt="" class="album-modal-cover">`
          : `<div class="album-modal-cover album-modal-cover-empty">♪</div>`
        }
        <div class="album-modal-name">${escapeHtml(a.name)}</div>
        <button class="album-modal-artist-link" id="alb-artist">${escapeHtml(a.artist || '')}</button>
      </div>
      ${(a.plays > 0 || a.min > 0) ? `
      <div class="album-modal-stats">
        <div class="album-modal-stat">
          <div class="album-modal-stat-v">${fmtMinutes(a.min)}</div>
          <div class="album-modal-stat-l">tiempo escuchado</div>
        </div>
        <div class="album-modal-stat">
          <div class="album-modal-stat-v">${(a.plays || 0).toLocaleString('es-ES')}</div>
          <div class="album-modal-stat-l">plays</div>
        </div>
      </div>
      ` : `
      <div class="album-modal-no-data">Sin datos de escucha en tu historial</div>
      `}
      <div class="album-modal-likes" id="alb-likes"><div class="album-modal-likes-loading">cargando tus me gusta…</div></div>
      <div class="album-modal-actions">
        <button class="btn btn-primary btn-sm" id="alb-go-artist">Ver ficha del artista</button>
        <a class="btn btn-secondary btn-sm" id="alb-spotify" href="${spotifyUrl}" target="_blank" rel="noopener">Buscar en Spotify</a>
      </div>
    </div>
  `,
  });

  overlay.querySelector('#alb-artist').onclick = () => {
    if (a.artist) openArtistCard({ name: a.artist });
  };
  overlay.querySelector('#alb-go-artist').onclick = () => {
    if (a.artist) openArtistCard({ name: a.artist });
  };

  hydrateLikes(overlay, a).catch(err => {
    console.warn('[album-card] likes:', err.message);
    const holder = overlay.querySelector('#alb-likes');
    if (holder) holder.innerHTML = '';
  });
}

async function hydrateLikes(overlay, a) {
  const holder = overlay.querySelector('#alb-likes');
  if (!holder) return;
  const likes = await loadLikesMemo();
  const matched = likesInAlbum(likes, a);
  const totalHint = a.totalTracks || null;
  const countLine = totalHint
    ? `${matched.length} de ${totalHint} pistas en tus me gusta`
    : matched.length > 0
      ? `${matched.length} pista${matched.length === 1 ? '' : 's'} en tus me gusta`
      : 'no tienes ninguna en tus me gusta';

  holder.innerHTML = `
    <div class="album-modal-likes-head">
      <div class="album-modal-likes-title">${escapeHtml(countLine)}</div>
    </div>
    ${matched.length === 0 ? '' : `
      <div class="album-modal-likes-list">
        ${matched.map(t => `
          <div class="album-modal-like-row" data-tid="${escapeHtml(t.id || '')}">
            <span class="album-modal-like-num">${t.trackNumber || '·'}</span>
            <span class="album-modal-like-name">${escapeHtml(t.name)}</span>
            <button type="button" class="wt-play-btn album-modal-like-play" data-play-id="${escapeHtml(t.id || '')}" data-play-name="${escapeHtml(t.name)}" title="Preview 30s" aria-label="Preview">${PLAY_SVG}</button>
          </div>
        `).join('')}
      </div>
    `}
  `;

  // Click en una fila → ficha de canción apilada.
  holder.querySelectorAll('.album-modal-like-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.album-modal-like-play')) return;
      const tid = row.dataset.tid;
      const t = matched.find(x => x.id === tid);
      if (!t) return;
      openTrackCard({ id: t.id, name: t.name, artist: t.artist, album: t.album, img: t.img });
    });
  });

  // ▶ preview por fila.
  holder.querySelectorAll('.album-modal-like-play').forEach(btn => {
    const id = btn.dataset.playId;
    const name = btn.dataset.playName;
    const setLabel = () => {
      btn.innerHTML = playingKey() === `alb:${id}` ? PAUSE_SVG : PLAY_SVG;
    };
    setLabel();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.innerHTML = DOTS_SVG;
      const res = await togglePreview(`alb:${id}`, async () => {
        return await getPreview({ name, artist: a.artist, spotifyId: id });
      });
      if (res === true) btn.innerHTML = PAUSE_SVG;
      else if (res === null) { btn.textContent = '—'; btn.title = 'Sin preview'; btn.disabled = true; }
      else btn.innerHTML = PLAY_SVG;
    });
  });
}

// Reset del cache al cambiar de user u otro invalidador (no lo enganchamos
// automáticamente — es cheap re-armarlo la próxima vez).
export function _clearAlbumCardLikesCache() { _likesMemo = null; }
