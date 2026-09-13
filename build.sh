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
  # Y lo mismo con los import() DINÁMICOS, que hasta v=216 quedaban SIN versionar.
  # No era teórico: `features/wrapped.js` carga así la apertura del Wrapped, y sin
  # esto el navegador podía servir el módulo viejo de su caché después de un bump
  # —sin fallar y sin avisar, que es el modo peligroso—. Es la misma regla del
  # `?v=` propio por despliegue, aplicada a la otra forma de importar.
  find docs/js -name '*.js' -print0 | xargs -0 sed -i -E "s#(import\([[:space:]]*['\"])(\.\.?/[^'\"?]+\.js)(['\"])#\1\2?v=$V\3#g"
  echo "Imports versionados con ?v=$V (estáticos y dinámicos)"
else
  echo "WARN: no pude detectar la versión en index.html — imports sin versionar"
fi

echo "Build OK → docs/"
