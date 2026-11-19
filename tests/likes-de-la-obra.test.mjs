// tests/likes-de-la-obra.test.mjs — tanda 134 (v=371): la ficha de álbum y la tarjeta de #listened cuentan tus me gusta con UNA regla.
//
// Hasta v=370 la ficha (`features/album-card.js`: `likesInAlbum` + `trackNameKey`) y la tarjeta (`features/listened.js`: `attachLikes`)
// contaban el mismo número con dos reglas, y Ian veía «0 de N pistas en tus me gusta» en la ficha y «♥ K» en la tarjeta del mismo disco.
// Desde v=371 las dos usan `util/likes-de-la-obra.js`.
//
// Los módulos REALES: `album-card.js`, `listened.js`, `listened-shared.js`, la regla y lo que ella importa (`album-key.js`,
// `edition-suffix.js`, `track-match.js`, `song-identity.js`, `versions-guard.js`) y `cache-solo-exitos.js`. El resto de `src/js/` lo dobla
// `tests/dobles/loader-t110.mjs` (sin tocar). Datos INVENTADOS. `RAIZ_T134` apunta a otra copia de `src/` (el rojo contra 970d486): lo que
// allá no existe (la regla, `_attachLikes`) cuenta como assert en rojo, no como un error del test.
//
// Los números esperados de cada caso están escritos ANTES de correrlo.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const REPO = resolve(import.meta.dirname, '..');
const RAIZ_SRC = process.env.RAIZ_T134 ? resolve(process.env.RAIZ_T134) : resolve(REPO, 'src');
const url = (p) => pathToFileURL(resolve(RAIZ_SRC, p)).href;
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const BASE = '970d486';

let bien = 0, mal = 0;
function ok(c, nombre) { console.log(`  ${c ? '✓' : '✗'} ${nombre}`); c ? bien++ : mal++; }
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Los dobles ───────────────────────────────────────────────────────────────
const estado = { likes: [], source: 'full', tracklists: {} };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function elemento() { return { innerHTML: '', textContent: '', style: {}, onclick: null, dataset: {}, querySelector: () => null, querySelectorAll: () => [] }; }
let overlay = null;
function nuevoOverlay(html) {
  const els = new Map();
  return { html, isConnected: true, els,
    querySelector: (sel) => { if (sel.startsWith('[data-alb-accion')) return null; if (!els.has(sel)) els.set(sel, elemento()); return els.get(sel); },
    querySelectorAll: () => [] };
}
globalThis.__T110 = {
  valores: {},
  stubs: {
    // Como la API real: con la caché fría, `items: []` y `source: 'empty'`.
    'api.js:getBestAvailableLikes': async () => (estado.source === 'full' ? { items: estado.likes, source: 'full' } : { items: [], source: 'empty' }),
    'api.js:getAlbumTracks': async (id) => (estado.tracklists[id] || []).map((t) => ({ ...t, artists: [{ name: t.artista || ARTISTA }] })),
    'ui/components.js:escapeHtml': esc,
    'ui/modal-stack.js:openModal': ({ html }) => { overlay = nuevoOverlay(html); return overlay; },
    'ui/skeleton.js:skelTracklist': () => '<div class="skel"></div>',
    'util/artist-name.js:firstArtistName': (s) => s,
    'util/artist-name.js:resolveArtistName': (s) => s,
    'util/album-stats.js:lookupAlbumStats': async () => ({}),
    'util/album-resolver.js:resolveAlbumId': async () => ({ id: null, motivo: 'doble t134: sin resolver' }),
    'features/history-data.js:falloDeLecturaDelHistorial': () => null,
    'ui/preview-player.js:playingKey': () => null,
  },
};
globalThis.window = globalThis.window || {};
globalThis.document = { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, documentElement: {} };
globalThis.requestAnimationFrame = () => 0;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
console.warn = () => {};
console.info = () => {};

