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

//
// ── Pausa y barra de los 30 s (v=357, tanda 115) ─────────────────────────────
//
// Hasta v=356 el único control del pill era el ✕, que para Y cierra. Ahora hay
// un botón de pausa (`.preview-pill-toggle`, «Pausar preview» / «Seguir
// preview») que deja el pill a la vista y sigue desde donde estaba, y una barra
// (`role="progressbar"`; desde v=374, `role="slider"`: ver «Adelantar») con lo que va a la izquierda y lo que falta a la
// derecha («0:12 ━━━━──── −0:18»). Ninguna firma ni el evento cambiaron: una
// pausa es `previewchange` con el mismo `key` y `playing: false`, que es el
// camino que las tarjetas ya pintaban (el del buffering y el embed).
//
// Tres cosas que no se ven y hacen falta:
//   - `pausadoPorUsuario` separa una pausa pedida de un `pause`/`waiting` del
//     navegador. Con él, el ▶ de una tarjeta con su preview en pausa SIGUE en
//     vez de parar (`togglePreview`), un `stalled` en pausa no arma el corte de
//     8 s, y el `play()` que se rechaza porque pausaste mientras cargaba
//     (AbortError) no cierra el pill.
//   - La barra se mueve con `timeupdate` (unas 4 veces por segundo). La
//     transición que la suaviza la pone `.preview-pill-anim`, que decide
//     `animationsEnabled()` y no el media query (Ian tiene las animaciones del
//     sistema apagadas y el toggle de la paleta puede forzar por encima). Sin
//     animación la barra salta de a pasos y el texto dice igual lo que falta.
//   - Buscando y con el embed no hay botón ni barra: no hay nada que pausar ni
//     ningún tiempo que leer (el iframe no avisa nada).

