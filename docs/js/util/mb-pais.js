// La regla para atribuir un país de MusicBrainz a un artista, SIN ADIVINAR (v=302;
// v=303: varios-mismo-pais exige país en todos, el apóstrofo tipográfico, y el
// país que sale del área).
//
// Módulo hoja, sin imports y sin red: recibe respuestas de MusicBrainz ya
// bajadas (`/ws/2/artist/?query=…` y `/ws/2/recording/?query=…`) y decide qué
// artista es y de qué país. Lo importan `util/mapa-paises.js` (la regla, para la
// vista `#mapa`, desde v=304) y `util/mapa-escaneo.js` (las consultas), y lo usan
// las mediciones de `fonoteca-migracion/mapa/`. Escrita una sola vez a propósito:
// en este repo una regla escrita dos veces termina divergiendo (el resolutor de
// álbumes de v=219). (Hasta v=305 esta cabecera decía «hoy no lo importa nadie
// de la app», y era falso desde v=304.)
//
// 🔴 Un artista que no se puede atribuir con certeza queda SIN país. Un país
// equivocado se ve igual que uno correcto: es el falso positivo silencioso.
//
// Las cinco clases de `clasificar()`:
//   sin-candidato      ningún resultado se llama igual
//   unico              uno solo se llama igual (no quiere decir «correcto»:
//                      puede ser un homónimo; para eso está `corroborado()`)
//   varios-mismo-pais  varios se llaman igual y TODOS traen `country`, el mismo
//   desempatado        varios, sin eso (países distintos, o alguno sin país), y
//                      la búsqueda de la grabación nombra a exactamente uno
//   ambiguo            varios, sin eso, y la grabación no desempata
//
// 🔴 v=303: hasta v=302 `varios-mismo-pais` miraba solo a los que traían país,
// y el homónimo SIN país puede ser el de verdad (MusicBrainz no manda `country`
// cuando el área es una subdivisión o una ciudad). Así salía el país de los
// otros, sin que nada lo corroborara. Ahora, si alguno no trae país, va por la
// grabación como cualquier otro caso de varios.
//
// El país del área (v=303): MusicBrainz no manda `country` cuando el área es una
// subdivisión o una ciudad. `paisDeArea()` sube por las
// relaciones «part of» de respuestas de `/ws/2/area/<id>?inc=area-rels` YA
// BAJADAS (la búsqueda de artistas trae el `id` y el `type` del área, pero
// ningún código ISO) hasta un área de tipo Country con un único código ISO 3166-1. Nada de
// tablas de nombres: el país sale de lo que contesta MusicBrainz, o no sale.

// NFKD, sin marcas diacríticas, minúsculas, espacios colapsados, trim. Nada más.
// 🔴 No es `normText` de `util/track-match.js`: ese tira todo lo que no sea
// [a-z0-9 ] y «¥$» le queda en la cadena vacía (v=142), o sea que dos nombres
// de puro símbolo coincidirían con cualquier otro. Acá «¥$» sigue siendo «¥$».
// v=303: los apóstrofos tipográficos ’ (U+2019), ‘ (U+2018) y ʼ (U+02BC) pasan
// a ser el recto ' (U+0027). Esos tres y ninguno más: el resto de la puntuación
// se queda como está («fun.», «N.E.R.D» no se tocan).
export function normalizarNombre(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2019\u2018\u02BC]/g, "'")
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

// `paisDe`: de dónde salió el país ('country', o 'area' después de
// `completarConArea`); null si no hay país. `areaId`: para subir por el área.
const resultado = (clase, elegido, necesitaGrabacion) => ({
  clase,
  mbid: elegido?.id ?? null,
  pais: elegido?.country || null,
  area: elegido?.area?.name ?? null,
  necesitaGrabacion,
  areaId: elegido?.area?.id ?? null,
  paisDe: elegido?.country ? 'country' : null,
});

export function clasificar(nombre, artistasMB, idsDeGrabacion = null) {
  const c = coincidentes(nombre, artistasMB);
  if (c.length === 0) return resultado('sin-candidato', null, false);
  if (c.length === 1) return resultado('unico', c[0], false);

  // TODOS con país, y el mismo. Uno sin país alcanza para no atribuir (v=303).
  const paises = new Set(c.map((a) => a.country || null));
  if (paises.size === 1 && !paises.has(null)) {
    const [pais] = paises;
    // El mbid y el area no se atribuyen: son varios artistas.
    return { clase: 'varios-mismo-pais', mbid: null, pais, area: null, necesitaGrabacion: false, areaId: null, paisDe: 'country' };
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

// ── El país que sale del área (v=303) ────────────────────────────────────────
// Medido contra MusicBrainz (tanda 51): una subdivisión puede estar a 1 salto de
// su país y una ciudad a 3 (City → County → Subdivision → Country). Más de 3
// queda sin país.
export const TOPE_SALTOS_AREA = 3;

const leerArea = (areas, id) => (typeof areas?.get === 'function' ? areas.get(id) : areas?.[id]);

// Un único código ISO 3166-1 de dos letras, o nada.
function codigoUnico(area) {
  const cs = area?.['iso-3166-1-codes'];
  if (Array.isArray(cs) && cs.length === 1 && /^[A-Z]{2}$/.test(cs[0])) return { pais: cs[0], motivo: 'ok' };
  return { pais: null, motivo: 'codigo-no-unico' };
}

// `areas`: Map (u objeto) de id → respuesta de `/ws/2/area/<id>?inc=area-rels`.
// Sube por «part of» con direction «backward» (el padre; las «forward» son los
// hijos). Devuelve { pais, motivo, saltos, falta }: `falta` es el id del área que
// hay que bajar para seguir (la red no es de acá). Queda sin país si hay dos
// padres, si la cadena se corta, si pasa el tope o si el país no trae un único
// código.
export function paisDeArea(areaId, areas, topeSaltos = TOPE_SALTOS_AREA) {
  let id = areaId;
  for (let saltos = 1; saltos <= topeSaltos; saltos++) {
    const a = leerArea(areas, id);
    if (a === undefined) return { pais: null, motivo: 'falta', saltos: saltos - 1, falta: id };
    if (!a || a.error !== undefined) return { pais: null, motivo: 'sin-respuesta', saltos, falta: null };
    if (a.type === 'Country') return { ...codigoUnico(a), saltos: saltos - 1, falta: null };
    const padres = (a.relations || []).filter((r) => r?.type === 'part of' && r.direction === 'backward' && r.area);
    if (padres.length === 0) return { pais: null, motivo: 'cortada', saltos, falta: null };
    if (padres.length > 1) return { pais: null, motivo: 'dos-padres', saltos, falta: null };
    const padre = padres[0].area;
    if (padre.type === 'Country') return { ...codigoUnico(padre), saltos, falta: null };
    id = padre.id;
  }
  return { pais: null, motivo: 'tope', saltos: topeSaltos, falta: null };
}

// A un `unico` o `desempatado` sin `country` le busca el país en su área. No
// cambia la clase ni el mbid; marca `paisDe: 'area'`. Si falta bajar un área,
// lo dice en `areaFalta`; el motivo de quedar sin país, en `areaMotivo`.
export function completarConArea(r, areas, topeSaltos = TOPE_SALTOS_AREA) {
  if (!r || r.pais || !r.areaId || (r.clase !== 'unico' && r.clase !== 'desempatado')) return r;
  const d = paisDeArea(r.areaId, areas, topeSaltos);
  if (d.pais) return { ...r, pais: d.pais, paisDe: 'area', areaSaltos: d.saltos };
  return { ...r, areaMotivo: d.motivo, areaFalta: d.falta };
}
