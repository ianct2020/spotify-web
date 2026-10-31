// tests/dashboard-salir-a-mitad.test.mjs — `loadData` de #dashboard: salir a mitad y el cartel de error (v=350, tanda 107)
//
// T107a: salir de «Dashboard» mientras la descarga de los me gusta falla tiraba «Cannot set properties of null (setting
// 'onclick')»: `loadData` escribía en `#dash-content` ya desenganchado y después buscaba `dash-retry-btn` en el documento.
// Ahora, después de cada espera, si `#dash-content` ya no está en el documento, no escribe nada y sale (la lista si la
// descarga salió bien, `null` si no), y los botones se buscan dentro de `#dash-content`.
//
// T107b: con «Rehacer» el cartel no promete que se retoma (con `force` un corte no se retoma) y no lleva «Reintentar»; sin
// «Rehacer», el cartel es byte a byte el de 37d71c2. Y pintar ya no es descargar: si `renderDashboard` tira después de una
// descarga buena, el cartel lo dice y `loadData` devuelve la lista (el modal de «Rehacer» sale y dice la verdad).
//
// El `loadData` REAL (y el handler REAL de «Rehacer») sacados del fuente con `dobles/rehacer-dashboard.mjs`, sobre su DOM de
// mentira. La descarga y la caché son dobles: lo que se prueba es lo que `loadData` escribe y devuelve, no `api.js`.
// `DASHBOARD_FUENTE=<ruta>` apunta el test a otro fuente (así se ve el rojo contra 37d71c2). Todo INVENTADO.
//
//   s1 «Descargar» (loadData(false)) · la descarga falla después de salir   s4 se sale durante getBestAvailableLikes del catch
//   s2 lo mismo con loadData(true, { rehacer: true })                       s5 conservación sin salir (falla y sale bien)
//   s3 la descarga sale bien después de salir
//   c1 el cartel con «Rehacer» · c2 sin «Rehacer», byte a byte el de 37d71c2 · c3 pintar tira · c4 c3 con el handler REAL

import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { sacarDelFuente, armar, crearDom, escapeHtml } from './dobles/rehacer-dashboard.mjs';

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

const rechazos = [];
process.on('unhandledRejection', (e) => { rechazos.push(e); });
const tic = () => new Promise((r) => setTimeout(r, 0));
const tics = async (n = 10) => { for (let i = 0; i < n; i++) await tic(); };
const diferido = () => { let res, rej; const p = new Promise((a, b) => { res = a; rej = b; }); return { p, res, rej }; };

const pista = (n) => ({ added_at: '2025-03-01T10:00:00Z', track: { id: `t107inventada${n}`, uri: `spotify:track:t107inventada${n}`, name: `Tema inventado ${n}`, duration_ms: 200000, artists: [{ id: `t107ar${n % 3}`, name: `Artista inventado ${n % 3}` }], album: { id: `t107al${n % 5}`, name: `Disco inventado ${n % 5}`, release_date: '2021-01-01', images: [] } } });
const rango = (d, h) => Array.from({ length: h - d + 1 }, (_, i) => pista(d + i));

const FUENTE = process.env.DASHBOARD_FUENTE || join(raiz, 'src/js/features/dashboard.js');
const textos = sacarDelFuente(FUENTE);
decir(`· fuente: ${process.env.DASHBOARD_FUENTE ? FUENTE : 'src/js/features/dashboard.js'}`);
ok(textos.loadData.length > 500, '`loadData` se encuentra en el fuente');
ok(textos.handler.length > 200, '`handleRehacerLikes` se encuentra en el fuente');

