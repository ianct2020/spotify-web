// tests/preview-siguiente-t136.test.mjs — tanda 136 (v=373): con la ficha de un álbum abierta y un preview suyo sonando, la tecla de
// medios «siguiente» y el botón «adelante» del mouse hacen sonar el preview de la pista siguiente de ESE álbum.
//
// La regla: «siguiente» es LO MISMO que apretar el ▶ de la fila siguiente de la ficha. Ni más, ni menos.
//
// Se prueban REALES, en Node: `ui/preview-player.js`, `features/album-card.js`, `ui/icons.js`, `ui/hover-marquee.js` y lo que la
// ficha necesita para pintar las filas (`util/likes-de-la-obra.js` y lo que importa, `util/cache-solo-exitos.js`). El resto de `src/js/`
// lo dobla `dobles/loader-t110.mjs` (sin tocar). Los vecinos del player (`components.js`, `toast.js`, `bottom-layer.js`, `reveal.js`)
// los contestan las funciones de `dobles/preview-t115-doble.mjs`, y el DOM y el `<audio>` son `dobles/dom-preview-doble.mjs` (ganó
// `dataset` y los selectores `#id`, sin cambiar lo que ya hacía). `loader-t115.mjs` no se usa: cambia `components.js` para CUALQUIER
// importador, y la ficha necesita `confirmModal` de ahí.
//
// `RAIZ_T136` (env) apunta a otra raíz con la forma del repo (con `src/` adentro): el rojo contra 2553389. Por defecto, este repo.
//
// Datos INVENTADOS: «Disco Siguiente Inventado», 5 pistas, la 3.ª sin preview (iTunes ni Deezer). Y «Disco Embed Inventado», 2 pistas,
// la 2.ª solo con el embed de Spotify.
//
// Lo esperado, escrito ANTES de correrlo:
//   1. Suena la 1.ª y llega `nexttrack` → suena la 2.ª, con su clave `alb:`; `previewchange` la dice sonando.
//   2. Desde la 2.ª, «siguiente» salta la 3.ª (sin preview) y suena la 4.ª. La 3.ª queda con «Sin preview».
//   3. En la última, «siguiente» no hace nada: ni vuelve a la 1.ª ni tira.
//   4. La misma pulsación por `mediaSession` y por `keydown MediaTrackNext` → UNA sola «siguiente».
//   5. `mouseup` + `auxclick` con `button === 4` del mismo clic → UNA sola «siguiente», con `defaultPrevented` en `true`.
//   6. Sin cola (no sonó nada de la ficha, o sonó algo de otra vista): el botón 4 no queda `defaultPrevented` y no suena nada;
//      `mediaSession` no tiene handler de `nexttrack`.
//   7. `button === 3`, con cola y sin cola: nunca `defaultPrevented` y nunca suena nada.
//   8. Cerrar la ficha (`modalstackempty`) → la cola se va, y el handler de `nexttrack` queda en `null`.
//   9. En pausa (`pausadoPorUsuario`) → «siguiente» pasa a la siguiente.
//  10. Después de `ended` con la ficha abierta → «siguiente» suena la siguiente.
//  11. La siguiente cae al embed → se abre el embed y la cola se corta.
//  12. Sin `navigator.mediaSession` → nada tira, y el mouse y el teclado andan igual.
//  13. Conservación: `preview-player-t115` y `tamano-fijo-t130` verdes sin tocarlos; un click en un ▶ hace lo mismo que en v=372;
//      0 `fetch` (a Spotify ni a nadie).
//  14. Lecturas estáticas: `nexttrack`, `MediaTrackNext`, `auxclick` y `button === 4` viven en UN solo archivo; ninguna otra vista
//      registra cola; `main.css` y `components.css` igual byte a byte.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REPO = resolve(import.meta.dirname, '..');
const RAIZ = process.env.RAIZ_T136 ? resolve(process.env.RAIZ_T136) : REPO;
const url = (p) => pathToFileURL(resolve(RAIZ, 'src', p)).href;
const sha = (s) => createHash('sha256').update(s).digest('hex');

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const asentar = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// ── El reloj de las pulsaciones (Date.now): cada pulsación nueva, un segundo después de la anterior ──
let reloj = 1_800_000_000_000;
Date.now = () => reloj;
const otraPulsacion = () => { reloj += 1000; };

