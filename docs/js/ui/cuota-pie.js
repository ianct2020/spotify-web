// El pie del menú enseña lo gastado de las dos cuotas de Spotify (v=310, tanda 58).
// La cuenta y el texto viven en `util/cuota.js`; esto solo pinta.
//
// Se repinta con el evento `cuotachange` que emite el contador, nunca con un
// intervalo. Lo único que necesita reloj es el «hace N min» del último 429: UN
// `setInterval` de 60 s, y solo mientras haya un 429 que enseñar.

import { contadorCuota, textoRenglon, tituloRenglon, EVENTO_CUOTA, CUOTAS } from '../util/cuota.js?v=315';

const MINUTO = 60 * 1000;

/** El marcado del bloque, para meterlo en `.sidebar-footer`. Los textos los pone `montarPieCuota`. */
export function pieCuotaHtml() {
  return `<div class="sidebar-cuota" role="status" aria-live="off">`
    + CUOTAS.map((c) => `<p class="sidebar-cuota-linea" data-cuota="${c}"></p>`).join('')
    + `</div>`;
}

/** Pinta el bloque y lo deja escuchando. Devuelve la función para soltarlo. */
export function montarPieCuota(raiz = document) {
  let reloj = null;
  const pintar = () => {
    const estado = contadorCuota.estado();
    const ahora = Date.now();
    for (const c of CUOTAS) {
      const el = raiz.querySelector(`.sidebar-cuota [data-cuota="${c}"]`);
      if (!el) continue;
      el.textContent = textoRenglon(c, estado, ahora);
      el.title = tituloRenglon(c);
    }
    const hay429 = CUOTAS.some((c) => estado[c].n429 > 0);
    if (hay429 && !reloj) reloj = setInterval(pintar, MINUTO);
    if (!hay429 && reloj) { clearInterval(reloj); reloj = null; }
  };
  window.addEventListener(EVENTO_CUOTA, pintar);
  pintar();
  return () => {
    window.removeEventListener(EVENTO_CUOTA, pintar);
    if (reloj) clearInterval(reloj);
  };
}
