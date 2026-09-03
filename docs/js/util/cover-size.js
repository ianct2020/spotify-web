// Elegir la tapa del tamaño correcto, y subirla cuando el caché solo guardó la
// chica.
//
// ── Por qué existe `coverUrl()` (v=150) ────────────────────────────────────
//
// `slimTrack` (api.js) guarda **las dos más chicas** del array de Spotify desde
// v=138: `images = [300, 64]`. Antes eran las tres, `[640, 300, 64]`. Los
// consumidores nunca se enteraron y siguieron indexando por posición:
//
//   images[2]  → antes la de 64, ahora **undefined** → cae a images[1] = 64
//   images[1]  → antes la de 300, ahora **la de 64**
//
// O sea que media app pasó a pedir la tapa de 64 px sin que nadie tocara una
// línea. El caso más visible: la ficha de álbum abierta desde una canción
// pintaba la de **64 a 180 px** (medido en producción el 2026-08-19).
//
// La lección: **el índice no es el tamaño**. `coverUrl()` elige por el `width`
// real de cada entrada y tolera arrays de 1, 2 y 3 elementos. Ningún feature
// vuelve a indexar el array crudo.
//
// ── El prefijo del CDN ─────────────────────────────────────────────────────
//
// El CDN de Spotify codifica el tamaño en el prefijo de la ruta y deja los 24
// hex finales como identidad de la imagen — la misma estructura en la que ya se
// apoya `coverId()` (util/album-key.js) para deduplicar tapas:
//
//   ab67616d0000b273… → 640×640
//   ab67616d00001e02… → 300×300
//   ab67616d00004851… →  64×64
//
// Verificado con las tres variantes de una tapa real el 2026-08-13: 200 y
// 64/300/640 px medidos en la cabecera JPEG.
//
// Es una convención NO documentada, así que esto es best-effort: si la URL no
// tiene la forma esperada se devuelve tal cual, y quien la pinte debería dejar
// un `onerror` que vuelva a la original.
//
// ⚠️ **Hay TRES hosts, no uno** (descubierto 2026-08-19). Los JSON del
// historial no usan `i.scdn.co`: usan `image-cdn-ak.spotifycdn.com` (1.933
// tapas en `history-listened-albums.json`) e `image-cdn-fa.spotifycdn.com`
// (462). Hasta v=149 el regex solo aceptaba `i.scdn.co`, así que para TODO lo
// que sale del historial —el Wrapped, `#covers`, W-Three— `coverAtSize()` era
// un no-op silencioso y la tapa se quedaba en la variante que trajera el JSON
// (siempre la de 300).

const PREFIJOS = { 640: 'ab67616d0000b273', 300: 'ab67616d00001e02', 64: 'ab67616d00004851' };
const POR_PREFIJO = { ab67616d0000b273: 640, ab67616d00001e02: 300, ab67616d00004851: 64 };

// Los tres hosts que sirven tapas de álbum. `i.scdn.co` es el de la API;
// los `image-cdn-*` son los que aparecen en el export del historial.
const HOSTS = 'i\\.scdn\\.co|image-cdn-ak\\.spotifycdn\\.com|image-cdn-fa\\.spotifycdn\\.com';
const RE = new RegExp(`^(https://(?:${HOSTS})/image/)(ab67616d[0-9a-f]{8})([0-9a-f]{24})$`);

/** Reescribe la URL de una tapa al tamaño pedido. Si no puede, la devuelve tal cual. */
export function coverAtSize(url, size = 300) {
  if (!url) return url;
  const pref = PREFIJOS[size];
  if (!pref) return url;
  const m = RE.exec(url);
  if (!m) return url;
  return `${m[1]}${pref}${m[3]}`;
}

/** El tamaño que declara el prefijo de la URL, o null si no la reconocemos. */
export function sizeFromUrl(url) {
  const m = RE.exec(url || '');
  return m ? (POR_PREFIJO[m[2]] ?? null) : null;
}