register('./dobles/loader-t110.mjs', {
  parentURL: pathToFileURL(import.meta.filename),
  data: { reales: ['/js/features/album-card.js', '/js/features/listened.js', '/js/features/listened-shared.js', '/js/util/likes-de-la-obra.js',
    '/js/util/album-key.js', '/js/util/edition-suffix.js', '/js/util/track-match.js', '/js/util/song-identity.js', '/js/util/versions-guard.js',
    '/js/util/cache-solo-exitos.js'] },
});
console.log(`src bajo prueba: ${RAIZ_SRC}`);
const ac = await import(url('js/features/album-card.js'));
const li = await import(url('js/features/listened.js'));
let regla = null;
try { regla = await import(url('js/util/likes-de-la-obra.js')); } catch (e) { console.log(`  (la regla no se pudo cargar: ${e.code || e.message})`); }
const { baseDeEdicion } = await import(url('js/util/edition-suffix.js'));

// ── Los datos inventados ─────────────────────────────────────────────────────
const ARTISTA = 'Banda Prueba Inventada';
let contador = 0;
const nuevoId = (p) => `${p}${String(++contador).padStart(4, '0')}`.padEnd(22, 'x').slice(0, 22);
function disco(name, temas, { artista = ARTISTA } = {}) {
  const id = nuevoId('alb');
  const tracks = temas.map((n, i) => ({ id: nuevoId('trk'), name: n, track_number: i + 1, disc_number: 1, artista }));
  estado.tracklists[id] = tracks;
  return { id, name, artista, tracks };
}
function like(albumNombre, nombre, { albumId = nuevoId('lal'), id = nuevoId('lik'), artista = ARTISTA } = {}) {
  return { added_at: '2026-01-01T00:00:00Z', track: { id, uri: `spotify:track:${id}`, name: nombre, track_number: 1, artists: [{ name: artista }], album: { id: albumId, name: albumNombre, images: [], artists: [{ name: artista }] } } };
}

