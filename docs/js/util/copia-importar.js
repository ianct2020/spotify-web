// «Importar todo» (v=334, tanda 79): volver a cargar en el navegador una copia de «Exportar todo» (v=333).
//
// PURO: sin red, sin DOM, sin IndexedDB y sin `localStorage`, y SIN UNA SOLA ESCRITURA. Quien lo enchufa
// (`importarCopiaCompleta()` / `aplicarPlan()` en `api.js`) le pasa el archivo ya parseado y el estado actual YA
// LEÍDO (`{ clave: valor }`, como `elegir()` de `copia-completa.js`); esto decide y devuelve un PLAN: qué claves
// escribir y con qué valor. Escribir es del enchufe. Así se prueba en Node (`tests/copia-importar.test.mjs`).
//
// 🔴 EL INVARIANTE, que es lo que se prueba: toda clave que existía antes del import sigue existiendo después, con un
// valor que contiene todo lo que tenía. El plan solo AGREGA claves que faltan y UNE conjuntos, mapas, registros y
// discografías; nunca borra una clave, y una clave que ya está y no se une se queda como está (`la tuya gana`).
//
// 🔴 EL CENSO DECIDE OTRA VEZ, AL IMPORTAR. Que una clave venga en el archivo no la habilita: pasa por `entradaDe()`
// del MISMO `CENSO` (importado). Si no está en el censo, si su fila dice que no entra, si es un secreto (clase 5) o
// si es de otro usuario, no va al plan y queda nombrada en el resumen. Un archivo editado a mano no puede meter un
// token ni una clave inventada. Y una segunda red en el enchufe (`segundaRed`), por si esto se equivocara.
//
// Cada `fusion` del censo (qué hace con una clave que ya está) está explicada en `copia-completa.js`, arriba del
// `CENSO`, y la tabla entera con la forma de cada valor en `CLAUDE.md`, «Importar todo (v=334)».

import { CENSO, CLASES, COPIA_VERSION, ULTIMO_USUARIO, entradaDe, esDelUsuario, uidDelValor } from './copia-completa.js?v=340';
import { fusionarBases, esBaseValida } from './disco-base.js?v=340';
import { CLAVE_MIGRADO } from './generos-artista.js?v=340';
import { BORRADOS_LOG_MAX, INCIDENCIAS_OCULTOS_MAX, SUPERVIVIENTES_PERDIDAS_MAX, ENSAYOS_VERSIONS_MAX } from './topes-registros.js?v=340';

// El tope de cada registro, el de su dueño (importado, no copiado). Los dos de `#versions` entraron en v=337 (tanda 81):
// hasta entonces eran un `20` literal en `features/versions.js` y el import los unía sin tope. Los cuatro ordenan por
// `fecha` (la `fechaCampo` de su fila del CENSO).
const TOPES = {
  likes_borrados_log_v1: BORRADOS_LOG_MAX,
  ocultos_incidencias_v1: INCIDENCIAS_OCULTOS_MAX,
  versions_supervivientes_perdidas_v1: SUPERVIVIENTES_PERDIDAS_MAX,
  versions_dry_run_log_v1: ENSAYOS_VERSIONS_MAX,
};
const BLOB_ETIQUETAS = 'lastfm_artist_tags_cache';
const PREFIJO_HISTORIAL = 'local_';
const DIAS = 'days';   // `localKey(uid, 'days')` (history-data.js): lo único que guarda «solo el detalle»

// En castellano de España: lo lee el usuario en el modal.
export const TEXTOS = {
  roto: 'El archivo no es una copia de «Exportar todo»: le faltan las partes «navegador» y «_censo».',
  formato: 'Este archivo no es una copia de Fonoteca.',
  v2: 'Este archivo es de “Exportar JSON”: cárgalo con “Importar JSON”.',
  version: (v) => `Esta copia es de un formato que esta versión no sabe leer (versión ${String(v)}).`,
  otroUsuario: 'Esta copia es de otro usuario de Spotify. Solo se puede cargar en la misma cuenta con la que se hizo.',
  identidad: 'No hemos podido confirmar tu identidad con Spotify, así que no se carga nada. Vuelve a intentarlo cuando Spotify responda.',
  lectura: 'No se ha podido leer todo lo que ya tienes en este navegador, así que no se carga nada: sin saber qué hay, podría escribir encima.',
};

const esPlano = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
function leerJSON(t) {
  if (typeof t !== 'string') return { ok: false };
  try { return { ok: true, v: JSON.parse(t) }; } catch { return { ok: false }; }
}
// Asignar sin pasar por el setter de `__proto__`: el archivo puede traer esa clave.
function poner(obj, k, v) { Object.defineProperty(obj, k, { value: v, enumerable: true, writable: true, configurable: true }); }

