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

import { loadDaysLocal, isOwner, hasLocalHistory, identidadSinConfirmar, ownerLockedMessage, falloDeLecturaDelHistorial, avisoHistorialIlegibleHtml } from './history-data.js?v=361';
import { LLUVIA_VERSION } from '../history-keys.js?v=361';
import { escapeHtml, pageHeader } from '../ui/components.js?v=361';
import { fmtDia } from '../util/fecha.js?v=361';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=361';
import {
  validarLluvia, diasLocalesValidos, filasDeLaVentana, resumir, porAnio, masLluviosos, lineaVentana,
  lineaRecorte, lineaAnios, FRASE_NO_CAUSA, textoMinutos, textoMm, textoPct, trozosAtribucion,
} from '../util/lluvia.js?v=361';

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

function tablaLluviososHtml(filas) {
  return `<h3 class="lluvia-sec">Los días más lluviosos</h3>
    <div class="lluvia-tabla-marco"><table class="lluvia-tabla" data-lluvia-tabla="lluviosos">
      <thead><tr><th scope="col">Día</th><th scope="col">Lluvia</th><th scope="col">Escuchaste</th></tr></thead>
      <tbody>${masLluviosos(filas).map((f) => `<tr><td>${escapeHtml(fmtDia(f.dia))}</td><td>${textoMm(f.mmD)} mm</td><td>${textoMinutos(f.minD)} min</td></tr>`).join('')}</tbody>
    </table></div>`;
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

function vistaHtml(filas, lluvia, dias) {
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
    ${pieHtml(lluvia)}
  </div>`;
}

const notaHtml = (clave, texto) => `<p class="lluvia-linea" data-lluvia="${clave}">${escapeHtml(texto)}</p>`;

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
  content.innerHTML = filas.length
    ? vistaHtml(filas, lluvia, dias)
    : notaHtml('sin-dias', 'Todavía no hay días con los dos datos para comparar.');
}
