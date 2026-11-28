// «📚 Por escuchar» a pantalla completa: la regla del buscador y del orden (v=376, tanda 139).
//
// PURA: sin red, sin DOM, sin IndexedDB, sin reloj. Recibe las entradas que da `pendientesDeBiblioteca()` de
// `util/registro-escuchados.js` (`{ addedAt, album }`, del guardado más nuevo al más viejo) y no cambia QUÉ álbumes salen: solo cuáles
// se ven con un texto puesto y en qué orden. `registro-escuchados.js` no se tocó (sigue sin imports).
//
// La normalización del buscador es `normalizarNombre` de `util/mb-pais.js`, importada: la regla de v=219 (una regla escrita dos veces
// termina divergiendo). La fecha de lanzamiento la lee `releaseTs` de `util/release-date.js`, importada.
//
// El desempate (decidido con Ian el 27/11/2026, porque el encargo pedía nombre e id y eso rompía la conservación): a igual criterio
// gana el guardado más nuevo y, si también empata, **el orden en que vino la lista** (el `sort` es estable). Así `guardado-nuevo` da
// exactamente el orden de `pendientesDeBiblioteca()`, que a igual `added_at` respeta el orden de la biblioteca.

import { normalizarNombre } from './mb-pais.js?v=377';
import { releaseTs } from './release-date.js?v=377';

export const ORDENES_POR_ESCUCHAR = ['guardado-nuevo', 'guardado-viejo', 'lanzamiento-nuevo', 'lanzamiento-viejo'];
export const ORDEN_POR_DEFECTO = 'guardado-nuevo';

/** ¿La entrada coincide con lo escrito? Vacío (o solo espacios) = todas. «Contiene», en el nombre del álbum o en el de algún artista. */
export function coincide(entrada, texto) {
  const q = normalizarNombre(texto);
  if (!q) return true;
  const al = entrada?.album || {};
  if (normalizarNombre(al.name).includes(q)) return true;
  return (al.artists || []).some((a) => normalizarNombre(a?.name).includes(q));
}

// La fecha de guardado en ms, o null si no se lee. El 0 cuenta como «sin fecha» porque `pendientesDeBiblioteca()` hace
// `Date.parse(…) || 0` y lo pone al final: así los dos dicen lo mismo.
const msGuardado = (e) => {
  const t = Date.parse(e?.addedAt || '');
  return Number.isFinite(t) && t !== 0 ? t : null;
};

// La fecha de lanzamiento en ms, o null si no se lee. Hacen falta cuatro cifras de año y un año mayor que 0: «0000» es el
// `release_date` de los álbumes sin metadatos, y `releaseTs` lo llevaría a 1900 (`Date.UTC(0, …)`), o sea a «el más viejo».
const msLanzamiento = (e) => {
  const r = String(e?.album?.release_date || '');
  if (!/^\d{4}/.test(r) || Number(r.slice(0, 4)) <= 0) return null;
  return releaseTs(r);
};

// Lo que no tiene fecha va al final en los DOS sentidos (la regla de `#covers`, v=278: lo desconocido no es lo más nuevo).
const porFecha = (a, b, sentido) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return sentido * (b - a);
};

/** Una COPIA ordenada (no muta). Un orden desconocido es `ORDEN_POR_DEFECTO`. */
export function ordenar(lista, orden) {
  const o = ORDENES_POR_ESCUCHAR.includes(orden) ? orden : ORDEN_POR_DEFECTO;
  const sentido = o.endsWith('-nuevo') ? 1 : -1;
  const fecha = o.startsWith('lanzamiento') ? msLanzamiento : msGuardado;
  return [...(lista || [])].sort((x, y) =>
    porFecha(fecha(x), fecha(y), sentido)
    // Desempate: el guardado más nuevo primero; con eso empatado, el `sort` estable deja el orden en que vino.
    || porFecha(msGuardado(x), msGuardado(y), 1));
}

/** El texto de `#porescuchar-cuenta`: «Con «x»: N de M.», «Ningún álbum coincide con «x».» o '' sin texto. */
export function textoCuenta(n, m, texto) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (!n) return `Ningún álbum coincide con «${t}».`;
  return `Con «${t}»: ${n.toLocaleString('es-ES')} de ${m.toLocaleString('es-ES')}.`;
}
