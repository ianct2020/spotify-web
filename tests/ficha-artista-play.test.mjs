// tests/ficha-artista-play.test.mjs — el ▶ por fila de «Tus 5 tracks más escuchados» (tanda 119, v=360).
//
// `features/artist-card.js` REAL en Node; todo lo demás de `src/js/` lo dobla `dobles/loader-t110.mjs`, y el DOM es
// `dobles/dom-t119-doble.mjs`. Artistas y temas INVENTADOS.
//
// Lo que se afirma:
//   A. cada fila tiene su `.ac-track-play`, un <button type="button"> con su `aria-label`;
//   B. tocarlo llama a `togglePreview` con una clave que NO empieza con `ac:`, y el preview se pide con `getPreview`, con
//      el artista de la ficha y sin `spotifyId` (0 a Spotify por el botón: con él, un tema sin preview abriría el embed);
//   C. el clic del ▶ no abre la ficha de canción, y el de la fila sí;
//   D. `previewchange` con esa clave: la fila en ⏸, las demás en ▶ y `#ac-preview` en «▶ Preview» (la trampa: el listener
//      de `#ac-preview` mira que la clave no empiece con `ac:`); con `playing: false`, ▶; con `ac:<artista>`, ninguna en ⏸;
//   E. sin preview (`togglePreview` da `null`): esa fila deshabilitada, con `title` y `aria-label` «Sin preview»;
//   F. con 2 temas, dos botones; con 1 (v=361), un botón, que suena, dice «Parar preview de…» y vuelve a ▶ al pararlo; con 0,
//      ninguno y el texto de siempre; las filas de stats.fm, también con ▶;
//   G. una ficha que se abre con su preview sonando nace en ⏸; dos fichas apiladas (dos `#ac-top-tracks`) se pintan las dos;
//   H. el CSS: en `components.css` con dos clases, nunca el atenuado, y `main.css` byte a byte.
//
// `T119_SRC` (env) apunta a otra copia de `src/`: los rojos contra `f6f4df1` y la copia de la trampa con la clave `ac:…`.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { instalarDom } from './dobles/dom-t119-doble.mjs';

const SRC = process.env.T119_SRC ? resolve(process.env.T119_SRC) : resolve(import.meta.dirname, '../src');
register('./dobles/loader-t110.mjs', pathToFileURL(import.meta.filename), { data: { reales: ['features/artist-card.js'] } });

// `sha256sum src/css/main.css` en v=363: lo único que cambió desde `f6f4df1` son las reglas del chip elegido de la tanda 120 y las de
// `.wr-ap-label` y `.wr-ap-fila.uno` de la tanda 122.
const SHA_MAIN_CSS = '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07';

let bien = 0, mal = 0;
const ok = (c, nombre) => { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; };
const tick = () => new Promise((r) => setTimeout(r, 15));

const doc = instalarDom();
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 0;
const ICONO = { play: '<svg data-icono="play"></svg>', pausa: '<svg data-icono="pausa"></svg>' };

const tema = (name, plays, id) => [name, plays, plays * 3, id];
const INDICE = {
  artists: {
    'Banda Cinco': [tema('Uno', 50, 'aaaaaaaaaaaaaaaaaaaaa1'), tema('Dos', 40, 'aaaaaaaaaaaaaaaaaaaaa2'), tema('Tres', 30, 'aaaaaaaaaaaaaaaaaaaaa3'), tema('Cuatro', 20, 'aaaaaaaaaaaaaaaaaaaaa4'), tema('Cinco', 10, 'aaaaaaaaaaaaaaaaaaaaa5')],
    'Dúo Dos': [tema('Sol', 9, 'bbbbbbbbbbbbbbbbbbbbb1'), tema('Luna', 8, 'bbbbbbbbbbbbbbbbbbbbb2')],
    'Otra Banda': [tema('Uno', 7, 'ccccccccccccccccccccc1')],
    'Solista Uno': [tema('Tema Único', 6, 'eeeeeeeeeeeeeeeeeeeee1')],
  },
  totals: {},
};
const STATS = {
  years: [{ year: 2024, top_artists: [], top_tracks: [] }],
  top_artists_all_time: [{ name: 'Sin Temas', min: 100, plays: 10 }, { name: 'De Statsfm', min: 100, plays: 10 }],
  top_tracks_all_time: [],
};

