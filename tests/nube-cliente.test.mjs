// tests/nube-cliente.test.mjs — el cliente de la copia en la nube (tanda 123): `util/nube.js` y `api/nube.js`, en Node
//
// POR QUÉ ESTA SUITE EXISTE: «Nube…» del ⚙ del Dashboard sube la copia de «Exportar todo» a un Worker de Cloudflare de
// Ian y la vuelve a bajar como archivo. Es el primer camino por el que lo del navegador sale a un servicio de afuera, y
// el token de Spotify viaja una vez al Worker. Acá se vigila, con los módulos REALES (`api.js` con `idb.js` y `toast.js`
// doblados, como `copia-completa.test.mjs`), un `localStorage` de mentira y un `fetch` doblado:
//   · la validación de la dirección (`https:`, `.workers.dev`, sin ruta, sin query, sin `#`);
//   · 🔴 con un secreto en la copia NO hay ningún `fetch`;
//   · la ida y vuelta del gzip: lo que baja es, byte a byte, lo que daba `exportarCopiaCompleta` con el mismo `ahora`;
//   · el token de otro uid se descarta; las dos filas del `CENSO`; el token propio hace dar positivo a `contieneSecreto`;
//   · el texto de cada error (y nunca «guardada» sin un 200 con JSON);
//   · y una lectura estática: `api/nube.js` no escribe en IndexedDB ni más claves de `localStorage` que esas dos, y
//     `render()` del Dashboard no llama a nada de `api/nube.js`.
//
// 🔴 Todo INVENTADO. Contra el commit de la 122 los módulos no existen: la suite lo dice y falla.

import { register } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

