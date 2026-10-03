// Universo explícito: las bases guardadas, con likes por id (sin consultas).
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
    return { id, name: liked?.name || credit?.name || id, likes: liked?.tracks.size || 0 };
  }).filter(a => /^[a-zA-Z0-9]{22}$/.test(a.id))
    .sort((a, b) => b.likes - a.likes || a.name.localeCompare(b.name, 'es'));
}
