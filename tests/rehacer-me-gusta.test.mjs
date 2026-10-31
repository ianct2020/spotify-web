// tests/rehacer-me-gusta.test.mjs — «Rehacer me gusta desde Spotify», el ítem del ⚙ de #dashboard (v=349, tanda 106)
//
// La caché de me gusta no dice de qué cuenta es cada ítem: si alguna vez entró otra cuenta en este navegador antes de
// v=345, la copia puede tener mezcla vieja, y desde el navegador no se puede saber. El botón vuelve a bajar `/me/tracks`
// entero (`loadData(true)`, el camino de siempre), reemplaza la copia y al final dice cuántas tenía de más y cuántas le
// faltaban, sin prometer qué eran las de más (pueden ser me gusta quitados desde la app de Spotify).
//
// El handler REAL y el `loadData` REAL, sacados del fuente de `dashboard.js` (`dobles/rehacer-dashboard.mjs`), con el
// `api.js` REAL en Node (`dobles/loader-otra-cuenta.mjs`, la IndexedDB doblada) y una Spotify de mentira. Los modales,
// los toasts, el DOM y la vigencia de la ruta son dobles. Todo INVENTADO (el repo es público).
//
// Casos: a) la cuenta y los textos con diferencias · b) sin diferencias · c) sin copia · d) «Cancelar», Escape y clic
// afuera = 0 peticiones y 0 escrituras · e) cada variante del modal final, palabra por palabra, y ninguna dice «cuenta»,
// «mezcl» ni «otra persona» · f) el cartel de la barra · g) dos clics = una descarga · h) salir de la ruta a mitad.

import { register } from 'node:module';
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

// El `sleep(600)` entre páginas y las esperas de los reintentos no aportan nada acá: a 0.
const setTimeoutReal = globalThis.setTimeout;
globalThis.setTimeout = (f, ms, ...a) => setTimeoutReal(f, ms >= 500 && ms !== 3000 ? 0 : ms, ...a);
const tic = () => new Promise((r) => setTimeoutReal(r, 0));
async function hasta(cond, que, vueltas = 2000) {
  for (let i = 0; i < vueltas; i++) { if (cond()) return true; await tic(); }
  decir(`  (se agotó la espera de «${que}»)`);
  return false;
}

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────
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

const CUENTA = 't106-cuenta-a-inventada';
const COMPLETA = 'all_liked_tracks';
const pista = (n) => ({ added_at: `2025-02-${String(1 + (n % 28)).padStart(2, '0')}T10:00:00Z`, track: { id: `t106inventada${n}`, uri: `spotify:track:t106inventada${n}`, name: `Tema inventado ${n}`, duration_ms: 200000, explicit: false, is_playable: true, track_number: 1, artists: [{ id: `t106ar${n % 3}`, name: `Artista inventado ${n % 3}` }], album: { id: `t106al${n % 7}`, name: `Disco inventado ${n % 7}`, release_date: '2020-01-01', album_type: 'album', total_tracks: 10, images: [] } } });
const rango = (desde, hasta) => Array.from({ length: hasta - desde + 1 }, (_, i) => pista(desde + i));

// ── Spotify de mentira ──────────────────────────────────────────────────────────────────────────
// `red.biblioteca`: lo que Spotify tiene. `red.alPedir(offset)` corre antes de contestar cada página de `/me/tracks`.
const red = { biblioteca: [], pedidos: [], alPedir: null };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const ruta = u.pathname.replace(/^\/v1/, '');
  const metodo = (opciones.method || 'GET').toUpperCase();
  red.pedidos.push(`${metodo} ${ruta}${u.search}`);
  if (ruta === '/me' && metodo === 'GET') return json({ id: CUENTA, display_name: 'Inventado' });
  if (ruta === '/me/tracks' && metodo === 'GET') {
    const limit = +(u.searchParams.get('limit') || 20), offset = +(u.searchParams.get('offset') || 0);
    if (red.alPedir) await red.alPedir(offset);
    const items = red.biblioteca.slice(offset, offset + limit).map((it) => structuredClone(it));
    return json({ items, total: red.biblioteca.length, next: offset + limit < red.biblioteca.length ? 'https://api.spotify.com/v1/me/tracks?más' : null });
  }
  return new Response('{}', { status: 599 });
};
const pedidosTracks = () => red.pedidos.filter((p) => p.startsWith('GET /me/tracks'));
const descargas = () => red.pedidos.filter((p) => /^GET \/me\/tracks\?.*offset=0\b/.test(p)).length;

