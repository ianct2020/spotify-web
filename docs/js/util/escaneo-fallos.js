// Los artistas cuyo escaneo FALLÓ, con el día (v=261).
//
// Un artista que falla (un 429 agotado, un corte de red, un «no encontrado en
// Spotify») no queda guardado en ningún sitio: el caché del escaneo solo lleva
// los que salieron bien. Al abrir la vista siguiente estaba otra vez «sin
// escanear» y volvía a la cola, y a costar. Pasó el 30/09 con Joseph Vincent.
//
// Esto NO es cachear el fallo como resultado (lo que v=256 sacó con
// `util/cache-solo-exitos.js`): no se guarda una discografía vacía ni un «no
// hay nada», que se serviría como verdad durante semanas. Se guarda solo
// «se intentó y falló el día X», y su única consecuencia es que las puertas
// AUTOMÁTICAS no lo reintentan solas. Un acto explícito —el selector,
// «Actualizar»— lo reintenta igual, y si sale bien la marca se borra.
//
// Por qué no vive en la base de discografías ni en el caché del escaneo: los dos
// son datos de Spotify; esto es un apunte nuestro sobre un intento. Es una clave
// chica de localStorage por vista, con la clave por usuario (`prefKey`).
//
// Todo local, 0 peticiones.

import { prefKey } from '../storage.js?v=266';

/** `nameLower` → `{ t: ISO del intento, motivo }`. */
export function leerFallos(lsKey) {
  const out = new Map();
  try {
    const v = JSON.parse(localStorage.getItem(prefKey(lsKey)) || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, f] of Object.entries(v)) {
        if (f && typeof f.t === 'string') out.set(k, { t: f.t, motivo: String(f.motivo || '') });
      }
    }
  } catch { /* valor roto: se lee como vacío */ }
  return out;
}

function guardar(lsKey, mapa) {
  try {
    localStorage.setItem(prefKey(lsKey), JSON.stringify(Object.fromEntries(mapa)));
  } catch { /* sin localStorage: la marca se pierde, no el escaneo */ }
}

/** Anota que el escaneo de este artista falló ahora. Devuelve el mapa entero. */
export function marcarFallo(lsKey, nameLower, motivo, ahora = new Date()) {
  const m = leerFallos(lsKey);
  if (!nameLower) return m;
  m.set(nameLower, { t: ahora.toISOString(), motivo: String(motivo || '').slice(0, 200) });
  guardar(lsKey, m);
  return m;
}

/** Borra la marca (el artista salió bien). Si no había, no escribe nada. */
export function limpiarFallo(lsKey, nameLower) {
  const m = leerFallos(lsKey);
  if (!m.delete(nameLower)) return m;
  guardar(lsKey, m);
  return m;
}

/**
 * Lo que una puerta AUTOMÁTICA puede encolar: la cola sin los marcados.
 * ⚠️ Las puertas explícitas (el selector, «Actualizar») no pasan por acá.
 */
export function sinFallosMarcados(cola, fallos) {
  return cola.filter(a => !fallos.has(a.nameLower));
}

/** «29 sept», el día del intento en tu hora. Cadena vacía si no parsea. */
export function fechaDelFallo(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}
