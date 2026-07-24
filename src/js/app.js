import { isLoggedIn, loginWithSpotify, logout } from './auth.js';
import { getUserProfile, spotifyFetch, tryAutoLoadUserBackup } from './api.js';
import { getValidToken } from './auth.js';
import { cacheClearAll } from './storage.js';
import { idbClearAll } from './idb.js';
import { registerRoute, initRouter, navigate } from './router.js';
import { showToast } from './ui/toast.js';

import { render as renderSync } from './features/sync.js';
import { render as renderDedupe } from './features/dedupe.js';
import { render as renderDupalbums } from './features/duplicate-albums.js';
import { render as renderZombies } from './features/zombies.js';
import { render as renderVersions } from './features/versions.js';
import { render as renderDashboard } from './features/dashboard.js';
import { render as renderSmart } from './features/smart.js';
import { render as renderSimilar } from './features/similar-artists.js';
import { render as renderRabbit } from './features/rabbit-hole.js';
import { render as renderByGenre } from './features/by-genre.js';
import { render as renderByArtist } from './features/by-artist.js';
import { render as renderRecs } from './features/recommendations.js';
import { render as renderListened } from './features/listened.js';

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
        localStorage.clear();
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
        <img class="login-icon" src="assets/favicon.svg" alt="spotify-tools">
        <h1>spotify-tools</h1>
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
    <button class="hamburger" id="hamburger-btn">&#9776;</button>
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    <aside class="sidebar" id="sidebar">
      <a class="sidebar-header" href="#home" title="Ir al inicio" style="text-decoration:none;color:inherit;cursor:pointer">
        <img class="sidebar-logo" src="assets/favicon.svg" alt="">
        <span class="sidebar-title">spotify-tools</span>
      </a>
      <nav class="sidebar-nav">
        <div class="sidebar-section">
          <div class="sidebar-section-title">General</div>
          <a class="nav-link" data-route="dashboard" href="#dashboard">
            <span class="nav-link-icon">&#9733;</span> Dashboard
          </a>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-title">Crear</div>
          <a class="nav-link" data-route="smart" href="#smart">
            <span class="nav-link-icon">&#10022;</span> Smart Playlists
          </a>
          <a class="nav-link" data-route="byartist" href="#byartist">
            <span class="nav-link-icon">&#9835;</span> Por artista
          </a>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-title">Descubrir</div>
          <a class="nav-link" data-route="similar" href="#similar">
            <span class="nav-link-icon">&#9737;</span> Artistas similares
          </a>
          <a class="nav-link" data-route="rabbit" href="#rabbit">
            <span class="nav-link-icon">&#8734;</span> Rabbit hole
          </a>
          <a class="nav-link" data-route="recs" href="#recs">
            <span class="nav-link-icon">&#9835;</span> Recomendaciones
          </a>
          <a class="nav-link" data-route="genre" href="#genre">
            <span class="nav-link-icon">&#9833;</span> Por género
          </a>
          <a class="nav-link" data-route="listened" href="#listened">
            <span class="nav-link-icon">&#9635;</span> Álbumes escuchados
          </a>
        </div>
        <div class="sidebar-section">
          <div class="sidebar-section-title">Limpieza</div>
          <a class="nav-link" data-route="sync" href="#sync">
            <span class="nav-link-icon">&#8644;</span> Sync Mirror
          </a>
          <a class="nav-link" data-route="dedupe" href="#dedupe">
            <span class="nav-link-icon">&#9851;</span> Dedupe
          </a>
          <a class="nav-link" data-route="dupalbums" href="#dupalbums">
            <span class="nav-link-icon">&#9834;</span> Álbumes repetidos
          </a>
          <a class="nav-link" data-route="zombies" href="#zombies">
            <span class="nav-link-icon">&#9760;</span> Zombis
          </a>
          <a class="nav-link" data-route="versions" href="#versions">
            <span class="nav-link-icon">&#9842;</span> Versiones
          </a>
        </div>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          ${avatarHtml}
          <span class="sidebar-username">${profile.display_name || profile.id}</span>
          <button class="sidebar-logout" id="logout-btn" title="Cerrar sesión">&#10005;</button>
        </div>
        <button class="btn btn-secondary btn-sm" id="refresh-all-btn" style="width:100%;margin-top:10px;justify-content:center;font-size:12px">Limpiar cache</button>
      </div>
    </aside>
    <main class="main" id="main-content"></main>
  `;

  document.getElementById('logout-btn').onclick = logout;
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

  const hamburger = document.getElementById('hamburger-btn');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  hamburger.onclick = () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  };
  overlay.onclick = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  };

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

  initRouter();
}

const HOME_SECTIONS = [
  {
    title: 'General',
    items: [
      { hash: 'dashboard', icon: '&#9733;', name: 'Dashboard', desc: 'Stats de tu biblioteca de Liked Songs.' },
    ],
  },
  {
    title: 'Crear',
    items: [
      { hash: 'smart', icon: '&#10022;', name: 'Smart Playlists', desc: 'Playlists por año, década o random.' },
      { hash: 'byartist', icon: '&#9835;', name: 'Por artista', desc: 'Todos tus likes de uno o varios artistas.' },
    ],
  },
  {
    title: 'Descubrir',
    items: [
      { hash: 'similar', icon: '&#9737;', name: 'Artistas similares', desc: 'Artistas parecidos a los que te gustan, vía Last.fm.' },
      { hash: 'rabbit', icon: '&#8734;', name: 'Rabbit hole', desc: 'Navegá artistas y tracks encadenados por género.' },
      { hash: 'recs', icon: '&#9835;', name: 'Recomendaciones', desc: 'Basadas en tus scrobbles de Last.fm.' },
      { hash: 'genre', icon: '&#9833;', name: 'Por género', desc: 'Agrupá tus likes por género y armá playlists.' },
      { hash: 'listened', icon: '&#9635;', name: 'Álbumes escuchados', desc: 'Los álbumes de tu playlist de registro, agrupados.' },
    ],
  },
  {
    title: 'Limpieza',
    items: [
      { hash: 'sync', icon: '&#8644;', name: 'Sync Mirror', desc: 'Una playlist como copia exacta de tus Liked Songs.' },
      { hash: 'dedupe', icon: '&#9851;', name: 'Dedupe', desc: 'Eliminá tracks duplicados dentro de cada playlist.' },
      { hash: 'dupalbums', icon: '&#9834;', name: 'Álbumes repetidos', desc: 'Álbumes con varios tracks distintos en una playlist.' },
      { hash: 'zombies', icon: '&#9760;', name: 'Zombis', desc: 'Tracks eliminados del catálogo de Spotify.' },
      { hash: 'versions', icon: '&#9842;', name: 'Versiones', desc: 'Mismo tema en distintos álbumes (remaster, live, etc.).' },
    ],
  },
];

function renderHome(container) {
  const sections = HOME_SECTIONS.map(sec => `
    <div style="margin-bottom:28px">
      <div class="sidebar-section-title" style="margin-bottom:12px">${sec.title}</div>
      <div class="home-grid">
        ${sec.items.map(it => `
          <a href="#${it.hash}" class="card home-card">
            <h3 style="margin-bottom:6px">${it.icon} ${it.name}</h3>
            <p style="color:var(--color-text-secondary);font-size:14px">${it.desc}</p>
          </a>
        `).join('')}
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="page-header">
      <h1>Bienvenido</h1>
      <p>Elegí una herramienta para empezar.</p>
    </div>
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

// Mientras haya cualquier cartel (.modal-overlay) abierto, bloqueamos el scroll del fondo:
// así al scrollear se mueve solo el contenido del cartel, no la página de atrás.
const modalScrollLock = new MutationObserver(() => {
  document.body.classList.toggle('modal-open', document.querySelector('.modal-overlay') !== null);
});
modalScrollLock.observe(document.body, { childList: true });

init();
