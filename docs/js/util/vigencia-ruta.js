// ¿La ruta que me tocó sigue siendo la ruta actual? (v=175)
//
// ── El problema ──────────────────────────────────────────────────────────────
//
// Las vistas pesadas tardan. `#skips` con el caché vacío se baja ~9.500 me gusta
// (185 requests, minutos) antes de pintar nada. Si el usuario se va a otra ruta
// mientras tanto, ese render **sigue corriendo**: cuando por fin vuelve del
// `await`, escribe en un DOM que el router ya reemplazó, y revienta con
// «Cannot set properties of null». Es el crash cazado el 2026-08-29.
//
// ⚠️ **El `teardown` que devuelve `render()` NO sirve para esto**, y es el error
// natural: el router lo llama puntualmente al cambiar de ruta, pero **un
// teardown no puede interrumpir un `await` que ya está en vuelo**. Sirve para
// soltar observers, timers y listeners; no para abortar trabajo asíncrono. La
// única forma es que el propio código pregunte al volver de cada espera.
//
// Medido zapeando 40 veces con los cachés fríos: **452 renders quedaron
// abiertos** después del cambio de ruta, en seis vistas, y el más viejo seguía
// vivo **39 segundos** después de que el usuario se hubiera ido.
//
// ── Cómo se usa ──────────────────────────────────────────────────────────────
//
//   const ruta = vigilarRuta();          // al principio del render/analyze
//   const datos = await algoLento();
//   if (!ruta.vigente()) return;         // después de CADA espera larga
//
// Y nada más. No tira, no envuelve promesas y no cambia el control de flujo:
// una excepción se la comería el `catch` de la propia vista y acabaría pintando
// «Error: ...» por haber cambiado de ruta, que es peor que el bug.
//
// ── Dónde poner el check ─────────────────────────────────────────────────────
//
// Después de cada `await` **a partir del cual se escribe en el DOM**. En la
// práctica: al volver de la carga de datos, y otra vez dentro de cada `catch`
// que pinte un mensaje de error — un fallo de red en una vista que ya
// abandonaste no tiene que pintar nada en la vista nueva.
//
// Un `await` cuyo resultado solo se guarda en una variable de módulo no
// necesita check: lo necesita el primer punto que toque el documento.

import { generacionActual, rutaVigente } from '../router.js?v=179';

/**
 * Captura la generación de ruta actual y devuelve con qué preguntarla después.
 *
 * @returns {{ vigente: () => boolean, generacion: number }}
 */
export function vigilarRuta() {
  const generacion = generacionActual();
  return {
    /** ¿Sigo en la ruta en la que empecé? Si es `false`, salí sin tocar el DOM. */
    vigente: () => rutaVigente(generacion),
    generacion,
  };
}