import { escapeHtml } from './components.js?v=375';
import { showToast } from './toast.js?v=375';
import { mountBottom } from './bottom-layer.js?v=375';
import { animationsEnabled } from './reveal.js?v=375';
import { iconoPlay, iconoPausa } from './icons.js?v=375';
// (v=367, tanda 130) El nombre del pill se mueve con la MISMA marquesina de las listas densas, sin esperar al mouse:
// el pill tiene ahora un ancho fijo y un nombre largo ya no lo agranda. Ver `moverEtiqueta()`.
import { hoverMarqueeSpan, prepararMarquesinaFila, pararMarquesinaFila } from './hover-marquee.js?v=375';

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
// La pausa la pidió el usuario con el botón del pill (o la retomó con el ▶ de
// la tarjeta). Distinto de un `pause`/`waiting` del navegador.
let pausadoPorUsuario = false;

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
      <div class="preview-pill-progress" role="slider" tabindex="0" aria-label="Avance del preview" aria-valuemin="0" aria-valuemax="30" aria-valuenow="0" aria-disabled="true" hidden>
        <span class="preview-pill-time-va">0:00</span>
        <span class="preview-pill-progress-bar"><span class="preview-pill-progress-fill"></span></span>
        <span class="preview-pill-time-falta"></span>
      </div>
    </div>
    <div class="preview-pill-embed" hidden></div>
    <button type="button" class="preview-pill-toggle" aria-label="Pausar preview" title="Pausar" hidden></button>
    <button class="preview-pill-close" title="Parar preview">✕</button>
  `;
  // (v=373) El ✕ además suelta la cola de «siguiente» (ver al final del archivo).
  pill.querySelector('.preview-pill-close').onclick = () => { soltarCola(); stopPreview(); };
  pill.querySelector('.preview-pill-toggle').onclick = () => alternarPausa();
  conectarAdelantar(pill.querySelector('.preview-pill-progress'), pill.querySelector('.preview-pill-progress-bar'));
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
  pintarBotonPausa();
  if (val === audioPlaying) return;
  audioPlaying = val;
  emit();
}

// ── Los controles nuevos (v=357) ──
// «Pausar» mientras no lo pausaste vos (aunque esté buffereando: pausar sirve
// igual); «Seguir» solo con la pausa pedida.
function pintarBotonPausa() {
  const b = pill?.querySelector('.preview-pill-toggle');
  if (!b) return;
  pill.classList.toggle('is-paused', pausadoPorUsuario);
  b.innerHTML = pausadoPorUsuario ? iconoPlay(14) : iconoPausa(14);
  b.setAttribute('aria-label', pausadoPorUsuario ? 'Seguir preview' : 'Pausar preview');
  b.title = pausadoPorUsuario ? 'Seguir' : 'Pausar';
}

// Botón y barra: a la vista solo con audio nuestro (no buscando, no embed, no error).
function mostrarControles(on) {
  if (!pill) return;
  if (!on) arrastre = null;   // (v=374) sin barra a la vista no hay nada que arrastrar
  pill.querySelector('.preview-pill-toggle').hidden = !on;
  pill.querySelector('.preview-pill-progress').hidden = !on;
}

const mmss = (s) => {
  const t = Math.max(0, Math.round(s || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// ── ⏩ Adelantar dentro del preview (v=374, tanda 137) ────────────────────────
//
// «Adelantar» es poner `audio.currentTime` donde dice el usuario. Ni más, ni menos: no hay `play()`, ni `pause()`,
// ni `pausadoPorUsuario`, ni `emit()`. Por eso en pausa sigue en pausa, lo que suena sigue sonando y adelantar no
// emite ningún `previewchange` nuevo.
//
// La barra (`.preview-pill-progress`) es un `role="slider"` con `tabindex="0"`: el teclado va sobre ella. El puntero va
// sobre la PISTA (`.preview-pill-progress-bar`), y la fracción se mide contra la pista y no contra el renglón, que lleva
// a los costados «0:12» y «−0:18». Un clic es un `pointerdown` + `pointerup` en el mismo punto: el mismo camino que
// arrastrar, sin un listener de `click` aparte.
//
// Mientras se arrastra, `actualizarBarra()` pinta el punto del usuario (`arrastre.t`) y no `audio.currentTime`: un
// `timeupdate` a mitad del arrastre vuelve a pintar ese punto y no lo pisa. Al soltar se fija el tiempo.
//
// El tope es `duration − 0,5 s`: un salto al final no llega a disparar `ended`, así que el pill no se cierra solo por
// adelantar. Sin duración (antes de `loadedmetadata`, o `NaN`/`Infinity`/0) la barra no mueve nada y lleva
// `aria-disabled="true"`.
//
// Solo el botón principal (`button === 0`): el 3 y el 4 siguen hasta `document`, donde la 136 escucha «siguiente». Las
// seis teclas de la barra (← → ↑ ↓ Home End) llevan `preventDefault()` y `stopPropagation()`: no scrollean la página ni
// llegan a los otros `keydown`. Con Alt, Ctrl o Meta siguen su camino (Alt+← es «atrás» del navegador), y cualquier otra
// tecla también: `MediaTrackNext` llega a la 136.
const SALTO_TECLA_S = 5;
const MARGEN_FINAL_S = 0.5;
let arrastre = null;   // { id, t } mientras se arrastra la pista

function duracionValida() {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
}

function topar(t, dur) {
  return Math.min(Math.max(0, t), Math.max(0, dur - MARGEN_FINAL_S));
}

// ¿Hay un preview nuestro con la barra a la vista? (No buscando, no embed, no error: ahí la barra está escondida.)
function barraActiva() {
  const barra = pill?.querySelector('.preview-pill-progress');
  return !!(barra && !barra.hidden && currentKey && currentProvider !== 'spotify-embed' && audio.getAttribute('src'));
}

function fijarTiempo(t) {
  const dur = duracionValida();
  if (!dur) return;
  audio.currentTime = topar(t, dur);
  actualizarBarra();
}

function conectarAdelantar(barra, pista) {
  const tiempoEn = (clientX, dur) => {
    const r = pista.getBoundingClientRect();
    if (!r || !(r.width > 0)) return null;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return topar(f * dur, dur);
  };
  const soltarCaptura = (id) => {
    try { if (pista.hasPointerCapture?.(id)) pista.releasePointerCapture(id); } catch { /* ya no la tenía */ }
  };

  pista.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || arrastre || !barraActiva()) return;
    const dur = duracionValida();
    if (!dur) return;
    const t = tiempoEn(e.clientX, dur);
    if (t === null) return;
    e.preventDefault();   // que no seleccione texto
    try { barra.focus({ preventScroll: true }); } catch { /* sin foco igual se puede arrastrar */ }
    try { pista.setPointerCapture(e.pointerId); } catch { /* sin captura, el arrastre termina al salir de la pista */ }
    arrastre = { id: e.pointerId, t };
    actualizarBarra();
  });
  pista.addEventListener('pointermove', (e) => {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    const dur = duracionValida();
    const t = dur ? tiempoEn(e.clientX, dur) : null;
    if (t === null) return;
    arrastre.t = t;
    actualizarBarra();
  });
  pista.addEventListener('pointerup', (e) => {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    const dur = duracionValida();
    const t = dur ? (tiempoEn(e.clientX, dur) ?? arrastre.t) : null;
    arrastre = null;
    soltarCaptura(e.pointerId);
    if (t === null || !barraActiva()) { actualizarBarra(); return; }
    fijarTiempo(t);
  });
  // Sin `pointerup` (el navegador canceló, o se perdió la captura): no se fija nada y la barra vuelve a decir lo del audio.
  const cancelar = (e) => {
    if (!arrastre || e.pointerId !== arrastre.id) return;
    arrastre = null;
    soltarCaptura(e.pointerId);
    actualizarBarra();
  };
  pista.addEventListener('pointercancel', cancelar);
  pista.addEventListener('lostpointercapture', cancelar);

  barra.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const paso = { ArrowRight: SALTO_TECLA_S, ArrowUp: SALTO_TECLA_S, ArrowLeft: -SALTO_TECLA_S, ArrowDown: -SALTO_TECLA_S }[e.key];
    if (paso === undefined && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'End' || arrastre || !barraActiva() || !duracionValida()) return;
    fijarTiempo(e.key === 'Home' ? 0 : (audio.currentTime || 0) + paso);
  });
}

function actualizarBarra() {
  if (!pill) return;
  const barra = pill.querySelector('.preview-pill-progress');
  const durValida = duracionValida();
  // (v=374) Sin duración la barra no mueve nada, y lo dice.
  if (durValida) barra.removeAttribute('aria-disabled');
  else barra.setAttribute('aria-disabled', 'true');
  const dur = durValida || 30;
  // (v=374) Mientras se arrastra, la barra dice el punto del usuario, no el del audio: `timeupdate` no lo pisa.
  const va = Math.min(dur, Math.max(0, arrastre ? arrastre.t : (audio.currentTime || 0)));
  // Los textos van en segundos enteros; el relleno, en el mismo segundo que el
  // texto, para que la barra y el número nunca digan dos cosas distintas.
  const vaS = Math.round(va), durS = Math.round(dur);
  const faltaS = Math.max(0, durS - vaS);
  pill.classList.toggle('preview-pill-anim', animationsEnabled());
  barra.setAttribute('aria-valuemax', String(durS));
  barra.setAttribute('aria-valuenow', String(vaS));
  barra.setAttribute('aria-valuetext', `${mmss(vaS)} de ${mmss(durS)}, faltan ${mmss(faltaS)}`);
  pill.querySelector('.preview-pill-progress-fill').style.width = `${durS ? Math.round((vaS / durS) * 1000) / 10 : 0}%`;
  pill.querySelector('.preview-pill-time-va').textContent = mmss(vaS);
  pill.querySelector('.preview-pill-time-falta').textContent = `−${mmss(faltaS)}`;
}

function reanudar() {
  pausadoPorUsuario = false;
  pintarBotonPausa();
  audio.play().catch(err => {
    if (err && err.name === 'NotAllowedError') {
      showToast('El navegador bloqueó el audio: haz un click en cualquier lado y prueba de nuevo', 'info');
    }
    if (pausadoPorUsuario && err && err.name === 'AbortError') return;   // la volviste a pausar
    stopPreview();
  });
}

function alternarPausa() {
  if (!currentKey || currentProvider === 'spotify-embed' || !audio.getAttribute('src')) return;
  if (pausadoPorUsuario) { reanudar(); return; }
  pausadoPorUsuario = true;
  // Pausar es un gesto explícito, como el clic en el ▶: fija el preview, así
  // que sacar el mouse de la tarjeta ya no lo corta.
  lockedKey = currentKey;
  hoverStartedKey = null;
  clearStallTimer();
  audio.pause();
  pintarBotonPausa();
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
  pausadoPorUsuario = false;
  pintarBotonPausa();
  mostrarControles(false);
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
  const labelEl = p.querySelector('.preview-pill-label');
  // (v=367) El nombre va dentro del marcado de `ui/hover-marquee.js` (`.mq > .mq-t`):
  // en reposo se corta con «…», y si sobra se mueve de un lado al otro (ver
  // `moverEtiqueta()`). El `textContent` de la etiqueta sigue siendo el nombre a
  // secas: lo leen `fail()` y el banco `siempre-y-play`.
  labelEl.innerHTML = hoverMarqueeSpan(escapeHtml(label || ''));
  // (v=357) El nombre entero va en el `title`, que sin animaciones es la única
  // forma de leerlo desde el pill.
  labelEl.title = label || '';
  const provEl = p.querySelector('.preview-pill-provider');
  provEl.textContent = loading ? 'buscando…' : (PROVIDER_LABEL[provider] || '');
  p.classList.toggle('loading', !!loading);
  // Quietas hasta que el <audio> avise que está sonando de verdad.
  p.classList.remove('is-playing');
  pausadoPorUsuario = false;
  arrastre = null;   // (v=374) un preview nuevo no hereda el arrastre del anterior
  pintarBotonPausa();
  mostrarControles(!loading);
  if (!loading) actualizarBarra();
  p.classList.add('show');
  moverEtiqueta();
}

// ── El nombre que no entra se mueve (v=367, tanda 130) ───────────────────────
//
// El pill ya no crece con el nombre (el ancho es fijo, en `components.css`), así
// que un nombre largo no entra. Se mueve con la maquinaria de
// `ui/hover-marquee.js` —la misma de `#wthree` y de las tarjetas: ida y vuelta,
// con pausa en los dos extremos y «…» en reposo—, pero acá sin esperar al mouse:
// el pill es uno solo, no una lista que marea. Se mide al cambiar el nombre y al
// cambiar el tamaño de la ventana, y se para al esconder el pill.
//
// Quién anima lo decide `animationsEnabled()` (dentro de
// `prepararMarquesinaFila`), nunca `prefers-reduced-motion`: Ian tiene las
// animaciones del sistema apagadas y el interruptor de la app en «siempre». Sin
// animaciones, quieto con «…» y el nombre entero en el `title`.
function moverEtiqueta() {
  if (!pill || !pill.classList.contains('show')) return;
  const l = pill.querySelector('.preview-pill-label');
  if (l) prepararMarquesinaFila(l);
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => moverEtiqueta());
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
  pararMarquesinaFila(p);   // (v=367) la etiqueta queda escondida: nada que mover
  pausadoPorUsuario = false;
  mostrarControles(false);
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
  arrastre = null;   // (v=374)
  if (pill) {
    pill.classList.remove('show');
    pill.classList.remove('is-playing');
    pararMarquesinaFila(pill);   // (v=367) el nombre deja de moverse con el pill escondido
    // Limpia el iframe para que no siga cargando/reproduciendo en background
    const box = pill.querySelector('.preview-pill-embed');
    if (box) { box.innerHTML = ''; box.hidden = true; }
  }
}

