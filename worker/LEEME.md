# La copia en la nube (Worker de Cloudflare)

Un Worker de Cloudflare con un almacén KV donde la app guarda una copia de seguridad: la misma que da «Exportar todo»
(⚙ del Dashboard), comprimida con gzip en el navegador. Se sube con un botón y se baja como archivo; para cargarla, se usa
«Importar todo» con ese archivo. **No sincroniza nada ni importa nada solo.**

Esta carpeta NO va a GitHub Pages (`build.sh` copia solo `src/`). Se despliega aparte, en la cuenta de Cloudflare de quien
use la app.

## Qué guarda

- Las últimas **5** copias de cada cuenta permitida, cada una en una clave nueva `copia/<id de Spotify>/<fecha ISO>`, con
  sus metadatos `{ bytes, fecha }`. Ninguna clave se pisa nunca: lo que se baja bajo una fecha es siempre esa copia, entera.
- Los bytes tal cual llegan (gzip). El Worker no los descomprime ni los lee.
- Hasta **24 MiB** por copia comprimida (el valor de KV admite 25 MiB). Si la copia pasa, la app no la manda y dice cuánto pesa.

## Qué NO guarda

- **El token de Spotify.** Al «Conectar», la app se lo manda una vez; el Worker hace un solo `GET https://api.spotify.com/v1/me`
  para saber de quién es, compara el id con `PERMITIDOS` y contesta con un token propio firmado (30 días). El de Spotify no
  se guarda en el KV ni se escribe en ningún log.
- Nada de la sesión: la copia es la de «Exportar todo», que ya no lleva ni el token ni el `refresh_token` ni la key de
  Last.fm (y si los llevara, la app no la manda).

## Lo que pide el entorno

| nombre | qué es | dónde va |
|---|---|---|
| `COPIAS` | el almacén KV | `wrangler.jsonc` (`kv_namespaces`, con su id) |
| `FIRMA` | la clave con la que se firman los tokens propios | secreto: `npx wrangler secret put FIRMA` |
| `PERMITIDOS` | los ids de Spotify que pueden usarlo, separados por coma | secreto: `npx wrangler secret put PERMITIDOS` |
| `ORIGENES` | desde qué páginas se lo puede llamar (comparación exacta) | `wrangler.jsonc` (`vars`) |

Sin `FIRMA` o sin `PERMITIDOS`, contesta 500 `{"error":"falta-configuracion"}` en todo menos el preflight.

## Los pasos para desplegarlo

Fuentes: developers.cloudflare.com/workers/wrangler/commands/, /kv/get-started/ y /workers/configuration/secrets/, leídas el
06/11/2026. Ningún paso lo hace la app ni ningún script del repo.

1. Crear una cuenta en dash.cloudflare.com (gratis; si pide tarjeta al registrarse, no está verificado).
2. En `~/spotify-web/worker/`: `npx wrangler login` (abre el navegador para autorizar).
3. `npx wrangler kv namespace create COPIAS` y pegar el `id` que devuelve en `worker/wrangler.jsonc` (una copia de
   `wrangler.ejemplo.jsonc`; el `.gitignore` tapa `worker/wrangler.jsonc`, así el id no va al repo público).
4. `npx wrangler secret put FIRMA` (una frase larga cualquiera) y `npx wrangler secret put PERMITIDOS` (tu id de Spotify).
5. `npx wrangler deploy` (lee `wrangler.jsonc` solo, sin opciones): devuelve una dirección `https://….workers.dev`. Si
   `deploy` no encuentra la configuración, `npx wrangler deploy --help` dice qué opción pide.
6. En la app: ⚙ del Dashboard → «Nube…», pegar esa dirección, «Conectar» y «Guardar copia en la nube».

## Las rutas

| ruta | qué hace |
|---|---|
| `OPTIONS *` | preflight: 204 con CORS si el `Origin` está en `ORIGENES`; si no, 403 sin cabeceras CORS |
| `POST /sesion` | con el token de Spotify: una `GET /v1/me`; 401 → 401, fuera de la lista → 403, otra cosa → 502; si vale, `{ token, uid, vence }` |
| `PUT /copias` | con el token propio: guarda el cuerpo (gzip), 413 si pasa de 24 MiB, poda a las 5 últimas; `{ fecha, bytes, guardadas }` |
| `GET /copias` | `[{ fecha, bytes }]`, la más nueva primero |
| `GET /copias/<fecha>` | los bytes, `application/gzip`; 404 si no está |

El uid sale siempre del token propio, nunca de la URL, del cuerpo ni de una cabecera.

## Lo que no se midió

- Que el `PUT` de una copia de varios MB entre en los 10 ms de CPU del plan gratis (leer el cuerpo es espera de red, pero no se midió).
- Cuánto tarda en aparecer en la lista una copia recién guardada (KV no da garantía escrita para `list`): mientras tanto, la app dice «todavía no aparece».
- Si los logs de la plataforma guardan las cabeceras de la petición. El código no las loguea nunca; por las dudas, no agregues `observability` a `wrangler.jsonc`.

Lo prueban `tests/nube-worker.test.mjs` (en Node, con el KV y Spotify doblados) y el banco `tests/banco/nube.html` (la app
entera contra este mismo Worker, corriendo dentro del banco).
