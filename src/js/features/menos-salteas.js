// `#menos-salteas` — las que menos te saltas (tanda 90).
//
// Los temas que escuchaste enteros al menos 10 veces desde el 15/10/2022 y que
// saltas como mucho la mitad que tu promedio. Es la salida que quedó de «las
// infalibles» (la tanda 69 midió la definición de Ian y daban cero). La cuenta es
// PURA y vive en `util/menos-salteas.js` (`tests/menos-salteas.test.mjs`); acá solo
// se enchufan los datos y se pinta (`tests/banco/menos-salteas.html`).
//
// De dónde sale cada cosa:
//   · `loadSkipStats()`: `tracks[id][5]` y `[6]` (completas y saltos desde el
//     corte), los dos campos de `history-skip-stats` v5. La guarda de
//     `history-data.js` sigue en `version >= 4` a propósito: los dos campos van al
//     final y un v4 le sirve entero a `#skips` (subirla dejaba sin `#skips` al amigo
//     con un historial importado antes; lo vio el caso H2 de `copia-importar`). Un v4
//     llega acá con `tracks[id]` de cinco campos y `faltanCampos()` lo detecta: la
//     vista pide volver a importarlo (el molde de `#puertas`). Sin `skip` y con
//     historial propio (`hasLocalHistory`), lo mismo.
//   · `loadHistoryStats()`: el `years[]` de la línea base (`lineaBaseSaltos`).
//   · Los nombres: la caché de me gusta (`getBestAvailableLikes()` sin `allowFetch`:
//     lee la caché y no pide nada) y, si no, `loadArtistTracks()`.
//
// 🔴 El candado es el de `#records` («pide los DATOS primero»): un amigo con su ZIP
// importado abre la vista con SUS datos. Abrir cuesta el `/me` de `loadOne()`
// (memoizado) y 0 de lo demás; «Mostrar 25 más» cuesta 0. Después de cada `await`
// se pregunta por la vigencia de la ruta (v=195).

import { loadSkipStats, loadHistoryStats, loadArtistTracks, isOwner, ownerLockedMessage, hasLocalHistory } from './history-data.js';
import { getBestAvailableLikes } from '../api.js';
import { escapeHtml, pageHeader } from '../ui/components.js';
import { vigilarRuta } from '../util/vigencia-ruta.js';
import { coverUrl } from '../util/cover-size.js';
import { openTrackCard } from './track-card.js';
import {
  armarMenosSalteas, POR_PAGINA, indiceDeLikes, indiceDeArtistTracks, nombreDeFila,
  textoPct, textoCuentas, textoIntro,
} from '../util/menos-salteas.js';

const TITULO = 'Las que menos te saltas';
const num = (n) => Number(n || 0).toLocaleString('es-ES');

function filaHtml(f, i) {
  const nombre = f.nombre
    ? escapeHtml(f.nombre)
    : '<span class="menos-salteas-sin-nombre">Sin nombre en tus datos</span>';
  return `<li class="menos-salteas-fila" data-id="${escapeHtml(f.id)}">
    <span class="menos-salteas-puesto">${i + 1}</span>
    <div class="menos-salteas-texto">
      <button type="button" class="menos-salteas-tema" data-i="${i}">${nombre}</button>
      <span class="menos-salteas-artista">${escapeHtml(f.artista || '—')}</span>
    </div>
    <span class="menos-salteas-cuentas">${textoCuentas(f.completas, f.saltos)}</span>
    <span class="menos-salteas-pct">${textoPct(f.pct)}</span>
  </li>`;
}

const reimportarHtml = () => `<div class="card menos-salteas-reimportar" data-menos-salteas="reimportar">
  <p><strong>Para ver esto, vuelve a importar tu historial.</strong></p>
  <p class="menos-salteas-nota">Lo importaste antes de que la app contara las veces que escuchas cada tema entero.</p>
  <button class="btn btn-primary" data-open-import>Volver a importar mi historial</button>
</div>`;

