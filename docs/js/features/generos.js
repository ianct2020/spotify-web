// #generos — buscar los géneros de tu historial (v=313, tanda 61).
//
// La primera mitad de la vista de géneros: el escaneo que le pide a Last.fm las etiquetas de
// cada artista del HISTORIAL (`universo()` de `util/mapa-paises.js`, ≥ 10 min), y un bloque que
// dice cuánto se sabe. 🔴 Ningún género, ningún top, ningún porcentaje por género: eso es la
// tanda 62, con la regla que salga de la medición de la 61. `#genre` (la vista vieja, sobre los
// me gusta) no se tocó.
//
// De dónde sale cada cosa:
//   · los minutos, de `loadArtistTracks()` (`history-data.js`), que pasa por `loadOne()`: el
//     candado de «pide los datos primero», como `#records`, `#mapa` y `#puertas` (con BYOH se
//     abre con los datos del amigo; sin datos, el cartel de bloqueo, sin botón de buscar). Solo
//     se leen `totals[a][1]` y los nombres: un historial importado antes de v=308 sirve igual;
//   · las etiquetas, del almacén de la tanda 60 (`cargarEtiquetas`, `registroEtiquetas`,
//     `setCachedTags` de `api/lastfm.js`). Lo que ya trajo `#genre` de los me gusta y lo migrado
//     del blob viejo CUENTA y no se vuelve a pedir (ver `yaBuscado` en `util/generos-escaneo.js`);
//   · el bucle, de `util/generos-escaneo.js`, con la red inyectada. Acá solo se enchufa el
//     `fetch` real, IndexedDB, `navigator.locks` y el reloj, y se pinta.
//
// 🔴 ABRIR LA VISTA NO LE PIDE NADA A LAST.FM (la regla de v=261). Abrir cuesta el `/me` de
// `loadOne()` (el `getCurrentUserId()` de acá va por el memo) y 0 a Last.fm. El escaneo arranca
// SOLO con el botón («Buscar géneros» la primera vez, «Seguir» si hay algo hecho, «Parar»).
//
// 🔴 Si `cargarEtiquetas()` falla, la vista LO DICE y no ofrece buscar: con el almacén sin
// cargar, `guardar()` no escribe y el escaneo gastaría peticiones para nada, y enseñar «0 con
// etiquetas» sería un resultado de dominio tapando un error de la app (la lección de v=154). El
// error crudo va a `console.warn`.
//
// 🔴 Al salir de la ruta el escaneo para: el `teardown` aborta la señal y el bucle pregunta por la
// vigencia después de cada `await` (un teardown no corta un `await`, v=174).
//
// ⚠️ La pestaña oculta NO está verificada (como en `#mapa`): la pantalla pide dejarla a la vista y
// enseña el ritmo medido.

import { loadArtistTracks, isOwner, ownerLockedMessage } from './history-data.js?v=313';
import { getCurrentUserId } from '../api.js?v=313';
import { getKey, cargarEtiquetas, registroEtiquetas, setCachedTags } from '../api/lastfm.js?v=313';
import { idbEntriesEnRango, idbSetCached, idbGetCachedRaw } from '../idb.js?v=313';
import { escapeHtml, pageHeader } from '../ui/components.js?v=313';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=313';
import { universo, MIN_MINUTOS } from '../util/mapa-paises.js?v=313';
import { prefijoGeneros } from '../util/generos-artista.js?v=313';
import { peticionesPorMinuto, estimarLoQueFalta, ritmoDesde, sumarPeticion, sumarArtista, MIN_ARTISTAS_ESTIMAR } from '../util/mapa-escaneo.js?v=313';
import { escanearGeneros, conCandado, armarCobertura, yaBuscado, urlEtiquetas, claveRitmo, textoLoQueFalta } from '../util/generos-escaneo.js?v=313';

// Números con `es-ES` explícito: sin el locale se usa el del navegador (es-AR en las máquinas
// de Ian) y salen dos formatos en la misma pantalla.
const fmt = (n, dec = 0) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtMin = (decimas) => `${fmt(Math.round(decimas / 10))} min`;
const plural = (n, uno, varios) => `${fmt(n)} ${n === 1 ? uno : varios}`;

// La tanda en curso de ESTA pestaña: al volver a la ruta mientras la anterior termina de abortar,
// se espera a que suelte el candado antes de pedirlo (si no, se diría «hay otra búsqueda»).
let enCurso = null;

