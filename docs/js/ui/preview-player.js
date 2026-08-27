// Reproductor global de previews de 30s (cadena de proveedores: iTunes → Deezer
// → Spotify embed). Un solo <audio> para toda la app + pill flotante abajo a
// la derecha con qué está sonando, de qué proveedor viene, y botón de stop.
// Cuando el proveedor devuelve type:'embed' (Spotify), el pill se rearma con
// un iframe (Spotify hace la reproducción en su UI).
//
// Dispara 'previewchange' en document con { detail: { key, provider, playing } }
// (key null = parado) para que cada feature actualice sus botones.
//
// `playing` es el estado REAL del <audio>, no un flag nuestro: lo ponen y lo
// sacan los eventos del elemento (`playing` / `pause` / `ended` / `waiting`…),
// igual que las barritas del pill desde v=141. Por eso el evento se dispara
// también cuando no cambia el `key`: lo que cambió es si suena o no.
//
// Con el embed de Spotify NO hay señal de reproducción: el iframe no nos avisa
// de nada. Ahí `playing` es siempre false y el botón de la tarjeta se queda
// como está (marcado como el preview actual, pero con el ▶), que es lo honesto:
// no sabemos si Spotify está sonando dentro del iframe.

import { escapeHtml } from './components.js?v=161';
import { showToast } from './toast.js?v=161';
import { mountBottom } from './bottom-layer.js?v=161';

const audio = new Audio();
audio.preload = 'none';
audio.volume = 0.9;

let currentKey = null;         // key del preview sonando (o cargando)
let currentProvider = null;    // 'itunes' | 'deezer' | 'spotify-embed' | null
// ¿El <audio> está sonando AHORA MISMO? Lo escriben solo los listeners del
// elemento, nunca el código que pide reproducir: entre `play()` y el primer
// frame de sonido hay buffering, y un botón que dice ⏸ mientras todavía no
// suena nada miente igual que el que se queda en ▶.
let audioPlaying = false;
let pill = null;

// --- estado de hover (para hover-play con debounce) ---
let hoverKey = null;
let hoverTimer = null;
let hoverStartedKey = null;

const PROVIDER_LABEL = {
  'itunes': 'vía iTunes',
  'deezer': 'vía Deezer',
  'spotify-embed': 'vía Spotify',
};

function emit() {
  document.dispatchEvent(new CustomEvent('previewchange', {
    detail: { key: currentKey, provider: currentProvider, playing: audioPlaying },
  }));
}

function ensurePill() {
  if (pill) return pill;
  pill = document.createElement('div');
  pill.className = 'preview-pill';
  pill.innerHTML = `
    <div class="preview-eq"><span></span><span></span><span></span></div>
    <div class="preview-pill-main">
      <div class="preview-pill-label"></div>
      <div class="preview-pill-provider"></div>
    </div>
    <div class="preview-pill-embed" hidden></div>
    <button class="preview-pill-close" title="Parar preview">✕</button>
  `;
  pill.querySelector('.preview-pill-close').onclick = () => stopPreview();
  // El pill ya no se posiciona solo: es un item más de la capa de abajo, que
  // es la que garantiza que no se pise con el progreso ni con los toasts.
  mountBottom('player', pill);
  return pill;
}

// Única puerta de entrada al estado "está sonando". Mueve las tres barritas del
// pill (v=141) y, desde v=149, avisa a las vistas: es lo que hace que el ▶ de
// la tarjeta pase a ⏸ y vuelva, sin que nadie lleve un flag propio ni un timer.
// Si el audio se pausa, se traba buffereando o se acaba, las dos cosas paran en
// el mismo momento. Con el embed de Spotify no hay ninguna señal desde el
// iframe, así que ahí no se llama nunca: barritas quietas y botón en ▶.
function setAudioPlaying(on) {
  const val = !!on;
  if (pill) pill.classList.toggle('is-playing', val);
  if (val === audioPlaying) return;
  audioPlaying = val;
  emit();
}

function showPillAudio(label, provider, loading) {
  const p = ensurePill();
  p.classList.remove('preview-pill-embedded');
  p.querySelector('.preview-eq').style.display = '';
  p.querySelector('.preview-pill-main').style.display = '';
  p.querySelector('.preview-pill-embed').hidden = true;
  p.querySelector('.preview-pill-embed').innerHTML = '';
  p.querySelector('.preview-pill-label').innerHTML = escapeHtml(label || '');
  const provEl = p.querySelector('.preview-pill-provider');
  provEl.textContent = loading ? 'buscando…' : '';
  p.classList.toggle('loading', !!loading);
  // Quietas hasta que el <audio> avise que está sonando de verdad.
  p.classList.remove('is-playing');
  p.classList.add('show');
}

function showPillEmbed(url, label) {
  const p = ensurePill();
  p.classList.add('preview-pill-embedded');
  p.classList.remove('loading');
  p.querySelector('.preview-eq').style.display = 'none';
  p.querySelector('.preview-pill-main').style.display = 'none';
  const box = p.querySelector('.preview-pill-embed');
  box.hidden = false;
  box.innerHTML = `
    <iframe src="${url}" allow="encrypted-media" title="${escapeHtml(label || '')}" style="border:0;width:100%;height:80px;border-radius:8px" loading="lazy"></iframe>
    <div class="preview-pill-provider preview-pill-provider-embed">${escapeHtml(label || '')}</div>
  `;
  p.classList.add('show');
}

