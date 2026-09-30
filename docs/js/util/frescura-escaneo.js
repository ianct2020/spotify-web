// La frescura del escaneo de las vistas de descubrir (v=262). Solo lógica y
// texto: sin IndexedDB, sin DOM, sin red.
//
// El caché del escaneo (`discover_scan_*`, 7 días) es una MARCA de «cuándo miré
// si salió algo nuevo», no los datos: los datos viven en la base de
// discografías (`discover_disco_base_v1_*`, sin caducidad). Hasta v=261 las
// vistas trataban las dos cosas como una: con el caché vencido —`idbGetCached`
// lo borra al leerlo vencido— la vista abría VACÍA con las 351 bases intactas,
// que costaron 805 peticiones y una cuota entera.
//
// Tres estados, y la cabecera tiene que decir en cuál está:
//   'al-dia'    hay caché de escaneo vigente (menos de 7 días)
//   'vencida'   no lo hay (vencido, o perdido) pero sí hay bases guardadas: se
//               pinta lo guardado y se dice que puede estar desactualizado
//   'sin-base'  tampoco hay bases: no hay nada que pintar
//
// ⚠️ Un número equivocado con cara de bueno es peor que uno que falta (v=255):
// con la frescura vencida, «N novedades sin escuchar» puede no incluir lo que
// salió después de la última comprobación. Por eso 'vencida' lleva su línea.

export const SCAN_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 días

const DIA_MS = 24 * 60 * 60 * 1000;

// 0 es «no consta» (así se guarda cuando hay que impedir que un escaneo parcial
// adelante la fecha sin saber cuál era); solo un número positivo es una fecha.
const esFecha = (ts) => Number.isFinite(ts) && ts > 0;

/**
 * ¿Está vencido un caché de escaneo leído CRUDO? `envelope.expiry` es el del
 * `idbSetCached`; `ts` es el del valor. Se miran los dos porque pueden diferir:
 * el caché se reescribe al guardar un escaneo parcial, pero el `ts` de la
 * comprobación no se adelanta (ver `saveScanCache`).
 */
export function escaneoVencido({ ts, expiry }, hoy = Date.now()) {
  if (typeof expiry === 'number' && hoy > expiry) return true;
  if (!esFecha(ts)) return true;   // sin fecha no se puede decir que está al día
  return hoy - ts > SCAN_TTL_MS;
}

/**
 * El estado de la vista. `guardado` es lo leído crudo ({ ts, vencido }) o null;
 * `nConBase` cuántos artistas de la vista tienen base guardada; `recienteMax` el
 * `recienteAt` más nuevo de esas bases (la última vez que se miró lo reciente de
 * alguno), que es la fecha cuando el caché de escaneo ya no existe.
 *
 * Devuelve { estado, ts }. `ts` es null si no consta cuándo se comprobó.
 */
export function estadoFrescura({ guardado, nConBase = 0, recienteMax = null }) {
  if (guardado && !guardado.vencido) return { estado: 'al-dia', ts: guardado.ts ?? null };
  if (!(nConBase > 0)) return { estado: 'sin-base', ts: null };
  const ts = esFecha(guardado?.ts) ? guardado.ts : (esFecha(recienteMax) ? recienteMax : null);
  return { estado: 'vencida', ts };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** «3 sept». La fecha es un instante (no un día del pipeline), así que va en hora local. */
export function fechaCorta(ts) {
  const d = new Date(ts);
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** «hoy» / «ayer» / «hace 8 días», por días de calendario LOCALES. */
export function haceCuanto(ts, hoy = Date.now()) {
  const a = new Date(hoy); a.setHours(0, 0, 0, 0);
  const b = new Date(ts); b.setHours(0, 0, 0, 0);
  const dias = Math.round((a - b) / DIA_MS);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

/**
 * La línea que acompaña al botón «Actualizar» cuando la frescura está vencida.
 * Solo se pide para el estado 'vencida'.
 */
export function textoFrescura(ts, hoy = Date.now()) {
  const cuando = esFecha(ts)
    ? `la última comprobación de novedades fue ${haceCuanto(ts, hoy)} (${fechaCorta(ts)})`
    : 'no consta cuándo se comprobaron las novedades por última vez';
  return `Lo que ves es lo guardado en este navegador: ${cuando}, así que puede faltar lo más reciente.`;
}

/**
 * La marca en memoria de «esta vista muestra lo guardado, no una comprobación
 * reciente». Existe por UN caso: guardar un escaneo PARCIAL (un artista desde el
 * selector) re-estamparía el caché con la hora de ahora, y la próxima apertura
 * diría «al día» con 350 artistas sin mirar, que es el número con cara de bueno
 * que este módulo vino a evitar. Mientras la marca esté puesta, `tsAlGuardar`
 * devuelve la fecha vieja y no la de ahora.
 *
 * Quien SÍ comprueba todo (el «Actualizar» y el importar, que pasan por
 * `clearScanCache`) la suelta con `soltar`; cada `render()` la fija de nuevo
 * según lo que leyó del disco.
 */
export function crearMarcasDeFrescura() {
  const marcas = new Map();   // viewKey → ts de la última comprobación (0 = no consta)
  return {
    /** `ts` null/undefined suelta la marca; cualquier otro valor la pone (un valor que no es fecha se guarda como 0). */
    fijar(viewKey, ts) {
      if (ts == null) marcas.delete(viewKey);
      else marcas.set(viewKey, esFecha(ts) ? ts : 0);
    },
    soltar(viewKey) { marcas.delete(viewKey); },
    /** El ts de la última comprobación si la marca está puesta, o null. */
    de(viewKey) { return marcas.has(viewKey) ? marcas.get(viewKey) : null; },
    /** El `ts` con el que hay que guardar el caché del escaneo. */
    tsAlGuardar(viewKey, ahora = Date.now()) { return marcas.has(viewKey) ? marcas.get(viewKey) : ahora; },
  };
}
