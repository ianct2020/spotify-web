// El bloque «Letra» de la ficha de canción (v=311, tanda 59): la red, la caché y
// el DOM. Lo que se decide (la URL, la clase de la respuesta, la verificación de
// nombres, el aviso de duración, qué se guarda) es puro y vive en
// `util/letras.js`. Vive acá y no dentro de `features/track-card.js` para que la
// ficha siga leyéndose de un tirón: la ficha solo pone el botón y el bloque en su
// HTML y llama a `conectarLetra()`.
//
// Las reglas, y por qué (el detalle, en CLAUDE.md, «🎤 Letras (v=311)»):
//   · 🔴 Abrir la ficha NO pide nada (la regla de v=261 aplicada a un tercero):
//     se pide al tocar «Letra», de a un tema. Nunca en lote ni de fondo.
//   · Primero la caché (`letras_v1_<trackId>`): una segunda apertura = 0 peticiones.
//   · El `fetch` va pelado: ninguna cabecera propia (una no simple provoca una
//     `OPTIONS` previa) y ningún token. El `try` envuelve SOLO la red.
//   · Un 503 tiene UN reintento automático, esperando `retry-after`. Lo demás
//     (corte, 429, 5xx, algo que no es JSON) no reintenta solo y no guarda nada.
//   · Un `teardown` no corta un `await` (v=174): después de cada espera se
//     pregunta si el bloque sigue en el documento. Si la ficha se cerró, no se
//     escribe en el DOM; lo que llegó SÍ se guarda si es un éxito o un 404.

import { idbGetCached, idbSetCached } from '../idb.js?v=322';
import { getBestAvailableLikes } from '../api.js?v=322';
import { escapeHtml } from './components.js?v=322';
import { claveLetra, urlLetra, clasificarRespuesta, decidir, esperaReintentoMs, TEXTOS } from '../util/letras.js?v=322';

// Lo que la ficha mete en su HTML: el botón va en la fila de «▶ Preview» y el
// bloque, plegado, debajo de la cabecera.
export function botonLetraHtml() {
  return `<button type="button" class="btn btn-secondary btn-sm" id="tc-letra-btn" aria-expanded="false" aria-controls="tc-letra">${TEXTOS.boton}</button>`;
}
export function bloqueLetraHtml() {
  return `<div id="tc-letra" class="tc-letra" hidden></div>`;
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// UNA petición a lrclib. `status: 0` = no contestó (corte de red, CORS);
// `cuerpo: undefined` = no era JSON. Nada más adentro del `try`.
async function unaPeticion(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    console.warn('[letras] lrclib no contestó:', e?.message || e);
    return { status: 0, cuerpo: undefined, retryAfter: null };
  }
  let cuerpo;
  try { cuerpo = await res.json(); } catch { cuerpo = undefined; }
  return { status: res.status, cuerpo, retryAfter: res.headers.get('retry-after') };
}