/** El texto del archivo, parseado. Tira si no es JSON. */
export function leerCopia(texto) {
  return JSON.parse(texto);
}

// ── Los binarios, de vuelta a su tipo ─────────────────────────────────────────────────────────────
// `serializar()` (copia-completa.js) escribe `{ "__tipo": "Uint8Array", "base64": … }` (y Map / Set con `entradas`).
const TIPADOS = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView };
if (typeof BigInt64Array !== 'undefined') Object.assign(TIPADOS, { BigInt64Array, BigUint64Array });
function deBase64(b64) {
  const s = atob(b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
export function revivir(v) {
  if (Array.isArray(v)) return v.map(revivir);
  if (!v || typeof v !== 'object') return v;
  if (typeof v.__tipo === 'string' && Object.keys(v).length === 2) {
    if (typeof v.base64 === 'string') {
      if (v.__tipo === 'ArrayBuffer') return deBase64(v.base64).buffer;
      const T = TIPADOS[v.__tipo];
      if (T) {
        const b = deBase64(v.base64);
        if (T === DataView) return new DataView(b.buffer);
        if (b.byteLength % T.BYTES_PER_ELEMENT === 0) return new T(b.buffer);
      }
    }
    if (v.__tipo === 'Map' && Array.isArray(v.entradas)) return new Map(v.entradas.map((e) => (Array.isArray(e) ? [revivir(e[0]), revivir(e[1])] : [e, undefined])));
    if (v.__tipo === 'Set' && Array.isArray(v.entradas)) return new Set(v.entradas.map(revivir));
  }
  const out = {};
  for (const [k, x] of Object.entries(v)) poner(out, k, revivir(x));
  return out;
}

// ── Las cuatro uniones. Cada una devuelve { escribir: valor } si hay qué unir, { igual: true } si no, o
// { formaTuya } / { formaArchivo } con el porqué si un lado no tiene la forma de su regla (y entonces no se escribe).
const esElemento = (x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x));
const idDe = (x) => `${typeof x}:${x}`;

function unirConjunto(tuyo, delArchivo) {
  const t = leerJSON(tuyo), a = leerJSON(delArchivo);
  if (!t.ok || !Array.isArray(t.v) || !t.v.every(esElemento)) return { formaTuya: 'tu valor no es una lista de cadenas' };
  if (!a.ok || !Array.isArray(a.v) || !a.v.every(esElemento)) return { formaArchivo: 'el valor del archivo no es una lista de cadenas' };
  const vistos = new Set(t.v.map(idDe));
  const nuevos = a.v.filter((x) => !vistos.has(idDe(x)) && vistos.add(idDe(x)));
  return nuevos.length ? { escribir: JSON.stringify([...t.v, ...nuevos]), nuevos: nuevos.length } : { igual: true };
}

function unirMapa(tuyo, delArchivo) {
  const t = leerJSON(tuyo), a = leerJSON(delArchivo);
  const forma = (r) => r.ok && esPlano(r.v) && Object.values(r.v).every((x) => typeof x === 'string');
  if (!forma(t)) return { formaTuya: 'tu valor no es un mapa de clave → texto' };
  if (!forma(a)) return { formaArchivo: 'el valor del archivo no es un mapa de clave → texto' };
  const out = { ...t.v };
  let nuevos = 0;
  for (const [k, v] of Object.entries(a.v)) {
    if (Object.prototype.hasOwnProperty.call(t.v, k)) continue;   // está en los dos: gana la tuya
    poner(out, k, v);
    nuevos++;
  }
  return nuevos ? { escribir: JSON.stringify(out), nuevos } : { igual: true };
}

function unirRegistro(tuyo, delArchivo, campo, tope) {
  const t = leerJSON(tuyo), a = leerJSON(delArchivo);
  if (!t.ok || !Array.isArray(t.v)) return { formaTuya: 'tu valor no es una lista' };
  if (!a.ok || !Array.isArray(a.v)) return { formaArchivo: 'el valor del archivo no es una lista' };
  const firma = (e) => JSON.stringify(e);
  const vistos = new Set(t.v.map(firma));
  const nuevos = a.v.filter((e) => !vistos.has(firma(e)) && vistos.add(firma(e)));
  if (!nuevos.length) return { igual: true };
  const fecha = (e) => (esPlano(e) && typeof e[campo] === 'string' ? e[campo] : null);
  // Sin una fecha en cada entrada no hay cómo ordenar: gana la tuya.
  if (![...t.v, ...nuevos].every(fecha)) return { formaTuya: `hay entradas sin «${campo}»: no se puede ordenar` };
  const deArchivo = new Set(nuevos);
  let union = [...t.v, ...nuevos].sort((x, y) => (fecha(x) < fecha(y) ? 1 : fecha(x) > fecha(y) ? -1 : 0));   // estable: a igual fecha, lo tuyo primero
  if (tope) union = union.slice(0, tope);
  const quedan = union.filter((e) => deArchivo.has(e)).length;
  return quedan ? { escribir: JSON.stringify(union), nuevos: quedan } : { igual: true };
}

function unirDiscografia(tuyo, delArchivo, t) {
  if (!esPlano(tuyo) || !esBaseValida(tuyo.value)) return { formaTuya: 'tu valor no tiene forma de base de discografías' };
  if (!esPlano(delArchivo) || !esBaseValida(delArchivo.value)) return { formaArchivo: 'el valor del archivo no tiene forma de base de discografías' };
  const mia = tuyo.value, suya = delArchivo.value;
  const ids = new Set(mia.items.map((x) => x.id));
  const nuevos = new Set(suya.items.map((x) => x.id).filter((id) => !ids.has(id))).size;
  if (!nuevos) return { igual: true };
  // ⚠️ AL REVÉS de lo que dice el comentario de `fusionarBases` («a = este navegador, b = la importada»): para un
  // mismo id, `unirItems` deja que los campos no vacíos de `b` pisen los de `a`. Con lo tuyo de `b`, ningún campo no
  // vacío tuyo cambia. La última entrada del historial (la de la importación) se arma con los números del archivo,
  // que en este orden saldrían al revés.
  const unida = fusionarBases(revivir(suya), mia, t);
  unida.historial[unida.historial.length - 1] = { t, via: 'importacion', n: suya.items.length, nuevos };
  return { escribir: { ...tuyo, value: unida }, nuevos };
}

function unir(c, tuyo, delArchivo, ahora) {
  switch (c.fusion) {
    case 'conjunto': return unirConjunto(tuyo, delArchivo);
    case 'mapa': return unirMapa(tuyo, delArchivo);
    case 'registro': return unirRegistro(tuyo, delArchivo, c.fechaCampo, TOPES[c.clave]);
    case 'discografia': return unirDiscografia(tuyo, delArchivo, ahora.getTime());
    default: return { igual: true };   // 'la tuya gana'
  }
}

// ── El resumen ──────────────────────────────────────────────────────────────────────────────────
const nombreClase = (c) => (c ? (CLASES[c.clase] || String(c.clase)) : 'sin censar');
function nuevoResumen() {
  const porClase = {};
  const claves = { agregan: [], unen: [], tuya: [], noEntran: [] };
  const anotar = (tipo, c, donde, clave, motivo) => {
    const n = nombreClase(c);
    porClase[n] ??= { agregan: 0, unen: 0, tuya: 0, noEntran: 0 };
    porClase[n][tipo]++;
    claves[tipo].push(motivo ? { donde, clave, motivo } : { donde, clave });
  };
  return { porClase, claves, anotar };
}

/**
 * El plan. `copia`: el archivo ya parseado. `idb` y `ls`: el estado actual YA LEÍDO (`{ clave: valor }`, los valores
 * de IndexedDB crudos, con su envoltorio; los de `localStorage`, texto). `uid`: el del memo de `getCurrentUserId()`.
 * `motivoOwner`: lo que devolvió `motivoSinImportCompleto()` (`null`, `'owner'` o `'identidad'`). Sincrónica.
 * Devuelve `{ rechazo, idb: [[clave, valor]], ls: [[clave, texto]], resumen, meta }`.
 */
export function planDeImport({ copia, idb = {}, ls = {}, uid = null, motivoOwner = null, ahora = new Date(), censo = CENSO }) {
  const r = nuevoResumen();
  const meta = {
    exportadoEn: typeof copia?._exportedAt === 'string' ? copia._exportedAt : null,
    usuario: typeof copia?.spotifyUserId === 'string' ? copia.spotifyUserId : null,
  };
  const plan = { rechazo: null, idb: [], ls: [], resumen: { porClase: r.porClase, claves: r.claves }, meta };
  const rechazar = (motivo, texto) => ({ ...plan, rechazo: { motivo, texto } });

  // ── Los rechazos, antes de armar nada ──────────────────────────────────────────────────────────
  if (!esPlano(copia)) return rechazar('roto', TEXTOS.roto);
  if (copia._format !== 'spotify-tools-data') return rechazar('formato', TEXTOS.formato);
  if (copia._version === 2) return rechazar('v2', TEXTOS.v2);
  if (copia._version !== COPIA_VERSION) return rechazar('version', TEXTOS.version(copia._version));
  const nav = copia.navegador;
  if (!esPlano(nav) || !esPlano(copia._censo) || (nav.idb != null && !esPlano(nav.idb)) || (nav.localStorage != null && !esPlano(nav.localStorage))) return rechazar('roto', TEXTOS.roto);
  // Sin identidad confirmada no se sabe si es el mismo usuario. Y si `fonoteca_last_user_id` no es el uid, `prefKey()`
  // armaría otras claves que las de este plan.
  if (motivoOwner === 'identidad' || !uid || ls[ULTIMO_USUARIO] !== uid) return rechazar('identidad', TEXTOS.identidad);
  if (copia.spotifyUserId !== uid) return rechazar('otro-usuario', TEXTOS.otroUsuario);

  const salida = { idb: plan.idb, ls: plan.ls };
  const tuyo = { idb, ls };
  const agregar = (c, donde, k, v) => {
    if (c.fusion === 'discografia' && !esBaseValida(v?.value)) return r.anotar('noEntran', c, donde, k, 'no tiene forma de base de discografías');
    if (c.clave === CLAVE_MIGRADO && ls[BLOB_ETIQUETAS] != null) return r.anotar('noEntran', c, donde, k, 'tu navegador tiene etiquetas viejas sin migrar: la marca impediría migrarlas');
    salida[donde].push([k, donde === 'idb' ? revivir(v) : v]);
    r.anotar('agregan', c, donde, k);
  };
  const decidir = (c, donde, kArchivo, vArchivo, kTuya, vTuya) => {
    const u = unir(c, vTuya, vArchivo, ahora);
    if (u.escribir !== undefined) { salida[donde].push([kTuya, u.escribir]); r.anotar('unen', c, donde, kTuya); }
    else if (u.formaArchivo) r.anotar('noEntran', c, donde, kArchivo, u.formaArchivo);
    else r.anotar('tuya', c, donde, kTuya, u.formaTuya);
  };

  for (const [donde, deArchivo] of [['idb', nav.idb || {}], ['ls', nav.localStorage || {}]]) {
    // Primero se decide, clave por clave, si la clave PUEDE entrar; las que pueden se agrupan por fila del censo.
    const porFila = new Map();
    for (const k of Object.keys(deArchivo).sort()) {
      const c = entradaDe(donde, k, censo);
      const v = deArchivo[k];
      if (!c) { r.anotar('noEntran', null, donde, k, 'no está en el censo'); continue; }
      if (c.clase === 5) { r.anotar('noEntran', c, donde, k, 'es un dato de tu sesión: nunca se carga'); continue; }
      if (!c.entra) { r.anotar('noEntran', c, donde, k, 'el censo dice que no entra (se vuelve a pedir sola)'); continue; }
      const uv = uidDelValor(v);
      if (!esDelUsuario(c, k, uid, uid) || (c.porUsuario === 'clave' && uv !== undefined && uv !== uid)) { r.anotar('noEntran', c, donde, k, 'es de otro usuario'); continue; }
      if (donde === 'ls' && typeof v !== 'string') { r.anotar('noEntran', c, donde, k, 'en localStorage solo hay texto'); continue; }
      if (!porFila.has(c)) porFila.set(c, []);
      porFila.get(c).push(k);
    }

    for (const [c, claves] of porFila) {
      // ── El historial importado: la guarda del owner (v=298) ──────────────────────────────────────
      if (donde === 'idb' && c.clave === PREFIJO_HISTORIAL) {
        const mio = c.deUsuario(uid);
        if (motivoOwner === 'owner') {
          for (const k of claves) {
            if (k !== mio + DIAS) r.anotar('noEntran', c, donde, k, 'tu historial ya está en la app: de lo importado solo entra el detalle por día');
            else if (idb[k] === undefined) agregar(c, donde, k, deArchivo[k]);
            else r.anotar('tuya', c, donde, k);
          }
        } else if (Object.keys(idb).some((k) => k.startsWith(mio))) {
          for (const k of claves) r.anotar('noEntran', c, donde, k, 'ya tienes un historial en este navegador: dos historiales no se mezclan');
        } else {
          for (const k of claves) agregar(c, donde, k, deArchivo[k]);
        }
        continue;
      }

      // ── Las claves con `prefKey()`: la pelada y la prefijada son la MISMA preferencia ─────────────
      // `migratePrefKey()` borra la pelada cuando la prefijada existe. Si tu navegador no tiene ninguna de las dos, las
      // del archivo van tal cual (la app las migra como en el navegador de origen); si tiene alguna, se une lo que la
      // app LEERÍA de cada lado (la prefijada o, si no hay, la pelada) y va a la prefijada. La pelada tuya no se toca.
      if (c.porUsuario === 'pref') {
        const pel = c.clave, pre = `${c.clave}__${uid}`;
        if (ls[pel] === undefined && ls[pre] === undefined) { for (const k of claves) agregar(c, donde, k, deArchivo[k]); continue; }
        const kArch = claves.includes(pre) ? pre : pel;
        for (const k of claves) if (k !== kArch) r.anotar('tuya', c, donde, k);   // la que la app del origen descartaba
        decidir(c, donde, kArch, deArchivo[kArch], pre, ls[pre] ?? ls[pel]);
        continue;
      }

      for (const k of claves) {
        if (tuyo[donde][k] === undefined) agregar(c, donde, k, deArchivo[k]);
        else decidir(c, donde, k, deArchivo[k], k, tuyo[donde][k]);
      }
    }
  }
  return plan;
}

/**
 * La segunda red, antes de aplicar: los nombres de las claves del plan que el censo no conoce, que no deja entrar o
 * que son un secreto, o que van a `localStorage` sin ser texto. Si no viene vacía, NO SE APLICA NADA.
 */
export function segundaRed(plan, censo = CENSO) {
  const malas = [];
  for (const [donde, pares] of [['idb', plan?.idb], ['ls', plan?.ls]]) {
    if (!Array.isArray(pares)) { malas.push(`${donde}:*`); continue; }
    for (const par of pares) {
      const [k, v] = Array.isArray(par) ? par : [];
      const c = typeof k === 'string' ? entradaDe(donde, k, censo) : null;
      if (!c || !c.entra || c.clase === 5 || (donde === 'ls' && typeof v !== 'string')) malas.push(`${donde}:${k}`);
    }
  }
  return malas;
}

/**
 * (v=336) Si `aplicarPlan` escribió algo, también a medias (una cuota que cortó, o IndexedDB escrita y `localStorage`
 * no). Lo usan las DOS puntas: `alTerminarImport` (`api.js`) para avisar a las otras pestañas y `handleImportTodo`
 * (`features/dashboard.js`) para recargar esta. Escrito una sola vez para que no vuelvan a divergir: hasta v=335 la
 * primera avisaba con un import a medias y la segunda no recargaba.
 */
export function importEscribio(r) {
  return ((r?.idb || 0) + (r?.ls || 0)) > 0;
}

// ── El resumen en palabras, para el modal ─────────────────────────────────────────────────────────
const NOMBRES = {
  irrecuperable: 'Lo que solo vive en tu navegador',
  rehacible: 'Lo que se puede rehacer (con tu ZIP, con horas de consultas o con cuota de Spotify)',
  respaldada: 'Los ocultos (con su lista en Spotify)',
  preferencia: 'Tus preferencias',
  registro: 'Los registros',
};
const n = (x) => x.toLocaleString('es-ES');
/** Una línea por clase, en castellano: `[{ clase, titulo, texto }]`. */
export function resumenEnPalabras(resumen) {
  const orden = ['irrecuperable', 'respaldada', 'rehacible', 'preferencia', 'registro'];
  const clases = [...orden.filter((c) => resumen.porClase[c]), ...Object.keys(resumen.porClase).filter((c) => !orden.includes(c))];
  return clases.map((clase) => {
    const s = resumen.porClase[clase];
    const partes = [];
    if (s.agregan) partes.push(`${n(s.agregan)} ${s.agregan === 1 ? 'se agrega' : 'se agregan'}`);
    if (s.unen) partes.push(`${n(s.unen)} ${s.unen === 1 ? 'se une con lo tuyo' : 'se unen con lo tuyo'}`);
    if (s.tuya) partes.push(`${n(s.tuya)} ${s.tuya === 1 ? 'se queda como la tienes' : 'se quedan como las tienes'}`);
    if (s.noEntran) partes.push(`${n(s.noEntran)} no ${s.noEntran === 1 ? 'entra' : 'entran'}`);
    return { clase, titulo: NOMBRES[clase] || (clase === 'sin censar' ? 'Claves que esta versión no conoce' : clase), texto: partes.join(' · ') || 'nada' };
  });
}
