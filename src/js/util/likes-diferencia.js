// «Rehacer me gusta desde Spotify» (v=349, tanda 106): la cuenta y los textos del ítem del ⚙ de #dashboard.
//
// La caché de me gusta no dice de qué cuenta es cada ítem (`slimTrack` guarda `added_at` y la pista), así que una copia
// con mezcla vieja no se puede detectar desde el navegador: hay que volver a bajar `/me/tracks` entero. El botón lo hace
// por el camino de siempre y, al final, compara la copia de antes con la nueva por `track.uri` DISTINTAS. Un me gusta
// que la copia tenía y Spotify ya no puede ser mezcla **o** uno quitado desde la app de Spotify: desde acá no se
// distinguen, y los textos no prometen ninguna de las dos.
//
// Puro y sin imports: sin red, IndexedDB ni DOM. Lo prueban `tests/likes-diferencia.test.mjs` (la cuenta) y
// `tests/rehacer-me-gusta.test.mjs` (los textos, palabra por palabra).

/**
 * Las uris distintas de una lista de me gusta (`[{ added_at, track: { uri } }]`). Los ítems sin `track` o sin `uri` no
 * cuentan. Si ya es un `Set` de uris, lo devuelve tal cual: es lo que el botón guarda en memoria de la copia de antes.
 */
export function urisDeLikes(lista) {
  if (lista instanceof Set) return lista;
  const uris = new Set();
  for (const it of Array.isArray(lista) ? lista : []) {
    const uri = it?.track?.uri;
    if (typeof uri === 'string' && uri) uris.add(uri);
  }
  return uris;
}

/**
 * Cuántas uris tenía la copia de antes que Spotify ya no tiene (`deMas`) y cuántas le faltaban (`faltaban`). Cada
 * argumento es una lista de me gusta o un `Set` de uris; no muta ninguno.
 */
export function diferenciaDeLikes(viejos, nuevos) {
  const a = urisDeLikes(viejos);
  const b = urisDeLikes(nuevos);
  let deMas = 0, faltaban = 0;
  for (const u of a) if (!b.has(u)) deMas++;
  for (const u of b) if (!a.has(u)) faltaban++;
  return { deMas, faltaban };
}

const num = (x) => x.toLocaleString('es-ES');

/** Las páginas de 50 que cuesta bajar `cuantos` me gusta. */
export function paginasDeLikes(cuantos) {
  return Math.ceil(Math.max(0, cuantos || 0) / 50);
}

/** El texto de la confirmación. `cuantos` = los me gusta de la copia de este navegador (0 = no hay copia). */
export function textoConfirmacionRehacer(cuantos) {
  const p = paginasDeLikes(cuantos);
  const costo = p === 0 ? '' : p === 1 ? ' (una página, varios minutos)' : ` (unas ${num(p)} páginas, varios minutos)`;
  return `Vuelve a bajar todos tus me gusta de Spotify${costo} y reemplaza la copia de este navegador. `
    + 'No cambia nada en tu cuenta de Spotify. Si se corta o la detienes, la copia que ya tienes queda como estaba.';
}

/**
 * El texto del modal del final. `n` = los me gusta de ahora; `deMas` y `faltaban`, de `diferenciaDeLikes`;
 * `habiaCopia` = si había una copia con la que comparar.
 *
 * 🔴 No dice «cuenta» (la palabra), «mezcl» ni «otra persona»: las de más pueden ser me gusta quitados desde la app de
 * Spotify, y desde el navegador no se sabe. Lo vigila `tests/rehacer-me-gusta.test.mjs` sobre todas las variantes.
 */
export function textoFinalRehacer({ n, deMas, faltaban, habiaCopia }) {
  const inicio = `Listo: ${num(n)} me gusta.`;
  if (!habiaCopia) return `${inicio} No había una copia anterior con la que comparar.`;
  if (!deMas && !faltaban) return `${inicio} Tu copia coincidía con Spotify.`;
  const falta = faltaban === 1 ? 'le faltaba 1' : `le faltaban ${num(faltaban)}`;
  if (!deMas) return `${inicio} A tu copia anterior ${falta}.`;
  const tenia = `tenía ${num(deMas)} que Spotify ya no tiene`;
  const quitados = deMas === 1
    ? 'Si quitaste un me gusta desde la app de Spotify, puede ser ese.'
    : `Si quitaste me gusta desde la app de Spotify, esos cuentan entre los ${num(deMas)}.`;
  return `${inicio} Tu copia anterior ${tenia}${faltaban ? ` y ${falta}` : ''}. ${quitados}`;
}
