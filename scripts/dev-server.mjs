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
import { deflateSync } from 'node:zlib';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', 'src');
// Los bancos visuales viven FUERA de `src/` a propósito: `build.sh` hace
// `cp -r src/*`, así que cualquier banco dentro de `src/` se publicaría en
// `docs/` y acabaría en producción. Se montan acá, en dev y nada más.
const BANCOS = resolve(import.meta.dirname, '..', 'tests', 'banco');
const PREFIJO_BANCO = '/banco/';
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
  // `/banco/…` sale de `tests/banco/`; todo lo demás, de `src/`. Los bancos
  // importan `/js/…` y `/css/…` con ruta absoluta y siguen cayendo en `src/`,
  // que es lo que los hace probar el código REAL y no una copia.
  const base = limpio.startsWith(PREFIJO_BANCO) ? BANCOS : ROOT;
  const resto = limpio.startsWith(PREFIJO_BANCO) ? limpio.slice(PREFIJO_BANCO.length) : limpio;
  const destino = join(base, resto);
  // Nada fuera de las dos raíces, ni con ../ ni con symlinks raros en la URL.
  return destino.startsWith(base) ? destino : null;
}

// ── Tapas con la forma del CDN, para el banco de la postal (v=327) ─────────
//
// `/image/ab67616d00001e02<24 hex>` contesta un PNG de 300×300 INVENTADO (el color sale de los seis
// primeros hex del final; una franja diagonal más oscura, como las tapas `data:` del banco), CON
// `access-control-allow-origin: *`. Cualquier otro prefijo de `/image/` es un 404: así el banco
// `postal` (puerta J) puede afirmar que la postal pide la variante de 300 y ninguna otra, pidiéndola
// desde OTRO origen (`localhost` en vez de `127.0.0.1`) para que el CORS cuente de verdad. No es el
// CDN de Spotify ni lo imita en nada más que la forma de la URL. `src/` no lo usa nunca.
const TAPA_300 = /^\/image\/ab67616d00001e02([0-9a-f]{6})[0-9a-f]{18}$/;
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function trozo(tipo, datos) {
  const t = Buffer.from(tipo, 'ascii'), largo = Buffer.alloc(4), crc = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, datos])));
  return Buffer.concat([largo, t, datos, crc]);
}
function pngDeTapa(hex) {
  const L = 300, [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const filas = Buffer.alloc(L * (1 + 3 * L));
  for (let y = 0; y < L; y++) {
    filas[y * (1 + 3 * L)] = 0;
    for (let x = 0; x < L; x++) {
      const k = 0.55, oscura = Math.abs(x - y) < 40;
      const o = y * (1 + 3 * L) + 1 + 3 * x;
      filas[o] = oscura ? Math.round(r * k) : r; filas[o + 1] = oscura ? Math.round(g * k) : g; filas[o + 2] = oscura ? Math.round(b * k) : b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(L, 0); ihdr.writeUInt32BE(L, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('IDAT', deflateSync(filas)), trozo('IEND', Buffer.alloc(0))]);
}

createServer(async (req, res) => {
  const enviar = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  };

  const ruta = (req.url || '/').split('?')[0];
  if (ruta.startsWith('/image/')) {
    const m = ruta.match(TAPA_300);
    if (!m) return enviar(404, 'Solo la variante de 300');
    const png = pngDeTapa(m[1]);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(png);
  }

  let destino = rutaSegura(req.url || '/');
  if (!destino) return enviar(403, 'Fuera de src/ y de tests/banco/');

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
  console.log(`      bancos visuales en http://${HOST}:${PORT}/banco/  (${BANCOS})`);
});
