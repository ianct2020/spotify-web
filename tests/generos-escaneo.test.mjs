// tests/generos-escaneo.test.mjs — el escaneo «Buscar géneros» de `#generos` (v=313, tanda 61)
//
// `util/generos-escaneo.js` es el bucle que le pide a Last.fm las etiquetas de cada artista del
// HISTORIAL (`universo()` de `mapa-paises.js`), con la red, el reloj, el guardado y el candado
// INYECTADOS, como el del mapa. Acá corre en Node contra un Last.fm y un reloj de mentira, con el
// almacén de verdad (`crearAlmacenGeneros` de `util/generos-artista.js`) sobre una IndexedDB de mentira.
//
// Lo que se vigila:
//   1. «Ya buscado»: `fuentes.lastfm` no nulo (aunque sea `[]`) o un `migrado` con alguna etiqueta. Un
//      `migrado` vacío, uno con solo MusicBrainz o solo stats.fm se vuelven a pedir.
//   2. Qué se guarda: un 200 con sus etiquetas (el filtro de siempre) y el `artista` que devolvió
//      Last.fm; «no encontrado» (error 6, que Last.fm devuelve con HTTP 200, medido en la tanda 61) como
//      `[]`. Un error de cuota (29), un 5xx, un corte de red y los «temporales» (8, 11, 16) NO se guardan
//      nunca: se reintenta EL MISMO artista con `esperaTrasFallo` del mapa; `FALLOS_PARA_PAUSAR`
//      seguidos pausan. Un error de la key (10, 26) para todo sin guardar. Otro 4xx sigue con el siguiente.
//   3. El ritmo: dos comienzos nunca a menos de `INTERVALO_MS`, y nunca dos esperas sin una petición.
//   4. Retomable: con la mitad guardada, «Seguir» pide solo la otra mitad.
//   5. Las filas de «Cuánto se sabe» suman el total, contra una cuenta hecha a mano (cinco desde v=314: ver
//      `tests/generos-regla.test.mjs`, que prueba la regla del género).
//   6. El filtro `count >= 5` es UNA función (`filtrarEtiquetasLastfm`): `getArtistTopTags` la importa,
//      no tiene su propio `>= 5`, y devuelve lo mismo que antes para una respuesta inventada.
//
// 🔴 Todo INVENTADO: artistas, etiquetas, respuestas.
//
// Correr con: node tests/generos-escaneo.test.mjs

import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

