// Doble de `ui/modal-stack.js` para la sección «Borrarlo» de la suite de la guarda (v=309).
//
// `openModal` devuelve un overlay de mentira cuyo `querySelector('#id')` da un elemento solo si el
// HTML del modal trae ese `id="…"` (así «Borrarlo» existe únicamente cuando el modal lo pinta), y
// apunta en `globalThis.__DOBLE.modal` qué se abrió y cuántas veces se cerró.
function m() {
  if (!globalThis.__DOBLE.modal) globalThis.__DOBLE.modal = { abiertos: [], cerrados: 0, elementos: {} };
  return globalThis.__DOBLE.modal;
}
export function openModal({ html }) {
  const est = m();
  est.abiertos.push(html);
  est.elementos = {};
  return {
    querySelector(sel) {
      const id = sel.startsWith('#') ? sel.slice(1) : null;
      if (!id || !html.includes(`id="${id}"`)) return null;
      return (est.elementos[id] ||= { id, classList: { add() {}, remove() {} }, click() {} });
    },
  };
}
export function closeById() { m().cerrados++; return true; }
export function closeTop() { m().cerrados++; }
