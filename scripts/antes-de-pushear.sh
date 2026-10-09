#!/usr/bin/env bash
# Lo que hay que correr ANTES de pushear un despliegue.  →  npm run prepush
#
# No es un hook instalado: no toca .git/hooks ni ninguna configuración. Si
# alguna vez se quiere como hook, alcanza con llamar a este archivo desde uno.
# Es de SOLO LECTURA: no modifica docs/ ni hace commit/add/push de nada.
#
# Corre TODAS las comprobaciones aunque alguna falle, para que se vea el cuadro
# entero de una vez, y sale con 1 si falló alguna.
#
#   1. node --check sobre todo src/ (la sintaxis, sin ejecutar nada)
#   2. npm test (todas las suites) y los bancos que se autocomprueban
#   3. docs/ está al día: un build de src/ en un directorio temporal da EXACTAMENTE
#      lo que hay en docs/ (el olvido más fácil: editar src/ y no correr build.sh)
#   4. el mismo ?v= en index.html (src y docs), en docs/callback.html y en el
#      nombre de la caché de docs/sw.js; y (4b) que NINGÚN recurso de src/ haya
#      quedado atrás del ?v= de app.js — no solo el de app.js, que es lo único
#      que se vigilaba hasta v=286
#   5. nada personal en lo que se va a subir: ni en el staging ni en los commits
#      que todavía no están en el remoto, comparado contra las reglas del
#      .gitignore (el repo es PÚBLICO; el 28/07/2026 se filtraron datos)
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

FALLOS=0
ok()   { echo "  ✓ $1"; }
mal()  { echo "  ✗ $1"; FALLOS=$((FALLOS + 1)); }

echo "1. node --check sobre src/"
MALOS=$(find src \( -name '*.js' -o -name '*.mjs' \) -print0 \
  | xargs -0 -n1 node --check 2>&1 \
  | grep -vE 'MODULE_TYPELESS|Reparsing as ES module|To eliminate this warning|trace-warnings' || true)
N=$(find src \( -name '*.js' -o -name '*.mjs' \) | wc -l)
if [ -z "$MALOS" ]; then ok "$N archivos parsean"; else mal "errores de sintaxis:"; echo "$MALOS" | sed 's/^/      /'; fi

echo "2. npm test"
if npm test --silent 2>&1 | tail -4 | sed 's/^/      /'; [ "${PIPESTATUS[0]}" -eq 0 ]; then ok "todas las suites"; else mal "hay suites que fallan (correr npm test para el detalle)"; fi

# Los bancos que se autocomprueban. `novedades` y `escrituras` entraron en v=275
# (la vista REAL contra una Spotify simulada: tests/banco/simulado.mjs).
# `mosaico` y `toasts` entraron en v=273:
# estaban en rojo desde antes del 04/10 y justamente por no estar acá nadie los
# miraba, igual que le había pasado a `barra` entre v=241 y v=261.
echo "2b. bancos (barra · pausa-search · toasts · mosaico · novedades · escrituras · ocultar-artista ×3 · covers-orden)"
# Los dos de `ocultar-artista` entraron en v=276: las TRES vistas que ocultan
# artistas, reales, contra una Spotify simulada. Es el único sitio donde se puede
# probar ocultar sin escribir en la cuenta de Ian, y el de `-disco` es el que
# vigila que el control no rompa la barra de #discover-artists a dos filas (que a
# 1.356 px la rompía). Van separados porque juntos no se estabilizaban: ver el
# comentario de PRESUPUESTO en scripts/correr-banco.mjs.
# `ocultar-artista-novedades` entró en v=278: la quinta vista, #new-releases, y que
# comparte el almacén con #discover-artists en las dos direcciones.
# `covers-orden` entró en v=278: el orden por fecha de #covers, con los sin fecha al final.
for B in barra pausa-search toasts mosaico novedades escrituras ocultar-artista ocultar-artista-disco ocultar-artista-novedades covers-orden; do
  if node scripts/correr-banco.mjs "$B" 2>&1 | sed 's/^/      /'; [ "${PIPESTATUS[0]}" -eq 0 ]; then
    ok "banco $B en verde"
  else
    mal "banco $B falló (node scripts/correr-banco.mjs $B para el detalle)"
  fi
done

echo "3. docs/ está al día con src/"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir "$TMP/docs"
cp -r src "$TMP/src" && cp build.sh "$TMP/build.sh"
if (cd "$TMP" && bash build.sh >/dev/null 2>&1); then
  if DIF=$(diff -rq "$TMP/docs" docs 2>&1) && [ -z "$DIF" ]; then ok "docs/ es idéntico a lo que da build.sh"
  else mal "docs/ NO coincide con un build de src/ — falta correr build.sh:"; echo "$DIF" | head -8 | sed 's/^/      /'; fi
