// Doble de `ui/components.js` para la sección «Borrarlo» de la suite de la guarda (v=309).
// `confirmModal` contesta «sí» al instante (lo que se prueba es lo que pasa DESPUÉS de confirmar).
export const escapeHtml = (s) => String(s ?? '');
export function showProgress() {}
export function hideProgress() {}
export async function confirmModal() { globalThis.__DOBLE.confirmaciones = (globalThis.__DOBLE.confirmaciones || 0) + 1; return true; }
export async function alertModal() {}
