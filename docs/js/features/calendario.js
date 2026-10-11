// `#calendario` — cada día de tu historial, coloreado por lo que escuchaste (v=289).
//
// ═══════════════════════════════════════════════════════════════════════════
// DE DÓNDE SALE CADA NÚMERO, Y POR QUÉ NINGUNO SE RECALCULA
// ═══════════════════════════════════════════════════════════════════════════
//
// La grilla y los tres números de arriba salen de `loadHistoryStats()` →
// `years[]`, que YA trae los minutos por día (`years[].days = { from, min[] }`,
// un valor por día, contiguo, en UTC). Lo emiten `gen-stats.py` y su puerto
// `history-processor.js`, y `STATS_VERSION = 4` existe por eso.
//
// ⚠️ **No se escribe otra agregación de minutos por día.** La había que
// escribir y ya estaba escrita dos veces (Python y JS); una tercera copia en
// una vista es exactamente la forma en que divergió el `fmtDate()` de v=231.
// Los días con música, los minutos del año y el día pico se LEEN de
// `years[]` — `days_active` no, ojo: ver el comentario de `diasConMusica()`.
//
// El DIBUJO es el de `ui/calendario-anual.js`, el mismo componente que pinta
// el paso «Días con música» de la apertura del Wrapped. Acá se le piden las
// opciones que esa no necesita (celdas tocables, marca del día elegido y la
// clase propia `cal-anual`), y sin ellas su salida es byte a byte la de v=288
// — lo vigila `tests/calendario-anual.test.mjs`.
//
// ───────────────────────────────────────────────────────────────────────────
// ABRIR ESTA VISTA NO GASTA CUOTA
//
// 0 peticiones a `api.spotify.com` además del `GET /me` que `loadOne()` paga
// para resolver si sos el owner (`resolvedUserId()` → `getCurrentUserId()`,
// memoizado en `_cachedUserId`). Es exactamente lo que pagan `#dashboard`,
// `#wrapped` y `#records`, y nada más: ni discografías, ni búsquedas, ni
// playlists, ni likes. Cambiar de año y abrir el detalle de un día **no**
// cuestan ninguna. Lo vigila `tests/calendario-sin-cuota.test.mjs`.
//
// El único camino que escribe en la cuenta es el botón «Crear playlist con
// este día», que lo dice antes de confirmar.
//
// ───────────────────────────────────────────────────────────────────────────
// LOS DÍAS VAN EN UTC
//
// Como todo el historial (sección «Zona horaria» de `CLAUDE.md`). El
// calendario y el detalle agrupan igual que `years[].days`, o los minutos no
// cuadran. Una línea al pie lo dice en la pantalla, porque un día que empieza
// a las 21:00 de la noche anterior no es un detalle de implementación para
// quien lo lee.

import {
  loadHistoryStats, loadDays, isOwner, ownerLockedMessage,
} from './history-data.js?v=295';
import { escapeHtml, pageHeader, showProgress, hideProgress, promptPlaylistName, confirmModal } from '../ui/components.js?v=295';
import { showToast } from '../ui/toast.js?v=295';
import { openModal, closeModal } from '../ui/modal-stack.js?v=295';
import { openTrackCard } from './track-card.js?v=295';
import { attachArtistCard } from './artist-card.js?v=295';
import { calendarioAnual, aMs, isoDelDia, ultimoDiaDelTramo } from '../ui/calendario-anual.js?v=295';
import { fmtDia } from '../util/fecha.js?v=295';
import { animationsEnabled, armRevealAll, releaseReveal } from '../ui/reveal.js?v=295';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=295';
import { prefKey, migratePrefKey } from '../storage.js?v=295';
import { createPlaylist, addTracksToPlaylist, invalidatePlaylistsCache } from '../api.js?v=295';
import { openImportHistory, importarSoloElDetalle } from './import-history.js?v=295';

const PREF_ANIO = 'fonoteca_calendario_anio_v1';

