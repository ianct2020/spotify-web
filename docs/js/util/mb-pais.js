// La regla para atribuir un país de MusicBrainz a un artista, SIN ADIVINAR (v=302).
//
// Módulo hoja, sin imports y sin red: recibe respuestas de MusicBrainz ya
// bajadas (`/ws/2/artist/?query=…` y `/ws/2/recording/?query=…`) y decide qué
// artista es y de qué país. Hoy no lo importa nadie de la app: lo usa la
// medición de la tanda 50 (`fonoteca-migracion/mapa/`), y la fase 2 del mapa va
// a usar exactamente esta misma regla. Escrita una sola vez a propósito: en
// este repo una regla escrita dos veces termina divergiendo (el resolutor de
// álbumes de v=219).
//
// 🔴 Un artista que no se puede atribuir con certeza queda SIN país. Un país
// equivocado se ve igual que uno correcto: es el falso positivo silencioso.
//
// Las cinco clases de `clasificar()`:
//   sin-candidato      ningún resultado se llama igual
//   unico              uno solo se llama igual (no quiere decir «correcto»:
//                      puede ser un homónimo; para eso está `corroborado()`)
//   varios-mismo-pais  varios se llaman igual y todos los que tienen país
//                      tienen el mismo (al menos uno lo tiene)
//   desempatado        varios con países distintos (o ninguno con país), y la
//                      búsqueda de la grabación nombra a exactamente uno
//   ambiguo            varios con países distintos y la grabación no desempata

// NFKD, sin marcas diacríticas, minúsculas, espacios colapsados, trim. Nada más.
// 🔴 No es `normText` de `util/track-match.js`: ese tira todo lo que no sea
// [a-z0-9 ] y «¥$» le queda en la cadena vacía (v=142), o sea que dos nombres
// de puro símbolo coincidirían con cualquier otro. Acá «¥$» sigue siendo «¥$».
export function normalizarNombre(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// La sintaxis de búsqueda de MusicBrainz es la de Lucene: dentro de una frase
// entre comillas solo hay que escapar la comilla y la barra invertida.
const frase = (s) => '"' + String(s ?? '').replace(/[\\"]/g, (c) => '\\' + c) + '"';

export function queryArtista(nombre) {
  return `artist:${frase(nombre)}`;
}

export function queryGrabacion(titulo, nombre) {
  return `recording:${frase(titulo)} AND artist:${frase(nombre)}`;
}

// Le saca al título lo que va desde el primer « - » y todo lo que esté entre
// paréntesis o corchetes. Si no queda nada, devuelve el original.
export function limpiarTitulo(t) {
  const original = String(t ?? '');
  let s = original;
  const guion = s.indexOf(' - ');
  if (guion >= 0) s = s.slice(0, guion);
  s = s.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  return s || original;
}

// Por qué coincide un candidato con el nombre pedido: 'nombre', 'sort-name',
// 'alias' o null. IGUALDAD después de normalizar, nunca parecido: ni `score`
// (es relativo a la consulta y no dice si es el mismo artista) ni distancia de
// edición.
export function comoCoincide(nombre, artista) {
  const n = normalizarNombre(nombre);
  if (!n || !artista) return null;
  if (normalizarNombre(artista.name) === n) return 'nombre';
  if (normalizarNombre(artista['sort-name']) === n) return 'sort-name';
  if ((artista.aliases || []).some((a) => normalizarNombre(a?.name) === n)) return 'alias';
  return null;
}

export function coincidentes(nombre, artistasMB) {
  return (artistasMB || []).filter((a) => comoCoincide(nombre, a) !== null);
}

const resultado = (clase, elegido, necesitaGrabacion) => ({
  clase,
  mbid: elegido?.id ?? null,
  pais: elegido?.country || null,
  area: elegido?.area?.name ?? null,
  necesitaGrabacion,
});

export function clasificar(nombre, artistasMB, idsDeGrabacion = null) {
  const c = coincidentes(nombre, artistasMB);
  if (c.length === 0) return resultado('sin-candidato', null, false);
  if (c.length === 1) return resultado('unico', c[0], false);

  const paises = new Set(c.map((a) => a.country).filter(Boolean));
  if (paises.size === 1) {
    const [pais] = paises;
    // El mbid y el area no se atribuyen: son varios artistas.
    return { clase: 'varios-mismo-pais', mbid: null, pais, area: null, necesitaGrabacion: false };
  }

  if (Array.isArray(idsDeGrabacion)) {
    const ids = new Set(idsDeGrabacion);
    const nombrados = c.filter((a) => ids.has(a.id));
    if (nombrados.length === 1) return resultado('desempatado', nombrados[0], true);
  }
  return resultado('ambiguo', null, true);
}

// ¿El artista elegido firma alguna de las grabaciones devueltas? true / false,
// o null si no hay ids (no se buscó la grabación). Es para MEDIR cuántos `unico`
// son otra persona; no cambia la clase de nadie.
export function corroborado(mbid, idsDeGrabacion) {
  if (!Array.isArray(idsDeGrabacion)) return null;
  return idsDeGrabacion.includes(mbid);
}
