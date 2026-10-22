// Doble ÚNICO de todo lo que importan `features/records.js` y `features/by-artist.js`, para
// `tests/vigencia-records-byartist.test.mjs` (v=329, tanda 75). Lo engancha `loader-vigencia-vistas.mjs`:
// los nueve módulos reales (la red, el DOM global, el reproductor, la ficha, el almacén y el
// router) se cambian por ESTE archivo, que exporta la unión de los nombres. `vigencia-ruta.js` va
// REAL: su `../router.js` también cae acá, con una generación de ruta que el test sube a mano
// (lo que hace `handleRoute()`).
//
// Cada espera que importa es una promesa que el test resuelve cuando quiere, después de «salir»:
// `globalThis.__VV.pendiente(nombre)` devuelve `{ promesa, resolver, rechazar }`.

const VV = (globalThis.__VV ||= {
  generacion: 0,
  esperas: {},
  llamadas: [],
});

function espera(nombre) {
  VV.llamadas.push(nombre);
  const p = VV.esperas[nombre];
  if (!p) throw new Error(`doble: nadie preparó la espera «${nombre}»`);
  return p.promesa;
}

// ── router.js ────────────────────────────────────────────────────────────────
export function generacionActual() { return VV.generacion; }
export function rutaVigente(gen) { return gen === VV.generacion; }

// ── api.js ───────────────────────────────────────────────────────────────────
export function getBestAvailableLikes() { return espera('getBestAvailableLikes'); }
export function getAllLikedTracks() { return espera('getAllLikedTracks'); }
export async function createPlaylist() { throw new Error('doble: createPlaylist no se usa'); }
export async function addTracksToPlaylist() { throw new Error('doble: addTracksToPlaylist no se usa'); }
export function invalidatePlaylistsCache() {}

// ── features/history-data.js ─────────────────────────────────────────────────
export function loadRecords() { return espera('loadRecords'); }
export function isOwner() { return espera('isOwner'); }
export function ownerLockedMessage(t) { return `<div class="card">candado ${t}</div>`; }

// ── ui/components.js ─────────────────────────────────────────────────────────
export function showProgress() { VV.llamadas.push('showProgress'); }
export function hideProgress() { VV.llamadas.push('hideProgress'); }
export function progressController() {
  return { signal: null, update() {}, done() { VV.llamadas.push('prog.done'); } };
}
export function isCancelled(e) { return /cancelada/i.test(e?.message || ''); }
export async function promptPlaylistName() { return null; }
export function escapeHtml(s) { return String(s ?? ''); }
export function pageHeader({ title }) { return `<h1>${title}</h1>`; }

// ── ui/toast.js, util/artist-preview.js, api/preview-providers.js, ui/preview-player.js,
//    features/artist-card.js, storage.js ─────────────────────────────────────
export function showToast() {}
export async function getArtistLikePreview() { return null; }
export async function getPreview() { return null; }
export function attachHover() {}
export function openArtistCard() {}
export function prefKey(k) { return k; }
export function migratePrefKey() {}
