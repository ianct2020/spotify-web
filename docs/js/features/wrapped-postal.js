// La postal del año «El año en días» (v=344, tanda 97; la de las tapas fue v=326-v=343): el DIBUJO y la
// DESCARGA. Qué dice y dónde va cada cosa lo decide `util/postal-anio.js` (puro, probado en Node); acá se leen
// los colores del tema, se espera la letra, se dibuja en un <canvas> de 1080×1350 y se descarga
// `fonoteca-<año>.png`.
//
// Lo carga `wrapped.js` con `import()` RECIÉN al apretar «Descargar postal (PNG)»: abrir «Wrapped» no
// baja este archivo ni `postal-anio.js` (lo afirma la puerta A del banco `tests/banco/postal.html`).
//
// ── Sin tapas ───────────────────────────────────────────────────────────────
//
// La postal de v=326-v=343 bajaba las tapas de los cinco discos del CDN de Spotify (`conTapa`, con un tope de
// 8 s por tapa y un plan B sin tapas si el lienzo quedaba manchado). La de días no lleva ninguna imagen: no
// pide nada a ninguna red (0 a Spotify, 0 al CDN; lo afirma la puerta J del banco) y el lienzo no puede
// quedar manchado. Si `toBlob` devuelve `null` o tira igual, se tira el error crudo: `wrapped.js` lo pinta en
// un toast rojo y no se descarga nada. `covers-wallpaper.js` no cambió: de él se usa solo `descargarBlob`.
//
// ── Los colores y la letra ──────────────────────────────────────────────────
//
// Ningún color escrito a mano: se leen del tema con `getComputedStyle` al apretar. Fondo `--color-bg`, los
// tonos de los días (`tonosPostal` de `postal-anio.js`: la superficie, el fondo y el acento mezclados), el
// contorno del día pico y el texto `--color-text`, y el secundario `--color-text-secondary` (NUNCA
// `--color-text-muted`). El contraste lo vuelve a medir `tests/postal-anio.test.mjs` en los cuatro presets,
// y el banco contra los píxeles del PNG.
//
// Antes de medir y dibujar se espera la letra de la app (`document.fonts.load` de cada peso), con un
// tope: si no carga, se dibuja con la de reserva y no se avisa (no es un error).
//
// ── Salir de la ruta a mitad ────────────────────────────────────────────────
//
// `vigente()` (la vigencia de ruta de v=174) y `signal` se preguntan después de cada espera: si saliste,
// devuelve `null` sin descargar nada y sin escribir en el DOM (la descarga mete un <a> en el documento, y
// eso también cuenta).
//
// `window.__postalDibujo` queda para el banco, como `window.__mapaArtistasDibujo`: cada `fillText` con
// su texto, el ancho medido, el máximo y los colores con que se pintó, y cada día con su tono.

import { descargarBlob } from './covers-wallpaper.js?v=344';
import { planPostal, tonosPostal, tonoDe, contrastePostal, PESOS, ANCHO, ALTO } from '../util/postal-anio.js?v=344';

const TOKENS = {
  bg: '--color-bg', surface: '--color-surface', accent: '--color-accent',
  text: '--color-text', secondary: '--color-text-secondary',
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
  let reloj = 0;
  await Promise.race([cargas, new Promise((r) => { reloj = setTimeout(r, ESPERA_LETRA_MS); })]);
  clearTimeout(reloj);
}

/** Los colores como los deja el lienzo (`#rrggbb`): las mezclas y el banco comparan esto. */
function normalizar(colores) {
  const ctx = document.createElement('canvas').getContext('2d');
  return Object.fromEntries(Object.entries(colores).map(([k, css]) => { ctx.fillStyle = '#000'; ctx.fillStyle = css; return [k, ctx.fillStyle]; }));
}

/** Un rectángulo con las esquinas redondeadas, como camino. `roundRect` es de Chrome 99: sin él, recto. */
function caminoRedondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

/** `toBlob` como promesa: el blob, o tira con el error crudo. */
function aPng(canvas) {
  return new Promise((ok, mal) => {
    try {
      canvas.toBlob((blob) => (blob ? ok(blob) : mal(new Error('toBlob devolvió null'))), 'image/png');
    } catch (e) {
      mal(e);
    }
  });
}

/**
 * Dibuja y descarga la postal del año `y` (una entrada de `years[]`). Devuelve `{ nombre, aviso }`, o `null`
 * si se abortó o la ruta dejó de ser la vigente (sin descargar nada). Tira si el navegador no pudo hacer el PNG.
 */
export async function generarPostal(y, { fmtMinutes, fmtDia, signal, vigente = () => true }) {
  const sigue = () => !signal?.aborted && vigente();
  const fam = familia();
  await esperarLetra(fam);
  if (!sigue()) return null;
  const colores = normalizar(leerColores());

  // Se mide con la letra de verdad: el recorte de `postal-anio.js` usa esta medida, así que lo que se
  // recorta es lo que entra.
  const medidor = document.createElement('canvas').getContext('2d');
  const medir = (t, f) => { medidor.font = fuenteCss(f, fam); return medidor.measureText(t).width; };
  const plan = planPostal(y, { fmtMinutes, fmtDia, medir });
  const tonos = tonosPostal(colores);
  const peor = new Map(contrastePostal(plan, colores).map((p) => [p.id, p.color]));

  const canvas = document.createElement('canvas');
  canvas.width = ANCHO;
  canvas.height = ALTO;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = colores.bg;
  ctx.fillRect(0, 0, ANCHO, ALTO);
  // Los días; el pico, con su contorno.
  for (const c of plan.celdas) {
    ctx.fillStyle = tonoDe(c, tonos);
    caminoRedondeado(ctx, c.x, c.y, c.w, c.h, c.radio);
    ctx.fill();
    if (c.pico) {
      ctx.strokeStyle = tonos.borde;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  ctx.textBaseline = 'top';
  const textos = [];
  for (const t of plan.textos) {
    if (!t.texto) continue;
    ctx.font = fuenteCss(t.fuente, fam);
    ctx.textAlign = t.alinear;
    ctx.fillStyle = colores[t.color];
    ctx.fillText(t.texto, t.x, t.y);
    textos.push({ id: t.id, texto: t.texto, ancho: ctx.measureText(t.texto).width, max: t.max, color: t.color, valor: ctx.fillStyle, sobreValor: peor.get(t.id), caja: t.caja });
  }

  let png;
  try {
    png = await aPng(canvas);
  } finally {
    canvas.width = canvas.height = 0;
  }

  window.__postalDibujo = {
    ancho: ANCHO, alto: ALTO, letra: fam, colores, tonos, textos,
    celdas: plan.celdas.map((c) => ({ iso: c.iso, x: c.x, y: c.y, w: c.w, h: c.h, fuera: c.fuera, nivel: c.nivel, pico: c.pico, tono: tonoDe(c, tonos) })),
  };
  if (!sigue()) return null;
  const nombre = `fonoteca-${y.year}.png`;
  descargarBlob(png, nombre);
  return { nombre, aviso: 'Postal descargada.' };
}
