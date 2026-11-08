// worker/index.js — la copia en la nube de Fonoteca (tanda 123): un Worker de Cloudflare con un almacén KV.
//
// Guarda la copia de «Exportar todo» de la app, comprimida con gzip en el navegador, y la devuelve tal cual. No sincroniza
// nada, no la abre y no la lee: el cuerpo se guarda como llega (el plan gratis da 10 ms de CPU por petición).
//
// 🔴 Este archivo está en un repo PÚBLICO: acá no hay ningún id de Spotify, de la cuenta de Cloudflare ni del almacén,
// ni ninguna dirección real. Todo entra por el entorno, que pone quien despliega:
//   env.COPIAS       el KV (binding en `wrangler.jsonc`)
//   env.FIRMA        SECRETO: la clave del HMAC con que se firman los tokens propios
//   env.PERMITIDOS   SECRETO: los ids de Spotify que pueden usarlo, separados por coma
//   env.ORIGENES     variable: los orígenes que pueden llamarlo desde un navegador, separados por coma (comparación exacta)
// Si falta FIRMA o PERMITIDOS (o el KV), toda ruta salvo el preflight contesta 500 {"error":"falta-configuracion"}: nunca
// un token firmado con una clave vacía.
//
// Las rutas (todas JSON salvo la descarga):
//   OPTIONS *               preflight: 204 con CORS si el origen vale; 403 sin cabeceras CORS si no
//   POST /sesion            Authorization: Bearer <token de Spotify>. UNA `GET https://api.spotify.com/v1/me` y nada más.
//                           401 de Spotify → 401 spotify-rechazo; id fuera de PERMITIDOS → 403 no-permitido; 429, 5xx,
//                           otra cosa o corte → 502 spotify-no-contesta. Si vale: { token, uid, vence } (30 días).
//   PUT /copias             Authorization: Bearer <token propio>. El cuerpo, los bytes gzip tal cual. Más de 24 MiB → 413.
//                           Guarda en `copia/<uid>/<fecha ISO del servidor>` con { bytes, fecha }, y poda a las 5 últimas.
//   GET /copias             [{ fecha, bytes }] del usuario del token, la más nueva primero.
//   GET /copias/<fecha>     los bytes, `application/gzip`; 404 si la clave no existe.
//   cualquier otra          404 {"error":"no-existe"}.
//
// 🔴 El uid de cada ruta sale SOLO del token propio, nunca de la URL, del cuerpo ni de una cabecera.
// 🔴 El token de Spotify no se guarda en ningún lado y no se loguea nunca: un `catch` loguea la ruta y el tipo de error.
// 🔴 KV es eventualmente consistente («up to 60 seconds or more» fuera del lugar donde se escribió, y también recuerda que
//    una clave NO existe): por eso cada copia es una clave NUEVA y ninguna clave se pisa nunca. Lo que se baja bajo una
//    fecha es siempre esa copia, entera. La poda trabaja con lo que lista y solo borra las más viejas: si la lista llega
//    sin la nueva, quedan 6 un rato; la nueva no se borra nunca.
//
// Sin dependencias: solo lo que trae el entorno (`fetch`, `Request`, `Response`, `crypto.subtle`, `TextEncoder`, `atob`,
// `btoa`). Lo prueban `tests/nube-worker.test.mjs` (Node) y el banco `tests/banco/nube.html` (la app entera contra él).

export const TOPE_BYTES = 24 * 1024 * 1024;
export const MAX_COPIAS = 5;
export const DURACION_MS = 30 * 24 * 60 * 60 * 1000;
export const UID_VALIDO = /^[A-Za-z0-9._-]{1,64}$/;
export const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SPOTIFY_ME = 'https://api.spotify.com/v1/me';
const ESPERA_SPOTIFY_MS = 10000;

const codificar = new TextEncoder();

