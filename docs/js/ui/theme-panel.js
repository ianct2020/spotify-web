// Paleta de colores de la app (v=157).
//
// Escribe las variables de `css/theme.css` en `:root` (inline, que le gana a la
// hoja) y las guarda en localStorage. Todo lo que la app pinta sale de esas
// variables, así que con esto se re-tematiza entera sin tocar CSS.
//
// LAS OCHO que se eligen son las que Ian pidió: acento, fondo, superficie,
// elevado, borde, texto, texto secundario y texto atenuado. El resto se DERIVA,
// y esa es la parte que importa:
//
//   · `--color-accent-hover/soft/tint/glow` salen del acento. Si se dejaran
//     fijas, un tema ámbar seguiría teniendo el halo violeta de las tarjetas
//     seleccionadas (`--color-accent-tint` se usa en 15 sitios).
//   · `--color-surface-hover` se mezcla hacia el TEXTO, no hacia el blanco:
//     en un tema claro «más claro» no se ve y el hover desaparecía.
//
// ⚠️ Fondo claro: los `box-shadow` y los backdrops de la app son negros con
// alpha y sobre claro quedan bien (más marcados, no rotos). Lo que sí asume
// oscuro son los ticks de los charts (#8888A0 hardcodeado en dashboard.js y en
// las fichas) y el tooltip del mosaico, que trae su propio fondo oscuro con
// texto blanco: los dos siguen legibles en claro, pero no acompañan al tema.
// Anotado en la doc.

import { openModal, closeTop } from './modal-stack.js?v=171';
import { showToast } from './toast.js?v=171';
import { prefKey, migratePrefKey } from '../storage.js?v=171';
import { MODOS, getAnimMode, setAnimMode } from './reveal.js?v=171';

// La clave lleva prefijo por usuario desde v=159 (antes era global y dos
// personas en el mismo navegador compartían paleta). El prefijo sale de
// `fonoteca_last_user_id`, que es SINCRÓNICO: ver el comentario largo de
// `prefKey()` en `storage.js` — con el id async de `getCurrentUserId()` esto
// pintaría un flash de tema en cada arranque.
const LS_BASE = 'fonoteca_theme_v1';
const LS_KEY = () => prefKey(LS_BASE);

// Las ocho editables, en el orden en que se muestran.
export const VARS = [
  { k: '--color-accent', label: 'Acento' },
  { k: '--color-bg', label: 'Fondo' },
  { k: '--color-surface', label: 'Superficie' },
  { k: '--color-elevated', label: 'Elevado' },
  { k: '--color-border', label: 'Borde' },
  { k: '--color-text', label: 'Texto' },
  { k: '--color-text-secondary', label: 'Texto secundario' },
  { k: '--color-text-muted', label: 'Texto atenuado' },
];

// El tema de fábrica (= lo que dice theme.css). Sirve de base del selector
// libre y de destino del botón «Volver al original».
const ORIGINAL = {
  '--color-accent': '#7C3AED',
  '--color-bg': '#0A0A0F',
  '--color-surface': '#16161F',
  '--color-elevated': '#1E1E2A',
  '--color-border': '#2A2A3A',
  '--color-text': '#F0F0F5',
  '--color-text-secondary': '#8888A0',
  '--color-text-muted': '#55556A',
};

export const PRESETS = [
  { id: 'violeta', name: 'Violeta', desc: 'El original', colors: ORIGINAL },
  {
    id: 'ambar', name: 'Ámbar', desc: 'Cálido, contraste fuerte',
    colors: {
      '--color-accent': '#FF6B2C',
      '--color-bg': '#0C0A08',
      '--color-surface': '#1A1714',
      '--color-elevated': '#242018',
      '--color-border': '#332E25',
      '--color-text': '#F5F0E8',
      '--color-text-secondary': '#A09880',
      '--color-text-muted': '#6B6353',
    },
  },
  {
    id: 'aguamarina', name: 'Aguamarina', desc: 'Fresco, turquesa',
    colors: {
      '--color-accent': '#06D6A0',
      '--color-bg': '#080F0D',
      '--color-surface': '#0F1A17',
      '--color-elevated': '#152420',
      '--color-border': '#1E3530',
      '--color-text': '#E8F5F0',
      '--color-text-secondary': '#80A098',
      '--color-text-muted': '#4E6A63',
    },
  },
  {
    id: 'papel', name: 'Papel', desc: 'Claro, para el día',
    colors: {
      '--color-accent': '#6D28D9',
      '--color-bg': '#F6F5F8',
      '--color-surface': '#FFFFFF',
      '--color-elevated': '#EDEBF2',
      '--color-border': '#D6D3DE',
      '--color-text': '#1A1725',
      '--color-text-secondary': '#5A5570',
      '--color-text-muted': '#8B85A0',
    },
  },
];

