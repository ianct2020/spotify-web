// Wallpaper del mosaico (v=145): dibuja las tapas de #covers en un canvas del
// tamaño de una pantalla y lo descarga como JPEG.
//
// ── Lo único que importa acá es la MEMORIA ──────────────────────────────────
//
// 2.449 tapas decodificadas a la vez son cientos de MB y matan la pestaña. Es
// el mismo pozo que documenta `ui/lazy-img.js` (ahí, recorrer #sin-clasificar
// con tapas de 300px dejaba ~830 MB colgados porque nada se soltaba nunca).
// Las tres reglas de las que sale todo lo demás:
//
//   1. NUNCA hay más de LOTE tapas vivas. Se baja un lote, se dibuja, se
//      libera, y recién ahí se pide el siguiente. No se precargan las 2.449.
//   2. Se libera EXPLÍCITAMENTE, con `ImageBitmap.close()`. Por eso el camino
//      es fetch → blob → createImageBitmap → drawImage → close(), y no un
//      `<img>`: con un `<img>` hay que confiar en que el GC pase por ahí, y
//      el mapa de píxeles decodificado ni siquiera vive en el heap de JS.
//   3. Se pide la variante MÁS CHICA que no se vea borrosa. La celda sale de
//      ~59px en 4K y ~41px en vertical, así que la de 64px alcanza y sobra:
//      2,5 KB por tapa en vez de los 37 KB de la de 300px (6 MB de descarga
//      en total en vez de 90 MB). `coverVariant()` la resuelve cambiando el
//      prefijo de la URL, sin ida a la API.
//
// El otro consumo grande es el canvas y no se puede evitar: 3840×2160×4 = 33
// MB, más el JPEG que sale de `toBlob`. Por eso al terminar se pone el canvas
// en 0×0 — soltar la referencia no basta, el backing store no se libera hasta
// que el canvas mide 0.
//
// Los límites de Chrome quedan lejos: dimensión máxima 16.384 px y unos 268 MP
// de área total (16.384²); el preset más grande son 8,3 MP.

import { coverVariant } from '../util/album-key.js?v=172';

// Presets. `nombre` es lo que se ve en el botón; `archivo` va en la descarga.
export const WALLPAPER_PRESETS = {
  escritorio: { w: 3840, h: 2160, nombre: 'Escritorio 16:9', archivo: 'escritorio-3840x2160' },
  movil: { w: 1440, h: 3120, nombre: 'Móvil', archivo: 'movil-1440x3120' },
};

// Cuántas tapas vivas a la vez. El número lo pone la RED, no la memoria: 24
// bitmaps de 64px son 24 × 16 KB decodificados, o sea nada, y medido contra el
// CDN real el lote de 24 baja las 2.378 tapas en 22 s contra los 44 s del de 12
// (Chrome abre 6 conexiones por host y las tapas se reparten entre dos CDN).
// Si alguna vez hay que bajarlo se baja sin pensarlo: cuesta tiempo, no
// resultado. Con la variante de 640px (mosaicos de pocas tapas, celda grande)
// el pico serían 24 × 1,6 MB = 39 MB, que también entra sobrado.
const LOTE = 24;

// Fondo del lienzo. Se usa donde no hay celda (la última fila casi nunca está
// completa) y, sobre todo, porque el JPEG no tiene alfa: sin pintar el fondo,
// lo transparente sale NEGRO.
const FONDO_FALLBACK = '#0A0A0F';

/**
 * Elige columnas y filas para meter N celdas en un lienzo de W×H.
 *
 * Dos objetivos que pelean entre sí:
 *
 *   - Que la celda quede CUADRADA. La tapa lo es, y estirarla se nota.
 *   - Que la última fila no quede casi vacía. N rara vez es múltiplo de las
 *     columnas, y el hueco cae todo junto abajo. Se centra (ver `offsetUltima`),
 *     pero una última fila con dos tapas centradas se lee como un error.
 *
 * No se mezclan en un score con pesos inventados, porque el resultado depende
 * de N de una forma que no se puede razonar: se pone la última fila como
 * RESTRICCIÓN (al menos medio llena) y dentro de lo que pasa el filtro se
 * minimiza la deformación. Si ningún reparto la cumple —pasa con N chicos y
 * primos— la restricción se afloja por pasos.
 *
 * Con 2.449 tapas: 4K → 67×37, celda 57,3×58,4 (deformación 1,9%, última fila
 * 37 de 67). Vertical → 35×70, celda 41,1×44,6 y sobra UNA celda.
 */
