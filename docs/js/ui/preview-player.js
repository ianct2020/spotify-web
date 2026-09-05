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

import { escapeHtml } from './components.js?v=205';
import { showToast } from './toast.js?v=205';
import { mountBottom } from './bottom-layer.js?v=205';

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
// ¿El preview actual sigue sonando aunque el mouse se vaya? Lo pone un click
// explícito en el botón ▶ (togglePreview), nunca el hover. Es lo que separa
// las dos acciones en una tarjeta donde conviven las dos (botón apoyado sobre
// la zona de hover-play, v=202): apoyar el mouse reproduce mientras esté
// encima; apretar el botón FIJA lo que esté sonando —lo haya arrancado el
// hover o el propio click— y a partir de ahí `hoverOut` ya no lo corta.
let lockedKey = null;

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

/**
 * Deja el pill diciendo que no se pudo reproducir, en vez de dejarlo abierto y
 * mudo. No lo cierra solo: si desaparece, parece que nunca pasó nada — que es
 * exactamente el problema que esto viene a arreglar.
 */
function mostrarFalloEnPill(motivo) {
  const p = pill;
  if (!p) return;
  p.classList.remove('loading', 'is-playing');
  p.classList.add('preview-pill-error');
  const provEl = p.querySelector('.preview-pill-provider');
  if (provEl) {
    provEl.textContent = `no se pudo reproducir — ${motivo}`;
    provEl.title = 'La URL del preview no respondió. Prueba con otro tema o recarga: los enlaces de preview caducan.';
  }
  const eq = p.querySelector('.preview-eq');
  if (eq) eq.style.display = 'none';
  p.classList.add('show');
}

function showPillAudio(label, provider, loading) {
  const p = ensurePill();
  p.classList.remove('preview-pill-embedded');
  p.classList.remove('preview-pill-error');   // el fallo anterior no mancha al siguiente
  p.querySelector('.preview-eq').style.display = '';
  p.querySelector('.preview-pill-main').style.display = '';
  p.querySelector('.preview-pill-embed').hidden = true;
  p.querySelector('.preview-pill-embed').innerHTML = '';
  p.querySelector('.preview-pill-label').innerHTML = escapeHtml(label || '');
  const provEl = p.querySelector('.preview-pill-provider');
  provEl.textContent = loading ? 'buscando…' : (PROVIDER_LABEL[provider] || '');
  p.classList.toggle('loading', !!loading);
  // Quietas hasta que el <audio> avise que está sonando de verdad.
  p.classList.remove('is-playing');
  p.classList.add('show');
}

