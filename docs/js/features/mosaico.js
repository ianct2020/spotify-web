// #mosaico (v=250): subes una imagen y la app la reconstruye usando como
// «píxeles» las portadas de tu biblioteca.
//
// ── Por qué es una ruta aparte y no una pestaña de #covers ──────────────────
//
// `#covers` es un fondo de pantalla: pinta TUS tapas, en el orden en que las
// ordenaste, y su wallpaper es una foto de eso. Esto es otro artefacto: la
// composición la manda una imagen de fuera y las portadas son material. Lo que
// se comparte es el CÓDIGO (`conTapa` de `covers-wallpaper.js`, que baja y
// libera una tapa siguiendo las tres reglas de memoria que están documentadas
// allí), no la vista. Mezclar dos propósitos en una vista es lo que dejó a
// `#new-releases` disparando un escaneo cada vez que se abre.
//
// ── Qué NO hace ─────────────────────────────────────────────────────────────
//
// **No pega a `api.spotify.com`, ni una vez.** Los colores salen de la caché
// `mosaico_colores_v1` (IndexedDB) y las portadas del CDN de imágenes, que no
// gasta cuota. Si algún día esta vista aparece en un Resource Timing pidiéndole
// algo a la API, está mal planteada.
//
// **La imagen del usuario no sale del navegador.** Se lee con
// `createImageBitmap(File)` y se dibuja en un canvas; no hay ningún `fetch` que
// la mande a ninguna parte, no se guarda en IndexedDB ni en localStorage, y al
// salir de la ruta se cierra. La única salida es la descarga que pide el
// usuario, que es un `<a download>` local.

import { pageHeader, escapeHtml } from '../ui/components.js?v=258';
import { showToast } from '../ui/toast.js?v=258';
import { generacionActual, rutaVigente } from '../router.js?v=258';
import { descargarBlob } from './covers-wallpaper.js?v=258';
import { bajarPortadas, soltarBitmaps, pintarMosaico } from './mosaico-lienzo.js?v=258';
import { leerColores, urlDe } from './mosaico-colores.js?v=258';
import {
  grillaPara, rejillaDelObjetivo, tilesALab, emparejar, mapaDeTinte, resumenDeEmparejado,
} from '../util/mosaico.js?v=258';

// El lado de cada celda en el mosaico final, en píxeles. 64 es **la variante
// que la caché de colores garantiza**: las 5.715 portadas se bajaron a 64 px
// para calcularles el color, así que ya están en la caché HTTP del navegador y
// el mosaico se compone sin pedir un byte nuevo. Y a 64 px la portada se dibuja
// 1:1, sin remuestrear. Con 60×80 celdas el resultado son 3.840×5.120 px.
const LADO_CELDA = 64;

// Tamaños de grilla que ofrece la vista: celdas del lado MÁS LARGO de la
// imagen. 80 da las 60×80 que pidió Ian con una imagen 3:4.
const GRILLAS = [
  { n: 60, etiqueta: 'Gruesa' },
  { n: 80, etiqueta: 'Normal' },
  { n: 120, etiqueta: 'Fina' },
];
const GRILLA_DEFECTO = 80;

// Cuántas portadas distintas entran, y qué cuesta en parecido. El número es la
// penalización por uso en ΔE que va a `emparejar()`; la curva entera está en el
// comentario de `PENAL_USO_DE` (`util/mosaico.js`) y el detalle en
// `RESUMEN-MOSAICO-VARIEDAD-2026-09-28.md`.
//
// ⚠️ **«Fiel» es 1 y no 0 a propósito.** Con 0 —el reparto de v=250/252— una
// zona de cielo plano se hace con 14 portadas puestas en una retícula periódica
// que se lee como un empapelado. El 1 la rompe por 0,10 de ΔE final (9,69 →
// 9,79 en la imagen de prueba): es gratis y no hay motivo para ofrecer el
// defecto como opción.
//
// Los números de la etiqueta salen de la imagen de prueba con 4.800 celdas: en
// otra imagen cambian, así que se dicen como orden de magnitud y la vista
// muestra los de verdad en el resumen cuando termina.
const VARIEDADES = [
  { n: 1, etiqueta: 'Fiel', ayuda: 'La portada más parecida a cada celda. Con la imagen de prueba: ~270 portadas distintas.' },
  { n: 3, etiqueta: 'Normal', ayuda: 'Reparte el catálogo sin que se note en el parecido. Con la imagen de prueba: ~530 portadas distintas.' },
  { n: 6, etiqueta: 'Variada', ayuda: 'El doble de portadas. El tinte tapa un poco más. Con la imagen de prueba: ~1.100 portadas distintas.' },
  { n: 10, etiqueta: 'Máxima', ayuda: 'Todas las portadas que quepan. Aquí el parecido ya se resiente. Con la imagen de prueba: ~1.900 portadas distintas.' },
];
const VARIEDAD_DEFECTO = 3;