const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// El MISMO `fmtMinutes` que el Wrapped, y por el mismo camino: llega al
// componente por `ctx`. No se escribe un formateador nuevo — hay cuatro copias
// privadas de «un decimal en es-ES» anotadas en `PENDIENTES.md` y no hace falta
// la quinta.
function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h.toLocaleString('es-ES')}h ${m}m`;
  }
  return `${Math.round(min)}m`;
}

function num(n) {
  return Number(n || 0).toLocaleString('es-ES');
}

const ctxCalendario = { MESES, MESES_LARGOS, fmtMinutes, fmtDia };

// ── estado de la vista ──────────────────────────────────────────────────────
let stats = null;
let anioElegido = null;
let diaEnfocado = 0;
let detalle = null;        // el payload `days`, o null si no está cargado
let detalleBuscado = false;

function anioConDatos() {
  return (stats?.years || []).filter(y => y.days && Array.isArray(y.days.min) && y.days.min.length);
}

function tramoDe(anio) {
  const y = (stats?.years || []).find(yy => yy.year === anio);
  return y && y.days && Array.isArray(y.days.min) && y.days.min.length ? y : null;
}

/**
 * Días con música **del tramo que cubre el año**, no `days_active`.
 *
 * ⚠️ Son dos números distintos y confundirlos es enseñar un número que no
 * cuadra con la grilla que tiene debajo. `days_active` cuenta los días con al
 * menos una play válida del año entero; el tramo de `days` arranca en la
 * primera play global (2018 empieza el 15/08) y termina en la última, así que
 * para 2018 y 2026 cubre menos días que el año. Acá se cuenta sobre `min[]`,
 * que es justo lo que la grilla dibuja.
 */
function diasConMusica(D) {
  return D.min.filter(v => v > 0).length;
}

function indicePico(D) {
  return D.min.reduce((mejor, v, i) => (v > D.min[mejor] ? i : mejor), 0);
}

function guardarAnio(anio) {
  try { localStorage.setItem(prefKey(PREF_ANIO), String(anio)); }
  catch { /* sin localStorage la preferencia no se recuerda, y no pasa nada */ }
}

function anioGuardado() {
  try {
    migratePrefKey(PREF_ANIO);
    const v = Number(localStorage.getItem(prefKey(PREF_ANIO)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════
// EL RENDER
// ═══════════════════════════════════════════════════════════════════════════

export async function render(container) {
  const ruta = vigilarRuta();

  container.innerHTML = `
    ${pageHeader({ title: 'Calendario' })}
    <div id="cal-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  stats = await loadHistoryStats();
  // Vigencia de ruta: `loadHistoryStats()` puede tardar (un fetch del JSON de
  // 26 KB en frío, o un `/me` con backoff). Si el usuario ya se fue, no se
  // escribe nada — ver `util/vigencia-ruta.js`.
  if (!ruta.vigente()) return;

  const content = document.getElementById('cal-content');
  if (!content) return;

  const anios = anioConDatos();
  if (!stats || !anios.length) {
    // El MISMO cartel de bloqueo que `#records`, con su botón de importar. Un
    // amigo con BYOH sí ve la grilla: `years[].days` viene en su payload.
    content.innerHTML = (await isOwner())
      ? `<div class="card"><p>No he podido cargar el historial. Vuelve a intentarlo.</p></div>`
      : ownerLockedMessage('El calendario');
    return;
  }

  // Por defecto, el ÚLTIMO año con datos. Si hay uno recordado y sigue
  // teniendo datos, gana ese.
  const recordado = anioGuardado();
  anioElegido = anios.some(y => y.year === recordado) ? recordado : anios[anios.length - 1].year;

  // El detalle se pide UNA vez por carga de vista y no cuesta ninguna
  // petición: no hay URL para el owner, sale de IndexedDB o no sale.
  if (!detalleBuscado) {
    detalleBuscado = true;
    detalle = await loadDays();
    if (!ruta.vigente()) return;
  }

  pintar(content, ruta);
}

