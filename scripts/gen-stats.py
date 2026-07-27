#!/usr/bin/env python3
"""
Genera JSONs agregados a partir del Extended Streaming History de Spotify.

Salidas:
- src/data/history-stats.json    Wrapped + Dashboard: totales, por año, heatmap, timeline mensual, all-time tops
- src/data/history-track-plays.json  Índice track_uri -> {p:plays, ms:ms_totales} para cruces con likes

Filtros:
- Se descartan plays con ms_played < 30000 para todos los agregados MENOS skip% (que usa total)
- Se descartan podcasts/audiobooks (no spotify_track_uri)
- Dedupe por (ts, uri, ms_played) — los archivos _N son partes descargadas en distintos períodos y se superponen
"""

import json
import glob
import os
from collections import defaultdict, Counter
from datetime import datetime, date, timedelta

HISTORY_DIR = "/home/ian/Descargas/my_spotify_data/Spotify Extended Streaming History"
OUT_DIR = "/home/ian/spotify-web/src/data"
OLD_IMG_JSON = "/home/ian/spotify-web/src/data/listening-history.json"

MIN_MS = 30000  # trigger warning: ignoramos plays de menos de 30s
STATS_VERSION = 2            # bump: excluye "Sonido Para Sacar Agua Del Movil"
TRACK_PLAYS_VERSION = 2      # incluye entries "partial" para tracks solo con plays <30s
LISTENED_VERSION = 2         # bump: excluye "Sonido Para Sacar Agua Del Movil"
TOP_N_YEAR = 40       # top X por año
TOP_N_ALLTIME = 60    # top X global
KEEP_TRACK_IF_MS = 60000  # solo indexamos tracks con >=60s totales (reduce peso del JSON)

# Tracks a excluir de todos los agregados (funcionales de despertador/notificación
# que aparecen inflados por reproducciones automáticas y no representan música escuchada).
# Match case-insensitive por subcadena en el nombre del track.
EXCLUDED_TRACK_SUBSTRINGS = [
    "sonido para sacar agua del movil",  # despertador iOS, sale en todos los tops
]

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

        # Filtrar tracks excluidos (funcionales que inflan tops sin ser música)
        track_lc = track.lower()
        if any(sub in track_lc for sub in EXCLUDED_TRACK_SUBSTRINGS):
            continue

        # skip% cuenta contra el total de plays
        is_skip = skipped or (end_reason == "fwdbtn" and ms < MIN_MS)
        if is_skip:
            total_skipped += 1

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

    return stats, track_plays_out, listened_payload


def main():
    print("Cargando streaming history…")
    plays = load_all()
    print(f"  plays únicas (con URI): {len(plays):,}")

    print("Cargando tapas viejas para reciclar…")
    img_idx = load_album_images()
    print(f"  tapas indexadas: {len(img_idx):,}")

    print("Agregando…")
    stats, track_plays, listened = build_stats(plays, img_idx)

    stats_path = os.path.join(OUT_DIR, "history-stats.json")
    tp_path = os.path.join(OUT_DIR, "history-track-plays.json")
    listened_path = os.path.join(OUT_DIR, "history-listened-albums.json")

    with open(stats_path, "w") as f:
        json.dump(stats, f, separators=(",", ":"), ensure_ascii=False)
    with open(tp_path, "w") as f:
        json.dump({
            "version": TRACK_PLAYS_VERSION,
            "generated_at": stats["generated_at"],
            "tracks": track_plays,
        }, f, separators=(",", ":"), ensure_ascii=False)
    with open(listened_path, "w") as f:
        json.dump(listened, f, separators=(",", ":"), ensure_ascii=False)

    print(f"OK → {stats_path} ({os.path.getsize(stats_path)/1024:.1f} KB)")
    print(f"OK → {tp_path} ({os.path.getsize(tp_path)/1024:.1f} KB)")
    print(f"OK → {listened_path} ({os.path.getsize(listened_path)/1024:.1f} KB)")
    print(f"totales stats: {stats['totals']}")
    print(f"totales listened: {listened['totals']} · years: {[y['year'] for y in listened['years']]}")


if __name__ == "__main__":
    main()
