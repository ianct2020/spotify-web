// tests/cache-solo-exitos.test.mjs — un fallo al preguntar NO se guarda en la
// caché (2026-09-28, v=256)
//
// Lo que se protege es un invariante, no una salida: **ante un fallo simulado no
// se escribe NADA en la caché**, en los cinco caminos que lo hacían.
//
// LAS DOS CAPAS DE ESTE ARCHIVO, dichas con todas las letras:
//
//   1. **Módulo real.** `util/cache-solo-exitos.js` se importa y se ejercita de
//      verdad, con un espía en lugar de la caché. Acá vive el invariante: si la
//      pregunta tira, `guardar` no se llama ni una vez.
//
//   2. **Fuente.** Los cinco sitios no se pueden importar en Node (arrastran
//      `api.js`, el DOM y media app), así que de ellos se comprueba el FUENTE:
//      que pasen por el helper y que **ningún `catch` del archivo escriba en su
//      caché**. Los bloques `catch` se recortan contando llaves sobre el archivo
//      entero — ⚠️ NO cortando entre dos nombres de función, que es justo el
//      error del test de v=255, que vigilaba a la función de al lado.
//
//   3. **Barrido de todo `src/js`**, para el llamador número seis: ningún
//      archivo del repo escribe en una caché desde un `catch`. Con su **guarda
//      del guarda** (mínimo de archivos y de `catch` mirados), por si alguien
//      estrecha el barrido y lo deja verde sin mirar nada.
//
// Lo que este archivo NO prueba: el comportamiento de las cinco vistas en el
// navegador. Para eso hay que abrirlas, y está anotado en el resumen.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  pedirYCachear, CUALQUIER_RESPUESTA, SOLO_CON_CONTENIDO, estaVacio,
} from '../src/js/util/cache-solo-exitos.js';

const SRC = new URL('../src/js/', import.meta.url).pathname;

let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}

// ── Capa 1: el módulo real ──────────────────────────────────────────────────

function espia() {
  const e = { escrituras: [], errores: [] };
  e.guardar = v => e.escrituras.push(v);
  e.alFallar = err => e.errores.push(err);
  return e;
}

console.log('\n[1] El invariante, contra el módulo real');

{
  // El caso que da nombre a la tanda: la pregunta falló.
  const e = espia();
  const r = await pedirYCachear({
    pedir: async () => { throw new Error('Spotify 429: rate limit'); },
    esResultado: CUALQUIER_RESPUESTA,
    guardar: e.guardar,
    siFalla: [],
    alFallar: e.alFallar,
  });
  ok(e.escrituras.length === 0, 'un fallo NO escribe nada en la caché');
  ok(Array.isArray(r) && r.length === 0, 'un fallo devuelve `siFalla`');
  ok(e.errores.length === 1 && /429/.test(e.errores[0].message), '`alFallar` recibe el error crudo');
}

{
  // Y con el otro criterio, el mismo invariante: es el `catch`, no el predicado.
  const e = espia();
  await pedirYCachear({
    pedir: async () => { throw new Error('Failed to fetch'); },
    esResultado: SOLO_CON_CONTENIDO,
    guardar: e.guardar,
  });
  ok(e.escrituras.length === 0, 'un corte de red tampoco escribe con SOLO_CON_CONTENIDO');
}

{
  const e = espia();
  const r = await pedirYCachear({
    pedir: async () => { throw new Error('x'); },
    esResultado: CUALQUIER_RESPUESTA,
    guardar: e.guardar,
  });
  ok(r === null, 'sin `siFalla`, un fallo devuelve null');
}

{
  // «Pregunté y no hay» SÍ es un resultado, y se guarda: es la otra mitad de la
  // distinción, y sin ella el arreglo sería «no cachear nunca».
  const e = espia();
  const r = await pedirYCachear({
    pedir: async () => [],
    esResultado: CUALQUIER_RESPUESTA,
    guardar: e.guardar,
  });
  ok(e.escrituras.length === 1 && Array.isArray(e.escrituras[0]) && e.escrituras[0].length === 0,
    'una lista vacía CONTESTADA se guarda con CUALQUIER_RESPUESTA');
  ok(Array.isArray(r), 'y se devuelve tal cual');
}

