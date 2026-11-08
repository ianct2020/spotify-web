// Los datos de mentira de la copia en la nube (tanda 123): el KV doblado, los ids y la dirección del Worker de prueba.
// Lo usan el banco `nube.html` (con `nube-caso.html`) y `tests/nube-worker.test.mjs`, en Node: por eso no toca el DOM.
//
// 🔴 Todo INVENTADO: el repo es público. Ningún id de Spotify de verdad, ningún id de Cloudflare, ninguna dirección
// `*.workers.dev` real: la de abajo es de un dominio de ejemplo y no existe.

export const DIRECCION = 'https://fonoteca-prueba.ejemplo.workers.dev';
export const HOST = 'fonoteca-prueba.ejemplo.workers.dev';
export const UID_A = 'usuario-a';
export const UID_B = 'usuario-b';
export const UID_FUERA = 'usuario-fuera-de-la-lista';
export const FIRMA = 'firma-inventada-del-banco-0123456789abcdef';
export const OTRA_FIRMA = 'otra-firma-inventada-que-no-es-la-del-worker';
// Los orígenes: el del banco se agrega en tiempo de ejecución (puerto libre).
export const ORIGENES_FIJOS = 'https://ejemplo.github.io,http://127.0.0.1:5500';

/**
 * Un KV de Cloudflare de mentira, en memoria, con la forma de la API (`put`, `get`, `getWithMetadata`, `list`,
 * `delete`). Guarda COPIAS de los bytes (como el de verdad: lo guardado no cambia si el que escribió toca su buffer).
 *
 *   listaAtrasada: N (un número): la última escritura NO aparece en los N primeros `list()` que la incluirían, y sí en
 *                  los siguientes. Es la consistencia eventual de KV («up to 60 seconds or more» fuera del lugar donde
 *                  se escribió; la página no da garantía para `list`). Con 1, la poda del propio `PUT` no la ve (el test
 *                  del Worker); con 2, tampoco el primer «Ver copias guardadas» (la puerta H del banco).
 *
 * `ops` anota cada operación (`put`, `get`, `list`, `delete`) con su clave o prefijo, para contar.
 */
export function crearKV({ listaAtrasada = 0 } = {}) {
  const datos = new Map();   // clave → { bytes: Uint8Array, metadata }
  const ops = [];
  let escondida = null;      // { clave, quedan }: la clave que los próximos `list()` no ven
  const aBytes = async (v) => {
    if (v instanceof ArrayBuffer) return new Uint8Array(v.slice(0));
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
    if (typeof v === 'string') return new TextEncoder().encode(v);
    if (v && typeof v.getReader === 'function') return new Uint8Array(await new Response(v).arrayBuffer());
    throw new TypeError('KV doblado: valor de un tipo que no sé guardar');
  };
  const leer = (bytes, tipo) => {
    const t = typeof tipo === 'object' && tipo ? tipo.type : tipo;
    if (t === 'arrayBuffer') return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (t === 'json') return JSON.parse(new TextDecoder().decode(bytes));
    if (t === 'stream') return new Response(bytes).body;
    return new TextDecoder().decode(bytes);
  };
  return {
    ops,
    datos,
    async put(clave, valor, opciones = {}) {
      ops.push(['put', clave]);
      if (typeof clave !== 'string' || !clave || new TextEncoder().encode(clave).length > 512) throw new Error('KV doblado: clave inválida');
      datos.set(clave, { bytes: await aBytes(valor), metadata: opciones.metadata ?? null });
      if (listaAtrasada > 0) escondida = { clave, quedan: listaAtrasada };
    },
    async get(clave, tipo) {
      ops.push(['get', clave]);
      const d = datos.get(clave);
      return d ? leer(d.bytes, tipo) : null;
    },
    async getWithMetadata(clave, tipo) {
      ops.push(['get', clave]);
      const d = datos.get(clave);
      return d ? { value: leer(d.bytes, tipo), metadata: d.metadata } : { value: null, metadata: null };
    },
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      ops.push(['list', prefix]);
      const todas = [...datos.keys()].filter((k) => k.startsWith(prefix)).sort();
      const oculta = escondida && todas.includes(escondida.clave) ? escondida.clave : null;
      const vistas = todas.filter((k) => k !== oculta);
      if (oculta && --escondida.quedan <= 0) escondida = null;   // la ve el siguiente
      const desde = cursor ? Number(cursor) : 0;
      const pagina = vistas.slice(desde, desde + limit);
      const completa = desde + limit >= vistas.length;
      return { keys: pagina.map((name) => ({ name, metadata: datos.get(name).metadata })), list_complete: completa, ...(completa ? {} : { cursor: String(desde + limit) }) };
    },
    async delete(clave) {
      ops.push(['delete', clave]);
      datos.delete(clave);
    },
  };
}

/**
 * Pasa una petición del navegador (ya sacada en limpio: `{ url, method, headers: [[k, v]], body: ArrayBuffer|null }`)
 * al `fetch` REAL del Worker y devuelve la respuesta en limpio (`{ status, headers: [[k, v]], body: ArrayBuffer }`).
 * Va «en limpio» porque el que pregunta vive en OTRA ventana (el iframe del caso): un `Request` o un `Response` de un
 * reino no se usa bien en otro.
 */
//
// ⚠️ No es un `new Request(…)`: en el navegador, `Request` DESCARTA la cabecera `Origin` (es de las prohibidas) y el
// Worker no vería el origen, que es justo lo que decide el CORS. Un `Headers` suelto sí la acepta, así que se le pasa un
// objeto con lo que el Worker usa de la petición: `method`, `url`, `headers` y `arrayBuffer()`.
export async function atender(worker, env, { url, method, headers, body }) {
  const bytes = body && method !== 'GET' && method !== 'HEAD' ? body : null;
  const req = { method, url, headers: new Headers(headers), arrayBuffer: async () => (bytes ? bytes.slice(0) : new ArrayBuffer(0)) };
  const res = await worker.fetch(req, env);
  return { status: res.status, headers: [...res.headers], body: await res.arrayBuffer() };
}
