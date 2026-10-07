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

import { pageHeader, escapeHtml } from '../ui/components.js?v=278';
import { showToast } from '../ui/toast.js?v=278';
import { generacionActual, rutaVigente } from '../router.js?v=278';
import { descargarBlob } from './covers-wallpaper.js?v=278';
import { bajarPortadas, soltarBitmaps, pintarMosaico } from './mosaico-lienzo.js?v=278';
import { leerColores, urlDe } from './mosaico-colores.js?v=278';
import {
  salidaPara, rejillaDelObjetivo, tilesALab, emparejarCediendo, mapaDeTinte, resumenDeEmparejado,
  podarGaleria, TOPE_GUARDADOS, TOPE_BYTES_GUARDADOS,
} from '../util/mosaico.js?v=278';

// Tamaños de grilla que ofrece la vista: celdas del lado MÁS LARGO de la
// imagen. 80 da las 60×80 que pidió Ian con una imagen 3:4.
//
// ⚠️ **El lado de cada celda NO es fijo**: lo da `ladoDeCelda()`, que topa el
// largo del lienzo en 7.680 px (ver su comentario en `util/mosaico.js`). De 120
// en adelante las tres rejillas dan el MISMO lienzo de 5.760×7.680 px con una
// imagen 3:4, y lo único que crece es de cuántas portadas está hecha. Por eso
// las dos finas nuevas no suben el techo de memoria del lienzo: lo que suben es
// el tiempo del emparejado, que es lineal en celdas.
//
// Los números de la ayuda son para una imagen 3:4 y la base de 5.715 portadas;
// con otra proporción cambian y la línea de estado dice los de verdad.
//
// ⚠️ **La etiqueta del botón NO lleva el número**, y es por el ancho: la caja del
// grupo mide 294 px en la pantalla de Ian (1.356 px de `main`, medido el 01/10) y
// cinco veces «Gruesa · 60» no entra — la barra se partiría en dos filas, que es
// exactamente el freno que paró la tanda de ocultar artistas. El número exacto
// vive en el `title`, y la rejilla de verdad en la línea de estado.
const GRILLAS = [
  { n: 60, etiqueta: 'Gruesa', ayuda: '45×60 = 2.700 celdas de 64 px. La más rápida.' },
  { n: 80, etiqueta: 'Normal', ayuda: '60×80 = 4.800 celdas de 64 px.' },
  { n: 120, etiqueta: 'Fina', ayuda: '90×120 = 10.800 celdas de 64 px. Desde aquí el lienzo ya no crece: 5.760×7.680 px.' },
  { n: 160, etiqueta: 'Muy fina', ayuda: '120×160 = 19.200 celdas de 48 px. El mismo lienzo que «Fina» hecho con un 78 % más de portadas; tarda casi el doble.' },
  { n: 240, etiqueta: 'Finísima', ayuda: '180×240 = 43.200 celdas de 32 px. El mismo lienzo con CUATRO veces más portadas; puede tardar un minuto. Se puede detener.' },
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

// La calidad del JPEG, la misma con la que se descarga y con la que se guarda en
// la galería: lo que Ian ve guardado es byte por byte lo que se va a descargar.
const CALIDAD_JPEG = 0.92;

// El lado largo de la miniatura de cada resultado guardado. 768 px porque la
// tarjeta mide ~260 px y una pantalla puede tener el doble de densidad; medido
// el 06/10, la miniatura de un mosaico de Fina pesa **146 KB** a este lado (21
// KB a 320, 54 KB a 480). Al margen, diez de estas en `<img>` costaron +31 MB de
// RSS: es lo barato de la galería, y lo que pesa son los JPEG enteros.
const LADO_MINIATURA = 768;

// Píxeles mínimos del objetivo por celda y por lado. Es el mismo 3 que exige
// `rejillaDelObjetivo` (su rejilla interna es 3×3); se comprueba ANTES de
// generar para poder decirlo en la línea de estado en vez de tirar al final.
const PX_MINIMOS_POR_CELDA = 3;

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
              ${GRILLAS.map(g => `<button type="button" class="${g.n === GRILLA_DEFECTO ? 'is-on' : ''}" aria-pressed="${g.n === GRILLA_DEFECTO}" data-grilla="${g.n}" title="${escapeHtml(`${g.n} celdas en el lado largo. ${g.ayuda}`)}">${g.etiqueta}</button>`).join('')}
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
        <button class="btn btn-secondary" id="mos-guardar" title="Deja una copia de este mosaico en «Los que ya has hecho», sin volver a generarlo. Sirve para comparar dos tintes del mismo emparejado.">Guardar esta</button>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px">
          <input type="checkbox" id="mos-cien"> Ver al 100 %
        </label>
        <span id="mos-resumen" style="font-size:12px;color:var(--color-text-secondary)"></span>
      </div>
      <div id="mos-lienzo" style="overflow:auto;max-height:78vh;background:var(--color-bg);border-radius:var(--radius-md)"></div>
    </div>
    <div class="card" id="mos-galeria" hidden style="margin-top:20px">
      <h2 style="margin:0 0 4px;font-size:16px">Los que ya has hecho <span id="mos-galeria-n" class="mos-valor"></span></h2>
      <p style="margin:0 0 14px;color:var(--color-text-secondary);font-size:13px">
        Cada vez que generas uno, el anterior se guarda aquí con su imagen y sus ajustes, y lo puedes descargar.
        Se quedan los <strong>${TOPE_GUARDADOS}</strong> últimos (o ${Math.round(TOPE_BYTES_GUARDADOS / 1e6)} MB, lo que llegue primero)
        y <strong>mientras no salgas de esta vista</strong>: no se guardan en el disco.
      </p>
      <ul class="mos-galeria" id="mos-galeria-lista"></ul>
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
  let nombreImagen = '';        // el nombre del archivo que subió Ian
  // Los mosaicos ya hechos, del más NUEVO al más viejo. Cada uno es su JPEG
  // (`blob`), la miniatura que se ve (`url`, un object URL) y su ficha. Ningún
  // lienzo y ningún bitmap: ver `TOPE_GUARDADOS` en `util/mosaico.js`.
  const guardados = [];
  let proximoId = 1;

  const soltarSalida = () => {
    if (!ultimo) return;
    soltarBitmaps(ultimo.bitmaps);
    // Soltar la referencia no alcanza: el backing store del canvas (78 MB con
    // 60×80 celdas de 64 px, 177 MB con 90×120) sigue vivo hasta que el canvas
    // mide 0×0.
    ultimo.canvas.width = ultimo.canvas.height = 0;
    ultimo = null;
  };

  // ── La galería: congelar, podar, pintar ───────────────────────────────────
  //
  // Congelar es pasar un resultado de VIVO (lienzo + bitmaps: 57 a 226 MB según
  // la rejilla) a GUARDADO (su JPEG y una miniatura: 4 a 16 MB). El factor es 14,
  // y es lo que hace que se puedan acumular varios. Las dos cifras están medidas
  // y la tabla está en `util/mosaico.js`, al lado de los topes que salen de ella.

  // La firma de un resultado: imagen y ajustes. Se guarda en la ficha para que
  // «Guardar esta» y el congelado automático de «Generar» no dejen el mismo
  // mosaico dos veces en la galería. Se mira la LISTA y no una variable aparte:
  // así quitar una tarjeta a mano vuelve a habilitar su firma sin código extra.
  const firmaDe = (u) => `${nombreImagen}|${u.ladoLargo}|${u.variedad}|${u.tinte}|${u.modo}`;
  const yaGuardado = (u) => guardados.some(g => g.firma === firmaDe(u));

  /** El nombre del archivo que se descarga. Lleva de qué imagen salió y con qué ajustes. */
  function nombreDescarga(f) {
    const base = (f.nombreImagen || 'mosaico').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase();
    const et = GRILLAS.find(g => g.n === f.ladoLargo)?.etiqueta.toLowerCase().replace(/\s+/g, '') || f.ladoLargo;
    const ev = VARIEDADES.find(v => v.n === f.variedad)?.etiqueta.toLowerCase() || f.variedad;
    return `fonoteca-mosaico-${base || 'imagen'}-${et}-${ev}-tinte${f.tinte}-${f.ancho}x${f.alto}.jpg`;
  }

  /** La miniatura de un lienzo, como blob. Reduce con suavizado: es una foto, no un recorte. */
  async function miniaturaDe(canvas, lado) {
    const k = Math.min(1, lado / Math.max(canvas.width, canvas.height));
    const m = document.createElement('canvas');
    m.width = Math.max(1, Math.round(canvas.width * k));
    m.height = Math.max(1, Math.round(canvas.height * k));
    const cx = m.getContext('2d', { alpha: false });
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    cx.drawImage(canvas, 0, 0, m.width, m.height);
    const blob = await new Promise(r => m.toBlob(r, 'image/jpeg', 0.85));
    const salida = blob ? { blob, ancho: m.width, alto: m.height } : null;
    // El lienzo de la miniatura también tiene backing store: a 0×0 antes de salir.
    m.width = m.height = 0;
    return salida;
  }

  /**
   * Pasa `ultimo` a la galería. No lo destruye: el que llama decide si además lo
   * suelta (al generar otro) o lo deja vivo («Guardar esta»).
   */
  async function congelarUltimo() {
    if (!ultimo || yaGuardado(ultimo)) return false;
    const antes = estado.textContent;
    di('Guardando este mosaico…');
    try {
      const blob = await new Promise(r => ultimo.canvas.toBlob(r, 'image/jpeg', CALIDAD_JPEG));
      if (!blob) throw new Error('el navegador no ha podido generar el JPEG');
      const mini = await miniaturaDe(ultimo.canvas, LADO_MINIATURA);
      const ficha = {
        id: proximoId++, nombreImagen,
        ladoLargo: ultimo.ladoLargo, variedad: ultimo.variedad, tinte: ultimo.tinte, modo: ultimo.modo,
        cols: ultimo.cols, filas: ultimo.filas, ancho: ultimo.ancho, alto: ultimo.alto, lado: ultimo.lado,
        distintas: ultimo.distintas, deMedio: ultimo.deMedio, cuando: Date.now(),
      };
      guardados.unshift({ ...ficha, firma: firmaDe(ultimo), blob, bytes: blob.size, nombre: nombreDescarga(ficha), mini });
      podar();
      pintarGaleria();
      di(antes);
      return true;
    } catch (err) {
      di(antes);
      showToast(`No he podido guardar este mosaico: ${err.message}`, 'error');
      return false;
    }
  }

  /** Aplica los topes y suelta de verdad lo que se tira (los object URL no se liberan solos). */
  function podar() {
    const { quedan, tirados } = podarGaleria(guardados);
    if (!tirados.length) return;
    for (const t of tirados) if (t.url) URL.revokeObjectURL(t.url);
    guardados.length = 0;
    guardados.push(...quedan);
  }

  function pintarGaleria() {
    const caja = $('mos-galeria');
    const lista = $('mos-galeria-lista');
    if (!caja || !lista) return;
    caja.hidden = guardados.length === 0;
    const bytes = guardados.reduce((a, g) => a + g.bytes, 0);
    $('mos-galeria-n').textContent = guardados.length ? `${fmtN(guardados.length)} · ${fmtMB(bytes)} MB` : '';
    lista.innerHTML = guardados.map(g => {
      // El object URL se crea aquí, una vez por resultado, y se guarda en la
      // ficha: crearlo en cada repintado dejaría uno colgado por repintado.
      if (!g.url && g.mini) g.url = URL.createObjectURL(g.mini.blob);
      const et = GRILLAS.find(x => x.n === g.ladoLargo)?.etiqueta || g.ladoLargo;
      const ev = VARIEDADES.find(x => x.n === g.variedad)?.etiqueta || g.variedad;
      return `<li class="mos-tarjeta">
        <img class="mos-tarjeta-img" src="${g.url}" width="${g.mini?.ancho || ''}" height="${g.mini?.alto || ''}" alt="${escapeHtml(`Mosaico de ${g.nombreImagen}, rejilla ${et}, variedad ${ev}`)}" loading="lazy">
        <p class="mos-tarjeta-n" title="${escapeHtml(g.nombreImagen)}">${escapeHtml(g.nombreImagen)}</p>
        <p class="mos-tarjeta-d">${escapeHtml(et)} · ${escapeHtml(String(ev))} · tinte ${g.tinte} % ${g.modo === 'plano' ? 'plano' : 'adaptativo'}</p>
        <p class="mos-tarjeta-d">${fmtN(g.cols)}×${fmtN(g.filas)} celdas de ${g.lado} px · ${fmtN(g.ancho)}×${fmtN(g.alto)} px</p>
        <p class="mos-tarjeta-d">${fmtN(g.distintas)} portadas distintas · ΔE ${fmt1(g.deMedio)} · ${fmtMB(g.bytes)} MB</p>
        <div class="mos-tarjeta-acciones">
          <button type="button" class="btn btn-secondary" data-bajar="${g.id}">Descargar</button>
          <button type="button" class="mos-quitar" data-quitar="${g.id}" title="Quitar este de la lista y soltar su memoria">Quitar</button>
        </div>
      </li>`;
    }).join('');
  }

  // Un solo escuchador para toda la galería: las tarjetas se redibujan enteras en
  // cada cambio, así que colgarle escuchadores a cada botón los multiplicaría.
  $('mos-galeria-lista').addEventListener('click', (e) => {
    const bajar = e.target.closest('[data-bajar]');
    if (bajar) {
      const g = guardados.find(x => x.id === Number(bajar.dataset.bajar));
      if (!g) return;
      descargarBlob(g.blob, g.nombre);
      showToast(`${g.nombre} — ${fmtN(g.ancho)}×${fmtN(g.alto)} px, ${fmtMB(g.bytes)} MB`, 'success');
      return;
    }
    const quitar = e.target.closest('[data-quitar]');
    if (!quitar) return;
    const i = guardados.findIndex(x => x.id === Number(quitar.dataset.quitar));
    if (i < 0) return;
    if (guardados[i].url) URL.revokeObjectURL(guardados[i].url);
    guardados.splice(i, 1);
    pintarGaleria();
  });

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
    nombreImagen = file.name;
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
      decirLaRejilla(`Imagen de ${fmtN(w0)}×${fmtN(h0)} px${k < 1 ? ` (leída a ${fmtN(w)}×${fmtN(h)})` : ''} · `);
    } catch (err) {
      pixelesObjetivo = null;
      nombreImagen = '';
      lugar.textContent = 'Ninguna imagen elegida';
      lugar.title = '';
      lugar.classList.remove('is-set');
      di('');
      showToast(`No he podido leer la imagen: ${err.message}`, 'error');
    }
  });

  // ── Controles ─────────────────────────────────────────────────────────────
  /**
   * La línea de estado con lo que va a salir, y el único sitio que decide si
   * «Generar» se puede pulsar.
   *
   * ⚠️ **Avisa ANTES si la imagen es demasiado chica para la rejilla.** Las dos
   * rejillas nuevas lo hacen posible de verdad: con 240 celdas de lado largo
   * `rejillaDelObjetivo` exige 720 px de lado largo en la imagen, y una foto de
   * 600 px tiraba recién al final de «Generar», con un toast rojo y después de
   * haber hecho LAB. Decirlo en la línea de estado cuesta una resta.
   */
  function decirLaRejilla(prefijo = '') {
    if (!pixelesObjetivo) return;
    const { ancho: w, alto: h } = pixelesObjetivo;
    const sal = salidaPara(w, h, ladoLargo);
    const pxPorCelda = Math.min(Math.floor(w / sal.cols), Math.floor(h / sal.filas));
    const cabe = pxPorCelda >= PX_MINIMOS_POR_CELDA;
    $('mos-generar').disabled = !cabe;
    if (!cabe) {
      di(`${prefijo}Esta imagen es demasiado chica para la rejilla «${GRILLAS.find(g => g.n === ladoLargo)?.etiqueta}»:`
        + ` ${fmtN(sal.cols)}×${fmtN(sal.filas)} celdas le dejan ${pxPorCelda} px por celda y hacen falta ${PX_MINIMOS_POR_CELDA}.`
        + ` Elige una rejilla más gruesa o una imagen más grande.`);
      return;
    }
    di(`${prefijo}rejilla ${fmtN(sal.cols)}×${fmtN(sal.filas)} = ${fmtN(sal.celdas)} celdas de ${sal.lado} px`
      + ` → ${fmtN(sal.ancho)}×${fmtN(sal.alto)} px${prefijo ? '' : '. Pulsa «Generar».'}`);
  }

  container.querySelectorAll('[data-grilla]').forEach(btn => {
    btn.addEventListener('click', () => {
      ladoLargo = Number(btn.dataset.grilla);
      marcar('data-grilla', btn);
      decirLaRejilla();
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
    // El que había NO se pierde: se congela a JPEG + miniatura y queda en la
    // galería. Es el bug que abre esta tanda: Ian generaba uno, subía otra
    // imagen, y el primero desaparecía sin dejar nada.
    await congelarUltimo();
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

      const { cols, filas, lado, ancho, alto } = salidaPara(pixelesObjetivo.ancho, pixelesObjetivo.alto, ladoLargo);
      const objetivo = rejillaDelObjetivo(pixelesObjetivo.rgba, pixelesObjetivo.ancho, pixelesObjetivo.alto, cols, filas);
      const tObj = performance.now();

      di(`Buscando la portada de cada celda (${fmtN(cols * filas)} celdas × ${fmtN(nTiles)} portadas)…`);
      // ⚠️ **`emparejarCediendo` y no `emparejar`**: con 43.200 celdas el
      // emparejado es del orden del minuto, y el síncrono lo hace sin devolver el
      // hilo ni una vez — el texto de progreso no se pinta y el clic en «Detener»
      // se queda en la cola hasta que termina, o sea que no detiene nada. El
      // porqué entero está en su comentario, en `util/mosaico.js`.
      const { indice, de } = await emparejarCediendo({
        objetivo, tilesLab, nTiles, penalUsoDE: variedad, signal: ctrl.signal,
        onProgress: (hechas, total) => di(`Emparejando… ${Math.round((100 * hechas) / total)} % (${fmtN(hechas)} de ${fmtN(total)} celdas)`),
      });
      if (ctrl.signal.aborted) { di('Detenido.'); return; }
      const tEmp = performance.now();

      // Un canvas del tamaño final. Los límites de Chrome quedan lejos porque
      // `ladoDeCelda()` topa el largo en 7.680 px: con una imagen 3:4 el peor
      // caso son 5.760×7.680 = 44,2 MP, contra una dimensión máxima de 16.384 px
      // y ~268 MP de área. Sin ese tope, 240 celdas de lado largo a 64 px serían
      // 11.520×15.360 = 177 MP y 708 MB de backing store.
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

      const r = resumenDeEmparejado({ indice, de, cols, filas });
      // `ladoLargo`, `variedad`, `tinte` y `modo` se copian AQUÍ, en el resultado:
      // los cuatro controles se pueden mover después de generar sin volver a
      // generar, y la ficha que va a la galería tiene que decir con qué ajustes
      // se hizo ESTE mosaico, no cómo están los botones ahora. (El tinte y el
      // reparto los actualiza `pintar()`, que es quien de verdad los aplica.)
      ultimo = {
        canvas, ctx, cols, filas, lado, indice, de, bitmaps, porPortada, portadas, ancho, alto, fallidas, bytes,
        ladoLargo, variedad, tinte, modo, distintas: r.distintas, deMedio: r.deMedio,
        ms: { lab: tLab - t0, obj: tObj - tLab, emp: tEmp - tObj, red: tRed - tEmp },
      };
      pintar();
      const tFin = performance.now();
      ultimo.ms.pintar = tFin - tRed;
      ultimo.ms.total = tFin - t0;

      $('mos-salida').hidden = false;
      $('mos-resumen').textContent = `${fmtN(cols)}×${fmtN(filas)} celdas de ${lado} px · ${fmtN(ancho)}×${fmtN(alto)} px`
        + ` · ${fmtN(r.distintas)} portadas distintas, la más repetida ${fmtN(r.masRepetida)} veces`
        + ` · ${fmt1(r.distintasPorVentana)} distintas por cada ${fmt1(r.celdasPorVentana)} celdas vecinas`
        + ` · parecido medio ΔE ${fmt1(r.deMedio)}`
        + (fallidas ? ` · ${fmtN(fallidas)} portadas no han cargado` : '')
        + ` · ${fmt1(ultimo.ms.total / 1000)} s`;
      di(`Listo en ${fmt1(ultimo.ms.total / 1000)} s`
        + ` (LAB ${Math.round(ultimo.ms.lab)} ms · rejilla del objetivo ${Math.round(ultimo.ms.obj)} ms`
        + ` · emparejado ${Math.round(ultimo.ms.emp)} ms · portadas ${fmt1(ultimo.ms.red / 1000)} s · dibujo ${Math.round(ultimo.ms.pintar)} ms).`);
      console.log('[mosaico]', { cols, filas, lado, ancho, alto, ...r, ms: ultimo.ms, bytes });
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
    const { ctx, cols, filas, lado, porPortada, bitmaps, de } = ultimo;
    // El tinte y el reparto de ESTE lienzo son los que se están aplicando ahora:
    // el deslizador repinta sin regenerar, así que la verdad de lo que se ve
    // (y de lo que se va a guardar en la galería) se anota acá.
    ultimo.tinte = tinte; ultimo.modo = modo;
    pintarMosaico({
      ctx, cols, filas, ladoCelda: lado, porPortada, bitmaps,
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
      // Se genera de nuevo y no se reusa el de la galería: el deslizador del
      // tinte pudo moverse después de guardarlo, y lo que se descarga tiene que
      // ser lo que está en pantalla.
      const blob = await new Promise(res => ultimo.canvas.toBlob(res, 'image/jpeg', CALIDAD_JPEG));
      if (!blob) throw new Error('el navegador no ha podido generar el archivo');
      const nombre = nombreDescarga({ ...ultimo, nombreImagen });
      descargarBlob(blob, nombre);
      showToast(`${nombre} — ${fmtN(ultimo.ancho)}×${fmtN(ultimo.alto)} px, ${fmtMB(blob.size)} MB`, 'success');
    } catch (err) {
      showToast(`No he podido preparar la descarga: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // «Guardar esta»: congela una copia del que está vivo SIN destruirlo. Es lo que
  // permite comparar dos tintes del mismo emparejado, que es la comparación más
  // barata que hay (el deslizador solo repinta) y la que de otra forma obligaría
  // a pagar el emparejado entero otra vez — hasta un minuto en la rejilla más fina.
  $('mos-guardar').addEventListener('click', async () => {
    const btn = $('mos-guardar');
    if (!ultimo) return;
    btn.disabled = true;
    try {
      if (await congelarUltimo()) showToast(`Guardado. Son ${fmtN(guardados.length)} de ${TOPE_GUARDADOS}.`, 'success');
      else showToast('Este mosaico, con estos ajustes, ya está guardado.', 'info');
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
    // La galería: los object URL NO se liberan solos, y cada uno retiene su blob.
    // Los JPEG enteros (hasta 16 MB cada uno) se van con el array.
    for (const g of guardados) if (g.url) URL.revokeObjectURL(g.url);
    guardados.length = 0;
    bitmapObjetivo?.close?.();
    bitmapObjetivo = null;
    if (lienzoLectura) { lienzoLectura.width = lienzoLectura.height = 0; lienzoLectura = null; }
    pixelesObjetivo = null;
    tilesLab = null;
  };
}
