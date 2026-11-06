// La cuenta del chip «Solo los de tu biblioteca» de `#listened` (v=363, tanda 122). PURA y sin imports.
//
// ⚠️ El cruce es por id EXACTO: otra edición del mismo disco (el deluxe guardado y el normal en la playlist) es otro id y NO cuenta.
// Cruzar por nombre o por edición es otra decisión, y aquí no se toma.

/** Los `album.id` de los items crudos `{ added_at, album }` de los álbumes guardados. Ignora los que no traen id. */
export function idsDeBiblioteca(itemsGuardados) {
  const ids = new Set();
  for (const it of itemsGuardados || []) {
    const id = it?.album?.id;
    if (id) ids.add(id);
  }
  return ids;
}

/** Los álbumes cuyo `id` está en `ids`, en el orden en que entraron. */
export function filtrarPorBiblioteca(albums, ids) {
  return albums.filter((a) => ids.has(a.id));
}
