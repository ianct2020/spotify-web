// La postal del año (v=326; rediseñada en v=327): el DIBUJO y la DESCARGA. Qué dice y dónde va cada cosa lo decide
// `util/postal-anio.js` (puro, probado en Node); acá se leen los colores del tema, se espera la letra, se
// bajan las tapas, se dibuja en un <canvas> de 1080×1350 y se descarga `fonoteca-<año>.png`.
//
// Lo carga `wrapped.js` con `import()` RECIÉN al apretar «Descargar postal (PNG)»: abrir «Wrapped» no
// baja este archivo ni `postal-anio.js` (lo afirma la puerta A del banco `tests/banco/postal.html`).
//
// ── Las tapas: por qué no pueden manchar el lienzo ──────────────────────────
//
// Se bajan con `conTapa()` de `covers-wallpaper.js`, IMPORTADO y no copiado: el mismo camino que el
// wallpaper de «Mis tapas» y el mosaico (`fetch(url, { mode: 'cors' })` → blob → `createImageBitmap` →
// `drawImage` → `close()`). Leído del código:
//
//   · con `mode: 'cors'`, una respuesta SIN `access-control-allow-origin` hace que el `fetch` se
//     RECHACE: no llega ningún blob y `conTapa` devuelve `false`. No hay camino que dibuje una imagen
//     opaca de otro origen;
//   · el bitmap que sale del blob de un `fetch` CORS no mancha el lienzo, así que `toBlob` funciona.
//
// Que el CDN de Spotify contesta con CORS ya está medido en vivo: `mosaico-colores.js` baja así sus tapas
// y lee los píxeles con `getImageData`, que TIRA sobre un lienzo manchado; la base de colores del
// navegador de Ian se armó así el 27/09 con 5.715 tapas de los mismos tres hosts.
//
// Igual, por las dudas, la regla de antemano: si `toBlob` devuelve `null` o tira (`SecurityError` o lo
// que sea), la postal se vuelve a dibujar SIN tapas en un lienzo NUEVO (uno manchado no se limpia
// pintando encima: la marca es del lienzo, no de los píxeles) y se descarga igual, con el aviso «La
// postal salió sin tapas: …». Una tapa que no baja (404, sin CORS, la red) es una casilla con ♪, nunca
// una postal abortada.
//
// ── Los colores y la letra ──────────────────────────────────────────────────
//
// Ningún color escrito a mano: se leen del tema con `getComputedStyle` al apretar. Fondo `--color-bg`,
// el degradé de arriba (el acento mezclado con el fondo: lo arma `degradadoPostal` de `postal-anio.js`, que
// elige la mezcla para que el texto de encima llegue a AA contra su punto PEOR), la casilla del ♪
// `--color-elevated`, el texto `--color-text` y el secundario `--color-text-secondary` (NUNCA
// `--color-text-muted`). El acento, solo para lo que no es texto (las barras y las líneas de la franja).
// El contraste lo vuelve a medir `tests/postal-anio.test.mjs` en los cuatro presets, y el banco contra
// los píxeles del PNG.
//
// Antes de medir y dibujar se espera la letra de la app (`document.fonts.load` de cada peso), con un
// tope: si no carga, se dibuja con la de reserva y no se avisa (no es un error).
//
// ── Salir de la ruta a mitad ────────────────────────────────────────────────
//
// `signal` aborta las tapas en vuelo y `vigente()` (la vigencia de ruta de v=174) se pregunta después de
// cada espera: si saliste, devuelve `null` sin descargar nada y sin escribir en el DOM (la descarga mete
// un <a> en el documento, y eso también cuenta).
//
// `window.__postalDibujo` queda para el banco, como `window.__mapaArtistasDibujo`: cada `fillText` con
// su texto, el ancho medido, el máximo y los colores con que se pintó, y cada tapa con si se dibujó.

import { conTapa, descargarBlob } from './covers-wallpaper.js?v=330';
import { planPostal, degradadoPostal, avisoPostal, PESOS, ANCHO, ALTO } from '../util/postal-anio.js?v=330';

