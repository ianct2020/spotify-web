// Port a JS de scripts/gen-stats.py — dado un array de arrays de plays crudas
// del Extended Streaming History, calcula los 6 payloads (stats, trackPlays,
// listened, skipStats, detail, records), con la MISMA lógica que el Python.
//
// Uso desde el UI de upload:
//   const raw = await Promise.all(files.map(readJson));   // File[] → array[array_plays]
//   const result = await processStreamingHistory(raw, { onProgress, ceder });
//   await saveMyHistory(userId, result);
//
// Es `async` (v=297): con `ceder` cede el hilo cada `presupuestoMs` (50 por
// defecto) en los puntos de control; sin `ceder` corre de un tirón, como en
// los tests y en Node.
//
// Devuelve la misma forma que los JSONs del repo (mismos `version` numbers).

import { isJunkTrack } from './util/junk.js?v=338';
import { songKey } from './util/song-identity.js?v=338';

// ---- Configuración (igual a gen-stats.py) ----
const MIN_MS = 30000;
const SKIP_MIN_MS = 5000;
// v2: baja de 3 a 1 — con el agrupado por gid, un id con 2 plays ya no es
// ruido: son 2 plays del total de su tema. Ver gen-stats.py.
const SKIP_STATS_MIN_PLAYS = 1;

// Cierres "completos": saliste, cerraste sesión o se cayó la app — no le diste
// next. Espejo de COMPLETE_CLOSES en gen-stats.py.
const COMPLETE_CLOSES = new Set([
  'endplay',
  'logout',
  'unexpected-exit',
  'unexpected-exit-while-paused',
  'backbtn',
]);
// ⚠️ Estos números van al campo `version` DENTRO de lo que produce el BYOH. Son
// un tercer juego de contadores, distinto del de `scripts/gen-stats.py` (el
// `version` de los JSON del owner) y del de `history-keys.js` (clave de
// IndexedDB y `?v=`). Ningún código lee el `version` de stats ni el de listened; el
// único lector es el de skips. Desde v=291 este STATS_VERSION va PAREJO con el de
// `gen-stats.py` (4: `years[].skip_pct` con la definición de `totals`, más `plays_raw`
// y `skips` por año). Estuvo en 2 hasta v=290, con la salida ya en formato v3.
// v5 (v=295): la basura funcional sale también del DIVISOR de `skip_pct`, y `years[]` y
// `totals` ganan `plays_junk`. Sigue parejo con `gen-stats.py`.
const STATS_VERSION = 5;
const TRACK_PLAYS_VERSION = 5;   // v5: cada álbum de `albums` lleva además el día de la primera play válida (espejo de gen-stats.py)
const SKIP_STATS_VERSION = 4;    // v4: dato crudo (ms de cada skip/cierre) + gid; el veredicto pasó a features/skips.js. El bump a v4 es por el `gid`: la cola de versión tras el guion («- Sped Up», «- Piano»…) reagrupa en v=271. ⚠️ Tiene que ir a la par del guarda `>= N` de features/history-data.js: si se queda atrás, el BYOH recién importado se RECHAZA
const LISTENED_VERSION = 2;
const TRACK_DETAIL_VERSION = 1;
const RECORDS_VERSION = 3;
const DAYS_VERSION = 1;    // v1: el detalle por día — el octavo payload, el que alimenta `#calendario` (v=289)
// Récords v3 — espejo de gen-stats.py.
// Corte de sesión de la racha de un artista (#18). Sin él, la racha "sin
// intercalar otro artista" sobrevive a que te vayas a dormir: la ganadora sin
// corte eran 69 plays repartidas en 59,6 horas y tres días distintos, que no
// es una racha de escucha sino una coincidencia de que no hubo nada más en
// medio. Con 3h el récord pasa a ser una sesión real.
const RUN_GAP_S = 3 * 3600;
// Base mínima para el crecimiento año a año (#16). Sin ella el récord se lo
// lleva siempre alguien que pasó de 0, y eso es un DESCUBRIMIENTO — que el
// Wrapped ya muestra como tal. Con base >= 60 min el récord mide lo que dice
// medir: que alguien que ya escuchabas pasó a escucharse mucho más.
const GROWTH_MIN_BASE = 60;
const ARTIST_TRACKS_VERSION = 3;  // v3 (v=308, `#puertas`): `totals` suma [6] = [nombre, trackId] del tema de entrada y [7] = el día del primer tema DISTINTO (otro `songKey`) o null, espejo de gen-stats.py. v2: `totals` lleva el día de la primera play válida del artista
const ARTIST_TRACKS_TOP_N = 6;
const DETAIL_MIN_PLAYS = 5;
const MILESTONE_TARGETS = new Set([1, 10000, 25000, 50000, 75000, 100000, 125000, 150000, 175000, 200000, 250000, 300000]);
const TOP_N_YEAR = 40;
const TOP_N_ALLTIME = 60;
const KEEP_TRACK_IF_MS = 60000;
// v=126: el ruleset de basura vive en util/junk.js, compartido con las vistas
// (y espejado en scripts/gen-stats.py para los JSON del owner).
const MIN_TRACKS_SAMEDAY = 4;
const MIN_MIN_SAMEDAY = 25;

// ---- Helpers ----

