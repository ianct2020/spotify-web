// ¿Este lanzamiento es el MISMO álbum que otro, solo que con un agregado en el
// título? (v=165)
//
// El caso real: en #discover-artists y #new-releases aparecían los deluxe de
// discos que Ian ya había escuchado como si fueran novedades. El cruce se hacía
// con `albumKey`, que sí saca «(Remastered)» y «(Deluxe Edition)» pero **solo
// cuando el agregado viene detrás de un separador y con las palabras exactas de
// su lista**: «Sombras Complete Edition», «Igor Bonus», «X (10th Anniversary
// Deluxe)» se le escapan enteros.
//
// ⚠️ **Esto NO es «normalizar más los nombres».** Aflojar `albumKey` fusiona
// American Football LP2/LP3, Crystal Castles I/II y el ÷ / = / + de Ed Sheeran,
// que ya costó caro dos veces. Acá el criterio es el mismo que el filtro de
// vivo/aniversario de v=152: una **lista explícita de palabras**, y el agregado
// se saca solo si el trozo que se descarta está formado ENTERAMENTE por
// palabras de esa lista. «(LP3)» no lo está, así que no se toca; «(Deluxe
// Edition)» sí; «(10th Anniversary Edition, Remastered 2011)» también.
//
// La comparación es simétrica por construcción: se le saca el agregado a los
// DOS títulos y se comparan las bases. Da igual si el que tiene el agregado es
// el candidato o el que ya se escuchó.

// Las palabras que, POR SÍ SOLAS, marcan que el trozo es un agregado de
// edición. Sin al menos una de estas, el trozo no se saca aunque el resto de
// sus palabras sean de relleno: «(Live)» y «(Acústico)» son otro disco, no el
// mismo con un agregado, y de ellos ya se ocupa `esEnVivoOAniversario`.
const NUCLEO = new Set([
  'deluxe', 'expanded', 'expandida', 'bonus', 'anniversary', 'aniversario',
  'remaster', 'remastered', 'remasterizado', 'remasterizada', 'reissue',
  'complete', 'completa', 'completo', 'special', 'especial',
  'collector', 'collectors', 'legacy', 'definitive', 'definitiva',
  'ultimate', 'extended', 'platinum', 'platino',
]);

// Palabras que pueden acompañar a una del núcleo dentro del mismo trozo. Solas
// no alcanzan para descartar nada.
const RELLENO = new Set([
  'the', 'a', 'an', 'de', 'del', 'la', 'el', 'los', 'las', 'of', 'and', 'y',
  'edition', 'editions', 'edicion', 'edición', 'ed', 'version', 'versión',
  'version', 'track', 'tracks', 'pista', 'pistas', 'super', 'mega', 'ultra',
  'original', 'standard', 'estandar', 'estándar', 'explicit', 'clean',
  'digital', 'international', 'internacional', 'plus', 'new', 'nueva', 'nuevo',
]);

const ANIO = /^(19|20)\d{2}$/;
const ORDINAL = /^\d{1,3}(st|nd|rd|th|º|ª|o|a)?$/i;

function tokens(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9º ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * ¿Este trozo suelto —lo que va dentro de un paréntesis, o detrás del último
 * guion— es un agregado de edición y nada más?
 */
export function esAgregadoDeEdicion(trozo) {
  const ts = tokens(trozo);
  if (!ts.length) return false;
  let hayNucleo = false;
  for (const t of ts) {
    if (NUCLEO.has(t)) { hayNucleo = true; continue; }
    if (RELLENO.has(t) || ANIO.test(t) || ORDINAL.test(t)) continue;
    return false;   // una palabra que no es de la lista: no lo tocamos
  }
  return hayNucleo;
}

// La cola pegada al título, sin separador: «Igor Deluxe», «Sombras Expanded».
// Lista CORTA a propósito: sin separador que la delimite, cualquier palabra
// ambigua se comería parte del nombre real («Midnight Gold» → «Midnight»).
const COLA_PELADA = new RegExp(
  '\\s+(?:' +
    // una palabra que sola ya alcanza
    '(?:super\\s+)?(?:deluxe|expanded|remastered|remaster|reissue)(?:\\s+(?:edition|version))?' +
    '|' +
    // dos palabras: la ambigua solo cuenta si viene con «edition»/«version»
    '(?:\\d{1,3}(?:st|nd|rd|th)\\s+)?' +
    '(?:complete|special|anniversary|collector\'?s?|legacy|definitive|ultimate|platinum)' +
    '\\s+(?:edition|version)' +
    '|' +
    'bonus\\s+tracks?(?:\\s+version)?' +
  ')\\s*$', 'i');

/**
 * El título sin su agregado de edición. Si no tiene ninguno —o si sacarlo
 * dejaría el título vacío— devuelve el título tal cual.
 */
export function baseDeEdicion(titulo) {
  const original = String(titulo || '').trim();
  let s = original;
  // Hasta 3 vueltas: «Album (Deluxe Edition) [Remastered 2011]» son dos trozos.
  for (let i = 0; i < 3; i++) {
    const antes = s;
    s = s.replace(/\s*[([{]([^)\]}]*)[)\]}]\s*$/, (m, g) => (esAgregadoDeEdicion(g) ? '' : m));
    s = s.replace(/\s*[-–—:]\s*([^-–—:]*)$/, (m, g) => (esAgregadoDeEdicion(g) ? '' : m));
    s = s.replace(COLA_PELADA, '');
    s = s.trim();
    if (!s) return original;      // era todo agregado: no se toca
    if (s === antes) break;
  }
  return s || original;
}

/** ¿El título trae un agregado de edición? (para contar y para depurar) */
export function tieneAgregadoDeEdicion(titulo) {
  const s = String(titulo || '').trim();
  return !!s && baseDeEdicion(s) !== s;
}
