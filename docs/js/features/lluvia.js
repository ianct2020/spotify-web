// `#lluvia` — cuando llueve (v=358, tanda 117).
//
// Tus minutos en los días de lluvia de Mar del Plata, contra los días sin lluvia. La cuenta es PURA
// y vive en `util/lluvia.js` (`tests/lluvia.test.mjs`); acá se cargan los datos y se pinta
// (`tests/banco/lluvia.html`). Ningún número se escribe a mano: salen de los dos JSON, al pintar.
//
// De dónde sale cada cosa:
//   · `loadDaysLocal()` (`history-data.js`, por `loadOne()`): `history-days-local.json`, los minutos
//     por día en hora de Mar del Plata. Es solo del owner: el import de un amigo no lo produce, y
//     la lluvia es de Mar del Plata.
//   · `leerLluvia()`, acá: `lluvia-mar-del-plata.json`, el dato de Open-Meteo de la tanda 116. No es
//     historial (es dato público), así que no pasa por el candado ni por IndexedDB. 🔴 Si falla, TIRA
//     el error crudo (v=154: un fallo no se disfraza de «no llovió nunca»).
//
// Abrir cuesta 1 `/me` (el de `loadOne()`) y 0 de todo lo demás: los dos JSON salen del propio Pages.
// 🔴 Después de cada `await` se pregunta por la vigencia de la ruta (v=195/v=329).
//
// ───────────────────────────────────────────────────────────────────────────
// QUÉ ESCUCHASTE ESE DÍA (v=368, tanda 131)
//
// Los días de «Los días más lluviosos» y de «Todos los días con lluvia» se tocan (un `<button>` en la
// celda de la fecha) y abren el panel del día: la fecha, «X mm · Y min» y las listas de artistas y temas.
//   · Los minutos de cada fila y de la cabecera salen de `history-days-local.json`, como siempre: el
//     detalle no se lee para pintar la lista.
//   · Las listas salen del detalle por día (`loadDays()`, PRIVADO, solo IndexedDB), que se lee la PRIMERA
//     vez que se toca un día y queda en memoria de la vista. Leerlo no pide nada a la red.
//   · 🔴 Se lee `diasLocal[iso]`, el día de Mar del Plata (`history-processor.js`, v=368), NUNCA
//     `dias[iso]`: ése es el día UTC, que va de las 21:00 del día anterior a las 21:00 de éste, y sus
//     minutos no cuadrarían con los que la misma pantalla dice para ese día. Un detalle cargado antes de
//     v=368 no tiene `diasLocal`, y el panel lo dice y ofrece volver a cargarlo.
//   · Las listas las arma `ui/dia-escuchado.js`, el MISMO módulo que el panel de `#calendario`: esta vista
//     no arma listas por su cuenta (`tests/lluvia-dia-detalle.test.mjs`).

import {
  loadDaysLocal, loadDays, isOwner, hasLocalHistory, identidadSinConfirmar, ownerLockedMessage, falloDeLecturaDelHistorial, avisoHistorialIlegibleHtml,
} from './history-data.js?v=371';
import { LLUVIA_VERSION } from '../history-keys.js?v=371';
import { escapeHtml, pageHeader } from '../ui/components.js?v=371';
import { openModal, closeModal } from '../ui/modal-stack.js?v=371';
import { armarDia, temasConVeces, listasDelDiaHtml, conectarListasDelDia } from '../ui/dia-escuchado.js?v=371';
import { importarSoloElDetalle } from './import-history.js?v=371';
import { fmtDia } from '../util/fecha.js?v=371';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=371';
import {
  validarLluvia, diasLocalesValidos, filasDeLaVentana, resumir, porAnio, masLluviosos, lineaVentana,
  lineaRecorte, lineaAnios, FRASE_NO_CAUSA, textoMinutos, textoMm, textoPct, trozosAtribucion,
  diasConLluvia, DE_A,
} from '../util/lluvia.js?v=371';

