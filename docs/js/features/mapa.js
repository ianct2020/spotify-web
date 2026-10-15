// #mapa — tus países (v=304, tanda 52). La fase 2 del mapa: una lista de tus
// países ordenados por minutos, con cuántos artistas tiene cada uno, y un bloque
// que dice la verdad sobre cuánto se sabe.
//
// v=305 (tanda 53): además, EL MUNDO. Un mapamundi en SVG entre «Cuánto se
// sabe» y «La búsqueda», cada país pintado por la parte de tus minutos que es
// suya (los cortes y la leyenda, en `util/mapa-mundo.js`, puro). La geometría es
// `util/mundo-110m.js`, generada una vez desde Natural Earth y commiteada, y se
// pide con `import()` SOLO al abrir esta vista. 🔴 La lista nunca depende del
// dibujo: si el `import()` falla, la vista sigue entera y lo dice en una línea.
// El SVG se arma UNA vez; al repintar solo cambia el `data-tono` de los países
// que cambiaron, dentro del mismo repintado por frame de siempre.
//
// De dónde sale cada cosa:
//   · los minutos y los temas, de `loadArtistTracks()` (`history-data.js`), que
//     pasa por `loadOne()`: el candado del owner y el historial importado de un
//     amigo, como `#records`. Sin datos, el MISMO cartel de bloqueo (el candado
//     de «pide los datos primero», no el de `isOwner()` por adelantado);
//   · el país, de MusicBrainz, con la regla de `util/mb-pais.js` (importada, no
//     copiada) a través de `util/mapa-paises.js` (la cuenta, pura) y
//     `util/mapa-escaneo.js` (el bucle, con la red inyectada). Acá solo se
//     enchufa el `fetch` real, IndexedDB, `navigator.locks` y el reloj, y se pinta.
//
// 🔴 ABRIR LA VISTA NO ESCANEA (la regla de v=261, aplicada a MusicBrainz). Abrir
// cuesta el `/me` de `loadOne()` y 0 peticiones a MusicBrainz: se pinta lo que
// haya en la caché. El escaneo arranca SOLO con el botón («Buscar países» la
// primera vez, «Seguir» si hay algo hecho, «Parar» mientras corre).
//
// 🔴 Al salir de la ruta el escaneo para: el `teardown` aborta la señal, y el
// bucle pregunta por la vigencia de la ruta después de cada `await` (un
// teardown no interrumpe un `await` en vuelo, v=174). Lo resuelto ya está
// guardado; al volver, «Seguir».
//
// ⚠️ La pestaña oculta NO está verificada. El bucle no encadena esperas (cada
// espera la sigue un `fetch`), pero en headless no se puede comprobar cómo se
// porta oculta: la pantalla pide dejarla a la vista y enseña el ritmo medido.

import { loadArtistTracks, isOwner, ownerLockedMessage } from './history-data.js?v=308';
import { getCurrentUserId } from '../api.js?v=308';
import { idbEntriesEnRango, idbSetCached, idbGetCachedRaw } from '../idb.js?v=308';
import { escapeHtml, pageHeader } from '../ui/components.js?v=308';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=308';
import { armarMapa, universo, claveArtista, claveArea, claveRitmo, PREFIJO_ARTISTA, PREFIJO_AREA, MIN_MINUTOS } from '../util/mapa-paises.js?v=308';
import { escanear, conCandado, peticionesPorMinuto, estimarLoQueFalta, textoLoQueFalta, ritmoDesde, sumarPeticion, sumarArtista, MIN_ARTISTAS_ESTIMAR } from '../util/mapa-escaneo.js?v=308';
import { armarMundo, textoDetalle, textoNoSeVen, etiquetaMapa, leyenda } from '../util/mapa-mundo.js?v=308';

