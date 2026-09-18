// #genre — auditoría de un grupo: qué tracks metió adentro y por qué.
//
// No es una vista de estadísticas. El clasificador le erra (la playlist de Rock
// trajo trap), y hasta ahora la única forma de enterarse era generar la
// playlist y escucharla. Acá se ve la lista entera con el TAG CONCRETO que hizo
// entrar a cada track, que es el dato con el que se arregla el reparto.
//
// Tres decisiones:
//
// 1. MODAL, no expansión de la tarjeta ni ruta aparte. La grilla de #genre son
//    ~98 tarjetas en `.smart-grid`: abrir una en el sitio empuja a las otras
//    96 y obliga a buscar de nuevo dónde estaba. Una ruta aparte pierde la
//    selección de tags y el filtro de búsqueda que ya están cargados, y habría
//    que inventarle navegación y vuelta. El modal se apila con `modal-stack`,
//    que ya trae Esc, backdrop, candado del body y botón de volver.
//
// 2. El chasis es el `.wt-modal` de W-Three (v=215): alto fijo, el modal nunca
//    scrollea y el scroll vive dentro de la lista. Se reusan sus clases tal
//    cual —incluido `.wthree-track-tag` para los chips— así que acá no hay
//    ningún número de los suyos copiado a mano.
//
// 3. La lista va incremental (`ui/incremental-list.js`), igual que #covers:
//    Hip-Hop/Rap son 3.762 filas y pintarlas de una es el mismo error que
//    costó 21,5 s en el mosaico de tapas.

import { escapeHtml } from '../ui/components.js?v=229';
import { openModal } from '../ui/modal-stack.js?v=229';
import { createIncrementalList, scrollRootOf } from '../ui/incremental-list.js?v=229';
import { reasonsFor, tallyReasons } from '../util/genre-reason.js?v=229';

const BATCH = 60;

// Una fila por track único del bucket, con sus razones ya resueltas.
// `tracks` viene de `genreMap.get(bucket)`: el mismo array que alimenta la
// playlist, así que lo que se audita es exactamente lo que se va a generar.
function buildRows(tracks, artistToTags, bucket, groupsMode) {
  const vistos = new Set();
  const rows = [];
  for (const track of tracks) {
    if (!track?.uri || vistos.has(track.uri)) continue;
    vistos.add(track.uri);
    // El reparto mira SOLO al primer artista (ver `buildGenreMap`), así que la
    // auditoría tiene que mirar al mismo o mentiría sobre el motivo.
    const artista = track.artists?.[0]?.name || '';
    const tags = artistToTags.get(artista) || [];
    rows.push({
      uri: track.uri,
      name: track.name || '(sin título)',
      artist: artista,
      otros: Math.max(0, (track.artists?.length || 0) - 1),
      reasons: reasonsFor(tags, bucket, groupsMode),
    });
  }
  // Orden de auditoría: primero los que entraron por UNA sola razón, que son
  // los que dependen de un único tag y por lo tanto los más frágiles; dentro
  // de eso, por artista, para que los errores de un mismo artista queden
  // pegados y se vean como el bloque que son.
  rows.sort((a, b) =>
    a.reasons.length - b.reasons.length ||
    a.artist.localeCompare(b.artist, 'es') ||
    a.name.localeCompare(b.name, 'es'));
  return rows;
}

function rowHtml(r, i) {
  const chips = r.reasons.length
    ? r.reasons.map(t => `<span class="wthree-track-tag gd-chip">${escapeHtml(t)}</span>`).join('')
    : `<span class="wthree-track-tag gd-chip gd-chip-none" title="El artista ya no tiene este tag en la caché: el track quedó de un análisis anterior">sin motivo</span>`;
  const otros = r.otros
    ? `<span class="gd-otros" title="El reparto solo mira al primer artista; los otros ${r.otros} no cuentan">+${r.otros}</span>`
    : '';
  return `
    <div class="gd-row" data-uri="${escapeHtml(r.uri)}">
      <span class="gd-num">${i + 1}</span>
      <span class="gd-txt">
        <span class="gd-name">${escapeHtml(r.name)}</span>
        <span class="gd-artist">${escapeHtml(r.artist)}${otros}</span>
      </span>
      <span class="gd-chips">${chips}</span>
    </div>`;
}

