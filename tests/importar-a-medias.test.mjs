// tests/importar-a-medias.test.mjs — «Importar todo» que se corta a mitad también recarga (tanda 81, v=336)
//
// Hasta v=335, en `handleImportTodo` (`features/dashboard.js`) el `if (!r.ok) { …showToast…; return; }` iba ANTES del
// modal obligado y del `location.reload()`. Tres salidas de `aplicarPlan` (`api.js`) con `ok: false` ya habían escrito:
//   1. la cuota corta el bucle de `localStorage` (IndexedDB entera más N claves);
//   2. IndexedDB escribió y después falló la relectura de `localStorage`;
//   3. IndexedDB escribió y la tercera decisión salió con un rechazo (acá: `fonoteca_last_user_id` cambió en el medio).
// En las tres `aplicarPlan` ya avisó a las OTRAS pestañas, pero ESTA no recargaba. Lo que se vigila:
//   · con escrituras a medias: el modal obligado («La copia se ha importado a medias», sin «Cerrar») y la recarga;
//   · con 0 escrituras (IndexedDB que tira, la segunda red): como antes, toast rojo y sin recarga;
//   · recargar y avisar a las otras pestañas salen de la MISMA función (`importEscribio`, `util/copia-importar.js`);
//   · la línea de los ocultos nombra las siete vistas y los dos clics, y está en el modal de CONFIRMACIÓN.
//
// 🔴 Todo INVENTADO (uid, claves, valores). El `api.js` REAL con `idb.js` y `toast.js` doblados (`dobles/loader-copia.mjs`),
// un `localStorage` y un `BroadcastChannel` de mentira, y el `handleImportTodo` REAL: su texto sacado de
// `dashboard.js` y armado con dobles de `alertModal`, `showToast`, `location`… (el molde de `versions-faltan-datos`).
// Contra v=335: los tres casos a medias terminan en un toast, sin modal y sin recarga.

import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

register('./dobles/loader-copia.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; console.log(`  ✓ ${nombre}`); }
  else { fallaron++; console.log(`  ✗ ${nombre}`); }
}
const fuente = (p) => (existsSync(join(raiz, p)) ? readFileSync(join(raiz, p), 'utf8') : '');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const J = JSON.stringify;

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────
const lsMapa = new Map();
// `fallaEn`: la clave cuyo `setItem` tira (la cuota). `alReleer`: se corre UNA vez en la primera lectura de
// `localStorage` después de que IndexedDB escribió (es la relectura de `aplicarPlan`, la del paso 4).
const lsCtl = { fallaEn: null, alReleer: null };
const idbD = () => globalThis.__IDB_COPIA;
function alLeer() {
  if (lsCtl.alReleer && idbD().escrituras.length) { const f = lsCtl.alReleer; lsCtl.alReleer = null; f(); }
}
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { if (k === lsCtl.fallaEn) { const e = new Error('QuotaExceededError (doble)'); e.name = 'QuotaExceededError'; throw e; } lsMapa.set(k, String(v)); },
  removeItem: (k) => { lsMapa.delete(k); },
  key: (i) => { alLeer(); return [...lsMapa.keys()][i] ?? null; },
  get length() { return lsMapa.size; },
  clear: () => lsMapa.clear(),
};
globalThis.window ??= globalThis;
const mensajes = [];
const canales = [];
globalThis.BroadcastChannel = class {
  constructor(nombre) { this.nombre = nombre; this.oyentes = []; canales.push(this); }
  postMessage(m) { mensajes.push({ canal: this.nombre, ...structuredClone(m) }); for (const c of canales) if (c !== this && c.nombre === this.nombre) c.oyentes.forEach((f) => f({ data: structuredClone(m) })); }
  addEventListener(t, f) { if (t === 'message') this.oyentes.push(f); }
};
const UID = 't81-uid-inventado';
globalThis.fetch = async (url) => {
  if (/\/v1\/me$/.test(String(url))) return new Response(JSON.stringify({ id: UID }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 599 });
};
function resetear() {
  globalThis.__IDB_COPIA = { kv: new Map(), escrituras: [], fallar: new Set(), fallarEscritura: false };
  lsMapa.clear();
  lsCtl.fallaEn = null;
  lsCtl.alReleer = null;
  mensajes.length = 0;
  lsMapa.set('sp_access_token', 'tok-inventado-81');
  lsMapa.set('sp_token_expiry', String(Date.now() + 6 * 60 * 60 * 1000));
  lsMapa.set('fonoteca_last_user_id', UID);
}

