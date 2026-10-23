// La letra de un tema, de lrclib.net (v=311, tanda 59). PURO: sin red, sin
// reloj, sin IndexedDB y sin DOM. La red, la caché y el bloque de la ficha
// viven en `features/track-card.js`; acá solo se decide.
//
// Lo que se decidió y por qué (el detalle, en CLAUDE.md, «🎤 Letras (v=311)»):
//
//   · UNA consulta: `GET /api/get?artist_name=…&track_name=…`, el artista
//     principal y el nombre tal cual. Sin `album_name` ni `duration`: es la
//     consulta que midió la tanda 58, y el servidor exige ±2 s si va la
//     duración (`track_repository.rs`), así que una diferencia de más daría 404
//     donde hoy hay letra.
//   · lrclib compara por IGUALDAD (en minúsculas), pero lo que vuelve se
//     verifica igual con `titleMatches` y `artistMatches`, IMPORTADAS de
//     `track-match.js` (la regla escrita dos veces diverge, v=219). Si no pasa,
//     es «no hay letra»: un falso positivo es silencioso.
//   · La caché guarda lo que CONTESTÓ lrclib, recortado (`registroDe`), o
//     `{ noHay, fecha }` para un 404; la decisión se recalcula al pintar
//     (`decidir`), como la de `#mapa`. Un 503, un corte, un 429 o un 5xx no
//     guardan NADA (los fracasos no se memoizan, v=219).
//   · La duración avisa, no filtra: más de 2 s de diferencia (el mismo margen
//     del servidor) pinta una línea encima de la letra.
//   · Nada se sincroniza con la reproducción: la app no sabe en qué segundo va
//     Spotify, así que de una letra sincronizada se muestra el texto sin marcas.

import { titleMatches, artistMatches } from './track-match.js?v=333';

export const URL_LRCLIB = 'https://lrclib.net/api/get';
// Sin uid: una letra es dato público, como `mapa_area_v1_`. «Limpiar caché» la
// borra (NO está en `CONSERVAR_PREFIJOS`): es re-pedible, una por tema.
export const PREFIJO_LETRAS = 'letras_v1_';
// El margen de `get_track_by_metadata` en el servidor (`dur - 2.0` / `dur + 2.0`).
export const MARGEN_DURACION_S = 2;
// Lo que se espera ante un 503 si `retry-after` no se puede leer, y el techo.
const ESPERA_503_MS = 1000;
const ESPERA_503_TOPE_MS = 10000;

// Copy visible, en castellano de España.
export const TEXTOS = {
  boton: 'Letra',
  buscando: 'Buscando la letra en lrclib.net…',
  noHay: 'lrclib no tiene la letra de este tema.',
  noContesta: 'lrclib no contesta ahora. Prueba otra vez en un rato.',
  errorApp: 'No se pudo enseñar la letra: algo falló en la app (el detalle está en la consola).',
  instrumental: 'Es instrumental.',
  fuente: 'Letra de lrclib.net',
  buscarDeNuevo: 'Buscar de nuevo',
  reintentar: 'Reintentar',
};

export function claveLetra(trackId) {
  return PREFIJO_LETRAS + trackId;
}

// `encodeURIComponent` y no `URLSearchParams`: deja los espacios como %20 y se
// lee igual en el registro de la prueba en vivo. Ninguna cabecera, ningún token:
// eso lo cumple quien hace el `fetch`.
export function urlLetra(artista, titulo) {
  return `${URL_LRCLIB}?artist_name=${encodeURIComponent(artista || '')}&track_name=${encodeURIComponent(titulo || '')}`;
}

