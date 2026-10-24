// La marca de los ocultos que llegaron con «Importar todo» (tanda 80, v=335).
//
// Las claves que agrega el import traen su uri (`<lsKey>_uris`), así que el `sync()` de `util/hidden-sync.js` las ve
// como «estuvieron en la playlist y ya no están» y hasta v=334 decía «N ocultos habían desaparecido de la playlist. Los
// he vuelto a subir.» y anotaba `resubida`. Lo que subía estaba bien; lo que decía, no: nunca habían estado. Con esta
// marca, `aplicarPlan` (`api.js`) deja escrito qué agregó a cada almacén y `sync()` lo avisa como lo que es.
//
// 🔴 LA MARCA NUNCA DECIDE QUÉ SE SUBE. Solo cambia el texto del aviso y el `tipo` de la incidencia: si falta, está
// vacía o está corrupta, el `sync()` sube y dice exactamente lo mismo que en v=334. Lo vigila
// `tests/ocultos-desde-copia.test.mjs`, que compara las escrituras contra las de v=334.
//
// La clave: `ocultos_desde_copia_v1` con `prefKey()` (como las de ocultos). El valor: `{ "<lsKey>": [claves] }`, con
// el `lsKey` PELADO (el nombre del almacén, no la clave de `localStorage`). En el `CENSO` de `copia-completa.js` va con
// `entra: false`: es un registro de paso, y exportarla haría que un import la reviviera.
//
// PURO y SIN IMPORTS: lo importan `api.js` y `hidden-sync.js`, y un import cualquiera acá podría cerrar un ciclo
// (`api.js → hidden-sync.js → … → api.js`, ver `util/ocultos-items-clave.js`). Quien lo usa lee y escribe.

export const MARCA_DESDE_COPIA = 'ocultos_desde_copia_v1';

const esPlano = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

/**
 * El texto guardado → `{ lsKey: [claves] }`. Sin texto (`null`), `{}`. Corrupta (no es JSON, no es un objeto, o un
 * valor que no es una lista) → `null`: quien llama la trata como vacía y NO la reescribe.
 */
export function leerMarca(texto) {
  if (texto == null) return {};
  let o;
  try { o = JSON.parse(texto); } catch { return null; }
  if (!esPlano(o)) return null;
  const limpia = {};
  for (const [k, v] of Object.entries(o)) {
    if (!Array.isArray(v)) return null;
    Object.defineProperty(limpia, k, { value: v.filter((x) => typeof x === 'string'), enumerable: true, writable: true, configurable: true });
  }
  return limpia;
}

/** Las claves marcadas de un almacén (un `Set` vacío si la marca no sirve). */
export function clavesDeLaMarca(marca, lsKey) {
  return new Set(esPlano(marca) && Array.isArray(marca[lsKey]) ? marca[lsKey] : []);
}

function conAlmacen(marca, lsKey, claves) {
  const nueva = { ...marca };
  if (claves.length) nueva[lsKey] = claves; else delete nueva[lsKey];
  return nueva;
}

/** Saca `claves` de la marca de `lsKey` (las que ya subieron). `{ marca, cambio }`. */
export function sacarDeLaMarca(marca, lsKey, claves) {
  const fuera = new Set(claves);
  const antes = [...clavesDeLaMarca(marca, lsKey)];
  const quedan = antes.filter((k) => !fuera.has(k));
  if (quedan.length === antes.length) return { marca, cambio: false };
  return { marca: conAlmacen(marca, lsKey, quedan), cambio: true };
}

/**
 * Deja en la marca de `lsKey` solo las claves de `conservar` (las que siguen solo en este navegador). Las que ya están
 * en la playlist, o que ya no están ocultas, salen: una marca vieja no puede rebautizar una pérdida de verdad futura.
 */
export function dejarEnLaMarca(marca, lsKey, conservar) {
  const antes = [...clavesDeLaMarca(marca, lsKey)];
  const quedan = antes.filter((k) => conservar.has(k));
  if (quedan.length === antes.length) return { marca, cambio: false };
  return { marca: conAlmacen(marca, lsKey, quedan), cambio: true };
}

// El conjunto que la app LEERÍA de un almacén: la prefijada o, si no hay, la pelada (la regla de `prefKey()` /
// `migratePrefKey()`, la misma que usa el import). Ilegible = vacío.
function conjuntoQueSeLee(ls, lsKey, uid) {
  const texto = ls[`${lsKey}__${uid}`] ?? ls[lsKey];
  if (typeof texto !== 'string') return new Set();
  try {
    const v = JSON.parse(texto);
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}

/**
 * La marca después de un import: para cada almacén, lo que la app leería DESPUÉS menos lo que leía ANTES, unido a lo
 * que la marca ya tenía. `antes` y `despues`: el `localStorage` como `{ clave: texto }`. `marca`: la leída (`null` si
 * estaba corrupta: se reemplaza). `{ marca, cambio }`.
 */
export function marcaTrasImport({ marca, antes, despues, uid, almacenes }) {
  // Una marca corrupta se reemplaza solo si hay algo que marcar; si no, se deja como está.
  let nueva = esPlano(marca) ? marca : {};
  let cambio = false;
  for (const lsKey of almacenes) {
    const eran = conjuntoQueSeLee(antes, lsKey, uid);
    const agregadas = [...conjuntoQueSeLee(despues, lsKey, uid)].filter((k) => !eran.has(k));
    if (!agregadas.length) continue;
    const ya = [...clavesDeLaMarca(nueva, lsKey)];
    const suman = agregadas.filter((k) => !ya.includes(k));
    if (!suman.length) continue;
    nueva = conAlmacen(nueva, lsKey, [...ya, ...suman]);
    cambio = true;
  }
  return { marca: nueva, cambio };
}
