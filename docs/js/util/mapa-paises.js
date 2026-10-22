// La cuenta de `#mapa` (v=304, tanda 52): tus países, con la regla de
// `util/mb-pais.js` y sin ninguna red.
//
// Módulo PURO: sin IndexedDB, sin `fetch`, sin DOM. Recibe `totals` y los temas
// del historial (`loadArtistTracks()`) y la caché de respuestas de MusicBrainz
// —por artista y por área— y decide, para cada artista:
//   · cuál es el próximo pedido que le falta (búsqueda, un área, la grabación, o
//     ninguno: está terminado), con la MISMA secuencia que midió la tanda 51
//     (`fonoteca-migracion/mapa/medir-mb-paises-2026-10-14.mjs`), para que lo
//     que mida la app se pueda comparar con aquello;
//   · en qué categoría cae: con país, sin país, sin confirmar, o pendiente.
// Y arma los países (minutos y artistas) y las cinco filas de cobertura.
//
// 🔴 La caché guarda lo que CONTESTÓ MusicBrainz (recortado), no la decisión. La
// decisión se recalcula acá cada vez que se pinta, que es puro y no cuesta nada:
// si la regla cambia en otra tanda, la caché sigue sirviendo sin repetir una
// sola petición. Por eso `proximoPaso()` mira la caché y no un «terminado».
//
// 🔴 «Tiene país» es la definición ESTRICTA de las tandas 50 y 51, y ninguna
// otra: `unico` con país CORROBORADO por la grabación, `varios-mismo-pais`, o
// `desempatado` con país (de `country` o del área). Un `unico` con país sin
// corroborar va a su propia fila, «sin confirmar», y no suma a ningún país: un
// país que no se puede atribuir con certeza no se atribuye.
//
// 🔴 Los desconocidos NO se reparten entre los países, ni en proporción ni de
// ninguna forma. Y el % de cada país es del TOTAL del historial, no del total con
// país: si no, un 70 % conocido se leería como un 100 %.
//
// Los minutos se suman en DÉCIMAS (enteros): las cinco filas tienen que sumar
// exactamente el total, y con flotantes «exactamente» no existe.

import { clasificar, completarConArea, corroborado, limpiarTitulo } from './mb-pais.js?v=325';

export const MIN_MINUTOS = 10;

// Las claves de IndexedDB. La del artista lleva el uid: la lista de artistas
// que escuchaste es dato de escucha, y dos usuarios del mismo navegador no
// pueden verse. La del área no: es dato público de MusicBrainz y se comparte
// (una provincia es la misma para todos). Las dos las conserva «Limpiar caché»
// (`util/limpiar-cache.js`): rehacerlas es una hora y media de escaneo.
export const PREFIJO_ARTISTA = 'mapa_artista_v1_';
export const PREFIJO_AREA = 'mapa_area_v1_';
export const claveArtista = (uid, nombre) => `${PREFIJO_ARTISTA}${uid}_${nombre}`;
export const claveArea = (id) => `${PREFIJO_AREA}${id}`;
// v=306 (tanda 54): lo medido del ritmo, ACUMULADO entre cargas, para estimar lo
// que falta (`ritmoVacio`/`estimarLoQueFalta` de `mapa-escaneo.js`). Una clave
// por usuario. «Limpiar caché» la borra a propósito (no está en
// `CONSERVAR_PREFIJOS`): es una medición, no un dato, y sin ella la pantalla
// vuelve a «se estimará cuando…», que es lo correcto; rehacerla son unos pocos
// artistas. El cambio de usuario no la toca: va por uid, como la del artista.
export const PREFIJO_RITMO = 'mapa_ritmo_v1_';
export const claveRitmo = (uid) => `${PREFIJO_RITMO}${uid}`;

// Comparación de cadenas simple (code units), nunca `localeCompare`: es la regla
// de la muestra de la tanda 50, y la que hace el orden reproducible en cualquier
// navegador.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const decimas = (min) => Math.round((Number(min) || 0) * 10);

/** El tema con más minutos de un artista; a igualdad, el primero de la lista. */
export function temaDe(temas) {
  let mejor = null;
  for (const t of temas || []) if (!mejor || t[2] > mejor[2]) mejor = t;
  return mejor ? mejor[0] : null;
}

/**
 * Los artistas que se escanean: ≥ 10 min, por minutos descendente y, a igualdad,
 * por nombre. Cada uno con su tema (el de la grabación) y sus minutos en décimas.
 */
export function universo(totals, artists) {
  return Object.entries(totals || {})
    .filter(([, t]) => (t?.[1] ?? 0) >= MIN_MINUTOS)
    .sort((a, b) => (b[1][1] - a[1][1]) || cmp(a[0], b[0]))
    .map(([nombre, t]) => ({ nombre, minutos: t[1], decimas: decimas(t[1]), tema: temaDe(artists?.[nombre]) }));
}

// ── Lo que se guarda, recortado a lo que lee la regla ────────────────────────

