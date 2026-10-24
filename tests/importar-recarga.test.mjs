// tests/importar-recarga.test.mjs — después de «Importar todo»: esta pestaña recarga, las otras se enteran, y los
// ocultos que llegaron quedan marcados (tanda 80, v=335)
//
// Los almacenes de ocultos (y `discover_escuchados`) leen su conjunto una vez por carga y lo guardan ENTERO cuando
// cambian: si esta pestaña, u OTRA pestaña de la app, ya tenía uno cargado y se toca después del import sin recargar,
// guarda el conjunto VIEJO más lo nuevo y lo importado se pierde. Hasta v=334 «Recargar ahora» era optativo y las otras
// pestañas ni se enteraban. Lo que se vigila:
//   1. `aplicarPlan` que escribió algo manda `{ tipo: 'importada', fecha, origen }` por `BroadcastChannel('fonoteca-copia')`;
//      con 0 escrituras, con la segunda red, con IndexedDB que tira (0 escrituras): nada. Una cuota que cortó a MITAD
//      (escribió algo) SÍ avisa: lo ya escrito es lo que otra pestaña puede pisar;
//   2. la marca `ocultos_desde_copia_v1`: las claves que el import AGREGÓ a cada almacén de ocultos, y solo esas; se une
//      con la que había; fuera del plan (ni `planDeImport` ni `segundaRed` la ven); en el censo, sin entrar;
//   3. el modal del resultado no ofrece cerrar sin recargar (`cancelText: null` + `location.reload()` sin condición) y
//      `alertModal` solo cambia para quien pasa `null`;
//   4. el aviso de la otra pestaña: fijo, sin botón de cerrar, no recarga solo; `app.js` lo escucha al arrancar.
//
// 🔴 Todo INVENTADO. El `api.js` REAL con `idb.js` y `toast.js` doblados (`dobles/loader-copia.mjs`, el de la 78/79),
// un `localStorage` de mentira y un `BroadcastChannel` de mentira que anota. Contra v=334: no hay mensaje, no hay marca,
// y el modal ofrece «Cerrar».

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
// Un objeto con las claves ordenadas: el orden de las claves de la marca es el del censo, no importa.
const O = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])) : o);

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────
const lsMapa = new Map();
const lsCtl = { fallaEn: null };
globalThis.localStorage = {
  getItem: (k) => (lsMapa.has(k) ? lsMapa.get(k) : null),
  setItem: (k, v) => { if (k === lsCtl.fallaEn) { const e = new Error('QuotaExceededError (doble)'); e.name = 'QuotaExceededError'; throw e; } lsMapa.set(k, String(v)); },
  removeItem: (k) => { lsMapa.delete(k); },
  key: (i) => [...lsMapa.keys()][i] ?? null,
  get length() { return lsMapa.size; },
  clear: () => lsMapa.clear(),
};
globalThis.window ??= globalThis;
// El canal de mentira: anota lo que se manda (un canal no se oye a sí mismo, como el de verdad).
const mensajes = [];
const canales = [];
globalThis.BroadcastChannel = class {
  constructor(nombre) { this.nombre = nombre; this.oyentes = []; canales.push(this); }
  postMessage(m) { mensajes.push({ canal: this.nombre, ...structuredClone(m) }); for (const c of canales) if (c !== this && c.nombre === this.nombre) c.oyentes.forEach((f) => f({ data: structuredClone(m) })); }
  addEventListener(t, f) { if (t === 'message') this.oyentes.push(f); }
};
const UID = 't80-test-uid';
globalThis.fetch = async (url) => {
  if (/\/v1\/me$/.test(String(url))) return new Response(JSON.stringify({ id: UID }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 599 });
};
const idbD = () => globalThis.__IDB_COPIA;
function resetear() {
  globalThis.__IDB_COPIA = { kv: new Map(), escrituras: [], fallar: new Set(), fallarEscritura: false };
  lsMapa.clear();
  lsCtl.fallaEn = null;
  mensajes.length = 0;
  lsMapa.set('sp_access_token', 'tok-del-test');
  lsMapa.set('sp_token_expiry', String(Date.now() + 6 * 60 * 60 * 1000));
  lsMapa.set('fonoteca_last_user_id', UID);
}

const api = await import(pathToFileURL(join(raiz, 'src/js/api.js')).href);
const C = await import(pathToFileURL(join(raiz, 'src/js/util/copia-completa.js')).href);
resetear();
await api.getCurrentUserId();