// El de 37d71c2, para c2 (sacado con `git show`).
let textosViejos = null;
try {
  const dir = mkdtempSync(join(tmpdir(), 't107-'));
  const ruta = join(dir, 'dashboard-37d71c2.js');
  writeFileSync(ruta, execFileSync('git', ['-C', raiz, 'show', '37d71c2:src/js/features/dashboard.js'], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  textosViejos = sacarDelFuente(ruta);
} catch { /* sin git: c2 lo dice */ }

let L = {};
try { L = await import(pathToFileURL(join(raiz, 'src/js/util/likes-diferencia.js')).href); } catch { /* el assert de c4 lo dice */ }

/**
 * Arma `loadData` (y el handler) con dobles. `descarga(opts)` es lo que hace `getAllLikedTracks`; `mejores()` lo que
 * devuelve `getBestAvailableLikes`; `pintar(cont, stats)` lo que hace `renderDashboard` (puede tirar).
 */
function armarVista({ descarga, mejores = async () => ({ items: [] }), pintar = null, fuente = textos } = {}) {
  const dom = crearDom();
  dom.montarDashboard();
  const v = { dom, pintados: [], avisos: [], llamadas: [], finales: [], confirmaciones: [] };
  const deps = {
    getAllLikedTracks: (cb, opts) => descarga(opts),
    getBestAvailableLikes: () => mejores(),
    hayCargaDeLikesEnVuelo: () => false,
    alertModal: async (titulo, html, opts) => { v.confirmaciones.push({ titulo, html, opts }); return true; },
    infoModal: async (titulo, html, opts) => { v.finales.push({ titulo, html, opts }); return true; },
    showToast: () => {},
    escapeHtml,
    computeStats: (likes) => ({ n: likes.length }),
    renderDashboard: (cont, stats) => { if (pintar) pintar(cont, stats); v.pintados.push(stats.n); },
    refreshLastSyncLabel: () => {},
    renderStartScreen: () => {},
    vigilarRuta: () => ({ vigente: () => true, generacion: 1 }),
    diferenciaDeLikes: L.diferenciaDeLikes, urisDeLikes: L.urisDeLikes,
    textoConfirmacionRehacer: L.textoConfirmacionRehacer, textoFinalRehacer: L.textoFinalRehacer,
    document: dom.document,
    console: { log() {}, info() {}, warn: (...a) => v.avisos.push(a), error() {} },
    alLlamarLoadData: (args, p) => { const r = { args, valor: undefined, tiro: null }; v.llamadas.push(r); p.then((x) => { r.valor = x; }, (e) => { r.tiro = e; }); },
  };
  v.f = armar(fuente, deps);
  return v;
}
const texto = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const ultimo = (v) => v.dom.pintadoEnContenido().at(-1) || '';
async function correr(p) { let valor, tiro = null; try { valor = await p; } catch (e) { tiro = e; } await tics(); return { valor, tiro }; }

const CONSERVA = 'El progreso descargado se conserva: al reintentar se retoma donde se quedó.';
const LINEA_REHACER = 'La copia que ya tenías queda como estaba. Para volver a intentarlo, usa «Rehacer me gusta desde Spotify» en el ⚙.';
const PINTAR = 'Se han descargado tus me gusta, pero no se ha podido pintar el panel.';
const NO_DESCARGA = 'No se han podido descargar los me gusta.';

// ── T107a ──────────────────────────────────────────────────────────────────────────────────────
for (const [nombre, args] of [['s1) «Descargar de Spotify», loadData(false)', [false]], ['s2) «Rehacer», loadData(true, { rehacer: true })', [true, { rehacer: true }]]]) {
  decir(`· ${nombre}: la descarga falla después de salir de la ruta`);
  const d = diferido();
  const v = armarVista({ descarga: () => d.p, mejores: async () => ({ items: rango(1, 4) }) });
  const r0 = rechazos.length;
  const p = v.f.loadData(...args);
  await tic();
  const desde = v.dom.cambiarDeRuta();
  d.rej(new TypeError('Failed to fetch (inventado)'));
  const { valor, tiro } = await correr(p);
  ok(!tiro, `loadData no tira (${tiro ? `tira «${tiro.message}»` : 'no tira'})`);
  ok(valor === null, `devuelve null (${J(valor === undefined ? 'undefined' : Array.isArray(valor) ? `lista de ${valor.length}` : valor)})`);
  const enDoc = v.dom.escriturasEnElDocumento(desde);
  ok(enDoc.length === 0, `0 escrituras en el DOM nuevo (${enDoc.length})`);
  ok(rechazos.length === r0, `ningún rechazo sin atrapar (${rechazos.length - r0})`);
}

decir('· s3) la descarga sale bien después de salir de la ruta');
{
  const d = diferido();
  const v = armarVista({ descarga: () => d.p });
  const p = v.f.loadData(false);
  await tic();
  const desde = v.dom.cambiarDeRuta();
  d.res(rango(1, 6));
  const { valor, tiro } = await correr(p);
  ok(!tiro && Array.isArray(valor) && valor.length === 6, `devuelve la lista (${tiro ? `tira «${tiro.message}»` : Array.isArray(valor) ? valor.length : J(valor)})`);
  const enDoc = v.dom.escriturasEnElDocumento(desde);
  ok(enDoc.length === 0, `0 escrituras en el DOM nuevo (${enDoc.length})`);
}

decir('· s4) se sale durante el await de getBestAvailableLikes() del catch');
{
  const m = diferido();
  const v = armarVista({ descarga: async () => { throw new TypeError('Failed to fetch (inventado)'); }, mejores: () => m.p });
  const r0 = rechazos.length;
  const p = v.f.loadData(false);
  await tics(3);
  const desde = v.dom.cambiarDeRuta();
  m.res({ items: rango(1, 4) });
  const { valor, tiro } = await correr(p);
  ok(!tiro, `loadData no tira (${tiro ? `tira «${tiro.message}»` : 'no tira'})`);
  ok(valor === null, `devuelve null (${J(valor ?? 'undefined')})`);
  const enDoc = v.dom.escriturasEnElDocumento(desde);
  ok(enDoc.length === 0, `0 escrituras en el DOM nuevo (${enDoc.length})`);
  ok(rechazos.length === r0, `ningún rechazo sin atrapar (${rechazos.length - r0})`);
}

decir('· s5) conservación, sin salir: la que falla pinta el cartel de hoy y la que sale bien pinta el panel');
{
  const v = armarVista({ descarga: async () => { throw new TypeError('Failed to fetch (inventado)'); }, mejores: async () => ({ items: rango(1, 4) }) });
  const { valor, tiro } = await correr(v.f.loadData(false));
  ok(!tiro && valor === null, `falla: devuelve null sin tirar (${tiro ? tiro.message : J(valor)})`);
  const cartel = ultimo(v);
  ok(cartel.includes(NO_DESCARGA) && cartel.includes(CONSERVA), 'el cartel de hoy («No se han podido descargar…» y la conservación)');
  ok(v.pintados.length === 1 && v.pintados[0] === 4, `debajo, la caché de rescate (${J(v.pintados)})`);
  const retry = v.dom.boton('dash-retry-btn');
  ok(retry && typeof retry.onclick === 'function', '«Reintentar» tiene su onclick');
  const antes = v.llamadas.length;
  retry?.onclick?.();
  ok(v.llamadas.length === antes + 1 && J(v.llamadas.at(-1)?.args) === J([false]), `«Reintentar» llama a loadData(false) (${J(v.llamadas.slice(antes).map((x) => x.args))})`);
  await tics();
  ok(typeof v.dom.boton('dash-back-btn')?.onclick === 'function', '«Volver a empezar» tiene su onclick');

  const b = armarVista({ descarga: async () => rango(1, 7) });
  const r = await correr(b.f.loadData(false));
  ok(!r.tiro && Array.isArray(r.valor) && r.valor.length === 7, `sale bien: devuelve la lista (${r.valor?.length ?? J(r.valor)})`);
  ok(b.pintados.length === 1 && b.pintados[0] === 7, `pinta el panel (${J(b.pintados)})`);
}

// ── T107b ──────────────────────────────────────────────────────────────────────────────────────
decir('· c1) con «Rehacer» y la descarga fallando');
{
  const v = armarVista({ descarga: async () => { throw new TypeError('Failed to fetch (inventado)'); }, mejores: async () => ({ items: rango(1, 4) }) });
  await correr(v.f.loadData(true, { rehacer: true }));
  const cartel = ultimo(v);
  decir(`    (el cartel: «${texto(cartel.split('<div id="dash-rescate">')[0])}»)`);
  ok(cartel.includes(LINEA_REHACER), `dice «${LINEA_REHACER}»`);
  ok(!/retoma/.test(cartel), 'no dice «retoma»');
  ok(!cartel.includes('dash-retry-btn') && !/>Reintentar</.test(cartel), 'no hay botón «Reintentar»');
  ok(cartel.includes('id="dash-back-btn"') && typeof v.dom.boton('dash-back-btn')?.onclick === 'function', '«Volver a empezar» sí, con su onclick');
}

decir('· c2) sin «Rehacer»: el cartel, byte a byte el de 37d71c2');
{
  ok(!!textosViejos && textosViejos.loadData.length > 500, 'el loadData de 37d71c2 sale de `git show`');
  const casos = [
    ['«Descargar de Spotify» (loadData(false))', [false]],
    ['«Usar los de la caché» (loadData(false))', [false]],
    ['«Actualizar datos» (loadData(true))', [true]],
  ];
  for (const [quien, args] of casos) {
    for (const [como, msj, items] of [['red', 'Failed to fetch (inventado)', rango(1, 4)], ['cancelada', 'Descarga cancelada (inventado)', []]]) {
      const correrCon = async (fuente) => {
        const v = armarVista({ fuente, descarga: async () => { throw new Error(msj); }, mejores: async () => ({ items }) });
        await correr(v.f.loadData(...args));
        return ultimo(v);
      };
      const hoy = await correrCon(textos);
      const viejo = textosViejos ? await correrCon(textosViejos) : null;
      ok(viejo != null && hoy === viejo && hoy.length > 200, `${quien}, ${como}: igual byte a byte (${hoy.length} contra ${viejo?.length ?? 'sin 37d71c2'})`);
    }
  }
}

decir('· c3) la descarga sale bien y renderDashboard tira');
{
  const v = armarVista({ descarga: async () => rango(1, 5), mejores: async () => ({ items: rango(1, 5) }), pintar: () => { throw new TypeError('pintar inventado'); } });
  const { valor, tiro } = await correr(v.f.loadData(false));
  const cartel = ultimo(v);
  decir(`    (lo que se ve: «${texto(cartel).slice(0, 200)}»)`);
  ok(!cartel.includes(NO_DESCARGA), 'no dice «No se han podido descargar»');
  ok(cartel.includes(PINTAR) && cartel.includes('pintar inventado'), `dice «${PINTAR}» con el error`);
  ok(v.avisos.some((a) => String(a[0]).startsWith('[dashboard]')), `console.warn con «[dashboard]» (${J(v.avisos.map((a) => String(a[0])))})`);
  ok(!tiro && Array.isArray(valor) && valor.length === 5, `loadData devuelve la lista (${tiro ? tiro.message : valor?.length ?? J(valor)})`);
}

decir('· c4) el handler REAL de «Rehacer» con el caso c3');
{
  ok(typeof L.textoFinalRehacer === 'function', 'util/likes-diferencia.js trae los textos');
  const v = armarVista({ descarga: async () => rango(2, 5), mejores: async () => ({ items: rango(1, 3) }), pintar: () => { throw new TypeError('pintar inventado'); } });
  let tiro = null;
  try { await v.f.handleRehacerLikes(); } catch (e) { tiro = e; }
  await tics();
  ok(!tiro, `el handler no tira (${tiro?.message ?? 'no tira'})`);
  ok(v.finales.length === 1, `sale el modal del final (${v.finales.length})`);
  const fin = texto(v.finales[0]?.html);
  ok(fin === 'Listo: 4 me gusta. Tu copia anterior tenía 1 que Spotify ya no tiene y le faltaban 2. Si quitaste un me gusta desde la app de Spotify, puede ser ese.', `su texto es el de hoy: «${fin}»`);
}

decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