function pintar(content, ruta) {
  const anios = anioConDatos();
  const y = tramoDe(anioElegido);
  const D = y.days;
  const iPico = indicePico(D);
  // El día enfocado arranca en el pico: es el que la grilla ya marca, así que
  // Tab entra justo donde está la marca y no en una esquina cualquiera.
  if (diaEnfocado < 0 || diaEnfocado >= D.min.length) diaEnfocado = iPico;

  const ultimoY = anios[anios.length - 1];
  const ultimoDia = ultimoDiaDelTramo(ultimoY.days);

  releaseReveal(content);
  content.innerHTML = `
    <div class="cal-anios" role="group" aria-label="Elegir año">
      ${anios.map(a => `
        <button type="button" class="cal-anio${a.year === anioElegido ? ' is-on' : ''}"
                data-anio="${a.year}" aria-pressed="${a.year === anioElegido}">${a.year}</button>
      `).join('')}
    </div>

    <div class="cal-resumen">
      <div class="cal-tile">
        <div class="cal-tile-n">${num(diasConMusica(D))}</div>
        <div class="cal-tile-l">días con música</div>
        <div class="cal-tile-h">de los ${num(D.min.length)} que cubre el historial en ${anioElegido}</div>
      </div>
      <div class="cal-tile">
        <div class="cal-tile-n">${fmtMinutes(y.min)}</div>
        <div class="cal-tile-l">escuchados en ${anioElegido}</div>
        <div class="cal-tile-h">${num(y.plays)} reproducciones válidas</div>
      </div>
      <div class="cal-tile">
        <div class="cal-tile-n">${fmtMinutes(D.min[iPico])}</div>
        <div class="cal-tile-l">el día pico</div>
        <div class="cal-tile-h">${fmtDia(isoDelDia(D, iPico))}</div>
      </div>
    </div>

    <div class="card cal-card">
      ${calendarioAnual(D, iPico, ctxCalendario, {
        claseContenedor: 'cal-anual',
        tocables: true,
        diaMarcado: diaEnfocado,
      })}
      <p class="cal-pie">
        Los días van en <strong>hora UTC</strong>, igual que todo el historial: un día
        empieza y acaba donde lo dice el dato, no en tu reloj.
        El historial termina el <strong>${fmtDia(ultimoDia)}</strong>.
      </p>
    </div>
  `;

  conectar(content, ruta);

  // Si se anima, se anima con el toggle de la app y SIN que el CSS esconda
  // nada: la clase la pone el JS (sección «Animaciones de entrada al
  // scrollear» de `CLAUDE.md`). Si `armRevealAll` falla o el módulo no carga,
  // el contenido queda visible.
  if (animationsEnabled()) {
    try { armRevealAll('.cal-tile, .cal-card', content); } catch { /* visible igual */ }
  }
}