// `[mm:ss]`, `[mm:ss.xx]`, `[m:ss.xxx]` (o con `:` en vez de `.`), una o varias
// pegadas al PRINCIPIO del renglón. Un corchete en medio no se toca.
const MARCAS = /^(?:\s*\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s?/;

export function sinMarcasDeTiempo(texto) {
  const renglones = String(texto || '').split(/\r?\n/).map(r => r.replace(MARCAS, '').replace(/\s+$/, ''));
  while (renglones.length && !renglones[0]) renglones.shift();
  while (renglones.length && !renglones[renglones.length - 1]) renglones.pop();
  return renglones.join('\n');
}

const conTexto = (s) => typeof s === 'string' && s.trim() !== '';

// Lo que se muestra: la plana si viene; si no, la sincronizada sin marcas.
export function textoDeRespuesta(cuerpo) {
  if (conTexto(cuerpo?.plainLyrics)) return sinMarcasDeTiempo(cuerpo.plainLyrics);
  if (conTexto(cuerpo?.syncedLyrics)) return sinMarcasDeTiempo(cuerpo.syncedLyrics);
  return '';
}

// Igualdad cruda (minúsculas, espacios colapsados): es más estricta que
// `titleMatches` y cubre lo que `normText` deja vacío (un título en japonés,
// por ejemplo, normaliza a la cadena vacía y `titleMatches` diría que no). Es la
// misma comparación que hace el servidor de lrclib, no una regla nueva.
const crudo = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// `pedido` = { name, artists: [...] } (lo que tiene la ficha); `respuesta` =
// lo que devolvió lrclib (o el registro guardado: los dos traen `trackName` y
// `artistName`).
export function nombresCoinciden(pedido, respuesta) {
  const titulo = respuesta?.trackName, artista = respuesta?.artistName;
  if (!conTexto(titulo) || !conTexto(artista)) return false;
  const tituloOk = (crudo(titulo) === crudo(pedido?.name) && crudo(titulo) !== '') || titleMatches(pedido?.name || '', titulo);
  if (!tituloOk) return false;
  return artistMatches(pedido?.artists || [], artista);
}

// Lo que se guarda de un 200: SOLO lo que se lee al pintar.
export function registroDe(cuerpo, fecha) {
  return {
    id: cuerpo?.id ?? null,
    trackName: cuerpo?.trackName ?? null,
    artistName: cuerpo?.artistName ?? null,
    duration: Number.isFinite(cuerpo?.duration) ? cuerpo.duration : null,
    instrumental: cuerpo?.instrumental === true,
    texto: textoDeRespuesta(cuerpo),
    fecha,
  };
}

export function registroNoHay(fecha) {
  return { noHay: true, fecha };
}

// m:ss, redondeando al segundo.
export function fmtMinSeg(segundos) {
  const s = Math.round(segundos);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// `segLrclib` en segundos (lo que manda lrclib); `msPropia` en ms (el
// `duration_ms` del me gusta). null = sin aviso.
export function avisoDuracion(segLrclib, msPropia) {
  if (!(segLrclib > 0) || !(msPropia > 0)) return null;
  const propia = msPropia / 1000;
  if (Math.abs(segLrclib - propia) <= MARGEN_DURACION_S) return null;
  return `Puede ser de otra versión: esta dura ${fmtMinSeg(segLrclib)} y la tuya ${fmtMinSeg(propia)}.`;
}

// La decisión, al pintar, sobre un registro guardado (o recién armado).
// Devuelve null si no hay registro (hay que pedirla).
export function decidir(registro, pedido, msPropia) {
  if (!registro) return null;
  if (registro.noHay) return { clase: 'no-hay', texto: '', aviso: null };
  if (!nombresCoinciden(pedido, registro)) return { clase: 'no-hay', texto: '', aviso: null };
  if (registro.instrumental) return { clase: 'instrumental', texto: '', aviso: null };
  if (!conTexto(registro.texto)) return { clase: 'no-hay', texto: '', aviso: null };
  return { clase: 'letra', texto: registro.texto, aviso: avisoDuracion(registro.duration, msPropia) };
}

// `status` 0 = corte de red (el `fetch` tiró); `cuerpo` undefined = no era JSON.
// Devuelve la clase, el registro a guardar (null = no se guarda NADA) y si
// corresponde el único reintento automático (solo el 503).
export function clasificarRespuesta({ status, cuerpo }, pedido, fecha) {
  if (status === 404) return { clase: 'no-hay', registro: registroNoHay(fecha), reintentable: false };
  if (status === 200 && cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo)) {
    const registro = registroDe(cuerpo, fecha);
    return { clase: decidir(registro, pedido, null).clase, registro, reintentable: false };
  }
  return { clase: 'fallo', registro: null, reintentable: status === 503 };
}

// La espera antes del reintento de un 503: lo que diga `retry-after` (en
// segundos; lrclib la expone por CORS), 1 s si no viene o no se lee, y nunca más
// de 10 s.
export function esperaReintentoMs(retryAfter) {
  const s = conTexto(retryAfter) ? Number(retryAfter) : NaN;
  if (!Number.isFinite(s) || s < 0) return ESPERA_503_MS;
  return Math.min(ESPERA_503_TOPE_MS, Math.round(s * 1000));
}