// La ficha: abre la ficha REAL y devuelve lo que pinta.
async function ficha(d, { conId = true } = {}) {
  ac._clearAlbumCardLikesCache();
  overlay = null;
  ac.openAlbumCard({ name: d.name, artist: d.artista, ...(conId ? { albumId: d.id } : {}) });
  await pausa(30);
  const html = overlay?.els.get('#alb-likes')?.innerHTML || '';
  const filas = html.split('album-modal-like-row').slice(1);
  const nombre = (f) => (f.match(/album-modal-like-name">([^<]*)</) || [])[1] || '';
  return {
    html,
    titulo: (html.match(/album-modal-likes-title">([^<]*)</) || [])[1] || '',
    linea: (html.match(/class="album-modal-otra-edicion">([^<]*)</) || [])[1] ?? null,
    conCorazon: filas.filter((f) => /class="album-modal-like-heart"/.test(f)).map(nombre),
    conBoton: filas.filter((f) => /class="album-modal-like-add"/.test(f)).map(nombre),
  };
}
// La tarjeta: el `attachLikes` REAL sobre un álbum registrado con la forma de `groupItemsByAlbum`.
async function tarjeta(d) {
  if (typeof li._attachLikes !== 'function') return null;
  const a = { id: d.id, name: d.name, artist: d.artista, cover: null, image: null, artistAlts: [d.artista], tracks: [{ name: d.tracks[0]?.name || '', artists: d.artista, uri: null }] };
  await li._attachLikes([a]);
  return a.likes.length;
}
// J de la línea («… y J más…» o «J canciones…»), 0 si no hay.
const jDeLinea = (l) => { if (!l) return 0; const m = l.match(/y (\d+) más/) || l.match(/^(\d+) canci/); return m ? +m[1] : 0; };
const nDeTitulo = (t) => +((t.match(/^(\d+) de/) || [])[1] ?? NaN);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] El de Ian, inventado: registrada «Disco Inventado»; likeadas 3 de su «(Deluxe Edition)», una bonus');
const c1 = disco('Disco Inventado', ['Tema Uno Inventado', 'Tema Dos Inventado', 'Tema Tres Inventado', 'Tema Cuatro Inventado', 'Tema Cinco Inventado', 'Tema Seis Inventado']);
const l1 = ['Tema Uno Inventado', 'Tema Dos Inventado', 'Tema Bonus Inventado (Bonus Track)'].map((n) => like('Disco Inventado (Deluxe Edition)', n));
estado.likes = [...l1];
{
  const f = await ficha(c1);
  ok(f.titulo === '2 de 6 pistas en tus me gusta', `la ficha: «2 de 6 pistas en tus me gusta» («${f.titulo}»)`);
  ok(JSON.stringify(f.conCorazon) === JSON.stringify(['Tema Uno Inventado', 'Tema Dos Inventado']), `♥ lleno en Uno y Dos (${f.conCorazon.join(' | ')})`);
  ok(f.linea === '2 de ellas están en otra edición y 1 más que este disco no tiene', `la línea («${f.linea}»)`);
  ok(f.conBoton.length === 4 && !f.conBoton.includes('Tema Uno Inventado') && !f.conBoton.includes('Tema Dos Inventado'), `«añadir» solo en las otras 4 (${f.conBoton.join(' | ')})`);
  const t = await tarjeta(c1);
  ok(t === 3, `la tarjeta: ♥ 3 (${t})`);
}

console.log('\n[2] La remasterizada: likeada «… - Remastered 2011» de «… (Remastered)»');
const c2 = disco('Disco Remaster Inventado', ['Tema Remaster Inventado', 'Otro Tema Remaster Inventado', 'Tercer Tema Remaster Inventado']);
estado.likes = [like('Disco Remaster Inventado (Remastered)', 'Tema Remaster Inventado - Remastered 2011')];
{
  const f = await ficha(c2);
  ok(f.titulo === '1 de 3 pistas en tus me gusta', `la ficha: «1 de 3» («${f.titulo}»)`);
  ok(JSON.stringify(f.conCorazon) === JSON.stringify(['Tema Remaster Inventado']), `«Tema Remaster Inventado» cuenta (${f.conCorazon.join(' | ')})`);
  ok(f.linea === '1 de ellas está en otra edición', `la línea, en singular («${f.linea}»)`);
  ok(await tarjeta(c2) === 1, 'la tarjeta: ♥ 1');
}

console.log('\n[3] «Deluxe» pegado: «Disco Pegado Inventado Deluxe» contra «Disco Pegado Inventado»');
const c3 = disco('Disco Pegado Inventado', ['Cancion Pegada Uno', 'Cancion Pegada Dos']);
estado.likes = [like('Disco Pegado Inventado Deluxe', 'Cancion Pegada Uno')];
{
  const f = await ficha(c3);
  ok(f.titulo === '1 de 2 pistas en tus me gusta', `la ficha: «1 de 2» («${f.titulo}»)`);
  ok(f.linea === '1 de ellas está en otra edición', `la línea («${f.linea}»)`);
  ok(await tarjeta(c3) === 1, 'la tarjeta: ♥ 1');
}

console.log('\n[4] Lo que NO cuenta: en vivo, acústico, remix y sped up no son «la misma canción»');
const c4 = disco('Disco Versiones Inventado', ['Tema Versionado Inventado', 'Relleno Versiones Inventado']);
estado.likes = ['Tema Versionado Inventado - Live', 'Tema Versionado Inventado (Acoustic)', 'Tema Versionado Inventado - DEVAULT Remix', 'Tema Versionado Inventado - Sped Up']
  .map((n) => like('Disco Versiones Inventado (Deluxe Edition)', n));
{
  const f = await ficha(c4);
  ok(f.titulo === '0 de 2 pistas en tus me gusta', `la ficha: «0 de 2» («${f.titulo}»)`);
  ok(f.conCorazon.length === 0, `ningún ♥ lleno (${f.conCorazon.join(' | ')})`);
  ok(f.linea === '4 canciones que te gustan de este disco no están en esta edición', `las 4 van a «este disco no las tiene» («${f.linea}»)`);
  ok(await tarjeta(c4) === 4, 'la tarjeta: ♥ 4 (cuatro canciones distintas)');
}
const c4b = disco('Disco Vivo Inventado', ['Tema Al Reves Inventado - Live', 'Relleno Vivo Inventado']);
estado.likes = [like('Disco Vivo Inventado (Deluxe Edition)', 'Tema Al Reves Inventado')];
{
  const f = await ficha(c4b);
  ok(f.titulo === '0 de 2 pistas en tus me gusta', `al revés: likeado el original, «… - Live» del tracklist no cuenta («${f.titulo}»)`);
  ok(f.linea === '1 canción que te gusta de este disco no está en esta edición', `la línea, solo J y en singular («${f.linea}»)`);
}
console.log('    y «Tema» con «Tema - Live» likeadas las dos, del mismo disco (la identidad lleva el marcador)');
const c4c = disco('Disco Ambos Inventado', ['Tema Ambos Inventado', 'Tema Ambos Inventado - Live', 'Relleno Ambos Inventado']);
estado.likes = [like(c4c.name, 'Tema Ambos Inventado', { albumId: c4c.id, id: c4c.tracks[0].id }), like('Disco Ambos Inventado (Deluxe Edition)', 'Tema Ambos Inventado - Live')];
{
  const f = await ficha(c4c);
  ok(f.titulo === '2 de 3 pistas en tus me gusta', `la ficha: «2 de 3» («${f.titulo}»)`);
  ok(f.linea === '1 de ellas está en otra edición', `la línea («${f.linea}»)`);
  ok(await tarjeta(c4c) === 2, 'la tarjeta: ♥ 2 (no las junta)');
}

console.log('\n[5] Conservación');
const c5 = disco('Disco Propio Inventado', ['Tema Propio Inventado', 'Dos Propio Inventado']);
estado.likes = [like(c5.name, 'Tema Propio Inventado', { albumId: c5.id, id: c5.tracks[0].id })];
{
  const f = await ficha(c5);
  ok(f.titulo === '1 de 2 pistas en tus me gusta' && f.linea === null, `un like del MISMO álbum por id: «1 de 2» y ninguna línea («${f.titulo}» · ${f.linea})`);
  ok(await tarjeta(c5) === 1, 'la tarjeta: ♥ 1');
}
const c5b = disco('Disco Vacio Inventado', ['Uno Vacio Inventado', 'Dos Vacio Inventado', 'Tres Vacio Inventado']);
estado.likes = [like('Disco Ajeno Del Todo', 'Tema Ajeno Del Todo', { artista: 'Banda Ajena Del Todo' })];
{
  const f = await ficha(c5b);
  ok(f.titulo === '0 de 3 pistas en tus me gusta' && f.linea === null, `un disco sin likes: «0 de 3» y ninguna línea («${f.titulo}» · ${f.linea})`);
  ok(await tarjeta(c5b) === 0, 'la tarjeta: sin ♥');
}
const c5c = disco('Disco Numerado Inventado', ['Tema Numerado Inventado', 'Otro Numerado Inventado']);
const c5d = disco('Disco Inventado (LP2)', ['Tema Lp Inventado', 'Otro Lp Inventado']);
estado.likes = [like('Disco Numerado Inventado II', 'Tema Numerado Inventado'), like('Disco Inventado (LP3)', 'Tema Lp Inventado')];
{
  const f = await ficha(c5c);
  ok(f.titulo === '0 de 2 pistas en tus me gusta' && f.linea === null, `«Disco … II» no se mezcla con «Disco …» («${f.titulo}» · ${f.linea})`);
  ok(await tarjeta(c5c) === 0, 'la tarjeta tampoco');
  const g = await ficha(c5d);
  ok(g.titulo === '0 de 2 pistas en tus me gusta' && g.linea === null, `«(LP3)» no se mezcla con «(LP2)» («${g.titulo}» · ${g.linea})`);
  ok(await tarjeta(c5d) === 0, 'la tarjeta tampoco');
}
for (const [t, que] of [['Disco Inventado (LP2)', '(LP2)'], ['Disco Inventado II', 'II'], ['÷', '÷'], ['Disco Inventado (Deluxe Edition)', '(Deluxe Edition), que sí se saca']]) {
  const b = baseDeEdicion(t);
  ok(que.includes('sí se saca') ? b === 'Disco Inventado' : b === t, `baseDeEdicion(«${t}») → «${b}» (${que})`);
}

console.log('\n[6] Otro artista: un disco del mismo nombre de otra banda no aporta');
const c6 = disco('Disco Homonimo Inventado', ['Tema Homonimo Inventado', 'Otro Homonimo Inventado']);
estado.likes = [
  like('Disco Homonimo Inventado (Deluxe Edition)', 'Tema Homonimo Inventado', { artista: 'Otra Banda Inventada' }),
  like('Disco Homonimo Inventado', 'Otro Homonimo Inventado', { artista: 'Otra Banda Inventada' }),
];
{
  const f = await ficha(c6);
  ok(f.titulo === '0 de 2 pistas en tus me gusta' && f.linea === null, `«0 de 2» y ninguna línea («${f.titulo}» · ${f.linea})`);
  ok(await tarjeta(c6) === 0, 'la tarjeta: sin ♥');
}

console.log('\n[7] Una canción likeada en dos ediciones cuenta UNA vez');
const c7 = disco('Disco Doble Inventado', ['Tema Doble Inventado', 'Resto Doble Inventado']);
estado.likes = [like(c7.name, 'Tema Doble Inventado', { albumId: c7.id, id: c7.tracks[0].id }), like('Disco Doble Inventado (Remastered)', 'Tema Doble Inventado - Remastered')];
{
  const f = await ficha(c7);
  ok(f.titulo === '1 de 2 pistas en tus me gusta' && f.linea === null, `la ficha: «1 de 2» y ninguna línea («${f.titulo}» · ${f.linea})`);
  ok(await tarjeta(c7) === 1, 'la tarjeta: ♥ 1');
}

console.log('\n[8] Sin tracklist y con la caché fría');
{
  const f = await ficha(c7, { conId: false });
  ok(f.titulo === '1 pista en tus me gusta', `sin tracklist: la lista de la obra, una por canción («${f.titulo}»)`);
  ok(f.conCorazon.length === 1 && f.linea === null, `una fila, con ♥, y ninguna línea (${f.conCorazon.join(' | ')} · ${f.linea})`);
  ok(/No se ha podido identificar este álbum en Spotify/.test(f.html), 'y el aviso de que no se identificó el disco, como hoy');
}
estado.likes = [...l1];
estado.source = 'empty';
{
  const f = await ficha(c1);
  ok(f.titulo === 'No sé cuáles de las 6 pistas tienes en me gusta', `la caché fría: el contador de hoy («${f.titulo}»)`);
  ok(f.linea === null && f.conCorazon.length === 0, 'ni línea ni ♥');
  ok(/Tus me gusta no están cargados en este navegador/.test(f.html), 'y el aviso de hoy, sin cambios');
}
estado.source = 'full';

console.log('\n[9] El invariante: ♥ de la tarjeta = canciones distintas del tracklist que cuentan + J');
for (const [nombre, d, likes] of [
  ['1', c1, l1],
  ['2', c2, [like('Disco Remaster Inventado (Remastered)', 'Tema Remaster Inventado - Remastered 2011')]],
  ['3', c3, [like('Disco Pegado Inventado Deluxe', 'Cancion Pegada Uno')]],
  ['7', c7, [like(c7.name, 'Tema Doble Inventado', { albumId: c7.id, id: c7.tracks[0].id }), like('Disco Doble Inventado (Remastered)', 'Tema Doble Inventado - Remastered')]],
]) {
  estado.likes = likes;
  const t = await tarjeta(d);
  const f = await ficha(d);
  let distintas = NaN, j = NaN;
  if (regla) {
    const cruce = regla.cruzarConTracklist(regla.indexarLikes(likes), { name: d.name, artist: d.artista, albumId: d.id }, d.tracks.map((x) => ({ id: x.id, name: x.name, artists: [d.artista] })));
    distintas = new Set(cruce.pistas.filter((p) => p.cuenta).map((p) => p.identidad)).size;
    j = cruce.j;
  }
  ok(t !== null && t === distintas + j, `caso ${nombre}: tarjeta ${t} = ${distintas} + ${j}`);
  ok(t !== null && t === nDeTitulo(f.titulo) + jDeLinea(f.linea), `caso ${nombre}: y en pantalla, tarjeta ${t} = «${f.titulo}» + J de «${f.linea}»`);
}

console.log('\n[10] La regla, sola y pura');
if (regla) {
  const { marcadoresDeVersion: mv, identidadDeCancion: id, textoOtraEdicion: tx } = regla;
  ok(mv('Tema - Remastered 2011').length === 0 && mv('Tema (Bonus Track)').length === 0 && mv('Tema - Deluxe').length === 0, 'remaster, bonus y deluxe NO son marcadores');
  ok(mv('Tema (Acoustic)').join() === 'acoustic' && mv('Tema - Sped Up').join() === 'sped up' && mv('Tema (Taylor’s Version)').join() === "taylor's version", 'acoustic, sped up y taylor’s version sí');
  ok(id('Tema Uno - Remastered 2011', ARTISTA) === id('Tema Uno', ARTISTA) && id('Tema Uno - Live', ARTISTA) !== id('Tema Uno', ARTISTA), 'la identidad junta el remaster y separa el en vivo');
  ok(tx(0, 0) === '' && tx(2, 1) === '2 de ellas están en otra edición y 1 más que este disco no tiene' && tx(1, 1) === '1 de ellas está en otra edición y 1 más que este disco no tiene', 'textoOtraEdicion: vacía, plural y singular');
} else {
  ok(false, 'la regla existe (util/likes-de-la-obra.js)');
}

console.log('\n[11] Lecturas estáticas');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const fuente = (p) => { try { return readFileSync(resolve(RAIZ_SRC, p), 'utf8'); } catch { return ''; } };
const fAc = sinComentarios(fuente('js/features/album-card.js'));
const fLi = sinComentarios(fuente('js/features/listened.js'));
ok(/from '\.\.\/util\/likes-de-la-obra\.js'/.test(fAc) && /from '\.\.\/util\/likes-de-la-obra\.js'/.test(fLi), 'album-card.js y listened.js importan la regla');
ok(!/trackNameKey/.test(fAc) && !/trackNameKey/.test(fLi), 'ninguno de los dos usa trackNameKey');
ok(!/function likesInAlbum/.test(fAc), 'la ficha ya no tiene su propio filtro (likesInAlbum)');
let conLaRegla = [];
try {
  conLaRegla = execFileSync('grep', ['-rlE', 'function (identidadDeCancion|cruzarConTracklist|likesDeLaObra)\\b', resolve(RAIZ_SRC, 'js')], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
} catch { /* grep sin coincidencias sale con 1: ningún módulo tiene la regla */ }
ok(conLaRegla.length === 1 && conLaRegla[0].endsWith('/js/util/likes-de-la-obra.js'), `un solo módulo con la regla (${conLaRegla.map((p) => p.split('/js/').pop()).join(', ')})`);
const deBase = (p) => execFileSync('git', ['-C', REPO, 'show', `${BASE}:src/${p}`], { encoding: 'utf8' });
const trozoSongKey = (t) => (t.match(/export function songKey[\s\S]*?\n}\n/) || [''])[0];
const trozoRemix = (t) => (t.match(/const REMIX_TAIL =[\s\S]*?;\n/) || [''])[0];
const si = fuente('js/util/song-identity.js'), siBase = deBase('js/util/song-identity.js');
ok(trozoSongKey(si) && sha(trozoSongKey(si)) === sha(trozoSongKey(siBase)), `songKey: el mismo sha256 que en ${BASE} (${sha(trozoSongKey(si)).slice(0, 12)}…)`);
ok(trozoRemix(si) && sha(trozoRemix(si)) === sha(trozoRemix(siBase)), `REMIX_TAIL: el mismo sha256 que en ${BASE} (${sha(trozoRemix(si)).slice(0, 12)}…)`);
ok(sha(fuente('css/main.css')) === sha(deBase('css/main.css')), `main.css igual byte a byte que en ${BASE}`);

console.log(`\n${bien} asserts OK · ${mal} fallos`);
process.exit(mal ? 1 : 0);
