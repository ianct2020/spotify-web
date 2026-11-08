// tests/nube-worker.test.mjs — el Worker de Cloudflare de la copia en la nube (tanda 123), en Node
//
// POR QUÉ ESTA SUITE EXISTE: `worker/index.js` es código que va a correr en un servicio de afuera, con los datos de Ian
// y su token de Spotify pasando por él. No se despliega en esta tanda (no hay red ni cuenta): lo único que lo prueba
// antes de que Ian lo suba es esto y el banco `nube`. Se importa el módulo REAL y se le pasa un `env` con un KV doblado
// (`tests/banco/nube-datos.mjs`, el mismo del banco) y un `fetch` doblado para Spotify.
//
// Lo que se vigila (la lista del encargo):
//   · el preflight con un origen permitido y con uno que no; CORS solo con el origen exacto; `Vary: Origin` siempre;
//   · `POST /sesion` con Spotify en 200 (permitido y no), 401, 429, 500 y un `fetch` que rechaza: EXACTAMENTE una
//     petición a Spotify por sesión y ningún token emitido salvo el caso bueno;
//   · el token propio: firma tocada, vencido, mal formado, firmado con otra FIRMA → 401;
//   · `PUT /copias` guarda bajo el uid DEL TOKEN aunque la URL o una cabecera digan otro; 413 con 24 MiB + 1 byte;
//     con 7 copias quedan 5, las más nuevas; si la lista llega sin la nueva, nunca se borra la nueva;
//   · `GET /copias` de «usuario-a» no ve las de «usuario-b»; la fecha de b con el token de a → 404;
//   · sin FIRMA o sin PERMITIDOS, 500 en todo menos el preflight;
//   · 🔴 el token de Spotify de la prueba no aparece ni en el KV ni en nada que pasó por `console` (los cuatro métodos);
//   · y una lectura estática de `worker/`: ningún id con forma de los de Spotify, ningún `*.workers.dev` que no sea de
//     ejemplo, ningún id de 32 hex, ni el uid del owner.
//
// 🔴 Todo INVENTADO. Contra el commit de la 122 `worker/index.js` no existe: la suite lo dice y falla.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { crearKV, UID_A, UID_B, UID_FUERA, FIRMA, OTRA_FIRMA, ORIGENES_FIJOS } from './banco/nube-datos.mjs';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
let pasaron = 0, fallaron = 0;
const decir = console.log.bind(console);
function ok(cond, nombre) {
  if (cond) { pasaron++; decir(`  ✓ ${nombre}`); }
  else { fallaron++; decir(`  ✗ ${nombre}`); }
}
const fin = () => { decir(`\n${pasaron} asserts OK · ${fallaron} fallaron`); process.exit(fallaron ? 1 : 0); };

// ── La consola, capturada ENTERA (los cuatro métodos) desde antes de importar el Worker ──────────────────────────────
const consola = [];
for (const m of ['log', 'info', 'warn', 'error']) {
  const original = console[m].bind(console);
  console[m] = (...a) => { consola.push(a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x) ?? String(x); } catch { return String(x); } })())).join(' ')); if (m !== 'log') return; original(...a); };
}

decir('· el módulo existe');
const rutaWorker = join(raiz, 'worker/index.js');
ok(existsSync(rutaWorker), 'worker/index.js existe');
if (!existsSync(rutaWorker)) fin();
const W = await import(pathToFileURL(rutaWorker).href);
const worker = W.default;
ok(worker && typeof worker.fetch === 'function', 'export default { fetch }');
ok(typeof W.firmarToken === 'function' && typeof W.verificarToken === 'function' && typeof W.claveDeCopia === 'function' && typeof W.cabecerasCors === 'function', 'exporta firmarToken, verificarToken, claveDeCopia y cabecerasCors');
ok(W.TOPE_BYTES === 24 * 1024 * 1024 && W.MAX_COPIAS === 5, `TOPE_BYTES = 24 MiB y MAX_COPIAS = 5 (${W.TOPE_BYTES}, ${W.MAX_COPIAS})`);
if (typeof worker?.fetch !== 'function') fin();

// ── El entorno ──────────────────────────────────────────────────────────────────────────────────────────────────────
const ORIGEN = 'http://127.0.0.1:5500';
const OTRO_ORIGEN = 'https://otro-sitio.ejemplo';
const SPOTIFY_TOKEN = 'TOKEN-DE-SPOTIFY-INVENTADO-que-no-puede-quedar-en-ningun-lado-7f3a9c';
const BASE = 'https://worker-de-prueba.ejemplo.workers.dev';
const envDe = (extra = {}) => ({ COPIAS: crearKV(), FIRMA, PERMITIDOS: `${UID_A}, ${UID_B}`, ORIGENES: ORIGENES_FIJOS, ...extra });

