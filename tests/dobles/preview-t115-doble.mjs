// Doble de los vecinos de `ui/preview-player.js` (tanda 115). Ver `loader-t115.mjs`.
//   components.js  → escapeHtml (la misma regla que la real: & < > " ')
//   toast.js       → showToast, que anota en `globalThis.__T115.toasts`
//   bottom-layer.js→ mountBottom, que cuelga el nodo del <body> del doble de DOM
//   reveal.js      → animationsEnabled, que lee `globalThis.__T115.animaciones`
globalThis.__T115 ??= { toasts: [], animaciones: false, montajes: [] };

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function showToast(msg, tipo) { globalThis.__T115.toasts.push({ msg, tipo }); }
export function mountBottom(zona, el) {
  globalThis.__T115.montajes.push(zona);
  const body = globalThis.document.body;
  if (el.parentNode !== body) body.appendChild(el);
  return el;
}
export function animationsEnabled() { return !!globalThis.__T115.animaciones; }
