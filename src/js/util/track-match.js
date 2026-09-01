// Verificación de que el resultado de un proveedor externo (iTunes, Deezer) es
// REALMENTE la canción que pedimos.
//
// El bug que arregla: la cadena de previews buscaba "artista + título" por texto
// y, si ningún resultado coincidía con el título, se quedaba con el primero que
// coincidía SOLO por artista. Resultado real: pedir "Not PLaying" (Playboi
// Carti) y que sonara "Timeless" (The Weeknd & Playboi Carti). Reproducir otra
// canción es peor que no reproducir nada.
//
// Reglas:
//   - Título: normalizado (sin acentos, sin "(feat. …)", sin sufijos de
//     remaster/edición, sin puntuación). Igualdad exacta o similitud de
//     bigramas ≥ TITLE_MIN.
//   - Artista: el pedido tiene que estar contenido en el del candidato o
//     viceversa a nivel de tokens (cubre colaboraciones: pedimos "Playboi
//     Carti" y el candidato dice "The Weeknd, Playboi Carti"), o similitud
//     de bigramas ≥ ARTIST_MIN.
//   - Los títulos de una sola palabra corta ("Go", "24") son los que más
//     falsos positivos dan: ahí exigimos igualdad exacta.
//
// v=142 — el pedido puede traer VARIOS artistas y alcanza con que UNO pase.
// El caso que lo motivó: VULTURES 1 está acreditado a «¥$», el alias de Kanye
// West + Ty Dolla $ign. iTunes y Deezer lo listan como "Kanye West & Ty Dolla
// $ign" y contra "¥$" no hay similitud posible (normalizado queda en la cadena
// vacía), así que TODAS las pistas del álbum caían al embed de Spotify. Los
// tracks sí traen la lista entera ("¥$, Kanye West, Ty Dolla $ign"): probando
// contra cada uno, el match sale por "Kanye West".
//
// Importante: no se relajó NADA de la comparación. Los umbrales son los
// mismos, la regla de títulos de una palabra o ≤4 caracteres sigue exigiendo
// igualdad exacta (es la que evita que "Not PLaying" reproduzca "Timeless").
// Lo único que cambia es CONTRA QUÉ se compara el artista.

const TITLE_MIN = 0.86;
const ARTIST_MIN = 0.80;

