// #generos — tus géneros (v=313 el escaneo, tanda 61; v=314 los géneros, tanda 62).
//
// El escaneo le pide a Last.fm las etiquetas de cada artista del HISTORIAL (`universo()` de
// `util/mapa-paises.js`, ≥ 10 min); «Cuánto se sabe» dice cuánto se sabe, en cinco filas; y desde
// v=314 «Tus 10 géneros» enseña lo que ya está guardado, con la regla de `util/generos-regla.js`
// (todas las etiquetas de género, sin repartir minutos: un artista cuenta ENTERO en cada uno de
// sus géneros, y el % es sobre todo el historial). Los «sin buscar todavía» no se reparten. El
// escaneo (el bucle, el ritmo, las esperas, el candado, el teardown) no cambió en v=314.
// `#genre` (la vista vieja, sobre los me gusta) no se tocó.
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
// Desplegar un género, «Ver todos» y «Mostrar 100 más» = 0 peticiones: todo sale de lo guardado.
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

import { loadArtistTracks, isOwner, ownerLockedMessage } from './history-data.js?v=320';
import { getCurrentUserId } from '../api.js?v=320';
import { getKey, cargarEtiquetas, registroEtiquetas, setCachedTags } from '../api/lastfm.js?v=320';
import { idbEntriesEnRango, idbSetCached, idbGetCachedRaw } from '../idb.js?v=320';
import { escapeHtml, pageHeader } from '../ui/components.js?v=320';
import { vigilarRuta } from '../util/vigencia-ruta.js?v=320';
import { universo, MIN_MINUTOS } from '../util/mapa-paises.js?v=320';
import { prefijoGeneros } from '../util/generos-artista.js?v=320';
import { peticionesPorMinuto, estimarLoQueFalta, ritmoDesde, sumarPeticion, sumarArtista, MIN_ARTISTAS_ESTIMAR } from '../util/mapa-escaneo.js?v=320';
import { escanearGeneros, conCandado, armarCobertura, yaBuscado, urlEtiquetas, claveRitmo, textoLoQueFalta } from '../util/generos-escaneo.js?v=320';
import { armarGeneros } from '../util/generos-regla.js?v=320';

// Números con `es-ES` explícito: sin el locale se usa el del navegador (es-AR en las máquinas
// de Ian) y salen dos formatos en la misma pantalla.
const fmt = (n, dec = 0) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtMin = (decimas) => `${fmt(Math.round(decimas / 10))} min`;
const plural = (n, uno, varios) => `${fmt(n)} ${n === 1 ? uno : varios}`;
const fmtPct = (parte, total) => `${fmt(total ? (parte / total) * 100 : 0, 1)} %`;

