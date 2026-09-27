// Base de colores del photomosaic (v=248): baja la miniatura de 64 px de cada
// portada del catálogo y guarda su rejilla 3×3 (ver `util/cover-color.js`).
// Se dispara desde `#debug`; la vista del mosaico todavía no existe.
//
// Catálogo, decidido por Ian el 27/09: las portadas ÚNICAS de los álbumes
// escuchados (`history-listened-albums.json`) más las de los likes (la caché
// `all_liked_tracks`). «Única» es por `coverId` (`util/album-key.js`), el mismo
// criterio del segundo pase de `#covers`: para un mosaico, dos entradas con el
// mismo hash de imagen son la misma tesela. No se pasa por el `buildList` de
// `covers.js` porque ese contesta otra pregunta (qué ÁLBUMES pintar, fusionando
// por nombre antes que por imagen) y además mete W-Three, que costaría pedir la
// playlist a la API. Armar el catálogo no hace ningún request a
// `api.spotify.com`: los likes se leen con `allowFetch: false`.
//
// Lo que se baja sale del CDN de imágenes (`image-cdn-*.spotifycdn.com`,
// `i.scdn.co`), que no es la API ni gasta su cuota. Manda
// `access-control-allow-origin: *` (medido con curl el 26/09). Aun así, sin
// `mode: 'cors'` el canvas queda contaminado: por eso se pide cada miniatura
// aparte, como `covers-wallpaper.js`, y nunca se reusa una `<img>` de la página.
//
// Reanudable: lo hecho se guarda por tandas en UNA sola clave de IndexedDB
// (`mosaico_colores_v1`); la próxima vez solo se baja lo que falta. Esa clave
// la conserva «Limpiar caché» (`util/limpiar-cache.js`).
//
// ⚠️ Sin `setTimeout` en el bucle: en una pestaña oculta Chrome espacia los
// temporizadores encadenados hasta uno por minuto. El bucle solo espera a la
// red y a la decodificación, que no se frenan.

import { idbGetCachedRaw, idbSetCached } from '../idb.js?v=251';
import { loadListenedAlbums } from './history-data.js?v=251';
import { getBestAvailableLikes } from '../api.js?v=251';
import { coverId, coverVariant } from '../util/album-key.js?v=251';
import { MOSAICO_COLORES_KEY, BYTES_POR_PORTADA, rejilla3x3 } from '../util/cover-color.js?v=251';

const FORMATO = 1;
// Descargas a la vez. Es el lote de `covers-wallpaper.js`, medido allí contra
// el CDN real (24 bajó 2.378 tapas en 22 s; 12, en 44 s).
const EN_PARALELO = 24;
// Cada cuántas portadas nuevas se guarda. Un corte a mitad pierde como mucho esto.
const GUARDAR_CADA = 120;
// Esta cantidad de fallos seguidos sin ningún acierto corta la tanda: si el
// CDN deja de mandar CORS, cada portada fallaría igual y no tiene sentido
// recorrer las 5.716.
const CORTE_FALLOS_SEGUIDOS = 48;

const DIAG_KEY = 'fonoteca_mosaico_diag';

// ── Catálogo ────────────────────────────────────────────────────────────────

const RE_TAPA = /^https:\/\/([^/]+)\/image\/[0-9a-f]{16}([0-9a-f]{24})$/i;

function anotar(mapa, url, fuente) {
  const id = coverId(url);
  if (!id) return false;
  const prev = mapa.get(id);
  if (prev) { prev.fuentes.add(fuente); return true; }
  mapa.set(id, { id, url64: coverVariant(url, 64), fuentes: new Set([fuente]) });
  return true;
}

/**
 * El catálogo: `{ items: [{id, url64, fuentes}], cuentas }`. Sin requests a la
 * API. Si no hay historial (usuario que no es Ian y no subió el suyo) sale
 * solo con los likes, y lo dice `cuentas.escuchadas`.
 */
export async function armarCatalogo() {
  const mapa = new Map();
  let filasEscuchadas = 0, likes = 0, likesSinTapa = 0;

  const listened = await loadListenedAlbums().catch(() => null);
  for (const y of (listened?.years || [])) {
    for (const a of (y.albums || [])) {
      filasEscuchadas++;
      if (a.img) anotar(mapa, a.img, 'escuchadas');
    }
  }
  const escuchadas = mapa.size;

  const { items } = await getBestAvailableLikes({ allowFetch: false });
  for (const it of (items || [])) {
    const t = it?.track || it;
    const imgs = t?.album?.images || [];
    likes++;
    // Cualquiera de las variantes da el mismo `coverId`; se prefiere la de 64
    // si ya viene, que es la que se va a bajar.
    const img = imgs.find(i => i?.width === 64) || imgs[0];
    if (!img?.url || !anotar(mapa, img.url, 'likes')) likesSinTapa++;
  }

  const lista = [...mapa.values()];
  const deLikes = lista.filter(x => x.fuentes.has('likes')).length;
  return {
    items: lista,
    cuentas: {
      total: lista.length,
      escuchadas,
      filasEscuchadas,
      likes,
      likesSinTapa,
      deLikes,
      soloLikes: lista.length - escuchadas,
      enLasDos: lista.filter(x => x.fuentes.size === 2).length,
    },
  };
}

