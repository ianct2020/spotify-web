// «Solo cambia la edición del disco»: la propuesta automática de #versions (tanda 70).
//
// Ian, el 16/10: «estaría bueno uno que haga automático con deluxes y yo solo
// confirme». En muchos grupos de «Versiones duplicadas» la única diferencia es
// el disco: el mismo tema likeado en «X» y en «X (Deluxe Edition)». Ahí la
// decisión es mecánica y este módulo la PROPONE. Nunca tilda nada: eso lo hace
// Ian, grupo por grupo, con el botón de cada tarjeta.
//
// ⚠️ El riesgo que importa NO es perder canciones (la edición que queda tiene el
// tema, y la guarda del último ejemplar ya lo impide). Es emparejar dos
// grabaciones DISTINTAS —un remaster, una regrabación, un vivo— y que Ian,
// confiado, borre la que quería. Por eso la regla es estricta y todo lo dudoso
// se resuelve hacia NO proponer: si un solo miembro no cumple, el grupo entero
// queda a mano, como hasta v=322.
//
// Puro a propósito: sin red, sin DOM, sin reloj, sin IndexedDB. Lo mide
// `fonoteca-migracion/deluxes/medir-deluxes-*.mjs` contra el export (la parte
// por nombres, que vive UNA sola vez en `motivosPorNombre`) y lo prueba
// `tests/deluxe-propuesta.test.mjs`. Si la medición aprieta la regla, se aprieta
// acá y la vista lo hereda.
//
// Lo que se IMPORTA y no se copia ni se afloja: `VERSION_MARKERS` (la clave de
// #versions) y `baseDeEdicion` / `tieneAgregadoDeEdicion` (los filtros de
// descubrir, v=165).

import { VERSION_MARKERS } from './versions-guard.js?v=343';
import { baseDeEdicion, tieneAgregadoDeEdicion } from './edition-suffix.js?v=343';

// Tope de diferencia de duración entre el más largo y el más corto del grupo.
export const TOPE_DURACION_MS = 2000;

/**
 * La limpieza MÍNIMA del título y del artista: NFC, minúsculas, apóstrofos
 * tipográficos al recto, espacios colapsados y recortados. Nada más: ni
 * `normText`, ni `EDITION_STRIP`, ni sacar paréntesis. «X» y «X - 2011
 * Remaster» NO son el mismo título acá, y eso es lo que se quiere.
 */
