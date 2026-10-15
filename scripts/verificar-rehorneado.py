#!/usr/bin/env python3
r"""Las comprobaciones de DESPUÉS de correr `gen-stats.py` (tanda 40, el blindaje).

POR QUÉ EXISTE: `gen-stats.py` tiene un modo de fallar que no avisa. Si no
encuentra el export no falla: imprime «OK» y sobrescribe los siete JSON de
`src/data/` con ceros (comprobado en vivo el 2026-08-06). Este script compara lo
recién horneado contra una COPIA hecha antes de hornear y sale con código ≠ 0 si
algo no cuadra. No escribe nada, en ningún lado.

    # 1) ANTES de hornear: la copia, fuera del repo
    R=~/respaldo-json-$(date +%F-%H%M%S); mkdir "$R"; cp -p src/data/history-*.json "$R"/
    # 2) hornear
    python3 scripts/gen-stats.py
    # 3) comprobar
    python3 scripts/verificar-rehorneado.py --respaldo "$R"

Qué mira, en este orden:
  a. el export está: hay archivos `Streaming_History_Audio_*.json` (y son `--archivos N`
     si se le dice cuántos tienen que ser);
  b. `totals.plays_raw`, `totals.plays_valid` y `totals.skip_pct` son los de la copia
     (o los de `--raw/--valid/--skip`, si el export es nuevo y TIENEN que cambiar);
  c. están todos los años de la copia y ninguno tiene `plays`, `min` ni `plays_raw` en cero;
  d. los otros seis JSON difieren de la copia SOLO en `generated_at` (y, en el archivo que
     se nombre con `--permitir-en ARCHIVO REGEX`, en las rutas que se le digan y en ninguna más);
  e. en `history-stats.json` solo cambiaron las rutas permitidas (`generated_at` y
     `version` siempre; las demás, con `--permitir REGEX`, una por cada una).

`--permitir-en` (tanda 56): para cuando un JSON del paso d TIENE que cambiar (un campo nuevo).
Se repite por cada ruta permitida y la regex se compara contra la ruta ESTRICTA, con las claves
entre corchetes y comillas JSON —`totals["Un Artista"][6]`—, porque un nombre de artista puede
traer puntos o corchetes y la ruta con puntos sería ambigua. Ejemplo (v=308):

    --permitir-en history-artist-tracks.json 'version' \
    --permitir-en history-artist-tracks.json 'totals\["(?:[^"\\]|\\.)*"\]\[[67]\]'

Una lista que cambia de largo da una ruta por cada posición que sobra o falta (hasta la tanda
55 daba una sola, `…(largo a → b)`): así un campo agregado al final se puede permitir por su
posición y todo lo demás de esa lista sigue exigiendo igualdad.

Si algo da rojo: restaurar la copia sobre `src/data/` y NO commitear ningún JSON.
"""
import argparse
import glob
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OTROS = [
    "history-track-plays.json", "history-listened-albums.json", "history-skip-stats.json",
    "history-track-detail.json", "history-records.json", "history-artist-tracks.json",
]

ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
ap.add_argument("--respaldo", required=True, help="carpeta con la copia de los siete JSON hecha ANTES de hornear")
ap.add_argument("--datos", default=os.path.join(RAIZ, "src", "data"), help="carpeta con lo recién horneado (defecto: src/data)")
ap.add_argument("--export", default=os.environ.get("FONOTECA_HISTORY_DIR") or os.path.join(RAIZ, "my_spotify_data", "Spotify Extended Streaming History"))
ap.add_argument("--archivos", type=int, default=None, help="cuántos Streaming_History_Audio_*.json tiene que haber")
ap.add_argument("--raw", type=int, default=None)
ap.add_argument("--valid", type=int, default=None)
ap.add_argument("--skip", type=float, default=None)
ap.add_argument("--permitir", action="append", default=[], help=r"regex de una ruta de history-stats.json que SÍ puede cambiar, p. ej. 'years\[\d+\]\.skip_pct'")
ap.add_argument("--permitir-en", nargs=2, action="append", default=[], metavar=("ARCHIVO", "REGEX"),
                help=r"""en ese JSON del paso d, una ruta ESTRICTA que SÍ puede cambiar, p. ej. 'totals\["(?:[^"\\]|\\.)*"\]\[[67]\]'""")
args = ap.parse_args()
permitidas_en = {}
for archivo, regex in args.permitir_en:
    if archivo not in OTROS:
        print(f"✗ --permitir-en: «{archivo}» no es uno de los seis JSON del paso d ({', '.join(OTROS)})")
        sys.exit(2)
    permitidas_en.setdefault(archivo, []).append(re.compile("^" + regex + "$"))

fallos = 0


def paso(ok, texto):
    global fallos
    print(("  ✓ " if ok else "  ✗ ") + texto)
    if not ok:
        fallos += 1
    return ok


def cargar(carpeta, nombre):
    with open(os.path.join(carpeta, nombre), encoding="utf-8") as f:
        return json.load(f)


