// `#mapa-artistas` — el mapa de artistas (v=315, tanda 64).
//
// Los ~2.300 artistas de tu historial (`universo()`: ≥ 10 min) acomodados en un plano por parecido,
// según los «similares» de Last.fm, con el tamaño de cada uno según sus minutos. Las posiciones y
// los pares vienen HORNEADOS (`src/data/history-artist-similares.json`, por
// `scripts/hornear-similares.mjs`): acá no corre ninguna simulación ni se carga d3. La cuenta pura
// (leer el JSON, el toque, el zoom, los nombres, el buscador) vive en `util/mapa-artistas.js`.
//
// Lo que manda, y por qué (lo midió la tanda 63, ver `fonoteca-migracion/mapa-artistas/`):
//   · 🔴 Cada frame dibuja los puntos y, como mucho, las líneas del artista ELEGIDO. Un frame con
//     todas las líneas del grafo (~60.000) eran 270 ms a velocidad normal y 3,2 s con la CPU seis
//     veces más lenta; sin líneas, 8 y 49 ms. Nada de «las fuertes» ni de una capa precalculada:
//     rehacerla en cada zoom cuesta lo mismo.
//   · Se repinta solo cuando algo cambió, a lo sumo una vez por frame (rAF, con un `setTimeout` de
//     respaldo como `#mapa`: rAF no corre en una pestaña oculta ni en headless con `--dump-dom`).
//     Quieto, 0 frames.
//   · 🔴 El candado es el de `#records`/`#puertas` («pide los datos primero»): sin historial, el
//     cartel de siempre. Con historial pero sin mapa (un amigo con su BYOH: el horneado es solo
//     del owner), una línea y nada más.
//   · Abrir cuesta el `/me` de `loadOne()` (memoizado: las dos cargas lo comparten) y 0 de todo lo
//     demás: 0 a Last.fm, 0 a cualquier CDN. Tocar, arrastrar, hacer zoom, buscar y «Mostrar 50
//     más» no piden nada. «Ver ficha» abre la ficha de artista, y lo que cueste es de la ficha.
//   · Los colores salen del tema y se leen al pintar (`getComputedStyle`), así un cambio de paleta
//     se ve en el frame siguiente. Sin animaciones.
//   · Accesible por el buscador y el panel, que son HTML de verdad; el `<canvas>` es una imagen
//     con su `aria-label`.
//
// `window.__mapaArtistasDibujo` = `{ puntos, lineas, nombres, conNombre, ms, cuadros }` del último
// frame (los cuadros, acumulados; `conNombre`, los índices que llevaron nombre): lo lee el banco
// `tests/banco/mapa-artistas.html`, que afirma que sin elegido se dibujan 0 líneas y con uno,
// exactamente su grado, y que a «Ver todo» sale el nombre del de más minutos (puerta H, v=316). `window.__mapaArtistasBanco` es el
// instrumento del banco y de la medición de frames (pintar ya, sin esperar al frame): solo existe
// mientras la ruta está abierta.

import { loadArtistTracks, loadArtistSimilares, isOwner, ownerLockedMessage } from './history-data.js';
import { openArtistCard } from './artist-card.js';
import { escapeHtml, pageHeader } from '../ui/components.js';
import { vigilarRuta } from '../util/vigencia-ruta.js';
import {
  leerMapa, vistaTodo, zoomEn, mover, encuadrarElegido, tocar, nombresVisibles, buscar,
  mezclar, leerRgb, planoAPantalla, radioEnPantalla, POR_PAGINA,
} from '../util/mapa-artistas.js';

const num = (n) => Number(n || 0).toLocaleString('es-ES');
const min = (m) => `${num(Math.round(m))} min`;
const PASO_ZOOM = 1.5;
const MOVIDO_PX = 5;          // menos que esto entre bajar y subir el dedo es un toque, no un arrastre
const RESPALDO_MS = 100;