const num = (n) => Number(n).toLocaleString('es-ES');
const SIN_ARCHIVO = 'La lluvia se cruza con el historial que está guardado en la app, y el tuyo no lo está.';
const LLUVIA_CAIDA = 'No se ha podido leer la lluvia. Recarga la página para volver a intentarlo.';

async function leerLluvia() {
  const res = await fetch(new URL(`../../data/lluvia-mar-del-plata.json?v=${LLUVIA_VERSION}`, import.meta.url));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return validarLluvia(await res.json());
}

function tarjetaHtml(clave, titulo, g) {
  const dato = (nombre, numero, etiqueta) => `<div class="lluvia-dato" data-dato="${nombre}"><span class="lluvia-num">${numero}</span><span class="lluvia-et">${etiqueta}</span></div>`;
  return `<section class="lluvia-tarjeta" data-lluvia-tarjeta="${clave}">
    <h3 class="lluvia-tit">${titulo}</h3>
    <div class="lluvia-datos">
      ${dato('dias', num(g.dias), 'días')}
      ${dato('sono', num(g.conMusica), `días en los que sonó algo (${textoPct(g.pctD)})`)}
      ${dato('media', textoMinutos(g.mediaD), 'minutos por día, de media')}
      ${dato('mediana', textoMinutos(g.medianaD), 'minutos por día, de mediana')}
    </div>
  </section>`;
}

