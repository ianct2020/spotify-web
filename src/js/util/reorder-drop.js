// Las dos cuentas del drag & drop del panel de orden de W-Three, sin DOM.
//
// Viven acá porque el drop nativo **no se puede disparar con un ratón
// sintético** (el navegador solo inicia un arrastre real desde un gesto de
// usuario de verdad), así que la única forma de dejar esto verificado sin
// depender de que alguien lo pruebe a mano es sacar la aritmética del handler.
// Lo que queda en `features/wthree.js` es medir rectángulos y repintar.

/**
 * Índice de inserción según dónde está el puntero.
 *
 * `rects` son los rectángulos de las filas, EN ORDEN y ya medidos
 * (`getBoundingClientRect()`), con al menos `{ top, height }`.
 *
 * Se compara contra el CENTRO de cada fila: por encima del centro de la fila i
 * el destino es «antes de i». Eso hace que todo lo que quede por ENCIMA de la
 * primera fila —el padding de la lista, y la franja de arriba del panel— dé 0,
 * que es justo el caso que no andaba: llevar la última al primer lugar.
 *
 * Devuelve 0..rects.length (length = al final de todo).
 */
export function insercionPorPuntero(rects, clientY) {
  const lista = rects || [];
  for (let i = 0; i < lista.length; i++) {
    const r = lista[i];
    if (clientY < r.top + r.height / 2) return i;
  }
  return lista.length;
}

/**
 * Mueve `desde` al hueco `insertAt`, donde `insertAt` está expresado sobre la
 * lista ORIGINAL (antes de sacar el elemento).
 *
 * Devuelve un array nuevo. Si el movimiento no cambia nada —soltar sobre uno
 * mismo, o en el hueco de justo debajo— devuelve el array tal cual.
 */
export function moverA(items, desde, insertAt) {
  const arr = [...(items || [])];
  if (desde < 0 || desde >= arr.length) return arr;
  if (insertAt === desde || insertAt === desde + 1) return arr;
  const [moving] = arr.splice(desde, 1);
  // El splice previo shiftea todo lo que estaba después de `desde`.
  const destino = desde < insertAt ? insertAt - 1 : insertAt;
  arr.splice(destino, 0, moving);
  return arr;
}

/** ¿Qué fila hay que marcar, y de qué lado? Para pintar la línea verde. */
export function indicadorPara(insertAt, total) {
  if (total <= 0) return null;
  if (insertAt >= total) return { fila: total - 1, lado: 'below' };
  return { fila: insertAt, lado: 'above' };
}
