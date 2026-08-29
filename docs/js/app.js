import { isLoggedIn, loginWithSpotify, logout } from './auth.js?v=170';
import { spotifyFetch, tryAutoLoadUserBackup } from './api.js?v=170';
import { getValidToken } from './auth.js?v=170';
import { cacheClearAll } from './storage.js?v=170';
import { idbClearAll } from './idb.js?v=170';
import { registerRoute, initRouter } from './router.js?v=170';
import { showToast } from './ui/toast.js?v=170';
import { pageHeader } from './ui/components.js?v=170';
import { installCrashGuard } from './ui/crash-guard.js?v=170';
import { getStack } from './ui/modal-stack.js?v=170';
import { installBackToTop } from './ui/back-to-top.js?v=170';
import { applyStoredTheme, openThemePanel } from './ui/theme-panel.js?v=170';

import { render as renderSync } from './features/sync.js?v=170';
import { render as renderDedupe } from './features/dedupe.js?v=170';
import { render as renderDupalbums } from './features/duplicate-albums.js?v=170';
import { render as renderZombies } from './features/zombies.js?v=170';
import { render as renderVersions } from './features/versions.js?v=170';
import { render as renderDashboard } from './features/dashboard.js?v=170';
import { render as renderSmart } from './features/smart.js?v=170';
import { render as renderSimilar } from './features/similar-artists.js?v=170';
import { render as renderRabbit } from './features/rabbit-hole.js?v=170';
import { render as renderByGenre } from './features/by-genre.js?v=170';
import { render as renderByArtist } from './features/by-artist.js?v=170';
import { render as renderRecs } from './features/recommendations.js?v=170';
import { render as renderListened } from './features/listened.js?v=170';
import { render as renderWrapped } from './features/wrapped.js?v=170';
import { render as renderRecords } from './features/records.js?v=170';
import { openImportHistory } from './features/import-history.js?v=170';
import { bindOwnerLockedButtons } from './features/history-data.js?v=170';
import { render as renderZeroPlays } from './features/zero-plays.js?v=170';
import { render as renderSkips } from './features/skips.js?v=170';
import { render as renderSearchLikes } from './features/search-likes.js?v=170';
import { render as renderWthree } from './features/wthree.js?v=170';
import { render as renderCovers } from './features/covers.js?v=170';
import { render as renderDiscoverArtists } from './features/discover-artists.js?v=170';
import { render as renderNewReleases } from './features/new-releases.js?v=170';
import { render as renderSinClasificar } from './features/sin-clasificar.js?v=170';

async function testConnection() {
  const token = await getValidToken();
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return res;
}

function showRateLimitScreen() {
  const WAIT = 300;
  document.getElementById('app').innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <h2 style="color:var(--color-error);margin-bottom:12px">Rate limited por Spotify</h2>
        <p style="margin-bottom:16px">Spotify bloquea las requests si se hacen muchas seguidas. Cada reintento antes de tiempo <strong>extiende el bloqueo</strong>.</p>
        <p id="countdown-text" style="color:var(--color-accent);font-size:24px;font-weight:700;margin-bottom:8px"></p>
        <p id="retry-status" style="color:var(--color-text-muted);font-size:13px;margin-bottom:24px">No recargues la página — eso también cuenta como request.</p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button class="btn btn-primary" id="retry-btn" disabled>Reintentar</button>
        </div>
      </div>
    </div>
  `;

  const countdownEl = document.getElementById('countdown-text');
  const retryBtn = document.getElementById('retry-btn');
  const statusEl = document.getElementById('retry-status');
  let remaining = WAIT;

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}s`;
  };

  const tick = () => {
    if (remaining <= 0) {
      countdownEl.textContent = '¡Listo!';
      statusEl.textContent = 'Apretá Reintentar — se va a probar con 1 sola request.';
      retryBtn.disabled = false;
      retryBtn.focus();
      return;
    }
    countdownEl.textContent = formatTime(remaining);
    remaining--;
    setTimeout(tick, 1000);
  };
  tick();

  retryBtn.onclick = async () => {
    retryBtn.disabled = true;
    countdownEl.textContent = '';
    statusEl.textContent = 'Probando conexión...';
    try {
      const res = await testConnection();
      if (res.status === 429) {
        statusEl.textContent = 'Todavía bloqueado. Esperando 5 min más...';
        remaining = WAIT;
        tick();
      } else if (res.status === 401) {
        statusEl.textContent = 'Token vencido, re-logueando...';
        logout(); // solo borra las keys de auth (NO tus ocultos/config/prefs)
        location.reload();
      } else if (res.ok) {
        statusEl.textContent = 'Conectado, cargando...';
        const profile = await res.json();
        showApp(profile);
      } else {
        const text = await res.text().catch(() => '');
        statusEl.textContent = `Error ${res.status}: ${text.slice(0, 100)}`;
        retryBtn.disabled = false;
      }
    } catch (e) {
      statusEl.textContent = `Error: ${e.message}`;
      retryBtn.disabled = false;
    }
  };
}

