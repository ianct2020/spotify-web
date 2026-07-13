# Backups por usuario

Cada usuario puede tener su backup en este directorio como `user-<spotifyId>.json`.

Al loguearse en la app, si existe `user-<tu-spotify-id>.json`, la app lo carga automáticamente (siempre que no haya cache local reciente).

## Cómo crear tu backup

1. Entrá al Dashboard, cargá tus likes.
2. Apretá "Exportar likes" — se baja `spotify-tools-likes-YYYY-MM-DD.json`.
3. Renombralo a `user-<tu-spotify-id>.json` (ej: `user-ianct2020.json`).
4. Movelo a `src/data/` de este repo.
5. `npm run build` (copia a `docs/data/`).
6. `git add`, `git commit`, `git push`.

La próxima vez que entres, la app te lo cargará solo — o cualquier usuario que se loguee con TU cuenta.

## Formato

Ver el JSON exportado por la app. Los formatos soportados:
- `spotify-tools-data` (unificado, likes + tags)
- `spotify-tools-likes` (solo likes)
- `spotify-tools-genres` (solo tags)
