// tests/preview-player-t115.test.mjs — el reproductor de previews: pausa, barra de los 30 s, el nombre
// entero y el enlace del embed (tanda 115, v=357).
//
// Se prueba `src/js/ui/preview-player.js` REAL, en Node. Sus vecinos (`components.js`, `toast.js`,
// `bottom-layer.js`, `reveal.js`) los cambia `dobles/loader-t115.mjs` por `dobles/preview-t115-doble.mjs`, y el
// DOM y el `<audio>` son `dobles/dom-preview-doble.mjs`. Los temporizadores son falsos (`avanzar(ms)`).
//
// `RAIZ_T115` (env) apunta a otra raíz con la misma forma (la copia de 0be19f5d en `tmp-t115/`), para ver
// los rojos contra la versión anterior. Por defecto, este repo.
//
// Lo que se afirma:
//   A. conservación: los ocho exports de siempre, el pill no existe antes del primer preview, el evento
//      `previewchange` trae exactamente { key, provider, playing } y `togglePreview` devuelve lo de siempre;
//   B. la pausa: un botón en el pill pausa sin cerrar (el `key` sigue, `playing: false`), sigue desde donde
//      estaba, se llama «Pausar preview» / «Seguir preview», el ▶ de la tarjeta con el preview en pausa
//      SIGUE en vez de parar, una pausa no dispara el corte por trabado ni la cierra un `play()` rechazado,
//      y el ✕ cierra como antes;
//   C. la barra: `role="progressbar"` con lo que va y lo que falta (texto y `aria-valuetext`), sin
//      animación si `animationsEnabled()` es false y con ella si es true;
//   D. el nombre entero en el `title` de la etiqueta;
//   E. el CSS: lo nuevo en `components.css` con dos clases, `main.css` byte a byte igual que en v=356.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

register('./dobles/loader-t115.mjs', pathToFileURL(import.meta.filename));

