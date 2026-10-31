// Datos INVENTADOS del banco `debug-ocultos-ancho.html` (tanda 109).
//
// Dos almacenes de ocultos con datos:
//   · «sin-clasificar» (la etiqueta más larga de los seis almacenes; sale del `label` de
//     `createHiddenStore()` en `features/sin-clasificar.js`): 2234 claves en este navegador,
//     1234 en su playlist → «aquí» 2234, «playlist» 1234, «huérfanas» 1000. Cuatro cifras en las
//     tres columnas;
//   · «skips»: tres claves, las tres en la playlist (coincide).
// Las claves son ids de pista de 22 caracteres (los dos almacenes deducen la uri del id).
export const OC = (n) => 't109inventada' + String(n).padStart(9, '0');
export const SC_LOCAL = Array.from({ length: 2234 }, (_, i) => OC(i));
export const SC_PLAYLIST = SC_LOCAL.slice(0, 1234);
export const SKIPS = [OC(900001), OC(900002), OC(900003)];
export const PLAYLISTS = [
  { id: 't109inventadaplsincl01', name: 'fonoteca · ocultos (sin clasificar)', claves: SC_PLAYLIST },
  { id: 't109inventadaplskips01', name: 'fonoteca · ocultos (skips)', claves: SKIPS },
];
export const plDe = (p, uid) => ({ id: p.id, name: p.name, owner: { id: uid, display_name: 'Banco' }, public: false, collaborative: false, snapshot_id: `snap-${p.id}`, tracks: { total: p.claves.length }, items: { total: p.claves.length }, images: [], description: '' });
export const itemDe = (k) => ({ added_at: '2025-01-01T00:00:00Z', item: { id: k, uri: `spotify:track:${k}`, type: 'track', name: 'Oculto inventado', duration_ms: 200000, artists: [{ id: 't109inventadaartista01', name: 'Artista inventado' }], album: { id: 't109inventadadisco0001', name: 'Disco inventado', images: [] } } });
// El historial del owner para la base de colores del mosaico (así no se pide el JSON del repo).
export const LISTENED = { years: [{ year: 2024, albums: [] }] };
