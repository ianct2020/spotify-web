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
#      nombre de la caché de docs/sw.js
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
echo "2b. bancos (barra · pausa-search · toasts · mosaico · novedades · escrituras)"
for B in barra pausa-search toasts mosaico novedades escrituras; do
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

echo "5. nada personal en lo que se va a subir"
PERSONAL=$( { git diff --cached --name-only; git diff --name-only '@{u}..HEAD' 2>/dev/null; } | sort -u | git check-ignore --no-index --stdin 2>/dev/null || true)
if [ -z "$PERSONAL" ]; then ok "ningún archivo del staging ni de los commits sin subir cae en el .gitignore"
else mal "archivos que el .gitignore marca como personales/no subir:"; echo "$PERSONAL" | sed 's/^/      /'; fi

echo
if [ "$FALLOS" -eq 0 ]; then echo "Todo en orden para pushear."; else echo "✗ $FALLOS comprobación(es) fallaron: NO pushear."; fi
exit $(( FALLOS > 0 ))
