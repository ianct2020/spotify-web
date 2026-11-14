// tests/tamano-fijo-t130.test.mjs — el nombre del pill y el título de la tarjeta se mueven con `ui/hover-marquee.js`
// (tanda 130, v=367).
//
// Se prueban REALES, en Node: `src/js/ui/preview-player.js` y `src/js/ui/track-card-row.js`, con `ui/hover-marquee.js` real
// adentro. Los vecinos los dobla `dobles/loader-t115.mjs` (el de la tanda 115: `components.js`, `toast.js`, `bottom-layer.js`
// y `reveal.js`, este último con `globalThis.__T115.animaciones`), y el DOM es `dobles/dom-preview-doble.mjs`, que desde
// esta tanda contesta `scrollWidth` / `clientWidth` con `globalThis.__medidas` (sin layout: el «sobra» se dobla a mano).
//
// `RAIZ_T130` (env) apunta a otra raíz con la misma forma (p. ej. una copia de 53a9914), para ver los rojos.
//
// Lo que se afirma:
//   A. la etiqueta del pill lleva el marcado `.mq > .mq-t`, con el nombre escapado; el `textContent` y el `title` son el
//      nombre entero;
//   B. con `animationsEnabled()` en true y un nombre que sobra: `mq-on` y `--mq-shift`; en false: sin `mq-on` y con `title`;
//   C. al esconder el pill, apagado; al cambiar el tamaño de la ventana, se vuelve a medir (solo con el pill a la vista);
//   D. lo que no cambia: los ocho exports, el evento `{ key, provider, playing }` y el toast de `fail()` con el nombre;
//   E. la tarjeta: `hoverMarqueeSpan` y no `marqueeSpan`, el nombre escapado, y la grilla cableada con `wireHoverMarquee`
//      por `wireTrackCardGrid` (en hover, no sola);
//   F. lectura estática: `main.css` con el mismo `sha256`, ningún `@keyframes` nuevo, ninguna `prefers-reduced-motion`
//      nueva, ninguna tercera marquesina, `activateMarquee` fuera de las tres vistas de tarjetas, `#wthree` igual, y las
//      reglas nuevas de `components.css` con dos clases.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

register('./dobles/loader-t115.mjs', pathToFileURL(import.meta.filename));