{
  const e = espia();
  await pedirYCachear({ pedir: async () => null, esResultado: CUALQUIER_RESPUESTA, guardar: e.guardar });
  ok(e.escrituras.length === 1 && e.escrituras[0] === null,
    'un null CONTESTADO se guarda con CUALQUIER_RESPUESTA (el criterio de discover-common v=228)');
}

{
  // El pozo de los corazones de W-Three: el vacío no cuenta como respuesta.
  for (const [v, etiqueta] of [
    [[], 'array vacío'], [null, 'null'], [undefined, 'undefined'], ['', 'cadena vacía'],
    [new Map(), 'Map vacío'], [new Set(), 'Set vacío'],
  ]) {
    const e = espia();
    const r = await pedirYCachear({ pedir: async () => v, esResultado: SOLO_CON_CONTENIDO, guardar: e.guardar });
    ok(e.escrituras.length === 0, `SOLO_CON_CONTENIDO no guarda un ${etiqueta}`);
    ok(r === v || (v instanceof Map && r instanceof Map) || (v instanceof Set && r instanceof Set),
      `pero devuelve el ${etiqueta} para que el llamador pinte`);
  }
}

{
  const e = espia();
  await pedirYCachear({ pedir: async () => [1, 2], esResultado: SOLO_CON_CONTENIDO, guardar: e.guardar });
  ok(e.escrituras.length === 1 && e.escrituras[0].length === 2, 'SOLO_CON_CONTENIDO sí guarda lo que trae contenido');
}

{
  // El criterio propio de una fuente: el `source` de `getBestAvailableLikes`.
  // `source: 'empty'` NO es «no tenés me gusta», es «la caché todavía no está».
  const esFull = r => r?.source === 'full';
  const e1 = espia();
  await pedirYCachear({ pedir: async () => ({ items: [], source: 'empty' }), esResultado: esFull, guardar: e1.guardar });
  ok(e1.escrituras.length === 0, "source:'empty' no se memoiza (aunque no haya tirado nada)");

  const e2 = espia();
  await pedirYCachear({ pedir: async () => ({ items: [], source: 'full' }), esResultado: esFull, guardar: e2.guardar });
  ok(e2.escrituras.length === 1, "source:'full' con cero me gusta SÍ se memoiza: es una respuesta");
}

{
  // `esResultado` obligatorio y sin defecto — el idiom de `guarda` en
  // `util/borrado-verificado.js`. Un llamador nuevo no puede saltearse la
  // decisión sin que explote en la cara.
  let tiro = false;
  try {
    await pedirYCachear({ pedir: async () => 1, guardar: () => {} });
  } catch (e) { tiro = e instanceof TypeError && /esResultado/.test(e.message); }
  ok(tiro, '`esResultado` es obligatorio: sin él, TypeError');

  let tiro2 = false;
  try { await pedirYCachear({ esResultado: CUALQUIER_RESPUESTA, guardar: () => {} }); }
  catch (e) { tiro2 = e instanceof TypeError && /pedir/.test(e.message); }
  ok(tiro2, '`pedir` es obligatorio');

  let tiro3 = false;
  try { await pedirYCachear({ pedir: async () => 1, esResultado: CUALQUIER_RESPUESTA }); }
  catch (e) { tiro3 = e instanceof TypeError && /guardar/.test(e.message); }
  ok(tiro3, '`guardar` es obligatorio');

  let tiro4 = false;
  try { await pedirYCachear(); } catch (e) { tiro4 = e instanceof TypeError; }
  ok(tiro4, 'sin argumentos, TypeError');
}

{
  // El `try` envuelve SOLO la pregunta. Si escribir en la caché falla, eso no se
  // disfraza de «la red falló»: sale como el error que es. Es la lección del
  // catch ancho de v=154.
  let propago = false;
  try {
    await pedirYCachear({
      pedir: async () => 'x',
      esResultado: CUALQUIER_RESPUESTA,
      guardar: () => { throw new Error('localStorage lleno'); },
    });
  } catch (e) { propago = /lleno/.test(e.message); }
  ok(propago, 'un fallo de ESCRITURA no se traga: propaga');
}

