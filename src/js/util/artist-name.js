// Nombre del artista a partir de lo que traen los likes (v=147).
//
// El patrón suelto `a.name || a` está mal y ya rompió cosas: hay al menos un
// like con `artists: [{ id: …, name: "" }]` —nombre vacío, no ausente— y ahí el
// `||` se cae al lado derecho y devuelve el OBJETO artista. En algunas vistas
// eso solo pinta `[object Object]`, pero en `#sin-clasificar` tiró abajo el
// orden «Por artista» (v=138).
//
// Vivía duplicado en features/skips.js; acá queda uno solo para que las tres
// vistas (skips, zero-plays, search-likes) se comporten igual.
export function firstArtistName(a) {
  const n = (a && typeof a === 'object') ? a.name : a;
  return typeof n === 'string' ? n : '';
}

// Los nombres de todos los artistas de un track, sin vacíos.
export function artistNames(track) {
  return (track?.artists || []).map(firstArtistName).filter(Boolean);
}

// ── La guarda de la cadena unida (v=150) ────────────────────────────────────
//
// El bug: la ficha de artista se abría con la CADENA DE ARTISTAS UNIDA
// («A$AP Rocky, Imogen Heap, Clams Casino») como si fuera el nombre de un
// artista solo. El historial se cruza por igualdad exacta de nombre, así que
// contra una cadena no matchea nada: «No aparece en tu historial», gráfico
// vacío y «0 likes» para el segundo artista más escuchado de Ian.
//
// El origen se arregló (features/artist-card.js unía la lista al armar el track
// de «Mis likes»), pero esto es la guarda de la puerta: `openArtistCard` y
// `openTrackCard` normalizan lo que les llega, así que ningún llamador futuro
// puede reintroducirlo.
//
// ⚠️ **Partir por coma a ciegas está MAL.** Hay artistas cuyo nombre LLEVA una
// coma: «Tyler, The Creator» es el caso obvio y está en los likes de Ian
// («FISH N STEAK (WHAT IT IS) (feat. Tyler, The Creator & Jozzy)»). Partir esa
// cadena da «Tyler», que no existe. Por eso el desempate no lo hace la coma:
// lo hace un índice de artistas conocidos (historial + likes).

/** ¿Esto huele a varios artistas pegados? Solo mira la forma, no decide nada. */
export function looksLikeArtistChain(name) {
  return typeof name === 'string' && /,\s/.test(name);
}

/** Parte «A, B, C» en sus segmentos, sin vacíos. */
export function splitArtistChain(name) {
  return String(name || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Resuelve un nombre de artista que PUEDE ser una cadena unida.
 *
 * El orden importa y es lo que salva a «Tyler, The Creator»:
 *   1. Si el nombre entero es un artista conocido, se devuelve TAL CUAL.
 *   2. Si no, se prueban los prefijos acumulados de más largo a más corto
 *      («Tyler, The Creator, Jozzy» → «Tyler, The Creator» ✅).
 *   3. Si no, el primer segmento que sea conocido.
 *   4. Si no hay índice o no se conoce ninguno, el primer segmento.
 *
 * @param {string} name
 * @param {(n: string) => boolean} [isKnown] índice de artistas conocidos
 * @returns {string} un nombre de UN artista, nunca una cadena de varios
 */
export function resolveArtistName(name, isKnown) {
  const full = String(name ?? '').trim();
  if (!looksLikeArtistChain(full)) return full;

  const conocido = typeof isKnown === 'function' ? isKnown : () => false;
  if (conocido(full)) return full;

  const partes = splitArtistChain(full);
  if (partes.length <= 1) return full;

  // 2. Prefijos acumulados, de más largo a más corto. El primero (la cadena
  //    entera) ya se probó arriba, así que arrancamos en length - 1.
  for (let n = partes.length - 1; n >= 1; n--) {
    const cand = partes.slice(0, n).join(', ');
    if (conocido(cand)) return cand;
  }

  // 3. Cualquier segmento suelto que conozcamos (el primero gana).
  for (const p of partes) {
    if (conocido(p)) return p;
  }

  // 4. Sin índice útil: el primer segmento. Puede equivocarse con un artista
  //    con coma que no esté en el historial, pero ahí la ficha iba a salir
  //    vacía igual — no es una regresión, es el mismo vacío con mejor nombre.
  return partes[0] || full;
}

/**
 * Lo que necesitan las fichas: la lista de artistas de un track, venga como
 * venga el llamador. Prefiere SIEMPRE el array; la cadena es el último recurso.
 *
 * @param {{artists?: any[], artist?: string|any[]}} t
 * @param {(n: string) => boolean} [isKnown]
 * @returns {string[]}
 */
export function resolveArtistList(t, isKnown) {
  const desdeArray = artistNames(t);
  if (desdeArray.length) return desdeArray;

  const suelto = t?.artist;
  if (Array.isArray(suelto)) return suelto.map(firstArtistName).filter(Boolean);

  const nombre = firstArtistName(suelto);
  if (!nombre) return [];
  if (!looksLikeArtistChain(nombre)) return [nombre];

  // Cadena unida y sin array: partimos, pero respetando los nombres con coma.
  const primero = resolveArtistName(nombre, isKnown);
  const resto = splitArtistChain(nombre.slice(primero.length).replace(/^\s*,\s*/, ''));
  return [primero, ...resto].filter(Boolean);
}