// ── El DOM, el <audio> y los vecinos del player ──
const { instalar, AudioDoble } = await import('./dobles/dom-preview-doble.mjs');
const t115 = await import('./dobles/preview-t115-doble.mjs');
const { body } = instalar();
globalThis.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
const eventos = [];
document.addEventListener('previewchange', (e) => eventos.push(e.detail));

// `navigator.mediaSession` de mentira: anota cada `setActionHandler`.
function mediaSessionDoble() {
  const ms = { handlers: {}, llamadas: [] };
  ms.setActionHandler = (accion, fn) => { ms.llamadas.push([accion, typeof fn === 'function']); ms.handlers[accion] = fn; };
  return ms;
}
let ms = mediaSessionDoble();
const ponerNavigator = (v) => Object.defineProperty(globalThis, 'navigator', { value: v, configurable: true, writable: true });
ponerNavigator({ mediaSession: ms });

// Ningún `fetch`: todo lo de red está doblado. Si algo pide, queda anotado.
const fetches = [];
globalThis.fetch = async (u) => { fetches.push(String(u)); throw new Error('test t136: sin red'); };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
console.warn = () => {};
console.info = () => {};

// ── Los datos inventados ──
const ARTISTA = 'Banda Siguiente Inventada';
const id22 = (p, i) => (p + String(i).padStart(3, '0')).padEnd(22, 'x').slice(0, 22);
const DISCO = { id: id22('discoSigInv', 1), name: 'Disco Siguiente Inventado' };
const TEMAS = ['Uno Siguiente Inventado', 'Dos Siguiente Inventado', 'Tres Sin Preview Inventado', 'Cuatro Siguiente Inventado', 'Cinco Siguiente Inventado'];
const EMBED = { id: id22('discoEmbedInv', 2), name: 'Disco Embed Inventado' };
const TEMAS_EMBED = ['Primero Con Audio Inventado', 'Segundo Solo Embed Inventado'];
const TRACKLISTS = {
  [DISCO.id]: TEMAS.map((n, i) => ({ id: id22('pistaSig', i + 1), name: n, track_number: i + 1, disc_number: 1 })),
  [EMBED.id]: TEMAS_EMBED.map((n, i) => ({ id: id22('pistaEmb', i + 1), name: n, track_number: i + 1, disc_number: 1 })),
};
const ID = TRACKLISTS[DISCO.id].map((t) => t.id);
const IDE = TRACKLISTS[EMBED.id].map((t) => t.id);

const pedidosPreview = [];
const pedidosTracklist = [];
let modalAbierto = null;   // { overlay, onClose }
globalThis.__T110 = {
  valores: { 'features/history-data.js:AVISO_HISTORIAL_ILEGIBLE': 'aviso' },
  stubs: {
    'ui/components.js:escapeHtml': t115.escapeHtml,
    'ui/toast.js:showToast': t115.showToast,
    'ui/bottom-layer.js:mountBottom': t115.mountBottom,
    'ui/reveal.js:animationsEnabled': t115.animationsEnabled,
    'api.js:getBestAvailableLikes': async () => ({ items: [], source: 'full' }),
    'api.js:getAlbumTracks': async (id) => { pedidosTracklist.push(id); return (TRACKLISTS[id] || []).map((t) => ({ ...t, artists: [{ name: ARTISTA }] })); },
    'ui/modal-stack.js:openModal': ({ html, onClose }) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay ms-overlay';
      overlay.innerHTML = html;
      body.appendChild(overlay);
      modalAbierto = { overlay, onClose };
      return overlay;
    },
    'ui/skeleton.js:skelTracklist': () => '<div class="skel"></div>',
    'util/artist-name.js:firstArtistName': (s) => s,
    'util/artist-name.js:resolveArtistName': (s) => s,
    'util/album-stats.js:lookupAlbumStats': async () => ({}),
    'util/album-resolver.js:resolveAlbumId': async () => ({ id: null, motivo: 'doble t136' }),
    'features/history-data.js:falloDeLecturaDelHistorial': () => null,
    // La cadena de proveedores: la 3.ª pista no está en ninguno; la 2.ª del disco del embed solo tiene el embed.
    'api/preview-providers.js:getPreview': async (q) => {
      pedidosPreview.push(q.name);
      if (q.name === TEMAS[2]) return null;
      if (q.name === TEMAS_EMBED[1]) return { type: 'embed', url: `https://open.spotify.com/embed/track/${q.spotifyId}`, label: q.name, provider: 'spotify-embed' };
      return { type: 'audio', url: `/inventado/${encodeURIComponent(q.name)}.m4a`, label: q.name, provider: 'itunes' };
    },
  },
};

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/ui/preview-player.js', '/js/ui/icons.js', '/js/ui/hover-marquee.js', '/js/features/album-card.js',
    '/js/util/likes-de-la-obra.js', '/js/util/album-key.js', '/js/util/edition-suffix.js', '/js/util/track-match.js',
    '/js/util/song-identity.js', '/js/util/versions-guard.js', '/js/util/cache-solo-exitos.js'] },
});
console.log(`raíz bajo prueba: ${RAIZ}`);
const player = await import(url('js/ui/preview-player.js'));
const ac = await import(url('js/features/album-card.js'));
const audio = AudioDoble.instancias[0];