const api = await import(pathToFileURL(join(raiz, 'src/js/api.js')).href);
const C = await import(pathToFileURL(join(raiz, 'src/js/util/copia-completa.js')).href);
const CI = await import(pathToFileURL(join(raiz, 'src/js/util/copia-importar.js')).href);
resetear();
await api.getCurrentUserId();

// ── El `handleImportTodo` REAL, sacado del fuente ───────────────────────────────────────────────────
const dash = fuente('src/js/features/dashboard.js');
const textoHandler = (dash.match(/async function handleImportTodo\(e\) \{[\s\S]*?\n}\n/) || [''])[0];
const textoOcultos = (dash.match(/const OCULTOS_CUANDO = '[^\n]*';/) || [''])[0];
ok(textoHandler.length > 500 && textoOcultos.length > 50, '`handleImportTodo` y `OCULTOS_CUANDO` se encuentran en dashboard.js');
const DEPS = ['importarCopiaCompleta', 'aplicarPlan', 'alertModal', 'infoModal', 'showToast', 'showProgress', 'hideProgress',
  'escapeHtml', 'resumenEnPalabras', 'importEscribio', 'location', 'console'];
const armar = new Function('deps', `const { ${DEPS.join(', ')} } = deps;\n${textoOcultos}\n${textoHandler}\nreturn handleImportTodo;`);
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Corre el handler real con un archivo. `cambiarPlan(plan)` toca el plan antes de confirmar (la segunda red). */
async function correr(copia, { cambiarPlan = null } = {}) {
  const vista = { modales: [], toasts: [], recargas: 0, avisos: [] };
  const deps = {
    importarCopiaCompleta: async (texto) => { const r = await api.importarCopiaCompleta(texto, { ahora: new Date('2026-10-24T12:00:00Z') }); if (cambiarPlan) cambiarPlan(r.plan); return r; },
    aplicarPlan: (plan) => api.aplicarPlan(plan),
    alertModal: async (titulo, html, opts) => { vista.modales.push({ titulo, html, opts, recargasAntes: vista.recargas }); return true; },
    infoModal: async (titulo, html, opts) => { vista.modales.push({ titulo, html, opts, info: true }); return true; },
    showToast: (m, t) => vista.toasts.push({ m, t }),
    showProgress: () => {}, hideProgress: () => {},
    escapeHtml, resumenEnPalabras: CI.resumenEnPalabras, importEscribio: CI.importEscribio,
    location: { reload: () => { vista.recargas++; } },
    console: { warn: (...a) => vista.avisos.push(a), log() {}, info() {} },
  };
  const handler = armar(deps);
  const archivo = { text: async () => J(copia) };
  await handler({ target: { files: [archivo], value: 'x' } });
  vista.mensajes = mensajes.length;
  return vista;
}