{
  ok(estaVacio([]) && estaVacio(null) && estaVacio(undefined) && estaVacio('')
    && estaVacio(new Map()) && estaVacio(new Set()), 'estaVacio: los seis vacíos');
  ok(!estaVacio([0]) && !estaVacio('a') && !estaVacio(0) && !estaVacio(false)
    && !estaVacio({}) && !estaVacio(new Map([['a', 1]])), 'estaVacio: 0, false y {} NO son vacíos');
}

// ── Capa 2: el fuente de los cinco sitios ───────────────────────────────────
//
// Recorta cada bloque `catch` contando llaves, sobre el archivo entero.

// Solo las líneas de CÓDIGO. Sin esto el test se pone rojo por sus propios
// comentarios: los cinco arreglos explican el patrón que sacaron, citándolo.
// Un comentario que nombra `setCachedTags(name, [])` no envenena ninguna caché.
function codigo(src) {
  return src.split('\n')
    .filter(l => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

function bloquesCatch(src) {
  const bloques = [];
  const re = /\bcatch\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length - 1;   // la `{`
    let prof = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') prof++;
      else if (src[j] === '}') {
        prof--;
        if (prof === 0) { bloques.push(src.slice(i + 1, j)); break; }
      }
    }
  }
  return bloques;
}