// El track de Spotify sin preview propio no puede autoarrancar (política de
// autoplay del navegador) ni avisarnos si suena: por eso el botón de la
// tarjeta se queda tintado en ▶ (ver `paintPlayingCard`) y acá el aviso deja
// claro que ARRANCAR es cosa del propio widget de Spotify, con una salida
// directa por si el play de adentro no responde (pasa con las cookies de
// terceros bloqueadas: el iframe no ve la sesión logueada de Spotify).
function showPillEmbed(url, label) {
  const p = ensurePill();
  p.classList.add('preview-pill-embedded');
  p.classList.remove('loading');
  p.querySelector('.preview-eq').style.display = 'none';
  p.querySelector('.preview-pill-main').style.display = 'none';
  const box = p.querySelector('.preview-pill-embed');
  box.hidden = false;
  const trackUrl = url.replace('/embed/track/', '/track/');
  box.innerHTML = `
    <div class="preview-pill-embed-note">Sin preview propio: te ofrecemos el reproductor de Spotify. Si el play de aquí abajo no arranca, ábrelo directamente:</div>
    <iframe src="${url}" allow="autoplay; encrypted-media; clipboard-write; fullscreen" title="${escapeHtml(label || '')}" style="border:0;width:100%;height:80px;border-radius:8px" loading="lazy"></iframe>
    <a class="preview-pill-embed-link" href="${trackUrl}" target="_blank" rel="noopener">Abrir en Spotify ↗</a>
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
  clearStallTimer();
  currentKey = null;
  currentProvider = null;
  audioPlaying = false;
  hoverStartedKey = null;
  lockedKey = null;
  hidePill();
  emit();
});

// Arranque y parada de las barritas, enganchados al audio real.
// `playing` es el que avisa de que efectivamente está SONANDO (`play` solo
// dice que se pidió reproducir); `waiting` es que se quedó sin buffer.
audio.addEventListener('playing', () => { clearStallTimer(); setAudioPlaying(true); });
audio.addEventListener('play', () => setAudioPlaying(!audio.paused));
audio.addEventListener('pause', () => setAudioPlaying(false));
audio.addEventListener('waiting', () => setAudioPlaying(false));
audio.addEventListener('emptied', () => setAudioPlaying(false));

// ── Una URL muerta tiene que decirlo (v=173) ─────────────────────────────────
//
// Hasta acá el <audio> no tenía listener de `error`: si la URL del preview
// moría —el m4a de iTunes caduca, Deezer rota el CDN, el proveedor se cae— el
// resultado era **silencio**. Apretás play, el pill se abre, y no pasa nada,
// sin ningún aviso y sin nada en consola. Hoy cargan 59 de 59, así que esto no
// se ve nunca; el día que un proveedor caiga se ve en todas.
//
// El `error` del elemento NO burbujea y no lo agarra `window.onerror`, así que
// tiene que ir acá. `audio.play()` tampoco lo cubre: la promesa resuelve bien y
// el fallo llega después, al intentar bajar el medio.
const MOTIVO_MEDIA = {
  1: 'cancelado',
  2: 'se cortó la red',
  3: 'el archivo está corrupto',
  4: 'el formato no se puede reproducir o la URL ya no existe',
};

// Cuánto esperar en 'stalled' antes de dar el intento por muerto (v=203). Ver
// el porqué en el comentario de `fail()` — un servidor que contesta pero no
// con audio puede dejar al <audio> en `stalled` PARA SIEMPRE, sin disparar
// nunca un `error`. 8 s de margen: los 59/59 de v=173 cargaban en menos.
const STALL_TIMEOUT_MS = 8000;
let stallTimer = null;
function clearStallTimer() {
  if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
}

// ── El aviso no le llegaba al botón que se apretó, y a veces no llegaba nunca
//    (v=203) ───────────────────────────────────────────────────────────────
//
// Caso real: «munni & drugs» (bleood) resuelve a Deezer, pero esa URL
// concreta devuelve **403 con un cuerpo HTML** — no es que falte el
// proveedor, es que la que encontramos no sirve. Medido en vivo contra esa
// URL: el `<audio>` nunca dispara `error` — se queda en `stalled` para
// siempre, sin avanzar y sin rendirse, así que el listener de `error` de acá
// abajo (que sí existe desde v=173) directamente no corre.
//
// Y aunque corriera, tenía un segundo problema: como el audio nunca llegó a
// `playing`, `audioPlaying` ya era `false`, así que el viejo
// `setAudioPlaying(false)` no cambiaba nada y su propio guarda (`if (val ===
// audioPlaying) return`) se comía el `emit()` — CERO `previewchange`. El pill
// de abajo SÍ avisaba, pero el botón ▶ que se apretó quedaba pintado en ⏸
// para siempre, como si siguiera sonando: la única señal que el usuario mira
// de cerca decía justo lo contrario de lo que pasó.
//
// `fail()` junta las dos arreglos: corta la reproducción DE VERDAD (mismo
// criterio que `stopPreview`, sin volver a mostrar el pill de "parado") y
// emite siempre, para que todos los botones de todas las vistas vuelvan a ▶.
// La llaman dos caminos — el `error` real (cuando SÍ llega) y un timeout de
// `STALL_TIMEOUT_MS` colgado de `stalled` (para cuando no llega nunca) — y el
// aviso se repite por toast, la misma vía que ya usan las vistas para "sin
// preview en iTunes ni en Deezer", con la etiqueta y el proveedor que sí
// encontramos: no dejar la explicación enterrada en un pill chico abajo a la
// derecha.
function fail(motivo) {
  const proveedor = currentProvider ? (PROVIDER_LABEL[currentProvider] || currentProvider) : null;
  const label = pill?.querySelector('.preview-pill-label')?.textContent || '';
  console.warn(`[preview] no se pudo reproducir (${currentProvider || 'sin proveedor'}): ${motivo}`);
  mostrarFalloEnPill(motivo);
  clearStallTimer();
  audio.pause();
  audio.removeAttribute('src');
  currentKey = null;
  currentProvider = null;
  audioPlaying = false;
  hoverStartedKey = null;
  lockedKey = null;
  emit();
  if (label) {
    showToast(`No se pudo reproducir «${label}»${proveedor ? ` (${proveedor})` : ''} — ${motivo}`, 'info');
  }
}

audio.addEventListener('stalled', () => {
  setAudioPlaying(false);
  const key = currentKey;
  clearStallTimer();
  stallTimer = setTimeout(() => {
    // Puede que para cuando dispare ya haya arrancado (rearmado por otro
    // 'stalled' intermedio) o que el usuario ya haya pedido otra cosa.
    if (currentKey === key && !audioPlaying) fail('no respondió a tiempo — puede que el enlace ya no esté disponible');
  }, STALL_TIMEOUT_MS);
});

audio.addEventListener('error', () => {
  // `emptied` dispara un `error` espurio cuando limpiamos el src a propósito
  // (stopPreview y el propio `fail()` hacen removeAttribute('src')). Sin este
  // filtro, cerrar el pill mostraría un cartel de fallo cada vez.
  if (!audio.getAttribute('src')) return;
  const motivo = MOTIVO_MEDIA[audio.error?.code] || 'motivo desconocido';
  fail(motivo);
});

function playAudio(key, { url, label, provider }) {
  clearStallTimer();
  currentKey = key;
  currentProvider = provider || null;
  audio.src = url;
  showPillAudio(label, provider, false);
  emit();
  audio.play().catch(err => {
    // Política de autoplay del browser: audio con sonido necesita al menos un
    // click previo en la página. Pasa solo si entraste directo por URL sin tocar nada.
    if (err && err.name === 'NotAllowedError') {
      showToast('El navegador bloqueó el audio: haz un click en cualquier lado y prueba de nuevo', 'info');
    }
    stopPreview();
  });
}

function playEmbed(key, { url, label, provider }) {
  // Con embed, el <audio> nuestro no juega — Spotify reproduce dentro del iframe.
  // Cortamos cualquier audio previo antes de mostrar el embed.
  clearStallTimer();
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
  clearStallTimer();
  audio.pause();
  audio.removeAttribute('src');
  currentKey = null;
  currentProvider = null;
  audioPlaying = false;
  hoverStartedKey = null;
  lockedKey = null;
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
// Devuelve: true = arrancó (o quedó fijado), false = lo paró (ya estaba), null
// = no hay preview.
//
// Si lo que está sonando es ESTE mismo `key` pero todavía no está fijado
// —llegó por hover, no por un click anterior—, el click no lo para: lo fija.
// Es la mitad que hace posible que hover-play y el botón ▶ convivan sobre la
// misma tarjeta sin pisarse (v=202): sin esto, clickear el botón mientras el
// hover ya venía sonando ejecutaba la rama de abajo (mismo key → parar), que
// es exactamente lo que el botón NO debería hacer.
async function togglePreview(key, getter) {
  if (currentKey === key) {
    if (lockedKey === key) { stopPreview(); return false; }
    lockedKey = key;
    hoverStartedKey = null;
    return true;
  }
  currentKey = key;
  currentProvider = null;
  showPillAudio('Buscando preview…', null, true);
  emit();
  const p = await getter();
  if (currentKey !== key) return false; // mientras buscaba, el user tocó otra cosa
  if (!p) { stopPreview(); return null; }
  lockedKey = key;
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
    if (hoverKey !== key) return;
    // Ya está sonando ESTE key —fijado por un click, o por un hover que
    // arrancó un instante antes por otra vía—: no lo reinicies. Reintentar acá
    // reemplazaría `audio.src` y cortaría el audio fijado justo cuando el
    // mouse vuelve a pasar por la tapa (v=202).
    if (currentKey === key) return;
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