export function conectarLetra(overlay, t, artistas) {
  const btn = overlay.querySelector('#tc-letra-btn');
  const bloque = overlay.querySelector('#tc-letra');
  if (!btn || !bloque) return;
  const pedido = { name: t.name || '', artists: artistas };
  const clave = claveLetra(t.id);
  let enVuelo = null;

  const vigente = () => bloque.isConnected;
  const desplegar = (si) => { bloque.hidden = !si; btn.setAttribute('aria-expanded', String(si)); };
  const pintar = (estado, html) => {
    if (!vigente()) return;
    bloque.dataset.letraEstado = estado;
    bloque.innerHTML = html;
  };
  const accion = (que, texto) => `<button type="button" class="btn btn-secondary btn-sm" data-letra-accion="${que}">${texto}</button>`;

  // La duración del tema, si es un me gusta: del caché (0 peticiones, como la
  // lee `irAlAlbum`). Sin ella no hay aviso.
  async function duracionPropia() {
    const likes = await getBestAvailableLikes().catch(() => ({ items: [] }));
    const like = (likes.items || []).find(l => l.track?.id === t.id);
    return like?.track?.duration_ms || null;
  }

  async function pintarRegistro(registro) {
    const ms = await duracionPropia();
    if (!vigente()) return;
    const d = decidir(registro, pedido, ms);
    if (d.clase === 'letra') {
      pintar('letra',
        (d.aviso ? `<p class="tc-letra-aviso">${escapeHtml(d.aviso)}</p>` : '') +
        `<div class="tc-letra-texto" tabindex="0">${escapeHtml(d.texto)}</div>` +
        `<p class="tc-letra-fuente">${TEXTOS.fuente}</p>`);
    } else if (d.clase === 'instrumental') {
      pintar('instrumental', `<p class="tc-letra-estado">${TEXTOS.instrumental}</p><p class="tc-letra-fuente">${TEXTOS.fuente}</p>`);
    } else {
      pintar('no-hay', `<p class="tc-letra-estado">${TEXTOS.noHay}</p>${accion('buscar', TEXTOS.buscarDeNuevo)}`);
    }
  }

  async function guardar(registro) {
    try { await idbSetCached(clave, registro, null); }
    catch (e) { console.warn('[letras] no pude guardar la letra en la caché:', e); }
  }

  async function pedir() {
    pintar('cargando', `<p class="tc-letra-estado">${TEXTOS.buscando}</p>`);
    const url = urlLetra(artistas[0] || '', t.name || '');
    let r = await unaPeticion(url);
    let c = clasificarRespuesta(r, pedido, new Date().toISOString());
    // El único reintento automático: un 503 (lrclib sin permisos de carga en ese
    // momento). Si la ficha se cerró mientras esperaba, no se gasta la petición.
    if (c.reintentable && vigente()) {
      await esperar(esperaReintentoMs(r.retryAfter));
      if (vigente()) {
        r = await unaPeticion(url);
        c = clasificarRespuesta(r, pedido, new Date().toISOString());
      }
    }
    if (c.registro) await guardar(c.registro);
    if (!vigente()) return;
    if (c.registro) return pintarRegistro(c.registro);
    console.warn(`[letras] lrclib contestó ${r.status || 'sin respuesta'}${r.cuerpo === undefined && r.status ? ' (no era JSON)' : ''}: no se guarda nada`);
    pintar('fallo', `<p class="tc-letra-estado">${TEXTOS.noContesta}</p>${accion('reintentar', TEXTOS.reintentar)}`);
  }

  // `forzar` = «Buscar de nuevo»: pide otra vez aunque haya algo guardado, y lo pisa.
  function cargar({ forzar = false } = {}) {
    if (enVuelo) return enVuelo;
    enVuelo = (async () => {
      try {
        if (!forzar) {
          const guardado = await idbGetCached(clave);
          if (!vigente()) return;
          if (guardado) return await pintarRegistro(guardado);
        }
        await pedir();
      } catch (e) {
        // Esto envuelve más que la red (la caché, la decisión, el DOM): el error
        // va crudo a la consola y el bloque dice que algo falló, nunca «no hay
        // letra» (el `catch` que disfraza, v=154).
        console.warn('[letras] algo falló al enseñar la letra:', e);
        pintar('error', `<p class="tc-letra-estado">${TEXTOS.errorApp}</p>${accion('reintentar', TEXTOS.reintentar)}`);
      } finally {
        enVuelo = null;
      }
    })();
    return enVuelo;
  }

  btn.onclick = () => {
    const abrir = bloque.hidden;
    desplegar(abrir);
    if (abrir && !bloque.dataset.letraEstado) cargar();
  };
  bloque.onclick = (e) => {
    const b = e.target.closest && e.target.closest('[data-letra-accion]');
    if (b) cargar({ forzar: b.dataset.letraAccion === 'buscar' });
  };
}
