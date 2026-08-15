// Ficha de álbum: modal chico con tapa, nombre, artista, plays/min totales,
// y botones para saltar a la ficha del artista o abrir el álbum en Spotify.
// Se dispara desde openAlbumCard({ name, artist, plays, min, img }).
//
// v=117: nueva sección "N de M pistas en tus me gusta" con la lista de likes
// que caen dentro de ese álbum (matcheados por album id si viene, si no por
// nombre + artista normalizados con util/album-key.js). Cada fila abre la
// ficha de canción y tiene botón ▶ de preview.
//
// v=142: ficha a dos columnas (pistas | tapa + escucha), corazón de "está en
// tus me gusta" en cada fila y previews que prueban contra TODOS los artistas
// del track.

import { escapeHtml } from '../ui/components.js?v=143';
import { openArtistCard } from './artist-card.js?v=143';
import { openModal, closeTop } from '../ui/modal-stack.js?v=143';
import { getBestAvailableLikes } from '../api.js?v=143';
import { albumKey, coverId } from '../util/album-key.js?v=143';
import { artistMatches } from '../util/track-match.js?v=143';
import { lookupAlbumStats } from '../util/album-stats.js?v=143';
import { getPreview } from '../api/preview-providers.js?v=143';
import { togglePreview, playingKey } from '../ui/preview-player.js?v=143';
import { openTrackCard } from './track-card.js?v=143';

const PLAY_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PAUSE_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
const DOTS_SVG = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
// Mismo corazón que la tracklist de W-Three (features/wthree.js).
const HEART_SVG = `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9A5 5 0 0 1 12 6.5 5 5 0 0 1 21.5 12c-2 4.4-9.5 9-9.5 9z"/></svg>`;

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

