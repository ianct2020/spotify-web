// tests/skips-pill-t138.test.mjs — el ▶ de «Skips crónicos» suena en el pill de abajo a la derecha (tanda 138, v=375).
//
// Se prueba `src/js/features/skips.js` REAL, en Node, con los dobles que ya cargan esa vista en la 104
// (`dobles/loader-t104.mjs` + `dobles/vista-t104.mjs`) y el DOM de mentira de la 115 (`dobles/dom-preview-doble.mjs`).
// Se eligió el par de la 104 y no el de la 92A porque su `vista-t104.mjs` ya lee el estado de `globalThis.__T104` (likes,
// historial, dueño): es el que estaba pensado para configurarse desde el caso. Lo que le faltaba, sin cambiar lo que hacía:
//   - `vista-t104.mjs`: `__T104.ganchos`, para que el caso ponga su propio `getPreview`, `togglePreview`, `playingKey`,
//     `getBestAvailableLikes`, `loadSkipStats`, `renderTrackCardRow`, `wireTrackCardGrid`, `createIncrementalList` y
//     `createLazyImages`. Sin `ganchos`, cada doble devuelve lo mismo que antes;
//   - `dom-preview-doble.mjs`: clases después del atributo (`.a[data-id="x"].b`) y el selector descendiente (`#a .b`), que
//     antes tiraban «no soporta».
// La tarjeta la arma el doble de `renderTrackCardRow` con la forma de la real (`ui/track-card-row.js`): el `extra` va
// DENTRO de `.sc-card`, al final. Tres temas INVENTADOS, con sus saltos inventados. Ninguna petición: `fetch` cuenta.
//
// `RAIZ_T138` (env) apunta a otra raíz con la misma forma (la copia de 6c2f87a), para ver los rojos. Por defecto, este repo.
//
// La regla: el ▶ pide `getPreview({ name, artists, spotifyId: r.id })` con la clave `sk:<id>`; sin match en iTunes ni en
// Deezer la cadena devuelve el embed y lo abre el pill; la tarjeta no abre nada. Lo esperado, escrito ANTES de correr nada:
//   1. el ▶ de una tarjeta llama a `togglePreview` con `sk:<id>`, y su función llama a `getPreview` con exactamente
//      `{ name, artists, spotifyId }`: el nombre del tema, TODOS los artistas y el id de la tarjeta;
//   2. sin match (la cadena devuelve el embed, `spotify-embed`): la tarjeta no tiene ningún `<iframe>` y no ganó ningún nodo;
//   3. `togglePreview` devuelve `null` (ni match ni embed): tampoco `<iframe>` en la tarjeta, ni nodos nuevos, y nada tira;
//   4. ninguna tarjeta tiene un elemento `.skips-preview-slot`, y ningún `extra` lo trae;
//   5. dos ▶ seguidos de dos tarjetas: cada uno con su propia clave, y ninguna de las dos abre nada;
//   6. (la conservación de las suites viejas la mira `npm test` entero, no esta suite);
//   7. lecturas estáticas: en el código de `src/` (.js, .css, .html) ni `toggleEmbed`, ni `closeEmbeds`, ni
//      `skips-preview-slot`; `skips.js` no importa `paintEmbedCard` ni arma una URL de `open.spotify.com/embed`;
//      `track-card-row.js`, `preview-player.js`, `preview-providers.js` y `main.css` iguales byte a byte a 6c2f87a;
//   8. ninguna petición (`fetch` en 0).
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const RAIZ = resolve(process.env.RAIZ_T138 || join(dirname(fileURLToPath(import.meta.url)), '..'));
let ok = 0, fallos = 0;
function comprobar(nombre, cond, detalle = '') {
  if (cond) { ok++; return; }
  fallos++;
  console.error(`  FALLA  ${nombre}${detalle ? '\n         ' + detalle : ''}`);
}
const igual = (n, sale, esperado) => comprobar(n, JSON.stringify(sale) === JSON.stringify(esperado), `sale     ${JSON.stringify(sale)}\n         esperaba ${JSON.stringify(esperado)}`);
const microtareas = () => new Promise((r) => setImmediate(r));

