// Universo explícito: las bases guardadas, con likes por id (sin consultas).
//
// ⚠️ Desde v=276 cada artista se lleva también `repTrackId`: el id de UNA pista
// suya que a Ian le gusta. Es la pista representativa con la que se lo puede
// ocultar en la playlist espejo — una playlist solo guarda pistas, y un artista
// no es una pista. Sale GRATIS porque este `Set` ya se armaba acá y se tiraba
// después de contarlo: sin esto, ocultar un artista desde #follow-artists
// costaría un `/search` por artista, y la lista a podar tiene 183.
export function artistasDeBases(entries, likes) {
  const porId = new Map();
  for (const { track } of likes) {
    if (!track?.id) continue;
    for (const a of track.artists || []) {
      if (!a.id) continue;
      if (!porId.has(a.id)) porId.set(a.id, { name: a.name, tracks: new Set() });
      porId.get(a.id).tracks.add(track.id);
    }
  }
  return entries.map(([key, raw]) => {
    const id = key.slice('discover_disco_base_v1_'.length);
    const liked = porId.get(id);
    const base = raw?.value || raw;
    const credit = (base?.items || []).flatMap(al => al.artists || []).find(a => a.id === id);
    // El orden de un Set es el de inserción, o sea el de los likes: siempre la
    // misma pista para el mismo artista, que es lo que hace que la clave y su
    // uri no bailen entre sesiones.
    const rep = liked?.tracks.values().next().value || null;
    return { id, name: liked?.name || credit?.name || id, likes: liked?.tracks.size || 0, repTrackId: rep };
  }).filter(a => /^[a-zA-Z0-9]{22}$/.test(a.id))
    .sort((a, b) => b.likes - a.likes || a.name.localeCompare(b.name, 'es'));
}