else
  mal "build.sh falla sobre una copia de src/"
fi

echo "4. una sola versión en todos lados"
V_SRC=$(grep -oE 'app\.js\?v=[0-9]+' src/index.html | head -1 | grep -oE '[0-9]+$' || true)
V_DOCS=$(grep -oE 'app\.js\?v=[0-9]+' docs/index.html | head -1 | grep -oE '[0-9]+$' || true)
V_SW=$(grep -oE "^const CACHE = 'fonoteca-sw-v[0-9]+';" docs/sw.js | grep -oE '[0-9]+' | head -1 || true)
V_CB=$(grep -oE '\?v=[0-9]+' docs/callback.html | sort -u | tr -d '?v=' | tr '\n' ' ' | sed 's/ $//')
echo "      src/index.html=$V_SRC  docs/index.html=$V_DOCS  docs/sw.js=$V_SW  docs/callback.html=$V_CB"
if [ -n "$V_SRC" ] && [ "$V_SRC" = "$V_DOCS" ] && [ "$V_SRC" = "$V_SW" ] && [ "$V_SRC" = "$V_CB" ]; then ok "todas en v=$V_SRC"
else mal "las versiones no coinciden"; fi
CUANTOS=$(grep -rhoE '\.js\?v=[0-9]+' docs/js | grep -oE '[0-9]+$' | sort -u | tr '\n' ' ')
[ "$CUANTOS" = "$V_SRC " ] && ok "un solo ?v= entre los imports de docs/js" || mal "hay ?v= mezclados en docs/js: $CUANTOS"

# 4b. NINGÚN recurso de src/ puede quedarse atrás, no solo `app.js`.
#
# POR QUÉ ESTA COMPROBACIÓN EXISTE. Hasta v=286 el punto 4 miraba el `?v=` de
# `app.js` y nada más, y eso dejaba un hueco con una forma muy particular:
# `build.sh` REESCRIBE el `?v=` de todo el HTML de `docs/`, así que un recurso
# atrasado en `src/` **sale bien en producción** y el fuente es el único que
# miente. Nadie lo ve, porque lo que se mira es producción. Encontrados así:
# las tres hojas de CSS de `src/index.html` en `?v=257` —29 versiones atrás— y
# los CUATRO recursos de `src/callback.html` en `?v=25`, que son 261.
#
# Se compara contra el `app.js?v=` de `src/index.html`, que es el número que se
# bumpea a mano y la única fuente de la verdad del despliegue. Falla solo con lo
# que está DETRÁS: un número por delante no puede salir de un olvido.
#
# ⚠️ Y el corolario para bumpear: ahora un despliegue pide poner ese número en
# los OCHO `?v=` de `src/` (los 4 de `index.html` y los 4 de `callback.html`),
# no solo en `app.js`. El mensaje de error los nombra con archivo y línea para
# que no haya que buscarlos.
echo "4b. ningún ?v= de src/ se quedó atrás"
if [ -z "$V_SRC" ]; then
  mal "sin versión en src/index.html no puedo comparar los demás ?v="
else
  V_EN_SRC=$(grep -rnoE "[^\"'[:space:]]+\?v=[0-9]+" src/ || true)
  N_SRC=$(printf '%s' "$V_EN_SRC" | grep -c . || true)
  ATRAS=$(printf '%s\n' "$V_EN_SRC" \
    | awk -v v="$V_SRC" '{ if (match($0, /\?v=[0-9]+$/)) { n = substr($0, RSTART + 3) + 0; if (n < v) print } }')
  if [ -z "$ATRAS" ]; then ok "los $N_SRC recursos con ?v= de src/ están en v=$V_SRC"
  else
    mal "recursos de src/ con el ?v= ATRASADO respecto de app.js?v=$V_SRC (build.sh los tapa en docs/: producción sale bien y el fuente miente):"
    echo "$ATRAS" | sed 's/^/      /'
  fi
fi

echo "5. nada personal en lo que se va a subir"
PERSONAL=$( { git diff --cached --name-only; git diff --name-only '@{u}..HEAD' 2>/dev/null; } | sort -u | git check-ignore --no-index --stdin 2>/dev/null || true)
if [ -z "$PERSONAL" ]; then ok "ningún archivo del staging ni de los commits sin subir cae en el .gitignore"
else mal "archivos que el .gitignore marca como personales/no subir:"; echo "$PERSONAL" | sed 's/^/      /'; fi

echo
if [ "$FALLOS" -eq 0 ]; then echo "Todo en orden para pushear."; else echo "✗ $FALLOS comprobación(es) fallaron: NO pushear."; fi
exit $(( FALLOS > 0 ))
