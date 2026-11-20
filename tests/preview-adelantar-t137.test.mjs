// tests/preview-adelantar-t137.test.mjs — adelantar dentro del preview con la barra del pill (tanda 137, v=374).
//
// Se prueba `src/js/ui/preview-player.js` REAL, en Node, con los dobles de la 115 (`dobles/loader-t115.mjs`,
// `dobles/preview-t115-doble.mjs` y `dobles/dom-preview-doble.mjs`). El doble de DOM ganó en la 137, sin cambiar lo que ya
// hacía: `getBoundingClientRect` (por `globalThis.__medidas.rect`), `setPointerCapture` / `releasePointerCapture` /
// `hasPointerCapture`, la propagación de los eventos con `bubbles: true` hasta el `document` (con `stopPropagation()`) y
// `evento()`, que arma un evento así. Un preview INVENTADO de 30 s.
//
// `RAIZ_T137` (env) apunta a otra raíz con la misma forma (la copia de e1a10cb), para ver los rojos. Por defecto, este repo.
//
// La regla: «adelantar» es poner `audio.currentTime` donde dice el usuario. Lo esperado, escrito ANTES de correr nada:
//   1. clic al 50 % de la pista con duración 30 → currentTime 15 (± 0,5); aria-valuenow y el relleno lo dicen;
//   2. arrastrar del 20 % al 70 %: en el medio el relleno y aria-valuenow siguen al puntero, un `timeupdate` no los pisa,
//      al soltar currentTime 21 (± 0,5);
//   3. teclado con foco en la barra, desde 10: → 15, ↑ 20, ← 15, ↓ 10, Home 0, End sin cambio; las seis con
//      `defaultPrevented` y ninguna llega a un espía en `document`; `MediaTrackNext` sobre la barra SÍ llega a la 136;
//   4. el tope: clic al 100 % y → desde 28 dan 29,5; ni `ended` ni el pill cerrado;
//   5. en pausa sigue en pausa (`paused`, «Seguir preview», sin `play()`); sonando sigue sonando (sin `pause()`);
//   6. sin duración (NaN o Infinity): clic y teclado no cambian currentTime, aria-disabled="true", nada tira;
//   7. buscando y con el embed la barra sigue escondida;
//   8. los botones 3 y 4 sobre la pista no mueven el tiempo; el 4 sigue siendo «siguiente» de la 136;
//   9. adelantar no emite `previewchange` y no hace ningún `fetch`;
//  10. los ocho exports;
//  11. lecturas estáticas: role="slider" y tabindex="0" en el marcado; nadie fuera del player toca la barra; las reglas nuevas
//      de `components.css` con dos clases y sin `prefers-reduced-motion`; `main.css` byte a byte.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

register('./dobles/loader-t115.mjs', pathToFileURL(import.meta.filename));