const ahora = new Date('2026-10-23T12:00:00Z');
const copiaDe = ({ idb = {}, ls = {} } = {}) => ({
  _format: 'spotify-tools-data', _version: 3, _exportedAt: '2026-10-20T10:00:00.000Z', spotifyUserId: UID,
  _likesSource: 'empty', likes: { totalAtExport: 0, items: [] }, tags: { entries: {} }, _config: {},
  _leeme: {}, navegador: { idb, localStorage: ls }, _censo: { version: C.CENSO_VERSION, clases: { idb: {}, localStorage: {} }, fuera: 0, deOtroUsuario: 0, sinCensar: [] }, _errores: [],
});
const P = (b) => `${b}__${UID}`;
const MARCA = P('ocultos_desde_copia_v1');
async function importar(copia) {
  const { plan } = await api.importarCopiaCompleta(J(copia), { ahora });
  return { plan, r: await api.aplicarPlan(plan) };
}
const deOcultos = {
  [P('skips_hidden_tracks')]: J(['s1', 's2', 's3']),
  [P('skips_hidden_tracks_uris')]: J({ s1: 'spotify:track:s1', s2: 'spotify:track:s2', s3: 'spotify:track:s3' }),
  [P('discover_ocultos')]: J(['d1']),
  [P('versions_dismissed')]: J(['v1']),
  [P('discover_escuchados')]: J(['e1']),
};

// ── 1. El aviso a las otras pestañas ─────────────────────────────────────────────────────────────
console.log('· el aviso a las otras pestañas');
{
  resetear();
  const { plan, r } = await importar(copiaDe({ ls: deOcultos }));
  ok(!plan.rechazo && r.ok && r.ls > 0, `el import escribió (${r.ls} claves de localStorage)`);
  ok(mensajes.length === 1 && mensajes[0].canal === 'fonoteca-copia' && mensajes[0].tipo === 'importada' && typeof mensajes[0].fecha === 'string' && typeof mensajes[0].origen === 'string',
    `🔴 con escrituras: UN mensaje { tipo: 'importada', fecha, origen } por «fonoteca-copia» (${J(mensajes)})`);

  mensajes.length = 0;
  const otra = await importar(copiaDe({ ls: deOcultos }));   // lo mismo otra vez: ya está todo
  ok(otra.r.ok && otra.r.ls === 0 && otra.r.idb === 0 && mensajes.length === 0, `con 0 escrituras: ningún mensaje (${otra.r.ls}+${otra.r.idb} escrituras, ${mensajes.length} mensajes)`);

  resetear();
  const { plan: p3 } = await api.importarCopiaCompleta(J(copiaDe({ ls: deOcultos })), { ahora });
  p3.ls.push(['sp_refresh_token', 'metido-a-mano']);
  const r3 = await api.aplicarPlan(p3);
  ok(!r3.ok && r3.motivo === 'red' && mensajes.length === 0, 'la segunda red (no se aplica nada): ningún mensaje');

  resetear();
  idbD().fallarEscritura = true;
  const r4 = (await importar(copiaDe({ idb: { mapa_area_v1_area: { value: { x: 1 }, storedAt: 1, expiry: null } }, ls: deOcultos }))).r;
  ok(!r4.ok && r4.motivo === 'idb' && r4.idb === 0 && r4.ls === 0 && mensajes.length === 0, `IndexedDB que tira (0 escrituras): ningún mensaje (${r4.motivo})`);

  resetear();
  lsCtl.fallaEn = P('versions_dismissed');
  const r5 = (await importar(copiaDe({ ls: deOcultos }))).r;
  ok(!r5.ok && r5.motivo === 'ls' && r5.ls > 0 && mensajes.length === 1, `una cuota que cortó a MITAD (${r5.ls} escritas): SÍ avisa, lo escrito es lo que otra pestaña puede pisar`);
}

