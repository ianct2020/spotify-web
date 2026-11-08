// La copia en la nube (tanda 123): lo que habla con el Worker de Cloudflare del usuario (`worker/` en la raíz del repo).
//
//   conectarNube(url)          UN `POST /sesion` con el token de Spotify de `getValidToken()`; guarda la dirección y el
//                              token propio que devuelve el Worker. Es la ÚNICA vez que el token de Spotify sale hacia el
//                              Worker (que no lo guarda: hace un `GET /v1/me` y lo suelta).
//   guardarCopiaEnNube()       la copia de `exportarCopiaCompleta()` (la de «Exportar todo», no otra), gzip y UN `PUT`.
//                              🔴 Si la copia lleva un secreto (`secretos` o `contieneSecreto`), NO se manda nada. Si el gzip
//                              pasa de 24 MiB, tampoco. Dos llamadas a la vez = UN `PUT`.
//   listarCopiasDeNube()       UN `GET /copias`.
//   bajarCopiaDeNube(fecha)    UN `GET /copias/<fecha>`, descomprime y DESCARGA el archivo. No lo importa.
//   leerConexion()             lo guardado, sin pedir nada: la dirección y el token propio si es del uid de ahora.
//
// 🔴 Ninguna escritura local salvo dos claves de `localStorage`, las dos con `prefKey()`: la dirección y el token propio
// (`util/nube.js`). Nada en IndexedDB. Lo vigila la lectura estática de `tests/nube-cliente.test.mjs`.
// 🔴 Los errores, sin silencio (v=154): cada uno sale como `ErrorNube` con su `texto` para la pantalla, y el error crudo va
// a `console.warn('[nube] …')`. Nunca se devuelve nada que se lea como «guardada» si el `PUT` no contestó 200 con JSON.

import { getValidToken } from '../auth.js?v=363';
import { prefKey } from '../storage.js?v=363';
import { exportarCopiaCompleta, getCurrentUserId } from '../api.js?v=363';
import { contieneSecreto } from '../util/copia-completa.js?v=363';
import { descargarBlob } from '../features/covers-wallpaper.js?v=363';
import { NUBE_URL_KEY, NUBE_TOKEN_KEY, TOPE_BYTES, TEXTOS, validarDireccion, leerToken, conexionVigente, nombreDeCopia, textoDemasiadoGrande, textoNoEsta } from '../util/nube.js?v=363';

const claveUrl = () => prefKey(NUBE_URL_KEY);
const claveToken = () => prefKey(NUBE_TOKEN_KEY);

/** Un error de la nube: `codigo` para decidir, `texto` para la pantalla. */
export class ErrorNube extends Error {
  constructor(codigo, texto) {
    super(texto);
    this.name = 'ErrorNube';
    this.codigo = codigo;
    this.texto = texto;
  }
}
const avisar = (que, crudo) => console.warn(`[nube] ${que}`, crudo ?? '');
const red = () => new ErrorNube('red', TEXTOS.RED);

// `localStorage` entero, SOLO para leer (la segunda red de los secretos, como `leido.ls` de «Exportar todo»).
function lsAhora() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const v = localStorage.getItem(k); if (v != null) out[k] = v; }
  return out;
}

/**
 * Lo guardado, sin pedir nada a nadie. El token propio vale solo si es del uid de ahora (`fonoteca_last_user_id`, el
 * mismo que pone el prefijo de `prefKey()`) y no venció; si no, se borra y `descartado` dice por qué.
 */
export function leerConexion() {
  const url = localStorage.getItem(claveUrl());
  const token = localStorage.getItem(claveToken());
  if (!token) return { url, token: null, conexion: null };
  const uid = localStorage.getItem('fonoteca_last_user_id');
  const conexion = conexionVigente(token, uid);
  if (conexion) return { url, token, conexion };
  const p = leerToken(token);
  localStorage.removeItem(claveToken());
  return { url, token: null, conexion: null, descartado: p && p.uid !== uid ? 'otra-cuenta' : 'vencido' };
}

async function alWorker(base, ruta, opciones, que) {
  try {
    return await fetch(base + ruta, { cache: 'no-store', ...opciones });
  } catch (e) {
    avisar(`${que}: el Worker no contestó`, e);
    throw red();
  }
}
async function leerJson(res, que) {
  try {
    return await res.json();
  } catch (e) {
    avisar(`${que}: la respuesta no es JSON (${res.status})`, e);
    throw red();
  }
}
// El token propio sirve solo para la cuenta de esta sesión (`getCurrentUserId()`, memoizado: con el Dashboard abierto ya
// está preguntado). Si es de otra, se borra.
async function comprobarCuenta(conexion) {
  let ahora;
  try { ahora = await getCurrentUserId(); } catch (e) { avisar('no se pudo comprobar la cuenta de Spotify', e); throw new ErrorNube('cuenta', TEXTOS.SIN_CUENTA); }
  if (conexion.uid !== ahora) {
    localStorage.removeItem(claveToken());
    throw new ErrorNube('sin-conexion', TEXTOS.OTRA_CUENTA_GUARDADA);
  }
}
function conectado() {
  const c = leerConexion();
  if (!c.url || !c.token || !c.conexion) throw new ErrorNube('sin-conexion', c.descartado === 'otra-cuenta' ? TEXTOS.OTRA_CUENTA_GUARDADA : c.descartado === 'vencido' ? TEXTOS.CADUCADA : TEXTOS.SIN_CONEXION);
  return c;
}
function caducada() {
  localStorage.removeItem(claveToken());
  return new ErrorNube('caducada', TEXTOS.CADUCADA);
}