const RAIZ = resolve(process.env.RAIZ_T115 || join(dirname(fileURLToPath(import.meta.url)), '..'));
let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? '\n         ' + detalle : ''}`);
}
const igual = (n, sale, esperado) => comprobar(n, JSON.stringify(sale) === JSON.stringify(esperado), `sale     ${JSON.stringify(sale)}\n         esperaba ${JSON.stringify(esperado)}`);

// ── Temporizadores falsos ────────────────────────────────────────────────────
let ahora = 0, seq = 0;
const timers = new Map();
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { fn, en: ahora + ms }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
function avanzar(ms) {
  const fin = ahora + ms;
  for (;;) {
    const prox = [...timers.entries()].filter(([, t]) => t.en <= fin).sort((a, b) => a[1].en - b[1].en)[0];
    if (!prox) break;
    timers.delete(prox[0]); ahora = prox[1].en; prox[1].fn();
  }
  ahora = fin;
}
const microtareas = () => new Promise((r) => setImmediate(r));

const { instalar, AudioDoble } = await import('./dobles/dom-preview-doble.mjs');
const { body } = instalar();
const eventos = [];
document.addEventListener('previewchange', (e) => eventos.push(e.detail));

const mod = await import(pathToFileURL(join(RAIZ, 'src/js/ui/preview-player.js')).href);
const { togglePreview, stopPreview, playingKey, isPlayingAudio } = mod;
const audio = AudioDoble.instancias[0];

// ── A. conservación ──────────────────────────────────────────────────────────
igual('A1 los exports son los ocho de siempre', Object.keys(mod).sort(),
  ['attachHover', 'hoverIn', 'hoverOut', 'isPlayingAudio', 'playingKey', 'playingProvider', 'stopPreview', 'togglePreview']);
igual('A2 sin usar el reproductor, el pill no existe', body.children.length, 0);
comprobar('A3 hay un solo <audio>', AudioDoble.instancias.length === 1);
const sinPreview = await togglePreview('t115:nada', async () => null);
igual('A4 sin preview, togglePreview devuelve null', sinPreview, null);
igual('A5 y no queda ningún key', playingKey(), null);
igual('A6 el evento trae exactamente { key, provider, playing }', Object.keys(eventos.at(-1)).sort(), ['key', 'playing', 'provider']);

const RES = (n, prov = 'itunes') => ({ url: `/t115/audio-${n}.wav`, provider: prov, type: 'audio', label: `Tema t115inventada ${n} — Banda t115inventada` });
async function sonar(key, res) {
  const p = togglePreview(key, async () => res);
  await microtareas();
  const r = await p;
  await microtareas();
  audio.emitir('playing');
  return r;
}

// Arranca uno, con las animaciones APAGADAS (el camino de Ian: el sistema las tiene apagadas).
globalThis.__T115.animaciones = false;
igual('A7 togglePreview devuelve true al arrancar', await sonar('t115:a', RES(1)), true);
const pill = body.querySelector('.preview-pill');
comprobar('A8 el pill existe y se ve', !!pill && pill.classList.contains('show'));
igual('A9 suena: playing true', [playingKey(), isPlayingAudio(), eventos.at(-1).playing], ['t115:a', true, true]);

// ── D. el nombre entero ──────────────────────────────────────────────────────
igual('D1 la etiqueta lleva el nombre entero en el title', pill.querySelector('.preview-pill-label')?.getAttribute('title') ?? null, 'Tema t115inventada 1 — Banda t115inventada');

// ── C. la barra ──────────────────────────────────────────────────────────────
const barra = pill.querySelector('[role=progressbar]');
comprobar('C1 hay una barra con role="progressbar"', !!barra);
audio.duration = 30; audio.emitir('loadedmetadata');
audio.currentTime = 12; audio.emitir('timeupdate');
igual('C2 aria-valuenow / aria-valuemax', [barra?.getAttribute('aria-valuenow') ?? null, barra?.getAttribute('aria-valuemax') ?? null], ['12', '30']);
igual('C3 el relleno va al 40 %', pill.querySelector('.preview-pill-progress-fill')?.style.width ?? null, '40%');
igual('C4 dice cuánto va y cuánto falta', [pill.querySelector('.preview-pill-time-va')?.textContent ?? null, pill.querySelector('.preview-pill-time-falta')?.textContent ?? null], ['0:12', '−0:18']);
comprobar('C5 aria-valuetext dice lo que falta', /faltan 0:18/.test(barra?.getAttribute('aria-valuetext') || ''), barra?.getAttribute('aria-valuetext'));
comprobar('C6 sin animaciones, la barra no anima (sin .preview-pill-anim)', !!barra && !pill.classList.contains('preview-pill-anim'));
globalThis.__T115.animaciones = true;
audio.currentTime = 13.4; audio.emitir('timeupdate');
comprobar('C7 con animaciones, anima (.preview-pill-anim)', pill.classList.contains('preview-pill-anim'));
igual('C8 redondea a segundos enteros', [pill.querySelector('.preview-pill-time-va')?.textContent ?? null, pill.querySelector('.preview-pill-time-falta')?.textContent ?? null], ['0:13', '−0:17']);
globalThis.__T115.animaciones = false;

// ── B. la pausa ──────────────────────────────────────────────────────────────
const boton = pill.querySelector('.preview-pill-toggle');
comprobar('B1 hay un botón de pausa a la vista', !!boton && !boton.hidden && boton.tagName === 'BUTTON');
igual('B2 se llama «Pausar preview»', boton?.getAttribute('aria-label') ?? null, 'Pausar preview');
audio.currentTime = 12;
const llamadasAntes = audio.llamadas.length;
boton?.click();
await microtareas();
comprobar('B3 pausa el <audio>', audio.paused && audio.llamadas.slice(llamadasAntes).includes('pause'));
// (rehecho tras el rojo: «el pill sigue» se cumplía solo sin pausa; ahora exige la pausa a la vez)
comprobar('B4 pausado, el pill sigue a la vista', !!boton && audio.paused && pill.classList.contains('show'));
igual('B5 el key sigue y avisa playing: false', [playingKey(), eventos.at(-1).key, eventos.at(-1).playing], ['t115:a', 't115:a', false]);
comprobar('B6 pausado, no saca el src', audio.paused && !!boton && !audio.llamadas.slice(llamadasAntes).includes('removeAttribute(src)') && audio.src === '/t115/audio-1.wav');
igual('B7 ahora se llama «Seguir preview»', boton?.getAttribute('aria-label') ?? null, 'Seguir preview');
// Una pausa no es un trabado: `stalled` en pausa no arma el corte.
audio.emitir('stalled');
avanzar(9000);
comprobar('B8 en pausa, 9 s de stalled no la cortan', playingKey() === 't115:a' && !pill.classList.contains('preview-pill-error'));
igual('B9 y la barra sigue diciendo dónde quedó', pill.querySelector('.preview-pill-time-va')?.textContent ?? null, '0:12');
// Seguir.
const antesDeSeguir = audio.llamadas.length;
boton?.click();
await microtareas();
audio.emitir('playing');
comprobar('B10 sigue: play() sin cambiar el src', audio.llamadas.slice(antesDeSeguir).includes('play') && !audio.llamadas.slice(antesDeSeguir).some(l => l.startsWith('src=')));
igual('B11 sigue desde donde estaba (y siguió de verdad)', [audio.currentTime, audio.paused, audio.llamadas.slice(antesDeSeguir).includes('play')], [12, false, true]);
igual('B12 avisa playing: true con el mismo key', [eventos.at(-1).key, eventos.at(-1).playing], ['t115:a', true]);
igual('B13 vuelve a «Pausar preview»', boton?.getAttribute('aria-label') ?? null, 'Pausar preview');
// El ▶ de la tarjeta con el preview en pausa: SIGUE (no para).
boton?.click(); await microtareas();
// (rehecho tras el rojo: sin la precondición, contra la base el key ya era null y arrancaba de cero)
const enPausaAntes = playingKey() === 't115:a' && audio.paused && !!boton;
const llamadasB14 = audio.llamadas.length;
const r = await togglePreview('t115:a', async () => RES(1));
await microtareas();
comprobar('B14 el ▶ de la tarjeta, en pausa, sigue (sin recargar) y devuelve true',
  enPausaAntes && r === true && !audio.paused && playingKey() === 't115:a' && !audio.llamadas.slice(llamadasB14).some(l => l.startsWith('src=')),
  JSON.stringify({ enPausaAntes, r, paused: audio.paused, key: playingKey() }));
audio.emitir('playing');
// Con el preview sonando y fijado, el ▶ de la tarjeta para, como siempre.
const r2 = await togglePreview('t115:a', async () => RES(1));
igual('A10 sonando y fijado, el ▶ de la tarjeta para (false)', [r2, playingKey()], [false, null]);
// Una pausa en medio de la carga: el `play()` rechazado (AbortError) no cierra el pill.
// (rehecho tras el primer verde: el doble rechazaba el `play()` antes del clic; ahora queda pendiente y se
// rechaza con AbortError al llegar el `pause()`, como en el navegador)
audio.colgarPlay = true;
const p3 = togglePreview('t115:b', async () => RES(2));
await microtareas(); await p3;
const toggleB15 = pill.querySelector('.preview-pill-toggle');
toggleB15?.click();
await microtareas(); await microtareas(); await microtareas();
comprobar('B15 pausar mientras carga no cierra el pill', !!toggleB15 && audio.paused && playingKey() === 't115:b' && pill.classList.contains('show'), JSON.stringify({ key: playingKey(), paused: audio.paused, clases: pill.className }));
// El ✕ cierra, como antes.
pill.querySelector('.preview-pill-close').click();
await microtareas();
igual('B16 el ✕ para y cierra', [playingKey(), pill.classList.contains('show'), audio.getAttribute('src')], [null, false, null]);

// Uno nuevo arranca la barra en cero y el botón en «Pausar».
await sonar('t115:c', RES(3, 'deezer'));
audio.duration = 30; audio.emitir('durationchange');
igual('C9 un preview nuevo arranca la barra en 0', [pill.querySelector('.preview-pill-progress-fill')?.style.width ?? null, pill.querySelector('.preview-pill-time-va')?.textContent ?? null], ['0%', '0:00']);
igual('B17 y el botón en «Pausar preview»', pill.querySelector('.preview-pill-toggle')?.getAttribute('aria-label') ?? null, 'Pausar preview');
// Buscando: ni botón de pausa ni barra (no hay nada que pausar).
stopPreview();
let soltar;
const p4 = togglePreview('t115:d', () => new Promise((res) => { soltar = res; }));
await microtareas();
comprobar('B18 buscando: sin botón de pausa ni barra', pill.querySelector('.preview-pill-toggle')?.hidden === true && pill.querySelector('.preview-pill-progress')?.hidden === true);
soltar({ url: 'https://open.spotify.com/embed/track/t115inventada000000005', provider: 'spotify-embed', type: 'embed', label: 'Tema t115inventada 5 — Banda t115inventada' });
await p4; await microtareas();
comprobar('B19 embed: sin botón de pausa ni barra (el iframe no avisa nada)', pill.querySelector('.preview-pill-toggle')?.hidden === true && pill.querySelector('.preview-pill-progress')?.hidden === true);
stopPreview();

// ── E. el CSS ────────────────────────────────────────────────────────────────
const comp = readFileSync(join(RAIZ, 'src/css/components.css'), 'utf8');
const regla = (sel) => { const i = comp.indexOf(sel + ' {'); return i < 0 ? null : comp.slice(i, comp.indexOf('}', i) + 1); };
comprobar('E1 el enlace del embed en --color-text-secondary (AA), con dos clases', /color:\s*var\(--color-text-secondary\)/.test(regla('.preview-pill .preview-pill-embed-link') || ''), regla('.preview-pill .preview-pill-embed-link'));
comprobar('E2 el botón de pausa tiene su regla con dos clases', !!regla('.preview-pill .preview-pill-toggle'));
comprobar('E3 la barra tiene su regla con dos clases', !!regla('.preview-pill .preview-pill-progress'));
comprobar('E4 la transición de la barra cuelga de .preview-pill-anim (la decide animationsEnabled())', /\.preview-pill\.preview-pill-anim \.preview-pill-progress-fill \{[^}]*transition/.test(comp));
comprobar('E5 ninguna regla nueva usa prefers-reduced-motion para la barra', !/prefers-reduced-motion[^{]*\{[^}]*preview-pill-progress/.test(comp));
const shaMain = createHash('sha256').update(readFileSync(join(RAIZ, 'src/css/main.css'))).digest('hex');
igual('E6 main.css no se tocó (sha256 de v=356)', shaMain, '409e0503b479d125d93bf80dfa8212ac8e03669103ac8bb094875fdf5b01641f');

console.log(`preview-player-t115: ${ok} asserts OK · ${fallos} fallos (de ${ok + fallos})`);
process.exit(fallos ? 1 : 0);
