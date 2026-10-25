// La regla de qué etiqueta es un GÉNERO (v=314, tanda 62).
//
// PURO: sin red, sin IndexedDB, sin DOM. Lo lee la vista de `#generos` (`features/generos.js`) y
// «Cuánto se sabe» (`armarCobertura` de `util/generos-escaneo.js`); se prueba en Node
// (`tests/generos-regla.test.mjs`).
//
// Lo que decidió la planificación con la medición de la 61 en la mano, y por qué:
//   · NO es «la primera etiqueta»: en 12 de los 50 artistas con etiquetas de la tanda 61 la primera
//     no era un género (un país, una ciudad, «dj», un instrumento, basura) y en 6 de esos empataba a
//     100 con un género. Cuentan TODAS las que ya pasan el filtro de siempre (`count >= 5`,
//     `filtrarEtiquetasLastfm`), MENOS las de una lista escrita a mano de lo que NO es un género, y
//     pasando por un mapeo chico de sinónimos a una forma canónica. Ningún corte de `count` además
//     del de siempre: «solo las de 50 o más» sería un número inventado.
//   · 🔴 Las listas las escribió la sesión LEYENDO las etiquetas de a una (las de la muestra de la 61
//     y las de la mitad A de la 62), nunca un modelo de lenguaje, y nada bajado ni generado.
//   · 🔴 El repo es público: la lista lleva SOLO lo genérico (países, gentilicios, ciudades, décadas,
//     instrumentos, descriptores de voz, etiquetas personales genéricas). Los NOMBRES PROPIOS (otro
//     artista, un grupo, un colectivo, un programa de la tele) y la basura idiosincrática NO van
//     escritos: identificarían artistas concretos. La basura se caza con PATRONES (abajo). Los
//     nombres propios se quedan contando como género: es un defecto conocido (son géneros de uno o
//     dos artistas, no llegan al top). Y ninguna regla del tipo «si se llama como un artista de tu
//     historial no es un género»: hay artistas que se llaman como un género y se borraría el género.
//   · El autocorrect que devuelve OTRO artista no cuenta (ver `generosDeArtista`); desde v=316 lo
//     decide `mismoArtistaAutocorregido` de `util/autocorrect-lastfm.js`, la misma del mapa de artistas.
//   · v=320 (tanda 67): una etiqueta igual al nombre del PROPIO artista no es un género
//     (`esNombreDelArtista`, con `claveEscritura` importada: ninguna normalización nueva). Solo el propio:
//     contra OTROS artistas del historial no se compara (hay artistas que se llaman como un género).
//
// La fuente de cada entrada, entre corchetes: `61: n` = en n de los 51 artistas de la tanda 61
// (`fonoteca-migracion/generos/medicion-lastfm-2026-10-17.json`); `62A: n` = en n de los 98 de la
// mitad A de la tanda 62 (`medicion-lastfm-t62-2026-10-17.json`); `62B: n`, ídem en la mitad B, que
// se sumó DESPUÉS de medir lo que se le escapaba a la versión 1 (ver `PENDIENTES.md`); «como X» =
// no se vio en ninguna muestra y se agregó por ser de la misma clase que X (son las sospechosas).

import { decidirEtiquetas } from './generos-artista.js?v=340';
import { mismoArtistaAutocorregido, claveEscritura } from './autocorrect-lastfm.js?v=340';
// ⚠️ Un import circular A PROPÓSITO: `generos-escaneo.js` importa `generosDeArtista` de acá para
// «Cuánto se sabe», y acá hace falta su `yaBuscado` (UNA sola función decide «ya buscado», v=219).
// Es seguro porque ninguno de los dos usa lo del otro al cargarse, solo adentro de funciones.
import { yaBuscado } from './generos-escaneo.js?v=340';

