// tests/vigencia-records-byartist.test.mjs — `#records` y `#byartist` no escriben en el DOM si saliste (v=329)
//
// EL FALLO QUE PROTEGE ESTE ARCHIVO: las dos vistas hacían `document.getElementById(…)` después de un
// `await` sin preguntar si la ruta seguía vigente. Si saliste mientras cargaban, eso es `null` y
// `content.innerHTML = …` TIRA («Cannot set properties of null (setting 'innerHTML')»). Desde v=325
// el error de una ruta vieja ya no le tapa la pantalla a la nueva (`guardRoute`), pero la vista
// seguía tirando por detrás. Y un camino que NO tira y que el banco no ve: el botón «Cargar likes»
// de `#byartist` (`loadLikes()`) volvía de `getAllLikedTracks()`, llamaba a `build()`, que tiraba,
// y su propio `catch` se lo comía y escribía «Cannot set properties of null…» en el nodo viejo,
// ya desenganchado. Lo mismo `#records` si saliste durante su `isOwner()`: escribía en un nodo muerto.
//
// Arreglo (v=329), el patrón de v=195: `const ruta = vigilarRuta()` al empezar `render()` (y al
// empezar `loadLikes()`, que corre por un clic: sin parámetro, así no hay `Event` que se cuele como
// `ruta`), y `if (!ruta.vigente()) return;` después de cada `await` y antes de tocar el DOM. En el
// `catch` de `loadLikes()`, después de `hideProgress()` (el overlay es global: se cierra igual).
//
// Carga los `records.js` y `by-artist.js` REALES en Node con todos sus `import` desviados a un doble
// (`tests/dobles/loader-vigencia-vistas.mjs`); `util/vigencia-ruta.js` va real. Las esperas son
// promesas que el test resuelve DESPUÉS de «salir»: subir la generación de ruta y reemplazar
// `#main-content`, que es exactamente lo que hace `handleRoute()`. Datos INVENTADOS.
// El caso de la app entera es el banco `tests/banco/guard-ruta-vieja.html` (A, B, D y E).
//
//   node tests/vigencia-records-byartist.test.mjs     (RECORDS=<ruta> / BY_ARTIST=<ruta> para probar otros)

import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORDS = process.env.RECORDS || join(RAIZ, 'src/js/features/records.js');
const BY_ARTIST = process.env.BY_ARTIST || join(RAIZ, 'src/js/features/by-artist.js');

register('./dobles/loader-vigencia-vistas.mjs', pathToFileURL(import.meta.filename));

let pasaron = 0, fallaron = 0;
function ok(cond, msg) {
  if (cond) { pasaron++; console.log(`  ✓ ${msg}`); }
  else { fallaron++; console.log(`  ✗ ${msg}`); }
}

// ── DOM mínimo ───────────────────────────────────────────────────────────────
// Cada elemento con `id` que aparece en un `innerHTML` queda registrado como hijo de quien lo
// escribió; volver a escribir el `innerHTML` de un elemento desengancha a sus hijos (y a los hijos
// de esos). `getElementById` solo encuentra los enganchados. Cada escritura de `innerHTML` queda
// anotada con si el elemento estaba enganchado o no.
const escrituras = [];
const porId = new Map();
class El {
  constructor(id) {
    this.id = id; this.conectado = true; this.hijos = [];
    this._html = ''; this.style = {}; this.dataset = {}; this.value = ''; this.onclick = null;
  }
  set innerHTML(v) {
    v = String(v);
    escrituras.push({ id: this.id, conectado: this.conectado, html: v });
    this._html = v;
    const soltar = (el) => { el.conectado = false; if (porId.get(el.id) === el) porId.delete(el.id); el.hijos.forEach(soltar); };
    this.hijos.forEach(soltar);
    this.hijos = [];
    for (const [, id] of v.matchAll(/\bid="([^"]+)"/g)) {
      const h = new El(id);
      h.conectado = this.conectado;
      this.hijos.push(h);
      if (this.conectado) porId.set(id, h);
    }
  }
  get innerHTML() { return this._html; }
  get textContent() { return this._html.replace(/<[^>]*>/g, ''); }
  set textContent(v) { this.innerHTML = String(v).replace(/</g, '&lt;'); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener() {}
  focus() {}
}
const main = new El('main-content');
porId.set('main-content', main);
globalThis.document = {
  getElementById: (id) => porId.get(id) || null,
  querySelectorAll: () => [],
};
const ls = new Map();
globalThis.localStorage = { getItem: (k) => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };

const VV = (globalThis.__VV ||= { generacion: 0, esperas: {}, llamadas: [] });
function preparar(nombre) {
  let resolver, rechazar;
  const promesa = new Promise((res, rej) => { resolver = res; rechazar = rej; });
  VV.esperas[nombre] = { promesa, resolver, rechazar };
  return VV.esperas[nombre];
}
const tic = () => new Promise((r) => setImmediate(r));
async function tics(n = 5) { for (let i = 0; i < n; i++) await tic(); }