// ── color helpers ───────────────────────────────────────────────────────────
function hex2rgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}
function rgb2hex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function mix(a, b, t) {
  const ra = hex2rgb(a), rb = hex2rgb(b);
  if (!ra || !rb) return a;
  return rgb2hex([0, 1, 2].map(i => ra[i] + (rb[i] - ra[i]) * t));
}
function alpha(hex, a) {
  const r = hex2rgb(hex);
  return r ? `rgba(${r[0]}, ${r[1]}, ${r[2]}, ${a})` : hex;
}

/** Las 8 elegidas + todas las derivadas. */
export function expandTheme(colors) {
  const c = { ...ORIGINAL, ...colors };
  const acc = c['--color-accent'];
  return {
    ...c,
    // El hover del acento: hacia el negro en cualquier tema (es lo que hace el
    // #6D28D9 original respecto del #7C3AED).
    '--color-accent-hover': mix(acc, '#000000', 0.15),
    '--color-accent-soft': alpha(acc, 0.1),
    '--color-accent-tint': alpha(acc, 0.14),
    '--color-accent-glow': alpha(acc, 0.25),
    // Hacia el texto, no hacia el blanco: sirve igual en claro y en oscuro.
    '--color-surface-hover': mix(c['--color-surface'], c['--color-text'], 0.06),
  };
}

function readStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY()));
    if (raw && typeof raw === 'object' && raw.colors) return raw;
  } catch { /* corrupto = sin tema */ }
  return null;
}

function write(colors, presetId) {
  try { localStorage.setItem(LS_KEY(), JSON.stringify({ colors, preset: presetId || null })); }
  catch { /* lleno */ }
}

/** Pinta un tema en `:root`. Sin argumento, saca todo y vuelve a theme.css. */
export function applyTheme(colors) {
  const root = document.documentElement;
  if (!colors) {
    for (const k of Object.keys(expandTheme(ORIGINAL))) root.style.removeProperty(k);
    return;
  }
  const full = expandTheme(colors);
  for (const [k, v] of Object.entries(full)) root.style.setProperty(k, v);
}

/**
 * Se llama al arrancar la app, ANTES de pintar nada. Es sincrónico a propósito:
 * si esto se hiciera después del primer render, el tema guardado entraría como
 * un flash de la paleta vieja.
 */
export function applyStoredTheme() {
  // La migración va PRIMERO y es sincrónica: la paleta que Ian guardó en v=157
  // vive en la clave sin prefijo, y leer la prefijada sin mudarla antes se la
  // come. Lo mismo para el modo de animaciones, por si alguna vez se guardó sin
  // id (primerísima carga del navegador, antes del primer `GET /me`).
  migratePrefKey(LS_BASE);
  migratePrefKey('fonoteca_anim_v1');

  const st = readStored();
  if (st) applyTheme(st.colors);
}

// ── el panel ────────────────────────────────────────────────────────────────

// El toggle de animaciones vive ACÁ y no en un icono propio del menú: esto ya
// es «cómo se ve la app», y el menú no necesita otra entrada.
// v=162: dos estados, encendidas de fábrica. El modo «Sigue al sistema» se
// quitó — las animaciones de entrada ya no miran `prefers-reduced-motion`. El
// resto de las animaciones de la aplicación sí lo sigue respetando.
const ANIM_OPCIONES = [
  { id: 'siempre', label: 'Encendidas', title: 'Las secciones entran al llegar a ellas scrolleando' },
  { id: 'nunca', label: 'Apagadas', title: 'Sin animaciones de entrada: el contenido aparece ya colocado' },
];

/** El cartel de debajo del toggle. */
function animNotaHtml(modo) {
  return modo === 'nunca'
    ? 'Sin animaciones de entrada. El contenido aparece ya colocado.'
    : 'Las secciones del Dashboard y del Wrapped entran al llegar a ellas scrolleando. No depende del ajuste de movimiento reducido del sistema.';
}

function swatchesHtml(colors) {
  return VARS.map(v => `<span class="theme-swatch" style="background:${colors[v.k]}"></span>`).join('');
}