function conectar(content, ruta) {
  for (const btn of content.querySelectorAll('.cal-anio')) {
    btn.onclick = () => {
      const a = Number(btn.dataset.anio);
      if (a === anioElegido) return;
      anioElegido = a;
      guardarAnio(a);
      diaEnfocado = -1;   // que lo reponga el pico del año nuevo
      pintar(content, ruta);
    };
  }

  const rejilla = content.querySelector('.cal-anual .wr-ap-cal');
  if (!rejilla) return;

  const celdas = [...rejilla.querySelectorAll('i[data-dia]')];

  function enfocar(i) {
    if (i < 0 || i >= celdas.length) return;
    const antes = celdas[diaEnfocado];
    if (antes) {
      antes.classList.remove('elegido');
      antes.tabIndex = -1;
      antes.removeAttribute('aria-selected');
    }
    diaEnfocado = i;
    const ahora = celdas[i];
    ahora.classList.add('elegido');
    ahora.tabIndex = 0;
    ahora.setAttribute('aria-selected', 'true');
    ahora.focus();
  }

  rejilla.addEventListener('click', (e) => {
    const celda = e.target.closest('i[data-dia]');
    if (!celda) return;
    enfocar(Number(celda.dataset.dia));
    abrirDia(Number(celda.dataset.dia), ruta);
  });

  // ←→ un día, ↑↓ una semana (que es exactamente lo que la grilla dibuja:
  // `grid-auto-flow: column` con 7 filas, así que la columna de al lado es
  // ±7 días). Inicio/Fin van al primero y al último del tramo.
  rejilla.addEventListener('keydown', (e) => {
    const celda = e.target.closest('i[data-dia]');
    if (!celda) return;
    const i = Number(celda.dataset.dia);
    let destino = null;
    if (e.key === 'ArrowRight') destino = i + 1;
    else if (e.key === 'ArrowLeft') destino = i - 1;
    else if (e.key === 'ArrowDown') destino = i + 7;
    else if (e.key === 'ArrowUp') destino = i - 7;
    else if (e.key === 'Home') destino = 0;
    else if (e.key === 'End') destino = celdas.length - 1;
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      abrirDia(i, ruta);
      return;
    } else return;
    e.preventDefault();
    if (destino >= 0 && destino < celdas.length) enfocar(destino);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EL PANEL DEL DÍA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lo que sabemos de un día, separando con cuidado las DOS fuentes:
 *  · `minutos` sale SIEMPRE de `years[].days.min` — existe aunque no haya
 *    detalle cargado, y es el número que la celda ya enseña en su `title`;
 *  · todo lo demás sale del payload `days` local, y puede no estar.
 */
function datosDelDia(iso) {
  const D = tramoDe(anioElegido).days;
  const i = Math.round((aMs(iso) - aMs(D.from)) / 86400000);
  const minutos = i >= 0 && i < D.min.length ? D.min[i] : 0;
  const d = detalle?.dias?.[iso] || null;
  if (!d) return { iso, minutos, detalle: null };

  const dic = detalle.temas || [];
  const temas = (d.temas || []).map(([idx, min, veces]) => {
    const t = dic[idx] || [];
    return { id: t[0] || '', nombre: t[1] || '', artista: t[2] || '', min, veces };
  });
  // Artistas por MINUTOS, de mayor a menor. Se agrupa por el artista principal
  // del tema, que es el único que el diccionario guarda.
  const porArtista = new Map();
  for (const t of temas) {
    if (!t.artista) continue;
    porArtista.set(t.artista, (porArtista.get(t.artista) || 0) + t.min);
  }
  const artistas = [...porArtista.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nombre, min]) => ({ nombre, min }));

  return { iso, minutos, detalle: d, temas, artistas };
}