// Entrar a una ruta: lo que hace `handleRoute()` antes de llamar al render.
function entrar() { VV.generacion += 1; main.innerHTML = '<div data-route-placeholder></div>'; }
// Salir: sube la generación y la ruta nueva reemplaza `#main-content`.
function salir() { VV.generacion += 1; main.innerHTML = '<div class="home-grid"></div>'; return escrituras.length; }
// El resultado de un render: `null` si terminó, el error si tiró.
const terminar = (p) => p.then(() => null, (e) => e);
const despuesDe = (marca) => escrituras.slice(marca);
const resumen = (ws) => ws.map((w) => `${w.id}${w.conectado ? '' : ' (desenganchado)'}: «${w.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)}»`).join(' | ') || 'ninguna';
const NULL_MSG = 'Cannot set properties of null';

const records = await import(pathToFileURL(RECORDS).href);
const byArtist = await import(pathToFileURL(BY_ARTIST).href);

// Me gusta INVENTADOS.
const LIKES = Array.from({ length: 12 }, (_, i) => ({
  track: { uri: `spotify:track:inv${i}`, name: `Tema inventado ${i}`, artists: [{ name: `Artista inventado ${i % 3}` }] },
}));
// Récords INVENTADOS, lo mínimo para el camino lleno.
const DIA = { date: '2020-05-01', min: 300, plays: 80, top_artist: { name: 'Artista inventado 0', min: 90 }, top_track: { name: 'Tema inventado 0' } };
const RECORDS_LLENOS = {
  top_days: [DIA], top_artist_days: [{ artist: 'Artista inventado 0', date: '2020-05-01', min: 90 }],
  top_track_days: [{ name: 'Tema inventado 0', artist: 'Artista inventado 0', date: '2020-05-01', plays: 9 }],
  top_track_weeks: [{ name: 'Tema inventado 0', artist: 'Artista inventado 0', week_start: '2020-04-27', plays: 20 }],
  top_streaks: [{ days: 30, start: '2020-04-01', end: '2020-04-30' }],
  track_most_days: [{ name: 'Tema inventado 0', artist: 'Artista inventado 0', days: 40 }],
  milestones: [{ n: 1000, name: 'Tema inventado 1', artist: 'Artista inventado 1', date: '2020-06-01' }],
};

// ══ 1. #byartist: salir mientras lee la caché (render → getBestAvailableLikes) ══
console.log('1. #byartist, salir mientras `getBestAvailableLikes()` lee la caché');
for (const [caso, items] of [['caché vacía (→ renderStart)', []], ['caché con 12 me gusta (→ build)', LIKES]]) {
  entrar();
  const e = preparar('getBestAvailableLikes');
  const p = terminar(byArtist.render(main));
  await tics();
  const marca = salir();
  e.resolver({ items, source: items.length ? 'full' : 'empty' });
  const err = await p;
  ok(err === null, `${caso}: el render termina sin tirar (tiró: ${err ? `«${err.message}»` : 'no'})`);
  ok(despuesDe(marca).length === 0, `${caso}: 0 escrituras al DOM después de salir (hubo: ${resumen(despuesDe(marca))})`);
}

// ══ 2. #byartist: «Cargar likes» y salir mientras baja (loadLikes → getAllLikedTracks) ══
console.log('2. #byartist, «Cargar likes» y salir mientras baja los me gusta');
for (const [caso, fin] of [['la descarga termina bien', 'bien'], ['la descarga falla', 'falla']]) {
  entrar();
  const e0 = preparar('getBestAvailableLikes');
  const p0 = terminar(byArtist.render(main));
  e0.resolver({ items: [], source: 'empty' });
  ok((await p0) === null, `${caso}: sin caché pinta la pantalla de arranque sin tirar`);
  const boton = document.getElementById('artist-load-btn');
  ok(typeof boton?.onclick === 'function', `${caso}: el botón «Cargar likes» está enganchado`);
  const e1 = preparar('getAllLikedTracks');
  VV.llamadas = [];
  // Como lo llama el navegador: con el Event de primer argumento (la trampa de v=195).
  const p1 = terminar(Promise.resolve(boton.onclick({ type: 'click', target: boton })));
  await tics();
  const marca = salir();
  if (fin === 'bien') e1.resolver(LIKES); else e1.rechazar(new Error('fallo de red inventado'));
  const err = await p1;
  await tics();
  ok(err === null, `${caso}: loadLikes() termina sin tirar (tiró: ${err ? `«${err.message}»` : 'no'})`);
  ok(despuesDe(marca).length === 0, `${caso}: 0 escrituras al DOM después de salir, tampoco en el nodo viejo (hubo: ${resumen(despuesDe(marca))})`);
  const cierra = fin === 'bien' ? 'prog.done' : 'hideProgress';
  ok(VV.llamadas.includes(cierra), `${caso}: el overlay de progreso (global) se cierra igual (${cierra}; llamadas: ${VV.llamadas.join(',')})`);
}

