#!/usr/bin/env python3
"""
Genera JSONs agregados a partir del Extended Streaming History de Spotify.

Salidas:
- src/data/history-stats.json    Wrapped + Dashboard: totales, por año, heatmap, timeline mensual, all-time tops
- src/data/history-track-plays.json  Índice track_uri -> {p:plays, ms:ms_totales} para cruces con likes
- src/data/history-skip-stats.json   Índice track_id -> [ok, skip] para "Skips crónicos"
  · ok = plays con reason_end == 'trackdone'
  · skip = plays con reason_end == 'fwdbtn' y ms_played >= SKIP_MIN_MS (skip consciente)

Filtros:
- Se descartan plays con ms_played < 30000 para todos los agregados MENOS skip% (que usa total)
- Se descartan podcasts/audiobooks (no spotify_track_uri)
- Dedupe por (ts, uri, ms_played) — los archivos _N son partes descargadas en distintos períodos y se superponen
"""

import json
import glob
import os
import unicodedata
from collections import defaultdict, Counter
from datetime import datetime, date, timedelta

HISTORY_DIR = "/home/ian/spotify-web/my_spotify_data/Spotify Extended Streaming History"
OUT_DIR = "/home/ian/spotify-web/src/data"
OLD_IMG_JSON = "/home/ian/spotify-web/src/data/listening-history.json"

MIN_MS = 30000  # trigger warning: ignoramos plays de menos de 30s
SKIP_MIN_MS = 5000  # skip "consciente": si le dio next después de 5s+ es deliberado
SKIP_STATS_MIN_PLAYS = 3  # excluimos tracks con menos de 3 plays totales (ruido)
STATS_VERSION = 2            # bump: excluye "Sonido Para Sacar Agua Del Movil"
TRACK_PLAYS_VERSION = 3      # v3: agrega `albums` (lista name/artist de TODO álbum tocado, aunque sea 1 play). v2: incluía entries "partial" para tracks solo con plays <30s
SKIP_STATS_VERSION = 1
LISTENED_VERSION = 2         # bump: excluye "Sonido Para Sacar Agua Del Movil"
TRACK_DETAIL_VERSION = 1     # ficha de canción: plays por mes + primera/última + récords del track
RECORDS_VERSION = 2          # v2: excluye todas las variantes del sonido saca-agua
ARTIST_TRACKS_VERSION = 1    # v=126: top de tracks por artista desde el historial COMPLETO (ficha de artista)
ARTIST_TRACKS_TOP_N = 6      # la ficha muestra 5; guardamos 6 de colchón
DETAIL_MIN_PLAYS = 5         # solo tracks con >=N plays válidas entran al detalle (controla peso)
MILESTONE_TARGETS = {1, 10000, 25000, 50000, 75000, 100000, 125000, 150000, 175000, 200000, 250000, 300000}
TOP_N_YEAR = 40       # top X por año
TOP_N_ALLTIME = 60    # top X global
KEEP_TRACK_IF_MS = 60000  # solo indexamos tracks con >=60s totales (reduce peso del JSON)

# Tracks a excluir de todos los agregados (funcionales de despertador/notificación
# que aparecen inflados por reproducciones automáticas y no representan música escuchada).
# Match case-insensitive por subcadena en el nombre del track.
# v=126: ampliado de 3 substrings a artistas + substrings. Debe quedar
# sincronizado con src/js/util/junk.js (mismo ruleset, mismas normalizaciones).
# Verificado contra el historial real de Ian: 63 entradas / 205 plays filtradas,
# sin falsos positivos sobre música de verdad.

# Artistas que solo publican sonidos funcionales — se van enteros.
EXCLUDED_ARTISTS = {
    "nbeats",                          # sonidos saca-agua, alarmas, repelente de mosquitos
    "miracle tones",                   # catálogo entero de "432 Hz ..."
    "para dormir",                     # "Sonido de Lluvia en la Ventana - Parte NN"
    "lluvia del bosque",
    "24h rain sounds",
    "naturaleza sonidos",
    "sonidos de truenos y lluvia",
    "estudio de sonidos de lluvia",
    "calmwaves",
    "musica instrumental para dormir",
}

