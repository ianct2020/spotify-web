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

  # Y AHORA LAS PÁGINAS HTML. Hasta acá el versionado solo alcanzaba a los
  # imports de adentro de `docs/js/*.js`, así que una página HTML que no fuera
  # `index.html` —la única que se bumpea a mano— quedaba fuera para siempre.
  # No era teórico: `callback.html`, la vuelta del login de Spotify, arrastró
  # `?v=25` hasta v=234, unas 200 versiones. Sus cuatro URLs quedaban
  # congeladas, y el service worker las sirve con stale-while-revalidate: la
  # nota de arriba de `sw.js` («cada deploy son URLs nuevas y nunca se sirve JS
  # viejo») valía para todo MENOS para esa página.
  #
  # Se versiona `.css` y `.js` (lo mismo que hace `index.html` a mano), tanto en
  # `href=`/`src=` como en los `import`/`from` de los <script type="module">
  # inline. Queda fuera lo externo (el `https://` del CDN lleva `:`, que el
  # patrón excluye), el favicon y el manifest. `sw.js` no se toca acá: se
  # registra desde `app.js` sin `?v=` a propósito, porque el navegador lo
  # actualiza comparando bytes.
  #
  # `index.html` entra también, y es idempotente: la V sale de su propio
  # `app.js?v=`, ya leída más arriba. El efecto es que bumpear ese número a mano
  # arrastra solo a las tres hojas, en vez de cuatro ediciones que se pueden
  # olvidar de a una.
  find docs -name '*.html' -print0 | xargs -0 sed -i -E \
    -e "s#((href|src)=([\"'])(\.{0,2}/)?[^\"'\#:?]+\.(css|js))(\?v=[0-9]+)?\3#\1?v=$V\3#g" \
    -e "s#((from|import\()[[:space:]]*([\"'])(\.{0,2}/)?[^\"'?]+\.js)(\?v=[0-9]+)?\3#\1?v=$V\3#g"

  echo "Imports versionados con ?v=$V (estáticos, dinámicos y páginas HTML)"
else
  echo "WARN: no pude detectar la versión en index.html — imports sin versionar"
fi

echo "Build OK → docs/"