export function elegirGrilla(N, W, H) {
  for (const minUltimaFila of [0.5, 0.25, 0]) {
    let mejor = null;
    for (let cols = 1; cols <= N; cols++) {
      const filas = Math.ceil(N / cols);
      const cw = W / cols;
      const ch = H / filas;
      if (cw < 4 || ch < 4) continue;
      if ((N - cols * (filas - 1)) / cols < minUltimaFila) continue;
      const deform = Math.max(cw / ch, ch / cw);
      // Empate de deformación (pasa cuando N es chico): gana el que deja menos
      // celdas vacías.
      const score = deform + (cols * filas - N) / (N * 1000);
      if (!mejor || score < mejor.score) mejor = { cols, filas, cw, ch, deform, score };
    }
    if (mejor) return mejor;
  }
  return { cols: N, filas: 1, cw: W / N, ch: H, deform: 1, score: 1 };
}

/**
 * La variante más chica que no se vea borrosa: la primera que llega al lado de
 * la celda. Se acepta hasta un 10% de estiramiento antes de saltar a la de
 * arriba — a 59px de celda, la de 64 es prácticamente 1:1 y la de 300 sería
 * bajar 15 veces más bytes para tirarlos en el downscale.
 */
export function variantePara(ladoCelda) {
  const lado = Math.ceil(ladoCelda);
  if (lado <= 71) return 64;
  if (lado <= 333) return 300;
  return 640;
}

// Una tapa, dibujada y liberada. Devuelve true si se dibujó.
//
// `createImageBitmap` sobre el blob evita el `<img>` entero: no toca el DOM, no
// deja nada en un caché de elementos y `close()` libera el mapa de píxeles en
// el acto. El fallback con `<img>` es para navegadores sin la API (ninguno de
// los que usa Ian, pero la vista no puede quedar rota por eso).
async function dibujarTapa(ctx, url, x, y, w, h, signal) {
  let bitmap = null;
  try {
    const res = await fetch(url, { mode: 'cors', signal, cache: 'force-cache' });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (signal?.aborted) return false;
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(blob);
      ctx.drawImage(bitmap, x, y, w, h);
      return true;
    }
    const url2 = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((ok, fail) => {
        img.onload = ok;
        img.onerror = () => fail(new Error('img'));
        img.src = url2;
      });
      ctx.drawImage(img, x, y, w, h);
      img.src = '';
      return true;
    } finally { URL.revokeObjectURL(url2); }
  } catch {
    return false;   // tapa caída: queda el fondo, no se aborta el mosaico
  } finally {
    bitmap?.close();
  }
}

// Cede el hilo entre lotes. `setTimeout` y NO `requestAnimationFrame`: la
// pestaña puede estar en segundo plano (o ser la de la extensión de testeo, que
// corre oculta) y ahí los rAF se espacian a uno por segundo o directamente no
// llegan. Con setTimeout el mosaico se genera igual sin la pestaña en pantalla.
const cederHilo = () => new Promise(r => setTimeout(r, 0));

/**
 * Genera el wallpaper y devuelve `{ blob, ancho, alto, cols, filas, lado,
 * variante, fallidas, ms }`, o `null` si se canceló.
 *
 * `lista` son los álbumes EN EL ORDEN EN QUE SE VEN (ya filtrados y ordenados
 * por la vista): el wallpaper reproduce el mosaico que está en pantalla, no
 * otro. `onProgress(hechas, total)` se llama una vez por lote.
 */