// ── Sin red, sin almacenamiento real ─────────────────────────────────────────
let fetches = 0;
globalThis.fetch = () => { fetches++; return Promise.reject(new Error('t138: sin red')); };
const valores = new Map();
globalThis.localStorage = {
  getItem: (k) => valores.get(k) ?? null,
  setItem: (k, v) => valores.set(k, String(v)),
  removeItem: (k) => valores.delete(k),
};
globalThis.CSS ??= { escape: (s) => String(s) };

const { instalar } = await import('./dobles/dom-preview-doble.mjs');
const { body } = instalar();

// ── Los datos, INVENTADOS ────────────────────────────────────────────────────
const DUR = 200000;
const TEMAS = [
  { id: 'pistainventada000000001', name: 'Canción inventada uno', artists: [{ name: 'Artista Inventado A' }, { name: 'Invitada Inventada B' }] },
  { id: 'pistainventada000000002', name: 'Canción inventada dos', artists: [{ name: 'Artista Inventado C' }] },
  { id: 'pistainventada000000003', name: 'Canción inventada tres', artists: [{ name: 'Artista Inventado D' }, { name: 'Invitado Inventado E' }, { name: 'Invitada Inventada F' }] },
];
const LIKES = TEMAS.map((t) => ({ track: { id: t.id, uri: `spotify:track:${t.id}`, name: t.name, artists: t.artists, album: { name: 'Disco inventado', images: [] }, duration_ms: DUR } }));
// [ok, skip, fwd_ms[], close_ms[], gid]: 1 escucha y 9 saltos a los 10 s → 90 % (pasa ≥5 plays y ≥70 %).
const SKIPS = { tracks: Object.fromEntries(TEMAS.map((t, i) => [t.id, [1, 9, Array(9).fill(10000), [], i + 1]])) };

// ── Los ganchos de los dobles ────────────────────────────────────────────────
const llamadas = { toggle: [], get: [] };
let modo = 'embed';          // 'embed': la cadena devuelve el embed si le pasan spotifyId · 'nada': devuelve null
let manejadores = null;
const extras = [];
globalThis.__T104 = {
  usuario: false, dueno: true, llamadas: 0, falla: null,
  ganchos: {
    getBestAvailableLikes: async () => ({ items: LIKES }),
    loadSkipStats: async () => SKIPS,
    playingKey: () => null,
    getPreview: async (args) => {
      llamadas.get.push(args);
      if (modo === 'nada') return null;
      return args?.spotifyId
        ? { url: `https://open.spotify.com/embed/track/${args.spotifyId}`, provider: 'spotify-embed', type: 'embed', label: args.name }
        : null;
    },
    // Como el real (`ui/preview-player.js`): con algo, «arrancó» (true); sin nada, null.
    togglePreview: async (key, getter) => {
      llamadas.toggle.push(key);
      const p = await getter();
      return p ? true : null;
    },
    renderTrackCardRow: (r, opts = {}) => {
      extras.push(opts.extra || '');
      return `<div class="sc-card" data-id="${r.id}"><div class="sc-card-body"><div class="sc-actions">${opts.badge || ''}<button type="button" class="sc-btn sc-play">P</button></div></div>${opts.extra || ''}</div>`;
    },
    wireTrackCardGrid: (grid, h) => { manejadores = h; },
    createIncrementalList: ({ container, items, renderItem }) => {
      container.innerHTML = items.map(renderItem).join('');
      return { destroy() {}, setItems(it) { container.innerHTML = it.map(renderItem).join(''); }, rendered: items.length };
    },
    createLazyImages: () => ({ destroy() {}, reset() {}, observe() {}, stats: null }),
  },
};

