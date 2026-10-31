// tests/rehacer-me-gusta-corte.test.mjs — «Rehacer me gusta» cortado a mitad deja la copia igual byte a byte (v=349, tanda 106)
//
// El botón baja `/me/tracks` entero con `force: true` y solo reemplaza la copia si la descarga llegó al final y cuadra
// (`startLikesLoad` → `saveLikes`, que exige `complete` y la misma época). Acá se corta a mitad por los cuatro caminos
// y se mira la copia sembrada en el doble de IndexedDB: el `sha256` de su valor (con el envoltorio) antes y después, y
// cuántas veces se escribió la clave.
//
//   e0  las 8 páginas con los 400 (conservación): escribe UNA vez, con los 400, y sale el modal del final
//   e1  la página 5 falla siempre con error de red, hasta agotar los reintentos
//   e2  «Detener carga» en la página 5
//   e3  a mitad, la otra pestaña cambia `fonoteca_last_user_id` (la época)
//   e4  las 8 páginas, pero con 399 ítems para un `total` de 400 (`complete: false`)
//
// En e1-e4: el mismo `sha256`, 0 escrituras de la clave, `loadData` devuelve `null` y el handler no muestra el modal.
// Contra el código de antes del botón (sin el handler) se corre `loadData(true)` directo: la parte de la copia tiene que
// dar verde igual (la copia ya estaba protegida); lo que no existe es el modal ni el `null`.
//
// El `api.js` REAL en Node con los dobles de la 98/103/105 (`dobles/loader-otra-cuenta.mjs`, `idb-otra-cuenta-doble.mjs`),
// y el handler y `loadData` REALES sacados del fuente (`dobles/rehacer-dashboard.mjs`). Todo INVENTADO.

import { register } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { sacarDelFuente, armar, crearDom, escapeHtml } from './dobles/rehacer-dashboard.mjs';

register('./dobles/loader-otra-cuenta.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const decir = console.log.bind(console);
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}
const J = JSON.stringify;
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};

// El `sleep(600)` entre páginas y las esperas de los reintentos (800, 1600 ms) a 0. El tope de 3 s del borrado, igual.
const setTimeoutReal = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => setTimeoutReal(f, ms >= 500 && ms !== 3000 ? 0 : ms, ...a);

const lsMapa = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { lsMapa.set(k, String(v)); },
  removeItem: (k) => { lsMapa.delete(k); },
  key: (i) => [...lsMapa.keys()][i] ?? null,
  get length() { return lsMapa.size; },
  clear: () => lsMapa.clear(),
};
globalThis.window ??= globalThis;
globalThis.__DOBLE = { toasts: [] };

const CUENTA_A = 't106-cuenta-a-inventada';
const CUENTA_B = 't106-cuenta-b-inventada';
const COMPLETA = 'all_liked_tracks';
const PARCIAL = 'all_liked_tracks_partial';
const pista = (n) => ({ added_at: `2024-0${1 + (n % 9)}-1${n % 9}T10:00:00Z`, track: { id: `t106inventada${n}`, uri: `spotify:track:t106inventada${n}`, name: `Tema inventado ${n}`, duration_ms: 180000, explicit: false, is_playable: true, track_number: 1, artists: [{ id: `t106ar${n % 5}`, name: `Artista inventado ${n % 5}` }], album: { id: `t106al${n % 9}`, name: `Disco inventado ${n % 9}`, release_date: '2019-05-17', album_type: 'album', total_tracks: 12, images: [] } } });
// La copia: 300 (u0..u299). Spotify: 400 (u100..u499), 8 páginas de 50.
const COPIA = Array.from({ length: 300 }, (_, i) => pista(i));
const SPOTIFY = Array.from({ length: 400 }, (_, i) => pista(100 + i));

