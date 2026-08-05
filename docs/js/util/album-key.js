// Clave canónica de álbum para dedup entre fuentes que reportan el mismo álbum
// con leves variaciones (Remastered vs no, acentos, mayúsculas). Se comparte
// entre covers.js, wthree.js y donde haga falta cruzar nombres de álbum.
//
// Reglas:
//   - lowercase + trim
//   - quita diacríticos (NFD → strip combining marks)
//   - colapsa espacios múltiples
//   - saca sufijos de edición ("(Remastered)", "- 2011 Remaster", "(Deluxe
//     Edition)", "(Bonus Track Version)"…) — la misma grabación en otro pack
//     se mergea con el original
//   - "&" ↔ "and" normalizado a "and"
//
// El separador de la key es "||" (dos pipes) para no chocar con nombres que
// contengan | (raro pero pasa).

const EDITION_STRIP =
  /\s*[-–—(\[]\s*(remaster(ed)?( \d{4})?|\d{4} remaster(ed)?|deluxe( edition)?|bonus( track)?( version)?|anniversary( edition)?|expanded( edition)?|mono( version)?|stereo( version)?|special edition|super deluxe|reissue|remixed and remastered|explicit|clean( version)?|the original|legacy edition|collector'?s edition|standard edition|international( version)?|the .+ edition)\b.*$/i;

const YEAR_TRAIL = /\s*[-–—]\s*(19|20)\d{2}\s*$/;
const PAREN_YEAR = /\s*\((19|20)\d{2}\)\s*$/;

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normPart(s) {
  if (!s) return '';
  let out = String(s).toLowerCase().trim();
  out = stripDiacritics(out);
  // sacar sufijos de edición hasta 2 vueltas (por si hay "(Remastered) (Deluxe)")
  for (let i = 0; i < 2; i++) {
    const before = out;
    out = out.replace(EDITION_STRIP, '');
    out = out.replace(PAREN_YEAR, '');
    out = out.replace(YEAR_TRAIL, '');
    if (out === before) break;
  }
  // "&" y "y" → "and" para juntar variantes
  out = out.replace(/\s*&\s*/g, ' and ');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

export function albumKey(name, artist) {
  return `${normPart(name)}||${normPart(artist)}`;
}

// Export para tests / debugging
export { normPart as _normPart };
