// La regla SIMÉTRICA de `versionesCompatibles()` — para ÁLBUMES, no para pistas.
//
// `util/track-match.js` resuelve pistas y desde v=185 su criterio es: un pedido
// SIN versión acepta cualquier versión del candidato. Para un álbum hace falta
// exactamente lo contrario, y por eso esta función NO importa aquella ni la
// copia: van al revés.
//
// El motivo es que la comparación de nombres pasa por `normText`, que **borra
// los paréntesis enteros**. O sea que «Harry's House» y «Harry's House (Piano
// Version)» normalizan las dos a `harrys house` y son indistinguibles para la
// igualdad de nombre. Pedir «Harry's House» y que `/search` devuelva primero el
// disco de versiones al piano da un tracklist entero de sufijos « - Piano
// Version», con cara de resultado correcto. Cuando el pedido no dice nada de
// versión, lo que se pidió es el disco ORIGINAL: un candidato que trae
// marcadores que el pedido no traía se rechaza.
//
// Al revés no se toca: si el pedido SÍ trae el marcador («Unplugged in New
// York», «MTV Unplugged»), el candidato con ese mismo marcador pasa, porque el
// conjunto del candidato queda contenido en el del pedido.

import { VERSION_MARKERS } from './versions-guard.js?v=228';

// `VERSION_MARKERS` (util/versions-guard.js) es la lista más completa del repo
// —ya trae «piano version», «instrumental» y «karaoke»— y es la que decide qué
// me gusta se pueden borrar, así que se REUSA en vez de escribir otra que
// envejezca aparte.
//
// Lo que no existe en ninguna parte del repo es el vocabulario de TRIBUTO: los
// discos de covers que Spotify indexa con el nombre del disco original y que
// por nombre normalizado son idénticos al que se pidió. Las frases largas van
// primero para que la alternancia no corte en la palabra corta.
const MARCADORES_TRIBUTO = [
  'made famous by',
  'in the style of',
  'cover version',
  'performed by',
  'tribute',
  'tributo',
  'homenaje',
  'covers',
];

// `VERSION_MARKERS` viene como `\b(a|b|c)\b`: le sacamos el ancla para poder
// meter el vocabulario de tributo dentro de la MISMA alternancia.
const ALTERNANCIA = VERSION_MARKERS.source.replace(/^\\b\(|\)\\b$/g, '');
const RE_MARCADORES = new RegExp('\\b(?:' + ALTERNANCIA + '|' + MARCADORES_TRIBUTO.join('|') + ')\\b', 'gi');

// Dos escrituras del mismo marcador tienen que caer en la misma clave:
// «Taylor's Version» / «Taylors Version», «re-record» / «rerecord».
function canon(m) {
  return String(m).toLowerCase().replace(/['‘’ʼ`´-]/g, '').replace(/\s+/g, ' ').trim();
}

/** Los marcadores de versión que declara un nombre de álbum, canonizados. */
export function marcadoresDeVersion(nombre) {
  const out = new Set();
  const s = String(nombre || '').toLowerCase();
  for (const m of s.matchAll(RE_MARCADORES)) out.add(canon(m[0]));
  return out;
}

/**
 * ¿El candidato trae marcadores de versión que el pedido NO traía?
 *
 * `true` = hay que RECHAZARLO. Es la dirección contraria a
 * `versionesCompatibles()` de `util/track-match.js`, a propósito.
 */
export function candidatoTraeVersionDeMas(nombrePedido, nombreCandidato) {
  const delCandidato = marcadoresDeVersion(nombreCandidato);
  if (delCandidato.size === 0) return false;
  const delPedido = marcadoresDeVersion(nombrePedido);
  for (const m of delCandidato) if (!delPedido.has(m)) return true;
  return false;
}

export { MARCADORES_TRIBUTO };
