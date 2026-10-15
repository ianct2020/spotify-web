// El escaneo de `#mapa` contra MusicBrainz (v=304, tanda 52).
//
// El bucle, con TODO lo que toca el mundo inyectado: la red (`pedir`), el reloj
// (`reloj.ahora`, `reloj.esperar`), el guardado (`guardarArtista`,
// `guardarArea`) y la señal para parar. Así `tests/mapa-escaneo.test.mjs` lo
// corre en Node con un MusicBrainz y un reloj de mentira, y la vista
// (`features/mapa.js`) le enchufa el `fetch` real, IndexedDB y `setTimeout`.
// La regla (qué artista es, de qué país) NO vive acá: es `util/mb-pais.js`, a
// través de `proximoPaso()` de `util/mapa-paises.js`. Este archivo solo decide
// QUÉ pedir, CUÁNDO y qué hacer si MusicBrainz no contesta.
//
// Lo que se decidió en la tanda 52, con lo que midieron la 50 y la 51 (el ajuste
// fino del ritmo es de otra tanda):
//
//   · UNA petición por vez y 1.200 ms como mínimo entre COMIENZOS: el ritmo de
//     las dos mediciones. Aun así MusicBrainz contestó 503 al 3 % (50) y al 6 %
//     (51) de las peticiones.
//   · Un 503, un 429, un 5xx o un corte de red es de MusicBrainz, no del
//     artista: se espera 10 s y se reintenta EL MISMO pedido; si vuelve a
//     fallar, 20, 40, 80 y de ahí 80 fijos. Nunca se guarda y nunca salta al
//     artista: «fallé al preguntar» no es un resultado (la regla de
//     `util/cache-solo-exitos.js`, aplicada a mano porque acá hay que distinguir
//     tres salidas y no dos; ver `pedirUno`).
//   · 8 fallos seguidos sin ningún 200 en el medio → el escaneo se pausa solo
//     (`motivo: 'pausa'`). Lo ya guardado queda guardado.
//   · Un 4xx que no es 429 (un 400 por una consulta rara, un 404 de un área) es
//     del ARTISTA: queda «no se pudo consultar» en esta sesión, sin guardar
//     nada, y el escaneo sigue con el siguiente. También cuenta como fallo
//     seguido (no es un 200).
//   · Cada respuesta buena se guarda ANTES de la petición siguiente: si se
//     cierra la pestaña, lo contestado está en la caché y no se vuelve a pedir.
//   · Un área se pide una sola vez en toda la vida de la caché: el costo de
//     subir por el área es por ÁREA DISTINTA, no por artista (tanda 51).
//
// ⚠️ Las esperas NUNCA van encadenadas. Chrome espacia los `setTimeout`
// encadenados de una pestaña oculta hasta uno por minuto (medido en el repo, ver
// CLAUDE.md, «Medir con la pestaña de la extensión»). Por eso antes de cada
// `fetch` hay COMO MUCHO una espera —la más larga entre lo que falta para el
// mínimo de 1.200 ms y lo que falta del reintento—, y después de cada espera
// viene un `fetch`, nunca otra espera. Aun así, en headless no se puede
// comprobar cómo se porta una pestaña oculta: la vista lo dice y enseña el ritmo
// medido para que, si se frena, se vea.

import { proximoPaso, recortarArtistas, recortarArea, idsDeGrabacion } from './mapa-paises.js';
import { queryArtista, queryGrabacion, limpiarTitulo } from './mb-pais.js';

export const BASE_MB = 'https://musicbrainz.org/ws/2';
export const INTERVALO_MS = 1200;
export const ESPERAS_MS = [10_000, 20_000, 40_000, 80_000];
export const FALLOS_PARA_PAUSAR = 8;
export const NOMBRE_CANDADO = 'fonoteca-mapa-escaneo';

// Las tres URLs, idénticas a las de la medición de la tanda 51
// (`fonoteca-migracion/mapa/medir-mb-paises-2026-10-14.mjs`): lo que mida la app
// tiene que poder compararse con aquello.
export const urlBusqueda = (nombre) => `${BASE_MB}/artist/?query=${encodeURIComponent(queryArtista(nombre))}&limit=10&fmt=json`;
export const urlGrabacion = (tema, nombre) => `${BASE_MB}/recording/?query=${encodeURIComponent(queryGrabacion(limpiarTitulo(tema), nombre))}&limit=25&fmt=json`;
export const urlArea = (id) => `${BASE_MB}/area/${id}?inc=area-rels&fmt=json`;

