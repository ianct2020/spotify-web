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

import { pageHeader, escapeHtml } from '../ui/components.js?v=267';
import { showToast } from '../ui/toast.js?v=267';
import { generacionActual, rutaVigente } from '../router.js?v=267';
import { descargarBlob } from './covers-wallpaper.js?v=267';
import { bajarPortadas, soltarBitmaps, pintarMosaico } from './mosaico-lienzo.js?v=267';
import { leerColores, urlDe } from './mosaico-colores.js?v=267';
import {
  grillaPara, rejillaDelObjetivo, tilesALab, emparejar, mapaDeTinte, resumenDeEmparejado,
} from '../util/mosaico.js?v=267';

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
// El defecto es «Variada» (6) desde v=265. Medido el 28/09 sobre la imagen de
// prueba: con «Normal» (3) quedaba una trama de damero (1,8 % de celdas con su
// misma portada a la vista) y con «Variada» desaparece (0 %), a cambio de más
// tinte medio (26 % → 40 %): el tinte adaptativo recompra lo que pierde el
// parecido. Decisión de Ian; la curva entera sigue en `PENAL_USO_DE`.
const VARIEDAD_DEFECTO = 6;

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
        <div class="mos-accion">
          <input type="file" id="mos-file" accept="image/*" hidden>
          <button type="button" class="btn btn-secondary" id="mos-elegir">Elegir imagen…</button>
          <span class="mos-archivo" id="mos-archivo">Ninguna imagen elegida</span>
          <span class="mos-acciones">
            <button class="btn btn-primary" id="mos-generar" disabled>Generar</button>
            <button class="btn btn-secondary" id="mos-parar" disabled>Detener</button>
          </span>
        </div>
        <div class="mos-ajustes">
          <section class="mos-grupo" aria-labelledby="mos-t-grilla">
            <h3 class="mos-grupo-t" id="mos-t-grilla">Tamaño de la rejilla</h3>
            <div class="mos-seg" role="group" aria-labelledby="mos-t-grilla">
              ${GRILLAS.map(g => `<button type="button" class="${g.n === GRILLA_DEFECTO ? 'is-on' : ''}" aria-pressed="${g.n === GRILLA_DEFECTO}" data-grilla="${g.n}">${g.etiqueta} · ${g.n}</button>`).join('')}
            </div>
          </section>
          <section class="mos-grupo" aria-labelledby="mos-t-tinte">
            <h3 class="mos-grupo-t" id="mos-t-tinte">Tinte del color original <output class="mos-valor" id="mos-tinte-val" for="mos-tinte">${TINTE_DEFECTO} %</output></h3>
            <input type="range" id="mos-tinte" class="mos-rango" min="0" max="100" step="5" value="${TINTE_DEFECTO}" style="--p:${TINTE_DEFECTO}%" aria-labelledby="mos-t-tinte">
            <div class="mos-escala" aria-hidden="true"><span>0 % · sin tinte</span><span>100 % · color de tu imagen</span></div>
          </section>
          <section class="mos-grupo" aria-labelledby="mos-t-variedad">
            <h3 class="mos-grupo-t" id="mos-t-variedad">Variedad de portadas</h3>
            <div class="mos-seg" role="group" aria-labelledby="mos-t-variedad">
              ${VARIEDADES.map(v => `<button type="button" class="${v.n === VARIEDAD_DEFECTO ? 'is-on' : ''}" aria-pressed="${v.n === VARIEDAD_DEFECTO}" data-variedad="${v.n}" title="${escapeHtml(v.ayuda)}">${v.etiqueta}</button>`).join('')}
            </div>
          </section>
          <section class="mos-grupo" aria-labelledby="mos-t-modo">
            <h3 class="mos-grupo-t" id="mos-t-modo">Reparto del tinte</h3>
            <div class="mos-seg" role="group" aria-labelledby="mos-t-modo">
              <button type="button" class="is-on" aria-pressed="true" data-modo="adaptativo" title="Más tinte donde la portada se parece poco al color que tocaba, y nada donde se parece mucho.">Adaptativo</button>
              <button type="button" aria-pressed="false" data-modo="plano" title="El mismo tinte en todas las celdas.">Plano</button>
            </div>
          </section>
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
  // Un grupo de botones es un grupo de opciones EXCLUSIVAS: se marca una y se
  // desmarcan las otras, con la clase que pinta `main.css` y con `aria-pressed`,
  // que es lo que lee un lector de pantalla (la clase sola no dice nada).
  const marcar = (attr, btn) => container.querySelectorAll(`[${attr}]`).forEach(b => {
    b.classList.toggle('is-on', b === btn);
    b.setAttribute('aria-pressed', String(b === btn));
  });
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
  // El `<input type=file>` nativo va escondido (sigue siendo el que recibe el
  // archivo y el que dispara `change`) y este botón le hace `click()`. El nombre
  // se enseña ENTERO: el nativo lo recorta con «…» y con 40 caracteres ya no se
  // sabía qué imagen estaba elegida.
  $('mos-elegir').addEventListener('click', () => $('mos-file').click());
  $('mos-file').addEventListener('change', async (e) => {
    const file = e.currentTarget.files?.[0];
    if (!file) return;
    const lugar = $('mos-archivo');
    lugar.textContent = file.name;
    lugar.title = file.name;
    lugar.classList.add('is-set');
    $('mos-generar').disabled = true;
    di('Leyendo la imagen…');
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
      di(`Imagen de ${fmtN(w0)}×${fmtN(h0)} px${k < 1 ? ` (leída a ${fmtN(w)}×${fmtN(h)})` : ''} · rejilla ${g.cols}×${g.filas} = ${fmtN(g.cols * g.filas)} celdas → ${fmtN(g.cols * LADO_CELDA)}×${fmtN(g.filas * LADO_CELDA)} px`);
      $('mos-generar').disabled = false;
    } catch (err) {
      pixelesObjetivo = null;
      lugar.textContent = 'Ninguna imagen elegida';
      lugar.title = '';
      lugar.classList.remove('is-set');
      di('');
      showToast(`No he podido leer la imagen: ${err.message}`, 'error');
    }
  });

  // ── Controles ─────────────────────────────────────────────────────────────
  container.querySelectorAll('[data-grilla]').forEach(btn => {
    btn.addEventListener('click', () => {
      ladoLargo = Number(btn.dataset.grilla);
      marcar('data-grilla', btn);
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
      marcar('data-variedad', btn);
      if (pixelesObjetivo) di(`Variedad «${VARIEDADES.find(v => v.n === variedad).etiqueta}». Pulsa «Generar».`);
    });
  });

  container.querySelectorAll('[data-modo]').forEach(btn => {
    btn.addEventListener('click', () => {
      modo = btn.dataset.modo;
      marcar('data-modo', btn);
      repintarTinte();
    });
  });

  const slider = $('mos-tinte');
  slider.addEventListener('input', () => {
    tinte = Number(slider.value);
    $('mos-tinte-val').textContent = `${tinte} %`;
    slider.style.setProperty('--p', `${tinte}%`);   // el tramo relleno de la pista
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