const TOKENS = {
  bg: '--color-bg', surface: '--color-surface', elevated: '--color-elevated',
  text: '--color-text', secondary: '--color-text-secondary', accent: '--color-accent',
};
// Lo que se espera a la letra como mucho. Medido en ningún lado: es un tope para que una red lenta no
// deje el botón en «Generando…»; pasado, se dibuja con la de reserva.
const ESPERA_LETRA_MS = 3000;

function leerColores() {
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(Object.entries(TOKENS).map(([k, v]) => [k, cs.getPropertyValue(v).trim()]));
}

const familia = () => getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
const fuenteCss = (f, fam) => `${f.peso} ${f.tam}px ${fam}`;

async function esperarLetra(fam) {
  if (!document.fonts?.load) return;
  const cargas = Promise.all(PESOS.map((p) => document.fonts.load(`${p} 24px ${fam}`).catch(() => null)));
  await Promise.race([cargas, new Promise((r) => setTimeout(r, ESPERA_LETRA_MS))]);
}

/** Los colores como los deja el lienzo (`#rrggbb`): la cuenta del degradé y el banco comparan esto. */
function normalizar(colores) {
  const ctx = document.createElement('canvas').getContext('2d');
  return Object.fromEntries(Object.entries(colores).map(([k, css]) => { ctx.fillStyle = '#000'; ctx.fillStyle = css; return [k, ctx.fillStyle]; }));
}

/** Un rectángulo con las esquinas redondeadas, como camino. `roundRect` es de Chrome 99: sin él, recto. */
function caminoRedondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

/** Un lienzo nuevo con todo menos las tapas. Devuelve el contexto y lo que se pintó de texto. */
function lienzoBase(plan, colores, fam, deg) {
  const canvas = document.createElement('canvas');
  canvas.width = ANCHO;
  canvas.height = ALTO;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colores.bg;
  ctx.fillRect(0, 0, ANCHO, ALTO);
  // El degradé de arriba: de la mezcla más fuerte al fondo, en la franja que dice el plan.
  const g = ctx.createLinearGradient(0, deg.y0, 0, deg.y1);
  for (const p of deg.paradas) g.addColorStop(p.t, p.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, deg.y0, ANCHO, deg.y1 - deg.y0);
  for (const f of plan.fondos) {
    ctx.fillStyle = colores[f.color];
    caminoRedondeado(ctx, f.x, f.y, f.w, f.h, 20);
    ctx.fill();
  }
  ctx.fillStyle = colores.accent;
  for (const b of plan.barras) { caminoRedondeado(ctx, b.x, b.y, b.w, b.h, Math.min(b.w, b.h) / 2); ctx.fill(); }
  ctx.textBaseline = 'top';
  // Lo que tiene detrás cada texto: el fondo liso, o el punto PEOR del degradé detrás de su caja.
  const peor = new Map(deg.peor.map((p) => [p.id, p.color]));
  const textos = [];
  for (const t of plan.textos) {
    if (!t.texto) continue;
    ctx.font = fuenteCss(t.fuente, fam);
    ctx.textAlign = t.alinear;
    ctx.fillStyle = colores[t.color];
    ctx.fillText(t.texto, t.x, t.y);
    textos.push({ id: t.id, texto: t.texto, ancho: ctx.measureText(t.texto).width, max: t.max, color: t.color, valor: ctx.fillStyle, sobre: t.sobre, sobreValor: t.sobre === 'degradado' ? peor.get(t.id) : colores[t.sobre], caja: t.caja });
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx, textos };
}

/** Una tapa en su casilla, con las esquinas redondeadas. */
function pintarTapa(ctx, dib, t) {
  ctx.save();
  caminoRedondeado(ctx, t.x, t.y, t.lado, t.lado, t.radio || 0);
  ctx.clip();
  ctx.drawImage(dib, t.x, t.y, t.lado, t.lado);
  ctx.restore();
  return true;
}

