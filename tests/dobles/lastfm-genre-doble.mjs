// Doble de `src/js/api/lastfm.js` para la pantalla de inicio de `#genre` (tanda 86).
//
// `cargarEtiquetas` tira si `globalThis.__T86.cargarFalla` trae un texto (el almacén de
// IndexedDB que no se pudo leer). `contarEtiquetasGuardadas` devuelve `.etiquetas` si se cargó
// y 0 si no, que es lo que hace el almacén real sin cargar: por eso la pantalla de hoy dice
// «0 artistas con tags». Lo que pegaría a Last.fm se anota en `.llamadas`.
function t() { return globalThis.__T86; }
let cargado = false;

export function hasKey() { return true; }
export function setKey() {}
export async function cargarEtiquetas(uid) {
  t().llamadas.push('cargarEtiquetas');
  if (t().cargarFalla) { cargado = false; throw new Error(t().cargarFalla); }
  cargado = !!uid;
}
export function contarEtiquetasGuardadas() { return cargado ? t().etiquetas : 0; }
export function getCachedTags() { return null; }
export async function getArtistTopTags() { t().llamadas.push('getArtistTopTags'); return []; }
export async function setCachedTags() { t().llamadas.push('setCachedTags'); }
export async function mergeCachedTags() { t().llamadas.push('mergeCachedTags'); }