// ── Lo guardado ─────────────────────────────────────────────────────────────
//
// { formato, rejilla: '3x3', espacio: 'lineal→srgb8', lado: 64,
//   hosts: ['image-cdn-ak.spotifycdn.com', …],
//   ids: [coverId, …], host: Uint8Array (índice en `hosts`, uno por id),
//   datos: Uint8Array(ids.length × 27),
//   fallidas: { coverId: 'motivo' },
//   rarasUrl: { coverId: url },
//   bytes, msRed (sumados entre tandas), creado, actualizado }
//
// La URL de 64 px se rehace con `urlDe()`: host + prefijo de 64 px + id.
// `rarasUrl` guarda la URL entera de las portadas cuyo nombre no lleva el
// prefijo de álbum (`ab67616d…`) y por tanto no tienen variante de 64 px que
// se pueda derivar: se bajan tal cual vienen. En la base de Ian del 27/09 era
// UNA de 5.715 (`i.scdn.co/image/533bd544…`, un id de 40 hex).

const PREFIJO_64 = 'ab67616d00004851';

export async function leerColores() {
  const r = await idbGetCachedRaw(MOSAICO_COLORES_KEY);
  if (!r || r.formato !== FORMATO) return null;
  return r;
}

export function urlDe(registro, i) {
  const rara = registro.rarasUrl?.[registro.ids[i]];
  if (rara) return rara;
  return `https://${registro.hosts[registro.host[i]]}/image/${PREFIJO_64}${registro.ids[i]}`;
}

// Estado mientras corre: arrays que crecen, y a la IndexedDB se escribe la
// forma compacta.
function estadoDesde(reg) {
  const st = {
    hosts: reg ? [...reg.hosts] : [],
    ids: reg ? [...reg.ids] : [],
    host: reg ? [...reg.host] : [],
    datos: reg ? [reg.datos] : [],   // trozos de Uint8Array, se juntan al guardar
    fallidas: reg ? { ...reg.fallidas } : {},
    rarasUrl: reg?.rarasUrl ? { ...reg.rarasUrl } : {},
    bytes: reg?.bytes || 0,
    msRed: reg?.msRed || 0,
    creado: reg?.creado || Date.now(),
  };
  st.hechas = new Set(st.ids);
  return st;
}

function compactar(st) {
  const datos = new Uint8Array(st.ids.length * BYTES_POR_PORTADA);
  let o = 0;
  for (const trozo of st.datos) { datos.set(trozo, o); o += trozo.length; }
  st.datos = [datos];
  return {
    formato: FORMATO, rejilla: '3x3', espacio: 'lineal→srgb8', lado: 64,
    hosts: st.hosts, ids: st.ids, host: Uint8Array.from(st.host), datos,
    fallidas: st.fallidas, rarasUrl: st.rarasUrl, bytes: st.bytes, msRed: st.msRed,
    creado: st.creado, actualizado: Date.now(),
  };
}

// ── Una portada ─────────────────────────────────────────────────────────────

class CorteTanda extends Error {}

async function colorDe(url, lienzo, signal) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache', signal });
  if (res.status === 429) throw new CorteTanda('el CDN de imágenes devolvió 429');
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const blob = await res.blob();
  let bmp = null;
  try {
    bmp = await createImageBitmap(blob);
  } catch (e) {
    return { error: `no decodifica (${e.name})`, bytes: blob.size };
  }
  try {
    const w = bmp.width, h = bmp.height;
    if (lienzo.canvas.width !== w || lienzo.canvas.height !== h) {
      lienzo.canvas.width = w; lienzo.canvas.height = h;
    }
    lienzo.clearRect(0, 0, w, h);
    lienzo.drawImage(bmp, 0, 0);
    let px;
    try {
      px = lienzo.getImageData(0, 0, w, h).data;
    } catch (e) {
      // Canvas contaminado: el CDN dejó de mandar CORS. Seguir no sirve.
      if (e.name === 'SecurityError') throw new CorteTanda(`canvas contaminado (${e.message})`);
      throw e;
    }
    return { rejilla: rejilla3x3(px, w, h), bytes: blob.size };
  } finally {
    bmp.close();
  }
}