function openGenreAudit({ bucket, tracks, artistToTags, groupsMode }) {
  const rows = buildRows(tracks || [], artistToTags || new Map(), bucket, groupsMode);
  const tally = tallyReasons(rows);
  const artistas = new Set(rows.map(r => r.artist)).size;

  // Estado del filtro: un tag concreto (o null) + texto libre.
  let tagFiltro = null;
  let texto = '';

  const modo = groupsMode
    ? 'con «Agrupar parecidos» encendido'
    : 'con «Agrupar parecidos» apagado';

  const overlay = openModal({
    id: `genre-audit:${bucket}`,
    html: `
    <div class="modal wt-modal gd-modal">
      <div class="wt-head">
        <div class="wt-head-top">
          <div class="card-modal-eyebrow">Auditoría de género</div>
          <button class="btn btn-secondary btn-sm card-modal-close" data-close-modal>✕</button>
        </div>
        <div class="wt-head-body">
          <div class="wt-head-info">
            <div class="wt-title-btn gd-title">${escapeHtml(bucket)}</div>
            <div class="wt-meta">${rows.length.toLocaleString('es-ES')} tracks · ${artistas.toLocaleString('es-ES')} artistas · ${modo}</div>
          </div>
        </div>
      </div>
      <div class="wt-body gd-body">
        <div class="gd-tools">
          <input type="text" id="gd-search" class="gd-search" placeholder="Buscar artista o canción… (ej: travis)">
          <div class="gd-tags" id="gd-tags">
            <button class="gd-tag gd-tag-on" data-tag="">Todos <b>${rows.length.toLocaleString('es-ES')}</b></button>
            ${tally.map(([t, n]) => `
              <button class="gd-tag" data-tag="${escapeHtml(t)}" title="Ver solo los que entraron por «${escapeHtml(t)}»">${escapeHtml(t)} <b>${n.toLocaleString('es-ES')}</b></button>
            `).join('')}
          </div>
        </div>
        <div class="gd-count" id="gd-count"></div>
        <div class="gd-list" id="gd-list"></div>
      </div>
      <div class="wt-footer gd-footer">
        <span class="gd-hint">Ordenado por motivos: arriba los que entraron por un solo tag. El reparto usa el primer artista del track.</span>
      </div>
    </div>
  `,
  });

  const listEl = overlay.querySelector('#gd-list');
  const countEl = overlay.querySelector('#gd-count');
  const searchEl = overlay.querySelector('#gd-search');

  const visibles = () => rows.filter(r => {
    if (tagFiltro && !r.reasons.some(t => t === tagFiltro)) return false;
    if (!texto) return true;
    return r.name.toLowerCase().includes(texto) || r.artist.toLowerCase().includes(texto);
  });

  let list = null;
  function pintar() {
    const items = visibles();
    countEl.textContent = items.length === rows.length
      ? `${rows.length.toLocaleString('es-ES')} tracks`
      : `${items.length.toLocaleString('es-ES')} de ${rows.length.toLocaleString('es-ES')} tracks`;
    if (!list) {
      list = createIncrementalList({
        container: listEl,
        items,
        renderItem: rowHtml,
        batchSize: BATCH,
        rootMargin: '400px',
      });
    } else {
      listEl.scrollTop = 0;
      list.setItems(items);
    }
  }

  searchEl.addEventListener('input', () => {
    texto = searchEl.value.trim().toLowerCase();
    pintar();
  });

  overlay.querySelector('#gd-tags').addEventListener('click', (e) => {
    const btn = e.target.closest('.gd-tag');
    if (!btn) return;
    const t = btn.dataset.tag || null;
    tagFiltro = (t && t === tagFiltro) ? null : t;
    overlay.querySelectorAll('.gd-tag').forEach(b =>
      b.classList.toggle('gd-tag-on', (b.dataset.tag || null) === tagFiltro));
    pintar();
  });

  // El scroll interno es `.gd-list`, pero el observer se cablea en el primer
  // `pintar()` y para entonces el nodo ya está en el DOM: `scrollRootOf` lo
  // resuelve solo. Se llama igual para dejarlo dicho y que no se pierda si
  // alguien mueve el overflow a un contenedor de más arriba.
  void scrollRootOf(listEl);
  pintar();
  return overlay;
}

export { openGenreAudit, buildRows };
