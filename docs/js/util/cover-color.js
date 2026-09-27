// Color de una portada para el photomosaic (v=248). Módulo PURO: no toca red,
// DOM ni IndexedDB, así que se prueba en Node (`tests/cover-color.test.mjs`).
//
// Qué se guarda por portada: una rejilla 3×3 de medias, 27 bytes (9 celdas ×
// RGB). Decisión de Ian del 27/09, con los datos del reconocimiento del 26/09
// (`RESUMEN-CORS-TAPAS-2026-09-26.md` §6): con un solo color, dos portadas de
// media casi igual son intercambiables aunque no se parezcan; con la rejilla se
// empareja también la estructura. De la 3×3 se baja a 1×1 promediando; de una
// 2×2 no se podría subir.
//
// ⚠️ LA CONVENCIÓN DEL PROMEDIO. Las medias se hacen en LUZ LINEAL, no sobre los
// valores sRGB tal cual. En las 20 portadas medidas el 26/09 la diferencia entre
// las dos formas fue ΔE 8,3 de media (2,6-13,8), del orden del hueco entre dos
// portadas vecinas del catálogo. La media lineal se guarda re-codificada a sRGB
// de 8 bits (así no se pierde precisión en las sombras).
//
// La imagen objetivo del mosaico TIENE que promediarse con esta misma función
// (`rejilla3x3` o `mediaLineal`): si los tiles van en lineal y los bloques del
// objetivo en sRGB, todo el mosaico se desplaza.

// La clave vive acá y no en el módulo que la llena porque la necesita también
// `app.js`, para que «Limpiar caché» la conserve (`util/limpiar-cache.js`).
export const MOSAICO_COLORES_KEY = 'mosaico_colores_v1';

export const REJILLA = 3;
export const BYTES_POR_PORTADA = REJILLA * REJILLA * 3;   // 27

// sRGB 8 bits → luz lineal [0,1]. Tabla de 256: se consulta 4.096 veces por
// portada de 64 px.
export const SRGB_A_LINEAL = (() => {
  const t = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/** Luz lineal [0,1] → sRGB 8 bits (redondeado y acotado). */
export function linealASrgb8(l) {
  const v = l <= 0 ? 0 : l >= 1 ? 1 : l;
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

// Cortes de una dimensión en `n` tramos: [0, round(L/n), …, L]. Con 64 px y
// n = 3 da 0, 21, 43, 64 → tramos de 21, 22 y 21 px.
function cortes(largo, n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(Math.round((i * largo) / n));
  return out;
}

/**
 * Rejilla 3×3 de medias en luz lineal de un buffer RGBA (el `data` de un
 * `ImageData`). Devuelve un `Uint8Array(27)`: celdas por filas, de arriba a la
 * izquierda, cada una r,g,b en sRGB 8 bits. El alfa se ignora (las portadas del
 * CDN son JPEG).
 */
export function rejilla3x3(rgba, ancho, alto) {
  if (!rgba || ancho < REJILLA || alto < REJILLA || rgba.length < ancho * alto * 4) {
    throw new Error(`rejilla3x3: imagen inválida (${ancho}×${alto}, ${rgba?.length ?? 0} bytes)`);
  }
  const cx = cortes(ancho, REJILLA);
  const cy = cortes(alto, REJILLA);
  const out = new Uint8Array(BYTES_POR_PORTADA);
  const L = SRGB_A_LINEAL;
  for (let fy = 0; fy < REJILLA; fy++) {
    for (let fx = 0; fx < REJILLA; fx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = cy[fy]; y < cy[fy + 1]; y++) {
        let i = (y * ancho + cx[fx]) * 4;
        for (let x = cx[fx]; x < cx[fx + 1]; x++, i += 4) {
          r += L[rgba[i]]; g += L[rgba[i + 1]]; b += L[rgba[i + 2]]; n++;
        }
      }
      const o = (fy * REJILLA + fx) * 3;
      out[o] = linealASrgb8(r / n);
      out[o + 1] = linealASrgb8(g / n);
      out[o + 2] = linealASrgb8(b / n);
    }
  }
  return out;
}

/**
 * Media 1×1 de una rejilla guardada (27 bytes desde `offset`), en luz lineal,
 * devuelta en sRGB 8 bits. Las nueve celdas pesan lo mismo: a 64 px las celdas
 * miden 21 o 22 px de lado, así que no es exactamente la media de los píxeles.
 */
export function mediaDeRejilla(datos, offset = 0) {
  const L = SRGB_A_LINEAL;
  let r = 0, g = 0, b = 0;
  for (let c = 0; c < REJILLA * REJILLA; c++) {
    const o = offset + c * 3;
    r += L[datos[o]]; g += L[datos[o + 1]]; b += L[datos[o + 2]];
  }
  const n = REJILLA * REJILLA;
  return [linealASrgb8(r / n), linealASrgb8(g / n), linealASrgb8(b / n)];
}

// sRGB 8 bits → CIELAB (D65, observador 2°). Para comparar colores (ΔE76 es
// la distancia euclídea en este espacio) y para el informe de color.
const XN = 0.95047, YN = 1.0, ZN = 1.08883;
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (t * 24389 / 27 + 16) / 116);

export function srgb8ALab(r, g, b) {
  const L = SRGB_A_LINEAL;
  const rl = L[r], gl = L[g], bl = L[b];
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / XN;
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / YN;
  const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / ZN;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** LAB → LCh: [L*, C* (croma), h (tono en grados, 0-360)]. */
export function labALch([l, a, b]) {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [l, Math.hypot(a, b), h < 0 ? h + 360 : h];
}
