#!/usr/bin/env python3
"""
Hornea las tapas que le FALTAN a src/data/history-listened-albums.json.

Por qué existe: el horneador original (el que generó `listening-history.json` el
2026-07-25) NO EXISTE — se buscó el 2026-08-24 y no está ni en el historial de
git. Ver PENDIENTES.md ítem 1. `gen-stats.py` no hornea nada: su
`load_album_images()` solo hace lookup contra el índice de aquel archivo, así
que todo álbum que entró con un export posterior al 25/07 sale con `img: null`.

Qué hace:
1. Junta los álbumes con `img` nulo de `history-listened-albums.json`.
2. Saca del Extended Streaming History la URI del track MÁS ESCUCHADO de cada
   uno (el único identificador de Spotify que el pipeline tiene: estas filas no
   traen albumId).
3. Le pide la tapa a `open.spotify.com/oembed`, que es público y sin auth — la
   misma vía que usa la app desde v=116 para los W-Three-only.
4. Escribe `src/data/covers-extra.json`.

Lo que NO hace, y es el punto:
- **No escribe en `listening-history.json`.** Lo abre en modo lectura y nada
  más. Ese archivo es irreemplazable y queda byte a byte idéntico.
- **No pisa ninguna tapa existente.** Todo lo ya horneado —incluida la
  corrección a mano de «Birds In The Trap Sing McKnight» (Travis Scott), que
  vive solo en el dato— entra en `BAKED` y se salta con un guarda duro.
- Es idempotente y reanudable: lo que ya está en `covers-extra.json` no se
  vuelve a pedir. Con el próximo export solo salen a la red los álbumes nuevos.

Uso:
    python3 scripts/bake-covers.py            # hornea lo que falta
    python3 scripts/bake-covers.py --dry-run  # dice qué pediría, sin red
Después hay que correr `python3 scripts/gen-stats.py` para que las tapas bajen
a los JSON derivados.

⚠️ La tapa sale de un TRACK, no del álbum: un track suelto puede devolver el
arte del single en vez del de su disco. Es la misma clase de discrepancia que el
ítem 5 de PENDIENTES (387 tapas horneadas que no coinciden con la API). Elegir
el track más escuchado la minimiza; no la elimina.
"""

import json
import glob
import os
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict

HISTORY_DIR = "/home/ian/spotify-web/my_spotify_data/Spotify Extended Streaming History"
OUT_DIR = "/home/ian/spotify-web/src/data"
LISTENED_JSON = os.path.join(OUT_DIR, "history-listened-albums.json")
BAKED_JSON = os.path.join(OUT_DIR, "listening-history.json")   # SOLO LECTURA
EXTRA_JSON = os.path.join(OUT_DIR, "covers-extra.json")

OEMBED = "https://open.spotify.com/oembed?url=spotify:track:{}"
PAUSA = 0.4          # segundos entre peticiones
REINTENTOS = 3
TIMEOUT = 20


def album_key(name, artist):
    """La misma clave que usa gen-stats.py: nombre y artista en minúsculas."""
    return f"{(name or '').lower()}||{(artist or '').lower()}"


def cargar_faltantes():
    """Los álbumes de history-listened-albums.json que no tienen tapa."""
    with open(LISTENED_JSON) as fh:
        payload = json.load(fh)
    falta = {}
    total = 0
    for year in payload.get("years", []):
        for alb in year.get("albums", []):
            total += 1
            if alb.get("img"):
                continue
            k = album_key(alb.get("name"), alb.get("artist"))
            falta.setdefault(k, (alb.get("name"), alb.get("artist")))
    return falta, total


def cargar_horneadas():
    """Las claves que YA tienen tapa horneada. Guarda duro: no se tocan."""
    baked = set()
    with open(BAKED_JSON) as fh:
        payload = json.load(fh)
    for alb in payload.get("albums", []):
        if alb.get("img"):
            baked.add(album_key(alb.get("a"), alb.get("ar")))
    return baked


