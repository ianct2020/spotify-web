import { isLoggedIn, loginWithSpotify, logout } from './auth.js';
import { getUserProfile, spotifyFetch } from './api.js';
import { cacheClearAll } from './storage.js';
import { registerRoute, initRouter, navigate } from './router.js';
import { showToast } from './ui/toast.js';

import { render as renderSync } from './features/sync.js';
import { render as renderDedupe } from './features/dedupe.js';
import { render as renderOrphans } from './features/orphans.js';
import { render as renderZombies } from './features/zombies.js';
import { render as renderVersions } from './features/versions.js';
import { render as renderDashboard } from './features/dashboard.js';

function startCountdown(seconds) {
  const el = document.getElementById('countdown-text');
  const btn = document.getElementById('retry-btn');
  if (!el) return;
  let remaining = seconds;
  const tick = () => {
    if (remaining <= 0) {
      el.textContent = '¡Listo! Probá ahora';
      if (btn) { btn.disabled = false; btn.focus(); }
      return;
    }
    el.textContent = `Esperá ${remaining}s...`;
    remaining--;
    setTimeout(tick, 1000);
  };
  tick();
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
    const profile = await spotifyFetch('/me', { _maxRetries: 1 });
    showApp(profile);
  } catch (e) {
    console.error('Failed to load profile:', e);
    const isRateLimit = e.message.includes('Rate limit') || e.message.includes('429');
    document.getElementById('app').innerHTML = `
      <div class="login-screen">
        <div class="login-card">
          <h2 style="color:var(--color-error);margin-bottom:12px">${isRateLimit ? 'Rate limited por Spotify' : 'Error al conectar'}</h2>
          <p style="margin-bottom:8px">${isRateLimit ? 'Spotify bloqueó temporalmente las requests. Esto pasa cuando se hacen muchas llamadas seguidas.' : e.message}</p>
          ${isRateLimit ? '<p id="countdown-text" style="color:var(--color-accent);font-size:20px;font-weight:700;margin-bottom:8px"></p>' : ''}
          <p style="color:var(--color-text-muted);font-size:13px;margin-bottom:24px">${isRateLimit ? 'Esperá a que termine el timer y apretá Reintentar.' : ''}</p>
          <div style="display:flex;gap:12px;justify-content:center">
            <button class="btn btn-primary" id="retry-btn" onclick="location.reload()" ${isRateLimit ? 'disabled' : ''}>Reintentar</button>
            <button class="btn btn-secondary" onclick="localStorage.clear();location.reload()">Reset + Login</button>
          </div>
        </div>
      </div>
    `;
    if (isRateLimit) {
      startCountdown(60);
    }
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
      <div class="sidebar-header">
        <img class="sidebar-logo" src="assets/favicon.svg" alt="">
        <span class="sidebar-title">spotify-tools</span>
      </div>
      <nav class="sidebar-nav">
        <div class="sidebar-section">
          <div class="sidebar-section-title">General</div>
          <a class="nav-link" data-route="dashboard" href="#dashboard">
            <span class="nav-link-icon">&#9733;</span> Dashboard
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
          <a class="nav-link" data-route="orphans" href="#orphans">
            <span class="nav-link-icon">&#9829;</span> Huérfanas
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
  document.getElementById('refresh-all-btn').onclick = () => {
    cacheClearAll();
    showToast('Cache limpiado', 'info');
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

  registerRoute('home', renderHome);
  registerRoute('dashboard', renderDashboard);
  registerRoute('debug', renderDebug);
  registerRoute('sync', renderSync);
  registerRoute('dedupe', renderDedupe);
  registerRoute('orphans', renderOrphans);
  registerRoute('zombies', renderZombies);
  registerRoute('versions', renderVersions);

  initRouter();
}

function renderHome(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Bienvenido</h1>
      <p>Elegí una herramienta del menú para empezar.</p>
    </div>
    <div class="home-grid">
      <a href="#sync" class="card home-card">
        <h3 style="margin-bottom:6px">&#8644; Sync Mirror</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Mantenés una playlist como copia exacta de tus Liked Songs.</p>
      </a>
      <a href="#dedupe" class="card home-card">
        <h3 style="margin-bottom:6px">&#9851; Dedupe</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Encontrá y eliminá tracks duplicados dentro de cada playlist.</p>
      </a>
      <a href="#orphans" class="card home-card">
        <h3 style="margin-bottom:6px">&#9829; Huérfanas</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Likes que no están en ninguna playlist.</p>
      </a>
      <a href="#zombies" class="card home-card">
        <h3 style="margin-bottom:6px">&#9760; Zombis</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Tracks eliminados del catálogo de Spotify.</p>
      </a>
      <a href="#versions" class="card home-card">
        <h3 style="margin-bottom:6px">&#9842; Versiones</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Mismo tema en distintos álbumes (remaster, live, etc.).</p>
      </a>
    </div>
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

    // si playlists anduvo, probar leer items de la primera
    write('--- GET /playlists/{id}/tracks?limit=1 ---');
    try {
      const playlists = await spotifyFetch('/me/playlists?limit=1');
      if (playlists.items?.length > 0) {
        const pl = playlists.items[0];
        write(`Usando playlist: "${pl.name}" (${pl.id})`);
        try {
          const items = await spotifyFetch(`/playlists/${pl.id}/tracks?limit=1`);
          write(`OK (${JSON.stringify(items).slice(0, 200)}...)`);
        } catch (e) {
          write(`ERROR: ${e.message}`);

          // probar endpoint alternativo
          write('');
          write('--- Probando /playlists/{id}?fields=tracks.items(track(name,id))&limit=1 ---');
          try {
            const alt = await spotifyFetch(`/playlists/${pl.id}?fields=tracks.items(track(name,id))`);
            write(`OK (${JSON.stringify(alt).slice(0, 200)}...)`);
          } catch (e2) {
            write(`ERROR: ${e2.message}`);
          }
        }
      } else {
        write('No hay playlists para testear');
      }
    } catch (e) {
      write(`ERROR al cargar playlists: ${e.message}`);
    }

    write('\n=== Tests completos ===');
    btn.disabled = false;
  };
}

init();