async function init() {
  if (!isLoggedIn()) {
    showLogin();
    return;
  }

  document.getElementById('app').innerHTML = `
    <div class="login-screen">
      <div class="spinner spinner-lg"></div>
      <p id="init-status" style="margin-top:16px;color:var(--color-text-secondary)">Conectando con Spotify...</p>
    </div>
  `;

  try {
    const res = await testConnection();
    if (res.status === 429) {
      console.warn('Rate limited on init');
      showRateLimitScreen();
      return;
    }
    if (!res.ok) {
      throw new Error(`Spotify ${res.status}: ${await res.text()}`);
    }
    const profile = await res.json();
    showApp(profile);
  } catch (e) {
    console.error('Failed to load profile:', e);
    document.getElementById('app').innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <h2 style="color:var(--color-error);margin-bottom:12px">Error al conectar</h2>
          <p style="margin-bottom:8px">${e.message}</p>
          <div style="display:flex;gap:12px;justify-content:center;margin-top:24px">
            <button class="btn btn-primary" onclick="location.reload()">Reintentar</button>
            <button class="btn btn-secondary" onclick="localStorage.clear();location.reload()">Reset + Login</button>
          </div>
        </div>
      </div>
    `;
  }
}

function showLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <img class="login-icon" src="assets/favicon.svg" alt="Fonoteca">
        <h1>Fonoteca</h1>
        <p>Administrá tu biblioteca de Spotify: sync, deduplicación, likes huérfanas, tracks zombi, y más.</p>
        <button class="btn btn-primary login-btn" id="login-btn">Conectar con Spotify</button>

        <div class="login-features">
          <div class="login-feature">
            <div class="login-feature-title">Sync Mirror</div>
            <div class="login-feature-desc">Playlist espejo de tus likes</div>
          </div>
          <div class="login-feature">
            <div class="login-feature-title">Dedupe</div>
            <div class="login-feature-desc">Limpiá duplicados por playlist</div>
          </div>
          <div class="login-feature">
            <div class="login-feature-title">Huérfanas</div>
            <div class="login-feature-desc">Likes sin playlist asignada</div>
          </div>
          <div class="login-feature">
            <div class="login-feature-title">Zombis</div>
            <div class="login-feature-desc">Tracks borrados del catálogo</div>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('login-btn').onclick = loginWithSpotify;
}

function showApp(profile) {
  const avatar = profile.images?.[0]?.url || '';
  const avatarHtml = avatar
    ? `<img class="sidebar-avatar" src="${avatar}" alt="">`
    : `<div class="sidebar-avatar" style="background:var(--color-accent);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px">${(profile.display_name || '?')[0].toUpperCase()}</div>`;

  document.getElementById('app').innerHTML = `
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <aside class="sidebar" id="sidebar">
      <a class="sidebar-header" data-route="home" href="#home" title="Ir al inicio" style="text-decoration:none;color:inherit;cursor:pointer">
        <img class="sidebar-logo" src="assets/favicon.svg" alt="">
        <span class="sidebar-title">Fonoteca</span>
      </a>
      <button class="sidebar-close" id="sidebar-close" type="button" title="Cerrar el menú" aria-label="Cerrar el menú">✕</button>
      <nav class="sidebar-nav">
        <div class="sidebar-section">
          <div class="sidebar-section-title">General</div>
          <a class="nav-link" data-route="dashboard" href="#dashboard">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span> Dashboard
          </a>
          <a class="nav-link" data-route="wrapped" href="#wrapped">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg></span> Wrapped
          </a>
          <a class="nav-link" data-route="records" href="#records">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg></span> Récords
          </a>
          <a class="nav-link" data-route="covers" href="#covers">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span> Mis tapas
          </a>
          <a class="nav-link" data-route="search" href="#search">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span> Buscar likes
          </a>
          <a class="nav-link" data-route="listened" href="#listened">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></span> Álbumes escuchados
          </a>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-title">Crear</div>
          <a class="nav-link" data-route="smart" href="#smart">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg></span> Smart Playlists
          </a>
          <a class="nav-link" data-route="byartist" href="#byartist">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></span> Por artista
          </a>
          <a class="nav-link" data-route="wthree" href="#wthree">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h16"/><path d="M18 12l3 3-3 3"/></svg></span> W-Three helper
          </a>
          <a class="nav-link" data-route="genre" href="#genre">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/></svg></span> Por género
          </a>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-title">Descubrir</div>
          <a class="nav-link" data-route="similar" href="#similar">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></span> Artistas similares
          </a>
          <a class="nav-link" data-route="rabbit" href="#rabbit">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10c0 3-2 5-4.5 5S13 15 13 13s1.5-3.5 3.5-3.5"/></svg></span> Rabbit hole
          </a>
          <a class="nav-link" data-route="recs" href="#recs">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M15 14a5 5 0 1 0-6 0c.5.5 1 1 1 2v2h4v-2c0-1 .5-1.5 1-2z"/></svg></span> Recomendaciones
          </a>
          <a class="nav-link" data-route="discover-artists" href="#discover-artists">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg></span> Sin escuchar de tus artistas
          </a>
          <a class="nav-link" data-route="new-releases" href="#new-releases">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span> Novedades de tus artistas
          </a>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-title">Limpieza</div>
          <a class="nav-link" data-route="sync" href="#sync">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></span> Sync Mirror
          </a>
          <a class="nav-link" data-route="dedupe" href="#dedupe">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></span> Dedupe
          </a>
          <a class="nav-link" data-route="zombies" href="#zombies">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9h.01M15 9h.01M9 15c1.5-.5 4.5-.5 6 0"/><circle cx="12" cy="12" r="10"/></svg></span> Zombis
          </a>
          <a class="nav-link" data-route="versions" href="#versions">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></span> Versiones
          </a>
          <a class="nav-link" data-route="zeroplays" href="#zeroplays">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg></span> Sin plays
          </a>
          <a class="nav-link" data-route="sin-clasificar" href="#sin-clasificar">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h7"/><circle cx="18" cy="16" r="3"/><path d="M18 10.5v1.5"/></svg></span> Sin clasificar
          </a>
          <a class="nav-link" data-route="skips" href="#skips">
            <span class="nav-link-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg></span> Skips crónicos
          </a>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          ${avatarHtml}
          <span class="sidebar-username">${profile.display_name || profile.id}</span>
        </div>
        <div class="sidebar-actions">
          <button class="sidebar-action" id="my-history-btn" title="Subí tu Extended Streaming History (ZIP) o borrá el que tengas cargado">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span>Mi historial</span>
          </button>
          <button class="sidebar-action" id="theme-btn" title="Cambiar los colores de la app">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 3a9 9 0 1 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1-.24-.27-.39-.62-.39-1 0-.83.67-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/></svg>
            <span>Paleta</span>
          </button>
          <button class="sidebar-action" id="refresh-all-btn" title="Vacía todos los caches locales (likes, playlists, tags, historial)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span>Limpiar cache</span>
          </button>
          <button class="sidebar-action sidebar-action-danger" id="logout-btn" title="Cerrar sesión de Spotify">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </aside>
    <main class="main" id="main-content"></main>
  `;

  document.getElementById('logout-btn').onclick = logout;
  document.getElementById('my-history-btn').onclick = () => openImportHistory();
  document.getElementById('theme-btn').onclick = () => openThemePanel();
  document.getElementById('refresh-all-btn').onclick = async () => {
    const btn = document.getElementById('refresh-all-btn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Limpiando...';
    cacheClearAll(); // localStorage
    try {
      // Vacía IndexedDB (grouped de playlists, análisis, etc.) menos tus likes (caros de re-bajar).
      const n = await idbClearAll(['all_liked_tracks', 'all_liked_tracks_partial']);
      showToast(`Cache limpiado (${n} entrada${n === 1 ? '' : 's'}). Tus likes se conservan.`, 'success');
    } catch (e) {
      showToast('Cache local limpiado (IDB falló: ' + e.message + ')', 'info');
    }
    btn.textContent = orig;
    btn.disabled = false;
  };

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  // Sidebar visible en Home, cerrado en las demás rutas.
  // El toggle manual del hamburguesa lo abre como OVERLAY sobre el contenido (no empuja).
  const isHome = () => {
    const h = window.location.hash.slice(1);
    return !h || h === 'home';
  };
  const applyRouteSidebar = () => {
    if (window.matchMedia('(max-width: 768px)').matches) return; // en mobile lo maneja el overlay
    sidebar.classList.remove('desktop-open'); // cerrar overlay al navegar
    overlay.classList.remove('open');
    if (isHome()) document.body.classList.remove('sidebar-hidden');
    else document.body.classList.add('sidebar-hidden');
  };
  applyRouteSidebar();
  window.addEventListener('hashchange', applyRouteSidebar);

  // Delegación: el hamburguesa vive dentro de cada .page-header (v=108) — el
  // botón se re-renderiza en cada cambio de ruta, así que en vez de bindear
  // por id, escuchamos clicks sobre cualquier elemento con [data-hamburger].
  document.addEventListener('click', (e) => {
    const target = e.target.closest && e.target.closest('[data-hamburger]');
    if (!target) return;
    if (window.matchMedia('(max-width: 768px)').matches) {
      // Mobile: overlay tradicional
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
      return;
    }
    // Desktop, y acá hay DOS comportamientos distintos (v=154):
    //
    // - En HOME el sidebar es parte del layout: el hamburguesa lo DESACOPLA y
    //   lo vuelve a ACOPLAR. Nunca lo abre como overlay.
    //
    //   Hasta v=153 la rama de abajo era una sola y en Home dejaba un estado
    //   sin salida (reproducido en producción el 2026-08-23): con el hash ya en
    //   `#home`, cerrar el menú ponía `sidebar-hidden`, y lo único que la saca
    //   es `applyRouteSidebar`, que corre en `hashchange`. Como el hash ya era
    //   `#home`, ni el hamburguesa ni el logo «Fonoteca» disparaban uno: el
    //   menú volvía, pero como OVERLAY con backdrop encima del contenido, y el
    //   hamburguesa quedaba tapado abajo (x=72, debajo de los 240px del
    //   sidebar). Para recuperar el menú acoplado había que irse a otra ruta y
    //   volver, o recargar.
    //
    // - En el resto de las rutas el sidebar vive fuera de pantalla y se abre
    //   como OVERLAY sobre el main, sin correrlo.
    if (isHome()) {
      sidebar.classList.remove('desktop-open');
      overlay.classList.remove('open');
      document.body.classList.toggle('sidebar-hidden');
      return;
    }
    if (document.body.classList.contains('sidebar-hidden')) {
      const opening = !sidebar.classList.contains('desktop-open');
      sidebar.classList.toggle('desktop-open');
      overlay.classList.toggle('open', opening);
    } else {
      document.body.classList.add('sidebar-hidden');
    }
  });
  // Un único cierre para los tres caminos: la ✕, Escape, y el toque fuera en
  // mobile. En desktop además hay que poner `sidebar-hidden`, porque en Home el
  // sidebar está acoplado (sin esa clase) y quitarle `desktop-open` no lo mueve.
  //
  // Recordatorio del gotcha de v=101: la regla `body.sidebar-hidden .sidebar`
  // le gana por especificidad a `.sidebar.open`, por eso vive envuelta en
  // `@media (min-width: 769px)` en main.css. Si se sacara de ahí, esta función
  // dejaría el sidebar cerrado también en mobile aunque se abra el overlay.
  const esMobile = () => window.matchMedia('(max-width: 768px)').matches;
  const sidebarAbierto = () =>
    sidebar.classList.contains('open') ||
    sidebar.classList.contains('desktop-open') ||
    (!esMobile() && !document.body.classList.contains('sidebar-hidden'));

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    sidebar.classList.remove('desktop-open');
    overlay.classList.remove('open');
    if (!esMobile()) document.body.classList.add('sidebar-hidden');
  };

  document.getElementById('sidebar-close').onclick = closeSidebar;
  overlay.onclick = closeSidebar;

  // Escape. No le pisa el Escape a los modales: si hay alguno abierto, el que
  // manda es modal-stack.js y acá no hacemos nada.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (getStack().length) return;
    if (!sidebarAbierto()) return;
    closeSidebar();
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  });

  tryAutoLoadUserBackup(profile.id).then(result => {
    if (result.loaded) {
      const parts = [];
      if (result.likesCount > 0) parts.push(`${result.likesCount.toLocaleString()} likes`);
      if (result.delta > 0) parts.push(`+${result.delta} nuevos`);
      if (result.tagsCount > 0) parts.push(`${result.tagsCount} artistas con tags`);
      if (parts.length > 0) {
        showToast(`Backup del repo cargado: ${parts.join(' · ')}`, 'success');
      }
    }
  }).catch(e => console.warn('Auto-load error:', e));

  registerRoute('home', renderHome);
  registerRoute('dashboard', renderDashboard);
  registerRoute('debug', renderDebug);
  registerRoute('smart', renderSmart);
  registerRoute('similar', renderSimilar);
  registerRoute('rabbit', renderRabbit);
  registerRoute('recs', renderRecs);
  registerRoute('genre', renderByGenre);
  registerRoute('byartist', renderByArtist);
  registerRoute('listened', renderListened);
  registerRoute('sync', renderSync);
  registerRoute('dedupe', renderDedupe);
  registerRoute('dupalbums', renderDupalbums);
  registerRoute('zombies', renderZombies);
  registerRoute('versions', renderVersions);
  registerRoute('wrapped', renderWrapped);
  registerRoute('records', renderRecords);
  registerRoute('zeroplays', renderZeroPlays);
  registerRoute('skips', renderSkips);
  registerRoute('search', renderSearchLikes);
  registerRoute('wthree', renderWthree);
  registerRoute('covers', renderCovers);
  registerRoute('discover-artists', renderDiscoverArtists);
  registerRoute('new-releases', renderNewReleases);
  registerRoute('sin-clasificar', renderSinClasificar);

  // «Volver arriba»: se instala una sola vez para toda la app y descubre solo
  // qué elemento scrollea en cada vista. Va después de initRouter para que la
  // primera siembra encuentre algo pintado. Ver ui/back-to-top.js.
  initRouter();
  installBackToTop();
}

