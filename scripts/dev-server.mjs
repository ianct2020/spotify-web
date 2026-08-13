// Servidor de desarrollo para `src/`. Reemplaza a `python3 -m http.server` por
// una razón concreta: aquel manda `Last-Modified` y nada más, así que Chrome se
// guarda los módulos de `src/js/` con frescura heurística y una navegación
// normal los sirve de la caché sin revalidar. Poner `?cb=` en la URL solo busca
// el `index.html` — los imports no llevan query en dev, así que seguís probando
// el código viejo sin enterarte. Pasó dos veces, la última el 2026-08-12.
//
// Acá va todo con `Cache-Control: no-store`.
//
//   npm run dev   →   http://127.0.0.1:5500
//
// Ojo: entrar por 127.0.0.1, NO por localhost — el redirect URI registrado en
// Spotify es 127.0.0.1 y exige coincidencia exacta.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'src');
const PORT = Number(process.env.PORT) || 5500;
const HOST = process.env.HOST || '127.0.0.1';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function rutaSegura(urlPath) {
  const limpio = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const destino = join(ROOT, limpio);
  // Nada fuera de src/, ni con ../ ni con symlinks raros en la URL.
  return destino.startsWith(ROOT) ? destino : null;
}

createServer(async (req, res) => {
  const enviar = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };

  let destino = rutaSegura(req.url || '/');
  if (!destino) return enviar(403, 'Fuera de src/');

  try {
    let info = await stat(destino).catch(() => null);
    if (info?.isDirectory()) {
      destino = join(destino, 'index.html');
      info = await stat(destino).catch(() => null);
    }
    if (!info?.isFile()) return enviar(404, 'No encontrado');

    res.writeHead(200, {
      'Content-Type': TIPOS[extname(destino).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      // La clave de todo este archivo.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
    });
    createReadStream(destino).pipe(res);
  } catch (e) {
    enviar(500, String(e.message));
  }
}).listen(PORT, HOST, () => {
  console.log(`dev → http://${HOST}:${PORT}  (sin caché, sirviendo ${ROOT})`);
});
