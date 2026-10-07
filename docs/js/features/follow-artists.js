import { getBestAvailableLikes, consultarSeguimientoArtistas, seguirArtistas, ARTISTAS_POR_LOTE } from '../api.js?v=280';
import { idbEntriesByPrefix } from '../idb.js?v=280';
import { DISCO_BASE_PREFIX } from '../util/disco-base.js?v=280';
import { artistasDeBases } from '../util/seguir-artistas.js?v=280';
import { controlesSeleccionArtistasHtml, conectarSeleccionArtistas } from './discover-common.js?v=280';
import { hasSpotifyScope, loginWithSpotify } from '../auth.js?v=280';
import { pageHeader, escapeHtml, confirmModal, tarjetaSinLikes } from '../ui/components.js?v=280';
import { showToast } from '../ui/toast.js?v=280';
import {
  artistasOcultos, artistaEstaOculto, alternarArtistaOculto,
  botonMenuArtistaHtml, botonArtistasOcultosHtml, conectarMenuArtista,
} from './artistas-ocultos.js?v=280';

const EXPLICACION = 'Seguir artistas no cambia nada en Fonoteca. «Novedades» y «Sin escuchar» se basan en tus me gusta y en las discografías guardadas, no en a quién sigues. Sirve para que Spotify tenga en cuenta a estos artistas en sus recomendaciones y avisos de música nueva; las notificaciones dependen de tus ajustes en Spotify.';
let session = null;