register('./dobles/loader-generos.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

let pasaron = 0, fallaron = 0;
function ok(cond, nombre, detalle = '') {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}${detalle ? '\n      ' + detalle : ''}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const cargar = async (p) => { try { return await import(pathToFileURL(join(raiz, p)).href); } catch (e) { console.log(`  (no se pudo importar ${p}: ${e.message})`); return {}; } };
const G = await cargar('src/js/util/generos-escaneo.js');
const A = await cargar('src/js/util/generos-artista.js');
const M = await cargar('src/js/util/mapa-escaneo.js');
const tiene = (f) => typeof f === 'function';

// ── El almacén de verdad, sobre una IndexedDB de mentira ────────────────────
const UID = 'uid-inventado';
let ahoraAlmacen = Date.UTC(2026, 9, 17, 12, 0, 0);
async function almacenCon(registros = {}) {
  const kv = new Map();
  for (const [nombre, fuentes] of Object.entries(registros)) {
    const k = nombre.toLowerCase();
    kv.set(A.claveGeneros(UID, k), { uid: UID, nombre: k, fuentes: { migrado: null, lastfm: null, musicbrainz: null, statsfm: null, ...fuentes } });
  }
  const al = A.crearAlmacenGeneros({
    leerRango: async (p) => [...kv].filter(([k]) => k.startsWith(p)),
    escribir: async (k, v) => { kv.set(k, v); },
    escribirVarios: async (pares) => { for (const [k, v] of pares) kv.set(k, v); },
    leerMarca: async () => ({ ya: true }),
    leerBlob: () => ({}),
    ahora: () => ++ahoraAlmacen,
    avisar: () => {},
  });
  await al.cargar(UID);
  return { al, kv };
}

// ── El Last.fm de mentira ───────────────────────────────────────────────────
// `respuestas`: nombre → lista de lo que contesta cada vez (la última se repite). Cada cosa es
// `{ tags: [...], artista }` (un 200 con `toptags`), `{ error: n }` (un 200 con `{error}`, como lo
// manda Last.fm), un número (status sin cuerpo útil) o 'red' (un corte).
function crearLastfm(respuestas = {}, { alPedir = null } = {}) {
  const llamadas = [];
  const vez = {};
  async function pedir(url, { signal } = {}) {
    const nombre = new URL(url).searchParams.get('artist');
    llamadas.push(nombre);
    if (alPedir) await alPedir(nombre, llamadas.length);
    if (signal?.aborted) { const e = new Error('abortado'); e.name = 'AbortError'; throw e; }
    const lista = respuestas[nombre] || [{ tags: [] }];
    const i = Math.min(vez[nombre] = (vez[nombre] ?? -1) + 1, lista.length - 1);
    const r = lista[i];
    if (r === 'red') throw new TypeError('Failed to fetch');
    if (typeof r === 'number') return { status: r, datos: null };
    if (r.error) return { status: 200, datos: { error: r.error, message: 'inventado', links: [] } };
    return { status: 200, datos: { toptags: { tag: r.tags.map(([name, count]) => ({ name, count, url: 'x' })), '@attr': { artist: r.artista ?? nombre } } } };
  }
  return { pedir, llamadas };
}

// El reloj de mentira: `esperar` adelanta el tiempo y anota la espera.
function crearReloj() {
  const r = { t: 0, esperas: [], ultimo: null };
  r.ahora = () => r.t;
  r.esperar = async (ms) => { r.esperas.push({ ms, despuesDe: r.ultimo }); r.t += ms; r.ultimo = 'espera'; };
  return r;
}

const item = (nombre, minutos) => ({ nombre, minutos, decimas: Math.round(minutos * 10) });

async function correr({ lista, registros = {}, respuestas = {}, saltar, alPedir, signal, seguir } = {}) {
  const { al, kv } = await almacenCon(registros);
  const lf = crearLastfm(respuestas, { alPedir });
  const reloj = crearReloj();
  const comienzos = [], peticiones = [], artistas = [];
  const pedir = async (url, o) => { reloj.ultimo = 'peticion'; return lf.pedir(url, o); };
  const r = await G.escanearGeneros({
    lista, registro: (n) => al.registro(n), url: (n) => G.urlEtiquetas(n, 'clave-inventada'),
    pedir, reloj, signal, seguir, saltar,
    guardar: (n, tags, artista) => al.guardar(n, tags, 'lastfm', artista === undefined ? undefined : { artista }),
    onPeticion: (p) => { comienzos.push(p.comienzo); peticiones.push(p); },
    onArtista: (n, e) => artistas.push([n, e]),
  });
  return { r, al, kv, lf, reloj, comienzos, peticiones, artistas };
}

// ── 1. «Ya buscado» ─────────────────────────────────────────────────────────
console.log('1. Qué cuenta como ya buscado');
{
  const f = (fuentes) => ({ uid: UID, nombre: 'x', fuentes: { migrado: null, lastfm: null, musicbrainz: null, statsfm: null, ...fuentes } });
  const yb = tiene(G.yaBuscado) ? G.yaBuscado : () => undefined;
  ok(yb(f({ lastfm: { tags: [], fecha: 1 } })) === true, 'lastfm con `[]`: ya buscado (Last.fm dijo que no tiene)');
  ok(yb(f({ lastfm: { tags: [{ name: 'polka inventada', count: 50 }], fecha: 1 } })) === true, 'lastfm con etiquetas: ya buscado');
  ok(yb(f({ migrado: { tags: [{ name: 'polka inventada', count: 50 }], fecha: 1 } })) === true, 'migrado con etiquetas: ya buscado');
  ok(yb(f({ migrado: { tags: [], fecha: 1 } })) === false, 'migrado con `[]`: NO (pudo ser el `[]` de MusicBrainz a ciegas)');
  ok(yb(f({ musicbrainz: { tags: [{ name: 'polka inventada', count: 1 }], fecha: 1 } })) === false, 'solo musicbrainz: NO');
  ok(yb(f({ statsfm: { tags: [{ name: 'polka inventada', count: 100 }], fecha: 1 } })) === false, 'solo statsfm: NO');
  ok(yb(null) === false, 'sin registro: NO');
}

// ── 2. Qué se guarda y qué no ───────────────────────────────────────────────
console.log('2. Qué se guarda');
if (tiene(G.escanearGeneros)) {
  const lista = [item('Banda Uno Inventada', 300), item('Banda Dos Inventada', 200), item('Banda Tres Inventada', 100)];
  const { r, al, lf } = await correr({
    lista,
    respuestas: {
      'Banda Uno Inventada': [{ tags: [['polka inventada', 100], ['ruido blanco inventado', 4], ['Vals Inventado', 30]], artista: 'BANDA UNO INVENTADA' }],
      'Banda Dos Inventada': [{ error: 6 }],
      'Banda Tres Inventada': [{ tags: [] }],
    },
  });
  ok(r.motivo === 'completo' && lf.llamadas.length === 3, `termina con 3 peticiones (${r.motivo}, ${lf.llamadas.length})`);
  const uno = al.registro('Banda Uno Inventada')?.fuentes?.lastfm;
  ok(igual(uno?.tags, [{ name: 'polka inventada', count: 100 }, { name: 'vals inventado', count: 30 }]), `un 200 guarda las etiquetas con el filtro de siempre: ${JSON.stringify(uno?.tags)}`);
  ok(uno?.artista === 'BANDA UNO INVENTADA', `y el nombre que devolvió Last.fm (\`artista\`): ${uno?.artista}`);
  ok(igual(al.leer('Banda Uno Inventada'), [{ name: 'polka inventada', count: 100 }, { name: 'vals inventado', count: 30 }]), 'la decisión (`leer`) no cambia por el campo nuevo');
  const dos = al.registro('Banda Dos Inventada')?.fuentes?.lastfm;
  ok(igual(dos?.tags, []), `«no encontrado» (error 6) se guarda como \`[]\`: ${JSON.stringify(dos)}`);
  ok(igual(al.registro('Banda Tres Inventada')?.fuentes?.lastfm?.tags, []), 'un 200 sin etiquetas, también `[]`');
} else ok(false, 'escanearGeneros existe');

console.log('2b. Los fallos de Last.fm no se guardan nunca y reintentan el MISMO artista');
if (tiene(G.escanearGeneros) && tiene(M.esperaTrasFallo)) {
  const lista = [item('Cuota Inventada', 300), item('Cinco Inventada', 200), item('Red Inventada', 150), item('Temporal Inventada', 120), item('Siguiente Inventada', 100)];
  const { r, al, lf, reloj, peticiones } = await correr({
    lista,
    respuestas: {
      'Cuota Inventada': [{ error: 29 }, { error: 29 }, { tags: [['polka inventada', 60]] }],
      'Cinco Inventada': [503, 502, { tags: [['vals inventado', 60]] }],
      'Red Inventada': ['red', { tags: [['jota inventada', 60]] }],
      'Temporal Inventada': [{ error: 16 }, { error: 8 }, { error: 11 }, { tags: [['fado inventado', 60]] }],
      'Siguiente Inventada': [{ tags: [['tango inventado', 60]] }],
    },
  });
  ok(r.motivo === 'completo', `termina igual (${r.motivo})`);
  ok(igual(lf.llamadas, ['Cuota Inventada', 'Cuota Inventada', 'Cuota Inventada', 'Cinco Inventada', 'Cinco Inventada', 'Cinco Inventada', 'Red Inventada', 'Red Inventada', 'Temporal Inventada', 'Temporal Inventada', 'Temporal Inventada', 'Temporal Inventada', 'Siguiente Inventada']),
    'cada fallo reintenta el MISMO artista, nunca salta al siguiente', lf.llamadas.join(' > '));
  for (const n of ['Cuota Inventada', 'Cinco Inventada', 'Red Inventada', 'Temporal Inventada']) {
    ok(al.registro(n)?.fuentes?.lastfm?.tags?.length === 1, `«${n}» guardado con lo de la respuesta buena, no con el fallo`);
  }
  const esperasDeFallo = reloj.esperas.map((e) => e.ms).filter((ms) => ms > G.INTERVALO_MS);
  ok(igual(esperasDeFallo, [M.esperaTrasFallo(1), M.esperaTrasFallo(2), M.esperaTrasFallo(1), M.esperaTrasFallo(2), M.esperaTrasFallo(1), M.esperaTrasFallo(1), M.esperaTrasFallo(2), M.esperaTrasFallo(3)]),
    `las esperas tras un fallo son las de \`esperaTrasFallo\` del mapa (${esperasDeFallo.join(', ')})`);
  ok(peticiones.filter((p) => p.reintento).length === 8, `8 reintentos marcados (${peticiones.filter((p) => p.reintento).length})`);
}

console.log('2c. Un error de cuota, sin respuesta buena, no se guarda: ni como `[]`');
if (tiene(G.escanearGeneros)) {
  // Con el artista siempre en 29: a los FALLOS_PARA_PAUSAR seguidos, pausa. Y no quedó NADA guardado.
  const { r, al, kv } = await correr({ lista: [item('Siempre Cuota Inventada', 300), item('Nunca Pedida Inventada', 100)], respuestas: { 'Siempre Cuota Inventada': [{ error: 29 }] } });
  ok(r.motivo === 'pausa', `pausa sola (${r.motivo})`);
  ok(r.peticiones === M.FALLOS_PARA_PAUSAR, `al llegar a FALLOS_PARA_PAUSAR (${M.FALLOS_PARA_PAUSAR}) seguidos: ${r.peticiones} peticiones`);
  ok(al.registro('Siempre Cuota Inventada') === null && kv.size === 0, `el error de cuota no se guardó (registro ${JSON.stringify(al.registro('Siempre Cuota Inventada'))}, ${kv.size} claves)`);
}
if (tiene(G.escanearGeneros)) {
  const { r, kv } = await correr({ lista: [item('Siempre 503 Inventada', 300)], respuestas: { 'Siempre 503 Inventada': [503] } });
  ok(r.motivo === 'pausa' && kv.size === 0, `con 5xx seguidos, pausa y 0 guardados (${r.motivo}, ${kv.size})`);
}

console.log('2d. La key y los otros 4xx');
if (tiene(G.escanearGeneros)) {
  for (const codigo of [10, 26]) {
    const { r, kv, lf } = await correr({ lista: [item('Primera Inventada', 300), item('Segunda Inventada', 100)], respuestas: { 'Primera Inventada': [{ error: codigo }] } });
    ok(r.motivo === 'key' && r.codigo === codigo && lf.llamadas.length === 1 && kv.size === 0, `error ${codigo}: para TODO, sin guardar nada y sin pedir el siguiente (${r.motivo}, ${lf.llamadas.length} peticiones, ${kv.size} guardados)`);
  }
  const { r, al, lf, artistas } = await correr({ lista: [item('Rara Inventada', 300), item('Normal Inventada', 100)], respuestas: { 'Rara Inventada': [400], 'Normal Inventada': [{ tags: [['polka inventada', 9]] }] } });
  ok(r.motivo === 'completo' && igual(lf.llamadas, ['Rara Inventada', 'Normal Inventada']), `un 400 es del artista: se sigue con el siguiente (${lf.llamadas.join(' > ')})`);
  ok(al.registro('Rara Inventada') === null && igual(r.noSePudo, ['Rara Inventada']), 'sin guardarlo, y queda en «no se pudo consultar»');
  ok(igual(artistas, [['Rara Inventada', 'no-se-pudo'], ['Normal Inventada', 'resuelto']]), `onArtista lo dice (${JSON.stringify(artistas)})`);
  const otro = await correr({ lista: [item('Codigo Raro Inventada', 300), item('Despues Inventada', 100)], respuestas: { 'Codigo Raro Inventada': [{ error: 7 }] } });
  ok(otro.r.motivo === 'completo' && otro.al.registro('Codigo Raro Inventada') === null && otro.lf.llamadas.length === 2, 'otro código de Last.fm (7) también es del artista: sin guardar y se sigue');
}

// ── 3. El ritmo ─────────────────────────────────────────────────────────────
console.log('3. El ritmo');
if (tiene(G.escanearGeneros)) {
  const lista = Array.from({ length: 12 }, (_, i) => item(`Ritmo Inventada ${i}`, 100 - i));
  const { comienzos, reloj } = await correr({ lista, respuestas: { 'Ritmo Inventada 3': [503, { tags: [] }], 'Ritmo Inventada 7': ['red', { tags: [] }] } });
  const gaps = comienzos.slice(1).map((t, i) => t - comienzos[i]);
  ok(G.INTERVALO_MS >= 1000, `INTERVALO_MS no baja de 1.000 ms (${G.INTERVALO_MS})`);
  ok(gaps.every((g) => g >= G.INTERVALO_MS), `dos comienzos nunca a menos de ${G.INTERVALO_MS} ms (mínimo ${Math.min(...gaps)})`);
  ok(reloj.esperas.every((e) => e.despuesDe !== 'espera'), 'nunca dos esperas seguidas sin una petición en el medio');
}

// ── 4. Retomable ────────────────────────────────────────────────────────────
console.log('4. Retomable');
if (tiene(G.escanearGeneros)) {
  const lista = Array.from({ length: 8 }, (_, i) => item(`Retoma Inventada ${i}`, 100 - i));
  const { al, kv } = await almacenCon({});
  const ctrl = new AbortController();
  const lf1 = crearLastfm({}, { alPedir: (n, k) => { if (k === 5) ctrl.abort(); } });
  const reloj = crearReloj();
  const base = { lista, registro: (n) => al.registro(n), url: (n) => G.urlEtiquetas(n, 'clave-inventada'), reloj, guardar: (n, t, a) => al.guardar(n, t, 'lastfm', { artista: a }) };
  const r1 = await G.escanearGeneros({ ...base, pedir: lf1.pedir, signal: ctrl.signal });
  const contestados = lista.filter((it) => al.registro(it.nombre)?.fuentes?.lastfm).map((it) => it.nombre);
  ok(r1.motivo === 'parado' && contestados.length === 4, `se para a mitad con 4 contestados y guardados (${r1.motivo}, ${contestados.length}, ${kv.size} claves)`);
  const lf2 = crearLastfm({});
  const r2 = await G.escanearGeneros({ ...base, pedir: lf2.pedir });
  ok(r2.motivo === 'completo' && lf2.llamadas.length === 4 && lf2.llamadas.every((n) => !contestados.includes(n)), `«Seguir» pide solo la otra mitad (${lf2.llamadas.join(', ')})`);
}
if (tiene(G.escanearGeneros)) {
  // Con registros sembrados: solo se piden los que no están «ya buscados».
  const lista = [item('Sembrada Lastfm', 500), item('Sembrada Migrado', 400), item('Migrado Vacio', 300), item('Solo MB', 200), item('Nueva', 100)];
  const { lf } = await correr({
    lista,
    registros: {
      'Sembrada Lastfm': { lastfm: { tags: [{ name: 'polka inventada', count: 50 }], fecha: 1 } },
      'Sembrada Migrado': { migrado: { tags: [{ name: 'vals inventado', count: 50 }], fecha: 1 } },
      'Migrado Vacio': { migrado: { tags: [], fecha: 1 } },
      'Solo MB': { musicbrainz: { tags: [{ name: 'jota inventada', count: 1 }], fecha: 1 } },
    },
  });
  ok(igual(lf.llamadas, ['Migrado Vacio', 'Solo MB', 'Nueva']), `pide exactamente los que faltan, uno por artista (${lf.llamadas.join(', ')})`);
}
if (tiene(G.escanearGeneros)) {
  // Al parar (teardown), 0 peticiones más.
  const lista = Array.from({ length: 6 }, (_, i) => item(`Para Inventada ${i}`, 100 - i));
  let vigente = true;
  const { lf, r } = await correr({ lista, seguir: () => vigente, alPedir: (n, k) => { if (k === 2) vigente = false; } });
  ok(r.motivo === 'parado' && lf.llamadas.length === 2, `si la ruta deja de estar vigente, para sin pedir más (${r.motivo}, ${lf.llamadas.length})`);
}

// ── 5. Las filas (cinco desde v=314) ────────────────────────────────────────
console.log('5. «Cuánto se sabe»: las cinco filas, contra una cuenta a mano');
if (tiene(G.armarCobertura) && tiene(A.crearAlmacenGeneros)) {
  const T = (min) => [1, min, 2021, 2025, [], '2021-01-01'];
  const totals = {
    'Con Lastfm': T(120.04), 'Con Migrado': T(80), 'Con MB Solo': T(33.3), 'Lastfm Vacio': T(50.5),
    'Migrado Vacio': T(20), 'Nadie': T(10), 'Chica Uno': T(9.99), 'Chica Dos': T(0.4),
  };
  const P = await cargar('src/js/util/mapa-paises.js');
  const lista = P.universo(totals, {});
  const { al } = await almacenCon({
    'Con Lastfm': { lastfm: { tags: [{ name: 'polka inventada', count: 50 }], fecha: 1 } },
    'Con Migrado': { migrado: { tags: [{ name: 'vals inventado', count: 50 }], fecha: 1 } },
    'Con MB Solo': { musicbrainz: { tags: [{ name: 'jota inventada', count: 1 }], fecha: 1 } },
    'Lastfm Vacio': { lastfm: { tags: [], fecha: 1 }, migrado: { tags: [], fecha: 1 } },
    'Migrado Vacio': { migrado: { tags: [], fecha: 1 } },
  });
  const c = G.armarCobertura({ totals, lista, registro: (n) => al.registro(n) });
  // A mano, en décimas: 120,04 → 1200; 80 → 800; 33,3 → 333; 50,5 → 505; 20 → 200; 10 → 100;
  // 9,99 → 100; 0,4 → 4. Total 3242.
  // con géneros: Con Lastfm + Con Migrado + Con MB Solo = 1200 + 800 + 333 = 2333 (3 artistas): las tres etiquetas
  //   inventadas son géneros para la regla de v=314 (hasta v=313 la fila se llamaba «con etiquetas» y daba lo mismo)
  // con etiquetas, ninguna de género: nadie = 0 (0) — la fila nueva de v=314
  // Last.fm dice que no tiene: Lastfm Vacio = 505 (1)
  // sin buscar: Migrado Vacio + Nadie = 200 + 100 = 300 (2)
  // menos de 10 min: Chica Uno + Chica Dos = 100 + 4 = 104 (2)
  const f = c.filas;
  ok(c.total === 3242, `el total, a mano: 3242 décimas (${c.total})`);
  // v=314: eran cuatro filas, [conEtiquetas, noTiene, sinBuscar, menos10] = [3/2333, 1/505, 2/300, 2/104]; ahora son
  // cinco y la de en medio es nueva («con etiquetas, ninguna de género»), vacía en este caso.
  ok(igual([f.conGeneros, f.sinGenero, f.noTiene, f.sinBuscar, f.menos10], [{ artistas: 3, decimas: 2333 }, { artistas: 0, decimas: 0 }, { artistas: 1, decimas: 505 }, { artistas: 2, decimas: 300 }, { artistas: 2, decimas: 104 }]), `las cinco filas = la cuenta a mano (${JSON.stringify(f)})`);
  ok(['conGeneros', 'sinGenero', 'noTiene', 'sinBuscar', 'menos10'].reduce((s, k) => s + (f[k]?.decimas ?? NaN), 0) === c.total, 'y suman exactamente el total');
  ok(c.universo === 6 && c.pendientes === 3, `universo 6 y por pedir 3 (Con MB Solo, Migrado Vacio, Nadie): ${c.universo}, ${c.pendientes}`);
}

// ── 6. El filtro, una sola vez ──────────────────────────────────────────────
console.log('6. El filtro `count >= 5`, una sola función');
{
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const lf = sinComentarios(readFileSync(join(raiz, 'src/js/api/lastfm.js'), 'utf8'));
  const cuerpo = (lf.match(/async function getArtistTopTags[\s\S]*?\n}/) || [''])[0];
  ok(/import\s*{[^}]*filtrarEtiquetasLastfm[^}]*}\s*from '\.\.\/util\/generos-artista\.js'/.test(lf), 'lastfm.js importa `filtrarEtiquetasLastfm` de util/generos-artista.js');
  ok(/filtrarEtiquetasLastfm\(/.test(cuerpo) && !/>=\s*5(?!\d)/.test(lf), 'getArtistTopTags la usa y lastfm.js no tiene su propio `>= 5`');
  let ge = '';
  try { ge = sinComentarios(readFileSync(join(raiz, 'src/js/util/generos-escaneo.js'), 'utf8')); } catch { /* no existe todavía: rojo */ }
  ok(/filtrarEtiquetasLastfm/.test(ge) && !/>=\s*5(?!\d)/.test(ge), 'generos-escaneo.js la importa y no tiene su propio `>= 5`');
  ok(/esperaTrasFallo/.test(ge) && /FALLOS_PARA_PAUSAR/.test(ge) && !/ESPERAS_MS\s*=/.test(ge) && /from '\.\/mapa-escaneo\.js'/.test(ge), 'las esperas y la pausa salen de mapa-escaneo.js, importadas');
}
{
  // De conservación: `getArtistTopTags` devuelve lo mismo que en v=312 para una respuesta inventada.
  const ls = new Map();
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  globalThis.__IDB_GENEROS = { kv: new Map(), fallar: new Set(), escrituras: [] };
  const fetchOriginal = globalThis.fetch;
  let pedida = null;
  globalThis.fetch = async (url) => {
    pedida = String(url);
    return new Response(JSON.stringify({ toptags: { tag: [
      { name: 'Polka Inventada', count: 100 }, { name: 'vals inventado', count: '42' }, { name: 'casi nada inventado', count: 4 },
      { name: '', count: 90 }, { name: 'justo cinco inventado', count: 5 }, { name: 'sin count inventado' }, { name: 'Jota Inventada', count: 'x' },
    ], '@attr': { artist: 'Banda Inventada' } } }), { status: 200 });
  };
  const L = await import(pathToFileURL(join(raiz, 'src/js/api/lastfm.js')).href + '?conservacion=1');
  const r = await L.getArtistTopTags('Banda Inventada');
  globalThis.fetch = fetchOriginal;
  // Lo que daba v=312 (el map + filter de siempre, escrito acá a mano como el valor esperado):
  ok(igual(r, [{ name: 'polka inventada', count: 100 }, { name: 'vals inventado', count: 42 }, { name: 'justo cinco inventado', count: 5 }]), `getArtistTopTags da lo mismo que en v=312 (${JSON.stringify(r)})`);
  const u = new URL(pedida);
  ok(u.searchParams.get('method') === 'artist.gettoptags' && u.searchParams.get('autocorrect') === '1' && u.searchParams.get('artist') === 'Banda Inventada', 'y con la misma consulta (artist.gettoptags + autocorrect=1)');
  if (tiene(G.urlEtiquetas)) {
    const g = new URL(G.urlEtiquetas('Banda Inventada', 'clave-inventada'));
    const claves = (x) => [...x.searchParams.keys()].sort().join(',');
    ok(g.origin + g.pathname === u.origin + u.pathname && claves(g) === claves(u) && ['method', 'autocorrect', 'artist', 'format'].every((k) => g.searchParams.get(k) === u.searchParams.get(k)) && g.searchParams.get('api_key') === 'clave-inventada',
      `el escaneo pide la MISMA consulta que getArtistTopTags (${claves(g)})`);
  } else ok(false, 'urlEtiquetas existe');
}