function abrirDia(i, ruta) {
  const D = tramoDe(anioElegido).days;
  const iso = isoDelDia(D, i);
  const d = datosDelDia(iso);

  const sinDetalle = !d.detalle;
  // Un día sin música se puede abrir igual, y lo dice. Antes que un panel con
  // filas vacías o un clic que no hace nada.
  const nadaSono = d.minutos <= 0;

  const cabecera = sinDetalle
    ? `<div class="cal-panel-sub">${nadaSono
        ? 'Ese día no sonó nada.'
        : `${fmtMinutes(d.minutos)} de música.`}</div>`
    : `<div class="cal-panel-sub">
         ${fmtMinutes(d.detalle.min)} ·
         <span title="Una reproducción puede durar más de 30 s y haber sido saltada, así que las dos cifras se solapan.">${num(d.detalle.crudas)} reproducciones · ${num(d.detalle.validas)} de más de 30 s · <span title="Un salto es una reproducción marcada como saltada, o un «siguiente» antes de los 30 segundos">${num(d.detalle.saltos)} saltadas</span></span>
       </div>`;

  const temasConVeces = sinDetalle ? [] : d.temas.filter(t => t.veces > 0 && t.id);

  const cuerpo = sinDetalle
    ? `<div class="cal-panel-vacio">
         <p>${nadaSono
            ? 'No hay nada que detallar: ese día no sonó ninguna canción.'
            : 'Los minutos de este día salen del historial horneado, pero <strong>qué</strong> sonó vive solo en tu navegador y todavía no está cargado.'}</p>
         ${nadaSono ? '' : `
         <p class="cal-panel-nota">El detalle por día <strong>no se publica</strong>: se queda en este navegador y nunca sale de tu ordenador.</p>
         <button class="btn btn-primary btn-sm" data-cal-cargar>Cargar el detalle por día desde tu export</button>
         <button class="btn btn-secondary btn-sm" data-cal-import-completo>Importar mi historial entero</button>`}
       </div>`
    : `
      ${d.artistas.length ? `
        <h4 class="cal-panel-h">Artistas del día</h4>
        <ul class="cal-lista cal-lista-art">
          ${d.artistas.map(a => `
            <li><button type="button" class="cal-fila" data-artista="${escapeHtml(a.nombre)}">
              <span class="cal-fila-n">${escapeHtml(a.nombre)}</span>
              <span class="cal-fila-m">${fmtMinutes(a.min)}</span>
            </button></li>
          `).join('')}
        </ul>` : ''}

      ${temasConVeces.length ? `
        <h4 class="cal-panel-h">Temas del día <span class="cal-panel-h-hint">en orden de la primera vez que sonaron</span></h4>
        <ul class="cal-lista cal-lista-temas">
          ${temasConVeces.map(t => `
            <li><button type="button" class="cal-fila" data-tema="${escapeHtml(t.id)}"
                        data-nombre="${escapeHtml(t.nombre)}" data-artista-tema="${escapeHtml(t.artista)}">
              <span class="cal-fila-n">${escapeHtml(t.nombre)}<span class="cal-fila-a">${escapeHtml(t.artista)}</span></span>
              <span class="cal-fila-m">${fmtMinutes(t.min)}${t.veces > 1 ? ` · ${num(t.veces)} veces` : ''}</span>
            </button></li>
          `).join('')}
        </ul>` : ''}
    `;

  const botonPlaylist = temasConVeces.length
    ? `<button class="btn btn-primary btn-sm" data-cal-playlist>Crear playlist con este día (${num(temasConVeces.length)} temas)</button>`
    : '';

  const overlay = openModal({
    className: 'cal-panel-overlay',
    html: `
      <div class="modal cal-panel" style="max-width:620px;width:min(620px,94vw)">
        <div class="cal-panel-head">
          <div style="flex:1;min-width:0">
            <h3 class="cal-panel-t">${fmtDia(iso)}</h3>
            ${cabecera}
          </div>
          <button class="btn btn-secondary btn-sm" data-close-modal title="Cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="cal-panel-scroll">${cuerpo}</div>
        ${botonPlaylist ? `<div class="cal-panel-pie">${botonPlaylist}</div>` : ''}
      </div>
    `,
  });

  // Las fichas: cada nombre abre la suya. `attachArtistCard` para los
  // artistas y `openTrackCard` para los temas — las dos ya existen y no se
  // reimplementan.
  for (const b of overlay.querySelectorAll('[data-artista]')) {
    attachArtistCard(b, b.dataset.artista);
  }
  for (const b of overlay.querySelectorAll('[data-tema]')) {
    b.onclick = () => openTrackCard({
      id: b.dataset.tema,
      name: b.dataset.nombre,
      artist: b.dataset.artistaTema,
    });
  }

  const cargar = overlay.querySelector('[data-cal-cargar]');
  if (cargar) cargar.onclick = () => { closeModal(overlay); cargarElDetalle(ruta); };
  const completo = overlay.querySelector('[data-cal-import-completo]');
  if (completo) completo.onclick = () => { closeModal(overlay); openImportHistory(); };

  const botonPl = overlay.querySelector('[data-cal-playlist]');
  if (botonPl) botonPl.onclick = () => crearPlaylistDelDia(botonPl, iso, temasConVeces);
}

// ═══════════════════════════════════════════════════════════════════════════
// LA IMPORTACIÓN «SOLO EL DETALLE»
// ═══════════════════════════════════════════════════════════════════════════

async function cargarElDetalle(ruta) {
  const res = await importarSoloElDetalle();
  if (!res || !res.ok) return;
  detalle = res.days;
  const content = document.getElementById('cal-content');
  // Repintar solo si seguimos en la vista: el import puede tardar y el usuario
  // puede haberse ido mientras procesaba sus 19 archivos.
  if (content && ruta.vigente()) pintar(content, ruta);
  showToast(`Detalle por día cargado: ${num(Object.keys(res.days.dias).length)} días`, 'success');
}