// ══ 3. #records: salir mientras carga (render → loadRecords) ═══════════════
console.log('3. #records, salir mientras `loadRecords()` carga');
for (const [caso, r] of [['sin récords (→ la rama de isOwner)', null], ['con récords (→ pinta)', RECORDS_LLENOS]]) {
  entrar();
  const e = preparar('loadRecords');
  preparar('isOwner').resolver(false);
  VV.llamadas = [];
  const p = terminar(records.render(main));
  await tics();
  const marca = salir();
  e.resolver(r);
  const err = await p;
  ok(err === null, `${caso}: el render termina sin tirar (tiró: ${err ? `«${err.message}»` : 'no'})`);
  ok(despuesDe(marca).length === 0, `${caso}: 0 escrituras al DOM después de salir (hubo: ${resumen(despuesDe(marca))})`);
}

// ══ 4. #records: salir mientras pregunta si sos el dueño (isOwner) ═════════
console.log('4. #records, sin récords, salir durante `isOwner()`');
{
  entrar();
  preparar('loadRecords').resolver(null);
  const e = preparar('isOwner');
  const p = terminar(records.render(main));
  await tics();
  ok(VV.esperas.isOwner && document.getElementById('records-content'), 'la vista está esperando a isOwner(), con su #records-content enganchado');
  const marca = salir();
  e.resolver(false);
  const err = await p;
  ok(err === null, `el render termina sin tirar (tiró: ${err ? `«${err.message}»` : 'no'})`);
  ok(despuesDe(marca).length === 0, `0 escrituras al DOM después de salir, tampoco en el nodo viejo (hubo: ${resumen(despuesDe(marca))})`);
}

// ══ 5. Conservación: sin salir, las dos vistas pintan lo de siempre ════════
console.log('5. Conservación: sin salir');
{
  entrar();
  preparar('getBestAvailableLikes').resolver({ items: LIKES, source: 'full' });
  const err = await terminar(byArtist.render(main));
  const c = document.getElementById('by-artist-content');
  ok(err === null && /12<\/strong> likes/.test(c?.innerHTML || '') && document.getElementById('artist-grid-holder'),
    `#byartist con caché: pinta «12 likes · 3 artistas» y la grilla (${err ? err.message : 'sin tirar'})`);
}
{
  entrar();
  preparar('getBestAvailableLikes').resolver({ items: [], source: 'empty' });
  await terminar(byArtist.render(main));
  preparar('getAllLikedTracks').resolver(LIKES);
  const err = await terminar(Promise.resolve(document.getElementById('artist-load-btn').onclick({ type: 'click' })));
  await tics();
  ok(err === null && /12<\/strong> likes/.test(document.getElementById('by-artist-content')?.innerHTML || ''),
    `#byartist sin caché → «Cargar likes» → pinta los 12 (${err ? err.message : 'sin tirar'})`);
}
{
  entrar();
  preparar('getBestAvailableLikes').resolver({ items: [], source: 'empty' });
  await terminar(byArtist.render(main));
  preparar('getAllLikedTracks').rechazar(new Error('fallo de red inventado'));
  await terminar(Promise.resolve(document.getElementById('artist-load-btn').onclick({ type: 'click' })));
  await tics();
  ok(/fallo de red inventado/.test(document.getElementById('by-artist-content')?.innerHTML || ''),
    '#byartist: «Cargar likes» que falla sin salir → pinta el error, como antes');
}
{
  entrar();
  preparar('loadRecords').resolver(RECORDS_LLENOS);
  const err = await terminar(records.render(main));
  ok(err === null && /TU DÍA MÁS MUSICAL/.test(document.getElementById('records-content')?.innerHTML || ''),
    `#records con récords: pinta el día más musical (${err ? err.message : 'sin tirar'})`);
}
{
  entrar();
  preparar('loadRecords').resolver(null);
  preparar('isOwner').resolver(false);
  const err = await terminar(records.render(main));
  ok(err === null && /candado Récords/.test(document.getElementById('records-content')?.innerHTML || ''),
    `#records sin récords y sin ser el dueño: el candado (${err ? err.message : 'sin tirar'})`);
}
{
  entrar();
  preparar('loadRecords').resolver(null);
  preparar('isOwner').resolver(true);
  await terminar(records.render(main));
  ok(/No pude cargar los récords/.test(document.getElementById('records-content')?.innerHTML || ''),
    '#records sin récords siendo el dueño: «No pude cargar los récords.»');
}

console.log(`\nrecords: ${RECORDS}\nby-artist: ${BY_ARTIST}`);
console.log(`${pasaron} pasaron · ${fallaron} fallaron`);
if (fallaron) process.exit(1);
console.log(`${pasaron} asserts OK`);
