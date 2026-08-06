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

const TITLE_MIN = 0.86;
const ARTIST_MIN = 0.80;

// Sufijos de edición/versión que no cambian la canción.
const EDITION_TAIL =
  /\s*[-–—]\s*(remaster(ed)?|\d{4} remaster(ed)?|remaster(ed)? \d{4}|single version|album version|radio edit|mono|stereo|live|bonus track|deluxe|extended|original mix)\b.*$/i;

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

export function titleMatches(wanted, candidate) {
  const a = normText(wanted), b = normText(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  // Títulos cortos (una palabra o ≤4 caracteres): exigimos exacto. "Go" no
  // puede matchear "Go Crazy", ni "24" a "24K Magic".
  const short = a.length <= 4 || !a.includes(' ');
  if (short) return false;
  return similarity(a, b) >= TITLE_MIN;
}

export function artistMatches(wanted, candidate) {
  const a = normText(wanted), b = normText(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  if (tokensContained(a, b) || tokensContained(b, a)) return true;
  return similarity(a, b) >= ARTIST_MIN;
}

// Un candidato sirve solo si coinciden TÍTULO Y ARTISTA. Devuelve un score
// para poder elegir el mejor entre varios candidatos válidos.
export function candidateScore(wanted, candidate) {
  if (!titleMatches(wanted.name, candidate.name)) return 0;
  if (!artistMatches(wanted.artist, candidate.artist)) return 0;
  const t = similarity(normText(wanted.name), normText(candidate.name));
  const ar = similarity(normText(wanted.artist), normText(candidate.artist));
  return 0.7 * t + 0.3 * ar;
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