export function render(container) {
  const user = localStorage.getItem('fonoteca_last_user_id');
  if (!session || session.user !== user) session = { user, estados: new Map(), writing: null, permisoFallido: false };
  const state = session;
  const controller = new AbortController();
  let disposed = false;
  let artistas = [];
  let selected = new Set();
  let checking = false;
  let deciding = false;
  let notice = '';
  // Mirando la lista de ocultos en vez de la de «elegí a quién seguir». Es un
  // modo de la vista, no un filtro más: la lista de ocultos no se sigue.
  let viendoOcultos = false;
  const vigente = () => !disposed && container.isConnected;
  container.innerHTML = `${pageHeader({ title: 'Seguir artistas en Spotify' })}
    <div class="follow-artists">
      <p class="follow-explanation">${EXPLICACION}</p>
      <div id="follow-content" aria-live="polite">Leyendo las discografías guardadas…</div>
    </div>`;
  const content = container.querySelector('#follow-content');

  function paint() {
    if (!vigente()) return;
    // La poda que Ian pidió (04/10, punto 13): los 183 sin seguir que no quiere
    // seguir salen de la lista y se pueden volver a mirar con «Artistas ocultos».
    const sinSeguir = artistas.filter(a => state.estados.get(a.id) === false);
    const ocultos = sinSeguir.filter(a => artistaEstaOculto(a.name));
    const noSeguidos = viendoOcultos ? ocultos : sinSeguir.filter(a => !artistaEstaOculto(a.name));
    const conocidos = artistas.filter(a => state.estados.has(a.id)).length;
    const permiso = hasSpotifyScope('user-follow-modify') && !state.permisoFallido;
    const busy = checking || deciding || !!state.writing;
    content.innerHTML = `
      <p class="follow-summary"><strong>${viendoOcultos
        ? `${noSeguidos.length} ${noSeguidos.length === 1 ? 'artista oculto' : 'artistas ocultos'}`
        : `${noSeguidos.length} sin seguir${conocidos < artistas.length ? ' de momento' : ''}`}</strong>
        · ${conocidos} de ${artistas.length} comprobados${ocultos.length && !viendoOcultos ? ` · ${ocultos.length} ${ocultos.length === 1 ? 'oculto' : 'ocultos'} fuera de la lista` : ''}</p>
      <p>Artistas con discografía guardada en este navegador, ordenados por canciones que te gustan. No es toda tu biblioteca de artistas.</p>
      ${!permiso ? `<div class="follow-permission"><p>Para seguir artistas, Spotify necesita tu permiso. Reconecta tu cuenta; después vuelve aquí y elige a quién seguir. Reconectar no sigue a nadie.</p><button class="btn btn-secondary" id="follow-connect">Dar permiso en Spotify</button></div>` : ''}
      <p id="follow-notice" role="status">${escapeHtml(notice || (checking ? 'Comprobando a quién sigues…' : ''))}</p>
      <div class="follow-actions">
        <button class="btn btn-secondary btn-sm" id="follow-check" ${busy ? 'disabled' : ''}>${conocidos < artistas.length ? 'Comprobar los pendientes' : 'Actualizar seguimiento'}</button>
        ${botonArtistasOcultosHtml('follow-ocultos', { mirando: viendoOcultos })}
        <span>Consultar ${conocidos < artistas.length ? artistas.length - conocidos : artistas.length} artistas: ${Math.ceil((conocidos < artistas.length ? artistas.length - conocidos : artistas.length) / ARTISTAS_POR_LOTE)} peticiones.</span>
      </div>
      ${noSeguidos.length ? `<fieldset class="follow-selection" ${busy ? 'disabled' : ''}>
        <legend>Elige a quién seguir</legend>
        ${controlesSeleccionArtistasHtml(noSeguidos.length)}
        <div class="follow-actions follow-save">
          <span id="follow-selected"></span>
          <button class="btn btn-primary" id="follow-save" disabled>Seguir en Spotify…</button>
        </div>
        <div class="sel-art-lista follow-list">${noSeguidos.map(a => `<label class="sc-ex-item sel-art-item">
          <input type="checkbox" data-id="${a.id}" ${selected.has(a.id) ? 'checked' : ''}>
          <span class="sel-art-name">${escapeHtml(a.name)}</span>
          <span class="sel-art-likes">${a.likes.toLocaleString('es-ES')} me gusta</span>
          ${botonMenuArtistaHtml(a.name)}
        </label>`).join('')}</div>
      </fieldset>` : `<p>${viendoOcultos ? 'No has ocultado ningún artista de esta lista.' : checking ? 'La lista aparecerá al terminar la consulta.' : conocidos === artistas.length ? 'Ya sigues a todos los artistas de esta lista.' : 'Todavía no sabemos a cuáles de los pendientes sigues.'}</p>`}`;
    const connect = content.querySelector('#follow-connect');
    if (connect) { connect.disabled = busy; connect.onclick = () => loginWithSpotify(); }
    content.querySelector('#follow-check').onclick = () => check(conocidos === artistas.length);
    const btnOcultos = content.querySelector('#follow-ocultos');
    if (btnOcultos) btnOcultos.onclick = () => { viendoOcultos = !viendoOcultos; selected = new Set(); paint(); };
    const cajas = [...content.querySelectorAll('input[type="checkbox"]')];
    if (!cajas.length) return;
    const selectionChanged = () => {
      selected = new Set(cajas.filter(c => c.checked).map(c => c.dataset.id));
      content.querySelector('#follow-selected').textContent = `${selected.size} seleccionados`;
      const save = content.querySelector('#follow-save');
      save.textContent = selected.size ? `Seguir a ${selected.size} en Spotify…` : 'Seguir en Spotify…';
      save.disabled = !selected.size || !permiso || busy;
    };
    conectarSeleccionArtistas(content, cajas, selectionChanged);
    cajas.forEach(c => c.onchange = selectionChanged);
    selectionChanged();
    content.querySelector('#follow-save').onclick = save;
  }

  // El ⋮ de cada fila. Una sola conexión delegada sobre `content`, que es el
  // nodo que sobrevive a los repintados: `paint()` rehace la lista entera, así
  // que un listener por botón se perdería en el primer cambio.
  const sueltaMenu = conectarMenuArtista(content, {
    selectorFila: '.sel-art-item',
    onCambio: async (nombre) => {
      const a = artistas.find(x => x.name === nombre);
      if (!a) return;
      try {
        // GRATIS: `repTrackId` es un like de este artista que ya estaba en
        // memoria. Sin esto habría que buscarle una pista con `/search`, una
        // por artista, y la lista a podar tiene 183.
        const uriSugerida = a.repTrackId ? `spotify:track:${a.repTrackId}` : null;
        const oculto = await alternarArtistaOculto(a, { uriSugerida });
        selected.delete(a.id);
        showToast(oculto
          ? `«${a.name}» oculto — ya no aparece en esta lista`
          : `«${a.name}» vuelve a la lista`, 'success');
      } catch (e) {
        showToast('No se ha podido ocultar: ' + e.message, 'error');
      }
      paint();
    },
  });

  async function check(force = false) {
    if (checking || deciding || state.writing || !vigente()) return;
    const ids = artistas.filter(a => force || !state.estados.has(a.id)).map(a => a.id);
    if (!ids.length) { paint(); return; }
    if (force) ids.forEach(id => state.estados.delete(id));
    checking = true;
    notice = '';
    paint();
    try {
      await consultarSeguimientoArtistas(ids, { signal: controller.signal, onBatch: batch => {
        for (const [id, follows] of batch) state.estados.set(id, follows);
      } });
      notice = 'Seguimiento comprobado. No se ha seguido a nadie.';
    } catch (e) {
      if (e.name !== 'AbortError') notice = `No se ha podido completar la consulta: ${e.message}. Los artistas sin comprobar no se dan por no seguidos.`;
    } finally {
      checking = false;
      paint();
    }
  }

  async function save() {
    if (checking || deciding || state.writing || !selected.size || state.permisoFallido || !hasSpotifyScope('user-follow-modify')) return;
    const ids = [...selected];
    deciding = true;
    paint();
    const ok = await confirmModal(`¿Seguir a ${ids.length} ${ids.length === 1 ? 'artista' : 'artistas'} en Spotify?`,
      `Esto cambiará a quién sigues en tu cuenta de Spotify (${Math.ceil(ids.length / ARTISTAS_POR_LOTE)} ${ids.length <= ARTISTAS_POR_LOTE ? 'petición' : 'peticiones'}). No cambia las novedades ni los descubrimientos de Fonoteca.`,
      `Sí, seguir a ${ids.length}`);
    deciding = false;
    if (!ok || !vigente()) { paint(); return; }
    state.writing = seguirArtistas(ids, { onBatch: lote => {
      lote.forEach(id => { state.estados.set(id, true); selected.delete(id); });
    } });
    paint();
    try {
      const result = await state.writing;
      if (result.error?.status === 403) state.permisoFallido = true;
      notice = result.error
        ? `${result.seguidos.length} seguidos; ${result.pendientes.length} pendientes. Spotify no ha confirmado el último lote: ${result.error.message}. Si indica 403, vuelve a dar permiso en Spotify. Actualiza el seguimiento antes de reintentar.`
        : `Ahora sigues a ${result.seguidos.length} ${result.seguidos.length === 1 ? 'artista más' : 'artistas más'} en Spotify.`;
    } finally {
      state.writing = null;
      paint();
    }
  }

  (async () => {
    try {
      const [bases, likes] = await Promise.all([idbEntriesByPrefix(DISCO_BASE_PREFIX), getBestAvailableLikes()]);
      // Los ocultos desde la playlist, en segundo plano: la vista arranca con el
      // caché local (0 peticiones) y se repinta cuando llega la reconciliación,
      // que es lo que trae lo que Ian podó desde la otra máquina. Cuesta
      // `1 /playlists/{id}` + `ceil(12/100)` = 2, y el `/me` ya está memoizado.
      artistasOcultos.ready().then(() => { if (vigente()) paint(); }).catch(() => {});
      if (!vigente()) return;
      if (likes.source === 'empty') { content.innerHTML = tarjetaSinLikes('ordenar tus artistas por canciones que te gustan'); return; }
      artistas = artistasDeBases(bases, likes.items);
      if (!artistas.length) { content.textContent = 'No hay discografías guardadas en este navegador. No se ha consultado Spotify.'; return; }
      if (state.writing) { paint(); await state.writing; }
      await check();
    } catch (e) {
      if (vigente()) content.textContent = `No se ha podido cargar la lista: ${e.message}`;
    }
  })();
  return () => { disposed = true; controller.abort(); sueltaMenu(); };
}