/** Los candidatos de una búsqueda `/ws/2/artist/`, con lo que lee `clasificar`. */
export function recortarArtistas(resp) {
  return (resp?.artists || []).map((a) => {
    const r = { id: a.id, name: a.name ?? null, 'sort-name': a['sort-name'] ?? null };
    r.aliases = (a.aliases || []).map((x) => ({ name: x?.name ?? null }));
    r.country = a.country ?? null;
    r.area = a.area ? { id: a.area.id ?? null, name: a.area.name ?? null, type: a.area.type ?? null } : null;
    r.disambiguation = a.disambiguation ?? null;
    return r;
  });
}

/**
 * Un área de `/ws/2/area/<id>?inc=area-rels`, con lo que lee `paisDeArea`: su
 * `type`, sus códigos ISO 3166-1, y las relaciones «part of» hacia el PADRE
 * (`backward`). Las `forward` son los hijos (Inglaterra trae 89) y la regla no
 * las lee nunca: guardarlas solo engordaría la caché.
 */
export function recortarArea(resp) {
  return {
    id: resp?.id ?? null,
    type: resp?.type ?? null,
    'iso-3166-1-codes': Array.isArray(resp?.['iso-3166-1-codes']) ? [...resp['iso-3166-1-codes']] : [],
    relations: (resp?.relations || [])
      .filter((r) => r?.type === 'part of' && r.direction === 'backward' && r.area)
      .map((r) => ({
        type: 'part of', direction: 'backward',
        area: { id: r.area.id ?? null, type: r.area.type ?? null, 'iso-3166-1-codes': Array.isArray(r.area['iso-3166-1-codes']) ? [...r.area['iso-3166-1-codes']] : [] },
      })),
  };
}

/**
 * Los ids de artista de todas las grabaciones devueltas, sin repetir. Una
 * búsqueda sin resultados da `[]` —«pregunté y no hay», que se guarda—, nunca
 * `null`, que en la caché quiere decir «no se pidió».
 */
export function idsDeGrabacion(resp) {
  return [...new Set((resp?.recordings || []).flatMap((r) => (r?.['artist-credit'] || []).map((x) => x?.artist?.id).filter(Boolean)))];
}

// ── La secuencia por artista ─────────────────────────────────────────────────

/**
 * Qué le falta a un artista y, si nada, en qué quedó. La secuencia es la de la
 * tanda 51:
 *   1. la búsqueda → `clasificar`;
 *   2. si son varios sin país común (`necesitaGrabacion`): la grabación, y
 *      `clasificar` otra vez con sus ids;
 *   3. un `unico` o `desempatado` sin `country`: su área, salto por salto,
 *      hasta que `completarConArea` deje de pedir;
 *   4. un `unico` que terminó CON país (de `country` o del área): la grabación,
 *      para corroborarlo.
 * Sin tema no hay grabación que buscar: el artista termina con lo que tenga.
 *
 * v=307 (tanda 55), EL RESPALDO: si la búsqueda de siempre da `sin-candidato`
 * (nadie se llama así), se pide la consulta por alias (`{tipo:'respaldo'}`) y,
 * con lo que traiga, la secuencia sigue igual (2-4), con la MISMA regla y la
 * grabación con el nombre que pidió Ian. 🔴 Con cualquier otra clase en la de
 * siempre (`unico`, `varios-mismo-pais`, `desempatado`, `ambiguo`) el respaldo
 * no se pide y, si el registro lo trajera, NO se lee: un artista que hoy tiene
 * país, «sin confirmar» o `ambiguo` no puede cambiar por esto. Esa es la
 * garantía (la vigila `tests/mapa-paises.test.mjs`, sección 10), y es lo que
 * faltaba en la tanda 54, que puso la consulta por alias EN LUGAR de la de
 * siempre y le quitó el país a un artista que lo tenía.
 * Un registro de v=304-306 (sin el campo `respaldo`) que dio `sin-candidato` pide
 * solo el respaldo; mientras tanto cuenta como pendiente («sin buscar todavía»).
 *
 * @param {{nombre: string, tema: string|null}} item
 * @param {object|null} registro  lo guardado del artista (o null)
 * @param {Map|object} areas      id → área recortada
 * @returns {{ falta: null | {tipo:'busqueda'} | {tipo:'respaldo'} | {tipo:'area', id} | {tipo:'grabacion', titulo},
 *             clase, pais, paisDe, mbid, corroborado, categoria, areaMotivo, porRespaldo }}
 */
