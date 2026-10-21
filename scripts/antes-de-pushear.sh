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
#      (5b es un AVISO, no un fallo: los archivos sin seguimiento que el .gitignore
#      no tapa, para que un volcado con otro nombre se vea antes de un `git add`)
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

FALLOS=0
ok()   { echo "  ✓ $1"; }
mal()  { echo "  ✗ $1"; FALLOS=$((FALLOS + 1)); }
# Un aviso se ve pero NO suma a FALLOS: un fallo bloquearía todo push mientras haya
# cualquier borrador en el árbol de trabajo.
aviso() { echo "  ! $1"; }

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
echo "2b. bancos (barra · pausa-search · toasts · mosaico · novedades · escrituras · ocultar-artista ×3 · covers-orden · calendario · import-guarda · ocultos-cache · mapa · puertas · cuota · letras · generos-cache · generos-escaneo · generos · mapa-artistas · versiones-deluxe)"
# Los dos de `ocultar-artista` entraron en v=276: las TRES vistas que ocultan
# artistas, reales, contra una Spotify simulada. Es el único sitio donde se puede
# probar ocultar sin escribir en la cuenta de Ian, y el de `-disco` es el que
# vigila que el control no rompa la barra de #discover-artists a dos filas (que a
# 1.356 px la rompía). Van separados porque juntos no se estabilizaban: ver el
# comentario de PRESUPUESTO en scripts/correr-banco.mjs.
# `ocultar-artista-novedades` entró en v=278: la quinta vista, #new-releases, y que
# comparte el almacén con #discover-artists en las dos direcciones.
# `covers-orden` entró en v=278: el orden por fecha de #covers, con los sin fecha al final.
# `calendario` entró en v=289: las puertas 3 y 4 de la vista nueva — que abrirla no haga
# ninguna lectura que no sea `GET /me`, y que la playlist de un día cueste EXACTAMENTE
# 1 + ceil(N/100) POST (2 con 30 temas, 3 con 150). Es el único sitio donde se puede probar
# el botón de playlist sin crear una playlist real en la cuenta de Ian — y no se pueden
# borrar por API.
# `import-guarda` entró en v=298: la guarda del import completo, en la app ENTERA. Con
# `/me` = owner las cuatro puertas al import completo dan la explicación (0 `input[type=file]`,
# sin «Borrarlo», y el panel de #calendario sin «Importar mi historial entero»); con un id de
# prueba, el selector de siempre; con `/me` caído, el cartel de identidad. Y al final, 0 claves
# `local_<owner>_history_*` que no sean `days` en la IndexedDB del perfil temporal.
# `ocultos-cache` entró en v=299: #discover-artists y #new-releases en la app ENTERA, contra
# una Spotify simulada con 900 + 12 ocultos y snapshot-contador. En caliente, 0 páginas de
# `/items` de las dos playlists de ocultos; en frío, las de siempre; si la otra compu cambia
# la playlist, se baja entera; 0 escrituras.
# `mapa` entró en v=304: #mapa en la app ENTERA contra un MusicBrainz simulado (nada sale a la red):
# abrir no escanea, el primer país sale con el primer artista, los 503 no se guardan, retomar no repite
# nada, salir para el escaneo, una sola pestaña escanea y «Limpiar caché» conserva lo buscado.
# `puertas` entró en v=308: #puertas en la app ENTERA con historiales inventados: abrir = 1 `/me` y nada
# más, las filas = la cuenta a mano en el orden de `universo()`, «Mostrar 100 más» con 150, el amigo con
# su v3 / con uno sin el tema de entrada / sin datos, y salir a mitad de la carga sin escribir en el DOM.
# `cuota` entró en v=310: el pie del menú enseña lo gastado de las dos cuotas de Spotify, en la app ENTERA
# contra la Spotify simulada: N búsquedas → N; un 429 de `/search` → el 429 y la pausa; una búsqueda durante la
# pausa no sube «peticiones» (sale como cortada); lo mismo con `/artists/{id}/albums`; las dos no se mezclan.
# `letras` entró en v=311: el botón «Letra» de la ficha de canción, en la app ENTERA contra la Spotify simulada y
# un lrclib SIMULADO (nada sale a lrclib.net): abrir la ficha no pide nada; tocar «Letra», 1 petición y 0 la segunda
# vez; el 404 se guarda; el 503 reintenta una vez y no guarda nada; otro artista no se muestra; el aviso de duración;
# cerrar con la respuesta en vuelo no escribe en el DOM; y el modal con 60 renglones entra a 1366×768 y a 390×844.
# (v=312 suma a `letras` la ficha del DUEÑO y la cabecera a 390 px.)
# `generos-cache` entró en v=312: las etiquetas de género en IndexedDB, por usuario y sin caducidad, en la app ENTERA
# contra la Spotify simulada y Last.fm, MusicBrainz y stats.fm SIMULADOS: abrir #genre con el blob viejo no pide nada a
# los terceros y migra también lo de hace 40 días; «Limpiar caché» lo conserva; recargar sin el blob da lo mismo; abrir
# cuesta 2 `/me` (el del arranque y el de la vista) y nada más.
# `generos-escaneo` entró en v=313: #generos en la app ENTERA contra la Spotify simulada y un Last.fm SIMULADO (nada sale a
# la red): abrir no pide nada a Last.fm y cuesta 1 `/me`; «Seguir» pide exactamente los que faltan; con 29 y 503 termina
# igual sin guardar ningún fallo; recargar a mitad no repite nada; salir para; dos pestañas no buscan a la vez; «Limpiar
# caché» conserva las etiquetas y borra el ritmo; con la IndexedDB rota lo dice y no ofrece buscar; a 390 px no desborda.
# `generos` entró en v=314: los géneros de #generos en la app ENTERA, con un historial y etiquetas INVENTADOS y un Last.fm
# SIMULADO: sin géneros, una línea y ninguna lista; abrir = 1 `/me` y 0 a Last.fm; desplegar, «Ver todos» y «Mostrar 100
# más» = 0 peticiones; el top 10 y la lista entera = la cuenta a mano (sin repartir minutos, sinónimos juntos, el
# autocorrect a otro artista afuera); las cinco filas; a 1366 y a 390 nada desborda; buscando, el género abierto sigue.
# `mapa-artistas` entró en v=315: #mapa-artistas en la app ENTERA con un grafo INVENTADO de 2.302 artistas y ~60.000 pares
# (la densidad medida en la tanda 63): abrir = 1 `/me` y 0 de lo demás; sin elegido 0 líneas por frame y con uno exactamente
# su grado (visto fallar con una copia que dibuja todas); tocar elige y el fondo suelta; arrastrar, la rueda, buscar y
# «Mostrar 50 más» = 0 peticiones y quieto 0 frames (visto fallar con una copia que repinta en bucle); el amigo sin mapa,
# una línea; a 1366 y 390 nada desborda; salir a mitad, 0 escrituras y 0 frames.
# `versiones-deluxe` entró en v=323 (tanda 70): la propuesta de «solo cambia la edición del disco» de
# #versions, en la app ENTERA contra la Spotify simulada y me gusta INVENTADOS: abrir = 0 peticiones (las de
# v=322); «Analizar» = las mismas de v=322, con la propuesta SOLO en el grupo que pasa (no en el remaster, ni
# a 3 s, ni con empate de pistas, ni con un single, ni en el oculto) y nada tildado; «Aceptar propuesta»
# tilda una pista y ningún botón acepta más de un grupo; «Borrar sobrantes» lista la que se va y el ÚNICO
# DELETE lo recibe la Spotify simulada, verificado; a 1366×591 y 390×844 nada desborda. Visto fallar contra
# v=322 en B (y en C con `XQ="&omitir=B"`).
for B in barra pausa-search toasts mosaico novedades escrituras ocultar-artista ocultar-artista-disco ocultar-artista-novedades covers-orden calendario import-guarda ocultos-cache mapa puertas cuota letras generos-cache generos-escaneo generos mapa-artistas versiones-deluxe; do
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

# 5b. El punto 5 mira lo que se va a subir; esto mira lo que TODAVÍA NO se agregó.
# Un volcado nuevo con un nombre que el .gitignore no conoce no cae en el punto 5
# hasta que alguien lo hace `git add`, y ese es justo el momento en que ya es tarde
# para mirarlo con calma. Solo avisa.
echo "5b. archivos sin seguimiento que el .gitignore NO tapa (aviso)"
SUELTOS=$(git ls-files --others --exclude-standard 2>/dev/null || true)
if [ -z "$SUELTOS" ]; then ok "ninguno"
else aviso "revisá que ninguno sea un volcado personal antes de agregarlo (el repo es PÚBLICO):"; echo "$SUELTOS" | sed 's/^/      /'; fi

echo
if [ "$FALLOS" -eq 0 ]; then echo "Todo en orden para pushear."; else echo "✗ $FALLOS comprobación(es) fallaron: NO pushear."; fi
exit $(( FALLOS > 0 ))
