// Subir de tamaño la tapa de un track cuando el caché solo guardó la chica.
//
// `slimTrack` (api.js) se queda con las imágenes más chicas del álbum para no
// inflar el caché de 9.500 likes. Hasta v=137 guardaba UNA sola, la de 64×64:
// pintada a 96px se ve borrosa, y las cachés viejas (y el backup del repo, que
// se generó con ese slimTrack) van a seguir teniendo solo esa durante un
// tiempo.
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

const PREFIJOS = { 640: 'ab67616d0000b273', 300: 'ab67616d00001e02', 64: 'ab67616d00004851' };
const RE = /^(https:\/\/i\.scdn\.co\/image\/)ab67616d[0-9a-f]{8}([0-9a-f]{24})$/;

export function coverAtSize(url, size = 300) {
  if (!url) return url;
  const pref = PREFIJOS[size];
  if (!pref) return url;
  const m = RE.exec(url);
  if (!m) return url;
  return `${m[1]}${pref}${m[2]}`;
}