// ── 2. La marca de los ocultos que llegaron ──────────────────────────────────────────────────────
console.log('· la marca de los ocultos importados');
{
  resetear();
  lsMapa.set(P('skips_hidden_tracks'), J(['s1']));   // ya tenía s1
  lsMapa.set(P('versions_dismissed'), J(['propio']));
  await importar(copiaDe({ ls: deOcultos }));
  ok(J(O(JSON.parse(lsMapa.get(MARCA) || 'null'))) === J(O({ skips_hidden_tracks: ['s2', 's3'], discover_ocultos: ['d1'] })),
    `🔴 la marca: SOLO lo que el import agregó a los almacenes de ocultos (s1 ya estaba; versions_dismissed y discover_escuchados no son de ocultos): ${lsMapa.get(MARCA)}`);
  ok(J(JSON.parse(lsMapa.get(P('skips_hidden_tracks')))) === J(['s1', 's2', 's3']), 'y el almacén quedó unido como siempre (el import no cambió)');

  // Un segundo import antes de que suban: se une.
  await importar(copiaDe({ ls: { [P('skips_hidden_tracks')]: J(['s4']), [P('recs_ocultos')]: J(['r1']) } }));
  ok(J(O(JSON.parse(lsMapa.get(MARCA) || 'null'))) === J(O({ skips_hidden_tracks: ['s2', 's3', 's4'], discover_ocultos: ['d1'], recs_ocultos: ['r1'] })), `dos imports seguidos: se unen (${lsMapa.get(MARCA)})`);

  // La pelada sin migrar (un navegador sin las prefijadas): el import escribe las del archivo tal cual.
  resetear();
  await importar(copiaDe({ ls: { skips_hidden_tracks: J(['p1', 'p2']) } }));
  ok(J(JSON.parse(lsMapa.get(MARCA) || 'null')) === J({ skips_hidden_tracks: ['p1', 'p2'] }), `con la clave pelada del archivo, también (lo que la app LEERÍA): ${lsMapa.get(MARCA)}`);

  // Sin ocultos nuevos: no se escribe ninguna marca.
  resetear();
  await importar(copiaDe({ ls: { [P('versions_dismissed')]: J(['v9']) } }));
  ok(!lsMapa.has(MARCA), 'un import sin ocultos nuevos no deja marca');

  // Si la marca no se puede escribir, el import no falla.
  resetear();
  lsCtl.fallaEn = MARCA;
  const r = (await importar(copiaDe({ ls: deOcultos }))).r;
  ok(r.ok && !lsMapa.has(MARCA) && J(JSON.parse(lsMapa.get(P('skips_hidden_tracks')))) === J(['s1', 's2', 's3']), 'la marca que tira (cuota) no hace fallar el import');

  // El plan nunca la lleva; la segunda red no la ve.
  resetear();
  const { plan } = await api.importarCopiaCompleta(J(copiaDe({ ls: deOcultos })), { ahora });
  ok(!plan.ls.some(([k]) => k.startsWith('ocultos_desde_copia_v1')), 'el plan no lleva la marca');

  // Un archivo editado que la trae: el censo dice que no entra.
  resetear();
  const { plan: p2 } = await api.importarCopiaCompleta(J(copiaDe({ ls: { [MARCA]: J({ skips_hidden_tracks: ['x'] }) } })), { ahora });
  ok(!p2.ls.length && p2.resumen.claves.noEntran.some((x) => x.clave === MARCA), 'una marca metida en el archivo no entra (y se nombra en «Lo que no entra»)');
}

// ── 2b. La fila del censo ─────────────────────────────────────────────────────────────────────────
console.log('· el censo');
{
  const filas = C.CENSO.filter((c) => c.clave === 'ocultos_desde_copia_v1');
  ok(filas.length === 1 && filas[0].donde === 'ls' && filas[0].entra === false && filas[0].clase === 4 && filas[0].porUsuario === 'pref' && !filas[0].fusion, `UNA fila: ls, clase 4, entra: false, con prefKey, sin fusion (${J(filas.map(({ quien, que, ...f }) => f))})`);
  resetear();
  lsMapa.set(MARCA, J({ skips_hidden_tracks: ['s2'] }));
  const { copia } = await api.exportarCopiaCompleta({ ahora });
  ok(!(MARCA in copia.navegador.localStorage) && !copia._censo.sinCensar.includes(MARCA), '«Exportar todo» no la lleva, y tampoco la nombra como «sin censar»');
}

// ── 3. El modal del resultado: recarga sí o sí ────────────────────────────────────────────────────
console.log('· el modal del resultado');
{
  const dash = sinComentarios(fuente('src/js/features/dashboard.js'));
  const handler = (dash.match(/async function handleImportTodo\([\s\S]*?\n}\n/) || [''])[0];
  const resultado = (handler.match(/await alertModal\('Copia importada'[\s\S]*?\}\);\s*location\.reload\(\);/) || [''])[0];
  ok(resultado.length > 100, 'el modal «Copia importada» va seguido de `location.reload()` sin condición');
  ok(/confirmText: 'Recargar ahora', cancelText: null/.test(resultado) && !/Cerrar/.test(resultado), 'un único botón, «Recargar ahora»: sin «Cerrar» (`cancelText: null`)');
  ok(!/if \(recargar\)/.test(handler), 'ya no depende de qué botón se pulsó (Escape o clic afuera también recargan)');
  const comp = sinComentarios(fuente('src/js/ui/components.js'));
  const am = (comp.match(/function alertModal\([\s\S]*?\n}\n/) || [''])[0];
  ok(/cancelText = 'Cancelar'/.test(am) && /\$\{cancelText === null \? '' : `<button class="btn btn-secondary" id="modal-cancel">/.test(am) && /if \(cancelBtn\) cancelBtn\.onclick/.test(am), 'alertModal: sin botón de cancelar SOLO con `cancelText: null`; por defecto sigue «Cancelar»');
  ok(/cancelText: opts\.cancelText \|\| 'Cerrar'/.test(comp), 'infoModal sigue convirtiendo cualquier vacío (también `null`) en «Cerrar»');
  const conNull = (await import('node:child_process')).execSync(`grep -rln "cancelText: null," ${join(raiz, 'src/js')} || true`).toString().trim().split('\n').filter(Boolean).map((p) => p.slice(raiz.length + 1));
  ok(J(conNull) === J(['src/js/features/dashboard.js']), `nadie más pasa \`cancelText: null\` (${conNull.join(', ')})`);
  // (v=336, tanda 81) Reescrito a propósito: la línea suma los dos clics que también suben (Artistas similares y
  // Recomendaciones); el detalle lo vigila `importar-a-medias.test.mjs`.
  ok(/Los ocultos que se agreguen se subirán a sus listas de Spotify la próxima vez que abras Skips crónicos, Sin plays, Sin clasificar, W-Three helper, Sin escuchar de tus artistas, Novedades de tus artistas o Seguir artistas, o cuando elijas un artista en Artistas similares o pulses «Generar recomendaciones» en Recomendaciones\./.test(fuente('src/js/features/dashboard.js')), 'la línea de los ocultos del modal nombra las siete vistas y los dos clics, con los nombres del menú');
  const app = fuente('src/js/app.js');
  for (const nombre of ['Skips crónicos', 'Sin plays', 'Sin clasificar', 'W-Three helper', 'Sin escuchar de tus artistas', 'Novedades de tus artistas', 'Seguir artistas']) {
    ok(app.includes(`name: '${nombre}'`), `«${nombre}» es un nombre del menú (app.js)`);
  }
}