// Set unificado de iconos Lucide inline. Cada uno con currentColor así toma el color del texto.
const ICONS = {
  dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  records: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
  wrapped: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
  smart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>',
  byartist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
  similar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  rabbit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C6.5 22 2 17.5 2 12S6.5 2 12 2s10 4.5 10 10c0 3-2 5-4.5 5S13 15 13 13s1.5-3.5 3.5-3.5"/></svg>',
  recs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4M15 14a5 5 0 1 0-6 0c.5.5 1 1 1 2v2h4v-2c0-1 .5-1.5 1-2z"/></svg>',
  genre: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/></svg>',
  listened: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
  dedupe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  zombies: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9h.01M15 9h.01M9 15c1.5-.5 4.5-.5 6 0"/><circle cx="12" cy="12" r="10"/></svg>',
  versions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>',
  zeroplays: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg>',
  skips: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  sinclasificar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13"/><path d="M3 12h9"/><path d="M3 18h7"/><circle cx="18" cy="16" r="3"/><path d="M18 10.5v1.5"/></svg>',
};

const HOME_SECTIONS = [
  {
    title: 'General',
    items: [
      { hash: 'dashboard', icon: ICONS.dashboard, name: 'Dashboard', desc: 'Stats de tu biblioteca de Liked Songs.' },
      { hash: 'wrapped', icon: ICONS.wrapped, name: 'Wrapped', desc: 'Tu resumen del año — año calendario completo, hecho con el streaming history.' },
      { hash: 'records', icon: ICONS.records, name: 'Récords', desc: 'Días épicos, maratones, temas en loop, rachas e hitos de tu historial.' },
      { hash: 'search', icon: ICONS.search, name: 'Buscar likes', desc: 'Buscador instantáneo en tus Liked Songs (local, sin ir a Spotify).' },
      { hash: 'listened', icon: ICONS.listened, name: 'Álbumes escuchados', desc: 'Los álbumes de tu playlist de registro, agrupados.' },
    ],
  },
  {
    title: 'Crear',
    items: [
      { hash: 'smart', icon: ICONS.smart, name: 'Smart Playlists', desc: 'Playlists por año, década o random.' },
      { hash: 'byartist', icon: ICONS.byartist, name: 'Por artista', desc: 'Todos tus likes de uno o varios artistas.' },
      { hash: 'genre', icon: ICONS.genre, name: 'Por género', desc: 'Agrupá tus likes por género y armá playlists.' },
    ],
  },
  {
    title: 'Descubrir',
    items: [
      { hash: 'similar', icon: ICONS.similar, name: 'Artistas similares', desc: 'Artistas parecidos a los que te gustan, vía Last.fm.' },
      { hash: 'rabbit', icon: ICONS.rabbit, name: 'Rabbit hole', desc: 'Navegá artistas y tracks encadenados por género.' },
      { hash: 'recs', icon: ICONS.recs, name: 'Recomendaciones', desc: 'Basadas en tus scrobbles de Last.fm.' },
      { hash: 'discover-artists', icon: ICONS.search, name: 'Sin escuchar de tus artistas', desc: 'Discografía de tus artistas favoritos que aún no escuchaste.' },
      { hash: 'new-releases', icon: ICONS.records, name: 'Novedades de tus artistas', desc: 'Lanzamientos recientes de tus artistas favoritos, filtrando lo que ya oíste.' },
    ],
  },
  {
    title: 'Limpieza',
    items: [
      { hash: 'sync', icon: ICONS.sync, name: 'Sync Mirror', desc: 'Una playlist como copia exacta de tus Liked Songs.' },
      { hash: 'dedupe', icon: ICONS.dedupe, name: 'Dedupe', desc: 'Eliminá tracks duplicados dentro de cada playlist.' },
      { hash: 'zombies', icon: ICONS.zombies, name: 'Zombis', desc: 'Tracks eliminados del catálogo de Spotify.' },
      { hash: 'versions', icon: ICONS.versions, name: 'Versiones', desc: 'Mismo tema en distintos álbumes (remaster, live, etc.).' },
      { hash: 'zeroplays', icon: ICONS.zeroplays, name: 'Sin plays', desc: 'Likes que nunca reprodujiste según tu historial de Spotify.' },
      { hash: 'sin-clasificar', icon: ICONS.sinclasificar, name: 'Sin clasificar', desc: 'Likes que no están en ninguna de tus playlists temáticas.' },
      { hash: 'skips', icon: ICONS.skips, name: 'Skips crónicos', desc: 'Likes que reproducís seguido pero casi siempre le das next.' },
    ],
  },
];

