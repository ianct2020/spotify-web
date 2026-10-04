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
//
// Si agregás otro camino que borre IndexedDB en masa, usá esta misma lista.

import { DISCO_BASE_PREFIX } from './disco-base.js?v=273';
import { MOSAICO_COLORES_KEY } from './cover-color.js?v=273';

export const CONSERVAR_CLAVES = ['all_liked_tracks', 'all_liked_tracks_partial', MOSAICO_COLORES_KEY];
export const CONSERVAR_PREFIJOS = [DISCO_BASE_PREFIX];
