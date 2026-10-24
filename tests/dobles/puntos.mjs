// Los «puntos de espera» de los dobles de `util/hidden-sync.js` (tanda 82). Cada llamada asíncrona a un doble (la
// Spotify doblada, la IndexedDB doblada, el `recoverUri` del test) pasa por acá DOS veces: al entrar (`antes`) y con la
// respuesta ya lista (`despues`), las dos mientras quien llamó está parado en su `await`. Es donde, en el navegador, puede
// llegar un mensaje de otra pestaña: un `BroadcastChannel` entrega en una TAREA, y una tarea solo entra cuando todo lo que
// corre está esperando red, IndexedDB o un temporizador.
//
// `globalThis.__PUNTOS` (lo pone el test) recibe `(donde, cuando)` y puede inyectar lo que quiera. Sin él, nada.

export async function punto(donde, cuando) {
  const h = globalThis.__PUNTOS;
  if (h) await h(donde, cuando);
}