// Los géneros que se enseñan arriba, y los artistas de un género de a cuántos (como `#puertas`).
const TOP = 10;
const POR_PAGINA = 100;

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
    // Los géneros (v=314): qué está abierto (para lo que se crea de nuevo; lo ya pintado manda el DOM),
    // cuántos artistas se enseñan de cada género abierto, y los nodos de cada lista por género.
    abiertos: new Set(),
    mostrados: new Map(),
    nodos: { top: new Map(), todos: new Map() },
    generosModo: null,
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
    <section class="card generos-lista" data-seccion="generos"></section>
    <section class="card generos-escaneo"><div data-seccion="escaneo"></div><div class="mapa-botones" data-seccion="botones"></div></section>
  </div>`;
  const raiz = content.querySelector('.generos');
  // Los `<details>` que se abren y se cierran: `toggle` no burbujea, se escucha en la captura. Al abrir un
  // género se pintan sus artistas (no antes: miles de filas cerradas son mucho DOM para nada).
  raiz.addEventListener('toggle', (e) => {
    const d = e.target;
    const clave = d instanceof HTMLDetailsElement ? d.dataset.generoClave : null;
    if (!clave) return;
    if (d.open) st.abiertos.add(clave); else st.abiertos.delete(clave);
    pintar(raiz, st, ruta);
  }, true);
  raiz.addEventListener('click', (e) => {
    const b = e.target.closest('[data-generos-accion]');
    if (!b || b.disabled) return;
    if (b.dataset.generosAccion === 'buscar') arrancar(raiz, st, ruta);
    else if (b.dataset.generosAccion === 'parar') st.ctrl?.abort();
    else if (b.dataset.generosAccion === 'mas') {
      const clave = b.dataset.clave;
      st.mostrados.set(clave, (st.mostrados.get(clave) || POR_PAGINA) + POR_PAGINA);
      pintar(raiz, st, ruta);
    }
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
  const g = armarGeneros({ totals: st.totals, lista: st.lista, registro: st.registro });
  const sec = raiz.querySelector('[data-seccion="generos"]');
  if (sec) pintarGeneros(sec, g, c, st);
  const f = c.filas;
  const filas = [f.conGeneros, f.sinGenero, f.noTiene, f.sinBuscar, f.menos10];
  raiz.dataset.estado = st.estado;
  raiz.dataset.universo = String(c.universo);
  raiz.dataset.pendientes = String(c.pendientes);
  raiz.dataset.total = String(c.total);
  raiz.dataset.filas = filas.map((x) => x.decimas).join(',');
  raiz.dataset.artistas = filas.map((x) => x.artistas).join(',');
  raiz.dataset.generos = String(g.generos.length);
}

// ── Los géneros (v=314) ──────────────────────────────────────────────────────
//
// No se rehace la sección en cada respuesta de la búsqueda: cada género es un `<li>` que se crea una vez y
// después solo se le cambia lo que cambió (el resumen, sus artistas si está abierto) y, si hace falta, el
// sitio. Así un género abierto sigue siendo EL MISMO elemento mientras la lista crece, con su foco. Lo que
// manda si está abierto es el DOM (`details.open`); `st.abiertos` solo sirve para lo que se crea de nuevo.

function pintarGeneros(el, g, c, st) {
  const modo = g.generos.length ? 'lista' : 'vacio';
  if (st.generosModo !== modo) {
    st.generosModo = modo;
    st.nodos = { top: new Map(), todos: new Map() };
    st.html.generos = {};
    el.innerHTML = modo === 'vacio'
      ? `<h2 class="mapa-h2">Géneros</h2><p class="mapa-vacio" data-parte="vacio"></p>`
      : `<h2 class="mapa-h2" data-parte="titulo"></h2>
        <p class="mapa-nota generos-medias" data-parte="medias" hidden></p>
        <ol class="mapa-lista generos-top" data-lista="top"></ol>
        <p class="mapa-nota generos-suma">Un artista cuenta en todos sus géneros, así que los porcentajes suman más de 100.</p>
        <details class="generos-todos" data-genero-clave="todos" hidden><summary data-parte="ver-todos"></summary><ol class="mapa-lista" data-lista="todos"></ol></details>`;
    const todos = el.querySelector('.generos-todos');
    if (todos && st.abiertos.has('todos')) todos.open = true;
  }
  const partes = st.html.generos;
  const parte = (k, texto) => {
    if (partes[k] === texto) return;
    partes[k] = texto;
    const p = el.querySelector(`[data-parte="${k}"]`);
    if (!p) return;
    p.textContent = texto;
    if (p.hasAttribute('hidden') !== !texto) p.hidden = !texto;
  };
  if (modo === 'vacio') {
    parte('vacio', c.pendientes > 0
      ? 'Tus géneros saldrán aquí a medida que avance la búsqueda.'
      : 'Ninguno de los artistas buscados tiene una etiqueta de género.');
    return;
  }
  const n = g.generos.length;
  parte('titulo', n === 1 ? 'Tu género' : `Tus ${fmt(Math.min(TOP, n))} géneros`);
  // 🔴 Los «sin buscar todavía» no están en ningún género, ni repartidos: con la búsqueda a medias se dice.
  parte('medias', c.filas.sinBuscar.artistas > 0
    ? 'Son los géneros de los artistas ya buscados: los minutos «sin buscar todavía» no están en ningún género, así que los porcentajes irán creciendo.'
    : '');
  parchearLista(el.querySelector('[data-lista="top"]'), g.generos.slice(0, TOP), 'top', g.total, st);
  const todos = el.querySelector('.generos-todos');
  if (todos.hidden !== (n <= TOP)) todos.hidden = n <= TOP;
  parte('ver-todos', `Ver todos (${fmt(n)})`);
  parchearLista(todos.querySelector('[data-lista="todos"]'), todos.open && n > TOP ? g.generos : [], 'todos', g.total, st);
}

function parchearLista(ol, items, lista, total, st) {
  const viejos = st.nodos[lista];
  const nuevos = new Map();
  let antes = null;
  for (const x of items) {
    const clave = `${lista}:${x.genero}`;
    let n = viejos.get(x.genero);
    if (!n) {
      const li = document.createElement('li');
      li.className = 'mapa-pais generos-genero';
      li.dataset.genero = x.genero;
      li.innerHTML = `<details data-genero-clave="${escapeHtml(clave)}"><summary></summary><div class="generos-artistas"></div></details>`;
      n = { li, details: li.firstElementChild, summary: li.querySelector('summary'), cuerpo: li.querySelector('.generos-artistas'), resumen: null, artistas: null };
      if (st.abiertos.has(clave)) n.details.open = true;
    }
    const resumen = htmlResumen(x, total);
    if (n.resumen !== resumen) { n.summary.innerHTML = resumen; n.resumen = resumen; }
    const artistas = n.details.open ? htmlArtistas(x, clave, st) : '';
    if (n.artistas !== artistas) {
      // Si el foco estaba en «Mostrar 100 más», vuelve al botón nuevo (o al género, si ya no hay más).
      const conFoco = n.cuerpo.contains(document.activeElement);
      n.cuerpo.innerHTML = artistas;
      n.artistas = artistas;
      if (conFoco) (n.cuerpo.querySelector('[data-generos-accion="mas"]') || n.summary).focus({ preventScroll: true });
    }
    const sitio = antes ? antes.nextSibling : ol.firstChild;
    if (sitio !== n.li) ol.insertBefore(n.li, sitio);
    antes = n.li;
    nuevos.set(x.genero, n);
  }
  for (const [k, n] of viejos) if (!nuevos.has(k)) n.li.remove();
  st.nodos[lista] = nuevos;
}

function htmlResumen(x, total) {
  return `<span class="mapa-pais-n">${escapeHtml(x.genero)}</span>
    <span class="mapa-num">${fmtMin(x.decimas)}</span>
    <span class="mapa-num mapa-pct">${fmtPct(x.decimas, total)}</span>
    <span class="mapa-num mapa-pais-a">${plural(x.artistas.length, 'artista', 'artistas')}</span>`;
}

function htmlArtistas(x, clave, st) {
  const todos = x.artistas.length;
  const n = Math.min(st.mostrados.get(clave) || POR_PAGINA, todos);
  const filas = x.artistas.slice(0, n).map((a) => `<li><span class="mapa-art-n">${escapeHtml(a.nombre)}</span><span class="mapa-num">${fmtMin(a.decimas)}</span></li>`).join('');
  const pie = todos > POR_PAGINA
    ? `<div class="generos-pie"><span class="mapa-num">${fmt(n)} de ${plural(todos, 'artista', 'artistas')}</span>${n < todos
      ? `<button class="btn btn-secondary btn-sm" data-generos-accion="mas" data-clave="${escapeHtml(clave)}">Mostrar ${fmt(POR_PAGINA)} más</button>` : ''}</div>`
    : '';
  return `<ol class="mapa-artistas-lista">${filas}</ol>${pie}`;
}

function htmlCobertura(c, st) {
  const f = c.filas;
  // Cinco filas desde v=314: «con etiquetas, pero ninguna de género» va aparte, para que esos minutos no se
  // mezclen con «Last.fm dice que no tiene» (que incluye a los que Last.fm cambió por OTRO artista).
  const filas = [
    ['con-generos', 'Con géneros', 'Alguna etiqueta suya es un género', f.conGeneros],
    ['sin-genero', 'Con etiquetas, pero ninguna de género', 'Solo países, voces u otras que no son géneros', f.sinGenero],
    ['no-tiene', 'Last.fm dice que no tiene', 'Buscados, y sin ninguna etiqueta a su nombre', f.noTiene],
    ['sin-buscar', 'Sin buscar todavía', `Artistas con ${MIN_MINUTOS} minutos o más`, f.sinBuscar],
    ['menos10', `Menos de ${MIN_MINUTOS} minutos`, 'No se buscan', f.menos10],
  ];
  const todos = filas.reduce((s, x) => s + x[3].artistas, 0);
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
