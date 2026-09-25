// Cuánto va a costar un escaneo, ANTES de empezarlo.
//
// Las dos vistas que escanean (`#new-releases` y `#discover-artists`) pueden
// gastar cuotas caras de Spotify sin que el usuario lo haya pedido: el
// `render()` de las dos termina en `scanArtists()`, o sea que ABRIR LA VISTA
// escanea solo. Este módulo calcula el número que hace falta para avisar.
//
// Las dos cuotas, medidas (no estimadas):
//
//   - `/artists/{id}/albums` se corta a los **100 requests acumulados** y el
//     bloqueo dura **86+ minutos** (medido el 24/09).
//   - `/search` se corta en el request **697** (medido el 24/09) y deja la
//     búsqueda de TODA la app caída **3+ horas**.
//
// Y las dos son de la CUENTA de Spotify, no del navegador: escanear en la
// netbook puede dejar sin discografías al escritorio.
//
// Peor todavía, las dos están encadenadas: ante un 429/400/403 del nativo,
// `getArtistAlbumsConFuente` (api.js:1532-1560) se pasa a `/search` por su
// cuenta, y la pausa del nativo manda a `/search` toda su ventana. O sea que
// agotar la primera cuota empieza a gastar la segunda, y el supuesto de que
// son independientes es falso.
//
// ⚠️ Ese encadenamiento NO es lo que pasó el 24/09. Aquella noche los 702
// requests de `/search` fueron el paso 2 del plan, pedidos a propósito, y el
// paso 3 (el nativo, 82 requests) corrió después sin un solo 429 — paró al
// llegar al tope de la ventana, no por cuota. El camino existe en el código
// pero todavía no se lo vio correr.

import { idbEntriesByPrefix, idbGetCached } from '../idb.js?v=243';
import { DISCO_BASE_PREFIX, RECIENTE_TTL_MS, RECIENTE_FORZADO_MIN_MS, PRESUPUESTO_REFRESCO } from './disco-base.js?v=243';

// Requests de `/artists/{id}/albums` que cuesta UN artista sin base.
//
// El endpoint pagina de a 10 (`ARTIST_ALBUMS_MAX_LIMIT`, api.js:1420), así que
// un artista cuesta `ceil(lanzamientos / 10)` requests. Medido sobre las 300
// bases reales del 2026-09-25 (13.006 lanzamientos): mediana 4 páginas, media
// **4,77**. Se redondea a 5 y no a 4 a propósito — un aviso que se queda corto
// es peor que uno que se pasa, porque la cuota se agota igual.
//
// Con este número, la cuota nativa de 100 se agota con ~21 artistas sin base.
export const PAGINAS_POR_ARTISTA = 5;

// A partir de cuántos requests se pide confirmación.
//
// Ni 100 ni 10:
//   - Avisar en 100 es avisar cuando ya es tarde: el bloqueo pasa DURANTE el
//     escaneo, no al final.
//   - Avisar en 10 (2 artistas nuevos) es ruido, y a un aviso que salta
//     siempre se le aprende a decir que sí sin leerlo.
// 40 son 8 artistas sin base: por debajo de eso un escaneo no puede, solo,
// acercarse al límite, y todavía entran dos seguidos antes de agotarlo.
export const UMBRAL_AVISO = 40;

/**
 * Índice de las bases que ya están guardadas: `artistId` → `recienteAt`.
 * Una sola pasada de cursor, `readonly`. 0 requests.
 */
async function leerIndiceDeBases() {
  const idx = new Map();
  try {
    for (const [k, w] of await idbEntriesByPrefix(DISCO_BASE_PREFIX)) {
      const b = w?.value;
      if (b && Array.isArray(b.items)) idx.set(k.slice(DISCO_BASE_PREFIX.length), b.recienteAt || 0);
    }
  } catch { /* sin índice: se estima todo como «sin base», que es el lado caro */ }
  return idx;
}

/**
 * Qué va a costar escanear estos artistas. Todo local: 0 requests.
 *
 * `artistas` son los de la cola del escaneo, tal como la arma `scanArtists()`
 * — o sea los que TODAVÍA no están escaneados, no los de la vista entera.
 *
 * Devuelve, además de los totales, `exacto`: si hay artistas sin base, el
 * número de requests NO se puede saber de antemano, porque depende de cuántos
 * lanzamientos tenga cada discografía, y eso solo lo sabe Spotify. En ese caso
 * `nativos` es una estimación y `minimo` es el piso real (1 página por artista).
 */
export async function estimarCostoDeEscaneo(artistas, { forzar = false } = {}) {
  const idx = await leerIndiceDeBases();
  const ahora = Date.now();
  const umbralEdad = forzar ? RECIENTE_FORZADO_MIN_MS : RECIENTE_TTL_MS;

  let sinBase = 0;      // hay que pedir la discografía ENTERA (endpoint caro)
  let sinId = 0;        // ni siquiera sabemos el id: 1 `/search` para buscarlo
  let aRefrescar = 0;   // tienen base; solo se mira lo reciente (1 `/search`)

  for (const a of artistas) {
    let id = a.id || a.seedId || null;
    if (!id) {
      // El id puede estar cacheado de antes (60 días) y entonces es gratis.
      try { id = await idbGetCached(`discover_artist_id_${a.nameLower}`); } catch { /* ignora */ }
      if (!id) sinId++;
    }
    const recienteAt = id ? idx.get(id) : undefined;
    if (recienteAt === undefined) { sinBase++; continue; }
    if (ahora - recienteAt > umbralEdad) aRefrescar++;
  }

  // Lo reciente está acotado por el presupuesto de la ronda: lo que no entra
  // no se pide, se deja para la próxima (discover-common.js:115).
  const refrescos = Math.min(aRefrescar, PRESUPUESTO_REFRESCO);
  const nativos = sinBase * PAGINAS_POR_ARTISTA;
  const busquedas = sinId + refrescos;

  return {
    artistas: artistas.length,
    sinBase,
    sinId,
    aRefrescar: refrescos,
    pendientes: Math.max(0, aRefrescar - refrescos),
    nativos,
    busquedas,
    total: nativos + busquedas,
    minimo: sinBase + busquedas,   // piso: 1 página por discografía
    exacto: sinBase === 0,
  };
}

/** ¿Hace falta pedir permiso para este escaneo? */
export function superaUmbral(est) {
  return est.total >= UMBRAL_AVISO;
}