// ── 7. Lo que se importa del mapa, sin tocarlo ──────────────────────────────
console.log('7. El texto y la clave del ritmo');
if (tiene(G.claveRitmo) && tiene(G.textoLoQueFalta) && tiene(M.estimarLoQueFalta)) {
  ok(G.claveRitmo('abc') === 'generos_ritmo_v1_abc', `la clave del ritmo lleva el uid (${G.claveRitmo('abc')})`);
  ok(G.NOMBRE_CANDADO === 'fonoteca-generos-escaneo' && G.NOMBRE_CANDADO !== M.NOMBRE_CANDADO, `su propio candado (${G.NOMBRE_CANDADO})`);
  let rt = M.ritmoVacio();
  for (let i = 0; i < 6; i++) { rt = M.sumarPeticion(rt, 200); rt = M.sumarArtista(rt, 1000 + i * 50); }
  const est = M.estimarLoQueFalta({ pendientes: 2000, ritmo: rt });
  const tx = G.textoLoQueFalta(est);
  ok(/^Quedan ~2000 peticiones: entre .+ y .+, según cuántos fallos dé Last\.fm\.$/.test(tx), `el texto habla de Last.fm, no de MusicBrainz: «${tx}»`);
}
{
  // El candado propio: con otro escaneo en marcha, este no corre.
  if (tiene(G.conCandado)) {
    const pedidos = [];
    const locks = { request: async (nombre, op, fn) => { pedidos.push([nombre, op.ifAvailable]); return fn(null); } };
    const r = await G.conCandado(locks, async () => 'corrió');
    ok(r.candado === 'ocupado' && r.valor === null && igual(pedidos, [['fonoteca-generos-escaneo', true]]), `ocupado: no corre, y pide SU candado con ifAvailable (${JSON.stringify(r)} ${JSON.stringify(pedidos)})`);
    const r2 = await G.conCandado({ request: async (n, o, fn) => fn({ name: n }) }, async () => 'corrió');
    ok(r2.candado === 'propio' && r2.valor === 'corrió', 'libre: corre');
    const r3 = await G.conCandado(undefined, async () => 'corrió');
    ok(r3.candado === 'sin-soporte' && r3.valor === 'corrió', 'sin navigator.locks: corre igual');
  } else ok(false, 'conCandado existe');
}

console.log(`\n${fallaron ? 'FALLÓ' : 'OK'} generos-escaneo: ${pasaron} de ${pasaron + fallaron} · ${pasaron + fallaron} asserts`);
if (fallaron) process.exit(1);