const idb = () => globalThis.__IDB_OTRA;
const escriturasCompleta = () => idb().escrituras.filter((k) => k === COMPLETA).length;
const urisDeLaCopia = () => (idb().kv.get(COMPLETA)?.value || []).map((i) => i.track.uri);

function escenario({ copia = null, biblioteca = [] } = {}) {
  globalThis.__IDB_OTRA = { kv: new Map(), lecturas: [], intentos: [], borrados: [], escrituras: [], fallanBorrar: new Set(), demoraBorrar: 0 };
  lsMapa.clear();
  lsMapa.set('sp_access_token', 'tok-inventado-t106');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3_600_000));
  lsMapa.set('fonoteca_last_user_id', CUENTA);
  if (copia) idb().kv.set(COMPLETA, { value: copia, storedAt: 1_760_000_000_000, expiry: null });
  Object.assign(red, { biblioteca, pedidos: [], alPedir: null });
  globalThis.__DOBLE.toasts.length = 0;
}

// ── Lo que se prueba ─────────────────────────────────────────────────────────────────────────────
const textos = sacarDelFuente(join(raiz, 'src/js/features/dashboard.js'));
ok(textos.loadData.length > 500, '`loadData` se encuentra en dashboard.js');
ok(textos.handler.length > 200, '`handleRehacerLikes` (el handler del ítem) se encuentra en dashboard.js');
let L = {};
try { L = await import(pathToFileURL(join(raiz, 'src/js/util/likes-diferencia.js')).href); } catch { /* sin el módulo: los asserts lo dicen */ }
ok(typeof L.textoFinalRehacer === 'function' && typeof L.textoConfirmacionRehacer === 'function', 'util/likes-diferencia.js trae los textos del botón');

let nCaso = 0;
const ruta = { gen: 1 };
/**
 * Corre el handler REAL con una copia y una Spotify ya puestas por `escenario`. `responder` es lo que contesta la
 * confirmación (true = «Rehacer»; false = «Cancelar», Escape o clic afuera: `alertModal` devuelve `false` en los tres).
 */
async function armarVista({ responder = true } = {}) {
  const api = await import(pathToFileURL(join(raiz, 'src/js/api.js')).href + `?caso=t106b${++nCaso}`);
  const dom = crearDom();
  dom.montarDashboard();
  const vista = { api, dom, confirmaciones: [], finales: [], toasts: [], llamadasDescarga: 0, loadData: [], pintados: [] };
  const deps = {
    getAllLikedTracks: (...a) => { vista.llamadasDescarga++; return api.getAllLikedTracks(...a); },
    getBestAvailableLikes: (...a) => api.getBestAvailableLikes(...a),
    hayCargaDeLikesEnVuelo: () => (typeof api.hayCargaDeLikesEnVuelo === 'function' ? api.hayCargaDeLikesEnVuelo() : false),
    alertModal: (titulo, html, opts) => { vista.confirmaciones.push({ titulo, html, opts }); return typeof responder === 'function' ? responder() : Promise.resolve(responder); },
    infoModal: async (titulo, html, opts) => { vista.finales.push({ titulo, html, opts }); return true; },
    showToast: (m, t) => vista.toasts.push({ m, t }),
    escapeHtml,
    computeStats: (likes) => ({ n: likes.length }),
    renderDashboard: (cont, stats) => vista.pintados.push(stats.n),
    refreshLastSyncLabel: () => {},
    renderStartScreen: () => {},
    vigilarRuta: () => { const g = ruta.gen; return { vigente: () => g === ruta.gen, generacion: g }; },
    diferenciaDeLikes: L.diferenciaDeLikes, urisDeLikes: L.urisDeLikes,
    textoConfirmacionRehacer: L.textoConfirmacionRehacer, textoFinalRehacer: L.textoFinalRehacer,
    document: dom.document,
    console: { log() {}, info() {}, warn() {}, error() {} },
    alLlamarLoadData: (args, p) => { const r = { args, valor: undefined, tiro: null }; vista.loadData.push(r); p.then((v) => { r.valor = v; }, (e) => { r.tiro = e; }); },
  };
  const f = armar(textos, deps);
  vista.f = f;
  vista.apretar = () => (f.handleRehacerLikes ? f.handleRehacerLikes() : Promise.resolve());
  return vista;
}
const texto = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const PROHIBIDAS = [/\bcuenta\b/i, /mezcl/i, /otra persona/i];
const limpio = (s) => PROHIBIDAS.every((re) => !re.test(s));