const copiaDe = ({ idb = {}, ls = {} } = {}) => ({
  _format: 'spotify-tools-data', _version: 3, _exportedAt: '2026-10-21T10:00:00.000Z', spotifyUserId: UID,
  _likesSource: 'empty', likes: { totalAtExport: 0, items: [] }, tags: { entries: {} }, _config: {},
  _leeme: {}, navegador: { idb, localStorage: ls }, _censo: { version: C.CENSO_VERSION, clases: { idb: {}, localStorage: {} }, fuera: 0, deOtroUsuario: 0, sinCensar: [] }, _errores: [],
});
const P = (b) => `${b}__${UID}`;
// Ocho claves de localStorage (todas faltan en el navegador: van tal cual) y dos de IndexedDB.
const lsCopia = {
  [P('skips_hidden_tracks')]: J(['inv-s1', 'inv-s2']),
  [P('skips_hidden_tracks_uris')]: J({ 'inv-s1': 'spotify:track:inv1', 'inv-s2': 'spotify:track:inv2' }),
  [P('discover_ocultos')]: J(['inv-d1']),
  [P('versions_dismissed')]: J(['inv-v1']),
  [P('discover_escuchados')]: J(['inv-e1']),
  [P('genre_hidden_tags')]: J(['inv-genero']),
  [P('listened_unreg_dismissed')]: J(['inv-u1']),
  [P('recs_ocultos')]: J(['inv-artista']),
};
const idbCopia = {
  mapa_area_v1_inventada1: { value: { pais: 'XX' }, storedAt: 1, expiry: null },
  mapa_area_v1_inventada2: { value: { pais: 'YY' }, storedAt: 1, expiry: null },
};
// Lo que el navegador ya tenía (no lo toca la copia): tiene que quedar igual.
const propio = { [P('listened_dupes_dismissed')]: J(['propio-1']), [P('fonoteca_theme_v1')]: J({ inventado: true }) };
const sembrarPropio = () => { for (const [k, v] of Object.entries(propio)) lsMapa.set(k, v); };
const propioIntacto = () => Object.entries(propio).every(([k, v]) => lsMapa.get(k) === v);

const esModalAMedias = (m) => m && !m.info && /a medias/.test(m.titulo) && !/hecho|importada$/i.test(m.titulo)
  && m.opts?.cancelText === null && m.opts?.confirmText === 'Recargar ahora';

// ── 1. La cuota corta a mitad: 4 escritas ─────────────────────────────────────────────────────────
console.log('· la cuota corta el bucle de localStorage a mitad');
{
  resetear(); sembrarPropio();
  const { plan } = await api.importarCopiaCompleta(J(copiaDe({ idb: idbCopia, ls: lsCopia })), { ahora: new Date('2026-10-24T12:00:00Z') });
  ok(plan.ls.length === 8 && plan.idb.length === 2, `el plan: 8 claves de localStorage y 2 de IndexedDB (${plan.ls.length}+${plan.idb.length})`);
  resetear(); sembrarPropio();
  lsCtl.fallaEn = plan.ls[4][0];   // la quinta: se escriben 4 y se para
  const v = await correr(copiaDe({ idb: idbCopia, ls: lsCopia }));
  const m = v.modales[1];
  ok(v.modales.length === 2 && v.modales[0].opts?.confirmText === 'Importar', 'primero el modal de confirmación («Importar»), después el del resultado');
  ok(v.recargas === 1, `🔴 RECARGA (${v.recargas} recargas; v=335: 0, el \`return\` iba antes)`);
  ok(esModalAMedias(m), `🔴 el modal obligado a medias: «${m?.titulo}», sin «Cerrar» (\`cancelText: null\`), «Recargar ahora»`);
  ok(m && m.recargasAntes === 0, 'la recarga va DESPUÉS del modal (se ve el aviso y después recarga)');
  ok(m && /Se han escrito 2 claves en IndexedDB y 4 en localStorage\./.test(m.html), 'dice cuántas se escribieron (2 en IndexedDB, 4 en localStorage)');
  const faltan = plan.ls.slice(4).map(([k]) => k);
  ok(m && /Faltan 4 de localStorage \(QuotaExceededError \(doble\)\)/.test(m.html) && faltan.every((k) => m.html.includes(k)), `y cuáles faltaron, con el error crudo (${faltan.length})`);
  ok(m && m.html.includes('Lo que ya tenías sigue entero.') && m.html.includes('La página se recarga ahora'), '«Lo que ya tenías sigue entero.» y «La página se recarga ahora…»');
  ok(v.toasts.length === 0, `sin el toast rojo de antes: lo dice el modal (${J(v.toasts)})`);
  ok(v.mensajes === 1, `las otras pestañas: 1 aviso (${v.mensajes})`);
  ok(propioIntacto(), 'lo que ya había (dos claves que la copia no toca) quedó igual');
}