export async function generarWallpaper({ lista, preset = 'escritorio', onProgress, signal, tipo = 'image/jpeg', calidad = 0.92 } = {}) {
  const cfg = WALLPAPER_PRESETS[preset] || WALLPAPER_PRESETS.escritorio;
  const albumes = (lista || []).filter(a => a?.img);
  const N = albumes.length;
  if (!N) throw new Error('No hay tapas para dibujar.');

  const t0 = performance.now();
  const { cols, filas, cw, ch } = elegirGrilla(N, cfg.w, cfg.h);
  const variante = variantePara(Math.max(cw, ch));

  const canvas = document.createElement('canvas');
  canvas.width = cfg.w;
  canvas.height = cfg.h;
  // `alpha: false` ahorra el canal que el JPEG va a tirar igual y le deja al
  // compositor un buffer opaco.
  const ctx = canvas.getContext('2d', { alpha: false });
  const fondo = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || FONDO_FALLBACK;
  ctx.fillStyle = fondo || FONDO_FALLBACK;
  ctx.fillRect(0, 0, cfg.w, cfg.h);
  // Las tapas se achican bastante (300→59 si alguna vez se usa la grande), así
  // que el resampleo bueno se nota y no cuesta casi nada a este tamaño.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // La última fila casi nunca viene completa: se centra, que es lo único que
  // no se lee como un error de dibujo.
  const enUltimaFila = N - cols * (filas - 1);
  const offsetUltima = (cols - enUltimaFila) * cw / 2;

  console.log(`[wallpaper] ${cfg.w}×${cfg.h}: ${N} tapas en ${cols}×${filas} (celda ${cw.toFixed(1)}×${ch.toFixed(1)}) → variante ${variante}px, lotes de ${LOTE}`);

  let fallidas = 0;
  for (let i = 0; i < N; i += LOTE) {
    if (signal?.aborted) { canvas.width = canvas.height = 0; return null; }
    const hasta = Math.min(i + LOTE, N);
    const tareas = [];
    for (let k = i; k < hasta; k++) {
      const fila = Math.floor(k / cols);
      const col = k % cols;
      const extra = fila === filas - 1 ? offsetUltima : 0;
      // Bordes redondeados al píxel y ancho tomado como diferencia entre bordes
      // consecutivos: así las celdas encajan sin costuras de fondo entre medio,
      // que con celdas fraccionarias (59,08px) saldrían sí o sí.
      const x0 = Math.round(col * cw + extra);
      const x1 = Math.round((col + 1) * cw + extra);
      const y0 = Math.round(fila * ch);
      const y1 = Math.round((fila + 1) * ch);
      const url = coverVariant(albumes[k].img, variante);
      tareas.push(dibujarTapa(ctx, url, x0, y0, x1 - x0, y1 - y0, signal));
    }
    const res = await Promise.all(tareas);
    fallidas += res.filter(ok => !ok).length;
    onProgress?.(hasta, N);
    await cederHilo();     // el lote anterior ya está cerrado antes de pedir el próximo
  }

  if (signal?.aborted) { canvas.width = canvas.height = 0; return null; }

  const blob = await new Promise(resolve => canvas.toBlob(resolve, tipo, calidad));
  // Soltar la referencia no alcanza: el backing store del canvas (33 MB en 4K)
  // sigue vivo hasta que el canvas mide 0×0.
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('El navegador no pudo generar la imagen.');
  if (signal?.aborted) return null;

  const ms = performance.now() - t0;
  console.log(`[wallpaper] listo en ${(ms / 1000).toFixed(1)}s — ${(blob.size / 1048576).toFixed(1)} MB, ${fallidas} tapas fallidas`);
  return { blob, ancho: cfg.w, alto: cfg.h, cols, filas, lado: Math.round(cw), variante, fallidas, ms, archivo: cfg.archivo };
}

/** Descarga un blob con nombre, soltando el object URL después. */
export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar en el acto cancela la descarga en Chrome; un tick alcanza.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