// ── Ayudas ──
async function abrirFicha(d = DISCO) {
  if (typeof ac._clearAlbumCardLikesCache === 'function') ac._clearAlbumCardLikesCache();
  ac.openAlbumCard({ name: d.name, artist: ARTISTA, albumId: d.id });
  await asentar();
  return modalAbierto.overlay;
}
function cerrarFicha() {
  if (!modalAbierto) return;
  const { overlay, onClose } = modalAbierto;
  modalAbierto = null;
  try { onClose?.(); } catch { /* como modal-stack */ }
  overlay.remove();
  document.dispatchEvent(new CustomEvent('modalstackempty'));
}
const botones = () => (modalAbierto ? modalAbierto.overlay.querySelectorAll('.album-modal-like-play') : []);
const conPausa = (b) => b.innerHTML.includes('<rect') || /pausa/i.test(b.innerHTML);
const enPausaSolo = (i) => botones().every((b, j) => (j === i ? conPausa(b) : !conPausa(b)));
const pill = () => body.querySelector('.preview-pill');
const etiqueta = () => pill()?.querySelector('.preview-pill-label')?.textContent || '';
async function tocar(i) { botones()[i].click(); await asentar(); }
async function medios() { otraPulsacion(); const h = ms.handlers.nexttrack; let tiro = null; try { h?.({ action: 'nexttrack' }); } catch (e) { tiro = e; } await asentar(); return { habia: typeof h === 'function', tiro }; }
function evento(type, extra) { return { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; }
async function tecla({ nueva = true } = {}) { if (nueva) otraPulsacion(); const e = evento('keydown', { key: 'MediaTrackNext' }); document.dispatchEvent(e); await asentar(); return e; }
async function clicLateral(button) {
  otraPulsacion();
  const up = evento('mouseup', { button }), aux = evento('auxclick', { button });
  document.dispatchEvent(up); document.dispatchEvent(aux);
  await asentar();
  return [up, aux];
}
const clave = (i) => `alb:${ID[i]}`;

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Suena la 1.ª y llega `nexttrack` → la 2.ª');
await abrirFicha();
const tracklistAlAbrir1 = pedidosTracklist.length;
ok(botones().length === 5, `la ficha tiene 5 ▶ (${botones().length})`);
await tocar(0);
ok(player.playingKey() === clave(0), 'la 1.ª suena');
ok(typeof ms.handlers.nexttrack === 'function', 'con la 1.ª sonando, `mediaSession` tiene handler de `nexttrack`');
let r = await medios();
ok(player.playingKey() === clave(1), `«siguiente» → la clave es la de la 2.ª (${player.playingKey()})`);
ok(eventos.at(-1)?.key === clave(1) && eventos.at(-1)?.playing === true, '`previewchange` la dice sonando');
ok(etiqueta() === TEMAS[1], `el pill dice «${TEMAS[1]}» («${etiqueta()}»)`);
ok(enPausaSolo(1), 'el ⏸ está en la 2.ª fila y en ninguna otra');

console.log('\n[2] Desde la 2.ª, salta la 3.ª (sin preview) y suena la 4.ª');
const pedidos2 = pedidosPreview.length;
r = await medios();
ok(player.playingKey() === clave(3), `suena la 4.ª (${player.playingKey()})`);
ok(botones()[2].disabled === true && botones()[2].innerHTML.includes('Sin preview'), 'la 3.ª queda deshabilitada con «Sin preview»');
ok(JSON.stringify(pedidosPreview.slice(pedidos2)) === JSON.stringify([TEMAS[2], TEMAS[3]]), `se pidieron la 3.ª y la 4.ª, en ese orden (${pedidosPreview.slice(pedidos2).join(' | ')})`);
ok(etiqueta() === TEMAS[3] && enPausaSolo(3), 'el pill y el ⏸ en la 4.ª');

console.log('\n[3] En la última, «siguiente» no hace nada');
await medios();
ok(player.playingKey() === clave(4), 'de la 4.ª a la 5.ª');
const pedidos3 = pedidosPreview.length;
r = await medios();
ok(!r.tiro, 'en la 5.ª, «siguiente» no tira');
ok(player.playingKey() === clave(4) && pedidosPreview.length === pedidos3, 'sigue la 5.ª y no se pidió nada (no vuelve a la 1.ª)');
const tracklistTras3 = pedidosTracklist.length;
cerrarFicha();

console.log('\n[4] La misma pulsación por `mediaSession` y por `keydown MediaTrackNext` → UNA «siguiente»');
await abrirFicha();
await tocar(0);
otraPulsacion();
ms.handlers.nexttrack?.({ action: 'nexttrack' });
await tecla({ nueva: false });
ok(player.playingKey() === clave(1), `suena la 2.ª, no la 4.ª (${player.playingKey()})`);
const tec = await tecla();
ok(player.playingKey() === clave(3), `una tecla sola, después, sí avanza (salta la 3.ª): ${player.playingKey()}`);
void tec;
cerrarFicha();

console.log('\n[5] `mouseup` + `auxclick` con `button === 4` del mismo clic → UNA «siguiente»');
await abrirFicha();
await tocar(0);
let [up, aux] = await clicLateral(4);
ok(player.playingKey() === clave(1), `suena la 2.ª, no la 4.ª (${player.playingKey()})`);
ok(up.defaultPrevented === true && aux.defaultPrevented === true, `los dos con \`defaultPrevented\` (mouseup ${up.defaultPrevented}, auxclick ${aux.defaultPrevented})`);
cerrarFicha();

console.log('\n[6] Sin cola');
await abrirFicha();
const pedidos6 = pedidosPreview.length;
[up, aux] = await clicLateral(4);
ok(!up.defaultPrevented && !aux.defaultPrevented, 'ficha abierta sin nada sonado: el botón 4 no queda `defaultPrevented`');
ok(player.playingKey() === null && pedidosPreview.length === pedidos6, 'y no suena nada');
ok(typeof ms.handlers.nexttrack !== 'function', '`mediaSession` sin handler de `nexttrack`');
await tocar(0);
ok(typeof ms.handlers.nexttrack === 'function', '(con la 1.ª de la ficha sonando sí hay handler)');
await player.togglePreview('zp:otraVistaInventada', async () => ({ type: 'audio', url: '/inventado/otra.m4a', label: 'Otra Vista Inventada', provider: 'itunes' }));
await asentar();
ok(player.playingKey() === 'zp:otraVistaInventada', 'sonó algo de otra vista');
ok(typeof ms.handlers.nexttrack !== 'function', 'la cola se fue: `mediaSession` sin handler de `nexttrack`');
const pedidos6b = pedidosPreview.length;
[up, aux] = await clicLateral(4);
ok(!up.defaultPrevented && !aux.defaultPrevented, 'el botón 4 no queda `defaultPrevented`');
await tecla();
ok(player.playingKey() === 'zp:otraVistaInventada' && pedidosPreview.length === pedidos6b, 'ni el botón 4 ni la tecla hacen sonar nada de la ficha');
player.stopPreview();
cerrarFicha();

console.log('\n[7] `button === 3`, con cola y sin cola: nunca');
await abrirFicha();
const pedidos7 = pedidosPreview.length;
[up, aux] = await clicLateral(3);
ok(!up.defaultPrevented && !aux.defaultPrevented && player.playingKey() === null && pedidosPreview.length === pedidos7, 'sin cola: ni `defaultPrevented` ni suena nada');
await tocar(0);
const pedidos7b = pedidosPreview.length;
[up, aux] = await clicLateral(3);
ok(!up.defaultPrevented && !aux.defaultPrevented, 'con cola: no queda `defaultPrevented`');
ok(player.playingKey() === clave(0) && pedidosPreview.length === pedidos7b, 'con cola: sigue la 1.ª y no se pidió nada');

console.log('\n[8] Cerrar la ficha → la cola se va');
ok(typeof ms.handlers.nexttrack === 'function', '(con cola, hay handler)');
cerrarFicha();
ok(ms.handlers.nexttrack === null, `el handler de \`nexttrack\` queda en \`null\` (${ms.handlers.nexttrack})`);
const ultimaNull = ms.llamadas.filter(([a]) => a === 'nexttrack').at(-1);
ok(ultimaNull && ultimaNull[1] === false, 'la última llamada a `setActionHandler(\'nexttrack\', …)` fue con `null`');
[up, aux] = await clicLateral(4);
ok(!up.defaultPrevented && player.playingKey() === null, 'y el botón 4 ya no se toca');

console.log('\n[9] En pausa → «siguiente» pasa a la siguiente');
await abrirFicha();
await tocar(0);
pill().querySelector('.preview-pill-toggle').click();
await asentar();
ok(audio.paused === true && player.playingKey() === clave(0), '(la 1.ª en pausa)');
await medios();
ok(player.playingKey() === clave(1) && audio.paused === false, `suena la 2.ª (${player.playingKey()})`);
cerrarFicha();

console.log('\n[10] Después de `ended`, con la ficha abierta → la siguiente');
await abrirFicha();
await tocar(0);
audio.emitir('ended');
await asentar();
ok(player.playingKey() === null, '(la 1.ª terminó sola: nada suena)');
await medios();
ok(player.playingKey() === clave(1), `«siguiente» suena la 2.ª (${player.playingKey()})`);
cerrarFicha();

console.log('\n[11] La siguiente cae al embed → se abre y la cola se corta');
await abrirFicha(EMBED);
await tocar(0);
ok(player.playingKey() === `alb:${IDE[0]}`, '(suena la 1.ª del disco del embed)');
await medios();
ok(player.playingKey() === `alb:${IDE[1]}` && player.playingProvider() === 'spotify-embed', 'se abrió el embed de la 2.ª');
ok(!!pill()?.querySelector('.preview-pill-embed')?.querySelector('iframe'), 'el pill tiene el iframe');
ok(typeof ms.handlers.nexttrack !== 'function', 'la cola se cortó: sin handler de `nexttrack`');
[up, aux] = await clicLateral(4);
ok(!up.defaultPrevented, 'el botón 4 ya no se toca');
player.stopPreview();
cerrarFicha();

console.log('\n[12] Sin `navigator.mediaSession`');
ponerNavigator({});
let tiro12 = null;
try {
  await abrirFicha();
  await tocar(0);
  await tecla();
  ok(player.playingKey() === clave(1), `el teclado: suena la 2.ª (${player.playingKey()})`);
  [up, aux] = await clicLateral(4);
  ok(player.playingKey() === clave(3) && up.defaultPrevented, `el mouse: salta la 3.ª y suena la 4.ª (${player.playingKey()})`);
  cerrarFicha();
} catch (e) { tiro12 = e; }
ok(!tiro12, `nada tiró${tiro12 ? ` (${tiro12.message})` : ''}`);
ponerNavigator({ mediaSession: ms });

console.log('\n[13] Conservación');
await abrirFicha();
await tocar(1);
ok(player.playingKey() === clave(1) && etiqueta() === TEMAS[1] && enPausaSolo(1), 'un click en el ▶: suena, el pill dice el nombre, ⏸ en esa fila');
await tocar(1);
ok(player.playingKey() === null && botones().every((b) => !conPausa(b)), 'el mismo ▶ otra vez: para (todas en ▶)');
await tocar(2);
ok(botones()[2].disabled === true && botones()[2].innerHTML.includes('Sin preview') && player.playingKey() === null, 'el ▶ de una sin preview: «Sin preview» y deshabilitada');
cerrarFicha();
ok(fetches.length === 0, `0 \`fetch\` en todo el test (${fetches.length})`);
ok(tracklistAlAbrir1 >= 1 && tracklistTras3 === tracklistAlAbrir1, `«siguiente» no pide el tracklist (al abrir la ficha 1: ${tracklistAlAbrir1}; después de tres «siguiente»: ${tracklistTras3})`);
for (const [suite, env] of [['preview-player-t115.test.mjs', 'RAIZ_T115'], ['tamano-fijo-t130.test.mjs', 'RAIZ_T130']]) {
  const p = spawnSync(process.execPath, [join(REPO, 'tests', suite)], { env: { ...process.env, [env]: RAIZ }, encoding: 'utf8', timeout: 120000 });
  const cola = (p.stdout + p.stderr).trim().split('\n').at(-1);
  ok(p.status === 0, `${suite} contra esta raíz, sin tocarlo: verde (${cola})`);
}

console.log('\n[14] Lecturas estáticas');
const JS = join(RAIZ, 'src', 'js');
const archivos = [];
(function rec(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) rec(p); else if (f.endsWith('.js')) archivos.push(p); } })(JS);
const corto = (p) => p.slice(JS.length + 1);
const conTexto = (re) => archivos.filter((p) => re.test(readFileSync(p, 'utf8'))).map(corto).sort();
for (const [nombre, re] of [['nexttrack', /['"]nexttrack['"]/], ['MediaTrackNext', /MediaTrackNext/], ['auxclick', /['"]auxclick['"]/], ['button === 4', /button\s*===\s*4/]]) {
  const donde = conTexto(re);
  ok(JSON.stringify(donde) === JSON.stringify(['ui/preview-player.js']), `\`${nombre}\` solo en ui/preview-player.js (${donde.join(', ') || 'ninguno'})`);
}
const conMedios = conTexto(/mediaSession|addEventListener\(\s*['"](?:mouseup|auxclick)['"]/);
ok(JSON.stringify(conMedios) === JSON.stringify(['ui/preview-player.js']), `los listeners de \`mediaSession\`, \`mouseup\` y \`auxclick\` en UN archivo (${conMedios.join(', ') || 'ninguno'})`);
const registran = conTexto(/['"]previewcola['"]/);
ok(JSON.stringify(registran) === JSON.stringify(['features/album-card.js', 'ui/preview-player.js']), `la cola la registra solo la ficha de álbum (${registran.join(', ') || 'nadie'})`);
ok(!/button\s*===\s*3/.test(readFileSync(join(JS, 'ui/preview-player.js'), 'utf8')), 'el botón 3 no aparece en el player');
ok(sha(readFileSync(join(RAIZ, 'src/css/main.css'))) === '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07', '`main.css` byte a byte igual que en 2553389');
// (tanda 137, con el OK de Ian del 20/11) El hash es el de `components.css` de v=374: la 137 le agregó las reglas de la barra del pill.
ok(sha(readFileSync(join(RAIZ, 'src/css/components.css'))) === '16a3c38db2963c845f8da40c919c0774dbb2dacedaf8f87a5648dada59412f88', '`components.css` byte a byte igual que en v=374 (la 137 le sumó la barra)');
const nExports = Object.keys(player).length;
ok(nExports === 8, `el player sigue exportando ocho cosas (${nExports})`);

console.log(`\n${bien + mal} asserts: ${bien} OK, ${mal} fallos`);
process.exit(mal ? 1 : 0);
