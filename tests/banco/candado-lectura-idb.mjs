// Envoltorio de `/js/idb.js` para `candado-lectura-caso.html` (tanda 109). Re-exporta el real y
// hace TIRAR toda lectura de una clave `local_<uid>_history_*` (el historial importado, BYOH): es
// el fallo de lectura que la tanda 109 le enseña al candado. Las escrituras y las demás lecturas
// van al real.
import { idbGetCached as leerCached, idbGetCachedRaw as leerRaw } from '/js/idb.js';
export * from '/js/idb.js';

const tira = (key) => /^local_.+_history_/.test(String(key));
const error = (key) => new Error('banco t109: IndexedDB inventada caída al leer ' + key);
export async function idbGetCached(key, ...r) { if (tira(key)) throw error(key); return leerCached(key, ...r); }
export async function idbGetCachedRaw(key, ...r) { if (tira(key)) throw error(key); return leerRaw(key, ...r); }