export function proximoPaso(item, registro, areas) {
  const pend = (falta) => ({ falta, clase: null, pais: null, paisDe: null, mbid: null, corroborado: null, categoria: 'pendiente', areaMotivo: null, porRespaldo: false });
  if (!registro) return pend({ tipo: 'busqueda' });

  let candidatos = registro.candidatos || [];
  let porRespaldo = false;
  if (clasificar(item.nombre, candidatos).clase === 'sin-candidato') {
    if (!Array.isArray(registro.respaldo)) return pend({ tipo: 'respaldo' });
    candidatos = registro.respaldo;
    porRespaldo = true;
  }
  const ids = Array.isArray(registro.grabacion?.ids) ? registro.grabacion.ids : null;
  const puedeGrabacion = !!item.tema;
  const grabacion = { tipo: 'grabacion', titulo: puedeGrabacion ? limpiarTitulo(item.tema) : null };

  let c = clasificar(item.nombre, candidatos);
  if (c.necesitaGrabacion) {
    if (ids === null && puedeGrabacion) return pend(grabacion);
    if (ids) c = clasificar(item.nombre, candidatos, ids);
  }
  const r = completarConArea(c, areas);
  if (r.areaFalta) return pend({ tipo: 'area', id: r.areaFalta });
  if (r.clase === 'unico' && r.pais && ids === null && puedeGrabacion) return pend(grabacion);

  const corr = r.clase === 'unico' && r.pais ? corroborado(r.mbid, ids) : null;
  let categoria;
  if (r.clase === 'varios-mismo-pais' || (r.clase === 'desempatado' && r.pais) || (r.clase === 'unico' && r.pais && corr === true)) categoria = 'pais';
  else if (r.clase === 'unico' && r.pais) categoria = 'sin-confirmar';
  else categoria = 'sin-pais';
  return {
    falta: null, clase: r.clase, pais: r.pais || null, paisDe: r.paisDe ?? null, mbid: r.mbid ?? null,
    corroborado: corr, categoria, areaMotivo: r.areaMotivo ?? null, porRespaldo,
  };
}

// El motivo de quedar sin país, en palabras (castellano de España: lo ve el
// usuario). Nunca el nombre interno de la clase.
function motivoEnPalabras(p, nombrePais, tieneTema) {
  if (p.categoria === 'sin-confirmar') {
    const pais = nombrePais(p.pais);
    return tieneTema
      ? `Sería ${pais}, pero la búsqueda de su tema más escuchado no lo nombra: sin confirmar`
      : `Sería ${pais}, pero no hay ningún tema suyo con el que comprobarlo: sin confirmar`;
  }
  switch (p.clase) {
    case 'sin-candidato': return 'MusicBrainz no tiene a nadie con este nombre';
    case 'ambiguo': return 'Varios artistas se llaman así y la búsqueda de su tema no dice cuál es';
    default:
      if (p.areaMotivo) return 'MusicBrainz lo sitúa en una zona que no lleva a un único país';
      return 'MusicBrainz no le asigna país ni zona';
  }
}

/**
 * Todo lo que pinta la vista, con la caché de hoy.
 *
 * @param {object} o
 * @param {object} o.totals      `totals` de `loadArtistTracks()`
 * @param {object} [o.artists]   `artists` (los temas), para el tema de la grabación
 * @param {Array}  [o.lista]     el `universo()` ya calculado (si no, se calcula)
 * @param {Map|object} o.artistas nombre → registro guardado
 * @param {Map|object} o.areas    id → área recortada
 * @param {(codigo:string)=>string} [o.nombrePais] el nombre del país (la vista
 *        pasa `Intl.DisplayNames`); sin él, el código
 */
export function armarMapa({ totals, artists, lista = null, artistas, areas, nombrePais = (c) => c }) {
  const leer = (m, k) => (typeof m?.get === 'function' ? m.get(k) : m?.[k]) ?? null;
  const u = lista || universo(totals, artists);
  let total = 0;
  for (const t of Object.values(totals || {})) total += decimas(t?.[1]);

  const filas = { conPais: 0, sinPais: 0, sinConfirmar: 0, sinEscanear: 0, menos10: 0 };
  const porPais = new Map();
  const sinPais = [];
  const estados = new Map();
  let escaneados = 0, conPaisArtistas = 0, pendientes = 0, enUniverso = 0;
  for (const it of u) {
    enUniverso += it.decimas;
    const p = proximoPaso(it, leer(artistas, it.nombre), areas);
    estados.set(it.nombre, p);
    if (p.falta) { filas.sinEscanear += it.decimas; pendientes++; continue; }
    escaneados++;
    if (p.categoria === 'pais') {
      filas.conPais += it.decimas;
      conPaisArtistas++;
      let x = porPais.get(p.pais);
      if (!x) porPais.set(p.pais, (x = { codigo: p.pais, nombre: nombrePais(p.pais), decimas: 0, artistas: [] }));
      x.decimas += it.decimas;
      x.artistas.push({ nombre: it.nombre, decimas: it.decimas, paisDe: p.paisDe, clase: p.clase });
    } else {
      if (p.categoria === 'sin-confirmar') filas.sinConfirmar += it.decimas;
      else filas.sinPais += it.decimas;
      sinPais.push({ nombre: it.nombre, decimas: it.decimas, categoria: p.categoria, pais: p.pais, motivo: motivoEnPalabras(p, nombrePais, !!it.tema) });
    }
  }
  filas.menos10 = total - enUniverso;

  const paises = [...porPais.values()]
    .sort((a, b) => (b.decimas - a.decimas) || cmp(a.nombre, b.nombre))
    .map((x) => ({ ...x, pct: total ? (x.decimas / total) * 100 : 0 }));
  return { total, filas, paises, sinPais, universo: u.length, escaneados, conPaisArtistas, pendientes, estados, lista: u };
}