/** Lo que NO es un género, en minúsculas. Cada entrada, con de dónde sale. */
export const NO_ES_GENERO = new Set([
  // países, gentilicios, ciudades y regiones
  'british',            // [61: 4 · 62A: 10]
  'canadian',           // [61: 4 · 62A: 2]
  'american',           // [61: 1 · 62A: 6]
  'usa',                // [61: 2 · 62A: 3]
  'australian',         // [61: 2 · 62A: 2]
  'colombia',           // [61: 2 · 62A: 2]
  'spanish',            // [61: 1 · 62A: 2]
  'united states',      // [61: 1 · 62A: 2]
  'argentina',          // [62A: 2]
  'canada',             // [61: 1 · 62A: 1]
  'dutch',              // [61: 1 · 62A: 1]
  'german',             // [61: 1 · 62A: 1]
  'irish',              // [61: 1 · 62A: 1]
  'korean',             // [61: 1 · 62A: 1]
  'mexico',             // [62A: 2]
  'spain',              // [61: 2]
  'zimbabwe',           // [61: 1 · 62A: 1]
  'atlanta',            // [61: 1]
  'australia',          // [62A: 1]
  'boston',             // [61: 1]
  'estonian',           // [61: 1]
  'georgia',            // [61: 1]
  'icelandic',          // [61: 1]
  'iranian',            // [61: 1]
  'ireland',            // [61: 1]
  'israeli',            // [61: 1]
  'italian',            // [61: 1]
  'japanese',           // [62A: 1]
  'netherlands',        // [61: 1]
  'norwegian',          // [62A: 1]
  'poland',             // [61: 1]
  'sweden',             // [61: 1]
  'the netherlands',    // [61: 1]
  'uk',                 // [61: 1]
  'ukraine',            // [62A: 1]
  'united kingdom',     // [61: 1]
  'vancouver',          // [62A: 1]
  'so very british',    // [62A: 1]
  'colombian',          // [como colombia]
  'mexican',            // [como mexico]
  'argentine',          // [como argentina]
  'argentinian',        // [como argentina]
  'germany',            // [como german]
  'italy',              // [como italian]
  'japan',              // [como japanese]
  'korea',              // [como korean]
  'south korea',        // [como korean]
  'swedish',            // [como sweden]
  'norway',             // [como norwegian]
  'iran',               // [como iranian]
  'israel',             // [como israeli]
  'iceland',            // [como icelandic]
  'estonia',            // [como estonian]
  'polish',             // [como poland]
  'ukrainian',          // [como ukraine]
  'zimbabwean',         // [como zimbabwe]
  'england',            // [como british]
  'english',            // [como british]
  'north carolina',     // [62B: 1]
  'new york',           // [62B: 2]
  'french',             // [62B: 1]
  'new zealand',        // [62B: 1]
  'dc',                 // [62B: 1]
  'guatemala',          // [62B: 1]
  'detroit',            // [62B: 1]
  'los angeles',        // [62B: 1]
  'venezuela',          // [62B: 1]
  'venezuelan',         // [62B: 1]
  'kazakhstan',         // [62B: 1]
  'seattle',            // [62B: 1]
  'puerto rico',        // [62B: 1]
  'nigeria',            // [62B: 1]
  'armenia',            // [62B: 1]
  'armenian',           // [62B: 1]
  // instrumentos y cómo suena (no qué género es)
  'piano',              // [61: 2]
  'acoustic',           // [62A: 3]
  'instrumental',       // [61: 1]
  'guitar',             // [como piano]
  // quién canta
  'female vocalists',   // [61: 5 · 62A: 8]
  'male vocalists',     // [62A: 4]
  'female vocalist',    // [62A: 1]
  'girl groups',        // [62A: 1]
  'femboy',             // [62A: 1]
  'male vocalist',      // [como male vocalists]
  // etiquetas personales, oficios y formatos
  'all',                // [61: 1]
  'spotify',            // [61: 1]
  'peak',               // [61: 1]
  'sexy',               // [62A: 2]
  'funky',              // [62A: 1]
  'guilty pleasure',    // [62A: 1]
  'producer',           // [62A: 2]
  'dj',                 // [61: 1 · 62A: 1]
  'remix',              // [62A: 1]
  'oldies',             // [62A: 2]
  'smooth',             // [62B: 1]
  'underground',        // [62B: 1]
  'dark',               // [62B: 1]
  'cocaine',            // [62B: 1]
  'composer',           // [62B: 1]
  'podcast',            // [62B: 1]
  'seen live',          // [como all]
  'favorites',          // [como all]
  'favourites',         // [como all]
  'favorite',           // [como all]
  'favourite',          // [como all]
]);

/**
 * Lo que no es un género y NO se puede escribir (identificaría a un artista), o una clase entera.
 * Cada patrón con de dónde sale, SIN el texto de la etiqueta que lo motivó.
 */