const RAIZ = resolve(process.env.RAIZ_T137 || join(dirname(fileURLToPath(import.meta.url)), '..'));
let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? '\n         ' + detalle : ''}`);
}
const igual = (n, sale, esperado) => comprobar(n, JSON.stringify(sale) === JSON.stringify(esperado), `sale     ${JSON.stringify(sale)}\n         esperaba ${JSON.stringify(esperado)}`);
const cerca = (n, sale, esperado, tol = 0.5) => comprobar(n, typeof sale === 'number' && Math.abs(sale - esperado) <= tol, `sale ${sale}, esperaba ${esperado} ± ${tol}`);

// ── Temporizadores y reloj falsos ────────────────────────────────────────────
let ahora = 0, seq = 0;
const timers = new Map();
globalThis.setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { fn, en: ahora + ms }); return id; };
globalThis.clearTimeout = (id) => { timers.delete(id); };
let reloj = 1_000_000;
Date.now = () => reloj;   // la 136 junta dos vías dentro de 400 ms: entre pulsación y pulsación se avanza a mano
const microtareas = () => new Promise((r) => setImmediate(r));

// Ningún `fetch`: si alguien lo llama, se cuenta.
let fetches = 0;
globalThis.fetch = () => { fetches++; return Promise.reject(new Error('t137: sin red')); };

const { instalar, AudioDoble, evento } = await import('./dobles/dom-preview-doble.mjs');
const { body } = instalar();
const eventos = [];
document.addEventListener('previewchange', (e) => eventos.push(e.detail));

// La pista mide 200 px y empieza en x = 100: el 50 % es x = 200.
const PISTA = { left: 100, top: 40, width: 200, height: 16, right: 300, bottom: 56, x: 100, y: 40 };
globalThis.__medidas = { rect: (n) => (n.classList?.contains('preview-pill-progress-bar') ? PISTA : null) };
const enX = (frac) => PISTA.left + PISTA.width * frac;

const mod = await import(pathToFileURL(join(RAIZ, 'src/js/ui/preview-player.js')).href);
const { togglePreview, stopPreview, playingKey } = mod;
const audio = AudioDoble.instancias[0];

const RES = (n, prov = 'itunes') => ({ url: `/t137/audio-${n}.wav`, provider: prov, type: 'audio', label: `Tema t137inventada ${n} — Banda t137inventada` });
async function sonar(key, res, dur = 30) {
  const p = togglePreview(key, async () => res);
  await microtareas();
  const r = await p;
  await microtareas();
  audio.duration = dur; audio.emitir('loadedmetadata');
  audio.emitir('playing');
  return r;
}

// ── 10. Los ocho exports ─────────────────────────────────────────────────────
igual('10a los exports son los ocho de siempre', Object.keys(mod).sort(),
  ['attachHover', 'hoverIn', 'hoverOut', 'isPlayingAudio', 'playingKey', 'playingProvider', 'stopPreview', 'togglePreview']);

globalThis.__T115.animaciones = false;
await sonar('t137:a', RES(1));
const pill = body.querySelector('.preview-pill');
const barra = pill.querySelector('.preview-pill-progress');
const pista = pill.querySelector('.preview-pill-progress-bar');
const relleno = () => pill.querySelector('.preview-pill-progress-fill')?.style.width ?? null;
const valor = () => barra?.getAttribute('aria-valuenow') ?? null;
const faltan = () => pill.querySelector('.preview-pill-time-falta')?.textContent ?? null;

// Un espía en `document`: cuenta las teclas que suben hasta ahí.
const subieron = [];
document.addEventListener('keydown', (e) => subieron.push(e.key));

function puntero(tipo, x, extra = {}) {
  const ev = evento(tipo, { clientX: x, clientY: 48, button: 0, buttons: 1, pointerId: 7, pointerType: 'mouse', ...extra });
  pista.dispatchEvent(ev);
  return ev;
}
function clic(frac) { puntero('pointerdown', enX(frac)); return puntero('pointerup', enX(frac), { buttons: 0 }); }
function tecla(key, extra = {}) { const ev = evento('keydown', { key, ...extra }); barra.dispatchEvent(ev); return ev; }

// ── 11. Marcado ──────────────────────────────────────────────────────────────
igual('11a la barra lleva role="slider"', barra?.getAttribute('role') ?? null, 'slider');
igual('11b la barra lleva tabindex="0"', barra?.getAttribute('tabindex') ?? null, '0');
igual('11c los aria de siempre siguen ahí', [barra?.getAttribute('aria-label'), barra?.getAttribute('aria-valuemin'), barra?.getAttribute('aria-valuemax')], ['Avance del preview', '0', '30']);
comprobar('11d con duración, la barra no lleva aria-disabled', barra?.getAttribute('aria-disabled') !== 'true', barra?.getAttribute('aria-disabled'));

// ── 1. Clic al 50 % ──────────────────────────────────────────────────────────
const ev0 = eventos.length;
audio.currentTime = 3; audio.emitir('timeupdate');
clic(0.5);
cerca('1a clic al 50 % → currentTime 15', audio.currentTime, 15);
igual('1b aria-valuenow lo dice', valor(), '15');
igual('1c el relleno lo dice', relleno(), '50%');
igual('1d «faltan» lo dice', faltan(), '−0:15');
comprobar('1e la pista soltó la captura del puntero', !pista.hasPointerCapture?.(7));

// ── 2. Arrastrar del 20 % al 70 % ────────────────────────────────────────────
audio.currentTime = 2; audio.emitir('timeupdate');
const abajo = puntero('pointerdown', enX(0.2));
comprobar('2a al apretar, la pista toma el puntero', pista.hasPointerCapture?.(7) === true);
comprobar('2b el pointerdown queda con preventDefault (no selecciona texto)', abajo.defaultPrevented === true);
puntero('pointermove', enX(0.5));
igual('2c en el medio, aria-valuenow sigue al puntero', valor(), '15');
igual('2d en el medio, el relleno sigue al puntero', relleno(), '50%');
cerca('2e en el medio, el audio todavía no se movió', audio.currentTime, 2, 0.01);
audio.currentTime = 2.3; audio.emitir('timeupdate');
igual('2f un timeupdate en el medio no pisa lo que se arrastra', [valor(), relleno()], ['15', '50%']);
puntero('pointermove', enX(0.7));
puntero('pointerup', enX(0.7), { buttons: 0 });
cerca('2g al soltar, currentTime 21', audio.currentTime, 21);
igual('2h y la barra lo dice', [valor(), relleno()], ['21', '70%']);
audio.currentTime = 21.2; audio.emitir('timeupdate');
igual('2i después de soltar, la barra vuelve a seguir al audio', valor(), '21');

// ── 3. Teclado ───────────────────────────────────────────────────────────────
barra.focus?.();
audio.currentTime = 10; audio.emitir('timeupdate');
subieron.length = 0;
const pasos = [];
const prevenidas = [];
for (const k of ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'Home', 'End']) {
  const ev = tecla(k);
  prevenidas.push(ev.defaultPrevented);
  pasos.push(Math.round(audio.currentTime * 10) / 10);
}
igual('3a desde 10: → 15, ↑ 20, ← 15, ↓ 10, Home 0, End sin cambio', pasos, [15, 20, 15, 10, 0, 0]);
igual('3b las seis quedan con defaultPrevented', prevenidas, [true, true, true, true, true, true]);
igual('3c ninguna llega a un espía en document', subieron, []);
// `MediaTrackNext` sobre la barra: llega a la 136. Con una cola registrada por una «ficha» inventada.
const duena = document.createElement('div');
body.appendChild(duena);
let siguientes = 0;
document.dispatchEvent(new CustomEvent('previewcola', { detail: { duena, esMia: (k) => String(k).startsWith('t137:'), siguiente: () => { siguientes++; } } }));
reloj += 1000;
const medios = tecla('MediaTrackNext');
igual('3d MediaTrackNext sobre la barra llega a document (y a la 136)', [subieron.includes('MediaTrackNext'), siguientes], [true, 1]);
comprobar('3e MediaTrackNext no queda prevenido por la barra', medios.defaultPrevented === false);
// Otra tecla cualquiera sigue su camino.
const tab = tecla('Tab');
comprobar('3f otra tecla (Tab) sigue su camino', subieron.includes('Tab') && !tab.defaultPrevented);
// Con Alt, la flecha sigue su camino (Alt+← es «atrás» del navegador).
audio.currentTime = 10;
const alt = tecla('ArrowLeft', { altKey: true });
comprobar('3g Alt+← no la toca la barra', !alt.defaultPrevented && audio.currentTime === 10 && subieron.includes('ArrowLeft'));

// ── 8. Los botones 3 y 4 sobre la pista ──────────────────────────────────────
audio.currentTime = 10;
reloj += 1000;
for (const b of [3, 4]) {
  puntero('pointerdown', enX(0.9), { button: b, buttons: b === 3 ? 8 : 16 });
  puntero('pointerup', enX(0.9), { button: b, buttons: 0 });
}
cerca('8a los botones 3 y 4 no mueven el tiempo', audio.currentTime, 10, 0.01);
const antesDel4 = siguientes;
reloj += 1000;
const up4 = evento('mouseup', { button: 4 });
pista.dispatchEvent(up4);
igual('8b el 4 sigue siendo «siguiente» de la 136 (y prevenido por ella)', [siguientes - antesDel4, up4.defaultPrevented], [1, true]);
reloj += 1000;
const up3 = evento('mouseup', { button: 3 });
pista.dispatchEvent(up3);
igual('8c el 3 no lo toca nadie', [siguientes - antesDel4, up3.defaultPrevented], [1, false]);
document.dispatchEvent(new CustomEvent('previewcola', { detail: { duena } }));   // la «ficha» suelta la cola

// ── 4. El tope ───────────────────────────────────────────────────────────────
let terminados = 0;
audio.addEventListener('ended', () => { terminados++; });
clic(1);
cerca('4a clic al 100 % → 29,5', audio.currentTime, 29.5, 0.01);
audio.currentTime = 28;
tecla('ArrowRight');
cerca('4b → desde 28 → 29,5', audio.currentTime, 29.5, 0.01);
puntero('pointerdown', enX(0.5));
puntero('pointermove', enX(1.4));   // fuera de la pista, a la derecha
puntero('pointerup', enX(1.4), { buttons: 0 });
cerca('4c arrastrar más allá de la pista también queda en 29,5', audio.currentTime, 29.5, 0.01);
clic(-0.3);
cerca('4d a la izquierda de la pista, 0', audio.currentTime, 0, 0.01);
comprobar('4e ni ended ni el pill cerrado', terminados === 0 && pill.classList.contains('show') && playingKey() === 't137:a');

// ── 9. Nada nuevo afuera ─────────────────────────────────────────────────────
igual('9a adelantar no emitió ningún previewchange', eventos.length - ev0, 0);
igual('9b ni ningún fetch', fetches, 0);

// ── 5. La pausa ──────────────────────────────────────────────────────────────
audio.emitir('playing');
const toggle = pill.querySelector('.preview-pill-toggle');
toggle?.click();
await microtareas();
const l5 = audio.llamadas.length;
clic(0.4);
tecla('ArrowRight');
igual('5a en pausa: queda en pausa, en el tiempo nuevo, con «Seguir preview»', [audio.paused, Math.round(audio.currentTime), toggle?.getAttribute('aria-label') ?? null], [true, 17, 'Seguir preview']);
comprobar('5b en pausa: ni play() ni pause()', !audio.llamadas.slice(l5).some((l) => l === 'play' || l === 'pause'), JSON.stringify(audio.llamadas.slice(l5)));
toggle?.click();
await microtareas();
audio.emitir('playing');
const l5b = audio.llamadas.length;
clic(0.2);
tecla('ArrowLeft');
igual('5c sonando: sigue sonando, en el tiempo nuevo', [audio.paused, Math.round(audio.currentTime), toggle?.getAttribute('aria-label') ?? null], [false, 1, 'Pausar preview']);
comprobar('5d sonando: ni play() ni pause()', !audio.llamadas.slice(l5b).some((l) => l === 'play' || l === 'pause'), JSON.stringify(audio.llamadas.slice(l5b)));

// ── 6. Sin duración ──────────────────────────────────────────────────────────
for (const d of [NaN, Infinity, 0]) {
  stopPreview();
  await sonar('t137:sin', RES(6), d);
  audio.currentTime = 0;
  let tiro = null;
  try { clic(0.5); tecla('ArrowRight'); tecla('Home'); } catch (e) { tiro = e; }
  comprobar(`6a duración ${d}: nada tira`, tiro === null, String(tiro));
  igual(`6b duración ${d}: clic y teclado no mueven currentTime`, audio.currentTime, 0);
  igual(`6c duración ${d}: aria-disabled="true"`, barra.getAttribute('aria-disabled'), 'true');
}
audio.duration = 30; audio.emitir('durationchange');
comprobar('6d con la duración que llega, se habilita', barra.getAttribute('aria-disabled') !== 'true', barra.getAttribute('aria-disabled'));

// ── 7. Buscando y con el embed: la barra escondida ───────────────────────────
stopPreview();
let soltar;
const p7 = togglePreview('t137:busca', () => new Promise((res) => { soltar = res; }));
await microtareas();
comprobar('7a buscando, la barra escondida', barra.hidden === true);
soltar({ url: 'https://open.spotify.com/embed/track/t137inventada0000000007', provider: 'spotify-embed', type: 'embed', label: 'Tema t137inventada 7 — Banda t137inventada' });
await p7; await microtareas();
comprobar('7b con el embed, la barra escondida', barra.hidden === true);
stopPreview();

// ── 11. Lecturas estáticas ───────────────────────────────────────────────────
const fuente = readFileSync(join(RAIZ, 'src/js/ui/preview-player.js'), 'utf8');
comprobar('11e el marcado dice role="slider" y tabindex="0"', /class="preview-pill-progress"[^>]*role="slider"/.test(fuente) && /class="preview-pill-progress"[^>]*tabindex="0"/.test(fuente));
const otros = [];
(function recorrer(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) recorrer(p);
    else if (/\.m?js$/.test(n) && !p.endsWith(join('ui', 'preview-player.js')) && /preview-pill-progress/.test(readFileSync(p, 'utf8'))) otros.push(p.slice(RAIZ.length + 1));
  }
})(join(RAIZ, 'src/js'));
igual('11f nadie fuera de preview-player.js toca la barra', otros, []);
comprobar('11g los listeners de puntero y de teclado están en preview-player.js', ['pointerdown', 'pointermove', 'pointerup', 'keydown'].every((t) => fuente.includes(`'${t}'`)) && /setPointerCapture/.test(fuente));
// Sin los comentarios: un comentario que nombra la barra no es una regla.
const comp = readFileSync(join(RAIZ, 'src/css/components.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const selectores = [...comp.matchAll(/(^|\})\s*([^{}@]*preview-pill-progress[^{}]*)\{/g)].map((m) => m[2].trim());
const conUnaClase = selectores.flatMap((s) => s.split(',').map((x) => x.trim())).filter((s) => !/^\.preview-pill[.\s]/.test(s));
igual('11h todas las reglas de la barra van con dos clases (.preview-pill + otra)', conUnaClase, []);
comprobar('11i la pista tiene cursor de mano', /\.preview-pill \.preview-pill-progress-bar \{[^}]*cursor:\s*pointer/.test(comp));
// (el acento mezclado hacia el texto: el acento a secas da 2,89:1 en Violeta, medido por el banco, puerta F)
comprobar('11j foco visible: contorno de 2 px del acento en la barra', /\.preview-pill \.preview-pill-progress:focus-visible[^{]*\{[^}]*outline:\s*2px solid (var\(--color-accent\)|color-mix\(in srgb, var\(--color-accent\))/.test(comp));
comprobar('11k ninguna regla de la barra usa prefers-reduced-motion', !/prefers-reduced-motion[^{]*\{[^}]*preview-pill-progress/.test(comp));
const shaMain = createHash('sha256').update(readFileSync(join(RAIZ, 'src/css/main.css'))).digest('hex');
igual('11l main.css byte a byte (sha256 de e1a10cb)', shaMain, '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07');

console.log(`preview-adelantar-t137: ${ok} asserts OK · ${fallos} fallos (de ${ok + fallos})`);
process.exit(fallos ? 1 : 0);
