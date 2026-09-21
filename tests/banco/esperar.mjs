// La espera por CONDICIÓN de los bancos visuales.
//
// POR QUÉ EXISTE, que es toda la historia:
//
// El banco del acento de v=233 esperaba **1,2 segundos con un `setTimeout`** y
// recién después fotografiaba. Andaba. Pero un reloj no comprueba nada: la
// primera tanda de capturas salió con dos filas pintadas de oscuro sobre el
// tema claro —eran 500 ms— y el arreglo fue subir el número hasta que dejó de
// pasar. Eso no es un arreglo, es una carrera con más margen: en una máquina
// más lenta, o con una hoja más grande, vuelve a fallar. Y va a fallar **de
// manera intermitente y pareciendo un bug de la app**, que es el peor modo
// posible — se va a buscar el problema en el CSS y va a estar en el banco.
//
// Acá no se espera un tiempo: se espera un HECHO, se comprueba mirando el
// valor computado, y si el hecho no llega en el tope se grita.

/**
 * Espera hasta que `condicion()` devuelva algo verdadero, mirando en cada
 * fotograma. No duerme un rato fijo: comprueba.
 *
 * @param {() => any} condicion  Lo que tiene que pasar. Si tira, cuenta como
 *   «todavía no» (leer `cssRules` de una hoja a medio cargar tira).
 * @param {{ que: string, tope?: number }} opciones  `que` es la frase que se
 *   va a leer en el error; el tope va en ms y por defecto son 10 s.
 * @returns {Promise<any>} lo que devolvió la condición.
 * @throws si se agota el tope, con el qué y el cuánto esperó.
 */
export function esperarA(condicion, { que, tope = 10000 } = {}) {
  const arranque = performance.now();
  return new Promise((resolver, rechazar) => {
    const mirar = () => {
      let valor;
      try { valor = condicion(); } catch { valor = false; }
      if (valor) return resolver(valor);
      const pasado = performance.now() - arranque;
      if (pasado > tope) {
        return rechazar(new Error(
          `BANCO: se agotó la espera de «${que}» tras ${Math.round(pasado)} ms ` +
          `(tope ${tope} ms). La captura NO se hizo: habría mentido.`));
      }
      // ⚠️ `setTimeout` y NO `requestAnimationFrame`, y está medido: en
      // `--headless=new` con `--dump-dom` el rAF deja de dispararse en cuanto
      // no hay nada que pintar —se cortaba a las **3 vueltas, a los 715 ms**—
      // así que el tope no se alcanzaba nunca y el banco se quedaba colgado
      // en silencio, que es el fallo que este archivo viene a impedir. Es la
      // misma familia que el `IntersectionObserver` que tampoco llega por
      // `--dump-dom`: en headless, lo que no se pinta no existe.
      //
      // Un `setTimeout` sí corre, y además hace avanzar el reloj virtual de
      // Chrome, así que el tope se cumple de verdad.
      setTimeout(mirar, 16);
    };
    mirar();
  });
}

/**
 * Las hojas inyectadas con `<link>` cargan solas y tarde. Hasta que el CSSOM
 * no es LEGIBLE, `document.styleSheets[…].cssRules` sale vacío o tira — y ese
 * fue el fallo real de v=233: el clon de los `:hover` se armaba sobre un CSSOM
 * que todavía no existía y tres filas quedaban sin su regla, pintadas de
 * oscuro sobre el tema claro. No era la app: era el banco.
 */
export function hojasLegibles(urls) {
  return esperarA(() => {
    for (const u of urls) {
      const hoja = [...document.styleSheets].find(h => h.href && h.href.includes(u));
      if (!hoja) return false;
      if (!hoja.cssRules || hoja.cssRules.length === 0) return false;   // tira si no cargó
    }
    return true;
  }, { que: `que el CSSOM de ${urls.join(' y ')} sea legible` });
}

/**
 * Comprueba que una variable de tema YA está aplicada y resuelve a lo que se
 * espera, preguntándole al navegador en vez de suponerlo. Devuelve el valor
 * computado, que es lo que hay que escribir en el informe.
 */
export function varAplicada(nombreVar, valorEsperado) {
  const sonda = document.createElement('div');
  sonda.style.position = 'absolute';
  sonda.style.visibility = 'hidden';
  document.body.appendChild(sonda);
  const resolver = (v) => { sonda.style.color = ''; sonda.style.color = v; return getComputedStyle(sonda).color; };
  const esperado = resolver(valorEsperado);
  return esperarA(() => {
    const puesto = resolver(`var(${nombreVar})`);
    return puesto === esperado ? puesto : false;
  }, { que: `que ${nombreVar} valga ${valorEsperado} (${esperado})` })
    .finally(() => sonda.remove());
}

/**
 * El cartel de «esto no se puede fotografiar». Va grande y arriba del todo: si
 * alguien saca la captura igual, que se vea en la captura. Y marca el
 * documento para que el runner lo cace con `--dump-dom` antes de fotografiar.
 */
export function fallar(err) {
  document.documentElement.dataset.banco = 'error';
  document.title = 'BANCO: ERROR';
  document.body.insertAdjacentHTML('afterbegin',
    `<pre style="background:#7f1d1d;color:#fff;padding:14px;margin:0 0 14px;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap">${
      String(err && err.message || err).replace(/</g, '&lt;')}</pre>`);
  console.error(err);
}

/** Todo listo y comprobado: el runner recién fotografía si ve esto. */
export function listo(resumen) {
  document.documentElement.dataset.banco = 'ok';
  document.title = 'BANCO: listo';
  if (resumen) console.log('[BANCO]', resumen);
}