const CONF_1 = 'Vuelve a bajar todos tus me gusta de Spotify (una página, varios minutos) y reemplaza la copia de este navegador. No cambia nada en tu cuenta de Spotify. Si se corta o la detienes, la copia que ya tienes queda como estaba.';
const CONF_3 = 'Vuelve a bajar todos tus me gusta de Spotify (unas 3 páginas, varios minutos) y reemplaza la copia de este navegador. No cambia nada en tu cuenta de Spotify. Si se corta o la detienes, la copia que ya tienes queda como estaba.';
const CONF_0 = 'Vuelve a bajar todos tus me gusta de Spotify y reemplaza la copia de este navegador. No cambia nada en tu cuenta de Spotify. Si se corta o la detienes, la copia que ya tienes queda como estaba.';
const LINEA_REHACER = 'Si la detienes, la copia que ya tienes queda como estaba.';
const LINEA_SIEMPRE = 'Puedes detener sin problema — la próxima vez retoma desde donde quedó.';

// ── El ítem del ⚙ ─────────────────────────────────────────────────────────────────────────────
decir('· el ítem del ⚙');
{
  const items = [...textos.dash.matchAll(/<button class="dash-cog-item" data-act="([a-z-]+)"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({ act: m[1], html: m[2] }));
  const i = items.findIndex((x) => x.act === 'rehacer');
  ok(i >= 0 && items[i - 1]?.act === 'refresh', `el ítem «rehacer» va justo debajo de «Actualizar datos» (orden: ${items.map((x) => x.act).join(', ')})`);
  ok(i >= 0 && items[i].html === 'Rehacer me gusta desde Spotify <span class="dash-cog-hint">vuelve a bajar todos</span>', `su texto y su pista (${J(items[i]?.html ?? null)})`);
  ok(/else if \(act === 'rehacer'\) handleRehacerLikes\(\);/.test(textos.dash), 'el despacho por `data-act` lleva «rehacer» → handleRehacerLikes()');
}

// ── a) la cuenta, con diferencias ───────────────────────────────────────────────────────────────
decir('· a) copia {u1,u2,u3}, Spotify {u2,u3,u4,u5}');
let vistaA;
{
  escenario({ copia: rango(1, 3), biblioteca: rango(2, 5) });
  const v = vistaA = await armarVista();
  await v.apretar();
  ok(v.confirmaciones.length === 1 && v.confirmaciones[0].titulo === 'Rehacer me gusta desde Spotify', `una confirmación, «Rehacer me gusta desde Spotify» (${v.confirmaciones.length})`);
  ok(texto(v.confirmaciones[0]?.html) === CONF_1, `la confirmación con P = 1, en singular: «${texto(v.confirmaciones[0]?.html)}»`);
  ok(v.confirmaciones[0]?.opts?.confirmText === 'Rehacer' && v.confirmaciones[0]?.opts?.cancelText === 'Cancelar', `los botones «Rehacer» y «Cancelar» (${J(v.confirmaciones[0]?.opts ?? null)})`);
  ok(v.finales.length === 1, `sale el modal del final (${v.finales.length})`);
  const fin = texto(v.finales[0]?.html);
  ok(fin === 'Listo: 4 me gusta. Tu copia anterior tenía 1 que Spotify ya no tiene y le faltaban 2. Si quitaste un me gusta desde la app de Spotify, puede ser ese.', `el modal: «${fin}»`);
  ok(fin.includes('tenía 1 que Spotify ya no tiene y le faltaban 2'), 'dice «tenía 1 que Spotify ya no tiene y le faltaban 2»');
  ok(escriturasCompleta() === 1 && J(urisDeLaCopia()) === J(rango(2, 5).map((i) => i.track.uri)), `saveLikes guardó los cuatro de Spotify, una vez (${escriturasCompleta()} · ${urisDeLaCopia().length})`);
  ok(v.loadData.length === 1 && v.loadData[0].args[0] === true, `por loadData(true), una vez (${J(v.loadData.map((x) => x.args))})`);
  ok(Array.isArray(v.loadData[0]?.valor) && v.loadData[0].valor.length === 4, `loadData devolvió la lista (${v.loadData[0]?.valor?.length ?? J(v.loadData[0]?.valor ?? null)})`);
  ok(descargas() === 1 && pedidosTracks().length === 1, `una página de /me/tracks (${pedidosTracks().length})`);
}
decir('· a) con una copia de 120 (P = 3), y «Cancelar»');
{
  escenario({ copia: rango(1, 120), biblioteca: rango(1, 120) });
  const v = await armarVista({ responder: false });
  await v.apretar();
  ok(texto(v.confirmaciones[0]?.html) === CONF_3, `la confirmación con P = 3: «${texto(v.confirmaciones[0]?.html)}»`);
}

// ── b) sin diferencias ──────────────────────────────────────────────────────────────────────────
decir('· b) sin diferencias');
{
  escenario({ copia: rango(1, 3), biblioteca: rango(1, 3) });
  const v = await armarVista();
  await v.apretar();
  ok(texto(v.finales[0]?.html) === 'Listo: 3 me gusta. Tu copia coincidía con Spotify.', `«${texto(v.finales[0]?.html)}»`);
}

// ── c) sin copia ────────────────────────────────────────────────────────────────────────────────
decir('· c) sin copia anterior');
{
  escenario({ copia: null, biblioteca: rango(1, 3) });
  const v = await armarVista();
  await v.apretar();
  ok(texto(v.confirmaciones[0]?.html) === CONF_0, `la confirmación sin el paréntesis: «${texto(v.confirmaciones[0]?.html)}»`);
  ok(texto(v.finales[0]?.html) === 'Listo: 3 me gusta. No había una copia anterior con la que comparar.', `«${texto(v.finales[0]?.html)}»`);
  ok(escriturasCompleta() === 1, `y guardó lo bajado (${escriturasCompleta()})`);
}

// ── d) «Cancelar», Escape y clic afuera ─────────────────────────────────────────────────────────
for (const como of ['«Cancelar»', 'Escape', 'clic afuera']) {
  decir(`· d) ${como} (alertModal devuelve false)`);
  escenario({ copia: rango(1, 3), biblioteca: rango(2, 5) });
  const antes = J(idb().kv.get(COMPLETA));
  const v = await armarVista({ responder: false });
  await v.apretar();
  ok(v.confirmaciones.length === 1, `${como}: la confirmación salió (${v.confirmaciones.length})`);
  ok(v.llamadasDescarga === 0 && v.loadData.length === 0 && pedidosTracks().length === 0, `${como}: 0 llamadas a getAllLikedTracks, 0 a loadData y 0 peticiones a /me/tracks (${v.llamadasDescarga} · ${v.loadData.length} · ${pedidosTracks().length})`);
  ok(idb().escrituras.length === 0 && J(idb().kv.get(COMPLETA)) === antes, `${como}: 0 escrituras en IndexedDB y la copia igual (${idb().escrituras.length})`);
  ok(v.finales.length === 0 && v.dom.pintadoEnContenido().length === 0, `${como}: ni modal final ni barra`);
}

// ── e) las variantes del modal final, palabra por palabra ──────────────────────────────────────
decir('· e) cada variante del modal final');
{
  const T = L.textoFinalRehacer || (() => '');
  const casos = [
    [{ n: 4, deMas: 1, faltaban: 2, habiaCopia: true }, 'Listo: 4 me gusta. Tu copia anterior tenía 1 que Spotify ya no tiene y le faltaban 2. Si quitaste un me gusta desde la app de Spotify, puede ser ese.'],
    [{ n: 130, deMas: 20, faltaban: 30, habiaCopia: true }, 'Listo: 130 me gusta. Tu copia anterior tenía 20 que Spotify ya no tiene y le faltaban 30. Si quitaste me gusta desde la app de Spotify, esos cuentan entre los 20.'],
    [{ n: 7, deMas: 2, faltaban: 1, habiaCopia: true }, 'Listo: 7 me gusta. Tu copia anterior tenía 2 que Spotify ya no tiene y le faltaba 1. Si quitaste me gusta desde la app de Spotify, esos cuentan entre los 2.'],
    [{ n: 7, deMas: 1, faltaban: 1, habiaCopia: true }, 'Listo: 7 me gusta. Tu copia anterior tenía 1 que Spotify ya no tiene y le faltaba 1. Si quitaste un me gusta desde la app de Spotify, puede ser ese.'],
    [{ n: 9, deMas: 0, faltaban: 5, habiaCopia: true }, 'Listo: 9 me gusta. A tu copia anterior le faltaban 5.'],
    [{ n: 9, deMas: 0, faltaban: 1, habiaCopia: true }, 'Listo: 9 me gusta. A tu copia anterior le faltaba 1.'],
    [{ n: 9, deMas: 3, faltaban: 0, habiaCopia: true }, 'Listo: 9 me gusta. Tu copia anterior tenía 3 que Spotify ya no tiene. Si quitaste me gusta desde la app de Spotify, esos cuentan entre los 3.'],
    [{ n: 9, deMas: 1, faltaban: 0, habiaCopia: true }, 'Listo: 9 me gusta. Tu copia anterior tenía 1 que Spotify ya no tiene. Si quitaste un me gusta desde la app de Spotify, puede ser ese.'],
    [{ n: 9, deMas: 0, faltaban: 0, habiaCopia: true }, 'Listo: 9 me gusta. Tu copia coincidía con Spotify.'],
    [{ n: 9, deMas: 0, faltaban: 9, habiaCopia: false }, 'Listo: 9 me gusta. No había una copia anterior con la que comparar.'],
    [{ n: 12345, deMas: 10000, faltaban: 23456, habiaCopia: true }, 'Listo: 12.345 me gusta. Tu copia anterior tenía 10.000 que Spotify ya no tiene y le faltaban 23.456. Si quitaste me gusta desde la app de Spotify, esos cuentan entre los 10.000.'],
  ];
  for (const [args, esperado] of casos) {
    const s = T(args);
    ok(s === esperado, `${J(args)} → «${s}»`);
    ok(limpio(s), `sin «cuenta» (palabra), «mezcl» ni «otra persona»: ${J(args)}`);
  }
  ok(limpio(texto(vistaA?.finales[0]?.html)) && limpio(vistaA?.finales[0]?.titulo ?? ''), 'el modal que salió en a), título incluido, tampoco');
  // Las confirmaciones sí dicen «tu cuenta de Spotify» (no es el modal del final): de P = 0 a P = 186
  const C = L.textoConfirmacionRehacer || (() => '');
  ok(C(9281) === CONF_1.replace('(una página, varios minutos)', '(unas 186 páginas, varios minutos)'), `con 9.281 me gusta, «unas 186 páginas» («${C(9281).slice(0, 80)}…»)`);
  ok(C(50) === CONF_1 && C(51) === CONF_1.replace('(una página', '(unas 2 páginas') && C(0) === CONF_0, 'P = ceil(L / 50): 50 → una página, 51 → 2, 0 → sin paréntesis');
}

// ── f) el cartel de la barra ────────────────────────────────────────────────────────────────────
decir('· f) el cartel de la barra');
{
  const conBoton = vistaA?.dom.pintadoEnContenido()[0] || '';
  ok(conBoton.includes(LINEA_REHACER) && !conBoton.includes('retoma'), `con el botón: «${LINEA_REHACER}»`);
  ok(conBoton.includes('Detener carga') && conBoton.includes('dash-load-bar'), 'con la barra y «Detener carga» de siempre');

  escenario({ copia: rango(1, 3), biblioteca: rango(2, 5) });
  let v = await armarVista();
  await v.f.loadData(false);
  const usar = v.dom.pintadoEnContenido()[0] || '';
  ok(usar.includes(LINEA_SIEMPRE) && !usar.includes(LINEA_REHACER), '«Usar los de la caché» (loadData(false)): la línea de siempre');
  escenario({ copia: rango(1, 3), biblioteca: rango(2, 5) });
  v = await armarVista();
  await v.f.loadData(true);
  const forzada = v.dom.pintadoEnContenido()[0] || '';
  ok(forzada.includes(LINEA_SIEMPRE) && !forzada.includes(LINEA_REHACER), 'loadData(true) sin el botón («Actualizar datos» sin caché): la línea de siempre');
  // Todos los llamadores de loadData del archivo: solo el handler pasa `rehacer`.
  const llamadas = [...textos.dash.matchAll(/loadData\(([^)]*)\)/g)].filter((m) => !/^forceRefresh/.test(m[1]));
  const conRehacer = llamadas.filter((m) => /rehacer/.test(m[1]));
  ok(llamadas.length >= 6 && conRehacer.length === 1 && textos.handler.includes(conRehacer[0][0]), `de ${llamadas.length} llamadas a loadData, solo la del handler pasa «rehacer» (${conRehacer.map((m) => m[0]).join(' | ') || 'ninguna'})`);
  ok(/getElementById\('dash-start-btn'\)\.onclick = \(\) => loadData\(false\);/.test(textos.dash), '«Usar los de la caché» sigue siendo loadData(false)');
}