// ── base64url ────────────────────────────────────────────────────────────────
function aB64url(bytes) {
  const b = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function desdeB64url(texto) {
  if (typeof texto !== 'string' || !/^[A-Za-z0-9_-]+$/.test(texto)) return null;
  const s = texto.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// ── El token propio: base64url(JSON {uid, vence, v: 1}) + "." + base64url(HMAC-SHA256(FIRMA, esa primera parte)) ──────
const claveHmac = (firma) => crypto.subtle.importKey('raw', codificar.encode(firma), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function firmarToken({ uid, vence, v = 1 }, firma) {
  const cuerpo = aB64url(codificar.encode(JSON.stringify({ uid, vence, v })));
  const sello = await crypto.subtle.sign('HMAC', await claveHmac(firma), codificar.encode(cuerpo));
  return `${cuerpo}.${aB64url(sello)}`;
}

/** `{ uid, vence }` si el token es de esta FIRMA, no venció, es `v: 1` y el uid pasa la regla; si no, `null`. */
export async function verificarToken(token, firma, ahora = Date.now()) {
  if (typeof token !== 'string' || typeof firma !== 'string' || !firma) return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const [cuerpo, selloTexto] = partes;
  const sello = desdeB64url(selloTexto), crudo = desdeB64url(cuerpo);
  if (!sello || !crudo || sello.length !== 32) return null;
  let bueno = false;
  try {
    // `crypto.subtle.verify` compara en tiempo constante (nada de comparar textos a mano).
    bueno = await crypto.subtle.verify('HMAC', await claveHmac(firma), sello, codificar.encode(cuerpo));
  } catch {
    return null;
  }
  if (!bueno) return null;
  let p;
  try { p = JSON.parse(new TextDecoder().decode(crudo)); } catch { return null; }
  if (!p || p.v !== 1 || typeof p.uid !== 'string' || !UID_VALIDO.test(p.uid) || typeof p.vence !== 'string') return null;
  const vence = Date.parse(p.vence);
  if (!Number.isFinite(vence) || vence <= ahora) return null;
  return { uid: p.uid, vence: p.vence };
}

// ── Claves del KV ────────────────────────────────────────────────────────────
export function prefijoDe(uid) {
  if (typeof uid !== 'string' || !UID_VALIDO.test(uid)) throw new Error('uid inválido');
  return `copia/${uid}/`;
}
export function claveDeCopia(uid, fecha) {
  if (typeof fecha !== 'string' || !FECHA_VALIDA.test(fecha)) throw new Error('fecha inválida');
  return prefijoDe(uid) + fecha;
}

// ── CORS ─────────────────────────────────────────────────────────────────────
const origenesDe = (env) => String(env?.ORIGENES || '').split(',').map((s) => s.trim()).filter(Boolean);
/** `Vary: Origin` siempre; `Access-Control-Allow-Origin` solo si el `Origin` está en ORIGENES (comparación exacta). */
export function cabecerasCors(request, env) {
  const h = { Vary: 'Origin' };
  const origen = request.headers.get('Origin');
  if (origen && origenesDe(env).includes(origen)) h['Access-Control-Allow-Origin'] = origen;
  return h;
}

// ── Ayudantes ────────────────────────────────────────────────────────────────
const permitidosDe = (env) => String(env?.PERMITIDOS || '').split(',').map((s) => s.trim()).filter(Boolean);
const configurado = (env) => typeof env?.FIRMA === 'string' && env.FIRMA.length > 0 && permitidosDe(env).length > 0 && !!env.COPIAS;
const json = (cuerpo, status, cors) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
function portador(request) {
  const m = /^Bearer\s+(\S+)$/.exec(request.headers.get('Authorization') || '');
  return m ? m[1] : null;
}
async function listarTodas(env, prefix) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await env.COPIAS.list({ prefix, ...(cursor ? { cursor } : {}) });
    out.push(...r.keys);
    if (r.list_complete || !r.cursor) break;
    cursor = r.cursor;
  }
  return out;
}

// ── POST /sesion ─────────────────────────────────────────────────────────────
async function sesion(request, env, cors) {
  const tokenSpotify = portador(request);
  if (!tokenSpotify) return json({ error: 'spotify-rechazo' }, 401, cors);
  let res;
  try {
    const espera = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ESPERA_SPOTIFY_MS) : undefined;
    res = await fetch(SPOTIFY_ME, { method: 'GET', headers: { Authorization: `Bearer ${tokenSpotify}` }, ...(espera ? { signal: espera } : {}) });
  } catch {
    return json({ error: 'spotify-no-contesta' }, 502, cors);
  }
  if (res.status === 401) return json({ error: 'spotify-rechazo' }, 401, cors);
  if (res.status !== 200) return json({ error: 'spotify-no-contesta' }, 502, cors);
  let yo;
  try { yo = await res.json(); } catch { return json({ error: 'spotify-no-contesta' }, 502, cors); }
  const uid = typeof yo?.id === 'string' && yo.id ? yo.id : null;
  if (!uid) return json({ error: 'spotify-no-contesta' }, 502, cors);
  if (!permitidosDe(env).includes(uid) || !UID_VALIDO.test(uid)) return json({ error: 'no-permitido' }, 403, cors);
  const vence = new Date(Date.now() + DURACION_MS).toISOString();
  return json({ token: await firmarToken({ uid, vence }, env.FIRMA), uid, vence }, 200, cors);
}