// Spotify doblado: `globalThis.fetch` (lo que usa el Worker). Cada escenario dice qué contesta.
const spotify = { llamadas: [], responder: () => new Response('{}', { status: 599 }) };
globalThis.fetch = async (entrada, opciones = {}) => {
  const url = typeof entrada === 'string' ? entrada : entrada.url;
  const auth = (opciones.headers instanceof Headers ? opciones.headers.get('authorization') : (opciones.headers?.Authorization ?? opciones.headers?.authorization)) ?? (typeof entrada === 'object' ? entrada.headers?.get?.('authorization') : null);
  spotify.llamadas.push({ url, metodo: opciones.method || 'GET', auth });
  return spotify.responder(url);
};
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function pedir(env, metodo, ruta, { token, origen = ORIGEN, cuerpo, cabeceras = {} } = {}) {
  const h = new Headers(cabeceras);
  if (origen) h.set('Origin', origen);
  if (token) h.set('Authorization', `Bearer ${token}`);
  const res = await worker.fetch(new Request(BASE + ruta, { method: metodo, headers: h, body: cuerpo }), env);
  const texto = res.headers.get('content-type')?.includes('json') ? await res.text() : null;
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { /* no es JSON */ }
  return { res, status: res.status, datos, texto, h: res.headers };
}
async function sesion(env, uid = UID_A) {
  spotify.responder = () => json({ id: uid, display_name: 'Cuenta inventada' });
  const r = await pedir(env, 'POST', '/sesion', { token: SPOTIFY_TOKEN });
  return r.datos?.token;
}
const gzipDe = async (texto) => new Uint8Array(await new Response(new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());

// ── 1. CORS y el preflight ──────────────────────────────────────────────────────────────────────────────────────────
decir('· CORS y el preflight');
{
  const env = envDe();
  const a = await pedir(env, 'OPTIONS', '/copias', { cabeceras: { 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  ok(a.status === 204, `preflight con un origen permitido: 204 (${a.status})`);
  ok(a.h.get('access-control-allow-origin') === ORIGEN, `Allow-Origin = el origen exacto (${a.h.get('access-control-allow-origin')})`);
  ok(a.h.get('access-control-allow-methods') === 'GET, PUT, POST, OPTIONS', `Allow-Methods (${a.h.get('access-control-allow-methods')})`);
  ok(a.h.get('access-control-allow-headers') === 'Authorization, Content-Type', `Allow-Headers (${a.h.get('access-control-allow-headers')})`);
  ok(a.h.get('access-control-max-age') === '600', `Max-Age 600 (${a.h.get('access-control-max-age')})`);
  ok(/\bOrigin\b/.test(a.h.get('vary') || ''), 'Vary: Origin en el preflight');
  const b = await pedir(env, 'OPTIONS', '/copias', { origen: OTRO_ORIGEN });
  ok(b.status === 403, `preflight con otro origen: 403 (${b.status})`);
  ok(![...b.h.keys()].some((k) => k.startsWith('access-control-')), `sin ninguna cabecera CORS (${[...b.h.keys()].join(', ')})`);
  ok(/\bOrigin\b/.test(b.h.get('vary') || ''), 'Vary: Origin también con el 403');
  // Un origen que EMPIEZA como uno permitido no vale: la comparación es exacta.
  const c = await pedir(env, 'OPTIONS', '/copias', { origen: ORIGEN + '.ejemplo' });
  ok(c.status === 403 && !c.h.get('access-control-allow-origin'), `un origen parecido no vale (${c.status})`);
  const d = await pedir(env, 'OPTIONS', '/copias', { origen: 'https://ejemplo.github.io/' });
  ok(d.status === 403, `con barra final tampoco: la comparación es exacta (${d.status})`);
  // En una ruta normal: con el origen bueno, Allow-Origin; con otro, nada; Vary siempre.
  const e = await pedir(env, 'GET', '/no-existe');
  ok(e.status === 404 && e.datos?.error === 'no-existe', `una ruta que no existe: 404 {"error":"no-existe"} (${e.status} ${e.texto})`);
  ok(e.h.get('access-control-allow-origin') === ORIGEN && /\bOrigin\b/.test(e.h.get('vary') || ''), 'con el origen bueno: Allow-Origin y Vary');
  const f = await pedir(env, 'GET', '/no-existe', { origen: OTRO_ORIGEN });
  ok(!f.h.get('access-control-allow-origin') && /\bOrigin\b/.test(f.h.get('vary') || ''), 'con otro origen: sin Allow-Origin, con Vary');
  const g = await pedir(env, 'GET', '/no-existe', { origen: null });
  ok(!g.h.get('access-control-allow-origin') && /\bOrigin\b/.test(g.h.get('vary') || ''), 'sin Origin: sin Allow-Origin, con Vary');
  const h = W.cabecerasCors(new Request(BASE, { headers: { Origin: ORIGEN } }), { ORIGENES: ` ${ORIGEN} ,https://x.ejemplo` });
  ok(h['Access-Control-Allow-Origin'] === ORIGEN, 'cabecerasCors tolera espacios alrededor de las comas de ORIGENES');
  const i = W.cabecerasCors(new Request(BASE, { headers: { Origin: ORIGEN } }), {});
  ok(!i['Access-Control-Allow-Origin'] && i.Vary === 'Origin', 'sin ORIGENES no se permite ningún origen');
}

// ── 2. POST /sesion ─────────────────────────────────────────────────────────────────────────────────────────────────
decir('· POST /sesion');
{
  const casos = [
    ['200 permitido', () => json({ id: UID_A }), 200, null],
    ['200 NO permitido', () => json({ id: UID_FUERA }), 403, 'no-permitido'],
    ['401', () => json({ error: { status: 401, message: 'The access token expired' } }, 401), 401, 'spotify-rechazo'],
    ['429', () => json({ error: { status: 429 } }, 429), 502, 'spotify-no-contesta'],
    ['500', () => json({ error: { status: 500 } }, 500), 502, 'spotify-no-contesta'],
    ['fetch que rechaza', () => { throw new TypeError('red caída (inventado)'); }, 502, 'spotify-no-contesta'],
    ['200 con HTML', () => new Response('<!doctype html><p>no', { status: 200, headers: { 'content-type': 'text/html' } }), 502, 'spotify-no-contesta'],
    ['200 sin id', () => json({ display_name: 'sin id' }), 502, 'spotify-no-contesta'],
  ];
  for (const [nombre, responder, status, error] of casos) {
    const env = envDe();
    spotify.llamadas.length = 0;
    spotify.responder = responder;
    const r = await pedir(env, 'POST', '/sesion', { token: SPOTIFY_TOKEN });
    ok(r.status === status, `${nombre}: ${status} (${r.status} ${r.texto})`);
    ok(spotify.llamadas.length === 1, `${nombre}: exactamente UNA petición a Spotify (${spotify.llamadas.length})`);
    ok(spotify.llamadas[0]?.url === 'https://api.spotify.com/v1/me' && spotify.llamadas[0]?.metodo === 'GET', `${nombre}: es GET https://api.spotify.com/v1/me (${spotify.llamadas[0]?.metodo} ${spotify.llamadas[0]?.url})`);
    ok(spotify.llamadas[0]?.auth === `Bearer ${SPOTIFY_TOKEN}`, `${nombre}: con el token que mandó el navegador`);
    if (error) {
      ok(r.datos?.error === error && !('token' in (r.datos || {})), `${nombre}: {"error":"${error}"} y ningún token emitido (${r.texto})`);
    } else {
      ok(typeof r.datos?.token === 'string' && r.datos.uid === UID_A && !Number.isNaN(Date.parse(r.datos.vence)), `${nombre}: { token, uid, vence } (${Object.keys(r.datos || {}).join(', ')})`);
      const dias = (Date.parse(r.datos.vence) - Date.now()) / 86400000;
      ok(dias > 29.9 && dias <= 30.01, `${nombre}: vence a los 30 días (${dias.toFixed(3)})`);
      const v = await W.verificarToken(r.datos.token, FIRMA);
      ok(v?.uid === UID_A && v?.vence === r.datos.vence, `${nombre}: el token verifica con FIRMA y dice el uid y el vencimiento`);
      ok(!r.datos.token.includes(SPOTIFY_TOKEN), `${nombre}: el token propio no lleva el de Spotify`);
    }
    ok(env.COPIAS.ops.length === 0, `${nombre}: /sesion no toca el KV (${env.COPIAS.ops.length} operaciones)`);
  }
  // Sin Authorization: no se pregunta a Spotify.
  const env = envDe();
  spotify.llamadas.length = 0;
  const r = await pedir(env, 'POST', '/sesion');
  ok(r.status === 401 && spotify.llamadas.length === 0, `sin Authorization: 401 y 0 peticiones a Spotify (${r.status}, ${spotify.llamadas.length})`);
  // Otro método en /sesion: no existe.
  const g = await pedir(env, 'GET', '/sesion', { token: SPOTIFY_TOKEN });
  ok(g.status === 404, `GET /sesion: 404 (${g.status})`);
  // El id permitido con mayúsculas distintas NO es el mismo.
  spotify.responder = () => json({ id: UID_A.toUpperCase() });
  const m = await pedir(envDe(), 'POST', '/sesion', { token: SPOTIFY_TOKEN });
  ok(m.status === 403, `un id que solo difiere en mayúsculas no está permitido (${m.status})`);
}

// ── 3. El token propio ──────────────────────────────────────────────────────────────────────────────────────────────
decir('· el token propio');
{
  const env = envDe();
  const bueno = await sesion(env);
  ok(typeof bueno === 'string' && bueno.split('.').length === 2, `forma «payload.firma» (${bueno?.split('.').length} partes)`);
  const ok200 = await pedir(env, 'GET', '/copias', { token: bueno });
  ok(ok200.status === 200 && Array.isArray(ok200.datos), `con el token bueno, GET /copias = 200 [] (${ok200.status} ${ok200.texto})`);
  const [p, f] = bueno.split('.');
  const tocar = (s) => s.slice(0, -2) + (s.at(-2) === 'A' ? 'B' : 'A') + s.at(-1);
  const vencido = await W.firmarToken({ uid: UID_A, vence: new Date(Date.now() - 1000).toISOString() }, FIRMA);
  const otraFirma = await W.firmarToken({ uid: UID_A, vence: new Date(Date.now() + 86400000).toISOString() }, OTRA_FIRMA);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payloadOtro = `${b64({ uid: UID_B, vence: new Date(Date.now() + 86400000).toISOString(), v: 1 })}.${f}`;
  const v2 = await W.firmarToken({ uid: UID_A, vence: new Date(Date.now() + 86400000).toISOString(), v: 2 }, FIRMA);
  const uidMalo = await W.firmarToken({ uid: '../usuario-a', vence: new Date(Date.now() + 86400000).toISOString() }, FIRMA);
  const malos = [
    ['la firma tocada', `${p}.${tocar(f)}`],
    ['el payload cambiado a otro uid con la firma vieja', payloadOtro],
    ['vencido', vencido],
    ['firmado con otra FIRMA', otraFirma],
    ['con v ≠ 1', v2],
    ['con un uid que no pasa la regla', uidMalo],
    ['mal formado: una sola parte', 'nada-de-puntos'],
    ['mal formado: tres partes', `${p}.${f}.extra`],
    ['mal formado: base64 roto', '%%%.$$$'],
    ['mal formado: vacío', '.'],
    ['mal formado: payload que no es JSON', `${Buffer.from('no json').toString('base64url')}.${f}`],
  ];
  for (const [nombre, t] of malos) {
    const r = await pedir(env, 'GET', '/copias', { token: t });
    ok(r.status === 401 && r.datos?.error === 'token-invalido', `${nombre}: 401 {"error":"token-invalido"} (${r.status} ${r.texto})`);
  }
  ok((await W.verificarToken(vencido, FIRMA, Date.now() - 60000))?.uid === UID_A, 'verificarToken mira el reloj que le pasan (vencido ahora, vigente un minuto antes)');
  const sin = await pedir(env, 'GET', '/copias');
  ok(sin.status === 401 && sin.datos?.error === 'token-invalido', `sin Authorization: 401 token-invalido (${sin.status})`);
  // El token de Spotify NO sirve como token propio.
  const conSpotify = await pedir(env, 'GET', '/copias', { token: SPOTIFY_TOKEN });
  ok(conSpotify.status === 401, `el token de Spotify en una ruta de copias: 401 (${conSpotify.status})`);
}

// ── 4. PUT /copias ──────────────────────────────────────────────────────────────────────────────────────────────────
decir('· PUT /copias');
{
  const env = envDe();
  const tA = await sesion(env, UID_A);
  const cuerpo = await gzipDe('{"copia":"inventada de A"}');
  const r = await pedir(env, 'PUT', `/copias?uid=${UID_B}`, { token: tA, cuerpo, cabeceras: { 'Content-Type': 'application/gzip', 'X-Uid': UID_B, 'X-Usuario': UID_B } });
  ok(r.status === 200, `PUT = 200 (${r.status} ${r.texto})`);
  ok(W.FECHA_VALIDA.test(r.datos?.fecha || '') && r.datos?.bytes === cuerpo.length && r.datos?.guardadas === 1, `contesta { fecha, bytes, guardadas } (${r.texto})`);
  const claves = [...env.COPIAS.datos.keys()];
  ok(claves.length === 1 && claves[0] === `copia/${UID_A}/${r.datos.fecha}`, `🔴 guardó bajo el uid DEL TOKEN aunque la URL y dos cabeceras digan otro (${claves.join(', ')})`);
  const guardado = env.COPIAS.datos.get(claves[0]);
  ok(Buffer.from(guardado.bytes).equals(Buffer.from(cuerpo)), 'los bytes guardados son los mandados, tal cual (no los descomprime)');
  ok(guardado.metadata?.bytes === cuerpo.length && guardado.metadata?.fecha === r.datos.fecha, `metadatos { bytes, fecha } (${JSON.stringify(guardado.metadata)})`);
  ok(r.h.get('access-control-allow-origin') === ORIGEN, 'el PUT lleva CORS con el origen bueno');
  // El tope.
  const justo = new Uint8Array(W.TOPE_BYTES); justo[0] = 0x1f; justo[1] = 0x8b;
  const r2 = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: justo });
  ok(r2.status === 200, `exactamente 24 MiB: 200 (${r2.status})`);
  const demas = new Uint8Array(W.TOPE_BYTES + 1); demas[0] = 0x1f; demas[1] = 0x8b;
  const antes = env.COPIAS.datos.size;
  const r3 = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: demas });
  ok(r3.status === 413 && r3.datos?.error === 'demasiado-grande', `24 MiB + 1 byte: 413 (${r3.status} ${r3.texto})`);
  ok(env.COPIAS.datos.size === antes, 'el 413 no guarda nada');
  // Un `Content-Length` que ya dice más del tope: 413 sin leer el cuerpo. Node (undici) puede descartar esa cabecera al
  // armar el `Request`; si la descarta, no se puede medir acá y se dice.
  const conLargo = new Request(BASE + '/copias', { method: 'PUT', headers: { 'Content-Length': String(W.TOPE_BYTES + 1) }, body: new Uint8Array(10) });
  if (conLargo.headers.get('content-length') === String(W.TOPE_BYTES + 1)) {
    const r4 = await worker.fetch(conLargo.clone ? new Request(conLargo, { headers: { 'Content-Length': String(W.TOPE_BYTES + 1), Authorization: `Bearer ${tA}`, Origin: ORIGEN } }) : conLargo, env);
    ok(r4.status === 413, `un Content-Length de más ya da 413 (${r4.status})`);
  } else {
    decir('  · (no medido en Node: undici descarta la cabecera Content-Length al armar el Request)');
  }
  const r5 = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: new TextEncoder().encode('{"no":"gzip"}') });
  ok(r5.status === 400 && r5.datos?.error === 'no-es-gzip', `un cuerpo que no empieza como gzip: 400 (${r5.status} ${r5.texto})`);
  const r6 = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: new Uint8Array(0) });
  ok(r6.status === 400, `un cuerpo vacío: 400 (${r6.status})`);
  const r7 = await pedir(env, 'PUT', '/copias', { cuerpo });
  ok(r7.status === 401, `PUT sin token: 401 (${r7.status})`);
}
{
  decir('· la poda: 7 seguidas, quedan 5');
  const env = envDe();
  const tA = await sesion(env, UID_A);
  const fechas = [];
  let reloj = Date.parse('2026-11-08T12:00:00.000Z');
  const ahoraReal = Date.now;
  Date.now = () => reloj;
  for (let i = 0; i < 7; i++) {
    reloj += 1000;
    const r = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: await gzipDe(`copia ${i}`) });
    fechas.push(r.datos?.fecha);
  }
  // Dos en el MISMO milisegundo: no se pisan.
  const m1 = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: await gzipDe('mismo ms 1') });
  const m2 = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: await gzipDe('mismo ms 2') });
  Date.now = ahoraReal;
  ok(m1.datos?.fecha && m2.datos?.fecha && m1.datos.fecha !== m2.datos.fecha, `🔴 dos PUT en el mismo milisegundo dan dos claves distintas (${m1.datos?.fecha} · ${m2.datos?.fecha})`);
  const quedan = [...env.COPIAS.datos.keys()].sort();
  const esperadas = [...fechas, m1.datos.fecha, m2.datos.fecha].sort().slice(-5).map((f) => `copia/${UID_A}/${f}`);
  ok(quedan.length === 5 && JSON.stringify(quedan) === JSON.stringify(esperadas), `quedan 5, las más nuevas (${quedan.length}: ${quedan.map((k) => k.slice(-13)).join(', ')})`);
  ok(m2.datos.guardadas === 5, `el último PUT dice guardadas: 5 (${m2.datos.guardadas})`);
  const lista = await pedir(env, 'GET', '/copias', { token: tA });
  ok(Array.isArray(lista.datos) && lista.datos.length === 5 && lista.datos.every((x, i, a) => i === 0 || a[i - 1].fecha > x.fecha), `GET /copias: 5, la más nueva primero (${lista.datos?.map((x) => x.fecha.slice(11, 23)).join(', ')})`);
  ok(lista.datos.every((x) => typeof x.bytes === 'number' && x.bytes > 0 && Object.keys(x).sort().join() === 'bytes,fecha'), 'cada una con { fecha, bytes } y nada más');
}
{
  decir('· la lista atrasada: el KV no lista la última escritura en la primera lectura');
  const env = envDe({ COPIAS: crearKV({ listaAtrasada: 1 }) });
  const tA = await sesion(env, UID_A);
  let reloj = Date.parse('2026-11-08T13:00:00.000Z');
  const ahoraReal = Date.now;
  Date.now = () => reloj;
  const fechas = [];
  for (let i = 0; i < 5; i++) { reloj += 1000; fechas.push((await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: await gzipDe(`v ${i}`) })).datos.fecha); }
  ok(env.COPIAS.datos.size === 5, `5 guardadas (${env.COPIAS.datos.size})`);
  reloj += 1000;
  const sexta = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: await gzipDe('la sexta') });
  Date.now = ahoraReal;
  const claves = [...env.COPIAS.datos.keys()];
  ok(sexta.status === 200 && claves.includes(`copia/${UID_A}/${sexta.datos.fecha}`), '🔴 la nueva está guardada aunque la lista de la poda no la trajo');
  ok(claves.length === 6, `con la lista sin la nueva, quedan 6 un rato, nunca 4 (${claves.length})`);
  // La siguiente poda (otra copia, con la lista al día) deja 5 y nunca borra la recién escrita.
  const env2 = envDe({ COPIAS: crearKV({ listaAtrasada: 1 }) });
  const t2 = await sesion(env2, UID_A);
  for (let i = 0; i < 7; i++) {
    const r = await pedir(env2, 'PUT', '/copias', { token: t2, cuerpo: await gzipDe(`w ${i}`) });
    ok([...env2.COPIAS.datos.keys()].includes(`copia/${UID_A}/${r.datos.fecha}`), `copia ${i + 1}: la recién escrita sigue ahí después de la poda`);
  }
  ok(env2.COPIAS.datos.size <= 6, `con la lista atrasada nunca quedan más de 6 (${env2.COPIAS.datos.size})`);
}

