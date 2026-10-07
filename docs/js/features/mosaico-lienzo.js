// El dibujo del photomosaic (v=250): bajar las portadas elegidas y pegarlas en
// un lienzo, con el tinte encima. La decisión de QUÉ portada va en cada celda es
// de `util/mosaico.js`; esto es solo el pincel.
//
// ⚠️ **Vive aparte de la vista a propósito.** El banco de pruebas
// (`tests/banco/mosaico.html`) genera mosaicos de verdad con estas dos
// funciones, sin token y sin la app: si el dibujo viviera dentro de
// `features/mosaico.js` habría que copiarlo al banco, y entonces el banco
// fotografiaría OTRO código que el que usa Ian. Es la lección del resolutor
// duplicado de v=219 aplicada antes de tiempo.

import { conTapa } from './covers-wallpaper.js?v=276';

/**
 * Baja las portadas que hacen falta y las deja en un `Map` índice → bitmap.
 *
 * **Agrupa por portada, no por celda.** Con 4.800 celdas y unas 320 portadas
 * distintas, bajar una vez por celda serían quince descargas y quince
 * decodificaciones de más por portada.
 *
 * ⚠️ Los bitmaps se **conservan**, contra la regla 1 de `covers-wallpaper.js`
 * («nunca más de LOTE tapas vivas»), y el motivo es que acá el número se
 * conoce: a 64 px cada bitmap son **16 KB**, y el tope lo pone el catálogo
 * entero (5.715 portadas = 94 MB). Allí el pozo eran 2.449 tapas de 300 px, o
 * sea 880 MB. Conservarlos es lo que permite mover el deslizador del tinte sin
 * volver a la red. **Quien llama es el dueño y tiene que cerrarlos**
 * (`soltarBitmaps`).
 *
 * ⚠️ **La perilla de variedad de v=253 mueve este número, y mucho.** Con 4.800
 * celdas: 271 portadas distintas en «Fiel» (4,4 MB de bitmaps) y **1.863** en
 * «Máxima» (**30,5 MB**). La cuenta de arriba decía «320 portadas son ~5 MB» y
 * con el reparto nuevo se queda corta por un factor de seis.
 *
 * **El peor caso real está medido** (28/09, en producción, navegador de Ian):
 * rejilla **Fina + Máxima**, o sea 10.800 celdas, da **2.964 portadas distintas**
 * (≈49 MB de bitmaps) más un lienzo de 5.760×7.680 = 44 MP. El **RSS del
 * renderer**, muestreado desde `/proc` —`performance.memory` no ve ni los
 * bitmaps ni el canvas—, fue **239 MB antes, 350 MB en el pico y 251 MB al
 * salir de la ruta**. O sea: **+111 MB en el pico**, y el teardown suelta 75.
 * Tarda 14 s y no baja un byte de la red (las 2.964 salen de la caché HTTP).
 */
export async function bajarPortadas({ indice, urlDeTile, signal, lote = 24, onProgress }) {
  const porPortada = new Map();
  for (let k = 0; k < indice.length; k++) {
    const i = indice[k];
    if (!porPortada.has(i)) porPortada.set(i, []);
    porPortada.get(i).push(k);
  }
  const bitmaps = new Map();
  const portadas = [...porPortada.keys()];
  let bajadas = 0, fallidas = 0, bytes = 0;

  for (let i = 0; i < portadas.length; i += lote) {
    if (signal?.aborted) break;
    await Promise.all(portadas.slice(i, i + lote).map(async (idx) => {
      const ok = await conTapa(urlDeTile(idx), signal, (dib, size) => {
        bitmaps.set(idx, dib);
        bytes += size || 0;
        return true;
      }, { conservar: true });
      if (ok) bajadas++; else fallidas++;
    }));
    onProgress?.(bajadas + fallidas, portadas.length);
    // Cede el hilo entre lotes. `setTimeout` y NO `requestAnimationFrame`: la
    // pestaña puede estar en segundo plano (o ser la de la extensión de testeo,
    // que corre oculta) y ahí los rAF se espacian o no llegan.
    await new Promise(r => setTimeout(r, 0));
  }
  return { porPortada, bitmaps, portadas: portadas.length, bajadas, fallidas, bytes };
}

export function soltarBitmaps(bitmaps) {
  for (const b of bitmaps.values()) { try { b?.close?.(); } catch { /* ya cerrado */ } }
  bitmaps.clear();
}

/**
 * Pinta el mosaico entero: las portadas, y encima el tinte con el alfa que le
 * toque a cada celda (`alfa`, de `mapaDeTinte`).
 *
 * `fuenteTinte` es la imagen original dibujable (el canvas de lectura). El tinte
 * pinta el RECORTE que le corresponde a cada celda, no un bloque de color
 * plano: así los bordes finos del original sobreviven al tinte en vez de
 * aplastarse contra el color medio de la celda.
 *
 * No toca la red: se puede llamar cien veces mientras el usuario mueve el
 * deslizador.
 */
export function pintarMosaico({ ctx, cols, filas, ladoCelda, porPortada, bitmaps, fuenteTinte, alfa, fondo, plano = false }) {
  const ancho = cols * ladoCelda, alto = filas * ladoCelda;
  if (fondo) { ctx.fillStyle = fondo; ctx.fillRect(0, 0, ancho, alto); }

  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;   // a 64 px la portada va 1:1
  for (const [idx, celdas] of porPortada) {
    const dib = bitmaps.get(idx);
    if (!dib) continue;
    for (const k of celdas) {
      ctx.drawImage(dib, (k % cols) * ladoCelda, Math.floor(k / cols) * ladoCelda, ladoCelda, ladoCelda);
    }
  }

  if (!fuenteTinte || !alfa) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (plano) {
    // Con el alfa igual en todas las celdas, un solo dibujo de la imagen entera
    // da el mismo resultado que celda a celda y ahorra 4.800 llamadas.
    ctx.globalAlpha = Math.min(1, alfa[0] || 0);
    if (ctx.globalAlpha > 0.002) ctx.drawImage(fuenteTinte, 0, 0, ancho, alto);
  } else {
    const sw = fuenteTinte.width / cols, sh = fuenteTinte.height / filas;
    for (let k = 0; k < alfa.length; k++) {
      if (alfa[k] <= 0.002) continue;
      ctx.globalAlpha = Math.min(1, alfa[k]);
      const c = k % cols, f = Math.floor(k / cols);
      ctx.drawImage(fuenteTinte, c * sw, f * sh, sw, sh, c * ladoCelda, f * ladoCelda, ladoCelda, ladoCelda);
    }
  }
  ctx.globalAlpha = 1;
}