// ── 2. IndexedDB escribió y falló la relectura de localStorage ───────────────────────────────────
console.log('· IndexedDB escribió y la relectura de localStorage falló');
{
  resetear(); sembrarPropio();
  lsCtl.alReleer = () => { throw new Error('SecurityError (doble): localStorage no se deja leer'); };
  const v = await correr(copiaDe({ idb: idbCopia, ls: lsCopia }));
  const m = v.modales[1];
  ok(idbD().escrituras.filter(([t]) => t === 'put').length === 2, 'IndexedDB sí escribió (2 claves)');
  ok(v.recargas === 1, `🔴 RECARGA (${v.recargas}; v=335: 0)`);
  ok(esModalAMedias(m) && /Se han escrito 2 claves en IndexedDB y 0 en localStorage\./.test(m.html) && /No se ha llegado a escribir en localStorage \(SecurityError \(doble\)/.test(m.html),
    `🔴 el modal a medias, con 2 en IndexedDB y el motivo de localStorage («${m?.titulo}»)`);
  ok(v.mensajes === 1 && v.toasts.length === 0, `1 aviso a las otras pestañas, 0 toasts (${v.mensajes}, ${v.toasts.length})`);
  ok(propioIntacto(), 'lo que ya había quedó igual');
}

// ── 3. IndexedDB escribió y la tercera decisión salió con un rechazo ─────────────────────────────
console.log('· IndexedDB escribió y la relectura salió con un rechazo (el caso que el encargo no nombraba)');
{
  resetear(); sembrarPropio();
  lsCtl.alReleer = () => { lsMapa.set('fonoteca_last_user_id', 'otro-uid-inventado'); };
  const v = await correr(copiaDe({ idb: idbCopia, ls: lsCopia }));
  const m = v.modales[1];
  ok(v.recargas === 1 && esModalAMedias(m) && /Se han escrito 2 claves en IndexedDB y 0 en localStorage\./.test(m.html), `🔴 recarga con el modal a medias (${v.recargas}, «${m?.titulo}»)`);
  ok(v.mensajes === 1, `1 aviso a las otras pestañas (${v.mensajes})`);
}

// ── 4. Con 0 escrituras: como antes ──────────────────────────────────────────────────────────────
console.log('· sin escrituras: toast rojo y sin recarga, como hasta ahora');
{
  resetear(); sembrarPropio();
  idbD().fallarEscritura = true;
  const v = await correr(copiaDe({ idb: idbCopia, ls: lsCopia }));
  ok(v.recargas === 0 && v.modales.length === 1 && v.toasts.length === 1 && v.toasts[0].t === 'error' && /IndexedDB no ha aceptado/.test(v.toasts[0].m), `IndexedDB que tira: toast rojo, sin modal de resultado y sin recarga (${v.recargas}, ${J(v.toasts)})`);
  ok(v.mensajes === 0, 'y ningún aviso a las otras pestañas');

  resetear(); sembrarPropio();
  const w = await correr(copiaDe({ idb: idbCopia, ls: lsCopia }), { cambiarPlan: (p) => p.ls.push(['sp_refresh_token', 'metido-a-mano']) });
  ok(w.recargas === 0 && w.modales.length === 1 && w.toasts.length === 1 && /no pueden entrar/.test(w.toasts[0].m) && w.mensajes === 0, `la segunda red: toast rojo, sin recarga, sin aviso (${w.recargas}, ${w.mensajes})`);
  ok(!lsMapa.has('sp_refresh_token') && idbD().escrituras.length === 0, 'y no se escribió nada');
}

// ── 5. De conservación: el import entero sigue igual ─────────────────────────────────────────────
console.log('· el import entero (conservación)');
{
  resetear(); sembrarPropio();
  const v = await correr(copiaDe({ idb: idbCopia, ls: lsCopia }));
  const m = v.modales[1];
  ok(m?.titulo === 'Copia importada' && m.opts?.cancelText === null && v.recargas === 1 && v.mensajes === 1 && v.toasts.length === 0, `«Copia importada», un solo botón, 1 recarga, 1 aviso (${m?.titulo}, ${v.recargas})`);
  const otra = await correr(copiaDe({ idb: idbCopia, ls: lsCopia }));   // lo mismo otra vez: 0 escrituras, ok
  ok(otra.modales[1]?.titulo === 'Copia importada' && otra.recargas === 1 && otra.mensajes === v.mensajes, `el mismo archivo otra vez (0 escrituras, \`ok\`): recarga como en v=335 y no avisa a nadie (${otra.recargas}, ${otra.mensajes - v.mensajes} avisos nuevos)`);
}

// ── 6. Recargar y avisar: la misma función ───────────────────────────────────────────────────────
console.log('· el criterio único');
{
  ok(typeof CI.importEscribio === 'function', '`importEscribio` existe en util/copia-importar.js');
  if (typeof CI.importEscribio === 'function') {
    const casos = [[{ idb: 0, ls: 0 }, false], [{ idb: 2, ls: 0 }, true], [{ idb: 0, ls: 4 }, true], [{}, false], [null, false], [{ ok: true, idb: 0, ls: 0 }, false]];
    ok(casos.every(([r, esp]) => CI.importEscribio(r) === esp), 'escribió algo = `(idb || 0) + (ls || 0) > 0`');
  }
  const apiSrc = sinComentarios(fuente('src/js/api.js'));
  const alTerminar = (apiSrc.match(/function alTerminarImport\([\s\S]*?\n}\n/) || [''])[0];
  ok(/if \(importEscribio\(r\)\) avisarCopiaImportada\(\);/.test(alTerminar), '`alTerminarImport` avisa a las otras pestañas con `importEscribio(r)`');
  const handler = sinComentarios(textoHandler);
  ok(/if \(!r\.ok && importEscribio\(r\)\) \{[\s\S]*?cancelText: null[\s\S]*?\}\);\s*location\.reload\(\);\s*return;/.test(handler), '`handleImportTodo` recarga a medias con `importEscribio(r)`');
  ok(/import \{[^}]*\bimportEscribio\b[^}]*\} from '\.\.\/util\/copia-importar\.js';/.test(dash) && /import \{[^}]*\bimportEscribio\b[^}]*\} from '\.\/util\/copia-importar\.js';/.test(fuente('src/js/api.js')), 'las dos la importan del MISMO módulo');
  const copias = (await import('node:child_process')).execSync(`grep -rlnE "\\.idb \\|\\| 0\\) \\+ \\(r\\??\\.ls" ${join(raiz, 'src/js')} || true`).toString().trim().split('\n').filter(Boolean).map((p) => p.slice(raiz.length + 1));
  ok(J(copias) === J(['src/js/util/copia-importar.js']), `la cuenta está escrita UNA vez (${copias.join(', ') || 'en ningún lado'})`);
}