# Substrings sobre el nombre del track normalizado (minúsculas, sin tildes).
# Deliberadamente estrechos: "white noise" y "pink noise" a secas se probaron y
# pisaban canciones reales (Brent Faiyaz, Ella Vos, young friend), así que no están.
EXCLUDED_TRACK_SUBSTRINGS = [
    "sonido para",                 # sacar agua / eliminar agua / enfriar el teléfono
    "sonidos para",
    "sonido de lluvia",
    "sonidos de lluvia",
    "sonidos de naturaleza",
    "lluvia de fondo para dormir",
    "fix my speakers",
    "water eject",
    "eject water",
    "remove water from",
    "som para remover agua",
    "ruido fuerte para molestar",
    "ruido blanco",
    "frecuencia de repelente",
    "frecuencias de repelente",
    "rain sounds",
    "rain soundscape",
    "432 hz",
    "432hz",
    "528 hz",
    "528hz",
    "theta waves",
    "binaural beat",
    "tono de prueba",
    "test tone",
]


def _norm_junk(s):
    """Minúsculas sin tildes, para que 'Teléfono' y 'Telefono' caigan igual."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def is_junk_track(track, artist):
    """¿Esta entrada es un sonido funcional en vez de música?"""
    if artist and _norm_junk(artist) in EXCLUDED_ARTISTS:
        return True
    t = _norm_junk(track)
    return bool(t) and any(sub in t for sub in EXCLUDED_TRACK_SUBSTRINGS)

# Regla mix A+C para detectar "álbum escuchado" desde el historial:
# el álbum cuenta cuando en un mismo día tuvo >=MIN_TRACKS_SAMEDAY tracks distintos
# O >=MIN_MIN_SAMEDAY minutos acumulados (lo que se cumpla primero).
MIN_TRACKS_SAMEDAY = 4
MIN_MIN_SAMEDAY = 25

# ---------------------------------------------------------------------------
# 1. Cargar y dedupear
# ---------------------------------------------------------------------------

def load_all():
    files = sorted(glob.glob(os.path.join(HISTORY_DIR, "Streaming_History_Audio_*.json")))
    seen = set()
    out = []
    for f in files:
        with open(f) as fh:
            data = json.load(fh)
        for r in data:
            uri = r.get("spotify_track_uri")
            if not uri:
                continue  # podcasts/audiobooks/plays sin uri
            key = (r["ts"], uri, r.get("ms_played", 0))
            if key in seen:
                continue
            seen.add(key)
            out.append(r)
    return out

# ---------------------------------------------------------------------------
# 2. Índice de tapas horneadas (reciclamos el JSON viejo)
# ---------------------------------------------------------------------------

def load_album_images():
    idx = {}
    try:
        with open(OLD_IMG_JSON) as fh:
            payload = json.load(fh)
        for a in payload.get("albums", []):
            img = a.get("img")
            if not img:
                continue
            # múltiples claves para maximizar el match
            keys = [
                (a.get("a", "").lower(), a.get("ar", "").lower()),
            ]
            uri = a.get("u")
            if uri:
                keys.append(("uri", uri))
            for k in keys:
                idx[k] = img
    except Exception as e:
        print("no pude cargar tapas viejas:", e)
    return idx

# ---------------------------------------------------------------------------
# 3. Agregados
# ---------------------------------------------------------------------------

def parse_ts(ts):
    # "2018-08-15T01:23:39Z"
    return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")

def album_key(name, artist):
    return f"{(name or '').lower()}||{(artist or '').lower()}"

def track_key(name, artist):
    return f"{(name or '').lower()}||{(artist or '').lower()}"

def build_stats(plays, img_idx):
    # Orden cronológico ascendente para que "primer año", "descubrimiento" y
    # "primer día que cumple umbral" salgan correctos.
    plays = sorted(plays, key=lambda r: r.get("ts", ""))
    # totales
    total_plays = len(plays)
    total_valid_ms = 0
    total_skipped = 0
    active_days_all = set()

    # global sums
    artist_ms = Counter()
    artist_plays = Counter()
    album_ms = Counter()
    album_plays = Counter()
    album_meta = {}   # album_key -> {name, artist, img}
    track_ms = Counter()
    track_plays_count = Counter()
    track_meta = {}   # track_key -> {name, artist, uri, img}

    # first play by artist (para descubrimientos)
    artist_first_year = {}

    # por año
    years = defaultdict(lambda: {
        "artist_ms": Counter(),
        "artist_plays": Counter(),
        "album_ms": Counter(),
        "album_plays": Counter(),
        "track_ms": Counter(),
        "track_plays": Counter(),
        "months_ms": Counter(),   # 1..12
        "days": {},              # 'YYYY-MM-DD' -> ms
        "active_days": set(),
        "plays": 0,
        "skipped": 0,
        "first_play": None,
        "last_play": None,
    })

    # timeline mensual (YYYY-MM)
    monthly_ms = Counter()

    # heatmap 7x24 (0=lunes)
    heatmap = [[0]*24 for _ in range(7)]

    # índice de plays por track para cruce con likes (solo plays >=30s)
    track_uri_stats = defaultdict(lambda: {"p": 0, "ms": 0})
    # tracks que solo tuvieron plays <30s (nunca completadas): útil para "quizás lo escuchaste"
    track_uri_partial = defaultdict(lambda: {"p": 0, "ms": 0})
    # Skips por track: ok = trackdone, skip = fwdbtn con >=SKIP_MIN_MS.
    # Cuenta el track_id (sin prefijo spotify:track:) para pegar directo con likes.
    # Guardamos también el meta para poder mostrar tapa/nombre sin depender de los likes.
    track_skip_stats = defaultdict(lambda: {"ok": 0, "skip": 0})
    track_skip_meta = {}

    # Ficha de canción: detalle por uri (plays por mes, primera/última, días, pico diario)
    track_uri_monthly = defaultdict(Counter)   # uri -> {"YYYY-MM": plays}
    track_uri_first = {}
    track_uri_last = {}
    track_uri_daycount = defaultdict(Counter)  # uri -> {day: plays}
    # Récords: acumuladores por día/semana
    day_ms_global = Counter()
    day_plays = Counter()
    day_artist_ms = defaultdict(Counter)       # day -> Counter(artista -> ms)
    day_track_plays = defaultdict(Counter)     # day -> Counter(tk -> plays)
    week_track_plays = Counter()               # (tk, lunes de la semana) -> plays
    tk_days = defaultdict(set)                 # tk -> set de días en que sonó
    milestones = []
    valid_seq = 0

    # Estado por álbum × día para detectar "escuchado" (mix A+C).
    # ak -> day (YYYY-MM-DD) -> {tracks_set, ms}
    album_day = defaultdict(lambda: defaultdict(lambda: {"tracks": set(), "ms": 0}))
    # Álbum -> primer día que cumplió el umbral (se llena una sola vez).
    listened_first = {}  # ak -> {"date": "YYYY-MM-DD", "tracks_that_day": N, "min_that_day": M}

    for r in plays:
        ts_str = r["ts"]
        try:
            dt = parse_ts(ts_str)
        except Exception:
            continue
        ms = int(r.get("ms_played") or 0)
        artist = r.get("master_metadata_album_artist_name") or ""
        album = r.get("master_metadata_album_album_name") or ""
        track = r.get("master_metadata_track_name") or ""
        uri = r.get("spotify_track_uri") or ""
        skipped = bool(r.get("skipped"))
        end_reason = r.get("reason_end") or ""

        # Filtrar basura (sonidos funcionales que inflan tops sin ser música)
        if is_junk_track(track, artist):
            continue

        # skip% cuenta contra el total de plays
        is_skip = skipped or (end_reason == "fwdbtn" and ms < MIN_MS)
        if is_skip:
            total_skipped += 1

        # Skips por track: solo si tenemos URI. Contamos ok si terminó bien,
        # skip si el usuario le dio next después de escuchar al menos 5s
        # (menos que eso puede ser autoplay skipeado o cambio accidental).
        if uri:
            tid_only = uri.split(":")[-1]
            if end_reason == "trackdone":
                track_skip_stats[tid_only]["ok"] += 1
            elif end_reason == "fwdbtn" and ms >= SKIP_MIN_MS:
                track_skip_stats[tid_only]["skip"] += 1
            if tid_only not in track_skip_meta and (track or artist):
                track_skip_meta[tid_only] = {"n": track, "a": artist, "al": album}

        if ms < MIN_MS:
            # Trigger warning: no cuenta para stats. Igual anotamos en partial para el badge de zeroplays.
            if uri:
                track_uri_partial[uri]["p"] += 1
                track_uri_partial[uri]["ms"] += ms
            continue

        y = dt.year
        month = dt.month
        day = dt.date().isoformat()

        total_valid_ms += ms
        active_days_all.add(day)

        artist_ms[artist] += ms
        artist_plays[artist] += 1
        if artist and artist not in artist_first_year:
            artist_first_year[artist] = y

        ak = album_key(album, artist)
        album_ms[ak] += ms
        album_plays[ak] += 1
        if ak not in album_meta:
            album_meta[ak] = {
                "name": album,
                "artist": artist,
                "img": img_idx.get((album.lower(), artist.lower())),
            }

        # Mix A+C: contar tracks distintos y minutos del álbum ese día.
        if ak not in listened_first:
            state = album_day[ak][day]
            state["tracks"].add(track)  # nombre del track como identidad (evita covers/masterings distintos)
            state["ms"] += ms
            distinct = len(state["tracks"])
            minutes = state["ms"] / 60000
            if distinct >= MIN_TRACKS_SAMEDAY or minutes >= MIN_MIN_SAMEDAY:
                listened_first[ak] = {
                    "date": day,
                    "tracks_that_day": distinct,
                    "min_that_day": round(minutes, 1),
                }
                # ya no necesitamos guardar más estado por día para este álbum
                del album_day[ak]

        tk = track_key(track, artist)
        track_ms[tk] += ms
        track_plays_count[tk] += 1
        if tk not in track_meta:
            track_meta[tk] = {
                "name": track,
                "artist": artist,
                "uri": uri,
                "album": album,
            }

        yb = years[y]
        yb["artist_ms"][artist] += ms
        yb["artist_plays"][artist] += 1
        yb["album_ms"][ak] += ms
        yb["album_plays"][ak] += 1
        yb["track_ms"][tk] += ms
        yb["track_plays"][tk] += 1
        yb["months_ms"][month] += ms
        yb["days"][day] = yb["days"].get(day, 0) + ms
        yb["active_days"].add(day)
        yb["plays"] += 1
        if end_reason == "fwdbtn" or skipped:
            yb["skipped"] += 1
        if yb["first_play"] is None or ts_str < yb["first_play"]:
            yb["first_play"] = ts_str
        if yb["last_play"] is None or ts_str > yb["last_play"]:
            yb["last_play"] = ts_str

        ym = f"{y:04d}-{month:02d}"
        monthly_ms[ym] += ms

        # heatmap: lunes=0 en Python (weekday())
        heatmap[dt.weekday()][dt.hour] += ms

        # índice por uri
        u = track_uri_stats[uri]
        u["p"] += 1
        u["ms"] += ms

        # detalle por track (ficha de canción)
        track_uri_monthly[uri][ym] += 1
        if uri not in track_uri_first:
            track_uri_first[uri] = day
        track_uri_last[uri] = day
        track_uri_daycount[uri][day] += 1

        # récords
        day_ms_global[day] += ms
        day_plays[day] += 1
        day_artist_ms[day][artist] += ms
        day_track_plays[day][tk] += 1
        week_track_plays[(tk, (dt.date() - timedelta(days=dt.weekday())).isoformat())] += 1
        tk_days[tk].add(day)
        valid_seq += 1
        if valid_seq in MILESTONE_TARGETS:
            milestones.append({"n": valid_seq, "date": day, "name": track, "artist": artist})

    # racha global histórica
    all_days_sorted = sorted(active_days_all)
    longest_streak = 0
    if all_days_sorted:
        cur = 1
        longest_streak = 1
        prev = date.fromisoformat(all_days_sorted[0])
        for s in all_days_sorted[1:]:
            d = date.fromisoformat(s)
            if (d - prev).days == 1:
                cur += 1
                longest_streak = max(longest_streak, cur)
            elif d != prev:
                cur = 1
            prev = d

    # ---- ensamblar salida ----
    def album_entry(ak, ms, plays_):
        m = album_meta.get(ak, {})
        return {
            "name": m.get("name", ""),
            "artist": m.get("artist", ""),
            "min": round(ms/60000, 1),
            "plays": plays_,
            "img": m.get("img"),
        }

    def track_entry(tk, ms, plays_):
        m = track_meta.get(tk, {})
        return {
            "name": m.get("name", ""),
            "artist": m.get("artist", ""),
            "min": round(ms/60000, 1),
            "plays": plays_,
            "uri": m.get("uri"),
        }

    year_out = []
    for y in sorted(years.keys()):
        yb = years[y]
        # día pico
        peak_day = None
        if yb["days"]:
            d, ms = max(yb["days"].items(), key=lambda kv: kv[1])
            peak_day = {"date": d, "min": round(ms/60000, 1)}
        # mes pico
        peak_month = None
        if yb["months_ms"]:
            m, ms = max(yb["months_ms"].items(), key=lambda kv: kv[1])
            peak_month = {"month": m, "min": round(ms/60000, 1)}
        # descubrimiento del año: artista con más minutos ese año, cuyo primer play fue ese año
        discovery = None
        best_disc_ms = 0
        for a, ms in yb["artist_ms"].items():
            if artist_first_year.get(a) == y and ms > best_disc_ms:
                best_disc_ms = ms
                discovery = {"artist": a, "min": round(ms/60000, 1)}

        # racha del año
        year_days_sorted = sorted(yb["active_days"])
        year_streak = 0
        if year_days_sorted:
            cur = 1; year_streak = 1
            prev = date.fromisoformat(year_days_sorted[0])
            for s in year_days_sorted[1:]:
                d = date.fromisoformat(s)
                if (d - prev).days == 1:
                    cur += 1
                    year_streak = max(year_streak, cur)
                elif d != prev:
                    cur = 1
                prev = d

        year_out.append({
            "year": y,
            "min": round(sum(yb["artist_ms"].values())/60000, 1),
            "plays": yb["plays"],
            "days_active": len(yb["active_days"]),
            "longest_streak": year_streak,
            "skip_pct": round(yb["skipped"]/max(1, yb["plays"] + yb["skipped"]) * 100, 1),
            "first_play": yb["first_play"],
            "last_play": yb["last_play"],
            "peak_day": peak_day,
            "peak_month": peak_month,
            "discovery": discovery,
            "top_artists": [
                {"name": a, "min": round(ms/60000, 1), "plays": yb["artist_plays"][a]}
                for a, ms in yb["artist_ms"].most_common(TOP_N_YEAR)
            ],
            "top_albums": [
                album_entry(ak, ms, yb["album_plays"][ak])
                for ak, ms in yb["album_ms"].most_common(TOP_N_YEAR)
            ],
            "top_tracks": [
                track_entry(tk, ms, yb["track_plays"][tk])
                for tk, ms in yb["track_ms"].most_common(TOP_N_YEAR)
            ],
        })

    stats = {
        "version": STATS_VERSION,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "totals": {
            "plays_valid": sum(y["plays"] for y in year_out),
            "plays_raw": total_plays,
            "min": round(total_valid_ms/60000, 1),
            "days_active": len(active_days_all),
            "longest_streak": longest_streak,
            "unique_artists": len([a for a in artist_ms if artist_ms[a] > 0]),
            "unique_albums": len(album_ms),
            "unique_tracks": len(track_ms),
            "skip_pct": round(total_skipped/max(1, total_plays)*100, 1),
        },
        "years": year_out,
        "monthly": [
            {"m": m, "min": round(ms/60000, 1)}
            for m, ms in sorted(monthly_ms.items())
        ],
        "heatmap": [[round(m/60000, 1) for m in row] for row in heatmap],
        "top_artists_all_time": [
            {"name": a, "min": round(ms/60000, 1), "plays": artist_plays[a], "first_year": artist_first_year.get(a)}
            for a, ms in artist_ms.most_common(TOP_N_ALLTIME)
        ],
        "top_albums_all_time": [
            album_entry(ak, ms, album_plays[ak])
            for ak, ms in album_ms.most_common(TOP_N_ALLTIME)
        ],
        "top_tracks_all_time": [
            track_entry(tk, ms, track_plays_count[tk])
            for tk, ms in track_ms.most_common(TOP_N_ALLTIME)
        ],
    }

    # v=126 — top de tracks POR ARTISTA sacado del historial completo.
    # La ficha de artista mostraba un solo track para artistas chicos porque solo
    # miraba top_tracks_all_time (top 60 global) y los top_tracks anuales (top 40
    # por año): "prettifun" con 89 plays no entra en ninguno de los dos.
    # Acá indexamos TODO artista con al menos una play válida (>=30s).
    artist_tracks_out = {}
    artist_totals_out = {}
    per_artist = defaultdict(list)
    for tk, meta in track_meta.items():
        per_artist[meta["artist"]].append(tk)
    for artist_name, tks in per_artist.items():
        tks.sort(key=lambda t: (-track_plays_count[t], -track_ms[t]))
        # Totales reales del artista. top_artists_all_time solo llega a 60 y los
        # tops anuales a 40, así que sin esto un artista chico salía con 0 plays.
        # La curva por año va acá por el mismo motivo: sin ella la ficha de un
        # artista fuera de los tops se quedaba sin chart y con "último año —".
        curve = [
            [y, round(yb["artist_ms"][artist_name] / 60000, 1), yb["artist_plays"][artist_name]]
            for y, yb in sorted(years.items())
            if yb["artist_ms"].get(artist_name)
        ]
        artist_totals_out[artist_name] = [
            artist_plays[artist_name],
            round(artist_ms[artist_name] / 60000, 1),
            artist_first_year.get(artist_name),
            curve[-1][0] if curve else None,
            curve,
        ]
        artist_tracks_out[artist_name] = [
            [
                track_meta[t]["name"],
                track_plays_count[t],
                round(track_ms[t] / 60000, 1),
                (track_meta[t]["uri"] or "").split(":")[-1],
            ]
            for t in tks[:ARTIST_TRACKS_TOP_N]
        ]

    artist_tracks_payload = {
        "version": ARTIST_TRACKS_VERSION,
        "generated_at": stats["generated_at"],
        "artists": artist_tracks_out,
        "totals": artist_totals_out,
    }

    # índice por uri — formato compacto: id (sin prefix) -> [plays, segundos] o [plays, seg, "p"] para partial-only
    track_plays_out = {}
    for uri, v in track_uri_stats.items():
        if v["ms"] >= KEEP_TRACK_IF_MS:
            tid = uri.split(":")[-1]
            track_plays_out[tid] = [v["p"], round(v["ms"]/1000)]
    # tracks que SOLO tuvieron plays <30s: útiles para el badge "N plays cortas" en zeroplays
    for uri, v in track_uri_partial.items():
        tid = uri.split(":")[-1]
        if tid in track_plays_out:
            continue  # el track ya tiene plays válidas (>=30s), no es partial-only
        if v["p"] == 0:
            continue
        track_plays_out[tid] = [v["p"], round(v["ms"]/1000), "p"]

    # Lista de TODO álbum con al menos 1 play válida (>=30s). Se usa en
    # #discover-artists / #new-releases para decidir si un álbum de la discografía
    # ya fue escuchado. El JS canonicaliza (name, artist) con util/album-key.js
    # (strip diacríticos, sufijos de edición), así que emitimos los nombres crudos.
    albums_played_out = [
        [m.get("name", ""), m.get("artist", "")]
        for ak, m in album_meta.items()
        if album_ms.get(ak, 0) > 0
    ]

    # Álbumes "escuchados" (mix A+C) agrupados por año del primer día
    listened_by_year = defaultdict(list)
    for ak, info in listened_first.items():
        meta = album_meta.get(ak, {})
        y = int(info["date"][:4])
        listened_by_year[y].append({
            "name": meta.get("name", ""),
            "artist": meta.get("artist", ""),
            "date": info["date"],
            "tracks_that_day": info["tracks_that_day"],
            "min_that_day": info["min_that_day"],
            "img": meta.get("img"),
        })
    listened_years = []
    for y in sorted(listened_by_year.keys()):
        arr = sorted(listened_by_year[y], key=lambda a: a["date"], reverse=True)
        listened_years.append({"year": y, "count": len(arr), "albums": arr})

    listened_payload = {
        "version": LISTENED_VERSION,
        "criteria": {"min_tracks_sameday": MIN_TRACKS_SAMEDAY, "min_min_sameday": MIN_MIN_SAMEDAY},
        "generated_at": stats["generated_at"],
        "totals": {
            "albums": sum(y["count"] for y in listened_years),
            "years": len(listened_years),
        },
        "years": listened_years,
    }

    # Skip stats: filtramos tracks con muy pocas plays (ruido) y armamos el JSON
    # compacto: {id: [ok, skip]}. Meta va aparte para poder cachearlo distinto.
    skip_out = {}
    skip_meta_out = {}
    for tid, v in track_skip_stats.items():
        total = v["ok"] + v["skip"]
        if total < SKIP_STATS_MIN_PLAYS:
            continue
        skip_out[tid] = [v["ok"], v["skip"]]
        m = track_skip_meta.get(tid)
        if m:
            skip_meta_out[tid] = m

    skip_payload = {
        "version": SKIP_STATS_VERSION,
        "generated_at": stats["generated_at"],
        "min_plays": SKIP_STATS_MIN_PLAYS,
        "skip_min_ms": SKIP_MIN_MS,
        "tracks": skip_out,
        "meta": skip_meta_out,
    }

    # ---- Ficha de canción: detalle por track (solo >=DETAIL_MIN_PLAYS plays) ----
    track_detail_out = {}
    for uri, months in track_uri_monthly.items():
        if track_uri_stats[uri]["p"] < DETAIL_MIN_PLAYS:
            continue
        tid = uri.split(":")[-1]
        daycounts = track_uri_daycount[uri]
        track_detail_out[tid] = {
            "m": dict(sorted(months.items())),
            "f": track_uri_first[uri],
            "l": track_uri_last[uri],
            "d": len(daycounts),
            "x": max(daycounts.values()),
        }
    detail_payload = {
        "version": TRACK_DETAIL_VERSION,
        "generated_at": stats["generated_at"],
        "min_plays": DETAIL_MIN_PLAYS,
        "tracks": track_detail_out,
    }

    # ---- Récords ----
    def tk_name(tk):
        m = track_meta.get(tk, {})
        return {"name": m.get("name", ""), "artist": m.get("artist", "")}

    top_days_out = []
    for day, ms in sorted(day_ms_global.items(), key=lambda kv: kv[1], reverse=True)[:20]:
        arts = day_artist_ms[day]
        ta, tams = arts.most_common(1)[0] if arts else ("", 0)
        trs = day_track_plays[day]
        entry = {
            "date": day,
            "min": round(ms / 60000, 1),
            "plays": day_plays[day],
            "top_artist": {"name": ta, "min": round(tams / 60000, 1)},
        }
        if trs:
            ttk, ttp = trs.most_common(1)[0]
            entry["top_track"] = {**tk_name(ttk), "plays": ttp}
        top_days_out.append(entry)

    # mismo tema más veces en un solo día
    track_day_records = []
    for day, ctr in day_track_plays.items():
        for tk, n in ctr.items():
            if n >= 5:
                track_day_records.append((n, day, tk))
    track_day_records.sort(reverse=True)
    top_track_days_out = [{**tk_name(tk), "date": day, "plays": n} for n, day, tk in track_day_records[:15]]

    # maratón de un solo artista en un día
    artist_day_records = []
    for day, ctr in day_artist_ms.items():
        for a, a_ms in ctr.items():
            artist_day_records.append((a_ms, day, a))
    artist_day_records.sort(reverse=True)
    top_artist_days_out = [
        {"artist": a, "date": day, "min": round(a_ms / 60000, 1)}
        for a_ms, day, a in artist_day_records[:15]
    ]

    # semana (lunes a domingo) con más plays del mismo tema
    top_track_weeks_out = [
        {**tk_name(tk), "week_start": ws, "plays": n}
        for (tk, ws), n in week_track_plays.most_common(10)
    ]

    # todas las rachas, ordenadas
    streaks = []
    if all_days_sorted:
        s_start = s_prev = date.fromisoformat(all_days_sorted[0])
        s_cur = 1
        for s in all_days_sorted[1:]:
            d = date.fromisoformat(s)
            if (d - s_prev).days == 1:
                s_cur += 1
            elif d != s_prev:
                streaks.append((s_cur, s_start.isoformat(), s_prev.isoformat()))
                s_start = d
                s_cur = 1
            s_prev = d
        streaks.append((s_cur, s_start.isoformat(), s_prev.isoformat()))
    streaks.sort(reverse=True)
    top_streaks_out = [{"days": n, "start": s, "end": e} for n, s, e in streaks[:10]]

    # tracks que sonaron en más días distintos
    track_most_days_out = [
        {**tk_name(tk), "days": len(ds)}
        for tk, ds in sorted(tk_days.items(), key=lambda kv: len(kv[1]), reverse=True)[:15]
    ]

    records_payload = {
        "version": RECORDS_VERSION,
        "generated_at": stats["generated_at"],
        "top_days": top_days_out,
        "top_track_days": top_track_days_out,
        "top_artist_days": top_artist_days_out,
        "top_track_weeks": top_track_weeks_out,
        "top_streaks": top_streaks_out,
        "track_most_days": track_most_days_out,
        "milestones": milestones,
    }

    return stats, track_plays_out, albums_played_out, listened_payload, skip_payload, detail_payload, records_payload, artist_tracks_payload


def main():
    print("Cargando streaming history…")
    plays = load_all()
    print(f"  plays únicas (con URI): {len(plays):,}")

    print("Cargando tapas viejas para reciclar…")
    img_idx = load_album_images()
    print(f"  tapas indexadas: {len(img_idx):,}")

    print("Agregando…")
    stats, track_plays, albums_played, listened, skip_stats, detail, records, artist_tracks = build_stats(plays, img_idx)

    stats_path = os.path.join(OUT_DIR, "history-stats.json")
    tp_path = os.path.join(OUT_DIR, "history-track-plays.json")
    listened_path = os.path.join(OUT_DIR, "history-listened-albums.json")
    skip_path = os.path.join(OUT_DIR, "history-skip-stats.json")
    detail_path = os.path.join(OUT_DIR, "history-track-detail.json")
    records_path = os.path.join(OUT_DIR, "history-records.json")
    at_path = os.path.join(OUT_DIR, "history-artist-tracks.json")

    with open(at_path, "w") as f:
        json.dump(artist_tracks, f, separators=(",", ":"), ensure_ascii=False)
    with open(stats_path, "w") as f:
        json.dump(stats, f, separators=(",", ":"), ensure_ascii=False)
    with open(tp_path, "w") as f:
        json.dump({
            "version": TRACK_PLAYS_VERSION,
            "generated_at": stats["generated_at"],
            "tracks": track_plays,
            "albums": albums_played,
        }, f, separators=(",", ":"), ensure_ascii=False)
    with open(listened_path, "w") as f:
        json.dump(listened, f, separators=(",", ":"), ensure_ascii=False)
    with open(skip_path, "w") as f:
        json.dump(skip_stats, f, separators=(",", ":"), ensure_ascii=False)
    with open(detail_path, "w") as f:
        json.dump(detail, f, separators=(",", ":"), ensure_ascii=False)
    with open(records_path, "w") as f:
        json.dump(records, f, separators=(",", ":"), ensure_ascii=False)

    print(f"OK → {detail_path} ({os.path.getsize(detail_path)/1024:.1f} KB, {len(detail['tracks'])} tracks)")
    print(f"OK → {records_path} ({os.path.getsize(records_path)/1024:.1f} KB)")
    print(f"OK → {stats_path} ({os.path.getsize(stats_path)/1024:.1f} KB)")
    print(f"OK → {tp_path} ({os.path.getsize(tp_path)/1024:.1f} KB, {len(track_plays)} tracks, {len(albums_played)} álbumes tocados)")
    print(f"OK → {listened_path} ({os.path.getsize(listened_path)/1024:.1f} KB)")
    print(f"OK → {skip_path} ({os.path.getsize(skip_path)/1024:.1f} KB)")
    print(f"OK → {at_path} ({os.path.getsize(at_path)/1024:.1f} KB, {len(artist_tracks['artists'])} artistas)")
    print(f"totales stats: {stats['totals']}")
    print(f"totales listened: {listened['totals']} · years: {[y['year'] for y in listened['years']]}")
    print(f"skip stats: {len(skip_stats['tracks'])} tracks con >={SKIP_STATS_MIN_PLAYS} plays")


if __name__ == "__main__":
    main()