export const PATRONES_NO_GENERO = [
  { re: /_/, que: 'lleva un guion bajo (el lote de un programa)', fuente: '61: 1' },
  { re: /\d{4,}/, que: 'cuatro o más dígitos seguidos (un número de teléfono o de fax)', fuente: '61: 1' },
  { re: /^(\S+\s+){4,}\S+$/, que: 'cinco palabras o más (una frase)', fuente: '61: 1 · 62A: 1' },
  { re: /^(19|20)?\d0s$/, que: 'una década (80s, 1990s): una época, no un género', fuente: '61: 3 · 62A: 10' },
  { re: /^\d+(\.\d+)?\s*stars?$/, que: 'una nota personal (5 stars)', fuente: '61: 2' },
  { re: /^my\s/, que: 'empieza con «my» (una lista personal)', fuente: '61: 1 · 62A: 4' },
];

/**
 * Variantes de ESCRITURA del mismo nombre → la forma canónica. Nada de agrupar subgéneros en un
 * padre: `rap` y `hip hop` no son sinónimos, ni `trap` y `hip hop`, ni `house` y `dance`.
 */
export const SINONIMOS = {
  // `hip hop` sin guion, como lo escribe el diccionario de la RAE.   [61: 8 con las dos · 62A: 11 con las dos]
  'hip-hop': 'hip hop',
  // El nombre entero; las otras son una sigla y una contracción.      [61: 2 con dos o más · 62A: 1]
  'dnb': 'drum and bass',
  'drum n bass': 'drum and bass',
  // La forma con más artistas (3 contra 1).                            [61: 1 con las dos]
  'synth pop': 'synthpop',
  // La forma con más artistas (21 contra 1 y 1).                       [61: 1 con dos · 62A: 1 con dos]
  'rhythm and blues': 'rnb',
  'r&b': 'rnb',
  // La forma con más artistas (13 contra 1).                           [62A: 1 con la otra forma]
  'singer songwriter': 'singer-songwriter',
  // La forma con más artistas (3 contra 1).                            [62A: 1 con las dos]
  'pop-rock': 'pop rock',
  // Como `hip hop`.                                                    [62A: 1 con las dos]
  'lo-fi hip-hop': 'lo-fi hip hop',
  // El nombre entero, como `drum and bass`.                            [62A: 1 con las dos]
  'rock n roll': 'rock and roll',
  // El nombre entero; `psytrance` es su contracción.                   [61: 1 con las dos]
  'psytrance': 'psychedelic trance',
  // La forma con más artistas (6 contra 1).                            [62B: 1 con las dos]
  'neo soul': 'neo-soul',
};

const limpia = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** ¿Es un género? No si está vacía, si está en la lista o si cae en algún patrón. */
export function esGenero(etiqueta) {
  const t = limpia(etiqueta);
  if (!t || NO_ES_GENERO.has(t)) return false;
  return !PATRONES_NO_GENERO.some((p) => p.re.test(t));
}

/**
 * ¿La etiqueta es el nombre del propio artista? (v=320, tanda 67) `true` si su `claveEscritura` no es vacía y es igual
 * a la del `nombre`: las mismas reglas de escritura del autocorrect (mayúsculas, «$» por «s», «&», un «the» adelante,
 * la puntuación). Igual, no «contiene»: «banda inventada rock» no es «Banda Inventada».
 */
export function esNombreDelArtista(etiqueta, nombre) {
  const k = claveEscritura(String(etiqueta ?? ''));
  return !!k && k === claveEscritura(String(nombre ?? ''));
}

/** La forma canónica (en minúsculas): la del mapeo, o la misma. */
export function canonico(etiqueta) {
  const t = limpia(etiqueta);
  return SINONIMOS[t] ?? t;
}

