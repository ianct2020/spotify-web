// tests/errores-que-dicen-hecho.test.mjs — dos pantallas que anunciaban un resultado normal
// cuando algo fallaba por debajo (tanda 86)
//
// LA REGLA (CLAUDE.md, v=154): un `catch` que traduce un error a un resultado normal esconde el
// error con la cara de un resultado limpio. Acá se vigilan dos sitios que la rompían:
//
//   1. **«Borrarlo»** (`clearMyHistory()` de `features/history-data.js`): borraba las ocho claves
//      `local_<uid>_history_*` con un `.catch(() => {})` en cada una, así que una que no se
//      borraba no se enteraba nadie y el handler de `#ih-clear` anunciaba «Historial local
//      borrado». Ahora intenta las ocho igual y, si alguna falló, TIRA diciendo cuántas.
//   2. **La pantalla de inicio de `#genre`** (`renderStartScreen()` de `features/by-genre.js`): si
//      `cargarEtiquetas()` fallaba, el `catch` solo avisaba por consola y la pantalla decía
//      «0 artistas con tags» y ofrecía analizar, con un almacén que no guarda nada. Ahora lo dice
//      y no ofrece ningún botón que lleve a buscar.
//
// Los dos módulos son los REALES; la red, IndexedDB y el DOM van a dobles nuevos
// (`tests/dobles/loader-errores-hecho.mjs`). Todo INVENTADO: ids, claves, números.
//
// Correr con: node tests/errores-que-dicen-hecho.test.mjs

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

function fakeLocalStorage(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

const PRUEBA = 't86-prueba-amigo-inventado';
globalThis.localStorage = fakeLocalStorage({ fonoteca_last_user_id: PRUEBA });
globalThis.__T86 = { me: PRUEBA, meFalla: null, likes: [], llamadas: [], etiquetas: 0, cargarFalla: null };
globalThis.__IDB_ESCR = { kv: new Map(), escrituras: [], borrados: [], intentos: [], fallanBorrar: new Set() };

// Los `console.warn` se juntan para poder mirarlos (y no ensucian la salida).
const avisos = [];
console.warn = (...a) => { avisos.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' ')); };