register('./dobles/loader-t104.mjs', pathToFileURL(import.meta.filename));
const skips = await import(pathToFileURL(join(RAIZ, 'src/js/features/skips.js')).href);

const contenedor = document.createElement('div');
body.appendChild(contenedor);
async function pintar() {
  manejadores = null; extras.length = 0;
  await skips.render(contenedor);
  for (let i = 0; i < 5; i++) await microtareas();
  return document.getElementById('skips-list');
}
const tarjeta = (grid, id) => grid.querySelector(`.sc-card[data-id="${id}"]`);
const contarNodos = (n) => n.children.reduce((s, c) => s + 1 + contarNodos(c), 0);
async function tocar(grid, id) {
  const card = tarjeta(grid, id);
  let error = null;
  try { await manejadores.onPlay(manejadores.rowById(id), card); } catch (e) { error = e; }
  for (let i = 0; i < 5; i++) await microtareas();
  return error;
}

// ── 1 y 2: el ▶ de una tarjeta, con el embed como resultado de la cadena ─────
{
  modo = 'embed'; llamadas.toggle.length = 0; llamadas.get.length = 0;
  const grid = await pintar();
  comprobar('0a la vista pinta la grilla', !!grid);
  comprobar('0b las tres tarjetas', grid?.querySelectorAll('.sc-card').length === 3, `hay ${grid?.querySelectorAll('.sc-card').length}`);
  comprobar('0c la vista cableó el ▶', typeof manejadores?.onPlay === 'function');
  const [t] = TEMAS;
  const card = tarjeta(grid, t.id);
  const antes = contarNodos(card);
  const error = await tocar(grid, t.id);
  comprobar('1a el ▶ no tira', !error, String(error));
  igual('1b togglePreview con la clave sk:<id>', llamadas.toggle, [`sk:${t.id}`]);
  igual('1c getPreview una vez', llamadas.get.length, 1);
  igual('1d getPreview con { name, artists (todos), spotifyId: id de la tarjeta }', llamadas.get[0], { name: t.name, artists: t.artists.map((a) => a.name), spotifyId: t.id });
  const ahora = tarjeta(grid, t.id);
  igual('2a sin match (embed): ningún <iframe> en la tarjeta', ahora?.querySelectorAll('iframe').length, 0);
  igual('2b sin match (embed): la tarjeta no ganó nodos', contarNodos(ahora), antes);
  igual('2c ningún <iframe> en toda la grilla', grid.querySelectorAll('iframe').length, 0);
}

// ── 3: togglePreview devuelve null (ni match ni embed) ───────────────────────
{
  modo = 'nada'; llamadas.toggle.length = 0; llamadas.get.length = 0;
  const grid = await pintar();
  const t = TEMAS[1];
  const antes = contarNodos(tarjeta(grid, t.id));
  const error = await tocar(grid, t.id);
  comprobar('3a con null nada tira', !error, String(error));
  igual('3b togglePreview con su clave', llamadas.toggle, [`sk:${t.id}`]);
  igual('3c con null: ningún <iframe> en la tarjeta', tarjeta(grid, t.id)?.querySelectorAll('iframe').length, 0);
  igual('3d con null: la tarjeta no ganó nodos', contarNodos(tarjeta(grid, t.id)), antes);
  igual('3e con null: ningún <iframe> en toda la grilla', grid.querySelectorAll('iframe').length, 0);
}

// ── 4: el marcado ────────────────────────────────────────────────────────────
{
  modo = 'embed';
  const grid = await pintar();
  igual('4a ninguna tarjeta tiene .skips-preview-slot', grid.querySelectorAll('.skips-preview-slot').length, 0);
  igual('4b ningún extra trae el slot', extras.filter((x) => x.includes('skips-preview-slot')), []);
}

