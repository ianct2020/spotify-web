// El escaneo de `#generos` contra Last.fm (v=313, tanda 61).
//
// Le pide a Last.fm las etiquetas de cada artista del HISTORIAL (`universo()` de
// `util/mapa-paises.js`: ≥ 10 min, por minutos), de a uno y retomable, y las guarda en el
// almacén de la tanda 60 (`util/generos-artista.js`). El molde es el del mapa
// (`util/mapa-escaneo.js`): TODO lo que toca el mundo va inyectado —la red (`pedir`), el reloj
// (`reloj.ahora`, `reloj.esperar`), el guardado (`guardar`) y la señal para parar—, así
// `tests/generos-escaneo.test.mjs` lo corre en Node con un Last.fm y un reloj de mentira, y la
// vista (`features/generos.js`) le enchufa el `fetch` real, IndexedDB y `setTimeout`.
//
// 🔴 NO es una copia de `escanear()` del mapa (aquél es de MusicBrainz: búsqueda, grabación,
// área) ni la cambia: el mapa está en producción y su banco no se toca. Lo genérico se IMPORTA
// de `mapa-escaneo.js` tal cual: `esperaTrasFallo` y `FALLOS_PARA_PAUSAR` (así la racha que suma
// la estimación es la MISMA que hace este bucle), y la vista importa de ahí el ritmo acumulado y
// `estimarLoQueFalta`. Lo que no sirve sin cambiarlo se escribe acá, y se dice por qué:
//   · `conCandado` del mapa pide SU nombre de candado (`NOMBRE_CANDADO` está fijo adentro): esta
//     búsqueda es de otra fuente y lleva el suyo, `fonoteca-generos-escaneo`;
//   · `textoLoQueFalta` del mapa termina en «según cuántos 503 dé MusicBrainz»: acá es Last.fm
//     (se reusa su `duracionCorta`, exportada, para que el formato sea el mismo).
//
// Lo que midió la tanda 61 contra el Last.fm de verdad (51 artistas, a una por segundo,
// `fonoteca-migracion/generos/`), y lo que se decidió con eso:
//   · 51 de 51 en 200, 0 errores, `access-control-allow-origin: *` en todas: el navegador puede
//     pedir. Latencia mediana 233 ms (máx. 474): el ritmo lo pone la constante, no la red.
//   · «Artista no encontrado» vuelve con HTTP **200** y `{"error": 6, "message": "The artist you
//     supplied could not be found"}`: el código decide, no el status. 6 es una respuesta
//     DEFINITIVA (como el 404 de lrclib) y se guarda como `tags: []`.
//   · Los códigos de la documentación (`https://www.last.fm/api/errorcodes`): 29 «Rate Limit
//     Exceded» (la cuota); 8 «Operation failed … Please try again», 11 «Service Offline … Try
//     again later», 16 «temporarily unavailable, please try again» (temporales); 10 «Invalid API
//     key» y 26 «API Key Suspended» (la key). Ninguno de esos se vio en la medición.

import { esperaTrasFallo, FALLOS_PARA_PAUSAR, duracionCorta } from './mapa-escaneo.js';
import { filtrarEtiquetasLastfm, decidirEtiquetas } from './generos-artista.js';

export const BASE_LASTFM = 'https://ws.audioscrobbler.com/2.0/';
// Una petición por vez y 1.000 ms como mínimo entre COMIENZOS. Las condiciones de uso de la API
// (`https://www.last.fm/api/tos`, 4.4) no dan un número: «Last.fm sets and enforces limits on use
// of the API … in our sole discretion». La tanda 61 midió 51 peticiones a este ritmo (60,75 por
// minuto) sin un solo error, así que nada obliga a ir más lento; y no se va más rápido aunque
// nadie lo prohíba con un número (lo puso el encargo: nunca menos de 1.000 ms).
export const INTERVALO_MS = 1000;
export const NOMBRE_CANDADO = 'fonoteca-generos-escaneo';

// Lo medido del ritmo, ACUMULADO entre cargas (el molde de `mapa_ritmo_v1_`): con el uid en la
// clave y dentro del valor. NO está en `CONSERVAR_PREFIJOS`: «Limpiar caché» lo borra (es una
// medición, no un dato).
export const PREFIJO_RITMO = 'generos_ritmo_v1_';
export const claveRitmo = (uid) => `${PREFIJO_RITMO}${uid}`;

const CODIGO_NO_ENCONTRADO = 6;
const CODIGOS_KEY = [10, 26];
const CODIGOS_REINTENTAR = [8, 11, 16, 29];

/** La consulta de `getArtistTopTags` (`api/lastfm.js`), la misma: `artist.gettoptags` + `autocorrect=1`. */
export function urlEtiquetas(nombre, key) {
  const qs = new URLSearchParams({ method: 'artist.gettoptags', api_key: key, format: 'json', artist: nombre, autocorrect: 1 });
  return `${BASE_LASTFM}?${qs}`;
}