/** La espera antes del reintento número `n` (1 = el primero) del mismo pedido. */
export function esperaTrasFallo(n) {
  return ESPERAS_MS[Math.min(Math.max(n, 1), ESPERAS_MS.length) - 1];
}

// ¿Este código es culpa de MusicBrainz (se reintenta) o del pedido (no)?
const esDeMusicBrainz = (status) => status === 'red' || status === 429 || (typeof status === 'number' && status >= 500);

/**
 * Corre el escaneo hasta terminar, parar o pausarse. Modifica `artistas` y
 * `areas` (los Map de la caché en memoria) a medida que guarda.
 *
 * @param {object}   o
 * @param {Array}    o.lista           `universo()` de `mapa-paises.js`, YA en orden
 * @param {Map}      o.artistas        nombre → registro (lo que haya en la caché)
 * @param {Map}      o.areas           id → área recortada
 * @param {Function} o.pedir           `async (url, {signal}) => ({status, datos})`;
 *                                     tira si la red falla. `datos` es el JSON
 *                                     (solo hace falta con 200)
 * @param {Function} o.guardarArtista  `async (nombre, registro)`
 * @param {Function} o.guardarArea     `async (id, area)`
 * @param {object}   o.reloj           `{ ahora(): ms, esperar(ms, signal): Promise }`
 * @param {AbortSignal} [o.signal]
 * @param {Function} [o.seguir]        `() => boolean`, se pregunta después de
 *                                     cada `await` (la vista pasa la vigencia de
 *                                     la ruta: un teardown no corta un await)
 * @param {Set}      [o.saltar]        nombres que no se piden (ya fallaron en la sesión)
 * @param {Function} [o.onPeticion]    `({url, tipo, nombre, status, comienzo, reintento})`
 * @param {Function} [o.onArtista]     `(nombre, 'resuelto' | 'no-se-pudo')`
 * @returns {Promise<{motivo: 'completo'|'parado'|'pausa', noSePudo: string[], peticiones: number}>}
 */
export async function escanear({
  lista, artistas, areas, pedir, guardarArtista, guardarArea, reloj,
  signal = null, seguir = () => true, saltar = new Set(), onPeticion = null, onArtista = null,
}) {
  const sigo = () => !signal?.aborted && seguir();
  const noSePudo = [];
  let ultimoComienzo = -Infinity;
  let fallosSeguidos = 0;
  let peticiones = 0;

  // Un pedido, con sus reintentos. Devuelve { ok: datos } | { delArtista: status }
  // | { pausa } | { parado }. «Fallé al preguntar» no sale de acá como resultado:
  // o se reintenta, o pausa, o para. Nunca llega a guardarse.
  async function pedirUno(url, tipo, nombre) {
    let intentosFallidos = 0;
    let listoDesde = -Infinity;   // cuándo se puede reintentar tras un fallo
    for (;;) {
      if (!sigo()) return { parado: true };
      // UNA espera como mucho, y la sigue un fetch (ver la cabecera).
      const espera = Math.max(ultimoComienzo + INTERVALO_MS, listoDesde) - reloj.ahora();
      if (espera > 0) {
        await reloj.esperar(espera, signal);
        if (!sigo()) return { parado: true };
      }
      const comienzo = reloj.ahora();
      ultimoComienzo = comienzo;
      peticiones++;
      let status, datos = null;
      try {
        const r = await pedir(url, { signal });
        status = r.status;
        datos = r.datos ?? null;
        if (status === 200 && (datos === null || typeof datos !== 'object')) status = 'json';
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') return { parado: true };
        status = 'red';
      }
      onPeticion?.({ url, tipo, nombre, status, comienzo, reintento: intentosFallidos > 0 });
      if (!sigo()) return { parado: true };
      if (status === 200) { fallosSeguidos = 0; return { ok: datos }; }

      fallosSeguidos++;
      if (fallosSeguidos >= FALLOS_PARA_PAUSAR) return { pausa: true };
      // Una respuesta 200 que no es JSON se trata como un fallo de MusicBrainz:
      // no hay nada que guardar y el pedido puede salir bien a la vuelta.
      if (!esDeMusicBrainz(status) && status !== 'json') return { delArtista: status };
      intentosFallidos++;
      listoDesde = reloj.ahora() + esperaTrasFallo(intentosFallidos);
    }
  }

  for (const it of lista) {
    if (!sigo()) return { motivo: 'parado', noSePudo, peticiones };
    if (saltar.has(it.nombre)) continue;
    let paso = proximoPaso(it, artistas.get(it.nombre) ?? null, areas);
    if (!paso.falta) continue;   // ya resuelto: 0 peticiones por él

    let fallo = null;
    while (paso.falta) {
      const f = paso.falta;
      const url = f.tipo === 'busqueda' ? urlBusqueda(it.nombre)
        : f.tipo === 'area' ? urlArea(f.id)
        : urlGrabacion(it.tema, it.nombre);
      const r = await pedirUno(url, f.tipo, it.nombre);
      if (r.parado) return { motivo: 'parado', noSePudo, peticiones };
      if (r.pausa) return { motivo: 'pausa', noSePudo, peticiones };
      if (r.delArtista !== undefined) { fallo = r.delArtista; break; }

      // Guardar ANTES de la petición siguiente.
      const cuando = new Date(reloj.ahora()).toISOString();
      if (f.tipo === 'area') {
        const area = recortarArea(r.ok);
        areas.set(f.id, area);
        await guardarArea(f.id, area);
      } else {
        const previo = artistas.get(it.nombre) ?? null;
        const reg = f.tipo === 'busqueda'
          ? { v: 1, nombre: it.nombre, consultado: cuando, candidatos: recortarArtistas(r.ok), grabacion: null }
          : { ...previo, grabacion: { titulo: f.titulo, ids: idsDeGrabacion(r.ok), consultado: cuando } };
        artistas.set(it.nombre, reg);
        await guardarArtista(it.nombre, reg);
      }
      if (!sigo()) return { motivo: 'parado', noSePudo, peticiones };
      paso = proximoPaso(it, artistas.get(it.nombre) ?? null, areas);
    }

    if (fallo !== null) {
      noSePudo.push(it.nombre);
      saltar.add(it.nombre);
      onArtista?.(it.nombre, 'no-se-pudo', fallo);
    } else {
      onArtista?.(it.nombre, 'resuelto');
    }
  }
  return { motivo: 'completo', noSePudo, peticiones };
}