// ── 5: dos ▶ seguidos de dos tarjetas ────────────────────────────────────────
{
  modo = 'embed'; llamadas.toggle.length = 0; llamadas.get.length = 0;
  const grid = await pintar();
  const [a, , c] = TEMAS;
  const antesA = contarNodos(tarjeta(grid, a.id)), antesC = contarNodos(tarjeta(grid, c.id));
  const e1 = await tocar(grid, a.id);
  const e2 = await tocar(grid, c.id);
  comprobar('5a ninguno de los dos tira', !e1 && !e2, `${e1} · ${e2}`);
  igual('5b cada ▶ con su propia clave', llamadas.toggle, [`sk:${a.id}`, `sk:${c.id}`]);
  igual('5c cada getPreview con el id de su tarjeta', llamadas.get.map((x) => x?.spotifyId), [a.id, c.id]);
  igual('5d la segunda con todos sus artistas (tres)', llamadas.get[1]?.artists, c.artists.map((x) => x.name));
  igual('5e ningún <iframe> en la grilla', grid.querySelectorAll('iframe').length, 0);
  igual('5f las dos tarjetas sin nodos nuevos', [contarNodos(tarjeta(grid, a.id)), contarNodos(tarjeta(grid, c.id))], [antesA, antesC]);
}

// ── 7: lecturas estáticas ────────────────────────────────────────────────────
{
  const archivos = [];
  const recorrer = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) { if (n !== 'data') recorrer(p); }
      else if (/\.(js|css|html)$/.test(n)) archivos.push(p);
    }
  };
  recorrer(join(RAIZ, 'src'));
  comprobar('7a hay código que leer en src/', archivos.length > 20, `${archivos.length} archivos`);
  for (const palabra of ['toggleEmbed', 'closeEmbeds', 'skips-preview-slot']) {
    const con = archivos.filter((p) => readFileSync(p, 'utf8').includes(palabra)).map((p) => p.slice(RAIZ.length + 1));
    igual(`7b en src/ no aparece «${palabra}»`, con, []);
  }
  const fuente = readFileSync(join(RAIZ, 'src/js/features/skips.js'), 'utf8');
  const importTarjeta = fuente.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/ui\/track-card-row\.js'/)?.[1] || '';
  comprobar('7c skips.js importa de track-card-row.js', importTarjeta.length > 0);
  comprobar('7d skips.js no importa paintEmbedCard', !/\bpaintEmbedCard\b/.test(importTarjeta));
  comprobar('7e skips.js no nombra paintEmbedCard en ningún lado', !/\bpaintEmbedCard\b/.test(fuente));
  comprobar('7f skips.js no arma ninguna URL de open.spotify.com/embed', !fuente.includes('open.spotify.com/embed'));
  comprobar('7g skips.js pasa spotifyId a getPreview', /getPreview\(\{[^}]*spotifyId:\s*r\.id/.test(fuente));
  const sha = (rel) => createHash('sha256').update(readFileSync(join(RAIZ, rel))).digest('hex');
  igual('7h track-card-row.js byte a byte (6c2f87a)', sha('src/js/ui/track-card-row.js'), '260329f63e9fe32e6754b8123d39f6e794ad48f7a21910403899c6ad7490b402');
  igual('7i preview-player.js byte a byte (6c2f87a)', sha('src/js/ui/preview-player.js'), '1c01cd3b9375f2720fa5f8c36c91b7272c4ec56dcb5b26dbb5b7d70115b95c57');
  igual('7j preview-providers.js byte a byte (6c2f87a)', sha('src/js/api/preview-providers.js'), '685a323e9673f6d73250d850f83ac8b3bfab57264fa41a2ef72eae1a1bd59634');
  igual('7k main.css byte a byte (6c2f87a)', sha('src/css/main.css'), '3f96a87858caf15a4fe6b67f2ba67a6430b6fc77083f4d2f5c25693849fecf07');
}

// ── 8: sin red ───────────────────────────────────────────────────────────────
igual('8a ninguna petición', fetches, 0);

console.log(`skips-pill-t138: ${ok} asserts OK · ${fallos} fallos (de ${ok + fallos})`);
process.exit(fallos ? 1 : 0);