/**
 * ¿Last.fm ya contestó por este artista? Sí si `fuentes.lastfm` no es `null` (aunque sea
 * `tags: []`: «pregunté y no hay»), o si `fuentes.migrado` trae AL MENOS una etiqueta. Un
 * `migrado` vacío se vuelve a pedir: pudo ser el `[]` de MusicBrainz de un `limit=1` a ciegas
 * (el blob viejo no decía de qué fuente era) y no se sabe. `musicbrainz` y `statsfm` solos no
 * cuentan: son otras fuentes.
 */
export function yaBuscado(registro) {
  const f = registro?.fuentes;
  if (!f) return false;
  if (f.lastfm && Array.isArray(f.lastfm.tags)) return true;
  return !!(f.migrado && Array.isArray(f.migrado.tags) && f.migrado.tags.length > 0);
}

/**
 * Qué hacer con una respuesta: `ok` (traer las etiquetas), `no-encontrado` (guardar `[]`),
 * `reintentar` (de Last.fm, no del artista: no se guarda nunca), `key` (para todo) o
 * `del-artista` (se sigue con el siguiente, sin guardar). Si el cuerpo trae `error`, manda el
 * código, sea cual sea el status (Last.fm manda el 6 con un 200).
 */
export function clasificar({ status, datos }) {
  const codigo = datos && typeof datos === 'object' && Number.isFinite(datos.error) ? datos.error : null;
  if (codigo !== null) {
    if (codigo === CODIGO_NO_ENCONTRADO) return { tipo: 'no-encontrado', codigo };
    if (CODIGOS_KEY.includes(codigo)) return { tipo: 'key', codigo };
    if (CODIGOS_REINTENTAR.includes(codigo)) return { tipo: 'reintentar', codigo };
    return { tipo: 'del-artista', codigo };
  }
  if (status === 'red' || status === 429 || (typeof status === 'number' && status >= 500)) return { tipo: 'reintentar', codigo: null };
  // Un 200 que no es JSON o no trae `toptags` se trata como un fallo de Last.fm: no hay nada que
  // guardar y la vuelta puede salir bien.
  if (status === 200) return datos && typeof datos === 'object' && datos.toptags ? { tipo: 'ok', codigo: null } : { tipo: 'reintentar', codigo: null };
  return { tipo: 'del-artista', codigo: null };
}

// `toptags.tag` puede no venir (artista sin etiquetas): lista vacía. Si viniera un objeto suelto,
// se envuelve. El filtro es el de siempre (`filtrarEtiquetasLastfm`).
function etiquetasDe(datos) {
  const t = datos?.toptags?.tag;
  return filtrarEtiquetasLastfm(Array.isArray(t) ? t : t ? [t] : []);
}

/**
 * Corre el escaneo hasta terminar, parar, pausarse o encontrar la key rota.
 *
 * @param {object}   o
 * @param {Array}    o.lista       `universo()` de `mapa-paises.js`, YA en orden
 * @param {Function} o.registro    `(nombre) => registro | null` (el del almacén)
 * @param {Function} o.url         `(nombre) => url` (la vista pasa `urlEtiquetas` con `getKey()`)
 * @param {Function} o.pedir       `async (url, {signal}) => ({status, datos})`; tira si la red falla
 * @param {Function} o.guardar     `async (nombre, tags, artista) => boolean` (false: no se pudo)
 * @param {object}   o.reloj       `{ ahora(): ms, esperar(ms, signal): Promise }`
 * @param {AbortSignal} [o.signal]
 * @param {Function} [o.seguir]    `() => boolean`, después de cada `await` (la vigencia de la ruta)
 * @param {Set}      [o.saltar]    nombres que no se piden (ya fallaron en la sesión)
 * @param {Function} [o.onPeticion] `({nombre, status, codigo, tipo, comienzo, reintento})`
 * @param {Function} [o.onArtista]  `(nombre, 'resuelto' | 'no-se-pudo', motivo)`
 * @returns {Promise<{motivo: 'completo'|'parado'|'pausa'|'key'|'no-guarda', codigo?: number, noSePudo: string[], peticiones: number}>}
 */
