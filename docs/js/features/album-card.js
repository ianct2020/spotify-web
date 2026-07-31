// Ficha de álbum: modal chico con tapa, nombre, artista, plays/min totales,
// y botones para saltar a la ficha del artista o abrir el álbum en Spotify.
// Se dispara desde openAlbumCard({ name, artist, plays, min, img }).

import { escapeHtml } from '../ui/components.js?v=106';
import { openArtistCard } from './artist-card.js?v=106';

function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) return `${Math.floor(min / 60).toLocaleString('es-AR')}h ${Math.round(min % 60)}m`;
  return `${Math.round(min)}m`;
}

function close() {
  document.getElementById('album-card-overlay')?.remove();
}

export function openAlbumCard(a) {
  if (!a || !a.name) return;
  close();

  const spotifyQuery = encodeURIComponent(`${a.name} ${a.artist || ''}`.trim());
  const spotifyUrl = `https://open.spotify.com/search/${spotifyQuery}`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'album-card-overlay';
  overlay.innerHTML = `
    <div class="modal card-modal album-modal" style="max-width:420px;width:min(420px,94vw)">
      <div class="card-modal-head-simple">
        <div class="card-modal-eyebrow">Ficha de álbum</div>
        <button class="btn btn-secondary btn-sm card-modal-close" id="alb-close">✕</button>
      </div>
      <div class="album-modal-body">
        ${a.img
          ? `<img src="${a.img}" alt="" class="album-modal-cover">`
          : `<div class="album-modal-cover album-modal-cover-empty">♪</div>`
        }
        <div class="album-modal-name">${escapeHtml(a.name)}</div>
        <button class="album-modal-artist-link" id="alb-artist">${escapeHtml(a.artist || '')}</button>
      </div>
      <div class="album-modal-stats">
        <div class="album-modal-stat">
          <div class="album-modal-stat-v">${fmtMinutes(a.min)}</div>
          <div class="album-modal-stat-l">tiempo escuchado</div>
        </div>
        <div class="album-modal-stat">
          <div class="album-modal-stat-v">${(a.plays || 0).toLocaleString('es-AR')}</div>
          <div class="album-modal-stat-l">plays</div>
        </div>
      </div>
      <div class="album-modal-actions">
        <button class="btn btn-primary btn-sm" id="alb-go-artist">Ver ficha del artista</button>
        <a class="btn btn-secondary btn-sm" id="alb-spotify" href="${spotifyUrl}" target="_blank" rel="noopener">Buscar en Spotify</a>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.getElementById('alb-close').onclick = close;
  document.getElementById('alb-artist').onclick = () => {
    close();
    if (a.artist) openArtistCard({ name: a.artist });
  };
  document.getElementById('alb-go-artist').onclick = () => {
    close();
    if (a.artist) openArtistCard({ name: a.artist });
  };
}

// Cierre con ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('album-card-overlay')) close();
});