function tablaAniosHtml(filas) {
  return `<h3 class="lluvia-sec">Por año</h3>
    <div class="lluvia-tabla-marco"><table class="lluvia-tabla" data-lluvia-tabla="anios">
      <thead><tr><th scope="col">Año</th><th scope="col">Días con lluvia</th><th scope="col">Media con lluvia</th><th scope="col">Media sin lluvia</th></tr></thead>
      <tbody>${porAnio(filas).map((a) => `<tr><td>${a.anio}</td><td>${num(a.diasConLluvia)}</td><td>${textoMinutos(a.mediaConD)}</td><td>${textoMinutos(a.mediaSinD)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

/** Una fila de día de lluvia: la fecha es un botón que abre el panel del día (v=368). */
const filaDiaHtml = (f) => `<tr><td><button type="button" class="lluvia-dia-btn" data-lluvia-dia="${f.dia}" title="Qué escuchaste el ${escapeHtml(fmtDia(f.dia))}">${escapeHtml(fmtDia(f.dia))}</button></td><td>${textoMm(f.mmD)} mm</td><td>${textoMinutos(f.minD)} min</td></tr>`;

function tablaLluviososHtml(filas) {
  return `<h3 class="lluvia-sec">Los días más lluviosos</h3>
    <div class="lluvia-tabla-marco"><table class="lluvia-tabla" data-lluvia-tabla="lluviosos">
      <thead><tr><th scope="col">Día</th><th scope="col">Lluvia</th><th scope="col">Escuchaste</th></tr></thead>
      <tbody>${masLluviosos(filas).map(filaDiaHtml).join('')}</tbody>
    </table></div>`;
}

/** «Todos los días con lluvia» (v=368), de a `DE_A`. `cuantos` = cuántos se enseñan ahora. */
function todosHtml(lluviosos, cuantos) {
  const n = Math.min(cuantos, lluviosos.length);
  const quedan = lluviosos.length - n;
  return `<h3 class="lluvia-sec">Todos los días con lluvia</h3>
    <p class="lluvia-linea" data-lluvia-todos-n>${num(lluviosos.length)} días con 1 mm o más, del más nuevo al más viejo.</p>
    <div class="lluvia-tabla-marco"><table class="lluvia-tabla" data-lluvia-tabla="todos">
      <thead><tr><th scope="col">Día</th><th scope="col">Lluvia</th><th scope="col">Escuchaste</th></tr></thead>
      <tbody>${lluviosos.slice(0, n).map(filaDiaHtml).join('')}</tbody>
    </table></div>
    ${quedan > 0 ? `<button type="button" class="btn btn-secondary btn-sm lluvia-mas" data-lluvia-mas>Mostrar ${num(Math.min(DE_A, quedan))} más</button>` : ''}`;
}

function pieHtml(lluvia) {
  const credito = trozosAtribucion(lluvia.atribucion).map((t) => (t.href
    ? `<a href="${escapeHtml(t.href)}" target="_blank" rel="noopener">${escapeHtml(t.texto)}</a>`
    : escapeHtml(t.texto))).join('');
  return `<footer class="lluvia-pie">
    <p data-lluvia-pie="aviso">${escapeHtml(lluvia.aviso)}</p>
    <p data-lluvia-pie="credito">${credito}</p>
  </footer>`;
}

function vistaHtml(filas, lluvia, dias, lluviosos) {
  const { con, sin } = resumir(filas);
  const recorte = lineaRecorte(dias, lluvia);
  const anios = lineaAnios(porAnio(filas));
  return `<div class="lluvia" data-lluvia="lista">
    <p class="lluvia-linea" data-lluvia-linea>${escapeHtml(lineaVentana(filas))}</p>
    <p class="lluvia-linea" data-lluvia-recorte title="${escapeHtml(recorte.title)}">${escapeHtml(recorte.texto)}</p>
    <div class="lluvia-tarjetas">
      ${tarjetaHtml('con', 'Días con lluvia', con)}
      ${tarjetaHtml('sin', 'Días sin lluvia', sin)}
    </div>
    ${anios ? `<p class="lluvia-linea" data-lluvia-anios>${escapeHtml(anios)}</p>` : ''}
    <p class="lluvia-linea" data-lluvia-causa>${escapeHtml(FRASE_NO_CAUSA)}</p>
    ${tablaAniosHtml(filas)}
    ${tablaLluviososHtml(filas)}
    <section class="lluvia-todos" data-lluvia-todos>${todosHtml(lluviosos, DE_A)}</section>
    ${pieHtml(lluvia)}
  </div>`;
}

const notaHtml = (clave, texto) => `<p class="lluvia-linea" data-lluvia="${clave}">${escapeHtml(texto)}</p>`;

// ═══════════════════════════════════════════════════════════════════════════
// EL PANEL DEL DÍA (v=368)
// ═══════════════════════════════════════════════════════════════════════════

const TEXTO_NADA = 'Ese día no sonó nada.';
const TEXTO_SIN_DETALLE = 'Qué sonó cada día vive solo en tu navegador y todavía no está cargado.';
const TEXTO_VERSION_ANTERIOR = 'Tu detalle por día se cargó con una versión anterior de la app y no sabe separar los días a la hora de Mar del Plata. Vuelve a cargarlo desde tu export para verlo aquí.';
const TEXTO_SIN_DIA = 'El detalle cargado no tiene este día: vuelve a cargarlo desde tu export.';
const BOTON_CARGAR = '<button type="button" class="btn btn-primary btn-sm" data-lluvia-cargar>Cargar el detalle por día desde tu export</button>';
const parrafo = (t) => `<p class="lluvia-panel-texto">${escapeHtml(t)}</p>`;

/**
 * El panel de un día: `{ caso, html }`. `fila` es la de `filasDeLaVentana()` (`{ dia, mmD, minD }`) y
 * `detalle` el payload `days` (o `null`). Los casos, en este orden:
 *  · `nada`: el día tiene 0 min en `history-days-local.json`;
 *  · `sin-detalle`: no hay detalle cargado;
 *  · `version-anterior`: hay detalle, sin `diasLocal` (cargado antes de v=368). 🔴 NUNCA se enseña
 *    `dias[iso]`, que es el día UTC;
 *  · `sin-dia`: hay `diasLocal` y el día no está (o no tiene nada que enseñar);
 *  · `listas`: las listas de `ui/dia-escuchado.js`.
 */
export function panelDelDia(fila, detalle) {
  let caso, cuerpo;
  if (fila.minD <= 0) {
    caso = 'nada';
    cuerpo = parrafo(TEXTO_NADA);
  } else if (!detalle) {
    caso = 'sin-detalle';
    cuerpo = `${parrafo(TEXTO_SIN_DETALLE)}
      <p class="lluvia-panel-nota">El detalle por día <strong>no se publica</strong>: se queda en este navegador y nunca sale de tu ordenador.</p>
      ${BOTON_CARGAR}`;
  } else if (!detalle.diasLocal || typeof detalle.diasLocal !== 'object') {
    caso = 'version-anterior';
    cuerpo = `${parrafo(TEXTO_VERSION_ANTERIOR)}${BOTON_CARGAR}`;
  } else {
    const delDia = detalle.diasLocal[fila.dia];
    const { temas, artistas } = delDia ? armarDia(delDia, detalle.temas) : { temas: [], artistas: [] };
    const sonaron = temasConVeces(temas);
    if (!artistas.length && !sonaron.length) {
      caso = 'sin-dia';
      cuerpo = `${parrafo(TEXTO_SIN_DIA)}${BOTON_CARGAR}`;
    } else {
      caso = 'listas';
      cuerpo = listasDelDiaHtml(artistas, sonaron);
    }
  }
  const html = `
    <div class="modal lluvia-panel" data-lluvia-panel="${caso}">
      <div class="lluvia-panel-head">
        <div class="lluvia-panel-titulo">
          <h3 class="lluvia-panel-t">${escapeHtml(fmtDia(fila.dia))}</h3>
          <div class="lluvia-panel-sub">${textoMm(fila.mmD)} mm · ${textoMinutos(fila.minD)} min</div>
        </div>
        <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="lluvia-panel-scroll">${cuerpo}</div>
    </div>`;
  return { caso, html };
}

/** Lo que la vista sabe del detalle mientras está abierta: se lee una vez, la primera vez que se toca un día. */
function crearEstadoDelDetalle() {
  let leido = false, detalle = null, leyendo = null;
  return {
    async leer() {
      if (leido) return detalle;
      leyendo ||= loadDays().catch((e) => { console.warn('[lluvia] no se pudo leer el detalle por día:', e); return null; });
      const d = await leyendo;
      leyendo = null;
      leido = true;
      detalle = d;
      return detalle;
    },
    poner(d) { leido = true; detalle = d; },
  };
}

function abrirPanel(content, ruta, estado, fila) {
  return estado.leer().then((detalle) => {
    // Vigencia de ruta: leer el detalle es IndexedDB y puede tardar; si el usuario se fue, no se abre nada.
    if (!ruta.vigente() || !content.isConnected) return;
    const { html } = panelDelDia(fila, detalle);
    const overlay = openModal({ className: 'lluvia-panel-overlay', html });
    conectarListasDelDia(overlay);
    const cargar = overlay.querySelector('[data-lluvia-cargar]');
    if (cargar) cargar.onclick = () => cargarElDetalle(content, ruta, estado, fila, overlay, cargar);
  });
}

/**
 * «Cargar el detalle por día desde tu export»: `importarSoloElDetalle()` tal cual (lee archivos locales,
 * 0 red). Al terminar bien, la vista RELEE el detalle con `loadDays()` y, si el panel sigue abierto, lo
 * cierra y lo abre otra vez con el detalle nuevo (el mismo día). Si te fuiste de la ruta, no toca nada.
 */
async function cargarElDetalle(content, ruta, estado, fila, overlay, boton) {
  boton.disabled = true;
  let res = null;
  try {
    res = await importarSoloElDetalle();
  } catch (e) {
    console.warn('[lluvia] no se pudo cargar el detalle por día:', e);
  }
  if (!ruta.vigente() || !content.isConnected) return;
  if (!res || !res.ok) { boton.disabled = false; return; }
  let releido = null;
  try { releido = await loadDays(); } catch (e) { console.warn('[lluvia] no se pudo releer el detalle por día:', e); }
  if (!ruta.vigente() || !content.isConnected) return;
  estado.poner(releido || res.days || null);
  if (overlay.isConnected) {
    closeModal(overlay);
    await abrirPanel(content, ruta, estado, fila);
  }
}

/** Los clics de la lista: el día abre su panel; «Mostrar 25 más» suma 25 filas (0 peticiones). */
function conectarDias(content, ruta, filas, lluviosos) {
  const porDia = new Map(filas.map((f) => [f.dia, f]));
  const estado = crearEstadoDelDetalle();
  let cuantos = DE_A;
  content.addEventListener('click', (e) => {
    const dia = e.target.closest('[data-lluvia-dia]');
    if (dia && content.contains(dia)) {
      const fila = porDia.get(dia.dataset.lluviaDia);
      if (fila) abrirPanel(content, ruta, estado, fila);
      return;
    }
    const mas = e.target.closest('[data-lluvia-mas]');
    if (mas && content.contains(mas)) {
      const caja = content.querySelector('[data-lluvia-todos]');
      if (!caja) return;
      const antes = cuantos;
      cuantos += DE_A;
      caja.innerHTML = todosHtml(lluviosos, cuantos);
      // El foco va a la primera fila nueva, para seguir con el teclado donde se estaba.
      caja.querySelectorAll('[data-lluvia-tabla="todos"] [data-lluvia-dia]')[antes]?.focus();
    }
  });
}

/** `loadDaysLocal()` no trajo nada: por qué, en este orden. */
async function pintarSinDias(content, ruta) {
  if (falloDeLecturaDelHistorial('daysLocal')) {
    content.innerHTML = `<div data-lluvia="historial-ilegible">${avisoHistorialIlegibleHtml()}</div>`;
    return;
  }
  const propio = await isOwner();
  if (!ruta.vigente() || !content.isConnected) return;
  if (propio) {
    // El archivo es suyo: si no llegó y no quedó anotado, es un fallo de la app (v=154).
    content.innerHTML = `<div data-lluvia="historial-ilegible">${avisoHistorialIlegibleHtml()}</div>`;
    return;
  }
  // Con `/me` caído no se le pregunta nada más a Spotify: `hasLocalHistory()` volvería a intentar.
  const tiene = identidadSinConfirmar() ? false : await hasLocalHistory();
  if (!ruta.vigente() || !content.isConnected) return;
  content.innerHTML = tiene ? notaHtml('sin-archivo', SIN_ARCHIVO) : ownerLockedMessage('Cuando llueve');
}

export async function render(container) {
  const ruta = vigilarRuta();
  container.innerHTML = `
    ${pageHeader({ title: 'Cuando llueve' })}
    <div id="lluvia-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  const dias = await loadDaysLocal();
  if (!ruta.vigente()) return;
  const content = document.getElementById('lluvia-content');
  if (!content) return;
  if (!dias) return pintarSinDias(content, ruta);
  if (!diasLocalesValidos(dias)) {
    console.warn('[lluvia] history-days-local.json no tiene la forma esperada');
    content.innerHTML = `<div data-lluvia="historial-ilegible">${avisoHistorialIlegibleHtml()}</div>`;
    return;
  }

  let lluvia;
  try {
    lluvia = await leerLluvia();
  } catch (e) {
    console.warn('[lluvia] no se pudo leer la lluvia:', e);
    if (!ruta.vigente() || !content.isConnected) return;
    content.innerHTML = notaHtml('lluvia-caida', LLUVIA_CAIDA);
    return;
  }
  if (!ruta.vigente() || !content.isConnected) return;

  const filas = filasDeLaVentana(dias, lluvia);
  if (!filas.length) {
    content.innerHTML = notaHtml('sin-dias', 'Todavía no hay días con los dos datos para comparar.');
    return;
  }
  const lluviosos = diasConLluvia(filas);
  content.innerHTML = vistaHtml(filas, lluvia, dias, lluviosos);
  conectarDias(content, ruta, filas, lluviosos);
}