const RAIZ = resolve(process.env.RAIZ_T130 || join(dirname(fileURLToPath(import.meta.url)), '..'));
let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? '\n         ' + detalle : ''}`);
}
const igual = (n, sale, esperado) => comprobar(n, JSON.stringify(sale) === JSON.stringify(esperado), `sale     ${JSON.stringify(sale)}\n         esperaba ${JSON.stringify(esperado)}`);
const microtareas = () => new Promise((r) => setImmediate(r));

const { instalar, AudioDoble } = await import('./dobles/dom-preview-doble.mjs');
const { body } = instalar();
// Sin layout: el texto de `.mq-t` mide 200 de visible y 200 (entra) o 400 (sobra 200) de contenido.
let sobra = false;
globalThis.__medidas = {
  scrollWidth: (n) => (n.classList.contains('mq-t') ? (sobra ? 400 : 200) : 0),
  clientWidth: (n) => (n.classList.contains('mq-t') ? 200 : 0),
};
const eventos = [];
document.addEventListener('previewchange', (e) => eventos.push(e.detail));
const anim = (on) => { globalThis.__T115.animaciones = on; };

const mod = await import(pathToFileURL(join(RAIZ, 'src/js/ui/preview-player.js')).href);
const { togglePreview, stopPreview } = mod;
const audio = AudioDoble.instancias[0];

const NOMBRE = 'Tema <b>inventado</b> & "t130" — Banda t130inventada';
const RES = (label) => ({ url: '/t130/audio.wav', provider: 'itunes', type: 'audio', label });
let n = 0;
async function sonar(label) {
  const p = togglePreview(`t130:${++n}`, async () => RES(label));
  await microtareas();
  await p;
  await microtareas();
  audio.emitir('playing');
}
const pill = () => body.querySelector('.preview-pill');
const etiqueta = () => pill()?.querySelector('.preview-pill-label');
const mq = () => etiqueta()?.querySelector('.mq') || null;

// ── A. el marcado ────────────────────────────────────────────────────────────
anim(false); sobra = false;
await sonar(NOMBRE);
const t = mq()?.querySelector('.mq-t') || null;
comprobar('A1 la etiqueta lleva .mq > .mq-t', !!t && t.parentNode === mq() && mq().parentNode === etiqueta(), `innerHTML de la etiqueta: ${etiqueta()?.innerHTML}`);
comprobar('A2 el nombre va escapado', (etiqueta()?.innerHTML || '').includes('&lt;b&gt;inventado&lt;/b&gt; &amp; &quot;t130&quot;') && !(etiqueta()?.innerHTML || '').includes('<b>'), etiqueta()?.innerHTML);
igual('A3 el textContent de la etiqueta es el nombre entero (lo leen fail() y el banco siempre-y-play)', etiqueta()?.textContent ?? null, NOMBRE);
igual('A4 el title de la etiqueta es el nombre entero (v=357)', etiqueta()?.getAttribute('title') ?? null, NOMBRE);
comprobar('A5 un nombre que entra: sin mq-on', !mq()?.classList.contains('mq-on'));

// ── B. con y sin animaciones ─────────────────────────────────────────────────
anim(true); sobra = true;
await sonar(NOMBRE);
comprobar('B1 con animaciones y un nombre que sobra: mq-on, sin esperar al mouse', !!mq()?.classList.contains('mq-on'), `clases de .mq: ${mq()?.className}`);
igual('B2 y --mq-shift con lo que sobra', mq()?.style.getPropertyValue('--mq-shift') ?? null, '-200px');
comprobar('B3 y sin title en .mq (se mueve)', !mq()?.getAttribute('title'));
anim(false);
await sonar(NOMBRE);
comprobar('B4 sin animaciones: sin mq-on', !!mq() && !mq().classList.contains('mq-on'));
igual('B5 sin animaciones: el nombre entero en el title de .mq', mq()?.getAttribute('title') ?? null, NOMBRE);
igual('B6 y en el de la etiqueta', etiqueta()?.getAttribute('title') ?? null, NOMBRE);

// ── C. al esconder y al cambiar el tamaño ────────────────────────────────────
anim(true); sobra = true;
await sonar(NOMBRE);
comprobar('C1 sonando, mq-on', !!mq()?.classList.contains('mq-on'));
stopPreview();
comprobar('C2 al esconder el pill, mq-on apagado', !!mq() && !mq().classList.contains('mq-on'));
sobra = false;
await sonar(NOMBRE);
comprobar('C3 un nombre que entra: sin mq-on', !!mq() && !mq().classList.contains('mq-on'));
sobra = true;
window.dispatchEvent({ type: 'resize' });
comprobar('C4 al cambiar el tamaño de la ventana y sobrar, mq-on', !!mq()?.classList.contains('mq-on'));
stopPreview();
window.dispatchEvent({ type: 'resize' });
comprobar('C5 con el pill escondido, un resize no la prende', !!mq() && !mq().classList.contains('mq-on'));

// ── D. lo que no cambia ──────────────────────────────────────────────────────
igual('D1 los exports son los ocho de siempre', Object.keys(mod).sort(),
  ['attachHover', 'hoverIn', 'hoverOut', 'isPlayingAudio', 'playingKey', 'playingProvider', 'stopPreview', 'togglePreview']);
igual('D2 el evento trae exactamente { key, provider, playing }', Object.keys(eventos.at(-1) || {}).sort(), ['key', 'playing', 'provider']);
anim(true); sobra = true;
await sonar(NOMBRE);
audio.error = { code: 4 };
audio.emitir('error');
comprobar('D3 el toast de fail() dice el nombre entero', (globalThis.__T115.toasts.at(-1)?.msg || '').includes(`«${NOMBRE}»`), globalThis.__T115.toasts.at(-1)?.msg);
audio.error = null;
stopPreview();

// ── E. la tarjeta ────────────────────────────────────────────────────────────
const tcr = await import(pathToFileURL(join(RAIZ, 'src/js/ui/track-card-row.js')).href);
const NOMBRE_T = 'Un tema <i>inventado</i> larguísimo de la t130';
const html = tcr.renderTrackCardRow({ id: 't130x', name: NOMBRE_T, artists: 'Banda t130inventada', sub: 'Disco t130inventado', trackId: 't130inventada000000001' });
comprobar('E1 el título con el marcado de hover-marquee (.mq > .mq-t)', /class="sc-title"><span class="mq\s*"><span class="mq-t">/.test(html), html.match(/<div class="sc-title">.*?<\/div>/s)?.[0]);
comprobar('E2 y sin la marquesina vieja (marquee-wrap)', !html.includes('marquee-wrap'));
comprobar('E3 el nombre escapado', html.includes('Un tema &lt;i&gt;inventado&lt;/i&gt; larguísimo de la t130'));
const grid = document.createElement('div');
grid.className = 'sc-grid';
grid.innerHTML = html;
body.appendChild(grid);
tcr.wireTrackCardGrid(grid, { rowById: () => ({}), onToggle() {} });
const titulo = grid.querySelector('.sc-title');
const mqT = () => titulo?.querySelector('.mq') || null;
anim(true); sobra = true;
comprobar('E4 en reposo, quieta (no se mueve sola)', !!mqT() && !mqT().classList.contains('mq-on'));
grid.dispatchEvent({ type: 'mouseover', target: titulo, relatedTarget: null });
comprobar('E5 en hover, con animaciones y un nombre que sobra: mq-on', !!mqT()?.classList.contains('mq-on'));
grid.dispatchEvent({ type: 'mouseout', target: titulo, relatedTarget: null });
comprobar('E6 al salir, apagada', !!mqT() && !mqT().classList.contains('mq-on'));
anim(false);
grid.dispatchEvent({ type: 'mouseover', target: titulo, relatedTarget: null });
comprobar('E7 sin animaciones, en hover: sin mq-on', !!mqT() && !mqT().classList.contains('mq-on'));
igual('E8 y con el nombre entero en el title', mqT()?.getAttribute('title') ?? null, 'Un tema <i>inventado</i> larguísimo de la t130');

// ── F. lectura estática ──────────────────────────────────────────────────────
const leer = (p) => readFileSync(join(RAIZ, p), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const tcrSrc = sinComentarios(leer('src/js/ui/track-card-row.js'));
comprobar('F1 track-card-row.js importa hoverMarqueeSpan y wireHoverMarquee de hover-marquee.js', /import\s*\{[^}]*hoverMarqueeSpan[^}]*\}\s*from\s*'\.\/hover-marquee\.js'/.test(tcrSrc) && /wireHoverMarquee\(/.test(tcrSrc));
comprobar('F2 y ya no usa marqueeSpan', !/\bmarqueeSpan\(/.test(tcrSrc) && !/from\s*'\.\/marquee\.js'/.test(tcrSrc));
comprobar('F3 preview-player.js usa la maquinaria de hover-marquee.js', /from\s*'\.\/hover-marquee\.js'/.test(sinComentarios(leer('src/js/ui/preview-player.js'))));
for (const v of ['skips', 'zero-plays', 'sin-clasificar']) {
  comprobar(`F4 ${v}.js ya no llama a activateMarquee (no le queda nada que mover)`, !/activateMarquee/.test(sinComentarios(leer(`src/js/features/${v}.js`))));
}
for (const v of ['wrapped', 'dashboard']) {
  comprobar(`F5 ${v}.js sigue con su activateMarquee (no se toca)`, /activateMarquee\(/.test(leer(`src/js/features/${v}.js`)));
}
comprobar('F6 #wthree cablea igual', leer('src/js/features/wthree.js').includes("wireHoverMarquee(content, '.wthree-album-row')"));
igual('F7 ninguna tercera marquesina en ui/', readdirSync(join(RAIZ, 'src/js/ui')).filter((f) => /marquee|marquesina/i.test(f)).sort(), ['hover-marquee.js', 'marquee.js']);
const shaMain = createHash('sha256').update(readFileSync(join(RAIZ, 'src/css/main.css'))).digest('hex');
igual('F8 main.css no se tocó (sha256 de v=366)', shaMain, '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07');
const comp = leer('src/css/components.css');
const cuenta = (s, re) => (s.match(re) || []).length;
igual('F9 ningún @keyframes nuevo (components.css: 5 líneas, main.css: 18, como en v=366)', [cuenta(comp, /^.*@keyframes.*$/gm), cuenta(leer('src/css/main.css'), /^.*@keyframes.*$/gm)], [5, 18]);
igual('F10 ninguna prefers-reduced-motion nueva en components.css (6 líneas, como en v=366)', cuenta(comp, /^.*prefers-reduced-motion.*$/gm), 6);
const compSin = sinComentarios(comp);
comprobar('F11 el pill: 360 px de ancho a más de 768, con dos clases', /@media \(min-width: 769px\)\s*\{\s*\.preview-pill\.show\s*\{[^}]*\bwidth:\s*360px/.test(compSin));
comprobar('F12 la tarjeta: su alto fijo con dos clases (.sc-grid .sc-card…)', /\.sc-grid \.sc-card[^{,]*\{[^}]*\bheight:/.test(compSin));
comprobar('F13 nada de overflow: hidden sobre .sc-actions', !/\.sc-actions[^{]*\{[^}]*overflow:\s*hidden/.test(compSin));

console.log(`tamano-fijo-t130: ${ok} asserts OK · ${fallos} fallos (de ${ok + fallos})`);
process.exit(fallos ? 1 : 0);
