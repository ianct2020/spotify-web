// Lo que sonó un día: las dos listas del panel del día (v=368, tanda 131).
//
// Las usan **dos vistas**: `#calendario` (el panel del día, desde v=289) y `#lluvia` (el panel de un día de
// lluvia, desde v=368). Hasta v=367 todo esto vivía dentro de `features/calendario.js` (`datosDelDia()` y
// `abrirDia()`); se sacó acá para que `#lluvia` no tuviera una segunda copia (la regla de v=219: dos copias
// del mismo criterio terminan divergiendo).
//
// 🔴 **El panel de `#calendario` es byte a byte el de v=367**: el HTML de `listasDelDiaHtml()` es el mismo
// carácter por carácter (espacios incluidos), y lo vigila `tests/lluvia-dia-detalle.test.mjs` con el
// `sha256` del panel entero en tres días.
//
// Qué recibe: un día del payload `days` (`{ min, crudas, validas, saltos, temas: [[i, min, veces]] }`), sea
// de `dias` (UTC, lo que lee `#calendario`) o de `diasLocal` (Mar del Plata, lo que lee `#lluvia`), y el
// diccionario `temas` (`[[trackId, nombre, artista]]`). **El módulo no elige qué día se enseña**: eso es
// de cada vista.
//
// Los formateadores viven acá y se importan, no se pasan por parámetro: las dos vistas enseñan las mismas
// listas, y un formateador por parámetro es justo la puerta para que cada una termine con el suyo.
//
// Las clases (`.cal-panel-h`, `.cal-lista`, `.cal-fila`…) se quedaron con su nombre de siempre (el CSS
// está en `main.css`, que no se toca); su dueño es ESTE módulo. Las fichas se conectan SOLO dentro de la
// raíz que se le pasa a `conectarListasDelDia()`: ningún listener de ninguna vista barre esas clases en
// todo el documento (la regla de `.wt-play-btn`, v=219).

import { escapeHtml } from './components.js?v=378';
import { openTrackCard } from '../features/track-card.js?v=378';
import { attachArtistCard } from '../features/artist-card.js?v=378';

// El MISMO `fmtMinutes` que el Wrapped, y por el mismo camino: llega al
// componente por `ctx`. No se escribe un formateador nuevo — hay cuatro copias
// privadas de «un decimal en es-ES» anotadas en `PENDIENTES.md` y no hace falta
// la quinta. (Hasta v=367 vivía en `features/calendario.js`, que lo importa de acá.)
export function fmtMinutes(min) {
  if (!min && min !== 0) return '—';
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return `${h.toLocaleString('es-ES')}h ${m}m`;
  }
  return `${Math.round(min)}m`;
}

export function num(n) {
  return Number(n || 0).toLocaleString('es-ES');
}

/**
 * Los temas y los artistas de un día. PURA.
 *  · `temas`: `[{ id, nombre, artista, min, veces }]`, en el orden del día (el de su primera vez);
 *  · `artistas`: `[{ nombre, min }]`, por MINUTOS de mayor a menor, agrupados por el artista principal del
 *    tema, que es el único que el diccionario guarda.
 */
export function armarDia(dia, dicTemas) {
  const dic = dicTemas || [];
  const temas = ((dia && dia.temas) || []).map(([idx, min, veces]) => {
    const t = dic[idx] || [];
    return { id: t[0] || '', nombre: t[1] || '', artista: t[2] || '', min, veces };
  });
  const porArtista = new Map();
  for (const t of temas) {
    if (!t.artista) continue;
    porArtista.set(t.artista, (porArtista.get(t.artista) || 0) + t.min);
  }
  const artistas = [...porArtista.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nombre, min]) => ({ nombre, min }));
  return { temas, artistas };
}

/** Los temas que se enseñan: los que sonaron alguna vez y tienen id. */
export function temasConVeces(temas) {
  return (temas || []).filter(t => t.veces > 0 && t.id);
}

/**
 * El HTML de las dos listas: «Artistas del día» y «Temas del día». Cada fila es un `<button>` (foco y
 * teclado de serie). Sin artistas o sin temas, esa lista no sale. 🔴 Byte a byte el de v=367: no se
 * reindenta.
 */
export function listasDelDiaHtml(artistas, temas) {
  return `
      ${artistas.length ? `
        <h4 class="cal-panel-h">Artistas del día</h4>
        <ul class="cal-lista cal-lista-art">
          ${artistas.map(a => `
            <li><button type="button" class="cal-fila" data-artista="${escapeHtml(a.nombre)}">
              <span class="cal-fila-n">${escapeHtml(a.nombre)}</span>
              <span class="cal-fila-m">${fmtMinutes(a.min)}</span>
            </button></li>
          `).join('')}
        </ul>` : ''}

      ${temas.length ? `
        <h4 class="cal-panel-h">Temas del día <span class="cal-panel-h-hint">en orden de la primera vez que sonaron</span></h4>
        <ul class="cal-lista cal-lista-temas">
          ${temas.map(t => `
            <li><button type="button" class="cal-fila" data-tema="${escapeHtml(t.id)}"
                        data-nombre="${escapeHtml(t.nombre)}" data-artista-tema="${escapeHtml(t.artista)}">
              <span class="cal-fila-n">${escapeHtml(t.nombre)}<span class="cal-fila-a">${escapeHtml(t.artista)}</span></span>
              <span class="cal-fila-m">${fmtMinutes(t.min)}${t.veces > 1 ? ` · ${num(t.veces)} veces` : ''}</span>
            </button></li>
          `).join('')}
        </ul>` : ''}
    `;
}

/**
 * Las fichas: cada nombre abre la suya (`attachArtistCard` para los artistas, `openTrackCard` para los
 * temas; las dos ya existen y no se reimplementan). SOLO dentro de `raiz` (el overlay del panel).
 */
export function conectarListasDelDia(raiz) {
  for (const b of raiz.querySelectorAll('[data-artista]')) {
    attachArtistCard(b, b.dataset.artista);
  }
  for (const b of raiz.querySelectorAll('[data-tema]')) {
    b.onclick = () => openTrackCard({
      id: b.dataset.tema,
      name: b.dataset.nombre,
      artist: b.dataset.artistaTema,
    });
  }
}