// El reloj de verdad. Una espera que se corta si se para el escaneo.
const reloj = {
  ahora: () => Date.now(),
  esperar: (ms, signal) => new Promise((res) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
  }),
};

// La red de verdad, SIN ninguna cabecera propia (una no simple provocaría una OPTIONS previa por
// pedido). El cuerpo se lee también con un status que no es 200: Last.fm manda ahí su `error`.
async function pedirLastfm(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  let datos = null;
  try { datos = await res.json(); } catch { datos = null; }
  return { status: res.status, datos };
}

// Con el candado en la mano se relee lo guardado: otra pestaña pudo haber buscado artistas
// mientras ésta miraba, y el `Map` del almacén de esta pestaña no lo sabe.
async function leerFrescos(uid) {
  const m = new Map();
  for (const [, v] of await idbEntriesEnRango(prefijoGeneros(uid))) {
    if (v && v.uid === uid && typeof v.nombre === 'string' && v.fuentes) m.set(v.nombre, v);
  }
  return m;
}

export async function render(container) {
  const ruta = vigilarRuta();
  container.innerHTML = `
    ${pageHeader({ title: 'Tus géneros' })}
    <div id="generos-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  const datos = await loadArtistTracks();
  if (!ruta.vigente()) return;
  const content = document.getElementById('generos-content');
  if (!content) return;
  if (!datos || !datos.totals) {
    const propio = await isOwner();
    if (!ruta.vigente()) return;
    content.innerHTML = propio
      ? `<div class="card"><p>No he podido cargar tu historial. Vuelve a intentarlo.</p></div>`
      : ownerLockedMessage('Tus géneros');
    return;
  }

  // Memoizado: el `/me` ya lo pagó `loadOne()`. 0 peticiones más.
  const uid = await getCurrentUserId();
  if (!ruta.vigente()) return;
  try {
    await cargarEtiquetas(uid);
  } catch (e) {
    console.warn('[generos] no se pudieron leer las etiquetas guardadas:', e?.message || e);
    if (!ruta.vigente()) return;
    content.innerHTML = `<div class="generos" data-estado="sin-almacen">
      <section class="card"><h2 class="mapa-h2">Cuánto se sabe</h2>
        <p class="mapa-estado-t">No se han podido leer las etiquetas que ya están guardadas en este navegador.</p>
        <p class="mapa-ayuda">Sin ellas no se puede decir cuánto se sabe ni buscar más: se volvería a pedir lo que ya está. Recarga la página para volver a intentarlo.</p>
      </section>
    </div>`;
    return;
  }
  if (!ruta.vigente()) return;
  const guardado = await idbGetCachedRaw(claveRitmo(uid)).catch(() => null);
  if (!ruta.vigente()) return;

  const st = {
    uid, totals: datos.totals,
    lista: universo(datos.totals, datos.artists),
    frescos: new Map(),            // lo que escribió otra pestaña (se relee con el candado)
    ritmo: guardado?.uid === uid ? ritmoDesde(guardado) : ritmoDesde(null),
    estado: 'quieto',              // quieto · escaneando · pausa · ocupado · terminado · parado · key · no-guarda · error
    error: null, codigoKey: null,
    ctrl: null,
    html: {},
    pintando: false,
    sesion: { peticiones: 0, fallos: 0, otrosFallos: 0, comienzos: [], desdeUltimo: null, noSePudo: new Set() },
  };
  // El registro de un artista: el del almacén de esta pestaña o, si otra ya lo buscó, el releído.
  st.registro = (nombre) => {
    const a = registroEtiquetas(nombre);
    if (yaBuscado(a)) return a;
    const b = st.frescos.get(String(nombre).toLowerCase());
    return yaBuscado(b) ? b : (a ?? b ?? null);
  };

  content.innerHTML = `<div class="generos">
    <section class="card generos-cobertura" data-seccion="cobertura"></section>
    <section class="card generos-escaneo"><div data-seccion="escaneo"></div><div class="mapa-botones" data-seccion="botones"></div></section>
  </div>`;
  const raiz = content.querySelector('.generos');
  raiz.addEventListener('click', (e) => {
    const b = e.target.closest('[data-generos-accion]');
    if (!b || b.disabled) return;
    if (b.dataset.generosAccion === 'buscar') arrancar(raiz, st, ruta);
    else if (b.dataset.generosAccion === 'parar') st.ctrl?.abort();
  });

  pintar(raiz, st, ruta);
  return () => { st.ctrl?.abort(); };
}

// ── El escaneo ───────────────────────────────────────────────────────────────

async function arrancar(raiz, st, ruta) {
  if (st.estado === 'escaneando') return;
  st.estado = 'escaneando';
  st.error = null;
  pintar(raiz, st, ruta);
  if (enCurso) { await enCurso.catch(() => {}); if (!ruta.vigente()) return; }

  const ctrl = new AbortController();
  st.ctrl = ctrl;
  const programar = () => programarPintado(raiz, st, ruta);
  const corrida = conCandado(typeof navigator !== 'undefined' ? navigator.locks : undefined, async () => {
    st.frescos = await leerFrescos(st.uid);
    if (ctrl.signal.aborted || !ruta.vigente()) return { motivo: 'parado' };
    // Lo acumulado, también releído: otra pestaña pudo haber medido mientras tanto.
    const r = await idbGetCachedRaw(claveRitmo(st.uid)).catch(() => null);
    if (ctrl.signal.aborted || !ruta.vigente()) return { motivo: 'parado' };
    const releido = r?.uid === st.uid ? ritmoDesde(r) : ritmoDesde(null);
    if (releido.artistas >= st.ritmo.artistas) st.ritmo = releido;
    // La duración de cada artista se mide desde el anterior (o desde acá): solo búsqueda activa.
    st.sesion.desdeUltimo = Date.now();
    const guardarRitmo = () => { idbSetCached(claveRitmo(st.uid), { ...st.ritmo, uid: st.uid }, null).catch(() => {}); };
    const key = getKey();
    return escanearGeneros({
      lista: st.lista, registro: st.registro,
      url: (nombre) => urlEtiquetas(nombre, key),
      pedir: pedirLastfm, reloj, signal: ctrl.signal,
      seguir: () => ruta.vigente(),
      saltar: st.sesion.noSePudo,
      guardar: (nombre, tags, artista) => setCachedTags(nombre, tags, 'lastfm', artista === undefined ? null : { artista }),
      onPeticion: (p) => {
        const s = st.sesion;
        s.peticiones++;
        s.comienzos.push(p.comienzo);
        if (p.tipo === 'reintentar') s.fallos++;
        else if (p.tipo === 'del-artista') s.otrosFallos++;
        st.ritmo = sumarPeticion(st.ritmo, p.status);
        guardarRitmo();
        programar();
      },
      onArtista: (nombre, estado) => {
        const ahora = Date.now();
        if (estado === 'resuelto') {
          st.ritmo = sumarArtista(st.ritmo, ahora - st.sesion.desdeUltimo);
          guardarRitmo();
        }
        st.sesion.desdeUltimo = ahora;
        programar();
      },
    });
  });
  enCurso = corrida.then(() => {}, () => {});
  let r;
  try {
    r = await corrida;
  } catch (e) {
    r = { candado: 'error', valor: null, error: e };
  } finally {
    if (st.ctrl === ctrl) st.ctrl = null;
  }
  if (!ruta.vigente()) return;
  if (r.candado === 'ocupado') st.estado = 'ocupado';
  else if (r.candado === 'error') { st.estado = 'error'; st.error = String(r.error?.message || r.error); console.warn('[generos] la búsqueda se cortó:', r.error); }
  else {
    const m = r.valor?.motivo;
    st.estado = m === 'completo' ? 'terminado' : m === 'pausa' ? 'pausa' : m === 'key' ? 'key' : m === 'no-guarda' ? 'no-guarda' : 'parado';
    if (m === 'key') st.codigoKey = r.valor.codigo;
  }
  pintar(raiz, st, ruta);
}

// ── Pintar ───────────────────────────────────────────────────────────────────

// A lo sumo un repintado por frame, con un `setTimeout` de respaldo (rAF no corre en una pestaña
// oculta ni en headless con `--dump-dom`): el que llegue primero pinta y el otro no hace nada.
function programarPintado(raiz, st, ruta) {
  if (st.pintando) return;
  st.pintando = true;
  let hecho = false;
  const una = () => {
    if (hecho) return;
    hecho = true;
    st.pintando = false;
    pintar(raiz, st, ruta);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(una);
  setTimeout(una, 250);
}

function pintar(raiz, st, ruta) {
  // Ninguna escritura al DOM después de salir de la ruta.
  if (!ruta.vigente() || !raiz.isConnected) return;
  const c = armarCobertura({ totals: st.totals, lista: st.lista, registro: st.registro });
  const esc = htmlEscaneo(c, st);
  const secciones = { cobertura: htmlCobertura(c, st), escaneo: esc.texto, botones: esc.botones };
  for (const [k, html] of Object.entries(secciones)) {
    if (st.html[k] === html) continue;
    st.html[k] = html;
    const el = raiz.querySelector(`[data-seccion="${k}"]`);
    if (el) el.innerHTML = html;
  }
  const f = c.filas;
  raiz.dataset.estado = st.estado;
  raiz.dataset.universo = String(c.universo);
  raiz.dataset.pendientes = String(c.pendientes);
  raiz.dataset.total = String(c.total);
  raiz.dataset.filas = [f.conEtiquetas.decimas, f.noTiene.decimas, f.sinBuscar.decimas, f.menos10.decimas].join(',');
  raiz.dataset.artistas = [f.conEtiquetas.artistas, f.noTiene.artistas, f.sinBuscar.artistas, f.menos10.artistas].join(',');
}

function htmlCobertura(c, st) {
  const f = c.filas;
  const filas = [
    ['con-etiquetas', 'Con etiquetas', 'Alguna fuente les da al menos una etiqueta', f.conEtiquetas],
    ['no-tiene', 'Last.fm dice que no tiene', 'Buscados, y sin ninguna etiqueta', f.noTiene],
    ['sin-buscar', 'Sin buscar todavía', `Artistas con ${MIN_MINUTOS} minutos o más`, f.sinBuscar],
    ['menos10', `Menos de ${MIN_MINUTOS} minutos`, 'No se buscan', f.menos10],
  ];
  const todos = f.conEtiquetas.artistas + f.noTiene.artistas + f.sinBuscar.artistas + f.menos10.artistas;
  const noSePudo = st.sesion.noSePudo.size;
  return `
    <h2 class="mapa-h2">Cuánto se sabe</h2>
    <table class="mapa-filas generos-filas">
      <tbody>
        ${filas.map(([k, t, d, x]) => `<tr data-fila="${k}">
          <th scope="row"><span class="mapa-fila-t">${t}</span><span class="mapa-fila-d">${d}</span></th>
          <td class="mapa-num">${plural(x.artistas, 'artista', 'artistas')}</td>
          <td class="mapa-num">${fmtMin(x.decimas)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><th scope="row">Todo tu historial</th><td class="mapa-num">${plural(todos, 'artista', 'artistas')}</td><td class="mapa-num">${fmtMin(c.total)}</td></tr></tfoot>
    </table>
    <p class="mapa-artistas">
      <strong>${fmt(c.universo - c.pendientes)}</strong> de ${plural(c.universo, 'artista buscado', 'artistas buscados')} en Last.fm${noSePudo ? ` · ${plural(noSePudo, 'no se ha podido consultar', 'no se han podido consultar')} en esta sesión` : ''}
    </p>
    <p class="mapa-nota">Cuentan también las etiquetas que ya tenías guardadas en este navegador (de «Por género»): esos artistas no se vuelven a pedir.</p>`;
}

function htmlEscaneo(c, st) {
  const s = st.sesion;
  const pendientes = Math.max(0, c.pendientes - [...s.noSePudo].filter((n) => !yaBuscado(st.registro(n))).length);
  const boton = (accion, texto, primario = true) =>
    `<button class="btn ${primario ? 'btn-primary' : 'btn-secondary'} btn-sm" data-generos-accion="${accion}">${texto}</button>`;
  const hayAlgo = c.universo - c.pendientes > 0;
  const seguir = pendientes > 0 ? boton('buscar', hayAlgo ? 'Seguir' : 'Buscar géneros') : '';

  // Lo que falta sale de lo ACUMULADO entre cargas (`st.ritmo`), como un rango: la estimación del
  // mapa, importada (ver «Lo que falta» en `util/mapa-escaneo.js`).
  const lineaFalta = () => {
    if (pendientes === 0) return '';
    const est = estimarLoQueFalta({ pendientes, ritmo: st.ritmo });
    if (!est) {
      return `<p class="mapa-estimacion">Lo que falta se estimará cuando se hayan buscado ${fmt(MIN_ARTISTAS_ESTIMAR)} artistas (van ${fmt(st.ritmo.artistas)}).</p>`;
    }
    return `<p class="mapa-estimacion">${escapeHtml(textoLoQueFalta(est))}</p>`;
  };
  const medidas = () => {
    const ritmo = peticionesPorMinuto(s.comienzos, Date.now());
    const partes = [
      `${plural(s.peticiones, 'petición', 'peticiones')} a Last.fm en esta sesión`,
      `${plural(s.fallos, 'fallo de Last.fm', 'fallos de Last.fm')}`,
    ];
    if (s.otrosFallos) partes.push(plural(s.otrosFallos, 'artista que no se pudo consultar', 'artistas que no se pudieron consultar'));
    if (ritmo !== null) partes.push(`ritmo medido: ${fmt(ritmo, 1)} peticiones por minuto (últimos 3 minutos)`);
    return `<p class="mapa-medidas">${partes.join(' · ')}</p>${lineaFalta()}`;
  };

  const progreso = `<p class="mapa-progreso"><strong>${fmt(c.universo - c.pendientes)}</strong> de ${plural(c.universo, 'artista', 'artistas')}</p>`;
  let cuerpo, botones = '';
  switch (st.estado) {
    case 'escaneando':
      cuerpo = `<p class="mapa-estado-t">Buscando etiquetas en Last.fm…</p>${progreso}${medidas()}
        <p class="mapa-aviso">Deja esta pestaña a la vista mientras busca: si está oculta, el navegador puede frenarla.</p>`;
      botones = boton('parar', 'Parar', false);
      break;
    case 'pausa':
      cuerpo = `<p class="mapa-estado-t">Last.fm no contesta ahora; lo que ya buscaste queda guardado.</p>${progreso}${medidas()}`;
      botones = seguir;
      break;
    case 'key':
      cuerpo = `<p class="mapa-estado-t">La clave de Last.fm no funciona (código ${fmt(st.codigoKey)}): Last.fm no acepta las peticiones de esta app.</p>
        <p class="mapa-ayuda">La búsqueda se ha parado sin guardar nada de esa respuesta; lo que ya estaba buscado se queda. Vuelve a intentarlo más tarde.</p>${progreso}`;
      botones = seguir;
      break;
    case 'no-guarda':
      cuerpo = `<p class="mapa-estado-t">No se ha podido guardar lo que contestó Last.fm en este navegador, así que la búsqueda se ha parado.</p>
        <p class="mapa-ayuda">Seguir pidiendo sería gastar peticiones para nada. Recarga la página para volver a intentarlo.</p>${progreso}`;
      break;
    case 'ocupado':
      cuerpo = `<p class="mapa-estado-t">Ya hay una búsqueda de géneros en marcha en otra pestaña de este navegador.</p>
        <p class="mapa-ayuda">Para no pedirle el doble a Last.fm, aquí no se busca. Cuando termine allí, aprieta «Seguir».</p>${progreso}`;
      botones = seguir;
      break;
    case 'error':
      cuerpo = `<p class="mapa-estado-t">La búsqueda se ha cortado por un error: ${escapeHtml(st.error || '')}</p>${progreso}`;
      botones = seguir;
      break;
    default:
      if (pendientes === 0) {
        cuerpo = `<p class="mapa-estado-t">Búsqueda terminada.</p>${progreso}${s.peticiones ? medidas() : ''}${s.noSePudo.size
          ? `<p class="mapa-ayuda">${plural(s.noSePudo.size, 'artista no se ha podido consultar', 'artistas no se han podido consultar')}; se volverán a intentar la próxima vez que abras esta página.</p>` : ''}`;
      } else if (!hayAlgo) {
        cuerpo = `<p class="mapa-estado-t">Todavía no has buscado ningún género.</p>
          <p class="mapa-ayuda">La búsqueda le pregunta a Last.fm por las etiquetas de tus ${plural(c.universo, 'artista', 'artistas')} con ${MIN_MINUTOS} minutos o más, de uno en uno y en orden de minutos. Puedes pararla cuando quieras: lo que ya esté buscado queda guardado en este navegador.</p>`;
        botones = seguir;
      } else {
        cuerpo = `<p class="mapa-estado-t">${st.estado === 'parado' ? 'Búsqueda parada.' : 'Búsqueda a medias.'} Lo que ya buscaste queda guardado.</p>${progreso}${s.peticiones ? medidas() : st.ritmo.artistas ? lineaFalta() : ''}`;
        botones = seguir;
      }
  }
  return { texto: `<h2 class="mapa-h2">La búsqueda</h2>${cuerpo}`, botones };
}
