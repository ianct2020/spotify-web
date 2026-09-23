// Por qué un track terminó dentro de un bucket de #genre.
//
// La vista de «Clasificar por género» reparte cada track en buckets a partir de
// los tags de Last.fm de su PRIMER artista. Con «Agrupar parecidos» apagado el
// bucket es el tag tal cual; encendido, el bucket es el grupo al que lo manda
// `tagToGroup()` y el tag concreto se pierde de vista. Ese tag concreto es
// justo lo único que permite auditar la clasificación: ver «Travis Scott» en
// Rock no dice nada, ver que entró por «psychedelic» dice todo.
//
// ⚠️ `bucketFor` es EL criterio de reparto, y lo importa también
// `features/by-genre.js` en `buildGenreMap`. No se duplica a propósito: la
// tanda de v=219 costó un disco equivocado justamente por tener dos funciones
// respondiendo la misma pregunta y divergiendo. Si el reparto cambia, cambia
// acá y la auditoría lo sigue sola.

import { tagToGroup } from '../features/genre-groups.js?v=238';

// A qué bucket manda este tag. Sin agrupar, el bucket ES el tag.
function bucketFor(tag, groupsMode) {
  if (!groupsMode) return tag;
  return tagToGroup(tag) || tag;
}

// Los tags de este artista que hacen entrar al track en `bucket`, en el orden
// en que vienen (que es el de popularidad de Last.fm: el primero es el que más
// peso tiene). Sin agrupar devuelve como mucho uno, que es el bucket mismo.
function reasonsFor(tags, bucket, groupsMode) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  const vistos = new Set();
  for (const tag of tags) {
    if (bucketFor(tag, groupsMode) !== bucket) continue;
    const k = String(tag).toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(tag);
  }
  return out;
}

// Cuántos tracks metió cada tag concreto en este bucket. Un track con tres
// razones suma en las tres, así que la suma de los valores es >= al total de
// tracks: el rótulo de la vista lo dice.
//
// `filas` son objetos { reasons: [...] } ya resueltos por `reasonsFor`.
function tallyReasons(filas) {
  const cuenta = new Map();
  for (const f of filas) {
    for (const tag of f.reasons) {
      cuenta.set(tag, (cuenta.get(tag) || 0) + 1);
    }
  }
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export { bucketFor, reasonsFor, tallyReasons };
