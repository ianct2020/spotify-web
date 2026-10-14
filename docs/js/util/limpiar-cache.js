// Qué sobrevive al botón «Limpiar caché» de la barra lateral (`app.js`).
//
// El botón vacía la IndexedDB entera menos lo que diga esta lista. Vive en un
// módulo propio para que el test (`tests/limpiar-cache.test.mjs`) compruebe la
// MISMA lista que usa el botón, y no una copia.
//
// Lo que se conserva, y por qué:
//   - Los likes (`all_liked_tracks` y su parcial): bajarlos de nuevo cuesta
//     ~190 requests.
//   - La base de discografías (prefijo, una clave por artista), desde v=229:
//     rehacerla cuesta cuotas enteras de Spotify.
//   - La base de colores del mosaico (`mosaico_colores_v1`), desde v=248: no
//     cuesta cuota (sale del CDN de imágenes), pero sí ~16 MB de descarga, y
//     Ian decidió que no se borre, igual que la de discografías.
//   - El historial importado (`local_<uid>_history_*`, prefijo), desde v=300.
//     No es caché: es dato que el usuario subió a mano desde su ZIP y que no
//     se puede volver a bajar. Hasta v=299 el botón se llevaba al owner
//     `local_<owner>_history_days` —el detalle por día que carga la
//     importación «solo el detalle»— y a un amigo las ocho claves de su ZIP,
//     o sea todo su historial; rehacer cualquiera de las dos pide volver a
//     pasar el ZIP. Para borrarlo queda el «Borrarlo» del modal de importación
//     (`clearMyHistory()`), que es la puerta que dice lo que hace. El prefijo es
//     `local_` a secas porque el uid va en el medio de la clave; no cubre el
//     caché de items de los ocultos (v=299), que sigue borrándose.
//
// Si agregás otro camino que borre IndexedDB en masa, usá esta misma lista.

import { DISCO_BASE_PREFIX } from './disco-base.js?v=301';
import { MOSAICO_COLORES_KEY } from './cover-color.js?v=301';
import { LOCAL_HISTORY_PREFIX } from '../history-keys.js?v=301';

export const CONSERVAR_CLAVES = ['all_liked_tracks', 'all_liked_tracks_partial', MOSAICO_COLORES_KEY];
export const CONSERVAR_PREFIJOS = [DISCO_BASE_PREFIX, LOCAL_HISTORY_PREFIX];