register('./dobles/loader-errores-hecho.mjs', pathToFileURL(import.meta.filename));
const hd = await import('../src/js/features/history-data.js');
const genre = await import('../src/js/features/by-genre.js');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
function eq(a, b, nombre) {
  const bien = JSON.stringify(a) === JSON.stringify(b);
  ok(bien, nombre, bien ? '' : `esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
}
async function capturar(fn) {
  try { await fn(); return null; } catch (e) { return e; }
}

// ── 1. clearMyHistory() ─────────────────────────────────────────────────────
const KINDS = ['stats', 'plays', 'listened', 'skip', 'detail', 'records', 'artistTracks', 'days'];
const clave = (uid, k) => `local_${uid}_history_${k}`;
const idb = () => globalThis.__IDB_ESCR;
function prepararBorrado(fallan = []) {
  const e = idb();
  e.kv = new Map(); e.escrituras = []; e.borrados = []; e.intentos = [];
  e.fallanBorrar = new Set(fallan.map(k => clave(PRUEBA, k)));
  for (const k of KINDS) e.kv.set(clave(PRUEBA, k), { inventado: k });
  avisos.length = 0;
}
const ochoClaves = KINDS.map(k => clave(PRUEBA, k)).sort();

console.log('\n[1a] clearMyHistory() con 1 de las 8 claves que no se deja borrar');
{
  globalThis.__T86.me = PRUEBA;
  prepararBorrado(['listened']);
  const err = await capturar(() => hd.clearMyHistory());
  ok(err instanceof Error, 'TIRA (no vuelve como si hubiera borrado todo)');
  ok(err && /\b1\b/.test(err.message), `el mensaje dice «1» («${err?.message}»)`);
  eq([...idb().intentos].sort(), ochoClaves, 'se intentaron las 8 (la que falla no corta a las otras)');
  eq(idb().borrados.length, 7, 'se borraron las otras 7');
  ok(idb().kv.has(clave(PRUEBA, 'listened')), 'la que falló sigue ahí');
  ok(err && Array.isArray(err.fallos) && err.fallos.length === 1 && /abortó/.test(String(err.fallos[0]?.error?.message || err.fallos[0]?.error)),
    `el error crudo viaja en una propiedad del error (${JSON.stringify(err?.fallos?.map(f => ({ ...f, error: String(f.error?.message || f.error) })))})`);
  ok(avisos.some(a => /abortó/.test(a)), `y va a console.warn (${JSON.stringify(avisos)})`);
}

console.log('\n[1b] clearMyHistory() con 3 que fallan');
{
  prepararBorrado(['stats', 'detail', 'days']);
  const err = await capturar(() => hd.clearMyHistory());
  ok(err instanceof Error, 'TIRA');
  ok(err && /\b3\b/.test(err.message), `el mensaje dice «3» («${err?.message}»)`);
  eq([...idb().intentos].sort(), ochoClaves, 'se intentaron las 8');
  eq(idb().borrados.length, 5, 'se borraron las otras 5');
}

console.log('\n[1c] CONSERVACIÓN: ninguna falla');
{
  prepararBorrado([]);
  let devuelto = 'sin llamar';
  const err = await capturar(async () => { devuelto = await hd.clearMyHistory(); });
  ok(err === null, `no tira${err ? ` (tiró: ${err.message})` : ''}`);
  eq([...idb().borrados].sort(), ochoClaves, 'se borraron las 8');
  eq(devuelto, undefined, 'devuelve lo mismo que antes (undefined)');
}

console.log('\n[1d] CONSERVACIÓN: el owner, la guarda va antes del primer idbDel');
{
  globalThis.__T86.me = hd.HISTORY_OWNER_ID;
  prepararBorrado([]);
  const err = await capturar(() => hd.clearMyHistory());
  ok(err instanceof Error && err.importBloqueado === 'owner', 'tira el error de la guarda («owner»)');
  eq(idb().intentos, [], '0 intentos de borrado');
  globalThis.__T86.me = PRUEBA;
}

// ⚠️ Va ÚLTIMO de la sección: `resolvedUserId()` recuerda el fallo de `/me` para toda la carga
// del módulo, como en el navegador (lo mismo que en `import-guarda-owner.test.mjs`).
console.log('\n[1e] CONSERVACIÓN: sin identidad confirmada, la guarda va antes del primer idbDel');
{
  globalThis.__T86.meFalla = 'doble: /me en 429';
  prepararBorrado([]);
  const err = await capturar(() => hd.clearMyHistory());
  ok(err instanceof Error && err.importBloqueado === 'identidad', `tira el error de la guarda («identidad»: ${err?.importBloqueado})`);
  eq(idb().intentos, [], '0 intentos de borrado');
  globalThis.__T86.meFalla = null;
}

// ── 2. La pantalla de inicio de #genre ──────────────────────────────────────
// Un DOM mínimo: `getElementById` solo encuentra un id si está en el HTML que se pintó, como en
// el navegador (si la vista quita un botón, el `getElementById(...).onclick = …` de después no lo
// encuentra y da `null`).
const elementos = new Map();
const container = { innerHTML: '' };
function pintado() { return container.innerHTML + (elementos.get('genre-content')?.innerHTML || ''); }
globalThis.document = {
  getElementById(id) {
    if (!pintado().includes(`id="${id}"`)) return null;
    if (!elementos.has(id)) elementos.set(id, { id, innerHTML: '', onclick: null, onchange: null, click() {} });
    return elementos.get(id);
  },
};
async function pintarInicio({ falla = null, etiquetas = 0, likes = 0 } = {}) {
  elementos.clear();
  container.innerHTML = '';
  Object.assign(globalThis.__T86, { cargarFalla: falla, etiquetas, likes: Array.from({ length: likes }, (_, i) => ({ id: `t${i}` })), llamadas: [] });
  avisos.length = 0;
  genre.render(container);
  // `render` no espera a `renderStartScreen`: se deja correr hasta que se quede quieta.
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
  return elementos.get('genre-content')?.innerHTML || '';
}
const plano = (s) => s.replace(/\s+/g, ' ').trim();
const TERCEROS = ['getAllLikedTracks', 'getArtistTopTags', 'setCachedTags', 'mergeCachedTags', 'musicbrainz'];

console.log('\n[2a] #genre con cargarEtiquetas() que tira');
{
  const html = await pintarInicio({ falla: 'doble: IndexedDB no abrió', likes: 12 });
  ok(!/0<\/strong>\s*artistas con tags/.test(html) && !/\b0 artistas con tags/.test(plano(html.replace(/<[^>]+>/g, ''))),
    'no dice «0 artistas con tags»', plano(html));
  ok(/No se han podido leer las etiquetas/.test(html), 'dice que no se han podido leer las etiquetas guardadas', plano(html));
  ok(!html.includes('id="genre-begin-btn"'), 'no hay #genre-begin-btn («Ver mis géneros» lleva a analizar)');
  ok(!/genre-(fetch|mb|statsfm|show)-btn|Analizar|MusicBrainz|Stats\.fm|Last\.fm/.test(html), 'ni ningún botón que lleve a Last.fm, MusicBrainz o stats.fm');
  ok(html.includes('id="genre-preimport-btn"') && html.includes('id="genre-preimport-input"'), 'el botón de importar JSON se queda');
  ok(avisos.some(a => /IndexedDB no abrió/.test(a)), `el error crudo va a console.warn (${JSON.stringify(avisos)})`);
  eq(globalThis.__T86.llamadas.filter(n => TERCEROS.includes(n)), [], 'abrir la pantalla no le pide nada a nadie');
}

// La pantalla de antes de la tanda 86, con el espacio en blanco aplanado: con el almacén
// cargado tiene que salir IGUAL.
const HOY_CON_LIKES = plano(`
    <div class="card" style="max-width:640px">
      <h3 style="margin-bottom:8px">¿Cómo quieres arrancar?</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">Tienes <strong>12</strong> likes y <strong>12.345</strong> artistas con tags cacheados. Ya puedes ver tus géneros.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="genre-begin-btn">Ver mis géneros</button>
        <button class="btn btn-secondary" id="genre-preimport-btn">Importar otro JSON</button>
        <input type="file" id="genre-preimport-input" accept=".json,application/json" style="display:none">
      </div>
    </div>`);
const HOY_SIN_LIKES = plano(`
    <div class="card" style="max-width:640px">
      <h3 style="margin-bottom:8px">¿Cómo quieres arrancar?</h3>
      <p style="color:var(--color-text-secondary);font-size:13px;margin-bottom:16px">Tienes <strong>0</strong> artistas con tags pero <strong>0 likes</strong> cacheados. Carga los likes desde Spotify o importa un JSON previo que los tenga.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="genre-begin-btn">Cargar mis likes desde Spotify</button>
        <button class="btn btn-secondary" id="genre-preimport-btn">Importar cache primero</button>
        <input type="file" id="genre-preimport-input" accept=".json,application/json" style="display:none">
      </div>
    </div>`);

console.log('\n[2b] CONSERVACIÓN: #genre con cargarEtiquetas() bien');
{
  const html = await pintarInicio({ etiquetas: 12345, likes: 12 });
  eq(plano(html), HOY_CON_LIKES, 'con likes y etiquetas: la pantalla de siempre');
  ok(typeof elementos.get('genre-begin-btn')?.onclick === 'function', 'y «Ver mis géneros» tiene su handler');
  eq(avisos, [], 'sin avisos por consola');
  // Un almacén cargado y vacío SÍ es «0 artistas con tags»: eso es un resultado, no un error.
  const vacio = await pintarInicio({ etiquetas: 0, likes: 0 });
  eq(plano(vacio), HOY_SIN_LIKES, 'con el almacén cargado y vacío: «0 artistas con tags», como siempre');
}

console.log(`\n${pasaron} asserts OK · ${fallaron} fallos`);
process.exit(fallaron ? 1 : 0);