function renderHome(container) {
  const sections = HOME_SECTIONS.map(sec => `
    <div style="margin-bottom:28px">
      <div class="sidebar-section-title" style="margin-bottom:12px">${sec.title}</div>
      <div class="home-grid">
        ${sec.items.map(it => `
          <a href="#${it.hash}" class="card home-card" data-route="${it.hash}">
            <div class="home-card-icon">${it.icon}</div>
            <h3 style="margin-bottom:6px">${it.name}</h3>
            <p style="color:var(--color-text-secondary);font-size:14px">${it.desc}</p>
          </a>
        `).join('')}
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    ${pageHeader({ title: 'Bienvenido' })}
    ${sections}
  `;
}

async function renderDebug(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>API Debug</h1>
      <p>Prueba cada endpoint por separado.</p>
    </div>
    <button class="btn btn-primary" id="debug-run-btn">Correr tests</button>
    <pre id="debug-log" style="margin-top:20px;background:var(--color-surface);padding:20px;border-radius:var(--radius-md);font-size:13px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:70vh;overflow-y:auto"></pre>
  `;

  document.getElementById('debug-run-btn').onclick = async () => {
    const log = document.getElementById('debug-log');
    const btn = document.getElementById('debug-run-btn');
    btn.disabled = true;
    log.textContent = '';

    const write = (msg) => { log.textContent += msg + '\n'; };

    const tests = [
      { name: 'GET /me', url: '/me' },
      { name: 'GET /me/tracks?limit=1', url: '/me/tracks?limit=1' },
      { name: 'GET /me/playlists?limit=5', url: '/me/playlists?limit=5' },
    ];

    for (const test of tests) {
      write(`--- ${test.name} ---`);
      try {
        const data = await spotifyFetch(test.url);
        write(`OK (${JSON.stringify(data).slice(0, 200)}...)`);
      } catch (e) {
        write(`ERROR: ${e.message}`);
      }
      write('');
    }

    // probar nuevo endpoint /playlists/{id}/items
    write('--- GET /playlists/{id}/items?limit=1 ---');
    try {
      const playlists = await spotifyFetch('/me/playlists?limit=1');
      if (playlists.items?.length > 0) {
        const pl = playlists.items[0];
        write(`Usando playlist: "${pl.name}" (${pl.id})`);
        const items = await spotifyFetch(`/playlists/${pl.id}/items?limit=1`);
        write(`OK (${JSON.stringify(items).slice(0, 200)}...)`);
      } else {
        write('No hay playlists para testear');
      }
    } catch (e) {
      write(`ERROR: ${e.message}`);
    }

    // probar DELETE /me/library (dry run con ID inexistente)
    write('');
    write('--- DELETE /me/library?uris=spotify:track:nonexistent ---');
    try {
      await spotifyFetch(`/me/library?uris=${encodeURIComponent('spotify:track:0000000000000000000000')}`, { method: 'DELETE' });
      write('OK (200)');
    } catch (e) {
      write(`ERROR: ${e.message}`);
    }

    write('\n=== Tests completos ===');
    btn.disabled = false;
  };
}

// El bloqueo de scroll con modales lo maneja src/js/ui/modal-stack.js
// (mete/quita body.modal-open + guarda scrollY). Ya no hace falta el
// MutationObserver que había acá antes.

// Último recurso contra la pantalla en blanco: cualquier error o promesa sin
// catch que se escape pinta un cartel con botón de recargar. Se instala ANTES
// de init() para cubrir también el arranque. Ver ui/crash-guard.js.
installCrashGuard();

// La paleta guardada se pinta ANTES de que se arme nada: si se aplicara después
// del primer render, el tema elegido entraría como un flash de la paleta vieja.
applyStoredTheme();

// PWA: registra el service worker (path relativo → scope /spotify-web/ en Pages).
// Con esto Chrome ofrece "Instalar Fonoteca" y los estáticos quedan offline.
//
// En DEV no se registra, y si quedó registrado de antes se desregistra y se
// tira su caché. El SW sirve stale-while-revalidate para los estáticos
// same-origin, y en dev los imports NO llevan `?v=` (los versiona build.sh al
// copiar a docs/), así que un módulo editado se seguía sirviendo viejo desde la
// caché del SW por más que el servidor de dev mande `Cache-Control: no-store`.
// Es el mismo pozo que documenta scripts/dev-server.mjs, un piso más abajo:
// pasó otra vez el 2026-08-15, probando esta versión.
const ES_DEV = ['127.0.0.1', 'localhost'].includes(location.hostname);
if ('serviceWorker' in navigator) {
  if (ES_DEV) {
    navigator.serviceWorker.getRegistrations()
      .then(rs => Promise.all(rs.map(r => r.unregister())))
      .then(() => caches?.keys?.().then(ks => Promise.all(ks.map(k => caches.delete(k)))))
      .catch(() => { /* si no se puede, no rompe nada */ });
  } else {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW no registrado:', e.message));
  }
}

// Delego los botones "Subir mi ZIP" / "Abrir Privacidad de Spotify" del
// ownerLockedMessage (que se inserta en varias features).
bindOwnerLockedButtons(openImportHistory);
window.__openImportHistory = openImportHistory; // para el link "Mi historial" del sidebar

init();