export async function render(container) {
  const ruta = vigilarRuta();
  container.innerHTML = `
    ${pageHeader({ title: 'Mapa de artistas' })}
    <div id="mapa-artistas-content"><div class="empty-state"><div class="spinner spinner-lg"></div></div></div>
  `;

  const datos = await loadArtistTracks();
  if (!ruta.vigente()) return;
  const content = document.getElementById('mapa-artistas-content');
  if (!content) return;
  if (!datos || !datos.totals) {
    const propio = await isOwner();
    if (!ruta.vigente()) return;
    content.innerHTML = propio
      ? '<div class="card"><p>No he podido cargar tu historial. Vuelve a intentarlo.</p></div>'
      : ownerLockedMessage('Mapa de artistas');
    return;
  }

  const similares = await loadArtistSimilares();
  if (!ruta.vigente() || !content.isConnected) return;
  const mapa = similares ? leerMapa(similares, datos.totals) : null;
  if (!mapa) {
    const propio = await isOwner();
    if (!ruta.vigente() || !content.isConnected) return;
    // Al owner no se le dice «no existe»: el horneado es suyo, y si no llegó es un fallo de la app
    // (v=154: un error no se disfraza de resultado).
    content.innerHTML = propio
      ? '<div class="card" data-mapa-artistas="error"><p>No he podido cargar el mapa. Vuelve a intentarlo.</p></div>'
      : '<p class="artmapa-nota" data-mapa-artistas="sin-mapa">El mapa todavía no existe para tu historial.</p>';
    return;
  }

  return montar(content, mapa, ruta);
}