export async function render(container) {
  const ruta = vigilarRuta();
  container.innerHTML = `
    ${pageHeader({ title: TITULO })}
    <div id="menos-salteas-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  // En serie y no con `Promise.all`: `getCurrentUserId()` (api.js) memoiza el id pero no la
  // promesa, así que dos `loadOne()` a la vez con el `/me` frío piden `/me` DOS veces (medido en
  // el banco). La primera espera deja el `/me` memoizado para todo lo demás.
  const skip = await loadSkipStats();
  if (!ruta.vigente()) return;
  const stats = await loadHistoryStats();
  if (!ruta.vigente()) return;
  let content = document.getElementById('menos-salteas-content');
  if (!content) return;

  if (!skip || !skip.tracks) {
    const propio = await isOwner();
    if (!ruta.vigente()) return;
    // Un amigo con historial propio pero sin el de saltos: que lo vuelva a importar.
    const local = propio ? false : await hasLocalHistory();
    if (!ruta.vigente()) return;
    content = document.getElementById('menos-salteas-content');
    if (!content) return;
    content.innerHTML = propio
      ? `<div class="card"><p>No he podido cargar tu historial. Vuelve a intentarlo.</p></div>`
      : local ? reimportarHtml() : ownerLockedMessage(TITULO);
    return;
  }

  const r = armarMenosSalteas(skip, stats?.years);
  if (r.estado === 'sin-campos') { content.innerHTML = reimportarHtml(); return; }
  if (r.estado === 'sin-base') {
    content.innerHTML = `<div class="card" data-menos-salteas="sin-base"><p>Tu historial no tiene dos años con los saltos anotados: no puedo calcular tu promedio.</p></div>`;
    return;
  }
  if (!r.filas.length) {
    content.innerHTML = `<div class="card" data-menos-salteas="vacia"><p>Todavía no hay temas que cumplan esto.</p></div>`;
    return;
  }

  // Los nombres: lo que ya está en el navegador, sin pedir nada.
  const [likes, at] = await Promise.all([
    getBestAvailableLikes().catch(() => ({ items: [] })),
    loadArtistTracks().catch(() => null),
  ]);
  if (!ruta.vigente()) return;
  content = document.getElementById('menos-salteas-content');
  if (!content) return;
  const idxLikes = indiceDeLikes(likes?.items);
  const idxAt = indiceDeArtistTracks(at?.artists);
  const filas = r.filas.map((f) => ({ ...f, ...nombreDeFila(f, idxLikes, idxAt) }));

  let mostradas = Math.min(POR_PAGINA, filas.length);
  content.innerHTML = `<div class="menos-salteas" data-menos-salteas="lista">
    <p class="menos-salteas-intro">${escapeHtml(textoIntro(r.base))}</p>
    <ol class="menos-salteas-lista">${filas.slice(0, mostradas).map(filaHtml).join('')}</ol>
    <div class="menos-salteas-pie">
      <span class="menos-salteas-cuenta" data-menos-salteas-cuenta></span>
      <button class="btn btn-secondary" data-menos-salteas-mas hidden>Mostrar ${num(POR_PAGINA)} más</button>
    </div>
  </div>`;

  const lista = content.querySelector('.menos-salteas-lista');
  const cuenta = content.querySelector('[data-menos-salteas-cuenta]');
  const mas = content.querySelector('[data-menos-salteas-mas]');
  const pie = () => {
    cuenta.textContent = `${num(mostradas)} de ${num(filas.length)} temas`;
    mas.hidden = mostradas >= filas.length;
  };
  pie();
  // «Mostrar 25 más»: 0 peticiones, las filas ya están armadas.
  mas.addEventListener('click', () => {
    const hasta = Math.min(mostradas + POR_PAGINA, filas.length);
    lista.insertAdjacentHTML('beforeend', filas.slice(mostradas, hasta).map((f, k) => filaHtml(f, mostradas + k)).join(''));
    mostradas = hasta;
    pie();
  });
  // Tocar el tema abre la ficha de canción, como `#skips`.
  lista.addEventListener('click', (e) => {
    const b = e.target.closest('.menos-salteas-tema');
    if (!b) return;
    const f = filas[+b.dataset.i];
    if (!f) return;
    const t = f.track;
    openTrackCard(t
      ? { id: f.idNombre, name: t.name, artists: (t.artists || []).map((a) => a?.name || a).filter(Boolean), album: t.album?.name, img: coverUrl(t.album?.images || [], 'grande') }
      : { id: f.idNombre, name: f.nombre, artist: f.artista });
  });
}
