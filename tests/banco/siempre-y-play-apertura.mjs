// El import map de `siempre-y-play-caso.html` desvía `/js/features/wrapped-apertura.js` acá (v=362, tanda 121).
//
// Con `?retener=1`, el módulo de la apertura no termina de cargar hasta que la madre llama a `__soltarApertura()`: es la puerta H,
// salir de `#wrapped` con el `import()` todavía en vuelo. Sin `?retener`, `__aperturaRetenida` no existe y es el módulo de siempre.
// El scope `/banco/` del mismo import map deja pasar este `import` al archivo real.
await globalThis.__aperturaRetenida;
export * from '/js/features/wrapped-apertura.js';