/**
 * Una sola búsqueda a la vez en TODO el navegador: dos pestañas escaneando
 * duplicarían el ritmo contra MusicBrainz. `navigator.locks` con
 * `ifAvailable: true`: si otra pestaña tiene el candado, esta no espera, no
 * escanea y lo dice. Sin `navigator.locks` (navegador viejo) escanea igual.
 *
 * @returns {Promise<{candado: 'propio'|'ocupado'|'sin-soporte', valor: *}>}
 */
export async function conCandado(locks, fn) {
  if (!locks || typeof locks.request !== 'function') return { candado: 'sin-soporte', valor: await fn() };
  return locks.request(NOMBRE_CANDADO, { ifAvailable: true }, async (lock) => {
    if (!lock) return { candado: 'ocupado', valor: null };
    return { candado: 'propio', valor: await fn() };
  });
}

/**
 * El ritmo MEDIDO: peticiones por minuto en la ventana de los últimos
 * `ventanaMs` (o desde la primera petición, si la sesión es más corta). Es lo
 * que la pantalla enseña para que, si la pestaña oculta frena el escaneo, se vea.
 */
export function peticionesPorMinuto(comienzos, ahora, ventanaMs = 180_000) {
  if (!comienzos.length) return null;
  const desde = Math.max(ahora - ventanaMs, comienzos[0]);
  const n = comienzos.filter((t) => t >= ahora - ventanaMs).length;
  const ms = Math.max(ahora - desde, 1);
  return n / (ms / 60_000);
}

/**
 * Lo que falta, ESTIMADO con lo medido en esta sesión: peticiones por artista y
 * milisegundos por petición de ESTA sesión (no un número fijo: el de `#genre`
 * calcula 1,1 s por artista y son dos peticiones). `null` si todavía no hay con
 * qué estimar.
 */
export function estimarLoQueFalta({ pendientes, peticiones, artistasHechos, msTranscurridos }) {
  if (!artistasHechos || !peticiones || !msTranscurridos) return null;
  const porArtista = peticiones / artistasHechos;
  const msPorPeticion = msTranscurridos / peticiones;
  const pet = Math.round(pendientes * porArtista);
  return { peticiones: pet, minutos: (pet * msPorPeticion) / 60_000, porArtista, msPorPeticion };
}
