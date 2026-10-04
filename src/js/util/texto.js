// util/texto.js — los normalizadores de texto COMPARTIDOS.
//
// Nació del informe de reconocimiento del 2026-10-03, que censó 19
// normalizadores en 16 archivos y encontró familias enteras con el mismo
// cuerpo copiado. Lo que vive acá es lo que ya era idéntico en varios lados:
// unificarlo no cambió ninguna salida, y `tests/normalizadores-foto.test.mjs`
// es la prueba (el fixture de v=268 sigue byte a byte igual).
//
// ⚠️ LO QUE NO VA ACÁ, Y POR QUÉ. Esto NO es «el normalizador de la app». La
// app tiene normalizadores que difieren A PROPÓSITO y que no hay que juntar:
//
//   · `util/album-key.js` conserva «÷», «=», «$» y los apóstrofos justamente
//     porque NO pasa por `normText`. Hacerla pasar fusionaría los discos de
//     Ed Sheeran entre sí y «¥$» con la cadena vacía.
//   · `util/versions-guard.js` es estricta porque decide un BORRADO.
//   · `util/song-identity.js` junta los remixes a propósito (16/08/2026) y
//     `versions-guard` los separa a propósito: van al revés, y los dos asserts
//     consecutivos de `tests/album-resolver.test.mjs` existen para que quien
//     los «unifique» rompa los dos.
//   · `limpiaParaQuery` limpia la QUERY, no compara.
//   · los `.toLowerCase()` a pelo de `lastfm.js`, `artist-card.js` (fotos),
//     `album-heard.js` y `recommendations.js` son claves de CACHÉ ya escritas:
//     normalizarlas cuesta 2.277 peticiones a Last.fm y ~200 `/search`.
//
// La tabla completa de qué es deliberado y qué era copia está en
// `fonoteca-migracion/RECONOCIMIENTO-NORMALIZADORES-2026-10-03.md`, punto 3.

// Normaliza para COMPARAR contra un proveedor de previews: sin acentos, sin
// «(feat. X)» ni «[Remaster]», solo alfanumérico y espacios colapsados.
//
// Estaba escrita tres veces, con el mismo comportamiento: `api/itunes.js`,
// `api/preview-providers.js` (que hasta tenía el comentario «Igual que
// iTunes») y `api/statsfm.js`. Las tres construyen claves de caché
// (`itunes_preview_cache_v1`, `deezer_preview_url_cache`,
// `preview_provider_map_v5`, `statsfm_track_ids_v1`), así que si alguna vez
// divergían, los hits se perdían en silencio. Ahora no pueden.
//
// ⚠️ Cambiar este cuerpo invalida esas cuatro cachés. No cuesta cuota de
// Spotify (se re-piden a iTunes/Deezer/Stats.fm al tocar ▶), pero es un costo.
export function normProveedor(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