// ── 5. GET /copias y GET /copias/<fecha> ────────────────────────────────────────────────────────────────────────────
decir('· GET /copias y GET /copias/<fecha>');
{
  const env = envDe();
  const tA = await sesion(env, UID_A);
  const tB = await sesion(env, UID_B);
  const ca = await gzipDe('copia inventada de A');
  const cb = await gzipDe('copia inventada de B');
  // Con el reloj fijo y distinto para cada una: si las dos caen en el mismo milisegundo, «la fecha de b» existe también
  // para a y la prueba de abajo no prueba nada (lo vio la primera corrida verde de la tanda 123: 200 en vez de 404).
  const ahoraReal = Date.now;
  Date.now = () => Date.parse('2026-11-08T14:00:00.000Z');
  const ra = await pedir(env, 'PUT', '/copias', { token: tA, cuerpo: ca });
  Date.now = () => Date.parse('2026-11-08T14:05:00.000Z');
  const rb = await pedir(env, 'PUT', '/copias', { token: tB, cuerpo: cb });
  Date.now = ahoraReal;
  ok(ra.datos?.fecha && rb.datos?.fecha && ra.datos.fecha !== rb.datos.fecha, `las dos copias tienen fechas distintas (${ra.datos?.fecha} · ${rb.datos?.fecha})`);
  const la = await pedir(env, 'GET', '/copias', { token: tA });
  ok(la.datos?.length === 1 && la.datos[0].fecha === ra.datos.fecha, `🔴 GET /copias de usuario-a ve solo la suya (${JSON.stringify(la.datos)})`);
  const lb = await pedir(env, 'GET', '/copias', { token: tB });
  ok(lb.datos?.length === 1 && lb.datos[0].fecha === rb.datos.fecha, 'GET /copias de usuario-b ve solo la suya');
  const bajada = await pedir(env, 'GET', `/copias/${encodeURIComponent(ra.datos.fecha)}`, { token: tA });
  ok(bajada.status === 200 && bajada.h.get('content-type') === 'application/gzip', `GET /copias/<fecha>: 200 application/gzip (${bajada.status} ${bajada.h.get('content-type')})`);
  ok(Buffer.from(await bajada.res.arrayBuffer()).equals(Buffer.from(ca)), 'devuelve los bytes guardados, tal cual');
  ok(bajada.h.get('access-control-allow-origin') === ORIGEN, 'la descarga lleva CORS con el origen bueno');
  const cruzada = await pedir(env, 'GET', `/copias/${encodeURIComponent(rb.datos.fecha)}`, { token: tA });
  ok(cruzada.status === 404 && cruzada.datos?.error === 'no-existe', `🔴 la fecha de b con el token de a: 404 (${cruzada.status} ${cruzada.texto})`);
  const sinCodificar = await pedir(env, 'GET', `/copias/${ra.datos.fecha}`, { token: tA });
  ok(sinCodificar.status === 200, `la fecha sin codificar también vale (${sinCodificar.status})`);
  const inexistente = await pedir(env, 'GET', `/copias/${encodeURIComponent('2020-01-01T00:00:00.000Z')}`, { token: tA });
  ok(inexistente.status === 404 && inexistente.datos?.error === 'no-existe', `una fecha que no está: 404 (${inexistente.status})`);
  const trampa = await pedir(env, 'GET', `/copias/${encodeURIComponent(`../${UID_B}/${rb.datos.fecha}`)}`, { token: tA });
  ok(trampa.status === 404, `una «fecha» con ../ no sale de la carpeta del usuario: 404 (${trampa.status})`);
  const otra = await pedir(env, 'GET', '/copias/no-es-una-fecha', { token: tA });
  ok(otra.status === 404, `algo que no es una fecha: 404 (${otra.status})`);
  ok(W.claveDeCopia(UID_A, ra.datos.fecha) === `copia/${UID_A}/${ra.datos.fecha}`, 'claveDeCopia arma copia/<uid>/<fecha>');
  let tiro = 0;
  for (const [u, f] of [['../x', ra.datos.fecha], [UID_A, '../x'], ['', ra.datos.fecha], ['a'.repeat(65), ra.datos.fecha], ['a/b', ra.datos.fecha]]) { try { W.claveDeCopia(u, f); } catch { tiro++; } }
  ok(tiro === 5, `claveDeCopia tira con un uid o una fecha que no pasan la regla (${tiro} de 5)`);
}