const toggles = [], previews = [], fichas = [];
const S = {
  respuesta: true,        // lo que devuelve `togglePreview`
  llamarGetter: true,
  sonando: null,          // `playingKey()`
  audio: false,           // `isPlayingAudio()`
  statsfm: false,
};
globalThis.__T110 = {
  valores: {},
  stubs: {
    isOwner: async () => true,
    loadHistoryStats: async () => STATS,
    loadArtistTracks: async () => INDICE,
    falloDeLecturaDelHistorial: () => null,
    avisoHistorialIlegibleHtml: () => '',
    escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    openModal: ({ html }) => { const o = doc.body.appendChild(doc.createElement('div')); o.innerHTML = html; return o; },
    firstArtistName: (x) => x,
    resolveArtistName: (x) => x,
    looksLikeArtistChain: () => false,
    artistNames: () => [],
    skelCardBody: () => '', skelBox: () => '', skelTrackRows: () => '',
    fmtDia: (s) => String(s),
    albumsDeArtista: async () => [],
    pedirYCachear: async () => null,
    hasUsername: () => S.statsfm,
    loadTopLifetime: async () => ({ map: new Map([
      ['1', { artist: 'De Statsfm', streams: 9, playedMs: 600000, name: 'Con id', sid: 'ddddddddddddddddddddd1' }],
      ['2', { artist: 'De Statsfm', streams: 8, playedMs: 600000, name: 'Sin id' }],
    ]) }),
    togglePreview: async (key, getter) => { toggles.push(key); if (S.llamarGetter) await getter(); return S.respuesta; },
    playingKey: () => S.sonando,
    isPlayingAudio: () => S.audio,
    getPreview: async (a) => { previews.push(a); return null; },
    getArtistLikePreview: async () => null,
    iconoPlay: () => ICONO.play,
    iconoPausa: () => ICONO.pausa,
    openTrackCard: (a) => { fichas.push(a); },
  },
};

const { openArtistCard } = await import(pathToFileURL(`${SRC}/js/features/artist-card.js`).href);
const abrir = async (name) => { doc.body.hijos = []; await openArtistCard({ name }); await tick(); };
const filas = () => doc.querySelectorAll('#ac-top-tracks .wrapped-top-row');
const botones = () => doc.querySelectorAll('#ac-top-tracks .ac-track-play');
const enPausa = (b) => b.innerHTML.includes('data-icono="pausa"');
const evento = (detail) => doc.dispatchEvent({ type: 'previewchange', detail });
const previewBtn = () => doc.getElementById('ac-preview');

console.log('A. un botón por fila');
await abrir('Banda Cinco');
ok(filas().length === 5, 'siguen las 5 filas');
ok(filas().every((f) => f.querySelectorAll('.ac-track-play').length === 1), 'cada fila tiene su .ac-track-play');
ok(botones().every((b) => b.tag === 'button' && b.getAttribute('type') === 'button'), 'son <button type="button">');
ok(botones()[1]?.getAttribute('aria-label') === 'Escuchar preview de Dos', 'aria-label «Escuchar preview de <tema>»');
ok(botones()[1]?.getAttribute('title') === 'Preview de 30 s — no suma reproducciones', 'en reposo, el title de #recs');
ok(!doc.querySelector('#ac-top-tracks .wt-play-btn, #ac-top-tracks .sc-play, #ac-top-tracks .dcard-play'), 'ninguna clase de otro módulo');
ok(botones().every((b) => !enPausa(b)), 'todas nacen en ▶');

