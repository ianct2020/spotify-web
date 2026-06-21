import { isLoggedIn, loginWithSpotify, logout } from './auth.js';
import { getUserProfile } from './api.js';
import { cacheClearAll } from './storage.js';
import { registerRoute, initRouter, navigate } from './router.js';
import { showToast } from './ui/toast.js';

import { render as renderSync } from './features/sync.js';
import { render as renderDedupe } from './features/dedupe.js';
import { render as renderOrphans } from './features/orphans.js';
import { render as renderZombies } from './features/zombies.js';
import { render as renderVersions } from './features/versions.js';

async function init() {
  if (!isLoggedIn()) {
    showLogin();
    return;
  }

  try {
    const profile = await getUserProfile();
    showApp(profile);
  } catch (e) {
    console.error('Failed to load profile:', e);
    showLogin();
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
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
      <a href="#sync" class="card" style="text-decoration:none;color:inherit">
        <h3 style="margin-bottom:6px">&#8644; Sync Mirror</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Mantenés una playlist como copia exacta de tus Liked Songs.</p>
      </a>
      <a href="#dedupe" class="card" style="text-decoration:none;color:inherit">
        <h3 style="margin-bottom:6px">&#9851; Dedupe</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Encontrá y eliminá tracks duplicados dentro de cada playlist.</p>
      </a>
      <a href="#orphans" class="card" style="text-decoration:none;color:inherit">
        <h3 style="margin-bottom:6px">&#9829; Huérfanas</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Likes que no están en ninguna playlist.</p>
      </a>
      <a href="#zombies" class="card" style="text-decoration:none;color:inherit">
        <h3 style="margin-bottom:6px">&#9760; Zombis</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Tracks eliminados del catálogo de Spotify.</p>
      </a>
      <a href="#versions" class="card" style="text-decoration:none;color:inherit">
        <h3 style="margin-bottom:6px">&#9842; Versiones</h3>
        <p style="color:var(--color-text-secondary);font-size:14px">Mismo tema en distintos álbumes (remaster, live, etc.).</p>
      </a>
    </div>
  `;
}

init();