// ═══════════════════════════════════════════════════════════════════════════
// TAREA 4 · «Crear playlist con lo que sonó este día»
// ═══════════════════════════════════════════════════════════════════════════
//
// COSTO: 1 `POST /me/playlists` + `ceil(N/100)` `POST /playlists/{id}/items`,
// y **0 GET**. `addTracksToPlaylist()` parte los items de a 100 (el lote de 40
// es de `/me/library`, que acá no se usa). O sea 2 peticiones para un día de
// 30 temas y 3 para uno de 150. Medido contra la Spotify simulada en
// `tests/calendario-playlist.test.mjs`, donde el número es exacto y no un techo.
//
// ⚠️ **GUARDA CONTRA EL DOBLE CLIC, y no es decorativa**: las playlists
// **no se pueden borrar por API** post-migración (ver «Crear playlists
// privadas» en `CLAUDE.md`), así que dos clics serían dos playlists que Ian
// tiene que limpiar a mano desde la app de Spotify. El botón se deshabilita en
// la MISMA instrucción en la que empieza el trabajo, y un `creando` de módulo
// lo respalda por si alguien llega por otro camino.
let creando = false;

async function crearPlaylistDelDia(boton, iso, temas) {
  if (creando) return;

  // Sin repetidos y en orden de primera reproducción — que es el orden en el
  // que ya vienen de `cerrar()` del acumulador.
  const vistos = new Set();
  const uris = [];
  for (const t of temas) {
    if (!t.id || vistos.has(t.id)) continue;
    vistos.add(t.id);
    uris.push(`spotify:track:${t.id}`);
  }
  if (!uris.length) return;

  const ok = await confirmModal(
    'Crear una playlist con este día',
    `Se va a crear una <strong>playlist nueva en tu cuenta de Spotify</strong> con los ` +
    `<strong>${num(uris.length)}</strong> temas que sonaron el ${fmtDia(iso)}.<br><br>` +
    `⚠️ <strong>Spotify la deja pública</strong> aunque se pida privada: su API ignora el campo ` +
    `y tampoco permite pasarla a privada ni borrarla después. Si la quieres privada, ` +
    `tendrás que cambiarla a mano desde la aplicación de Spotify.`,
    'Crear la playlist',
  );
  if (!ok) return;

  // El nombre se pide ANTES de tocar la API y antes de deshabilitar nada:
  // cancelar acá no es un error y no tiene que pintar un toast rojo.
  const nombre = await promptPlaylistName(`Lo que sonó el ${fmtDia(iso)}`, {
    trackCount: uris.length,
    subtitle: 'Los temas con al menos una reproducción válida de ese día, sin repetidos.',
  });
  if (!nombre) return;

  creando = true;
  boton.disabled = true;
  const etiqueta = boton.textContent;
  boton.textContent = 'Creando…';
  try {
    showProgress('Creando la playlist…', 0, uris.length);
    const pl = await createPlaylist(
      nombre,
      `Lo que sonó el ${fmtDia(iso)} — generado desde el calendario de Fonoteca`,
      false,
    );
    showProgress('Añadiendo los temas…', 0, uris.length);
    await addTracksToPlaylist(pl.id, uris);
    invalidatePlaylistsCache();
    hideProgress();
    showToast(`Playlist creada con ${num(uris.length)} temas`, 'success');
  } catch (e) {
    hideProgress();
    // El mensaje REAL, no uno de dominio: un `catch` que traduce cualquier
    // excepción a «no se pudo crear» esconde los errores de programación con
    // el disfraz de un resultado normal (la lección de v=154).
    showToast('Error: ' + e.message, 'error');
  } finally {
    creando = false;
    boton.disabled = false;
    boton.textContent = etiqueta;
  }
}

// Para los bancos y las puertas: el estado de módulo se reinicia entre
// escenarios, y así una suite no arrastra el año elegido de la anterior.
export function __reiniciarParaTests() {
  stats = null; anioElegido = null; diaEnfocado = 0;
  detalle = null; detalleBuscado = false; creando = false;
}

export { datosDelDia };