// ── 6. Sin configuración ────────────────────────────────────────────────────────────────────────────────────────────
decir('· sin FIRMA o sin PERMITIDOS: 500 en todo menos el preflight');
for (const [nombre, extra] of [['sin FIRMA', { FIRMA: undefined }], ['con FIRMA vacía', { FIRMA: '' }], ['sin PERMITIDOS', { PERMITIDOS: undefined }], ['con PERMITIDOS vacío', { PERMITIDOS: ' , ' }]]) {
  const env = envDe(extra);
  spotify.llamadas.length = 0;
  spotify.responder = () => json({ id: UID_A });
  const tFalso = await W.firmarToken({ uid: UID_A, vence: new Date(Date.now() + 86400000).toISOString() }, FIRMA);
  const rs = [
    await pedir(env, 'POST', '/sesion', { token: SPOTIFY_TOKEN }),
    await pedir(env, 'PUT', '/copias', { token: tFalso, cuerpo: await gzipDe('x') }),
    await pedir(env, 'GET', '/copias', { token: tFalso }),
    await pedir(env, 'GET', '/copias/2026-11-08T00%3A00%3A00.000Z', { token: tFalso }),
    await pedir(env, 'GET', '/otra-cosa'),
  ];
  ok(rs.every((r) => r.status === 500 && r.datos?.error === 'falta-configuracion'), `${nombre}: las cinco rutas, 500 {"error":"falta-configuracion"} (${rs.map((r) => r.status).join(', ')})`);
  ok(rs.every((r) => !('token' in (r.datos || {}))), `${nombre}: ningún token emitido`);
  ok(spotify.llamadas.length === 0 && env.COPIAS.ops.length === 0, `${nombre}: 0 peticiones a Spotify y 0 operaciones en el KV (${spotify.llamadas.length}, ${env.COPIAS.ops.length})`);
  const pre = await pedir(env, 'OPTIONS', '/sesion');
  ok(pre.status === 204, `${nombre}: el preflight sigue en 204 (${pre.status})`);
}

