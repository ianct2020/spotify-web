// Doble único para lo que `features/by-genre.js` importa de la interfaz y de terceros (tanda 86):
// `ui/components.js`, `ui/toast.js`, `ui/modal-stack.js`, `features/genre-detail.js`,
// `api/statsfm.js` y `api/musicbrainz.js`. En Node no hay DOM, y la pantalla de inicio no tiene
// por qué llamar a stats.fm ni a MusicBrainz: si alguien lo hace, queda en `globalThis.__T86.llamadas`.
const anotar = (nombre) => { globalThis.__T86?.llamadas.push(nombre); };

export const escapeHtml = (s) => String(s ?? '');
export const pageHeader = () => '';
export function showProgress() {}
export function hideProgress() {}
export function progressController() { return { update() {}, done() {}, signal: null }; }
export function isCancelled() { return false; }
export async function promptPlaylistName() { return null; }
export async function alertModal() {}
export async function confirmModal() { return false; }
export function showToast(message, type) { (globalThis.__T86.toasts ||= []).push({ message, type }); }
export function openModal() { return { close() {} }; }
export function closeTop() {}
export function openGenreAudit() {}

// stats.fm y MusicBrainz
export function hasUsername() { return false; }
export async function getGenresForArtist() { anotar('musicbrainz'); return []; }
