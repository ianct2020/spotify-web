// util/corte-saltos.js — desde cuándo el export de Spotify anota los saltos (v=292)
//
// El campo `skipped` del Extended Streaming History vale `false` (no vacío) en
// TODAS las reproducciones anteriores a esta fecha. El primer `true` del export
// de Ian es del `2022-10-15T01:06:42Z`.
//
// Fuente: la tabla por año de la tanda 40, medida sobre los 19 archivos del
// export el 11/10/2026 — `fonoteca-migracion/medicion-skips-por-anio-2026-10-11.txt`,
// sección «El campo skipped por año» (2018-2021: 0 `true`; 2022: 7.776 de 21.908;
// 2023: 25.686 de 34.315), sacada con `medicion-skips-campo-skipped-2026-10-11.py`.
//
// QUÉ IMPLICA. La definición de salto es una sola desde v=291:
//
//     skipped === true  ||  (reason_end === 'fwdbtn' && ms_played < 30 s)
//
// Antes de la fecha la primera mitad no puede dar `true`, así que el porcentaje
// de esos años cuenta SOLO lo que se pasó con «siguiente» antes de 30 s. Son dos
// reglas de medición distintas con el mismo nombre, y por eso el porcentaje de
// un año anterior al corte no se compara con el total ni con los años de después.
//
// 🟥 LO QUE ESTE ARCHIVO NO DICE, y nadie puede decir con estos datos: cuánto
// de la diferencia entre un año y otro es de la regla y cuánto de cómo se
// escuchó. El dato que lo diría no se escribió nunca. Ningún texto que salga de
// acá puede afirmarlo en ninguna de las dos direcciones.
//
// LA REGLA ES DE PRESENTACIÓN: el pipeline (`gen-stats.py`, `history-processor.js`)
// y los JSON no saben nada de esto. La usan `features/wrapped-apertura.js` (el
// paso «dentro de todo») y `features/wrapped.js` (la pista del tile «Skips»), y
// ninguno de los dos escribe el año a mano: lo vigila `tests/corte-saltos.test.mjs`.
//
// ⚠️ Supuesto SIN verificar: que la fecha valga para cualquier cuenta y no solo
// para la de Ian. A un historial importado (BYOH) se le aplica igual. Anotado en
// `fonoteca-migracion/PENDIENTES.md`.

/** El día (UTC) del primer `skipped: true` del export. */
export const PRIMER_SKIPPED_TRUE = '2022-10-15';

const ANIO_DEL_CORTE = Number(PRIMER_SKIPPED_TRUE.slice(0, 4));

/**
 * ¿El año se trata como «sin el campo `skipped`»?
 *
 * El año del corte entra entero: nueve meses y medio de sus doce son anteriores
 * a la fecha, y partirlo por la mitad no tiene con qué (el JSON trae un solo
 * porcentaje por año).
 */
export function anioSinCampoSkipped(year) {
  return Number(year) <= ANIO_DEL_CORTE;
}

/** ¿Es justo el año en que el campo empezó a anotarse? (Su texto es otro.) */
export function esElAnioDelCorte(year) {
  return Number(year) === ANIO_DEL_CORTE;
}
