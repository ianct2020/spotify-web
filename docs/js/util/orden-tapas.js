// El orden de #covers (Mis tapas). Funciones puras, sin DOM: viven acá y no en
// `features/covers.js` para que un test de Node las pueda importar (covers.js
// arrastra la vista entera).
//
// ⚠️ LA FECHA DE UNA TAPA ES LA DE SU PRIMERA ESCUCHA, no la de lanzamiento: sale de
// `history-listened-albums.json`. Un álbum que solo viene de la playlist «w three» y
// nunca se escuchó entero NO TIENE FECHA (`date: ''`).
//
// ⚠️ LOS ÁLBUMES SIN FECHA VAN AL FINAL EN LOS DOS ÓRDENES (decisión de Ian,
// 07/10). Un álbum sin fecha no es ni el más viejo ni el más nuevo: es desconocido, y
// ponerlo arriba en «más nuevas» sería afirmar algo falso. Hasta v=278 quedaban al
// final en ascendente POR ACCIDENTE —la lambda usaba `x.date || '9999'`— y por eso
// invertir el comparador no alcanza para el orden descendente: hay que separarlos.
//
// Los comparadores de `util/release-date.js` no sirven acá: ordenan lanzamientos por
// `.release`, no tapas por `.date`.

/** De menor a mayor fecha de primera escucha. Solo para tapas CON fecha. */
export function compararPorFecha(x, y) {
  return x.date.localeCompare(y.date);
}

/**
 * Por fecha, con los sin fecha pegados al final en los dos sentidos.
 * El descendente es EXACTAMENTE el ascendente al revés (empates incluidos) entre los
 * que sí tienen fecha: se da vuelta la lista ya ordenada en vez de invertir el
 * comparador, porque con dos álbumes del mismo día el comparador invertido los deja en
 * el orden de entrada y el reverso no.
 */
export function ordenarPorFecha(list, { descendente = false } = {}) {
  const con = list.filter(a => a.date);
  const sin = list.filter(a => !a.date);
  con.sort(compararPorFecha);
  if (descendente) con.reverse();
  return con.concat(sin);
}

export const ORDENES_TAPAS = ['date-asc', 'date-desc', 'min-desc', 'artist-asc'];

/** Devuelve una COPIA ordenada; nunca toca la lista que recibe. */
export function sortList(list, mode) {
  if (mode === 'date-desc') return ordenarPorFecha(list, { descendente: true });
  if (mode === 'min-desc') return list.slice().sort((x, y) => y.min - x.min);
  if (mode === 'artist-asc') {
    return list.slice().sort((x, y) =>
      (x.artist || '').localeCompare(y.artist || '', 'es', { sensitivity: 'base' })
      || (x.name || '').localeCompare(y.name || '', 'es', { sensitivity: 'base' }));
  }
  return ordenarPorFecha(list);   // 'date-asc', y lo que no se reconozca
}