// Números con `es-ES` explícito: sin el locale se usa el del navegador (es-AR
// en las máquinas de Ian) y salen dos formatos en la misma pantalla.
const fmt = (n, dec = 0) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtMin = (decimas) => `${fmt(Math.round(decimas / 10))} min`;
const fmtPct = (parte, total) => `${fmt(total ? (parte / total) * 100 : 0, 1)} %`;
const plural = (n, uno, varios) => `${fmt(n)} ${n === 1 ? uno : varios}`;

// El nombre del país sale del navegador (`Intl.DisplayNames`), nunca de una
// tabla escrita o bajada: la regla del país prohíbe tablas de nombres.
let traductor = null;
function nombrePais(codigo) {
  try {
    traductor = traductor || new Intl.DisplayNames(['es-ES'], { type: 'region' });
    return traductor.of(codigo) || codigo;
  } catch {
    return codigo;
  }
}

// La tanda en curso de ESTA pestaña. Al volver a la ruta mientras la anterior
// termina de abortar, se espera a que suelte el candado antes de pedirlo: si
// no, esta pestaña se diría a sí misma «hay otra búsqueda en marcha».
let enCurso = null;

// Medidas del repintado, para el banco (`tests/banco/mapa.html`). `montajeMs` es
// lo que cuesta armar el SVG del mundo y ponerle los tonos (una vez por render)
// y `registros`, cada repintado con su tiempo y si ya estaba el mundo.
const perf = { pintados: 0, ultimoMs: 0, maxMs: 0, montajeMs: null, montajes: 0, registros: [] };
if (typeof window !== 'undefined') window.__mapaPerf = perf;

async function leerCache(uid) {
  const [arts, areas, ritmo] = await Promise.all([
    idbEntriesEnRango(`${PREFIJO_ARTISTA}${uid}_`),
    idbEntriesEnRango(PREFIJO_AREA),
    idbGetCachedRaw(claveRitmo(uid)).catch(() => null),
  ]);
  const artistas = new Map();
  for (const [, w] of arts) {
    const v = w?.value;
    // El uid va también DENTRO del valor: un uid que sea prefijo de otro
    // («abc» y «abc_x») compartiría el rango de claves.
    if (v && v.v === 1 && v.uid === uid && typeof v.nombre === 'string') artistas.set(v.nombre, v);
  }
  const mapaAreas = new Map();
  for (const [k, w] of areas) {
    if (w?.value && typeof w.value === 'object') mapaAreas.set(k.slice(PREFIJO_AREA.length), w.value);
  }
  // v=306: lo medido del ritmo, acumulado entre cargas (ver «Lo que falta» en
  // `util/mapa-escaneo.js`). El uid va también dentro, como en el del artista.
  return { artistas, areas: mapaAreas, ritmo: ritmo?.uid === uid ? ritmoDesde(ritmo) : ritmoDesde(null) };
}

// El reloj de verdad. Una espera que se corta si se para el escaneo.
const reloj = {
  ahora: () => Date.now(),
  esperar: (ms, signal) => new Promise((res) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
  }),
};

// La red de verdad, SIN ninguna cabecera propia: una cabecera que no sea de las
// simples provoca una petición OPTIONS previa por cada pedido, o sea el doble
// contra MusicBrainz (y el `User-Agent` es una cabecera que `fetch` no deja
// fijar en Chrome). `fmt=json` va en la URL.
async function pedirMB(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (res.status !== 200) return { status: res.status, datos: null };
  try {
    return { status: 200, datos: await res.json() };
  } catch {
    return { status: 200, datos: null };   // el bucle lo trata como un fallo de MusicBrainz
  }
}