export function openThemePanel() {
  const st = readStored();
  let actual = { ...ORIGINAL, ...(st?.colors || {}) };
  let presetId = st?.preset || (st ? null : 'violeta');

  // Desde v=162 el toggle de animaciones no escucha `prefers-reduced-motion`,
  // así que el panel ya no deja ningún listener que desuscribir al cerrarse.
  const overlay = openModal({
    id: 'theme-panel',
    html: `
    <div class="modal card-modal" style="max-width:560px;width:min(560px,94vw)">
      <div class="card-modal-head-simple">
        <div class="card-modal-eyebrow">Paleta de colores</div>
        <button class="btn btn-secondary btn-sm card-modal-close" data-close-modal>✕</button>
      </div>
      <p class="theme-help">Los cambios se ven al instante y quedan guardados en este navegador.</p>
      <div class="theme-presets" id="theme-presets">
        ${PRESETS.map(p => `
          <button type="button" class="theme-preset" data-preset="${p.id}">
            <span class="theme-preset-swatches">${swatchesHtml(expandTheme(p.colors))}</span>
            <span class="theme-preset-name">${p.name}</span>
            <span class="theme-preset-desc">${p.desc}</span>
          </button>
        `).join('')}
      </div>
      <div class="theme-title">A mano</div>
      <div class="theme-grid" id="theme-grid">
        ${VARS.map(v => `
          <label class="theme-field">
            <input type="color" data-var="${v.k}" value="${actual[v.k]}">
            <span class="theme-field-label">${v.label}</span>
          </label>
        `).join('')}
      </div>
      <div class="theme-title">Animaciones</div>
      <div class="theme-anim-row" id="theme-anim-row">
        ${ANIM_OPCIONES.map(o => `
          <button type="button" class="theme-anim-opt" data-anim="${o.id}" title="${o.title}">${o.label}</button>
        `).join('')}
      </div>
      <p class="theme-anim-nota" id="theme-anim-nota"></p>

      <div class="card-modal-actions" style="margin-top:16px">
        <button class="btn btn-secondary btn-sm" id="theme-reset">Volver al original</button>
        <button class="btn btn-primary btn-sm" id="theme-done">Listo</button>
      </div>
    </div>`,
  });

  const marcarPreset = () => {
    overlay.querySelectorAll('.theme-preset').forEach(el => {
      el.classList.toggle('is-on', el.dataset.preset === presetId);
    });
  };
  const sincronizarInputs = () => {
    overlay.querySelectorAll('input[data-var]').forEach(inp => { inp.value = actual[inp.dataset.var]; });
  };
  marcarPreset();

  overlay.querySelectorAll('.theme-preset').forEach(el => {
    el.onclick = () => {
      const p = PRESETS.find(x => x.id === el.dataset.preset);
      if (!p) return;
      actual = { ...p.colors };
      presetId = p.id;
      applyTheme(actual);
      write(actual, presetId);
      sincronizarInputs();
      marcarPreset();
    };
  });

  overlay.querySelectorAll('input[data-var]').forEach(inp => {
    inp.oninput = () => {
      actual = { ...actual, [inp.dataset.var]: inp.value.toUpperCase() };
      presetId = null;   // ya es una mezcla propia
      applyTheme(actual);
      write(actual, null);
      marcarPreset();
    };
  });

  // ── animaciones ──
  const notaEl = overlay.querySelector('#theme-anim-nota');
  const pintarAnim = () => {
    const modo = getAnimMode();
    overlay.querySelectorAll('.theme-anim-opt').forEach(el => {
      el.classList.toggle('is-on', el.dataset.anim === modo);
      el.setAttribute('aria-pressed', String(el.dataset.anim === modo));
    });
    if (notaEl) notaEl.innerHTML = animNotaHtml(modo);
  };
  pintarAnim();

  overlay.querySelectorAll('.theme-anim-opt').forEach(el => {
    el.onclick = () => {
      if (!MODOS.includes(el.dataset.anim)) return;
      setAnimMode(el.dataset.anim);
      pintarAnim();
      // Lo elegido se nota la próxima vez que se entra a una vista con
      // animaciones: acá no hay nada armado que re-animar.
      showToast('Se aplica al volver a entrar al Dashboard o al Wrapped', 'info');
    };
  });

  overlay.querySelector('#theme-reset').onclick = () => {
    try { localStorage.removeItem(LS_KEY()); } catch { /* noop */ }
    actual = { ...ORIGINAL };
    presetId = 'violeta';
    applyTheme(null);
    sincronizarInputs();
    marcarPreset();
    showToast('Paleta original restablecida', 'success');
  };

  overlay.querySelector('#theme-done').onclick = () => closeTop();
}