// Escribir en una caché: los nombres con los que este repo escribe cachés.
//
// ⚠️ NO están `localStorage.setItem` ni `idbSetCached` a secas, y es a propósito:
// esos dos aparecen legítimamente dentro de un `catch` en el patrón INVERSO —el
// reintento de `cacheSet()` en `storage.js` después de un `QuotaExceededError`—,
// que es fallar al ESCRIBIR y no guardar un fallo de LECTURA. Lo que se busca acá
// es lo segundo. Las cachés de este repo se escriben con estos seis nombres.
const ESCRITURAS_DE_CACHE = [
  /\b\w*[Cc]ach\w*\.set\s*\(/,              // albumTracksCache.set(…)
  /\bsetCached[A-Z]\w*\s*\(/,               // setCachedTags(…)
  /\bsave[A-Z]\w*[Cc]ach\w*\s*\(/,          // saveImgCache(…) · saveTagsCache(…)
  /\b_?\w*[Mm]emo\w*\s*(\.set\s*\(|=[^=])/, // artistUriMemo.set(…) · _likesMemo = …
  /\b\w*[Cc]ach\w*\s*\[[^\]]*\]\s*=[^=]/,   // cache[key] = …
  /\bcacheSet\s*\(/,
];

// ⚠️ Y la regla que NO depende de cómo se llame la caché: una asignación, desde
// dentro de un `catch`, a una variable de módulo declarada con `let`. Eso es un
// memo de archivo, se llame `_likesMemo`, `likesPorAlbum` o `pepe`.
//
// Hizo falta porque la primera versión de este test solo miraba nombres con
// «cache» o «memo» adentro, y con eso **el llamador número seis se escapaba**:
// restaurar el bug en `covers.js` (`likesPorAlbum = idx` dentro del catch) la
// dejaba verde. O sea que la guarda cubría a los siete sitios conocidos y no la
// familia, que es justo lo que esta tanda vino a arreglar.
function letsDeModulo(src) {
  const nombres = new Set();
  for (const m of src.matchAll(/^(?:let|var)\s+([A-Za-z_$][\w$]*)/gm)) nombres.add(m[1]);
  return nombres;
}

// Excepciones con nombre, archivo y motivo escrito. Nunca se afloja el patrón:
// se nombra la línea y se dice por qué está bien. Las seis que hay son de dos
// clases, y ninguna guarda un fallo de lectura como resultado:
//
//   a) ARRANCAR una caché vacía porque el `JSON.parse` de lo guardado falló.
//      No memoiza ningún fallo de red: deja la caché en su estado inicial.
//   b) ANOTAR el fallo *como fallo*, que es lo contrario de disfrazarlo: la
//      pausa del nativo tras un 429 (v=226), la bandera de que `/me` falló en
//      esta carga (el gate degradado), y los charts del Dashboard, que se
//      destruyen para pintar la tarjeta de error — el ejemplar de lo que hay
//      que hacer.
const EXCEPCIONES = new Set([
  'api/itunes.js|cache',                      // (a) cache = new Map() si el parse falla
  'api/preview-providers.js|providerCache',   // (a) idem
  'api/preview-providers.js|deezerCache',     // (a) idem
  'api.js|_nativoPausaHasta',                 // (b) la pausa de 5 min tras el 429 del nativo
  'api.js|_nativoPausaMs',                    // (b) y su doblaje, mismo bloque (v=226)
  'api.js|_nativoDenegado',                   // (b) 400/403: abandona el nativo y lo DICE en pantalla
  'features/history-data.js|meFalloEnEstaCarga', // (b) anota que /me falló, para degradar
  // (b) el camino de RESCATE del Dashboard: tras el fallo pinta la caché que
  // sobrevivió y anota lo que pintó, para que el repintado por paleta (v=236) no
  // tenga que recalcular. No memoiza ningún fallo: memoiza lo que hay en pantalla.
  'features/dashboard.js|charts',
  'features/dashboard.js|_lastStats',
  'features/dashboard.js|_lastContainer',
]);

function escrituraEnCatch(src, rel = '') {
  const malos = [];
  const cod = codigo(src);
  const lets = letsDeModulo(cod);
  for (const b of bloquesCatch(cod)) {
    // Un `catch` cuyo cuerpo es solo comentarios o un aviso no escribe nada.
    let malo = null;
    for (const re of ESCRITURAS_DE_CACHE) {
      if (re.test(b)) { malo = b; break; }
    }
    if (!malo) {
      for (const n of lets) {
        if (EXCEPCIONES.has(`${rel}|${n}`)) continue;
        // `n = …` pero no `n == …`, `n === …` ni `n =>`.
        if (new RegExp(`\\b${n}\\s*=(?![=>])`).test(b)) { malo = b; break; }
      }
    }
    if (malo) malos.push(malo.trim().replace(/\s+/g, ' ').slice(0, 90));
  }
  return malos;
}

const CINCO = {
  'features/by-genre.js': {
    // ⚠️ El patrón tiene que ser «`setCachedTags` DESPUÉS de un catch», no
    // «`setCachedTags(name, [])` en cualquier parte»: la pasada de MusicBrainz
    // (línea 321) guarda `[]` en su camino de ÉXITO, cuando MusicBrainz contestó
    // que no tiene géneros para ese artista. Eso es «pregunté y no hay» y es
    // legítimo. Buscar el literal a secas ponía en rojo una línea correcta.
    veneno: [/catch[\s\S]{0,200}?setCachedTags/],
    nombre: 'by-genre · tags de Last.fm (TTL 30 días)',
  },
  'features/album-card.js': {
    veneno: [/_likesMemo\s*=\s*\[\s*\]/],
    nombre: 'album-card · memo de me gusta',
  },
  'features/recommendations.js': {
    veneno: [/catch[\s\S]{0,400}?artistUriMemo\.set/],
    nombre: 'recommendations · uri representativa',
  },
  'features/wthree.js': {
    veneno: [/albumTracksCache\.set\s*\(\s*key\s*,\s*\[\s*\]\s*\)/],
    nombre: 'wthree · tracklist del álbum',
  },
  'features/artist-card.js': {
    veneno: [/artist:\\?"\$\{\s*name\s*\}/],   // la query SIN limpiar
    nombre: 'artist-card · foto del artista (TTL 30 días)',
  },
  // El SEXTO, que no estaba en el informe: lo encontró el barrido de abajo.
  'features/listened.js': {
    veneno: [/catch[\s\S]{0,160}?historyAlbums\s*=/],
    nombre: 'listened · historial de reproducción (el sexto)',
  },
};

console.log('\n[2] Los cinco sitios, sobre el fuente');

let sitiosMirados = 0, llamadasAlHelper = 0;
for (const [rel, cfg] of Object.entries(CINCO)) {
  const bruto = readFileSync(join(SRC, rel), 'utf8');
  const src = codigo(bruto);
  sitiosMirados++;
  const usos = (src.match(/pedirYCachear\s*\(/g) || []).length;
  llamadasAlHelper += usos;

  ok(/from '\.\.\/util\/cache-solo-exitos\.js'/.test(src), `${cfg.nombre}: importa el helper`);
  ok(usos >= 1, `${cfg.nombre}: lo usa de verdad`);

  const malos = escrituraEnCatch(bruto, rel);
  ok(malos.length === 0, `${cfg.nombre}: NINGÚN catch del archivo escribe en una caché${malos.length ? ` → ${malos[0]}` : ''}`);

  for (const re of cfg.veneno) {
    ok(!re.test(src), `${cfg.nombre}: el patrón envenenado ya no está (${re.source.slice(0, 40)})`);
  }
}

ok(sitiosMirados === 6, 'guarda del guarda: se miraron los SEIS sitios, no menos');
ok(llamadasAlHelper >= 6, `guarda del guarda: al menos 6 llamadas al helper (hay ${llamadasAlHelper})`);

{
  // El caso 2 tiene DOS mitades y la segunda no es un `catch`: memoizar un vacío
  // LEGÍTIMO. Sin este assert, cambiar `esResultado` a `() => true` dejaba el
  // test verde con el bug de «abrí una ficha antes de la primera sincronización
  // y me quedé sin corazones toda la sesión» puesto — comprobado restaurándolo.
  const src = codigo(readFileSync(join(SRC, 'features/album-card.js'), 'utf8'));
  ok(/esResultado:\s*r\s*=>\s*r\?\.source === 'full'/.test(src),
    "album-card: el memo de me gusta mira `source === 'full'`, no si el array vino vacío");
}

{
  // El apóstrofo, que es la mitad del caso 5: la query va limpia.
  const src = codigo(readFileSync(join(SRC, 'features/artist-card.js'), 'utf8'));
  ok(/artist:\\?"\$\{limpiaParaQuery\(name\)\}/.test(src),
    'artist-card: la query `artist:"…"` pasa por limpiaParaQuery');
  ok(/artistIsSame/.test(src) && !/\|\|\s*artists\[0\]/.test(src),
    'artist-card: el candidato se verifica con artistIsSame, sin `|| artists[0]` a ciegas');
}

{
  // Ninguna query `campo:"…"` sin limpiar en lo que le habla a SPOTIFY. La regla
  // de `limpiaParaQuery` es de la sintaxis `campo:"…"` de Spotify y de nadie más:
  // `api/musicbrainz.js` arma un query de Lucene contra MusicBrainz, otra API y
  // otra sintaxis, así que queda fuera a propósito (acotado por `spotifyFetch`).
  const crudos = [];
  let archivosDeSpotify = 0;
  for (const f of archivosJs(SRC)) {
    const src = codigo(readFileSync(f, 'utf8'));
    if (!/\bspotifyFetch\s*\(/.test(src)) continue;
    archivosDeSpotify++;
    for (const m of src.matchAll(/(album|artist|track):\\?"\$\{(?!limpiaParaQuery)([^}]*)\}/g)) {
      crudos.push(`${relative(SRC, f)} → ${m[0].slice(0, 50)}`);
    }
  }
  ok(crudos.length === 0, `ninguna query campo:"…" sin limpiar donde se le habla a Spotify${crudos.length ? ` → ${crudos[0]}` : ''}`);
  ok(archivosDeSpotify >= 10, `guarda del guarda: ${archivosDeSpotify} archivos hablan con Spotify (≥10)`);
}

// ── Capa 3: el llamador número seis ─────────────────────────────────────────

function archivosJs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...archivosJs(p));
    else if (e.endsWith('.js')) out.push(p);
  }
  return out;
}

console.log('\n[3] Barrido de todo src/js: nadie escribe en una caché desde un catch');

{
  const todos = archivosJs(SRC);
  let catchsMirados = 0;
  const sospechosos = [];
  for (const f of todos) {
    const src = readFileSync(f, 'utf8');
    catchsMirados += bloquesCatch(src).length;
    for (const b of escrituraEnCatch(src, relative(SRC, f))) sospechosos.push(`${relative(SRC, f)} → ${b}`);
  }
  ok(sospechosos.length === 0,
    `ningún catch de src/js escribe en una caché${sospechosos.length ? ` → ${sospechosos.length}: ${sospechosos[0]}` : ''}`);
  // Guarda del guarda: si alguien estrecha el barrido, esto se pone rojo.
  ok(todos.length >= 90, `guarda del guarda: se barrieron ${todos.length} archivos (≥90)`);
  ok(catchsMirados >= 100, `guarda del guarda: se miraron ${catchsMirados} bloques catch (≥100)`);
}

console.log(`\n${pasaron + fallaron} asserts · ${pasaron} ok · ${fallaron} fallan`);
process.exit(fallaron ? 1 : 0);