const red = { biblioteca: SPOTIFY, total: 400, pedidos: [], alPedir: null };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  const metodo = (opciones.method || 'GET').toUpperCase();
  red.pedidos.push(`${metodo} ${ruta}${u.search}`);
  if (ruta === '/me' && metodo === 'GET') return json({ id: lsMapa.get('fonoteca_last_user_id') || CUENTA_A });
  if (ruta === '/me/tracks' && metodo === 'GET') {
    const limit = +(u.searchParams.get('limit') || 20), offset = +(u.searchParams.get('offset') || 0);
    if (red.alPedir) await red.alPedir(offset);
    const items = red.biblioteca.slice(offset, offset + limit).map((it) => structuredClone(it));
    return json({ items, total: red.total, next: offset + limit < red.total ? 'https://api.spotify.com/v1/me/tracks?más' : null });
  }
  return new Response('{}', { status: 599 });
};

const idb = () => globalThis.__IDB_OTRA;
const sha = () => createHash('sha256').update(J(idb().kv.get(COMPLETA) ?? null)).digest('hex');
const escriturasDe = (k) => idb().escrituras.filter((x) => x === k).length;

const textos = sacarDelFuente(join(raiz, 'src/js/features/dashboard.js'));
const hayHandler = textos.handler.length > 0;
ok(textos.loadData.length > 500, '`loadData` se encuentra en dashboard.js');
let L = {};
try { L = await import(pathToFileURL(join(raiz, 'src/js/util/likes-diferencia.js')).href); } catch { /* sin el módulo */ }
decir(`  (${hayHandler ? 'con el handler del botón' : 'SIN el handler: se corre loadData(true) directo'})`);

let nCaso = 0;
async function correr(nombre, preparar) {
  globalThis.__IDB_OTRA = { kv: new Map(), lecturas: [], intentos: [], borrados: [], escrituras: [], fallanBorrar: new Set(), demoraBorrar: 0 };
  lsMapa.clear();
  lsMapa.set('sp_access_token', 'tok-inventado-t106');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
  lsMapa.set('fonoteca_last_user_id', CUENTA_A);
  idb().kv.set(COMPLETA, { value: structuredClone(COPIA), storedAt: 1_760_000_000_000, expiry: null });
  Object.assign(red, { biblioteca: SPOTIFY, total: 400, pedidos: [], alPedir: null });

  const api = await import(pathToFileURL(join(raiz, 'src/js/api.js')).href + `?caso=t106c${++nCaso}`);
  const dom = crearDom();
  dom.montarDashboard();
  const v = { finales: [], devuelto: [], tiro: null };
  const f = armar(textos, {
    getAllLikedTracks: (...a) => api.getAllLikedTracks(...a),
    getBestAvailableLikes: (...a) => api.getBestAvailableLikes(...a),
    hayCargaDeLikesEnVuelo: () => (typeof api.hayCargaDeLikesEnVuelo === 'function' ? api.hayCargaDeLikesEnVuelo() : false),
    alertModal: async () => true,
    infoModal: async (titulo, html) => { v.finales.push({ titulo, html }); return true; },
    showToast: () => {},
    escapeHtml,
    computeStats: (likes) => ({ n: likes.length }),
    renderDashboard: () => {},
    refreshLastSyncLabel: () => {},
    renderStartScreen: () => {},
    vigilarRuta: () => ({ vigente: () => true, generacion: 1 }),
    diferenciaDeLikes: L.diferenciaDeLikes, urisDeLikes: L.urisDeLikes,
    textoConfirmacionRehacer: L.textoConfirmacionRehacer, textoFinalRehacer: L.textoFinalRehacer,
    document: dom.document,
    console: { log() {}, info() {}, warn() {}, error() {} },
    alLlamarLoadData: (args, p) => { p.then((x) => v.devuelto.push(x), (e) => { v.tiro = e; }); },
  });
  preparar({ dom });
  const antes = sha();
  try {
    if (hayHandler) await f.handleRehacerLikes();
    else await f.loadData(true);
  } catch (e) { v.tiro = e; }
  await new Promise((r) => setTimeoutReal(r, 0));
  const despues = sha();
  const pintado = dom.pintadoEnContenido();
  return {
    nombre, antes, despues, escrituras: escriturasDe(COMPLETA), parcial: escriturasDe(PARCIAL), modal: v.finales.length,
    devuelto: v.devuelto.length ? v.devuelto[0] : undefined, tiro: v.tiro?.message ?? null,
    error: (pintado[pintado.length - 1] || '').match(/<p style="margin:0 0 6px;font-weight:500">\s*([^<]*?)\s*<\/p>/)?.[1] ?? null,
    paginas: red.pedidos.filter((p) => p.startsWith('GET /me/tracks')).length,
    copia: idb().kv.get(COMPLETA)?.value?.length ?? null, final: v.finales[0]?.html ?? null,
  };
}