// Qué píxeles pedimos para cada uso. «grande» cubre todo lo que se pinta por
// encima de ~64 px (tarjetas de 96/104, tapa de la ficha a 180, hero del
// Wrapped a 222); «chica» es para miniaturas y para el `onerror`.
const OBJETIVO = { grande: 300, chica: 64 };

/**
 * La URL de tapa del tamaño pedido, a partir del array `images` de Spotify.
 *
 * Elige por el `width` REAL de cada entrada, no por su posición: el array puede
 * venir con 3 (API cruda), 2 (`slimTrack` desde v=138) o 1 elemento (cachés
 * viejas y el backup del repo `src/data/user-*.json`, generado con el slimTrack
 * de entonces). Si no hay una entrada del tamaño justo, se toma la más cercana
 * y se reescribe la URL con `coverAtSize`.
 *
 * @param {Array<{url?: string, width?: number, height?: number}>|null|undefined} images
 * @param {'grande'|'chica'} [tamano]
 * @returns {string|null}
 */
export function coverUrl(images, tamano = 'grande') {
  const objetivo = OBJETIVO[tamano] ?? OBJETIVO.grande;

  const entradas = (Array.isArray(images) ? images : [])
    .map(im => {
      if (!im) return null;
      const url = typeof im === 'string' ? im : im.url;
      if (!url) return null;
      // El `width` de la API manda; si falta (cachés viejas), lo deducimos del
      // prefijo del CDN, y si tampoco se puede, queda desconocido.
      const width = (typeof im === 'object' && im.width) || sizeFromUrl(url) || null;
      return { url, width };
    })
    .filter(Boolean);

  if (!entradas.length) return null;

  // 1. Una entrada del tamaño exacto.
  const exacta = entradas.find(e => e.width === objetivo);
  if (exacta) return exacta.url;

  // 2. La más cercana al objetivo (prefiriendo la más grande ante un empate,
  //    que escalar hacia abajo se ve bien y hacia arriba no).
  const conAncho = entradas.filter(e => e.width);
  const base = conAncho.length
    ? conAncho.reduce((mejor, e) => {
      const d = Math.abs(e.width - objetivo);
      const dm = Math.abs(mejor.width - objetivo);
      return d < dm || (d === dm && e.width > mejor.width) ? e : mejor;
    })
    : entradas[0];

  // 3. Reescribir al objetivo. Si la URL no es del CDN conocido vuelve igual,
  //    que es lo correcto: mejor la que hay que ninguna.
  return coverAtSize(base.url, objetivo);
}

/**
 * Las dos de una: la grande para pintar y la chica para el `onerror`.
 * Devuelve `{ grande, chica }`, cualquiera puede ser null.
 */
export function coverPair(images) {
  return { grande: coverUrl(images, 'grande'), chica: coverUrl(images, 'chica') };
}

/**
 * La URL de tapa que corresponde a una celda de `ladoCss` píxeles CSS (v=193).
 *
 * `#covers` pinta celdas de 28 px y hasta v=192 bajaba la variante de 300×300
 * para todas: 115 veces los píxeles que se ven. A 28 px entran cientos de tapas
 * en una pantalla, y desde que `ui/lazy-img.js` no blanquea nada de lo que está
 * a la vista, esas cientos se quedan decodificadas a la vez — el pozo de
 * memoria que documenta ese módulo. Con la variante de 64 son ~2,5 KB por tapa
 * en vez de ~25 KB, y 64×64 en vez de 300×300 decodificados.
 *
 * El umbral va por píxeles REALES (lado × devicePixelRatio), no por el lado
 * CSS: en una pantalla 2× una celda de 48 necesita 96 px y la de 64 se vería
 * blanda. Es best-effort como todo `coverAtSize`: si la URL no es de un CDN
 * conocido vuelve igual, así que lo peor que puede pasar es seguir como antes.
 *
 * @param {string} url     la tapa tal como viene del dato
 * @param {number} ladoCss lado de la celda en píxeles CSS
 * @param {number} [dpr]   para testear sin navegador
 */
export function tapaParaCelda(url, ladoCss, dpr = globalThis.devicePixelRatio || 1) {
  return coverAtSize(url, (ladoCss || 0) * dpr <= 64 ? 64 : 300);
}