register('./dobles/loader-copia.mjs', pathToFileURL(import.meta.filename));

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const decir = console.log.bind(console);
let pasaron = 0, fallaron = 0;
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}
const fin = () => { decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`); process.exit(fallaron ? 1 : 0); };

// ── El navegador de mentira ─────────────────────────────────────────────────────────────────────────────────────────
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
const avisos = [];
console.warn = (...a) => { avisos.push(a.map((x) => String(x?.message ?? x)).join(' ')); };
console.error = () => {};
// La descarga: `descargarBlob` (features/covers-wallpaper.js) arma un <a download> y le hace clic.
const blobs = new Map();
let descargas = [];
URL.createObjectURL = (b) => { const u = `blob:banco/${blobs.size}`; blobs.set(u, b); return u; };
URL.revokeObjectURL = () => {};
globalThis.document = {
  createElement: () => { const a = { href: '', download: '', click() { descargas.push({ nombre: a.download, blob: blobs.get(a.href) }); }, remove() {} }; return a; },
  body: { appendChild() {} },
};

const DIRECCION = 'https://mi-worker.ejemplo.workers.dev';
const UID = 'usuario-a', OTRO = 'usuario-b';
const TOKEN_SPOTIFY = 'tok-spotify-inventado-del-test-123';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenPropio = (uid, venceMs = Date.now() + 30 * 86400000) => `${b64u({ uid, vence: new Date(venceMs).toISOString(), v: 1 })}.firma-inventada-de-43-caracteres-xxxxxxxxxxxxxx`;

// ── La red doblada: el Worker de mentira y el /me de Spotify ────────────────────────────────────────────────────────
const red = { llamadas: [], guardadas: new Map(), modo: {} };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (entrada, opciones = {}) => {
  const url = new URL(typeof entrada === 'string' ? entrada : entrada.url);
  const metodo = (opciones.method || 'GET').toUpperCase();
  const h = new Headers(opciones.headers || {});
  red.llamadas.push({ host: url.host, metodo, ruta: url.pathname, auth: h.get('authorization'), tipo: h.get('content-type') });
  if (url.host === 'api.spotify.com' && url.pathname === '/v1/me') return json({ id: UID, display_name: 'Inventada' });
  if (url.origin !== DIRECCION) return new Response('{}', { status: 599 });
  const modo = red.modo[`${metodo} ${url.pathname.startsWith('/copias/') ? '/copias/x' : url.pathname}`];
  if (modo === 'rechazo') throw new TypeError('banco: red caída (inventado)');
  if (modo === 'html') return new Response('<!doctype html><p>esto no es JSON', { status: 200, headers: { 'content-type': 'text/html' } });
  if (typeof modo === 'number') return json({ error: modo === 500 ? 'cualquier-cosa' : 'inventado' }, modo);
  if (modo && typeof modo === 'object') return json(modo.cuerpo, modo.status);
  if (metodo === 'POST' && url.pathname === '/sesion') return json({ token: tokenPropio(UID), uid: UID, vence: new Date(Date.now() + 30 * 86400000).toISOString() });
  if (metodo === 'PUT' && url.pathname === '/copias') {
    const bytes = new Uint8Array(await new Response(opciones.body).arrayBuffer());
    const fecha = new Date(Date.now() + red.guardadas.size).toISOString();
    red.guardadas.set(fecha, bytes);
    return json({ fecha, bytes: bytes.length, guardadas: red.guardadas.size });
  }
  if (metodo === 'GET' && url.pathname === '/copias') return json([...red.guardadas].map(([fecha, b]) => ({ fecha, bytes: b.length })).reverse());
  if (metodo === 'GET' && url.pathname.startsWith('/copias/')) {
    const b = red.guardadas.get(decodeURIComponent(url.pathname.slice('/copias/'.length)));
    return b ? new Response(b, { status: 200, headers: { 'content-type': 'application/gzip' } }) : json({ error: 'no-existe' }, 404);
  }
  return json({ error: 'no-existe' }, 404);
};
const alWorker = () => red.llamadas.filter((l) => `https://${l.host}` === DIRECCION);

function sesion() {
  lsMapa.clear();
  globalThis.__IDB_COPIA = { kv: new Map(), escrituras: [], fallar: new Set() };
  lsMapa.set('sp_access_token', TOKEN_SPOTIFY);
  lsMapa.set('sp_refresh_token', 'ref-inventado-del-test');
  lsMapa.set('sp_token_expiry', String(Date.now() + 3600000));
  lsMapa.set('fonoteca_last_user_id', UID);
  lsMapa.set(`discover_escuchados__${UID}`, JSON.stringify(['disco inventado||artista inventado']));
  lsMapa.set(`fonoteca_theme_v1__${UID}`, JSON.stringify({ preset: 'violeta' }));
  globalThis.__IDB_COPIA.kv.set('all_liked_tracks', { value: [{ added_at: '2024-01-01T00:00:00Z', track: { id: 'x'.repeat(22), uri: 'spotify:track:' + 'x'.repeat(22), name: 'Tema inventado', artists: [{ name: 'Artista inventado' }], album: { name: 'Disco inventado' } } }], storedAt: 1, expiry: null });
  red.llamadas.length = 0; red.guardadas.clear(); red.modo = {};
  descargas = []; avisos.length = 0;
}
async function tira(promesa) { try { await promesa; return null; } catch (e) { return e; } }

decir('· los módulos existen');
const rutaUtil = join(raiz, 'src/js/util/nube.js'), rutaApi = join(raiz, 'src/js/api/nube.js');
ok(existsSync(rutaUtil), 'src/js/util/nube.js existe');
ok(existsSync(rutaApi), 'src/js/api/nube.js existe');
if (!existsSync(rutaUtil) || !existsSync(rutaApi)) fin();
const N = await import(pathToFileURL(rutaUtil).href);
const A = await import(pathToFileURL(rutaApi).href);
const C = await import(pathToFileURL(join(raiz, 'src/js/util/copia-completa.js')).href);
const api = await import(pathToFileURL(join(raiz, 'src/js/api.js')).href);
const { prefKey } = await import(pathToFileURL(join(raiz, 'src/js/storage.js')).href);

// ── 1. util/nube.js: puro y sin imports ─────────────────────────────────────────────────────────────────────────────
decir('· util/nube.js');
{
  const src = readFileSync(rutaUtil, 'utf8');
  ok(!/^\s*import\s/m.test(src) && !/\bimport\(/.test(src), 'no importa nada');
  ok(!/localStorage|indexedDB|document\.|fetch\(/.test(src.replace(/\/\/.*$/gm, '')), 'no toca localStorage, IndexedDB, el DOM ni la red');
  ok(N.NUBE_URL_KEY === 'fonoteca_nube_url_v1' && N.NUBE_TOKEN_KEY === 'fonoteca_nube_token_v1', 'las dos claves');
  ok(N.TOPE_BYTES === 24 * 1024 * 1024, `TOPE_BYTES = 24 MiB (${N.TOPE_BYTES})`);
  if (existsSync(join(raiz, 'worker/index.js'))) {
    const W = await import(pathToFileURL(join(raiz, 'worker/index.js')).href);
    ok(W.TOPE_BYTES === N.TOPE_BYTES, 'el mismo tope que el Worker');
  }
  const MALA = 'La dirección tiene que ser la de tu Worker, que termina en .workers.dev.';
  ok(N.TEXTOS.DIRECCION_MALA === MALA, 'el texto de la dirección mala');
  const buenas = [['https://mi-worker.ejemplo.workers.dev', DIRECCION], ['https://mi-worker.ejemplo.workers.dev/', DIRECCION], ['  https://Mi-Worker.Ejemplo.workers.dev  ', DIRECCION]];
  for (const [d, esperada] of buenas) { const r = N.validarDireccion(d); ok(r.ok && r.url === esperada, `vale «${d.trim()}» → ${r.url}`); }
  const malas = ['http://mi-worker.ejemplo.workers.dev', 'https://otro.ejemplo.com', 'https://mi-worker.ejemplo.workers.dev/ruta', 'https://mi-worker.ejemplo.workers.dev/?a=1', 'https://mi-worker.ejemplo.workers.dev?', 'https://mi-worker.ejemplo.workers.dev/#x', 'https://workers.dev', 'https://mi.workers.dev.otro.com', 'https://usuario:clave@mi.ejemplo.workers.dev', 'https://mi.ejemplo.workers.dev:8443', '', 'no es una dirección', 'javascript:alert(1)//.workers.dev'];
  for (const d of malas) { const r = N.validarDireccion(d); ok(!r.ok && r.texto === MALA, `no vale «${d}»`); }
  // El token propio, leído SIN verificar (lo verifica el Worker).
  const t = tokenPropio(UID, Date.parse('2026-12-08T10:00:00.000Z'));
  ok(JSON.stringify(N.leerToken(t)) === JSON.stringify({ uid: UID, vence: '2026-12-08T10:00:00.000Z' }), 'leerToken saca { uid, vence }');
  ok(['', 'x', 'a.b', '%%%.x', `${b64u({ vence: 'x' })}.f`, `${b64u({ uid: UID })}.f`, null, undefined].every((x) => N.leerToken(x) === null), 'leerToken da null con lo mal formado');
  ok(N.conexionVigente(t, UID, Date.parse('2026-11-08T00:00:00Z'))?.uid === UID, 'conexionVigente: el uid de ahora y sin vencer');
  ok(N.conexionVigente(t, OTRO, Date.parse('2026-11-08T00:00:00Z')) === null, 'conexionVigente: otro uid → null');
  ok(N.conexionVigente(t, UID, Date.parse('2026-12-09T00:00:00Z')) === null, 'conexionVigente: vencido → null');
  ok(N.conexionVigente(t, null, Date.parse('2026-11-08T00:00:00Z')) === null, 'conexionVigente: sin uid de ahora → null');
  const d = new Date(2026, 10, 2, 23, 59);
  ok(N.nombreDeCopia(d.toISOString()) === C.nombreArchivo(d) && N.nombreDeCopia(d.toISOString()) === 'fonoteca-copia-2026-11-02.json', `nombreDeCopia = el nombre de «Exportar todo» con la fecha local de la copia (${N.nombreDeCopia(d.toISOString())})`);
  ok(N.TEXTOS.NOTA === 'La copia lleva lo mismo que «Exportar todo» y se guarda en tu cuenta de Cloudflare. No lleva tu sesión de Spotify.', 'la nota de lo que lleva');
  ok(N.TEXTOS.PARA_CARGAR === 'Para cargarla, usa «Importar todo» con el archivo.', 'la línea de «Importar todo»');
  ok(N.TEXTOS.RED === 'No se ha podido hablar con tu Worker.', 'el texto de sin red');
  ok(N.TEXTOS.PERMITIDOS === 'Tu cuenta de Spotify no está en la lista de tu Worker (PERMITIDOS).', 'el texto del 403');
  ok(N.TEXTOS.CADUCADA === 'La conexión con tu Worker ha caducado: vuelve a conectar.', 'el texto del 401');
  ok(N.textoTodaviaNoAparece('8 nov 2026, 12:00') === 'La que acabas de guardar (8 nov 2026, 12:00) todavía no aparece: puede tardar un minuto.', 'el texto de «todavía no aparece»');
  ok(N.textoConectado(UID, '08 dic 2026') === `Conectado como ${UID} hasta el 08 dic 2026`, 'el texto de conectado');
  ok(N.textoTamano(1536) === '2 KB' && N.textoTamano(3 * 1048576 + 104858) === '3,1 MB', `textoTamano en es-ES (${N.textoTamano(1536)}, ${N.textoTamano(3 * 1048576 + 104858)})`);
  ok(N.textoDemasiadoGrande(25 * 1048576) === 'La copia pesa 25 MB comprimida, más de los 24 MB que admite el almacén.', `el texto del tamaño (${N.textoDemasiadoGrande(25 * 1048576)})`);
}

// ── 2. Las dos filas del CENSO ──────────────────────────────────────────────────────────────────────────────────────
decir('· las dos filas del CENSO');
{
  ok(C.CENSO_VERSION === '2026-11-06', `CENSO_VERSION = '2026-11-06' (${C.CENSO_VERSION})`);
  const url = C.CENSO.filter((c) => c.clave === 'fonoteca_nube_url_v1');
  const tok = C.CENSO.filter((c) => c.clave === 'fonoteca_nube_token_v1');
  ok(url.length === 1 && url[0].donde === 'ls' && url[0].clase === 'preferencia' && url[0].entra === true && url[0].porUsuario === 'pref' && url[0].fusion === 'la tuya gana', `la dirección: preferencia, entra, prefKey, «la tuya gana» (${JSON.stringify(url[0] && { clase: url[0].clase, entra: url[0].entra, porUsuario: url[0].porUsuario, fusion: url[0].fusion })})`);
  ok(tok.length === 1 && tok[0].donde === 'ls' && tok[0].clase === 5 && tok[0].entra === false && tok[0].porUsuario === 'pref' && !tok[0].fusion, `el token propio: clase 5, no entra, prefKey, sin fusión (${JSON.stringify(tok[0] && { clase: tok[0].clase, entra: tok[0].entra, porUsuario: tok[0].porUsuario })})`);
  ok(C.entradaDe('ls', `fonoteca_nube_token_v1__${UID}`)?.clase === 5 && C.entradaDe('ls', 'fonoteca_nube_token_v1')?.clase === 5, 'la prefijada y la pelada son clase 5');
  ok(C.entradaDe('ls', `fonoteca_nube_url_v1__${UID}`)?.clase === 'preferencia', 'la dirección prefijada es preferencia');
  // El token propio hace dar positivo a contieneSecreto, sin tocar esa función.
  const t = tokenPropio(UID);
  ok(JSON.stringify(C.contieneSecreto(`{"x":"${t}"}`, { [`fonoteca_nube_token_v1__${UID}`]: t })) === JSON.stringify([`fonoteca_nube_token_v1__${UID}`]), '🔴 el valor del token propio (prefijado) hace dar positivo a contieneSecreto');
  ok(C.contieneSecreto(`{"x":"${t}"}`, { fonoteca_nube_token_v1: t }).length === 1, 'y el pelado también');
  ok(C.contieneSecreto('{"x":"nada"}', { fonoteca_nube_token_v1: t }).length === 0, 'sin el valor en el texto, nada');
}

// ── 3. Conectar ─────────────────────────────────────────────────────────────────────────────────────────────────────
decir('· conectarNube');
{
  sesion();
  const e0 = await tira(A.conectarNube('http://mi-worker.ejemplo.workers.dev'));
  ok(e0?.texto === N.TEXTOS.DIRECCION_MALA && red.llamadas.length === 0, `una dirección mala: el texto y 0 peticiones (${e0?.texto}, ${red.llamadas.length})`);
  const r = await A.conectarNube(DIRECCION + '/');
  const w = alWorker();
  ok(w.length === 1 && w[0].metodo === 'POST' && w[0].ruta === '/sesion', `1 POST /sesion (${w.map((l) => `${l.metodo} ${l.ruta}`).join(', ')})`);
  ok(w[0].auth === `Bearer ${TOKEN_SPOTIFY}`, 'con el token de Spotify de getValidToken()');
  ok(r?.uid === UID && typeof r.vence === 'string', `devuelve { uid, vence } (${JSON.stringify(r)})`);
  ok(lsMapa.get(prefKey('fonoteca_nube_url_v1')) === DIRECCION && prefKey('fonoteca_nube_url_v1') === `fonoteca_nube_url_v1__${UID}`, 'guarda la dirección con prefKey, sin la barra final');
  ok(N.leerToken(lsMapa.get(`fonoteca_nube_token_v1__${UID}`))?.uid === UID, 'guarda el token propio con prefKey, el texto pelado');
  ok(!lsMapa.has('fonoteca_nube_token_v1') && !lsMapa.has('fonoteca_nube_url_v1'), 'nada en las peladas');
  ok(red.llamadas.filter((l) => l.host === 'api.spotify.com').length <= 1, `a lo sumo 1 /me de Spotify desde el navegador (el memo de getCurrentUserId: ${red.llamadas.filter((l) => l.host === 'api.spotify.com').length})`);
  // Los errores de /sesion: ningún token guardado.
  const casos = [
    ['403', 403, N.TEXTOS.PERMITIDOS],
    ['401 de Spotify', { status: 401, cuerpo: { error: 'spotify-rechazo' } }, N.TEXTOS.SPOTIFY_RECHAZO],
    ['502', { status: 502, cuerpo: { error: 'spotify-no-contesta' } }, N.TEXTOS.SPOTIFY_NO_CONTESTA],
    ['500 sin configuración', { status: 500, cuerpo: { error: 'falta-configuracion' } }, N.TEXTOS.CONFIG],
    ['500', 500, N.TEXTOS.RED],
    ['fetch que rechaza', 'rechazo', N.TEXTOS.RED],
    ['200 con HTML', 'html', N.TEXTOS.RED],
    ['200 de otra cuenta', { status: 200, cuerpo: { token: tokenPropio(OTRO), uid: OTRO, vence: new Date(Date.now() + 86400000).toISOString() } }, N.TEXTOS.OTRA_CUENTA],
  ];
  for (const [nombre, modo, texto] of casos) {
    sesion();
    red.modo['POST /sesion'] = modo;
    const e = await tira(A.conectarNube(DIRECCION));
    ok(e?.texto === texto, `${nombre}: «${texto}» (${e?.texto})`);
    ok(![...lsMapa.keys()].some((k) => k.startsWith('fonoteca_nube_token_v1')), `${nombre}: ningún token en localStorage`);
    if (texto === N.TEXTOS.RED) ok(avisos.some((a) => a.startsWith('[nube]')), `${nombre}: el error crudo a console.warn('[nube] …')`);
  }
  ok(!avisos.concat().join(' ').includes(TOKEN_SPOTIFY), 'ningún aviso lleva el token de Spotify');
}

// ── 4. La conexión guardada: el token de otro uid se descarta ───────────────────────────────────────────────────────
decir('· leerConexion');
{
  sesion();
  lsMapa.set(`fonoteca_nube_url_v1__${UID}`, DIRECCION);
  lsMapa.set(`fonoteca_nube_token_v1__${UID}`, tokenPropio(OTRO));
  const c = A.leerConexion();
  ok(c.url === DIRECCION && c.conexion === null, 'el token de otro uid: sin conexión, la dirección queda');
  ok(!lsMapa.has(`fonoteca_nube_token_v1__${UID}`), '🔴 el token de otro uid se borra');
  lsMapa.set(`fonoteca_nube_token_v1__${UID}`, tokenPropio(UID, Date.now() - 1000));
  ok(A.leerConexion().conexion === null && !lsMapa.has(`fonoteca_nube_token_v1__${UID}`), 'el vencido, también');
  const bueno = tokenPropio(UID);
  lsMapa.set(`fonoteca_nube_token_v1__${UID}`, bueno);
  const c2 = A.leerConexion();
  ok(c2.conexion?.uid === UID && c2.token === bueno, 'el bueno queda');
  red.llamadas.length = 0;
  A.leerConexion();
  ok(red.llamadas.length === 0, 'leerConexion no pide nada');
  lsMapa.clear();
  ok(JSON.stringify(A.leerConexion()) === JSON.stringify({ url: null, token: null, conexion: null }), 'sin nada guardado: todo null');
}

// ── 5. Guardar: el secreto, la ida y vuelta, los errores ────────────────────────────────────────────────────────────
decir('· guardarCopiaEnNube: con un secreto en la copia, ningún fetch');
const conectar = () => { lsMapa.set(`fonoteca_nube_url_v1__${UID}`, DIRECCION); lsMapa.set(`fonoteca_nube_token_v1__${UID}`, tokenPropio(UID)); };
{
  for (const [nombre, poner] of [
    ['el token de Spotify en una preferencia', () => lsMapa.set(`fonoteca_theme_v1__${UID}`, JSON.stringify({ nota: TOKEN_SPOTIFY }))],
    ['el token propio en una preferencia', () => lsMapa.set(`fonoteca_theme_v1__${UID}`, JSON.stringify({ nota: lsMapa.get(`fonoteca_nube_token_v1__${UID}`) }))],
  ]) {
    sesion(); conectar(); poner();
    red.llamadas.length = 0;
    const e = await tira(A.guardarCopiaEnNube({ ahora: new Date('2026-11-08T12:00:00Z') }));
    ok(e?.texto === N.TEXTOS.SECRETO, `${nombre}: «${N.TEXTOS.SECRETO}» (${e?.texto})`);
    ok(red.llamadas.length === 0, `🔴 ${nombre}: NINGÚN fetch (${red.llamadas.map((l) => `${l.metodo} ${l.host}${l.ruta}`).join(', ') || '0'})`);
  }
}
decir('· guardarCopiaEnNube → bajarCopiaDeNube: la ida y vuelta');
{
  sesion(); conectar();
  await api.getCurrentUserId();   // el memo, como en el Dashboard abierto
  const ahora = new Date('2026-11-08T12:00:00Z');
  const esperado = await api.exportarCopiaCompleta({ ahora });
  red.llamadas.length = 0;
  const g = await A.guardarCopiaEnNube({ ahora });
  const puts = alWorker().filter((l) => l.metodo === 'PUT');
  ok(puts.length === 1 && puts[0].ruta === '/copias' && puts[0].auth === `Bearer ${lsMapa.get(`fonoteca_nube_token_v1__${UID}`)}` && puts[0].tipo === 'application/gzip', `1 PUT /copias con el token propio y application/gzip (${puts.length})`);
  ok(red.llamadas.length === 1, `y nada más: ${red.llamadas.length} peticiones (0 a Spotify)`);
  ok(typeof g?.fecha === 'string' && g.bytes === [...red.guardadas.values()][0].length && g.bytesSinComprimir === esperado.bytes, `devuelve { fecha, bytes, bytesSinComprimir } (${JSON.stringify(g)})`);
  const subido = [...red.guardadas.values()][0];
  ok(subido[0] === 0x1f && subido[1] === 0x8b, 'lo subido es gzip');
  const texto = await new Response(new Blob([subido]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  ok(texto === esperado.texto, `lo subido, descomprimido, es el texto de exportarCopiaCompleta con el mismo ahora (${texto.length} y ${esperado.texto.length} caracteres)`);
  red.llamadas.length = 0;
  const lista = await A.listarCopiasDeNube();
  ok(alWorker().length === 1 && alWorker()[0].metodo === 'GET' && alWorker()[0].ruta === '/copias', '«Ver copias guardadas» = 1 GET /copias');
  ok(lista.length === 1 && lista[0].fecha === g.fecha && lista[0].bytes === g.bytes, `la lista trae la recién guardada (${JSON.stringify(lista)})`);
  red.llamadas.length = 0;
  const b = await A.bajarCopiaDeNube(g.fecha);
  ok(alWorker().length === 1 && alWorker()[0].ruta === `/copias/${encodeURIComponent(g.fecha)}`, `«Bajar» = 1 GET /copias/<fecha> (${alWorker().map((l) => l.ruta).join(', ')})`);
  ok(descargas.length === 1 && descargas[0].nombre === N.nombreDeCopia(g.fecha) && /^fonoteca-copia-\d{4}-\d{2}-\d{2}\.json$/.test(descargas[0].nombre), `una descarga, ${descargas[0]?.nombre}`);
  const bajado = await descargas[0].blob.text();
  ok(bajado === esperado.texto, '🔴 lo que baja es, byte a byte, lo que daba exportarCopiaCompleta con el mismo ahora');
  ok(b?.nombre === descargas[0].nombre && b.bytes === new Blob([esperado.texto]).size, `devuelve { nombre, bytes } (${JSON.stringify(b)})`);
  ok(globalThis.__IDB_COPIA.escrituras.length === 0, `0 escrituras en IndexedDB en todo el camino (${globalThis.__IDB_COPIA.escrituras.length})`);
  // Dos «Guardar» a la vez = UN PUT.
  red.llamadas.length = 0;
  const [x, y] = await Promise.all([A.guardarCopiaEnNube({ ahora }), A.guardarCopiaEnNube({ ahora })]);
  ok(alWorker().filter((l) => l.metodo === 'PUT').length === 1 && x.fecha === y.fecha, `dos guardados a la vez = 1 PUT (${alWorker().filter((l) => l.metodo === 'PUT').length})`);
  // 404 al bajar: un error con su código, nunca otra copia.
  red.llamadas.length = 0; descargas = [];
  const e404 = await tira(A.bajarCopiaDeNube('2020-01-01T00:00:00.000Z'));
  ok(e404?.codigo === 'no-aparece' && descargas.length === 0, `404 al bajar: código «no-aparece» y 0 descargas (${e404?.codigo})`);
  ok(alWorker().length === 1, 'y no pide otra en su lugar');
}
decir('· guardarCopiaEnNube: los errores, y nunca «guardada»');
{
  const casos = [
    ['401', 401, N.TEXTOS.CADUCADA],
    ['413', 413, null],
    ['500', 500, N.TEXTOS.RED],
    ['fetch que rechaza', 'rechazo', N.TEXTOS.RED],
    ['200 con HTML', 'html', N.TEXTOS.RED],
    ['200 sin fecha', { status: 200, cuerpo: { ok: true } }, N.TEXTOS.RED],
  ];
  for (const [nombre, modo, texto] of casos) {
    sesion(); conectar();
    await api.getCurrentUserId();
    red.modo['PUT /copias'] = modo;
    const e = await tira(A.guardarCopiaEnNube({ ahora: new Date('2026-11-08T12:00:00Z') }));
    if (texto) ok(e?.texto === texto, `${nombre}: «${texto}» (${e?.texto})`);
    else ok(/^La copia pesa .+ comprimida, más de los 24 MB que admite el almacén\.$/.test(e?.texto || ''), `${nombre}: el texto del tamaño (${e?.texto})`);
    ok(e instanceof Error, `${nombre}: tira (no devuelve nada que se lea como «guardada»)`);
    if (nombre === '401') ok(!lsMapa.has(`fonoteca_nube_token_v1__${UID}`) && lsMapa.get(`fonoteca_nube_url_v1__${UID}`) === DIRECCION, '401: se borra el token y la dirección queda');
    if (texto === N.TEXTOS.RED) ok(avisos.some((a) => a.startsWith('[nube]')), `${nombre}: el error crudo a console.warn('[nube] …')`);
  }
  // Los mismos tres para la lista y la descarga.
  for (const [ruta, llamar] of [['GET /copias', () => A.listarCopiasDeNube()], ['GET /copias/x', () => A.bajarCopiaDeNube('2026-11-08T12:00:00.000Z')]]) {
    for (const [nombre, modo, texto] of [['401', 401, N.TEXTOS.CADUCADA], ['500', 500, N.TEXTOS.RED], ['rechazo', 'rechazo', N.TEXTOS.RED], ['html', 'html', N.TEXTOS.RED]]) {
      sesion(); conectar();
      red.modo[ruta] = modo;
      const e = await tira(llamar());
      ok(e?.texto === texto, `${ruta} ${nombre}: «${texto}» (${e?.texto})`);
    }
  }
  // Sin conexión: no se pide nada.
  sesion();
  red.llamadas.length = 0;
  const e = await tira(A.guardarCopiaEnNube());
  ok(e?.codigo === 'sin-conexion' && red.llamadas.length === 0, `sin conexión guardada: código «sin-conexion» y 0 peticiones (${e?.codigo}, ${red.llamadas.length})`);
  // El token de otra cuenta al guardar: se borra y no se manda nada.
  sesion();
  lsMapa.set(`fonoteca_nube_url_v1__${UID}`, DIRECCION);
  lsMapa.set(`fonoteca_nube_token_v1__${UID}`, tokenPropio(OTRO));
  red.llamadas.length = 0;
  const e2 = await tira(A.guardarCopiaEnNube());
  ok(e2?.codigo === 'sin-conexion' && alWorker().length === 0 && !lsMapa.has(`fonoteca_nube_token_v1__${UID}`), `el token de otro uid al guardar: se borra y 0 al Worker (${e2?.codigo})`);
}
decir('· guardarCopiaEnNube: más de 24 MiB comprimida, no se manda');
{
  sesion(); conectar();
  await api.getCurrentUserId();
  // Una preferencia INVENTADA con bytes al azar en base64 (no se comprime): la copia pasa de 24 MiB comprimida.
  lsMapa.set(`fonoteca_theme_v1__${UID}`, randomBytes(26 * 1024 * 1024).toString('base64'));
  red.llamadas.length = 0;
  const e = await tira(A.guardarCopiaEnNube({ ahora: new Date('2026-11-08T12:00:00Z') }));
  ok(/^La copia pesa \d+(,\d)? MB comprimida, más de los 24 MB que admite el almacén\.$/.test(e?.texto || ''), `el texto con lo que pesa (${e?.texto})`);
  ok(alWorker().length === 0, `🔴 0 peticiones al Worker (${alWorker().length})`);
}

// ── 6. La lectura estática ──────────────────────────────────────────────────────────────────────────────────────────
decir('· la lectura estática');
{
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const src = sinComentarios(readFileSync(rutaApi, 'utf8'));
  ok(!/\bidb\w*\(|indexedDB|idbSet|idbDel|cacheSet|cacheClear/.test(src), 'api/nube.js no escribe en IndexedDB (ni la nombra) ni en la caché');
  const todas = [...src.matchAll(/localStorage\s*\.\s*(setItem|removeItem|clear)\s*\(/g)].length;
  const permitidas = [...src.matchAll(/localStorage\s*\.\s*(?:setItem\(\s*claveUrl\(\)\s*,|setItem\(\s*claveToken\(\)\s*,|removeItem\(\s*claveToken\(\)\s*\))/g)].length;
  ok(todas > 0 && todas === permitidas, `api/nube.js escribe en localStorage solo con claveUrl()/claveToken() (${permitidas} de ${todas})`);
  ok(!/localStorage\s*\[|migratePrefKey|Storage\.prototype/.test(src), 'ni con corchetes, ni migratePrefKey, ni por el prototipo');
  ok(/const claveUrl = \(\) => prefKey\(NUBE_URL_KEY\)/.test(src) && /const claveToken = \(\) => prefKey\(NUBE_TOKEN_KEY\)/.test(src), 'claveUrl() y claveToken() son prefKey() de las dos claves');
  ok(!/sessionStorage/.test(src), 'ni sessionStorage');
  const dash = readFileSync(join(raiz, 'src/js/features/dashboard.js'), 'utf8');
  const importados = (dash.match(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/api\/nube\.js'/)?.[1] || '').split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
  ok(importados.length > 0, `dashboard.js importa de api/nube.js (${importados.join(', ')})`);
  const i0 = dash.indexOf('export function render(container)');
  let prof = 0, i = dash.indexOf('{', i0), j = i;
  for (; j < dash.length; j++) { if (dash[j] === '{') prof++; else if (dash[j] === '}' && --prof === 0) break; }
  const cuerpo = sinComentarios(dash.slice(i, j + 1));
  const usados = importados.filter((n) => new RegExp(`\\b${n}\\b`).test(cuerpo));
  ok(i0 >= 0 && usados.length === 0, `render() del Dashboard no llama a nada de api/nube.js (${usados.join(', ') || 'nada'})`);
  ok(/data-act="nube"/.test(cuerpo) && /Nube…/.test(cuerpo) && /copia en Cloudflare/.test(cuerpo), 'el ítem «Nube…» con la pista «copia en Cloudflare» está en el ⚙');
  ok(cuerpo.indexOf('data-act="import-todo"') < cuerpo.indexOf('data-act="nube"'), 'debajo de «Importar todo»');
}

fin();