function montar(content, mapa, ruta) {
  content.innerHTML = `<div class="artmapa" data-mapa-artistas="listo">
    <p class="artmapa-intro">Cada punto es un artista de tu historial: cuanto más grande, más lo has escuchado. Toca uno para ver a quién se parece.</p>
    <form class="artmapa-buscar" role="search">
      <input class="input artmapa-campo" type="search" placeholder="Busca un artista" aria-label="Buscar un artista en el mapa" autocomplete="off">
      <button class="btn btn-secondary" type="submit">Buscar</button>
      <span class="artmapa-aviso" aria-live="polite"></span>
    </form>
    <div class="artmapa-lienzo">
      <canvas class="artmapa-canvas" role="img" aria-label="Mapa de tus artistas: ${num(mapa.N)} artistas, ${num(mapa.aristas)} parecidos"></canvas>
      <div class="artmapa-zoom">
        <button class="btn btn-secondary" type="button" data-zoom="mas" aria-label="Acercar">+</button>
        <button class="btn btn-secondary" type="button" data-zoom="menos" aria-label="Alejar">−</button>
        <button class="btn btn-secondary" type="button" data-zoom="todo">Ver todo</button>
      </div>
    </div>
    <section class="artmapa-panel" data-panel aria-live="polite"></section>
    <p class="artmapa-pie">${mapa.aislados === 1 ? '1 artista no tiene' : `${num(mapa.aislados)} artistas no tienen`} ningún parecido en tu historial. Parecidos según <a href="https://www.last.fm" target="_blank" rel="noopener">Last.fm</a>.</p>
  </div>`;

  const raiz = content.querySelector('.artmapa');
  const canvas = raiz.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const panel = raiz.querySelector('[data-panel]');
  const campo = raiz.querySelector('.artmapa-campo');
  const aviso = raiz.querySelector('.artmapa-aviso');

  const st = {
    ancho: 0, alto: 0, dpr: 1, vista: null,
    elegido: -1, mostrados: POR_PAGINA,
    raf: 0, respaldo: 0, pendiente: false, vivo: true,
    punteros: new Map(), arrastre: null, pellizco: null,
    anchos: new Map(), fuente: '',
  };
  const dibujo = { puntos: 0, lineas: 0, nombres: 0, conNombre: [], ms: 0, cuadros: 0 };
  window.__mapaArtistasDibujo = dibujo;

  // ── El tamaño ─────────────────────────────────────────────────────────────
  function medirLienzo() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return false;
    const dpr = window.devicePixelRatio || 1;
    if (w === st.ancho && h === st.alto && dpr === st.dpr) return false;
    const antes = st.vista, enTodo = !antes || antes.escala <= antes.base * 1.0001;
    const centro = antes ? [(st.ancho / 2 - antes.tx) / antes.escala, (st.alto / 2 - antes.ty) / antes.escala] : null;
    st.ancho = w; st.alto = h; st.dpr = dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const todo = vistaTodo(mapa, w, h);
    if (enTodo) st.vista = todo;
    else {
      // Con zoom puesto: el mismo punto del plano en el centro, con el piso del zoom nuevo.
      const escala = Math.max(todo.base, antes.escala);
      st.vista = { base: todo.base, escala, tx: w / 2 - centro[0] * escala, ty: h / 2 - centro[1] * escala };
    }
    return true;
  }

  // ── Pintar ────────────────────────────────────────────────────────────────
  function programar() {
    if (st.pendiente || !st.vivo) return;
    st.pendiente = true;
    const una = () => {
      if (!st.pendiente) return;
      st.pendiente = false;
      cancelAnimationFrame(st.raf); clearTimeout(st.respaldo);
      pintar();
    };
    st.raf = requestAnimationFrame(una);
    st.respaldo = setTimeout(una, RESPALDO_MS);
  }

  function color(nombre) {
    // El token tal como lo resuelve el navegador (rgb), leído en CADA frame: cambia con la paleta.
    sonda.style.color = `var(${nombre})`;
    return leerRgb(getComputedStyle(sonda).color) || [128, 128, 128];
  }
  const sonda = document.createElement('span');
  sonda.hidden = true;
  raiz.appendChild(sonda);
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  function pintar() {
    // Ninguna escritura después de salir de la ruta.
    if (!st.vivo || !ruta.vigente() || !canvas.isConnected) return;
    const t0 = performance.now();
    medirLienzo();
    // Un lienzo que todavía mide 0 (el contenedor oculto) no tiene vista: no hay nada que pintar.
    if (!st.vista) return;
    const { ancho: w, alto: h, dpr, vista: v, elegido: sel } = st;
    const acento = color('--color-accent'), superficie = color('--color-surface');
    const secundario = color('--color-text-secondary'), texto = color('--color-text'), fondo = color('--color-bg');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const resaltados = new Set();
    if (sel >= 0) { resaltados.add(sel); for (const n of mapa.vecinos[sel]) resaltados.add(n.j); }
    const visible = (sx, sy, rp) => sx + rp >= 0 && sx - rp <= w && sy + rp >= 0 && sy - rp <= h;
    let puntos = 0;

    // 1. Los puntos de fondo, en un solo trazo: atenuados si hay un elegido.
    ctx.beginPath();
    for (let i = 0; i < mapa.N; i++) {
      if (resaltados.has(i)) continue;
      const [sx, sy] = planoAPantalla(v, mapa.x[i], mapa.y[i]);
      const rp = radioEnPantalla(mapa, i, v.escala);
      if (!visible(sx, sy, rp)) continue;
      ctx.moveTo(sx + rp, sy);
      ctx.arc(sx, sy, rp, 0, Math.PI * 2);
      puntos++;
    }
    ctx.fillStyle = rgb(mezclar(acento, superficie, sel >= 0 ? 0.22 : 0.6));
    ctx.fill();

    // 2. 🔴 Las líneas: SOLO las del elegido. Sin elegido, ninguna.
    let lineas = 0;
    if (sel >= 0) {
      const [ax, ay] = planoAPantalla(v, mapa.x[sel], mapa.y[sel]);
      ctx.beginPath();
      for (const n of mapa.vecinos[sel]) {
        const [bx, by] = planoAPantalla(v, mapa.x[n.j], mapa.y[n.j]);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        lineas++;
      }
      ctx.strokeStyle = rgb(secundario);
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // 3. El elegido y sus parecidos, encima, en el acento; el elegido con un anillo.
      ctx.beginPath();
      for (const i of resaltados) {
        const [sx, sy] = planoAPantalla(v, mapa.x[i], mapa.y[i]);
        const rp = radioEnPantalla(mapa, i, v.escala);
        if (!visible(sx, sy, rp)) continue;
        ctx.moveTo(sx + rp, sy);
        ctx.arc(sx, sy, rp, 0, Math.PI * 2);
        puntos++;
      }
      ctx.fillStyle = rgb(acento);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ax, ay, radioEnPantalla(mapa, sel, v.escala) + 2, 0, Math.PI * 2);
      ctx.strokeStyle = rgb(texto);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 4. Los nombres, de más minutos a menos, sin pisarse (v=316: sin el umbral de 12 px de radio).
    const familia = getComputedStyle(canvas).fontFamily || 'sans-serif';
    const fuente = `600 12px ${familia}`;
    if (fuente !== st.fuente) { st.fuente = fuente; st.anchos.clear(); }
    ctx.font = fuente;
    const medir = (s) => {
      let a = st.anchos.get(s);
      if (a === undefined) { a = ctx.measureText(s).width; st.anchos.set(s, a); }
      return a;
    };
    const etiquetas = nombresVisibles(mapa, v, w, h, medir, sel);   // v=318: el del elegido, primero
    if (etiquetas.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgb(fondo);
      ctx.fillStyle = rgb(texto);
      for (const e of etiquetas) {
        ctx.strokeText(mapa.nombres[e.i], e.x, e.y);
        ctx.fillText(mapa.nombres[e.i], e.x, e.y);
      }
    }

    dibujo.puntos = puntos;
    dibujo.lineas = lineas;
    dibujo.nombres = etiquetas.length;
    dibujo.conNombre = etiquetas.map((e) => e.i);
    dibujo.ms = performance.now() - t0;
    dibujo.cuadros++;
    dibujo.vista = { ...v };
    dibujo.elegido = sel;
  }

  // ── El panel del elegido ─────────────────────────────────────────────────
  function filaParecido(n) {
    return `<li class="artmapa-fila"><button class="artmapa-parecido" type="button" data-elegir="${n.j}">${escapeHtml(mapa.nombres[n.j])}</button> <span class="artmapa-min">${min(mapa.minutos[n.j])}</span></li>`;
  }
  function pintarPanel() {
    const sel = st.elegido;
    if (sel < 0) {
      panel.innerHTML = '<p class="artmapa-nota">Toca un artista del mapa, o búscalo, para ver sus parecidos.</p>';
      return;
    }
    const vec = mapa.vecinos[sel];
    const cuantos = vec.length === 0 ? 'Ningún artista parecido en tu historial'
      : vec.length === 1 ? '1 artista parecido en tu historial'
        : `${num(vec.length)} artistas parecidos en tu historial`;
    const hasta = Math.min(st.mostrados, vec.length);
    panel.innerHTML = `<div class="artmapa-cabecera">
        <h2 class="artmapa-nombre" tabindex="-1">${escapeHtml(mapa.nombres[sel])}</h2>
        <button class="btn btn-secondary" type="button" data-ficha>Ver ficha</button>
      </div>
      <p class="artmapa-meta">${min(mapa.minutos[sel])} · ${cuantos}</p>
      ${vec.length ? `<ol class="artmapa-lista">${vec.slice(0, hasta).map(filaParecido).join('')}</ol>` : ''}
      <button class="btn btn-secondary" type="button" data-mas ${hasta >= vec.length ? 'hidden' : ''}>Mostrar ${num(POR_PAGINA)} más</button>`;
  }
  // Desde el buscador o un botón del panel, ENCUADRA (v=318): el elegido en el centro y sus 30 primeros
  // parecidos dentro (`encuadrarElegido`). Tocar el lienzo elige sin moverse: quien explora con el dedo no
  // se queda sin piso.
  function elegir(i, { encuadrar = false, foco = false } = {}) {
    st.elegido = i;
    st.mostrados = POR_PAGINA;
    if (encuadrar && i >= 0 && st.vista) st.vista = encuadrarElegido(st.vista, mapa, i, st.ancho, st.alto);
    pintarPanel();
    if (foco && i >= 0) panel.querySelector('.artmapa-nombre')?.focus({ preventScroll: true });
    programar();
  }

  panel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-elegir')) elegir(+b.dataset.elegir, { encuadrar: true, foco: true });
    else if (b.hasAttribute('data-ficha')) { if (st.elegido >= 0) openArtistCard({ name: mapa.nombres[st.elegido] }); }
    else if (b.hasAttribute('data-mas')) {
      const vec = mapa.vecinos[st.elegido] || [];
      const desde = st.mostrados;
      st.mostrados = Math.min(desde + POR_PAGINA, vec.length);
      panel.querySelector('.artmapa-lista')?.insertAdjacentHTML('beforeend', vec.slice(desde, st.mostrados).map(filaParecido).join(''));
      b.hidden = st.mostrados >= vec.length;
    }
  });

  // ── El buscador ──────────────────────────────────────────────────────────
  raiz.querySelector('.artmapa-buscar').addEventListener('submit', (e) => {
    e.preventDefault();
    const i = buscar(mapa, campo.value);
    aviso.textContent = i < 0 ? 'No está en tu mapa.' : '';
    if (i >= 0) elegir(i, { encuadrar: true, foco: true });
  });

  // ── Zoom con los botones ─────────────────────────────────────────────────
  raiz.querySelector('.artmapa-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (!b || !st.vista) return;
    if (b.dataset.zoom === 'todo') st.vista = vistaTodo(mapa, st.ancho, st.alto);
    else st.vista = zoomEn(st.vista, b.dataset.zoom === 'mas' ? PASO_ZOOM : 1 / PASO_ZOOM, st.ancho / 2, st.alto / 2);
    programar();
  });

  // ── Puntero: arrastrar, pellizcar y tocar ─────────────────────────────────
  const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const distancia = () => { const [a, b] = [...st.punteros.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  const medio = () => { const [a, b] = [...st.punteros.values()]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  const alBajar = (e) => {
    if (!st.vista) return;
    // Sin la captura, un arrastre que sale del canvas se perdería; con un puntero sintético (el
    // banco) tira, y no es motivo para no mover.
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignora */ }
    st.punteros.set(e.pointerId, local(e));
    if (st.punteros.size === 1) st.arrastre = { inicio: local(e), movido: false };
    else if (st.punteros.size === 2) { st.pellizco = { d: distancia(), c: medio() }; if (st.arrastre) st.arrastre.movido = true; }
  };
  const alMover = (e) => {
    const antes = st.punteros.get(e.pointerId);
    if (!antes) return;
    const ahora = local(e);
    st.punteros.set(e.pointerId, ahora);
    if (st.punteros.size === 1 && st.arrastre) {
      st.vista = mover(st.vista, ahora[0] - antes[0], ahora[1] - antes[1]);
      const [x0, y0] = st.arrastre.inicio;
      if (Math.hypot(ahora[0] - x0, ahora[1] - y0) > MOVIDO_PX) st.arrastre.movido = true;
      programar();
    } else if (st.punteros.size === 2 && st.pellizco) {
      const d = distancia(), c = medio();
      st.vista = mover(st.vista, c[0] - st.pellizco.c[0], c[1] - st.pellizco.c[1]);
      if (st.pellizco.d > 0) st.vista = zoomEn(st.vista, d / st.pellizco.d, c[0], c[1]);
      st.pellizco = { d, c };
      programar();
    }
  };
  const alSoltar = (e) => {
    if (!st.punteros.has(e.pointerId)) return;
    const [px, py] = local(e);
    st.punteros.delete(e.pointerId);
    if (st.punteros.size < 2) st.pellizco = null;
    if (st.punteros.size === 0) {
      const toque = e.type === 'pointerup' && st.arrastre && !st.arrastre.movido;
      st.arrastre = null;
      if (toque) elegir(tocar(mapa, st.vista, px, py));
    }
  };
  const alRueda = (e) => {
    e.preventDefault();
    if (!st.vista) return;
    const [px, py] = local(e);
    st.vista = zoomEn(st.vista, Math.exp(-e.deltaY * 0.002), px, py);
    programar();
  };
  canvas.addEventListener('pointerdown', alBajar);
  canvas.addEventListener('pointermove', alMover);
  canvas.addEventListener('pointerup', alSoltar);
  canvas.addEventListener('pointercancel', alSoltar);
  canvas.addEventListener('wheel', alRueda, { passive: false });

  // El tamaño cambia con la ventana; la paleta, con el panel de temas (`themechange`).
  const obs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (medirLienzo()) programar(); }) : null;
  obs?.observe(canvas);
  const alTema = () => programar();
  document.addEventListener('themechange', alTema);

  medirLienzo();
  pintarPanel();
  programar();

  window.__mapaArtistasBanco = {
    mapa,
    vista: () => ({ ...st.vista }),
    pendiente: () => st.pendiente,
    pintarYa: () => { st.pendiente = false; cancelAnimationFrame(st.raf); clearTimeout(st.respaldo); pintar(); return { ...dibujo }; },
    zoomCentro: (f) => { st.vista = zoomEn(st.vista, f, st.ancho / 2, st.alto / 2); },
    verTodo: () => { st.vista = vistaTodo(mapa, st.ancho, st.alto); },
    elegir: (i) => elegir(i, { encuadrar: true }),   // como desde el panel (v=318: encuadra)
    canvas,
  };

  return () => {
    st.vivo = false;
    st.pendiente = false;
    cancelAnimationFrame(st.raf);
    clearTimeout(st.respaldo);
    obs?.disconnect();
    document.removeEventListener('themechange', alTema);
    canvas.removeEventListener('pointerdown', alBajar);
    canvas.removeEventListener('pointermove', alMover);
    canvas.removeEventListener('pointerup', alSoltar);
    canvas.removeEventListener('pointercancel', alSoltar);
    canvas.removeEventListener('wheel', alRueda);
    if (window.__mapaArtistasBanco?.canvas === canvas) delete window.__mapaArtistasBanco;
  };
}
