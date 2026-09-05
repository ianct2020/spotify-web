// Loader de módulos para los tests de `util/hidden-sync.js`.
//
// `hidden-sync.js` importa `../api.js` (red), `./playlist-add.js` (cachés) y
// `../ui/toast.js` (DOM). Nada de eso existe en Node, y ninguno es lo que hay
// que probar: lo que se prueba es la reconciliación. Este loader los cambia por
// dobles que guardan su estado en `globalThis.__DOBLE`, así que el test ve las
// llamadas que se hicieron sin tocar el módulo real.
//
// Se engancha con `module.register()` desde el propio test, antes del primer
// `import()` dinámico de hidden-sync — en Node 20 los hooks corren en un worker
// aparte, así que solo pueden devolver URLs, no objetos.

const MAPA = {
  '/src/js/api.js': '/tests/dobles/api-doble.mjs',
  '/src/js/util/playlist-add.js': '/tests/dobles/playlist-add-doble.mjs',
  '/src/js/ui/toast.js': '/tests/dobles/toast-doble.mjs',
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  for (const [real, doble] of Object.entries(MAPA)) {
    if (r.url.endsWith(real)) {
      return { ...r, url: r.url.replace(real, doble), shortCircuit: true };
    }
  }
  return r;
}