def diferencias(a, b, ruta=()):
    """Las rutas (tuplas de claves e índices) donde `a` y `b` difieren: hojas, el nodo si
    cambia de forma, y en una lista que cambia de largo, cada posición que sobra o falta."""
    if type(a) is not type(b):
        return [ruta]
    if isinstance(a, dict):
        out = []
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                out.append(ruta + (k,))
            else:
                out.extend(diferencias(a[k], b[k], ruta + (k,)))
        return out
    if isinstance(a, list):
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out.extend(diferencias(x, y, ruta + (i,)))
        out.extend(ruta + (i,) for i in range(min(len(a), len(b)), max(len(a), len(b))))
        return out
    return [] if a == b else [ruta]


def con_puntos(ruta):
    """`years[3].skip_pct`: la forma de siempre, para `--permitir` y para leer."""
    out = ""
    for p in ruta:
        out += f"[{p}]" if isinstance(p, int) else (f".{p}" if out else str(p))
    return out or "(raíz)"


def estricta(ruta):
    """`totals["Un Artista"][6]`: sin ambigüedad aunque la clave traiga puntos o corchetes. La
    primera clave va suelta (son las del archivo: `version`, `totals`…, que no traen nada raro)."""
    return "".join(f"[{p}]" if isinstance(p, int) else (f"[{json.dumps(p, ensure_ascii=False)}]" if i else str(p))
                   for i, p in enumerate(ruta))


print("a. el export")
n = len(glob.glob(os.path.join(args.export, "Streaming_History_Audio_*.json")))
paso(n > 0, f"hay {n} archivos Streaming_History_Audio_*.json en «{args.export}»")
if args.archivos is not None:
    paso(n == args.archivos, f"son {args.archivos} (hay {n})")

print("b. los totales")
try:
    viejo = cargar(args.respaldo, "history-stats.json")
    nuevo = cargar(args.datos, "history-stats.json")
except Exception as e:  # noqa: BLE001 — cualquier fallo de lectura es un rojo, con su mensaje
    paso(False, f"no pude leer history-stats.json: {e}")
    print(f"\n✗ {fallos} comprobaciones en rojo. Restaurá la copia y NO commitees ningún JSON.")
    sys.exit(1)
tv, tn = viejo["totals"], nuevo["totals"]
for campo, forzado in (("plays_raw", args.raw), ("plays_valid", args.valid), ("skip_pct", args.skip)):
    esperado = tv.get(campo) if forzado is None else forzado
    paso(tn.get(campo) == esperado, f"totals.{campo} = {tn.get(campo)} (esperado {esperado})")
paso(bool(tn.get("plays_raw")) and bool(tn.get("plays_valid")), "ninguno de los dos conteos del total es cero")

print("c. los años")
anios_v = [y["year"] for y in viejo["years"]]
anios_n = {y["year"]: y for y in nuevo["years"]}
paso(all(a in anios_n for a in anios_v), f"están los {len(anios_v)} años de la copia ({anios_v[0]}–{anios_v[-1]}); hay {sorted(anios_n)}")
for a in anios_v:
    y = anios_n.get(a)
    if not y:
        continue
    ceros = [c for c in ("plays", "min", "plays_raw") if c in y and not y[c]]
    paso(not ceros, f"{a}: plays={y.get('plays')} · min={y.get('min')} · plays_raw={y.get('plays_raw', '—')}" + (f" → EN CERO: {ceros}" if ceros else ""))

print("d. los otros seis JSON, sin `generated_at`")
for nombre in OTROS:
    try:
        a, b = cargar(args.respaldo, nombre), cargar(args.datos, nombre)
    except Exception as e:  # noqa: BLE001
        paso(False, f"{nombre}: no pude leerlo: {e}")
        continue
    a.pop("generated_at", None)
    b.pop("generated_at", None)
    d = diferencias(a, b)
    reglas = permitidas_en.get(nombre)
    if not reglas:
        paso(not d, f"{nombre}: " + ("idéntico" if not d else f"{len(d)} diferencias, p. ej. {[con_puntos(r) for r in d[:4]]}"))
        continue
    # La forma de la regla: el patrón va contra la ruta estricta (`totals["X"][6]`), que es
    # la que no se puede confundir con otra; y la raíz tiene que seguir siendo un objeto.
    fuera = [r for r in d if not r or not any(p.match(estricta(r)) for p in reglas)]
    paso(not fuera, f"{nombre}: {len(d)} rutas distintas, {len(d) - len(fuera)} permitidas por --permitir-en"
         + ("" if not fuera else f", {len(fuera)} NO permitidas, p. ej. {[estricta(r) for r in fuera[:6]]}"))

print("e. history-stats.json: qué cambió")
permitidas = [re.compile(r"^generated_at$"), re.compile(r"^version$")] + [re.compile("^" + r + "$") for r in args.permitir]
d = [con_puntos(r) for r in diferencias(viejo, nuevo)]
fuera = [r for r in d if not any(p.match(r) for p in permitidas)]
dentro = len(d) - len(fuera)
paso(not fuera, f"{len(d)} rutas distintas, {dentro} permitidas" + ("" if not fuera else f", {len(fuera)} NO permitidas, p. ej. {fuera[:6]}"))

if fallos:
    print(f"\n✗ {fallos} comprobaciones en rojo. Restaurá la copia sobre src/data/ y NO commitees ningún JSON.")
    sys.exit(1)
print("\n✓ el rehorneado cuadra con la copia.")
