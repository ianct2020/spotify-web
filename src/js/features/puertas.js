// `#puertas` — puertas de entrada (v=308, tanda 56).
//
// Para cada artista que escuchaste 10 minutos o más: por qué tema entraste (la
// primera reproducción válida), si ese tema sigue siendo tu top de ese artista y
// cuántos días tardaste en escuchar un segundo tema suyo. La cuenta es PURA y vive
// en `util/puertas-entrada.js` (probada en `tests/puertas-entrada.test.mjs`); acá
// solo se enchufan los datos y se pinta (`tests/banco/puertas.html`).
//
// De dónde sale cada cosa:
//   · `loadArtistTracks()` (`history-data.js`), que pasa por `loadOne()`: el
//     candado del owner y el historial importado de un amigo. 🔴 El candado es el
//     de `#records` («pide los DATOS primero» y recién si vienen vacíos pregunta
//     por el owner), NO el de `#covers` (`isOwner()` por adelantado): un amigo con
//     su ZIP importado abre la vista con SUS datos.
//   · El tema de entrada y el día del segundo tema son `totals[a][6]` y `[7]`
//     (`history-artist-tracks` v3). Un historial importado antes de v=308 no los
//     trae (su clave `local_<uid>_history_artistTracks` no lleva versión): la
//     vista lo dice y pide volver a importar; no pinta una lista vacía ni con huecos.
//
// Abrir cuesta lo mismo que `#records`: el `/me` de `loadOne()` (memoizado) y 0
// de cualquier otra cosa. 🔴 Después de cada `await` largo se pregunta por la
// vigencia de la ruta (v=195: un `teardown` no interrumpe un `await`): salir a
// mitad de la carga no escribe en el DOM de la ruta nueva.
//
// Sin ranking ni ordenar por otra columna: la lista en el orden de `universo()` y de a
// 100 filas («Mostrar 100 más»), que miles de filas de golpe son mucho DOM. A 390 px
// cada fila pasa a dos renglones (ver `.puertas` en main.css).
//
// v=328 (tanda 74, «se podría embellecer un poco»): los datos no cambiaron, cambió cómo
// se ven. Arriba, un resumen de tres números (`resumenPuertas`); cada fila con
// jerarquía (el artista primero, el día debajo del tema, una pastilla para «Sí» con el
// anillo del acento —el molde de `.covers-chip.is-on`, v=290: nada de blanco sobre el
// acento—, y una barrita logarítmica para los días); y un filtro de tres chips (Todos /
// Siguen siendo su top / Cambiaron) que filtra ANTES de paginar: «Mostrar 100 más» va
// sobre lo filtrado y el orden sigue siendo el de `universo()`. Filtrar no pide nada.

import { loadArtistTracks, isOwner, ownerLockedMessage } from './history-data.js';
import { escapeHtml, pageHeader } from '../ui/components.js';
import { vigilarRuta } from '../util/vigencia-ruta.js';
import { armarPuertas, POR_PAGINA, FILTROS, filtrarPuertas, cuentasPuertas, resumenPuertas, textoMediana, maxDias, anchoBarra } from '../util/puertas-entrada.js';
import { MIN_MINUTOS } from '../util/mapa-paises.js';

const num = (n) => Number(n || 0).toLocaleString('es-ES');

function filaHtml(f, max) {
  // «Sí» es una pastilla (anillo del acento, texto en --color-text); «No», texto con el top de hoy.
  const sigue = f.sigue === true ? '<span class="puertas-pastilla">Sí</span>'
    : f.sigue === false ? `Ahora: «${escapeHtml(f.top)}»`
      : '—';
  const ancho = anchoBarra(f.dias, max);
  // La barrita no es texto (aria-hidden): el número ya está escrito al lado.
  const barra = ancho === null ? '' : `<span class="puertas-barra" aria-hidden="true"><span class="puertas-barra-llena" style="width:${(ancho * 100).toFixed(1)}%"></span></span>`;
  return `<tr class="puertas-fila" data-artista="${escapeHtml(f.nombre)}">
    <td class="puertas-art" data-et="Artista">${escapeHtml(f.nombre)}</td>
    <td class="puertas-entrada" data-et="Tema de entrada"><span class="puertas-tema">${escapeHtml(f.tema || '—')}</span> <span class="puertas-dia">${escapeHtml(f.diaTexto)}</span></td>
    <td class="puertas-sigue" data-et="¿Sigue siendo tu top?" data-sigue="${f.sigue === true ? 'si' : f.sigue === false ? 'no' : ''}">${sigue}</td>
    <td class="puertas-hasta" data-et="Hasta el segundo tema"><span class="puertas-hasta-texto">${escapeHtml(f.hasta)}</span>${barra}</td>
  </tr>`;
}

/** Las tres tarjetas del resumen. Los números, con es-ES; las etiquetas, en el secundario (CSS). */
function resumenHtml(r) {
  const tarjeta = (clave, numero, texto) => `<div class="puertas-resumen-tarjeta" data-puertas-resumen="${clave}"><span class="puertas-resumen-num">${numero}</span><span class="puertas-resumen-et">${texto}</span></div>`;
  return `<div class="puertas-resumen">
    ${tarjeta('siguen', num(r.siguen), `de ${num(r.total)} artistas siguen teniendo su tema de entrada como el más escuchado`)}
    ${tarjeta('mismo-dia', num(r.mismoDia), `te ganaron el mismo día: el segundo tema sonó el mismo día que el primero`)}
    ${tarjeta('mediana', textoMediana(r.mediana), `la mediana hasta el segundo tema (de los ${num(r.conSegundo)} que lo tienen)`)}
  </div>`;
}