/** La casilla de una tapa que no está: el cuadro de `--color-elevated` con un ♪ en el secundario. */
function pintarNota(ctx, t, colores, fam) {
  ctx.fillStyle = colores[t.nota.sobre];
  caminoRedondeado(ctx, t.x, t.y, t.lado, t.lado, t.radio || 0);
  ctx.fill();
  ctx.font = fuenteCss(t.nota.fuente, fam);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colores[t.nota.color];
  ctx.fillText(t.nota.texto, t.x + t.lado / 2, t.y + t.lado / 2);
  ctx.textBaseline = 'top';
  return { id: `nota-${t.i}`, texto: t.nota.texto, ancho: ctx.measureText(t.nota.texto).width, max: t.lado, color: t.nota.color, valor: ctx.fillStyle, sobre: t.nota.sobre, sobreValor: colores[t.nota.sobre] };
}

/** `toBlob` como promesa que nunca tira: `{ blob }` o `{ motivo }`. */
function aPng(canvas) {
  return new Promise((ok) => {
    try {
      canvas.toBlob((blob) => ok(blob ? { blob } : { motivo: 'toBlob devolvió null' }), 'image/png');
    } catch (e) {
      ok({ motivo: e?.name || String(e) });
    }
  });
}

/**
 * Dibuja y descarga la postal del año `y` (una entrada de `years[]`). Devuelve `{ nombre, aviso, faltan,
 * sinTapas, motivo }`, o `null` si se abortó o la ruta dejó de ser la vigente (sin descargar nada).
 * Tira solo si el navegador no pudo hacer el PNG ni siquiera sin tapas.
 */
export async function generarPostal(y, { fmtMinutes, fmtDia, signal, vigente = () => true }) {
  const sigue = () => !signal?.aborted && vigente();
  const fam = familia();
  await esperarLetra(fam);
  if (!sigue()) return null;
  const colores = normalizar(leerColores());

  // Se mide con la letra de verdad, en un lienzo del mismo tamaño: el recorte de `postal-anio.js` usa
  // esta medida, así que lo que se recorta es lo que entra.
  const medidor = document.createElement('canvas').getContext('2d');
  const medir = (t, f) => { medidor.font = fuenteCss(f, fam); return medidor.measureText(t).width; };
  const plan = planPostal(y, { fmtMinutes, fmtDia, medir });
  const deg = degradadoPostal(plan, colores);

  const base = lienzoBase(plan, colores, fam, deg);
  const dibujadas = await Promise.all(plan.tapas.map((t) => (t.url
    ? conTapa(t.url, signal, (dib) => pintarTapa(base.ctx, dib, t))
    : Promise.resolve(false))));
  if (!sigue()) { base.canvas.width = base.canvas.height = 0; return null; }
  const notas = plan.tapas.filter((t, k) => !dibujadas[k]).map((t) => pintarNota(base.ctx, t, colores, fam));
  let png = await aPng(base.canvas);
  base.canvas.width = base.canvas.height = 0;
  let textos = [...base.textos, ...notas], sinTapas = false, motivo = null;

  if (!png.blob) {
    // El plan B: otra vez, en un lienzo nuevo y sin ninguna tapa.
    motivo = png.motivo;
    console.warn('[postal] el PNG con tapas no salió, va sin tapas:', motivo);
    const b = lienzoBase(plan, colores, fam, deg);
    textos = [...b.textos, ...plan.tapas.map((t) => pintarNota(b.ctx, t, colores, fam))];
    png = await aPng(b.canvas);
    b.canvas.width = b.canvas.height = 0;
    if (!png.blob) throw new Error(`El navegador no pudo generar la imagen (${png.motivo}).`);
    sinTapas = true;
  }

  const faltan = sinTapas ? 0 : dibujadas.filter((d) => !d).length;
  window.__postalDibujo = {
    ancho: ANCHO, alto: ALTO, letra: fam, sinTapas, motivo, faltan,
    colores,
    degradado: { y0: deg.y0, y1: deg.y1, mezcla: deg.mezcla, paradas: deg.paradas, peor: deg.peor },
    textos,
    tapas: plan.tapas.map((t, k) => ({ i: t.i, x: t.x, y: t.y, lado: t.lado, conUrl: !!t.url, dibujada: !sinTapas && !!dibujadas[k] })),
  };
  if (!sigue()) return null;
  const nombre = `fonoteca-${y.year}.png`;
  descargarBlob(png.blob, nombre);
  return { nombre, aviso: avisoPostal({ faltan, sinTapas, motivo }), faltan, sinTapas, motivo };
}