/** «Conectar»: devuelve `{ uid, vence }` y guarda la dirección y el token propio. */
export async function conectarNube(direccion) {
  const v = validarDireccion(direccion);
  if (!v.ok) throw new ErrorNube('direccion', v.texto);
  const tokenSpotify = await getValidToken();
  const res = await alWorker(v.url, '/sesion', { method: 'POST', headers: { Authorization: `Bearer ${tokenSpotify}` } }, 'POST /sesion');
  if (res.status === 403) throw new ErrorNube('permitidos', TEXTOS.PERMITIDOS);
  if (res.status === 401) throw new ErrorNube('spotify', TEXTOS.SPOTIFY_RECHAZO);
  if (res.status === 502) throw new ErrorNube('spotify', TEXTOS.SPOTIFY_NO_CONTESTA);
  if (res.status === 500) {
    const d = await res.json().catch(() => null);
    if (d?.error === 'falta-configuracion') throw new ErrorNube('config', TEXTOS.CONFIG);
  }
  if (res.status !== 200) { avisar(`POST /sesion: el Worker contestó ${res.status}`); throw red(); }
  const d = await leerJson(res, 'POST /sesion');
  const p = leerToken(d?.token);
  if (!p || p.uid !== d.uid) { avisar('POST /sesion: la respuesta no trae un token propio'); throw red(); }
  let ahora;
  try { ahora = await getCurrentUserId(); } catch (e) { avisar('no se pudo comprobar la cuenta de Spotify', e); throw new ErrorNube('cuenta', TEXTOS.SIN_CUENTA); }
  if (p.uid !== ahora) throw new ErrorNube('otra-cuenta', TEXTOS.OTRA_CUENTA);
  localStorage.setItem(claveUrl(), v.url);
  localStorage.setItem(claveToken(), d.token);
  return { uid: p.uid, vence: p.vence };
}

let _guardando = null;
/** «Guardar copia en la nube». Dos llamadas mientras la primera sigue en vuelo devuelven la MISMA promesa: un `PUT`. */
export function guardarCopiaEnNube(opciones = {}) {
  if (!_guardando) _guardando = guardar(opciones).finally(() => { _guardando = null; });
  return _guardando;
}
async function guardar({ ahora = new Date() } = {}) {
  const { url, token, conexion } = conectado();
  const r = await exportarCopiaCompleta({ ahora });
  // 🔴 Antes de cualquier petición: si la copia lleva un dato de la sesión (el de Spotify o el token propio), no sale.
  const secretos = [...new Set([...r.secretos, ...contieneSecreto(r.texto, lsAhora())])];
  if (secretos.length) {
    avisar('la copia llevaba el valor de', secretos);
    throw new ErrorNube('secreto', TEXTOS.SECRETO);
  }
  const gz = new Uint8Array(await new Response(new Blob([r.texto]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  if (gz.byteLength > TOPE_BYTES) throw new ErrorNube('tamano', textoDemasiadoGrande(gz.byteLength));
  await comprobarCuenta(conexion);
  const res = await alWorker(url, '/copias', { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' }, body: gz }, 'PUT /copias');
  if (res.status === 401) throw caducada();
  if (res.status === 413) throw new ErrorNube('tamano', textoDemasiadoGrande(gz.byteLength));
  if (res.status !== 200) { avisar(`PUT /copias: el Worker contestó ${res.status}`); throw red(); }
  const d = await leerJson(res, 'PUT /copias');
  if (typeof d?.fecha !== 'string' || Number.isNaN(Date.parse(d.fecha))) { avisar('PUT /copias: la respuesta no trae la fecha', d); throw red(); }
  return { fecha: d.fecha, bytes: gz.byteLength, bytesSinComprimir: r.bytes, guardadas: Number.isFinite(d.guardadas) ? d.guardadas : null, errores: r.errores.length };
}

/** «Ver copias guardadas»: `[{ fecha, bytes }]`, la más nueva primero. */
export async function listarCopiasDeNube() {
  const { url, token, conexion } = conectado();
  await comprobarCuenta(conexion);
  const res = await alWorker(url, '/copias', { headers: { Authorization: `Bearer ${token}` } }, 'GET /copias');
  if (res.status === 401) throw caducada();
  if (res.status !== 200) { avisar(`GET /copias: el Worker contestó ${res.status}`); throw red(); }
  const d = await leerJson(res, 'GET /copias');
  if (!Array.isArray(d)) { avisar('GET /copias: la respuesta no es una lista', d); throw red(); }
  return d
    .filter((x) => typeof x?.fecha === 'string' && !Number.isNaN(Date.parse(x.fecha)))
    .map((x) => ({ fecha: x.fecha, bytes: Number(x.bytes) || 0 }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
}

/** «Bajar»: descarga `fonoteca-copia-<AAAA-MM-DD>.json` (descomprimido). No lo importa. 404 → código «no-aparece». */
export async function bajarCopiaDeNube(fecha) {
  const { url, token, conexion } = conectado();
  await comprobarCuenta(conexion);
  const res = await alWorker(url, `/copias/${encodeURIComponent(fecha)}`, { headers: { Authorization: `Bearer ${token}` } }, 'GET /copias/<fecha>');
  if (res.status === 401) throw caducada();
  if (res.status === 404) throw new ErrorNube('no-aparece', textoNoEsta(fecha));
  if (res.status !== 200 || !res.body) { avisar(`GET /copias/<fecha>: el Worker contestó ${res.status}`); throw red(); }
  let texto;
  try {
    texto = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
  } catch (e) {
    avisar('GET /copias/<fecha>: no se pudo descomprimir', e);
    throw red();
  }
  const blob = new Blob([texto], { type: 'application/json' });
  const nombre = nombreDeCopia(fecha);
  descargarBlob(blob, nombre);
  return { nombre, bytes: blob.size };
}
