// La copia en la nube (tanda 123): lo PURO del cliente. Sin imports, sin red, sin DOM, sin `localStorage`.
//
// «Nube…» del ⚙ del Dashboard sube la copia de «Exportar todo» a un Worker de Cloudflare del usuario (`worker/` en la
// raíz del repo) y la baja como archivo. Acá viven las dos claves de `localStorage`, la validación de la dirección, la
// lectura del token propio (SIN verificarlo: lo verifica el Worker; acá solo se mira de quién es y hasta cuándo), los
// textos y el nombre de los archivos. Lo que habla con el Worker es `api/nube.js`; el modal, `features/dashboard.js`.
// Lo vigila `tests/nube-cliente.test.mjs`.

// Las dos claves, las dos con `prefKey()` (el uid de `fonoteca_last_user_id`). La dirección es una preferencia del
// `CENSO` y entra en la copia; el token propio es clase 5: no entra nunca y `contieneSecreto` busca su valor.
export const NUBE_URL_KEY = 'fonoteca_nube_url_v1';
export const NUBE_TOKEN_KEY = 'fonoteca_nube_token_v1';

// El tope del Worker (`worker/index.js`, TOPE_BYTES): uno menos que los 25 MiB de un valor de KV. El test los compara.
export const TOPE_BYTES = 24 * 1024 * 1024;

// En castellano de España, de «tú».
export const TEXTOS = {
  DIRECCION_MALA: 'La dirección tiene que ser la de tu Worker, que termina en .workers.dev.',
  RED: 'No se ha podido hablar con tu Worker.',
  PERMITIDOS: 'Tu cuenta de Spotify no está en la lista de tu Worker (PERMITIDOS).',
  CADUCADA: 'La conexión con tu Worker ha caducado: vuelve a conectar.',
  SPOTIFY_RECHAZO: 'Spotify no ha aceptado tu sesión: recarga la página y vuelve a conectar.',
  SPOTIFY_NO_CONTESTA: 'Tu Worker no ha podido preguntarle a Spotify quién eres: prueba otra vez dentro de un rato.',
  CONFIG: 'A tu Worker le falta configuración (FIRMA o PERMITIDOS): repasa la guía para desplegarlo.',
  OTRA_CUENTA: 'Tu Worker te ha reconocido como otra cuenta de Spotify, no como la de esta sesión: no se ha guardado la conexión.',
  OTRA_CUENTA_GUARDADA: 'La conexión guardada era de otra cuenta de Spotify: vuelve a conectar.',
  SIN_CUENTA: 'No se ha podido comprobar con qué cuenta de Spotify estás: recarga la página.',
  SIN_CONEXION: 'Conecta primero con tu Worker.',
  SECRETO: 'No se ha subido la copia: llevaba un dato de tu sesión de Spotify, y eso no puede salir del navegador.',
  NOTA: 'La copia lleva lo mismo que «Exportar todo» y se guarda en tu cuenta de Cloudflare. No lleva tu sesión de Spotify.',
  PARA_CARGAR: 'Para cargarla, usa «Importar todo» con el archivo.',
  SIN_COPIAS: 'Todavía no hay copias guardadas en tu Worker.',
  CONECTANDO: 'Conectando con tu Worker…',
  GUARDANDO: 'Guardando la copia…',
  BUSCANDO: 'Buscando tus copias…',
  BAJANDO: 'Bajando la copia…',
};

/**
 * La dirección del Worker: `https:`, el host termina en `.workers.dev`, sin ruta más allá de `/`, sin query ni `#`, sin
 * usuario, clave ni puerto. Devuelve `{ ok: true, url }` (el origen, sin barra final) o `{ ok: false, texto }`.
 */
export function validarDireccion(texto) {
  const mala = { ok: false, texto: TEXTOS.DIRECCION_MALA };
  const s = String(texto ?? '').trim();
  if (!s || /[?#\s]/.test(s)) return mala;
  let u;
  try { u = new URL(s); } catch { return mala; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return mala;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/.test(host)) return mala;
  if (u.pathname !== '/' && u.pathname !== '') return mala;
  return { ok: true, url: `https://${host}` };
}

/** `{ uid, vence }` del token propio, SIN verificar la firma (eso es del Worker). `null` si no tiene la forma. */
export function leerToken(token) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 2 || !partes[0] || !partes[1] || !/^[A-Za-z0-9_-]+$/.test(partes[0])) return null;
  try {
    const s = partes[0].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const p = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof p?.uid !== 'string' || !p.uid || typeof p.vence !== 'string' || Number.isNaN(Date.parse(p.vence))) return null;
    return { uid: p.uid, vence: p.vence };
  } catch {
    return null;
  }
}

/** El token sirve en esta sesión solo si es del uid de ahora y no venció. `{ uid, vence }` o `null`. */
export function conexionVigente(token, uidAhora, ahora = Date.now()) {
  const p = leerToken(token);
  if (!p || !uidAhora || p.uid !== uidAhora || Date.parse(p.vence) <= ahora) return null;
  return p;
}

/** El archivo que baja «Bajar»: el mismo nombre que «Exportar todo», con la fecha LOCAL de la copia. */
export function nombreDeCopia(fecha) {
  const d = new Date(fecha);
  const dd = (n) => String(n).padStart(2, '0');
  return `fonoteca-copia-${d.getFullYear()}-${dd(d.getMonth() + 1)}-${dd(d.getDate())}.json`;
}

/** «2 KB», «3,1 MB» (como el toast de «Exportar todo»). */
export function textoTamano(bytes) {
  return bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('es-ES')} KB`
    : `${(bytes / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`;
}
/** La hora local de un instante: «12:05». */
export function horaLocal(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export const textoDemasiadoGrande = (bytes) => `La copia pesa ${textoTamano(bytes)} comprimida, más de los 24 MB que admite el almacén.`;
export const textoConectado = (uid, fecha) => `Conectado como ${uid} hasta el ${fecha}`;
export const textoTodaviaNoAparece = (fecha) => `La que acabas de guardar (${fecha}) todavía no aparece: puede tardar un minuto.`;
export const textoNoEsta = (fecha) => `No se ha encontrado la copia del ${fecha} en tu Worker: puede que se haya borrado al guardar otra (se guardan las 5 últimas).`;
export const textoDescargada = (nombre) => `Descargada: ${nombre}.`;
export function textoGuardada({ fecha, bytes, bytesSinComprimir, errores = 0 }) {
  const base = `Copia guardada en la nube (${fecha}): ${textoTamano(bytes)} comprimida, ${textoTamano(bytesSinComprimir)} sin comprimir.`;
  return errores ? `${base} Pero está INCOMPLETA: no se han podido leer ${errores.toLocaleString('es-ES')} claves (están en «_errores» de la copia).` : base;
}