const filas = [];
// ── e0: conservación ────────────────────────────────────────────────────────────────────────────
decir('· e0) las 8 páginas con los 400 (conservación)');
{
  const r = await correr('e0', () => {});
  filas.push(r);
  ok(r.escrituras === 1 && r.copia === 400, `escribe una vez, con los 400 (${r.escrituras} escritura(s), ${r.copia} en la copia)`);
  ok(r.antes !== r.despues, 'el sha256 cambió (la copia se reemplazó)');
  ok(hayHandler && r.modal === 1, `sale el modal del final (${r.modal})`);
  ok(hayHandler && String(r.final).includes('Listo: 400 me gusta. Tu copia anterior tenía 100 que Spotify ya no tiene y le faltaban 200.'), `el modal cuenta 100 de más y 200 que faltaban (${String(r.final).replace(/<[^>]+>/g, '')})`);
  ok(Array.isArray(r.devuelto) && r.devuelto.length === 400, `loadData devolvió la lista de 400 (${Array.isArray(r.devuelto) ? r.devuelto.length : J(r.devuelto ?? 'undefined')})`);
}

const cortes = [
  ['e1', 'la página 5 falla siempre (red)', ({ dom }) => { red.alPedir = async (offset) => { if (offset === 200) throw new TypeError('Failed to fetch (inventado)'); }; }],
  ['e2', '«Detener carga» en la página 5', ({ dom }) => { red.alPedir = async (offset) => { if (offset === 200) dom.boton('dash-cancel-btn')?.onclick?.(); }; }],
  ['e3', 'la otra pestaña cambia fonoteca_last_user_id a mitad', () => { red.alPedir = async (offset) => { if (offset === 200) lsMapa.set('fonoteca_last_user_id', CUENTA_B); }; }],
  ['e4', '399 ítems para un total de 400', () => { red.biblioteca = SPOTIFY.slice(0, 399); }],
];
for (const [nombre, que, preparar] of cortes) {
  decir(`· ${nombre}) ${que}`);
  const r = await correr(nombre, preparar);
  filas.push(r);
  ok(r.antes === r.despues, `🔴 ${nombre}: el sha256 de la copia es el mismo antes y después (${r.antes.slice(0, 16)}… → ${r.despues.slice(0, 16)}…)`);
  ok(r.escrituras === 0, `🔴 ${nombre}: saveLikes no escribió la clave ${COMPLETA} (${r.escrituras})`);
  ok(r.copia === 300, `${nombre}: la copia sigue con sus 300 (${r.copia})`);
  ok(hayHandler && r.modal === 0, `${nombre}: el handler no muestra el modal del final (${hayHandler ? r.modal : 'no hay handler'})`);
  ok(r.devuelto === null, `${nombre}: loadData devuelve null (${r.devuelto === undefined ? 'undefined' : J(r.devuelto === null ? null : `lista de ${r.devuelto?.length}`)})`);
  ok(!!r.error, `${nombre}: se ve el error de siempre de loadData («${r.error}»)`);
}

decir('\n  la tabla:');
decir('    caso  sha256 antes                                                      sha256 después                                                    escrituras  parcial  modal  páginas  loadData  el cartel');
for (const r of filas) decir(`    ${r.nombre.padEnd(5)} ${r.antes}  ${r.despues}  ${String(r.escrituras).padEnd(10)}  ${String(r.parcial).padEnd(7)}  ${String(r.modal).padEnd(5)}  ${String(r.paginas).padEnd(7)}  ${(r.devuelto === null ? 'null' : r.devuelto === undefined ? 'undefined' : `lista ${r.devuelto.length}`).padEnd(8)}  ${r.error ?? '—'}${r.tiro ? ` · tiró: ${r.tiro}` : ''}`);

decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
