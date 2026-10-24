// El aviso entre pestañas de «Importar todo» (tanda 80, v=335).
//
// Los almacenes de ocultos (y `discover_escuchados`) leen su conjunto UNA vez por carga y lo guardan ENTERO cuando
// cambia. Si otra pestaña de la app ya tenía uno cargado y se toca después de un import sin recargar, guarda su
// conjunto VIEJO más lo nuevo, y lo que trajo la copia a ese almacén se pierde. La pestaña que importa se recarga sola;
// las otras reciben este mensaje y pintan un aviso (`ui/aviso-copia.js`). 🔴 No se las recarga: pueden estar a mitad de
// un borrado verificado o de una escritura en Spotify.
//
// UN `BroadcastChannel` por pestaña (perezoso), para mandar y para escuchar: un canal no recibe lo que él mismo manda,
// y además el mensaje lleva el id de la pestaña que lo mandó (`origen`) y quien escucha ignora el suyo. Si el navegador
// no tiene `BroadcastChannel`, no se hace nada (Chrome lo tiene desde la 54).
//
// SIN IMPORTS: lo usan `api.js` (manda) y `ui/aviso-copia.js` (escucha).

export const CANAL_COPIA = 'fonoteca-copia';

let canal;
const pestana = Math.random().toString(36).slice(2) + Date.now().toString(36);

function abrirCanal() {
  if (typeof BroadcastChannel !== 'function') return null;
  try { return new BroadcastChannel(CANAL_COPIA); } catch { return null; }
}

function elCanal() {
  if (canal === undefined) canal = abrirCanal();
  return canal;
}

/** Le dice a las OTRAS pestañas de la app que se cargó una copia. Devuelve si se pudo mandar. */
export function avisarCopiaImportada(fecha = new Date().toISOString()) {
  const c = elCanal();
  if (!c) return false;
  try { c.postMessage({ tipo: 'importada', fecha, origen: pestana }); return true; } catch { return false; }
}

/** `alRecibir({ tipo, fecha })` cuando OTRA pestaña cargó una copia. Devuelve si se pudo escuchar. */
export function escucharCopiaImportada(alRecibir) {
  const c = elCanal();
  if (!c) return false;
  c.addEventListener('message', (e) => {
    const m = e?.data;
    if (m && m.tipo === 'importada' && m.origen !== pestana) alRecibir(m);
  });
  return true;
}
