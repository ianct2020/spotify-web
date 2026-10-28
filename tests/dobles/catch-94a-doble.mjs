// Datos INVENTADOS; no hay acceso a red ni al almacenamiento del navegador.
const s = () => globalThis.__T94A;
export const MOSAICO_COLORES_KEY = 'mosaico-inventado';
export const BYTES_POR_PORTADA = 27;
export const rejilla3x3 = () => new Uint8Array(27);
export const idbGetCachedRaw = async () => s().reg;
export const idbSetCached = async () => {};
export const loadListenedAlbums = async () => {
  s().historialCalls++;
  const modo = s().modos.shift() || 'null';
  if (modo === 'throw') throw Error('doble: historial no disponible');
  return modo === 'albums' ? s().historial : null;
};
export const getBestAvailableLikes = async () => ({ items: s().likes });
export const coverId = url => /\/image\/[0-9a-f]{16}([0-9a-f]{24})$/i.exec(url)?.[1].toLowerCase() || null;
export const coverVariant = (url, px) => px === 64
  ? url.replace(/(\/image\/)ab67616d[0-9a-f]{8}([0-9a-f]{24})$/i, '$1ab67616d00004851$2') : url;
