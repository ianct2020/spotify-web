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
// Sin ranking, sin filtros, sin ordenar por otra columna: la lista en el orden de
// `universo()` y de a 100 filas («Mostrar 100 más»), que miles de filas de golpe son
// mucho DOM. A 390 px cada fila pasa a dos renglones (ver `.puertas` en main.css).

import { loadArtistTracks, isOwner, ownerLockedMessage } from './history-data.js?v=312';
import { escapeHtml, pageHeader } from '../ui/components.js?v=312';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=312';
import { armarPuertas, POR_PAGINA } from '../util/puertas-entrada.js?v=312';
import { MIN_MINUTOS } from '../util/mapa-paises.js?v=312';

const num = (n) => Number(n || 0).toLocaleString('es-ES');

function filaHtml(f) {
  const sigue = f.sigue === true ? 'Sí'
    : f.sigue === false ? `No: ahora «${escapeHtml(f.top)}»`
      : '—';
  return `<tr class="puertas-fila" data-artista="${escapeHtml(f.nombre)}">
    <td class="puertas-art" data-et="Artista">${escapeHtml(f.nombre)}</td>
    <td class="puertas-entrada" data-et="Tema de entrada"><span class="puertas-tema">${escapeHtml(f.tema || '—')}</span> <span class="puertas-dia">${escapeHtml(f.diaTexto)}</span></td>
    <td class="puertas-sigue" data-et="¿Sigue siendo tu top?" data-sigue="${f.sigue === true ? 'si' : f.sigue === false ? 'no' : ''}">${sigue}</td>
    <td class="puertas-hasta" data-et="Hasta el segundo tema">${escapeHtml(f.hasta)}</td>
  </tr>`;
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

  let mostradas = Math.min(POR_PAGINA, filas.length);
  content.innerHTML = `<div class="puertas" data-puertas="lista">
    <p class="puertas-intro">El primer tema que escuchaste de cada artista con ${MIN_MINUTOS} minutos o más, si sigue siendo tu favorito suyo y cuánto tardaste en escuchar otro.</p>
    <table class="puertas-tabla">
      <thead><tr><th scope="col">Artista</th><th scope="col">Tema de entrada</th><th scope="col">¿Sigue siendo tu top?</th><th scope="col">Hasta el segundo tema</th></tr></thead>
      <tbody>${filas.slice(0, mostradas).map(filaHtml).join('')}</tbody>
    </table>
    <div class="puertas-pie">
      <span class="puertas-cuenta" data-puertas-cuenta></span>
      <button class="btn btn-secondary" data-puertas-mas hidden>Mostrar ${num(POR_PAGINA)} más</button>
    </div>
  </div>`;

  const tbody = content.querySelector('.puertas-tabla tbody');
  const cuenta = content.querySelector('[data-puertas-cuenta]');
  const mas = content.querySelector('[data-puertas-mas]');
  const pie = () => {
    cuenta.textContent = `${num(mostradas)} de ${num(filas.length)} artistas`;
    mas.hidden = mostradas >= filas.length;
  };
  pie();
  mas.addEventListener('click', () => {
    const hasta = Math.min(mostradas + POR_PAGINA, filas.length);
    tbody.insertAdjacentHTML('beforeend', filas.slice(mostradas, hasta).map(filaHtml).join(''));
    mostradas = hasta;
    pie();
  });
}