// ── g) dos clics = una descarga ─────────────────────────────────────────────────────────────────
decir('· g) dos clics en el ítem, uno con el modal abierto y otro con la descarga en marcha');
{
  escenario({ copia: rango(1, 3), biblioteca: rango(1, 120) });
  let soltar;
  const v = await armarVista({ responder: () => new Promise((r) => { soltar = r; }) });
  const primero = v.apretar();
  await hasta(() => v.confirmaciones.length === 1, 'la confirmación');
  await v.apretar();                         // con el modal abierto
  let enPagina2;
  const pagina2 = new Promise((r) => { enPagina2 = r; });
  red.alPedir = async (offset) => { if (offset === 50) { enPagina2(); await tic(); } };
  soltar?.(true);
  await Promise.race([pagina2, new Promise((r) => setTimeoutReal(r, 2000))]);
  await v.apretar();                         // con la descarga en marcha
  await primero;
  ok(v.confirmaciones.length === 1, `una sola confirmación (${v.confirmaciones.length})`);
  ok(descargas() === 1 && v.loadData.length === 1 && v.llamadasDescarga === 1, `una sola descarga: ${descargas()} desde el offset 0, ${v.loadData.length} loadData, ${v.llamadasDescarga} getAllLikedTracks`);
  ok(v.toasts.length === 2 && v.toasts.every((t) => t.m === 'Ya se están descargando tus me gusta. Espera a que termine.' && t.t === 'info'), `los dos clics de más, un toast cada uno (${J(v.toasts)})`);
  ok(v.finales.length === 1 && escriturasCompleta() === 1, `un modal final y una escritura (${v.finales.length} · ${escriturasCompleta()})`);
  // «Rehacer» dos veces en el modal: el `alertModal` real resuelve una sola vez.
  const comp = (await import('node:fs')).readFileSync(join(raiz, 'src/js/ui/components.js'), 'utf8');
  ok(/function alertModal[\s\S]*?const done = val => \{ if \(resolved\) return;/.test(comp), '«Rehacer» dos veces: el `done` de alertModal sale si ya resolvió (components.js)');
}
decir('· g) con una carga de me gusta de otra vista ya en vuelo');
{
  escenario({ copia: null, biblioteca: rango(1, 120) });
  const v = await armarVista();
  let enPagina2;
  const pagina2 = new Promise((r) => { enPagina2 = r; });
  red.alPedir = async (offset) => { if (offset === 50) { enPagina2(); await tic(); } };
  const otraVista = v.api.getAllLikedTracks(null, {});
  await Promise.race([pagina2, new Promise((r) => setTimeoutReal(r, 2000))]);
  await v.apretar();
  await otraVista.catch(() => {});
  ok(v.confirmaciones.length === 0 && v.loadData.length === 0, `no pregunta ni descarga (${v.confirmaciones.length} · ${v.loadData.length})`);
  ok(descargas() === 1, `una sola descarga, la de la otra vista (${descargas()})`);
  ok(v.toasts.length === 1 && v.toasts[0].m === 'Ya se están descargando tus me gusta. Espera a que termine.', `el toast lo dice (${J(v.toasts)})`);
}

// ── h) la ruta deja de estar vigente mientras baja ─────────────────────────────────────────────
decir('· h) salir de la ruta mientras baja (la descarga sale bien)');
{
  escenario({ copia: rango(1, 3), biblioteca: rango(1, 160) });
  const v = await armarVista();
  let desde = null;
  red.alPedir = async (offset) => { if (offset === 50 && desde == null) { desde = v.dom.cambiarDeRuta(); ruta.gen++; } };
  await v.apretar();
  ok(desde != null, 'la ruta cambió durante la página 2');
  ok(v.finales.length === 0, `al terminar, no hay modal (${v.finales.length})`);
  const enDoc = desde == null ? [] : v.dom.escriturasEnElDocumento(desde);
  ok(enDoc.length === 0, `0 escrituras en el DOM de la vista nueva (${J(enDoc)})`);
  // Lo que hace hoy loadData al salir (no se cambia): la descarga sigue hasta el final y guarda.
  ok(pedidosTracks().length === 4 && escriturasCompleta() === 1, `la descarga siguió y guardó: ${pedidosTracks().length} páginas, ${escriturasCompleta()} escritura`);
}
decir('· h) salir de la ruta mientras baja (la descarga se corta)');
{
  escenario({ copia: rango(1, 3), biblioteca: rango(1, 160) });
  const antes = J(idb().kv.get(COMPLETA));
  const v = await armarVista();
  let desde = null;
  red.alPedir = async (offset) => {
    if (offset === 50 && desde == null) { desde = v.dom.cambiarDeRuta(); ruta.gen++; }
    if (offset === 100) throw new TypeError('Failed to fetch (inventado)');
  };
  let tiro = null;
  await v.apretar().catch((e) => { tiro = e; });
  ok(v.finales.length === 0, `no hay modal (${v.finales.length})`);
  const enDoc = desde == null ? [] : v.dom.escriturasEnElDocumento(desde);
  ok(enDoc.length === 0, `0 escrituras en el DOM de la vista nueva (${J(enDoc)})`);
  ok(escriturasCompleta() === 0 && J(idb().kv.get(COMPLETA)) === antes, 'la copia, igual');
  decir(`    (lo que pasa hoy, sin cambiar: loadData ${v.loadData[0]?.tiro ? `TIRA «${v.loadData[0].tiro.message}»` : `devuelve ${J(v.loadData[0]?.valor ?? null)}`}; el handler ${tiro ? `tira «${tiro.message}»` : 'termina sin tirar'})`);
}

decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
