// Los topes de los registros que guarda la app (v=334, tanda 79). SIN IMPORTS, a propósito.
//
// Vivían como constantes privadas de sus dueños (`api.js` y `util/hidden-sync.js`). «Importar todo»
// (`util/copia-importar.js`, puro) une un registro del archivo con el del navegador y tiene que dejar las
// entradas más nuevas con el MISMO tope que usa el dueño: importado, no copiado (una regla escrita dos veces
// diverge, v=219). No se pueden importar de los dueños: `api.js` no es puro y `hidden-sync.js` arrastra
// `api.js` por `playlist-add.js`. Así que el número vive acá y los dueños lo importan de acá.
//
// (v=337, tanda 81) Los dos registros de `#versions` (`versions_supervivientes_perdidas_v1`, `versions_dry_run_log_v1`)
// tenían su tope como un `20` literal dentro de `features/versions.js`, y el import los unía sin tope. Ahora viven acá
// también: la vista y el import los importan.

/** `likes_borrados_log_v1` (`api.js`): los últimos borrados de me gusta. */
export const BORRADOS_LOG_MAX = 20;

/** `ocultos_incidencias_v1` (`util/hidden-sync.js`): las últimas incidencias de los ocultos. */
export const INCIDENCIAS_OCULTOS_MAX = 100;

/** `versions_supervivientes_perdidas_v1` (`features/versions.js`): las últimas veces que `#versions` perdió la que se quedaba. */
export const SUPERVIVIENTES_PERDIDAS_MAX = 20;

/** `versions_dry_run_log_v1` (`features/versions.js`): los últimos ensayos del doble de borrado de `#versions`. */
export const ENSAYOS_VERSIONS_MAX = 20;
