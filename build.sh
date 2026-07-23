#!/usr/bin/env bash
# Build: copia src/ a docs/ y versiona TODOS los imports relativos con el ?v=N actual.
# Esto evita que el navegador sirva módulos viejos cacheados cuando se bumpea la versión
# (bumpear app.js?v= no invalida los imports internos si no llevan query).
set -e

rm -rf docs/*
cp -r src/* docs/
touch docs/.nojekyll

# Sacar el número de versión desde index.html (ej: app.js?v=52 -> 52)
V=$(grep -oE 'app\.js\?v=[0-9]+' docs/index.html | head -1 | grep -oE '[0-9]+$')

if [ -n "$V" ]; then
  # Reescribe:  from './x.js'  ->  from './x.js?v=V'   (y ../, y comillas simples/dobles)
  find docs/js -name '*.js' -print0 | xargs -0 sed -i -E "s#(from[[:space:]]+['\"])(\.\.?/[^'\"?]+\.js)(['\"])#\1\2?v=$V\3#g"
  echo "Imports versionados con ?v=$V"
else
  echo "WARN: no pude detectar la versión en index.html — imports sin versionar"
fi

echo "Build OK → docs/"