console.log('B y C. tocar el ▶');
botones()[1]?.click();
await tick();
const clave = toggles.at(-1);
ok(typeof clave === 'string' && !clave.startsWith('ac:'), `la clave no empieza con «ac:» (${clave})`);
ok(previews.at(-1)?.name === 'Dos', 'getPreview con el nombre del tema');
ok(JSON.stringify(previews.at(-1)?.artists) === '["Banda Cinco"]', 'getPreview con la lista de artistas');
ok(previews.at(-1) && !('spotifyId' in previews.at(-1) && previews.at(-1).spotifyId), 'getPreview sin spotifyId: 0 a Spotify por el botón');
ok(fichas.length === 0, 'el clic del ▶ no abre la ficha de canción');
filas()[1]?.click();
ok(fichas.length === 1 && fichas[0].name === 'Dos', 'el clic en la fila sí la abre');
const clave0 = (botones()[0]?.click(), await tick(), toggles.at(-1));
ok(clave0 !== clave, 'cada fila tiene su clave');

console.log('D. el estado');
previewBtn().textContent = '⏹ Parar';
evento({ key: clave, provider: 'itunes', playing: true });
ok(enPausa(botones()[1] || { innerHTML: '' }), 'la fila que suena, en ⏸');
ok(botones().filter(enPausa).length === 1, 'las demás, en ▶');
ok(botones()[1]?.getAttribute('aria-label') === 'Parar preview de Dos', `sonando, aria-label «Parar preview de <tema>» (dice «${botones()[1]?.getAttribute('aria-label')}»)`);
ok(botones()[1]?.getAttribute('title') === 'Parar el preview', 'sonando, title «Parar el preview»');
ok(enPausa(botones()[1] || { innerHTML: '' }), 'y el ícono sigue siendo iconoPausa, el de todas las vistas que paran');
ok(previewBtn().textContent === '▶ Preview', '#ac-preview vuelve a «▶ Preview» al sonar una fila');
evento({ key: clave, provider: 'itunes', playing: false });
ok(botones().length === 5 && botones().filter(enPausa).length === 0, 'en pausa (playing: false), ▶');
ok(botones()[1]?.getAttribute('aria-label') === 'Escuchar preview de Dos', 'y el aria-label vuelve');
ok(botones()[1]?.getAttribute('title') === 'Preview de 30 s — no suma reproducciones', 'y el title vuelve');
evento({ key: clave, provider: 'itunes', playing: true });
evento({ key: clave0, provider: 'itunes', playing: true });
ok(botones().length === 5 && enPausa(botones()[0]) && !enPausa(botones()[1]), 'otra fila: el ⏸ se muda');
evento({ key: 'ac:Banda Cinco', provider: 'itunes', playing: true });
ok(botones().length === 5 && botones().filter(enPausa).length === 0, 'suena el del artista: ninguna fila en ⏸');
evento({ key: null, provider: null, playing: false });
ok(botones().length === 5 && botones().filter(enPausa).length === 0, 'parado: ninguna en ⏸');

console.log('E. sin preview');
S.respuesta = null;
botones()[3]?.click();
await tick();
S.respuesta = true;
const sin = botones()[3];
ok(sin?.disabled === true, 'esa fila queda deshabilitada');
ok(sin?.title === 'Sin preview' && sin?.getAttribute('aria-label') === 'Sin preview', 'con title y aria-label «Sin preview»');
ok(botones().filter((b) => b.disabled).length === 1, 'las demás no');
evento({ key: null, provider: null, playing: false });
ok(sin?.disabled === true && sin?.getAttribute('aria-label') === 'Sin preview', 'un previewchange no la rehabilita ni le pisa el texto');