// ── 7. 🔴 El token de Spotify no queda en ningún lado ───────────────────────────────────────────────────────────────
decir('· el token de Spotify no queda en el KV ni en la consola');
{
  // Un recorrido entero, más los caminos de error de /sesion y un catch forzado (el KV que tira).
  const env = envDe();
  const t = await sesion(env, UID_A);
  await pedir(env, 'PUT', '/copias', { token: t, cuerpo: await gzipDe(`la copia no lleva ${'nada'}`) });
  for (const responder of [() => { throw new TypeError(`red caída ${SPOTIFY_TOKEN}`); }, () => json({ error: { message: SPOTIFY_TOKEN } }, 401), () => json({ id: UID_FUERA }), () => json({}, 500)]) {
    spotify.responder = responder;
    await pedir(env, 'POST', '/sesion', { token: SPOTIFY_TOKEN });
  }
  const roto = envDe({ COPIAS: { ...crearKV(), list: async () => { throw new Error('KV caído (inventado)'); }, put: async () => { throw new Error('KV caído (inventado)'); }, get: async () => null, getWithMetadata: async () => ({ value: null, metadata: null }), delete: async () => {} } });
  const tr = await sesion(roto, UID_A);
  const caido = await pedir(roto, 'PUT', '/copias', { token: tr, cuerpo: await gzipDe('x') });
  ok(caido.status === 500 && !caido.texto?.includes('KV caído'), `con el KV caído: 500 sin el error crudo en el cuerpo (${caido.status} ${caido.texto})`);
  const lista = await pedir(roto, 'GET', '/copias', { token: tr });
  ok(lista.status === 500, `GET /copias con el KV caído: 500 (${lista.status})`);
  let enKV = 0;
  for (const kv of [env.COPIAS, roto.COPIAS]) for (const [k, d] of kv.datos ?? []) if (k.includes(SPOTIFY_TOKEN) || Buffer.from(d.bytes).toString('latin1').includes(SPOTIFY_TOKEN) || JSON.stringify(d.metadata ?? null).includes(SPOTIFY_TOKEN)) enKV++;
  ok(enKV === 0, `🔴 el token de Spotify no está en ninguna clave, valor ni metadato del KV (${enKV})`);
  const enConsola = consola.filter((l) => l.includes(SPOTIFY_TOKEN) || l.includes(SPOTIFY_TOKEN.slice(10, 40)));
  ok(enConsola.length === 0, `🔴 ni en nada que pasó por console.log/info/warn/error (${consola.length} líneas, ${enConsola.length} con el token)`);
  ok(consola.length > 0, `el catch del Worker sí dejó algo en la consola (la prueba miró algo: ${consola.length} líneas)`);
}