function chipsHtml(cuentas, filtro) {
  return `<div class="puertas-filtro" role="group" aria-label="Filtrar artistas">
    ${FILTROS.map((c) => `<button type="button" class="puertas-chip${c.id === filtro ? ' is-on' : ''}" data-puertas-filtro="${c.id}" aria-pressed="${c.id === filtro}">${c.texto} <span class="puertas-chip-cuenta">${num(cuentas[c.id])}</span></button>`).join('')}
  </div>`;
}

export async function render(container) {
  const ruta = vigilarRuta();
  container.innerHTML = `
    ${pageHeader({ title: 'Puertas de entrada' })}
    <div id="puertas-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  const datos = await loadArtistTracks();
  if (!ruta.vigente()) return;
  const content = document.getElementById('puertas-content');
  if (!content) return;
  if (!datos || !datos.totals) {
    const propio = await isOwner();
    if (!ruta.vigente()) return;
    content.innerHTML = propio
      ? `<div class="card"><p>No he podido cargar tu historial. Vuelve a intentarlo.</p></div>`
      : ownerLockedMessage('Puertas de entrada');
    return;
  }

  const { sinEntrada, filas } = armarPuertas(datos.totals, datos.artists);
  if (sinEntrada) {
    // Un historial importado antes de v=308. El botón lo engancha
    // `bindOwnerLockedButtons()` (`[data-open-import]`), igual que el del cartel.
    content.innerHTML = `<div class="card puertas-reimportar" data-puertas="reimportar">
      <p><strong>Para ver esto, vuelve a importar tu historial.</strong></p>
      <p class="puertas-nota">Lo importaste antes de que la app guardara el primer tema de cada artista.</p>
      <button class="btn btn-primary" data-open-import>Volver a importar mi historial</button>
    </div>`;
    return;
  }
  if (!filas.length) {
    content.innerHTML = `<div class="card" data-puertas="vacia"><p>Todavía no hay ningún artista con ${MIN_MINUTOS} minutos o más en tu historial.</p></div>`;
    return;
  }

  // La escala de la barrita es la de TODAS las filas, no la del filtro: un artista no cambia de largo
  // por apretar un chip.
  const max = maxDias(filas);
  const cuentas = cuentasPuertas(filas);
  let filtro = 'todos';
  let lista = filas;
  let mostradas = Math.min(POR_PAGINA, lista.length);
  content.innerHTML = `<div class="puertas" data-puertas="lista">
    <p class="puertas-intro">El primer tema que escuchaste de cada artista con ${MIN_MINUTOS} minutos o más, si sigue siendo tu favorito suyo y cuánto tardaste en escuchar otro.</p>
    ${resumenHtml(resumenPuertas(filas))}
    ${chipsHtml(cuentas, filtro)}
    <table class="puertas-tabla">
      <thead><tr><th scope="col">Artista</th><th scope="col">Tema de entrada</th><th scope="col">¿Sigue siendo tu top?</th><th scope="col">Hasta el segundo tema</th></tr></thead>
      <tbody>${lista.slice(0, mostradas).map((f) => filaHtml(f, max)).join('')}</tbody>
    </table>
    <p class="puertas-vacio" data-puertas-vacio hidden>Ningún artista en este filtro.</p>
    <div class="puertas-pie">
      <span class="puertas-cuenta" data-puertas-cuenta></span>
      <button class="btn btn-secondary" data-puertas-mas hidden>Mostrar ${num(POR_PAGINA)} más</button>
    </div>
  </div>`;

  const tbody = content.querySelector('.puertas-tabla tbody');
  const cuenta = content.querySelector('[data-puertas-cuenta]');
  const mas = content.querySelector('[data-puertas-mas]');
  const vacio = content.querySelector('[data-puertas-vacio]');
  const pie = () => {
    cuenta.textContent = `${num(mostradas)} de ${num(lista.length)} artistas`;
    mas.hidden = mostradas >= lista.length;
    vacio.hidden = lista.length > 0;
  };
  pie();
  mas.addEventListener('click', () => {
    const hasta = Math.min(mostradas + POR_PAGINA, lista.length);
    tbody.insertAdjacentHTML('beforeend', lista.slice(mostradas, hasta).map((f) => filaHtml(f, max)).join(''));
    mostradas = hasta;
    pie();
  });
  // Filtrar va ANTES de paginar: se vuelve a la primera página de lo filtrado. 0 peticiones.
  content.querySelector('.puertas-filtro').addEventListener('click', (e) => {
    const b = e.target.closest('[data-puertas-filtro]');
    if (!b || b.dataset.puertasFiltro === filtro) return;
    filtro = b.dataset.puertasFiltro;
    for (const c of content.querySelectorAll('[data-puertas-filtro]')) {
      const on = c.dataset.puertasFiltro === filtro;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-pressed', String(on));
    }
    lista = filtrarPuertas(filas, filtro);
    mostradas = Math.min(POR_PAGINA, lista.length);
    tbody.innerHTML = lista.slice(0, mostradas).map((f) => filaHtml(f, max)).join('');
    pie();
  });
}