def uris_representativas(claves):
    """URI del track MÁS ESCUCHADO de cada álbum, sacada del export."""
    ms_por_track = defaultdict(lambda: defaultdict(int))
    for path in sorted(glob.glob(os.path.join(HISTORY_DIR, "Streaming_History_Audio_*.json"))):
        with open(path) as fh:
            for r in json.load(fh):
                uri = r.get("spotify_track_uri")
                if not uri:
                    continue  # podcasts/audiobooks
                k = album_key(r.get("master_metadata_album_album_name"),
                              r.get("master_metadata_album_artist_name"))
                if k in claves:
                    ms_por_track[k][uri] += r.get("ms_played", 0)
    out = {}
    for k, tracks in ms_por_track.items():
        out[k] = max(tracks.items(), key=lambda kv: kv[1])[0]
    return out


def pedir_tapa(track_uri):
    tid = track_uri.split(":")[-1]
    url = OEMBED.format(tid)
    for intento in range(1, REINTENTOS + 1):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
                data = json.load(resp)
            return data.get("thumbnail_url")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None  # el track ya no existe en Spotify: no se reintenta
            if intento == REINTENTOS:
                raise
        except Exception:
            if intento == REINTENTOS:
                raise
        time.sleep(PAUSA * 4 * intento)
    return None


def main():
    dry = "--dry-run" in sys.argv

    if not os.path.isdir(HISTORY_DIR):
        print(f"ERROR: no está {HISTORY_DIR} — sin el export no hay URIs.")
        sys.exit(1)

    faltantes, total = cargar_faltantes()
    horneadas = cargar_horneadas()

    # Guarda duro: nada que ya tenga tapa horneada puede salir a la red.
    pisadas = [k for k in faltantes if k in horneadas]
    for k in pisadas:
        del faltantes[k]
    if pisadas:
        print(f"  {len(pisadas)} saltados por tener tapa horneada")

    extra = {}
    if os.path.exists(EXTRA_JSON):
        with open(EXTRA_JSON) as fh:
            extra = json.load(fh).get("covers", {})
    ya = [k for k in faltantes if k in extra]
    for k in ya:
        del faltantes[k]

    print(f"álbumes en {os.path.basename(LISTENED_JSON)}: {total:,}")
    print(f"  ya resueltos en covers-extra.json: {len(ya)}")
    print(f"  a resolver ahora: {len(faltantes)}")
    if not faltantes:
        print("nada que hacer.")
        return

    uris = uris_representativas(set(faltantes))
    sin_uri = [k for k in faltantes if k not in uris]
    print(f"  con URI de track en el export: {len(uris)} · sin URI: {len(sin_uri)}")
    for k in sin_uri:
        print(f"    SIN URI: {k}")

    if dry:
        print("\n--dry-run: no se pidió nada.")
        for k, uri in list(uris.items())[:10]:
            print(f"  {k}  ->  {uri}")
        return

    ok = fallos = vacias = 0
    for i, (k, uri) in enumerate(sorted(uris.items()), 1):
        try:
            img = pedir_tapa(uri)
        except Exception as e:
            print(f"  [{i}/{len(uris)}] FALLO {k}: {e}")
            fallos += 1
            time.sleep(PAUSA)
            continue
        if img:
            extra[k] = img
            ok += 1
        else:
            vacias += 1
            print(f"  [{i}/{len(uris)}] sin thumbnail: {k}")
        if i % 20 == 0:
            print(f"  [{i}/{len(uris)}] ok={ok} vacías={vacias} fallos={fallos}")
        time.sleep(PAUSA)

    payload = {
        "_format": "fonoteca-covers-extra",
        "_version": 1,
        "_generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "_source": "open.spotify.com/oembed (track más escuchado de cada álbum)",
        "_note": "Complemento de listening-history.json, que NO se toca. gen-stats.py mergea esto SOLO donde la clave no existía.",
        "covers": dict(sorted(extra.items())),
    }
    with open(EXTRA_JSON, "w") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)
        fh.write("\n")

    print(f"\nresueltas: {ok} · sin thumbnail: {vacias} · fallos: {fallos}")
    print(f"escrito {EXTRA_JSON} con {len(extra)} tapas")
    print("ahora: python3 scripts/gen-stats.py")


if __name__ == "__main__":
    main()