function nuevoLienzo() {
  const c = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(64, 64)
    : Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
  return c.getContext('2d', { willReadFrequently: true });
}

// ── La tanda ────────────────────────────────────────────────────────────────

let enCurso = null;

export function construyendo() { return !!enCurso; }

/**
 * Construye (o continúa) la base. `onProgress({ hechas, total, fallidas,
 * bytes, ms })` se llama tras cada portada. Devuelve un resumen con `corte`
 * (null si terminó; si no, el motivo). Si ya hay una tanda en curso, devuelve
 * esa misma promesa.
 */
export function construirColores({ onProgress, signal } = {}) {
  if (enCurso) return enCurso;
  enCurso = correr({ onProgress, signal }).finally(() => { enCurso = null; });
  return enCurso;
}

async function correr({ onProgress, signal }) {
  const t0 = performance.now();
  const { items, cuentas } = await armarCatalogo();
  const st = estadoDesde(await leerColores());
  const yaEstaban = items.filter(x => st.hechas.has(x.id)).length;
  // Lo fallido de otras tandas se reintenta: puede haber sido la red.
  const pendientes = items.filter(x => !st.hechas.has(x.id));
  const total = items.length;

  let bytesTanda = 0, nuevas = 0, fallidasTanda = 0, seguidosMal = 0, sinGuardar = 0;
  let corte = null;
  let guardando = Promise.resolve();
  const guardar = () => { guardando = guardando.then(() => idbSetCached(MOSAICO_COLORES_KEY, compactar(st), null)); return guardando; };
  const aviso = () => onProgress?.({
    hechas: st.ids.length, total, fallidas: Object.keys(st.fallidas).length,
    bytes: bytesTanda, ms: performance.now() - t0,
  });

  let cursor = 0;
  const obrero = async () => {
    const lienzo = nuevoLienzo();
    while (!corte && cursor < pendientes.length) {
      if (signal?.aborted) { corte = corte || 'detenida a mano'; break; }
      const it = pendientes[cursor++];
      const m = RE_TAPA.exec(it.url64);
      if (!m) {
        st.fallidas[it.id] = 'la URL no tiene la forma de una portada del CDN';
        fallidasTanda++;
        continue;
      }
      const rara = !it.url64.includes(`/image/${PREFIJO_64}`);
      let r;
      try {
        r = await colorDe(it.url64, lienzo, signal);
      } catch (e) {
        if (e instanceof CorteTanda) { corte = e.message; break; }
        if (e.name === 'AbortError') { corte = corte || 'detenida a mano'; break; }
        r = { error: `${e.name}: ${e.message}` };
      }
      bytesTanda += r.bytes || 0;
      st.bytes += r.bytes || 0;   // aquí y no al final: una tanda cortada también bajó lo suyo
      if (r.error) {
        st.fallidas[it.id] = r.error;
        fallidasTanda++;
        if (++seguidosMal >= CORTE_FALLOS_SEGUIDOS) corte = `${seguidosMal} fallos seguidos (el último: ${r.error})`;
      } else {
        seguidosMal = 0;
        let h = st.hosts.indexOf(m[1]);
        if (h < 0) { st.hosts.push(m[1]); h = st.hosts.length - 1; }
        st.ids.push(it.id);
        st.host.push(h);
        st.datos.push(r.rejilla);
        if (rara) st.rarasUrl[it.id] = it.url64;
        st.hechas.add(it.id);
        delete st.fallidas[it.id];
        nuevas++;
        if (++sinGuardar >= GUARDAR_CADA) { sinGuardar = 0; guardar(); }
      }
      aviso();
    }
  };

  await Promise.all(Array.from({ length: Math.min(EN_PARALELO, pendientes.length) }, obrero));

  const ms = performance.now() - t0;
  st.msRed += ms;
  await guardar();

  const resumen = {
    corte,
    total,
    cuentas,
    yaEstaban,
    nuevas,
    hechas: st.ids.length,
    fallidas: Object.keys(st.fallidas).length,
    fallidasTanda,
    faltan: items.filter(x => !st.hechas.has(x.id)).length,
    bytes: bytesTanda,
    ms: Math.round(ms),
    cuando: new Date().toISOString(),
  };
  // Registro legible desde la pestaña, no solo en pantalla: si una tanda se
  // corta, el motivo queda donde se puede leer después.
  try { sessionStorage.setItem(DIAG_KEY, JSON.stringify(resumen)); } catch { /* lleno */ }
  return resumen;
}