function hidePill() {
  if (pill) {
    pill.classList.remove('show');
    pill.classList.remove('is-playing');
    // Limpia el iframe para que no siga cargando/reproduciendo en background
    const box = pill.querySelector('.preview-pill-embed');
    if (box) { box.innerHTML = ''; box.hidden = true; }
  }
}

audio.addEventListener('ended', () => {
  currentKey = null;
  currentProvider = null;
  audioPlaying = false;
  hoverStartedKey = null;
  hidePill();
  emit();
});

// Arranque y parada de las barritas, enganchados al audio real.
// `playing` es el que avisa de que efectivamente está SONANDO (`play` solo
// dice que se pidió reproducir); `waiting` es que se quedó sin buffer.
audio.addEventListener('playing', () => setAudioPlaying(true));
audio.addEventListener('play', () => setAudioPlaying(!audio.paused));
audio.addEventListener('pause', () => setAudioPlaying(false));
audio.addEventListener('waiting', () => setAudioPlaying(false));
audio.addEventListener('stalled', () => setAudioPlaying(false));
audio.addEventListener('emptied', () => setAudioPlaying(false));

function playAudio(key, { url, label, provider }) {
  currentKey = key;
  currentProvider = provider || null;
  audio.src = url;
  showPillAudio(label, provider, false);
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

function playEmbed(key, { url, label, provider }) {
  // Con embed, el <audio> nuestro no juega — Spotify reproduce dentro del iframe.
  // Cortamos cualquier audio previo antes de mostrar el embed.
  audio.pause();
  audio.removeAttribute('src');
  currentKey = key;
  currentProvider = provider || 'spotify-embed';
  // El iframe no nos avisa de nada, así que para nosotros no hay reproducción.
  audioPlaying = false;
  showPillEmbed(url, label);
  emit();
}

function playPreview(key, result) {
  if (!result || !result.url) return;
  if (result.type === 'embed') playEmbed(key, result);
  else playAudio(key, result);
}

function stopPreview() {
  audio.pause();
  audio.removeAttribute('src');
  currentKey = null;
  currentProvider = null;
  audioPlaying = false;
  hoverStartedKey = null;
  hidePill();
  emit();
}

function playingKey() {
  return currentKey;
}

function playingProvider() {
  return currentProvider;
}

// ¿Está SONANDO de verdad el <audio>? False mientras busca preview, mientras
// bufferea y siempre que el proveedor sea el embed de Spotify.
function isPlayingAudio() {
  return audioPlaying;
}

// Toggle por click. `getter` es async y devuelve { url, label, provider, type }
// o null (compatible con la firma vieja { url, label } — asume type='audio').
// Devuelve: true = arrancó, false = lo paró (ya estaba), null = no hay preview.
async function togglePreview(key, getter) {
  if (currentKey === key) { stopPreview(); return false; }
  currentKey = key;
  currentProvider = null;
  showPillAudio('Buscando preview…', null, true);
  emit();
  const p = await getter();
  if (currentKey !== key) return false; // mientras buscaba, el user tocó otra cosa
  if (!p) { stopPreview(); return null; }
  playPreview(key, p);
  return true;
}

// Hover-play con debounce: llamar hoverIn al entrar (o al moverse entre
// elementos) y hoverOut al salir. El preview que arrancó por hover se corta solo.
// Nota: si el getter devuelve type:'embed', igual lo abrimos — pero no se auto-
// corta al hover-out porque el usuario puede estar interactuando con el iframe.
function hoverIn(key, getter, delay = 400) {
  if (key === hoverKey) return;
  hoverKey = key;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(async () => {
    const p = await getter();
    if (hoverKey !== key || !p) return;
    if (p.type === 'embed') return; // hover no dispara embeds — muy invasivo
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

function attachHover(el, key, getter, delay = 400) {
  el.addEventListener('mouseenter', () => hoverIn(key, getter, delay));
  el.addEventListener('mouseleave', () => hoverOut());
}

// ── Teardown: el preview NO puede sobrevivir a salir de donde se lanzó ──
//
// Esto va acá y no en cada feature justamente porque el bug era que cada
// feature tenía que acordarse. Se engancha a dos señales transversales:
//
//   - 'routeteardown', que dispara el router en CADA cambio de ruta (router.js),
//     antes de correr el cleanup de la vista que se va;
//   - 'modalstackempty', que dispara ui/modal-stack.js cuando se cierra el
//     último modal de la pila (o sea: se cerró la ficha).
//
// Se escucha por evento y no importando las funciones al revés para no armar
// un ciclo de imports: components.js ya importa modal-stack.js y este módulo
// importa components.js.
//
// La señal de modal es "la pila quedó VACÍA", no "se cerró un modal
// cualquiera": si estás oyendo un preview lanzado desde una lista y encima se
// abre y se cierra el selector de playlists, el audio no tiene por qué cortarse.
document.addEventListener('routeteardown', () => stopPreview());
document.addEventListener('modalstackempty', () => stopPreview());

export { togglePreview, stopPreview, playingKey, playingProvider, isPlayingAudio, hoverIn, hoverOut, attachHover };
