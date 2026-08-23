// Port a JS de scripts/gen-stats.py — dado un array de arrays de plays crudas
// del Extended Streaming History, calcula los 6 payloads (stats, trackPlays,
// listened, skipStats, detail, records) con la MISMA lógica que el Python.
//
// Uso desde el UI de upload:
//   const raw = await Promise.all(files.map(readJson));   // File[] → array[array_plays]
//   const result = processStreamingHistory(raw, { onProgress });
//   await saveMyHistory(userId, result);
//
// Devuelve la misma forma que los JSONs del repo (mismos `version` numbers).

import { isJunkTrack } from './util/junk.js?v=156';
import { songKey } from './util/song-identity.js?v=156';

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
const STATS_VERSION = 2;
const TRACK_PLAYS_VERSION = 4;   // v4: cada álbum de `albums` lleva plays y ms (espejo de gen-stats.py)
const SKIP_STATS_VERSION = 2;    // v2: dato crudo (ms de cada skip/cierre) + gid; el veredicto pasó a features/skips.js
const LISTENED_VERSION = 2;
const TRACK_DETAIL_VERSION = 1;
const RECORDS_VERSION = 2;
const ARTIST_TRACKS_VERSION = 1;
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

// ---- Función principal ----

function processStreamingHistory(fileArrays, { onProgress } = {}) {
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
  }
  // sort por ts asc (para first_year, discovery, milestones en orden real)
  plays.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const totalPlays = plays.length;
  if (onProgress) onProgress({ phase: 'aggregate', loaded: 0, total: totalPlays });

  // ---- Acumuladores globales ----
  let totalValidMs = 0;
  let totalSkipped = 0;
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
        plays: 0, skipped: 0,
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
  const milestones = [];
  let validSeq = 0;

  const albumDay = new Map(); // ak → Map<day, { tracksSet, ms }>
  const listenedFirst = new Map(); // ak → { date, tracks_that_day, min_that_day }

  const progressStep = Math.max(1, Math.floor(totalPlays / 40));

  for (let i = 0; i < plays.length; i++) {
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

    // Basura funcional (sonidos saca-agua, lluvia para dormir, 432 Hz…)
    if (isJunkTrack(track, artist)) continue;

    // skip% (contra el total, sin filtro de ms)
    const isSkip = skipped || (endReason === 'fwdbtn' && ms < MIN_MS);
    if (isSkip) totalSkipped++;

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

    const ak = albumKey(album, artist);
    albumMs.set(ak, (albumMs.get(ak) || 0) + ms);
    albumPlaysCounter.set(ak, (albumPlaysCounter.get(ak) || 0) + 1);
    if (!albumMeta.has(ak)) albumMeta.set(ak, { name: album, artist, img: null });

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
    if (endReason === 'fwdbtn' || skipped) yb.skipped++;
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
    validSeq++;
    if (MILESTONE_TARGETS.has(validSeq)) {
      milestones.push({ n: validSeq, date: day, name: track, artist });
    }

    if (onProgress && i % progressStep === 0) {
      onProgress({ phase: 'aggregate', loaded: i, total: totalPlays });
    }
  }
  if (onProgress) onProgress({ phase: 'aggregate', loaded: totalPlays, total: totalPlays });

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

  // ---- Helpers de salida ----
  function albumEntry(ak, ms, plays_) {
    const m = albumMeta.get(ak) || {};
    return { name: m.name || '', artist: m.artist || '', min: round1(ms / 60000), plays: plays_, img: m.img || null };
  }
  function trackEntry(tk, ms, plays_) {
    const m = trackMeta.get(tk) || {};
    return { name: m.name || '', artist: m.artist || '', min: round1(ms / 60000), plays: plays_, uri: m.uri || null };
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
    let totalMsYear = 0;
    for (const m of yb.artistMs.values()) totalMsYear += m;
    yearOut.push({
      year: y,
      min: round1(totalMsYear / 60000),
      plays: yb.plays,
      days_active: yb.activeDays.size,
      longest_streak: yearStreak,
      skip_pct: round1(yb.skipped / Math.max(1, yb.plays + yb.skipped) * 100),
      first_play: yb.firstPlay,
      last_play: yb.lastPlay,
      peak_day: peakDay,
      peak_month: peakMonth,
      discovery,
      top_artists: mostCommon(yb.artistMs, TOP_N_YEAR).map(([a, ms]) => ({ name: a, min: round1(ms / 60000), plays: yb.artistPlays.get(a) })),
      top_albums: mostCommon(yb.albumMs, TOP_N_YEAR).map(([ak, ms]) => albumEntry(ak, ms, yb.albumPlays.get(ak))),
      top_tracks: mostCommon(yb.trackMs, TOP_N_YEAR).map(([tk, ms]) => trackEntry(tk, ms, yb.trackPlays.get(tk))),
    });
  }

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
      skip_pct: round1(totalSkipped / Math.max(1, totalPlays) * 100),
      first_play: totalsFirstPlay,
      last_play: totalsLastPlay,
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

  // ---- skip stats v2: [ok, skip, fwd_ms[], close_ms[], gid] ----
  // El gid agrupa los ids del MISMO tema (ver util/song-identity.js). Se
  // recorre en orden de tid para que la numeración salga igual que en el
  // Python y los dos JSON sean comparables.
  const skipOut = {};
  const gidSeq = new Map();
  for (const tid of [...trackSkipStats.keys()].sort()) {
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
  trackDayRecords.sort((a, b) => b[0] - a[0]);
  const topTrackDaysOut = trackDayRecords.slice(0, 15).map(([n, day, tk]) => ({ ...tkName(tk), date: day, plays: n }));

  const artistDayRecords = [];
  for (const [day, ctr] of dayArtistMs) {
    for (const [a, aMs] of ctr) {
      artistDayRecords.push([aMs, day, a]);
    }
  }
  artistDayRecords.sort((a, b) => b[0] - a[0]);
  const topArtistDaysOut = artistDayRecords.slice(0, 15).map(([aMs, day, a]) => ({ artist: a, date: day, min: round1(aMs / 60000) }));

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

  const records = {
    version: RECORDS_VERSION,
    generated_at: generatedAt,
    top_days: topDaysOut,
    top_track_days: topTrackDaysOut,
    top_artist_days: topArtistDaysOut,
    top_track_weeks: topTrackWeeksOut,
    top_streaks: topStreaksOut,
    track_most_days: trackMostDaysOut,
    milestones,
  };

  // [name, artist, plays, ms]. Los dos primeros campos NO se mueven: album-heard.js
  // desestructura `[name, artist]` y tiene que seguir andando con los JSON v3.
  // Los dos nuevos los usa la ficha de álbum (antes decía "0 plays").
  const albumsPlayedOut = [];
  for (const [ak, m] of albumMeta) {
    const ms = albumMs.get(ak) || 0;
    if (ms > 0) albumsPlayedOut.push([m.name || '', m.artist || '', albumPlaysCounter.get(ak) || 0, ms]);
  }

  const trackPlays = {
    version: TRACK_PLAYS_VERSION,
    generated_at: generatedAt,
    tracks: trackPlaysOut,
    albums: albumsPlayedOut,
  };

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
  for (const [artistName, tks] of perArtist) {
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

  return { stats, trackPlays, listened, skipStats, detail, records, artistTracks };
}

export { processStreamingHistory };