// Sufijos de edición/versión que no cambian la canción.
//
// v=185 — «from…» se agrega acá y no a PALABRA_VERSION porque no es una
// versión distinta del tema: es la atribución a la película/serie
// («Honest - From The Amazing Spider-Man 2 Soundtrack», «Time - From the
// Motion Picture "Amsterdam"»). Tratarla como versión la dejaría exigir
// `versionesCompatibles`, y el candidato limpio de iTunes/Deezer nunca la va a
// tener — se cae siempre. Es ruido puro: se borra igual que "remaster" o
// "live", de los dos lados, antes de comparar.
const EDITION_TAIL =
  /\s*[-–—]\s*(?:(?:remaster(?:ed)?|\d{4} remaster(?:ed)?|remaster(?:ed)? \d{4}|single version|album version|radio edit|mono|stereo|live|bonus track|deluxe|extended|original mix)\b.*|from\b.*)$/i;

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Normalización compartida: minúsculas, sin diacríticos, sin paréntesis ni
// corchetes (ahí viven "(feat. X)", "[Explicit]", "(Remastered)"), sin
// puntuación y con espacios colapsados.
export function normText(s) {
  let out = stripDiacritics(String(s || '').toLowerCase());
  out = out.replace(/\s*(feat\.?|ft\.?|featuring|with)\s+.*$/i, ' ');
  out = out.replace(EDITION_TAIL, '');
  out = out.replace(/\(.*?\)|\[.*?\]/g, ' ');
  out = out.replace(/[^a-z0-9 ]/g, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

function bigrams(s) {
  const out = [];
  const t = ' ' + s + ' ';
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

// Coeficiente de Sørensen–Dice sobre bigramas: 1 = idéntico, 0 = nada en común.
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  const pool = new Map();
  for (const g of A) pool.set(g, (pool.get(g) || 0) + 1);
  let hits = 0;
  for (const g of B) {
    const n = pool.get(g) || 0;
    if (n > 0) { hits++; pool.set(g, n - 1); }
  }
  return (2 * hits) / (A.length + B.length);
}

function tokens(s) {
  return new Set(s.split(' ').filter(Boolean));
}

// ¿Todos los tokens de `sub` están en `sup`? (para "Playboi Carti" dentro de
// "The Weeknd, Playboi Carti").
function tokensContained(sub, sup) {
  const S = tokens(sup);
  const parts = [...tokens(sub)];
  return parts.length > 0 && parts.every(t => S.has(t));
}

// ── La versión del tema (v=167) ──────────────────────────────────────────────
//
// El bug, medido en producción el 2026-08-29 sobre las 60 primeras tarjetas de
// `#zero-plays`: «A Different Way - DEVAULT Remix» (DJ Snake) caía al embed de
// Spotify teniendo el tema EXACTO en iTunes y en Deezer.
//
//   pedido:    "A Different Way - DEVAULT Remix"     → "a different way devault remix"
//   candidato: "A Different Way (feat. Lauv) [DEVAULT Remix]" → "a different way"
//   similitud: 0,696  (el umbral es 0,86)  → rechazado
//
// La causa es una ASIMETRÍA de `normText`: el corte de `feat.` se lleva **todo
// lo que viene después hasta el final de la cadena**, así que al candidato le
// borra de paso el «[DEVAULT Remix]» que va detrás del «(feat. Lauv)». El
// pedido, que escribe el remix detrás de un guion, se lo queda. Los dos lados
// dicen lo mismo y quedan en cadenas distintas.
//
// No alcanza con reordenar los cortes: Spotify escribe el remix detrás de un
// guion y los proveedores entre corchetes, así que la comparación tiene que
// tratar las dos formas como la misma cosa. Lo que NO se puede es limitarse a
// borrar la cola en los dos lados: ahí «Tema - X Remix» matchearía el «Tema»
// original y sonaría la canción equivocada, que es justo lo que esta unidad
// existe para evitar. Por eso la versión se compara APARTE:
//
//   - `tituloBase` es el título sin su cola de versión;
//   - `tokensDeVersion` es lo que dice esa cola («devault», «remix»);
//   - dos títulos matchean por esta vía solo si las bases coinciden Y los dos
//     conjuntos de versión son compatibles: uno contenido en el otro. Desde
//     v=185 un PEDIDO sin versión acepta cualquier versión del candidato
//     (ver `versionesCompatibles`, medido el 2026-09-01); lo que sigue sin
//     aceptar es al revés: un remix pedido nunca acepta el original.

// Una cola solo cuenta como VERSIÓN si trae una de estas palabras. Sin esto,
// «(feat. Lauv)» contaría como versión y «Tema (feat. A)» no matchearía
// «Tema (feat. B)» — que son el mismo tema acreditado distinto.
const PALABRA_VERSION = /\b(remix|mix|edit|version|slowed|sped|speed|reverb|acoustic|unplugged|live|instrumental|vip|bootleg|rework|flip|remaster|remastered|extended|radio|club|dub|nightcore|demo|orchestral|karaoke|8d)\b/;

const GRUPOS = /\(([^)]*)\)|\[([^\]]*)\]/g;
const COLA_GUION = /\s[-–—]\s+(.*)$/;

// Los tokens de la cola de versión, vengan entre paréntesis, entre corchetes o
// detrás de un guion. Devuelve un Set vacío si el título no declara ninguna.
export function tokensDeVersion(s) {
  const raw = stripDiacritics(String(s || '').toLowerCase());
  const partes = [];
  for (const m of raw.matchAll(GRUPOS)) partes.push(m[1] ?? m[2] ?? '');
  const resto = raw.replace(GRUPOS, ' ');
  const guion = resto.match(COLA_GUION);
  if (guion) partes.push(guion[1]);

  const toks = new Set();
  for (const parte of partes) {
    if (!PALABRA_VERSION.test(parte)) continue;
    for (const t of parte.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)) toks.add(t);
  }
  return toks;
}

// El título sin su cola de versión. `normText` ya se lleva los paréntesis y los
// corchetes; lo que agrega esto es la cola detrás de un guion, que `normText`
// conserva (y hace bien: «Tema - Otra Cosa» puede ser parte del nombre).
export function tituloBase(s) {
  const raw = stripDiacritics(String(s || '').toLowerCase());
  const sinCola = raw.replace(COLA_GUION, (m, cola) => (PALABRA_VERSION.test(cola) ? ' ' : m));
  return normText(sinCola);
}

