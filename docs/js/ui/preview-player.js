// Reproductor global de previews de 30s (iTunes). Un solo <audio> para toda la
// app + pill flotante abajo a la derecha con qué está sonando y botón de stop.
// Dispara 'previewchange' en document con { detail: { key } } (key null = parado)
// para que cada feature actualice sus botones sin acoplarse al player.

import { escapeHtml } from './components.js?v=88';
import { showToast } from './toast.js?v=88';

const audio = new Audio();
audio.preload = 'none';
audio.volume = 0.9;

let currentKey = null;   // key del preview sonando (o cargando)
let pill = null;

// --- estado de hover (para hover-play con debounce) ---
let hoverKey = null;         // key que el mouse está pidiendo ahora
let hoverTimer = null;
let hoverStartedKey = null;  // preview que arrancó por hover (se corta al salir)

function emit() {
  document.dispatchEvent(new CustomEvent('previewchange', { detail: { key: currentKey } }));
}

function ensurePill() {
  if (pill) return pill;
  pill = document.createElement('div');
  pill.className = 'preview-pill';
  pill.innerHTML = `
    <div class="preview-eq"><span></span><span></span><span></span></div>
    <div class="preview-pill-label"></div>
    <button class="preview-pill-close" title="Parar preview">✕</button>
  `;
  pill.querySelector('.preview-pill-close').onclick = () => stopPreview();
  document.body.appendChild(pill);
  return pill;
}

function showPill(label, loading) {
  const p = ensurePill();
  p.querySelector('.preview-pill-label').innerHTML = escapeHtml(label);
  p.classList.toggle('loading', !!loading);
  p.classList.add('show');
}

function hidePill() {
  if (pill) pill.classList.remove('show');
}

audio.addEventListener('ended', () => {
  currentKey = null;
  hoverStartedKey = null;
  hidePill();
  emit();
});

function playPreview(key, { url, label }) {
  currentKey = key;
  audio.src = url;
  showPill(label, false);
  emit();
  audio.play().catch(err => {
    // Política de autoplay del browser: audio con sonido necesita al menos un
    // click previo en la página. Pasa solo si entraste directo por URL sin tocar nada.
    if (err && err.name === 'NotAllowedError') {
      showToast('El browser bloqueó el audio: hacé un click en cualquier lado y probá de nuevo', 'info');
    }
    stopPreview();
  });
}

function stopPreview() {
  audio.pause();
  audio.removeAttribute('src');
  currentKey = null;
  hoverStartedKey = null;
  hidePill();
  emit();
}

function playingKey() {
  return currentKey;
}

// Toggle por click. getter es async y devuelve { url, label } o null.
// Devuelve: true = arrancó, false = lo paró (ya estaba sonando), null = no hay preview.
async function togglePreview(key, getter) {
  if (currentKey === key) { stopPreview(); return false; }
  currentKey = key;
  showPill('Buscando preview…', true);
  emit();
  const p = await getter();
  if (currentKey !== key) return false; // mientras buscaba, el user tocó otra cosa
  if (!p) { stopPreview(); return null; }
  playPreview(key, p);
  return true;
}

// Hover-play con debounce: llamar hoverIn al entrar (o al moverse entre
// elementos) y hoverOut al salir. El preview que arrancó por hover se corta solo.
function hoverIn(key, getter, delay = 400) {
  if (key === hoverKey) return;
  hoverKey = key;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(async () => {
    const p = await getter();
    if (hoverKey !== key || !p) return;
    hoverStartedKey = key;
    playPreview(key, p);
  }, delay);
}

function hoverOut() {
  hoverKey = null;
  clearTimeout(hoverTimer);
  if (hoverStartedKey && currentKey === hoverStartedKey) stopPreview();
  hoverStartedKey = null;
}

// Azúcar para elementos DOM: hover-play sobre el elemento completo.
function attachHover(el, key, getter, delay = 400) {
  el.addEventListener('mouseenter', () => hoverIn(key, getter, delay));
  el.addEventListener('mouseleave', () => hoverOut());
}

export { togglePreview, stopPreview, playingKey, hoverIn, hoverOut, attachHover };