// ── 8. La lectura estática de worker/ ───────────────────────────────────────────────────────────────────────────────
decir('· la lectura estática de worker/ (el repo es PÚBLICO)');
{
  const archivos = [];
  const recorrer = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) { if (e !== '.wrangler' && e !== 'node_modules') recorrer(p); } else archivos.push(p); } };
  recorrer(join(raiz, 'worker'));
  const ignorados = new Set(['worker/wrangler.jsonc']);
  const aMirar = archivos.filter((p) => !ignorados.has(relative(raiz, p)) && !/\.dev\.vars/.test(p));
  ok(aMirar.some((p) => p.endsWith('index.js')) && aMirar.some((p) => p.endsWith('wrangler.ejemplo.jsonc')) && aMirar.some((p) => p.endsWith('LEEME.md')), `están index.js, wrangler.ejemplo.jsonc y LEEME.md (${aMirar.map((p) => relative(raiz, p)).join(', ')})`);
  const owner = readFileSync(join(raiz, 'src/js/features/history-data.js'), 'utf8').match(/const HISTORY_OWNER_ID = '([^']+)'/)?.[1];
  const ID_SPOTIFY = /(?<![A-Za-z0-9])[A-Za-z0-9]{22}(?![A-Za-z0-9])/g;
  const HEX32 = /(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])/g;
  const WORKERS_DEV = /[A-Za-z0-9.-]*\.workers\.dev/g;
  const dominioDeEjemplo = (d) => /(^|\.)ejemplo\.workers\.dev$/.test(d) || d === '.workers.dev' || /^(tu-worker|TU-WORKER|<[^>]*>)\.workers\.dev$/.test(d);
  const hallazgos = [];
  for (const p of aMirar) {
    const texto = readFileSync(p, 'utf8');
    const r = relative(raiz, p);
    for (const m of texto.matchAll(ID_SPOTIFY)) if (/\d/.test(m[0]) && /[a-z]/.test(m[0]) && /[A-Z]/.test(m[0])) hallazgos.push(`${r}: id con forma de Spotify «${m[0]}»`);
    for (const m of texto.matchAll(HEX32)) hallazgos.push(`${r}: 32 hex «${m[0]}»`);
    for (const m of texto.matchAll(WORKERS_DEV)) if (!dominioDeEjemplo(m[0])) hallazgos.push(`${r}: dirección «${m[0]}»`);
    if (owner && texto.includes(owner)) hallazgos.push(`${r}: el uid del owner`);
  }
  ok(hallazgos.length === 0, `🔴 ningún id de Spotify, ningún 32 hex, ninguna *.workers.dev real, ni el uid del owner (${hallazgos.join(' · ') || '—'})`);
  ok(!!owner, 'el uid del owner se leyó de history-data.js (si no, la guarda no miraría nada)');
  // Las guardas ven lo que tienen que ver (mutantes inventados).
  const muestra = 'id 4uLU6hMCjMI75M1A2tKUQC · cuenta 0123456789abcdef0123456789abcdef · https://mi-worker.alguien.workers.dev';
  ok([...muestra.matchAll(ID_SPOTIFY)].length === 1 && [...muestra.matchAll(HEX32)].length === 1 && [...muestra.matchAll(WORKERS_DEV)].filter((m) => !dominioDeEjemplo(m[0])).length === 1, 'las tres guardas ven un id, un 32 hex y una dirección real inventados (mutante)');
  const ej = readFileSync(join(raiz, 'worker/wrangler.ejemplo.jsonc'), 'utf8');
  ok(/"main"\s*:\s*"index\.js"/.test(ej) && /"binding"\s*:\s*"COPIAS"/.test(ej) && /"id"\s*:\s*"PEGAR_AQUI_EL_ID"/.test(ej) && /"ORIGENES"\s*:\s*"https:\/\/ianct2020\.github\.io,http:\/\/127\.0\.0\.1:5500"/.test(ej) && /compatibility_date/.test(ej), 'wrangler.ejemplo.jsonc: main, COPIAS con PEGAR_AQUI_EL_ID, ORIGENES y compatibility_date');
  ok(!/FIRMA|PERMITIDOS/.test(ej.replace(/\/\/.*$/gm, '')), 'wrangler.ejemplo.jsonc no trae FIRMA ni PERMITIDOS fuera de los comentarios (son secretos)');
  const gi = readFileSync(join(raiz, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
  ok(['worker/wrangler.jsonc', 'worker/.dev.vars*', 'worker/.wrangler/'].every((l) => gi.includes(l)), 'el .gitignore tapa worker/wrangler.jsonc, worker/.dev.vars* y worker/.wrangler/');
  const src = readFileSync(rutaWorker, 'utf8');
  ok(!/^\s*import\s/m.test(src) && !/require\(/.test(src), 'index.js no importa nada (sin dependencias)');
  ok(/crypto\.subtle\.verify/.test(src), 'verifica con crypto.subtle.verify (tiempo constante)');
  ok(!/console\.\w+\([^)]*(authorization|token|request\.headers|req\.headers)/i.test(src), 'ningún console.* con la cabecera Authorization ni un token');
}

fin();
