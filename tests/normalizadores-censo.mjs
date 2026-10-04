// tests/normalizadores-censo.mjs — las 19 funciones de texto del censo, listas
// para pasarles un corpus. Lo usa `normalizadores-foto.test.mjs` (la foto que
// protege el plan de unificación) y queda disponible para los pasos que siguen.
//
// POR QUÉ EXISTE. El informe de reconocimiento del 2026-10-03 contó 19
// normalizadores de texto repartidos en 16 archivos, y la mayoría (#11 a #20)
// NO tiene ni un test. El plan unifica seis de ellos prometiendo que «ninguna
// salida cambia»; sin una foto previa, esa promesa no se puede verificar.
//
// LAS EXPORTADAS SE IMPORTAN. Es la única forma de que la foto siga al código:
// si alguien cambia `normText`, el test lo ve.
//
// LAS NO EXPORTADAS SE EXTRAEN DEL FUENTE POR TEXTO, con `extraer()`. No es
// elegante y es a propósito: la alternativa era exportarlas solo para el test,
// y eso agranda la superficie pública de nueve módulos para medir algo que es
// interno. El precio es que `extraer()` falla ruidosamente si la función se
// renombra o se borra — que es exactamente lo que se quiere saber. Es el mismo
// camino que usó el banco del informe.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'js');

const fuente = (rel) => readFileSync(join(SRC, rel), 'utf8');