// Nombres de todos los artistas de un track (del track y, si hace falta, del
// álbum). Es lo que necesita la cadena de previews para no depender de que el
// primero sea el "buscable".
function artistsOf(t, alb) {
  const out = [];
  const seen = new Set();
  for (const x of [...(t?.artists || []), ...(alb?.artists || [])]) {
    const n = x?.name || (typeof x === 'string' ? x : '');
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

// Del cache de likes, devuelve las canciones que pertenecen a este álbum.
// Tres criterios, de más fuerte a más flojo:
//   1. album.id, si el llamador lo trajo.
//   2. coverId() de la tapa — el hash de la imagen es la identidad real del
//      disco (util/album-key.js) y es lo que ya usa el mosaico.
//   3. albumKey() exacto, y si no, mismo nombre de álbum + algún artista en
//      común. Este último es el que rescata los discos colaborativos: el
//      mosaico puede llamarlo «Kanye West» y los likes decir «¥$», y sin él la
//      ficha aparecía sin ninguna pista.
function likesInAlbum(likes, a) {
  if (!Array.isArray(likes) || likes.length === 0) return [];
  const targetKey = albumKey(a.name, a.artist);
  const targetNameKey = albumKey(a.name, '');
  const targetAlbumId = a.albumId || a.id || null;
  const targetCover = coverId(a.img);
  const out = [];
  const seen = new Set();
  for (const it of likes) {
    const t = it?.track || it;
    if (!t || !t.name) continue;
    const alb = t.album || {};
    const artistas = artistsOf(t, alb);
    const artistName = artistas[0] || '';
    const matchById = targetAlbumId && alb.id && alb.id === targetAlbumId;
    const matchByCover = !matchById && targetCover
      && (alb.images || []).some(im => coverId(im?.url) === targetCover);
    const mismoNombre = albumKey(alb.name || '', '') === targetNameKey;
    const matchByKey = !matchById && !matchByCover
      && (albumKey(alb.name || '', artistName) === targetKey
        || (mismoNombre && (!a.artist || artistMatches(artistas, a.artist))));
    if (!matchById && !matchByCover && !matchByKey) continue;
    if (t.id && seen.has(t.id)) continue;
    if (t.id) seen.add(t.id);
    out.push({
      id: t.id || null,
      name: t.name,
      artist: artistName,
      artists: artistas,
      album: alb.name || a.name,
      img: alb.images?.[2]?.url || alb.images?.[1]?.url || alb.images?.[0]?.url || null,
      trackNumber: t.track_number || 0,
    });
  }
  out.sort((x, y) => (x.trackNumber || 999) - (y.trackNumber || 999) || x.name.localeCompare(y.name, 'es'));
  return out;
}

function statsHtml(a) {
  if (!(a.plays > 0 || a.min > 0)) {
    return `<div class="album-modal-no-data">Sin datos de escucha en tu historial</div>`;
  }
  return `
    <div class="album-modal-stats">
      <div class="album-modal-stat">
        <div class="album-modal-stat-v">${fmtMinutes(a.min)}</div>
        <div class="album-modal-stat-l">tiempo escuchado</div>
      </div>
      <div class="album-modal-stat">
        <div class="album-modal-stat-v">${(a.plays || 0).toLocaleString('es-ES')}</div>
        <div class="album-modal-stat-l">plays</div>
      </div>
    </div>`;
}

export function openAlbumCard(a) {
  if (!a || !a.name) return;

  const spotifyQuery = encodeURIComponent(`${a.name} ${a.artist || ''}`.trim());
  const spotifyUrl = `https://open.spotify.com/search/${spotifyQuery}`;

  // Dos columnas (v=142): pistas a la izquierda, tapa + info de escucha a la
  // derecha. El orden del DOM es al revés (info primero) para que al plegarse
  // en una sola columna la tapa quede arriba; en escritorio las columnas se
  // reordenan con `order` en el CSS. El corte lo hace una media query, sin JS.
  const overlay = openModal({
    id: `album-card:${a.name}||${a.artist || ''}`,
    html: `
    <div class="modal card-modal album-modal" style="max-width:820px;width:min(820px,94vw)">
      <div class="card-modal-head-simple">
        <div class="card-modal-eyebrow">Ficha de álbum</div>
        <button class="btn btn-secondary btn-sm card-modal-close" data-close-modal>✕</button>
      </div>
      <div class="album-modal-cols">
        <div class="album-modal-col album-modal-col-info">
          <div class="album-modal-body">
            ${a.img
              ? `<img src="${a.img}" alt="" class="album-modal-cover">`
              : `<div class="album-modal-cover album-modal-cover-empty">♪</div>`
            }
            <div class="album-modal-name">${escapeHtml(a.name)}</div>
            <button class="album-modal-artist-link" id="alb-artist">${escapeHtml(a.artist || '')}</button>
          </div>
          <div id="alb-stats">${statsHtml(a)}</div>
          <div class="album-modal-actions">
            <button class="btn btn-primary btn-sm" id="alb-go-artist">Ver ficha del artista</button>
            <a class="btn btn-secondary btn-sm" id="alb-spotify" href="${spotifyUrl}" target="_blank" rel="noopener">Buscar en Spotify</a>
          </div>
        </div>
        <div class="album-modal-col album-modal-col-tracks">
          <div class="album-modal-likes" id="alb-likes"><div class="album-modal-likes-loading">cargando tus me gusta…</div></div>
        </div>
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

  // Los números SIEMPRE se recontrastan contra el historial, no solo cuando el
  // llamador no trajo ninguno. En v=140 la condición era "los dos en cero", y
  // eso dejaba pasar justo el caso que se veía: un llamador que trae los
  // minutos pero no las plays («20m · 0 plays»). `lookupAlbumStats` unifica por
  // `coverId()`, así que también junta los discos colaborativos que el export
  // parte en varias claves (VULTURES 1 como «¥$» y como «Kanye West»).
  //
  // Solo se pisa lo que el índice sabe de verdad: si devuelve ceros, se deja lo
  // que hubiera pasado el llamador.
  lookupAlbumStats(a).then(t => {
    if (!(t.plays > 0 || t.min > 0)) return;
    if (t.plays <= (a.plays || 0) && t.min <= (a.min || 0)) return;
    const slot = overlay.querySelector('#alb-stats');
    if (slot) slot.innerHTML = statsHtml({ ...a, ...t });
  }).catch(err => console.warn('[album-card] stats:', err.message));

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

  // El ♥ marca "está en tus me gusta", igual que en la tracklist de W-Three.
  // Antes ahí había un punto: era el NÚMERO DE PISTA, que nunca se llegó a ver
  // porque la caché de likes (`slimTrack` en api.js) no guardaba `track_number`
  // y el `·` era su relleno para el caso "no sé qué número es".
  //
  // Todas las filas de esta lista son likes, así que el corazón va lleno en
  // todas: la lista es "tus me gusta de este álbum", no el tracklist completo
  // (para eso haría falta `GET /albums/{id}/tracks`, que no está confirmado
  // vivo post-migración).
  holder.innerHTML = `
    <div class="album-modal-likes-head">
      <div class="album-modal-likes-title">${escapeHtml(countLine)}</div>
    </div>
    ${matched.length === 0 ? '' : `
      <div class="album-modal-likes-list">
        ${matched.map(t => `
          <div class="album-modal-like-row" data-tid="${escapeHtml(t.id || '')}">
            <span class="album-modal-like-heart" title="Está en tus me gusta" aria-label="En tus me gusta">${HEART_SVG}</span>
            <span class="album-modal-like-num">${t.trackNumber || ''}</span>
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
      openTrackCard({ id: t.id, name: t.name, artist: t.artist, artists: t.artists, album: t.album, img: t.img, albumImg: a.img });
    });
  });

  // ▶ preview por fila. Van TODOS los artistas del track más el del álbum: si
  // solo mandáramos el del álbum, un disco acreditado a un alias («¥$») no
  // matchea en ningún proveedor y se cae entero al embed de Spotify, que en un
  // iframe cross-origin no puede autoarrancar.
  holder.querySelectorAll('.album-modal-like-play').forEach(btn => {
    const id = btn.dataset.playId;
    const name = btn.dataset.playName;
    const t = matched.find(x => x.id === id);
    const setLabel = () => {
      btn.innerHTML = playingKey() === `alb:${id}` ? PAUSE_SVG : PLAY_SVG;
    };
    setLabel();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.innerHTML = DOTS_SVG;
      const res = await togglePreview(`alb:${id}`, async () => {
        return await getPreview({ name, artists: t?.artists, artist: a.artist, spotifyId: id });
      });
      if (res === true) btn.innerHTML = PAUSE_SVG;
      else if (res === null) { btn.textContent = '—'; btn.title = 'Sin preview'; btn.disabled = true; }
      else btn.innerHTML = PLAY_SVG;
    });
  });

  // Medición del punto 1: resuelve la cadena de proveedores para todas las
  // pistas de la ficha abierta y cuenta cuántas quedan con audio de verdad
  // (iTunes/Deezer) y cuántas caen al embed de Spotify. Se corre a mano desde
  // la consola porque son N búsquedas de red: no se dispara al abrir la ficha.
  window.__auditAlbumPreviews = async () => {
    const filas = [];
    for (const t of matched) {
      const p = await getPreview({ name: t.name, artists: t.artists, artist: a.artist, spotifyId: t.id });
      filas.push({ pista: t.name, artistas: (t.artists || []).join(', '), proveedor: p?.provider || 'ninguno' });
    }
    const cuenta = filas.reduce((acc, f) => { acc[f.proveedor] = (acc[f.proveedor] || 0) + 1; return acc; }, {});
    console.table(filas);
    console.log(`[album-card] ${a.name} — ${filas.length} pistas:`, cuenta);
    return { album: a.name, total: filas.length, cuenta, filas };
  };
}

// Reset del cache al cambiar de user u otro invalidador (no lo enganchamos
// automáticamente — es cheap re-armarlo la próxima vez).
export function _clearAlbumCardLikesCache() { _likesMemo = null; }
