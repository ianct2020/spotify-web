#!/usr/bin/env bash
# Saca las capturas de un banco visual, pero SOLO si el banco dice que está
# listo.
#
# POR QUÉ ESTE PASO EXISTE: una captura no avisa cuando sale mal. Si el banco
# fotografía antes de tiempo, la imagen sale igual de nítida y de convincente,
# y lo que se ve —un color que no es, una fila sin su regla— parece un bug de
# la app. Pasó en v=233. Por eso acá se pregunta primero con `--dump-dom` por
# la marca `data-banco` que el banco pone cuando TODAS sus condiciones se
# cumplieron, y recién entonces se fotografía. Si el banco falló, no hay
# captura y se sale con error, con el mensaje del banco a la vista.
#
#   tests/banco/correr.sh pausa "~/Escritorio/pausa unica"
#   tests/banco/correr.sh acento "~/Escritorio/iconos unicos" "preset=ambar&css=viejo" acento-viejo-ambar
#
set -euo pipefail

BANCO="${1:?falta el nombre del banco (pausa | acento)}"
DESTINO="${2:?falta la carpeta de destino}"
QUERY="${3:-}"
NOMBRE="${4:-$BANCO}"
PUERTO="${PUERTO:-5500}"
VENTANA="${VENTANA:-880x700}"

URL="http://127.0.0.1:${PUERTO}/banco/${BANCO}.html${QUERY:+?$QUERY}"
CHROME=(google-chrome --headless=new --disable-gpu
        --host-resolver-rules="MAP * 127.0.0.1"   # que no salga NADA a la red
        --virtual-time-budget=20000)

mkdir -p "$DESTINO"

# 1. Preguntar. `data-banco` la pone el banco cuando terminó de comprobar.
DOM=$("${CHROME[@]}" --dump-dom "$URL" 2>/dev/null || true)
ESTADO=$(printf '%s' "$DOM" | grep -o 'data-banco="[a-z]*"' | head -1 | cut -d'"' -f2 || true)

if [ "$ESTADO" != "ok" ]; then
  echo "BANCO «$BANCO» NO está listo (data-banco=\"${ESTADO:-ausente}\") — no se fotografía." >&2
  printf '%s' "$DOM" | grep -o '<pre[^>]*>[^<]*</pre>' | sed 's/<[^>]*>//g' >&2 || true
  echo "URL: $URL" >&2
  exit 1
fi

# 2. Recién ahora, la foto.
"${CHROME[@]}" --window-size="${VENTANA/x/,}" \
  --screenshot="$DESTINO/$NOMBRE.png" "$URL" 2>/dev/null

echo "ok → $DESTINO/$NOMBRE.png"