export async function escanearGeneros({
  lista, registro, url, pedir, guardar, reloj,
  signal = null, seguir = () => true, saltar = new Set(), onPeticion = null, onArtista = null,
}) {
  const sigo = () => !signal?.aborted && seguir();
  const noSePudo = [];
  let ultimoComienzo = -Infinity;
  let fallosSeguidos = 0;
  let peticiones = 0;

  // Un artista, con sus reintentos. «Fallé al preguntar» no sale de acá como resultado: o se
  // reintenta, o pausa, o para. Nunca llega a guardarse (la regla de `util/cache-solo-exitos.js`).
  async function pedirUno(nombre) {
    let intentosFallidos = 0;
    let listoDesde = -Infinity;
    for (;;) {
      if (!sigo()) return { parado: true };
      // UNA espera como mucho, y la sigue un fetch (Chrome espacia los `setTimeout` encadenados
      // de una pestaña oculta: ver la cabecera de `mapa-escaneo.js`).
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
        const r = await pedir(url(nombre), { signal });
        status = r.status;
        datos = r.datos ?? null;
      } catch (e) {
        if (signal?.aborted || e?.name === 'AbortError') return { parado: true };
        status = 'red';
      }
      const c = clasificar({ status, datos });
      onPeticion?.({ nombre, status, codigo: c.codigo, tipo: c.tipo, comienzo, reintento: intentosFallidos > 0 });
      if (!sigo()) return { parado: true };
      if (c.tipo === 'ok' || c.tipo === 'no-encontrado') { fallosSeguidos = 0; return { tipo: c.tipo, datos }; }
      if (c.tipo === 'key') return { key: c.codigo };
      fallosSeguidos++;
      if (fallosSeguidos >= FALLOS_PARA_PAUSAR) return { pausa: true };
      if (c.tipo === 'del-artista') return { delArtista: c.codigo ?? status };
      intentosFallidos++;
      listoDesde = reloj.ahora() + esperaTrasFallo(intentosFallidos);
    }
  }

  for (const it of lista) {
    if (!sigo()) return { motivo: 'parado', noSePudo, peticiones };
    if (saltar.has(it.nombre)) continue;
    if (yaBuscado(registro(it.nombre))) continue;   // ya contestado: 0 peticiones por él

    const r = await pedirUno(it.nombre);
    if (r.parado) return { motivo: 'parado', noSePudo, peticiones };
    if (r.pausa) return { motivo: 'pausa', noSePudo, peticiones };
    if (r.key !== undefined) return { motivo: 'key', codigo: r.key, noSePudo, peticiones };
    if (r.delArtista !== undefined) {
      noSePudo.push(it.nombre);
      saltar.add(it.nombre);
      onArtista?.(it.nombre, 'no-se-pudo', r.delArtista);
      continue;
    }

    // Guardar ANTES de la petición siguiente. «No encontrado» es una respuesta: `[]`.
    const tags = r.tipo === 'ok' ? etiquetasDe(r.datos) : [];
    const artista = r.tipo === 'ok' ? (r.datos?.toptags?.['@attr']?.artist ?? null) : undefined;
    const guardado = await guardar(it.nombre, tags, artista);
    // Si la IndexedDB no escribe, seguir pidiendo sería gastar peticiones para nada.
    if (guardado === false) return { motivo: 'no-guarda', noSePudo, peticiones };
    if (!sigo()) return { motivo: 'parado', noSePudo, peticiones };
    onArtista?.(it.nombre, 'resuelto');
  }
  return { motivo: 'completo', noSePudo, peticiones };
}

/**
 * Una sola búsqueda de géneros a la vez en TODO el navegador (dos pestañas duplicarían el ritmo
 * contra Last.fm). Es la de `mapa-escaneo.js` con SU nombre de candado: aquélla lo tiene fijo.
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

// En décimas de minuto, enteras: así las cuatro filas suman EXACTAMENTE el total (la misma cuenta
// que `decimas()` de `mapa-paises.js`, que no está exportada).
const decimas = (min) => Math.round((Number(min) || 0) * 10);

/**
 * «Cuánto se sabe»: cuatro filas que suman exactamente los minutos de todo el historial.
 *   · conEtiquetas: alguna fuente trae al menos una etiqueta (también lo de `#genre` y lo migrado);
 *   · noTiene: Last.fm ya contestó y no hay ninguna (buscado y vacío);
 *   · sinBuscar: del universo, sin etiquetas y sin buscar todavía;
 *   · menos10: los de menos de 10 min (no se buscan).
 * Cada una `{ artistas, decimas }`. `pendientes` = los del universo que el escaneo pediría (no
 * `yaBuscado`): incluye a los que tienen etiquetas de MusicBrainz o stats.fm solamente.
 */
export function armarCobertura({ totals, lista, registro }) {
  let total = 0, todos = 0;
  for (const t of Object.values(totals || {})) { total += decimas(t?.[1]); todos++; }
  const filas = { conEtiquetas: { artistas: 0, decimas: 0 }, noTiene: { artistas: 0, decimas: 0 }, sinBuscar: { artistas: 0, decimas: 0 }, menos10: { artistas: 0, decimas: 0 } };
  let enUniverso = 0, pendientes = 0;
  for (const it of lista) {
    enUniverso += it.decimas;
    const reg = registro(it.nombre);
    const buscado = yaBuscado(reg);
    if (!buscado) pendientes++;
    const tags = decidirEtiquetas(reg);
    const fila = tags && tags.length ? filas.conEtiquetas : buscado ? filas.noTiene : filas.sinBuscar;
    fila.artistas++;
    fila.decimas += it.decimas;
  }
  filas.menos10 = { artistas: todos - lista.length, decimas: total - enUniverso };
  return { total, filas, universo: lista.length, pendientes };
}

const fmtEs = (n) => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 0 });

/** La línea de lo que falta, con las dos cotas de `estimarLoQueFalta` (castellano de España). */
export function textoLoQueFalta(est) {
  const bajo = duracionCorta(est.minutosBajo), alto = duracionCorta(est.minutosAlto);
  const rango = bajo === alto ? alto : `entre ${bajo} y ${alto}`;
  return `Quedan ~${fmtEs(est.peticiones)} peticiones: ${rango}, según cuántos fallos dé Last.fm.`;
}
