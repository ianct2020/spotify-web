// Doble de `ui/bottom-layer.js` para probar `ui/toast.js` sin navegador.
// El módulo real reparte la capa de abajo en slots; a `toast.js` solo le hace
// falta que `mountBottom` cuelgue el contenedor del <body> y lo devuelva, y que
// sea idempotente (llamarlo dos veces no lo monta dos veces).
export function mountBottom(zona, el) {
  const body = globalThis.document.body;
  if (el.parentNode !== body) body.appendChild(el);
  return el;
}