// ── El extractor ─────────────────────────────────────────────────────────────
//
// Busca `function NOMBRE(` o `const NOMBRE = ` y corta en el primer punto donde
// las llaves y los paréntesis vuelven a cero, ignorando lo que está dentro de
// comillas, plantillas, regex y comentarios. Es un balanceador, no un parser:
// alcanza porque los normalizadores son funciones de diez líneas sin nada raro.
//
// Si no encuentra la función, TIRA. Un normalizador que desaparece no puede
// quedar en silencio: la foto dejaría de mirarlo y el plan perdería su red.
export function extraer(rel, nombre, { deps = {} } = {}) {
  const txt = fuente(rel);
  const re = new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:function\\s+${nombre}\\s*\\(|const\\s+${nombre}\\s*=)`);
  const m = re.exec(txt);
  if (!m) throw new Error(`extraer(): no encontré ${nombre} en ${rel}. ¿Se renombró o se borró?`);

  const desde = m.index + m[0].length - (m[0].endsWith('(') ? 1 : 0);
  const inicio = txt.indexOf(nombre, m.index);
  const cuerpo = recortar(txt, inicio);

  const nombresDeps = Object.keys(deps);
  const fabrica = new Function(...nombresDeps, `
    ${m[0].includes('const') ? 'const ' + cuerpo : 'function ' + cuerpo}
    return ${nombre};
  `);
  return fabrica(...nombresDeps.map(k => deps[k]));
}

// Recorta desde `inicio` (el nombre de la función) hasta que las llaves cierren.
// Para un `const f = s => expr;` sin llaves, corta en el `;` o salto de línea
// de nivel cero.
function recortar(txt, inicio) {
  let i = inicio, llaves = 0, parens = 0, vioLlave = false;
  let enCadena = null, enRegex = false, enClase = false, enLinea = false, enBloque = false;
  for (; i < txt.length; i++) {
    const c = txt[i], sig = txt[i + 1];
    if (enLinea) { if (c === '\n') enLinea = false; continue; }
    if (enBloque) { if (c === '*' && sig === '/') { enBloque = false; i++; } continue; }
    if (enCadena) { if (c === '\\') { i++; continue; } if (c === enCadena) enCadena = null; continue; }
    // Dentro de un regex, una clase `[...]` NO anida: el `[` de `[([]` es
    // literal. Por eso es un booleano y no un contador — con un contador,
    // `baseName` de listened-shared no cerraba nunca.
    if (enRegex) {
      if (c === '\\') { i++; continue; }
      if (enClase) { if (c === ']') enClase = false; continue; }
      if (c === '[') enClase = true;
      else if (c === '/') enRegex = false;
      continue;
    }
    if (c === '/' && sig === '/') { enLinea = true; i++; continue; }
    if (c === '/' && sig === '*') { enBloque = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { enCadena = c; continue; }
    // Un `/` empieza un regex cuando lo anterior no puede terminar un valor.
    if (c === '/') {
      const antes = txt.slice(inicio, i).replace(/\s+$/, '');
      if (!/[\w)\]]$/.test(antes)) { enRegex = true; enClase = false; continue; }
    }
    if (c === '(') parens++;
    else if (c === ')') parens--;
    else if (c === '{') { llaves++; vioLlave = true; }
    else if (c === '}') {
      llaves--;
      if (vioLlave && llaves === 0 && parens === 0) return txt.slice(inicio, i + 1);
    } else if (!vioLlave && llaves === 0 && parens === 0 && (c === ';' || c === '\n')) {
      // Arrow de una línea: `const f = s => …;`
      const trozo = txt.slice(inicio, i).trim();
      if (trozo.includes('=>')) return trozo.replace(/;$/, '') + ';';
    }
  }
  throw new Error('recortar(): no pude cerrar la función');
}

// ── Las exportadas, importadas de verdad ─────────────────────────────────────
import { normText, tokensDeVersion, tituloBase, limpiaParaQuery } from '../src/js/util/track-match.js';
import { albumKey as albumKeyUtil, _normPart } from '../src/js/util/album-key.js';
import { songKey, songKeysCandidatas, songKeyBase } from '../src/js/util/song-identity.js';
import { normalizeName, normalizeKey } from '../src/js/util/versions-guard.js';
import { baseDeEdicion } from '../src/js/util/edition-suffix.js';
import { marcadoresDeVersion } from '../src/js/util/album-version-guard.js';
import { normProveedor, sinTildes } from '../src/js/util/texto.js';
import { normPlaylistName } from '../src/js/util/hidden-sync.js';

// ── Las no exportadas, extraídas ─────────────────────────────────────────────
const stripDiacritics = extraer('util/track-match.js', 'stripDiacritics');
const rawName = extraer('util/track-match.js', 'rawName', { deps: { stripDiacritics } });
const claveResolver = extraer('util/album-resolver.js', 'clave', { deps: { normText } });
const canon = extraer('util/album-version-guard.js', 'canon');
// PASO 2: `junk.js` ya no tiene cuerpo propio — su normalize ES `sinTildes`,
// sin nada encima (es el único de los tres que no recorta). No se extrae porque
// no hay nada que extraer; que siga siendo así lo verifica el assert de
// estructura del test.
const junkNormalize = sinTildes;
// PASO 1 del plan: los tres `norm` de proveedores eran el mismo cuerpo y ahora
// son UNA sola función exportada. Las tres entradas del censo siguen acá, y a
// propósito: apuntan a la misma `normProveedor`, así que el fixture compara que
// las tres salidas sigan siendo las de antes de unificarlas.
// ⚠️ Si alguien le vuelve a escribir un `norm` propio a uno de los tres
// archivos, esto NO lo ve. Lo ve el assert de estructura del test.
const itunesNorm = normProveedor;
const previewNorm = normProveedor;
const statsfmNormName = normProveedor;
const artistCardNormName = extraer('features/artist-card.js', 'normName', { deps: { sinTildes } });
const listenedNorm = extraer('features/listened-shared.js', 'norm');
const listenedBaseName = extraer('features/listened-shared.js', 'baseName');
const listenedAlbumKey = extraer('features/listened-shared.js', 'albumKey', {
  deps: { norm: listenedNorm, baseName: listenedBaseName },
});
const searchLikesNormalize = extraer('features/search-likes.js', 'normalize', { deps: { sinTildes } });
// PASO 2: hidden-sync lo exporta como `normPlaylistName`, así que se importa.
const hiddenSyncNormName = normPlaylistName;
const sinClasificarNormName = extraer('features/sin-clasificar.js', 'normName', { deps: { normPlaylistName: hiddenSyncNormName } });
// PASO 3: likeNameKey ya no lleva el regex adentro; usa el helper del archivo.
// v=272: y ese helper es `sinParentesis`, el de delimitadores que COINCIDEN. El
// mezclado se borró de `wthree.js` al quedarse sin llamadores, así que acá ya no
// hay nada que extraer con ese nombre.
const sinParentesis = extraer('features/wthree.js', 'sinParentesis');
const wthreeLikeNameKey = extraer('features/wthree.js', 'likeNameKey', { deps: { sinParentesis } });
const historyAlbumKey = extraer('history-processor.js', 'albumKey');

// ── El censo ─────────────────────────────────────────────────────────────────
//
// `aridad` dice qué le entra: 'texto' = un string; 'par' = (nombre, artista).
// `origen` es 'import' o 'extraído', para que el resumen del test lo diga.
export const CENSO = [
  { n: 1,  id: 'track-match.normText',            fn: normText,              aridad: 'texto', origen: 'import' },
  { n: 2,  id: 'track-match.tituloBase',          fn: tituloBase,            aridad: 'texto', origen: 'import' },
  { n: 2.1,id: 'track-match.tokensDeVersion',     fn: s => [...tokensDeVersion(s)].sort().join(','), aridad: 'texto', origen: 'import' },
  { n: 3,  id: 'track-match.rawName',             fn: rawName,               aridad: 'texto', origen: 'extraído' },
  { n: 4,  id: 'track-match.limpiaParaQuery',     fn: limpiaParaQuery,       aridad: 'texto', origen: 'import' },
  { n: 5,  id: 'album-resolver.clave',            fn: claveResolver,         aridad: 'texto', origen: 'extraído' },
  { n: 6,  id: 'album-key.normPart',              fn: _normPart,             aridad: 'texto', origen: 'import' },
  { n: 6.1,id: 'album-key.albumKey',              fn: albumKeyUtil,          aridad: 'par',   origen: 'import' },
  { n: 7,  id: 'song-identity.songKey',           fn: songKey,               aridad: 'par',   origen: 'import' },
  { n: 7.1,id: 'song-identity.songKeyBase',       fn: songKeyBase,           aridad: 'par',   origen: 'import' },
  { n: 7.2,id: 'song-identity.songKeysCandidatas',fn: (a, b) => songKeysCandidatas(a, b).join(' ;; '), aridad: 'par', origen: 'import' },
  { n: 8,  id: 'versions-guard.normalizeName',    fn: normalizeName,         aridad: 'texto', origen: 'import' },
  // normalizeKey toma el TRACK entero, no (nombre, artista): se le arma uno.
  { n: 8.1,id: 'versions-guard.normalizeKey',     fn: (n, a) => normalizeKey({ name: n, artists: [{ name: a }] }), aridad: 'par', origen: 'import' },
  { n: 9,  id: 'edition-suffix.baseDeEdicion',    fn: baseDeEdicion,         aridad: 'texto', origen: 'import' },
  { n: 10, id: 'album-version-guard.canon',       fn: canon,                 aridad: 'texto', origen: 'extraído' },
  { n: 10.1,id:'album-version-guard.marcadores',  fn: s => [...marcadoresDeVersion(s)].sort().join(','), aridad: 'texto', origen: 'import' },
  { n: 11, id: 'junk.normalize',                  fn: junkNormalize,         aridad: 'texto', origen: 'import' },
  { n: 12, id: 'itunes.norm',                     fn: itunesNorm,            aridad: 'texto', origen: 'import' },
  { n: 13, id: 'preview-providers.norm',          fn: previewNorm,           aridad: 'texto', origen: 'import' },
  { n: 14, id: 'statsfm.normName',                fn: statsfmNormName,       aridad: 'texto', origen: 'import' },
  { n: 15, id: 'artist-card.normName',            fn: artistCardNormName,    aridad: 'texto', origen: 'extraído' },
  { n: 16, id: 'listened-shared.norm',            fn: listenedNorm,          aridad: 'texto', origen: 'extraído' },
  { n: 16.1,id:'listened-shared.baseName',        fn: listenedBaseName,      aridad: 'texto', origen: 'extraído' },
  { n: 16.2,id:'listened-shared.albumKey',        fn: listenedAlbumKey,      aridad: 'par',   origen: 'extraído' },
  { n: 17, id: 'search-likes.normalize',          fn: searchLikesNormalize,  aridad: 'texto', origen: 'extraído' },
  { n: 18, id: 'sin-clasificar.normName',         fn: sinClasificarNormName, aridad: 'texto', origen: 'extraído' },
  { n: 19, id: 'hidden-sync.normName',            fn: hiddenSyncNormName,    aridad: 'texto', origen: 'import' },
  { n: 20, id: 'wthree.likeNameKey',              fn: wthreeLikeNameKey,     aridad: 'par',   origen: 'extraído' },
  { n: 21, id: 'history-processor.albumKey',      fn: historyAlbumKey,       aridad: 'par',   origen: 'extraído' },
];