export function limpiarNombre(s) {
  return String(s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Para buscar marcadores sin distinguir mayúsculas NI ACENTOS: «Acústico» y
// «acustico» tienen que caer igual. Solo se usa para buscar, nunca para comparar.
function plegar(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'");
}

// Los marcadores que se SUMAN a `VERSION_MARKERS` (que se usa tal cual). Cada
// uno dice por qué está; ante la duda sobre una palabra, va a la lista: un
// título con cualquiera de estas deja el grupo a mano.
//
// Se escriben ya plegados (sin acentos, en minúsculas) porque se buscan sobre
// el título plegado, y como PALABRA ENTERA: ni letra ni dígito pegado a ningún
// lado («mix» no cae dentro de «remix», que tiene su propia entrada).
const MARCADORES_EXTRA = [
  'remix', 'remixes', 'remixed',           // otra mezcla; los plurales y el participio, por la duda
  'mix', 'mixed',                          // «Club Mix», «Mixed»: otra mezcla
  'en vivo', 'live',                       // otra toma
  'acustico', 'acustica', 'acoustic',      // otra toma
  'remaster', 'remastered', 'remasterizado', 'remasterizada', // otra masterización: el título ya lo dice
  'radio edit', 'edit',                    // otro corte
  'demo', 'demos',                         // otra grabación
  'regrabacion', 're-recorded', 'rerecorded', // otra grabación
  'sped up', 'slowed', 'reverb', 'nightcore', '8d', // otra versión del audio
  'instrumental', 'karaoke',               // sin voz: otra pista
  'a cappella', 'a capella', 'acapella', 'acappella', // solo voz: otra pista
  'version', 'versions', 'versiones',      // cualquier «X Version»: «Taylor's Version», «Album Version», «Piano Version»
  'mono', 'stereo',                        // otra mezcla
  'bonus',                                 // la pista agregada de una edición: puede no ser la misma
  'session', 'sessions',                   // otra toma
  'unplugged', 'rework', 'reworked', 'reimagined', // otra toma / otro arreglo
  'cover',                                 // otro intérprete
  'commentary',                            // no es el tema
];
// «versión» lleva tilde y se pliega a «version»: no hace falta escribirla dos veces.
const RE_MARCADORES_EXTRA = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' +
    // (el guion NO se escapa: con la bandera `u`, `\-` fuera de una clase es inválido)
    MARCADORES_EXTRA.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|') +
  ')(?![\\p{L}\\p{N}])', 'u');

// ── Apretado en la medición de la tanda 70 (mitad A, 20/10/2026) ─────────────
//
// Un DISCO cuyo nombre trae una de estas palabras puede ser otra grabación del
// mismo tema aunque `baseDeEdicion` lo dé por edición. La mitad A del export
// marcó 47 grupos por nombres y 4 eran de esta clase (sin nombres: los nombres
// están en `fonoteca-migracion/deluxes/`):
//   · «Remastered Edition» contra el disco sin cola: otra masterización, que el
//     encargo cuenta como otra grabación (1 grupo);
//   · «Extended Edition» contra «Expanded Edition»: puede ser un disco de
//     mezclas extendidas (1 grupo);
//   · «<alguien>'s Version»: otra versión del disco hecha por otra persona (o
//     una regrabación, como «Taylor's Version»), no una edición (2 grupos).
// Se suman, por ser de la misma clase y sin haberse visto, las palabras de
// regrabación y de remezcla: ninguna puede estar en el nombre de una edición
// que sea la misma grabación. Se busca en el nombre ENTERO del disco (más
// estricto que mirar solo la cola: un disco que se llama así de base también
// queda a mano), plegado y como palabra entera.
const DISCO_OTRA_GRABACION = [
  'remaster', 'remastered', 'remasterizado', 'remasterizada', // otra masterización (visto: 1)
  'extended',                                                  // ¿mezclas extendidas? (visto: 1)
  're-recorded', 'rerecorded', 'regrabado', 'regrabada', 'regrabacion', // regrabación (misma clase que la posesiva)
  'remix', 'remixes', 'remixed', 'rework', 'reworked', 'reimagined', // otra mezcla u otro arreglo
];
const RE_DISCO_OTRA_GRABACION = new RegExp(
  '(?<![\\p{L}\\p{N}])(?:' + DISCO_OTRA_GRABACION.join('|') + ')(?![\\p{L}\\p{N}])', 'u');
// «Metro's Version», «Taylor's Version»: la forma posesiva entera, en cualquier
// lugar del nombre (visto: 2).
const RE_VERSION_POSESIVA = /[\p{L}\p{N}]'s\s+version(?![\p{L}\p{N}])/u;

/** ¿El nombre de este DISCO dice que puede ser otra grabación? (apretado en la tanda 70) */
export function discoDeOtraGrabacion(disco) {
  const s = plegar(disco);
  return RE_DISCO_OTRA_GRABACION.test(s) || RE_VERSION_POSESIVA.test(s);
}

/** ¿El título CRUDO trae algún marcador de versión? (`VERSION_MARKERS` + la lista de arriba) */
export function tieneMarcadorDeVersion(titulo) {
  const crudo = String(titulo ?? '');
  return VERSION_MARKERS.test(crudo) || RE_MARCADORES_EXTRA.test(plegar(crudo));
}

// Un miembro del grupo puede venir como el item de los me gusta (`{ track }`,
// como los arma #versions) o como la pista sola.
const pista = (m) => (m && m.track) || m || {};

const todosIguales = (xs) => xs.every(x => x === xs[0]);
const todosDistintos = (xs) => new Set(xs).size === xs.length;

/**
 * Las condiciones que se deciden SOLO CON NOMBRES. Es la parte que mide el
 * script contra el export: vive una sola vez, acá, y `propuestaDeGrupo` la usa.
 *
 * Devuelve la lista de las que FALLAN (vacía = pasa por nombres). Puede fallar
 * más de una a la vez y se devuelven todas: la medición cuenta por motivo.
 */
export function motivosPorNombre(grupo) {
  const miembros = (grupo || []).map(pista);
  if (miembros.length < 2) return ['menos-de-dos'];
  const motivos = [];

  const artistas = miembros.map(t => limpiarNombre(t.artists?.[0]?.name));
  if (artistas.some(a => !a) || !todosIguales(artistas)) motivos.push('artista-distinto');

  const titulos = miembros.map(t => limpiarNombre(t.name));
  if (titulos.some(x => !x) || !todosIguales(titulos)) motivos.push('titulo-distinto');

  if (miembros.some(t => tieneMarcadorDeVersion(t.name))) motivos.push('marcador-de-version');

  const discos = miembros.map(t => String(t.album?.name ?? ''));
  if (discos.some(d => !d.trim())) {
    motivos.push('disco-sin-nombre');
  } else {
    // «Nombres distintos» después de la limpieza mínima: dos discos que solo
    // difieren en mayúsculas o espacios son el mismo nombre.
    if (!todosDistintos(discos.map(limpiarNombre))) motivos.push('disco-mismo-nombre');
    // La base, EXACTA (sin limpiar): «x» contra «X (Deluxe)» queda a mano.
    const bases = discos.map(d => baseDeEdicion(d));
    if (bases.some(b => !b.trim()) || !todosIguales(bases)) motivos.push('base-distinta');
    if (!discos.some(d => tieneAgregadoDeEdicion(d))) motivos.push('sin-agregado-de-edicion');
    // Apretado en la tanda 70 (ver `discoDeOtraGrabacion`).
    if (discos.some(d => discoDeOtraGrabacion(d))) motivos.push('disco-de-otra-grabacion');
  }
  return motivos;
}

/**
 * La regla ENTERA: lo de nombres más lo que solo trae la API. Devuelve la lista
 * de lo que falla (vacía = hay propuesta). Exportada para los tests y para
 * poder decir por qué un grupo quedó a mano.
 */
export function motivosDeLaRegla(grupo) {
  const motivos = motivosPorNombre(grupo);
  const miembros = (grupo || []).map(pista);
  if (miembros.length < 2) return motivos;

  const idsDisco = miembros.map(t => t.album?.id);
  if (idsDisco.some(id => !id) || !todosDistintos(idsDisco)) motivos.push('disco-mismo-id');

  // El single contra el álbum NO entra: Ian dijo «con deluxes».
  if (!miembros.every(t => t.album?.album_type === 'album')) motivos.push('no-es-album');

  const durs = miembros.map(t => t.duration_ms);
  if (!durs.every(d => Number.isFinite(d) && d > 0)) motivos.push('sin-duracion');
  else if (Math.max(...durs) - Math.min(...durs) > TOPE_DURACION_MS) motivos.push('duracion-distinta');

  const expl = miembros.map(t => t.explicit);
  if (!expl.every(e => typeof e === 'boolean') || !todosIguales(expl)) motivos.push('explicit-distinto');

  // ISRC: si TODOS lo traen, tienen que ser iguales. Si falta en alguno, la
  // regla sigue sin él (y la vista lo dice). Nunca se propone con ISRC distintos.
  const isrcs = miembros.map(t => String(t.external_ids?.isrc ?? '').trim().toUpperCase());
  if (isrcs.every(Boolean) && !todosIguales(isrcs)) motivos.push('isrc-distinto');

  // La edición que queda: la de MÁS pistas, si es única. A igualdad, a mano.
  const pistas = miembros.map(t => t.album?.total_tracks);
  if (!pistas.every(n => Number.isInteger(n) && n > 0)) motivos.push('sin-total-de-pistas');
  else if (pistas.filter(n => n === Math.max(...pistas)).length !== 1) motivos.push('empate-de-pistas');

  return motivos;
}

/**
 * La propuesta de un grupo de #versions, o `null` (queda a mano).
 *
 * `{ queda: [ids], seBorran: [ids], porque }`, con todo lo que la vista enseña:
 * la diferencia de duración en ms, si los dos son explícitos, el estado del
 * ISRC (`'igual'` o `'no-esta'`), la base del disco y las pistas de cada
 * edición. No tilda nada: eso es de quien llama, y solo con un clic de Ian.
 */
export function propuestaDeGrupo(grupo) {
  if (motivosDeLaRegla(grupo).length) return null;
  const miembros = (grupo || []).map(pista);
  const pistas = miembros.map(t => t.album.total_tracks);
  const max = Math.max(...pistas);
  const durs = miembros.map(t => t.duration_ms);
  const isrcs = miembros.map(t => String(t.external_ids?.isrc ?? '').trim());
  const ediciones = miembros.map(t => ({
    id: t.id,
    disco: t.album.name,
    pistas: t.album.total_tracks,
    queda: t.album.total_tracks === max,
  }));
  return {
    queda: ediciones.filter(e => e.queda).map(e => e.id),
    seBorran: ediciones.filter(e => !e.queda).map(e => e.id),
    porque: {
      diferenciaMs: Math.max(...durs) - Math.min(...durs),
      explicit: miembros[0].explicit,
      isrc: isrcs.every(Boolean) ? 'igual' : 'no-esta',
      base: baseDeEdicion(miembros[0].album.name),
      ediciones,
    },
  };
}

// ── «Le faltan datos» no es «no es de edición» (tanda 80, v=335) ─────────────
//
// La caché de me gusta es incremental y no caduca: lo guardado antes de v=127
// no trae `album_type` ni `total_tracks`, y la regla de arriba los exige en
// TODOS los miembros. Un grupo con un me gusta viejo cae por `no-es-album` o
// `sin-total-de-pistas`, y hasta v=334 la vista decía «Ningún grupo es solo de
// edición.»: un resultado del dominio tapando un dato que falta. Estas dos NO
// tocan la regla (las tres de arriba quedan byte a byte, lo vigila
// `tests/versions-faltan-datos.test.mjs`): solo cuentan aparte, para el cartel.

/**
 * ¿A este miembro le falta algún dato de los que la regla lee y solo trae la
 * API? `album_type` vacío (`'single'` o `'compilation'` son valores, no faltan),
 * `total_tracks` que no es un entero > 0, `duration_ms` que no es > 0, o
 * `explicit` que no es booleano. El ISRC no cuenta: la regla ya sigue sin él.
 */
export function faltanDatos(miembro) {
  const t = pista(miembro);
  const tipo = t.album?.album_type;
  if (tipo == null || tipo === '') return true;
  const n = t.album?.total_tracks;
  if (!Number.isInteger(n) || n <= 0) return true;
  if (!(typeof t.duration_ms === 'number' && t.duration_ms > 0)) return true;
  return typeof t.explicit !== 'boolean';
}

/**
 * Cuántos grupos «podrían ser solo de edición, pero faltan datos»: pasan por
 * nombres (`motivosPorNombre` vacío) y algún miembro tiene un dato faltante. Es
 * una COTA: con los datos completos pueden seguir sin propuesta. `meGusta` son
 * los me gusta distintos (por id) con algún dato faltante dentro de esos grupos.
 */
export function resumenDeFaltantes(grupos) {
  let n = 0;
  const ids = new Set();
  for (const grupo of grupos || []) {
    if (motivosPorNombre(grupo).length) continue;
    const viejos = (grupo || []).filter(faltanDatos);
    if (!viejos.length) continue;
    n++;
    viejos.forEach((m, i) => ids.add(pista(m).id ?? `sin-id-${n}-${i}`));
  }
  return { grupos: n, meGusta: ids.size };
}