console.log('F. menos de 5 filas, y ninguna');
await abrir('Dúo Dos');
ok(filas().length === 2 && botones().length === 2, 'con 2 temas, dos botones');
await abrir('Solista Uno');
ok(filas().length === 1 && botones().length === 1, 'con 1 tema, un botón');
ok(botones()[0]?.getAttribute('aria-label') === 'Escuchar preview de Tema Único', 'con 1 tema, nace en «Escuchar preview de…»');
botones()[0]?.click();
await tick();
const claveUnica = toggles.at(-1);
ok(previews.at(-1)?.name === 'Tema Único', 'con 1 tema, suena ese tema');
evento({ key: claveUnica, provider: 'itunes', playing: true });
ok(enPausa(botones()[0] || { innerHTML: '' }), 'con 1 tema, la fila en ⏸');
ok(botones()[0]?.getAttribute('aria-label') === 'Parar preview de Tema Único', `con 1 tema, aria-label «Parar preview de…» (dice «${botones()[0]?.getAttribute('aria-label')}»)`);
evento({ key: claveUnica, provider: 'itunes', playing: false });
ok(!enPausa(botones()[0] || { innerHTML: '<svg data-icono="pausa">' }), 'con 1 tema, al pararlo vuelve a ▶');
ok(botones()[0]?.getAttribute('aria-label') === 'Escuchar preview de Tema Único', 'con 1 tema, al pararlo vuelve el «Escuchar preview de…»');
await abrir('Sin Temas');
ok(botones().length === 0, 'con 0, ningún botón');
ok(doc.querySelector('#ac-top-tracks')?.textContent.includes('Sin tracks puntuales'), 'y el texto de siempre');
S.statsfm = true;
await abrir('De Statsfm');
await tick();
ok(filas().length === 2 && botones().length === 2, 'las filas de stats.fm también llevan ▶');
ok(botones()[1]?.getAttribute('aria-label') === 'Escuchar preview de Sin id', 'también la que no tiene id');
const c0 = toggles.length;
botones()[1]?.click();
await tick();
ok(toggles.length === c0 + 1 && !String(toggles.at(-1)).startsWith('ac:'), 'y suenan por el mismo camino');
ok(fichas.length === 1, 'sin abrir la ficha de canción');
S.statsfm = false;

console.log('G. al abrir, y apiladas');
await abrir('Dúo Dos');
botones()[0]?.click();
await tick();
const claveSol = toggles.at(-1);
S.sonando = claveSol; S.audio = true;
await abrir('Dúo Dos');
ok(botones().length === 2 && enPausa(botones()[0]) && !enPausa(botones()[1]), 'con su preview sonando, la fila nace en ⏸');
S.sonando = null; S.audio = false;
await abrir('Banda Cinco');
botones()[0]?.click();
await tick();
const claveUno = toggles.at(-1);
await openArtistCard({ name: 'Otra Banda' });
await tick();
ok(botones().length === 6, 'dos fichas apiladas: se ven los botones de las dos');
evento({ key: claveUno, provider: 'itunes', playing: true });
ok(enPausa(botones()[0] || { innerHTML: '' }), 'pinta la de abajo');
ok(botones().length === 6 && !enPausa(botones()[5]), 'y el mismo nombre en otro artista no se confunde');

console.log('H. el CSS');
const css = readFileSync(`${SRC}/css/components.css`, 'utf8');
const reglas = [...css.matchAll(/([^{}]*\.ac-track-play[^{}]*)\{([^}]*)\}/g)];
ok(reglas.length > 0, 'hay reglas de .ac-track-play en components.css');
ok(reglas.every((m) => m[1].split(',').every((s) => /\.ac-col-tracks\s+\.ac-track-play/.test(s))), 'todas con dos clases');
ok(reglas.length > 0 && reglas.every((m) => !m[2].includes('--color-text-muted')), 'ninguna con el atenuado');
const shaMain = createHash('sha256').update(readFileSync(`${SRC}/css/main.css`)).digest('hex');
ok(shaMain === SHA_MAIN_CSS, 'main.css, byte a byte');

console.log(mal ? `${mal} fallos de ${bien + mal}` : `OK — ${bien} asserts`);
process.exit(mal ? 1 : 0);
