// `util/costo-escaneo.js` importa `../idb.js`, que necesita IndexedDB y no
// existe en Node. Lo que se prueba es la CUENTA, no el almacenamiento.
const MAPA = { '/src/js/idb.js': '/tests/dobles/idb-doble.mjs' };

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.endsWith(real)) return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
  }
  return r;
}