// ── 4. El aviso de la otra pestaña ────────────────────────────────────────────────────────────────
console.log('· el aviso de la otra pestaña');
{
  const aviso = sinComentarios(fuente('src/js/ui/aviso-copia.js'));
  const canal = sinComentarios(fuente('src/js/util/canal-copia.js'));
  // (v=339) Reescrito a propósito: con la unión, lo importado ya cuenta en la otra pestaña.
  ok(/Se ha cargado una copia en otra pestaña\. Lo que trajo ya cuenta en esta, pero recárgala para que todas las vistas lo enseñen\./.test(aviso) && /id="aviso-copia-recargar" type="button">Recargar<\/button>/.test(aviso), 'el texto y el botón «Recargar»');
  ok((aviso.match(/location\.reload\(\)/g) || []).length === 1 && /\.onclick = \(\) => location\.reload\(\)/.test(aviso), 'no recarga sola: el único `location.reload()` es el del botón');
  ok(!/cerrar|✕|×|remove\(\)/i.test(aviso.replace(/Recarga/g, '')), 'no se puede cerrar: ni botón de cerrar ni quien lo quite');
  ok(!/^import /m.test(canal) && /new BroadcastChannel\(CANAL_COPIA\)/.test(canal) && /CANAL_COPIA = 'fonoteca-copia'/.test(canal), 'canal-copia.js: sin imports, UN BroadcastChannel(«fonoteca-copia»)');
  ok(/if \(typeof BroadcastChannel !== 'function'\) return null;/.test(canal), 'sin BroadcastChannel, no hace nada (no tira)');
  ok(/m\.origen !== pestana/.test(canal), 'quien escucha ignora lo que mandó su propia pestaña');
  ok(/import \{ escucharAvisoDeCopia \} from '\.\/ui\/aviso-copia\.js';/.test(fuente('src/js/app.js')) && /^escucharAvisoDeCopia\(\);$/m.test(fuente('src/js/app.js')), 'app.js lo escucha al arrancar');
  const css = fuente('src/css/components.css');
  ok(/\.aviso-copia \{[^}]*position: fixed;[^}]*top: 0;[^}]*background: var\(--color-elevated\);[^}]*border-bottom: 2px solid var\(--color-warning\);/.test(css) && !/\.aviso-copia[^{]*\{[^}]*(animation|transition)/.test(css), 'clases propias, fijo arriba, colores del tema y sin animación');

  // Y de punta a punta con el canal de mentira: lo que manda `aplicarPlan` lo oye OTRO canal, no el suyo.
  const CC = await import(pathToFileURL(join(raiz, 'src/js/util/canal-copia.js')).href);
  const oidos = [];
  const otraPestana = new globalThis.BroadcastChannel('fonoteca-copia');
  otraPestana.addEventListener('message', (e) => oidos.push(e.data));
  const propios = [];
  CC.escucharCopiaImportada((m) => propios.push(m));
  resetear();
  await importar(copiaDe({ ls: deOcultos }));
  ok(oidos.length === 1 && oidos[0].tipo === 'importada', `otra pestaña lo oye (${oidos.length})`);
  ok(propios.length === 0, 'la misma pestaña que importó no se avisa a sí misma');
}

console.log(`\n${pasaron} asserts OK · ${fallaron} fallaron`);
process.exit(fallaron ? 1 : 0);