// ── PUT /copias ──────────────────────────────────────────────────────────────
async function guardar(uid, request, env, cors) {
  const largo = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(largo) && largo > TOPE_BYTES) return json({ error: 'demasiado-grande' }, 413, cors);
  const cuerpo = new Uint8Array(await request.arrayBuffer());
  if (cuerpo.byteLength > TOPE_BYTES) return json({ error: 'demasiado-grande' }, 413, cors);
  if (cuerpo.byteLength < 2 || cuerpo[0] !== 0x1f || cuerpo[1] !== 0x8b) return json({ error: 'no-es-gzip' }, 400, cors);
  // La fecha del servidor. Si esa clave ya existe (dos copias en el mismo milisegundo), la siguiente: nunca se pisa.
  const t = Date.now();
  let fecha = null, clave = null;
  for (let i = 0; i < 50; i++) {
    const f = new Date(t + i).toISOString();
    const k = claveDeCopia(uid, f);
    if ((await env.COPIAS.get(k, 'arrayBuffer')) === null) { fecha = f; clave = k; break; }
  }
  if (!clave) throw new Error('sin fecha libre');
  await env.COPIAS.put(clave, cuerpo, { metadata: { bytes: cuerpo.byteLength, fecha } });
  // La poda, con lo que liste: solo las más viejas, nunca la recién escrita.
  const listadas = (await listarTodas(env, prefijoDe(uid))).map((k) => k.name).sort().reverse();
  const aBorrar = listadas.slice(MAX_COPIAS).filter((k) => k !== clave);
  for (const k of aBorrar) await env.COPIAS.delete(k);
  const guardadas = listadas.length - aBorrar.length + (listadas.includes(clave) ? 0 : 1);
  return json({ fecha, bytes: cuerpo.byteLength, guardadas }, 200, cors);
}

// ── GET /copias y GET /copias/<fecha> ────────────────────────────────────────
async function listar(uid, env, cors) {
  const prefijo = prefijoDe(uid);
  const copias = (await listarTodas(env, prefijo))
    .map((k) => ({ fecha: typeof k.metadata?.fecha === 'string' ? k.metadata.fecha : k.name.slice(prefijo.length), bytes: Number(k.metadata?.bytes) || 0 }))
    .filter((c) => FECHA_VALIDA.test(c.fecha))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  return json(copias, 200, cors);
}
async function bajar(uid, fechaCruda, env, cors) {
  let fecha;
  try { fecha = decodeURIComponent(fechaCruda); } catch { return json({ error: 'no-existe' }, 404, cors); }
  if (!FECHA_VALIDA.test(fecha)) return json({ error: 'no-existe' }, 404, cors);
  const valor = await env.COPIAS.get(claveDeCopia(uid, fecha), 'arrayBuffer');
  if (valor === null) return json({ error: 'no-existe' }, 404, cors);
  return new Response(valor, { status: 200, headers: { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', ...cors } });
}

export default {
  async fetch(request, env) {
    const cors = cabecerasCors(request, env);
    let ruta = 'desconocida';
    try {
      if (request.method === 'OPTIONS') {
        if (!cors['Access-Control-Allow-Origin']) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
        return new Response(null, {
          status: 204,
          headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' },
        });
      }
      if (!configurado(env)) return json({ error: 'falta-configuracion' }, 500, cors);
      const camino = new URL(request.url).pathname;
      const metodo = request.method;
      if (camino === '/sesion' && metodo === 'POST') { ruta = 'POST /sesion'; return await sesion(request, env, cors); }
      const esCopias = camino === '/copias' && (metodo === 'PUT' || metodo === 'GET');
      const esUna = camino.startsWith('/copias/') && metodo === 'GET';
      if (!esCopias && !esUna) return json({ error: 'no-existe' }, 404, cors);
      ruta = esUna ? 'GET /copias/<fecha>' : `${metodo} /copias`;
      const quien = await verificarToken(portador(request), env.FIRMA);
      if (!quien) return json({ error: 'token-invalido' }, 401, cors);
      if (esUna) return await bajar(quien.uid, camino.slice('/copias/'.length), env, cors);
      if (metodo === 'PUT') return await guardar(quien.uid, request, env, cors);
      return await listar(quien.uid, env, cors);
    } catch (e) {
      // Solo la ruta y el tipo de error: nunca el mensaje (podría traer algo de la petición), ni cabeceras, ni tokens.
      console.error('[worker]', ruta, e?.name || 'Error');
      return json({ error: 'error-interno' }, 500, cors);
    }
  },
};
