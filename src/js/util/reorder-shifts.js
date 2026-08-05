// Cálculo de posiciones absolutas de los picks de un álbum después de que
// aplicamos add (siempre contiguo en insertPos = maxPos+1) y remove (por URI).
// Reemplaza el refetch entero de la playlist en W-Three al guardar cambios
// (con 2000+ tracks, `paginateAll` mete ~15-30s por el sleep 600ms entre pages).
//
// Invariantes que dependemos:
// - addInsertPos SIEMPRE es maxPos+1 (contiguo al final de los picks
//   originales del álbum), así que ningún pick original shiftea al insertar.
// - remove por URI borra todas las instancias — asumimos que cada URI está
//   una sola vez en la playlist (la UI del modal no permite duplicar picks).
export function computeUpdatedPickPositions(origOrder, orderedPicks, { toAddUris, toRemoveUris, addInsertPos }) {
  const removedUris = new Set(toRemoveUris);
  const opByUri = new Map(orderedPicks.map(p => [p.uri, p]));

  // 1. Originales con sus posiciones absolutas actuales.
  const working = origOrder.map(p => ({
    id: p.id, uri: p.uri, name: p.name, pos: p.pos,
  }));

  // 2. Nuevos: van en addInsertPos + i (respetan el orden en el que se
  //    agregaron). Si no había picks previos y no tenemos addInsertPos,
  //    dejamos pos=null y el caller detecta que hace falta refetch.
  toAddUris.forEach((uri, i) => {
    const op = opByUri.get(uri);
    if (!op) return;
    working.push({
      id: op.id, uri: op.uri, name: op.name,
      pos: addInsertPos != null ? addInsertPos + i : null,
    });
  });

  // 3. Remove: cada superviviente shiftea -1 por cada removido con pos<suya.
  const removedPositions = working
    .filter(p => removedUris.has(p.uri))
    .map(p => p.pos)
    .filter(pos => pos != null)
    .sort((a, b) => a - b);
  const surviving = working.filter(p => !removedUris.has(p.uri));
  for (const p of surviving) {
    if (p.pos == null) continue;
    let shift = 0;
    for (const rp of removedPositions) if (rp < p.pos) shift--;
    p.pos += shift;
  }

  surviving.sort((a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity));
  return surviving;
}