// El tinte por defecto, y por qué ESTE número. El informe de color del catálogo
// (27/09) midió que el 38 % de sRGB no tiene ninguna portada a ΔE 10, así que
// hace falta tinte; pero también que el 26 % tiene cinco o más y no lo necesita.
// De ahí el modo adaptativo, que reparte según el ΔE de cada celda. Y de ahí
// que el número de arranque sea MÁS ALTO que el 25 % de un tinte plano: en
// adaptativo la escala se multiplica por un peso que en la imagen de prueba
// promedió 0,55, así que 45 % de escala son ~25 % de tinte efectivo.
const TINTE_DEFECTO = 45;
const MODO_DEFECTO = 'adaptativo';

// Techo de píxeles que se leen de la imagen subida. 8 MP son 32 MB de
// `ImageData`; por encima se escala. El promedio de cada celda se hace en luz
// lineal sobre estos píxeles (`rejillaDelObjetivo`), y el único paso en sRGB es
// este escalado, que solo ocurre con imágenes de más de 8 MP.
const MAX_PIXELES_OBJETIVO = 8e6;

const fmtN = (n) => n.toLocaleString('es-ES');
const fmtMB = (b) => (b / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const fmt1 = (n) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

export async function render(container) {
  const gen = generacionActual();

  container.innerHTML = `
    ${pageHeader({ title: 'Mosaico' })}
    <div class="card">
      <p style="margin:0 0 4px">Sube una imagen y la reconstruyo con las portadas de tu biblioteca.</p>
      <p style="margin:0 0 14px;color:var(--color-text-secondary);font-size:13px">
        Tu imagen no sale de este navegador: se lee aquí, se dibuja aquí y solo se guarda si pulsas «Descargar».
      </p>
      <p id="mos-base" style="margin:0 0 14px;font-size:13px">Leyendo la base de colores…</p>
      <div id="mos-controles" hidden>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:14px">
          <input type="file" id="mos-file" accept="image/*" style="font-size:13px">
          <button class="btn btn-primary" id="mos-generar" disabled>Generar</button>
          <button class="btn btn-secondary" id="mos-parar" disabled>Detener</button>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end">
          <div>
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px">Tamaño de la rejilla</div>
            <div style="display:flex;gap:6px">
              ${GRILLAS.map(g => `<button class="btn btn-secondary${g.n === GRILLA_DEFECTO ? ' is-on' : ''}" data-grilla="${g.n}" style="padding:6px 12px;font-size:13px">${g.etiqueta} · ${g.n}</button>`).join('')}
            </div>
          </div>
          <div style="min-width:240px">
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px">
              Tinte del color original: <strong id="mos-tinte-val">${TINTE_DEFECTO} %</strong>
            </div>
            <input type="range" id="mos-tinte" min="0" max="100" step="5" value="${TINTE_DEFECTO}" style="width:100%">
          </div>
          <div>
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px">Variedad de portadas</div>
            <div style="display:flex;gap:6px">
              ${VARIEDADES.map(v => `<button class="btn btn-secondary${v.n === VARIEDAD_DEFECTO ? ' is-on' : ''}" data-variedad="${v.n}" title="${escapeHtml(v.ayuda)}" style="padding:6px 12px;font-size:13px">${v.etiqueta}</button>`).join('')}
            </div>
          </div>
          <div>
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:6px">Reparto del tinte</div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary is-on" data-modo="adaptativo" title="Más tinte donde la portada se parece poco al color que tocaba, y nada donde se parece mucho." style="padding:6px 12px;font-size:13px">Adaptativo</button>
              <button class="btn btn-secondary" data-modo="plano" title="El mismo tinte en todas las celdas." style="padding:6px 12px;font-size:13px">Plano</button>
            </div>
          </div>
        </div>
      </div>
      <p id="mos-estado" style="margin:14px 0 0;font-size:13px;color:var(--color-text-secondary)"></p>
    </div>
    <div class="card" id="mos-salida" hidden style="margin-top:20px">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <button class="btn btn-primary" id="mos-descargar">Descargar</button>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px">
          <input type="checkbox" id="mos-cien"> Ver al 100 %
        </label>
        <span id="mos-resumen" style="font-size:12px;color:var(--color-text-secondary)"></span>
      </div>
      <div id="mos-lienzo" style="overflow:auto;max-height:78vh;background:var(--color-bg);border-radius:var(--radius-md)"></div>
    </div>
  `;

  const $ = (id) => document.getElementById(id);
  const estado = $('mos-estado');
  const di = (txt) => { if (estado.isConnected) estado.textContent = txt; };

  // ── La base de colores ────────────────────────────────────────────────────
  let reg = null;
  try {
    reg = await leerColores();
  } catch (err) {
    $('mos-base').innerHTML = `<span style="color:var(--color-error)">No he podido leer la base de colores: ${escapeHtml(err.message)}</span>`;
    return () => {};
  }
  if (!rutaVigente(gen)) return () => {};
  if (!reg || !reg.ids?.length) {
    $('mos-base').innerHTML = '<span style="color:var(--color-error)">Todavía no hay base de colores.</span>'
      + ' Constrúyela en <code>#debug</code> → «Base de colores del mosaico»: baja la miniatura de cada portada del CDN de imágenes y le calcula el color. Tarda menos de un minuto y no gasta cuota de Spotify.';
    return () => {};
  }
  const nTiles = reg.ids.length;
  $('mos-base').innerHTML = `<strong>${fmtN(nTiles)} portadas</strong> disponibles como teselas`
    + ` <span style="color:var(--color-text-muted)">· ${fmtMB(reg.bytes)} MB de miniaturas ya descargadas · base del ${escapeHtml(new Date(reg.actualizado).toLocaleDateString('es-ES'))}</span>`;
  $('mos-controles').hidden = false;

  // ── Estado de la vista ────────────────────────────────────────────────────
  let tilesLab = null;          // Float32Array(nTiles × 27), perezoso
  let bitmapObjetivo = null;    // la imagen del usuario
  let lienzoLectura = null;     // canvas con la imagen a tamaño de lectura
  let pixelesObjetivo = null;   // { rgba, ancho, alto }
  let ladoLargo = GRILLA_DEFECTO;
  let variedad = VARIEDAD_DEFECTO;
  let modo = MODO_DEFECTO;
  let tinte = TINTE_DEFECTO;
  let ultimo = null;            // { canvas, ctx, cols, filas, indice, de, objetivo, ms, bitmaps }
  let ctrl = null;

  const soltarSalida = () => {
    if (!ultimo) return;
    soltarBitmaps(ultimo.bitmaps);
    // Soltar la referencia no alcanza: el backing store del canvas (78 MB con
    // 60×80 celdas de 64 px) sigue vivo hasta que el canvas mide 0×0.
    ultimo.canvas.width = ultimo.canvas.height = 0;
    ultimo = null;
  };

  // ── La imagen que sube el usuario ─────────────────────────────────────────
  $('mos-file').addEventListener('change', async (e) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    $('mos-generar').disabled = true;
    di(`Leyendo ${file.name}…`);
    try {
      bitmapObjetivo?.close?.();
      bitmapObjetivo = await createImageBitmap(file);
      const w0 = bitmapObjetivo.width, h0 = bitmapObjetivo.height;
      // Se lee a tamaño natural mientras no pase del techo. Escalar acá
      // promedia en sRGB (lo hace el canvas), y la convención del mosaico es
      // luz lineal: cuanto menos escalado, menos desvío.
      const k = Math.min(1, Math.sqrt(MAX_PIXELES_OBJETIVO / (w0 * h0)));
      const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
      lienzoLectura = document.createElement('canvas');
      lienzoLectura.width = w; lienzoLectura.height = h;
      const cl = lienzoLectura.getContext('2d', { alpha: false, willReadFrequently: true });
      cl.imageSmoothingEnabled = true; cl.imageSmoothingQuality = 'high';
      cl.drawImage(bitmapObjetivo, 0, 0, w, h);
      pixelesObjetivo = { rgba: cl.getImageData(0, 0, w, h).data, ancho: w, alto: h };
      const g = grillaPara(w, h, ladoLargo);
      di(`${file.name}: ${fmtN(w0)}×${fmtN(h0)} px${k < 1 ? ` (leída a ${fmtN(w)}×${fmtN(h)})` : ''} · rejilla ${g.cols}×${g.filas} = ${fmtN(g.cols * g.filas)} celdas → ${fmtN(g.cols * LADO_CELDA)}×${fmtN(g.filas * LADO_CELDA)} px`);
      $('mos-generar').disabled = false;
    } catch (err) {
      pixelesObjetivo = null;
      di('');
      showToast(`No he podido leer la imagen: ${err.message}`, 'error');
    }
  });

  // ── Controles ─────────────────────────────────────────────────────────────
  container.querySelectorAll('[data-grilla]').forEach(btn => {
    btn.addEventListener('click', () => {
      ladoLargo = Number(btn.dataset.grilla);
      container.querySelectorAll('[data-grilla]').forEach(b => b.classList.toggle('is-on', b === btn));
      if (pixelesObjetivo) {
        const g = grillaPara(pixelesObjetivo.ancho, pixelesObjetivo.alto, ladoLargo);
        di(`Rejilla ${g.cols}×${g.filas} = ${fmtN(g.cols * g.filas)} celdas → ${fmtN(g.cols * LADO_CELDA)}×${fmtN(g.filas * LADO_CELDA)} px. Pulsa «Generar».`);
      }
    });
  });

  // Cambiar la variedad rehace el emparejado (y baja las portadas nuevas), así
  // que pide «Generar» igual que la rejilla; el deslizador del tinte, en cambio,
  // solo repinta. Son dos costos distintos y por eso dos comportamientos.
  container.querySelectorAll('[data-variedad]').forEach(btn => {
    btn.addEventListener('click', () => {
      variedad = Number(btn.dataset.variedad);
      container.querySelectorAll('[data-variedad]').forEach(b => b.classList.toggle('is-on', b === btn));
      if (pixelesObjetivo) di(`Variedad «${VARIEDADES.find(v => v.n === variedad).etiqueta}». Pulsa «Generar».`);
    });
  });

  container.querySelectorAll('[data-modo]').forEach(btn => {
    btn.addEventListener('click', () => {
      modo = btn.dataset.modo;
      container.querySelectorAll('[data-modo]').forEach(b => b.classList.toggle('is-on', b === btn));
      repintarTinte();
    });
  });

  const slider = $('mos-tinte');
  slider.addEventListener('input', () => {
    tinte = Number(slider.value);
    $('mos-tinte-val').textContent = `${tinte} %`;
    repintarTinte();
  });

  // Dos vistas y no una escala intermedia: **entera** (lo primero que se quiere
  // ver es si el mosaico salió bien) y **al 100 %** (para que se vean las
  // portadas una a una). Entera se ajusta al ALTO de la caja, no al ancho: con
  // 60×80 celdas el mosaico mide 3.840×5.120 px y ajustado al ancho se sale de
  // la caja por abajo, o sea que no se ve entero, que era el punto.
  function aplicarZoom(cien) {
    const c = ultimo?.canvas;
    if (!c) return;
    c.style.width = cien ? `${c.width}px` : 'auto';
    c.style.height = cien ? `${c.height}px` : 'auto';
    c.style.maxWidth = '100%';
    c.style.maxHeight = cien ? 'none' : '76vh';
    c.style.margin = cien ? '0' : '0 auto';
  }
  $('mos-cien').addEventListener('change', (e) => aplicarZoom(e.currentTarget.checked));

  // ── Componer ──────────────────────────────────────────────────────────────
  async function componer() {
    const t0 = performance.now();
    if (!pixelesObjetivo) return;
    soltarSalida();
    ctrl = new AbortController();
    $('mos-generar').disabled = true;
    $('mos-parar').disabled = false;
    $('mos-salida').hidden = true;

    try {
      if (!tilesLab) {
        di('Pasando las portadas a LAB…');
        await new Promise(r => setTimeout(r, 0));   // deja pintar el aviso
        tilesLab = tilesALab(reg.datos, nTiles);
      }
      const tLab = performance.now();

      const { cols, filas } = grillaPara(pixelesObjetivo.ancho, pixelesObjetivo.alto, ladoLargo);
      const objetivo = rejillaDelObjetivo(pixelesObjetivo.rgba, pixelesObjetivo.ancho, pixelesObjetivo.alto, cols, filas);
      const tObj = performance.now();

      di(`Buscando la portada de cada celda (${fmtN(cols * filas)} celdas × ${fmtN(nTiles)} portadas)…`);
      await new Promise(r => setTimeout(r, 0));
      const { indice, de } = emparejar({
        objetivo, tilesLab, nTiles, penalUsoDE: variedad, signal: ctrl.signal,
        onProgress: (hechas, total) => { if (hechas % (cols * 8) === 0) di(`Emparejando… ${Math.round((100 * hechas) / total)} %`); },
      });
      if (ctrl.signal.aborted) { di('Detenido.'); return; }
      const tEmp = performance.now();

      // Un canvas del tamaño final. Los límites de Chrome quedan lejos:
      // dimensión máxima 16.384 px y ~268 MP de área; 120 celdas de lado largo
      // con una imagen 3:4 son 7.680×10.240 = 78,6 MP.
      const ancho = cols * LADO_CELDA, alto = filas * LADO_CELDA;
      const canvas = document.createElement('canvas');
      canvas.width = ancho; canvas.height = alto;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error(`El navegador no ha podido crear un lienzo de ${fmtN(ancho)}×${fmtN(alto)} px.`);

      const { porPortada, bitmaps, portadas, fallidas, bytes } = await bajarPortadas({
        indice, urlDeTile: (idx) => urlDe(reg, idx), signal: ctrl.signal,
        onProgress: (hechas, total) => di(`Bajando portadas… ${fmtN(hechas)} de ${fmtN(total)}`),
      });
      if (ctrl.signal.aborted) { soltarBitmaps(bitmaps); canvas.width = canvas.height = 0; di('Detenido.'); return; }
      const tRed = performance.now();

      ultimo = { canvas, ctx, cols, filas, indice, de, bitmaps, porPortada, portadas, ancho, alto, fallidas, bytes, ms: { lab: tLab - t0, obj: tObj - tLab, emp: tEmp - tObj, red: tRed - tEmp } };
      pintar();
      const tFin = performance.now();
      ultimo.ms.pintar = tFin - tRed;
      ultimo.ms.total = tFin - t0;

      const r = resumenDeEmparejado({ indice, de, cols, filas });
      $('mos-salida').hidden = false;
      $('mos-resumen').textContent = `${fmtN(cols)}×${fmtN(filas)} celdas · ${fmtN(ancho)}×${fmtN(alto)} px`
        + ` · ${fmtN(r.distintas)} portadas distintas, la más repetida ${fmtN(r.masRepetida)} veces`
        + ` · ${fmt1(r.distintasPorVentana)} distintas por cada ${fmt1(r.celdasPorVentana)} celdas vecinas`
        + ` · parecido medio ΔE ${fmt1(r.deMedio)}`
        + (fallidas ? ` · ${fmtN(fallidas)} portadas no han cargado` : '')
        + ` · ${fmt1(ultimo.ms.total / 1000)} s`;
      di(`Listo en ${fmt1(ultimo.ms.total / 1000)} s`
        + ` (LAB ${Math.round(ultimo.ms.lab)} ms · rejilla del objetivo ${Math.round(ultimo.ms.obj)} ms`
        + ` · emparejado ${Math.round(ultimo.ms.emp)} ms · portadas ${fmt1(ultimo.ms.red / 1000)} s · dibujo ${Math.round(ultimo.ms.pintar)} ms).`);
      console.log('[mosaico]', { cols, filas, ancho, alto, ...r, ms: ultimo.ms, bytes });
    } catch (err) {
      console.error('[mosaico]', err);
      di('');
      showToast(`No he podido generar el mosaico: ${err.message}`, 'error');
    } finally {
      ctrl = null;
      $('mos-parar').disabled = true;
      $('mos-generar').disabled = !pixelesObjetivo;
    }
  }

  /** Dibuja las portadas y el tinte encima. Sin red: usa los bitmaps guardados. */
  function pintar() {
    const { ctx, cols, filas, porPortada, bitmaps, de, ancho, alto } = ultimo;
    pintarMosaico({
      ctx, cols, filas, ladoCelda: LADO_CELDA, porPortada, bitmaps,
      fuenteTinte: lienzoLectura,
      alfa: mapaDeTinte({ de, cols, filas, escala: tinte / 100, modo }),
      plano: modo === 'plano',
      fondo: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#0A0A0F',
    });

    const caja = document.getElementById('mos-lienzo');
    if (caja && caja.firstElementChild !== ultimo.canvas) {
      const cien = document.getElementById('mos-cien')?.checked;
      caja.innerHTML = '';
      ultimo.canvas.style.display = 'block';
      aplicarZoom(cien);
      caja.appendChild(ultimo.canvas);
    }
  }

  // Mover el deslizador solo repinta: ni red, ni emparejado. El `input` de un
  // `range` dispara por píxel movido, así que se juntan los disparos seguidos.
  //
  // ⚠️ **`setTimeout` y NO `requestAnimationFrame`**, que es la misma regla que
  // ya tiene escrita `covers-wallpaper.js` y que este archivo se saltó en v=250:
  // en una pestaña oculta Chrome no dispara los rAF, así que el repintado no
  // llegaba nunca. Medido en producción el 27/09 con la pestaña de la extensión
  // (que corre oculta): el píxel del mosaico daba el mismo valor con el tinte a
  // 0, a 45 y a 100. Se ve solo en una pestaña de fondo, o sea justo donde no
  // hay nadie mirando para notarlo.
  let pendiente = 0;
  function repintarTinte() {
    if (!ultimo) return;
    clearTimeout(pendiente);
    pendiente = setTimeout(() => { if (ultimo) pintar(); }, 16);
  }

  $('mos-generar').addEventListener('click', componer);
  $('mos-parar').addEventListener('click', () => { ctrl?.abort(); $('mos-parar').disabled = true; });

  $('mos-descargar').addEventListener('click', async () => {
    if (!ultimo) return;
    const btn = $('mos-descargar');
    btn.disabled = true;
    try {
      const blob = await new Promise(res => ultimo.canvas.toBlob(res, 'image/jpeg', 0.92));
      if (!blob) throw new Error('el navegador no ha podido generar el archivo');
      const nombre = `fonoteca-mosaico-${ultimo.ancho}x${ultimo.alto}-tinte${tinte}.jpg`;
      descargarBlob(blob, nombre);
      showToast(`${nombre} — ${fmtN(ultimo.ancho)}×${fmtN(ultimo.alto)} px, ${fmtMB(blob.size)} MB`, 'success');
    } catch (err) {
      showToast(`No he podido preparar la descarga: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // Irse de la vista aborta lo que haya en curso y suelta la memoria: el canvas
  // final, los bitmaps de las portadas y la imagen del usuario.
  return () => {
    ctrl?.abort();
    clearTimeout(pendiente);
    soltarSalida();
    bitmapObjetivo?.close?.();
    bitmapObjetivo = null;
    if (lienzoLectura) { lienzoLectura.width = lienzoLectura.height = 0; lienzoLectura = null; }
    pixelesObjetivo = null;
    tilesLab = null;
  };
}