export async function render(container) {
  const ruta = vigilarRuta();
  // La geometría del mundo (~73 KB) se pide al abrir ESTA vista, en paralelo con
  // el historial: abrir la app no la baja. Nunca rechaza: un fallo vuelve como
  // `{ error }` y la vista sigue sin el dibujo.
  const mundoP = import('../util/mundo-110m.js?v=308').then((mod) => ({ mod }), (error) => ({ error }));
  container.innerHTML = `
    ${pageHeader({ title: 'Tus países' })}
    <div id="mapa-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  const datos = await loadArtistTracks();
  if (!ruta.vigente()) return;
  const content = document.getElementById('mapa-content');
  if (!content) return;
  if (!datos || !datos.totals) {
    const propio = await isOwner();
    if (!ruta.vigente()) return;
    content.innerHTML = propio
      ? `<div class="card"><p>No he podido cargar tu historial. Vuelve a intentarlo.</p></div>`
      : ownerLockedMessage('El mapa');
    return;
  }

  // Memoizado: el `/me` ya lo pagó `loadOne()`. 0 peticiones más.
  const uid = await getCurrentUserId();
  if (!ruta.vigente()) return;
  const cache = await leerCache(uid);
  if (!ruta.vigente()) return;

  const st = {
    uid, totals: datos.totals,
    lista: universo(datos.totals, datos.artists),
    artistas: cache.artistas, areas: cache.areas,
    ritmo: cache.ritmo,          // v=306: lo medido, ACUMULADO entre cargas (IndexedDB)
    estado: 'quieto',            // quieto · escaneando · pausa · ocupado · terminado · parado · error
    error: null,
    ctrl: null,
    abiertos: new Set(),
    html: {},                    // lo último escrito en cada sección, para no repintar lo igual
    pintando: false,
    ultimoMapa: null,            // la última cuenta de `armarMapa` (la usa el mundo al armarse)
    mundo: null,                 // el SVG ya armado y los tonos aplicados (ver montarMundo)
    sesion: { peticiones: 0, porTipo: { busqueda: 0, respaldo: 0, area: 0, grabacion: 0 }, n503: 0, otrosFallos: 0, comienzos: [], desdeUltimo: null, noSePudo: new Set() },
  };

  content.innerHTML = `<div class="mapa">
    <section class="card mapa-cobertura" data-seccion="cobertura"></section>
    <section class="card mapa-mundo" data-mundo="cargando">${htmlMundoMarco()}</section>
    <section class="card mapa-escaneo"><div data-seccion="escaneo"></div><div class="mapa-botones" data-seccion="botones"></div></section>
    <section class="mapa-paises" data-seccion="paises"></section>
    <section class="mapa-sinpais-sec" data-seccion="sinpais"></section>
  </div>`;
  const raiz = content.querySelector('.mapa');

  // Los <details> que el usuario abrió siguen abiertos al repintar. `toggle` no
  // burbujea: se escucha en la fase de captura.
  raiz.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.abrible) return;
    if (d.open) st.abiertos.add(d.dataset.abrible); else st.abiertos.delete(d.dataset.abrible);
  }, true);
  raiz.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mapa-accion]');
    if (!b || b.disabled) return;
    if (b.dataset.mapaAccion === 'buscar') arrancar(raiz, st, ruta);
    else if (b.dataset.mapaAccion === 'parar') st.ctrl?.abort();
  });

  pintar(raiz, st, ruta);
  mundoP.then((r) => montarMundo(raiz, st, ruta, r));
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
    // Con el candado en la mano, se relee la caché: otra pestaña pudo haber
    // resuelto artistas mientras esta miraba, y no se vuelven a pedir.
    const c = await leerCache(st.uid);
    if (ctrl.signal.aborted || !ruta.vigente()) return { motivo: 'parado' };
    for (const [k, v] of c.artistas) st.artistas.set(k, v);
    for (const [k, v] of c.areas) st.areas.set(k, v);
    // Lo acumulado, también releído: otra pestaña pudo haber medido mientras tanto.
    if (c.ritmo.artistas >= st.ritmo.artistas) st.ritmo = c.ritmo;
    // La duración de cada artista se mide desde el anterior (o desde acá): solo
    // tiempo de búsqueda activa, nunca el que la página estuvo quieta.
    st.sesion.desdeUltimo = Date.now();
    const guardarRitmo = () => { idbSetCached(claveRitmo(st.uid), { ...st.ritmo, uid: st.uid }, null).catch(() => {}); };
    return escanear({
      lista: st.lista, artistas: st.artistas, areas: st.areas,
      pedir: pedirMB, reloj, signal: ctrl.signal,
      seguir: () => ruta.vigente(),
      saltar: st.sesion.noSePudo,
      guardarArtista: (nombre, reg) => idbSetCached(claveArtista(st.uid, nombre), { ...reg, uid: st.uid }, null),
      guardarArea: (id, area) => idbSetCached(claveArea(id), area, null),
      onPeticion: (p) => {
        const s = st.sesion;
        s.peticiones++;
        s.porTipo[p.tipo] = (s.porTipo[p.tipo] || 0) + 1;
        s.comienzos.push(p.comienzo);
        if (p.status === 503) s.n503++;
        else if (p.status !== 200) s.otrosFallos++;
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
  else if (r.candado === 'error') { st.estado = 'error'; st.error = String(r.error?.message || r.error); }
  else {
    const m = r.valor?.motivo;
    st.estado = m === 'completo' ? 'terminado' : m === 'pausa' ? 'pausa' : 'parado';
  }
  pintar(raiz, st, ruta);
}

// ── Pintar ───────────────────────────────────────────────────────────────────

// A lo sumo un repintado por frame. `requestAnimationFrame` no corre en una
// pestaña oculta (ni en headless con `--dump-dom`, medido en
// `tests/banco/esperar.mjs`), así que va con un `setTimeout` de respaldo: el
// que llegue primero pinta y el otro no hace nada.
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
  const t0 = performance.now();
  const m = armarMapa({ totals: st.totals, lista: st.lista, artistas: st.artistas, areas: st.areas, nombrePais });
  st.ultimoMapa = m;   // para que el mundo, al armarse, pinte sin rehacer la cuenta
  const esc = htmlEscaneo(m, st);
  const secciones = {
    cobertura: htmlCobertura(m, st),
    escaneo: esc.texto,
    botones: esc.botones,
    paises: htmlPaises(m, st),
    sinpais: htmlSinPais(m, st),
  };
  for (const [k, html] of Object.entries(secciones)) {
    if (st.html[k] === html) continue;
    st.html[k] = html;
    const el = raiz.querySelector(`[data-seccion="${k}"]`);
    if (el) el.innerHTML = html;
  }
  if (st.mundo) pintarMundo(st, m);
  const f = m.filas;
  raiz.dataset.estado = st.estado;
  raiz.dataset.escaneados = String(m.escaneados);
  raiz.dataset.universo = String(m.universo);
  raiz.dataset.conPais = String(m.conPaisArtistas);
  raiz.dataset.total = String(m.total);
  raiz.dataset.filas = [f.conPais, f.sinPais, f.sinConfirmar, f.sinEscanear, f.menos10].join(',');
  const ms = performance.now() - t0;
  perf.pintados++;
  perf.ultimoMs = ms;
  perf.maxMs = Math.max(perf.maxMs, ms);
  if (perf.registros.length < 2000) perf.registros.push({ ms, mundo: !!st.mundo });
}

// ── El mundo ─────────────────────────────────────────────────────────────────

const AYUDA_MUNDO = 'Pasa el ratón por un país o tócalo para ver sus minutos.';

// El marco de la sección: el lienzo (vacío hasta que llega la geometría, con la
// proporción del dibujo reservada), la línea de detalle, la leyenda y la línea
// de lo que no se ve. Va UNA vez: el repintado no reescribe esta sección.
function htmlMundoMarco() {
  const l = leyenda();
  return `
    <h2 class="mapa-h2">El mapa</h2>
    <div class="mapa-mundo-lienzo"></div>
    <p class="mapa-mundo-detalle">${AYUDA_MUNDO}</p>
    <div class="mapa-mundo-leyenda">
      <p class="mapa-mundo-leyenda-t">${escapeHtml(l.titulo)}</p>
      <ul class="mapa-mundo-tonos">
        ${l.tonos.map((t) => `<li><span class="mapa-mundo-muestra" data-tono="${t.tono}" aria-hidden="true"></span>${escapeHtml(t.texto)}</li>`).join('')}
      </ul>
      <p class="mapa-mundo-frase">${escapeHtml(l.frase)}</p>
    </div>
    <p class="mapa-mundo-noseven" hidden></p>`;
}

// Arma el SVG una vez, con todos los países en «sin datos», y le aplica los
// tonos con un repintado. Si la geometría no llegó, una línea y nada más: la
// lista de abajo no depende del dibujo.
function montarMundo(raiz, st, ruta, r) {
  if (!ruta.vigente() || !raiz.isConnected) return;
  const sec = raiz.querySelector('.mapa-mundo');
  const lienzo = sec?.querySelector('.mapa-mundo-lienzo');
  if (!sec || !lienzo) return;
  const formas = r?.mod?.FORMAS;
  if (r?.error || !Array.isArray(formas) || !r.mod.VIEWBOX) {
    sec.dataset.mundo = 'error';
    lienzo.classList.add('is-sin-dibujo');
    lienzo.innerHTML = '<p class="mapa-mundo-detalle">No se ha podido cargar el dibujo del mapa. La lista de países de abajo está completa.</p>';
    for (const s of ['.mapa-mundo-lienzo + .mapa-mundo-detalle', '.mapa-mundo-leyenda', '.mapa-mundo-noseven']) sec.querySelector(s)?.remove();
    return;
  }
  const t0 = performance.now();
  // Los `d` solo traen números, «M», «l», «z» y espacios, y los códigos son dos
  // letras (lo vigila `tests/mundo-geometria.test.mjs`): no hay nada que escapar.
  lienzo.innerHTML = `<svg class="mapa-mundo-svg" viewBox="${r.mod.VIEWBOX}" role="img" aria-label="${escapeHtml(etiquetaMapa(null))}" xmlns="http://www.w3.org/2000/svg">${
    formas.map((f) => (f.iso ? `<path data-iso="${f.iso}" data-tono="0" d="${f.d}"/>` : `<path d="${f.d}"/>`)).join('')
  }</svg>`;
  const svg = lienzo.firstElementChild;
  const porIso = new Map();
  for (const p of svg.querySelectorAll('path[data-iso]')) porIso.set(p.dataset.iso, p);
  st.mundo = {
    formas, svg, porIso,
    aplicados: new Map([...porIso.keys()].map((iso) => [iso, 0])),
    etiqueta: null, noSeVen: null, activo: null, w: null,
    detalle: sec.querySelector('.mapa-mundo-lienzo + .mapa-mundo-detalle'),
    noseven: sec.querySelector('.mapa-mundo-noseven'),
  };
  conectarMundo(raiz, st, ruta);
  // Los tonos con la última cuenta del repintado: rehacer `armarMapa` acá costaba
  // otro repintado entero (~70-90 ms con 2.302 artistas) para no cambiar nada.
  if (st.ultimoMapa) pintarMundo(st, st.ultimoMapa); else pintar(raiz, st, ruta);
  perf.montajeMs = performance.now() - t0;
  perf.montajes++;
  sec.dataset.mundo = 'listo';
}

// Los tonos de hoy: solo se toca el `data-tono` de los países que cambiaron.
function pintarMundo(st, m) {
  const mm = st.mundo;
  const w = armarMundo(m, mm.formas, nombrePais);
  mm.w = w;
  for (const [iso, t] of w.tonos) {
    if (mm.aplicados.get(iso) === t) continue;
    mm.aplicados.set(iso, t);
    mm.porIso.get(iso)?.setAttribute('data-tono', String(t));
  }
  const et = etiquetaMapa(w);
  if (et !== mm.etiqueta) { mm.etiqueta = et; mm.svg.setAttribute('aria-label', et); }
  const nv = textoNoSeVen(w);
  if (nv !== mm.noSeVen && mm.noseven) { mm.noSeVen = nv; mm.noseven.textContent = nv; mm.noseven.hidden = !nv; }
  if (mm.activo) escribirDetalle(mm, mm.activo);
}

function escribirDetalle(mm, iso) {
  const txt = iso && mm.w ? textoDetalle(iso, mm.w, nombrePais) : AYUDA_MUNDO;
  if (mm.detalle && mm.detalle.textContent !== txt) mm.detalle.textContent = txt;
}

// Pasar el ratón o tocar un país escribe en la línea de detalle, DEBAJO del
// mapa (una caja flotante, en el móvil, la tapa el dedo). Hacer clic en un país
// con minutos abre su fila de la lista y la lleva a la vista. Los países no son
// focusables (serían 174 paradas de tabulador): la versión accesible es la lista.
function conectarMundo(raiz, st, ruta) {
  const mm = st.mundo;
  const activar = (iso) => {
    if (mm.activo === iso) { escribirDetalle(mm, iso); return; }
    if (mm.activo) mm.porIso.get(mm.activo)?.classList.remove('is-activo');
    mm.activo = iso;
    if (iso) mm.porIso.get(iso)?.classList.add('is-activo');
    escribirDetalle(mm, iso);
  };
  mm.svg.addEventListener('pointerover', (e) => {
    if (!ruta.vigente()) return;
    activar(e.target.closest?.('path[data-iso]')?.dataset.iso || null);
  });
  // Con el dedo, el `pointerleave` llega justo después de soltar: la línea se
  // quedaría en blanco antes de poder leerla. Solo el ratón la limpia al salir.
  mm.svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && ruta.vigente()) activar(null); });
  mm.svg.addEventListener('click', (e) => {
    if (!ruta.vigente()) return;
    const iso = e.target.closest?.('path[data-iso]')?.dataset.iso;
    if (!iso) return;
    activar(iso);
    if (!(mm.aplicados.get(iso) > 0)) return;   // sin datos: solo la línea de detalle
    const li = raiz.querySelector(`.mapa-pais[data-codigo="${iso}"]`);
    const d = li?.querySelector('details');
    if (!d) return;
    st.abiertos.add(`pais-${iso}`);
    d.open = true;
    li.scrollIntoView({ block: 'center' });
  });
}

function htmlCobertura(m, st) {
  const f = m.filas;
  const filas = [
    ['con-pais', 'Con país', 'MusicBrainz lo sitúa en un país y está confirmado', f.conPais],
    ['sin-pais', 'Sin país', 'Buscados, pero MusicBrainz no da un país seguro', f.sinPais],
    ['sin-confirmar', 'Sin confirmar', 'Hay un país, pero la búsqueda de su tema no lo confirma', f.sinConfirmar],
    ['sin-escanear', 'Sin buscar todavía', `Artistas con ${MIN_MINUTOS} minutos o más`, f.sinEscanear],
    ['menos10', `Menos de ${MIN_MINUTOS} minutos`, 'No se buscan', f.menos10],
  ];
  const noSePudo = st.sesion.noSePudo.size;
  return `
    <h2 class="mapa-h2">Cuánto se sabe</h2>
    <table class="mapa-filas">
      <tbody>
        ${filas.map(([k, t, d, dec]) => `<tr data-fila="${k}">
          <th scope="row"><span class="mapa-fila-t">${t}</span><span class="mapa-fila-d">${d}</span></th>
          <td class="mapa-num">${fmtMin(dec)}</td>
          <td class="mapa-num mapa-pct">${fmtPct(dec, m.total)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><th scope="row">Todo tu historial</th><td class="mapa-num">${fmtMin(m.total)}</td><td class="mapa-num mapa-pct">100,0 %</td></tr></tfoot>
    </table>
    <p class="mapa-artistas">
      <strong>${fmt(m.escaneados)}</strong> de ${plural(m.universo, 'artista buscado', 'artistas buscados')} ·
      de <strong>${fmt(m.conPaisArtistas)}</strong> se sabe el país${noSePudo ? ` · ${plural(noSePudo, 'no se ha podido consultar', 'no se han podido consultar')} en esta sesión` : ''}
    </p>
    <p class="mapa-nota">Los minutos sin país no se reparten entre los países: cada país enseña solo lo que se sabe de él, en % de todo tu historial.</p>`;
}

function htmlEscaneo(m, st) {
  const s = st.sesion;
  const pendientes = Math.max(0, m.pendientes - [...s.noSePudo].filter((n) => m.estados.get(n)?.falta).length);
  const boton = (accion, texto, primario = true) =>
    `<button class="btn ${primario ? 'btn-primary' : 'btn-secondary'} btn-sm" data-mapa-accion="${accion}">${texto}</button>`;
  const hayAlgo = m.escaneados > 0 || st.artistas.size > 0;
  const seguir = pendientes > 0 ? boton('buscar', hayAlgo ? 'Seguir' : 'Buscar países') : '';

  // v=306: lo que falta sale de lo ACUMULADO entre cargas (`st.ritmo`); por eso
  // se enseña también con la búsqueda a medias, antes de apretar «Seguir».
  // v=307: es un RANGO, la cota baja con el ritmo medido y la alta con una racha
  // de 503 entera de margen (ver «Lo que falta» en `util/mapa-escaneo.js`).
  const lineaFalta = () => {
    if (pendientes === 0) return '';
    const est = estimarLoQueFalta({ pendientes, ritmo: st.ritmo });
    if (!est) {
      return `<p class="mapa-estimacion">Lo que falta se estimará cuando se hayan buscado ${fmt(MIN_ARTISTAS_ESTIMAR)} artistas (van ${fmt(st.ritmo.artistas)}).</p>`;
    }
    return `<p class="mapa-estimacion">${escapeHtml(textoLoQueFalta(est))}</p>`;
  };
  const medidas = () => {
    const ahora = Date.now();
    const ritmo = peticionesPorMinuto(s.comienzos, ahora);
    const partes = [
      `${plural(s.peticiones, 'petición', 'peticiones')} a MusicBrainz en esta sesión`,
      `${plural(s.n503, 'respuesta 503', 'respuestas 503')}`,
    ];
    if (s.otrosFallos) partes.push(plural(s.otrosFallos, 'otro fallo', 'otros fallos'));
    if (ritmo !== null) partes.push(`ritmo medido: ${fmt(ritmo, 1)} peticiones por minuto (últimos 3 minutos)`);
    return `<p class="mapa-medidas">${partes.join(' · ')}</p>${lineaFalta()}`;
  };

  const progreso = `<p class="mapa-progreso"><strong>${fmt(m.escaneados)}</strong> de ${plural(m.universo, 'artista', 'artistas')}</p>`;
  let cuerpo, botones = '';
  switch (st.estado) {
    case 'escaneando':
      cuerpo = `<p class="mapa-estado-t">Buscando países en MusicBrainz…</p>${progreso}${medidas()}
        <p class="mapa-aviso">Deja esta pestaña a la vista mientras busca: si está oculta, el navegador puede frenarla.</p>`;
      botones = boton('parar', 'Parar', false);
      break;
    case 'pausa':
      cuerpo = `<p class="mapa-estado-t">MusicBrainz no contesta ahora; lo que ya buscaste queda guardado.</p>${progreso}${medidas()}`;
      botones = seguir;
      break;
    case 'ocupado':
      cuerpo = `<p class="mapa-estado-t">Ya hay una búsqueda en marcha en otra pestaña de este navegador.</p>
        <p class="mapa-ayuda">Para no pedirle el doble a MusicBrainz, aquí no se busca. Cuando termine allí, aprieta «Seguir».</p>${progreso}`;
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
        cuerpo = `<p class="mapa-estado-t">Todavía no has buscado ningún país.</p>
          <p class="mapa-ayuda">La búsqueda le pregunta a MusicBrainz por tus ${plural(m.universo, 'artista', 'artistas')} con ${MIN_MINUTOS} minutos o más, de uno en uno y en orden de minutos, y la lista se va llenando a medida que llegan. Puedes pararla cuando quieras: lo que ya esté buscado queda guardado en este navegador.</p>`;
        botones = seguir;
      } else {
        cuerpo = `<p class="mapa-estado-t">${st.estado === 'parado' ? 'Búsqueda parada.' : 'Búsqueda a medias.'} Lo que ya buscaste queda guardado.</p>${progreso}${s.peticiones ? medidas() : st.ritmo.artistas ? lineaFalta() : ''}`;
        botones = seguir;
      }
  }
  return { texto: `<h2 class="mapa-h2">La búsqueda</h2>${cuerpo}`, botones };
}

function htmlPaises(m, st) {
  if (!m.paises.length) {
    return `<h2 class="mapa-h2">Países</h2><p class="mapa-vacio">${m.escaneados ? 'Todavía ninguno de los artistas buscados tiene un país confirmado.' : 'Aquí aparecerán tus países a medida que se busquen tus artistas.'}</p>`;
  }
  return `<h2 class="mapa-h2">Países <span class="mapa-cuenta">${fmt(m.paises.length)}</span></h2>
    <ol class="mapa-lista">
      ${m.paises.map((p) => `<li class="mapa-pais" data-codigo="${escapeHtml(p.codigo)}">
        <details data-abrible="pais-${escapeHtml(p.codigo)}"${st.abiertos.has(`pais-${p.codigo}`) ? ' open' : ''}>
          <summary>
            <span class="mapa-pais-n">${escapeHtml(p.nombre)}</span>
            <span class="mapa-num">${fmtMin(p.decimas)}</span>
            <span class="mapa-num mapa-pct">${fmtPct(p.decimas, m.total)}</span>
            <span class="mapa-num mapa-pais-a">${plural(p.artistas.length, 'artista', 'artistas')}</span>
          </summary>
          <ol class="mapa-artistas-lista">
            ${p.artistas.map((a) => `<li><span class="mapa-art-n">${escapeHtml(a.nombre)}</span>${a.paisDe === 'area' ? '<span class="mapa-art-d">por su ciudad o región</span>' : ''}<span class="mapa-num">${fmtMin(a.decimas)}</span></li>`).join('')}
          </ol>
        </details>
      </li>`).join('')}
    </ol>`;
}

function htmlSinPais(m, st) {
  if (!m.sinPais.length) return '';
  const dec = m.sinPais.reduce((s, x) => s + x.decimas, 0);
  return `<details class="card mapa-sinpais" data-abrible="sinpais"${st.abiertos.has('sinpais') ? ' open' : ''}>
    <summary><span class="mapa-pais-n">Sin país</span><span class="mapa-num">${plural(m.sinPais.length, 'artista', 'artistas')} · ${fmtMin(dec)}</span></summary>
    <ul class="mapa-artistas-lista">
      ${m.sinPais.map((x) => `<li data-categoria="${x.categoria}"><span class="mapa-art-n">${escapeHtml(x.nombre)}</span><span class="mapa-num">${fmtMin(x.decimas)}</span><span class="mapa-motivo">${escapeHtml(x.motivo)}</span></li>`).join('')}
    </ul>
  </details>`;
}