// ¿Las dos colas de versión hablan de lo mismo? Una contenida en la otra
// («Slowed» dentro de «Slowed + Reverb»), o el PEDIDO sin ninguna versión.
//
// v=185 — antes exigía que las dos estuvieran vacías: «pedir "Tema"
// nunca acepta "Tema - Sped Up"». Medido el 2026-09-01 sobre 200 tarjetas
// reales (100 de #skips, 100 de #sin-clasificar): la regla vieja frenaba
// exactamente los casos que el pedido no especifica versión, así que no hay
// ninguna versión con la que pueda chocar. Ahora un pedido SIN versión acepta
// cualquier versión del candidato. Lo que NO cambia: un pedido CON versión
// sigue sin aceptar un candidato sin ninguna («un remix nunca acepta el
// original», al revés de esto) — `wanted` va siempre primero.
function versionesCompatibles(wanted, candidate) {
  if (wanted.size === 0) return true;
  if (candidate.size === 0) return false;
  const [chico, grande] = wanted.size <= candidate.size ? [wanted, candidate] : [candidate, wanted];
  for (const t of chico) if (!grande.has(t)) return false;
  return true;
}

export function titleMatches(wanted, candidate) {
  const a = normText(wanted), b = normText(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  // Títulos cortos (una palabra o ≤4 caracteres): exigimos exacto. "Go" no
  // puede matchear "Go Crazy", ni "24" a "24K Magic".
  const short = a.length <= 4 || !a.includes(' ');
  if (short) return false;
  if (similarity(a, b) >= TITLE_MIN) return true;

  // Segunda vía: misma base y misma versión. Los umbrales y la regla de los
  // títulos cortos son los MISMOS, aplicados sobre la base.
  const ba = tituloBase(wanted), bb = tituloBase(candidate);
  if (!ba || !bb) return false;
  if (ba.length <= 4 || !ba.includes(' ')) return false;
  const basesIguales = ba === bb || similarity(ba, bb) >= TITLE_MIN;
  if (!basesIguales) return false;
  return versionesCompatibles(tokensDeVersion(wanted), tokensDeVersion(candidate));
}

// Versión ESTRICTA: "¿es exactamente este artista?". `artistMatches` acepta
// contención por tokens porque los proveedores de preview devuelven la lista
// entera de una colaboración en un solo string. Para filtrar discografías eso
// es demasiado laxo: "Drake" quedaba contenido en "Nick Drake" y la vista de
// "sin escuchar" se llenaba con Bryter Layter y Pink Moon.
export function artistIsSame(wanted, candidate) {
  const a = normText(wanted), b = normText(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  return similarity(a, b) >= 0.92;
}

// Lista de artistas pedidos, ya sea que venga uno solo (string), un array, o
// las dos cosas repartidas entre `artist` y `artists`. Sin duplicados y sin
// vacíos. Los nombres que se normalizan a la cadena vacía ("¥$", "∆") no se
// tiran acá: `artistOneMatches` los descarta al comparar, pero mantenerlos en
// la lista deja que `preferredQueryArtists` decida el orden de las búsquedas.
export function artistList(wanted) {
  const raw = [];
  if (Array.isArray(wanted)) raw.push(...wanted);
  else if (wanted && typeof wanted === 'object') {
    if (Array.isArray(wanted.artists)) raw.push(...wanted.artists);
    if (wanted.artist) raw.push(...(Array.isArray(wanted.artist) ? wanted.artist : [wanted.artist]));
  } else if (wanted) raw.push(wanted);

  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const name = String(item?.name ?? item ?? '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(name);
  }
  return out;
}

// Nombre "crudo": minúsculas, sin diacríticos y con los espacios colapsados,
// pero CONSERVANDO los símbolos. `normText` los tira todos, y hay nombres que
// son solo símbolos: «¥$» queda en la cadena vacía y ahí no hay comparación
// posible. Deezer lista las pistas de VULTURES 1 justo así, como «¥$» a secas.
function rawName(s) {
  return stripDiacritics(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

// Match de UN artista pedido contra el string del candidato. Es la regla de
// siempre; `artistMatches` la aplica sobre la lista entera.
function artistOneMatches(wanted, candidate) {
  // Igualdad exacta del nombre crudo. Es la comparación MÁS estricta que hay
  // (más que la de bigramas), así que no afloja nada: solo cubre los nombres
  // que la normalización deja vacíos o irreconocibles.
  const ra = rawName(wanted);
  if (ra && ra === rawName(candidate)) return true;

  const a = normText(wanted), b = normText(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  if (tokensContained(a, b) || tokensContained(b, a)) return true;
  return similarity(a, b) >= ARTIST_MIN;
}

// `wanted` puede ser un nombre, un array de nombres o {artist, artists}.
// Alcanza con que UNO pase: los proveedores acreditan las colaboraciones de
// mil formas distintas y basta con reconocer a uno de los que están de verdad.
export function artistMatches(wanted, candidate) {
  const list = artistList(wanted);
  if (!list.length) return false;
  return list.some(a => artistOneMatches(a, candidate));
}

// Similitud del mejor artista de la lista contra el candidato. Solo para el
// score (desempatar entre candidatos válidos), no para aceptar o rechazar.
function bestArtistSimilarity(wanted, candidate) {
  const b = normText(candidate);
  let best = 0;
  for (const a of artistList(wanted)) {
    const s = similarity(normText(a), b);
    if (s > best) best = s;
  }
  return best;
}

// Un candidato sirve solo si coinciden TÍTULO Y ARTISTA. Devuelve un score
// para poder elegir el mejor entre varios candidatos válidos.
export function candidateScore(wanted, candidate) {
  if (!titleMatches(wanted.name, candidate.name)) return 0;
  const artists = artistList(wanted);
  if (!artistMatches(artists, candidate.artist)) return 0;
  const t = similarity(normText(wanted.name), normText(candidate.name));
  const ar = bestArtistSimilarity(artists, candidate.artist);
  return 0.7 * t + 0.3 * ar;
}

// Orden en el que conviene BUSCAR en los proveedores. Un alias como "¥$" o
// "∆" no es texto buscable (normalizado queda vacío o en un carácter suelto),
// así que los nombres con letras van primero; los raros quedan al final como
// último intento en vez de quemarse la primera búsqueda.
export function preferredQueryArtists(wanted) {
  const list = artistList(wanted);
  const buscables = list.filter(a => normText(a).length >= 2);
  const raros = list.filter(a => normText(a).length < 2);
  return [...buscables, ...raros];
}

// Elige el mejor candidato verificado de una lista, o null si ninguno pasa.
// `map` extrae { name, artist } de cada item del proveedor.
export function pickBestMatch(wanted, items, map) {
  let best = null, bestScore = 0;
  for (const it of (items || [])) {
    const cand = map(it);
    if (!cand) continue;
    const score = candidateScore(wanted, cand);
    if (score > bestScore) { best = it; bestScore = score; }
  }
  return best;
}

// ── Limpieza de texto para las queries de /search ──────────────────────────
//
// ⚠️ **El apóstrofo dentro de las comillas rompe la búsqueda de Spotify.**
// Medido en vivo contra la API real (2026-08-19 con álbumes, 2026-08-22 con
// artistas):
//
//   album:"Don't Be Dumb"     →  0 resultados
//   album:"Dont Be Dumb"      →  2 ✅
//   artist:"Sinéad O'Connor"  →  0 resultados
//   artist:"Sinéad OConnor"   →  10 ✅
//   artist:"Guns N' Roses"    →  10 (este no se rompe)
//
// No falla siempre —parece hacer falta que el apóstrofo esté en mitad de una
// palabra que no sea la primera— pero sacarlo NUNCA empeora un caso y arregla
// los rotos, así que se saca siempre.
//
// ⚠️ Se **BORRA**, no se cambia por un espacio: Spotify indexa «don't» como el
// token `dont`, así que «don t» es otra forma de no encontrar nada.
//
//   album:"Don t Be Dumb"             →  0 resultados
//   album:"1989 (Taylor s Version)"   →  1
//   album:"1989 (Taylors Version)"    →  3 ✅
//
// La contrapartida es que la query queda más laxa, así que **el que llama
// TIENE que comparar el resultado contra el nombre real**. Aflojar el filtro
// posterior es lo que traía a Nick Drake cuando se buscaba Drake (v=124).
export function limpiaParaQuery(s) {
  return String(s || '')
    .replace(/["]/g, '')
    .replace(/['‘’ʼ`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