// Counter que soporta most_common(N)
function mostCommon(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function albumKey(name, artist) {
  return `${(name || '').toLowerCase()}||${(artist || '').toLowerCase()}`;
}

function trackKey(name, artist) {
  return `${(name || '').toLowerCase()}||${(artist || '').toLowerCase()}`;
}

// Parsea "2018-08-15T01:23:39Z" a { date, day, year, month, weekday, hour, ts }.
// weekday 0=lunes (como Python .weekday()). No usa el TZ local — todo es UTC porque
// así viene el timestamp de Spotify.
function parseTs(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const dayStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // JS getUTCDay: 0=domingo. Python weekday: 0=lunes. Conversión:
  const wd = (d.getUTCDay() + 6) % 7;
  return { d, year: y, month: m, day: dayStr, weekday: wd, hour: d.getUTCHours(), ts };
}

// [6] y [7] de `totals` (v3): `[nombre, trackId]` del tema de entrada y el día
// de la primera play válida de un tema con OTRO `songKey`, o null. Espejo de
// `entrada_y_segundo()` de scripts/gen-stats.py.
function entradaYSegundo(entrada, temasDia, artist) {
  if (!entrada) return [null, null];
  const skEntrada = songKey(entrada.name, artist);
  let segundo = null;
  for (const [sk, d] of temasDia || []) if (sk !== skEntrada && (segundo === null || d < segundo)) segundo = d;
  return [[entrada.name, entrada.tid], segundo];
}

// Suma 1 día a un dayStr YYYY-MM-DD (para calcular rachas)
function nextDay(dayStr) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

// Cuenta días entre dos dayStr (0 = mismo día, 1 = consecutivos)
function daysBetween(a, b) {
  const da = Date.UTC(...a.split('-').map((v, i) => i === 1 ? +v - 1 : +v));
  const db = Date.UTC(...b.split('-').map((v, i) => i === 1 ? +v - 1 : +v));
  return Math.round((db - da) / 86400000);
}

function round1(x) { return Math.round(x * 10) / 10; }

// ════════════════════════════════════════════════════════════════════════════
// EL DETALLE POR DÍA (`days`, el octavo payload) — v=289
// ════════════════════════════════════════════════════════════════════════════
//
// QUÉ PRODUCE, exactamente:
//
//   {
//     version: 1,
//     generated_at: "2026-10-10T…Z",
//     temas: [ [trackId, nombre, artista], … ],     // diccionario ÚNICO
//     dias: {
//       "2026-01-09": {
//         min:     412.5,   // minutos VÁLIDOS (≥30 s), redondeados a 1 decimal
//         crudas:  118,     // reproducciones crudas (deduplicadas, con uri)
//         validas: 96,      // reproducciones de ≥30 s
//         saltos:  21,      // ver «la definición de salto», más abajo
//         temas:   [ [i, min, veces], … ]  // i = índice en `temas`
//       }, …
//     }
//   }
//
// Los temas de un día van en el orden de su **primera** reproducción de ese
// día. Por eso NO hace falta el `sort` global de `processStreamingHistory()`:
// alcanza con quedarse con el `ts` mínimo de cada tema dentro del día.
//
// ── POR QUÉ ES UNA FUNCIÓN APARTE E INCREMENTAL ────────────────────────────
//
// `processStreamingHistory()` junta los 19 archivos de audio del export EN
// MEMORIA (`arrays.push(JSON.parse(text))` en `features/import-history.js`),
// con un `sort` global de las 212.491 plays. Desde v=297 cede el hilo ella
// misma (`ceder` + `presupuestoMs`), pero sigue necesitando los 19 arrays a
// la vez.
//
// Este acumulador recibe **un archivo por vez**, lo acumula y lo suelta, así
// los 19 nunca están juntos. Es lo que permite que la importación «solo el
// detalle» del owner lea, procese y suelte archivo por archivo sin cargar
// el export entero.
//
// ── UNA SOLA IMPLEMENTACIÓN ────────────────────────────────────────────────
//
// `processStreamingHistory()` la usa por dentro para producir `days` en el
// import completo de un amigo, alimentándola con los mismos arrays. No hay una
// segunda copia de la agrupación por día: si hubiera, divergirían (el
// resolutor de álbum de v=219, el `fmtDate()` de v=231).
//
// ── LAS TRES REGLAS QUE TIENE QUE COMPARTIR CON EL PIPELINE ────────────────
//
//   1. **La misma deduplicación**: clave `${ts}|${uri}|${ms_played || 0}`, y el
//      `Set` es COMPARTIDO entre archivos, porque los `_N` se solapan.
//   2. **El mismo descarte**: sin `spotify_track_uri` no entra (episodios y
//      audiolibros), y sus minutos tampoco cuentan.
//   3. **La misma agrupación por día, en UTC** (`parseTs`, que es `getUTC*`).
//      Es lo que hace que `min` cuadre con `years[].days.min` día por día.
//
// ── LA DEFINICIÓN DE SALTO, Y UNA DISCREPANCIA DEL PIPELINE ────────────────
//
// `saltos` usa la definición de `totals.skip_pct`:
//
//     r.skipped === true   ||   (r.reason_end === 'fwdbtn' && ms_played < 30 s)
//
// contada sobre las reproducciones CRUDAS. Con eso, la suma de `saltos` sobre
// la suma de `crudas` reproduce `totals.skip_pct` **exacto**.
//
// 🟩 **Desde v=291 `years[].skip_pct` ES esa misma cuenta.** Hasta v=290 el
// pipeline tenía dos definiciones con el mismo nombre, en los dos lenguajes: la
// de `totals` (la de arriba) y la de `years[]`, que contaba `fwdbtn || skipped`
// SOLO entre las plays de ≥30 s y dividía por `plays + skipped`, sumando los
// saltos dos veces (2023: 34,7 con aquélla, 74,9 con ésta). Ahora
// `years[].skip_pct = skips / plays_raw` del año, y `tests/calendario-dias.test.mjs`
// afirma que la suma de `saltos` de los días de un año sobre sus `crudas` da
// exactamente ese número.

/**
 * Acumulador incremental del detalle por día.
 * @returns {{agregarArchivo: (arr: any[]) => {crudas: number, dedup: number}, cerrar: () => object, leidas: () => number}}
 */
function crearAcumuladorDeDias() {
  // La deduplicación es COMPARTIDA entre archivos: los `_N` del export se
  // solapan y la misma play aparece en dos archivos.
  const vistas = new Set();
  // dia -> { ms, crudas, validas, saltos, temas: Map(trackId -> {ms, veces, ts}) }
  const dias = new Map();
  // trackId -> { i, nombre, artista }. Un tema vive UNA vez, no una por día.
  const temas = new Map();
  let leidasTotal = 0;
  let sinUri = 0;
  let repetidas = 0;
  let tsIlegible = 0;

  function agregarArchivo(arr) {
    if (!Array.isArray(arr)) return { crudas: 0, dedup: 0 };
    let crudasArchivo = 0, dedupArchivo = 0;
    for (const r of arr) {
      leidasTotal++;
      crudasArchivo++;
      const uri = r.spotify_track_uri;
      // Sin uri no es una pista: episodio de podcast o audiolibro. Fuera, y sus
      // minutos tampoco cuentan — igual que el pipeline.
      if (!uri) { sinUri++; continue; }
      const clave = `${r.ts}|${uri}|${r.ms_played || 0}`;
      if (vistas.has(clave)) { repetidas++; continue; }
      vistas.add(clave);
      dedupArchivo++;

      const parsed = parseTs(r.ts);
      if (!parsed) { tsIlegible++; continue; }
      const dia = parsed.day;
      const ms = Number(r.ms_played) || 0;
      const track = r.master_metadata_track_name || '';
      const artista = r.master_metadata_album_artist_name || '';

      let d = dias.get(dia);
      if (!d) { d = { ms: 0, crudas: 0, validas: 0, saltos: 0, temas: new Map() }; dias.set(dia, d); }
      // `crudas` se cuenta ANTES del filtro de basura, porque es el mismo
      // denominador que `totals.plays_raw` del pipeline (que tampoco la
      // descuenta: el `continue` de la basura va después del contador).
      d.crudas++;

      // Basura funcional (sonidos saca-agua, lluvia para dormir, 432 Hz…). El
      // pipeline la salta acá mismo, así que sus minutos no están en
      // `years[].days.min` y tampoco pueden estar en el nuestro.
      if (isJunkTrack(track, artista)) continue;

      if (!!r.skipped || ((r.reason_end || '') === 'fwdbtn' && ms < MIN_MS)) d.saltos++;
      if (ms < MIN_MS) continue;

      d.ms += ms;
      d.validas++;

      const tid = uri.split(':').pop();
      let t = d.temas.get(tid);
      if (!t) { t = { ms: 0, veces: 0, ts: r.ts }; d.temas.set(tid, t); }
      t.ms += ms;
      t.veces++;
      // El orden del día sale del `ts` MÍNIMO, así que no hace falta que los
      // archivos lleguen ordenados ni que haya un `sort` global.
      if (r.ts < t.ts) t.ts = r.ts;

      if (!temas.has(tid)) temas.set(tid, { i: temas.size, nombre: track, artista });
    }
    return { crudas: crudasArchivo, dedup: dedupArchivo };
  }

  function cerrar() {
    const temasOut = new Array(temas.size);
    for (const [tid, m] of temas) temasOut[m.i] = [tid, m.nombre, m.artista];

    const diasOut = {};
    for (const dia of [...dias.keys()].sort()) {
      const d = dias.get(dia);
      const lista = [...d.temas.entries()]
        .sort((a, b) => (a[1].ts < b[1].ts ? -1 : a[1].ts > b[1].ts ? 1 : 0))
        .map(([tid, t]) => [temas.get(tid).i, round1(t.ms / 60000), t.veces]);
      diasOut[dia] = {
        min: round1(d.ms / 60000),
        crudas: d.crudas,
        validas: d.validas,
        saltos: d.saltos,
        temas: lista,
      };
    }
    return {
      version: DAYS_VERSION,
      generated_at: new Date().toISOString(),
      temas: temasOut,
      dias: diasOut,
      // Para el reporte del import: cuántas líneas se leyeron de verdad y qué
      // se descartó. Un import que diga «listo» sin estos números no se puede
      // comprobar contra `totals.plays_raw`.
      conteo: { leidas: leidasTotal, sin_uri: sinUri, repetidas, ts_ilegible: tsIlegible },
    };
  }

  return { agregarArchivo, cerrar, leidas: () => leidasTotal };
}

// ---- Función principal ----

// ── CEDER EL HILO (v=297) ──────────────────────────────────────────────────
//
// Hasta v=296 esto corría sincrónico de punta a punta (~3,7 s con el export de
// Ian en Chrome) y el cartel de progreso se quedaba quieto: el `onProgress` de
// `handleFiles()` tenía un `await` adentro que nadie esperaba. Ahora la que
// cede es la función: en cada punto de control llama a `onProgress` (que es
// sincrónico, solo pinta) y, si pasaron `presupuestoMs` desde la última
// cesión, hace `await ceder()`. Quien la llama decide CÓMO se cede: el import
// le pasa `cederElHilo` (`MessageChannel`, que no se estrangula en una pestaña
// oculta). Sin `ceder` no cede nunca: así la usan los tests y Node.
//
// ⚠️ Los puntos de control no tocan ningún cálculo: la salida es idéntica byte
// a byte con y sin `ceder` (lo vigila `tests/import-cede.test.mjs`). El
// `plays.sort` es una sola llamada y no se parte.
async function processStreamingHistory(fileArrays, { onProgress, ceder, presupuestoMs = 50 } = {}) {
  const reloj = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let ultimaCesion = reloj();
  const puntoDeControl = async () => {
    if (!ceder || reloj() - ultimaCesion < presupuestoMs) return;
    await ceder();
    ultimaCesion = reloj();
  };

  const totalRawPlays = fileArrays.reduce((n, arr) => n + arr.length, 0);
  if (onProgress) onProgress({ phase: 'dedup', loaded: 0, total: totalRawPlays });

  // 1. Dedupe global (los archivos _N pueden solaparse)
  const seen = new Set();
  const plays = [];
  let seenCount = 0;
  for (const arr of fileArrays) {
    for (const r of arr) {
      seenCount++;
      const uri = r.spotify_track_uri;
      if (!uri) continue;
      const key = `${r.ts}|${uri}|${r.ms_played || 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plays.push(r);
    }
    if (onProgress) onProgress({ phase: 'dedup', loaded: seenCount, total: totalRawPlays });
    await puntoDeControl();
  }
  // El octavo payload va por su propia función, incremental y con la MISMA
  // deduplicación: una sola implementación de la agrupación por día. Se la
  // alimenta con los mismos arrays, archivo por archivo.
  const acuDias = crearAcumuladorDeDias();
  for (const arr of fileArrays) {
    acuDias.agregarArchivo(arr);
    await puntoDeControl();
  }
  const days = acuDias.cerrar();

  // sort por ts asc (para first_year, discovery, milestones en orden real)
  plays.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const totalPlays = plays.length;
  if (onProgress) onProgress({ phase: 'aggregate', loaded: 0, total: totalPlays });

  // ---- Acumuladores globales ----
  let totalValidMs = 0;
  let totalSkipped = 0;
  // Lo mismo, partido por año (v=291) — espejo de `year_raw` / `year_skips` de
  // `gen-stats.py`. UNA sola definición de salto: la de `totals.skip_pct`. Van en mapas
  // aparte y no en el cubo del año, que nace con la primera play válida.
  const yearRaw = new Map();     // año -> reproducciones crudas (el criterio de totalPlays)
  const yearSkips = new Map();   // año -> saltos (el sitio y la condición de totalSkipped)
  // v=295 — espejo de `total_junk` / `year_junk` de `gen-stats.py`: la basura funcional,
  // contada en el MISMO sitio en que se saltea, para restarla del divisor de `skip_pct`.
  // `plays_raw` no cambia: sigue siendo «las crudas».
  let totalJunk = 0;
  const yearJunk = new Map();    // año -> reproducciones de basura funcional
  const activeDaysAll = new Set();

  const artistMs = new Map();
  const artistPlays = new Map();
  const albumMs = new Map();
  const albumPlaysCounter = new Map();
  const albumMeta = new Map();
  const trackMs = new Map();
  const trackPlaysCount = new Map();
  const trackMeta = new Map();

  const artistFirstYear = new Map();
  // Día de la primera play válida (>=30s) por artista y por álbum, "YYYY-MM-DD".
  // Las fichas muestran la fecha entera, no solo el año. `plays` ya viene
  // ordenado asc, así que la primera vez que se ve la clave es la de verdad.
  const artistFirstDay = new Map();
  const albumFirstDay = new Map();
  // v3 (tanda 56, `#puertas`): el TEMA DE ENTRADA de cada artista, {ts, name,
  // tid} de la MISMA play que fija `artistFirstDay` (se llenan juntos: no puede
  // haber dos definiciones de «primera»). Si dos plays válidas del mismo artista
  // tienen el mismo `ts`, gana el menor trackId (orden de cadena): el orden de
  // llegada depende del orden de los archivos y del sort, y un dato nuevo no se
  // deja al azar. ⚠️ ESPEJO de `artist_entrada` en scripts/gen-stats.py.
  const artistEntrada = new Map();
  // artista → Map<songKey, primer día>, en orden de aparición. Sale el [7]: el
  // día del primer tema DISTINTO del de entrada. «Distinto» es otro `songKey`,
  // no otro id: un remaster o la versión del álbum del mismo single NO es un
  // segundo tema.
  const artistTemasDia = new Map();

  // Por año: obj con Maps y stats
  const years = new Map();
  function yearBucket(y) {
    let yb = years.get(y);
    if (!yb) {
      yb = {
        artistMs: new Map(), artistPlays: new Map(),
        albumMs: new Map(), albumPlays: new Map(),
        trackMs: new Map(), trackPlays: new Map(),
        monthsMs: new Map(), days: new Map(),
        activeDays: new Set(),
        plays: 0,
        firstPlay: null, lastPlay: null,
      };
      years.set(y, yb);
    }
    return yb;
  }

  const monthlyMs = new Map();
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));

  const trackUriStats = new Map(); // uri → { p, ms }
  const trackUriPartial = new Map(); // uri → { p, ms } (solo <30s)
  // v2: además de los contadores, los ms_played crudos de cada skip y de cada
  // cierre completo. El veredicto lo arma features/skips.js con el duration_ms.
  const trackSkipStats = new Map(); // tid → { ok, skip, fwd[], close[] }
  const trackSkipMeta = new Map(); // tid → [nombre, artista] (solo para el gid; ya no se emite)

  // Ficha de canción
  const trackUriMonthly = new Map(); // uri → Map<YM, plays>
  const trackUriFirst = new Map();
  const trackUriLast = new Map();
  const trackUriDaycount = new Map(); // uri → Map<day, plays>

  // Récords
  const dayMsGlobal = new Map();
  const dayPlaysCount = new Map();
  const dayArtistMs = new Map(); // day → Map<artist, ms>
  const dayTrackPlays = new Map(); // day → Map<tk, plays>
  const weekTrackPlays = new Map(); // "tk|weekStart" → count
  const tkDays = new Map(); // tk → Set<day>
  // Récords v3.
  const artistDays = new Map();    // artista → Set<día> (#14)
  const songYears = new Map();     // song_key → Set<año> (#10)
  const songDays = new Map();      // song_key → Set<día>
  const songPlays = new Map();     // song_key → plays
  const songMeta = new Map();      // song_key → {name, artist} de la primera vez
  const artistRuns = [];           // rachas cerradas del mismo artista (#18)
  let run = null;                  // la racha en curso
  const milestones = [];
  let validSeq = 0;

  const albumDay = new Map(); // ak → Map<day, { tracksSet, ms }>
  const listenedFirst = new Map(); // ak → { date, tracks_that_day, min_that_day }

  const progressStep = Math.max(1, Math.floor(totalPlays / 40));

  for (let i = 0; i < plays.length; i++) {
    // El punto de control va ARRIBA de todo: abajo lo saltaban los `continue`
    // de las plays cortas y de la basura, y el progreso avanzaba a saltos.
    if (i % progressStep === 0) {
      if (onProgress) onProgress({ phase: 'aggregate', loaded: i, total: totalPlays });
      await puntoDeControl();
    }
    const r = plays[i];
    const parsed = parseTs(r.ts);
    if (!parsed) continue;
    const ms = Number(r.ms_played) || 0;
    const artist = r.master_metadata_album_artist_name || '';
    const album = r.master_metadata_album_album_name || '';
    const track = r.master_metadata_track_name || '';
    const uri = r.spotify_track_uri;
    const skipped = !!r.skipped;
    const endReason = r.reason_end || '';

    // Las crudas del año, ANTES del filtro de basura: igual que `totalPlays`.
    yearRaw.set(parsed.year, (yearRaw.get(parsed.year) || 0) + 1);

    // Basura funcional (sonidos saca-agua, lluvia para dormir, 432 Hz…).
    // v=295: se CUENTA acá mismo, para sacarla también del divisor de `skip_pct`.
    if (isJunkTrack(track, artist)) {
      totalJunk++;
      yearJunk.set(parsed.year, (yearJunk.get(parsed.year) || 0) + 1);
      continue;
    }

    // skip% (contra el total, sin filtro de ms)
    const isSkip = skipped || (endReason === 'fwdbtn' && ms < MIN_MS);
    if (isSkip) {
      totalSkipped++;
      yearSkips.set(parsed.year, (yearSkips.get(parsed.year) || 0) + 1);
    }

    // Skip stats por track (necesita uri, cualquier ms)
    if (uri) {
      const tidOnly = uri.split(':').pop();
      let ss = trackSkipStats.get(tidOnly);
      if (!ss) { ss = { ok: 0, skip: 0, fwd: [], close: [] }; trackSkipStats.set(tidOnly, ss); }
      if (endReason === 'trackdone') ss.ok++;
      else if (endReason === 'fwdbtn' && ms >= SKIP_MIN_MS) { ss.skip++; ss.fwd.push(ms); }
      if (COMPLETE_CLOSES.has(endReason)) ss.close.push(ms);
      if (!trackSkipMeta.has(tidOnly) && (track || artist)) {
        trackSkipMeta.set(tidOnly, [track, artist]);
      }
    }

    if (ms < MIN_MS) {
      // Play corta: solo cuenta para el "partial" (badge en zero-plays)
      if (uri) {
        let p = trackUriPartial.get(uri);
        if (!p) { p = { p: 0, ms: 0 }; trackUriPartial.set(uri, p); }
        p.p++; p.ms += ms;
      }
      continue;
    }

    const { year: y, month, day, weekday, hour } = parsed;
    totalValidMs += ms;
    activeDaysAll.add(day);

    artistMs.set(artist, (artistMs.get(artist) || 0) + ms);
    artistPlays.set(artist, (artistPlays.get(artist) || 0) + 1);
    if (artist && !artistFirstYear.has(artist)) artistFirstYear.set(artist, y);
    if (artist && !artistFirstDay.has(artist)) artistFirstDay.set(artist, day);
    if (artist) {
      const tidEntrada = uri.split(':').pop();
      const e = artistEntrada.get(artist);
      // `plays` viene ordenado por ts: después de la primera solo puede empatar
      // el mismo `ts`, nunca uno anterior.
      if (!e || (e.ts === r.ts && tidEntrada < e.tid)) artistEntrada.set(artist, { ts: r.ts, name: track, tid: tidEntrada });
    }

    const ak = albumKey(album, artist);
    albumMs.set(ak, (albumMs.get(ak) || 0) + ms);
    albumPlaysCounter.set(ak, (albumPlaysCounter.get(ak) || 0) + 1);
    if (!albumMeta.has(ak)) albumMeta.set(ak, { name: album, artist, img: null });
    if (!albumFirstDay.has(ak)) albumFirstDay.set(ak, day);

    // Mix A+C para "álbum escuchado"
    if (!listenedFirst.has(ak)) {
      let dayMap = albumDay.get(ak);
      if (!dayMap) { dayMap = new Map(); albumDay.set(ak, dayMap); }
      let st = dayMap.get(day);
      if (!st) { st = { tracks: new Set(), ms: 0 }; dayMap.set(day, st); }
      st.tracks.add(track);
      st.ms += ms;
      const distinct = st.tracks.size;
      const minutes = st.ms / 60000;
      if (distinct >= MIN_TRACKS_SAMEDAY || minutes >= MIN_MIN_SAMEDAY) {
        listenedFirst.set(ak, {
          date: day,
          tracks_that_day: distinct,
          min_that_day: round1(minutes),
        });
        albumDay.delete(ak);
      }
    }

    const tk = trackKey(track, artist);
    trackMs.set(tk, (trackMs.get(tk) || 0) + ms);
    trackPlaysCount.set(tk, (trackPlaysCount.get(tk) || 0) + 1);
    if (!trackMeta.has(tk)) trackMeta.set(tk, { name: track, artist, uri, album });

    const yb = yearBucket(y);
    yb.artistMs.set(artist, (yb.artistMs.get(artist) || 0) + ms);
    yb.artistPlays.set(artist, (yb.artistPlays.get(artist) || 0) + 1);
    yb.albumMs.set(ak, (yb.albumMs.get(ak) || 0) + ms);
    yb.albumPlays.set(ak, (yb.albumPlays.get(ak) || 0) + 1);
    yb.trackMs.set(tk, (yb.trackMs.get(tk) || 0) + ms);
    yb.trackPlays.set(tk, (yb.trackPlays.get(tk) || 0) + 1);
    yb.monthsMs.set(month, (yb.monthsMs.get(month) || 0) + ms);
    yb.days.set(day, (yb.days.get(day) || 0) + ms);
    yb.activeDays.add(day);
    yb.plays++;
    if (yb.firstPlay == null || r.ts < yb.firstPlay) yb.firstPlay = r.ts;
    if (yb.lastPlay == null || r.ts > yb.lastPlay) yb.lastPlay = r.ts;

    const ym = `${y}-${String(month).padStart(2, '0')}`;
    monthlyMs.set(ym, (monthlyMs.get(ym) || 0) + ms);

    heatmap[weekday][hour] += ms;

    let u = trackUriStats.get(uri);
    if (!u) { u = { p: 0, ms: 0 }; trackUriStats.set(uri, u); }
    u.p++; u.ms += ms;

    // Ficha de canción
    let mm = trackUriMonthly.get(uri);
    if (!mm) { mm = new Map(); trackUriMonthly.set(uri, mm); }
    mm.set(ym, (mm.get(ym) || 0) + 1);
    if (!trackUriFirst.has(uri)) trackUriFirst.set(uri, day);
    trackUriLast.set(uri, day);
    let dc = trackUriDaycount.get(uri);
    if (!dc) { dc = new Map(); trackUriDaycount.set(uri, dc); }
    dc.set(day, (dc.get(day) || 0) + 1);

    // Récords
    dayMsGlobal.set(day, (dayMsGlobal.get(day) || 0) + ms);
    dayPlaysCount.set(day, (dayPlaysCount.get(day) || 0) + 1);
    let da = dayArtistMs.get(day);
    if (!da) { da = new Map(); dayArtistMs.set(day, da); }
    da.set(artist, (da.get(artist) || 0) + ms);
    let dt = dayTrackPlays.get(day);
    if (!dt) { dt = new Map(); dayTrackPlays.set(day, dt); }
    dt.set(tk, (dt.get(tk) || 0) + 1);
    // Semana empieza en lunes: parsed.weekday ya es 0=lunes; restamos ese offset del día
    const [yy, mm2, dd] = day.split('-').map(Number);
    const monday = new Date(Date.UTC(yy, mm2 - 1, dd - parsed.weekday));
    const weekStart = monday.toISOString().slice(0, 10);
    const wk = `${tk}|${weekStart}`;
    weekTrackPlays.set(wk, (weekTrackPlays.get(wk) || 0) + 1);
    let tds = tkDays.get(tk);
    if (!tds) { tds = new Set(); tkDays.set(tk, tds); }
    tds.add(day);
    let ad = artistDays.get(artist);
    if (!ad) { ad = new Set(); artistDays.set(artist, ad); }
    ad.add(day);
    // #10 va por `song_key` y no por (nombre, artista): el remaster, el single
    // y la versión del álbum son EL MISMO TEMA, que es justo lo que el récord
    // quiere contar. Por (nombre, artista) el mismo tema se parte en varias
    // filas y ninguna llega a los años que le corresponden.
    const sk = songKey(track, artist);
    // v3: el primer día de cada tema del artista (el mismo `sk`, la misma play
    // válida: entre el `artistFirstDay` de arriba y acá no hay ningún `continue`).
    if (artist) {
      let td = artistTemasDia.get(artist);
      if (!td) { td = new Map(); artistTemasDia.set(artist, td); }
      if (!td.has(sk)) td.set(sk, day);
    }
    let sy = songYears.get(sk); if (!sy) { sy = new Set(); songYears.set(sk, sy); } sy.add(y);
    let sd = songDays.get(sk); if (!sd) { sd = new Set(); songDays.set(sk, sd); } sd.add(day);
    songPlays.set(sk, (songPlays.get(sk) || 0) + 1);
    if (!songMeta.has(sk)) songMeta.set(sk, { name: track, artist });
    // #18: la racha corta si cambia el artista O si pasan más de RUN_GAP_S
    // entre dos plays. `plays` viene ordenado ascendente por ts, así que esto
    // es la secuencia real de escucha.
    const tsMs = Date.parse(r.ts);
    if (run && run.artist === artist && (tsMs - run.lastMs) / 1000 <= RUN_GAP_S) {
      run.plays++; run.ms += ms; run.end = r.ts; run.lastMs = tsMs;
    } else {
      if (run) artistRuns.push(run);
      run = { artist, plays: 1, ms, start: r.ts, end: r.ts, lastMs: tsMs };
    }
    validSeq++;
    if (MILESTONE_TARGETS.has(validSeq)) {
      milestones.push({ n: validSeq, date: day, name: track, artist });
    }

  }
  if (onProgress) onProgress({ phase: 'aggregate', loaded: totalPlays, total: totalPlays });
  await puntoDeControl();

  // ---- Racha global histórica ----
  const allDaysSorted = [...activeDaysAll].sort();
  let longestStreak = 0;
  if (allDaysSorted.length) {
    let cur = 1;
    longestStreak = 1;
    let prev = allDaysSorted[0];
    for (let i = 1; i < allDaysSorted.length; i++) {
      const gap = daysBetween(prev, allDaysSorted[i]);
      if (gap === 1) {
        cur++;
        longestStreak = Math.max(longestStreak, cur);
      } else if (gap > 1) {
        cur = 1;
      }
      prev = allDaysSorted[i];
    }
  }

  // El armado de abajo también cede entre bloques (v=297): medido en Chrome con
  // el export de Ian eran ~640 ms seguidos, y `skipStats` solo, ~260.
  await puntoDeControl();
  // ---- Helpers de salida ----
  function albumEntry(ak, ms, plays_) {
    const m = albumMeta.get(ak) || {};
    return { name: m.name || '', artist: m.artist || '', min: round1(ms / 60000), plays: plays_, img: m.img || null };
  }
  function trackEntry(tk, ms, plays_) {
    const m = trackMeta.get(tk) || {};
    return { name: m.name || '', artist: m.artist || '', min: round1(ms / 60000), plays: plays_, uri: m.uri || null };
  }

  // ── ventana de días con datos de un año (v=216) ──────────────────────────
  //
  // PUERTO EXACTO de `ventana_del_anio()` de scripts/gen-stats.py. ⚠️ Si se toca
  // una, se toca la otra: es la misma regla que ya vale para `song_key` y para
  // `junk`. Sin este espejo, quien sube su propio ZIP (BYOH) se quedaría sin el
  // calendario de la apertura y el owner no — y sin fallar en ningún lado.
  //
  // Mismo criterio que `daysCovered()` de features/wrapped.js: del 1 de enero
  // (o de la primera play global, si el historial empieza a mitad de año) al 31
  // de diciembre (o al último día con datos). El tope es el último día
  // REGISTRADO y no «hoy», porque el export llega con semanas de atraso.
  const primeraGlobal = allDaysSorted[0] || null;
  const ultimaGlobal = allDaysSorted[allDaysSorted.length - 1] || null;

  function ventanaDelAnio(y) {
    if (!primeraGlobal || !ultimaGlobal) return null;
    const pri = +primeraGlobal.slice(0, 4);
    const ult = +ultimaGlobal.slice(0, 4);
    if (pri > y || ult < y) return null;
    return {
      desde: pri === y ? primeraGlobal : `${y}-01-01`,
      hasta: ult === y ? ultimaGlobal : `${y}-12-31`,
    };
  }

  // ---- Ensamblar year_out ----
  const yearOut = [];
  const yearsSorted = [...years.keys()].sort((a, b) => a - b);
  for (const y of yearsSorted) {
    const yb = years.get(y);
    let peakDay = null;
    if (yb.days.size) {
      let mx = -1, best = null;
      for (const [d, m] of yb.days) if (m > mx) { mx = m; best = d; }
      peakDay = { date: best, min: round1(mx / 60000) };
    }
    let peakMonth = null;
    if (yb.monthsMs.size) {
      let mx = -1, best = null;
      for (const [m, ms] of yb.monthsMs) if (ms > mx) { mx = ms; best = m; }
      peakMonth = { month: best, min: round1(mx / 60000) };
    }
    let discovery = null, bestDiscMs = 0;
    for (const [a, ms] of yb.artistMs) {
      if (artistFirstYear.get(a) === y && ms > bestDiscMs) {
        bestDiscMs = ms;
        discovery = { artist: a, min: round1(ms / 60000) };
      }
    }
    const yearDaysSorted = [...yb.activeDays].sort();
    let yearStreak = 0;
    if (yearDaysSorted.length) {
      let cur = 1; yearStreak = 1;
      let prev = yearDaysSorted[0];
      for (let i = 1; i < yearDaysSorted.length; i++) {
        const gap = daysBetween(prev, yearDaysSorted[i]);
        if (gap === 1) { cur++; yearStreak = Math.max(yearStreak, cur); }
        else if (gap > 1) { cur = 1; }
        prev = yearDaysSorted[i];
      }
    }
    // ── el detalle por día (v=216) ───────────────────────────────────────
    // `yb.days` ya se acumulaba y solo se usaba para el día pico. Contrato:
    // `min` contiguo, un valor por día desde `from`. Un 0 es un día sin una
    // sola play válida, no un día sin datos — la ventana ya recortó eso.
    let daysOut = null;
    const ventana = ventanaDelAnio(y);
    if (ventana) {
      const serie = [];
      const pasos = daysBetween(ventana.desde, ventana.hasta);
      const base = Date.UTC(+ventana.desde.slice(0, 4), +ventana.desde.slice(5, 7) - 1, +ventana.desde.slice(8, 10));
      for (let k = 0; k <= pasos; k++) {
        const dia = new Date(base + k * 86400000).toISOString().slice(0, 10);
        serie.push(round1((yb.days.get(dia) || 0) / 60000));
      }
      daysOut = { from: ventana.desde, min: serie };
    }

    let totalMsYear = 0;
    for (const m of yb.artistMs.values()) totalMsYear += m;
    yearOut.push({
      year: y,
      min: round1(totalMsYear / 60000),
      plays: yb.plays,
      days_active: yb.activeDays.size,
      longest_streak: yearStreak,
      skip_pct: round1((yearSkips.get(y) || 0) / Math.max(1, (yearRaw.get(y) || 0) - (yearJunk.get(y) || 0)) * 100),
      first_play: yb.firstPlay,
      last_play: yb.lastPlay,
      peak_day: peakDay,
      peak_month: peakMonth,
      discovery,
      days: daysOut,
      top_artists: mostCommon(yb.artistMs, TOP_N_YEAR).map(([a, ms]) => ({ name: a, min: round1(ms / 60000), plays: yb.artistPlays.get(a) })),
      top_albums: mostCommon(yb.albumMs, TOP_N_YEAR).map(([ak, ms]) => albumEntry(ak, ms, yb.albumPlays.get(ak))),
      top_tracks: mostCommon(yb.trackMs, TOP_N_YEAR).map(([tk, ms]) => trackEntry(tk, ms, yb.trackPlays.get(tk))),
      // v4, al FINAL (append): espejo de `gen-stats.py`.
      plays_raw: yearRaw.get(y) || 0,
      skips: yearSkips.get(y) || 0,
      // v5, al FINAL (append): lo que el divisor de `skip_pct` le resta a `plays_raw`.
      plays_junk: yearJunk.get(y) || 0,
    });
  }

  await puntoDeControl();
  const generatedAt = new Date().toISOString();
  const totalsFirstPlay = yearOut.length ? yearOut[0].first_play : null;
  const totalsLastPlay = yearOut.length ? yearOut[yearOut.length - 1].last_play : null;

  const stats = {
    version: STATS_VERSION,
    generated_at: generatedAt,
    totals: {
      plays_valid: yearOut.reduce((n, y) => n + y.plays, 0),
      plays_raw: totalPlays,
      min: round1(totalValidMs / 60000),
      days_active: activeDaysAll.size,
      longest_streak: longestStreak,
      unique_artists: [...artistMs.entries()].filter(([, m]) => m > 0).length,
      unique_albums: albumMs.size,
      unique_tracks: trackMs.size,
      skip_pct: round1(totalSkipped / Math.max(1, totalPlays - totalJunk) * 100),
      first_play: totalsFirstPlay,
      last_play: totalsLastPlay,
      // v5, al FINAL (append): Σ de `years[].plays_junk`.
      plays_junk: totalJunk,
    },
    years: yearOut,
    monthly: [...monthlyMs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, ms]) => ({ m, min: round1(ms / 60000) })),
    heatmap: heatmap.map(row => row.map(m => round1(m / 60000))),
    top_artists_all_time: mostCommon(artistMs, TOP_N_ALLTIME).map(([a, ms]) => ({
      name: a, min: round1(ms / 60000), plays: artistPlays.get(a), first_year: artistFirstYear.get(a) || null,
    })),
    top_albums_all_time: mostCommon(albumMs, TOP_N_ALLTIME).map(([ak, ms]) => albumEntry(ak, ms, albumPlaysCounter.get(ak))),
    top_tracks_all_time: mostCommon(trackMs, TOP_N_ALLTIME).map(([tk, ms]) => trackEntry(tk, ms, trackPlaysCount.get(tk))),
  };

  await puntoDeControl();
  // ---- trackPlays index (id → [plays, seg] o [p, s, "p"]) ----
  const trackPlaysOut = {};
  for (const [uri, v] of trackUriStats) {
    if (v.ms >= KEEP_TRACK_IF_MS) {
      const tid = uri.split(':').pop();
      trackPlaysOut[tid] = [v.p, Math.round(v.ms / 1000)];
    }
  }
  for (const [uri, v] of trackUriPartial) {
    const tid = uri.split(':').pop();
    if (tid in trackPlaysOut) continue;
    if (v.p === 0) continue;
    trackPlaysOut[tid] = [v.p, Math.round(v.ms / 1000), 'p'];
  }

  await puntoDeControl();
  // ---- listened albums (agrupados por año del primer día que cumplieron el umbral) ----
  const listenedByYear = new Map();
  for (const [ak, info] of listenedFirst) {
    const meta = albumMeta.get(ak) || {};
    const y = Number(info.date.slice(0, 4));
    let arr = listenedByYear.get(y);
    if (!arr) { arr = []; listenedByYear.set(y, arr); }
    arr.push({
      name: meta.name || '', artist: meta.artist || '',
      date: info.date, tracks_that_day: info.tracks_that_day, min_that_day: info.min_that_day,
      img: meta.img || null,
    });
  }
  const listenedYears = [];
  for (const y of [...listenedByYear.keys()].sort((a, b) => a - b)) {
    const arr = listenedByYear.get(y).sort((a, b) => b.date.localeCompare(a.date));
    listenedYears.push({ year: y, count: arr.length, albums: arr });
  }
  const listened = {
    version: LISTENED_VERSION,
    criteria: { min_tracks_sameday: MIN_TRACKS_SAMEDAY, min_min_sameday: MIN_MIN_SAMEDAY },
    generated_at: generatedAt,
    totals: { albums: listenedYears.reduce((n, y) => n + y.count, 0), years: listenedYears.length },
    years: listenedYears,
  };

  await puntoDeControl();
  // ---- skip stats v2: [ok, skip, fwd_ms[], close_ms[], gid] ----
  // El gid agrupa los ids del MISMO tema (ver util/song-identity.js). Se
  // recorre en orden de tid para que la numeración salga igual que en el
  // Python y los dos JSON sean comparables.
  const skipOut = {};
  const gidSeq = new Map();
  let vueltas = 0;
  for (const tid of [...trackSkipStats.keys()].sort()) {
    if (++vueltas % 500 === 0) await puntoDeControl();
    const v = trackSkipStats.get(tid);
    const total = v.ok + v.skip;
    // `|| v.close.length`: un id que siempre terminó en endplay/logout tiene
    // total 0 y se caía con todos sus cierres (5.177 ids, 6.212 cierres sobre
    // el historial de Ian). Ver gen-stats.py.
    if (total < SKIP_STATS_MIN_PLAYS && !v.close.length) continue;
    const [name, artistName] = trackSkipMeta.get(tid) || ['', ''];
    let key = songKey(name, artistName);
    // Sin nombre no hay identidad: que sea su propio grupo, no todos juntos.
    if (!key.split('||')[0]) key = '\x00' + tid;
    if (!gidSeq.has(key)) gidSeq.set(key, gidSeq.size);
    skipOut[tid] = [v.ok, v.skip, v.fwd, v.close, gidSeq.get(key)];
  }
  const skipStats = {
    version: SKIP_STATS_VERSION,
    generated_at: generatedAt,
    min_plays: SKIP_STATS_MIN_PLAYS,
    skip_min_ms: SKIP_MIN_MS,
    complete_closes: [...COMPLETE_CLOSES].sort(),
    groups: gidSeq.size,
    tracks: skipOut,
  };

  await puntoDeControl();
  // ---- detail (ficha de canción, tracks con >= DETAIL_MIN_PLAYS) ----
  const detailOut = {};
  for (const [uri, months] of trackUriMonthly) {
    const st = trackUriStats.get(uri);
    if (!st || st.p < DETAIL_MIN_PLAYS) continue;
    const tid = uri.split(':').pop();
    const dc = trackUriDaycount.get(uri) || new Map();
    let maxDay = 0;
    for (const v of dc.values()) if (v > maxDay) maxDay = v;
    detailOut[tid] = {
      m: Object.fromEntries([...months.entries()].sort(([a], [b]) => a.localeCompare(b))),
      f: trackUriFirst.get(uri),
      l: trackUriLast.get(uri),
      d: dc.size,
      x: maxDay,
    };
  }
  const detail = {
    version: TRACK_DETAIL_VERSION,
    generated_at: generatedAt,
    min_plays: DETAIL_MIN_PLAYS,
    tracks: detailOut,
  };

  await puntoDeControl();
  // ---- records ----
  const tkName = (tk) => {
    const m = trackMeta.get(tk) || {};
    return { name: m.name || '', artist: m.artist || '' };
  };

  const topDaysArr = [...dayMsGlobal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const topDaysOut = topDaysArr.map(([day, ms]) => {
    const arts = dayArtistMs.get(day) || new Map();
    const [ta, tams] = mostCommon(arts, 1)[0] || ['', 0];
    const trs = dayTrackPlays.get(day) || new Map();
    const entry = { date: day, min: round1(ms / 60000), plays: dayPlaysCount.get(day) || 0, top_artist: { name: ta, min: round1(tams / 60000) } };
    if (trs.size) {
      const [ttk, ttp] = mostCommon(trs, 1)[0];
      entry.top_track = { ...tkName(ttk), plays: ttp };
    }
    return entry;
  });

  const trackDayRecords = [];
  for (const [day, ctr] of dayTrackPlays) {
    for (const [tk, n] of ctr) {
      if (n >= 5) trackDayRecords.push([n, day, tk]);
    }
  }
  // Python ordena la tupla (n, day, tk) entera en reversa: desempata por día y
  // después por clave, las dos descendentes. Ordenar solo por `n` deja el
  // resto en orden de iteración del Map, que no coincide con el Python.
  const desc = (x, y) => (x < y ? 1 : x > y ? -1 : 0);
  trackDayRecords.sort((a, b) => (b[0] - a[0]) || desc(a[1], b[1]) || desc(a[2], b[2]));
  const topTrackDaysOut = trackDayRecords.slice(0, 15).map(([n, day, tk]) => ({ ...tkName(tk), date: day, plays: n }));

  const artistDayRecords = [];
  for (const [day, ctr] of dayArtistMs) {
    for (const [a, aMs] of ctr) {
      artistDayRecords.push([aMs, day, a]);
    }
  }
  artistDayRecords.sort((a, b) => b[0] - a[0]);
  const topArtistDaysOut = artistDayRecords.slice(0, 15).map(([aMs, day, a]) => ({ artist: a, date: day, min: round1(aMs / 60000) }));

  await puntoDeControl();
  const weekArr = [...weekTrackPlays.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topTrackWeeksOut = weekArr.map(([wk, n]) => {
    const idx = wk.lastIndexOf('|');
    const tk = wk.slice(0, idx);
    const ws = wk.slice(idx + 1);
    return { ...tkName(tk), week_start: ws, plays: n };
  });

  const streaks = [];
  if (allDaysSorted.length) {
    let sStart = allDaysSorted[0];
    let sPrev = allDaysSorted[0];
    let sCur = 1;
    for (let i = 1; i < allDaysSorted.length; i++) {
      const d = allDaysSorted[i];
      const gap = daysBetween(sPrev, d);
      if (gap === 1) sCur++;
      else if (gap > 1) {
        streaks.push([sCur, sStart, sPrev]);
        sStart = d;
        sCur = 1;
      }
      sPrev = d;
    }
    streaks.push([sCur, sStart, sPrev]);
  }
  streaks.sort((a, b) => b[0] - a[0]);
  const topStreaksOut = streaks.slice(0, 10).map(([n, s, e]) => ({ days: n, start: s, end: e }));

  const trackMostDaysArr = [...tkDays.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 15);
  const trackMostDaysOut = trackMostDaysArr.map(([tk, ds]) => ({ ...tkName(tk), days: ds.size }));

  // La última racha queda abierta al salir del bucle: hay que cerrarla o se
  // pierde, y podría ser la ganadora.
  if (run) artistRuns.push(run);

  // #4 — el día que sonaron más artistas distintos. `dayArtistMs` ya está
  // indexado por artista, así que la cuenta sale de su tamaño.
  const dayMostArtistsOut = [...dayArtistMs.entries()]
    .sort((a, b) => (b[1].size - a[1].size) || ((dayMsGlobal.get(b[0]) || 0) - (dayMsGlobal.get(a[0]) || 0)))
    .slice(0, 10)
    .map(([day, arts]) => ({
      date: day, artists: arts.size, plays: dayPlaysCount.get(day) || 0,
      min: round1((dayMsGlobal.get(day) || 0) / 60000),
      top_artist: arts.size ? mostCommon(arts, 1)[0][0] : '',
    }));

  await puntoDeControl();
  // #10 — el tema que aparece en más años distintos.
  const trackMostYearsOut = [...songYears.entries()]
    .sort((a, b) => (b[1].size - a[1].size) || ((songPlays.get(b[0]) || 0) - (songPlays.get(a[0]) || 0)))
    .slice(0, 10)
    .map(([sk, ys]) => {
      const m = songMeta.get(sk);
      const arr = [...ys];
      return {
        name: m.name, artist: m.artist, years: ys.size,
        first_year: Math.min(...arr), last_year: Math.max(...arr),
        plays: songPlays.get(sk) || 0, days: (songDays.get(sk) || new Set()).size,
      };
    });

  // #14 — el artista que sonó en más días distintos. NO es el de más plays, y
  // esa es la gracia: Kanye tiene más plays que Drake y menos días.
  const artistMostDaysOut = [...artistDays.entries()]
    .sort((a, b) => (b[1].size - a[1].size) || ((artistPlays.get(b[0]) || 0) - (artistPlays.get(a[0]) || 0)))
    .slice(0, 10)
    .map(([a, ds]) => ({ artist: a, days: ds.size, plays: artistPlays.get(a) || 0, min: round1((artistMs.get(a) || 0) / 60000) }));

  // #15 y #16 salen de la misma curva: artista → {año: minutos}.
  const aniosDatos = [...years.keys()].sort((a, b) => a - b);
  const anioIncompleto = aniosDatos.length ? aniosDatos[aniosDatos.length - 1] : null;
  const curva = new Map();
  for (const y_ of aniosDatos) {
    for (const [a, aMs] of years.get(y_).artistMs) {
      if (!aMs) continue;
      let c = curva.get(a); if (!c) { c = new Map(); curva.set(a, c); }
      c.set(y_, aMs / 60000);
    }
  }
  // ⚠️ EL ÚLTIMO AÑO CON DATOS NO PUEDE SER AÑO DESTINO: el export corta a
  // mitad de año, así que contra ese año cualquiera se ve caído a cero solo
  // porque el año no terminó.
  const abandonados = [], crecidos = [];
  for (const [a, c] of curva) {
    for (let i = 0; i < aniosDatos.length - 1; i++) {
      const y_ = aniosDatos[i], nxt = aniosDatos[i + 1];
      if (nxt === anioIncompleto) continue;
      const base = c.get(y_) || 0, desp = c.get(nxt) || 0;
      // #15 — abandonado: mucho un año, cero al siguiente y NUNCA MÁS.
      if (base > 0 && desp === 0 && !aniosDatos.some(p => p > nxt && (c.get(p) || 0) > 0)) {
        abandonados.push([base, a, y_, nxt]);
      }
      // #16 — el que más creció, por MULTIPLICADOR y con base ≥ GROWTH_MIN_BASE.
      if (base >= GROWTH_MIN_BASE && desp > base) crecidos.push([desp / base, a, y_, nxt, base, desp]);
    }
  }
  abandonados.sort((x, y2) => (y2[0] - x[0]) || (x[1] < y2[1] ? -1 : x[1] > y2[1] ? 1 : 0));
  crecidos.sort((x, y2) => (y2[0] - x[0]) || (x[1] < y2[1] ? -1 : x[1] > y2[1] ? 1 : 0));
  const artistDroppedOut = abandonados.slice(0, 10).map(([m, a, y_, nxt]) => ({
    artist: a, year: y_, min: round1(m), plays: years.get(y_).artistPlays.get(a) || 0, since: nxt,
  }));
  const artistGrowthOut = crecidos.slice(0, 10).map(([f, a, y_, nxt, b, d]) => ({
    artist: a, from_year: y_, to_year: nxt, from_min: round1(b), to_min: round1(d), factor: round1(f),
  }));

  await puntoDeControl();
  // #18 — la racha más larga del mismo artista sin intercalar otro, en plays
  // válidas. Se ordena por plays y no por minutos a propósito: por minutos
  // sería otra forma de escribir "Maratones de un artista", que ya existe.
  artistRuns.sort((a, b) => (b.plays - a.plays) || (b.ms - a.ms));
  const artistRunsOut = artistRuns.slice(0, 10).map(c => ({
    artist: c.artist, plays: c.plays, min: round1(c.ms / 60000), date: c.start.slice(0, 10),
    hours: round1((Date.parse(c.end) - Date.parse(c.start)) / 3600000),
  }));

  const records = {
    version: RECORDS_VERSION,
    generated_at: generatedAt,
    top_days: topDaysOut,
    top_track_days: topTrackDaysOut,
    top_artist_days: topArtistDaysOut,
    top_track_weeks: topTrackWeeksOut,
    top_streaks: topStreaksOut,
    track_most_days: trackMostDaysOut,
    day_most_artists: dayMostArtistsOut,
    track_most_years: trackMostYearsOut,
    artist_most_days: artistMostDaysOut,
    artist_dropped: artistDroppedOut,
    artist_growth: artistGrowthOut,
    artist_runs: artistRunsOut,
    milestones,
  };

  await puntoDeControl();
  // [name, artist, plays, ms, first_day]. Los dos primeros campos NO se mueven:
  // album-heard.js desestructura `[name, artist]` y tiene que seguir andando con
  // los JSON v3. Los dos siguientes los usa la ficha de álbum (antes decía
  // "0 plays") y el quinto, su «primera vez».
  const albumsPlayedOut = [];
  for (const [ak, m] of albumMeta) {
    const ms = albumMs.get(ak) || 0;
    if (ms > 0) albumsPlayedOut.push([m.name || '', m.artist || '', albumPlaysCounter.get(ak) || 0, ms, albumFirstDay.get(ak) || null]);
  }

  const trackPlays = {
    version: TRACK_PLAYS_VERSION,
    generated_at: generatedAt,
    tracks: trackPlaysOut,
    albums: albumsPlayedOut,
  };

  await puntoDeControl();
  // v=126 — top de tracks POR ARTISTA desde el historial completo. Es lo que
  // usa la ficha de artista: los tops anuales (40) y el global (60) dejaban a
  // los artistas chicos con un solo track visible. Espejo de gen-stats.py.
  const perArtist = new Map();
  for (const [tk, m] of trackMeta) {
    const arr = perArtist.get(m.artist) || [];
    arr.push(tk);
    perArtist.set(m.artist, arr);
  }
  const artistTracksOut = {};
  const artistTotalsOut = {};
  vueltas = 0;
  for (const [artistName, tks] of perArtist) {
    if (++vueltas % 500 === 0) await puntoDeControl();
    // Totales reales: los tops anuales (40) y el global (60) dejan fuera a la
    // mayoría de los artistas, y sin esto la ficha mostraría 0 plays, "último
    // año —" y sin chart.
    const curve = [...years.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, yb]) => yb.artistMs.get(artistName))
      .map(([y, yb]) => [y, round1(yb.artistMs.get(artistName) / 60000), yb.artistPlays.get(artistName) || 0]);
    artistTotalsOut[artistName] = [
      artistPlays.get(artistName) || 0,
      round1((artistMs.get(artistName) || 0) / 60000),
      artistFirstYear.get(artistName) ?? null,
      curve.length ? curve[curve.length - 1][0] : null,
      curve,
      artistFirstDay.get(artistName) || null,
      // v3: [6] el tema de entrada y [7] el día del segundo tema (dato crudo:
      // las cuentas las hace `#puertas`).
      ...entradaYSegundo(artistEntrada.get(artistName), artistTemasDia.get(artistName), artistName),
    ];
    tks.sort((a, b) =>
      (trackPlaysCount.get(b) || 0) - (trackPlaysCount.get(a) || 0) ||
      (trackMs.get(b) || 0) - (trackMs.get(a) || 0));
    artistTracksOut[artistName] = tks.slice(0, ARTIST_TRACKS_TOP_N).map(tk => {
      const m = trackMeta.get(tk) || {};
      return [
        m.name || '',
        trackPlaysCount.get(tk) || 0,
        round1((trackMs.get(tk) || 0) / 60000),
        (m.uri || '').split(':').pop(),
      ];
    });
  }

  const artistTracks = {
    version: ARTIST_TRACKS_VERSION,
    generated_at: generatedAt,
    artists: artistTracksOut,
    totals: artistTotalsOut,
  };

  await puntoDeControl();
  // ⚠️ `days` se AGREGA. Los siete de siempre no cambian ni un byte: lo
  // afirma `tests/calendario-dias.test.mjs` con `JSON.stringify`.
  return { stats, trackPlays, listened, skipStats, detail, records, artistTracks, days };
}

export { processStreamingHistory, crearAcumuladorDeDias, DAYS_VERSION };