/**
 * Los géneros de un artista, y por qué no tiene ninguno.
 *   · Las etiquetas son las de `decidirEtiquetas` de siempre (todas las fuentes del registro, en su
 *     orden, mezcladas): lo mismo que lee `#genre` y lo que contaba «Cuánto se sabe» en v=313.
 *     ⚠️ Eso incluye lo que `#genre` trajo de MusicBrainz con su `limit=1` a ciegas y lo migrado de
 *     fuente desconocida (defecto conocido, en `PENDIENTES.md`; no se arregla acá).
 *   · El autocorrect: si Last.fm devolvió un `artista` que no es el MISMO que el pedido según
 *     `mismoArtistaAutocorregido` (`util/autocorrect-lastfm.js`, v=316: igual con `normalizarNombre`,
 *     o la misma escritura —«Travi$ Scott»—), lo de Last.fm de ese artista no se usa (las etiquetas
 *     son de OTRO). Se decide sobre una copia con
 *     `fuentes.lastfm = null`: el registro y `decidirEtiquetas` no se tocan. Lo de las otras fuentes
 *     sigue valiendo. Sin `artista` (lo de `#genre`, lo migrado) se usa como siempre.
 *   · Se quedan las que `esGenero`, pasadas por `canonico` y sin repetir (`hip-hop` y `hip hop`
 *     cuentan UNA vez, en `hip hop`), en el orden de la mezcla.
 *   · v=320: una etiqueta igual al nombre del propio artista (`esNombreDelArtista`, con `nombre` o, si no viene,
 *     `reg.nombre`) no cuenta, igual que una de `NO_ES_GENERO`. Si era la única de género y tenía etiquetas, el
 *     artista va a «sin-genero», como cualquiera.
 *
 * @returns {{ generos: string[], motivo: null | 'sin-buscar' | 'no-tiene' | 'sin-genero' }}
 *   `motivo` es `null` si tiene alguno; si no: `sin-genero` (tiene etiquetas, ninguna de género),
 *   `no-tiene` (Last.fm ya contestó y no hay nada que usar: vacío, o era otro artista) o
 *   `sin-buscar` (nadie contestó todavía).
 */
export function generosDeArtista(registro, nombre) {
  let reg = registro;
  const devuelto = reg?.fuentes?.lastfm?.artista;
  if (!mismoArtistaAutocorregido(nombre ?? reg?.nombre, devuelto)) {
    reg = { ...reg, fuentes: { ...reg.fuentes, lastfm: null } };
  }
  const tags = decidirEtiquetas(reg) || [];
  const propio = nombre ?? reg?.nombre;
  const generos = [];
  for (const t of tags) {
    if (!esGenero(t.name) || esNombreDelArtista(t.name, propio)) continue;
    const c = canonico(t.name);
    if (!generos.includes(c)) generos.push(c);
  }
  if (generos.length) return { generos, motivo: null };
  if (tags.length) return { generos, motivo: 'sin-genero' };
  return { generos, motivo: yaBuscado(registro) ? 'no-tiene' : 'sin-buscar' };
}

// El orden de `universo()` (`mapa-paises.js`): la comparación simple, la misma en cualquier navegador.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const decimas = (min) => Math.round((Number(min) || 0) * 10);

/**
 * Tus géneros: por género canónico, los minutos (en décimas, enteras) y sus artistas.
 *   · 🔴 Los minutos NO se reparten: cada artista suma sus minutos ENTEROS a CADA uno de sus géneros
 *     (repartir por el `count` sería inventarse pesos). Por eso los porcentajes suman más de 100.
 *   · El porcentaje es sobre el total de TODO el historial (las décimas de todos los `totals`,
 *     también los de menos de 10 min), como el mapa. Los «sin buscar todavía» no están en ningún
 *     género y no se reparten.
 *   · Ordenado por minutos y, a igualdad, por nombre. Los artistas de cada uno, en el orden de
 *     `lista` (el de `universo()`: por minutos y a igualdad por nombre).
 *
 * @param {object} o
 * @param {object} o.totals   `totals` del historial (`[1]` = minutos)
 * @param {Array}  o.lista    `universo()` (≥ 10 min, ya en orden)
 * @param {Function} o.registro `(nombre) => registro | null`
 */
export function armarGeneros({ totals, lista, registro }) {
  let total = 0;
  for (const t of Object.values(totals || {})) total += decimas(t?.[1]);
  const porGenero = new Map();
  let conGeneros = 0;
  for (const it of lista) {
    const { generos } = generosDeArtista(registro(it.nombre), it.nombre);
    if (generos.length) conGeneros++;
    for (const g of generos) {
      let x = porGenero.get(g);
      if (!x) porGenero.set(g, (x = { genero: g, decimas: 0, artistas: [] }));
      x.decimas += it.decimas;
      x.artistas.push({ nombre: it.nombre, decimas: it.decimas });
    }
  }
  const generos = [...porGenero.values()]
    .sort((a, b) => (b.decimas - a.decimas) || cmp(a.genero, b.genero))
    .map((x) => ({ ...x, pct: total ? (x.decimas / total) * 100 : 0 }));
  return { total, generos, conGeneros };
}