audio.addEventListener('ended', () => {
  clearStallTimer();
  pausadoPorUsuario = false;
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
// La barra (v=357): unas 4 veces por segundo mientras suena, y al saber la duración.
audio.addEventListener('timeupdate', () => actualizarBarra());
audio.addEventListener('pause', () => actualizarBarra());   // en pausa, la barra dice dónde quedó
audio.addEventListener('durationchange', () => actualizarBarra());
audio.addEventListener('loadedmetadata', () => actualizarBarra());

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
  pausadoPorUsuario = false;
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
  // En pausa (v=357) el navegador puede dejar de bajar y avisar `stalled`: no es un trabado.
  if (pausadoPorUsuario) return;
  stallTimer = setTimeout(() => {
    // Puede que para cuando dispare ya haya arrancado (rearmado por otro
    // 'stalled' intermedio) o que el usuario ya haya pedido otra cosa.
    if (currentKey === key && !audioPlaying && !pausadoPorUsuario) fail('no respondió a tiempo — puede que el enlace ya no esté disponible');
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
    // (v=357) Pausar mientras carga rechaza este `play()` con AbortError: es
    // la pausa que pediste, no un fallo, y no cierra el pill.
    if (pausadoPorUsuario && err && err.name === 'AbortError' && currentKey === key) return;
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
  pausadoPorUsuario = false;
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
    // (v=357) Con su preview en pausa, el ▶ de la tarjeta (que se pinta ▶
    // porque `playing` es false) SIGUE: parar ahí sería hacer lo contrario de
    // lo que dice el botón. Devuelve true, que ya significa «arrancó».
    if (pausadoPorUsuario) { lockedKey = key; hoverStartedKey = null; reanudar(); return true; }
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
document.addEventListener('routeteardown', () => { soltarCola(); stopPreview(); });
document.addEventListener('modalstackempty', () => { soltarCola(); stopPreview(); });

// ── ⏭ «Siguiente» (v=373, tanda 136) ─────────────────────────────────────────
//
// Con la ficha de un álbum abierta y un preview suyo sonando, la tecla de medios «siguiente» y el botón
// «adelante» del mouse hacen sonar la pista siguiente de ESE álbum. La regla: «siguiente» es LO MISMO que
// apretar el ▶ de la fila siguiente. La que sabe qué fila sigue es la ficha (`features/album-card.js`); acá
// vive la COLA (quién la tiene y cuándo se va) y los TRES listeners, que no viven en ningún otro archivo.
//
// La ficha la registra con el evento `previewcola` en `document` y no con un export: los ocho exports de este
// módulo son un contrato que vigilan `preview-player-t115` y `tamano-fijo-t130`. Es el mismo camino que
// `routeteardown` y `modalstackempty`.
//   detail: { duena, esMia(key), siguiente() }  → registra (solo si lo que suena ahora es suyo y no es el embed);
//   detail: { duena }                           → la suelta, si es de esa dueña.
//
// La cola se va con: algo que suena y no es de la ficha (`esMia` dice que no), el embed (el iframe no avisa
// nada: después de él no hay «siguiente»), el ✕ del pill, `modalstackempty`, `routeteardown`, el cierre de la
// ficha (su `onClose`) y, por si acaso, una dueña que ya no está en el DOM. NO se va con `key: null` a secas:
// `ended`, el ⏸ de una fila y el `null` de una fila sin preview la dejan, así «siguiente» sigue andando.
//
// Una pulsación, una «siguiente»: la misma tecla puede llegar por `mediaSession` y por `keydown`, y un clic
// lateral por `mouseup` y por `auxclick`. Una vía DISTINTA de la última aceptada, dentro de los
// `MISMA_PULSACION_MS`, es la misma pulsación y no avanza (en el mouse igual se hace el `preventDefault()`).
// La misma vía dos veces son dos pulsaciones.
//
// 🔴 El botón de atrás del mouse (el 3) no se toca nunca: cambiaría de ruta y cerraría la ficha.
// Sin cola, el de adelante tampoco: el navegador hace lo de siempre.
const MISMA_PULSACION_MS = 400;
let cola = null;               // { duena, esMia, siguiente }
let ultimaPulsacion = null;    // { via, t }

function ponerHandlerDeMedios(fn) {
  const ms = (typeof navigator !== 'undefined' && navigator) ? navigator.mediaSession : null;
  if (!ms || typeof ms.setActionHandler !== 'function') return;
  try { ms.setActionHandler('nexttrack', fn); } catch { /* el navegador no conoce la acción: no hay medios */ }
}

function soltarCola() {
  if (!cola) return;
  cola = null;
  ultimaPulsacion = null;
  ponerHandlerDeMedios(null);
}

function colaViva() {
  if (!cola) return false;
  if (cola.duena && cola.duena.isConnected === false) { soltarCola(); return false; }
  return true;
}

function pedirSiguiente(via) {
  if (!colaViva()) return false;
  const t = Date.now();
  if (ultimaPulsacion && ultimaPulsacion.via !== via && t - ultimaPulsacion.t < MISMA_PULSACION_MS) return true;
  ultimaPulsacion = { via, t };
  try {
    Promise.resolve(cola.siguiente()).catch(err => console.warn('[preview] siguiente:', err));
  } catch (err) { console.warn('[preview] siguiente:', err); }
  return true;
}

document.addEventListener('previewcola', (e) => {
  const d = e.detail || {};
  if (typeof d.siguiente !== 'function') {
    if (cola && cola.duena === d.duena) soltarCola();
    return;
  }
  if (!currentKey || currentProvider === 'spotify-embed' || typeof d.esMia !== 'function' || !d.esMia(currentKey)) {
    soltarCola();
    return;
  }
  cola = { duena: d.duena || null, esMia: d.esMia, siguiente: d.siguiente };
  ponerHandlerDeMedios(() => pedirSiguiente('medios'));
});

// Lo que suena decide si la cola sigue: otra clave que no es de la ficha, o el embed, la sueltan.
document.addEventListener('previewchange', (e) => {
  if (!cola) return;
  const { key, provider } = e.detail || {};
  if (provider === 'spotify-embed') { soltarCola(); return; }
  if (key && !cola.esMia(key)) soltarCola();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'MediaTrackNext') pedirSiguiente('teclado');
});

function botonAdelante(via) {
  // Solo el de adelante y solo con cola. El de atrás ni se mira; sin cola, el navegador hace lo suyo.
  return (e) => {
    if (e.button === 4 && colaViva()) {
      e.preventDefault();
      pedirSiguiente(via);
    }
  };
}
document.addEventListener('mouseup', botonAdelante('mouseup'));
document.addEventListener('auxclick', botonAdelante('auxclick'));

export { togglePreview, stopPreview, playingKey, playingProvider, isPlayingAudio, hoverIn, hoverOut, attachHover };