// ── 7. La línea de los ocultos, en el modal de confirmación ──────────────────────────────────────
console.log('· la línea de los ocultos');
{
  resetear();
  const v = await correr(copiaDe({ ls: lsCopia }));
  const conf = v.modales[0];
  ok(conf && conf.opts?.confirmText === 'Importar' && conf.opts?.cancelText === 'Cancelar', 'el primer modal es el de confirmación («Importar» / «Cancelar»)');
  const app = fuente('src/js/app.js');
  const nueve = ['Skips crónicos', 'Sin plays', 'Sin clasificar', 'W-Three helper', 'Sin escuchar de tus artistas', 'Novedades de tus artistas', 'Seguir artistas', 'Artistas similares', 'Recomendaciones'];
  const linea = (conf?.html.match(/<p class="import-todo-ocultos">([^<]*)<\/p>/) || [])[1] || '';
  for (const nombre of nueve) ok(app.includes(`name: '${nombre}'`) && linea.includes(nombre), `🔴 «${nombre}»: nombre del menú (app.js) y en la línea del modal de confirmación`);
  ok(/o cuando elijas un artista en Artistas similares o pulses «Generar recomendaciones» en Recomendaciones\.$/.test(linea), `los dos clics, dichos como son: «${linea.slice(-110)}»`);
  ok(/id="recs-run-btn">Generar recomendaciones</.test(fuente('src/js/features/recommendations.js')), '«Generar recomendaciones» es el texto del botón de Recomendaciones');
}

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
